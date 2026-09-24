import io
import csv
from datetime import date, datetime
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.database import get_db
from app.api.deps import require_roles, get_current_user
from app.core.excel_exporter import create_styled_excel

router = APIRouter()

# ===================================================================================
# 1. DASHBOARD STATS (THẺ CHỈ SỐ TỔNG QUAN)
# ===================================================================================

@router.get("/dashboard-stats", summary="Số liệu tổng quan hiển thị trên thẻ Dashboard (Executive KPI Cards)")
async def get_dashboard_stats(
    period: Optional[str] = Query("2026-09", description="Kỳ thống kê (YYYY-MM)"),
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER", "STORE_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Số liệu KPI tổng hợp cho trang chủ Quản trị & Quản lý chi nhánh:
    - Tổng nhân sự đang làm việc (ACTIVE, PROBATION)
    - Tổng số cửa hàng đang hoạt động
    - Số đơn nghỉ phép đang chờ duyệt (PENDING, STORE_APPROVED)
    - Quỹ lương Net của kỳ hiện tại
    - Tổng doanh số chuỗi trong kỳ
    - Tình hình chấm công hôm nay (Đã check-in, Đi muộn)
    """
    roles = current_user.get("roles", [])
    store_filter = ""
    params = {"period": period, "today": date.today()}

    if "STORE_MANAGER" in roles and "ADMIN" not in roles and "HR_MANAGER" not in roles:
        user_store_id = current_user.get("store_id")
        if user_store_id:
            store_filter = " AND store_id = :store_id"
            params["store_id"] = user_store_id

    # 1. Nhân sự
    total_emp = (await db.execute(text(f"SELECT count(*) FROM employees WHERE employment_status IN ('ACTIVE', 'PROBATION'){store_filter}"), params)).scalar() or 0
    total_stores = (await db.execute(text("SELECT count(*) FROM stores WHERE is_active = TRUE"))).scalar() or 0

    # 2. Đơn chờ duyệt
    leave_query = "SELECT count(*) FROM leave_requests lr JOIN employees e ON lr.employee_id = e.employee_id WHERE lr.status IN ('PENDING', 'STORE_APPROVED')"
    if store_filter:
        leave_query += " AND e.store_id = :store_id"
    pending_leaves = (await db.execute(text(leave_query), params)).scalar() or 0

    # 3. Quỹ lương kỳ
    pr_query = "SELECT COALESCE(SUM(p.net_salary), 0), COALESCE(SUM(p.gross_income), 0) FROM payrolls p JOIN employees e ON p.employee_id = e.employee_id WHERE p.salary_period = :period"
    if store_filter:
        pr_query += " AND e.store_id = :store_id"
    pr_res = (await db.execute(text(pr_query), params)).first()
    monthly_net_fund = float(pr_res[0] or 0)
    monthly_gross_fund = float(pr_res[1] or 0)

    # 4. Doanh số toàn chuỗi trong kỳ
    sales_query = "SELECT COALESCE(SUM(total_revenue), 0) FROM employee_sales WHERE salary_period = :period"
    if store_filter:
        sales_query += " AND store_id = :store_id"
    total_sales = float((await db.execute(text(sales_query), params)).scalar() or 0)

    # 5. Chấm công hôm nay
    att_query = """
        SELECT 
            COUNT(CASE WHEN check_in_time IS NOT NULL THEN 1 END) as checked_in,
            COUNT(CASE WHEN late_minutes > 0 THEN 1 END) as late_count
        FROM attendances a
        JOIN employees e ON a.employee_id = e.employee_id
        WHERE a.work_date = :today
    """
    if store_filter:
        att_query += " AND e.store_id = :store_id"
    att_res = (await db.execute(text(att_query), params)).first()
    checked_in_today = att_res[0] or 0
    late_today = att_res[1] or 0

    return {
        "active_employees": total_emp,
        "total_stores": total_stores,
        "pending_leaves": pending_leaves,
        "monthly_net_payroll_fund": monthly_net_fund,
        "monthly_gross_payroll_fund": monthly_gross_fund,
        "total_retail_revenue": total_sales,
        "attendance_today": {
            "checked_in": checked_in_today,
            "late": late_today
        },
        "system_status": "ONLINE",
        "current_period": period
    }


# ===================================================================================
# 2. RUBRIC III.3.1.4: BÁO CÁO BIẾN ĐỘNG NHÂN SỰ THEO THÁNG
# ===================================================================================

@router.get("/monthly-status", summary="Báo cáo tình hình nhân sự tháng: Đang làm, Nghỉ phép, Thôi việc (Rubric III.3.1.4)")
async def get_monthly_status_report(
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
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
    data["recent_join_trends"] = trend_res.mappings().all()

    return data


# ===================================================================================
# 3. RUBRIC III.3.1.5: BÁO CÁO CƠ CẤU TRÌNH ĐỘ HỌC VẤN, MỨC LƯƠNG & THÂM NIÊN
# ===================================================================================

@router.get("/demographics", summary="Báo cáo học vấn, thâm niên và khung bậc lương toàn chuỗi (Rubric III.3.1.5)")
async def get_demographics_report(
    store_id: Optional[int] = Query(None, description="Lọc theo cửa hàng"),
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER", "STORE_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Truy vấn View v_hr_demographics_report kết hợp gom nhóm đa chiều phục vụ biểu đồ Recharts:
    1. Trình độ học vấn (education_distribution): Đại học, Cao đẳng, Trung cấp, THPT
    2. Nhóm thâm niên (seniority_distribution): Dưới 1 năm, 1-3 năm, 3-5 năm, Trên 5 năm
    3. Phân khúc mức lương (salary_distribution): <7M, 7-12M, 12-20M, >20M
    4. Chi tiết từng nhân sự (details)
    """
    roles = current_user.get("roles", [])
    filter_store_id = store_id
    if "STORE_MANAGER" in roles and "ADMIN" not in roles and "HR_MANAGER" not in roles:
        filter_store_id = current_user.get("store_id")

    where_clause = ""
    params = {}
    if filter_store_id:
        where_clause = " WHERE e.store_id = :sid"
        params["sid"] = filter_store_id

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

    # 3. Phân bổ khung mức lương
    salary_query = f"""
        SELECT 
            CASE 
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

    return {
        "store_id": filter_store_id,
        "total_employees": len(rows),
        "education_distribution": edu_stats,
        "salary_distribution": salary_stats,
        "seniority_distribution": seniority_stats,
        "details": rows
    }


# ===================================================================================
# 4. BÁO CÁO QUỸ LƯƠNG & CHI PHÍ THEO CHI NHÁNH CỬA HÀNG
# ===================================================================================

@router.get("/payroll-fund", summary="Báo cáo tổng hợp chi phí tiền lương theo chi nhánh & phòng ban")
async def get_payroll_fund_summary(
    period: Optional[str] = Query("2026-09", description="Kỳ lương (YYYY-MM)"),
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Báo cáo tổng hợp chi phí tiền lương chia theo từng điểm bán và phòng ban:
    Tổng lương cơ bản, Tổng làm thêm OT, Tổng hoa hồng, Tổng các loại phụ cấp,
    Tổng trích nộp bảo hiểm 10.5% và Tổng ngân sách lương thực chi.
    """
    store_stats = (await db.execute(text("""
        SELECT 
            COALESCE(s.store_name, d.department_name, 'Khác') as unit_name,
            COUNT(p.payroll_id) as employee_count,
            SUM(p.actual_base_salary) as total_base_salary,
            SUM(p.overtime_salary) as total_overtime,
            SUM(p.position_allowance + p.seniority_allowance + p.project_allowance + p.meal_transport_allowance) as total_allowances,
            SUM(p.commission_amount) as total_commissions,
            SUM(p.bonus_amount) as total_bonuses,
            SUM(p.gross_income) as total_gross,
            SUM(p.total_insurance) as total_insurance,
            SUM(p.penalty_deduction) as total_penalties,
            SUM(p.net_salary) as total_net
        FROM payrolls p
        JOIN employees e ON p.employee_id = e.employee_id
        LEFT JOIN stores s ON e.store_id = s.store_id
        LEFT JOIN departments d ON e.department_id = d.department_id
        WHERE p.salary_period = :period
        GROUP BY COALESCE(s.store_name, d.department_name, 'Khác')
        ORDER BY total_gross DESC
    """), {"period": period})).mappings().all()

    # Tổng cộng toàn chuỗi
    total_res = (await db.execute(text("""
        SELECT 
            COUNT(payroll_id) as total_headcount,
            COALESCE(SUM(gross_income), 0) as total_gross_fund,
            COALESCE(SUM(net_salary), 0) as total_net_fund,
            COALESCE(SUM(total_insurance), 0) as total_insurance_fund,
            COALESCE(SUM(commission_amount), 0) as total_commission_fund
        FROM payrolls
        WHERE salary_period = :period
    """), {"period": period})).mappings().first()

    return {
        "salary_period": period,
        "company_totals": dict(total_res) if total_res else {},
        "by_unit": store_stats
    }


# ===================================================================================
# 5. BÁO CÁO HIỆU SUẤT BÁN LẺ & TỶ LỆ ĐẠT KPI DOANH SỐ
# ===================================================================================

@router.get("/sales-performance", summary="Báo cáo hiệu suất bán lẻ 3 ngành hàng và tỷ lệ hoàn thành KPI")
async def get_sales_performance_report(
    period: Optional[str] = Query("2026-09", description="Kỳ doanh số (YYYY-MM)"),
    store_id: Optional[int] = Query(None, description="Lọc theo cửa hàng"),
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER", "STORE_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Báo cáo phân tích doanh thu 3 nhóm sản phẩm: Điện thoại, Laptop, Phụ kiện,
    tỷ lệ đạt chỉ tiêu KPI và tiền thưởng nóng KPI của từng nhân viên và cửa hàng.
    """
    params = {"period": period}
    where_extra = ""
    roles = current_user.get("roles", [])

    if "STORE_MANAGER" in roles and "ADMIN" not in roles and "HR_MANAGER" not in roles:
        mgr_store = current_user.get("store_id")
        if mgr_store:
            where_extra = " AND es.store_id = :sid"
            params["sid"] = mgr_store
    elif store_id:
        where_extra = " AND es.store_id = :sid"
        params["sid"] = store_id

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

    return {
        "salary_period": period,
        "revenue_breakdown": dict(totals_res) if totals_res else {},
        "sales_staff_details": emp_res
    }


# ===================================================================================
# 6. NHẬT KÝ HỆ THỐNG AUDIT LOGS (RUBRIC II.2 - GIAO DIỆN ADMIN)
# ===================================================================================

@router.get("/audit-logs", summary="Nhật ký hoạt động hệ thống phục vụ Admin (Rubric II.2)")
async def get_audit_logs(
    limit: int = Query(50, ge=1, le=500),
    action: Optional[str] = Query(None, description="Lọc theo hành động"),
    current_user: dict = Depends(require_roles(["ADMIN"])),
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
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
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
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
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
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
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
