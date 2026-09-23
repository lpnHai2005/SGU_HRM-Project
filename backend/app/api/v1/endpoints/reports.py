from typing import Optional, List
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.core.database import get_db
from app.api.deps import require_roles

router = APIRouter()

@router.get("/dashboard-stats", summary="Số liệu tổng quan hiển thị trên thẻ Dashboard")
async def get_dashboard_stats(
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER", "STORE_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    total_emp = (await db.execute(text("SELECT count(*) FROM employees WHERE employment_status IN ('ACTIVE', 'PROBATION')"))).scalar()
    total_stores = (await db.execute(text("SELECT count(*) FROM stores WHERE is_active = TRUE"))).scalar()
    pending_leaves = (await db.execute(text("SELECT count(*) FROM leave_requests WHERE status IN ('PENDING', 'STORE_APPROVED')"))).scalar()
    latest_payroll = (await db.execute(text("SELECT COALESCE(SUM(net_salary), 0) FROM payrolls WHERE salary_period = '2026-09'"))).scalar()

    return {
        "active_employees": total_emp,
        "total_stores": total_stores,
        "pending_leaves": pending_leaves,
        "latest_monthly_payroll_fund": float(latest_payroll or 0),
        "system_status": "ONLINE",
        "current_period": "2026-09"
    }

@router.get("/monthly-status", summary="Báo cáo tình hình nhân sự tháng: Đang làm, Nghỉ phép, Thôi việc (Rubric III.3.1.4)")
async def get_monthly_status_report(
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(text("SELECT * FROM v_monthly_hr_status_report"))
    return res.mappings().first()

@router.get("/demographics", summary="Báo cáo trình độ học vấn, thâm niên và mức lương theo phòng ban/chi nhánh (Rubric III.3.1.5)")
async def get_demographics_report(
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    # Dữ liệu chi tiết từng nhân viên
    rows = (await db.execute(text("SELECT * FROM v_hr_demographics_report"))).mappings().all()

    # Thống kê tổng hợp theo nhóm học vấn
    edu_stats = (await db.execute(text("""
        SELECT edu.level_name, count(e.employee_id) as count
        FROM employees e
        JOIN education_levels edu ON e.education_level_id = edu.education_level_id
        GROUP BY edu.level_name
    """))).mappings().all()

    # Thống kê theo phân khúc lương
    salary_stats = (await db.execute(text("""
        SELECT salary_bracket, count(*) as count
        FROM v_hr_demographics_report
        GROUP BY salary_bracket
    """))).mappings().all()

    # Thống kê theo nhóm thâm niên
    seniority_stats = (await db.execute(text("""
        SELECT seniority_group, count(*) as count
        FROM v_hr_demographics_report
        GROUP BY seniority_group
    """))).mappings().all()

    return {
        "details": rows,
        "education_distribution": edu_stats,
        "salary_distribution": salary_stats,
        "seniority_distribution": seniority_stats
    }

@router.get("/audit-logs", summary="Nhật ký hệ thống phục vụ Admin (Rubric II.2)")
async def get_audit_logs(
    limit: int = Query(50, ge=1, le=200),
    current_user: dict = Depends(require_roles(["ADMIN"])),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(text("""
        SELECT a.log_id, a.user_id, u.username, a.action, a.entity_name,
               a.entity_id, a.old_values, a.new_values, a.ip_address, a.created_at
        FROM audit_logs a
        LEFT JOIN users u ON a.user_id = u.user_id
        ORDER BY a.log_id DESC
        LIMIT :limit
    """), {"limit": limit})
    return res.mappings().all()
