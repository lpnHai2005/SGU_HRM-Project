from datetime import date

from app.api.v1.endpoints.resignations import self_service_min_last_day


def test_min_last_day_is_one_calendar_month_later():
    assert self_service_min_last_day(date(2026, 11, 14)) == date(2026, 12, 14)
    assert self_service_min_last_day(date(2026, 12, 20)) == date(2027, 1, 20)
    # Cuối tháng dài -> cuối tháng ngắn
    assert self_service_min_last_day(date(2027, 1, 31)) == date(2027, 2, 28)
