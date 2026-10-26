"""
TechZone HRM - AI Chatbot API Endpoints
Cung cấp cổng giao tiếp Chatbot Agentic RAG, điều phối LangGraph và xử lý HITL Action Confirmations.
"""

from typing import Dict, Any, Optional
from datetime import datetime, date
import json
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.database import get_db
from app.api.deps import get_current_user
from app.schemas.schemas import (
    AIChatbotQuery, AIChatbotResponse, AIChatbotConfirmActionRequest
)
from app.core.ai_chatbot_graph import run_ai_chatbot_pipeline, stream_ai_chatbot_pipeline
from app.core.ai_chatbot_db import get_chat_history, save_chat_message

router = APIRouter()


@router.post("/stream", summary="Hỏi đáp AI HR Chatbot dạng Streaming thời gian thực (SSE)")
async def ask_ai_chatbot_stream(
    body: AIChatbotQuery,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Điểm vào Streaming Server-Sent Events (SSE):
    - Trả về từng token ngay khi LLM sinh ra
    - Tránh cảm giác phải chờ đợi lâu
    - Tự động lưu toàn bộ lịch sử hội thoại vào Supabase PostgreSQL
    """
    if not body.query or not body.query.strip():
        raise HTTPException(status_code=400, detail="Vui lòng nhập nội dung câu hỏi.")

    async def event_generator():
        async for event in stream_ai_chatbot_pipeline(
            query=body.query.strip(),
            current_user=current_user,
            db=db,
            thread_id=body.thread_id
        ):
            yield f"data: {json.dumps(event, default=str, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.get("/history", summary="Lấy lịch sử trò chuyện chính thức từ Supabase PostgreSQL")
async def get_user_chat_history(
    thread_id: Optional[str] = Query(None, description="Thread ID để lọc hội thoại"),
    limit: int = Query(50, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Truy xuất lịch sử tin nhắn của người dùng hiện tại từ bảng ai_chat_messages trên Supabase.
    """
    user_id = current_user.get("user_id")
    if not user_id:
        return {"messages": []}

    rows = await get_chat_history(db, user_id=user_id, thread_id=thread_id, limit=limit)
    return {"thread_id": thread_id, "messages": rows}


@router.post("/query", response_model=AIChatbotResponse, summary="Hỏi đáp AI HR Chatbot với LangGraph Agentic RAG")
async def ask_ai_chatbot(
    body: AIChatbotQuery,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Điểm vào duy nhất cho câu hỏi của nhân viên / quản lý:
    - Phân luồng Router (Chính sách RAG / Dữ liệu cá nhân Tools / Hybrid)
    - Chặn câu hỏi ngoài phạm vi dự án HRM TechZone (Guardrail)
    - Kiểm tra RBAC Scope Check
    - Trả về câu trả lời kèm Trích dẫn PDF (Tên tài liệu & Trang) và Đề xuất hành động (HITL) nếu có
    """
    if not body.query or not body.query.strip():
        raise HTTPException(status_code=400, detail="Vui lòng nhập nội dung câu hỏi.")

    result = await run_ai_chatbot_pipeline(body.query.strip(), current_user, db, thread_id=body.thread_id)

    return AIChatbotResponse(
        answer=result.get("final_answer", ""),
        sources=result.get("sources", []),
        confidence=0.98 if result.get("sources") or result.get("tools_used") else 0.85,
        tools_used=result.get("tools_used", []),
        action_proposal=result.get("action_proposal"),
        requires_action=bool(result.get("requires_action", False)),
        thread_id=result.get("thread_id")
    )


@router.post("/confirm-action", summary="Xác nhận thực thi hành động nhạy cảm HITL (Tạo đơn / Hủy đơn)")
async def confirm_chatbot_action(
    req: AIChatbotConfirmActionRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Xác nhận của con người (Human-in-the-Loop) để ghi nhận thay đổi CSDL sau khi xem Action Proposal Card:
    - create_leave_request: Ghi nhận đơn nghỉ phép mới (kèm attachment_url nếu là nghỉ ốm/thai sản/thôi việc)
    - cancel_leave_request: Cập nhật trạng thái đơn thành CANCELLED
    """
    if not req.confirmed:
        return {"status": "CANCELLED_BY_USER", "message": "Hành động đã được hủy bỏ theo yêu cầu của bạn."}

    emp_id = current_user.get("employee_id")
    if not emp_id:
        raise HTTPException(status_code=400, detail="Tài khoản chưa được liên kết với nhân viên.")

    # Đánh dấu action_proposal trong tin nhắn của thread là đã được xác nhận (không hiện lại khi mở lại chat)
    if req.thread_id:
        try:
            await db.execute(text("""
                UPDATE ai_chat_messages
                SET action_proposal = jsonb_set(COALESCE(action_proposal, '{}'::jsonb), '{confirmed}', 'true')
                WHERE thread_id = :tid AND action_proposal IS NOT NULL
            """), {"tid": str(req.thread_id).strip()})
        except Exception:
            pass

    action_type = req.action_type
    payload = req.payload or {}

    # 1. Thực thi Tạo đơn nghỉ phép (Kiểm tra toàn bộ ràng buộc nghiệp vụ)
    if action_type == "create_leave_request":
        leave_type_id = payload.get("leave_type_id")
        start_date = payload.get("start_date")
        end_date = payload.get("end_date")
        reason = (payload.get("reason") or "Đăng ký qua Trợ lý AI Chatbot").strip()
        attachment_url = req.attachment_url or payload.get("attachment_url")

        s_date_obj = date.fromisoformat(start_date) if isinstance(start_date, str) else (start_date or date.today())
        e_date_obj = date.fromisoformat(end_date) if isinstance(end_date, str) else (end_date or s_date_obj)

        today = date.today()
        if s_date_obj < today:
            raise HTTPException(
                status_code=400,
                detail=f"Không thể tạo đơn nghỉ phép cho ngày trong quá khứ (trước ngày {today.strftime('%d/%m/%Y')}). Vui lòng chọn ngày bắt đầu từ hôm nay trở đi."
            )

        if s_date_obj > e_date_obj:
            raise HTTPException(status_code=400, detail="Ngày bắt đầu nghỉ không được lớn hơn ngày kết thúc.")

        total_days = float((e_date_obj - s_date_obj).days + 1)
        if total_days <= 0:
            raise HTTPException(status_code=400, detail="Số ngày xin nghỉ phải lớn hơn 0.")

        # Kiểm tra loại nghỉ
        lt_res = await db.execute(
            text("SELECT leave_type_id, type_code, type_name, max_days_allowed, requires_attachment FROM leave_types WHERE leave_type_id = :id"),
            {"id": leave_type_id}
        )
        lt = lt_res.mappings().first()
        if not lt:
            raise HTTPException(status_code=404, detail="Loại đơn nghỉ phép không tồn tại.")

        if lt["requires_attachment"] and not attachment_url:
            raise HTTPException(
                status_code=400,
                detail=f"Loại đơn '{lt['type_name']}' bắt buộc phải cung cấp tệp hoặc liên kết minh chứng trước khi xác nhận!"
            )

        # Kiểm tra trùng lặp thời gian với các đơn đã nộp (PENDING, STORE_APPROVED, HR_APPROVED)
        overlap_res = await db.execute(text("""
            SELECT request_id, start_date, end_date, status
            FROM leave_requests
            WHERE employee_id = :emp_id
              AND status IN ('PENDING', 'STORE_APPROVED', 'HR_APPROVED')
              AND start_date <= :end_date AND end_date >= :start_date
            LIMIT 1
        """), {
            "emp_id": emp_id,
            "start_date": s_date_obj,
            "end_date": e_date_obj
        })
        overlap = overlap_res.mappings().first()
        if overlap:
            s_str = overlap['start_date'].strftime('%d/%m/%Y') if hasattr(overlap['start_date'], 'strftime') else str(overlap['start_date'])
            e_str = overlap['end_date'].strftime('%d/%m/%Y') if hasattr(overlap['end_date'], 'strftime') else str(overlap['end_date'])
            raise HTTPException(
                status_code=400,
                detail=f"Bạn đã có đơn nghỉ phép (Mã #{overlap['request_id']}) trong khoảng thời gian {s_str} đến {e_str} đang chờ duyệt hoặc đã được phê duyệt. Không thể tạo đơn trùng lịch."
            )

        # Kiểm tra hạn mức phép năm nếu là PHEP_NAM hoặc hạn mức tối đa của loại đơn
        if lt["type_code"] == "PHEP_NAM":
            from app.core.ai_chatbot_tools import get_my_leave_balance
            bal = await get_my_leave_balance({}, current_user, db)
            rem = bal.get("annual_leave_remaining", 0)
            pend = bal.get("annual_leave_pending", 0)
            avail = max(0.0, rem - pend)
            if total_days > avail:
                raise HTTPException(
                    status_code=400,
                    detail=f"Số ngày nghỉ yêu cầu ({total_days} ngày) vượt quá số ngày phép năm còn lại khả dụng của bạn ({avail} ngày; đã duyệt: {bal.get('annual_leave_used', 0)} ngày, đang chờ duyệt: {pend} ngày). Vui lòng chọn loại nghỉ không lương hoặc điều chỉnh lại thời gian."
                )
        else:
            max_days = lt.get("max_days_allowed")
            if max_days and float(max_days) > 0 and total_days > float(max_days):
                raise HTTPException(
                    status_code=400,
                    detail=f"Loại nghỉ '{lt['type_name']}' chỉ được nghỉ tối đa {max_days} ngày theo quy định. Bạn đang đăng ký {total_days} ngày."
                )

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
            "lt_id": leave_type_id,
            "s_date": s_date_obj,
            "e_date": e_date_obj,
            "days": total_days,
            "reason": reason,
            "att": attachment_url
        })
        new_row = ins_res.mappings().first()
        await db.commit()

        return {
            "status": "SUCCESS",
            "message": f"Đã nộp thành công đơn {lt['type_name'] if lt else ''} (Mã đơn: #{new_row['request_id']})!",
            "request_id": new_row["request_id"],
            "leave_status": new_row["status"],
            "created_at": new_row["created_at"].isoformat() if new_row.get("created_at") else None
        }

    # 2. Thực thi Hủy đơn nghỉ phép (Hỗ trợ đơn lẻ, danh sách hoặc toàn bộ)
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

            await db.commit()
            id_list_str = ", ".join(f"#{r['request_id']}" for r in cancelled_rows)
            return {
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

            await db.commit()
            return {
                "status": "SUCCESS",
                "message": f"Đã hủy thành công đơn nghỉ phép #{req_id}.",
                "request_id": row["request_id"],
                "leave_status": row["status"]
            }

    else:
        raise HTTPException(status_code=400, detail=f"Hành động '{action_type}' không được hỗ trợ.")
