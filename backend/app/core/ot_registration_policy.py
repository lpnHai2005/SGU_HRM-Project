"""Cutoff policy for legacy attendance-based OT decisions; no payroll formula changes."""

from calendar import monthrange
from datetime import date

from app.core.config import settings


LEGACY_OT_LOCK_MESSAGE = (
    "Phiên thuộc giai đoạn đăng ký OT mới. Không thể duyệt giờ ngoài ca qua luồng cũ; "
    "giờ ngoài ca đã ghi nhận vẫn được giữ để đối chiếu. Liên hệ HR để xử lý theo quy chế mới."
)


def legacy_decision_locked(work_date: date) -> bool:
    """Attendance work_date is the Vietnam business day, also for overnight shifts."""
    cutoff = settings.OT_REGISTRATION_POLICY_EFFECTIVE_FROM
    return settings.OT_REGISTRATION_POLICY_MODE != "DISABLED" and cutoff is not None and work_date >= cutoff


def period_overlaps_policy(salary_period: str) -> bool:
    cutoff = settings.OT_REGISTRATION_POLICY_EFFECTIVE_FROM
    if settings.OT_REGISTRATION_POLICY_MODE == "DISABLED" or cutoff is None:
        return False
    year, month = map(int, salary_period.split("-"))
    return date(year, month, monthrange(year, month)[1]) >= cutoff
