from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.api.deps import require_roles
from app.api.v1.endpoints.contracts import sync_employee_statuses

router = APIRouter()


@router.post("/sync-employee-statuses", summary="Đồng bộ trạng thái nhân viên theo hợp đồng (Chỉ ADMIN)")
async def admin_sync_employee_statuses(
    current_user: dict = Depends(require_roles(["ADMIN"])),
    db: AsyncSession = Depends(get_db)
):
    # Router /contracts chặn ADMIN nên module quản trị gọi cùng logic qua cổng riêng này.
    return await sync_employee_statuses(current_user=current_user, db=db)
