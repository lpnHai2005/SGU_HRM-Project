import asyncio
import re
import shutil
import subprocess
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.database import get_db
from app.api.deps import require_roles, record_audit_log
from app.api.v1.endpoints.contracts import sync_employee_statuses

router = APIRouter()


@router.post("/sync-employee-statuses", summary="Đồng bộ trạng thái nhân viên theo hợp đồng (Chỉ ADMIN)")
async def admin_sync_employee_statuses(
    current_user: dict = Depends(require_roles(["ADMIN"])),
    db: AsyncSession = Depends(get_db)
):
    # Router /contracts chặn ADMIN nên module quản trị gọi cùng logic qua cổng riêng này.
    return await sync_employee_statuses(current_user=current_user, db=db)


def pg_dump_command(db_url: str) -> list[str]:
    """pg_dump có sẵn (image Docker của backend) thì gọi thẳng, không thì chạy qua Docker (máy dev)."""
    url = re.sub(r"^postgres(ql)?\+\w+://", "postgresql://", db_url)
    # Chỉ schema public; bỏ owner/grant để restore được sang project khác.
    args = ["pg_dump", url, "--schema=public", "--no-owner", "--no-privileges"]
    if shutil.which("pg_dump"):
        return args
    if shutil.which("docker"):
        # Supabase đang chạy Postgres 17: pg_dump phải >= 17.
        return ["docker", "run", "--rm", "postgres:17", *args]
    raise HTTPException(500, "Máy chủ không có pg_dump hoặc Docker để tạo bản sao lưu.")


@router.get("/backup", summary="Tải bản sao lưu database (Chỉ ADMIN)")
async def admin_backup_database(
    request: Request,
    current_user: dict = Depends(require_roles(["ADMIN"])),
    db: AsyncSession = Depends(get_db)
):
    cmd = pg_dump_command(settings.SYNC_DATABASE_URL)
    try:
        # Chạy trong thread: event loop trên Windows có thể không hỗ trợ asyncio subprocess.
        result = await asyncio.to_thread(subprocess.run, cmd, capture_output=True, timeout=300)
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "Sao lưu quá thời gian cho phép (5 phút).")
    if result.returncode != 0:
        # stderr có thể chứa host/user DB: chỉ ghi log server, không trả cho client.
        print(f"[BACKUP_ERROR] {result.stderr.decode(errors='replace')[-2000:]}")
        raise HTTPException(500, "Sao lưu thất bại. Kiểm tra log máy chủ (Docker Desktop đã chạy chưa?).")

    filename = f"techzone_hrm_backup_{datetime.now():%Y%m%d_%H%M%S}.sql"
    await record_audit_log(
        db=db,
        user_id=current_user["user_id"],
        action="DATABASE_BACKUP",
        entity_name="database",
        new_values={"file": filename, "size_bytes": len(result.stdout)},
        ip_address=request.client.host if request.client else None,
    )
    return Response(
        content=result.stdout,
        media_type="application/sql",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
