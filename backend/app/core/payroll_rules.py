"""Quy tắc lương, công, OT và kỷ luật (bản thuần Python).

Stored procedure `sp_generate_monthly_payroll` (migration 20261106) áp dụng cùng
các quy tắc này trong SQL. Module này dùng cho validate ở API và cho unit test.
"""
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal

from app.core.attendance import VIETNAM_TZ, net_work_hours  # noqa: F401 (re-export)


def sql_round(value, digits: int = 0):
    """Làm tròn giống ROUND() NUMERIC của PostgreSQL: nửa xa số 0 (2.5 → 3, −2.5 → −3).

    round() của Python làm tròn về số chẵn (2.5 → 2), có thể lệch 1đ so với phiếu lương do SP tính.
    Tính trên Decimal để tránh sai số dấu phẩy động (VD 0.125 → 0.13).
    """
    exp = Decimal(1).scaleb(-digits)
    result = Decimal(str(value)).quantize(exp, rounding=ROUND_HALF_UP)
    return int(result) if digits == 0 else float(result)


def _money(numerator, denominator=1) -> int:
    """Phép chia tiền tính bằng Decimal rồi làm tròn kiểu SQL (đơn vị đồng)."""
    return sql_round(Decimal(str(numerator)) / Decimal(str(denominator)))

STANDARD_DAYS = 26
STANDARD_DAILY_HOURS = 8.0
HALF_DAY_MIN_HOURS = 4.0
FULL_DAY_MIN_HOURS = 7.5
LATE_GRACE_MINUTES = 15
ATTENDANCE_MIN_DAYS = 20
LATE_WARNING_THRESHOLD_DAYS = 5
BLACKLIST_CONSECUTIVE_MONTHS = 3
MAX_MONTHLY_OT_HOURS = 40.0
MAX_WEEKLY_REGULAR_HOURS = 48.0
MAX_WORK_DAYS_PER_WEEK = 6
NIGHT_START = time(22, 0)
NIGHT_END = time(8, 0)


# ---------------------------------------------------------------- Công ngày
def work_day_credit(actual_work_hours: float | None) -> float:
    """Quy đổi giờ làm trong ngày ra công: 0 / 0.5 / 1.0 (tối đa 1 công/ngày)."""
    hours = float(actual_work_hours or 0)
    if hours < HALF_DAY_MIN_HOURS:
        return 0.0
    if hours < FULL_DAY_MIN_HOURS:
        return 0.5
    return 1.0


def split_shift_hours(elapsed_hours: float, break_minutes: int = 0,
                      regular_hours: float = STANDARD_DAILY_HOURS) -> tuple[float, float]:
    """Tách giờ làm thực tế thành (giờ công chuẩn, giờ OT).

    Ca cuối tuần 08:00–21:00 (13h, nghỉ 1h) -> 12h thực tế -> (8.0, 4.0).
    """
    net = net_work_hours(elapsed_hours, break_minutes)
    regular = min(net, regular_hours)
    return sql_round(regular, 2), sql_round(max(0.0, net - regular), 2)


# ---------------------------------------------------------------- Lương & phụ cấp
def prorated_base_pay(base_salary: float, payable_days: float,
                      standard_days: float = STANDARD_DAYS) -> int:
    """Lương cơ bản theo công: base/26 × công. KHÔNG chặn trần (27 công > lương HĐ)."""
    if standard_days <= 0:
        return 0
    return _money(Decimal(str(base_salary)) * Decimal(str(max(0.0, float(payable_days)))), standard_days)


def prorated_lunch_allowance(amount: float, actual_work_days: float, *, cap: bool = True,
                             standard_days: float = STANDARD_DAYS) -> int:
    """Phụ cấp ăn trưa & đi lại theo công thực tế; mặc định chặn trần ở 26 công."""
    if standard_days <= 0:
        return 0
    days = max(0.0, float(actual_work_days))
    if cap:
        days = min(days, standard_days)
    return _money(Decimal(str(amount)) * Decimal(str(days)), standard_days)


def attendance_allowance(amount: float, late_over_grace_days: int, actual_work_days: float,
                         *, min_days: float = ATTENDANCE_MIN_DAYS) -> int:
    """Phụ cấp chuyên cần lũy tiến.

    - công < 20 hoặc trễ >15' từ 5 lần: 0đ
    - trễ 3–4 lần: 50%
    - trễ < 3 lần và công >= 20: 100%
    """
    if actual_work_days < min_days or late_over_grace_days >= LATE_WARNING_THRESHOLD_DAYS:
        return 0
    if late_over_grace_days >= 3:
        return _money(amount, 2)
    return sql_round(amount)


def attendance_allowance_tier(late_over_grace_days: int, actual_work_days: float,
                              *, min_days: float = ATTENDANCE_MIN_DAYS) -> str:
    if actual_work_days < min_days:
        return 'NOT_ENOUGH_DAYS'
    if late_over_grace_days >= LATE_WARNING_THRESHOLD_DAYS:
        return 'LATE_REPORT'
    if late_over_grace_days >= 3:
        return 'HALF'
    return 'FULL'


@dataclass(frozen=True)
class MonthlyPay:
    base_pay: int
    lunch_allowance: int
    attendance_allowance: int

    @property
    def total(self) -> int:
        return self.base_pay + self.lunch_allowance + self.attendance_allowance


def payable_work_days(actual_work_days: float, paid_leave_days: float = 0.0,
                      standard_days: float = STANDARD_DAYS) -> float:
    """Công hưởng lương: phép có lương chỉ bù cho đủ công chuẩn, không tạo công vượt chuẩn.

    27 công làm thực tế → 27 (được trả phần vượt). 25 công + 2 phép → 26 (không phải 27).
    """
    actual = max(0.0, float(actual_work_days))
    return max(actual, min(actual + max(0.0, float(paid_leave_days)), float(standard_days)))


def monthly_pay(base_salary: float, lunch_amount: float, attendance_amount: float,
                actual_work_days: float, late_over_grace_days: int,
                paid_leave_days: float = 0.0) -> MonthlyPay:
    return MonthlyPay(
        base_pay=prorated_base_pay(base_salary, payable_work_days(actual_work_days, paid_leave_days)),
        lunch_allowance=prorated_lunch_allowance(lunch_amount, actual_work_days),
        attendance_allowance=attendance_allowance(attendance_amount, late_over_grace_days, actual_work_days),
    )


# ---------------------------------------------------------------- OT
def _local(value: datetime) -> datetime:
    return value.replace(tzinfo=VIETNAM_TZ) if value.tzinfo is None else value.astimezone(VIETNAM_TZ)


def night_overlap_hours(start: datetime, end: datetime) -> float:
    """Số giờ nằm trong khung đêm 22:00–08:00 (giờ Việt Nam)."""
    start, end = _local(start), _local(end)
    if end <= start:
        return 0.0
    total = timedelta()
    day = start.date() - timedelta(days=1)
    while day <= end.date():
        night_start = datetime.combine(day, NIGHT_START, VIETNAM_TZ)
        night_end = datetime.combine(day + timedelta(days=1), NIGHT_END, VIETNAM_TZ)
        lo, hi = max(start, night_start), min(end, night_end)
        if hi > lo:
            total += hi - lo
        day += timedelta(days=1)
    return sql_round(total.total_seconds() / 3600, 2)


def ot_pay_multiplier_hours(start: datetime, end: datetime, *, is_sunday: bool = False,
                            is_holiday: bool = False, normal_rate: float = 1.5,
                            night_rate: float = 2.0, weekend_rate: float = 2.0,
                            holiday_rate: float = 3.0) -> float:
    """Giờ OT đã nhân hệ số (giờ quy đổi). Lễ > Chủ nhật/Đêm > Ngày thường."""
    hours = max(0.0, (_local(end) - _local(start)).total_seconds() / 3600)
    if is_holiday:
        return sql_round(hours * holiday_rate, 4)
    if is_sunday:
        return sql_round(hours * max(weekend_rate, night_rate), 4)
    night = night_overlap_hours(start, end)
    return sql_round((hours - night) * normal_rate + night * night_rate, 4)


class OvertimeCapExceeded(ValueError):
    pass


def ensure_monthly_ot_cap(existing_hours: float, additional_hours: float,
                          cap: float = MAX_MONTHLY_OT_HOURS) -> float:
    """Chặn cứng khi tổng OT tháng vượt trần. Trả về tổng mới."""
    total = sql_round(float(existing_hours or 0) + float(additional_hours or 0), 2)
    if additional_hours > 0 and total > cap + 1e-9:
        raise OvertimeCapExceeded(
            f'OT_MONTHLY_CAP_EXCEEDED: tổng OT tháng sẽ là {total:g}h, vượt trần {cap:g}h/tháng '
            f'(đã có {float(existing_hours or 0):g}h).')
    return total


# ---------------------------------------------------------------- Phân ca tuần
def week_bounds(day: date) -> tuple[date, date]:
    monday = day - timedelta(days=day.weekday())
    return monday, monday + timedelta(days=6)


@dataclass(frozen=True)
class WeeklyCheck:
    work_days: int
    regular_hours: float
    errors: tuple[str, ...]
    warnings: tuple[str, ...]


def check_weekly_schedule(regular_hours_by_day: dict[date, float]) -> WeeklyCheck:
    """Một tuần T2–CN: bắt buộc ≥1 ngày OFF và tối đa 48h công chuẩn (Điều 105 BLLĐ) — cả hai đều chặn.

    Giờ vượt phải đi qua luồng Đăng ký & đối soát OT, không xếp vào lịch thường (sign-off 2026-11-06 #5).
    """
    days = {d for d, h in regular_hours_by_day.items() if h > 0}
    hours = sql_round(sum(regular_hours_by_day.values()), 2)
    errors, warnings = [], []
    if len(days) > MAX_WORK_DAYS_PER_WEEK:
        errors.append(f'WEEKLY_DAY_OFF_REQUIRED: nhân viên phải có ít nhất 1 ngày OFF/tuần '
                      f'(đang xếp {len(days)}/7 ngày).')
    if hours > MAX_WEEKLY_REGULAR_HOURS:
        errors.append(f'WEEKLY_HOURS_OVER_48: tổng giờ công chuẩn tuần {hours:g}h vượt 48h; '
                      'phần vượt phải đăng ký OT.')
    return WeeklyCheck(len(days), hours, tuple(errors), tuple(warnings))


# ---------------------------------------------------------------- Kỷ luật
def previous_periods(period: str, count: int) -> list[str]:
    """['2026-11', '2026-10', '2026-09'] cho period='2026-11', count=3."""
    year, month = map(int, period.split('-'))
    result = []
    for _ in range(count):
        result.append(f'{year:04d}-{month:02d}')
        month -= 1
        if month == 0:
            year, month = year - 1, 12
    return result


def needs_late_warning_report(late_over_grace_days: int) -> bool:
    return late_over_grace_days >= LATE_WARNING_THRESHOLD_DAYS


def is_blacklist_warning(period: str, report_periods: set[str]) -> bool:
    """Bị lập biên bản trễ 3 tháng liên tiếp (M-2, M-1, M)."""
    return all(p in report_periods for p in previous_periods(period, BLACKLIST_CONSECUTIVE_MONTHS))
