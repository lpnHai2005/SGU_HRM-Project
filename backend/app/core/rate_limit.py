"""Giới hạn tần suất theo khóa, dùng Redis nếu có và tự lùi về bộ nhớ của tiến trình."""
from collections import defaultdict, deque
import logging
import time

from app.core.config import settings

logger = logging.getLogger(__name__)


class UserRateLimiter:
    """Sliding window. Khóa có thể là user_id hoặc chuỗi bất kỳ."""

    def __init__(self, max_requests: int = 20, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.history = defaultdict(deque)
        self._call_count = 0
        self._redis_client = None
        self._redis_checked = False

    def _get_redis(self):
        if not self._redis_checked:
            self._redis_checked = True
            redis_url = getattr(settings, "REDIS_URL", None)
            if redis_url:
                try:
                    import redis
                    self._redis_client = redis.Redis.from_url(
                        redis_url,
                        decode_responses=True,
                        socket_timeout=0.5,
                        socket_connect_timeout=0.5
                    )
                    self._redis_client.ping()
                except Exception as e:
                    logger.warning(f"Rate Limiter Redis kết nối thất bại ({e}). Tự động dùng In-Memory.")
                    self._redis_client = None
        return self._redis_client

    def is_allowed(self, user_id) -> bool:
        """Ghi nhận một lượt; trả về False nếu đã chạm giới hạn."""
        now = time.time()
        cutoff = now - self.window_seconds

        r = self._get_redis()
        if r:
            try:
                key = f"ai_ratelimit:{user_id}"
                pipe = r.pipeline()
                pipe.zremrangebyscore(key, 0, cutoff)
                pipe.zcard(key)
                results = pipe.execute()
                current_count = results[1]
                if current_count >= self.max_requests:
                    return False
                pipe2 = r.pipeline()
                pipe2.zadd(key, {f"{now}_{self._call_count}": now})
                pipe2.expire(key, self.window_seconds + 5)
                pipe2.execute()
                return True
            except Exception as e:
                logger.warning(f"Lỗi Redis rate limit: {e}")

        self._call_count += 1

        # Định kỳ dọn các khóa không còn lượt nào trong cửa sổ để bộ nhớ không tăng mãi
        if self._call_count % 100 == 0:
            stale_uids = [u for u, d in list(self.history.items()) if not d or d[-1] < cutoff]
            for u in stale_uids:
                self.history.pop(u, None)

        dq = self.history[user_id]
        while dq and dq[0] < cutoff:
            dq.popleft()
        if len(dq) >= self.max_requests:
            return False
        dq.append(now)

        return True

    def is_blocked(self, key) -> bool:
        """Chỉ đọc: không tính thêm lượt."""
        cutoff = time.time() - self.window_seconds
        r = self._get_redis()
        if r:
            try:
                return r.zcount(f"ai_ratelimit:{key}", cutoff, "+inf") >= self.max_requests
            except Exception as e:
                logger.warning(f"Lỗi Redis rate limit: {e}")
        return sum(1 for at in self.history.get(key, ()) if at >= cutoff) >= self.max_requests

    def reset(self, key) -> None:
        r = self._get_redis()
        if r:
            try:
                r.delete(f"ai_ratelimit:{key}")
            except Exception as e:
                logger.warning(f"Lỗi Redis rate limit: {e}")
        self.history.pop(key, None)
