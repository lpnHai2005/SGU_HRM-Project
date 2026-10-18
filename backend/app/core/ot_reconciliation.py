"""Pure interval reconciliation for approved overtime; no payroll calculation."""

from dataclasses import dataclass
from datetime import datetime, timezone
import json


Interval = tuple[datetime, datetime]


def _aware(value) -> datetime:
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Timestamp must contain a timezone offset")
    return value.astimezone(timezone.utc)


def union_intervals(intervals: list[Interval]) -> list[Interval]:
    result: list[Interval] = []
    for start, end in sorted(intervals):
        if end <= start:
            raise ValueError("Interval end must be after start")
        if result and start <= result[-1][1]:
            result[-1] = (result[-1][0], max(result[-1][1], end))
        else:
            result.append((start, end))
    return result


def subtract_intervals(source: list[Interval], exclusions: list[Interval]) -> list[Interval]:
    remaining: list[Interval] = []
    for start, end in union_intervals(source):
        cursor = start
        for blocked_start, blocked_end in union_intervals(exclusions):
            if blocked_end <= cursor or blocked_start >= end:
                continue
            if blocked_start > cursor:
                remaining.append((cursor, min(blocked_start, end)))
            cursor = max(cursor, blocked_end)
            if cursor >= end:
                break
        if cursor < end:
            remaining.append((cursor, end))
    return remaining


def _overlap(left: Interval, right: Interval) -> Interval | None:
    start, end = max(left[0], right[0]), min(left[1], right[1])
    return (start, end) if start < end else None


@dataclass(frozen=True)
class ReconciliationPreview:
    proposed_microseconds: int
    eligible_intervals: list[dict[str, str]]
    attendance_ids: list[int]
    issues: list[str]

    @property
    def status(self) -> str:
        return "NEEDS_REVIEW" if self.issues else "PENDING_RECONCILIATION"


def reconcile_intervals(
    approved_start: datetime,
    approved_end: datetime,
    store_id: int,
    attendances: list[dict],
) -> ReconciliationPreview:
    """Find actual worked time outside snapshotted regular shifts, within approved OT.

    Ambiguous/invalid attendance is listed as an issue and must never be verified.
    Results retain microsecond precision; no rounding or pay multiplier is applied.
    """
    approved = (_aware(approved_start), _aware(approved_end))
    if approved[1] <= approved[0]:
        raise ValueError("Approved interval is invalid")
    actual: list[Interval] = []
    regular: list[Interval] = []
    attendance_ids: list[int] = []
    issues: set[str] = set()

    for row in attendances:
        attendance_ids.append(int(row["attendance_id"]))
        try:
            check_in = _aware(row["check_in_time"])
            check_out = _aware(row["check_out_time"])
            if check_out <= check_in:
                raise ValueError("Invalid attendance interval")
            worked = _overlap((check_in, check_out), approved)
            if not worked:
                continue
            context = row.get("attendance_context")
            if isinstance(context, str):
                context = json.loads(context)
            if not isinstance(context, dict) or context.get("schedule_status") != "MATCHED":
                issues.add("SCHEDULE_SNAPSHOT_MISSING_OR_MISMATCH")
                continue
            planned, shift = context.get("planned"), context.get("actual")
            if not isinstance(planned, dict) or not isinstance(shift, dict):
                issues.add("SCHEDULE_SNAPSHOT_MISSING_OR_MISMATCH")
                continue
            if (row.get("store_id") != store_id or planned.get("store_id") != store_id
                    or planned.get("shift_id") != shift.get("shift_id")):
                issues.add("STORE_OR_SHIFT_MISMATCH")
                continue
            shift_start = _aware(planned["starts_at"])
            shift_end = _aware(planned["ends_at"])
            if shift_end <= shift_start:
                raise ValueError("Invalid schedule snapshot interval")
            actual.append(worked)
            regular.append((shift_start, shift_end))
        except (KeyError, TypeError, ValueError):
            issues.add("INVALID_OR_OPEN_ATTENDANCE_SNAPSHOT")

    if not attendances:
        issues.add("NO_ATTENDANCE")
    ordered_actual = sorted(actual)
    has_overlap = any(start < previous_end for (_, previous_end), (start, _) in
                      zip(ordered_actual, ordered_actual[1:]))
    merged_actual = union_intervals(actual)
    if has_overlap:
        issues.add("OVERLAPPING_ATTENDANCE")
    eligible = subtract_intervals(merged_actual, regular)
    microseconds = sum(
        (end - start).days * 86_400_000_000
        + (end - start).seconds * 1_000_000
        + (end - start).microseconds
        for start, end in eligible
    )
    return ReconciliationPreview(
        proposed_microseconds=microseconds,
        eligible_intervals=[{"starts_at": start.isoformat(), "ends_at": end.isoformat()}
                            for start, end in eligible],
        attendance_ids=sorted(set(attendance_ids)),
        issues=sorted(issues),
    )
