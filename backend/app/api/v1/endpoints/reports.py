import io
import csv
import calendar
from datetime import date, datetime
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.database import get_db
from app.core.attendance import local_now
from app.api.deps import require_roles, require_strict_roles, get_current_user
from app.core.excel_exporter import create_styled_excel, create_multisheet_excel

router = APIRouter()


async def _dashboard_kpis(db: AsyncSession, current_user: dict, today: date) -> dict:
    """Four workforce cards are independent of payroll and sales availability."""
    roles = set(current_user.get("roles", []))
    manager_scope = "STORE_MANAGER" in roles and not roles.intersection({"ADMIN", "HR_MANAGER", "DIRECTOR"})
    store_id = current_user.get("store_id") if manager_scope else None
    if manager_scope and not store_id:
        raise HTTPException(403, "Tài khoản chưa được gán cửa hàng.")
    params = {"today": today}
    employee_filter = ""
    if store_id:
        params["store_id"] = store_id
        employee_filter = " AND e.store_id = :store_id"

    active = (await db.execute(text("""SELECT count(*) FROM employees e
        WHERE e.employment_status IN ('ACTIVE','PROBATION')""" + employee_filter), params)).scalar() or 0
    pending_filter = "lr.status = 'PENDING'" if manager_scope else "lr.status IN ('PENDING','STORE_APPROVED')"
    if manager_scope:
        params["manager_employee_id"] = current_user.get("employee_id")
    pending = (await db.execute(text("""SELECT count(*) FROM leave_requests lr
        JOIN employees e ON e.employee_id = lr.employee_id WHERE """ + pending_filter
        + employee_filter + (" AND lr.employee_id IS DISTINCT FROM :manager_employee_id" if manager_scope else "")), params)).scalar() or 0
    attendance = (await db.execute(text("""SELECT
        COUNT(DISTINCT a.employee_id) FILTER (WHERE a.check_in_time IS NOT NULL) AS checked_in,
        COUNT(DISTINCT a.employee_id) FILTER (WHERE a.late_minutes > 15) AS late,
        COUNT(DISTINCT a.employee_id) FILTER (WHERE a.check_in_time IS NOT NULL AND a.check_out_time IS NULL) AS working
        FROM attendances a JOIN employees e ON e.employee_id = a.employee_id
        WHERE a.work_date = :today""" + employee_filter), params)).one()
    return {"active_employees": active, "pending_leaves": pending,
            "attendance_today": {"checked_in": attendance[0] or 0,
                                 "late": attendance[1] or 0, "working": attendance[2] or 0}}


@router.get("/dashboard-kpis", summary="Bốn chỉ số nhân sự Dashboard, không phụ thuộc Payroll/Sales")
async def get_dashboard_kpis(
    current_user: dict = Depends(require_strict_roles(["DIRECTOR", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db),
):
    return await _dashboard_kpis(db, current_user, local_now().date())

# ===================================================================================
# 1. DASHBOARD STATS (THẺ CHỈ SỐ TỔNG QUAN)
# ===================================================================================

@router.get("/dashboard-stats", summary="Số liệu tổng quan hiển thị trên thẻ Dashboard (Executive KPI Cards)")
async def get_dashboard_stats(
    period: Optional[str] = Query(None, description="Kỳ thống kê (YYYY-MM)"),
    store_id: Optional[int] = Query(None, description="Lọc theo cửa hàng"),
    current_user: dict = Depends(require_strict_roles(["DIRECTOR", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Số liệu KPI tổng hợp cho trang chủ Quản trị & Quản lý chi nhánh:
    - Tổng nhân sự đang làm việc tính theo mốc kỳ thống kê (Point-in-time headcount)
    - Số nhân sự thôi việc hoặc tuyển mới trong kỳ
    - Quỹ lương Net của kỳ
    - Tình hình chấm công
    """
    roles = current_user.get("roles", [])
    today = local_now().date()
    period = period or today.strftime('%Y-%m')
    params = {"period": period}

    filter_store_id = store_id
    store_manager_scope = "STORE_MANAGER" in roles and "ADMIN" not in roles and "HR_MANAGER" not in roles and "DIRECTOR" not in roles
    if store_manager_scope:
        user_store_id = current_user.get("store_id")
        if not user_store_id:
            raise HTTPException(403, 'Tài khoản chưa được gán cửa hàng.')
        filter_store_id = user_store_id

    emp_store_filter = ""
    sales_store_filter = ""
    if filter_store_id:
        params["store_id"] = filter_store_id
        emp_store_filter = " AND e.store_id = :store_id"
        sales_store_filter = " AND store_id = :store_id"

    # Tính toán mốc thời gian của kỳ period (YYYY-MM) để chốt quân số lịch sử chính xác
    try:
        y, m = map(int, period.split("-"))
        _, last_day = calendar.monthrange(y, m)
        period_start = date(y, m, 1)
        period_end = date(y, m, last_day)
    except Exception:
        period_start = today.replace(day=1)
        period_end = today

    params["m_start"] = period_start
    params["m_end"] = period_end

    # 1. Số nhân sự thực tế công tác tại kỳ đó (Đã gia nhập và chưa thôi việc trước kỳ)
    active_emp_query = f"""
        SELECT COUNT(*) FROM employees e
        WHERE e.join_date <= :m_end 
          AND (e.resignation_date IS NULL OR e.resignation_date >= :m_start)
          {emp_store_filter}
    """
    period_active_employees = (await db.execute(text(active_emp_query), params)).scalar() or 0

    # 2. Tuyển mới trong kỳ
    hires_query = f"""
        SELECT COUNT(*) FROM employees e
        WHERE e.join_date BETWEEN :m_start AND :m_end {emp_store_filter}
    """
    new_hires = (await db.execute(text(hires_query), params)).scalar() or 0

    # 3. Thôi việc trong kỳ
    resigned_query = f"""
        SELECT COUNT(*) FROM employees e
        WHERE e.resignation_date BETWEEN :m_start AND :m_end {emp_store_filter}
    """
    resigned_employees = (await db.execute(text(resigned_query), params)).scalar() or 0

    # 4. Cửa hàng đang hoạt động
    total_stores = (await db.execute(text("SELECT count(*) FROM stores WHERE is_active = TRUE"))).scalar() or 0

    # 5. Quỹ lương kỳ
    pr_query = f"""
        SELECT COALESCE(SUM(p.net_salary), 0), COALESCE(SUM(p.gross_income), 0)
        FROM payrolls p 
        JOIN employees e ON p.employee_id = e.employee_id 
        WHERE p.salary_period = :period {emp_store_filter}
    """
    pr_res = (await db.execute(text(pr_query), params)).first()
    monthly_net_fund = float(pr_res[0] or 0)
    monthly_gross_fund = float(pr_res[1] or 0)

    # 6. Doanh số toàn chuỗi trong kỳ
    sales_query = f"SELECT COALESCE(SUM(total_revenue), 0) FROM employee_sales WHERE salary_period = :period {sales_store_filter}"
    total_sales = float((await db.execute(text(sales_query), params)).scalar() or 0)

    # Chỉ số chấm công / nghỉ phép
    kpis = await _dashboard_kpis(db, current_user, today)

    return {
        **kpis,
        "total_employees": period_active_employees,
        "active_employees": period_active_employees,
        "new_hires": new_hires,
        "resigned_employees": resigned_employees,
        "total_stores": total_stores,
        "monthly_net_payroll_fund": monthly_net_fund,
        "monthly_gross_payroll_fund": monthly_gross_fund,
        "total_retail_revenue": total_sales,
        "system_status": "ONLINE",
        "current_period": period
    }


# ===================================================================================
# 2. RUBRIC III.3.1.4: BÁO CÁO BIẾN ĐỘNG NHÂN SỰ THEO THÁNG
# ===================================================================================

@router.get("/monthly-status", summary="Báo cáo tình hình nhân sự tháng: Đang làm, Nghỉ phép, Thôi việc (Rubric III.3.1.4)")
async def get_monthly_status_report(
    current_user: dict = Depends(require_strict_roles(["DIRECTOR", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Truy vấn View v_monthly_hr_status_report:
    - total_active_employees (ACTIVE, PROBATION)
    - total_on_leave_employees (ON_LEAVE - thai sản, hộ sản)
    - total_resigned_employees (RESIGNED, TERMINATED)
    - total_headcount (Tổng biên chế)
    Kèm theo tỷ lệ phần trăm phân bổ và danh sách nhân sự mới tuyển / nghỉ việc gần nhất.
    """
    res = await db.execute(text("SELECT * FROM v_monthly_hr_status_report"))
    row = res.mappings().first()
    if not row:
        return {"report_period": "2026-09", "total_active_employees": 0, "total_headcount": 0}

    data = dict(row)
    total = max(data.get("total_headcount", 0), 1)
    data["active_percent"] = round((data.get("total_active_employees", 0) / total) * 100, 1)
    data["on_leave_percent"] = round((data.get("total_on_leave_employees", 0) / total) * 100, 1)
    data["resigned_percent"] = round((data.get("total_resigned_employees", 0) / total) * 100, 1)

    # Thống kê biến động 6 tháng gần nhất (Monthly Trends)
    trend_res = await db.execute(text("""
        SELECT 
            TO_CHAR(join_date, 'YYYY-MM') as month,
            COUNT(*) as new_hires
        FROM employees
        WHERE join_date >= (CURRENT_DATE - INTERVAL '6 months')
        GROUP BY TO_CHAR(join_date, 'YYYY-MM')
        ORDER BY month ASC
    """))
    data["recent_join_trends"] = [dict(t) for t in trend_res.mappings().all()]

    # Thống kê phân bổ nhân sự theo từng cơ sở (Cửa hàng / Phòng ban)
    store_res = await db.execute(text("""
        SELECT 
            s.store_id,
            COALESCE(s.store_name, 'Văn phòng chính') as store_name,
            COUNT(e.employee_id) as total_staff,
            COUNT(CASE WHEN e.employment_status = 'ACTIVE' THEN 1 END) as active_staff,
            COUNT(CASE WHEN e.employment_status = 'PROBATION' THEN 1 END) as probation_staff,
            COUNT(CASE WHEN e.employment_status IN ('RESIGNED', 'TERMINATED') THEN 1 END) as resigned_staff,
            COALESCE(SUM(c.basic_salary), 0) as total_contract_salary
        FROM stores s
        LEFT JOIN employees e ON s.store_id = e.store_id
        LEFT JOIN contracts c ON e.employee_id = c.employee_id AND c.status = 'ACTIVE'
        GROUP BY s.store_id, s.store_name
        ORDER BY s.store_name ASC
    """))
    data["by_store"] = [dict(r) for r in store_res.mappings().all()]

    return data



# ===================================================================================
# 3. RUBRIC III.3.1.5: BÁO CÁO CƠ CẤU TRÌNH ĐỘ HỌC VẤN, MỨC LƯƠNG & THÂM NIÊN
# ===================================================================================

@router.get("/demographics", summary="Báo cáo học vấn, thâm niên và khung bậc lương toàn chuỗi (Rubric III.3.1.5)")
async def get_demographics_report(
    store_id: Optional[int] = Query(None, description="Lọc theo cửa hàng"),
    include_resigned: bool = Query(False, description="Bao gồm cả nhân sự đã thôi việc"),
    current_user: dict = Depends(require_strict_roles(["DIRECTOR", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Truy vấn View v_hr_demographics_report kết hợp gom nhóm đa chiều phục vụ biểu đồ Recharts:
    1. Trình độ học vấn (education_distribution): Đại học, Cao đẳng, Trung cấp, THPT
    2. Nhóm thâm niên (seniority_distribution): Dưới 1 năm, 1-3 năm, 3-5 năm, Trên 5 năm
    3. Phân khúc mức lương (salary_distribution): Chưa có hợp đồng, <7M, 7-12M, 12-20M, >20M
    4. Chi tiết từng nhân sự (details)
    """
    filter_store_id = store_id if isinstance(store_id, int) else None
    is_include_resigned = include_resigned if isinstance(include_resigned, bool) else False
    where_conditions = []
    params = {}

    if filter_store_id:
        where_conditions.append("e.store_id = :sid")
        params["sid"] = filter_store_id

    if not is_include_resigned:
        where_conditions.append("e.employment_status IN ('ACTIVE', 'PROBATION', 'ON_LEAVE')")

    where_clause = f" WHERE {' AND '.join(where_conditions)}" if where_conditions else ""

    # 1. Danh sách chi tiết nhân viên
    details_query = f"""
        SELECT d.*, s.store_name
        FROM v_hr_demographics_report d
        JOIN employees e ON d.employee_id = e.employee_id
        LEFT JOIN stores s ON e.store_id = s.store_id
        {where_clause}
        ORDER BY d.employee_id ASC
    """
    rows = (await db.execute(text(details_query), params)).mappings().all()

    # 2. Phân bổ học vấn
    edu_query = f"""
        SELECT edu.level_name, count(e.employee_id) as count
        FROM employees e
        JOIN education_levels edu ON e.education_level_id = edu.education_level_id
        {where_clause}
        GROUP BY edu.level_name
        ORDER BY count DESC
    """
    edu_stats = (await db.execute(text(edu_query), params)).mappings().all()

    # 3. Phân bổ khung mức lương (Chuẩn hóa: basic_salary IS NULL xếp vào 'Chưa có hợp đồng')
    salary_query = f"""
        SELECT 
            CASE 
                WHEN c.basic_salary IS NULL THEN 'Chưa có hợp đồng'
                WHEN c.basic_salary < 7000000 THEN 'Dưới 7 triệu'
                WHEN c.basic_salary BETWEEN 7000000 AND 12000000 THEN 'Từ 7 - 12 triệu'
                WHEN c.basic_salary BETWEEN 12000001 AND 20000000 THEN 'Từ 12 - 20 triệu'
                ELSE 'Trên 20 triệu'
            END AS salary_bracket,
            COUNT(e.employee_id) as count
        FROM employees e
        LEFT JOIN contracts c ON e.employee_id = c.employee_id AND c.status = 'ACTIVE'
        {where_clause}
        GROUP BY salary_bracket
        ORDER BY 
            CASE 
                WHEN CASE 
                    WHEN c.basic_salary IS NULL THEN 'Chưa có hợp đồng'
                    WHEN c.basic_salary < 7000000 THEN 'Dưới 7 triệu'
                    WHEN c.basic_salary BETWEEN 7000000 AND 12000000 THEN 'Từ 7 - 12 triệu'
                    WHEN c.basic_salary BETWEEN 12000001 AND 20000000 THEN 'Từ 12 - 20 triệu'
                    ELSE 'Trên 20 triệu'
                END = 'Chưa có hợp đồng' THEN 0
                WHEN CASE 
                    WHEN c.basic_salary IS NULL THEN 'Chưa có hợp đồng'
                    WHEN c.basic_salary < 7000000 THEN 'Dưới 7 triệu'
                    WHEN c.basic_salary BETWEEN 7000000 AND 12000000 THEN 'Từ 7 - 12 triệu'
                    WHEN c.basic_salary BETWEEN 12000001 AND 20000000 THEN 'Từ 12 - 20 triệu'
                    ELSE 'Trên 20 triệu'
                END = 'Dưới 7 triệu' THEN 1
                WHEN CASE 
                    WHEN c.basic_salary IS NULL THEN 'Chưa có hợp đồng'
                    WHEN c.basic_salary < 7000000 THEN 'Dưới 7 triệu'
                    WHEN c.basic_salary BETWEEN 7000000 AND 12000000 THEN 'Từ 7 - 12 triệu'
                    WHEN c.basic_salary BETWEEN 12000001 AND 20000000 THEN 'Từ 12 - 20 triệu'
                    ELSE 'Trên 20 triệu'
                END = 'Từ 7 - 12 triệu' THEN 2
                WHEN CASE 
                    WHEN c.basic_salary IS NULL THEN 'Chưa có hợp đồng'
                    WHEN c.basic_salary < 7000000 THEN 'Dưới 7 triệu'
                    WHEN c.basic_salary BETWEEN 7000000 AND 12000000 THEN 'Từ 7 - 12 triệu'
                    WHEN c.basic_salary BETWEEN 12000001 AND 20000000 THEN 'Từ 12 - 20 triệu'
                    ELSE 'Trên 20 triệu'
                END = 'Từ 12 - 20 triệu' THEN 3
                ELSE 4
            END ASC
    """
    salary_stats = (await db.execute(text(salary_query), params)).mappings().all()

    # 4. Phân bổ thâm niên công tác
    seniority_query = f"""
        SELECT 
            CASE 
                WHEN EXTRACT(YEAR FROM age(CURRENT_DATE, e.join_date)) < 1 THEN 'Dưới 1 năm'
                WHEN EXTRACT(YEAR FROM age(CURRENT_DATE, e.join_date)) BETWEEN 1 AND 3 THEN 'Từ 1 - 3 năm'
                WHEN EXTRACT(YEAR FROM age(CURRENT_DATE, e.join_date)) BETWEEN 4 AND 5 THEN 'Từ 3 - 5 năm'
                ELSE 'Trên 5 năm'
            END AS seniority_group,
            COUNT(e.employee_id) as count
        FROM employees e
        {where_clause}
        GROUP BY seniority_group
    """
    seniority_stats = (await db.execute(text(seniority_query), params)).mappings().all()

    formatted_edu = [
        {"education_level": r["level_name"], "level_name": r["level_name"], "total": r["count"], "count": r["count"]}
        for r in edu_stats
    ]
    formatted_salary = [
        {"salary_range": r["salary_bracket"], "salary_bracket": r["salary_bracket"], "total": r["count"], "count": r["count"]}
        for r in salary_stats
    ]
    formatted_seniority = [
        {"seniority_group": r["seniority_group"], "total": r["count"], "count": r["count"]}
        for r in seniority_stats
    ]

    return {
        "store_id": filter_store_id,
        "total_employees": len(rows),
        "education": formatted_edu,
        "education_distribution": formatted_edu,
        "salary_range": formatted_salary,
        "salary_distribution": formatted_salary,
        "seniority": formatted_seniority,
        "seniority_distribution": formatted_seniority,
        "details": rows
    }


# ===================================================================================
# 4. BÁO CÁO QUỸ LƯƠNG & CHI PHÍ THEO CHI NHÁNH CỬA HÀNG
# ===================================================================================

@router.get("/payroll-fund", summary="Báo cáo tổng hợp chi phí tiền lương theo chi nhánh & phòng ban")
async def get_payroll_fund_summary(
    period: Optional[str] = Query("2026-09", description="Kỳ lương (YYYY-MM)"),
    store_id: Optional[int] = Query(None, description="Lọc theo cửa hàng"),
    current_user: dict = Depends(require_strict_roles(["DIRECTOR", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Báo cáo tổng hợp chi phí tiền lương chia theo từng điểm bán và phòng ban:
    Tổng lương cơ bản, Tổng làm thêm OT, Tổng hoa hồng, Tổng các loại phụ cấp,
    Tổng trích nộp bảo hiểm 10.5% và Tổng ngân sách lương thực chi.
    """
    period_str = period if isinstance(period, str) and period else local_now().date().strftime('%Y-%m')
    scope_params = {"period": period_str}
    scope_sql = ""
    if store_id and isinstance(store_id, int):
        scope_params["store_id"] = store_id
        scope_sql = " AND e.store_id = :store_id"

    store_stats = (await db.execute(text(f"""
        SELECT 
            COALESCE(s.store_name, d.department_name, 'Khác') as unit_name,
            COUNT(p.payroll_id) as employee_count,
            COALESCE(SUM(p.total_earnings - COALESCE(ot.amount, 0)), 0) as total_base_salary,
            COALESCE(SUM(COALESCE(ot.amount, 0)), 0) as total_overtime,
            COALESCE(SUM(p.total_allowances), 0) as total_allowances,
            COALESCE(SUM(COALESCE(comm.amount, 0)), 0) as total_commissions,
            COALESCE(SUM(p.total_bonuses - COALESCE(comm.amount, 0)), 0) as total_bonuses,
            COALESCE(SUM(p.gross_income), 0) as total_gross,
            COALESCE(SUM(p.total_insurance), 0) as total_insurance,
            COALESCE(SUM(COALESCE(pen.amount, 0)), 0) as total_penalties,
            COALESCE(SUM(p.net_salary), 0) as total_net
        FROM payrolls p
        JOIN employees e ON p.employee_id = e.employee_id
        LEFT JOIN stores s ON e.store_id = s.store_id
        LEFT JOIN departments d ON e.department_id = d.department_id
        LEFT JOIN (
            SELECT payroll_id, SUM(amount) as amount FROM payroll_details 
            WHERE item_code = 'OVERTIME' GROUP BY payroll_id
        ) ot ON ot.payroll_id = p.payroll_id
        LEFT JOIN (
            SELECT payroll_id, SUM(amount) as amount FROM payroll_details 
            WHERE item_code = 'COMMISSION' GROUP BY payroll_id
        ) comm ON comm.payroll_id = p.payroll_id
        LEFT JOIN (
            SELECT payroll_id, SUM(amount) as amount FROM payroll_details 
            WHERE item_code = 'PENALTY' GROUP BY payroll_id
        ) pen ON pen.payroll_id = p.payroll_id
        WHERE p.salary_period = :period {scope_sql}
        GROUP BY COALESCE(s.store_name, d.department_name, 'Khác')
        ORDER BY total_gross DESC
    """), scope_params)).mappings().all()

    # Tổng cộng toàn chuỗi
    total_res = (await db.execute(text(f"""
        SELECT 
            COUNT(p.payroll_id) as total_headcount,
            COALESCE(SUM(p.gross_income), 0) as total_gross_fund,
            COALESCE(SUM(p.net_salary), 0) as total_net_fund,
            COALESCE(SUM(p.total_insurance), 0) as total_insurance_fund,
            COALESCE(SUM(comm.amount), 0) as total_commission_fund
        FROM payrolls p
        JOIN employees e ON e.employee_id = p.employee_id
        LEFT JOIN (
            SELECT payroll_id, SUM(amount) as amount FROM payroll_details 
            WHERE item_code = 'COMMISSION' GROUP BY payroll_id
        ) comm ON comm.payroll_id = p.payroll_id
        WHERE p.salary_period = :period {scope_sql}
    """), scope_params)).mappings().first()

    totals_dict = dict(total_res) if total_res else {}
    net_fund = float(totals_dict.get("total_net_fund", 0) or 0)
    gross_fund = float(totals_dict.get("total_gross_fund", 0) or 0)
    ins_fund = float(totals_dict.get("total_insurance_fund", 0) or 0)
    comm_fund = float(totals_dict.get("total_commission_fund", 0) or 0)

    allowance_total = sum(float(u.get("total_allowances", 0) or 0) for u in store_stats)
    bonus_total = sum(float(u.get("total_bonuses", 0) or 0) for u in store_stats)

    return {
        "salary_period": period_str,
        "company_totals": totals_dict,
        "by_unit": [dict(u) for u in store_stats],
        "total_net_salary": net_fund,
        "total_gross_income": gross_fund,
        "total_insurance_deducted": ins_fund,
        "total_commission_fund": comm_fund,
        "total_allowances": allowance_total,
        "total_bonuses": bonus_total,
        "total_tax_deducted": max(0.0, gross_fund - net_fund - ins_fund)
    }


# ===================================================================================
# 5. BÁO CÁO HIỆU SUẤT BÁN LẺ & TỶ LỆ ĐẠT KPI DOANH SỐ
# ===================================================================================

@router.get("/sales-performance", summary="Báo cáo hiệu suất bán lẻ 3 ngành hàng và tỷ lệ hoàn thành KPI")
async def get_sales_performance_report(
    period: Optional[str] = Query("2026-09", description="Kỳ doanh số (YYYY-MM)"),
    store_id: Optional[int] = Query(None, description="Lọc theo cửa hàng"),
    current_user: dict = Depends(require_strict_roles(["DIRECTOR", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Báo cáo phân tích doanh thu 3 nhóm sản phẩm: Điện thoại, Laptop, Phụ kiện,
    tỷ lệ đạt chỉ tiêu KPI và tiền thưởng nóng KPI của từng nhân viên và cửa hàng.
    """
    period_str = period if isinstance(period, str) and period else local_now().date().strftime('%Y-%m')
    filter_store_id = store_id if isinstance(store_id, int) else None
    params = {"period": period_str}
    where_extra = ""

    if filter_store_id:
        where_extra = " AND es.store_id = :sid"
        params["sid"] = filter_store_id

    # 1. Chi tiết theo từng nhân viên
    emp_res = (await db.execute(text(f"""
        SELECT 
            es.sale_record_id, es.employee_id, e.employee_code, e.full_name as employee_name,
            s.store_name, es.salary_period,
            es.phone_revenue, es.laptop_revenue, es.accessory_revenue, es.total_revenue,
            es.target_kpi, es.kpi_achievement_rate,
            COALESCE(c.commission_amount, 0) as commission_amount,
            COALESCE(c.kpi_bonus_amount, 0) as kpi_bonus_amount
        FROM employee_sales es
        JOIN employees e ON es.employee_id = e.employee_id
        LEFT JOIN stores s ON es.store_id = s.store_id
        LEFT JOIN commissions c ON es.sale_record_id = c.sale_record_id
        WHERE es.salary_period = :period {where_extra}
        ORDER BY es.total_revenue DESC
    """), params)).mappings().all()

    # 2. Tổng hợp theo 3 nhóm ngành hàng
    totals_res = (await db.execute(text(f"""
        SELECT 
            COALESCE(SUM(phone_revenue), 0) as total_phone_revenue,
            COALESCE(SUM(laptop_revenue), 0) as total_laptop_revenue,
            COALESCE(SUM(accessory_revenue), 0) as total_accessory_revenue,
            COALESCE(SUM(total_revenue), 0) as grand_total_revenue,
            COALESCE(SUM(target_kpi), 0) as total_target_kpi
        FROM employee_sales es
        WHERE es.salary_period = :period {where_extra}
    """), params)).mappings().first()

    tot_dict = dict(totals_res) if totals_res else {}
    grand_total = float(tot_dict.get("grand_total_revenue", 0) or 0)
    target_total = float(tot_dict.get("total_target_kpi", 0) or 0)
    avg_kpi_rate = round((grand_total / target_total * 100), 1) if target_total > 0 else 0.0

    records_list = [
        {
            **dict(r),
            "phone_revenue": float(r.get("phone_revenue", 0) or 0),
            "laptop_revenue": float(r.get("laptop_revenue", 0) or 0),
            "accessory_revenue": float(r.get("accessory_revenue", 0) or 0),
            "total_revenue": float(r.get("total_revenue", 0) or 0),
            "target_kpi": float(r.get("target_kpi", 0) or 0),
            "kpi_completion_rate": float(r.get("kpi_achievement_rate", 0) or 0),
            "commission_amount": float(r.get("commission_amount", 0) or 0),
            "kpi_bonus_amount": float(r.get("kpi_bonus_amount", 0) or 0),
        }
        for r in emp_res
    ]

    summary_obj = {
        **tot_dict,
        "grand_total_revenue": grand_total,
        "total_target_kpi": target_total,
        "avg_kpi_completion_rate": avg_kpi_rate,
        "total_sales_employees": len(records_list),
        "total_commission_paid": sum(float(r.get("commission_amount", 0) or 0) for r in records_list)
    }

    return {
        "salary_period": period_str,
        "revenue_breakdown": tot_dict,
        "sales_staff_details": [dict(r) for r in emp_res],
        "summary": summary_obj,
        "records": records_list
    }


# ===================================================================================
# 6. NHẬT KÝ HỆ THỐNG AUDIT LOGS (RUBRIC II.2 - GIAO DIỆN ADMIN)
# ===================================================================================

@router.get("/audit-logs", summary="Nhật ký hoạt động hệ thống (Admin, Giám đốc)")
async def get_audit_logs(
    limit: int = Query(50, ge=1, le=500),
    action: Optional[str] = Query(None, description="Lọc theo hành động"),
    current_user: dict = Depends(require_roles(["ADMIN", "DIRECTOR"])),
    db: AsyncSession = Depends(get_db)
):
    query = """
        SELECT a.log_id, a.user_id, u.username, a.action, a.entity_name,
               a.entity_id, a.old_values, a.new_values, a.ip_address, a.created_at
        FROM audit_logs a
        LEFT JOIN users u ON a.user_id = u.user_id
    """
    params = {"limit": limit}
    if action:
        query += " WHERE a.action = :action"
        params["action"] = action

    query += " ORDER BY a.log_id DESC LIMIT :limit"
    res = await db.execute(text(query), params)
    return res.mappings().all()


# ===================================================================================
# 7. XUẤT DỮ LIỆU BÁO CÁO RA FILE EXCEL & CSV (SPEC 9.5 & RUBRIC SGU)
# ===================================================================================

@router.get("/export/demographics/excel", summary="Xuất báo cáo nhân sự & học vấn ra file Excel (.xlsx) chuẩn TechZone (Rubric III.3.1.5)")
async def export_demographics_excel(
    store_id: Optional[int] = Query(None, description="Lọc theo cửa hàng"),
    current_user: dict = Depends(require_strict_roles(["DIRECTOR", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Xuất dữ liệu báo cáo nhân sự, bằng cấp học vấn, thâm niên và mức lương hợp đồng ra file Excel (.xlsx).
    """
    data = await get_demographics_report(store_id=store_id, current_user=current_user, db=db)
    details = data.get("details", [])
    if not details:
        raise HTTPException(status_code=404, detail="Không có dữ liệu nhân sự để xuất báo cáo")

    columns = [
        {"key": "employee_code", "title": "Mã NV", "width": 12, "align": "center"},
        {"key": "full_name", "title": "Họ và Tên", "width": 24},
        {"key": "store_name", "title": "Cửa hàng Chi nhánh", "width": 22},
        {"key": "department_name", "title": "Phòng ban", "width": 20},
        {"key": "position_name", "title": "Chức vụ", "width": 18},
        {"key": "education_level", "title": "Trình độ học vấn", "width": 18, "align": "center"},
        {"key": "basic_salary", "title": "Lương HĐ", "width": 16, "format": "currency"},
        {"key": "salary_bracket", "title": "Khung bậc lương", "width": 18},
        {"key": "seniority_years", "title": "Thâm niên (năm)", "width": 16, "format": "number"},
        {"key": "seniority_group", "title": "Nhóm thâm niên", "width": 16},
        {"key": "employment_status", "title": "Trạng thái", "width": 14, "align": "center"}
    ]

    file_stream = create_styled_excel(
        title="BÁO CÁO CƠ CẤU NHÂN SỰ & HỌC VẤN TOÀN CHUỖI",
        subtitle=f"Ngày xuất: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')} - Tổng số nhân sự: {len(details)} người",
        columns=columns,
        data=[dict(d) for d in details],
        include_totals=False
    )

    filename = f"Bao_Cao_Nhan_Su_TechZone_{datetime.now().strftime('%Y%m%d')}.xlsx"
    return StreamingResponse(
        file_stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.get("/export/demographics/csv", summary="Xuất báo cáo nhân sự ra file CSV (UTF-8 BOM)")
async def export_demographics_csv(
    store_id: Optional[int] = Query(None, description="Lọc theo cửa hàng"),
    current_user: dict = Depends(require_strict_roles(["DIRECTOR", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    data = await get_demographics_report(store_id=store_id, current_user=current_user, db=db)
    details = data.get("details", [])
    if not details:
        raise HTTPException(status_code=404, detail="Không có dữ liệu nhân sự để xuất báo cáo")

    output = io.StringIO()
    output.write('\ufeff')
    writer = csv.writer(output)
    writer.writerow([
        "Mã NV", "Họ và Tên", "Cửa hàng", "Phòng ban", "Chức vụ",
        "Trình độ học vấn", "Lương HĐ", "Khung lương", "Thâm niên (năm)",
        "Nhóm thâm niên", "Trạng thái"
    ])

    for d in details:
        writer.writerow([
            d.get("employee_code"), d.get("full_name"), d.get("store_name"),
            d.get("department_name"), d.get("position_name"), d.get("education_level"),
            d.get("basic_salary"), d.get("salary_bracket"), d.get("seniority_years"),
            d.get("seniority_group"), d.get("employment_status")
        ])

    csv_bytes = output.getvalue().encode('utf-8')
    filename = f"Bao_Cao_Nhan_Su_{datetime.now().strftime('%Y%m%d')}.csv"
    return Response(
        content=csv_bytes,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.get("/export/payroll-summary/excel", summary="Xuất báo cáo quỹ lương theo chi nhánh ra file Excel (.xlsx)")
async def export_payroll_fund_excel(
    period: Optional[str] = Query("2026-09", description="Kỳ lương (YYYY-MM)"),
    current_user: dict = Depends(require_strict_roles(["DIRECTOR", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    fund_data = await get_payroll_fund_summary(period=period, current_user=current_user, db=db)
    by_unit = fund_data.get("by_unit", [])
    if not by_unit:
        raise HTTPException(status_code=404, detail=f"Không có dữ liệu quỹ lương trong kỳ {period}")

    columns = [
        {"key": "unit_name", "title": "Chi nhánh / Phòng ban", "width": 26},
        {"key": "employee_count", "title": "Số lượng NV", "width": 14, "format": "number"},
        {"key": "total_base_salary", "title": "Tổng lương CB", "width": 18, "format": "currency"},
        {"key": "total_overtime", "title": "Tổng tăng ca OT", "width": 16, "format": "currency"},
        {"key": "total_allowances", "title": "Tổng phụ cấp", "width": 16, "format": "currency"},
        {"key": "total_commissions", "title": "Tổng hoa hồng", "width": 16, "format": "currency"},
        {"key": "total_bonuses", "title": "Tổng tiền thưởng", "width": 16, "format": "currency"},
        {"key": "total_gross", "title": "Tổng chi phí Gross", "width": 20, "format": "currency"},
        {"key": "total_insurance", "title": "Trích nộp BHXH", "width": 16, "format": "currency"},
        {"key": "total_net", "title": "Tổng thực lĩnh (Net)", "width": 20, "format": "currency"}
    ]

    total_keys = [
        "employee_count", "total_base_salary", "total_overtime",
        "total_allowances", "total_commissions", "total_bonuses",
        "total_gross", "total_insurance", "total_net"
    ]

    file_stream = create_styled_excel(
        title=f"BÁO CÁO TỔNG HỢP QUỸ LƯƠNG THEO ĐƠN VỊ - KỲ {period}",
        subtitle=f"Ngày xuất: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')} - Chuỗi bán lẻ TechZone",
        columns=columns,
        data=[dict(u) for u in by_unit],
        include_totals=True,
        total_keys=total_keys
    )

    filename = f"Quy_Luong_TechZone_{period}.xlsx"
    return StreamingResponse(
        file_stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


# ===================================================================================
# 8. CÁC ENDPOINT XU HƯỚNG PHỤC VỤ BIỂU ĐỒ RECHARTS (DASHBOARD CHARTS)
# ===================================================================================

@router.get("/headcount-trend", summary="Xu hướng biến động quân số và tuyển dụng theo tháng")
async def get_headcount_trend(
    months: int = Query(6, ge=3, le=24, description="Số tháng thống kê gần nhất"),
    current_user: dict = Depends(require_strict_roles(["DIRECTOR", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Thống kê xu hướng biến động nhân sự:
    - Tuyển mới (hired / new_hires)
    - Nghỉ việc (resigned)
    - Tổng nhân sự cuối kỳ (active_total / active_count)
    """
    num_months = months if isinstance(months, int) else 6
    # 1. Sinh danh sách các tháng từ hiện tại trở về trước
    query_months = text("""
        WITH RECURSIVE month_series AS (
            SELECT DATE_TRUNC('month', CURRENT_DATE) AS m, 1 AS step
            UNION ALL
            SELECT (m - INTERVAL '1 month')::DATE, step + 1
            FROM month_series
            WHERE step < :months
        )
        SELECT TO_CHAR(m, 'YYYY-MM') as period,
               (m + INTERVAL '1 month - 1 day')::DATE as month_end
        FROM month_series
        ORDER BY period ASC;
    """)
    m_rows = (await db.execute(query_months, {"months": num_months})).mappings().all()

    # 2. Thống kê theo từng tháng
    result = []
    for row in m_rows:
        period = row["period"]
        m_end = row["month_end"]

        # Số tuyển mới trong tháng
        new_hires_res = await db.execute(text("""
            SELECT COUNT(*) FROM employees 
            WHERE TO_CHAR(join_date, 'YYYY-MM') = :period
        """), {"period": period})
        new_hires = new_hires_res.scalar() or 0

        # Số thôi việc trong tháng
        resigned_res = await db.execute(text("""
            SELECT COUNT(*) FROM employees 
            WHERE TO_CHAR(resignation_date, 'YYYY-MM') = :period
        """), {"period": period})
        resigned = resigned_res.scalar() or 0

        # Tổng quân số đang làm việc tính đến cuối tháng
        active_res = await db.execute(text("""
            SELECT COUNT(*) FROM employees 
            WHERE join_date <= :m_end 
              AND (resignation_date IS NULL OR resignation_date > :m_end)
              AND employment_status IN ('ACTIVE', 'PROBATION', 'ON_LEAVE')
        """), {"m_end": m_end})
        active_count = active_res.scalar() or 0

        final_active = max(active_count, new_hires)
        result.append({
            "period": period,
            "month": period,
            "new_hires": new_hires,
            "hired": new_hires,
            "resigned": resigned,
            "active_count": final_active,
            "active_total": final_active
        })

    return result


@router.get("/payroll-trend", summary="Xu hướng tổng quỹ lương các kỳ gần nhất")
async def get_payroll_trend(
    limit: int = Query(6, ge=2, le=12, description="Số kỳ lương gần nhất"),
    current_user: dict = Depends(require_strict_roles(["DIRECTOR", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Thống kê biến động quỹ lương:
    - Tổng lương gộp (Gross)
    - Tổng lương thực nhận (Net)
    - Tổng trích nộp bảo hiểm (Insurance)
    - Số lượng nhân sự nhận lương
    """
    num_limit = limit if isinstance(limit, int) else 6
    query = text("""
        SELECT 
            salary_period,
            COUNT(payroll_id) as employee_count,
            COALESCE(SUM(gross_income), 0) as total_gross,
            COALESCE(SUM(net_salary), 0) as total_net,
            COALESCE(SUM(total_insurance), 0) as total_insurance,
            COALESCE(SUM(total_allowances), 0) as total_allowances,
            COALESCE(SUM(total_bonuses), 0) as total_bonuses
        FROM payrolls
        GROUP BY salary_period
        ORDER BY salary_period DESC
        LIMIT :limit
    """)
    res = await db.execute(query, {"limit": num_limit})
    rows = res.mappings().all()
    # Sắp xếp theo chiều thời gian tăng dần để vẽ biểu đồ
    sorted_rows = sorted(rows, key=lambda x: x["salary_period"])
    return [
        {
            "salary_period": r["salary_period"],
            "period": r["salary_period"],
            "employee_count": int(r["employee_count"] or 0),
            "total_gross": float(r["total_gross"] or 0),
            "gross_total": float(r["total_gross"] or 0),
            "total_net": float(r["total_net"] or 0),
            "net_total": float(r["total_net"] or 0),
            "total_insurance": float(r["total_insurance"] or 0),
            "insurance_total": float(r["total_insurance"] or 0),
            "total_allowances": float(r["total_allowances"] or 0),
            "total_bonuses": float(r["total_bonuses"] or 0),
            "bonus_total": float(r["total_bonuses"] or 0),
        }
        for r in sorted_rows
    ]


@router.get("/attendance-summary", summary="Thống kê chuyên cần và làm thêm giờ trong kỳ")
async def get_attendance_summary(
    period: Optional[str] = Query(None, description="Kỳ thống kê (YYYY-MM)"),
    store_id: Optional[int] = Query(None, description="Lọc theo cửa hàng"),
    current_user: dict = Depends(require_strict_roles(["DIRECTOR", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Thống kê tình hình chấm công trong tháng:
    - Tỷ lệ các trạng thái (Đúng giờ, Đi muộn, Về sớm, Nghỉ phép)
    - Tổng giờ làm việc thực tế và OT
    - Tỷ lệ đúng giờ (On-time Rate)
    """
    today = local_now().date()
    period_str = period if isinstance(period, str) and period else today.strftime('%Y-%m')
    params = {"period": period_str}
    store_filter = ""
    details_store_filter = ""
    if store_id and isinstance(store_id, int):
        params["sid"] = store_id
        store_filter = " AND store_id = :sid"
        details_store_filter = " AND (a.store_id = :sid OR e.store_id = :sid)"

    # 1. Phân bổ theo trạng thái chấm công
    status_query = text(f"""
        SELECT 
            status,
            COUNT(*) as count
        FROM attendances
        WHERE TO_CHAR(work_date, 'YYYY-MM') = :period {store_filter}
        GROUP BY status
    """)
    status_rows = (await db.execute(status_query, params)).mappings().all()

    # 2. Tổng giờ làm, giờ OT và số lượt chấm công
    totals_query = text(f"""
        SELECT 
            COUNT(*) as total_records,
            COALESCE(SUM(actual_work_hours), 0) as total_working_hours,
            COALESCE(SUM(overtime_hours), 0) as total_ot_hours,
            COALESCE(SUM(late_minutes), 0) as total_late_minutes,
            COUNT(*) FILTER (WHERE status = 'NORMAL') as on_time_count,
            COUNT(*) FILTER (WHERE status IN ('LATE', 'LATE_AND_EARLY')) as late_count
        FROM attendances
        WHERE TO_CHAR(work_date, 'YYYY-MM') = :period {store_filter}
    """)
    totals = (await db.execute(totals_query, params)).mappings().first()

    total_records = totals["total_records"] if totals else 0
    on_time_count = totals["on_time_count"] if totals else 0
    ontime_rate = round((on_time_count / total_records * 100), 1) if total_records > 0 else 100.0

    status_label_map = {
        "NORMAL": "Đúng giờ",
        "LATE": "Đi muộn",
        "EARLY": "Về sớm",
        "LATE_AND_EARLY": "Đi muộn & Về sớm",
        "ABSENT": "Vắng mặt",
        "ON_LEAVE": "Nghỉ phép",
        "ANNUAL_LEAVE": "Nghỉ phép năm",
        "MATERNITY_LEAVE": "Nghỉ thai sản",
        "SICK_LEAVE": "Nghỉ ốm đau",
        "UNPAID_LEAVE": "Nghỉ không lương"
    }
    by_status = [
        {
            "status": r["status"],
            "label": status_label_map.get(r["status"], r["status"]),
            "count": int(r["count"]),
            "rate": round((r["count"] / max(total_records, 1)) * 100, 1)
        }
        for r in status_rows
    ]

    # 3. Giờ OT theo từng ngày trong kỳ (Top ngày có OT)
    ot_daily_query = text(f"""
        SELECT 
            TO_CHAR(work_date, 'DD/MM') as day,
            COALESCE(SUM(overtime_hours), 0) as ot_hours
        FROM attendances
        WHERE TO_CHAR(work_date, 'YYYY-MM') = :period AND overtime_hours > 0 {store_filter}
        GROUP BY work_date
        ORDER BY work_date ASC
        LIMIT 15
    """)
    daily_ot = (await db.execute(ot_daily_query, params)).mappings().all()

    # 4. Chi tiết các lượt chấm công trong kỳ phục vụ drill-down
    att_details_query = text(f"""
        SELECT 
            a.attendance_id,
            e.employee_code,
            e.full_name as employee_name,
            COALESCE(s.store_name, 'Văn phòng chính') as store_name,
            TO_CHAR(a.work_date, 'DD/MM/YYYY') as work_date,
            TO_CHAR(a.check_in_time, 'HH24:MI') as check_in_time,
            TO_CHAR(a.check_out_time, 'HH24:MI') as check_out_time,
            COALESCE(a.actual_work_hours, 0) as actual_work_hours,
            COALESCE(a.overtime_hours, 0) as overtime_hours,
            COALESCE(a.late_minutes, 0) as late_minutes,
            a.status,
            CASE 
                WHEN a.status = 'NORMAL' THEN 'Đúng giờ'
                WHEN a.status = 'LATE' THEN 'Đi muộn'
                WHEN a.status = 'EARLY' THEN 'Về sớm'
                WHEN a.status = 'LATE_AND_EARLY' THEN 'Đi muộn & Về sớm'
                WHEN a.status = 'ABSENT' THEN 'Vắng mặt'
                WHEN a.status = 'ON_LEAVE' THEN 'Nghỉ phép'
                WHEN a.status = 'ANNUAL_LEAVE' THEN 'Nghỉ phép năm'
                WHEN a.status = 'MATERNITY_LEAVE' THEN 'Nghỉ thai sản'
                WHEN a.status = 'SICK_LEAVE' THEN 'Nghỉ ốm đau'
                WHEN a.status = 'UNPAID_LEAVE' THEN 'Nghỉ không lương'
                ELSE a.status
            END as status_label
        FROM attendances a
        JOIN employees e ON a.employee_id = e.employee_id
        LEFT JOIN stores s ON e.store_id = s.store_id
        WHERE TO_CHAR(a.work_date, 'YYYY-MM') = :period {details_store_filter}
        ORDER BY a.work_date DESC, a.check_in_time ASC
    """)
    att_details = (await db.execute(att_details_query, params)).mappings().all()

    return {
        "period": period_str,
        "total_records": total_records,
        "total_working_hours": float(totals["total_working_hours"]) if totals else 0.0,
        "total_ot_hours": float(totals["total_ot_hours"]) if totals else 0.0,
        "total_late_minutes": int(totals["total_late_minutes"]) if totals else 0,
        "on_time_rate": ontime_rate,
        "ontime_rate": ontime_rate,
        "on_time_count": on_time_count,
        "late_count": totals["late_count"] if totals else 0,
        "by_status": by_status,
        "status_distribution": [dict(r) for r in status_rows],
        "daily_ot": [dict(r) for r in daily_ot],
        "details": [dict(r) for r in att_details]
    }


@router.get("/leave-summary", summary="Thống kê cơ cấu đơn nghỉ phép và tỷ lệ phê duyệt")
async def get_leave_summary(
    period: Optional[str] = Query(None, description="Kỳ thống kê (YYYY-MM)"),
    store_id: Optional[int] = Query(None, description="Lọc theo cửa hàng"),
    current_user: dict = Depends(require_strict_roles(["DIRECTOR", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Thống kê cơ cấu đơn xin nghỉ phép:
    - Số đơn theo loại nghỉ phép (Phép năm, Ốm đau, Thai sản, Việc riêng, Không lương)
    - Tình hình xử lý (Chờ duyệt, Đã duyệt, Từ chối)
    """
    today = local_now().date()
    period_str = period if isinstance(period, str) and period else today.strftime('%Y-%m')
    params = {"period": period_str}
    store_join = ""
    store_filter = ""
    if store_id and isinstance(store_id, int):
        params["sid"] = store_id
        store_join = " JOIN employees e ON lr.employee_id = e.employee_id"
        store_filter = " AND e.store_id = :sid"

    # 1. Phân bổ theo loại đơn nghỉ
    types_query = text(f"""
        SELECT 
            COALESCE(lt.type_name, 'Khác') as type_name,
            COUNT(lr.request_id) as count,
            COALESCE(SUM(lr.total_days), 0) as total_days
        FROM leave_requests lr
        {store_join}
        LEFT JOIN leave_types lt ON lr.leave_type_id = lt.leave_type_id
        WHERE TO_CHAR(lr.start_date, 'YYYY-MM') = :period {store_filter}
        GROUP BY lt.type_name
        ORDER BY count DESC
    """)
    type_rows = (await db.execute(types_query, params)).mappings().all()

    # 2. Phân bổ theo trạng thái phê duyệt
    status_query = text(f"""
        SELECT 
            lr.status,
            COUNT(*) as count
        FROM leave_requests lr
        {store_join}
        WHERE TO_CHAR(lr.start_date, 'YYYY-MM') = :period {store_filter}
        GROUP BY lr.status
    """)
    status_rows = (await db.execute(status_query, params)).mappings().all()

    total_requests = sum(r["count"] for r in status_rows)
    approved_count = sum(r["count"] for r in status_rows if r["status"] == "HR_APPROVED")
    pending_count = sum(r["count"] for r in status_rows if r["status"] in ("PENDING", "STORE_APPROVED"))

    status_label_map = {
        "PENDING": "Chờ duyệt",
        "STORE_APPROVED": "Cửa hàng đã duyệt",
        "HR_APPROVED": "Đã duyệt",
        "REJECTED": "Từ chối",
        "CANCELLED": "Đã hủy"
    }
    by_status = [
        {
            "status": r["status"],
            "label": status_label_map.get(r["status"], r["status"]),
            "count": int(r["count"])
        }
        for r in status_rows
    ]

    by_type = [
        {
            "type_name": r["type_name"],
            "count": int(r["count"]),
            "days": float(r["total_days"]),
            "total_days": float(r["total_days"])
        }
        for r in type_rows
    ]

    # 3. Danh sách chi tiết các đơn xin nghỉ trong kỳ phục vụ drill-down
    leave_details_query = text(f"""
        SELECT 
            lr.request_id,
            e.employee_code,
            e.full_name as employee_name,
            COALESCE(s.store_name, 'Văn phòng chính') as store_name,
            COALESCE(lt.type_name, 'Khác') as type_name,
            TO_CHAR(lr.start_date, 'DD/MM/YYYY') as start_date,
            TO_CHAR(lr.end_date, 'DD/MM/YYYY') as end_date,
            lr.total_days,
            lr.reason,
            lr.status,
            CASE 
                WHEN lr.status = 'HR_APPROVED' THEN 'Đã duyệt'
                WHEN lr.status = 'STORE_APPROVED' THEN 'Cửa hàng đã duyệt'
                WHEN lr.status = 'PENDING' THEN 'Chờ duyệt'
                WHEN lr.status = 'REJECTED' THEN 'Từ chối'
                WHEN lr.status = 'CANCELLED' THEN 'Đã hủy'
                ELSE lr.status
            END as status_label
        FROM leave_requests lr
        JOIN employees e ON lr.employee_id = e.employee_id
        LEFT JOIN stores s ON e.store_id = s.store_id
        LEFT JOIN leave_types lt ON lr.leave_type_id = lt.leave_type_id
        WHERE TO_CHAR(lr.start_date, 'YYYY-MM') = :period {store_filter}
        ORDER BY lr.start_date DESC
    """)
    leave_details = (await db.execute(leave_details_query, params)).mappings().all()

    return {
        "period": period_str,
        "total_requests": total_requests,
        "approved_count": approved_count,
        "pending_count": pending_count,
        "by_type": by_type,
        "by_status": by_status,
        "details": [dict(r) for r in leave_details]
    }


# ===================================================================================
# 9. XUẤT BÁO CÁO TỔNG QUAN ĐA SHEET EXCEL (MULTI-SHEET WORKBOOK)
# ===================================================================================

@router.get("/export/overview/excel", summary="Xuất báo cáo tổng quan đa trang (Workbook) chuẩn TechZone")
async def export_overview_excel(
    period: Optional[str] = Query(None, description="Kỳ báo cáo (YYYY-MM)"),
    store_id: Optional[int] = Query(None, description="Lọc theo cửa hàng"),
    current_user: dict = Depends(require_strict_roles(["DIRECTOR", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Xuất file Excel tích hợp 3 Sheet dữ liệu quản trị chuẩn:
    - Sheet 1: Cơ cấu nhân sự & Học vấn
    - Sheet 2: Tổng hợp chi phí quỹ lương
    - Sheet 3: Báo cáo hiệu suất bán lẻ
    """
    today = local_now().date()
    period_str = period if isinstance(period, str) and period else today.strftime('%Y-%m')

    # 1. Dữ liệu Cơ cấu nhân sự
    demo_data = await get_demographics_report(store_id=store_id, current_user=current_user, db=db)
    demo_rows = [dict(d) for d in demo_data.get("details", [])]

    demo_columns = [
        {"key": "employee_code", "title": "Mã NV", "width": 12, "align": "center"},
        {"key": "full_name", "title": "Họ và Tên", "width": 24},
        {"key": "store_name", "title": "Cửa hàng Chi nhánh", "width": 22},
        {"key": "department_name", "title": "Phòng ban", "width": 20},
        {"key": "position_name", "title": "Chức vụ", "width": 18},
        {"key": "education_level", "title": "Trình độ học vấn", "width": 18, "align": "center"},
        {"key": "basic_salary", "title": "Lương HĐ", "width": 16, "format": "currency"},
        {"key": "salary_bracket", "title": "Khung bậc lương", "width": 18},
        {"key": "seniority_years", "title": "Thâm niên (năm)", "width": 16, "format": "number"},
        {"key": "seniority_group", "title": "Nhóm thâm niên", "width": 16},
        {"key": "employment_status", "title": "Trạng thái", "width": 14, "align": "center"}
    ]

    # 2. Dữ liệu Quỹ lương
    fund_data = await get_payroll_fund_summary(period=period_str, store_id=store_id, current_user=current_user, db=db)
    fund_rows = [dict(u) for u in fund_data.get("by_unit", [])]

    fund_columns = [
        {"key": "unit_name", "title": "Chi nhánh / Phòng ban", "width": 26},
        {"key": "employee_count", "title": "Số lượng NV", "width": 14, "format": "number"},
        {"key": "total_base_salary", "title": "Tổng lương CB", "width": 18, "format": "currency"},
        {"key": "total_overtime", "title": "Tổng tăng ca OT", "width": 16, "format": "currency"},
        {"key": "total_allowances", "title": "Tổng phụ cấp", "width": 16, "format": "currency"},
        {"key": "total_commissions", "title": "Tổng hoa hồng", "width": 16, "format": "currency"},
        {"key": "total_bonuses", "title": "Tổng tiền thưởng", "width": 16, "format": "currency"},
        {"key": "total_gross", "title": "Tổng chi phí Gross", "width": 20, "format": "currency"},
        {"key": "total_insurance", "title": "Trích nộp BHXH", "width": 16, "format": "currency"},
        {"key": "total_net", "title": "Tổng thực lĩnh (Net)", "width": 20, "format": "currency"}
    ]

    # 3. Dữ liệu Chấm công chi tiết
    att_data = await get_attendance_summary(period=period_str, store_id=store_id, current_user=current_user, db=db)
    att_rows = [dict(a) for a in att_data.get("details", [])]
    att_columns = [
        {"key": "employee_code", "title": "Mã NV", "width": 12, "align": "center"},
        {"key": "employee_name", "title": "Họ và Tên", "width": 24},
        {"key": "store_name", "title": "Cơ sở / Chi nhánh", "width": 24},
        {"key": "work_date", "title": "Ngày làm việc", "width": 14, "align": "center"},
        {"key": "check_in_time", "title": "Giờ vào", "width": 12, "align": "center"},
        {"key": "check_out_time", "title": "Giờ ra", "width": 12, "align": "center"},
        {"key": "actual_work_hours", "title": "Giờ làm thực", "width": 14, "format": "number"},
        {"key": "overtime_hours", "title": "Tăng ca (OT)", "width": 14, "format": "number"},
        {"key": "late_minutes", "title": "Đi muộn (phút)", "width": 15, "format": "number"},
        {"key": "status_label", "title": "Trạng thái chuyên cần", "width": 22, "align": "center"}
    ]

    # 4. Dữ liệu Nghỉ phép chi tiết
    leave_data = await get_leave_summary(period=period_str, store_id=store_id, current_user=current_user, db=db)
    leave_rows = [dict(l) for l in leave_data.get("details", [])]
    leave_columns = [
        {"key": "employee_code", "title": "Mã NV", "width": 12, "align": "center"},
        {"key": "employee_name", "title": "Họ và Tên", "width": 24},
        {"key": "store_name", "title": "Chi nhánh", "width": 22},
        {"key": "type_name", "title": "Loại hình nghỉ phép", "width": 28},
        {"key": "start_date", "title": "Từ ngày", "width": 14, "align": "center"},
        {"key": "end_date", "title": "Đến ngày", "width": 14, "align": "center"},
        {"key": "total_days", "title": "Số ngày nghỉ", "width": 14, "format": "number"},
        {"key": "reason", "title": "Lý do xin nghỉ", "width": 36},
        {"key": "status_label", "title": "Trạng thái phê duyệt", "width": 20, "align": "center"}
    ]

    sheets = [
        {
            "sheet_name": "CƠ CẤU NHÂN SỰ",
            "title": "BÁO CÁO CƠ CẤU NHÂN SỰ TOÀN CHUỖI TECHZONE",
            "subtitle": f"Ngày xuất: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')} - Tổng cộng: {len(demo_rows)} nhân sự",
            "columns": demo_columns,
            "data": demo_rows,
            "include_totals": False
        },
        {
            "sheet_name": "QUỸ LƯƠNG ĐƠN VỊ",
            "title": f"BÁO CÁO TỔNG HỢP QUỸ LƯƠNG THEO ĐƠN VỊ - KỲ {period_str}",
            "subtitle": f"Ngày xuất: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')} - Chuỗi bán lẻ TechZone",
            "columns": fund_columns,
            "data": fund_rows,
            "include_totals": True,
            "total_keys": [
                "employee_count", "total_base_salary", "total_overtime",
                "total_allowances", "total_commissions", "total_bonuses",
                "total_gross", "total_insurance", "total_net"
            ]
        },
        {
            "sheet_name": "CHẤM CÔNG CHUYÊN CẦN",
            "title": f"BẢNG KÊ CHẤM CÔNG VÀ CHUYÊN CẦN CHI TIẾT - KỲ {period_str}",
            "subtitle": f"Ngày xuất: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')} - Tổng cộng: {len(att_rows)} lượt ca",
            "columns": att_columns,
            "data": att_rows,
            "include_totals": True,
            "total_keys": ["actual_work_hours", "overtime_hours", "late_minutes"]
        },
        {
            "sheet_name": "THEO DÕI NGHỈ PHÉP",
            "title": f"SỔ THEO DÕI ĐƠN NGHỈ PHÉP TOÀN HỆ THỐNG - KỲ {period_str}",
            "subtitle": f"Ngày xuất: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')} - Tổng cộng: {len(leave_rows)} đơn nghỉ phép",
            "columns": leave_columns,
            "data": leave_rows,
            "include_totals": True,
            "total_keys": ["total_days"]
        }
    ]

    file_stream = create_multisheet_excel(sheets)
    filename = f"Bao_Cao_Tong_Hop_TechZone_{period}.xlsx"
    return StreamingResponse(
        file_stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


# ===================================================================================
# 6. BÁO CÁO MA TRẬN ĐA CHIỀU (CROSS-TAB MATRIX REPORTS THEO QUÝ / NĂM / ĐỐI TƯỢNG)
# Phục vụ thiết kế Main-Subform: Bảng ma trận Master -> Click hiển thị Subform Detail
# ===================================================================================

@router.get("/matrix/quarterly-payroll", summary="Thống kê ma trận chi phí lương và quỹ thưởng theo Quý & Năm")
async def get_quarterly_payroll_matrix(
    year: int = Query(2026, description="Năm thống kê"),
    store_id: Optional[int] = Query(None, description="Lọc theo cửa hàng"),
    current_user: dict = Depends(require_strict_roles(["DIRECTOR", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Thống kê ma trận chi phí theo chuẩn kế toán doanh nghiệp TechZone:
    - 4 Quý (Q1, Q2, Q3, Q4) và Tổng năm (Cả năm)
    - Chỉ số: Tổng Gross, Lương HĐ cơ bản, Thưởng & Phụ cấp, Giảm trừ BHXH/BHYT, Thuế TNCN, Thực lĩnh Net
    - Kèm danh sách chi tiết N chứng từ theo từng quý phục vụ Subform
    """
    roles = current_user.get("roles", [])
    if "STORE_MANAGER" in roles and not set(roles).intersection({"ADMIN", "HR_MANAGER", "DIRECTOR"}):
        user_store_id = current_user.get("store_id")
        if not user_store_id:
            raise HTTPException(403, "Tài khoản chưa được gán cửa hàng.")
        store_id = user_store_id

    quarter_months = {
        "Q1": [f"{year}-01", f"{year}-02", f"{year}-03"],
        "Q2": [f"{year}-04", f"{year}-05", f"{year}-06"],
        "Q3": [f"{year}-07", f"{year}-08", f"{year}-09"],
        "Q4": [f"{year}-10", f"{year}-11", f"{year}-12"],
    }

    params = {"year": str(year)}
    store_filter = ""
    if store_id:
        params["store_id"] = store_id
        store_filter = " AND e.store_id = :store_id"

    # Lấy toàn bộ bản ghi bảng lương trong năm
    query = text(f"""
        SELECT p.payroll_id, p.employee_id, e.employee_code, e.full_name as employee_name,
               e.store_id, COALESCE(s.store_name, 'Văn phòng chính') as store_name,
               pos.position_name, p.salary_period,
               COALESCE(p.contract_salary, 0) as contract_salary,
               COALESCE(p.total_allowances, 0) as total_allowances,
               COALESCE(p.total_bonuses, 0) as total_bonuses,
               COALESCE(p.total_insurance, 0) as total_insurance,
               COALESCE(p.total_deductions, 0) as total_deductions,
               COALESCE(p.gross_income, 0) as gross_income,
               COALESCE(p.net_salary, 0) as net_salary,
               p.payment_status, p.payment_date,
               p.actual_working_days
        FROM payrolls p
        JOIN employees e ON p.employee_id = e.employee_id
        LEFT JOIN stores s ON e.store_id = s.store_id
        LEFT JOIN positions pos ON e.position_id = pos.position_id
        WHERE p.salary_period LIKE :year || '-%' {store_filter}
        ORDER BY p.salary_period ASC, e.employee_id ASC;
    """)

    res = await db.execute(query, params)
    all_payrolls = [dict(r) for r in res.mappings().all()]

    # Phân nhóm theo Quý
    quarter_data = {"Q1": [], "Q2": [], "Q3": [], "Q4": []}
    for pr in all_payrolls:
        sp = pr.get("salary_period", "")
        for q, months in quarter_months.items():
            if sp in months:
                pr_copy = dict(pr)
                pr_copy["quarter"] = q
                quarter_data[q].append(pr_copy)
                break

    def calc_metrics(rows):
        total_gross = sum(float(r["gross_income"] or 0) for r in rows)
        basic_salary = sum(float(r["contract_salary"] or 0) for r in rows)
        allowances = sum(float(r["total_allowances"] or 0) for r in rows)
        bonuses = sum(float(r["total_bonuses"] or 0) for r in rows)
        insurance = sum(float(r["total_insurance"] or 0) for r in rows)
        deductions = sum(float(r["total_deductions"] or 0) for r in rows)
        net_salary = sum(float(r["net_salary"] or 0) for r in rows)
        unique_emps = len(set(r["employee_id"] for r in rows))
        return {
            "record_count": len(rows),
            "employee_count": unique_emps,
            "total_gross": total_gross,
            "basic_salary": basic_salary,
            "allowances": allowances,
            "bonuses": bonuses,
            "insurance": insurance,
            "deductions": deductions,
            "net_salary": net_salary
        }

    q1_metrics = calc_metrics(quarter_data["Q1"])
    q2_metrics = calc_metrics(quarter_data["Q2"])
    q3_metrics = calc_metrics(quarter_data["Q3"])
    q4_metrics = calc_metrics(quarter_data["Q4"])
    year_metrics = calc_metrics(all_payrolls)

    # Cấu trúc Bảng ma trận tài chính (Matrix Table)
    indicators = [
        {
            "code": "gross",
            "name": "1. Tổng chi phí lương (Gross)",
            "is_header": True,
            "q1": q1_metrics["total_gross"],
            "q2": q2_metrics["total_gross"],
            "q3": q3_metrics["total_gross"],
            "q4": q4_metrics["total_gross"],
            "total": year_metrics["total_gross"]
        },
        {
            "code": "basic_salary",
            "name": "   • Lương thỏa thuận hợp đồng",
            "is_sub": True,
            "q1": q1_metrics["basic_salary"],
            "q2": q2_metrics["basic_salary"],
            "q3": q3_metrics["basic_salary"],
            "q4": q4_metrics["basic_salary"],
            "total": year_metrics["basic_salary"]
        },
        {
            "code": "bonuses",
            "name": "   • Tiền thưởng (KPI, hiệu suất, doanh số)",
            "is_sub": True,
            "q1": q1_metrics["bonuses"],
            "q2": q2_metrics["bonuses"],
            "q3": q3_metrics["bonuses"],
            "q4": q4_metrics["bonuses"],
            "total": year_metrics["bonuses"]
        },
        {
            "code": "allowances",
            "name": "   • Các khoản phụ cấp trách nhiệm/ăn trưa",
            "is_sub": True,
            "q1": q1_metrics["allowances"],
            "q2": q2_metrics["allowances"],
            "q3": q3_metrics["allowances"],
            "q4": q4_metrics["allowances"],
            "total": year_metrics["allowances"]
        },
        {
            "code": "insurance",
            "name": "2. Trích nộp bảo hiểm (BHXH, BHYT, BHTN)",
            "is_header": False,
            "q1": q1_metrics["insurance"],
            "q2": q2_metrics["insurance"],
            "q3": q3_metrics["insurance"],
            "q4": q4_metrics["insurance"],
            "total": year_metrics["insurance"]
        },
        {
            "code": "deductions",
            "name": "3. Các khoản giảm trừ khác (Kỷ luật, tạm ứng)",
            "is_header": False,
            "q1": q1_metrics["deductions"],
            "q2": q2_metrics["deductions"],
            "q3": q3_metrics["deductions"],
            "q4": q4_metrics["deductions"],
            "total": year_metrics["deductions"]
        },
        {
            "code": "net",
            "name": "4. TỔNG THỰC LĨNH CHI TRẢ (NET)",
            "is_highlight": True,
            "q1": q1_metrics["net_salary"],
            "q2": q2_metrics["net_salary"],
            "q3": q3_metrics["net_salary"],
            "q4": q4_metrics["net_salary"],
            "total": year_metrics["net_salary"]
        },
        {
            "code": "employee_count",
            "name": "5. Số lượng nhân sự nhận lương",
            "is_count": True,
            "q1": q1_metrics["employee_count"],
            "q2": q2_metrics["employee_count"],
            "q3": q3_metrics["employee_count"],
            "q4": q4_metrics["employee_count"],
            "total": year_metrics["employee_count"]
        }
    ]

    return {
        "year": year,
        "store_id": store_id,
        "indicators": indicators,
        "quarter_details": {
            "Q1": quarter_data["Q1"],
            "Q2": quarter_data["Q2"],
            "Q3": quarter_data["Q3"],
            "Q4": quarter_data["Q4"],
            "ALL": all_payrolls
        }
    }


@router.get("/matrix/by-store", summary="Thống kê ma trận chi phí lương theo Chi nhánh và 4 Quý")
async def get_payroll_matrix_by_store(
    year: int = Query(2026, description="Năm thống kê"),
    current_user: dict = Depends(require_strict_roles(["DIRECTOR", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Ma trận chi phí quỹ lương theo Chi nhánh cửa hàng x 4 Quý trong năm
    Bấm vào từng chi nhánh hoặc ô số liệu để hiển thị Subform nhân sự của chi nhánh đó
    """
    quarter_months = {
        "Q1": [f"{year}-01", f"{year}-02", f"{year}-03"],
        "Q2": [f"{year}-04", f"{year}-05", f"{year}-06"],
        "Q3": [f"{year}-07", f"{year}-08", f"{year}-09"],
        "Q4": [f"{year}-10", f"{year}-11", f"{year}-12"],
    }

    # Lấy danh sách cửa hàng
    stores_res = await db.execute(text("SELECT store_id, store_name, store_code FROM stores ORDER BY store_id ASC;"))
    stores_list = [dict(s) for s in stores_res.mappings().all()]

    # Lấy dữ liệu payroll trong năm
    payroll_res = await db.execute(text("""
        SELECT p.payroll_id, p.employee_id, e.employee_code, e.full_name as employee_name,
               COALESCE(e.store_id, 0) as store_id,
               COALESCE(s.store_name, 'Văn phòng chính') as store_name,
               p.salary_period,
               COALESCE(p.contract_salary, 0) as contract_salary,
               COALESCE(p.gross_income, 0) as gross_income,
               COALESCE(p.net_salary, 0) as net_salary,
               p.actual_working_days
        FROM payrolls p
        JOIN employees e ON p.employee_id = e.employee_id
        LEFT JOIN stores s ON e.store_id = s.store_id
        WHERE p.salary_period LIKE :year || '-%'
    """), {"year": str(year)})
    payrolls = [dict(r) for r in payroll_res.mappings().all()]

    # Map payroll theo store_id và quarter
    store_map = {}
    for st in stores_list:
        sid = st["store_id"]
        store_map[sid] = {
            "store_id": sid,
            "store_name": st["store_name"],
            "store_code": st.get("store_code", ""),
            "q1_net": 0, "q2_net": 0, "q3_net": 0, "q4_net": 0, "total_net": 0,
            "q1_gross": 0, "q2_gross": 0, "q3_gross": 0, "q4_gross": 0, "total_gross": 0,
            "employee_count": set(),
            "details": []
        }

    # Thêm văn phòng chính nếu có nhân viên không thuộc store nào
    store_map[0] = {
        "store_id": 0,
        "store_name": "Văn phòng chính",
        "store_code": "HQ",
        "q1_net": 0, "q2_net": 0, "q3_net": 0, "q4_net": 0, "total_net": 0,
        "q1_gross": 0, "q2_gross": 0, "q3_gross": 0, "q4_gross": 0, "total_gross": 0,
        "employee_count": set(),
        "details": []
    }

    for pr in payrolls:
        sid = pr.get("store_id") or 0
        if sid not in store_map:
            store_map[sid] = {
                "store_id": sid,
                "store_name": pr.get("store_name", "Khác"),
                "store_code": "",
                "q1_net": 0, "q2_net": 0, "q3_net": 0, "q4_net": 0, "total_net": 0,
                "q1_gross": 0, "q2_gross": 0, "q3_gross": 0, "q4_gross": 0, "total_gross": 0,
                "employee_count": set(),
                "details": []
            }
        
        sp = pr.get("salary_period", "")
        net = float(pr.get("net_salary") or 0)
        gross = float(pr.get("gross_income") or 0)
        store_map[sid]["employee_count"].add(pr["employee_id"])
        store_map[sid]["total_net"] += net
        store_map[sid]["total_gross"] += gross
        store_map[sid]["details"].append(pr)

        if sp in quarter_months["Q1"]:
            store_map[sid]["q1_net"] += net
            store_map[sid]["q1_gross"] += gross
        elif sp in quarter_months["Q2"]:
            store_map[sid]["q2_net"] += net
            store_map[sid]["q2_gross"] += gross
        elif sp in quarter_months["Q3"]:
            store_map[sid]["q3_net"] += net
            store_map[sid]["q3_gross"] += gross
        elif sp in quarter_months["Q4"]:
            store_map[sid]["q4_net"] += net
            store_map[sid]["q4_gross"] += gross

    rows = []
    for sid, data in store_map.items():
        if data["total_gross"] > 0 or sid != 0:
            rows.append({
                "store_id": sid,
                "store_name": data["store_name"],
                "store_code": data["store_code"],
                "q1_net": data["q1_net"],
                "q2_net": data["q2_net"],
                "q3_net": data["q3_net"],
                "q4_net": data["q4_net"],
                "total_net": data["total_net"],
                "total_gross": data["total_gross"],
                "employee_count": len(data["employee_count"]),
                "details": data["details"]
            })

    rows.sort(key=lambda x: x["total_net"], reverse=True)

    totals = {
        "q1_net": sum(r["q1_net"] for r in rows),
        "q2_net": sum(r["q2_net"] for r in rows),
        "q3_net": sum(r["q3_net"] for r in rows),
        "q4_net": sum(r["q4_net"] for r in rows),
        "total_net": sum(r["total_net"] for r in rows),
        "total_gross": sum(r["total_gross"] for r in rows),
        "employee_count": sum(r["employee_count"] for r in rows),
    }

    return {
        "year": year,
        "rows": rows,
        "totals": totals
    }


@router.get("/matrix/by-employee", summary="Thống kê ma trận thu nhập theo từng Nhân viên và 4 Quý")
async def get_payroll_matrix_by_employee(
    year: int = Query(2026, description="Năm thống kê"),
    store_id: Optional[int] = Query(None, description="Lọc theo cửa hàng"),
    current_user: dict = Depends(require_strict_roles(["DIRECTOR", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Ma trận thu nhập theo từng Nhân viên x 4 Quý trong năm
    Bấm vào từng nhân sự để xem lịch sử phiếu lương ở Subform bên cạnh
    """
    quarter_months = {
        "Q1": [f"{year}-01", f"{year}-02", f"{year}-03"],
        "Q2": [f"{year}-04", f"{year}-05", f"{year}-06"],
        "Q3": [f"{year}-07", f"{year}-08", f"{year}-09"],
        "Q4": [f"{year}-10", f"{year}-11", f"{year}-12"],
    }

    params = {"year": str(year)}
    store_filter = ""
    if store_id:
        params["store_id"] = store_id
        store_filter = " AND e.store_id = :store_id"

    res = await db.execute(text(f"""
        SELECT p.payroll_id, p.employee_id, e.employee_code, e.full_name as employee_name,
               COALESCE(s.store_name, 'Văn phòng chính') as store_name,
               COALESCE(pos.position_name, 'Nhân viên') as position_name,
               p.salary_period,
               COALESCE(p.contract_salary, 0) as contract_salary,
               COALESCE(p.gross_income, 0) as gross_income,
               COALESCE(p.net_salary, 0) as net_salary,
               p.payment_status, p.payment_date, p.actual_working_days
        FROM payrolls p
        JOIN employees e ON p.employee_id = e.employee_id
        LEFT JOIN stores s ON e.store_id = s.store_id
        LEFT JOIN positions pos ON e.position_id = pos.position_id
        WHERE p.salary_period LIKE :year || '-%' {store_filter}
        ORDER BY e.employee_id ASC, p.salary_period ASC;
    """), params)

    payrolls = [dict(r) for r in res.mappings().all()]
    emp_map = {}

    for pr in payrolls:
        eid = pr["employee_id"]
        if eid not in emp_map:
            emp_map[eid] = {
                "employee_id": eid,
                "employee_code": pr["employee_code"],
                "employee_name": pr["employee_name"],
                "store_name": pr["store_name"],
                "position_name": pr["position_name"],
                "q1_net": 0, "q2_net": 0, "q3_net": 0, "q4_net": 0, "total_net": 0,
                "total_gross": 0,
                "paid_months": 0,
                "payrolls": []
            }
        
        sp = pr.get("salary_period", "")
        net = float(pr.get("net_salary") or 0)
        gross = float(pr.get("gross_income") or 0)
        emp_map[eid]["total_net"] += net
        emp_map[eid]["total_gross"] += gross
        emp_map[eid]["paid_months"] += 1
        emp_map[eid]["payrolls"].append(pr)

        if sp in quarter_months["Q1"]:
            emp_map[eid]["q1_net"] += net
        elif sp in quarter_months["Q2"]:
            emp_map[eid]["q2_net"] += net
        elif sp in quarter_months["Q3"]:
            emp_map[eid]["q3_net"] += net
        elif sp in quarter_months["Q4"]:
            emp_map[eid]["q4_net"] += net

    emp_list = list(emp_map.values())
    emp_list.sort(key=lambda x: x["total_net"], reverse=True)

    totals = {
        "q1_net": sum(e["q1_net"] for e in emp_list),
        "q2_net": sum(e["q2_net"] for e in emp_list),
        "q3_net": sum(e["q3_net"] for e in emp_list),
        "q4_net": sum(e["q4_net"] for e in emp_list),
        "total_net": sum(e["total_net"] for e in emp_list),
        "total_gross": sum(e["total_gross"] for e in emp_list),
        "employee_count": len(emp_list)
    }

    return {
        "year": year,
        "rows": emp_list,
        "totals": totals
    }


