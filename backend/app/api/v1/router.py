from app.api.v1.endpoints import stores
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.core.database import get_db
from app.api.deps import staff_scope
from app.api.v1.endpoints import (
    auth, users, roles, audit_logs, admin,
    employees, attendances, leaves, payrolls, reports, ai_chatbot, mobile_attendance,
    work_schedules, fixed_schedules, operations, overtime_requests, overtime_reconciliations, contracts, resignations,
    work_shifts
)

api_router = APIRouter()
api_router.include_router(stores.router, prefix='/stores', tags=['Stores'])
api_router.include_router(operations.router, prefix="/operations", tags=["Operations"], dependencies=[Depends(staff_scope)])
api_router.include_router(fixed_schedules.router, prefix="/fixed-schedules", tags=["Work Schedule"], dependencies=[Depends(staff_scope)])
api_router.include_router(work_schedules.router, prefix="/work-schedules", tags=["Work Schedule"], dependencies=[Depends(staff_scope)])
api_router.include_router(work_shifts.router, prefix="/work-shifts", tags=["Work Schedule"], dependencies=[Depends(staff_scope)])
api_router.include_router(overtime_requests.router, prefix="/overtime-requests", tags=["Overtime Requests"], dependencies=[Depends(staff_scope)])
api_router.include_router(overtime_reconciliations.router, prefix="/overtime-reconciliations", tags=["Overtime Reconciliation"], dependencies=[Depends(staff_scope)])
api_router.include_router(mobile_attendance.router, prefix="/mobile-attendance", tags=["Mobile Attendance"], dependencies=[Depends(staff_scope)])

# 1. Mount các phân hệ API
api_router.include_router(auth.router, prefix="/auth", tags=["Xác thực & Tài khoản (Auth)"])
api_router.include_router(users.router, prefix="/users", tags=["Quản lý Người dùng (Users)"])
api_router.include_router(admin.router, prefix="/admin", tags=["Quản trị hệ thống (Admin)"])
api_router.include_router(roles.router, prefix="/roles", tags=["Vai trò & Phân quyền (Roles & RBAC)"])
api_router.include_router(employees.router, prefix="/employees", tags=["Quản lý Nhân sự (Employees)"], dependencies=[Depends(staff_scope)])
api_router.include_router(contracts.router, prefix="/contracts", tags=["Quản lý Hợp đồng (Contracts)"], dependencies=[Depends(staff_scope)])
api_router.include_router(resignations.router, prefix="/resignations", tags=["Quản lý Thôi việc (Resignations)"], dependencies=[Depends(staff_scope)])
api_router.include_router(attendances.router, prefix="/attendances", tags=["Chấm công & Ca kíp (Attendances)"], dependencies=[Depends(staff_scope)])
api_router.include_router(leaves.router, prefix="/leaves", tags=["Nghỉ phép (Leaves)"], dependencies=[Depends(staff_scope)])
api_router.include_router(leaves.router, prefix="/leave-requests", tags=["Nghỉ phép (Leave Requests Workflow)"], dependencies=[Depends(staff_scope)])
api_router.include_router(payrolls.router, prefix="/payrolls", tags=["Lương & Thưởng (Payrolls)"], dependencies=[Depends(staff_scope)])
api_router.include_router(payrolls.router, prefix="/payroll", tags=["Lương & Thưởng (Payroll alias)"], dependencies=[Depends(staff_scope)])
api_router.include_router(reports.router, prefix="/reports", tags=["Báo cáo & Thống kê (Reports)"], dependencies=[Depends(staff_scope)])
api_router.include_router(audit_logs.router, prefix="/audit-logs", tags=["Nhật ký Hệ thống (Audit Logs)"])
api_router.include_router(ai_chatbot.router, prefix="/ai-chatbot", tags=["Trợ lý AI (AI Chatbot)"], dependencies=[Depends(staff_scope)])

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
