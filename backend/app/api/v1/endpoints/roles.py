from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.core.database import get_db
from app.api.deps import get_current_user, require_roles
from app.schemas.schemas import RoleResponse, PermissionResponse, RBACMatrixItem

router = APIRouter()

@router.get(
    "",
    response_model=List[RoleResponse],
    summary="Danh sách vai trò và quyền hạn tương ứng",
    description="Truy xuất danh sách tất cả các vai trò trong hệ thống kèm quyền chức năng được cấp."
)
async def get_all_roles(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    # 1. Lấy danh sách Roles
    roles_res = await db.execute(text("SELECT role_id, role_code, role_name, description FROM roles ORDER BY role_id;"))
    roles = roles_res.mappings().all()

    # 2. Lấy permissions theo từng role
    perms_query = text("""
        SELECT rp.role_id, p.permission_code
        FROM role_permissions rp
        JOIN permissions p ON rp.permission_id = p.permission_id;
    """)
    perms_res = await db.execute(perms_query)
    perms_map = {}
    for p in perms_res.mappings().all():
        perms_map.setdefault(p["role_id"], []).append(p["permission_code"])

    result = []
    for r in roles:
        item = dict(r)
        item["permissions"] = perms_map.get(r["role_id"], [])
        result.append(item)

    return result


@router.get(
    "/permissions",
    response_model=List[PermissionResponse],
    summary="Danh mục tất cả các quyền chức năng của hệ thống",
    description="Truy xuất danh sách toàn bộ các quyền chức năng chi tiết được phân theo module."
)
async def get_all_permissions(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    query = text("SELECT permission_id, permission_code, permission_name, module FROM permissions ORDER BY module, permission_id;")
    res = await db.execute(query)
    return [dict(p) for p in res.mappings().all()]


@router.get(
    "/matrix",
    response_model=List[RBACMatrixItem],
    summary="Ma trận phân quyền RBAC (Role-Based Access Control Matrix)",
    description="Hiển thị ma trận phân quyền chi tiết giữa các quyền chức năng và 4 vai trò chính của chuỗi TechZone."
)
async def get_rbac_matrix(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    # Lấy danh sách quyền và vai trò sở hữu
    query = text("""
        SELECT p.permission_code, p.permission_name, p.module, r.role_code
        FROM permissions p
        LEFT JOIN role_permissions rp ON p.permission_id = rp.permission_id
        LEFT JOIN roles r ON rp.role_id = r.role_id
        ORDER BY p.module, p.permission_id;
    """)
    res = await db.execute(query)
    rows = res.mappings().all()

    matrix_map: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        code = r["permission_code"]
        if code not in matrix_map:
            matrix_map[code] = {
                "permission_code": code,
                "permission_name": r["permission_name"],
                "module": r["module"],
                "roles": {
                    "ADMIN": True, # ADMIN luôn có full quyền
                    "HR_MANAGER": False,
                    "STORE_MANAGER": False,
                    "EMPLOYEE": False
                }
            }
        role = r["role_code"]
        if role and role in matrix_map[code]["roles"]:
            matrix_map[code]["roles"][role] = True

    return list(matrix_map.values())
