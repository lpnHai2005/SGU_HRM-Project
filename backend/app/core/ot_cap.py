"""Trần OT 40h/tháng: tính tổng OT đã cam kết của nhân viên và chặn cứng khi vượt.

DB cũng có trigger trg_guard_monthly_ot_cap làm lớp chặn cuối; các hàm ở đây
trả lỗi 409 dễ đọc trước khi chạm tới trigger.
"""
from fastapi import HTTPException
from sqlalchemy import text

from app.core.payroll_rules import MAX_MONTHLY_OT_HOURS, OvertimeCapExceeded, ensure_monthly_ot_cap


async def _column_exists(db, table: str, column: str) -> bool:
    return bool((await db.execute(text("""SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name=:t AND column_name=:c"""), {'t': table, 'c': column})).first())


async def monthly_ot_cap(db) -> float:
    try:
        async with db.begin_nested():
            value = (await db.execute(text("""SELECT numeric_value FROM payroll_policy_settings
                WHERE setting_key='MAX_MONTHLY_OT_HOURS' AND is_active=TRUE"""))).scalar_one_or_none()
    except Exception:
        value = None
    return float(value) if value is not None else MAX_MONTHLY_OT_HOURS


async def committed_ot_hours(db, employee_id: int, period: str, *, exclude_request_ids: list[int] | None = None,
                             exclude_attendance_ids: list[int] | None = None,
                             exclude_schedule_id: int | None = None) -> float:
    """OT đã duyệt + OT tự động của ca Full đã xếp + đơn OT đã duyệt chưa đối soát."""
    params = {'emp': employee_id, 'period': period, 'ex_att': list(exclude_attendance_ids or []),
              'ex_req': list(exclude_request_ids or []), 'ex_ws': exclude_schedule_id or 0}
    ledger = (await db.execute(text("""SELECT COALESCE(SUM(ota.approved_hours),0)
        FROM attendance_overtime_approvals ota JOIN attendances a USING(attendance_id)
        WHERE a.employee_id=:emp AND to_char(a.work_date,'YYYY-MM')=:period AND ota.decision='APPROVED'
          AND NOT (a.attendance_id = ANY(CAST(:ex_att AS bigint[])))"""), params)).scalar_one()
    planned = 0
    if await _column_exists(db, 'work_shifts', 'planned_overtime_hours'):
        planned = (await db.execute(text("""SELECT COALESCE(SUM(sh.planned_overtime_hours),0)
            FROM work_schedules ws JOIN work_shifts sh USING(shift_id)
            WHERE ws.employee_id=:emp AND ws.cancelled_at IS NULL AND ws.schedule_id<>:ex_ws
              AND to_char(ws.work_date,'YYYY-MM')=:period"""), params)).scalar_one()
    pending = (await db.execute(text("""SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (o.ends_at-o.starts_at))/3600.0),0)
        FROM overtime_requests o LEFT JOIN overtime_reconciliations r USING(request_id)
        WHERE o.employee_id=:emp AND to_char(o.work_date,'YYYY-MM')=:period AND o.status='APPROVED'
          AND NOT (o.request_id = ANY(CAST(:ex_req AS bigint[]))) AND (r.status IS NULL OR r.status NOT IN ('VERIFIED','REJECTED'))"""),
        params)).scalar_one()
    return round(float(ledger or 0) + float(planned or 0) + float(pending or 0), 2)


async def require_ot_within_cap(db, employee_id: int, period: str, additional_hours: float, **exclude) -> float:
    cap = await monthly_ot_cap(db)
    existing = await committed_ot_hours(db, employee_id, period, **exclude)
    try:
        return ensure_monthly_ot_cap(existing, additional_hours, cap)
    except OvertimeCapExceeded as exc:
        raise HTTPException(409, {'code': 'OT_MONTHLY_CAP_EXCEEDED', 'message': str(exc),
                                  'existing_hours': existing, 'additional_hours': round(additional_hours, 2),
                                  'cap_hours': cap})
