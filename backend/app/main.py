import logging
import asyncio
from contextlib import suppress
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from app.core.config import settings
from app.core.database import engine, sync_engine
from app.api.v1.router import api_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("techzone_hrm")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Khởi động: Kiểm tra kết nối Supabase Cloud PostgreSQL
    logger.info("=" * 60)
    logger.info("Đang khởi động TechZone HRM Backend FastAPI...")
    try:
        async with engine.connect() as conn:
            res = await conn.execute(text("SELECT current_database(), current_user, version();"))
            row = res.first()
            logger.info(f"-> Kết nối CSDL Supabase thành công! Database: {row[0]} | User: {row[1]}")
    except Exception as e:
        logger.error(f"-> CẢNH BÁO: Lỗi kết nối CSDL Supabase: {e}")
    logger.info("=" * 60)
    
    from app.core.fixed_schedule import worker
    fixed_schedule_task = asyncio.create_task(worker())

    # Khởi động contract expiration cron job
    from app.core.contract_cron import start_contract_cron
    contract_cron_task = asyncio.create_task(start_contract_cron())

    try:
        yield
    finally:
        fixed_schedule_task.cancel()
        contract_cron_task.cancel()
        with suppress(asyncio.CancelledError):
            await fixed_schedule_task
        with suppress(asyncio.CancelledError):
            await contract_cron_task
    
    # Dọn dẹp tài nguyên khi tắt server
    logger.info("Đang đóng các kết nối CSDL...")
    await engine.dispose()
    if sync_engine is not None:
        sync_engine.dispose()
    logger.info("Đã tắt máy chủ TechZone HRM Backend an toàn.")

app = FastAPI(
    title="TechZone HRM API",
    description="""
# Hệ Thống Thông Tin Quản Lý Nhân Sự Chuỗi Cửa Hàng Công Nghệ TechZone (TechZone HRM)

### Môn học: Hệ thống thông tin doanh nghiệp (841065) & Công nghệ phần mềm (841403)
**Đại học Sài Gòn (SGU) - Khoa Công nghệ Thông tin**

**Nhóm thực hiện:**
- Huỳnh Viễn Thông (MSSV: 3123411287) - Nhóm trưởng
- Lê Phan Nguyên Hải (MSSV: 3123411081)
- Võ Hoàng Bảo (MSSV: 3123411030)
- Đoàn Trung Kiên (MSSV: 3123411166)

---
### Các tính năng cốt lõi Phân hệ Nền tảng (Tuần 1 & 2):
1. **Xác thực JWT Token**: Hỗ trợ đăng nhập JSON body và OAuth2 Password Form cho Swagger UI.
2. **Phân quyền vai trò RBAC**: 4 vai trò chính (`ADMIN`, `HR_MANAGER`, `STORE_MANAGER`, `EMPLOYEE`).
3. **Quản lý Tài khoản & Quyền hạn**: Danh mục quyền chi tiết theo từng phân hệ.
4. **Nhật ký Thanh tra Hệ thống (Audit Logs)**: Ghi vết toàn bộ hành động người dùng.
    """,
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan
)

# Cấu hình CORS cho phép Frontend truy cập
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=settings.CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from sqlalchemy.exc import SQLAlchemyError

@app.exception_handler(SQLAlchemyError)
async def sqlalchemy_exception_handler(request: Request, exc: SQLAlchemyError):
    logger.exception(f"Lỗi cơ sở dữ liệu tại {request.method} {request.url.path}: {exc}")
    origin = request.headers.get("origin")
    headers = {}
    if origin:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
        headers["Access-Control-Allow-Methods"] = "*"
        headers["Access-Control-Allow-Headers"] = "*"
    
    error_str = str(getattr(exc, 'orig', exc))
    if "duplicate key" in error_str.lower() or "unique constraint" in error_str.lower():
        if "work_schedules_pkey" in error_str:
            msg = "Xung đột mã dữ liệu ca làm việc trên máy chủ. Hệ thống đang tự động hiệu chỉnh, vui lòng thử lại sau giây lát."
        elif "work_schedules" in error_str:
            msg = "Nhân viên đã có lịch làm việc trong ngày hoặc khung giờ này. Không thể phân ca trùng lặp."
        else:
            msg = "Dữ liệu bị trùng lặp với bản ghi đã tồn tại trong hệ thống."
        return JSONResponse(status_code=409, content={"detail": msg}, headers=headers)
    
    if "OT_MONTHLY_CAP_EXCEEDED" in error_str:
        # Trigger trg_guard_monthly_ot_cap chặn cứng OT tháng vượt trần 40h.
        msg = error_str[error_str.index("OT_MONTHLY_CAP_EXCEEDED"):].splitlines()[0]
        return JSONResponse(status_code=409, content={"detail": {"code": "OT_MONTHLY_CAP_EXCEEDED", "message": msg}}, headers=headers)

    if "foreign key" in error_str.lower():
        msg = "Dữ liệu liên kết không hợp lệ (nhân viên, cửa hàng hoặc ca làm việc không tồn tại hoặc đã thay đổi)."
        return JSONResponse(status_code=422, content={"detail": msg}, headers=headers)
        
    return JSONResponse(
        status_code=500,
        content={"detail": "Máy chủ gặp sự cố khi xử lý dữ liệu. Vui lòng tải lại trang hoặc thử lại sau ít phút."},
        headers=headers
    )

@app.exception_handler(Exception)
async def global_unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception(f"Lỗi chưa bắt được tại {request.method} {request.url.path}: {exc}")
    origin = request.headers.get("origin")
    headers = {}
    if origin:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
        headers["Access-Control-Allow-Methods"] = "*"
        headers["Access-Control-Allow-Headers"] = "*"
    
    err_msg = str(exc)
    # Lọc bỏ các thông báo kỹ thuật SQL/ORM để không làm lộ cấu trúc hệ thống và gây khó hiểu cho người dùng
    if any(k in err_msg for k in ["SQL", "sqlalchemy", "asyncpg", "INSERT INTO", "SELECT", "UPDATE", "DELETE FROM"]):
        user_msg = "Lỗi hệ thống máy chủ khi xử lý dữ liệu. Vui lòng tải lại trang hoặc thử lại sau ít phút."
    else:
        user_msg = f"Lỗi hệ thống máy chủ: {err_msg}"

    return JSONResponse(
        status_code=500,
        content={"detail": user_msg},
        headers=headers
    )

# Mount các tuyến API v1
app.include_router(api_router, prefix=settings.API_V1_STR)
# Mount thêm alias /api để tương thích ngược
app.include_router(api_router, prefix="/api")

# Mount thư mục tĩnh uploads (phục vụ file chứng từ, hợp đồng, đơn thôi việc khi lưu cục bộ)
import os
from fastapi.staticfiles import StaticFiles
uploads_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads")
os.makedirs(uploads_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")

@app.get("/", tags=["Hệ thống (System)"])
async def root():
    return {
        "project": "TechZone HRM API",
        "version": "1.0.0",
        "author": "Huỳnh Viễn Thông (Lead Developer)",
        "docs_url": "/docs",
        "redoc_url": "/redoc",
        "api_v1": settings.API_V1_STR
    }
