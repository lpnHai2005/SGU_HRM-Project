from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.core.database import get_db
from app.api.deps import get_current_user, require_roles
from app.schemas.schemas import (
    EmployeeCreate, EmployeeUpdate, EmployeeOut,
    PromotionCreate
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
    # Kiểm tra quyền: chỉ ADMIN, HR_MANAGER, STORE_MANAGER được phép xem danh sách nhân sự
    user_roles = current_user.get("roles", [])
    if not any(role in user_roles for role in ["ADMIN", "HR_MANAGER", "STORE_MANAGER"]):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bạn không có quyền truy cập trang quản lý nhân sự."
        )

    # Store Manager chỉ xem nhân viên chi nhánh mình phụ trách
    if "STORE_MANAGER" in user_roles and "ADMIN" not in user_roles and "HR_MANAGER" not in user_roles:
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

# ===================================================================================
# ===================================================================================
# Xem hợp đồng của nhân viên (read-only)
# Đã chuyển sang module /contracts riêng. Endpoint này chỉ để backward compat.
# ===================================================================================

@router.get("/contracts", summary="[DEPRECATED] Danh sách hợp đồng - chuyển sang /contracts")
async def list_contracts_deprecated(
    employee_id: Optional[int] = Query(None, description="Lọc theo nhân viên"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """DEPRECATED: Sử dụng GET /contracts thay thế"""
    q = """
        SELECT c.contract_id, c.contract_number, c.employee_id, c.contract_type,
               c.start_date, c.end_date, c.status, c.basic_salary,
               e.full_name as employee_name, e.employee_code
        FROM contracts c
        JOIN employees e ON c.employee_id = e.employee_id
        WHERE 1=1
    """
    params = {}
    roles = current_user.get("roles", [])
    if not any(role in roles for role in ("ADMIN", "HR_MANAGER")):
        if "STORE_MANAGER" in roles:
            if not current_user.get("store_id"):
                raise HTTPException(status_code=403, detail="Tài khoản chưa được gán cửa hàng")
            q += " AND e.store_id = :assigned_store_id"
            params["assigned_store_id"] = current_user["store_id"]
        else:
            if not current_user.get("employee_id"):
                raise HTTPException(status_code=403, detail="Tài khoản chưa liên kết nhân viên")
            q += " AND c.employee_id = :self_employee_id"
            params["self_employee_id"] = current_user["employee_id"]
    if employee_id:
        q += " AND c.employee_id = :emp_id"
        params["emp_id"] = employee_id
    q += " ORDER BY c.contract_id DESC"
    res = await db.execute(text(q), params)
    return res.mappings().all()


@router.get("/{employee_id}/contracts", summary="Xem danh sách hợp đồng của nhân sự")
async def get_employee_contracts(
    employee_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Xem lịch sử / danh sách hợp đồng của nhân viên (read-only) với phân quyền RBAC:
    - ADMIN/HR_MANAGER: Xem đầy đủ
    - STORE_MANAGER: Chỉ xem nhân viên thuộc store mình
    - EMPLOYEE: Chỉ xem của chính mình
    """
    from app.api.v1.endpoints.contracts import get_employee_contract_history
    return await get_employee_contract_history(employee_id, current_user, db)

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
    roles = set(current_user.get('roles', []))
    if not roles & {'ADMIN', 'HR_MANAGER'} and employee_id != current_user.get('employee_id'):
        if 'STORE_MANAGER' not in roles or not current_user.get('store_id') or emp['store_id'] != current_user['store_id']:
            raise HTTPException(403, 'Không được xem hồ sơ ngoài phạm vi quản lý')
    return emp

@router.post("", response_model=EmployeeOut, summary="Thêm nhân sự mới (Rubric III.3.1.1)")
async def create_employee(
    emp: EmployeeCreate,
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    if emp.store_id is not None:
        store_active = (await db.execute(text('SELECT is_active FROM stores WHERE store_id=:id'), {'id': emp.store_id})).scalar_one_or_none()
        if store_active is None:
            raise HTTPException(status_code=404, detail='Không tìm thấy cửa hàng được chọn')
        if not store_active:
            raise HTTPException(status_code=409, detail='Không thể gán nhân viên mới vào cửa hàng đã ngừng hoạt động')
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

    # Tự động tạo hợp đồng lao động ban đầu (status = DRAFT để HR review)
    contract_num = f"HDLD-{emp.employee_code}-2026"
    await db.execute(text("""
        INSERT INTO contracts (
            contract_number, employee_id, contract_type, start_date,
            basic_salary, insurance_salary, signed_date, status
        ) VALUES (
            :c_num, :emp_id, 'FIXED_TERM', :start_date,
            :b_sal, 5000000, :start_date, 'DRAFT'
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
    from app.core.employee_transfers import sync_transfer_schedules
    old_store_id = (await db.execute(text('SELECT store_id FROM employees WHERE employee_id=:id FOR UPDATE'), {'id': employee_id})).scalar_one()
    update_fields = []
    params = {"id": employee_id}
    data = emp.model_dump(exclude_unset=True)
    if data.get('store_id') is not None:
        store_active = (await db.execute(text('SELECT is_active FROM stores WHERE store_id=:id'), {'id': data['store_id']})).scalar_one_or_none()
        if store_active is None:
            raise HTTPException(status_code=404, detail='Không tìm thấy cửa hàng được chọn')
        if not store_active:
            raise HTTPException(status_code=409, detail='Không thể chuyển nhân viên vào cửa hàng đã ngừng hoạt động')

    # Note: Thay đổi lương cơ bản của nhân viên nên được thực hiện qua:
    # 1. Tạo hợp đồng mới (renew) - Giữ nguyên lịch sử
    # 2. Tạo phụ lục hợp đồng - Sắp triển khai
    # Không tự động cập nhật basic_salary của hợp đồng ACTIVE trực tiếp
    # để đảm bảo tính lịch sử của hợp đồng lao động.

    for k, v in data.items():
        if k in ["employee_id", "full_name"]:
            continue
        update_fields.append(f"{k} = :{k}")
        params[k] = v

    if update_fields:
        update_fields.append("updated_at = CURRENT_TIMESTAMP")
        q = f"UPDATE employees SET {', '.join(update_fields)} WHERE employee_id = :id"
        await db.execute(text(q), params)
        if 'store_id' in data:
            await sync_transfer_schedules(db, employee_id, old_store_id, data['store_id'])
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
    # Terminate all ACTIVE contracts with proper audit fields
    user_id = current_user.get("user_id")
    await db.execute(text("""
        UPDATE contracts
        SET status = 'TERMINATED',
            termination_date = CURRENT_DATE,
            termination_reason = 'Nhân viên thôi việc (RESIGNED)',
            terminated_by = :user_id,
            updated_at = CURRENT_TIMESTAMP
        WHERE employee_id = :id AND status = 'ACTIVE'
    """), {"id": employee_id, "user_id": user_id})
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
    emp_query = text("SELECT position_id, store_id FROM employees WHERE employee_id = :id FOR UPDATE")
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
    from app.core.employee_transfers import sync_transfer_schedules
    await sync_transfer_schedules(db, employee_id, old_store_id, target_store_id)

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

