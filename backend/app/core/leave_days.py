"""Quy tắc đếm ngày nghỉ dùng chung cho API, chatbot và bước đồng bộ chấm công."""
from datetime import date, timedelta
from typing import Iterable, List

from sqlalchemy import text


def working_dates(start: date, end: date, holidays: Iterable[date] = ()) -> List[date]:
    """Ngày phải đi làm trong khoảng: bỏ Chủ nhật và ngày lễ."""
    off = set(holidays)
    days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    return [day for day in days if day.weekday() != 6 and day not in off]


async def leave_working_dates(db, start: date, end: date) -> List[date]:
    rows = await db.execute(
        text("SELECT holiday_date FROM public_holidays WHERE holiday_date BETWEEN :start AND :end"),
        {"start": start, "end": end},
    )
    return working_dates(start, end, rows.scalars().all())


async def count_leave_days(db, start: date, end: date, type_code: str) -> float:
    # Thai sản tính theo ngày lịch (tối đa 180 ngày, TZ-DOC-04); các loại khác theo ngày làm việc.
    if type_code == "THAI_SAN":
        return float((end - start).days + 1)
    return float(len(await leave_working_dates(db, start, end)))
