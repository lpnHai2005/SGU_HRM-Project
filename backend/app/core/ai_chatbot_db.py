from uuid import uuid4, UUID
from datetime import datetime, timezone, timedelta
"""
TechZone HRM - AI Chatbot Database Persistence
Quản lý lưu trữ và truy xuất lịch sử trò chuyện chính thức trong bảng ai_chat_messages và ai_chat_action_proposals trên Supabase PostgreSQL.
"""

import json
from typing import List, Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text


async def save_chat_message(
    db: AsyncSession,
    thread_id: str,
    user_id: Optional[int],
    employee_id: Optional[int],
    sender: str,  # 'user' | 'assistant'
    content: str,
    sources: Optional[List[str]] = None,
    tools_used: Optional[List[str]] = None,
    action_proposal: Optional[Dict[str, Any]] = None,
    auto_commit: bool = True
) -> int:
    """Lưu 1 tin nhắn vào CSDL Supabase PostgreSQL"""
    query = text("""
        INSERT INTO ai_chat_messages (
            thread_id, user_id, employee_id, sender, content,
            sources, tools_used, action_proposal, created_at
        )
        VALUES (
            :tid, :uid, :eid, :sender, :content,
            CAST(:sources AS jsonb), CAST(:tools AS jsonb), CAST(:prop AS jsonb), NOW()
        )
        RETURNING message_id;
    """)

    safe_uid = None
    if user_id is not None:
        try:
            safe_uid = int(user_id)
        except (ValueError, TypeError):
            safe_uid = None

    safe_eid = None
    if employee_id is not None:
        try:
            safe_eid = int(employee_id)
        except (ValueError, TypeError):
            safe_eid = None

    res = await db.execute(query, {
        "tid": thread_id,
        "uid": safe_uid,
        "eid": safe_eid,
        "sender": sender,
        "content": content,
        "sources": json.dumps(sources or [], ensure_ascii=False),
        "tools": json.dumps(tools_used or [], ensure_ascii=False),
        "prop": json.dumps(action_proposal, ensure_ascii=False, default=str) if action_proposal else None,
    })
    row = res.mappings().first()
    if auto_commit:
        await db.commit()
    return row["message_id"] if row else 0


async def save_turn(
    db: AsyncSession,
    thread_id: str,
    user_id: Optional[int],
    employee_id: Optional[int],
    query: str,
    answer: str,
    sources: Optional[List[str]] = None,
    tools_used: Optional[List[str]] = None,
    action_proposal: Optional[Dict[str, Any]] = None
) -> None:
    """Lưu nguyên khối cả lượt tương tác (User query + Assistant answer) trong 1 transaction an toàn (3.1)."""
    try:
        await save_chat_message(
            db=db,
            thread_id=thread_id,
            user_id=user_id,
            employee_id=employee_id,
            sender="user",
            content=query,
            auto_commit=False
        )
        await save_chat_message(
            db=db,
            thread_id=thread_id,
            user_id=user_id,
            employee_id=employee_id,
            sender="assistant",
            content=answer,
            sources=sources,
            tools_used=tools_used,
            action_proposal=action_proposal,
            auto_commit=False
        )
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise e


async def get_chat_history(
    db: AsyncSession,
    user_id: int,
    thread_id: Optional[str] = None,
    limit: int = 50
) -> List[Dict[str, Any]]:
    """Truy xuất lịch sử tin nhắn gần đây của người dùng trên Supabase, lấy mới nhất và sắp xếp thời gian tăng dần (2.1)."""
    safe_uid = None
    if user_id is not None:
        try:
            safe_uid = int(user_id)
        except (ValueError, TypeError):
            safe_uid = None

    if safe_uid is None:
        return []

    where = ["user_id = :uid"]
    params: Dict[str, Any] = {"uid": safe_uid, "lim": limit}

    if thread_id:
        where.append("thread_id = :tid")
        params["tid"] = thread_id

    query = text(f"""
        SELECT message_id, thread_id, sender, content, sources, tools_used, action_proposal, created_at
        FROM ai_chat_messages
        WHERE {' AND '.join(where)}
        ORDER BY created_at DESC
        LIMIT :lim
    """)

    res = await db.execute(query, params)
    rows = [dict(r) for r in res.mappings().all()]
    rows.reverse()
    return rows


async def resolve_thread_id(
    db: AsyncSession,
    user_id: Optional[int],
    thread_id: Optional[str]
) -> str:
    """
    Xác định và bảo vệ quyền sở hữu của thread_id (Chống IDOR).
    - Nếu thread_id rỗng: Tạo thread mới theo chuẩn thread-user-{user_id}-{uuid4}.
    - Nếu thread_id đã tồn tại và thuộc về user_id khác: Lập tức sinh thread mới riêng biệt để bảo mật dữ liệu.
    - Fail-closed: Sinh thread mới an toàn nếu có lỗi truy vấn DB (1B.7).
    """
    safe_uid = int(user_id) if user_id is not None else 0
    if not thread_id or not str(thread_id).strip():
        return f"thread-user-{safe_uid}-{uuid4().hex[:8]}"

    clean_tid = str(thread_id).strip()
    try:
        check_q = text("""
            SELECT user_id FROM ai_chat_messages
            WHERE thread_id = :tid
            LIMIT 1
        """)
        res = await db.execute(check_q, {"tid": clean_tid})
        row = res.mappings().first()
        if row and row["user_id"] is not None and row["user_id"] != safe_uid:
            # Thuộc người dùng khác -> IDOR prevention: tạo thread mới an toàn
            return f"thread-user-{safe_uid}-{uuid4().hex[:8]}"
    except Exception:
        # Fail-closed (1B.7): Lỗi DB thì tạo thread mới, không cho dùng thread không kiểm chứng
        return f"thread-user-{safe_uid}-{uuid4().hex[:8]}"

    return clean_tid


async def create_action_proposal(
    db: AsyncSession,
    user_id: int,
    thread_id: str,
    action_type: str,
    payload: Dict[str, Any],
    expires_minutes: int = 30
) -> str:
    """
    Lưu trữ Action Proposal vào CSDL với trạng thái PENDING và thời gian hết hạn (HITL Server Enforcement).
    Hủy các đề xuất PENDING trước đó của cùng user trên thread này (1B.9).
    """
    proposal_id = str(uuid4())
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)

    # 1B.9: Hủy proposal pending cũ trên cùng thread của user
    await db.execute(text("""
        UPDATE ai_chat_action_proposals
        SET status = 'CANCELLED'
        WHERE user_id = :uid AND thread_id = :tid AND status = 'PENDING'
    """), {"uid": int(user_id), "tid": str(thread_id).strip()})

    q = text("""
        INSERT INTO ai_chat_action_proposals (
            proposal_id, user_id, thread_id, action_type, payload,
            status, expires_at, created_at
        ) VALUES (
            CAST(:pid AS uuid), :uid, :tid, :act, CAST(:payload AS jsonb),
            'PENDING', :exp, NOW()
        )
    """)
    await db.execute(q, {
        "pid": proposal_id,
        "uid": int(user_id),
        "tid": str(thread_id).strip(),
        "act": action_type,
        "payload": json.dumps(payload, default=str, ensure_ascii=False),
        "exp": expires_at
    })
    await db.commit()
    return proposal_id


async def get_action_proposal(
    db: AsyncSession,
    proposal_id: str,
    for_update: bool = False
) -> Optional[Dict[str, Any]]:
    """Truy vấn đề xuất hành động từ bảng ai_chat_action_proposals (CAST(:pid AS uuid), an toàn kiểu dữ liệu) (1B.9)"""
    try:
        clean_pid = str(UUID(str(proposal_id).strip()))
    except (ValueError, TypeError, AttributeError):
        return None

    lock_clause = "FOR UPDATE" if for_update else ""
    q = text(f"""
        SELECT proposal_id, user_id, thread_id, action_type, payload,
               status, execution_result, expires_at, created_at
        FROM ai_chat_action_proposals
        WHERE proposal_id = CAST(:pid AS uuid)
        {lock_clause}
    """)
    res = await db.execute(q, {"pid": clean_pid})
    row = res.mappings().first()
    return dict(row) if row else None


async def update_action_proposal_status(
    db: AsyncSession,
    proposal_id: str,
    status: str,
    execution_result: Optional[Dict[str, Any]] = None
) -> None:
    """Cập nhật trạng thái đề xuất hành động (CONFIRMED / CANCELLED / EXPIRED) và kết quả thực thi (1B.9)"""
    try:
        clean_pid = str(UUID(str(proposal_id).strip()))
    except (ValueError, TypeError, AttributeError):
        return

    q = text("""
        UPDATE ai_chat_action_proposals
        SET status = :st,
            execution_result = CAST(:res AS jsonb)
        WHERE proposal_id = CAST(:pid AS uuid)
    """)
    await db.execute(q, {
        "st": status,
        "res": json.dumps(execution_result, default=str, ensure_ascii=False) if execution_result else None,
        "pid": clean_pid
    })
