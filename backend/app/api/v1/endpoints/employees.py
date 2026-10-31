from datetime import date
from typing import Literal, Optional, List, Union
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError
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

# ===================== Tìm kiếm nâng cao =====================
# Client gửi danh sách điều kiện [{join, not, field, op, value, value2}] dạng JSON.
# Tên trường và phép toán chỉ lấy từ whitelist dưới đây; giá trị luôn đi qua bind param.

def _address_part(column: str, from_end: int) -> str:
    """Phần thứ from_end tính từ cuối của địa chỉ 'số nhà đường, phường/xã, tỉnh/thành phố'."""
    parts = f"string_to_array({column}, ',')"
    return f"trim(({parts})[cardinality({parts}) - {from_end - 1}])"


ACTIVE_CONTRACT_SALARY = (
    "(SELECT c.basic_salary FROM contracts c WHERE c.employee_id = e.employee_id "
    "AND c.status = 'ACTIVE' ORDER BY c.start_date DESC LIMIT 1)"
)

# key -> (biểu thức SQL, kiểu, nhạy cảm)
SEARCH_FIELDS = {
    "name": (("e.full_name",), "text", False),
    "code": (("e.employee_code",), "text", False),
    "phone": (("e.phone",), "text", False),
    "email": (("e.personal_email", "e.company_email"), "text", False),
    "address": (("e.permanent_address", "e.current_address"), "text", False),
    "current_province": ((_address_part("e.current_address", 1),), "province", False),
    "current_ward": ((_address_part("e.current_address", 2),), "text", False),
    "permanent_province": ((_address_part("e.permanent_address", 1),), "province", False),
    "permanent_ward": ((_address_part("e.permanent_address", 2),), "text", False),
    "identity_card": (("e.identity_card",), "text", False),
    "department": (("d.department_name",), "text", False),
    "bank_name": (("e.bank_name",), "text", False),
    "tax_code": (("e.tax_code",), "text", True),
    "insurance_code": (("e.insurance_code",), "text", True),
    "bank_account": (("e.bank_account_number",), "text", True),
    "base_salary": ((ACTIVE_CONTRACT_SALARY,), "number", False),
    "age": (("date_part('year', age(current_date, e.dob))",), "number", False),
    "join_date": (("e.join_date",), "date", False),
}
SEARCH_OPS = {
    "text": {"contains", "eq", "neq", "starts"},
    "province": {"eq", "neq", "in"},
    "number": {"eq", "neq", "gt", "gte", "lt", "lte", "between"},
    "date": {"eq", "neq", "gt", "gte", "lt", "lte", "between"},
}
COMPARE_SQL = {"eq": "=", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}
SENSITIVE_SEARCH_ROLES = {"ADMIN", "HR_MANAGER", "DIRECTOR"}
MAX_SEARCH_CONDITIONS = 10


class SearchCondition(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    join: Literal["AND", "OR"] = "AND"
    negate: bool = Field(False, alias="not")
    field: str
    op: str
    value: Union[str, float, int, List[str]]  # danh sách chỉ dùng cho op "in"
    value2: Optional[Union[str, float, int]] = None


def _like_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _parse_value(raw, kind: str):
    if kind == "number":
        number = float(raw)
        if number != number or number in (float("inf"), float("-inf")):
            raise ValueError("số không hợp lệ")
        return number
    if kind == "date":
        return date.fromisoformat(str(raw))
    text_value = str(raw).strip()
    if not text_value or len(text_value) > 100:
        raise ValueError("giá trị chữ phải dài 1-100 ký tự")
    return text_value


def _condition_sql(cond: SearchCondition, index: int, params: dict, can_see_sensitive: bool) -> str:
    if cond.field not in SEARCH_FIELDS:
        raise HTTPException(status_code=422, detail=f"Trường tìm kiếm không hợp lệ: {cond.field}")
    columns, kind, sensitive = SEARCH_FIELDS[cond.field]
    if sensitive and not can_see_sensitive:
        raise HTTPException(status_code=403, detail="Bạn không có quyền tìm kiếm theo trường này.")
    if cond.op not in SEARCH_OPS[kind]:
        raise HTTPException(status_code=422, detail=f"Phép toán '{cond.op}' không áp dụng cho trường {cond.field}")
    try:
        if cond.op == "in":
            # "thuộc một trong": 1-34 giá trị (34 tỉnh/thành)
            if not isinstance(cond.value, list) or not 1 <= len(cond.value) <= 34:
                raise ValueError("cần 1-34 giá trị")
            value = [_parse_value(item, kind) for item in cond.value]
        elif isinstance(cond.value, list):
            raise ValueError("chỉ phép 'thuộc một trong' nhận danh sách")
        else:
            value = _parse_value(cond.value, kind)
        value2 = _parse_value(cond.value2, kind) if cond.op == "between" else None
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"Giá trị không hợp lệ cho trường {cond.field}")
    if value2 is not None and value2 < value:
        raise HTTPException(status_code=422, detail=f"Khoảng giá trị của {cond.field} bị ngược")

    p = f"c{index}"
    if cond.op == "in":
        names = [f"{p}_{i}" for i in range(len(value))]
        params.update({name: _like_escape(item) for name, item in zip(names, value)})
        expr = " OR ".join(
            f"extensions.unaccent({col}) ILIKE extensions.unaccent(:{name})" for col in columns for name in names
        )
    elif kind in ("text", "province"):
        patterns = {"contains": f"%{_like_escape(value)}%", "starts": f"{_like_escape(value)}%"}
        params[p] = patterns.get(cond.op, _like_escape(value))
        # Không dấu, không phân biệt hoa thường; eq/neq so khớp nguyên chuỗi
        expr = " OR ".join(f"extensions.unaccent({col}) ILIKE extensions.unaccent(:{p})" for col in columns)
    elif cond.op == "between":
        params[p], params[f"{p}b"] = value, value2
        expr = f"{columns[0]} BETWEEN :{p} AND :{p}b"
    else:
        params[p] = value
        expr = f"{columns[0]} {COMPARE_SQL['eq' if cond.op == 'neq' else cond.op]} :{p}"
    # COALESCE để NULL được coi là "không khớp", nhờ vậy NOT / ≠ vẫn trả về bản ghi thiếu dữ liệu
    sql = f"COALESCE(({expr}), FALSE)"
    if cond.op == "neq":
        sql = f"NOT {sql}"
    return f"NOT {sql}" if cond.negate else sql


def build_advanced_search(raw_conditions: str, user_roles, params: dict) -> str:
    """Trả về biểu thức SQL đã bọc ngoặc; SQL tự tính AND trước OR."""
    try:
        conditions = TypeAdapter(List[SearchCondition]).validate_json(raw_conditions)
    except ValidationError:
        raise HTTPException(status_code=422, detail="Điều kiện tìm kiếm nâng cao không hợp lệ")
    if len(conditions) > MAX_SEARCH_CONDITIONS:
        raise HTTPException(status_code=422, detail=f"Tối đa {MAX_SEARCH_CONDITIONS} điều kiện")
    can_see_sensitive = bool(SENSITIVE_SEARCH_ROLES & set(user_roles))
    parts = []
    for index, cond in enumerate(conditions):
        sql = _condition_sql(cond, index, params, can_see_sensitive)
        parts.append(sql if index == 0 else f"{cond.join} {sql}")
    return "(" + " ".join(parts) + ")" if parts else ""


def _unaccent_match(columns, param: str) -> str:
    """So khớp không dấu, không phân biệt hoa thường (cần extension unaccent)."""
    return "(" + " OR ".join(
        f"extensions.unaccent({col}) ILIKE extensions.unaccent(:{param})" for col in columns
    ) + ")"


@router.get("", response_model=List[EmployeeOut], summary="Danh sách nhân sự chuỗi TechZone")
async def list_employees(
    store_id: Optional[int] = Query(None, description="Lọc theo chi nhánh cửa hàng"),
    department_id: Optional[int] = Query(None, description="Lọc theo phòng ban"),
    status: Optional[str] = Query(None, description="Lọc theo trạng thái"),
    search: Optional[str] = Query(None, description="Tìm theo họ tên, mã NV, SĐT"),
    conditions: Optional[str] = Query(None, description="Tìm nâng cao: JSON [{join, not, field, op, value, value2}]"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Kiểm tra quyền: ADMIN, DIRECTOR, HR_MANAGER, STORE_MANAGER được phép xem danh sách nhân sự
    user_roles = current_user.get("roles", [])
    if not any(role in user_roles for role in ["ADMIN", "DIRECTOR", "HR_MANAGER", "STORE_MANAGER"]):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bạn không có quyền truy cập trang quản lý nhân sự."
        )

    # Store Manager chỉ xem nhân viên chi nhánh mình phụ trách
    if "STORE_MANAGER" in user_roles and "ADMIN" not in user_roles and "HR_MANAGER" not in user_roles and "DIRECTOR" not in user_roles:
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
        base_query += " AND " + _unaccent_match(("e.full_name", "e.employee_code", "e.phone"), "search")
        params["search"] = f"%{search}%"
    if conditions:
        # Bọc ngoặc rồi AND với bộ lọc/phạm vi ở trên để OR không vượt được giới hạn cửa hàng
        advanced_sql = build_advanced_search(conditions, user_roles, params)
        if advanced_sql:
            base_query += " AND " + advanced_sql

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
    if not any(role in roles for role in ("ADMIN", "HR_MANAGER", "DIRECTOR")):
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
    - ADMIN/HR_MANAGER/DIRECTOR: Xem đầy đủ
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
    if not roles & {'ADMIN', 'HR_MANAGER', 'DIRECTOR'} and employee_id != current_user.get('employee_id'):
        if 'STORE_MANAGER' not in roles or not current_user.get('store_id') or emp['store_id'] != current_user['store_id']:
            raise HTTPException(403, 'Không được xem hồ sơ ngoài phạm vi quản lý')
    return emp

@router.post("", response_model=EmployeeOut, summary="Thêm nhân sự mới (Rubric III.3.1.1)")
async def create_employee(
    emp: EmployeeCreate,
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER", "DIRECTOR"])),
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
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER", "DIRECTOR"])),
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
    data.pop("basic_salary", None)

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
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER", "DIRECTOR"])),
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
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER", "DIRECTOR"])),
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
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER", "DIRECTOR"])),
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
