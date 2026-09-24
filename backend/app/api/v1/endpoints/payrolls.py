import io
import csv
from datetime import date, datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.database import get_db
from app.api.deps import get_current_user, require_roles
from app.core.vietnamese_number import currency_to_vietnamese_words
from app.core.excel_exporter import create_styled_excel
from app.schemas.schemas import (
    PayrollOut, PayrollDetailOut, CalculatePayrollRequest,
    SalesRecordCreate, SalesRecordOut, SalesRecordUpdate,
    CommissionOut, PayrollStatusUpdate, BatchPayrollStatusRequest,
    ProjectCreate, ProjectUpdate, ProjectMemberCreate, ProjectMemberUpdate,
    ProjectOut, ProjectMemberOut
)

router = APIRouter()

# ===================================================================================
# 1. PAYROLL LIST (PHÂN HỆ 8 - QUẢN LÝ TIỀN LƯƠNG & CHỐT LƯƠNG)
# ===================================================================================

@router.get("", response_model=List[PayrollOut], summary="Danh sách bảng lương theo kỳ tháng (Rubric III.3.1.7)")
async def list_payrolls(
    period: Optional[str] = Query("2026-09", description="Kỳ lương (YYYY-MM)"),
    employee_id: Optional[int] = Query(None, description="Lọc theo mã nhân viên"),
    store_id: Optional[int] = Query(None, description="Lọc theo cửa hàng"),
    payment_status: Optional[str] = Query(None, description="Lọc theo trạng thái: DRAFT, CONFIRMED, PAID"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Lấy danh sách bảng lương theo kỳ.
    - ADMIN, HR_MANAGER: Xem toàn chuỗi, lọc linh hoạt theo store, employee, status.
    - STORE_MANAGER: Tự động giới hạn theo cửa hàng do mình phụ trách.
    - EMPLOYEE: Chỉ xem bảng lương của chính mình (Rubric III.3.2.3).
    """
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

    if "ADMIN" in roles or "HR_MANAGER" in roles:
        if store_id:
            query += " AND e.store_id = :store_id"
            params["store_id"] = store_id
        if employee_id:
            query += " AND p.employee_id = :emp_id"
            params["emp_id"] = employee_id
    elif "STORE_MANAGER" in roles:
        user_store_id = current_user.get("store_id")
        if user_store_id:
            query += " AND e.store_id = :mgr_store_id"
            params["mgr_store_id"] = user_store_id
        if employee_id:
            query += " AND p.employee_id = :emp_id"
            params["emp_id"] = employee_id
    else:
        user_emp_id = current_user.get("employee_id")
        query += " AND p.employee_id = :self_emp_id"
        params["self_emp_id"] = user_emp_id

    if payment_status:
        query += " AND p.payment_status = :status"
        params["status"] = payment_status

    query += " ORDER BY p.payroll_id ASC"
    res = await db.execute(text(query), params)
    payrolls = res.mappings().all()

    result = []
    for pr in payrolls:
        pr_dict = dict(pr)
        det_res = await db.execute(text("""
            SELECT detail_id, item_code, item_name, item_type, calculation_formula, amount, notes
            FROM payroll_details WHERE payroll_id = :pid
            ORDER BY detail_id ASC
        """), {"pid": pr["payroll_id"]})
        pr_dict["details"] = det_res.mappings().all()
        result.append(pr_dict)

    return result


# ===================================================================================
# 2. PAYROLL CALCULATION ENGINE & BATCH WORKFLOW
# ===================================================================================

@router.post("/calculate", summary="Chốt công và tự động tính bảng lương toàn chuỗi (Rubric III.3.1.7)")
async def calculate_payroll(
    req: CalculatePayrollRequest,
    current_user: dict = Depends(require_roles(["HR_MANAGER", "ADMIN"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Chạy Stored Procedure tính lương tự động cho toàn bộ nhân sự chuỗi TechZone:
    1. Gọi sp_calculate_monthly_commission: Tính hoa hồng 1% ĐT/Laptop + 3% Phụ kiện + Thưởng nóng KPI.
    2. Dọn dẹp bản ghi cũ nếu tính lại để đảm bảo tính idempotent.
    3. Gọi sp_generate_monthly_payroll: Tính lương trừ thời gian, 3 phụ cấp, 2 thưởng, bảo hiểm 10.5%.
    4. Tự động sinh 12 dòng giải trình cấu phần chi tiết vào payroll_details.
    """
    hr_id = current_user.get("employee_id") or 2
    period = req.salary_period

    # 1. Tính hoa hồng trước
    await db.execute(text("CALL sp_calculate_monthly_commission(:period)"), {"period": period})

    # Dọn dẹp các chi tiết và bảng lương của kỳ này trước khi chốt lại
    await db.execute(text("""
        DELETE FROM payroll_details 
        WHERE payroll_id IN (SELECT payroll_id FROM payrolls WHERE salary_period = :period)
    """), {"period": period})
    await db.execute(text("DELETE FROM payrolls WHERE salary_period = :period"), {"period": period})

    # 2. Gọi Stored Procedure chính
    await db.execute(text("CALL sp_generate_monthly_payroll(:period, :hr_id)"), {"period": period, "hr_id": hr_id})
    await db.commit()

    count_res = await db.execute(text("SELECT count(*), COALESCE(SUM(gross_income), 0), COALESCE(SUM(net_salary), 0) FROM payrolls WHERE salary_period = :period"), {"period": period})
    total_count, total_gross, total_net = count_res.first()

    return {
        "message": f"Chốt công và tính toán bảng lương kỳ {period} thành công!",
        "salary_period": period,
        "total_employees_calculated": total_count,
        "total_gross_income": float(total_gross),
        "total_net_salary": float(total_net)
    }


@router.get("/generate/{month}", summary="Chốt và tự động tính bảng lương tháng (Week 3.2)")
@router.post("/generate/{month}", summary="Chốt và tự động tính bảng lương tháng (Week 3.2)")
async def generate_payroll_month(
    month: str,
    current_user: dict = Depends(require_roles(["HR_MANAGER", "ADMIN"])),
    db: AsyncSession = Depends(get_db)
):
    """Alias nhanh cho quy trình tính bảng lương tháng và trả về danh sách kết quả"""
    await calculate_payroll(req=CalculatePayrollRequest(salary_period=month), current_user=current_user, db=db)
    return await list_payrolls(period=month, employee_id=None, store_id=None, payment_status=None, current_user=current_user, db=db)


@router.post("/confirm-all", summary="Duyệt chốt toàn bộ bảng lương trong kỳ (DRAFT -> CONFIRMED)")
async def confirm_all_payrolls(
    req: BatchPayrollStatusRequest,
    current_user: dict = Depends(require_roles(["HR_MANAGER", "ADMIN"])),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(text("""
        UPDATE payrolls
        SET payment_status = 'CONFIRMED', updated_at = CURRENT_TIMESTAMP
        WHERE salary_period = :period AND payment_status = 'DRAFT'
        RETURNING payroll_id
    """), {"period": req.salary_period})
    updated_ids = [r[0] for r in res.all()]
    await db.commit()
    return {
        "message": f"Đã duyệt chính thức {len(updated_ids)} phiếu lương kỳ {req.salary_period}!",
        "confirmed_count": len(updated_ids),
        "salary_period": req.salary_period
    }


@router.post("/pay-all", summary="Xác nhận chi trả toàn bộ bảng lương trong kỳ (CONFIRMED -> PAID)")
async def pay_all_payrolls(
    req: BatchPayrollStatusRequest,
    current_user: dict = Depends(require_roles(["HR_MANAGER", "ADMIN"])),
    db: AsyncSession = Depends(get_db)
):
    pay_date = req.payment_date or date.today()
    res = await db.execute(text("""
        UPDATE payrolls
        SET payment_status = 'PAID', payment_date = :p_date, updated_at = CURRENT_TIMESTAMP
        WHERE salary_period = :period AND payment_status IN ('DRAFT', 'CONFIRMED')
        RETURNING payroll_id
    """), {"period": req.salary_period, "p_date": pay_date})
    updated_ids = [r[0] for r in res.all()]
    await db.commit()
    return {
        "message": f"Đã hoàn tất thanh toán chuyển khoản cho {len(updated_ids)} nhân viên kỳ {req.salary_period}!",
        "paid_count": len(updated_ids),
        "payment_date": str(pay_date)
    }


@router.get("/annual-summary/{employee_id}", summary="Bảng in tổng hợp thu nhập năm của nhân sự (Rubric III.3.2.5)")
async def get_annual_salary(
    employee_id: int,
    year: Optional[str] = Query("2026", description="Năm thống kê (YYYY)"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Truy vấn View v_annual_salary_summary:
    Tổng hợp thu nhập 12 tháng phục vụ quyết toán thuế TNCN và in phiếu lương năm A4.
    """
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
        return {
            "message": "Chưa có dữ liệu bảng lương trong năm này",
            "employee_id": employee_id,
            "salary_year": year
        }
    
    row_dict = dict(row)
    row_dict["net_salary_in_words"] = currency_to_vietnamese_words(float(row_dict.get("total_net_salary_year") or 0))
    return row_dict


# ===================================================================================
# 3. SALES RECORDS & COMMISSIONS (PHÂN HỆ 6 - DOANH SỐ & HOA HỒNG BÁN LẺ)
# ===================================================================================

@router.get("/sales-records/me", summary="Doanh số cá nhân của nhân viên đang đăng nhập (Employee Self-Service)")
async def get_my_sales_record(
    period: Optional[str] = Query("2026-09", description="Kỳ doanh số (YYYY-MM)"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    emp_id = current_user.get("employee_id")
    if not emp_id:
        raise HTTPException(status_code=400, detail="Tài khoản chưa được liên kết với hồ sơ nhân viên")

    res = await db.execute(text("""
        SELECT es.*, e.full_name as employee_name, e.employee_code, s.store_name
        FROM employee_sales es
        JOIN employees e ON es.employee_id = e.employee_id
        LEFT JOIN stores s ON es.store_id = s.store_id
        WHERE es.salary_period = :period AND es.employee_id = :emp_id
    """), {"period": period, "emp_id": emp_id})
    row = res.mappings().first()
    if not row:
        return {
            "message": "Chưa có dữ liệu doanh số trong kỳ này",
            "employee_id": emp_id,
            "salary_period": period,
            "total_revenue": 0,
            "kpi_achievement_rate": 0
        }
    return row


@router.get("/sales-records", response_model=List[SalesRecordOut], summary="Danh sách doanh số bán lẻ theo kỳ tháng")
async def list_sales_records(
    period: Optional[str] = Query("2026-09", description="Kỳ doanh số (YYYY-MM)"),
    store_id: Optional[int] = Query(None, description="Lọc theo cửa hàng"),
    employee_id: Optional[int] = Query(None, description="Lọc theo nhân viên"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    query = """
        SELECT es.*, e.full_name as employee_name, e.employee_code, s.store_name
        FROM employee_sales es
        JOIN employees e ON es.employee_id = e.employee_id
        LEFT JOIN stores s ON es.store_id = s.store_id
        WHERE es.salary_period = :period
    """
    params = {"period": period}
    roles = current_user.get("roles", [])

    if "ADMIN" in roles or "HR_MANAGER" in roles:
        if store_id:
            query += " AND es.store_id = :store_id"
            params["store_id"] = store_id
        if employee_id:
            query += " AND es.employee_id = :emp_id"
            params["emp_id"] = employee_id
    elif "STORE_MANAGER" in roles:
        user_store_id = current_user.get("store_id")
        if user_store_id:
            query += " AND es.store_id = :mgr_store_id"
            params["mgr_store_id"] = user_store_id
        if employee_id:
            query += " AND es.employee_id = :emp_id"
            params["emp_id"] = employee_id
    else:
        query += " AND es.employee_id = :self_emp_id"
        params["self_emp_id"] = current_user.get("employee_id")

    query += " ORDER BY es.total_revenue DESC"
    res = await db.execute(text(query), params)
    return res.mappings().all()


@router.post("/sales-records", response_model=SalesRecordOut, summary="Ghi nhận doanh số bán lẻ thiết bị công nghệ (Week 3.1)")
async def record_sales(
    req: SalesRecordCreate,
    current_user: dict = Depends(require_roles(["STORE_MANAGER", "HR_MANAGER", "ADMIN"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Ghi nhận doanh số bán lẻ 3 ngành hàng (Điện thoại, Laptop, Phụ kiện) kèm KPI mục tiêu.
    Hệ thống tự động kích hoạt Stored Procedure tính hoa hồng.
    """
    res = await db.execute(text("""
        INSERT INTO employee_sales (
            employee_id, store_id, salary_period,
            phone_revenue, laptop_revenue, accessory_revenue, target_kpi
        ) VALUES (
            :emp_id, :store_id, :period,
            :phone, :laptop, :acc, :kpi
        )
        ON CONFLICT (employee_id, salary_period)
        DO UPDATE SET store_id = EXCLUDED.store_id,
                      phone_revenue = EXCLUDED.phone_revenue,
                      laptop_revenue = EXCLUDED.laptop_revenue,
                      accessory_revenue = EXCLUDED.accessory_revenue,
                      target_kpi = EXCLUDED.target_kpi
        RETURNING sale_record_id, employee_id, store_id, salary_period,
                  phone_revenue, laptop_revenue, accessory_revenue,
                  total_revenue, target_kpi, kpi_achievement_rate;
    """), {
        "emp_id": req.employee_id, "store_id": req.store_id,
        "period": req.salary_period, "phone": req.phone_revenue,
        "laptop": req.laptop_revenue, "acc": req.accessory_revenue,
        "kpi": req.target_kpi
    })
    row = res.mappings().first()

    # Tự động cập nhật hoa hồng cho kỳ này
    await db.execute(text("CALL sp_calculate_monthly_commission(:period)"), {"period": req.salary_period})
    await db.commit()

    emp_name = (await db.execute(text("SELECT full_name FROM employees WHERE employee_id = :eid"), {"eid": req.employee_id})).scalar()

    record_dict = dict(row)
    record_dict["employee_name"] = emp_name
    return record_dict


@router.get("/commissions/me", summary="Hoa hồng của tôi trong kỳ (Employee Self-Service)")
async def get_my_commission(
    period: Optional[str] = Query("2026-09", description="Kỳ hoa hồng (YYYY-MM)"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    emp_id = current_user.get("employee_id")
    if not emp_id:
        raise HTTPException(status_code=400, detail="Tài khoản chưa được liên kết với hồ sơ nhân viên")

    res = await db.execute(text("""
        SELECT c.*, e.full_name as employee_name, e.employee_code,
               es.phone_revenue, es.laptop_revenue, es.accessory_revenue, es.total_revenue, es.kpi_achievement_rate
        FROM commissions c
        JOIN employees e ON c.employee_id = e.employee_id
        JOIN employee_sales es ON c.sale_record_id = es.sale_record_id
        WHERE c.salary_period = :period AND c.employee_id = :emp_id
    """), {"period": period, "emp_id": emp_id})
    row = res.mappings().first()
    if not row:
        return {"message": "Chưa có hoa hồng trong kỳ này", "employee_id": emp_id, "commission_amount": 0}
    return row


@router.get("/commissions/calculate/{month}", response_model=List[CommissionOut], summary="Chạy tính hoa hồng và trả về kết quả theo tháng (Week 3.1)")
async def calculate_commissions_endpoint(
    month: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    await db.execute(text("CALL sp_calculate_monthly_commission(:period)"), {"period": month})
    await db.commit()
    return await list_commissions(period=month, store_id=None, employee_id=None, current_user=current_user, db=db)


@router.get("/commissions", response_model=List[CommissionOut], summary="Danh sách hoa hồng bán lẻ toàn chuỗi theo tháng")
async def list_commissions(
    period: Optional[str] = Query("2026-09", description="Kỳ hoa hồng (YYYY-MM)"),
    store_id: Optional[int] = Query(None, description="Lọc theo cửa hàng"),
    employee_id: Optional[int] = Query(None, description="Lọc theo nhân viên"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    query = """
        SELECT c.*, e.full_name as employee_name, e.employee_code,
               es.phone_revenue, es.laptop_revenue, es.accessory_revenue, es.total_revenue, es.kpi_achievement_rate
        FROM commissions c
        JOIN employees e ON c.employee_id = e.employee_id
        JOIN employee_sales es ON c.sale_record_id = es.sale_record_id
        WHERE c.salary_period = :period
    """
    params = {"period": period}
    roles = current_user.get("roles", [])

    if "ADMIN" in roles or "HR_MANAGER" in roles:
        if store_id:
            query += " AND es.store_id = :store_id"
            params["store_id"] = store_id
        if employee_id:
            query += " AND c.employee_id = :emp_id"
            params["emp_id"] = employee_id
    elif "STORE_MANAGER" in roles:
        user_store_id = current_user.get("store_id")
        if user_store_id:
            query += " AND es.store_id = :mgr_store_id"
            params["mgr_store_id"] = user_store_id
    else:
        query += " AND c.employee_id = :self_emp_id"
        params["self_emp_id"] = current_user.get("employee_id")

    query += " ORDER BY c.commission_amount DESC"
    res = await db.execute(text(query), params)
    return res.mappings().all()


# ===================================================================================
# 4. PROJECTS & PROJECT ALLOWANCES (PHÂN HỆ 7 - DỰ ÁN & PHỤ CẤP DỰ ÁN)
# ===================================================================================

@router.get("/projects/list", response_model=List[ProjectOut], summary="Danh sách dự án và phụ cấp thành viên (Week 3.2 & Rubric III.3.1.7)")
async def list_projects_with_allowances(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Lấy danh sách tất cả các dự án kèm danh sách nhân viên tham gia và mức phụ cấp dự án project_allowance.
    """
    res_proj = await db.execute(text("SELECT * FROM projects ORDER BY project_id ASC"))
    projects = res_proj.mappings().all()
    result = []
    for p in projects:
        p_dict = dict(p)
        res_mem = await db.execute(text("""
            SELECT pm.project_member_id, pm.project_id, pm.employee_id, pm.project_role,
                   pm.project_allowance, pm.joined_date, pm.left_date, pm.is_active,
                   e.employee_code, e.full_name as employee_name, pos.position_name
            FROM project_members pm
            JOIN employees e ON pm.employee_id = e.employee_id
            JOIN positions pos ON e.position_id = pos.position_id
            WHERE pm.project_id = :pid
            ORDER BY pm.project_member_id ASC
        """), {"pid": p["project_id"]})
        p_dict["members"] = res_mem.mappings().all()
        result.append(p_dict)
    return result


@router.post("/projects", summary="Tạo dự án mới (Admin / HR)")
async def create_project(
    req: ProjectCreate,
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    try:
        res = await db.execute(text("""
            INSERT INTO projects (project_code, project_name, description, start_date, end_date, status, budget)
            VALUES (:code, :name, :desc, :s_date, :e_date, :status, :budget)
            RETURNING *
        """), {
            "code": req.project_code, "name": req.project_name, "desc": req.description,
            "s_date": req.start_date, "e_date": req.end_date, "status": req.status or "IN_PROGRESS",
            "budget": req.budget or 0
        })
        row = res.mappings().first()
        await db.commit()
        return {"message": "Tạo dự án thành công!", "project": dict(row)}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"Lỗi tạo dự án: {str(e)}")


@router.put("/projects/members/{member_id}", summary="Cập nhật phụ cấp hoặc vai trò thành viên dự án")
async def update_project_member(
    member_id: int,
    req: ProjectMemberUpdate,
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    updates = []
    params = {"mid": member_id}
    if req.project_role is not None:
        updates.append("project_role = :role")
        params["role"] = req.project_role
    if req.project_allowance is not None:
        updates.append("project_allowance = :allowance")
        params["allowance"] = req.project_allowance
    if req.left_date is not None:
        updates.append("left_date = :l_date")
        params["l_date"] = req.left_date
    if req.is_active is not None:
        updates.append("is_active = :active")
        params["active"] = req.is_active

    if not updates:
        raise HTTPException(status_code=400, detail="Không có thông tin cần cập nhật")

    query = f"UPDATE project_members SET {', '.join(updates)} WHERE project_member_id = :mid RETURNING *"
    res = await db.execute(text(query), params)
    row = res.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Không tìm thấy thành viên dự án")
    await db.commit()
    return {"message": "Cập nhật thành viên dự án thành công!", "member": dict(row)}


@router.delete("/projects/members/{member_id}", summary="Xóa thành viên khỏi dự án")
async def remove_project_member(
    member_id: int,
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(text("DELETE FROM project_members WHERE project_member_id = :mid RETURNING project_member_id"), {"mid": member_id})
    row = res.first()
    if not row:
        raise HTTPException(status_code=404, detail="Không tìm thấy bản ghi")
    await db.commit()
    return {"message": f"Đã xóa thành viên #{member_id} khỏi dự án!"}


@router.put("/projects/{project_id}", summary="Cập nhật thông tin dự án (Admin / HR)")
async def update_project(
    project_id: int,
    req: ProjectUpdate,
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    updates = []
    params = {"pid": project_id}
    if req.project_name is not None:
        updates.append("project_name = :p_name")
        params["p_name"] = req.project_name
    if req.description is not None:
        updates.append("description = :p_desc")
        params["p_desc"] = req.description
    if req.start_date is not None:
        updates.append("start_date = :s_date")
        params["s_date"] = req.start_date
    if req.end_date is not None:
        updates.append("end_date = :e_date")
        params["e_date"] = req.end_date
    if req.status is not None:
        updates.append("status = :status")
        params["status"] = req.status
    if req.budget is not None:
        updates.append("budget = :budget")
        params["budget"] = req.budget

    if not updates:
        raise HTTPException(status_code=400, detail="Không có thông tin cần cập nhật")

    query = f"UPDATE projects SET {', '.join(updates)} WHERE project_id = :pid RETURNING *"
    res = await db.execute(text(query), params)
    row = res.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Không tìm thấy dự án")
    await db.commit()
    return {"message": "Cập nhật dự án thành công!", "project": dict(row)}


@router.delete("/projects/{project_id}", summary="Xóa dự án (Admin)")
async def delete_project(
    project_id: int,
    current_user: dict = Depends(require_roles(["ADMIN"])),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(text("DELETE FROM projects WHERE project_id = :pid RETURNING project_id"), {"pid": project_id})
    row = res.first()
    if not row:
        raise HTTPException(status_code=404, detail="Không tìm thấy dự án")
    await db.commit()
    return {"message": f"Đã xóa dự án #{project_id} thành công!"}


@router.post("/projects/{project_id}/members", summary="Gán nhân viên vào dự án kèm phụ cấp dự án hàng tháng")
async def add_project_member(
    project_id: int,
    req: ProjectMemberCreate,
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Thêm nhân viên vào dự án với mức phụ cấp project_allowance (VD: 1.000.000đ - 2.500.000đ/tháng).
    Mức phụ cấp này được cộng tự động vào lương hàng tháng khi chạy chốt lương.
    """
    try:
        res = await db.execute(text("""
            INSERT INTO project_members (project_id, employee_id, project_role, project_allowance, joined_date, left_date, is_active)
            VALUES (:pid, :eid, :role, :allowance, :j_date, :l_date, :active)
            ON CONFLICT (project_id, employee_id)
            DO UPDATE SET project_role = EXCLUDED.project_role,
                          project_allowance = EXCLUDED.project_allowance,
                          is_active = EXCLUDED.is_active,
                          left_date = EXCLUDED.left_date
            RETURNING *
        """), {
            "pid": project_id, "eid": req.employee_id, "role": req.project_role or "MEMBER",
            "allowance": req.project_allowance or 0, "j_date": req.joined_date,
            "l_date": req.left_date, "active": req.is_active if req.is_active is not None else True
        })
        row = res.mappings().first()
        await db.commit()
        return {"message": "Gán thành viên vào dự án thành công!", "member": dict(row)}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"Lỗi gán thành viên dự án: {str(e)}")


# ===================================================================================
# 5. EXPORT PAYROLL DATA (XUẤT EXCEL & CSV BẢNG LƯƠNG)
# ===================================================================================

@router.get("/export/excel", summary="Xuất bảng lương tháng ra file Excel (.xlsx) chuẩn TechZone (Rubric III.3.1.7)")
async def export_payroll_excel(
    period: Optional[str] = Query("2026-09", description="Kỳ lương (YYYY-MM)"),
    store_id: Optional[int] = Query(None, description="Lọc theo cửa hàng"),
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    payrolls = await list_payrolls(period=period, employee_id=None, store_id=store_id, payment_status=None, current_user=current_user, db=db)
    if not payrolls:
        raise HTTPException(status_code=404, detail=f"Không có dữ liệu bảng lương trong kỳ {period}")

    columns = [
        {"key": "employee_code", "title": "Mã NV", "width": 12, "align": "center"},
        {"key": "employee_name", "title": "Họ và Tên", "width": 24},
        {"key": "store_name", "title": "Cửa hàng / Đơn vị", "width": 20},
        {"key": "position_name", "title": "Chức vụ", "width": 18},
        {"key": "standard_working_days", "title": "Công chuẩn", "width": 12, "format": "number"},
        {"key": "actual_working_days", "title": "Công thực tế", "width": 12, "format": "number"},
        {"key": "contract_salary", "title": "Lương HĐ", "width": 16, "format": "currency"},
        {"key": "time_deduction_amount", "title": "Trừ thời gian", "width": 16, "format": "currency"},
        {"key": "actual_base_salary", "title": "Lương CB thực", "width": 16, "format": "currency"},
        {"key": "position_allowance", "title": "PC Chức vụ", "width": 14, "format": "currency"},
        {"key": "seniority_allowance", "title": "PC Thâm niên", "width": 14, "format": "currency"},
        {"key": "project_allowance", "title": "PC Dự án", "width": 14, "format": "currency"},
        {"key": "meal_transport_allowance", "title": "PC Cơm xe", "width": 14, "format": "currency"},
        {"key": "commission_amount", "title": "Hoa hồng", "width": 16, "format": "currency"},
        {"key": "bonus_amount", "title": "Tổng thưởng", "width": 16, "format": "currency"},
        {"key": "gross_income", "title": "Tổng Gross", "width": 18, "format": "currency"},
        {"key": "total_insurance", "title": "Bảo hiểm (10.5%)", "width": 16, "format": "currency"},
        {"key": "penalty_deduction", "title": "Phạt trễ", "width": 14, "format": "currency"},
        {"key": "total_deduction", "title": "Tổng giảm trừ", "width": 16, "format": "currency"},
        {"key": "net_salary", "title": "THỰC LĨNH (NET)", "width": 20, "format": "currency"},
        {"key": "payment_status", "title": "Trạng thái", "width": 14, "align": "center"}
    ]

    total_keys = [
        "contract_salary", "time_deduction_amount", "actual_base_salary",
        "position_allowance", "seniority_allowance", "project_allowance",
        "meal_transport_allowance", "commission_amount", "bonus_amount",
        "gross_income", "total_insurance", "total_deduction", "net_salary"
    ]

    excel_data = [p if isinstance(p, dict) else p.model_dump() for p in payrolls]
    file_stream = create_styled_excel(
        title=f"BẢNG LƯƠNG NHÂN SỰ TOÀN CHUỖI - KỲ {period}",
        subtitle=f"Thời điểm xuất báo cáo: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')} - Đơn vị tiền tệ: VNĐ",
        columns=columns,
        data=excel_data,
        include_totals=True,
        total_keys=total_keys
    )

    filename = f"Bang_Luong_TechZone_{period}.xlsx"
    return StreamingResponse(
        file_stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.get("/export/csv", summary="Xuất bảng lương tháng ra file CSV (UTF-8 BOM)")
async def export_payroll_csv(
    period: Optional[str] = Query("2026-09", description="Kỳ lương (YYYY-MM)"),
    store_id: Optional[int] = Query(None, description="Lọc theo cửa hàng"),
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    payrolls = await list_payrolls(period=period, employee_id=None, store_id=store_id, payment_status=None, current_user=current_user, db=db)
    if not payrolls:
        raise HTTPException(status_code=404, detail=f"Không có dữ liệu bảng lương trong kỳ {period}")

    output = io.StringIO()
    output.write('\ufeff')
    writer = csv.writer(output)
    writer.writerow([
        "Mã NV", "Họ và Tên", "Cửa hàng", "Chức vụ", "Kỳ lương",
        "Lương HĐ", "Trừ thời gian", "Lương CB thực", "Phụ cấp CV",
        "Phụ cấp Thâm niên", "Phụ cấp Dự án", "Phụ cấp Cơm xe", "Hoa hồng",
        "Tổng thưởng", "Lương Gross", "Bảo hiểm 10.5%", "Phạt trễ", "Tổng khấu trừ",
        "Thực lĩnh Net", "Trạng thái"
    ])

    for p in payrolls:
        p_dict = p if isinstance(p, dict) else p.model_dump()
        writer.writerow([
            p_dict.get("employee_code"), p_dict.get("employee_name"), p_dict.get("store_name") or "Trụ sở",
            p_dict.get("position_name"), p_dict.get("salary_period"),
            p_dict.get("contract_salary"), p_dict.get("time_deduction_amount"), p_dict.get("actual_base_salary"),
            p_dict.get("position_allowance"), p_dict.get("seniority_allowance"), p_dict.get("project_allowance"),
            p_dict.get("meal_transport_allowance"), p_dict.get("commission_amount"), p_dict.get("bonus_amount"),
            p_dict.get("gross_income"), p_dict.get("total_insurance"), p_dict.get("penalty_deduction"),
            p_dict.get("total_deduction"), p_dict.get("net_salary"), p_dict.get("payment_status")
        ])

    csv_bytes = output.getvalue().encode('utf-8')
    filename = f"Bang_Luong_TechZone_{period}.csv"
    return Response(
        content=csv_bytes,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


# ===================================================================================
# 6. PAYROLL BY ID (DYNAMIC PATH PARAMETER - MUST BE AT THE BOTTOM)
# ===================================================================================

@router.get("/{payroll_id}/payslip", summary="Dữ liệu chuẩn in Phiếu lương tháng A4 có đọc số tiền bằng chữ tiếng Việt (Rubric III.3.2.4)")
async def get_printable_payslip(
    payroll_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Trả về bộ dữ liệu hoàn chỉnh để render bản in Phiếu lương A4 chuẩn hóa doanh nghiệp:
    Thông tin công ty, chi nhánh, thông tin nhân viên, tài khoản ngân hàng,
    bảng kê chi tiết thu nhập - giảm trừ, và số tiền thực lĩnh bằng chữ tiếng Việt.
    """
    res = await db.execute(text("""
        SELECT p.*, e.employee_code, e.full_name as employee_name, e.tax_code,
               e.bank_account_number, e.bank_name, e.identity_card, e.join_date,
               s.store_name, s.address as store_address, d.department_name, pos.position_name
        FROM payrolls p
        JOIN employees e ON p.employee_id = e.employee_id
        LEFT JOIN stores s ON e.store_id = s.store_id
        JOIN departments d ON e.department_id = d.department_id
        JOIN positions pos ON e.position_id = pos.position_id
        WHERE p.payroll_id = :pid
    """), {"pid": payroll_id})
    row = res.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Không tìm thấy bảng lương")

    roles = current_user.get("roles", [])
    if "ADMIN" not in roles and "HR_MANAGER" not in roles:
        if row["employee_id"] != current_user.get("employee_id"):
            raise HTTPException(status_code=403, detail="Bạn chỉ có thể in phiếu lương của chính mình")

    det_res = await db.execute(text("""
        SELECT detail_id, item_code, item_name, item_type, calculation_formula, amount, notes
        FROM payroll_details WHERE payroll_id = :pid
        ORDER BY detail_id ASC
    """), {"pid": payroll_id})
    details = det_res.mappings().all()

    earnings = [d for d in details if d["item_type"] in ("EARNING", "ALLOWANCE", "BONUS")]
    deductions = [d for d in details if d["item_type"] == "DEDUCTION"]

    net_val = float(row["net_salary"] or 0)
    net_in_words = currency_to_vietnamese_words(net_val)

    return {
        "company": {
            "name": "CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ TECH ZONE",
            "brand": "TECHZONE",
            "tax_id": "0312345678",
            "hotline": "1900 6868",
            "address": "273 An Dương Vương, Phường 3, Quận 5, TP. Hồ Chí Minh"
        },
        "payslip_title": f"PHIẾU LƯƠNG THÁNG {row['salary_period'].split('-')[1]}/{row['salary_period'].split('-')[0]}",
        "salary_period": row["salary_period"],
        "employee": {
            "employee_id": row["employee_id"],
            "employee_code": row["employee_code"],
            "full_name": row["employee_name"],
            "department_name": row["department_name"],
            "position_name": row["position_name"],
            "store_name": row["store_name"] or "Trụ sở chính",
            "bank_account": row["bank_account_number"],
            "bank_name": row["bank_name"],
            "tax_code": row["tax_code"]
        },
        "attendance_summary": {
            "standard_working_days": float(row["standard_working_days"] or 26.0),
            "actual_working_days": float(row["actual_working_days"] or 0),
            "paid_leave_days": float(row["paid_leave_days"] or 0),
            "unpaid_leave_days": float(row["unpaid_leave_days"] or 0),
            "unworked_hours": float(row["unworked_hours"] or 0)
        },
        "earnings": [dict(e) for e in earnings],
        "deductions": [dict(d) for d in deductions],
        "summary": {
            "contract_salary": float(row["contract_salary"] or 0),
            "time_deduction_amount": float(row["time_deduction_amount"] or 0),
            "actual_base_salary": float(row["actual_base_salary"] or 0),
            "gross_income": float(row["gross_income"] or 0),
            "total_insurance": float(row["total_insurance"] or 0),
            "total_deduction": float(row["total_deduction"] or 0),
            "net_salary": net_val,
            "net_salary_in_words": net_in_words,
            "payment_status": row["payment_status"],
            "payment_date": str(row["payment_date"]) if row["payment_date"] else None
        }
    }


@router.get("/{payroll_id}", response_model=PayrollOut, summary="Xem chi tiết phiếu lương tháng và giải trình công thức (Rubric III.3.2.3)")
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
        if "STORE_MANAGER" in roles:
            emp_res = await db.execute(text("SELECT store_id FROM employees WHERE employee_id = :eid"), {"eid": pr["employee_id"]})
            emp_store = emp_res.scalar()
            if emp_store != current_user.get("store_id") and pr["employee_id"] != current_user.get("employee_id"):
                raise HTTPException(status_code=403, detail="Bạn không thể xem phiếu lương của nhân viên chi nhánh khác")
        else:
            if pr["employee_id"] != current_user.get("employee_id"):
                raise HTTPException(status_code=403, detail="Bạn chỉ có thể xem phiếu lương của chính mình")

    pr_dict = dict(pr)
    det_res = await db.execute(text("""
        SELECT detail_id, item_code, item_name, item_type, calculation_formula, amount, notes
        FROM payroll_details WHERE payroll_id = :pid
        ORDER BY detail_id ASC
    """), {"pid": payroll_id})
    pr_dict["details"] = det_res.mappings().all()

    return pr_dict


@router.put("/{payroll_id}/status", summary="Cập nhật trạng thái phiếu lương (DRAFT -> CONFIRMED -> PAID)")
async def update_payroll_status(
    payroll_id: int,
    req: PayrollStatusUpdate,
    current_user: dict = Depends(require_roles(["HR_MANAGER", "ADMIN"])),
    db: AsyncSession = Depends(get_db)
):
    valid_statuses = ("DRAFT", "CONFIRMED", "PAID")
    status_val = req.payment_status.upper()
    if status_val not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Trạng thái không hợp lệ. Cho phép: {valid_statuses}")

    payment_date = req.payment_date or (date.today() if status_val == "PAID" else None)
    res = await db.execute(text("""
        UPDATE payrolls 
        SET payment_status = :status, payment_date = :p_date, updated_at = CURRENT_TIMESTAMP
        WHERE payroll_id = :pid
        RETURNING payroll_id, employee_id, salary_period, payment_status, payment_date
    """), {"status": status_val, "p_date": payment_date, "pid": payroll_id})
    row = res.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Không tìm thấy bảng lương")

    await db.commit()
    return {
        "message": f"Cập nhật trạng thái phiếu lương #{payroll_id} sang {status_val} thành công!",
        "payroll": dict(row)
    }
