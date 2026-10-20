from fastapi import APIRouter, Depends, HTTPException, Request, status
from typing import List, Optional
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.core.database import get_db
from app.core.security import get_password_hash
from app.api.deps import get_current_user, require_roles, record_audit_log
from app.schemas.schemas import UserResponse, UserCreate, UserUpdate, AdminResetPassword

router = APIRouter()

@router.get(
    "",
    response_model=List[UserResponse],
    summary="Danh sách tài khoản người dùng trong hệ thống",
    description="Truy xuất toàn bộ tài khoản người dùng kèm vai trò và thông tin nhân sự. Yêu cầu vai trò ADMIN hoặc HR_MANAGER."
)
async def get_all_users(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_roles(["ADMIN", "DIRECTOR", "HR_MANAGER"]))
):
    query = text("""
        SELECT u.user_id, u.username, u.email, u.phone, u.is_active, u.last_login, u.created_at,
               u.employee_id, e.employee_code, e.full_name,
               d.department_name, s.store_name
        FROM users u
        LEFT JOIN employees e ON u.employee_id = e.employee_id
        LEFT JOIN departments d ON e.department_id = d.department_id
        LEFT JOIN stores s ON e.store_id = s.store_id
        ORDER BY u.user_id ASC;
    """)
    res = await db.execute(query)
    users_raw = res.mappings().all()

    # Lấy danh sách roles của từng user
    roles_query = text("""
        SELECT ur.user_id, r.role_code
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.role_id;
    """)
    roles_res = await db.execute(roles_query)
    roles_map = {}
    for r in roles_res.mappings().all():
        roles_map.setdefault(r["user_id"], []).append(r["role_code"])

    result = []
    for u in users_raw:
        item = dict(u)
        item["roles"] = roles_map.get(u["user_id"], [])
        result.append(item)

    return result


@router.get(
    "/{user_id}",
    response_model=UserResponse,
    summary="Chi tiết tài khoản người dùng theo ID",
    description="Yêu cầu vai trò ADMIN, DIRECTOR hoặc HR_MANAGER."
)
async def get_user_by_id(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER", "DIRECTOR"]))
):
    query = text("""
        SELECT u.user_id, u.username, u.email, u.phone, u.is_active, u.last_login, u.created_at,
               u.employee_id, e.employee_code, e.full_name,
               d.department_name, s.store_name
        FROM users u
        LEFT JOIN employees e ON u.employee_id = e.employee_id
        LEFT JOIN departments d ON e.department_id = d.department_id
        LEFT JOIN stores s ON e.store_id = s.store_id
        WHERE u.user_id = :user_id;
    """)
    res = await db.execute(query, {"user_id": user_id})
    user_row = res.mappings().first()

    if not user_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Không tìm thấy tài khoản với ID {user_id}"
        )

    roles_query = text("""
        SELECT r.role_code
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.role_id
        WHERE ur.user_id = :user_id;
    """)
    roles_res = await db.execute(roles_query, {"user_id": user_id})
    roles = [r["role_code"] for r in roles_res.mappings().all()]

    result = dict(user_row)
    result["roles"] = roles
    return result


@router.post(
    "",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Tạo tài khoản người dùng mới (Chỉ ADMIN)",
    description="Tạo tài khoản hệ thống mới, băm mật khẩu bằng Bcrypt, liên kết nhân viên và gán vai trò ban đầu."
)
async def create_user(
    request: Request,
    user_in: UserCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_roles(["ADMIN"]))
):
    # 1. Kiểm tra username hoặc email đã tồn tại chưa
    check_query = text("""
        SELECT user_id, username, email FROM users
        WHERE username = :username OR email = :email;
    """)
    check_res = await db.execute(check_query, {"username": user_in.username, "email": user_in.email})
    existing = check_res.mappings().first()
    if existing:
        if existing["username"] == user_in.username:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tên đăng nhập này đã được sử dụng.")
        if existing["email"] == user_in.email:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email này đã được sử dụng.")

    # 2. Nếu có employee_id, kiểm tra nhân viên hợp lệ và chưa liên kết tài khoản nào
    emp_details = None
    if user_in.employee_id is not None:
        emp_check = await db.execute(text("""
            SELECT e.employee_id, e.employee_code, e.full_name, d.department_name, s.store_name
            FROM employees e
            LEFT JOIN departments d ON e.department_id = d.department_id
            LEFT JOIN stores s ON e.store_id = s.store_id
            WHERE e.employee_id = :eid;
        """), {"eid": user_in.employee_id})
        emp_details = emp_check.mappings().first()
        if not emp_details:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy nhân viên được chỉ định.")

        linked_check = await db.execute(
            text("SELECT user_id, username FROM users WHERE employee_id = :eid;"),
            {"eid": user_in.employee_id}
        )
        linked_user = linked_check.mappings().first()
        if linked_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Nhân viên {emp_details['full_name']} ({emp_details['employee_code']}) đã liên kết với tài khoản '{linked_user['username']}'."
            )

    # 3. Băm mật khẩu và Insert user
    hashed_pwd = get_password_hash(user_in.password)
    insert_query = text("""
        INSERT INTO users (username, password_hash, email, phone, employee_id, is_active)
        VALUES (:username, :password_hash, :email, :phone, :employee_id, TRUE)
        RETURNING user_id, username, email, phone, is_active, last_login, created_at, employee_id;
    """)
    insert_res = await db.execute(insert_query, {
        "username": user_in.username,
        "password_hash": hashed_pwd,
        "email": user_in.email,
        "phone": user_in.phone,
        "employee_id": user_in.employee_id
    })
    new_user = insert_res.mappings().first()
    user_id = new_user["user_id"]

    # 4. Gán vai trò (1 tài khoản 1 vai trò duy nhất)
    target_role_id = None
    if user_in.role_id is not None:
        target_role_id = user_in.role_id
    elif user_in.role_ids:
        target_role_id = user_in.role_ids[0]
    else:
        target_role_id = 4  # Mặc định EMPLOYEE

    role_codes = []
    if target_role_id:
        await db.execute(
            text("INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES (:user_id, :role_id, :assigned_by) ON CONFLICT DO NOTHING;"),
            {"user_id": user_id, "role_id": target_role_id, "assigned_by": current_user["user_id"]}
        )
        rc_res = await db.execute(
            text("SELECT role_code FROM roles WHERE role_id = :role_id;"),
            {"role_id": target_role_id}
        )
        rc = rc_res.mappings().first()
        if rc:
            role_codes = [rc["role_code"]]

    await db.commit()

    # 5. Ghi Audit Log
    client_ip = request.client.host if request.client else "unknown"
    await record_audit_log(
        db=db,
        user_id=current_user["user_id"],
        action="CREATE_USER",
        entity_name="users",
        entity_id=str(user_id),
        new_values={"username": user_in.username, "email": user_in.email, "roles": role_codes, "employee_id": user_in.employee_id},
        ip_address=client_ip
    )

    res_dict = dict(new_user)
    res_dict["roles"] = role_codes
    res_dict["employee_code"] = emp_details["employee_code"] if emp_details else None
    res_dict["full_name"] = emp_details["full_name"] if emp_details else None
    res_dict["department_name"] = emp_details["department_name"] if emp_details else None
    res_dict["store_name"] = emp_details["store_name"] if emp_details else None
    return res_dict


@router.put(
    "/{user_id}",
    response_model=UserResponse,
    summary="Cập nhật thông tin tài khoản người dùng (Chỉ ADMIN)",
    description="Cập nhật email, số điện thoại, liên kết nhân sự (employee_id) và trạng thái người dùng."
)
async def update_user(
    user_id: int,
    user_in: UserUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_roles(["ADMIN"]))
):
    # 1. Kiểm tra tài khoản tồn tại
    user_res = await db.execute(text("SELECT * FROM users WHERE user_id = :id;"), {"id": user_id})
    user_row = user_res.mappings().first()
    if not user_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Không tìm thấy tài khoản với ID {user_id}")

    old_values = {
        k: (v.isoformat() if hasattr(v, "isoformat") else v)
        for k, v in dict(user_row).items()
        if k != "password_hash"
    }

    # 2. Kiểm tra email mới không bị trùng
    if user_in.email and user_in.email != user_row["email"]:
        email_check = await db.execute(
            text("SELECT user_id FROM users WHERE email = :email AND user_id != :id;"),
            {"email": user_in.email, "id": user_id}
        )
        if email_check.mappings().first():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email này đã được sử dụng bởi tài khoản khác.")

    # 3. Kiểm tra liên kết nhân viên (employee_id)
    emp_details = None
    target_employee_id = user_row["employee_id"]
    if user_in.employee_id is not None:
        target_employee_id = user_in.employee_id if user_in.employee_id > 0 else None
        if target_employee_id is not None:
            emp_check = await db.execute(text("""
                SELECT e.employee_id, e.employee_code, e.full_name, d.department_name, s.store_name
                FROM employees e
                LEFT JOIN departments d ON e.department_id = d.department_id
                LEFT JOIN stores s ON e.store_id = s.store_id
                WHERE e.employee_id = :eid;
            """), {"eid": target_employee_id})
            emp_details = emp_check.mappings().first()
            if not emp_details:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy nhân viên được chỉ định.")

            # Kiểm tra nếu nhân viên này đã liên kết với tài khoản khác
            linked_check = await db.execute(
                text("SELECT user_id, username FROM users WHERE employee_id = :eid AND user_id != :id;"),
                {"eid": target_employee_id, "id": user_id}
            )
            linked_user = linked_check.mappings().first()
            if linked_user:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Nhân viên {emp_details['full_name']} ({emp_details['employee_code']}) đã liên kết với tài khoản '{linked_user['username']}'."
                )
    elif target_employee_id:
        emp_check = await db.execute(text("""
            SELECT e.employee_id, e.employee_code, e.full_name, d.department_name, s.store_name
            FROM employees e
            LEFT JOIN departments d ON e.department_id = d.department_id
            LEFT JOIN stores s ON e.store_id = s.store_id
            WHERE e.employee_id = :eid;
        """), {"eid": target_employee_id})
        emp_details = emp_check.mappings().first()

    # 4. Kiểm tra trạng thái is_active (không cho tự khóa mình)
    new_is_active = user_row["is_active"]
    if user_in.is_active is not None:
        if user_id == current_user["user_id"] and not user_in.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bạn không thể tự khóa tài khoản của chính mình.")
        new_is_active = user_in.is_active

    # 5. Cập nhật bảng users
    new_email = user_in.email if user_in.email is not None else user_row["email"]
    new_phone = user_in.phone if user_in.phone is not None else user_row["phone"]

    update_query = text("""
        UPDATE users
        SET email = :email,
            phone = :phone,
            employee_id = :employee_id,
            is_active = :is_active,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = :user_id
        RETURNING user_id, username, email, phone, is_active, last_login, created_at, employee_id;
    """)
    update_res = await db.execute(update_query, {
        "user_id": user_id,
        "email": new_email,
        "phone": new_phone,
        "employee_id": target_employee_id,
        "is_active": new_is_active
    })
    updated_user = update_res.mappings().first()

    # 6. Cập nhật vai trò nếu có gửi role_id hoặc role_ids (1 tài khoản 1 vai trò duy nhất)
    target_role_id = None
    if user_in.role_id is not None:
        target_role_id = user_in.role_id
    elif user_in.role_ids is not None:
        if not user_in.role_ids:
            raise HTTPException(status_code=400, detail="Cần chọn một vai trò hợp lệ")
        target_role_id = user_in.role_ids[0]

    if target_role_id is not None:
        v_res = await db.execute(text("SELECT role_id, role_code FROM roles WHERE role_id = :rid;"), {"rid": target_role_id})
        v_role = v_res.mappings().first()
        if not v_role:
            raise HTTPException(status_code=400, detail="Vai trò không tồn tại")

        # Kiểm tra không tự bỏ role ADMIN của chính mình
        if user_id == current_user["user_id"] and v_role["role_code"] != "ADMIN":
            raise HTTPException(status_code=400, detail="Không thể tự gỡ quyền ADMIN của chính mình.")

        await db.execute(text("DELETE FROM user_roles WHERE user_id = :id;"), {"id": user_id})
        await db.execute(
            text("INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES (:user_id, :role_id, :assigned_by);"),
            {"user_id": user_id, "role_id": target_role_id, "assigned_by": current_user["user_id"]}
        )

    await db.commit()

    # 7. Lấy danh sách roles mới
    roles_res = await db.execute(
        text("SELECT r.role_code FROM user_roles ur JOIN roles r ON ur.role_id = r.role_id WHERE ur.user_id = :id;"),
        {"id": user_id}
    )
    roles = [r["role_code"] for r in roles_res.mappings().all()]

    # 8. Audit log
    client_ip = request.client.host if request.client else "unknown"
    await record_audit_log(
        db=db,
        user_id=current_user["user_id"],
        action="UPDATE_USER",
        entity_name="users",
        entity_id=str(user_id),
        old_values=old_values,
        new_values={
            "email": new_email,
            "phone": new_phone,
            "employee_id": target_employee_id,
            "is_active": new_is_active,
            "roles": roles
        },
        ip_address=client_ip
    )

    res_dict = dict(updated_user)
    res_dict["roles"] = roles
    res_dict["employee_code"] = emp_details["employee_code"] if emp_details else None
    res_dict["full_name"] = emp_details["full_name"] if emp_details else None
    res_dict["department_name"] = emp_details["department_name"] if emp_details else None
    res_dict["store_name"] = emp_details["store_name"] if emp_details else None
    return res_dict


@router.post(
    "/{user_id}/reset-password",
    summary="Đặt lại mật khẩu người dùng (Chỉ ADMIN)",
    description="Quản trị viên đặt lại mật khẩu cho tài khoản người dùng mà không cần mật khẩu cũ."
)
async def reset_user_password(
    user_id: int,
    body: AdminResetPassword,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_roles(["ADMIN"]))
):
    user_res = await db.execute(text("SELECT user_id, username FROM users WHERE user_id = :id;"), {"id": user_id})
    user_row = user_res.mappings().first()
    if not user_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy tài khoản.")

    new_pwd = body.new_password
    if len(new_pwd) < 6 or len(new_pwd.encode("utf-8")) > 72 or new_pwd != new_pwd.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Mật khẩu mới cần ít nhất 6 ký tự, tối đa 72 byte và không có khoảng trắng ở đầu hoặc cuối."
        )

    hashed = get_password_hash(new_pwd)
    await db.execute(
        text("UPDATE users SET password_hash = :hash, updated_at = CURRENT_TIMESTAMP WHERE user_id = :id;"),
        {"hash": hashed, "id": user_id}
    )
    await db.commit()

    client_ip = request.client.host if request.client else "unknown"
    await record_audit_log(
        db=db,
        user_id=current_user["user_id"],
        action="RESET_USER_PASSWORD",
        entity_name="users",
        entity_id=str(user_id),
        old_values={"note": "password_reset_by_admin"},
        new_values={"username": user_row["username"]},
        ip_address=client_ip
    )

    return {"message": f"Đặt lại mật khẩu thành công cho tài khoản '{user_row['username']}'."}


@router.delete(
    "/{user_id}",
    summary="Xóa tài khoản người dùng (Chỉ ADMIN)",
    description="Xóa tài khoản người dùng. Nếu tài khoản đã phát sinh dữ liệu kiểm toán (hợp đồng, đơn từ), hệ thống sẽ tự động chuyển sang chế độ vô hiệu hóa (khóa tài khoản) để bảo toàn dữ liệu."
)
async def delete_user(
    user_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_roles(["ADMIN"]))
):
    if user_id == current_user["user_id"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bạn không thể tự xóa tài khoản của chính mình.")

    user_res = await db.execute(text("SELECT user_id, username, is_active FROM users WHERE user_id = :id;"), {"id": user_id})
    user_row = user_res.mappings().first()
    if not user_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy tài khoản.")

    # Kiểm tra xem user có dữ liệu liên kết quan trọng không
    check_refs = await db.execute(text("""
        SELECT 
            (SELECT COUNT(*) FROM contracts WHERE created_by = :uid OR activated_by = :uid OR terminated_by = :uid) as cnt_contracts,
            (SELECT COUNT(*) FROM resignation_requests WHERE created_by = :uid OR approved_by = :uid) as cnt_resignations,
            (SELECT COUNT(*) FROM overtime_requests WHERE created_by = :uid OR reviewed_by = :uid OR cancelled_by = :uid OR revoked_by = :uid) as cnt_ot,
            (SELECT COUNT(*) FROM payroll_manual_adjustments WHERE edited_by = :uid) as cnt_payroll;
    """), {"uid": user_id})
    refs = check_refs.mappings().first()
    total_refs = sum(refs.values()) if refs else 0

    client_ip = request.client.host if request.client else "unknown"

    if total_refs > 0:
        # Soft delete: Khóa tài khoản để bảo toàn dữ liệu
        await db.execute(
            text("UPDATE users SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE user_id = :id;"),
            {"id": user_id}
        )
        await db.commit()

        await record_audit_log(
            db=db,
            user_id=current_user["user_id"],
            action="DEACTIVATE_USER_ON_DELETE",
            entity_name="users",
            entity_id=str(user_id),
            old_values={"is_active": user_row["is_active"]},
            new_values={"is_active": False, "reason": "Tài khoản có dữ liệu lịch sử nghiệp vụ"},
            ip_address=client_ip
        )
        return {
            "action": "DEACTIVATED",
            "is_active": False,
            "message": f"Tài khoản '{user_row['username']}' đã từng tham gia ký hợp đồng, phê duyệt đơn từ hoặc điều chỉnh lương. Để đảm bảo toàn vẹn dữ liệu kiểm toán pháp lý, hệ thống đã vô hiệu hóa (khóa) tài khoản thay vì xóa vĩnh viễn."
        }
    else:
        # Hard delete: Xóa an toàn
        await db.execute(text("DELETE FROM user_roles WHERE user_id = :id;"), {"id": user_id})
        await db.execute(text("DELETE FROM users WHERE user_id = :id;"), {"id": user_id})
        await db.commit()

        await record_audit_log(
            db=db,
            user_id=current_user["user_id"],
            action="DELETE_USER",
            entity_name="users",
            entity_id=str(user_id),
            old_values={"username": user_row["username"]},
            new_values=None,
            ip_address=client_ip
        )
        return {
            "action": "DELETED",
            "message": f"Đã xóa vĩnh viễn tài khoản '{user_row['username']}' khỏi hệ thống."
        }


@router.put(
    "/{user_id}/status",
    summary="Khóa hoặc Kích hoạt lại tài khoản người dùng (Chỉ ADMIN)",
    description="Thay đổi trạng thái is_active của tài khoản."
)
async def update_user_status(
    user_id: int,
    is_active: bool,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_roles(["ADMIN"]))
):
    if user_id == current_user["user_id"] and not is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bạn không thể tự khóa tài khoản của chính mình."
        )

    # Lấy trạng thái cũ
    old_res = await db.execute(text("SELECT is_active, username FROM users WHERE user_id = :id;"), {"id": user_id})
    old_row = old_res.mappings().first()
    if not old_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy tài khoản.")

    await db.execute(
        text("UPDATE users SET is_active = :status, updated_at = CURRENT_TIMESTAMP WHERE user_id = :id;"),
        {"status": is_active, "id": user_id}
    )
    await db.commit()

    client_ip = request.client.host if request.client else "unknown"
    await record_audit_log(
        db=db,
        user_id=current_user["user_id"],
        action="UPDATE_USER_STATUS",
        entity_name="users",
        entity_id=str(user_id),
        old_values={"is_active": old_row["is_active"]},
        new_values={"is_active": is_active},
        ip_address=client_ip
    )

    status_str = "kích hoạt" if is_active else "khóa"
    return {"message": f"Đã {status_str} thành công tài khoản {old_row['username']}", "is_active": is_active}


@router.put(
    "/{user_id}/roles",
    summary="Cập nhật vai trò phân quyền cho tài khoản (Chỉ ADMIN)",
    description="Thay đổi vai trò (role) được gán cho người dùng (1 tài khoản 1 vai trò duy nhất)."
)
async def update_user_roles(
    user_id: int,
    role_ids: List[int],
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_roles(["ADMIN"]))
):
    if not role_ids:
        raise HTTPException(status_code=400, detail="Cần chọn một vai trò hợp lệ")
    
    # 1 tài khoản 1 vai trò: lấy role đầu tiên
    target_role_id = role_ids[0]
    valid_roles_res = await db.execute(
        text("SELECT role_id, role_code FROM roles WHERE role_id = :role_id"),
        {"role_id": target_role_id},
    )
    valid_role = valid_roles_res.mappings().first()
    if not valid_role:
        raise HTTPException(status_code=400, detail="Vai trò không tồn tại")
    if user_id == current_user["user_id"] and valid_role["role_code"] != "ADMIN":
        raise HTTPException(status_code=400, detail="Không thể tự gỡ quyền ADMIN của chính mình")
    exists = (await db.execute(text("SELECT 1 FROM users WHERE user_id = :id"), {"id": user_id})).scalar_one_or_none()
    if exists is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản")
    # Lấy roles cũ
    old_r_res = await db.execute(
        text("SELECT r.role_code FROM user_roles ur JOIN roles r ON ur.role_id = r.role_id WHERE ur.user_id = :id;"),
        {"id": user_id}
    )
    old_roles = [r["role_code"] for r in old_r_res.mappings().all()]

    # Xóa roles cũ và gán duy nhất 1 role mới
    await db.execute(text("DELETE FROM user_roles WHERE user_id = :id;"), {"id": user_id})
    await db.execute(
        text("INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES (:user_id, :role_id, :assigned_by);"),
        {"user_id": user_id, "role_id": target_role_id, "assigned_by": current_user["user_id"]}
    )
    await db.commit()

    new_roles = [valid_role["role_code"]]

    client_ip = request.client.host if request.client else "unknown"
    await record_audit_log(
        db=db,
        user_id=current_user["user_id"],
        action="UPDATE_USER_ROLES",
        entity_name="user_roles",
        entity_id=str(user_id),
        old_values={"roles": old_roles},
        new_values={"roles": new_roles},
        ip_address=client_ip
    )

    return {"message": "Cập nhật vai trò người dùng thành công", "roles": new_roles}

