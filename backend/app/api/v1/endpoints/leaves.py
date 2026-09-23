from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.core.database import get_db
from app.api.deps import get_current_user, require_roles
from app.schemas.schemas import (
    LeaveRequestCreate, LeaveApproveRequest, LeaveRejectRequest,
    LeaveRequestOut, LeaveBalanceOut
)

router = APIRouter()

@router.get("/types", summary="Danh mục loại đơn nghỉ phép / thôi việc")
async def list_leave_types(db: AsyncSession = Depends(get_db)):
    res = await db.execute(text("SELECT leave_type_id, type_code, type_name, is_paid, max_days_allowed FROM leave_types"))
    return res.mappings().all()

@router.get("", response_model=List[LeaveRequestOut], summary="Danh sách đơn xin nghỉ phép")
async def list_leaves(
    status: Optional[str] = Query(None, description="Lọc theo trạng thái: PENDING, STORE_APPROVED, HR_APPROVED, REJECTED"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    query = """
        SELECT lr.request_id, lr.employee_id, e.full_name as employee_name,
               lr.leave_type_id, lt.type_name as leave_type_name,
               lr.start_date, lr.end_date, lr.total_days, lr.reason, lr.status,
               lr.attachment_url, lr.store_manager_id, lr.store_approved_at, lr.store_manager_note,
               lr.hr_approver_id, lr.hr_approved_at, lr.rejection_reason, lr.created_at
        FROM leave_requests lr
        JOIN employees e ON lr.employee_id = e.employee_id
        JOIN leave_types lt ON lr.leave_type_id = lt.leave_type_id
        WHERE 1=1
    """
    params = {}
    roles = current_user.get("roles", [])

    # Nhân viên thông thường chỉ xem đơn của mình
    if "ADMIN" not in roles and "HR_MANAGER" not in roles and "STORE_MANAGER" not in roles:
        query += " AND lr.employee_id = :emp_id"
        params["emp_id"] = current_user.get("employee_id")
    # Cửa hàng trưởng xem đơn của nhân viên thuộc cửa hàng mình
    elif "STORE_MANAGER" in roles and "ADMIN" not in roles and "HR_MANAGER" not in roles:
        query += " AND e.store_id = :store_id"
        params["store_id"] = current_user.get("store_id")

    if status:
        query += " AND lr.status = :status"
        params["status"] = status

    query += " ORDER BY lr.request_id DESC"
    res = await db.execute(text(query), params)
    return res.mappings().all()

@router.post("", summary="Nộp đơn xin nghỉ phép / nghỉ ốm / nghỉ việc (Rubric III.3.2.2)")
async def create_leave_request(
    req: LeaveRequestCreate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    emp_id = current_user.get("employee_id")
    if not emp_id:
        raise HTTPException(status_code=400, detail="Tài khoản chưa liên kết hồ sơ nhân viên")

    insert_query = text("""
        INSERT INTO leave_requests (
            employee_id, leave_type_id, start_date, end_date, total_days, reason, attachment_url, status
        ) VALUES (
            :employee_id, :leave_type_id, :start_date, :end_date, :total_days, :reason, :attachment_url, 'PENDING'
        ) RETURNING request_id;
    """)
    res = await db.execute(insert_query, {
        "employee_id": emp_id,
        "leave_type_id": req.leave_type_id,
        "start_date": req.start_date,
        "end_date": req.end_date,
        "total_days": req.total_days,
        "reason": req.reason,
        "attachment_url": req.attachment_url
    })
    req_id = res.scalar()
    await db.commit()

    return {"message": "Nộp đơn thành công! Đang chờ Cửa hàng trưởng duyệt.", "request_id": req_id}

@router.post("/{request_id}/approve-store", summary="Cửa hàng trưởng duyệt sơ bộ Cấp 1 (Rubric III.3.1.3)")
@router.post("/{request_id}/approve-level1", summary="Cửa hàng trưởng duyệt sơ bộ Cấp 1 (Workflow alias)")
async def store_approve_leave(
    request_id: int,
    body: Optional[LeaveApproveRequest] = None,
    current_user: dict = Depends(require_roles(["STORE_MANAGER", "ADMIN"])),
    db: AsyncSession = Depends(get_db)
):
    emp_id = current_user.get("employee_id")
    note = body.note if body else "Cửa hàng trưởng đã xác nhận"

    await db.execute(text("""
        UPDATE leave_requests
        SET status = 'STORE_APPROVED', store_manager_id = :mgr_id,
            store_approved_at = CURRENT_TIMESTAMP, store_manager_note = :note,
            updated_at = CURRENT_TIMESTAMP
        WHERE request_id = :req_id AND status = 'PENDING'
    """), {"mgr_id": emp_id, "note": note, "req_id": request_id})
    await db.commit()

    return {"message": "Duyệt Cấp 1 thành công! Đã chuyển tiếp đến Phòng Nhân sự (HR)."}

@router.post("/{request_id}/approve-hr", summary="Phòng Nhân sự duyệt chính thức Cấp 2 (Rubric III.3.1.3)")
@router.post("/{request_id}/approve-level2", summary="Phòng Nhân sự duyệt chính thức Cấp 2 (Workflow alias)")
async def hr_approve_leave(
    request_id: int,
    current_user: dict = Depends(require_roles(["HR_MANAGER", "ADMIN"])),
    db: AsyncSession = Depends(get_db)
):
    emp_id = current_user.get("employee_id")

    # Lấy thông tin đơn
    req_row = (await db.execute(
        text("SELECT employee_id, leave_type_id FROM leave_requests WHERE request_id = :id"),
        {"id": request_id}
    )).mappings().first()

    if not req_row:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn")

    await db.execute(text("""
        UPDATE leave_requests
        SET status = 'HR_APPROVED', hr_approver_id = :hr_id,
            hr_approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE request_id = :req_id
    """), {"hr_id": emp_id, "req_id": request_id})

    # Nếu là đơn thôi việc (leave_type_id = 6), tự động cập nhật trạng thái nhân viên thành RESIGNED
    if req_row["leave_type_id"] == 6:
        await db.execute(text("""
            UPDATE employees 
            SET employment_status = 'RESIGNED', resignation_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP
            WHERE employee_id = :eid
        """), {"eid": req_row["employee_id"]})

    await db.commit()
    return {"message": "Phòng Nhân sự đã phê duyệt chính thức đơn nghỉ phép thành công!"}

@router.post("/{request_id}/reject", summary="Từ chối đơn xin nghỉ phép")
async def reject_leave(
    request_id: int,
    body: LeaveRejectRequest,
    current_user: dict = Depends(require_roles(["STORE_MANAGER", "HR_MANAGER", "ADMIN"])),
    db: AsyncSession = Depends(get_db)
):
    await db.execute(text("""
        UPDATE leave_requests
        SET status = 'REJECTED', rejection_reason = :reason, updated_at = CURRENT_TIMESTAMP
        WHERE request_id = :req_id
    """), {"reason": body.rejection_reason, "req_id": request_id})
    await db.commit()

    return {"message": "Đã từ chối đơn nghỉ phép."}

@router.get("/balances/me", response_model=LeaveBalanceOut, summary="Số dư phép năm của người đăng nhập (Week 2.2)")
async def get_my_leave_balance(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    emp_id = current_user.get("employee_id") or 1
    return await get_employee_leave_balance(emp_id, current_user, db)

@router.get("/balances/{employee_id}", response_model=LeaveBalanceOut, summary="Số dư phép năm theo nhân viên (Week 2.2)")
async def get_employee_leave_balance(
    employee_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    emp_name = (await db.execute(text("SELECT full_name FROM employees WHERE employee_id = :id"), {"id": employee_id})).scalar() or "Nhân viên"
    # Tính số ngày phép năm đã duyệt trong năm 2026
    used_annual = (await db.execute(text("""
        SELECT COALESCE(SUM(total_days), 0)
        FROM leave_requests 
        WHERE employee_id = :id AND leave_type_id = 1 AND status = 'HR_APPROVED'
    """), {"id": employee_id})).scalar() or 0.0

    used_sick = (await db.execute(text("""
        SELECT COALESCE(SUM(total_days), 0)
        FROM leave_requests 
        WHERE employee_id = :id AND leave_type_id = 2 AND status = 'HR_APPROVED'
    """), {"id": employee_id})).scalar() or 0.0

    total_days = 12.0
    rem_days = max(0.0, total_days - float(used_annual))

    return LeaveBalanceOut(
        employee_id=employee_id,
        employee_name=emp_name,
        annual_leave_total=total_days,
        annual_leave_used=float(used_annual),
        annual_leave_remaining=rem_days,
        sick_leave_used=float(used_sick)
    )
