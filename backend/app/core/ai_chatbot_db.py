"""
TechZone HRM - AI Chatbot Database Persistence
Quản lý lưu trữ và truy xuất lịch sử trò chuyện chính thức trong bảng ai_chat_messages trên Supabase PostgreSQL.
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
    await db.commit()
    return row["message_id"] if row else 0


async def get_chat_history(
    db: AsyncSession,
    user_id: int,
    thread_id: Optional[str] = None,
    limit: int = 50
) -> List[Dict[str, Any]]:
    """Truy xuất lịch sử tin nhắn gần đây của người dùng trên Supabase"""
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
        ORDER BY created_at ASC
        LIMIT :lim
    """)

    res = await db.execute(query, params)
    rows = [dict(r) for r in res.mappings().all()]
    return rows
