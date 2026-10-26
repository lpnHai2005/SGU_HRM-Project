"""
TechZone HRM - AI Chatbot Cache Engine
Cung cấp bộ đệm (Deterministic Caching) cho các câu hỏi chính sách nhân sự (HR_POLICY):
- Hỗ trợ Redis khi có cấu hình REDIS_URL
- Tự động fallback sang In-Memory LRU Cache có TTL (Time-To-Live)
- Tiết kiệm chi phí token Mistral AI và giảm độ trễ từ vài giây xuống mili-giây
"""

import time
import json
import hashlib
import logging
from typing import Dict, Any, Optional
from collections import OrderedDict

from app.core.config import settings

logger = logging.getLogger(__name__)


class PolicyResponseCache:
    """Bộ đệm phản hồi chính sách hai tầng: Redis (nếu có) + In-Memory LRU TTL."""

    def __init__(self, capacity: int = 1000, default_ttl: int = 3600):
        self.capacity = capacity
        self.default_ttl = default_ttl
        self._memory_cache: OrderedDict[str, Dict[str, Any]] = OrderedDict()
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
                        socket_timeout=1.0,
                        socket_connect_timeout=1.0
                    )
                    self._redis_client.ping()
                    logger.info("✓ Đã kết nối Redis Cache cho AI Chatbot thành công.")
                except Exception as e:
                    logger.warning(f"Không thể kết nối Redis ({e}). Tự động dùng In-Memory LRU Cache.")
                    self._redis_client = None
        return self._redis_client

    @staticmethod
    def _normalize_key(query: str, user_role: str = "EMPLOYEE") -> str:
        """Chuẩn hóa câu hỏi để tạo cache key thống nhất."""
        q_clean = " ".join(query.lower().strip().split())
        # Bỏ dấu câu ở cuối
        q_clean = q_clean.rstrip("?!.,;:")
        key_raw = f"{user_role.upper()}:{q_clean}"
        digest = hashlib.sha256(key_raw.encode("utf-8")).hexdigest()[:16]
        return f"ai_policy_cache:{digest}"

    def get(self, query: str, user_role: str = "EMPLOYEE") -> Optional[Dict[str, Any]]:
        """Lấy dữ liệu từ bộ đệm nếu còn hạn hiệu lực."""
        if not getattr(settings, "AI_CHATBOT_CACHE_ENABLED", True):
            return None

        key = self._normalize_key(query, user_role)
        now = time.time()

        # 1. Thử đọc từ Redis
        r = self._get_redis()
        if r:
            try:
                cached_json = r.get(key)
                if cached_json:
                    return json.loads(cached_json)
            except Exception as e:
                logger.warning(f"Lỗi đọc Redis cache: {e}")

        # 2. Đọc từ In-Memory LRU
        if key in self._memory_cache:
            entry = self._memory_cache[key]
            if entry["expires_at"] > now:
                # Đưa lên đầu danh sách LRU
                self._memory_cache.move_to_end(key)
                return entry["data"]
            else:
                del self._memory_cache[key]

        return None

    def set(self, query: str, data: Dict[str, Any], user_role: str = "EMPLOYEE", ttl: Optional[int] = None) -> None:
        """Lưu kết quả câu hỏi chính sách vào bộ đệm."""
        if not getattr(settings, "AI_CHATBOT_CACHE_ENABLED", True):
            return

        key = self._normalize_key(query, user_role)
        ttl_seconds = ttl or getattr(settings, "AI_CHATBOT_CACHE_TTL_SECONDS", self.default_ttl)
        now = time.time()

        # 1. Ghi vào Redis
        r = self._get_redis()
        if r:
            try:
                r.setex(key, ttl_seconds, json.dumps(data, ensure_ascii=False, default=str))
            except Exception as e:
                logger.warning(f"Lỗi ghi Redis cache: {e}")

        # 2. Ghi vào In-Memory LRU
        if len(self._memory_cache) >= self.capacity:
            # Loại bỏ phần tử cũ nhất (LRU eviction)
            self._memory_cache.popitem(last=False)

        self._memory_cache[key] = {
            "expires_at": now + ttl_seconds,
            "data": data
        }

    def clear(self) -> None:
        """Xóa toàn bộ bộ đệm trong bộ nhớ."""
        self._memory_cache.clear()
        r = self._get_redis()
        if r:
            try:
                keys = r.keys("ai_policy_cache:*")
                if keys:
                    r.delete(*keys)
            except Exception:
                pass


# Global singleton cache instance
ai_policy_cache = PolicyResponseCache()
