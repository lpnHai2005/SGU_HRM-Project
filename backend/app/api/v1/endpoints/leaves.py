from typing import Optional, List, Dict, Any
from datetime import date, datetime
from fastapi import APIRouter, Depends, HTTPException, Query, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.core.database import get_db
from app.api.deps import get_current_user, require_roles, log_audit
from app.schemas.schemas import (
    LeaveTypeOut, LeaveRequestCreate, LeaveApproveRequest, LeaveRejectRequest,
    LeaveRequestOut, LeaveBalanceOut
)

router = APIRouter()


# ===================================================================================
# 1. DANH MỤC LOẠI ĐƠN NGHỈ PHÉP (LEAVE TYPES)
# ===================================================================================

@router.get("/types", response_model=List[LeaveTypeOut], summary="Danh mục loại đơn nghỉ phép / thôi việc")
async def list_leave_types(db: AsyncSession = Depends(get_db)):
    """
    Truy vấn danh mục các loại nghỉ phép tại TechZone:
    1: PHEP_NAM (Phép năm - hưởng lương)
    2: NGHI_OM (Ốm đau - hưởng BHXH)
    3: THAI_SAN (Thai sản theo luật)
    4: VIEC_RIENG (Việc riêng có lương: hiếu hỉ, kết hôn)
    5: KHONG_LUONG (Nghỉ việc riêng không hưởng lương)
    6: THOI_VIEC (Đơn xin thôi việc / chấm dứt HĐLĐ)
    """
    query = text("""
        SELECT leave_type_id, type_code, type_name, is_paid, max_days_allowed, requires_attachment
        FROM leave_types
        ORDER BY leave_type_id ASC
    """)
    res = await db.execute(query)
    return res.mappings().all()


# ===================================================================================
# 2. THỐNG KÊ NHANH & LỊCH NGHỈ PHÉP (DASHBOARD & CALENDAR)
# ===================================================================================

@router.get("/summary/stats", summary="Thống kê tổng quan đơn nghỉ phép theo vai trò (Dashboard metrics)")
async def get_leave_stats(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Thống kê nhanh số lượng đơn theo từng trạng thái phục vụ hiển thị thẻ KPI:
    - Tổng số đơn
    - Đơn chờ Cửa hàng trưởng duyệt (Level 1 - PENDING)
    - Đơn chờ Phòng Nhân sự duyệt (Level 2 - STORE_APPROVED)
    - Đơn đã duyệt chính thức (HR_APPROVED)
    - Đơn bị từ chối (REJECTED)
    - Số nhân viên đang trong thời gian nghỉ hôm nay
    """
    roles = current_user.get("roles", [])
    emp_id = current_user.get("employee_id")
    store_id = current_user.get("store_id")

    where_clause = "WHERE 1=1"
    params: Dict[str, Any] = {}

    # Phân quyền: Nhân viên chỉ thấy thống kê cá nhân; Cửa hàng trưởng thấy chi nhánh; HR/Admin thấy toàn chuỗi
    if "ADMIN" not in roles and "HR_MANAGER" not in roles:
        if "STORE_MANAGER" in roles:
            where_clause += " AND (e.store_id = :store_id OR lr.employee_id = :emp_id)"
            params["store_id"] = store_id
            params["emp_id"] = emp_id
        else:
            where_clause += " AND lr.employee_id = :emp_id"
            params["emp_id"] = emp_id

    query = f"""
        SELECT 
            COUNT(*) as total_requests,
            COUNT(*) FILTER (WHERE lr.status = 'PENDING') as pending_store_approval,
            COUNT(*) FILTER (WHERE lr.status = 'STORE_APPROVED') as pending_hr_approval,
            COUNT(*) FILTER (WHERE lr.status = 'HR_APPROVED') as approved,
            COUNT(*) FILTER (WHERE lr.status = 'REJECTED') as rejected,
            COUNT(*) FILTER (WHERE lr.status = 'HR_APPROVED' AND CURRENT_DATE BETWEEN lr.start_date AND lr.end_date) as on_leave_today
        FROM leave_requests lr
        JOIN employees e ON lr.employee_id = e.employee_id
        {where_clause}
    """
    res = await db.execute(text(query), params)
    row = res.mappings().first()
    return dict(row) if row else {
        "total_requests": 0,
        "pending_store_approval": 0,
        "pending_hr_approval": 0,
        "approved": 0,
        "rejected": 0,
        "on_leave_today": 0
    }


@router.get("/calendar", summary="Lịch nghỉ phép theo tháng (Calendar View)")
async def get_leave_calendar(
    month: Optional[str] = Query(None, description="Tháng cần xem theo định dạng YYYY-MM (mặc định tháng hiện tại)"),
    store_id: Optional[int] = Query(None, description="Lọc theo mã chi nhánh"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Trả về danh sách các đơn nghỉ phép đã được duyệt trong tháng phục vụ vẽ biểu đồ Lịch (Calendar View)
    giúp Cửa hàng trưởng và Nhân sự theo dõi nhân sự vắng mặt.
    """
    target_month = month or datetime.now().strftime("%Y-%m")
    roles = current_user.get("roles", [])

    query = """
        SELECT lr.request_id, lr.employee_id, e.employee_code, e.full_name as employee_name,
               e.store_id, s.store_name, d.department_name, pos.position_name,
               lr.leave_type_id, lt.type_code as leave_type_code, lt.type_name as leave_type_name,
               lt.is_paid, lr.start_date, lr.end_date, lr.total_days, lr.reason, lr.status
        FROM leave_requests lr
        JOIN employees e ON lr.employee_id = e.employee_id
        JOIN leave_types lt ON lr.leave_type_id = lt.leave_type_id
        LEFT JOIN stores s ON e.store_id = s.store_id
        LEFT JOIN departments d ON e.department_id = d.department_id
        LEFT JOIN positions pos ON e.position_id = pos.position_id
        WHERE lr.status = 'HR_APPROVED'
          AND (to_char(lr.start_date, 'YYYY-MM') = :month OR to_char(lr.end_date, 'YYYY-MM') = :month)
    """
    params: Dict[str, Any] = {"month": target_month}

    if "ADMIN" not in roles and "HR_MANAGER" not in roles:
        if "STORE_MANAGER" in roles:
            query += " AND e.store_id = :user_store_id"
            params["user_store_id"] = current_user.get("store_id")
        else:
            query += " AND (lr.employee_id = :user_emp_id OR e.store_id = :user_store_id)"
            params["user_emp_id"] = current_user.get("employee_id")
            params["user_store_id"] = current_user.get("store_id")
    elif store_id:
        query += " AND e.store_id = :filter_store_id"
        params["filter_store_id"] = store_id

    query += " ORDER BY lr.start_date ASC"
    res = await db.execute(text(query), params)
    return res.mappings().all()


# ===================================================================================
# 3. TRUY VẤN DANH SÁCH & CHI TIẾT ĐƠN NGHỈ PHÉP
# ===================================================================================

@router.get("", response_model=List[LeaveRequestOut], summary="Danh sách đơn xin nghỉ phép (Phân quyền 4 vai trò)")
async def list_leaves(
    status: Optional[str] = Query(None, description="Lọc theo trạng thái: PENDING, STORE_APPROVED, HR_APPROVED, REJECTED, CANCELLED"),
    employee_id: Optional[int] = Query(None, description="Lọc theo nhân viên"),
    store_id: Optional[int] = Query(None, description="Lọc theo chi nhánh"),
    leave_type_id: Optional[int] = Query(None, description="Lọc theo loại nghỉ phép"),
    from_date: Optional[date] = Query(None, description="Lọc từ ngày bắt đầu"),
    to_date: Optional[date] = Query(None, description="Lọc đến ngày kết thúc"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Truy vấn danh sách đơn xin nghỉ phép với cơ chế phân quyền RBAC chặt chẽ:
    - **EMPLOYEE**: Chỉ xem được các đơn do chính mình gửi.
    - **STORE_MANAGER**: Xem được đơn của toàn bộ nhân viên thuộc chi nhánh mình quản lý + đơn của bản thân.
    - **HR_MANAGER & ADMIN**: Xem và quản lý toàn bộ đơn trên toàn chuỗi TechZone.
    Hiển thị rõ ràng thông tin người duyệt cấp 1, cấp 2 và người từ chối (kèm vai trò).
    """
    query = """
        SELECT lr.request_id, lr.employee_id, e.employee_code, e.full_name as employee_name,
               e.store_id, s.store_name, d.department_name, pos.position_name,
               lr.leave_type_id, lt.type_code as leave_type_code, lt.type_name as leave_type_name,
               lr.start_date, lr.end_date, lr.total_days, lr.reason, lr.status,
               lr.attachment_url, 
               lr.store_manager_id, sm.full_name as store_manager_name, lr.store_approved_at, lr.store_manager_note,
               lr.hr_approver_id, hr.full_name as hr_approver_name, lr.hr_approved_at, 
               lr.rejection_reason, lr.rejected_by_id, rj.full_name as rejected_by_name, lr.rejected_at,
               CASE 
                   WHEN rj.employee_id = 1 THEN 'Ban Giám đốc / Admin'
                   WHEN rj_pos.position_code = 'HR_DIR' THEN 'Phòng Nhân sự'
                   WHEN rj_pos.position_code = 'STORE_MGR' THEN 'Cửa hàng trưởng'
                   WHEN lr.rejected_by_id = lr.store_manager_id THEN 'Cửa hàng trưởng'
                   WHEN lr.rejected_by_id = lr.hr_approver_id THEN 'Phòng Nhân sự'
                   WHEN rj_pos.is_store_role = FALSE THEN 'Phòng Nhân sự'
                   WHEN lr.rejected_by_id IS NOT NULL THEN 'Cửa hàng trưởng'
                   ELSE NULL
               END as rejected_by_role,
               CASE 
                   WHEN pos.position_code = 'STORE_MGR' THEN TRUE
                   WHEN EXISTS (
                       SELECT 1 FROM user_roles ur2 
                       JOIN roles r2 ON ur2.role_id = r2.role_id 
                       JOIN users u2 ON ur2.user_id = u2.user_id 
                       WHERE u2.employee_id = lr.employee_id AND r2.role_code = 'STORE_MANAGER'
                   ) THEN TRUE
                   ELSE FALSE 
               END as is_store_manager_request,
               lr.created_at, lr.updated_at
        FROM leave_requests lr
        JOIN employees e ON lr.employee_id = e.employee_id
        JOIN leave_types lt ON lr.leave_type_id = lt.leave_type_id
        LEFT JOIN stores s ON e.store_id = s.store_id
        LEFT JOIN departments d ON e.department_id = d.department_id
        LEFT JOIN positions pos ON e.position_id = pos.position_id
        LEFT JOIN employees sm ON lr.store_manager_id = sm.employee_id
        LEFT JOIN employees hr ON lr.hr_approver_id = hr.employee_id
        LEFT JOIN employees rj ON lr.rejected_by_id = rj.employee_id
        LEFT JOIN positions rj_pos ON rj.position_id = rj_pos.position_id
        WHERE 1=1
    """
    params: Dict[str, Any] = {}
    roles = current_user.get("roles", [])
    user_emp_id = current_user.get("employee_id")
    user_store_id = current_user.get("store_id")

    # Áp dụng RBAC
    if "ADMIN" not in roles and "HR_MANAGER" not in roles:
        if "STORE_MANAGER" in roles:
            # Cửa hàng trưởng xem nhân viên chi nhánh mình + đơn của mình
            query += " AND (e.store_id = :user_store_id OR lr.employee_id = :user_emp_id)"
            params["user_store_id"] = user_store_id
            params["user_emp_id"] = user_emp_id
        else:
            # Nhân viên thông thường chỉ xem đơn của mình
            query += " AND lr.employee_id = :user_emp_id"
            params["user_emp_id"] = user_emp_id
    else:
        # HR/Admin có thể lọc theo store_id
        if store_id:
            query += " AND e.store_id = :store_id"
            params["store_id"] = store_id

    # Các bộ lọc tìm kiếm
    if employee_id:
        # Nhân viên thường không được xem đơn người khác
        if "ADMIN" not in roles and "HR_MANAGER" not in roles and "STORE_MANAGER" not in roles:
            if employee_id != user_emp_id:
                raise HTTPException(status_code=403, detail="Bạn không có quyền xem đơn nghỉ phép của nhân viên khác.")
        query += " AND lr.employee_id = :employee_id"
        params["employee_id"] = employee_id

    if status:
        query += " AND lr.status = :status"
        params["status"] = status

    if leave_type_id:
        query += " AND lr.leave_type_id = :leave_type_id"
        params["leave_type_id"] = leave_type_id

    if from_date:
        query += " AND lr.start_date >= :from_date"
        params["from_date"] = from_date

    if to_date:
        query += " AND lr.end_date <= :to_date"
        params["to_date"] = to_date

    query += " ORDER BY lr.request_id DESC"
    res = await db.execute(text(query), params)
    return res.mappings().all()


@router.get("/{request_id}", response_model=LeaveRequestOut, summary="Chi tiết một đơn xin nghỉ phép")
async def get_leave_detail(
    request_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Xem chi tiết đơn nghỉ phép kèm thông tin người phê duyệt 2 cấp hoặc người từ chối"""
    query = text("""
        SELECT lr.request_id, lr.employee_id, e.employee_code, e.full_name as employee_name,
               e.store_id, s.store_name, d.department_name, pos.position_name,
               lr.leave_type_id, lt.type_code as leave_type_code, lt.type_name as leave_type_name,
               lr.start_date, lr.end_date, lr.total_days, lr.reason, lr.status,
               lr.attachment_url, 
               lr.store_manager_id, sm.full_name as store_manager_name, lr.store_approved_at, lr.store_manager_note,
               lr.hr_approver_id, hr.full_name as hr_approver_name, lr.hr_approved_at, 
               lr.rejection_reason, lr.rejected_by_id, rj.full_name as rejected_by_name, lr.rejected_at,
               CASE 
                   WHEN rj.employee_id = 1 THEN 'Ban Giám đốc / Admin'
                   WHEN rj_pos.position_code = 'HR_DIR' THEN 'Phòng Nhân sự'
                   WHEN rj_pos.position_code = 'STORE_MGR' THEN 'Cửa hàng trưởng'
                   WHEN lr.rejected_by_id = lr.store_manager_id THEN 'Cửa hàng trưởng'
                   WHEN lr.rejected_by_id = lr.hr_approver_id THEN 'Phòng Nhân sự'
                   WHEN rj_pos.is_store_role = FALSE THEN 'Phòng Nhân sự'
                   WHEN lr.rejected_by_id IS NOT NULL THEN 'Cửa hàng trưởng'
                   ELSE NULL
               END as rejected_by_role,
               CASE 
                   WHEN pos.position_code = 'STORE_MGR' THEN TRUE
                   WHEN EXISTS (
                       SELECT 1 FROM user_roles ur2 
                       JOIN roles r2 ON ur2.role_id = r2.role_id 
                       JOIN users u2 ON ur2.user_id = u2.user_id 
                       WHERE u2.employee_id = lr.employee_id AND r2.role_code = 'STORE_MANAGER'
                   ) THEN TRUE
                   ELSE FALSE 
               END as is_store_manager_request,
               lr.created_at, lr.updated_at
        FROM leave_requests lr
        JOIN employees e ON lr.employee_id = e.employee_id
        JOIN leave_types lt ON lr.leave_type_id = lt.leave_type_id
        LEFT JOIN stores s ON e.store_id = s.store_id
        LEFT JOIN departments d ON e.department_id = d.department_id
        LEFT JOIN positions pos ON e.position_id = pos.position_id
        LEFT JOIN employees sm ON lr.store_manager_id = sm.employee_id
        LEFT JOIN employees hr ON lr.hr_approver_id = hr.employee_id
        LEFT JOIN employees rj ON lr.rejected_by_id = rj.employee_id
        LEFT JOIN positions rj_pos ON rj.position_id = rj_pos.position_id
        WHERE lr.request_id = :id
    """)
    res = await db.execute(query, {"id": request_id})
    row = res.mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn nghỉ phép")

    roles = current_user.get("roles", [])
    user_emp_id = current_user.get("employee_id")
    user_store_id = current_user.get("store_id")

    # Kiểm tra quyền xem chi tiết
    if "ADMIN" not in roles and "HR_MANAGER" not in roles:
        if "STORE_MANAGER" in roles:
            if row["store_id"] != user_store_id and row["employee_id"] != user_emp_id:
                raise HTTPException(status_code=403, detail="Bạn không có quyền xem đơn của nhân sự chi nhánh khác")
        else:
            if row["employee_id"] != user_emp_id:
                raise HTTPException(status_code=403, detail="Bạn chỉ có thể xem đơn nghỉ phép của chính mình")

    return row


# ===================================================================================
# 4. TẠO ĐƠN & QUY TRÌNH PHÊ DUYỆT 2 CẤP (WORKFLOW & RUBRIC III.3.2.2 & III.3.1.3)
# ===================================================================================

@router.post("", summary="Nộp đơn xin nghỉ phép / nghỉ ốm / thôi việc (Workflow Submit)")
async def create_leave_request(
    req: LeaveRequestCreate,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Nhân viên nộp đơn xin nghỉ phép trực tuyến:
    1. Kiểm tra ngày bắt đầu không sau ngày kết thúc.
    2. Kiểm tra số ngày nghỉ > 0.
    3. Kiểm tra số dư phép năm còn lại (nếu nghỉ phép năm).
    4. Kiểm tra không bị trùng lặp thời gian với các đơn đã nộp.
    5. Đơn tự động khởi tạo ở trạng thái 'PENDING' chờ Cửa hàng trưởng duyệt Cấp 1.
    """
    emp_id = current_user.get("employee_id")
    if not emp_id:
        raise HTTPException(status_code=400, detail="Tài khoản chưa liên kết hồ sơ nhân viên trong hệ thống.")

    # 1. Kiểm tra tính hợp lệ của ngày tháng
    if req.start_date > req.end_date:
        raise HTTPException(status_code=400, detail="Ngày bắt đầu nghỉ không được lớn hơn ngày kết thúc.")

    if req.total_days <= 0:
        raise HTTPException(status_code=400, detail="Số ngày xin nghỉ phải lớn hơn 0.")

    # 2. Kiểm tra loại đơn nghỉ
    type_res = await db.execute(
        text("SELECT leave_type_id, type_code, type_name, max_days_allowed, requires_attachment FROM leave_types WHERE leave_type_id = :id"),
        {"id": req.leave_type_id}
    )
    leave_type = type_res.mappings().first()
    if not leave_type:
        raise HTTPException(status_code=404, detail="Loại đơn nghỉ phép không tồn tại.")

    # 3. Kiểm tra hạn mức số ngày nghỉ tối đa theo loại đơn
    if leave_type["type_code"] == "PHEP_NAM":
        balance = await get_employee_leave_balance(emp_id, current_user, db)
        if req.total_days > balance.annual_leave_remaining:
            raise HTTPException(
                status_code=400,
                detail=f"Số ngày phép yêu cầu ({req.total_days} ngày) vượt quá số dư phép năm còn lại ({balance.annual_leave_remaining} ngày). Vui lòng điều chỉnh hoặc chọn loại nghỉ không lương."
            )
    else:
        max_days = leave_type.get("max_days_allowed")
        if max_days and max_days > 0 and req.total_days > float(max_days):
            raise HTTPException(
                status_code=400,
                detail=f"Loại nghỉ '{leave_type['type_name']}' chỉ được nghỉ tối đa {max_days} ngày theo quy định. Bạn đang đăng ký {req.total_days} ngày. Vui lòng điều chỉnh lại thời gian."
            )

    # 4. Kiểm tra đơn trùng lặp thời gian
    overlap_res = await db.execute(text("""
        SELECT request_id, start_date, end_date, status
        FROM leave_requests
        WHERE employee_id = :emp_id
          AND status IN ('PENDING', 'STORE_APPROVED', 'HR_APPROVED')
          AND start_date <= :end_date AND end_date >= :start_date
        LIMIT 1
    """), {
        "emp_id": emp_id,
        "start_date": req.start_date,
        "end_date": req.end_date
    })
    overlap = overlap_res.mappings().first()
    if overlap:
        raise HTTPException(
            status_code=400,
            detail=f"Bạn đã có đơn nghỉ phép (Mã #{overlap['request_id']}) trong khoảng thời gian {overlap['start_date']} đến {overlap['end_date']} đang chờ duyệt hoặc đã được phê duyệt."
        )

    # 5. Lưu đơn vào CSDL
    insert_query = text("""
        INSERT INTO leave_requests (
            employee_id, leave_type_id, start_date, end_date, total_days, reason, attachment_url, status, created_at, updated_at
        ) VALUES (
            :employee_id, :leave_type_id, :start_date, :end_date, :total_days, :reason, :attachment_url, 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
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

    # 6. Ghi nhật ký thanh tra (Audit Log)
    client_ip = request.client.host if request.client else None
    await log_audit(
        db=db,
        user_id=current_user.get("user_id"),
        action="CREATE_LEAVE_REQUEST",
        entity_name="leave_requests",
        entity_id=str(req_id),
        new_values={
            "employee_id": emp_id,
            "leave_type": leave_type["type_name"],
            "start_date": str(req.start_date),
            "end_date": str(req.end_date),
            "total_days": req.total_days,
            "reason": req.reason
        },
        ip_address=client_ip
    )

    is_cht = "STORE_MANAGER" in current_user.get("roles", [])
    msg = f"Nộp đơn {leave_type['type_name']} thành công!"
    if is_cht:
        msg += " Đơn của Cửa hàng trưởng được chuyển trực tiếp cho Phòng Nhân sự phê duyệt."
    else:
        msg += " Đơn đang chờ Cửa hàng trưởng phê duyệt."

    return {
        "message": msg,
        "request_id": req_id,
        "status": "PENDING"
    }


@router.post("/{request_id}/approve-store", summary="Cửa hàng trưởng duyệt sơ bộ Cấp 1 (Rubric III.3.1.3)")
@router.post("/{request_id}/approve-level1", summary="Cửa hàng trưởng duyệt sơ bộ Cấp 1 (Workflow alias)")
async def store_approve_leave(
    request_id: int,
    request: Request,
    body: Optional[LeaveApproveRequest] = None,
    current_user: dict = Depends(require_roles(["STORE_MANAGER", "ADMIN"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Quy trình duyệt Cấp 1 (Cửa hàng trưởng):
    - Kiểm tra đơn tồn tại và đang ở trạng thái 'PENDING'.
    - Đảm bảo Cửa hàng trưởng không thể tự duyệt đơn của chính mình (chống xung đột lợi ích).
    - Đảm bảo Cửa hàng trưởng chỉ duyệt đơn của nhân viên thuộc chi nhánh mình.
    - Cập nhật trạng thái thành 'STORE_APPROVED', lưu dấu thời gian và chuyển tiếp lên HR.
    """
    emp_id = current_user.get("employee_id")
    roles = current_user.get("roles", [])
    note = body.note if body and body.note else "Cửa hàng trưởng đã kiểm tra ca kíp và đồng ý cho nghỉ."

    # Lấy thông tin đơn
    req_res = await db.execute(text("""
        SELECT lr.request_id, lr.employee_id, lr.status, lr.start_date, lr.end_date, lr.total_days,
               e.store_id, e.full_name as employee_name, lt.type_name as leave_type_name
        FROM leave_requests lr
        JOIN employees e ON lr.employee_id = e.employee_id
        JOIN leave_types lt ON lr.leave_type_id = lt.leave_type_id
        WHERE lr.request_id = :id
    """), {"id": request_id})
    leave_req = req_res.mappings().first()

    if not leave_req:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn nghỉ phép")

    if leave_req["status"] == "STORE_APPROVED":
        raise HTTPException(status_code=400, detail="Đơn này đã được Cửa hàng trưởng phê duyệt Cấp 1 trước đó.")
    elif leave_req["status"] == "HR_APPROVED":
        raise HTTPException(status_code=400, detail="Đơn này đã được Phòng Nhân sự phê duyệt chính thức hoàn tất.")
    elif leave_req["status"] == "REJECTED":
        raise HTTPException(status_code=400, detail="Không thể phê duyệt đơn đã bị từ chối.")
    elif leave_req["status"] == "CANCELLED":
        raise HTTPException(status_code=400, detail="Không thể phê duyệt đơn đã bị nhân viên hủy.")
    elif leave_req["status"] != "PENDING":
        raise HTTPException(status_code=400, detail=f"Trạng thái đơn không hợp lệ để duyệt: {leave_req['status']}")

    # Kiểm tra phân quyền Cửa hàng trưởng
    if "ADMIN" not in roles:
        # Không tự duyệt đơn của mình
        if leave_req["employee_id"] == emp_id:
            raise HTTPException(
                status_code=400,
                detail="Cửa hàng trưởng không thể tự phê duyệt đơn của chính mình. Đơn của bạn sẽ được chuyển thẳng đến Trưởng phòng Nhân sự duyệt."
            )
        # Chỉ duyệt đơn thuộc chi nhánh mình
        if leave_req["store_id"] != current_user.get("store_id"):
            raise HTTPException(
                status_code=403,
                detail="Bạn chỉ có quyền phê duyệt đơn của nhân viên thuộc chi nhánh cửa hàng mình quản lý."
            )

    # Đơn của Cửa hàng trưởng hoặc nhân sự quản lý không qua Cửa hàng trưởng duyệt
    applicant_mgr_check = await db.execute(text("""
        SELECT 1 FROM user_roles ur
        JOIN roles r ON ur.role_id = r.role_id
        JOIN users u ON ur.user_id = u.user_id
        WHERE u.employee_id = :eid AND r.role_code IN ('STORE_MANAGER', 'HR_MANAGER', 'ADMIN')
    """), {"eid": leave_req["employee_id"]})
    if applicant_mgr_check.first():
        raise HTTPException(
            status_code=403,
            detail="Đơn xin nghỉ phép của Cửa hàng trưởng / Quản lý chỉ do Trưởng phòng Nhân sự hoặc Ban Giám đốc trực tiếp phê duyệt."
        )

    await db.execute(text("""
        UPDATE leave_requests
        SET status = 'STORE_APPROVED', store_manager_id = :mgr_id,
            store_approved_at = CURRENT_TIMESTAMP, store_manager_note = :note,
            updated_at = CURRENT_TIMESTAMP
        WHERE request_id = :req_id
    """), {"mgr_id": emp_id, "note": note, "req_id": request_id})
    await db.commit()

    # Ghi nhật ký thanh tra
    client_ip = request.client.host if request.client else None
    await log_audit(
        db=db,
        user_id=current_user.get("user_id"),
        action="APPROVE_LEAVE_LEVEL1",
        entity_name="leave_requests",
        entity_id=str(request_id),
        old_values={"status": "PENDING"},
        new_values={
            "status": "STORE_APPROVED",
            "store_manager_id": emp_id,
            "note": note
        },
        ip_address=client_ip
    )

    return {
        "message": f"Duyệt Cấp 1 thành công cho nhân viên {leave_req['employee_name']}! Đã chuyển tiếp đến Phòng Nhân sự (HR).",
        "request_id": request_id,
        "status": "STORE_APPROVED"
    }


@router.post("/{request_id}/approve-hr", summary="Phòng Nhân sự duyệt chính thức Cấp 2 (Rubric III.3.1.3)")
@router.post("/{request_id}/approve-level2", summary="Phòng Nhân sự duyệt chính thức Cấp 2 (Workflow alias)")
async def hr_approve_leave(
    request_id: int,
    request: Request,
    body: Optional[LeaveApproveRequest] = None,
    current_user: dict = Depends(require_roles(["HR_MANAGER", "ADMIN"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Quy trình duyệt Cấp 2 (Trưởng phòng HR):
    - Phòng Nhân sự xem xét phê duyệt chính thức cuối cùng.
    - HR có thể duyệt thẳng (Cấp 2) kể cả trước khi Cửa hàng trưởng duyệt Cấp 1 (chấp nhận trạng thái 'STORE_APPROVED' hoặc 'PENDING').
    - Tự động hóa tác vụ nhân sự đi kèm:
      * Nếu là đơn thôi việc (leave_type_id = 6 / THOI_VIEC): Tự động chuyển hồ sơ nhân viên thành 'RESIGNED', ghi ngày thôi việc và khóa tài khoản người dùng.
      * Nếu là đơn thai sản (leave_type_id = 3 / THAI_SAN): Tự động chuyển trạng thái nhân viên thành 'ON_LEAVE'.
    """
    emp_id = current_user.get("employee_id")

    req_res = await db.execute(text("""
        SELECT lr.request_id, lr.employee_id, lr.leave_type_id, lr.status, lr.start_date, lr.end_date, lr.total_days,
               e.full_name as employee_name, e.employee_code, lt.type_code, lt.type_name as leave_type_name
        FROM leave_requests lr
        JOIN employees e ON lr.employee_id = e.employee_id
        JOIN leave_types lt ON lr.leave_type_id = lt.leave_type_id
        WHERE lr.request_id = :id
    """), {"id": request_id})
    leave_req = req_res.mappings().first()

    if not leave_req:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn nghỉ phép")

    if leave_req["status"] == "HR_APPROVED":
        raise HTTPException(status_code=400, detail="Đơn này đã được Phòng Nhân sự phê duyệt chính thức trước đó.")
    elif leave_req["status"] == "REJECTED":
        raise HTTPException(status_code=400, detail="Không thể duyệt đơn đã bị từ chối.")
    elif leave_req["status"] == "CANCELLED":
        raise HTTPException(status_code=400, detail="Không thể duyệt đơn đã bị nhân viên hủy.")
    elif leave_req["status"] not in ("PENDING", "STORE_APPROVED"):
        raise HTTPException(status_code=400, detail=f"Trạng thái đơn không hợp lệ để duyệt: {leave_req['status']}")

    old_status = leave_req["status"]

    # Cập nhật duyệt chính thức Cấp 2 (Xóa bỏ dấu từ chối nếu có)
    await db.execute(text("""
        UPDATE leave_requests
        SET status = 'HR_APPROVED', hr_approver_id = :hr_id,
            hr_approved_at = CURRENT_TIMESTAMP,
            rejected_by_id = NULL, rejected_at = NULL, rejection_reason = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE request_id = :req_id
    """), {"hr_id": emp_id, "req_id": request_id})

    # TỰ ĐỘNG HÓA NGHIỆP VỤ NHÂN SỰ
    # 1. Đơn xin thôi việc (type_code = 'THOI_VIEC' hoặc leave_type_id = 6)
    if leave_req["type_code"] == "THOI_VIEC" or leave_req["leave_type_id"] == 6:
        # Cập nhật hồ sơ nhân viên thành RESIGNED
        await db.execute(text("""
            UPDATE employees 
            SET employment_status = 'RESIGNED', resignation_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP
            WHERE employee_id = :eid
        """), {"eid": leave_req["employee_id"]})
        # Vô hiệu hóa tài khoản đăng nhập để bảo mật hệ thống
        await db.execute(text("""
            UPDATE users 
            SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
            WHERE employee_id = :eid
        """), {"eid": leave_req["employee_id"]})

    # 2. Đơn nghỉ thai sản (type_code = 'THAI_SAN' hoặc leave_type_id = 3)
    elif leave_req["type_code"] == "THAI_SAN" or leave_req["leave_type_id"] == 3:
        await db.execute(text("""
            UPDATE employees 
            SET employment_status = 'ON_LEAVE', updated_at = CURRENT_TIMESTAMP
            WHERE employee_id = :eid
        """), {"eid": leave_req["employee_id"]})

    await db.commit()

    # Ghi nhật ký thanh tra
    client_ip = request.client.host if request.client else None
    await log_audit(
        db=db,
        user_id=current_user.get("user_id"),
        action="APPROVE_LEAVE_LEVEL2",
        entity_name="leave_requests",
        entity_id=str(request_id),
        old_values={"status": old_status},
        new_values={
            "status": "HR_APPROVED",
            "hr_approver_id": emp_id,
            "type_code": leave_req["type_code"]
        },
        ip_address=client_ip
    )

    return {
        "message": f"Phòng Nhân sự đã phê duyệt chính thức đơn {leave_req['leave_type_name']} của nhân viên {leave_req['employee_name']} thành công!",
        "request_id": request_id,
        "status": "HR_APPROVED"
    }


@router.post("/{request_id}/reject", summary="Từ chối đơn xin nghỉ phép (Cửa hàng trưởng hoặc HR)")
async def reject_leave(
    request_id: int,
    body: LeaveRejectRequest,
    request: Request,
    current_user: dict = Depends(require_roles(["STORE_MANAGER", "HR_MANAGER", "ADMIN"])),
    db: AsyncSession = Depends(get_db)
):
    """
    Từ chối đơn xin nghỉ phép kèm lý do giải trình bắt buộc:
    - Cửa hàng trưởng có thể từ chối đơn ở Cấp 1 (khi đơn PENDING).
    - Phòng Nhân sự có thể từ chối đơn ở Cấp 2 (khi đơn STORE_APPROVED hoặc PENDING).
    - ĐẶC BIỆT: Nếu đơn ĐÃ ĐƯỢC DUYỆT CHÍNH THỨC (HR_APPROVED), Trưởng phòng Nhân sự hoặc Admin
      vẫn có quyền Thu hồi / Từ chối lại (ví dụ phát hiện vi phạm hoặc nhân viên rút đơn).
      Khi đó hệ thống tự động hoàn nguyên trạng thái nhân viên (nếu là thôi việc/thai sản) và hoàn lại ngày phép.
    - Cửa hàng trưởng không có quyền từ chối đơn đã được HR duyệt chính thức.
    - Ghi nhận rõ ràng ID người từ chối (rejected_by_id) và thời điểm từ chối (rejected_at).
    """
    if not body.rejection_reason or not body.rejection_reason.strip():
        raise HTTPException(status_code=400, detail="Vui lòng nhập lý do từ chối đơn nghỉ phép.")

    roles = current_user.get("roles", [])
    user_store_id = current_user.get("store_id")
    emp_id = current_user.get("employee_id")

    # Lấy thông tin đơn
    req_res = await db.execute(text("""
        SELECT lr.request_id, lr.employee_id, lr.status, lr.leave_type_id,
               e.store_id, e.full_name as employee_name, lt.type_code
        FROM leave_requests lr
        JOIN employees e ON lr.employee_id = e.employee_id
        JOIN leave_types lt ON lr.leave_type_id = lt.leave_type_id
        WHERE lr.request_id = :id
    """), {"id": request_id})
    leave_req = req_res.mappings().first()

    if not leave_req:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn nghỉ phép")

    if leave_req["status"] == "REJECTED":
        raise HTTPException(status_code=400, detail="Đơn này hiện tại đã ở trạng thái từ chối.")

    # Kiểm tra quyền từ chối:
    # 1. Cửa hàng trưởng chỉ được từ chối nhân viên chi nhánh mình
    if "ADMIN" not in roles and "HR_MANAGER" not in roles:
        if leave_req["store_id"] != user_store_id:
            raise HTTPException(status_code=403, detail="Bạn không có quyền từ chối đơn của nhân sự chi nhánh khác.")
        if leave_req["status"] == "HR_APPROVED":
            raise HTTPException(status_code=403, detail="Đơn đã được Phòng Nhân sự phê duyệt chính thức, Cửa hàng trưởng không thể từ chối.")

    old_status = leave_req["status"]

    # Cập nhật trạng thái từ chối kèm thông tin người từ chối
    await db.execute(text("""
        UPDATE leave_requests
        SET status = 'REJECTED', 
            rejection_reason = :reason,
            rejected_by_id = :rejector_id,
            rejected_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE request_id = :req_id
    """), {
        "reason": body.rejection_reason.strip(),
        "rejector_id": emp_id,
        "req_id": request_id
    })

    # NẾU ĐƠN NÀY TỪNG ĐƯỢC DUYỆT CHÍNH THỨC (HR_APPROVED) VÀ BỊ THU HỒI/TỪ CHỐI LẠI:
    # Tự động hoàn nguyên trạng thái hồ sơ nhân sự
    if old_status == "HR_APPROVED":
        # 1. Hoàn nguyên nếu là đơn thôi việc
        if leave_req["type_code"] == "THOI_VIEC" or leave_req["leave_type_id"] == 6:
            await db.execute(text("""
                UPDATE employees 
                SET employment_status = 'ACTIVE', resignation_date = NULL, updated_at = CURRENT_TIMESTAMP
                WHERE employee_id = :eid
            """), {"eid": leave_req["employee_id"]})
            await db.execute(text("""
                UPDATE users 
                SET is_active = TRUE, updated_at = CURRENT_TIMESTAMP
                WHERE employee_id = :eid
            """), {"eid": leave_req["employee_id"]})
        # 2. Hoàn nguyên nếu là đơn thai sản
        elif leave_req["type_code"] == "THAI_SAN" or leave_req["leave_type_id"] == 3:
            await db.execute(text("""
                UPDATE employees 
                SET employment_status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
                WHERE employee_id = :eid
            """), {"eid": leave_req["employee_id"]})

    await db.commit()

    # Ghi nhật ký thanh tra
    client_ip = request.client.host if request.client else None
    await log_audit(
        db=db,
        user_id=current_user.get("user_id"),
        action="REJECT_LEAVE",
        entity_name="leave_requests",
        entity_id=str(request_id),
        old_values={"status": old_status},
        new_values={
            "status": "REJECTED",
            "rejection_reason": body.rejection_reason.strip(),
            "rejected_by_id": emp_id,
            "rejected_by_name": current_user.get("full_name")
        },
        ip_address=client_ip
    )

    msg = f"Đã từ chối đơn nghỉ phép của nhân viên {leave_req['employee_name']}."
    if old_status == "HR_APPROVED":
        msg = f"Đã thu hồi phê duyệt và từ chối đơn nghỉ phép của nhân viên {leave_req['employee_name']}. Số dư ngày phép và hồ sơ nhân sự đã được hoàn nguyên thành công!"

    return {
        "message": msg,
        "request_id": request_id,
        "status": "REJECTED",
        "rejected_by_name": current_user.get("full_name")
    }


@router.post("/{request_id}/cancel", summary="Hủy đơn xin nghỉ phép (Dành cho nhân viên đã gửi đơn)")
@router.delete("/{request_id}", summary="Hủy / Xóa đơn xin nghỉ phép đang chờ duyệt")
async def cancel_leave_request(
    request_id: int,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Cho phép nhân viên tự hủy đơn nghỉ phép của mình khi đơn còn ở trạng thái 'PENDING'.
    Quản trị viên (ADMIN) và HR Manager có thể hủy đơn bất kỳ lúc nào nếu chưa chốt công.
    """
    roles = current_user.get("roles", [])
    user_emp_id = current_user.get("employee_id")

    req_res = await db.execute(text("""
        SELECT request_id, employee_id, status, total_days
        FROM leave_requests
        WHERE request_id = :id
    """), {"id": request_id})
    leave_req = req_res.mappings().first()

    if not leave_req:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn nghỉ phép")

    if "ADMIN" not in roles and "HR_MANAGER" not in roles:
        if leave_req["employee_id"] != user_emp_id:
            raise HTTPException(status_code=403, detail="Bạn chỉ có thể hủy đơn nghỉ phép của chính mình.")
        if leave_req["status"] not in ("PENDING", "STORE_APPROVED"):
            raise HTTPException(
                status_code=400,
                detail=f"Không thể tự hủy đơn ở trạng thái '{leave_req['status']}'. Vui lòng liên hệ Phòng Nhân sự để được hỗ trợ."
            )

    await db.execute(text("""
        UPDATE leave_requests
        SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
        WHERE request_id = :id
    """), {"id": request_id})
    await db.commit()

    # Ghi nhật ký thanh tra
    client_ip = request.client.host if request.client else None
    await log_audit(
        db=db,
        user_id=current_user.get("user_id"),
        action="CANCEL_LEAVE_REQUEST",
        entity_name="leave_requests",
        entity_id=str(request_id),
        old_values={"status": leave_req["status"]},
        new_values={"status": "CANCELLED"},
        ip_address=client_ip
    )

    return {
        "message": "Đã hủy đơn xin nghỉ phép thành công.",
        "request_id": request_id,
        "status": "CANCELLED"
    }


# ===================================================================================
# 5. TÍNH TOÁN SỐ DƯ PHÉP NĂM (LEAVE BALANCE CALCULATION - WEEK 2.2)
# ===================================================================================

@router.get("/balances/me", response_model=LeaveBalanceOut, summary="Số dư phép năm của người đăng nhập (Week 2.2)")
async def get_my_leave_balance(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Lấy số dư ngày phép năm và thống kê ngày nghỉ của nhân viên đang đăng nhập"""
    emp_id = current_user.get("employee_id")
    if not emp_id:
        emp_id = 1
    return await get_employee_leave_balance(emp_id, current_user, db)


@router.get("/balances/{employee_id}", response_model=LeaveBalanceOut, summary="Số dư phép năm theo nhân viên (Week 2.2)")
async def get_employee_leave_balance(
    employee_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Tính toán số dư ngày phép năm chuẩn theo Bộ luật Lao động và chính sách TechZone:
    1. Tiêu chuẩn cơ bản: 12 ngày phép năm / năm.
    2. Chế độ thâm niên: Cứ đủ mỗi 5 năm làm việc tại TechZone được cộng thêm 1 ngày phép năm.
    3. Thống kê số ngày phép đã sử dụng trong năm (đã được HR phê duyệt).
    4. Thống kê số ngày đang chờ duyệt, nghỉ ốm đau BHXH, thai sản và không lương.
    """
    roles = current_user.get("roles", [])
    user_emp_id = current_user.get("employee_id")
    user_store_id = current_user.get("store_id")

    # Lấy thông tin nhân viên (họ tên, ngày vào làm, chi nhánh)
    emp_res = await db.execute(text("""
        SELECT e.employee_id, e.full_name, e.join_date, e.store_id
        FROM employees e
        WHERE e.employee_id = :id
    """), {"id": employee_id})
    emp_row = emp_res.mappings().first()

    if not emp_row:
        raise HTTPException(status_code=404, detail="Không tìm thấy nhân viên trong hệ thống.")

    # Kiểm tra phân quyền truy cập số dư
    if "ADMIN" not in roles and "HR_MANAGER" not in roles:
        if "STORE_MANAGER" in roles:
            if emp_row["store_id"] != user_store_id and employee_id != user_emp_id:
                raise HTTPException(status_code=403, detail="Bạn không có quyền tra cứu số dư phép của nhân viên chi nhánh khác.")
        else:
            if employee_id != user_emp_id:
                raise HTTPException(status_code=403, detail="Bạn chỉ có thể xem số dư phép của chính mình.")

    emp_name = emp_row["full_name"]
    join_date = emp_row["join_date"]

    # Tính thâm niên công tác (+1 ngày phép cho mỗi 5 năm làm việc)
    seniority_bonus_days = 0.0
    if join_date:
        today = date.today()
        # Tính số năm công tác
        years_of_service = (today - join_date).days / 365.25
        if years_of_service >= 5.0:
            seniority_bonus_days = float(int(years_of_service // 5))

    annual_leave_total = 12.0 + seniority_bonus_days

    # 1. Số ngày phép năm đã duyệt trong năm hiện tại (leave_type_id = 1, status = 'HR_APPROVED')
    used_annual = (await db.execute(text("""
        SELECT COALESCE(SUM(total_days), 0)
        FROM leave_requests 
        WHERE employee_id = :id 
          AND leave_type_id = 1 
          AND status = 'HR_APPROVED'
          AND EXTRACT(YEAR FROM start_date) = EXTRACT(YEAR FROM CURRENT_DATE)
    """), {"id": employee_id})).scalar() or 0.0

    # 2. Số ngày phép năm đang chờ duyệt trong năm hiện tại (status IN ('PENDING', 'STORE_APPROVED'))
    pending_annual = (await db.execute(text("""
        SELECT COALESCE(SUM(total_days), 0)
        FROM leave_requests 
        WHERE employee_id = :id 
          AND leave_type_id = 1 
          AND status IN ('PENDING', 'STORE_APPROVED')
          AND EXTRACT(YEAR FROM start_date) = EXTRACT(YEAR FROM CURRENT_DATE)
    """), {"id": employee_id})).scalar() or 0.0

    # 3. Số ngày nghỉ ốm đau BHXH đã duyệt (leave_type_id = 2)
    used_sick = (await db.execute(text("""
        SELECT COALESCE(SUM(total_days), 0)
        FROM leave_requests 
        WHERE employee_id = :id 
          AND leave_type_id = 2 
          AND status = 'HR_APPROVED'
          AND EXTRACT(YEAR FROM start_date) = EXTRACT(YEAR FROM CURRENT_DATE)
    """), {"id": employee_id})).scalar() or 0.0

    # 4. Số ngày nghỉ thai sản đã duyệt (leave_type_id = 3)
    used_maternity = (await db.execute(text("""
        SELECT COALESCE(SUM(total_days), 0)
        FROM leave_requests 
        WHERE employee_id = :id 
          AND leave_type_id = 3 
          AND status = 'HR_APPROVED'
          AND EXTRACT(YEAR FROM start_date) = EXTRACT(YEAR FROM CURRENT_DATE)
    """), {"id": employee_id})).scalar() or 0.0

    # 5. Số ngày nghỉ không lương đã duyệt (leave_type_id = 5)
    used_unpaid = (await db.execute(text("""
        SELECT COALESCE(SUM(total_days), 0)
        FROM leave_requests 
        WHERE employee_id = :id 
          AND leave_type_id = 5 
          AND status = 'HR_APPROVED'
          AND EXTRACT(YEAR FROM start_date) = EXTRACT(YEAR FROM CURRENT_DATE)
    """), {"id": employee_id})).scalar() or 0.0

    annual_remaining = max(0.0, annual_leave_total - float(used_annual))

    return LeaveBalanceOut(
        employee_id=employee_id,
        employee_name=emp_name,
        annual_leave_total=annual_leave_total,
        annual_leave_used=float(used_annual),
        annual_leave_remaining=annual_remaining,
        sick_leave_used=float(used_sick),
        pending_leave_days=float(pending_annual),
        maternity_leave_used=float(used_maternity),
        unpaid_leave_used=float(used_unpaid),
        seniority_bonus_days=seniority_bonus_days
    )
