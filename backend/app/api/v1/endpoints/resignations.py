"""
Resignation Management API Endpoints
Quản lý quy trình thôi việc: HR tiếp nhận và nhập đơn, phê duyệt/từ chối đơn thôi việc
"""
from datetime import date, datetime
from typing import Optional, List
import os
import base64
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.database import get_db
from app.api.deps import get_current_user, require_roles, record_audit_log
from app.core.resignation_service import ResignationService, ResignationStatus
from app.schemas.schemas import (
    ResignationCreate,
    ResignationApprove,
    ResignationReject,
    ResignationOut,
)

router = APIRouter()


# ===============================================================================
# 1. THỐNG KÊ ĐƠN THÔI VIỆC
# ===============================================================================

@router.get("/stats", summary="Thống kê đơn thôi việc theo trạng thái")
async def get_resignation_stats(
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER", "DIRECTOR"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Thống kê số lượng đơn: Tổng, Chờ duyệt (Pending), Đã duyệt (Approved), Đã từ chối (Rejected), Đã hủy (Cancelled).
    """
    return await ResignationService.get_stats(db)


# ===============================================================================
# 2. DANH SÁCH HỢP ĐỒNG ACTIVE CỦA NHÂN VIÊN (Phục vụ form tạo đơn)
# ===============================================================================

@router.get("/employee-active-contracts/{employee_id}", summary="Lấy hợp đồng đang hiệu lực của nhân viên")
async def get_employee_active_contracts(
    employee_id: int,
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER", "DIRECTOR"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Trả về danh sách hợp đồng đang ACTIVE để HR chọn khi tạo đơn thôi việc cho nhân viên.
    """
    return await ResignationService.get_employee_active_contracts(db, employee_id)


# ===============================================================================
# 3. DANH SÁCH ĐƠN THÔI VIỆC
# ===============================================================================

@router.get("", summary="Danh sách đơn xin thôi việc")
async def list_resignations(
    status: Optional[str] = Query(None, description="Lọc theo trạng thái (PENDING, APPROVED, REJECTED, CANCELLED)"),
    employee_id: Optional[int] = Query(None, description="Lọc theo nhân viên"),
    store_id: Optional[int] = Query(None, description="Lọc theo cửa hàng"),
    department_id: Optional[int] = Query(None, description="Lọc theo phòng ban"),
    search: Optional[str] = Query(None, description="Tìm theo tên/mã NV hoặc số HĐ"),
    page: int = Query(1, ge=1, description="Trang hiện tại"),
    page_size: int = Query(20, ge=1, le=100, description="Số dòng mỗi trang"),
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER", "DIRECTOR"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Danh sách đơn thôi việc do HR quản lý, hỗ trợ phân trang và tìm kiếm.
    """
    conditions = []
    params = {}

    if status:
        conditions.append("r.status = :status")
        params["status"] = status.upper()

    if employee_id:
        conditions.append("r.employee_id = :employee_id")
        params["employee_id"] = employee_id

    if store_id:
        conditions.append("e.store_id = :store_id")
        params["store_id"] = store_id

    if department_id:
        conditions.append("e.department_id = :department_id")
        params["department_id"] = department_id

    if search:
        search_pattern = f"%{search.strip()}%"
        conditions.append("""
            (e.full_name ILIKE :search 
             OR e.employee_code ILIKE :search 
             OR c.contract_number ILIKE :search
             OR r.reason ILIKE :search)
        """)
        params["search"] = search_pattern

    where_clause = "WHERE " + " AND ".join(conditions) if conditions else ""

    # Count total
    count_query = text(f"""
        SELECT COUNT(*) as total
        FROM resignation_requests r
        JOIN employees e ON r.employee_id = e.employee_id
        JOIN contracts c ON r.contract_id = c.contract_id
        {where_clause}
    """)
    count_res = await db.execute(count_query, params)
    total = count_res.mappings().first()["total"]

    # Fetch rows
    offset = (page - 1) * page_size
    params["limit"] = page_size
    params["offset"] = offset

    data_query = text(f"""
        SELECT 
            r.resignation_id, r.employee_id, r.contract_id,
            r.submitted_date, r.requested_last_working_date,
            r.reason, r.attachment_url, r.notes, r.status,
            r.rejection_reason, r.approved_last_working_date,
            r.created_by, r.approved_by, r.approved_at,
            r.created_at, r.updated_at,
            e.employee_code, e.full_name as employee_name,
            e.department_id, d.department_name,
            e.position_id, p.position_name,
            e.store_id, s.store_name,
            c.contract_number, c.contract_type,
            c.start_date as contract_start_date, c.end_date as contract_end_date,
            u_creator.username as created_by_name,
            u_approver.username as approved_by_name,
            EXISTS (
                SELECT 1 FROM user_roles ur2
                JOIN roles r2 ON ur2.role_id = r2.role_id
                JOIN users u2 ON ur2.user_id = u2.user_id
                WHERE u2.employee_id = r.employee_id AND r2.role_code IN ('HR_MANAGER', 'ADMIN')
            ) as is_hr_or_admin_request
        FROM resignation_requests r
        JOIN employees e ON r.employee_id = e.employee_id
        JOIN contracts c ON r.contract_id = c.contract_id
        LEFT JOIN departments d ON e.department_id = d.department_id
        LEFT JOIN positions p ON e.position_id = p.position_id
        LEFT JOIN stores s ON e.store_id = s.store_id
        LEFT JOIN users u_creator ON r.created_by = u_creator.user_id
        LEFT JOIN users u_approver ON r.approved_by = u_approver.user_id
        {where_clause}
        ORDER BY r.created_at DESC
        LIMIT :limit OFFSET :offset
    """)

    data_res = await db.execute(data_query, params)
    rows = [dict(r) for r in data_res.mappings().fetchall()]

    return {
        "items": rows,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size if page_size > 0 else 0
    }


# ===============================================================================
# 4. CHI TIẾT ĐƠN THÔI VIỆC
# ===============================================================================

@router.get("/{resignation_id}", summary="Chi tiết đơn thôi việc")
async def get_resignation_detail(
    resignation_id: int,
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER", "DIRECTOR"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Lấy thông tin chi tiết một đơn thôi việc, bao gồm thông tin nhân viên, hợp đồng và lịch sử xử lý.
    """
    return await ResignationService.get_resignation_or_404(db, resignation_id)


# ===============================================================================
# 5. TẠO ĐƠN THÔI VIỆC (HR Tạo dựa trên đơn giấy/PDF nhận từ nhân viên)
# ===============================================================================

@router.post("", summary="Tạo đơn thôi việc cho nhân viên")
async def create_resignation(
    resignation_in: ResignationCreate,
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER", "DIRECTOR"])),
    db: AsyncSession = Depends(get_db)
):
    """
    HR/Admin nhập đơn thôi việc cho nhân viên:
    - Nhân viên nộp đơn giấy/PDF
    - HR tiếp nhận và nhập vào hệ thống
    - Trạng thái ban đầu: PENDING
    """
    # 1. Validate business rules
    context = await ResignationService.validate_create(
        db=db,
        employee_id=resignation_in.employee_id,
        contract_id=resignation_in.contract_id,
        submitted_date=resignation_in.submitted_date,
        requested_last_working_date=resignation_in.requested_last_working_date
    )

    user_id = current_user.get("user_id")

    # 2. Insert record
    insert_query = text("""
        INSERT INTO resignation_requests (
            employee_id, contract_id, submitted_date,
            requested_last_working_date, reason, attachment_url,
            notes, status, created_by
        ) VALUES (
            :employee_id, :contract_id, :submitted_date,
            :requested_last_working_date, :reason, :attachment_url,
            :notes, 'PENDING', :created_by
        )
        RETURNING resignation_id
    """)

    res = await db.execute(insert_query, {
        "employee_id": resignation_in.employee_id,
        "contract_id": resignation_in.contract_id,
        "submitted_date": resignation_in.submitted_date,
        "requested_last_working_date": resignation_in.requested_last_working_date,
        "reason": resignation_in.reason,
        "attachment_url": resignation_in.attachment_url,
        "notes": resignation_in.notes,
        "created_by": user_id
    })

    new_id = res.mappings().first()["resignation_id"]

    # 3. Audit log
    await record_audit_log(
        db=db,
        user_id=user_id,
        action="RESIGNATION_CREATED",
        entity_name="resignation_request",
        entity_id=str(new_id),
        new_values={
            "employee_id": resignation_in.employee_id,
            "contract_id": resignation_in.contract_id,
            "submitted_date": str(resignation_in.submitted_date),
            "requested_last_working_date": str(resignation_in.requested_last_working_date),
            "reason": resignation_in.reason,
            "status": "PENDING"
        }
    )

    await db.commit()

    return {
        "message": "Tạo đơn thôi việc thành công!",
        "resignation_id": new_id,
        "status": "PENDING"
    }


# ===============================================================================
# 6. DUYỆT ĐƠN THÔI VIỆC
# ===============================================================================

@router.post("/{resignation_id}/approve", summary="Duyệt đơn thôi việc")
async def approve_resignation(
    resignation_id: int,
    approve_data: ResignationApprove,
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER", "DIRECTOR"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Duyệt đơn thôi việc (No Self-Approval):
    - HR_MANAGER duyệt đơn của Employee/Store Manager.
    - DIRECTOR duyệt đơn của HR_MANAGER/ADMIN.
    - ADMIN duyệt mọi đơn.
    - LƯU Ý: Hợp đồng CHƯA bị chấm dứt ngay.
    """
    resignation = await ResignationService.get_resignation_or_404(db, resignation_id)

    if resignation["status"] != ResignationStatus.PENDING:
        raise HTTPException(
            status_code=400,
            detail=f"Chỉ có thể duyệt đơn ở trạng thái PENDING. Trạng thái hiện tại: {resignation['status']}"
        )

    if approve_data.approved_last_working_date < resignation["submitted_date"]:
        raise HTTPException(
            status_code=400,
            detail="Ngày làm việc cuối cùng được duyệt không được trước ngày nộp đơn"
        )

    user_roles = current_user.get("roles", [])
    user_id = current_user.get("user_id")
    emp_id = current_user.get("employee_id")

    # ===== NO SELF-APPROVAL CHECK =====
    if emp_id and resignation["employee_id"] == emp_id:
        raise HTTPException(
            status_code=400,
            detail="Không thể tự phê duyệt đơn thôi việc của chính mình (nguyên tắc No Self-Approval)."
        )

    # Lấy roles của người thôi việc
    applicant_roles_res = await db.execute(text("""
        SELECT DISTINCT r.role_code
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.role_id
        JOIN users u ON ur.user_id = u.user_id
        WHERE u.employee_id = :eid
    """), {"eid": resignation["employee_id"]})
    applicant_roles = [r["role_code"] for r in applicant_roles_res.mappings().all()]

    is_hr_or_admin_resigner = any(r in applicant_roles for r in ("HR_MANAGER", "ADMIN"))
    is_director = "DIRECTOR" in user_roles
    is_admin = "ADMIN" in user_roles
    is_hr = "HR_MANAGER" in user_roles

    # Đơn của HR/Admin BẮT BUỘC do DIRECTOR duyệt, không được HR hoặc Admin tự duyệt
    if is_hr_or_admin_resigner and not is_director:
        raise HTTPException(
            status_code=403,
            detail="Đơn thôi việc của Trưởng phòng Nhân sự / Quản trị viên chỉ được Giám đốc phê duyệt (nguyên tắc No Self-Approval)."
        )

    # DIRECTOR chỉ duyệt đơn của HR/Admin
    if is_director and not is_hr_or_admin_resigner and not is_admin:
        raise HTTPException(
            status_code=403,
            detail="Giám đốc chỉ duyệt đơn thôi việc của Trưởng phòng Nhân sự / Quản trị viên."
        )

    update_query = text("""
        UPDATE resignation_requests
        SET status = 'APPROVED',
            approved_last_working_date = :approved_last_working_date,
            approved_by = :approved_by,
            approved_at = CURRENT_TIMESTAMP,
            notes = COALESCE(:notes, notes),
            updated_at = CURRENT_TIMESTAMP
        WHERE resignation_id = :resignation_id
    """)

    await db.execute(update_query, {
        "resignation_id": resignation_id,
        "approved_last_working_date": approve_data.approved_last_working_date,
        "approved_by": user_id,
        "notes": approve_data.notes
    })

    # Audit log
    await record_audit_log(
        db=db,
        user_id=user_id,
        action="RESIGNATION_APPROVED",
        entity_name="resignation_request",
        entity_id=str(resignation_id),
        old_values={"status": resignation["status"]},
        new_values={
            "status": "APPROVED",
            "approved_last_working_date": str(approve_data.approved_last_working_date),
            "approved_by": user_id
        }
    )

    await db.commit()

    return {
        "message": "Duyệt đơn thôi việc thành công! Hợp đồng vẫn giữ hiệu lực đến ngày làm việc cuối cùng.",
        "resignation_id": resignation_id,
        "status": "APPROVED",
        "approved_last_working_date": str(approve_data.approved_last_working_date)
    }


# ===============================================================================
# 7. TỪ CHỐI ĐƠN THÔI VIỆC
# ===============================================================================

@router.post("/{resignation_id}/reject", summary="Từ chối đơn thôi việc")
async def reject_resignation(
    resignation_id: int,
    reject_data: ResignationReject,
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER", "DIRECTOR"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Từ chối đơn thôi việc:
    - Bắt buộc nhập lý do từ chối
    - Chuyển trạng thái sang REJECTED
    - Hợp đồng và tài khoản nhân viên vẫn giữ nguyên
    """
    resignation = await ResignationService.get_resignation_or_404(db, resignation_id)

    if resignation["status"] != ResignationStatus.PENDING:
        raise HTTPException(
            status_code=400,
            detail=f"Chỉ có thể từ chối đơn ở trạng thái PENDING. Trạng thái hiện tại: {resignation['status']}"
        )

    user_id = current_user.get("user_id")
    emp_id = current_user.get("employee_id")
    user_roles = current_user.get("roles", [])

    # ===== NO SELF-APPROVAL CHECK =====
    if emp_id and resignation["employee_id"] == emp_id:
        raise HTTPException(
            status_code=400,
            detail="Không thể tự từ chối đơn thôi việc của chính mình (nguyên tắc No Self-Approval)."
        )

    # Lấy roles của người thôi việc
    applicant_roles_res = await db.execute(text("""
        SELECT DISTINCT r.role_code
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.role_id
        JOIN users u ON ur.user_id = u.user_id
        WHERE u.employee_id = :eid
    """), {"eid": resignation["employee_id"]})
    applicant_roles = [r["role_code"] for r in applicant_roles_res.mappings().all()]

    is_hr_or_admin_resigner = any(r in applicant_roles for r in ("HR_MANAGER", "ADMIN"))
    is_director = "DIRECTOR" in user_roles
    is_admin = "ADMIN" in user_roles

    # Đơn của HR/Admin BẮT BUỘC do DIRECTOR từ chối
    if is_hr_or_admin_resigner and not is_director:
        raise HTTPException(
            status_code=403,
            detail="Đơn thôi việc của Trưởng phòng Nhân sự / Quản trị viên chỉ được Giám đốc từ chối (nguyên tắc No Self-Approval)."
        )

    # DIRECTOR chỉ xử lý đơn của HR/Admin
    if is_director and not is_hr_or_admin_resigner and not is_admin:
        raise HTTPException(
            status_code=403,
            detail="Giám đốc chỉ từ chối đơn thôi việc của Trưởng phòng Nhân sự / Quản trị viên."
        )

    update_query = text("""
        UPDATE resignation_requests
        SET status = 'REJECTED',
            rejection_reason = :rejection_reason,
            approved_by = :approved_by,
            approved_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE resignation_id = :resignation_id
    """)

    await db.execute(update_query, {
        "resignation_id": resignation_id,
        "rejection_reason": reject_data.rejection_reason,
        "approved_by": user_id
    })

    # Audit log
    await record_audit_log(
        db=db,
        user_id=user_id,
        action="RESIGNATION_REJECTED",
        entity_name="resignation_request",
        entity_id=str(resignation_id),
        old_values={"status": resignation["status"]},
        new_values={
            "status": "REJECTED",
            "rejection_reason": reject_data.rejection_reason,
            "rejected_by": user_id
        }
    )

    await db.commit()

    return {
        "message": "Từ chối đơn thôi việc thành công!",
        "resignation_id": resignation_id,
        "status": "REJECTED"
    }


# ===============================================================================
# 8. HỦY ĐƠN THÔI VIỆC
# ===============================================================================

@router.post("/{resignation_id}/cancel", summary="Hủy đơn thôi việc")
async def cancel_resignation(
    resignation_id: int,
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER", "DIRECTOR"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Hủy đơn thôi việc (khi nhân viên rút đơn hoặc nhập sai thông tin):
    - Chỉ cho phép khi đơn ở trạng thái PENDING
    - Chuyển sang CANCELLED
    """
    resignation = await ResignationService.get_resignation_or_404(db, resignation_id)

    if resignation["status"] != ResignationStatus.PENDING:
        raise HTTPException(
            status_code=400,
            detail=f"Chỉ có thể hủy đơn ở trạng thái PENDING. Trạng thái hiện tại: {resignation['status']}"
        )

    user_id = current_user.get("user_id")

    update_query = text("""
        UPDATE resignation_requests
        SET status = 'CANCELLED',
            updated_at = CURRENT_TIMESTAMP
        WHERE resignation_id = :resignation_id
    """)

    await db.execute(update_query, {"resignation_id": resignation_id})

    # Audit log
    await record_audit_log(
        db=db,
        user_id=user_id,
        action="RESIGNATION_CANCELLED",
        entity_name="resignation_request",
        entity_id=str(resignation_id),
        old_values={"status": resignation["status"]},
        new_values={"status": "CANCELLED"}
    )

    await db.commit()

    return {
        "message": "Hủy đơn thôi việc thành công!",
        "resignation_id": resignation_id,
        "status": "CANCELLED"
    }


# ===============================================================================
# 9. TẢI TẬP TIN ĐÍNH KÈM ĐƠN THÔI VIỆC (Đơn giấy scan / file PDF)
# ===============================================================================

@router.post("/upload-attachment", summary="Upload file đính kèm đơn thôi việc (PDF / Ảnh)")
async def upload_resignation_attachment(
    file: UploadFile = File(...),
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER", "DIRECTOR"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Upload file PDF hoặc ảnh chụp đơn thôi việc viết tay của nhân viên.
    Hỗ trợ Cloudinary nếu có cấu hình, fallback lưu vào thư mục static uploads.
    """
    allowed_types = ["application/pdf", "image/jpeg", "image/png", "image/webp"]
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail="Chỉ chấp nhận file PDF hoặc hình ảnh (JPG, PNG, WebP)"
        )

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:  # 10MB
        raise HTTPException(status_code=400, detail="Dung lượng file không được vượt quá 10MB")

    from app.core.storage import upload_file_to_storage
    file_url = await upload_file_to_storage(
        content=content,
        filename=file.filename or "resignation_attachment",
        folder="resignations",
        content_type=file.content_type or "application/octet-stream"
    )

    return {
        "message": "Upload file đính kèm thành công!",
        "file_url": file_url,
        "filename": file.filename
    }
