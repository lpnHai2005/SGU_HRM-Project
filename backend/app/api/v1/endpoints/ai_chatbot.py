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

    action_type = req.action_type
    payload = req.payload or {}

    # 1. Thực thi Tạo đơn nghỉ phép
    if action_type == "create_leave_request":
        leave_type_id = payload.get("leave_type_id")
        start_date = payload.get("start_date")
        end_date = payload.get("end_date")
        total_days = payload.get("total_days")
        reason = payload.get("reason", "Tạo qua Trợ lý AI Chatbot")
        attachment_url = req.attachment_url or payload.get("attachment_url")

        # Kiểm tra loại nghỉ có yêu cầu minh chứng
        lt_res = await db.execute(text("SELECT requires_attachment, type_name FROM leave_types WHERE leave_type_id = :id"), {"id": leave_type_id})
        lt = lt_res.mappings().first()
        if lt and lt["requires_attachment"] and not attachment_url:
            raise HTTPException(
                status_code=400,
                detail=f"Loại đơn '{lt['type_name']}' bắt buộc phải tải lên tệp minh chứng trước khi xác nhận!"
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
            "s_date": start_date,
            "e_date": end_date,
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

    # 2. Thực thi Hủy đơn nghỉ phép
    elif action_type == "cancel_leave_request":
        req_id = payload.get("request_id")
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
