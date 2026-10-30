from typing import AsyncGenerator
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import declarative_base, sessionmaker
from app.core.config import settings

# Giữ pool nhỏ vì session pooler Supabase giới hạn client dùng chung cho
# cùng database/role. Mỗi process tối đa 3 async + 1 sync connection;
# không cho overflow tạo thêm client khi tải tăng đột biến.
# 1. Async Engine kết nối Supabase PostgreSQL qua pooler cổng 5432
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    future=True,
    pool_size=3,
    max_overflow=0,
    pool_timeout=15,
    pool_recycle=300,
    pool_pre_ping=True
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)

async_session_maker = AsyncSessionLocal

# 2. Sync Engine cho các tác vụ đồng bộ / tiện ích nếu cần
sync_engine = None
if settings.SYNC_DATABASE_URL:
    sync_engine = create_engine(
        settings.SYNC_DATABASE_URL,
        pool_size=1,
        max_overflow=0,
        pool_timeout=15,
        pool_recycle=300,
        pool_pre_ping=True
    )

# 3. Base class cho SQLAlchemy Models
Base = declarative_base()

# 4. Dependency cấp phát Database Session cho FastAPI
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
