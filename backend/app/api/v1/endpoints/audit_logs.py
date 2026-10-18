from fastapi import APIRouter, Depends, Query
from typing import List, Optional, Union, Any
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from pydantic import BaseModel
from app.core.database import get_db
from app.api.deps import require_roles

router = APIRouter()


class AuditLogItem(BaseModel):
    log_id: int
    user_id: Optional[int] = None
    username: Optional[str] = None
    action: str
    entity_name: str
    entity_id: Optional[Union[str, int]] = None
    old_values: Optional[Any] = None
    new_values: Optional[Any] = None
    ip_address: Optional[str] = None
    created_at: Union[datetime, str]


class AuditLogResponse(BaseModel):
    items: List[AuditLogItem]
    total: int
    page: int
    page_size: int
    total_pages: int


@router.get(
    "",
    response_model=AuditLogResponse,
    summary="Nhật ký thanh tra hoạt động hệ thống (Audit Logs)",
    description="Truy xuất lịch sử các thao tác người dùng. Yêu cầu vai trò ADMIN, DIRECTOR hoặc HR_MANAGER."
)
async def get_audit_logs(
    page: int = Query(1, ge=1, description="Trang hiện tại"),
    page_size: Optional[int] = Query(None, ge=1, le=200, description="Số bản ghi mỗi trang"),
    limit: Optional[int] = Query(None, ge=1, le=200, description="Số bản ghi tối đa (tương thích ngược)"),
    action: Optional[str] = Query(None, description="Lọc theo hành động (VD: LOGIN, CREATE_USER...)"),
    entity_name: Optional[str] = Query(None, description="Lọc theo bảng đối tượng (VD: users, payrolls...)"),
    start_date: Optional[str] = Query(None, description="Lọc từ ngày (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="Lọc đến ngày (YYYY-MM-DD)"),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_roles(["ADMIN", "DIRECTOR", "HR_MANAGER"]))
):
    size = page_size or limit or 20

    # Build WHERE clause
    where_clauses = []
    params: dict = {}

    if action:
        where_clauses.append("a.action = :action")
        params["action"] = action
    if entity_name:
        where_clauses.append("a.entity_name = :entity_name")
        params["entity_name"] = entity_name
    if start_date:
        where_clauses.append("DATE(a.created_at) >= :start_date")
        params["start_date"] = start_date
    if end_date:
        where_clauses.append("DATE(a.created_at) <= :end_date")
        params["end_date"] = end_date

    where_sql = " AND ".join(where_clauses) if where_clauses else "1=1"

    # Count total
    count_sql = f"""
        SELECT COUNT(*) as total
        FROM audit_logs a
        LEFT JOIN users u ON a.user_id = u.user_id
        WHERE {where_sql}
    """
    count_res = await db.execute(text(count_sql), params)
    total = count_res.scalar() or 0

    # Calculate pagination
    offset = (page - 1) * size
    total_pages = (total + size - 1) // size if total > 0 else 1

    # Get paginated data
    data_sql = f"""
        SELECT a.log_id, a.user_id, u.username, a.action, a.entity_name, a.entity_id,
               a.old_values, a.new_values, a.ip_address, a.created_at
        FROM audit_logs a
        LEFT JOIN users u ON a.user_id = u.user_id
        WHERE {where_sql}
        ORDER BY a.log_id DESC
        LIMIT :limit OFFSET :offset
    """
    params["limit"] = size
    params["offset"] = offset

    res = await db.execute(text(data_sql), params)
    items = [dict(row) for row in res.mappings().all()]

    return AuditLogResponse(
        items=items,
        total=total,
        page=page,
        page_size=size,
        total_pages=total_pages
    )


@router.get(
    "/actions",
    summary="Danh sách các loại action trong audit logs",
    description="Trả về danh sách các action duy nhất để phục vụ bộ lọc."
)
async def get_audit_actions(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_roles(["ADMIN", "DIRECTOR", "HR_MANAGER"]))
):
    sql = """
        SELECT DISTINCT action FROM audit_logs WHERE action IS NOT NULL ORDER BY action
    """
    res = await db.execute(text(sql))
    return [row[0] for row in res.fetchall()]


@router.get(
    "/entities",
    summary="Danh sách các entity trong audit logs",
    description="Trả về danh sách các entity duy nhất để phục vụ bộ lọc."
)
async def get_audit_entities(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_roles(["ADMIN", "DIRECTOR", "HR_MANAGER"]))
):
    sql = """
        SELECT DISTINCT entity_name FROM audit_logs WHERE entity_name IS NOT NULL ORDER BY entity_name
    """
    res = await db.execute(text(sql))
    return [row[0] for row in res.fetchall()]
