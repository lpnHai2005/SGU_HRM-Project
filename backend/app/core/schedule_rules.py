"""Quy tắc phân ca tuần T2–CN và trần OT tháng (bản thuần Python).

Không chứa công thức lương: không đổi công chuẩn, phụ cấp hay tiền phạt của bảng lương.
"""
from dataclasses import dataclass
from datetime import date, timedelta

STANDARD_DAILY_HOURS = 8.0
MAX_MONTHLY_OT_HOURS = 40.0
MAX_WEEKLY_REGULAR_HOURS = 48.0  # Điều 105 BLLĐ 2019
MAX_WORK_DAYS_PER_WEEK = 6


# ---------------------------------------------------------------- Lịch tuần T2–CN
def week_bounds(day: date) -> tuple[date, date]:
    """(Thứ Hai, Chủ Nhật) của tuần chứa ngày `day`."""
    monday = day - timedelta(days=day.weekday())
    return monday, monday + timedelta(days=6)


@dataclass(frozen=True)
class WeeklyCheck:
    work_days: int
    regular_hours: float
    errors: tuple[str, ...]
    warnings: tuple[str, ...]


def check_weekly_schedule(regular_hours_by_day: dict[date, float]) -> WeeklyCheck:
    """Một tuần T2–CN: bắt buộc ≥ 1 ngày OFF và tối đa 48h công chuẩn — cả hai đều chặn.

    Giờ vượt phải đi qua luồng Đăng ký & đối soát OT, không xếp vào lịch thường.
    """
    days = {d for d, h in regular_hours_by_day.items() if h > 0}
    hours = round(sum(regular_hours_by_day.values()), 2)
    errors: list[str] = []
    if len(days) > MAX_WORK_DAYS_PER_WEEK:
        errors.append(f'WEEKLY_DAY_OFF_REQUIRED: nhân viên phải có ít nhất 1 ngày OFF/tuần '
                      f'(đang xếp {len(days)}/7 ngày).')
    if hours > MAX_WEEKLY_REGULAR_HOURS:
        errors.append(f'WEEKLY_HOURS_OVER_48: tổng giờ công chuẩn tuần {hours:g}h vượt 48h; '
                      'phần vượt phải đăng ký OT.')
    return WeeklyCheck(len(days), hours, tuple(errors), ())


# ---------------------------------------------------------------- Trần OT tháng
class OvertimeCapExceeded(ValueError):
    """Tổng OT tháng vượt trần."""


def ensure_monthly_ot_cap(existing_hours: float, additional_hours: float,
                          cap: float = MAX_MONTHLY_OT_HOURS) -> float:
    """Chặn cứng khi tổng OT tháng vượt trần. Trả về tổng mới."""
    total = round(float(existing_hours or 0) + float(additional_hours or 0), 2)
    if additional_hours > 0 and total > cap + 1e-9:
        raise OvertimeCapExceeded(
            f'OT_MONTHLY_CAP_EXCEEDED: tổng OT tháng sẽ là {total:g}h, vượt trần {cap:g}h/tháng '
            f'(đã có {float(existing_hours or 0):g}h).')
    return total
