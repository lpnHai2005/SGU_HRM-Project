"""Nghiệm thu tháng 07/2026 trên bộ dữ liệu seed chuẩn hóa (scripts/seed_july_2026.py).

Phần 1 (luôn chạy): kiểm tra bộ dữ liệu theo luật thuần trong app.core.payroll_rules.
Phần 2 (cần HRM_TEST_PG_DSN trỏ DB rỗng tên *_test): nạp đúng bộ dữ liệu vào Postgres,
chạy sp_generate_monthly_payroll('2026-07') và đối chiếu với bảng công.
"""
from collections import defaultdict
from datetime import timedelta

import pytest

from app.core.payroll_rules import (
    attendance_allowance_tier, check_weekly_schedule, ensure_monthly_ot_cap, monthly_pay,
    needs_late_warning_report, night_overlap_hours, week_bounds, work_day_credit,
)
from scripts.seed_july_2026 import PERIOD, build_july_dataset, default_shifts, july_work_days

SALARY = 6_000_000
LUNCH = 1_000_000
ATTENDANCE = 500_000
RATE = SALARY / 26 / 8

# Kỳ vọng nghiệm thu theo quy chế (lương HĐ minh họa 6.000.000đ).
EXPECTED = {
    5: dict(credits=27.0, late_days=0, tier='FULL', report=False,
            base=6_230_769, lunch=1_000_000, attendance=500_000, ot_hours=5.5, night=0.0),
    4: dict(credits=26.5, late_days=5, tier='LATE_REPORT', report=True,
            base=6_115_385, lunch=1_000_000, attendance=0, ot_hours=5.0, night=0.0),
    3: dict(credits=26.0, late_days=3, tier='HALF', report=False,
            base=6_000_000, lunch=1_000_000, attendance=250_000, ot_hours=2.0, night=1.0),
}


@pytest.fixture(scope='module')
def data():
    return build_july_dataset(default_shifts())


def _by_employee(data):
    out = defaultdict(list)
    for s in data.sessions:
        out[s.employee_id].append(s)
    return out


def _ot_hours(s):
    """Giờ OT trả lương của phiên: max(giờ đơn OT đã duyệt, OT tự động của ca)."""
    approved = (s.ot[1] - s.ot[0]).total_seconds() / 3600 if s.ot else 0.0
    planned = min(s.shift.planned_ot, max(0.0, s.actual_work_hours - s.shift.work_hours))
    return max(approved, planned)


# =============================================================== Phần 1: bộ dữ liệu
class TestJulyDataset:
    def test_calendar_has_27_workdays_but_standard_is_26(self, data):
        assert len(july_work_days()) == 27
        assert all(len(rows) == 27 for rows in _by_employee(data).values())
        assert len(data.schedules) == 81

    def test_shift_snapshots_are_standard(self, data):
        for s in data.sessions:
            assert s.shift.work_hours == 8.0
            if s.shift.code == 'CA_FULL':
                assert (s.shift.break_minutes, s.shift.planned_ot) == (60, 4.0)
            else:
                assert (s.shift.break_minutes, s.shift.planned_ot) == (0, 0.0)

    def test_on_time_standard_shift_is_8h_one_credit(self, data):
        normal = [s for s in data.sessions
                  if s.status == 'NORMAL' and s.late_minutes == 0 and s.shift.code != 'CA_FULL']
        assert normal and all(s.actual_work_hours == 8.0 for s in normal)
        assert all(work_day_credit(s.actual_work_hours) == 1.0 for s in normal)

    def test_full_weekend_shift_13h_is_8h_plus_4h_ot(self, data):
        full = [s for s in data.sessions if s.shift.code == 'CA_FULL']
        assert len(full) == 1 and full[0].work_date.weekday() == 5
        assert (full[0].actual_work_hours, full[0].overtime_hours) == (12.0, 4.0)
        assert work_day_credit(full[0].actual_work_hours) == 1.0

    def test_every_week_has_a_day_off_and_no_48h_warning(self, data):
        weeks = defaultdict(dict)
        for s in data.sessions:
            weeks[(s.employee_id, week_bounds(s.work_date)[0])][s.work_date] = (
                s.actual_work_hours - s.overtime_hours)
        for key, days in weeks.items():
            result = check_weekly_schedule(days)
            assert result.errors == (), key
            assert result.warnings == (), key

    @pytest.mark.parametrize('employee_id', sorted(EXPECTED))
    def test_timesheet_and_pay(self, data, employee_id):
        exp = EXPECTED[employee_id]
        rows = _by_employee(data)[employee_id]
        hours_by_day = defaultdict(float)
        for s in rows:
            hours_by_day[s.work_date] += s.actual_work_hours
        credits = sum(work_day_credit(h) for h in hours_by_day.values())
        # Lần trễ hợp lệ như bảng công: > 15 phút và ≤ 240 phút (trễ quá dài chờ HR rà soát).
        late_days = len({s.work_date for s in rows if 15 < s.late_minutes <= 240})
        assert credits == exp['credits']
        assert late_days == exp['late_days']
        assert attendance_allowance_tier(late_days, credits) == exp['tier']
        assert needs_late_warning_report(late_days) is exp['report']
        pay = monthly_pay(SALARY, LUNCH, ATTENDANCE, credits, late_days)
        assert (pay.base_pay, pay.lunch_allowance, pay.attendance_allowance) == (
            exp['base'], exp['lunch'], exp['attendance'])
        ot = sum(_ot_hours(s) for s in rows)
        assert ot == exp['ot_hours']
        assert ensure_monthly_ot_cap(0, ot) == ot  # dưới trần 40h
        night = sum(night_overlap_hours(*s.ot[:2]) for s in rows if s.ot)
        assert night == exp['night']

    def test_edge_sessions(self, data):
        by_key = {s.key: s for s in data.sessions}
        half = by_key['4-2026-07-09']
        assert half.actual_work_hours == 7.42 and work_day_credit(half.actual_work_hours) == 0.5
        assert by_key['4-2026-07-07'].status == 'NORMAL'          # trễ 10' trong ân hạn
        assert by_key['4-2026-07-14'].overtime_hours == 1.5 and by_key['4-2026-07-14'].ot is None
        assert work_day_credit(by_key['3-2026-07-18'].actual_work_hours) == 0.0
        assert by_key['3-2026-07-21'].early_minutes == 300
        assert by_key['4-2026-07-21'].late_minutes == 300


# =============================================================== Phần 2: SQL thật
pg_mod = pytest.importorskip('tests.test_payroll_attendance_refactor')


@pytest.fixture(scope='module')
def july_pg(data):
    if not pg_mod.DSN:
        pytest.skip('Cần HRM_TEST_PG_DSN để chạy test SQL')
    psycopg2 = pytest.importorskip('psycopg2')
    conn = psycopg2.connect(pg_mod.DSN)
    if not conn.get_dsn_parameters().get('dbname', '').endswith('_test'):
        pytest.skip('HRM_TEST_PG_DSN phải trỏ tới database tên *_test')
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(pg_mod.MINIMAL_SCHEMA)
    cur.execute((pg_mod.MIGRATIONS / '20261104_director_exception_contract_hours_and_payslip_breakdown.sql').read_text('utf-8'))
    cur.execute((pg_mod.MIGRATIONS / '20261106_prorated_allowances_shift_ot_discipline.sql').read_text('utf-8'))
    cur.execute("INSERT INTO users DEFAULT VALUES; INSERT INTO users DEFAULT VALUES;"
                "INSERT INTO stores(store_name) SELECT 'CH ' || g FROM generate_series(1, 5) g;"
                "INSERT INTO positions(position_code, position_name) VALUES ('SALES', 'Nhân viên bán hàng')")
    for emp in sorted(EXPECTED):
        cur.execute("""INSERT INTO employees(employee_id, employee_code, full_name, store_id, position_id, join_date)
                       VALUES (%s, %s, %s, 5, 1, '2026-06-01')""", (emp, f'TZ-00{emp}', f'NV {emp}'))
        cur.execute("""INSERT INTO contracts(employee_id, status, basic_salary, insurance_salary, start_date,
                       working_hours_per_week) VALUES (%s, 'ACTIVE', %s, %s, '2026-06-01', 48)""",
                    (emp, SALARY, SALARY))
    cur.execute('SELECT shift_code, shift_id FROM work_shifts')
    ids = dict(cur.fetchall())
    for s in data.sessions:
        cur.execute("""INSERT INTO attendances(employee_id, store_id, shift_id, work_date, check_in_time,
                       check_out_time, late_minutes, early_minutes, actual_work_hours, overtime_hours, status)
                       VALUES (%s, 5, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING attendance_id""",
                    (s.employee_id, ids[s.shift.code], s.work_date, s.check_in, s.check_out, s.late_minutes,
                     s.early_minutes, s.actual_work_hours, s.overtime_hours, s.status))
        att_id = cur.fetchone()[0]
        if s.ot:
            pg_mod._verified_ot(cur, s.employee_id, s.work_date, s.ot[0].timetz().replace(tzinfo=None),
                                s.ot[1].timetz().replace(tzinfo=None), att_id)
    cur.execute('CALL sp_generate_monthly_payroll(%s, 1)', (PERIOD,))
    yield cur
    conn.close()


@pytest.mark.skipif(not pg_mod.DSN, reason='Cần HRM_TEST_PG_DSN để chạy test SQL')
class TestJulyPayrollProcedure:
    def test_standard_days_unified_26(self, july_pg):
        july_pg.execute("""SELECT applied_standard_days, auto_standard_days, calendar_working_days
                           FROM v_payroll_period_working_days WHERE salary_period = %s""", (PERIOD,))
        assert tuple(float(x) for x in july_pg.fetchone()) == (26.0, 26.0, 27.0)
        july_pg.execute('SELECT fn_payroll_standard_days(%s)', (PERIOD,))
        assert float(july_pg.fetchone()[0]) == 26.0
        july_pg.execute('SELECT DISTINCT standard_working_days FROM payrolls WHERE salary_period = %s', (PERIOD,))
        assert [float(r[0]) for r in july_pg.fetchall()] == [26.0]

    @pytest.mark.parametrize('employee_id', sorted(EXPECTED))
    def test_payslip_matches_timesheet(self, july_pg, employee_id):
        exp = EXPECTED[employee_id]
        july_pg.execute("""SELECT actual_working_days FROM payrolls WHERE employee_id = %s AND salary_period = %s""",
                        (employee_id, PERIOD))
        assert float(july_pg.fetchone()[0]) == exp['credits']
        july_pg.execute("""SELECT d.item_code, d.amount FROM payroll_details d JOIN payrolls p USING (payroll_id)
                           WHERE p.employee_id = %s AND p.salary_period = %s""", (employee_id, PERIOD))
        items = {code: float(amount) for code, amount in july_pg.fetchall()}
        base = items['CONTRACT_SALARY'] - items.get('BASE_SALARY_DEDUCTION', 0) + items.get('EXTRA_WORKDAY_SALARY', 0)
        assert base == exp['base']
        assert items['MEAL_ALLOWANCE'] == exp['lunch']
        assert items.get('ATTENDANCE_ALLOWANCE', 0) == exp['attendance']
        assert 'PENALTY' not in items
        expected_ot = RATE * ((exp['ot_hours'] - exp['night']) * 1.5 + exp['night'] * 2.0)
        assert abs(items['OVERTIME'] - expected_ot) <= 2

    def test_late_report_only_for_dung(self, july_pg):
        july_pg.execute("""SELECT employee_id, late_days FROM disciplinary_records
                           WHERE salary_period = %s AND status <> 'VOIDED'""", (PERIOD,))
        assert dict(july_pg.fetchall()) == {4: 5}  # ngày 21 trễ 300 phút chờ HR rà soát, chưa tính

    def test_full_shift_planned_ot_without_request(self, july_pg, data):
        full = next(s for s in data.sessions if s.shift.code == 'CA_FULL')
        july_pg.execute("""SELECT fn_attendance_planned_ot_hours(attendance_id) FROM attendances
                           WHERE employee_id = %s AND work_date = %s""", (full.employee_id, full.work_date))
        assert float(july_pg.fetchone()[0]) == 4.0
        assert full.work_date - timedelta(days=full.work_date.weekday()) == week_bounds(full.work_date)[0]
