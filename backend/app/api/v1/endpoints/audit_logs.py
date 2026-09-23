from fastapi import APIRouter, Depends, Query, status
from typing import List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.core.database import get_db
from app.api.deps import require_roles
from app.schemas.schemas import AuditLogResponse

router = APIRouter()

@router.get(
    "",
    response_model=List[AuditLogResponse],
    summary="Nhật ký thanh tra hoạt động hệ thống (Audit Logs)",
    description="Truy xuất lịch sử các thao tác người dùng (Đăng nhập, Tạo/Sửa dữ liệu, Duyệt đơn, Tính lương). Yêu cầu vai trò ADMIN hoặc HR_MANAGER."
)
async def get_audit_logs(
    limit: int = Query(50, ge=1, le=200, description="Số lượng bản ghi tối đa"),
    action: Optional[str] = Query(None, description="Lọc theo hành động (VD: LOGIN, CREATE_USER...)"),
    entity_name: Optional[str] = Query(None, description="Lọc theo bảng đối tượng (VD: users, payrolls...)"),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"]))
):
    sql = """
        SELECT a.log_id, a.user_id, u.username, a.action, a.entity_name, a.entity_id,
               a.old_values, a.new_values, a.ip_address, a.created_at
        FROM audit_logs a
        LEFT JOIN users u ON a.user_id = u.user_id
        WHERE 1=1
    """
    params = {"limit": limit}

    if action:
        sql += " AND a.action = :action"
        params["action"] = action
    if entity_name:
        sql += " AND a.entity_name = :entity_name"
        params["entity_name"] = entity_name

    sql += " ORDER BY a.log_id DESC LIMIT :limit;"

    res = await db.execute(text(sql), params)
    return [dict(row) for row in res.mappings().all()]
