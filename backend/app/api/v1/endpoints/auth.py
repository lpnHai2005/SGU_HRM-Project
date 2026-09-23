from fastapi import APIRouter, Depends, HTTPException, Request, status
from typing import Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.core.database import get_db
from app.core.security import verify_password, create_access_token
from app.api.deps import get_current_user, record_audit_log
from app.schemas.schemas import LoginRequest, TokenResponse, UserProfile, TestAccountResponse

router = APIRouter()

@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Đăng nhập hệ thống HRM TechZone",
    description="Xác thực danh tính người dùng bằng username và password. Hỗ trợ cả JSON body (Frontend) và Form URL-Encoded (Swagger UI Authorize).",
    openapi_extra={
        "requestBody": {
            "content": {
                "application/json": {
                    "schema": {
                        "type": "object",
                        "properties": {
                            "username": {"type": "string", "example": "admin"},
                            "password": {"type": "string", "example": "123456"}
                        },
                        "required": ["username", "password"]
                    }
                },
                "application/x-www-form-urlencoded": {
                    "schema": {
                        "type": "object",
                        "properties": {
                            "username": {"type": "string", "example": "admin"},
                            "password": {"type": "string", "example": "123456"}
                        },
                        "required": ["username", "password"]
                    }
                }
            }
        }
    }
)
async def login(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    username = ""
    password = ""

    # Trích xuất linh hoạt từ Form-data (Swagger OAuth2) hoặc JSON body (React/Axios)
    content_type = request.headers.get("content-type", "")
    if "application/x-www-form-urlencoded" in content_type or "multipart/form-data" in content_type:
        form = await request.form()
        username = str(form.get("username", "")).strip()
        password = str(form.get("password", "")).strip()
    else:
        try:
            body = await request.json()
            username = str(body.get("username", "")).strip()
            password = str(body.get("password", "")).strip()
        except Exception:
            pass

    if not username or not password:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Vui lòng cung cấp đầy đủ tên đăng nhập (username) và mật khẩu (password)."
        )

    # 1. Tìm tài khoản trong CSDL Supabase
    query = text("""
        SELECT u.user_id, u.username, u.password_hash, u.is_active, u.employee_id,
               e.full_name, e.store_id, s.store_name
        FROM users u
        LEFT JOIN employees e ON u.employee_id = e.employee_id
        LEFT JOIN stores s ON e.store_id = s.store_id
        WHERE u.username = :username;
    """)
    res = await db.execute(query, {"username": username})
    user = res.mappings().first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tên đăng nhập hoặc mật khẩu không chính xác."
        )

    if not user["is_active"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản này hiện đang bị khóa hoặc ngưng kích hoạt. Vui lòng liên hệ Quản trị viên."
        )

    # 2. Xác thực mật khẩu Bcrypt
    if not verify_password(password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tên đăng nhập hoặc mật khẩu không chính xác."
        )

    # 3. Lấy danh sách Vai trò & Quyền chi tiết
    perm_query = text("""
        SELECT DISTINCT r.role_code, p.permission_code
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.role_id
        LEFT JOIN role_permissions rp ON r.role_id = rp.role_id
        LEFT JOIN permissions p ON rp.permission_id = p.permission_id
        WHERE ur.user_id = :user_id;
    """)
    perm_res = await db.execute(perm_query, {"user_id": user["user_id"]})
    perm_rows = perm_res.mappings().all()

    roles = list({row["role_code"] for row in perm_rows if row["role_code"]})
    permissions = list({row["permission_code"] for row in perm_rows if row["permission_code"]})

    # Cập nhật thời điểm last_login
    await db.execute(
        text("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE user_id = :user_id"),
        {"user_id": user["user_id"]}
    )
    await db.commit()

    # Ghi nhận nhật ký đăng nhập (Audit Log)
    client_ip = request.client.host if request.client else "unknown"
    user_agent = request.headers.get("user-agent", "")
    await record_audit_log(
        db=db,
        user_id=user["user_id"],
        action="LOGIN",
        entity_name="users",
        entity_id=str(user["user_id"]),
        new_values={"username": user["username"], "roles": roles},
        ip_address=client_ip,
        user_agent=user_agent
    )

    # 4. Phát hành JWT Access Token
    access_token = create_access_token(subject=user["username"], roles=roles)

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        user_id=user["user_id"],
        username=user["username"],
        full_name=user["full_name"] or user["username"],
        roles=roles,
        permissions=permissions,
        employee_id=user["employee_id"],
        store_id=user["store_id"],
        store_name=user["store_name"]
    )


@router.get(
    "/me",
    response_model=UserProfile,
    summary="Lấy thông tin tài khoản đang đăng nhập",
    description="Truy xuất hồ sơ chi tiết của người dùng hiện tại, bao gồm thông tin cá nhân, phòng ban, cửa hàng, chức vụ, vai trò và quyền hạn."
)
async def get_me(current_user: dict = Depends(get_current_user)):
    return UserProfile(
        user_id=current_user["user_id"],
        username=current_user["username"],
        email=current_user["email"],
        phone=current_user["phone"],
        is_active=current_user["is_active"],
        roles=current_user["roles"],
        permissions=current_user["permissions"],
        employee_id=current_user["employee_id"],
        employee_code=current_user["employee_code"],
        full_name=current_user["full_name"],
        department_name=current_user["department_name"],
        position_name=current_user["position_name"],
        store_name=current_user["store_name"],
        store_id=current_user["store_id"]
    )


@router.get(
    "/test-accounts",
    response_model=List[TestAccountResponse],
    summary="Danh sách 5 tài khoản test demo nhanh (Mật khẩu: 123456)",
    description="Cung cấp danh sách 5 tài khoản demo tương ứng với 4 vai trò chính của chuỗi TechZone để hội đồng và nhóm kiểm thử nhanh."
)
async def get_test_accounts():
    return [
        {
            "username": "admin",
            "role": "Quản trị viên (ADMIN)",
            "name": "Nguyễn Văn An",
            "desc": "Toàn quyền quản trị tài khoản, ma trận phân quyền và nhật ký hệ thống (Audit Log)"
        },
        {
            "username": "hr_manager",
            "role": "Trưởng phòng Nhân sự (HR_MANAGER)",
            "name": "Trần Thị Bình",
            "desc": "Quản lý hồ sơ nhân sự, phê duyệt nghỉ phép cấp 2, thăng chức đổi role, chốt lương và xem báo cáo"
        },
        {
            "username": "store_mgr_q1",
            "role": "Cửa hàng trưởng (STORE_MANAGER)",
            "name": "Lê Văn Cường",
            "desc": "Quản lý nhân viên chi nhánh Q1, phân ca tuần, duyệt nghỉ phép cấp 1"
        },
        {
            "username": "staff_dung",
            "role": "Nhân viên Bán hàng xuất sắc (EMPLOYEE)",
            "name": "Phạm Quốc Dũng",
            "desc": "Check-in chấm công, nộp đơn nghỉ phép, ghi nhận doanh số 220M, xem và in phiếu lương A4"
        },
        {
            "username": "tech_em",
            "role": "Kỹ thuật viên Phần cứng (EMPLOYEE)",
            "name": "Hoàng Thị Em",
            "desc": "Chấm công kỹ thuật, xem lịch phân ca, xem phiếu lương cá nhân"
        }
    ]


@router.post(
    "/logout",
    summary="Đăng xuất khỏi hệ thống",
    description="Ghi nhận hoạt động đăng xuất của người dùng vào nhật ký thanh tra hệ thống."
)
async def logout(
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    client_ip = request.client.host if request.client else "unknown"
    await record_audit_log(
        db=db,
        user_id=current_user["user_id"],
        action="LOGOUT",
        entity_name="users",
        entity_id=str(current_user["user_id"]),
        ip_address=client_ip
    )
    return {"message": "Đăng xuất thành công", "username": current_user["username"]}
