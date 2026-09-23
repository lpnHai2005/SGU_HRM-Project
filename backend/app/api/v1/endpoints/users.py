from fastapi import APIRouter, Depends, HTTPException, Request, status
from typing import List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.core.database import get_db
from app.core.security import get_password_hash
from app.api.deps import get_current_user, require_roles, record_audit_log
from app.schemas.schemas import UserResponse, UserCreate, UserUpdate

router = APIRouter()

@router.get(
    "",
    response_model=List[UserResponse],
    summary="Danh sách tài khoản người dùng trong hệ thống",
    description="Truy xuất toàn bộ tài khoản người dùng kèm vai trò và thông tin nhân sự. Yêu cầu vai trò ADMIN hoặc HR_MANAGER."
)
async def get_all_users(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"]))
):
    query = text("""
        SELECT u.user_id, u.username, u.email, u.phone, u.is_active, u.last_login, u.created_at,
               u.employee_id, e.employee_code, e.full_name
        FROM users u
        LEFT JOIN employees e ON u.employee_id = e.employee_id
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
    description="Yêu cầu vai trò ADMIN hoặc HR_MANAGER."
)
async def get_user_by_id(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_roles(["ADMIN", "HR_MANAGER"]))
):
    query = text("""
        SELECT u.user_id, u.username, u.email, u.phone, u.is_active, u.last_login, u.created_at,
               u.employee_id, e.employee_code, e.full_name
        FROM users u
        LEFT JOIN employees e ON u.employee_id = e.employee_id
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
    description="Tạo tài khoản hệ thống mới, băm mật khẩu bằng Bcrypt và gán vai trò ban đầu."
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

    # 2. Băm mật khẩu và Insert user
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

    # 3. Gán roles
    role_codes = []
    if user_in.role_ids:
        for r_id in user_in.role_ids:
            await db.execute(
                text("INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES (:user_id, :role_id, :assigned_by) ON CONFLICT DO NOTHING;"),
                {"user_id": user_id, "role_id": r_id, "assigned_by": current_user["user_id"]}
            )
        # Lấy tên các role vừa gán
        rc_res = await db.execute(
            text("SELECT role_code FROM roles WHERE role_id = ANY(:role_ids);"),
            {"role_ids": user_in.role_ids}
        )
        role_codes = [r["role_code"] for r in rc_res.mappings().all()]

    await db.commit()

    # 4. Ghi Audit Log
    client_ip = request.client.host if request.client else "unknown"
    await record_audit_log(
        db=db,
        user_id=current_user["user_id"],
        action="CREATE_USER",
        entity_name="users",
        entity_id=str(user_id),
        new_values={"username": user_in.username, "email": user_in.email, "roles": role_codes},
        ip_address=client_ip
    )

    res_dict = dict(new_user)
    res_dict["roles"] = role_codes
    res_dict["employee_code"] = None
    res_dict["full_name"] = None
    return res_dict


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
    description="Thay đổi danh sách vai trò (roles) được gán cho người dùng."
)
async def update_user_roles(
    user_id: int,
    role_ids: List[int],
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_roles(["ADMIN"]))
):
    # Lấy roles cũ
    old_r_res = await db.execute(
        text("SELECT r.role_code FROM user_roles ur JOIN roles r ON ur.role_id = r.role_id WHERE ur.user_id = :id;"),
        {"id": user_id}
    )
    old_roles = [r["role_code"] for r in old_r_res.mappings().all()]

    # Xóa roles cũ và thêm roles mới
    await db.execute(text("DELETE FROM user_roles WHERE user_id = :id;"), {"id": user_id})
    for r_id in role_ids:
        await db.execute(
            text("INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES (:user_id, :role_id, :assigned_by);"),
            {"user_id": user_id, "role_id": r_id, "assigned_by": current_user["user_id"]}
        )
    await db.commit()

    new_r_res = await db.execute(
        text("SELECT role_code FROM roles WHERE role_id = ANY(:role_ids);"),
        {"role_ids": role_ids}
    )
    new_roles = [r["role_code"] for r in new_r_res.mappings().all()]

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
