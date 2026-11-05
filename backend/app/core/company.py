"""Thông tin pháp nhân của công ty, lưu trong bảng company_profile."""
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def get_company_profile(db: AsyncSession) -> dict:
    """Trả về rỗng khi chưa nhập, để nơi in tự để trống thay vì điền giá trị giả."""
    res = await db.execute(text("""
        SELECT company_name AS name, tax_code, address, phone, email
        FROM company_profile
        WHERE company_id = 1
    """))
    row = res.mappings().first()
    return dict(row) if row else {}
