from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.core.database import get_db
from app.api.deps import get_current_user, require_roles
from app.schemas.schemas import (
    PayrollOut, PayrollDetailOut, CalculatePayrollRequest,
    SalesRecordCreate, SalesRecordOut
)

router = APIRouter()

@router.get("", response_model=List[PayrollOut], summary="Danh sách bảng lương theo kỳ tháng")
async def list_payrolls(
    period: Optional[str] = Query("2026-09", description="Kỳ lương (YYYY-MM)"),
    employee_id: Optional[int] = Query(None, description="Lọc theo nhân viên"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    query = """
        SELECT p.payroll_id, p.employee_id, e.employee_code, e.full_name as employee_name,
               s.store_name, pos.position_name, p.salary_period,
               p.standard_working_days, p.actual_working_days, p.paid_leave_days, p.unpaid_leave_days,
               p.unworked_hours, p.time_deduction_amount,
               p.contract_salary, p.actual_base_salary, p.overtime_salary,
               p.position_allowance, p.seniority_allowance, p.project_allowance,
               p.meal_transport_allowance, p.commission_amount, p.bonus_amount,
               p.holiday_bonus, p.productivity_bonus,
               p.gross_income, p.bhxh_amount, p.bhyt_amount, p.bhtn_amount,
               p.total_insurance, p.personal_income_tax, p.penalty_deduction, p.total_deduction,
               p.net_salary, p.payment_status, p.payment_date
        FROM payrolls p
        JOIN employees e ON p.employee_id = e.employee_id
        LEFT JOIN stores s ON e.store_id = s.store_id
        JOIN positions pos ON e.position_id = pos.position_id
        WHERE p.salary_period = :period
    """
    params = {"period": period}
    roles = current_user.get("roles", [])

    # Nhân viên thông thường chỉ xem bảng lương của mình (Rubric III.3.2.3)
    if "ADMIN" not in roles and "HR_MANAGER" not in roles:
        query += " AND p.employee_id = :emp_id"
        params["emp_id"] = current_user.get("employee_id")
    elif employee_id:
        query += " AND p.employee_id = :emp_id"
        params["emp_id"] = employee_id

    query += " ORDER BY p.payroll_id ASC"
    res = await db.execute(text(query), params)
    payrolls = res.mappings().all()

    # Nạp chi tiết payroll_details cho từng bảng lương
    result = []
    for pr in payrolls:
        pr_dict = dict(pr)
        det_res = await db.execute(text("""
            SELECT detail_id, item_code, item_name, item_type, calculation_formula, amount, notes
            FROM payroll_details WHERE payroll_id = :pid
        """), {"pid": pr["payroll_id"]})
        pr_dict["details"] = det_res.mappings().all()
        result.append(pr_dict)

    return result

@router.get("/{payroll_id}", response_model=PayrollOut, summary="Xem chi tiết phiếu lương tháng và giải trình công thức (Rubric III.3.2.3 & In phiếu lương III.3.2.4)")
async def get_payroll_detail(
    payroll_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    query = text("""
        SELECT p.payroll_id, p.employee_id, e.employee_code, e.full_name as employee_name,
               s.store_name, pos.position_name, p.salary_period,
               p.standard_working_days, p.actual_working_days, p.paid_leave_days, p.unpaid_leave_days,
               p.unworked_hours, p.time_deduction_amount,
               p.contract_salary, p.actual_base_salary, p.overtime_salary,
               p.position_allowance, p.seniority_allowance, p.project_allowance,
               p.meal_transport_allowance, p.commission_amount, p.bonus_amount,
               p.holiday_bonus, p.productivity_bonus,
               p.gross_income, p.bhxh_amount, p.bhyt_amount, p.bhtn_amount,
               p.total_insurance, p.personal_income_tax, p.penalty_deduction, p.total_deduction,
               p.net_salary, p.payment_status, p.payment_date
        FROM payrolls p
        JOIN employees e ON p.employee_id = e.employee_id
        LEFT JOIN stores s ON e.store_id = s.store_id
        JOIN positions pos ON e.position_id = pos.position_id
        WHERE p.payroll_id = :pid
    """)
    res = await db.execute(query, {"pid": payroll_id})
    pr = res.mappings().first()
    if not pr:
        raise HTTPException(status_code=404, detail="Không tìm thấy bảng lương")

    roles = current_user.get("roles", [])
    if "ADMIN" not in roles and "HR_MANAGER" not in roles:
        if pr["employee_id"] != current_user.get("employee_id"):
            raise HTTPException(status_code=403, detail="Bạn không thể xem phiếu lương của người khác")

    pr_dict = dict(pr)
    det_res = await db.execute(text("""
        SELECT detail_id, item_code, item_name, item_type, calculation_formula, amount, notes
        FROM payroll_details WHERE payroll_id = :pid
    """), {"pid": payroll_id})
    pr_dict["details"] = det_res.mappings().all()

    return pr_dict

@router.post("/calculate", summary="Chốt công và tự động chạy bảng tính lương toàn chuỗi (Rubric III.3.1.7)")
async def calculate_payroll(
    req: CalculatePayrollRequest,
    current_user: dict = Depends(require_roles(["HR_MANAGER", "ADMIN"])),
    db: AsyncSession = Depends(get_db)
):
    hr_id = current_user.get("employee_id") or 2
    period = req.salary_period

    # 1. Gọi stored procedure tính hoa hồng bán lẻ
    await db.execute(text("CALL sp_calculate_monthly_commission(:period)"), {"period": period})

    # Dọn dẹp bản ghi cũ nếu tính lại để tránh lỗi unique constraint
    await db.execute(text("DELETE FROM payroll_details WHERE payroll_id IN (SELECT payroll_id FROM payrolls WHERE salary_period = :period)"), {"period": period})
    await db.execute(text("DELETE FROM payrolls WHERE salary_period = :period"), {"period": period})

    # 2. Gọi stored procedure tự động tạo bảng lương
    await db.execute(text("CALL sp_generate_monthly_payroll(:period, :hr_id)"), {"period": period, "hr_id": hr_id})

    await db.commit()
    return {
        "message": f"Tính toán bảng lương kỳ {period} thành công!",
        "salary_period": period
    }

@router.get("/annual-summary/{employee_id}", summary="Bảng in tổng hợp thu nhập theo năm của nhân sự (Rubric III.3.2.5)")
async def get_annual_salary(
    employee_id: int,
    year: Optional[str] = Query("2026", description="Năm thống kê (YYYY)"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    roles = current_user.get("roles", [])
    if "ADMIN" not in roles and "HR_MANAGER" not in roles:
        if employee_id != current_user.get("employee_id"):
            raise HTTPException(status_code=403, detail="Bạn chỉ có thể xem báo cáo thu nhập năm của chính mình")

    res = await db.execute(text("""
        SELECT * FROM v_annual_salary_summary
        WHERE employee_id = :eid AND salary_year = :year
    """), {"eid": employee_id, "year": year})
    row = res.mappings().first()
    if not row:
        return {"message": "Chưa có dữ liệu bảng lương trong năm này", "employee_id": employee_id, "salary_year": year}
    return row

@router.post("/sales-records", summary="Ghi nhận doanh số bán lẻ thiết bị công nghệ (Week 3.1)")
async def record_sales(
    req: SalesRecordCreate,
    current_user: dict = Depends(require_roles(["STORE_MANAGER", "HR_MANAGER", "ADMIN"])),
    db: AsyncSession = Depends(get_db)
):
    await db.execute(text("""
        INSERT INTO employee_sales (
            employee_id, store_id, salary_period,
            phone_revenue, laptop_revenue, accessory_revenue, target_kpi
        ) VALUES (
            :emp_id, :store_id, :period,
            :phone, :laptop, :acc, :kpi
        )
        ON CONFLICT (employee_id, salary_period)
        DO UPDATE SET phone_revenue = EXCLUDED.phone_revenue,
                      laptop_revenue = EXCLUDED.laptop_revenue,
                      accessory_revenue = EXCLUDED.accessory_revenue,
                      target_kpi = EXCLUDED.target_kpi;
    """), {
        "emp_id": req.employee_id, "store_id": req.store_id,
        "period": req.salary_period, "phone": req.phone_revenue,
        "laptop": req.laptop_revenue, "acc": req.accessory_revenue,
        "kpi": req.target_kpi
    })
    # Tự động cập nhật hoa hồng cho kỳ này
    await db.execute(text("CALL sp_calculate_monthly_commission(:period)"), {"period": req.salary_period})
    await db.commit()
    return {
        "message": "Ghi nhận doanh số bán lẻ và cập nhật hoa hồng thành công!",
        "employee_id": req.employee_id,
        "salary_period": req.salary_period
    }

@router.get("/commissions/calculate/{month}", summary="Tính hoa hồng và xem kết quả theo tháng (Week 3.1)")
async def calculate_commissions_endpoint(
    month: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    await db.execute(text("CALL sp_calculate_monthly_commission(:period)"), {"period": month})
    await db.commit()
    res = await db.execute(text("""
        SELECT c.*, e.full_name as employee_name, e.employee_code,
               es.phone_revenue, es.laptop_revenue, es.accessory_revenue, es.total_revenue, es.kpi_achievement_rate
        FROM commissions c
        JOIN employees e ON c.employee_id = e.employee_id
        JOIN employee_sales es ON c.sale_record_id = es.sale_record_id
        WHERE c.salary_period = :period
        ORDER BY c.commission_id ASC
    """), {"period": month})
    return res.mappings().all()

@router.get("/generate/{month}", summary="Chốt và tự động tính bảng lương tháng (Week 3.2)")
@router.post("/generate/{month}", summary="Chốt và tự động tính bảng lương tháng (Week 3.2)")
async def generate_payroll_month(
    month: str,
    current_user: dict = Depends(require_roles(["HR_MANAGER", "ADMIN"])),
    db: AsyncSession = Depends(get_db)
):
    hr_id = current_user.get("employee_id") or 2
    await db.execute(text("CALL sp_calculate_monthly_commission(:period)"), {"period": month})
    await db.execute(text("DELETE FROM payroll_details WHERE payroll_id IN (SELECT payroll_id FROM payrolls WHERE salary_period = :period)"), {"period": month})
    await db.execute(text("DELETE FROM payrolls WHERE salary_period = :period"), {"period": month})
    await db.execute(text("CALL sp_generate_monthly_payroll(:period, :hr_id)"), {"period": month, "hr_id": hr_id})
    await db.commit()
    return await list_payrolls(period=month, employee_id=None, current_user=current_user, db=db)

@router.get("/projects/list", summary="Danh sách dự án và phụ cấp thành viên tham gia (Phụ cấp theo dự án)")
async def list_projects_with_allowances(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    res_proj = await db.execute(text("SELECT * FROM projects ORDER BY project_id ASC"))
    projects = res_proj.mappings().all()
    result = []
    for p in projects:
        p_dict = dict(p)
        res_mem = await db.execute(text("""
            SELECT pm.*, e.employee_code, e.full_name as employee_name, pos.position_name
            FROM project_members pm
            JOIN employees e ON pm.employee_id = e.employee_id
            JOIN positions pos ON e.position_id = pos.position_id
            WHERE pm.project_id = :pid
            ORDER BY pm.project_member_id ASC
        """), {"pid": p["project_id"]})
        p_dict["members"] = res_mem.mappings().all()
        result.append(p_dict)
    return result

