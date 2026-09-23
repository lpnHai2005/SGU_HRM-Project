from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.core.database import get_db
from app.api.v1.endpoints import auth, users, roles, audit_logs

api_router = APIRouter()

# 1. Mount các phân hệ API
api_router.include_router(auth.router, prefix="/auth", tags=["Xác thực & Tài khoản (Auth)"])
api_router.include_router(users.router, prefix="/users", tags=["Quản lý Người dùng (Users)"])
api_router.include_router(roles.router, prefix="/roles", tags=["Vai trò & Phân quyền (Roles & RBAC)"])
api_router.include_router(audit_logs.router, prefix="/audit-logs", tags=["Nhật ký Hệ thống (Audit Logs)"])

# 2. Endpoint kiểm tra sức khỏe hệ thống & kết nối Supabase CSDL
@api_router.get(
    "/health",
    tags=["Hệ thống (System)"],
    summary="Kiểm tra trạng thái máy chủ & kết nối CSDL Supabase Cloud"
)
async def health_check(db: AsyncSession = Depends(get_db)):
    try:
        res = await db.execute(text("SELECT 1 AS ok;"))
        row = res.mappings().first()
        db_status = "connected" if row and row["ok"] == 1 else "error"
    except Exception as e:
        db_status = f"disconnected ({str(e)})"

    return {
        "status": "online",
        "service": "TechZone HRM Backend API",
        "database": db_status,
        "environment": "production"
    }
