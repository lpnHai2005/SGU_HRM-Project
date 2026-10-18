"""Domain helpers for the overtime request workflow (separate from attendance)."""
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException

VIETNAM_TZ = ZoneInfo("Asia/Ho_Chi_Minh")
ACTIVE_REQUEST_STATUSES = (
    "DRAFT", "PENDING_EMPLOYEE_CONFIRMATION", "PENDING_HR", "APPROVED"
)


def local_interval(work_date: date, start_time: time, end_time: time) -> tuple[datetime, datetime]:
    """Convert Vietnam wall-clock times into aware timestamps; end<=start means overnight."""
    if start_time.tzinfo is not None or end_time.tzinfo is not None:
        raise HTTPException(422, "OT times must be local Vietnam times without an offset")
    if start_time == end_time:
        raise HTTPException(422, "OT start and end times cannot be equal")
    starts_at = datetime.combine(work_date, start_time, VIETNAM_TZ)
    ends_at = datetime.combine(work_date, end_time, VIETNAM_TZ)
    if ends_at <= starts_at:
        ends_at += timedelta(days=1)
    return starts_at, ends_at


def require_transition(current: str, allowed: set[str], action: str) -> None:
    if current not in allowed:
        raise HTTPException(409, {
            "code": "INVALID_OVERTIME_TRANSITION",
            "message": f"Cannot {action} overtime request in state {current}",
            "current_status": current,
        })
