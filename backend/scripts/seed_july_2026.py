"""Seed dữ liệu chấm công tháng 07/2026 theo danh mục ca chuẩn (ca cố định, migration 20261106).

Chạy: python scripts/seed_july_2026.py           (cần đã áp migration 20261106)

Quy chế áp dụng:
- Ca sáng 08:00–16:00 = 8h = 1 công; ca chiều 13:00–21:00 = 8h = 1 công (ăn luân phiên, không trừ giờ).
- Ca Full 08:00–21:00 = 13h − 1h nghỉ = 12h = 8h công + 4h OT tự động.
- Công ngày: < 4h = 0; 4h–< 7.5h = 0.5; ≥ 7.5h = 1. Công chuẩn cố định 26.
- Lịch T2–CN, mỗi tuần nghỉ Chủ nhật (≥ 1 ngày OFF). Không phạt tiền đi trễ.

Tháng 07/2026: bắt đầu Thứ Tư, 4 Chủ nhật (5, 12, 19, 26) → 27 ngày làm việc.
Kịch bản (lương HĐ minh họa trong test: 6.000.000đ):
- #5 Hoàng Thị Em: 27/27 ngày đúng giờ (27/26 công, lương vượt HĐ), OT 1.5h ngày 20,
  Ca Full Thứ 7 25/07 (8h + 4h OT tự động) → chuyên cần 100%, PC ăn trưa chặn 1.000.000đ.
- #4 Phạm Quốc Dũng (ca sáng): 5 ngày trễ hợp lệ (3, 4, 6, 9, 13) → mất chuyên cần + biên bản;
  ngày 21 trễ 300' (> 240') chờ HR rà soát, chưa tính — HR 'Xác nhận trễ' thì thành 6 ngày;
  ngày 9 làm 7.42h → 0.5 công; OT 2h + 3h; ngày 14 ở lại 1.5h không có đơn OT (không trả).
- #3 Lê Văn Cường (ca chiều): 3 ngày trễ > 15' (3, 4, 8) → chuyên cần 50%;
  ngày 15 OT 21:00–23:00 (1h thường + 1h đêm x2.0); ngày 18 phiên 5 phút → 0 công.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# Cho phép chạy trực tiếp `python scripts/seed_july_2026.py` từ thư mục backend/.
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from app.core.payroll_rules import split_shift_hours  # noqa: E402

VN_TZ = ZoneInfo('Asia/Ho_Chi_Minh')
PERIOD = '2026-07'
YEAR, MONTH = 2026, 7
STORE_ID = 5
REVIEWER_USER_ID = 2
GRACE_MINUTES = 15

# Danh mục ca chuẩn sau migration 20261106 (seed kiểm tra DB khớp trước khi ghi).
STANDARD_SHIFTS = {
    'CA_SANG': dict(start=time(8), end=time(16), work_hours=8.0, break_minutes=0, planned_ot=0.0),
    'CA_CHIEU': dict(start=time(13), end=time(21), work_hours=8.0, break_minutes=0, planned_ot=0.0),
    'CA_FULL': dict(start=time(8), end=time(21), work_hours=8.0, break_minutes=60, planned_ot=4.0),
}


@dataclass
class Shift:
    shift_id: int
    code: str
    name: str
    start: time
    end: time
    work_hours: float
    break_minutes: int
    planned_ot: float


@dataclass
class Session:
    key: str
    employee_id: int
    shift: Shift
    work_date: date
    check_in: datetime
    check_out: datetime
    late_minutes: int
    early_minutes: int
    actual_work_hours: float
    overtime_hours: float
    status: str
    note: str = ''
    ot: tuple[datetime, datetime, str] | None = None  # (bắt đầu, kết thúc, lý do) đơn OT đã duyệt

    def context(self) -> str:
        s = self.shift
        return json.dumps({'schedule_status': 'MATCHED', 'actual': {
            'shift_id': s.shift_id, 'shift_code': s.code, 'shift_name': s.name,
            'start_time': s.start.strftime('%H:%M:%S'), 'end_time': s.end.strftime('%H:%M:%S'),
            'work_hours': s.work_hours, 'break_minutes': s.break_minutes,
            'planned_overtime_hours': s.planned_ot}})


@dataclass
class Dataset:
    sessions: list[Session] = field(default_factory=list)
    schedules: list[dict] = field(default_factory=list)


def _at(day: date, value: time) -> datetime:
    return datetime.combine(day, value, tzinfo=VN_TZ)


def make_session(employee_id: int, shift: Shift, day: date, cin: time, cout: time,
                 note: str = '', ot: tuple[time, time, str] | None = None) -> Session:
    """Tính chỉ số phiên giống check-out thật: trễ/sớm theo giờ ca, giờ làm trừ nghỉ, tách giờ công/OT."""
    start, end = _at(day, shift.start), _at(day, shift.end)
    check_in, check_out = _at(day, cin), _at(day, cout)
    late = max(0, round((check_in - start).total_seconds() / 60))
    early = max(0, round((end - check_out).total_seconds() / 60))
    regular, overtime = split_shift_hours((check_out - check_in).total_seconds() / 3600,
                                          shift.break_minutes, shift.work_hours)
    actual = round(regular + overtime, 2)
    if late > GRACE_MINUTES and early > 0:
        status = 'LATE_AND_EARLY'
    elif late > GRACE_MINUTES:
        status = 'LATE'
    elif early > 0:
        status = 'EARLY'
    elif overtime > 0:
        status = 'OVERTIME'
    else:
        status = 'NORMAL'
    ot_window = (_at(day, ot[0]), _at(day, ot[1]), ot[2]) if ot else None
    return Session(f'{employee_id}-{day.isoformat()}', employee_id, shift, day, check_in, check_out,
                   late, early, actual, overtime, status, note, ot_window)


def july_work_days() -> list[date]:
    days = [date(YEAR, MONTH, d) for d in range(1, 32)]
    return [d for d in days if d.weekday() != 6]  # nghỉ Chủ nhật → mỗi tuần T2–CN có 1 ngày OFF


# (giờ vào, giờ ra, ghi chú, đơn OT) theo ngày; ngày không liệt kê = đúng ca.
DUNG_CASES = {  # NV #4, ca sáng
    1: (time(7), time(15), 'Vào sớm 1h, về sớm 60p (vẫn đủ 8h)', None),
    3: (time(9), time(17), 'Trễ 60p, làm bù đủ 8h', None),
    4: (time(10), time(18), 'Trễ 120p, làm bù đủ 8h', None),
    6: (time(10), time(18), 'Trễ 120p, làm bù đủ 8h', None),
    7: (time(8, 10), time(16, 10), 'Trễ 10p trong ân hạn', None),
    8: (time(8, 14), time(16, 14), 'Trễ 14p trong ân hạn', None),
    9: (time(8, 35), time(16), 'Trễ 35p, 7.42h → 0.5 công', None),
    10: (time(8), time(18), 'OT 2h có đơn', (time(16), time(18), 'Tăng ca kiểm kê hàng tồn kho')),
    11: (time(8), time(19), 'OT 3h có đơn', (time(16), time(19), 'Tăng ca phụ trách đợt khuyến mãi')),
    13: (time(9), time(17), 'Sliding shift: trễ 60p, làm bù 8h', None),
    14: (time(8), time(17, 30), 'Ở lại 1.5h không có đơn OT (không trả lương OT)', None),
    21: (time(13), time(21), 'Phân ca sáng nhưng làm giờ ca chiều: trễ 300p → HR rà soát', None),
}
CUONG_CASES = {  # NV #3, ca chiều
    1: (time(12), time(20), 'Vào sớm 1h, về sớm 60p (vẫn đủ 8h)', None),
    3: (time(14), time(22), 'Trễ 60p, làm bù đủ 8h', None),
    4: (time(15), time(23), 'Trễ 120p, làm bù đủ 8h', None),
    6: (time(13, 8), time(21), 'Trễ 8p trong ân hạn', None),
    7: (time(13, 12), time(21), 'Trễ 12p trong ân hạn', None),
    8: (time(13, 20), time(21), 'Trễ 20p (lần trễ thứ 3 → chuyên cần 50%)', None),
    15: (time(13), time(23), 'OT 2h có đơn (22:00–23:00 tính OT đêm x2.0)',
         (time(21), time(23), 'Tăng ca khóa sổ cửa hàng cuối ngày')),
    18: (time(13), time(13, 5), 'Phiên 5 phút → 0 công, cần HR rà soát', None),
    21: (time(8), time(16), 'Phân ca chiều nhưng làm giờ ca sáng: về sớm 300p → HR rà soát', None),
}
EM_CASES = {  # NV #5, ca sáng — benchmark 27 công
    20: (time(8), time(17, 30), 'OT 1.5h có đơn', (time(16), time(17, 30), 'Tăng ca chốt doanh thu quầy thu ngân')),
}
EM_FULL_SHIFT_DAY = 25  # Thứ 7: Ca Full 08:00–21:00 → 8h công + 4h OT tự động


def build_july_dataset(shifts: dict[str, Shift]) -> Dataset:
    data = Dataset()
    plans = [(4, 'CA_SANG', DUNG_CASES), (3, 'CA_CHIEU', CUONG_CASES), (5, 'CA_SANG', EM_CASES)]
    for employee_id, shift_code, cases in plans:
        for day in july_work_days():
            shift = shifts[shift_code]
            if employee_id == 5 and day.day == EM_FULL_SHIFT_DAY:
                shift = shifts['CA_FULL']
            data.schedules.append({
                'employee_id': employee_id, 'store_id': STORE_ID, 'shift_id': shift.shift_id, 'work_date': day,
                'notes': f'{shift.name} {day.strftime("%d/%m")}',
                'starts_at': _at(day, shift.start), 'ends_at': _at(day, shift.end),
            })
            cin, cout, note, ot = cases.get(day.day, (shift.start, shift.end, 'Đúng ca', None))
            if shift.code == 'CA_FULL':
                note = 'Ca Full cuối tuần: 13h − 1h nghỉ = 8h công + 4h OT tự động'
            data.sessions.append(make_session(employee_id, shift, day, cin, cout, note, ot))
    return data


def default_shifts() -> dict[str, Shift]:
    """Danh mục ca chuẩn với shift_id giả định — dùng cho test không cần DB."""
    names = {'CA_SANG': 'Ca sáng bán lẻ', 'CA_CHIEU': 'Ca chiều bán lẻ', 'CA_FULL': 'Ca Full cuối tuần'}
    return {code: Shift(i, code, names[code], v['start'], v['end'], v['work_hours'], v['break_minutes'],
                        v['planned_ot'])
            for i, (code, v) in enumerate(STANDARD_SHIFTS.items(), start=1)}


# ----------------------------------------------------------------------------- Ghi DB
async def _load_shifts(conn) -> dict[str, Shift]:
    from sqlalchemy import text
    rows = (await conn.execute(text("""
        SELECT shift_id, shift_code, shift_name, start_time, end_time, work_hours,
               break_minutes, planned_overtime_hours
        FROM work_shifts WHERE shift_code = ANY(:codes)
    """), {'codes': list(STANDARD_SHIFTS)})).mappings().all()
    shifts = {r['shift_code']: Shift(r['shift_id'], r['shift_code'], r['shift_name'], r['start_time'],
                                     r['end_time'], float(r['work_hours']), int(r['break_minutes'] or 0),
                                     float(r['planned_overtime_hours'] or 0)) for r in rows}
    problems = []
    for code, expected in STANDARD_SHIFTS.items():
        s = shifts.get(code)
        actual = s and dict(start=s.start, end=s.end, work_hours=s.work_hours,
                            break_minutes=s.break_minutes, planned_ot=s.planned_ot)
        if actual != expected:
            problems.append(f'{code}: DB={actual} ≠ chuẩn={expected}')
    if problems:
        raise SystemExit('Danh mục ca chưa chuẩn hóa — hãy áp migration 20261106 trước:\n  ' + '\n  '.join(problems))
    return shifts


async def _clean_july(conn) -> None:
    from sqlalchemy import text
    july = "work_date BETWEEN '2026-07-01' AND '2026-07-31'"
    try:
        await conn.execute(text("ALTER TABLE overtime_reconciliation_events DISABLE TRIGGER trg_ot_reconciliation_events_immutable"))
        await conn.execute(text(f"""DELETE FROM overtime_reconciliation_events WHERE request_id IN (
            SELECT request_id FROM overtime_requests WHERE {july})"""))
    finally:
        await conn.execute(text("ALTER TABLE overtime_reconciliation_events ENABLE TRIGGER trg_ot_reconciliation_events_immutable"))
    await conn.execute(text(f"""DELETE FROM attendance_overtime_approvals WHERE attendance_id IN (
        SELECT attendance_id FROM attendances WHERE {july})"""))
    await conn.execute(text(f"""DELETE FROM overtime_reconciliations WHERE request_id IN (
        SELECT request_id FROM overtime_requests WHERE {july})"""))
    await conn.execute(text(f"DELETE FROM overtime_requests WHERE {july}"))
    await conn.execute(text(f"DELETE FROM attendances WHERE {july}"))
    await conn.execute(text(f"DELETE FROM work_schedules WHERE {july}"))
    await conn.execute(text("DELETE FROM disciplinary_records WHERE salary_period = :p AND is_auto"), {'p': PERIOD})


async def seed_july() -> None:
    from sqlalchemy import text
    from app.core.database import engine

    async with engine.begin() as conn:
        shifts = await _load_shifts(conn)
        print('=== XÓA DỮ LIỆU THÁNG 07/2026 CŨ ===')
        await _clean_july(conn)
        data = build_july_dataset(shifts)
        now_vn = datetime.now(VN_TZ)

        for s in data.schedules:
            await conn.execute(text("""
                INSERT INTO work_schedules (employee_id, store_id, shift_id, work_date, notes, starts_at, ends_at)
                VALUES (:employee_id, :store_id, :shift_id, :work_date, :notes, :starts_at, :ends_at)
            """), s)

        ot_count = 0
        for s in data.sessions:
            attendance_id = (await conn.execute(text("""
                INSERT INTO attendances (employee_id, store_id, shift_id, work_date, check_in_time, check_out_time,
                    late_minutes, early_minutes, overtime_hours, actual_work_hours, status, notes, attendance_context)
                VALUES (:employee_id, :store_id, :shift_id, :work_date, :check_in, :check_out, :late, :early,
                    :overtime, :actual, :status, :notes, CAST(:context AS jsonb))
                RETURNING attendance_id
            """), {'employee_id': s.employee_id, 'store_id': STORE_ID, 'shift_id': s.shift.shift_id,
                   'work_date': s.work_date, 'check_in': s.check_in, 'check_out': s.check_out,
                   'late': s.late_minutes, 'early': s.early_minutes, 'overtime': s.overtime_hours,
                   'actual': s.actual_work_hours, 'status': s.status, 'notes': s.note,
                   'context': s.context()})).scalar_one()
            if not s.ot:
                continue
            ot_start, ot_end, reason = s.ot
            request_id = (await conn.execute(text("""
                INSERT INTO overtime_requests (employee_id, store_id, work_date, starts_at, ends_at, reason, created_by,
                    status, reviewed_by, reviewed_at, created_at, updated_at, request_type)
                VALUES (:employee_id, :store_id, :work_date, :starts_at, :ends_at, :reason, :employee_id,
                    'APPROVED', :reviewer, :now, :now, :now, 'STANDARD')
                RETURNING request_id
            """), {'employee_id': s.employee_id, 'store_id': STORE_ID, 'work_date': s.work_date,
                   'starts_at': ot_start, 'ends_at': ot_end, 'reason': reason,
                   'reviewer': REVIEWER_USER_ID, 'now': now_vn})).scalar_one()
            micros = int((ot_end - ot_start).total_seconds() * 1_000_000)
            # Trigger fn_sync_ot_reconciliation_to_approvals ghi attendance_overtime_approvals (kèm giờ đêm).
            await conn.execute(text("""
                INSERT INTO overtime_reconciliations (request_id, employee_id, store_id, status, version,
                    source_signature, proposed_microseconds, verified_microseconds, eligible_intervals,
                    attendance_ids, review_issues, reviewed_by, reviewed_at, decision_reason, calculated_at,
                    created_at, updated_at)
                VALUES (:request_id, :employee_id, :store_id, 'VERIFIED', 1,
                    public.ot_reconciliation_source_signature(:request_id), :micros, :micros,
                    CAST(:intervals AS jsonb), CAST(:attendance_ids AS jsonb), '[]'::jsonb, :reviewer, :now,
                    'Đối soát thành công', :now, :now, :now)
            """), {'request_id': request_id, 'employee_id': s.employee_id, 'store_id': STORE_ID,
                   'micros': micros,
                   'intervals': json.dumps([{'starts_at': ot_start.isoformat(), 'ends_at': ot_end.isoformat()}]),
                   'attendance_ids': json.dumps([attendance_id]), 'reviewer': REVIEWER_USER_ID, 'now': now_vn})
            ot_count += 1

        reports = (await conn.execute(text('SELECT public.fn_evaluate_late_discipline(:p)'), {'p': PERIOD})).scalar()
        print(f'Lịch: {len(data.schedules)} · Chấm công: {len(data.sessions)} · Đơn OT đã đối soát: {ot_count} '
              f'· Biên bản đi trễ kỳ {PERIOD}: {reports}')

    async with engine.connect() as conn:
        rows = (await conn.execute(text("""
            SELECT a.employee_id, SUM(fn_work_day_credit(a.h)) AS credits,
                   COUNT(*) FILTER (WHERE a.is_late) AS late_days
            FROM (SELECT employee_id, work_date, SUM(actual_work_hours) AS h,
                         BOOL_OR(fn_attendance_counts_as_late(late_minutes, check_in_time, check_out_time,
                                                              attendance_context, 15)) AS is_late
                  FROM attendances WHERE TO_CHAR(work_date, 'YYYY-MM') = :p GROUP BY 1, 2) a
            GROUP BY a.employee_id ORDER BY a.employee_id
        """), {'p': PERIOD})).all()
        for emp, credits, late in rows:
            print(f'  NV #{emp}: {float(credits):g}/26 công · {late} ngày trễ hợp lệ')
    print('=== ĐÃ SEED THÁNG 07/2026 THEO CA CHUẨN ===')


if __name__ == '__main__':
    asyncio.run(seed_july())
