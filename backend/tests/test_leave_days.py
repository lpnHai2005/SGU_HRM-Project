from datetime import date

from app.core.leave_days import working_dates


def test_sunday_is_not_a_leave_day():
    # Thứ 7 14/11 đến Thứ 2 16/11/2026
    assert working_dates(date(2026, 11, 14), date(2026, 11, 16)) == [date(2026, 11, 14), date(2026, 11, 16)]


def test_public_holiday_is_not_a_leave_day():
    days = working_dates(date(2026, 9, 1), date(2026, 9, 3), [date(2026, 9, 1), date(2026, 9, 2)])
    assert days == [date(2026, 9, 3)]


def test_range_with_only_a_sunday_has_no_leave_day():
    assert working_dates(date(2026, 11, 15), date(2026, 11, 15)) == []
