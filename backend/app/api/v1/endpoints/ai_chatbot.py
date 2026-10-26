"""
TechZone HRM - AI Chatbot API Endpoints
Cung cấp cổng giao tiếp Chatbot Agentic RAG, điều phối StateGraph và xử lý HITL Action Confirmations.
Bảo mật Production: Quyền sở hữu thread_id (chống IDOR), Cưỡng chế HITL tại server (chống double-submit),
giới hạn tốc độ theo user (Rate Limiting) và che giấu lỗi thô hệ thống.
"""

from typing import Dict, Any, Optional
from datetime import datetime, date, timezone
from collections import defaultdict, deque
import time
import json
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.config import settings
from app.core.database import get_db
from app.api.deps import get_current_user, log_audit
from app.schemas.schemas import (
    AIChatbotQuery, AIChatbotResponse, AIChatbotConfirmActionRequest
)
from app.core.ai_chatbot_graph import run_ai_chatbot_pipeline, stream_ai_chatbot_pipeline
from app.core.ai_chatbot_db import (
    get_chat_history, save_chat_message, get_action_proposal, update_action_proposal_status
)
from app.core.ai_chatbot_tools import validate_leave_request

logger = logging.getLogger(__name__)
router = APIRouter()


# ===================================================================================
# RATE LIMITER PER USER (1.8, 1B.11)
# ===================================================================================

class UserRateLimiter:
    """Sliding Window Rate Limiter hỗ trợ phân tán qua Redis và In-Memory an toàn với TTL purge (1.8, 1B.11)."""
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

    def is_allowed(self, user_id: int) -> bool:
        now = time.time()
        cutoff = now - self.window_seconds

        # 1. Thử Redis Sliding Window nếu có
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

        # 2. Fallback In-Memory Sliding Window kèm Garbage Collection
        self._call_count += 1

        # Định kỳ mỗi 100 lần gọi dọn dẹp các user không còn request nào trong window (tránh rò rỉ RAM)
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


ai_chatbot_rate_limiter = UserRateLimiter(
    max_requests=getattr(settings, "AI_CHATBOT_RATE_LIMIT_PER_MINUTE", 20),
    window_seconds=60
)


def check_ai_chatbot_rate_limit(current_user: dict = Depends(get_current_user)) -> dict:
    """Dependency giới hạn số lượng request theo user_id để chống spam và cạn kiệt tài nguyên (1.8, 1B.11)."""
    uid = current_user.get("user_id") or 0
    if not ai_chatbot_rate_limiter.is_allowed(uid):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Bạn đã gửi quá nhiều yêu cầu trong thời gian ngắn. Vui lòng chờ 1 phút trước khi tiếp tục."
        )
    return current_user


# ===================================================================================
# STREAMING ENDPOINT (SSE)
# ===================================================================================

@router.post("/stream", summary="Hỏi đáp AI HR Chatbot dạng Streaming thời gian thực (SSE)")
async def ask_ai_chatbot_stream(
    body: AIChatbotQuery,
    current_user: dict = Depends(check_ai_chatbot_rate_limit),
    db: AsyncSession = Depends(get_db)
):
    """
    Điểm vào Streaming Server-Sent Events (SSE):
    - Trả về từng token ngay khi LLM sinh ra
    - Tự động lưu toàn bộ lịch sử hội thoại vào Supabase PostgreSQL
    - Bảo vệ an toàn: Bắt lỗi phía server và trả sự kiện lỗi chuẩn hóa, không leak exception thô (1.7)
    """
    if not body.query or not body.query.strip():
        raise HTTPException(status_code=400, detail="Vui lòng nhập nội dung câu hỏi.")

    async def event_generator():
        try:
            async for event in stream_ai_chatbot_pipeline(
                query=body.query.strip(),
                current_user=current_user,
                db=db,
                thread_id=body.thread_id
            ):
                yield f"data: {json.dumps(event, default=str, ensure_ascii=False)}\n\n"
        except Exception as e:
            logger.exception(f"Lỗi unhandled trong SSE stream cho user {current_user.get('user_id')}: {e}")
            err_event = {
                "event": "error",
                "message": "Đã xảy ra lỗi trong quá trình xử lý yêu cầu. Vui lòng thử lại sau."
            }
            yield f"data: {json.dumps(err_event, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


# ===================================================================================
# HISTORY ENDPOINT
# ===================================================================================

@router.get("/history", summary="Lấy lịch sử trò chuyện chính thức từ Supabase PostgreSQL")
async def get_user_chat_history(
    thread_id: Optional[str] = Query(None, description="Thread ID để lọc hội thoại"),
    limit: int = Query(50, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Truy xuất lịch sử tin nhắn của người dùng hiện tại từ bảng ai_chat_messages trên Supabase.
    Đảm bảo quyền sở hữu: Người dùng chỉ xem được tin nhắn thuộc sở hữu user_id của chính mình (1.1).
    """
    user_id = current_user.get("user_id")
    if not user_id:
        return {"messages": []}

    rows = await get_chat_history(db, user_id=user_id, thread_id=thread_id, limit=limit)
    return {"thread_id": thread_id, "messages": rows}


# ===================================================================================
# NON-STREAMING QUERY ENDPOINT
# ===================================================================================

@router.post("/query", response_model=AIChatbotResponse, summary="Hỏi đáp AI HR Chatbot với LangGraph Agentic RAG")
async def ask_ai_chatbot(
    body: AIChatbotQuery,
    current_user: dict = Depends(check_ai_chatbot_rate_limit),
    db: AsyncSession = Depends(get_db)
):
    """
    Điểm vào duy nhất cho câu hỏi đồng bộ:
    - Phân luồng Router (Chính sách RAG / Dữ liệu cá nhân Tools / Hybrid)
    - Chặn câu hỏi ngoài phạm vi dự án HRM TechZone (Guardrail)
    - Kiểm tra RBAC Scope Check
    - Trả về câu trả lời kèm Trích dẫn PDF và Đề xuất hành động (HITL) nếu có
    """
    if not body.query or not body.query.strip():
        raise HTTPException(status_code=400, detail="Vui lòng nhập nội dung câu hỏi.")

    result = await run_ai_chatbot_pipeline(body.query.strip(), current_user, db, thread_id=body.thread_id)

    return AIChatbotResponse(
        answer=result.get("final_answer", ""),
        sources=result.get("sources", []),
        confidence=float(result.get("confidence", 0.95)) if result.get("confidence") is not None else (0.98 if result.get("sources") or result.get("tools_used") else 0.85),
        tools_used=result.get("tools_used", []),
        action_proposal=result.get("action_proposal"),
        requires_action=bool(result.get("requires_action", False)),
        thread_id=result.get("thread_id")
    )


# ===================================================================================
# HITL CONFIRMATION ENDPOINT (1.2, 1.3, 1B.2, 1B.11, 1B.12)
# ===================================================================================

@router.post("/confirm-action", summary="Xác nhận thực thi hành động nhạy cảm HITL (Tạo đơn / Hủy đơn)")
async def confirm_chatbot_action(
    req: AIChatbotConfirmActionRequest,
    current_user: dict = Depends(check_ai_chatbot_rate_limit),
    db: AsyncSession = Depends(get_db)
):
    """
    Xác nhận của con người (Human-in-the-Loop) cưỡng chế bảo mật tại Server (1.2):
    - Đòi hỏi proposal_id hợp lệ đã lưu trước đó trong CSDL.
    - Transaction nguyên khối với SELECT ... FOR UPDATE proposal.
    - Chống IDOR (kiểm tra user_id), chống Double-Submit (idempotency), kiểm tra hết hạn.
    - Chỉ cho phép client ghi đè các trường được phép chỉnh sửa: start_date, end_date, reason, attachment_url.
    - Dùng savepoint begin_nested() an toàn khi cập nhật ai_chat_messages (1B.2).
    - Ghi nhận Audit Log hệ thống (1B.12).
    """
    user_id = current_user.get("user_id")
    emp_id = current_user.get("employee_id")

    if not user_id:
        raise HTTPException(status_code=401, detail="Chưa xác thực danh tính người dùng.")
    if not emp_id:
        raise HTTPException(status_code=400, detail="Tài khoản chưa được liên kết với hồ sơ nhân viên.")

    # Tương thích client cũ: Nếu chưa gửi proposal_id nhưng có thread_id, tìm proposal PENDING gần nhất
    if not req.proposal_id and req.thread_id:
        res_p = await db.execute(text("""
            SELECT proposal_id FROM ai_chat_action_proposals
            WHERE user_id = :uid AND thread_id = :tid AND status = 'PENDING'
            ORDER BY created_at DESC LIMIT 1
        """), {"uid": user_id, "tid": str(req.thread_id).strip()})
        p_row = res_p.mappings().first()
        if p_row:
            req.proposal_id = p_row["proposal_id"]

    # 1.2 Cưỡng chế proposal_id tại server
    if not req.proposal_id:
        raise HTTPException(
            status_code=400,
            detail="Thiếu mã đề xuất (proposal_id). Vui lòng yêu cầu AI Chatbot lập dự thảo đề xuất trước khi xác nhận."
        )

    proposal = await get_action_proposal(db, str(req.proposal_id), for_update=True)
    if not proposal:
        raise HTTPException(
            status_code=404,
            detail="Không tìm thấy đề xuất hành động (proposal_id không tồn tại hoặc đã bị xóa)."
        )

    # Kiểm tra quyền sở hữu (IDOR Check)
    if proposal["user_id"] != user_id:
        raise HTTPException(
            status_code=403,
            detail="Truy cập bị từ chối: Đề xuất hành động này không thuộc sở hữu của bạn."
        )

    # Kiểm tra Idempotent (Bấm đúp / Network Retry)
    if proposal["status"] == "CONFIRMED":
        return proposal.get("execution_result") or {
            "status": "SUCCESS",
            "message": "Hành động đã được xác nhận thực thi trước đó (idempotent)."
        }

    # Kiểm tra thời hạn hiệu lực (Expires Check)
    exp = proposal.get("expires_at")
    now_utc = datetime.now(timezone.utc)
    if proposal["status"] == "EXPIRED" or (exp and exp < now_utc):
        await update_action_proposal_status(db, str(req.proposal_id), "EXPIRED")
        await db.commit()
        raise HTTPException(
            status_code=400,
            detail="Đề xuất hành động này đã hết hạn hiệu lực (quá 30 phút). Vui lòng gửi lại yêu cầu trong chat."
        )

    if proposal["status"] != "PENDING":
        raise HTTPException(
            status_code=400,
            detail=f"Đề xuất hành động đang ở trạng thái '{proposal['status']}', không thể thực thi."
        )

    # Nếu người dùng bấm Từ chối / Hủy (1B.2)
    if not req.confirmed:
        await update_action_proposal_status(db, str(req.proposal_id), "CANCELLED")
        await db.commit()
        await log_audit(
            db=db,
            user_id=user_id,
            action="CANCEL_ACTION_PROPOSAL",
            entity_name="ai_chat_action_proposals",
            entity_id=str(req.proposal_id),
            new_values={"status": "CANCELLED"}
        )
        return {"status": "CANCELLED_BY_USER", "message": "Hành động đã được hủy bỏ theo yêu cầu của bạn."}

    action_type = proposal["action_type"]
    payload = dict(proposal["payload"] or {})

    # Ghi đè an toàn các trường được phép chỉnh sửa
    if req.start_date:
        payload["start_date"] = req.start_date.isoformat()
    if req.end_date:
        payload["end_date"] = req.end_date.isoformat()
    if req.reason:
        payload["reason"] = req.reason.strip()
    if req.attachment_url:
        payload["attachment_url"] = req.attachment_url.strip()

    # THỰC THI 1: TẠO ĐƠN NGHỈ PHÉP
    if action_type == "create_leave_request":
        leave_type_id = payload.get("leave_type_id") or payload.get("leave_type_code")
        start_date_val = payload.get("start_date")
        end_date_val = payload.get("end_date")
        reason = (payload.get("reason") or "Đăng ký qua Trợ lý AI Chatbot").strip()
        attachment_url = payload.get("attachment_url")

        if not leave_type_id or not start_date_val or not end_date_val:
            raise HTTPException(status_code=400, detail="Thiếu thông tin loại phép hoặc ngày bắt đầu/kết thúc.")

        try:
            s_date_obj = date.fromisoformat(start_date_val) if isinstance(start_date_val, str) else start_date_val
            e_date_obj = date.fromisoformat(end_date_val) if isinstance(end_date_val, str) else end_date_val
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Định dạng ngày nghỉ không hợp lệ (YYYY-MM-DD).")

        # Xác thực tập trung qua Unified Leave Service (2.7)
        val = await validate_leave_request(
            db=db,
            current_user=current_user,
            leave_type_code_or_id=leave_type_id,
            start_d=s_date_obj,
            end_d=e_date_obj,
            reason=reason,
            attachment_url=attachment_url
        )
        if not val["valid"]:
            raise HTTPException(status_code=val.get("status_code", 400), detail=val["error"])

        lt = val["leave_type"]
        total_days = val["total_days"]

        insert_q = text("""
            INSERT INTO leave_requests (
                employee_id, leave_type_id, start_date, end_date, total_days,
                reason, attachment_url, status, created_at, updated_at
            )
            VALUES (
                :emp_id, :lt_id, :s_date, :e_date, :days,
                :reason, :att, 'PENDING', NOW(), NOW()
            )
            RETURNING request_id, status, created_at
        """)
        ins_res = await db.execute(insert_q, {
            "emp_id": emp_id,
            "lt_id": lt["leave_type_id"],
            "s_date": s_date_obj,
            "e_date": e_date_obj,
            "days": total_days,
            "reason": reason,
            "att": attachment_url
        })
        new_row = ins_res.mappings().first()

        execution_result = {
            "status": "SUCCESS",
            "message": f"Đã nộp thành công đơn {lt['type_name']} (Mã đơn: #{new_row['request_id']})!",
            "request_id": new_row["request_id"],
            "leave_status": new_row["status"],
            "created_at": new_row["created_at"].isoformat() if new_row.get("created_at") else None
        }

        # Cập nhật proposal thành CONFIRMED và lưu kết quả
        await update_action_proposal_status(db, str(req.proposal_id), "CONFIRMED", execution_result)

        # Cập nhật cờ confirmed trong ai_chat_messages với savepoint an toàn (1B.2)
        thread_id = proposal.get("thread_id")
        if thread_id:
            try:
                async with db.begin_nested():
                    await db.execute(text("""
                        UPDATE ai_chat_messages
                        SET action_proposal = jsonb_set(COALESCE(action_proposal, '{}'::jsonb), '{confirmed}', 'true')
                        WHERE thread_id = :tid AND user_id = :uid AND action_proposal IS NOT NULL
                    """), {"tid": str(thread_id).strip(), "uid": user_id})
            except Exception:
                pass

        await db.commit()

        # Audit Log (1B.12)
        await log_audit(
            db=db,
            user_id=user_id,
            action="CREATE_LEAVE_CONFIRMED",
            entity_name="leave_requests",
            entity_id=str(new_row["request_id"]),
            new_values=execution_result
        )

        return execution_result

    # THỰC THI 2: HỦY ĐƠN NGHỈ PHÉP
    elif action_type == "cancel_leave_request":
        req_id = payload.get("request_id")
        req_ids = payload.get("request_ids")
        cancel_all = payload.get("cancel_all", False)

        if cancel_all or req_ids:
            if req_ids and isinstance(req_ids, list):
                target_ids = [int(i) for i in req_ids]
            else:
                target_ids = []

            if target_ids:
                upd_q = text("""
                    UPDATE leave_requests
                    SET status = 'CANCELLED', updated_at = NOW()
                    WHERE request_id = ANY(:ids) AND employee_id = :emp_id AND status IN ('PENDING', 'STORE_APPROVED')
                    RETURNING request_id, status
                """)
                upd_res = await db.execute(upd_q, {"ids": target_ids, "emp_id": emp_id})
            else:
                upd_q = text("""
                    UPDATE leave_requests
                    SET status = 'CANCELLED', updated_at = NOW()
                    WHERE employee_id = :emp_id AND status IN ('PENDING', 'STORE_APPROVED')
                    RETURNING request_id, status
                """)
                upd_res = await db.execute(upd_q, {"emp_id": emp_id})

            cancelled_rows = upd_res.mappings().all()
            if not cancelled_rows:
                raise HTTPException(status_code=400, detail="Không có đơn nghỉ phép nào đang chờ duyệt để hủy.")

            id_list_str = ", ".join(f"#{r['request_id']}" for r in cancelled_rows)
            execution_result = {
                "status": "SUCCESS",
                "message": f"Đã hủy thành công {len(cancelled_rows)} đơn nghỉ phép đang chờ duyệt ({id_list_str}).",
                "cancelled_count": len(cancelled_rows)
            }
        else:
            if not req_id:
                raise HTTPException(status_code=400, detail="Thiếu mã đơn cần hủy.")

            upd_q = text("""
                UPDATE leave_requests
                SET status = 'CANCELLED', updated_at = NOW()
                WHERE request_id = :id AND employee_id = :emp_id AND status IN ('PENDING', 'STORE_APPROVED')
                RETURNING request_id, status
            """)
            upd_res = await db.execute(upd_q, {"id": int(req_id), "emp_id": emp_id})
            row = upd_res.mappings().first()
            if not row:
                raise HTTPException(status_code=400, detail="Không tìm thấy đơn hoặc đơn đã được phê duyệt chính thức/đã hủy.")

            execution_result = {
                "status": "SUCCESS",
                "message": f"Đã hủy thành công đơn nghỉ phép #{req_id}.",
                "request_id": row["request_id"],
                "leave_status": row["status"]
            }

        await update_action_proposal_status(db, str(req.proposal_id), "CONFIRMED", execution_result)

        # Cập nhật cờ confirmed trong ai_chat_messages với savepoint an toàn (1B.2)
        thread_id = proposal.get("thread_id")
        if thread_id:
            try:
                async with db.begin_nested():
                    await db.execute(text("""
                        UPDATE ai_chat_messages
                        SET action_proposal = jsonb_set(COALESCE(action_proposal, '{}'::jsonb), '{confirmed}', 'true')
                        WHERE thread_id = :tid AND user_id = :uid AND action_proposal IS NOT NULL
                    """), {"tid": str(thread_id).strip(), "uid": user_id})
            except Exception:
                pass

        await db.commit()

        # Audit Log (1B.12)
        await log_audit(
            db=db,
            user_id=user_id,
            action="CANCEL_LEAVE_CONFIRMED",
            entity_name="leave_requests",
            entity_id=str(payload.get("request_id") or "MULTIPLE"),
            new_values=execution_result
        )

        return execution_result

    else:
        raise HTTPException(status_code=400, detail=f"Hành động '{action_type}' không được hỗ trợ.")
