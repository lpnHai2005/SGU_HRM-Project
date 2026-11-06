"""Cutoff policy for legacy attendance-based OT decisions; no payroll formula changes."""

from calendar import monthrange
from datetime import date

from app.core.config import settings


LEGACY_OT_LOCK_MESSAGE = (
    "Luồng duyệt OT cũ (theo giờ ngoài ca) đã đóng. Bảng lương chỉ trả OT đã được HR đối soát "
    "VERIFIED trong quy trình Đăng ký & đối soát OT. Giờ ngoài ca đã ghi nhận vẫn được giữ để đối chiếu."
)

# Sign-off 2026-11-06 #4: Payroll chỉ dùng một nguồn OT (VERIFIED_ONLY) — luồng duyệt legacy đóng vĩnh viễn.
LEGACY_OT_APPROVAL_CLOSED = True


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
