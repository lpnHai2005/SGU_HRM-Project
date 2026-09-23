import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from app.core.config import settings
from app.core.database import engine
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
    
    yield
    
    # Dọn dẹp tài nguyên khi tắt server
    logger.info("Đang đóng các kết nối CSDL...")
    await engine.dispose()
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
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount các tuyến API v1
app.include_router(api_router, prefix=settings.API_V1_STR)
# Mount thêm alias /api để tương thích ngược
app.include_router(api_router, prefix="/api")

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
