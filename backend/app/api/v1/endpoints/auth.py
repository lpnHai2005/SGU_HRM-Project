from fastapi import APIRouter, Depends, HTTPException, Request, status, UploadFile, File
from typing import Optional, List
import os
import base64
import re
import time
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.core.database import get_db
from app.core.security import verify_password, create_access_token, get_password_hash
from app.core.storage import upload_file_to_storage
from app.api.deps import get_current_user, record_audit_log
from app.schemas.schemas import LoginRequest, TokenResponse, UserProfile, TestAccountResponse, AvatarUploadRequest
import bcrypt
import hmac
from pydantic import BaseModel, SecretStr

router = APIRouter()


class PasswordChange(BaseModel):
    current_password: SecretStr
    new_password: SecretStr


def _normalize_login_credentials(username_value: object, password_value: object) -> tuple[str, str]:
    """Normalize the account identifier, but preserve password characters verbatim."""
    username = str(username_value or "").strip()
    password = password_value if isinstance(password_value, str) else ""
    return username, password


@router.post('/change-password', summary="Người dùng đổi mật khẩu cá nhân")
async def change_password(
    req: PasswordChange,
    request: Request,
    current_user=Depends(get_current_user),
    db: AsyncSession=Depends(get_db)
):
    current, new = req.current_password.get_secret_value(), req.new_password.get_secret_value()
    if len(new) < 6 or len(new.encode('utf-8')) > 72 or new != new.strip():
        raise HTTPException(422, 'Mật khẩu mới cần ít nhất 6 ký tự, tối đa 72 byte và không có khoảng trắng đầu/cuối.')
    if new == current:
        raise HTTPException(422, 'Mật khẩu mới phải khác mật khẩu hiện tại.')
    stored = (await db.execute(text('SELECT password_hash FROM users WHERE user_id=:id FOR UPDATE'), {'id':current_user['user_id']})).scalar_one_or_none()
    try:
        valid = bool(stored) and (bcrypt.checkpw(current.encode(), stored.encode()) if stored.startswith('$2') else hmac.compare_digest(current.encode(), stored.encode()))
    except (ValueError, TypeError):
        valid = False
    if not valid:
        raise HTTPException(400, 'Mật khẩu hiện tại không chính xác.')
    await db.execute(text('UPDATE users SET password_hash=:hash, updated_at=CURRENT_TIMESTAMP WHERE user_id=:id'), {'hash':get_password_hash(new), 'id':current_user['user_id']})
    await db.commit()

    client_ip = request.client.host if request.client else "unknown"
    await record_audit_log(
        db=db,
        user_id=current_user["user_id"],
        action="CHANGE_PASSWORD",
        entity_name="users",
        entity_id=str(current_user["user_id"]),
        new_values={"note": "password_changed_by_user"},
        ip_address=client_ip
    )

    return {'message':'Đã đổi mật khẩu thành công. Vui lòng sử dụng mật khẩu mới cho các lần đăng nhập tiếp theo.'}

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
    content_type = request.headers.get("content-type", "")
    username = ""
    password = ""

    # Trích xuất linh hoạt từ Form-data (Swagger OAuth2) hoặc JSON body (React/Axios)
    if "application/x-www-form-urlencoded" in content_type or "multipart/form-data" in content_type:
        form = await request.form()
        username, password = _normalize_login_credentials(form.get("username", ""), form.get("password", ""))
    else:
        try:
            body = await request.json()
            username, password = _normalize_login_credentials(body.get("username", ""), body.get("password", ""))
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
               COALESCE(u.avatar_url, e.avatar) AS avatar_url,
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
        avatar_url=user.get("avatar_url"),
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
    description="Truy xuất hồ sơ chi tiết của người dùng hiện tại, bao gồm thông tin cá nhân, ảnh đại diện, phòng ban, cửa hàng, chức vụ, vai trò và quyền hạn."
)
async def get_me(current_user: dict = Depends(get_current_user)):
    return UserProfile(
        user_id=current_user["user_id"],
        username=current_user["username"],
        email=current_user["email"],
        phone=current_user["phone"],
        avatar_url=current_user.get("avatar_url"),
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


@router.post(
    "/avatar",
    summary="Cập nhật ảnh đại diện người dùng qua chuỗi Base64",
    description="Nhận chuỗi base64 của ảnh (hỗ trợ cả Data URL), giải mã thành mảng byte, lưu trữ qua storage service và cập nhật vào hồ sơ người dùng."
)
async def upload_avatar_base64(
    body: AvatarUploadRequest,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    raw_b64 = body.avatar_base64.strip()
    content_type = "image/jpeg"
    ext = ".jpg"

    # Kiểm tra Data URL dạng: data:image/png;base64,iVBORw0KGgo...
    if raw_b64.startswith("data:"):
        match = re.match(r"^data:(image/[a-zA-Z0-9\+\-\.]+);base64,(.+)$", raw_b64, re.DOTALL)
        if match:
            content_type = match.group(1).lower()
            raw_b64 = match.group(2)
            if "png" in content_type:
                ext = ".png"
            elif "webp" in content_type:
                ext = ".webp"
            elif "gif" in content_type:
                ext = ".gif"
            else:
                ext = ".jpg"
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Định dạng Data URL của ảnh không hợp lệ."
            )

    try:
        image_bytes = base64.b64decode(raw_b64)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Chuỗi Base64 không hợp lệ hoặc lỗi giải mã: {str(exc)}"
        )

    # Giới hạn dung lượng ảnh: tối đa 5MB
    if len(image_bytes) > 5 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Dung lượng ảnh đại diện không được vượt quá 5MB."
        )

    user_id = current_user["user_id"]
    filename = f"avatar_u{user_id}_{int(time.time())}{ext}"
    avatar_url = await upload_file_to_storage(
        content=image_bytes,
        filename=filename,
        folder="avatars",
        content_type=content_type
    )

    # 1. Cập nhật bảng users
    await db.execute(
        text("UPDATE users SET avatar_url = :url, updated_at = CURRENT_TIMESTAMP WHERE user_id = :id;"),
        {"url": avatar_url, "id": user_id}
    )

    # 2. Đồng bộ sang bảng employees nếu có liên kết nhân viên
    if current_user.get("employee_id"):
        await db.execute(
            text("UPDATE employees SET avatar = :url, updated_at = CURRENT_TIMESTAMP WHERE employee_id = :eid;"),
            {"url": avatar_url, "eid": current_user["employee_id"]}
        )

    await db.commit()

    # 3. Ghi Audit Log
    client_ip = request.client.host if request.client else "unknown"
    await record_audit_log(
        db=db,
        user_id=user_id,
        action="UPDATE_AVATAR",
        entity_name="users",
        entity_id=str(user_id),
        new_values={"avatar_url": avatar_url},
        ip_address=client_ip
    )

    return {
        "message": "Cập nhật ảnh đại diện thành công!",
        "avatar_url": avatar_url
    }


@router.post(
    "/avatar/file",
    summary="Cập nhật ảnh đại diện người dùng qua tệp Multipart File",
    description="Tải lên tệp ảnh trực tiếp (JPG, PNG, WebP) và cập nhật avatar cho tài khoản."
)
async def upload_avatar_file(
    request: Request,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Chỉ chấp nhận file hình ảnh (JPG, PNG, WebP).")

    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Dung lượng ảnh đại diện không được vượt quá 5MB.")

    user_id = current_user["user_id"]
    ext = os.path.splitext(file.filename or "")[1] or ".jpg"
    filename = f"avatar_u{user_id}_{int(time.time())}{ext}"

    avatar_url = await upload_file_to_storage(
        content=content,
        filename=filename,
        folder="avatars",
        content_type=file.content_type
    )

    await db.execute(
        text("UPDATE users SET avatar_url = :url, updated_at = CURRENT_TIMESTAMP WHERE user_id = :id;"),
        {"url": avatar_url, "id": user_id}
    )

    if current_user.get("employee_id"):
        await db.execute(
            text("UPDATE employees SET avatar = :url, updated_at = CURRENT_TIMESTAMP WHERE employee_id = :eid;"),
            {"url": avatar_url, "eid": current_user["employee_id"]}
        )

    await db.commit()

    client_ip = request.client.host if request.client else "unknown"
    await record_audit_log(
        db=db,
        user_id=user_id,
        action="UPDATE_AVATAR",
        entity_name="users",
        entity_id=str(user_id),
        new_values={"avatar_url": avatar_url, "filename": file.filename},
        ip_address=client_ip
    )

    return {
        "message": "Cập nhật ảnh đại diện thành công!",
        "avatar_url": avatar_url
    }


@router.get(
    "/test-accounts",
    response_model=List[TestAccountResponse],
    summary="Danh sách tài khoản test demo nhanh (Mật khẩu: 123456)",
    description="Cung cấp danh sách tài khoản demo tương ứng với các vai trò của chuỗi TechZone để hội đồng và nhóm kiểm thử nhanh."
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
            "username": "director",
            "role": "Giám đốc (DIRECTOR)",
            "name": "Nguyễn Văn Giám Đốc",
            "desc": "Phê duyệt đơn nghỉ phép / thôi việc của HR và Admin (No Self-Approval), xem báo cáo tổng hợp toàn công ty"
        },
        {
            "username": "hr_manager",
            "role": "Trưởng phòng Nhân sự (HR_MANAGER)",
            "name": "Trần Thị Bình",
            "desc": "Quản lý hồ sơ nhân sự, phê duyệt nghỉ phép cấp 2 (Employee/Store Manager), thăng chức đổi role, chốt lương và xem báo cáo"
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
