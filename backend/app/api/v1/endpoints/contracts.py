"""
Contract Management API Endpoints
Quản lý hợp đồng lao động: tạo, sửa, kích hoạt, gia hạn, chấm dứt
"""
from datetime import date, datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
import json
import io
import aiohttp

from app.core.database import get_db
from app.api.deps import get_current_user, require_roles, record_audit_log
from app.core.contract_service import (
    ContractService, ContractStatus, ContractType,
    VALID_TRANSITIONS
)
from app.core.resignation_service import ResignationService
from app.schemas.schemas import (
    ContractCreate,
    ContractUpdate,
    ContractOut,
    ContractTerminate,
    ContractRenew,
)

router = APIRouter()


# ===============================================================================
# 1. DANH SÁCH HỢP ĐỒNG VÀ THỐNG KÊ
# ===============================================================================

@router.get("", summary="Danh sách hợp đồng lao động")
async def list_contracts(
    status: Optional[str] = Query(None, description="Lọc theo trạng thái"),
    contract_type: Optional[str] = Query(None, description="Lọc theo loại hợp đồng"),
    employee_id: Optional[int] = Query(None, description="Lọc theo nhân viên"),
    store_id: Optional[int] = Query(None, description="Lọc theo cửa hàng"),
    department_id: Optional[int] = Query(None, description="Lọc theo phòng ban"),
    position_id: Optional[int] = Query(None, description="Lọc theo chức vụ"),
    expiring_days: Optional[int] = Query(None, description="Sắp hết hạn trong N ngày"),
    expired: bool = Query(False, description="Lọc hợp đồng đã hết hạn"),
    search: Optional[str] = Query(None, description="Tìm kiếm theo mã HĐ, mã NV, tên NV"),
    page: int = Query(1, ge=1, description="Trang hiện tại"),
    page_size: int = Query(20, ge=1, le=100, description="Số dòng mỗi trang"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Danh sách hợp đồng với phân trang và bộ lọc.
    RBAC:
    - ADMIN/HR_MANAGER: Xem tất cả
    - STORE_MANAGER: Xem nhân viên cửa hàng mình (không thấy lương)
    - EMPLOYEE: Chỉ xem hợp đồng của mình (không thấy lương)
    """
    roles = current_user.get("roles", [])
    is_hr = "ADMIN" in roles or "HR_MANAGER" in roles

    # Base query
    q = """
        SELECT c.contract_id, c.contract_number, c.employee_id, c.contract_type,
               c.start_date, c.end_date, c.basic_salary, c.insurance_salary,
               c.signed_date, c.status, c.notes, c.contract_file_url,
               c.previous_contract_id, c.termination_date, c.termination_reason,
               c.created_at, c.activated_at, c.updated_at,
               e.employee_code, e.full_name as employee_name, e.store_id,
               s.store_name, d.department_name, pos.position_name,
               pc.contract_number as previous_contract_number
        FROM contracts c
        JOIN employees e ON c.employee_id = e.employee_id
        LEFT JOIN stores s ON e.store_id = s.store_id
        LEFT JOIN departments d ON e.department_id = d.department_id
        LEFT JOIN positions pos ON COALESCE(c.position_id, e.position_id) = pos.position_id
        LEFT JOIN contracts pc ON c.previous_contract_id = pc.contract_id
        WHERE 1=1
    """
    params = {}

    # RBAC filtering
    if not is_hr:
        if "STORE_MANAGER" in roles:
            if not current_user.get("store_id"):
                raise HTTPException(status_code=403, detail="Tài khoản chưa được gán cửa hàng")
            q += " AND e.store_id = :user_store_id"
            params["user_store_id"] = current_user["store_id"]
        else:
            # EMPLOYEE - only own contracts
            if not current_user.get("employee_id"):
                raise HTTPException(status_code=403, detail="Tài khoản chưa được liên kết nhân viên")
            q += " AND c.employee_id = :user_employee_id"
            params["user_employee_id"] = current_user["employee_id"]

    # Apply filters
    if status:
        if status == "ACTIVE":
            q += " AND c.status = 'ACTIVE' AND (c.end_date IS NULL OR c.end_date >= CURRENT_DATE)"
        elif status == "EXPIRED":
            q += " AND (c.status = 'EXPIRED' OR (c.status = 'ACTIVE' AND c.end_date IS NOT NULL AND c.end_date < CURRENT_DATE))"
        else:
            q += " AND c.status = :status"
            params["status"] = status

    if contract_type:
        q += " AND c.contract_type = :contract_type"
        params["contract_type"] = contract_type

    if employee_id:
        q += " AND c.employee_id = :employee_id"
        params["employee_id"] = employee_id

    if store_id:
        q += " AND e.store_id = :store_id"
        params["store_id"] = store_id

    if department_id:
        q += " AND e.department_id = :department_id"
        params["department_id"] = department_id

    if position_id:
        q += " AND (c.position_id = :position_id OR (c.position_id IS NULL AND e.position_id = :position_id))"
        params["position_id"] = position_id

    if search:
        q += " AND (c.contract_number ILIKE :search OR e.employee_code ILIKE :search OR e.full_name ILIKE :search)"
        params["search"] = f"%{search}%"

    if expiring_days:
        # Contracts expiring within N days (only for active contracts with end_date)
        q += """
            AND c.status = 'ACTIVE'
            AND c.end_date IS NOT NULL
            AND c.end_date <= CURRENT_DATE + :expiring_days
            AND c.end_date >= CURRENT_DATE
        """
        params["expiring_days"] = expiring_days

    if expired:
        q += """
            AND (c.status = 'EXPIRED' OR (c.status = 'ACTIVE' AND c.end_date IS NOT NULL AND c.end_date < CURRENT_DATE))
        """

    # Get total count
    count_q = f"SELECT COUNT(*) as count FROM ({q}) as _subq"
    res = await db.execute(text(count_q), params)
    total = res.mappings().first()["count"]

    # Add ordering and pagination
    q += " ORDER BY c.contract_id DESC LIMIT :limit OFFSET :offset"
    params["limit"] = page_size
    params["offset"] = (page - 1) * page_size

    res = await db.execute(text(q), params)
    contracts = res.mappings().all()

    # Mask sensitive fields for non-HR
    if not is_hr:
        for c in contracts:
            c = dict(c)
            c["basic_salary"] = None
            c["insurance_salary"] = None
            c["contract_file_url"] = None
            c["termination_reason"] = None

    return {
        "data": contracts,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size
    }


@router.get("/stats/dashboard", summary="Thống kê dashboard hợp đồng")
async def get_contract_stats(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Thống kê số lượng hợp đồng theo trạng thái.
    """
    roles = current_user.get("roles", [])
    is_hr = "ADMIN" in roles or "HR_MANAGER" in roles

    base_where = "WHERE 1=1"
    params = {}

    if not is_hr:
        if "STORE_MANAGER" in roles:
            if current_user.get("store_id"):
                base_where += " AND e.store_id = :store_id"
                params["store_id"] = current_user["store_id"]
        else:
            if current_user.get("employee_id"):
                base_where += " AND c.employee_id = :emp_id"
                params["emp_id"] = current_user["employee_id"]

    # Active contracts (status = 'ACTIVE' and end_date is NULL or >= CURRENT_DATE)
    active_q = text(f"""
        SELECT COUNT(*) as count FROM contracts c
        JOIN employees e ON c.employee_id = e.employee_id
        {base_where} AND c.status = 'ACTIVE'
        AND (c.end_date IS NULL OR c.end_date >= CURRENT_DATE)
    """)
    res = await db.execute(active_q, params)
    active_count = res.mappings().first()["count"]

    # Expiring soon (within 30 days)
    expiring_q = text(f"""
        SELECT COUNT(*) as count FROM contracts c
        JOIN employees e ON c.employee_id = e.employee_id
        {base_where} AND c.status = 'ACTIVE'
        AND c.end_date IS NOT NULL
        AND c.end_date <= CURRENT_DATE + 30
        AND c.end_date >= CURRENT_DATE
    """)
    res = await db.execute(expiring_q, params)
    expiring_count = res.mappings().first()["count"]

    # Expired (status = 'EXPIRED' or passed end_date)
    expired_q = text(f"""
        SELECT COUNT(*) as count FROM contracts c
        JOIN employees e ON c.employee_id = e.employee_id
        {base_where} AND (c.status = 'EXPIRED' OR (c.status = 'ACTIVE' AND c.end_date IS NOT NULL AND c.end_date < CURRENT_DATE))
    """)
    res = await db.execute(expired_q, params)
    expired_count = res.mappings().first()["count"]

    # Terminated
    terminated_q = text(f"""
        SELECT COUNT(*) as count FROM contracts c
        JOIN employees e ON c.employee_id = e.employee_id
        {base_where} AND c.status = 'TERMINATED'
    """)
    res = await db.execute(terminated_q, params)
    terminated_count = res.mappings().first()["count"]

    # Draft
    draft_q = text(f"""
        SELECT COUNT(*) as count FROM contracts c
        JOIN employees e ON c.employee_id = e.employee_id
        {base_where} AND c.status = 'DRAFT'
    """)
    res = await db.execute(draft_q, params)
    draft_count = res.mappings().first()["count"]

    return {
        "active": active_count,
        "expiring_soon": expiring_count,
        "expired": expired_count,
        "terminated": terminated_count,
        "draft": draft_count
    }


# ===============================================================================
# 2. CHI TIẾT HỢP ĐỒNG
# ===============================================================================

@router.get("/{contract_id}", summary="Chi tiết hợp đồng")
async def get_contract(
    contract_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Lấy chi tiết một hợp đồng.
    Sensitive fields (basic_salary, file_url, termination_reason) chỉ hiển thị cho HR.
    """
    # Check access permission
    await ContractService.can_user_access_contract(db, current_user, contract_id)

    # Get contract data with field masking
    contract = await ContractService.get_contract_with_sensitive_data(db, current_user, contract_id)

    return contract


# ===============================================================================
# 3. TẠO HỢP ĐỒNG MỚI
# ===============================================================================

@router.post("", summary="Tạo hợp đồng lao động mới")
async def create_contract(
    contract: ContractCreate,
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Tạo hợp đồng mới (trạng thái mặc định: DRAFT).

    Validation:
    - Employee tồn tại
    - Ngày hợp lệ theo loại hợp đồng
    - Không overlap với hợp đồng ACTIVE khác
    - Lương >= 0
    """
    # Validate employee exists
    await ContractService.validate_employee_exists(db, contract.employee_id)

    # Validate date range
    await ContractService.validate_date_range(
        contract.contract_type,
        contract.start_date,
        contract.end_date
    )

    # Validate salary
    if contract.basic_salary < 0:
        raise HTTPException(status_code=400, detail="Lương cơ bản không được âm")

    # Validate overlap (only for DRAFT -> ACTIVE later)
    # For now, skip overlap check since contract starts as DRAFT

    # Generate contract number
    contract_number = await ContractService.generate_contract_number(
        db,
        contract.start_date.year
    )

    # Get current user ID
    user_id = current_user.get("user_id")

    # Insert contract
    query = text("""
        INSERT INTO contracts (
            contract_number, employee_id, contract_type, start_date, end_date,
            basic_salary, insurance_salary, signed_date, status,
            position_id, department_id, notes, contract_file_url,
            created_by
        ) VALUES (
            :contract_number, :employee_id, :contract_type, :start_date, :end_date,
            :basic_salary, :insurance_salary, :signed_date, 'DRAFT',
            :position_id, :department_id, :notes, :contract_file_url,
            :created_by
        )
        RETURNING contract_id
    """)

    result = await db.execute(query, {
        "contract_number": contract_number,
        "employee_id": contract.employee_id,
        "contract_type": contract.contract_type,
        "start_date": contract.start_date,
        "end_date": contract.end_date,
        "basic_salary": contract.basic_salary,
        "insurance_salary": contract.insurance_salary,
        "signed_date": contract.signed_date,
        "position_id": contract.position_id,
        "department_id": contract.department_id,
        "notes": contract.notes,
        "contract_file_url": contract.file_url,
        "created_by": user_id
    })

    new_contract_id = result.mappings().first()["contract_id"]

    # Audit log
    await record_audit_log(
        db=db,
        user_id=user_id,
        action="CONTRACT_CREATED",
        entity_name="contract",
        entity_id=str(new_contract_id),
        new_values={
            "contract_number": contract_number,
            "employee_id": contract.employee_id,
            "contract_type": contract.contract_type,
            "start_date": str(contract.start_date),
            "end_date": str(contract.end_date) if contract.end_date else None,
            "basic_salary": contract.basic_salary
        }
    )

    await db.commit()

    return {
        "message": "Tạo hợp đồng thành công!",
        "contract_id": new_contract_id,
        "contract_number": contract_number,
        "status": "DRAFT"
    }


# ===============================================================================
# 4. CẬP NHẬT HỢP ĐỒNG
# ===============================================================================

@router.put("/{contract_id}", summary="Cập nhật hợp đồng")
async def update_contract(
    contract_id: int,
    contract_update: ContractUpdate,
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Cập nhật hợp đồng.
    - Chỉ cho phép cập nhật khi status = DRAFT
    """
    # Get current contract
    current_contract = await ContractService.check_contract_exists(db, contract_id)

    # Check status
    if current_contract["status"] != ContractStatus.DRAFT:
        raise HTTPException(
            status_code=409,
            detail=f"Chỉ có thể cập nhật hợp đồng ở trạng thái DRAFT. Trạng thái hiện tại: {current_contract['status']}"
        )

    # Validate date range if provided
    if contract_update.start_date and contract_update.end_date:
        await ContractService.validate_date_range(
            current_contract["contract_type"],
            contract_update.start_date,
            contract_update.end_date
        )

    # Validate salary if provided
    if contract_update.basic_salary is not None and contract_update.basic_salary < 0:
        raise HTTPException(status_code=400, detail="Lương cơ bản không được âm")

    # Build update query
    update_fields = []
    params = {"contract_id": contract_id}

    data = contract_update.model_dump(exclude_unset=True)
    for k, v in data.items():
        if v is not None:
            # Map field names (camelCase in schema to snake_case in DB)
            db_field = k
            if k == "file_url":
                db_field = "contract_file_url"
            update_fields.append(f"{db_field} = :{k}")
            params[k] = v

    if update_fields:
        update_fields.append("updated_at = CURRENT_TIMESTAMP")
        query = f"""
            UPDATE contracts
            SET {', '.join(update_fields)}
            WHERE contract_id = :contract_id
        """
        await db.execute(text(query), params)

        # Audit log
        await record_audit_log(
            db=db,
            user_id=current_user.get("user_id"),
            action="CONTRACT_UPDATED",
            entity_name="contract",
            entity_id=str(contract_id),
            old_values=dict(current_contract),
            new_values=data
        )

        await db.commit()

    return {
        "message": "Cập nhật hợp đồng thành công!",
        "contract_id": contract_id
    }


@router.patch("/{contract_id}", summary="Cập nhật một phần hợp đồng")
async def patch_contract(
    contract_id: int,
    contract_update: ContractUpdate,
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Cập nhật một phần thông tin hợp đồng (chỉ cho phép khi ở trạng thái DRAFT).
    """
    return await update_contract(contract_id, contract_update, current_user, db)


# ===============================================================================
# 5. KÍCH HOẠT HỢP ĐỒNG
# ===============================================================================

@router.post("/{contract_id}/activate", summary="Kích hoạt hợp đồng")
async def activate_contract(
    contract_id: int,
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Kích hoạt hợp đồng: DRAFT -> ACTIVE

    Validation:
    - Contract ở trạng thái DRAFT
    - Employee tồn tại
    - Ngày hợp lệ theo loại hợp đồng
    - Không overlap với hợp đồng ACTIVE khác (kèm row lock chống race condition)
    """
    # Get current contract
    current_contract = await ContractService.check_contract_exists(db, contract_id)

    # Validate state transition
    ContractService.check_state_transition(current_contract["status"], ContractStatus.ACTIVE)

    # Validate employee
    await ContractService.validate_employee_exists(db, current_contract["employee_id"])

    # Validate date range
    await ContractService.validate_date_range(
        current_contract["contract_type"],
        current_contract["start_date"],
        current_contract["end_date"]
    )

    # Validate overlap
    await ContractService.validate_overlap(
        db,
        current_contract["employee_id"],
        current_contract["start_date"],
        current_contract["end_date"],
        exclude_contract_id=contract_id
    )

    # Update contract status
    user_id = current_user.get("user_id")
    query = text("""
        UPDATE contracts
        SET status = 'ACTIVE',
            activated_at = CURRENT_TIMESTAMP,
            activated_by = :user_id,
            updated_at = CURRENT_TIMESTAMP
        WHERE contract_id = :contract_id
    """)
    await db.execute(query, {"contract_id": contract_id, "user_id": user_id})

    # Audit log
    await record_audit_log(
        db=db,
        user_id=user_id,
        action="CONTRACT_ACTIVATED",
        entity_name="contract",
        entity_id=str(contract_id),
        old_values={"status": current_contract["status"]},
        new_values={"status": "ACTIVE"}
    )

    await db.commit()

    return {
        "message": "Kích hoạt hợp đồng thành công!",
        "contract_id": contract_id,
        "status": "ACTIVE"
    }


# ===============================================================================
# 6. GIA HẠN HỢP ĐỒNG
# ===============================================================================

@router.post("/{contract_id}/renew", summary="Gia hạn hợp đồng")
async def renew_contract(
    contract_id: int,
    renew_data: ContractRenew,
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Gia hạn hợp đồng: Tạo hợp đồng mới với link đến hợp đồng cũ.

    - Hợp đồng cũ được giữ nguyên
    - Tạo hợp đồng mới với previous_contract_id = contract_id cũ
    - Validate overlap trước khi activate
    """
    # Get current contract
    current_contract = await ContractService.check_contract_exists(db, contract_id)

    # Validate state: only ACTIVE or EXPIRED contracts can be renewed
    if current_contract["status"] not in [ContractStatus.ACTIVE, ContractStatus.EXPIRED]:
        raise HTTPException(
            status_code=400,
            detail=f"Chỉ có thể gia hạn hợp đồng ở trạng thái ACTIVE hoặc EXPIRED. Trạng thái hiện tại: {current_contract['status']}"
        )

    # Check if this contract has already been renewed
    check_prev = await db.execute(
        text("SELECT contract_id, contract_number FROM contracts WHERE previous_contract_id = :cid AND status != 'CANCELLED'"),
        {"cid": contract_id}
    )
    already_renewed = check_prev.mappings().first()
    if already_renewed:
        raise HTTPException(
            status_code=409,
            detail=f"Hợp đồng {current_contract['contract_number']} đã được gia hạn bởi hợp đồng {already_renewed['contract_number']}"
        )

    # Validate new dates
    new_start = renew_data.new_start_date
    new_end = renew_data.new_end_date

    await ContractService.validate_date_range(
        current_contract["contract_type"],
        new_start,
        new_end
    )

    # Validate new salary
    new_salary = renew_data.new_basic_salary if renew_data.new_basic_salary else current_contract["basic_salary"]
    if new_salary and new_salary < 0:
        raise HTTPException(status_code=400, detail="Lương cơ bản không được âm")

    # Validate overlap
    await ContractService.validate_overlap(
        db,
        current_contract["employee_id"],
        new_start,
        new_end
    )

    # Generate new contract number
    new_contract_number = await ContractService.generate_contract_number(db, new_start.year)

    user_id = current_user.get("user_id")

    # Create new contract
    query = text("""
        INSERT INTO contracts (
            contract_number, employee_id, contract_type, start_date, end_date,
            basic_salary, insurance_salary, signed_date, status,
            position_id, department_id, notes, previous_contract_id,
            created_by
        ) VALUES (
            :contract_number, :employee_id, :contract_type, :start_date, :end_date,
            :basic_salary, :insurance_salary, :signed_date, 'DRAFT',
            :position_id, :department_id, :notes, :previous_contract_id,
            :created_by
        )
        RETURNING contract_id
    """)

    result = await db.execute(query, {
        "contract_number": new_contract_number,
        "employee_id": current_contract["employee_id"],
        "contract_type": current_contract["contract_type"],
        "start_date": new_start,
        "end_date": new_end,
        "basic_salary": new_salary,
        "insurance_salary": renew_data.new_basic_salary or current_contract.get("insurance_salary"),
        "signed_date": date.today(),
        "position_id": renew_data.new_position_id or current_contract.get("position_id"),
        "department_id": current_contract.get("department_id"),
        "notes": renew_data.notes,
        "previous_contract_id": contract_id,
        "created_by": user_id
    })

    new_contract_id = result.mappings().first()["contract_id"]

    # Audit log
    await record_audit_log(
        db=db,
        user_id=user_id,
        action="CONTRACT_RENEWED",
        entity_name="contract",
        entity_id=str(contract_id),
        old_values={
            "contract_number": current_contract["contract_number"],
            "end_date": str(current_contract["end_date"])
        },
        new_values={
            "new_contract_id": new_contract_id,
            "new_contract_number": new_contract_number,
            "new_start_date": str(new_start),
            "new_end_date": str(new_end) if new_end else None
        }
    )

    await db.commit()

    return {
        "message": "Gia hạn hợp đồng thành công!",
        "old_contract_id": contract_id,
        "new_contract_id": new_contract_id,
        "new_contract_number": new_contract_number,
        "status": "DRAFT"
    }


# ===============================================================================
# 7. CHẤM DỨT HỢP ĐỒNG
# ===============================================================================

@router.post("/{contract_id}/terminate", summary="Chấm dứt hợp đồng")
async def terminate_contract(
    contract_id: int,
    terminate_data: ContractTerminate,
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Chấm dứt hợp đồng: ACTIVE -> TERMINATED
    
    Quy trình và ràng buộc:
    1. Contract ở trạng thái ACTIVE.
    2. termination_date phải trong khoảng hiệu lực hợp đồng.
    3. Lý do chấm dứt có cấu trúc:
       - EMPLOYEE_RESIGNATION: Bắt buộc nhân viên phải có đơn thôi việc đã được duyệt (APPROVED).
       - MUTUAL_AGREEMENT / EMPLOYER_TERMINATION / OTHER.
    4. Kiểm tra hợp đồng ACTIVE còn lại của nhân viên:
       - Nếu nhân viên còn hợp đồng ACTIVE khác: Nhân viên và tài khoản vẫn giữ trạng thái bình thường.
       - Nếu không còn hợp đồng ACTIVE nào khác:
         + Cập nhật trạng thái nhân viên: RESIGNED (nếu EMPLOYEE_RESIGNATION / MUTUAL_AGREEMENT) hoặc TERMINATED (nếu EMPLOYER_TERMINATION).
         + Cập nhật ngày thôi việc (resignation_date).
         + Khóa tài khoản đăng nhập (users.is_active = FALSE).
    """
    # 1. Get current contract
    current_contract = await ContractService.check_contract_exists(db, contract_id)

    # Validate state transition
    ContractService.check_state_transition(current_contract["status"], ContractStatus.TERMINATED)

    # 2. Validate termination date
    term_date = terminate_data.termination_date
    if term_date < current_contract["start_date"]:
        raise HTTPException(
            status_code=400,
            detail="Ngày chấm dứt không được trước ngày bắt đầu hợp đồng"
        )

    if current_contract["end_date"] and term_date > current_contract["end_date"]:
        raise HTTPException(
            status_code=400,
            detail="Ngày chấm dứt không được sau ngày kết thúc hợp đồng"
        )

    # 3. Determine reason type and validate resignation requirement
    reason_raw = terminate_data.termination_reason.strip()
    term_type = terminate_data.termination_type or "OTHER"
    if "EMPLOYEE_RESIGNATION" in reason_raw or term_type == "EMPLOYEE_RESIGNATION":
        term_type = "EMPLOYEE_RESIGNATION"
    elif "MUTUAL_AGREEMENT" in reason_raw or term_type == "MUTUAL_AGREEMENT":
        term_type = "MUTUAL_AGREEMENT"
    elif "EMPLOYER_TERMINATION" in reason_raw or term_type == "EMPLOYER_TERMINATION":
        term_type = "EMPLOYER_TERMINATION"

    approved_resignation = None
    if term_type == "EMPLOYEE_RESIGNATION":
        approved_resignation = await ResignationService.get_approved_resignation(
            db,
            employee_id=current_contract["employee_id"],
            contract_id=contract_id,
            resignation_id=terminate_data.resignation_id
        )
        if not approved_resignation:
            raise HTTPException(
                status_code=400,
                detail="Không tìm thấy đơn thôi việc đã được phê duyệt (APPROVED) cho nhân viên/hợp đồng này. Vui lòng tạo và duyệt đơn thôi việc trong mục 'Quản lý thôi việc' trước khi chấm dứt hợp đồng!"
            )

    # 3b. Documentation constraint: Bắt buộc có giấy tờ/chứng từ kèm theo
    final_doc_url = terminate_data.document_url
    if not final_doc_url and approved_resignation and approved_resignation.get("attachment_url"):
        final_doc_url = approved_resignation.get("attachment_url")

    # Bắt buộc phải có tệp đính kèm hoặc số hiệu văn bản quyết định thôi việc
    if not final_doc_url and not terminate_data.decision_number:
        raise HTTPException(
            status_code=400,
            detail="Bắt buộc phải có giấy tờ, chứng từ kèm theo (Tải lên file Quyết định chấm dứt / Biên bản thanh lý hoặc nhập Số hiệu quyết định) để chấm dứt hợp đồng!"
        )

    user_id = current_user.get("user_id")

    # Format final termination reason to save in contracts
    reason_notes = terminate_data.notes or ""
    decision_info = f" [Số QĐ: {terminate_data.decision_number}]" if terminate_data.decision_number else ""
    if reason_notes:
        saved_reason = f"[{term_type}]{decision_info} {reason_raw} - {reason_notes}"
    else:
        saved_reason = f"[{term_type}]{decision_info} {reason_raw}"

    # 4. Update contract to TERMINATED
    update_contract_query = text("""
        UPDATE contracts
        SET status = 'TERMINATED',
            termination_date = :termination_date,
            termination_reason = :termination_reason,
            termination_document_url = :termination_document_url,
            terminated_by = :terminated_by,
            updated_at = CURRENT_TIMESTAMP
        WHERE contract_id = :contract_id
    """)

    await db.execute(update_contract_query, {
        "contract_id": contract_id,
        "termination_date": term_date,
        "termination_reason": saved_reason,
        "termination_document_url": final_doc_url,
        "terminated_by": user_id
    })

    # Contract Audit Log
    await record_audit_log(
        db=db,
        user_id=user_id,
        action="CONTRACT_TERMINATED",
        entity_name="contract",
        entity_id=str(contract_id),
        old_values={"status": current_contract["status"]},
        new_values={
            "status": "TERMINATED",
            "termination_date": str(term_date),
            "termination_reason": saved_reason,
            "termination_document_url": final_doc_url
        }
    )

    # 5. Check remaining active contracts of employee
    emp_id = current_contract["employee_id"]
    active_contracts_query = text("""
        SELECT contract_id, contract_number 
        FROM contracts 
        WHERE employee_id = :employee_id 
          AND status = 'ACTIVE' 
          AND contract_id != :contract_id
    """)
    rem_res = await db.execute(active_contracts_query, {"employee_id": emp_id, "contract_id": contract_id})
    remaining_active = rem_res.mappings().fetchall()

    user_account_locked = False
    employee_status_updated = False
    new_emp_status = None

    if not remaining_active:
        # No more active contracts: update employee status and lock user account
        if term_type == "EMPLOYER_TERMINATION":
            new_emp_status = "TERMINATED"
        else:
            new_emp_status = "RESIGNED"

        # Update employee status & resignation date
        await db.execute(text("""
            UPDATE employees
            SET employment_status = :new_status,
                resignation_date = :resignation_date,
                updated_at = CURRENT_TIMESTAMP
            WHERE employee_id = :employee_id
        """), {
            "new_status": new_emp_status,
            "resignation_date": term_date,
            "employee_id": emp_id
        })
        employee_status_updated = True

        # Lock user account
        user_update_res = await db.execute(text("""
            UPDATE users
            SET is_active = FALSE,
                updated_at = CURRENT_TIMESTAMP
            WHERE employee_id = :employee_id
            RETURNING user_id, username
        """), {"employee_id": emp_id})
        locked_user = user_update_res.mappings().first()
        if locked_user:
            user_account_locked = True
            await record_audit_log(
                db=db,
                user_id=user_id,
                action="USER_LOCKED_ON_CONTRACT_TERMINATION",
                entity_name="user",
                entity_id=str(locked_user["user_id"]),
                old_values={"is_active": True},
                new_values={"is_active": False, "reason": f"Contract terminated ({term_type})"}
            )

        # Audit log for employee status change
        await record_audit_log(
            db=db,
            user_id=user_id,
            action="EMPLOYEE_STATUS_CHANGED",
            entity_name="employee",
            entity_id=str(emp_id),
            new_values={
                "employment_status": new_emp_status,
                "resignation_date": str(term_date),
                "account_locked": user_account_locked
            }
        )

    await db.commit()

    return {
        "message": "Chấm dứt hợp đồng thành công!",
        "contract_id": contract_id,
        "status": "TERMINATED",
        "termination_date": str(term_date),
        "termination_type": term_type,
        "termination_document_url": final_doc_url,
        "remaining_active_contracts": len(remaining_active),
        "employee_status_updated": employee_status_updated,
        "new_employee_status": new_emp_status,
        "user_account_locked": user_account_locked
    }


@router.post("/upload-termination-document", summary="Upload giấy tờ/quyết định chấm dứt hợp đồng")
async def upload_termination_document(
    file: UploadFile = File(...),
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Upload văn bản quyết định thôi việc, biên bản thanh lý hợp đồng hoặc thỏa thuận chấm dứt (PDF hoặc ảnh).
    """
    allowed_types = ["application/pdf", "image/jpeg", "image/png", "image/webp"]
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Chỉ chấp nhận file PDF hoặc hình ảnh (JPG, PNG, WebP)")
    
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Dung lượng file không được vượt quá 10MB")
        
    from app.core.storage import upload_file_to_storage
    file_url = await upload_file_to_storage(
        content=content,
        filename=file.filename or "termination_document",
        folder="contract_terminations",
        content_type=file.content_type or "application/octet-stream"
    )

    return {
        "message": "Upload chứng từ chấm dứt thành công!",
        "file_url": file_url,
        "filename": file.filename
    }


@router.post("/sync-employee-statuses", summary="Đồng bộ trạng thái nhân viên và tài khoản theo hiệu lực hợp đồng")
async def sync_employee_statuses(
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Quét qua toàn bộ nhân viên và tài khoản người dùng để đồng bộ trạng thái phù hợp với hợp đồng:
    - Nhân viên còn HĐ ACTIVE: employment_status = ACTIVE, tài khoản mở.
    - Nhân viên hết HĐ ACTIVE:
      + Đã TERMINATED: employment_status = TERMINATED, tài khoản khóa.
      + Đã EXPIRED: employment_status = RESIGNED, tài khoản khóa.
    """
    res = await db.execute(text("""
        SELECT 
            e.employee_id, e.employee_code, e.full_name, e.employment_status, e.resignation_date,
            u.user_id, u.username, u.is_active as user_active,
            COUNT(c.contract_id) as total_contracts,
            COUNT(c.contract_id) FILTER (WHERE c.status = 'ACTIVE') as active_contracts,
            COUNT(c.contract_id) FILTER (WHERE c.status = 'EXPIRED') as expired_contracts,
            COUNT(c.contract_id) FILTER (WHERE c.status = 'TERMINATED') as terminated_contracts,
            MAX(c.end_date) as max_end_date,
            MAX(c.termination_date) as max_termination_date
        FROM employees e
        LEFT JOIN users u ON e.employee_id = u.employee_id
        LEFT JOIN contracts c ON e.employee_id = c.employee_id
        GROUP BY e.employee_id, e.employee_code, e.full_name, e.employment_status, e.resignation_date, u.user_id, u.username, u.is_active
        ORDER BY e.employee_id;
    """))
    rows = res.mappings().fetchall()

    updates = []
    for r in rows:
        emp_id = r["employee_id"]
        curr_emp_status = r["employment_status"]
        curr_user_active = r["user_active"]
        active_cnt = r["active_contracts"]
        term_cnt = r["terminated_contracts"]
        exp_cnt = r["expired_contracts"]
        total_cnt = r["total_contracts"]
        
        target_emp_status = curr_emp_status
        target_user_active = curr_user_active
        target_resignation_date = r["resignation_date"]
        
        if active_cnt > 0:
            if curr_emp_status in ["RESIGNED", "TERMINATED"]:
                target_emp_status = "ACTIVE"
                target_resignation_date = None
            if curr_user_active is False:
                target_user_active = True
        elif total_cnt > 0 and active_cnt == 0:
            if term_cnt > 0:
                target_emp_status = "TERMINATED"
                target_user_active = False
                if not target_resignation_date:
                    target_resignation_date = r["max_termination_date"] or r["max_end_date"]
            elif exp_cnt > 0:
                target_emp_status = "RESIGNED"
                target_user_active = False
                if not target_resignation_date:
                    target_resignation_date = r["max_end_date"]
        elif total_cnt == 0:
            if curr_emp_status in ["RESIGNED", "TERMINATED"] and curr_user_active is not None:
                target_user_active = False
        
        needs_update = (target_emp_status != curr_emp_status or 
                        target_user_active != curr_user_active or 
                        target_resignation_date != r["resignation_date"])
        
        if needs_update:
            updates.append({
                "employee_id": emp_id,
                "name": r["full_name"],
                "old_status": curr_emp_status,
                "new_status": target_emp_status
            })
            await db.execute(text("""
                UPDATE employees 
                SET employment_status = :status,
                    resignation_date = :res_date,
                    updated_at = CURRENT_TIMESTAMP
                WHERE employee_id = :emp_id
            """), {
                "status": target_emp_status,
                "res_date": target_resignation_date,
                "emp_id": emp_id
            })
            
            if r["user_id"]:
                await db.execute(text("""
                    UPDATE users
                    SET is_active = :is_active,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = :uid
                """), {
                    "is_active": target_user_active,
                    "uid": r["user_id"]
                })

    await db.commit()

    return {
        "message": f"Đã quét và đồng bộ thành công {len(updates)} nhân viên và tài khoản!",
        "synchronized_count": len(updates),
        "details": updates
    }


# ===============================================================================
# 8. HỦY HỢP ĐỒNG
# ===============================================================================

@router.post("/{contract_id}/cancel", summary="Hủy hợp đồng")
async def cancel_contract(
    contract_id: int,
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Hủy hợp đồng: DRAFT -> CANCELLED

    Validation:
    - Contract ở trạng thái DRAFT
    """
    # Get current contract
    current_contract = await ContractService.check_contract_exists(db, contract_id)

    # Validate state transition
    ContractService.check_state_transition(current_contract["status"], ContractStatus.CANCELLED)

    user_id = current_user.get("user_id")

    # Update contract
    query = text("""
        UPDATE contracts
        SET status = 'CANCELLED',
            updated_at = CURRENT_TIMESTAMP
        WHERE contract_id = :contract_id
    """)

    await db.execute(query, {"contract_id": contract_id})

    # Audit log
    await record_audit_log(
        db=db,
        user_id=user_id,
        action="CONTRACT_CANCELLED",
        entity_name="contract",
        entity_id=str(contract_id),
        old_values={"status": current_contract["status"]},
        new_values={"status": "CANCELLED"}
    )

    await db.commit()

    return {
        "message": "Hủy hợp đồng thành công!",
        "contract_id": contract_id,
        "status": "CANCELLED"
    }


# ===============================================================================
# 9. LỊCH SỬ HỢP ĐỒNG NHÂN VIÊN
# ===============================================================================

@router.get("/employee/{employee_id}/history", summary="Lịch sử hợp đồng của nhân viên")
async def get_employee_contract_history(
    employee_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Lấy lịch sử hợp đồng của một nhân viên.
    Bao gồm cả hợp đồng cũ và hiện tại.
    """
    roles = current_user.get("roles", [])
    is_hr = "ADMIN" in roles or "HR_MANAGER" in roles

    # Check access
    if not is_hr:
        if "STORE_MANAGER" in roles:
            # Check if employee in their store
            emp_query = text("""
                SELECT store_id FROM employees WHERE employee_id = :employee_id
            """)
            res = await db.execute(emp_query, {"employee_id": employee_id})
            emp = res.mappings().first()
            if not emp or emp["store_id"] != current_user.get("store_id"):
                raise HTTPException(status_code=403, detail="Không có quyền xem hợp đồng nhân viên này")
        else:
            # Employee can only view their own
            if current_user.get("employee_id") != employee_id:
                raise HTTPException(status_code=403, detail="Không có quyền xem hợp đồng nhân viên này")

    query = text("""
        SELECT c.contract_id, c.contract_number, c.contract_type,
               c.start_date, c.end_date, c.basic_salary, c.status,
               c.termination_date, c.termination_reason,
               p.position_name, d.department_name,
               c.created_at, c.activated_at
        FROM contracts c
        LEFT JOIN positions p ON c.position_id = p.position_id
        LEFT JOIN departments d ON c.department_id = d.department_id
        WHERE c.employee_id = :employee_id
        ORDER BY c.start_date DESC
    """)

    res = await db.execute(query, {"employee_id": employee_id})
    contracts = res.mappings().all()

    # Mask sensitive fields for non-HR
    if not is_hr:
        for c in contracts:
            c = dict(c)
            c["basic_salary"] = None
            c["termination_reason"] = None

    return contracts


# ===============================================================================
# 10. UPLOAD FILE HỢP ĐỒNG
# ===============================================================================

@router.post("/{contract_id}/file", summary="Upload file hợp đồng")
async def upload_contract_file(
    contract_id: int,
    file: UploadFile = File(...),
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Upload file hợp đồng (PDF only, max 10MB).
    Sử dụng Cloudinary.
    """
    # Get current contract
    current_contract = await ContractService.check_contract_exists(db, contract_id)

    # Only allow upload for DRAFT contracts
    if current_contract["status"] != ContractStatus.DRAFT:
        raise HTTPException(
            status_code=409,
            detail="Chỉ có thể upload file cho hợp đồng ở trạng thái DRAFT"
        )

    # Validate file type
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Chỉ chấp nhận file PDF")

    # Read file content
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:  # 10MB
        raise HTTPException(status_code=400, detail="File không được quá 10MB")

    # Upload to Cloudinary or local storage fallback
    from app.core.storage import upload_file_to_storage
    file_url = await upload_file_to_storage(
        content=content,
        filename=file.filename or f"contract_{contract_id}.pdf",
        folder="contracts",
        content_type=file.content_type or "application/pdf"
    )

    # Update contract
    query = text("""
        UPDATE contracts
        SET contract_file_url = :file_url,
            updated_at = CURRENT_TIMESTAMP
        WHERE contract_id = :contract_id
    """)
    await db.execute(query, {"contract_id": contract_id, "file_url": file_url})

    # Audit log
    await record_audit_log(
        db=db,
        user_id=current_user.get("user_id"),
        action="CONTRACT_FILE_UPLOADED",
        entity_name="contract",
        entity_id=str(contract_id),
        new_values={"file_url": file_url}
    )

    await db.commit()

    return {
        "message": "Upload file thành công!",
        "file_url": file_url
    }


@router.get("/{contract_id}/file", summary="Download/Tải file hợp đồng")
async def download_contract_file(
    contract_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Lấy URL file hợp đồng để tải về hoặc xem trực tiếp.
    """
    # Check access
    await ContractService.can_user_access_contract(db, current_user, contract_id)

    # Get contract
    contract = await ContractService.check_contract_exists(db, contract_id)

    if not contract.get("contract_file_url"):
        raise HTTPException(status_code=404, detail="Hợp đồng chưa có file đính kèm")

    return {
        "file_url": contract["contract_file_url"]
    }


# ===============================================================================
# 11. CẬP NHẬT TRẠNG THÁI HẾT HẠN (CRON JOB)
# ===============================================================================

@router.post("/cron/expire", summary="Cập nhật hợp đồng hết hạn (Cron Job)")
async def expire_contracts(
    current_user: dict = Depends(require_roles(["ADMIN"])),  # Only admin can trigger
    db: AsyncSession = Depends(get_db)
):
    """
    Cập nhật các hợp đồng ACTIVE có end_date < today thành EXPIRED.
    Được gọi bởi cron job mỗi ngày.
    """
    query = text("""
        UPDATE contracts
        SET status = 'EXPIRED',
            updated_at = CURRENT_TIMESTAMP
        WHERE status = 'ACTIVE'
        AND end_date IS NOT NULL
        AND end_date < CURRENT_DATE
        RETURNING contract_id, contract_number, end_date
    """)

    result = await db.execute(query)
    expired_contracts = result.mappings().all()

    if expired_contracts:
        # Audit log for batch update
        await record_audit_log(
            db=db,
            user_id=current_user.get("user_id"),
            action="CONTRACTS_AUTO_EXPIRED",
            entity_name="contract",
            new_values={
                "count": len(expired_contracts),
                "contracts": [dict(c) for c in expired_contracts]
            }
        )
        await db.commit()

    return {
        "message": f"Cập nhật {len(expired_contracts)} hợp đồng hết hạn",
        "expired_count": len(expired_contracts)
    }
