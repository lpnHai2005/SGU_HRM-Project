import json
from typing import Optional, List, Any, Dict
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.core.config import settings
from app.core.database import get_db
from app.core.security import decode_token

# OAuth2PasswordBearer hỗ trợ hiển thị ô Authorize trong Swagger UI
oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/auth/login",
    auto_error=False
)

async def get_current_user(
    request: Request,
    token: Optional[str] = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db)
) -> dict:
    """
    Trích xuất và kiểm tra tính hợp lệ của token JWT.
    Hỗ trợ đọc từ Header Authorization: Bearer <token>.
    """
    # Fallback kiểm tra header thủ công nếu OAuth2PasswordBearer bỏ qua
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Chưa cung cấp mã truy cập xác thực (Access Token). Vui lòng đăng nhập.",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
    payload = decode_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token không hợp lệ hoặc đã hết hạn truy cập.",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
    username = payload.get("sub")
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Dữ liệu token không hợp lệ (thiếu subject).",
            headers={"WWW-Authenticate": "Bearer"}
        )

    # 1. Truy vấn thông tin người dùng từ CSDL Supabase
    query = text("""
        SELECT u.user_id, u.username, u.email, u.phone, u.is_active, u.employee_id,
               e.employee_code, e.full_name, e.store_id, s.store_name, d.department_name, pos.position_name
        FROM users u
        LEFT JOIN employees e ON u.employee_id = e.employee_id
        LEFT JOIN stores s ON e.store_id = s.store_id
        LEFT JOIN departments d ON e.department_id = d.department_id
        LEFT JOIN positions pos ON e.position_id = pos.position_id
        WHERE u.username = :username;
    """)
    res = await db.execute(query, {"username": username})
    user_row = res.mappings().first()
    
    if not user_row:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tài khoản người dùng không tồn tại trong hệ thống."
        )

    if not user_row["is_active"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản này hiện đang bị khóa hoặc tạm ngưng hoạt động."
        )

    # 2. Truy vấn danh sách Vai trò (Roles) và Quyền chức năng (Permissions)
    perm_query = text("""
        SELECT DISTINCT r.role_code, p.permission_code
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.role_id
        LEFT JOIN role_permissions rp ON r.role_id = rp.role_id
        LEFT JOIN permissions p ON rp.permission_id = p.permission_id
        WHERE ur.user_id = :user_id;
    """)
    perm_res = await db.execute(perm_query, {"user_id": user_row["user_id"]})
    perm_rows = perm_res.mappings().all()

    roles = list({row["role_code"] for row in perm_rows if row["role_code"]})
    permissions = list({row["permission_code"] for row in perm_rows if row["permission_code"]})

    user_dict = dict(user_row)
    user_dict["roles"] = roles
    user_dict["permissions"] = permissions
    return user_dict


async def get_current_active_user(
    current_user: dict = Depends(get_current_user)
) -> dict:
    """Đảm bảo tài khoản đang trong trạng thái kích hoạt"""
    if not current_user.get("is_active", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản đã bị vô hiệu hóa."
        )
    return current_user


def require_roles(allowed_roles: List[str]):
    """
    Dependency kiểm tra vai trò (Role-Based Access Control - RBAC).
    - Vai trò 'ADMIN' luôn có đặc quyền tối cao bỏ qua kiểm tra.
    - Người dùng phải sở hữu ít nhất một trong các vai trò được cấp phép.
    """
    def role_checker(current_user: dict = Depends(get_current_user)):
        user_roles = current_user.get("roles", [])
        if "ADMIN" in user_roles:
            return current_user
            
        if not any(role in allowed_roles for role in user_roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Truy cập bị từ chối. Chức năng yêu cầu một trong các vai trò: {', '.join(allowed_roles)}"
            )
        return current_user
    return role_checker


def require_permissions(allowed_permissions: List[str]):
    """
    Dependency kiểm tra quyền chức năng chi tiết (Permission-Based Access Control).
    """
    def perm_checker(current_user: dict = Depends(get_current_user)):
        user_roles = current_user.get("roles", [])
        if "ADMIN" in user_roles:
            return current_user

        user_perms = current_user.get("permissions", [])
        if not any(perm in allowed_perms for perm in user_perms for allowed_perms in [allowed_permissions]):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Truy cập bị từ chối. Bạn không có quyền chức năng: {', '.join(allowed_permissions)}"
            )
        return current_user
    return perm_checker


async def record_audit_log(
    db: AsyncSession,
    user_id: Optional[int],
    action: str,
    entity_name: str,
    entity_id: Optional[str] = None,
    old_values: Optional[Any] = None,
    new_values: Optional[Any] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None
):
    """
    Ghi nhận nhật ký thanh tra hệ thống vào bảng audit_logs
    """
    try:
        old_json = json.dumps(old_values, ensure_ascii=False) if old_values is not None else None
        new_json = json.dumps(new_values, ensure_ascii=False) if new_values is not None else None
        
        insert_query = text("""
            INSERT INTO audit_logs (user_id, action, entity_name, entity_id, old_values, new_values, ip_address, user_agent)
            VALUES (:user_id, :action, :entity_name, :entity_id, CAST(:old_values AS jsonb), CAST(:new_values AS jsonb), :ip_address, :user_agent);
        """)
        await db.execute(insert_query, {
            "user_id": user_id,
            "action": action,
            "entity_name": entity_name,
            "entity_id": str(entity_id) if entity_id is not None else None,
            "old_values": old_json,
            "new_values": new_json,
            "ip_address": ip_address,
            "user_agent": user_agent
        })
        await db.commit()
    except Exception as e:
        # Không làm gián đoạn luồng chính nếu ghi audit log gặp lỗi
        print(f"[AUDIT_LOG_ERROR] Lỗi khi ghi nhật ký hệ thống: {e}")


log_audit = record_audit_log

