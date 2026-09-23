from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.core.database import get_db
from app.api.deps import get_current_user, require_roles
from app.schemas.schemas import (
    EmployeeCreate, EmployeeUpdate, EmployeeOut,
    PromotionCreate, ContractCreate, ContractOut
)

router = APIRouter()

@router.get("", response_model=List[EmployeeOut], summary="Danh sách nhân sự chuỗi TechZone")
async def list_employees(
    store_id: Optional[int] = Query(None, description="Lọc theo chi nhánh cửa hàng"),
    department_id: Optional[int] = Query(None, description="Lọc theo phòng ban"),
    status: Optional[str] = Query(None, description="Lọc theo trạng thái"),
    search: Optional[str] = Query(None, description="Tìm theo họ tên, mã NV, SĐT"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Store Manager chỉ xem nhân viên chi nhánh mình phụ trách
    if "STORE_MANAGER" in current_user.get("roles", []) and "ADMIN" not in current_user.get("roles", []) and "HR_MANAGER" not in current_user.get("roles", []):
        store_id = current_user.get("store_id")

    base_query = """
        SELECT e.employee_id, e.employee_code, e.first_name, e.last_name, e.full_name,
               e.gender, e.dob, e.identity_card, e.phone, e.personal_email, e.company_email,
               e.permanent_address, e.current_address, e.store_id, e.department_id,
               e.position_id, e.education_level_id, e.join_date, e.employment_status,
               e.bank_account_number, e.bank_name, e.created_at,
               s.store_name, d.department_name, pos.position_name, edu.level_name as education_level_name
        FROM employees e
        LEFT JOIN stores s ON e.store_id = s.store_id
        JOIN departments d ON e.department_id = d.department_id
        JOIN positions pos ON e.position_id = pos.position_id
        JOIN education_levels edu ON e.education_level_id = edu.education_level_id
        WHERE 1=1
    """
    params = {}
    if store_id:
        base_query += " AND e.store_id = :store_id"
        params["store_id"] = store_id
    if department_id:
        base_query += " AND e.department_id = :department_id"
        params["department_id"] = department_id
    if status:
        base_query += " AND e.employment_status = :status"
        params["status"] = status
    if search:
        base_query += " AND (e.full_name ILIKE :search OR e.employee_code ILIKE :search OR e.phone ILIKE :search)"
        params["search"] = f"%{search}%"

    base_query += " ORDER BY e.employee_id ASC"

    res = await db.execute(text(base_query), params)
    return res.mappings().all()

@router.get("/metadata/lookups", summary="Danh mục tham chiếu (phòng ban, cửa hàng, chức vụ, học vấn)")
async def get_lookups(db: AsyncSession = Depends(get_db)):
    depts = (await db.execute(text("SELECT department_id, department_code, department_name FROM departments WHERE is_active = TRUE"))).mappings().all()
    stores = (await db.execute(text("SELECT store_id, store_code, store_name, district, city FROM stores WHERE is_active = TRUE"))).mappings().all()
    positions = (await db.execute(text("SELECT position_id, position_code, position_name, position_allowance FROM positions"))).mappings().all()
    edus = (await db.execute(text("SELECT education_level_id, level_code, level_name FROM education_levels"))).mappings().all()
    shifts = (await db.execute(text("SELECT shift_id, shift_code, shift_name, start_time, end_time, work_hours FROM work_shifts WHERE is_active = TRUE"))).mappings().all()

    return {
        "departments": depts,
        "stores": stores,
        "positions": positions,
        "education_levels": edus,
        "work_shifts": shifts
    }

@router.get("/{employee_id}", response_model=EmployeeOut, summary="Xem chi tiết 1 nhân sự")
async def get_employee(
    employee_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    query = text("""
        SELECT e.employee_id, e.employee_code, e.first_name, e.last_name, e.full_name,
               e.gender, e.dob, e.identity_card, e.phone, e.personal_email, e.company_email,
               e.permanent_address, e.current_address, e.store_id, e.department_id,
               e.position_id, e.education_level_id, e.join_date, e.employment_status,
               e.bank_account_number, e.bank_name, e.created_at,
               s.store_name, d.department_name, pos.position_name, edu.level_name as education_level_name
        FROM employees e
        LEFT JOIN stores s ON e.store_id = s.store_id
        JOIN departments d ON e.department_id = d.department_id
        JOIN positions pos ON e.position_id = pos.position_id
        JOIN education_levels edu ON e.education_level_id = edu.education_level_id
        WHERE e.employee_id = :employee_id;
    """)
    res = await db.execute(query, {"employee_id": employee_id})
    emp = res.mappings().first()
    if not emp:
        raise HTTPException(status_code=404, detail="Không tìm thấy nhân viên")
    return emp

@router.post("", response_model=EmployeeOut, summary="Thêm nhân sự mới (Rubric III.3.1.1)")
async def create_employee(
    emp: EmployeeCreate,
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    # Tự sinh mã nhân viên TZ-xxx nếu chưa nhập
    if not emp.employee_code:
        max_id = (await db.execute(text("SELECT COALESCE(MAX(employee_id), 0) FROM employees"))).scalar() or 0
        emp.employee_code = f"TZ-{(max_id + 1):03d}"

    # Kiểm tra trùng mã NV, CCCD, phone, email
    check_query = text("""
        SELECT employee_id FROM employees 
        WHERE employee_code = :code OR identity_card = :id_card OR phone = :phone OR company_email = :email
    """)
    res = await db.execute(check_query, {
        "code": emp.employee_code, "id_card": emp.identity_card, "phone": emp.phone, "email": emp.company_email
    })
    if res.first():
        raise HTTPException(status_code=400, detail="Mã nhân viên, CCCD, số điện thoại hoặc email công ty đã tồn tại")

    insert_query = text("""
        INSERT INTO employees (
            employee_code, first_name, last_name, gender, dob, identity_card,
            phone, personal_email, company_email, permanent_address, current_address,
            store_id, department_id, position_id, education_level_id, join_date,
            employment_status, bank_account_number, bank_name
        ) VALUES (
            :employee_code, :first_name, :last_name, :gender, :dob, :identity_card,
            :phone, :personal_email, :company_email, :permanent_address, :current_address,
            :store_id, :department_id, :position_id, :education_level_id, :join_date,
            :employment_status, :bank_account_number, :bank_name
        ) RETURNING employee_id;
    """)
    emp_data = emp.model_dump()
    basic_salary = emp_data.pop("basic_salary", 8000000.0) or 8000000.0
    emp_res = await db.execute(insert_query, emp_data)
    new_id = emp_res.scalar()

    # Tự động tạo hợp đồng lao động ban đầu
    contract_num = f"HDLD-{emp.employee_code}-2026"
    await db.execute(text("""
        INSERT INTO contracts (
            contract_number, employee_id, contract_type, start_date,
            basic_salary, insurance_salary, signed_date, status
        ) VALUES (
            :c_num, :emp_id, 'FIXED_1_YEAR', :start_date,
            :b_sal, 5000000, :start_date, 'ACTIVE'
        )
    """), {
        "c_num": contract_num, "emp_id": new_id,
        "start_date": emp.join_date,
        "b_sal": basic_salary
    })

    await db.commit()
    return await get_employee(new_id, current_user, db)

@router.put("/{employee_id}", response_model=EmployeeOut, summary="Cập nhật hồ sơ nhân sự (Week 2.1)")
async def update_employee(
    employee_id: int,
    emp: EmployeeUpdate,
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    await get_employee(employee_id, current_user, db)
    update_fields = []
    params = {"id": employee_id}
    for k, v in emp.model_dump(exclude_unset=True).items():
        if v is not None:
            update_fields.append(f"{k} = :{k}")
            params[k] = v
    if update_fields:
        update_fields.append("updated_at = CURRENT_TIMESTAMP")
        q = f"UPDATE employees SET {', '.join(update_fields)} WHERE employee_id = :id"
        await db.execute(text(q), params)
        await db.commit()
    return await get_employee(employee_id, current_user, db)

@router.delete("/{employee_id}", summary="Thôi việc nhân viên (Week 2.1)")
async def delete_employee(
    employee_id: int,
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    await db.execute(text("""
        UPDATE employees 
        SET employment_status = 'RESIGNED', resignation_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP
        WHERE employee_id = :id
    """), {"id": employee_id})
    await db.execute(text("UPDATE contracts SET status = 'TERMINATED' WHERE employee_id = :id"), {"id": employee_id})
    await db.commit()
    return {"message": "Nhân viên đã được cập nhật trạng thái thôi việc (RESIGNED)."}

@router.post("/promotions", summary="Thăng cấp chức vụ theo body JSON (Workflow spec)")
async def promotions_endpoint(
    promo: PromotionCreate,
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    return await promote_employee(
        employee_id=promo.employee_id,
        new_position_id=promo.new_position_id,
        new_store_id=promo.new_store_id,
        decision_number=promo.decision_number,
        reason=promo.reason,
        current_user=current_user,
        db=db
    )

@router.post("/{employee_id}/promote", summary="Thăng chức / Điều chuyển & Cập nhật quyền (Rubric III.3.1.6)")
async def promote_employee(
    employee_id: int,
    new_position_id: int,
    new_store_id: Optional[int] = None,
    decision_number: str = "QĐ-BN-2026",
    reason: str = "Thăng cấp chức vụ theo năng lực",
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    # Lấy chức vụ và store hiện tại
    emp_query = text("SELECT position_id, store_id FROM employees WHERE employee_id = :id")
    emp = (await db.execute(emp_query, {"id": employee_id})).mappings().first()
    if not emp:
        raise HTTPException(status_code=404, detail="Không tìm thấy nhân viên")

    old_position_id = emp["position_id"]
    old_store_id = emp["store_id"]
    target_store_id = new_store_id if new_store_id is not None else old_store_id

    # 1. Lưu lịch sử position_histories
    await db.execute(text("""
        INSERT INTO position_histories (
            employee_id, old_position_id, new_position_id, old_store_id, new_store_id,
            decision_number, effective_date, reason
        ) VALUES (
            :employee_id, :old_pos, :new_pos, :old_store, :new_store,
            :decision, CURRENT_DATE, :reason
        )
    """), {
        "employee_id": employee_id, "old_pos": old_position_id, "new_pos": new_position_id,
        "old_store": old_store_id, "new_store": target_store_id,
        "decision": decision_number, "reason": reason
    })

    # 2. Cập nhật chức vụ cho employee
    await db.execute(text("""
        UPDATE employees 
        SET position_id = :new_pos, store_id = :new_store, updated_at = CURRENT_TIMESTAMP
        WHERE employee_id = :id
    """), {"id": employee_id, "new_pos": new_position_id, "new_store": target_store_id})

    # 3. Tự động đổi User Role tương ứng nếu thăng lên Cửa hàng trưởng (STORE_MANAGER)
    pos_code = (await db.execute(text("SELECT position_code FROM positions WHERE position_id = :id"), {"id": new_position_id})).scalar()
    user_id = (await db.execute(text("SELECT user_id FROM users WHERE employee_id = :id"), {"id": employee_id})).scalar()

    if user_id:
        if pos_code == "STORE_MGR":
            role_id = (await db.execute(text("SELECT role_id FROM roles WHERE role_code = 'STORE_MANAGER'"))).scalar()
            if role_id:
                # Xóa role cũ EMPLOYEE và gán STORE_MANAGER
                await db.execute(text("DELETE FROM user_roles WHERE user_id = :uid"), {"uid": user_id})
                await db.execute(text("INSERT INTO user_roles (user_id, role_id) VALUES (:uid, :rid)"), {"uid": user_id, "rid": role_id})

    await db.commit()
    return {"message": "Thăng chức và điều chuyển nhân sự thành công!", "new_position_id": new_position_id}

@router.get("/contracts", summary="Danh sách hợp đồng lao động")
async def list_contracts(
    employee_id: Optional[int] = Query(None, description="Lọc theo nhân viên"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    q = """
        SELECT c.*, e.full_name as employee_name, e.employee_code
        FROM contracts c
        JOIN employees e ON c.employee_id = e.employee_id
        WHERE 1=1
    """
    params = {}
    if employee_id:
        q += " AND c.employee_id = :emp_id"
        params["emp_id"] = employee_id
    q += " ORDER BY c.contract_id DESC"
    res = await db.execute(text(q), params)
    return res.mappings().all()

@router.post("/contracts", summary="Tạo hợp đồng lao động mới")
async def create_contract(
    c: ContractCreate,
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    c_num = c.contract_number or f"HDLD-TZ{c.employee_id}-{c.start_date.year}"
    signed = c.signed_date or c.start_date
    await db.execute(text("""
        INSERT INTO contracts (
            contract_number, employee_id, contract_type, start_date, end_date,
            basic_salary, insurance_salary, salary_percentage, working_hours_per_week,
            signed_date, status
        ) VALUES (
            :c_num, :emp_id, :c_type, :start_date, :end_date,
            :basic_salary, :ins_salary, :pct, :hours, :signed, 'ACTIVE'
        )
    """), {
        "c_num": c_num, "emp_id": c.employee_id, "c_type": c.contract_type,
        "start_date": c.start_date, "end_date": c.end_date,
        "basic_salary": c.basic_salary, "ins_salary": c.insurance_salary,
        "pct": c.salary_percentage, "hours": c.working_hours_per_week,
        "signed": signed
    })
    await db.commit()
    return {"message": "Tạo hợp đồng thành công!", "contract_number": c_num}
