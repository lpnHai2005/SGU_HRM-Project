"""Refactor lương / công / OT / kỷ luật (migration 20261106).

- Phần 1: quy tắc thuần Python (app.core.payroll_rules) — luôn chạy.
- Phần 2: chạy migration + sp_generate_monthly_payroll trên PostgreSQL thật.
  Cần biến môi trường HRM_TEST_PG_DSN trỏ tới một database RỖNG dùng để test
  (tên database phải kết thúc bằng `_test`), ví dụ:
  HRM_TEST_PG_DSN=postgresql://postgres@localhost:55432/hrm_refactor_test
"""
import json
import os
from datetime import date, datetime, time, timedelta
from pathlib import Path

import pytest

from app.core.attendance import VIETNAM_TZ, session_metrics
from app.core.payroll_rules import (
    OvertimeCapExceeded, attendance_allowance, check_weekly_schedule, ensure_monthly_ot_cap,
    is_blacklist_warning, monthly_pay, night_overlap_hours, ot_pay_multiplier_hours,
    previous_periods, prorated_base_pay, prorated_lunch_allowance, split_shift_hours, work_day_credit,
)

MIGRATIONS = Path(__file__).resolve().parents[1] / 'migrations'


# =============================================================== Phần 1: quy tắc
class TestProratedPay:
    def test_24_of_26_days(self):
        pay = monthly_pay(6_000_000, 1_000_000, 500_000, actual_work_days=24, late_over_grace_days=0)
        assert pay.base_pay == 5_538_462
        assert pay.lunch_allowance == 923_077
        assert pay.attendance_allowance == 500_000

    def test_27_of_26_days_exceeds_contract_base(self):
        pay = monthly_pay(6_000_000, 1_000_000, 500_000, actual_work_days=27, late_over_grace_days=0)
        assert pay.base_pay == 6_230_769 > 6_000_000
        assert pay.lunch_allowance == 1_000_000  # chặn trần ở 26 công
        assert prorated_lunch_allowance(1_000_000, 27, cap=False) == 1_038_462

    def test_paid_leave_counts_for_base_not_lunch(self):
        pay = monthly_pay(6_000_000, 1_000_000, 500_000, actual_work_days=24, late_over_grace_days=0,
                          paid_leave_days=2)
        assert pay.base_pay == 6_000_000
        assert pay.lunch_allowance == 923_077

    def test_full_month_equals_agreement(self):
        assert monthly_pay(6_000_000, 1_000_000, 500_000, 26, 0).total == 7_500_000
        assert prorated_base_pay(6_000_000, 0) == 0


class TestAttendanceAllowance:
    @pytest.mark.parametrize('late,days,expected', [
        (0, 26, 500_000), (2, 26, 500_000), (3, 26, 250_000), (4, 26, 250_000),
        (5, 26, 0), (9, 26, 0), (0, 19.5, 0), (0, 20, 500_000), (3, 20, 250_000),
    ])
    def test_tiers(self, late, days, expected):
        assert attendance_allowance(500_000, late, days) == expected


class TestWorkDayCredit:
    @pytest.mark.parametrize('hours,credit', [
        (0, 0.0), (3.99, 0.0), (4.0, 0.5), (7.49, 0.5), (7.5, 1.0), (8, 1.0), (12, 1.0), (None, 0.0),
    ])
    def test_buckets(self, hours, credit):
        assert work_day_credit(hours) == credit

    def test_weekend_full_shift_13h_splits_8_plus_4(self):
        assert split_shift_hours(13, break_minutes=60) == (8.0, 4.0)
        assert split_shift_hours(9, break_minutes=60) == (8.0, 0.0)   # ca hành chính
        assert split_shift_hours(8, break_minutes=0) == (8.0, 0.0)    # ca sáng/chiều

    def test_checkout_deducts_break_for_full_shift(self):
        day = date(2026, 9, 5)
        att = dict(check_in_time=datetime.combine(day, time(8), VIETNAM_TZ), work_date=day,
                   start_time=time(8), end_time=time(21), work_hours=8.0, break_minutes=60,
                   late_minutes=0, attendance_context=None)
        metrics = session_metrics(att, datetime.combine(day, time(21), VIETNAM_TZ))
        assert metrics['actual_work_hours'] == 12.0
        assert metrics['overtime_hours'] == 4.0

    def test_short_session_keeps_break(self):
        day = date(2026, 9, 5)
        att = dict(check_in_time=datetime.combine(day, time(8), VIETNAM_TZ), work_date=day,
                   start_time=time(8), end_time=time(17), work_hours=8.0, break_minutes=60,
                   late_minutes=0, attendance_context=None)
        metrics = session_metrics(att, datetime.combine(day, time(12), VIETNAM_TZ))
        assert metrics['actual_work_hours'] == 4.0

    def test_hr_verified_checkout_deducts_snapshot_break(self):
        from app.api.v1.endpoints.operations import verified_session_hours
        day = date(2026, 9, 5)
        c_in = datetime.combine(day, time(8), VIETNAM_TZ)
        c_out = datetime.combine(day, time(17), VIETNAM_TZ)
        # Giờ nghỉ chụp lúc check-in được ưu tiên hơn cấu hình ca hiện tại.
        assert verified_session_hours(c_in, c_out, {'actual': {'break_minutes': 60}}, 0) == 8.0
        assert verified_session_hours(c_in, c_out, {}, 60) == 8.0
        assert verified_session_hours(c_in, c_out, None, None) == 9.0
        # Phiên ngắn không bị trừ nghỉ.
        assert verified_session_hours(c_in, datetime.combine(day, time(12), VIETNAM_TZ), {}, 60) == 4.0


class TestOvertime:
    def test_night_window(self):
        d = date(2026, 9, 7)
        at = lambda dd, hh: datetime.combine(dd, time(hh), VIETNAM_TZ)  # noqa: E731
        assert night_overlap_hours(at(d, 21), at(d, 23)) == 1.0
        assert night_overlap_hours(at(d, 22), at(d + timedelta(days=1), 8)) == 10.0
        assert night_overlap_hours(at(d, 6), at(d, 9)) == 2.0
        assert night_overlap_hours(at(d, 17), at(d, 21)) == 0.0

    def test_night_multiplier_2x(self):
        d = date(2026, 9, 7)
        start, end = datetime.combine(d, time(21), VIETNAM_TZ), datetime.combine(d, time(23), VIETNAM_TZ)
        assert ot_pay_multiplier_hours(start, end) == pytest.approx(1 * 1.5 + 1 * 2.0)
        assert ot_pay_multiplier_hours(start, end, is_holiday=True) == pytest.approx(6.0)

    def test_40h_cap(self):
        assert ensure_monthly_ot_cap(36, 4) == 40
        with pytest.raises(OvertimeCapExceeded):
            ensure_monthly_ot_cap(38, 3)
        assert ensure_monthly_ot_cap(45, 0) == 45  # không chặn khi không cộng thêm


class TestScheduleAndDiscipline:
    def test_week_needs_one_day_off(self):
        monday = date(2026, 9, 7)
        six = {monday + timedelta(days=i): 8.0 for i in range(6)}
        assert check_weekly_schedule(six).errors == ()
        seven = {monday + timedelta(days=i): 8.0 for i in range(7)}
        assert check_weekly_schedule(seven).errors

    def test_week_over_48h_is_blocked(self):
        monday = date(2026, 9, 7)
        days = {monday + timedelta(days=i): 8.0 for i in range(6)}
        assert check_weekly_schedule(days).errors == ()  # đúng 48h: hợp lệ
        days[monday] = 16.0
        result = check_weekly_schedule(days)
        assert result.errors and result.errors[0].startswith('WEEKLY_HOURS_OVER_48')

    def test_blacklist_three_consecutive_months(self):
        assert previous_periods('2026-01', 3) == ['2026-01', '2025-12', '2025-11']
        assert is_blacklist_warning('2026-01', {'2026-01', '2025-12', '2025-11'})
        assert not is_blacklist_warning('2026-01', {'2026-01', '2025-11', '2025-10'})


# =============================================================== Phần 2: SQL
DSN = os.getenv('HRM_TEST_PG_DSN')
pytestmark_sql = pytest.mark.skipif(not DSN, reason='Cần HRM_TEST_PG_DSN để chạy test SQL')

MINIMAL_SCHEMA = """
DROP SCHEMA public CASCADE; CREATE SCHEMA public;
CREATE TABLE users(user_id SERIAL PRIMARY KEY);
CREATE TABLE stores(store_id SERIAL PRIMARY KEY, store_name TEXT, is_active BOOLEAN DEFAULT TRUE);
CREATE TABLE positions(position_id SERIAL PRIMARY KEY, position_code TEXT, position_name TEXT,
  position_allowance NUMERIC DEFAULT 0, position_coefficient NUMERIC DEFAULT 1);
CREATE TABLE employees(employee_id SERIAL PRIMARY KEY, employee_code TEXT, full_name TEXT, store_id INT,
  position_id INT, join_date DATE, employment_status VARCHAR(20) DEFAULT 'ACTIVE');
CREATE TABLE contracts(contract_id SERIAL PRIMARY KEY, employee_id INT, status TEXT, basic_salary NUMERIC,
  insurance_salary NUMERIC, start_date DATE, working_hours_per_week NUMERIC);
CREATE TABLE work_shifts(shift_id SERIAL PRIMARY KEY, shift_code TEXT UNIQUE, shift_name TEXT,
  start_time TIME, end_time TIME, work_hours NUMERIC(4,2), is_active BOOLEAN DEFAULT TRUE);
INSERT INTO work_shifts(shift_code, shift_name, start_time, end_time, work_hours) VALUES
  ('CA_SANG','Ca sáng','08:00','16:00',8),('CA_CHIEU','Ca chiều','13:00','21:00',8),
  ('CA_FULL','Ca full','08:00','21:00',12);
CREATE TABLE work_schedules(schedule_id SERIAL PRIMARY KEY, employee_id INT, store_id INT, shift_id INT,
  work_date DATE, cancelled_at TIMESTAMPTZ);
CREATE TABLE attendances(attendance_id BIGSERIAL PRIMARY KEY, employee_id INT, store_id INT, shift_id INT,
  work_date DATE, check_in_time TIMESTAMPTZ, check_out_time TIMESTAMPTZ, late_minutes INT DEFAULT 0,
  early_minutes INT DEFAULT 0, actual_work_hours NUMERIC(5,2), overtime_hours NUMERIC(5,2) DEFAULT 0,
  status VARCHAR(30) DEFAULT 'NORMAL', attendance_context JSONB, updated_at TIMESTAMPTZ);
CREATE TABLE attendance_overtime_approvals(attendance_id BIGINT PRIMARY KEY, approved_hours NUMERIC(5,2),
  decision VARCHAR(20), reviewer_user_id INT, reason TEXT, updated_at TIMESTAMPTZ);
CREATE TABLE payroll_policy_settings(setting_id SERIAL PRIMARY KEY, setting_key VARCHAR(50) UNIQUE NOT NULL,
  setting_name VARCHAR(150) NOT NULL, setting_group VARCHAR(50) NOT NULL, numeric_value NUMERIC(15,2) NOT NULL,
  unit VARCHAR(20), description TEXT, is_active BOOLEAN DEFAULT TRUE);
INSERT INTO payroll_policy_settings(setting_key, setting_name, setting_group, numeric_value) VALUES
  ('LATE_TOLERANCE_MINUTES','x','PENALTY',15),('LATE_PENALTY_AMOUNT','x','PENALTY',50000),
  ('MEAL_TRANSPORT_ALLOWANCE','x','ALLOWANCE',1000000),('BHXH_EMPLOYEE_RATE','x','INS',0),
  ('BHYT_EMPLOYEE_RATE','x','INS',0),('BHTN_EMPLOYEE_RATE','x','INS',0);
CREATE TABLE payroll_import_overrides(salary_period VARCHAR(7), employee_id INT, unpaid_leave_days NUMERIC,
  paid_leave_days NUMERIC, extra_commission NUMERIC DEFAULT 0, extra_bonus NUMERIC DEFAULT 0,
  extra_allowance NUMERIC DEFAULT 0, extra_penalty NUMERIC DEFAULT 0, note TEXT);
CREATE TABLE leave_types(leave_type_id SERIAL PRIMARY KEY, is_paid BOOLEAN);
CREATE TABLE leave_requests(request_id SERIAL PRIMARY KEY, employee_id INT, leave_type_id INT,
  start_date DATE, end_date DATE, status TEXT);
CREATE TABLE payrolls(payroll_id SERIAL PRIMARY KEY, employee_id INT, store_id INT, salary_period VARCHAR(7),
  standard_working_days NUMERIC, daily_standard_hours NUMERIC(4,2), actual_working_days NUMERIC,
  paid_leave_days NUMERIC, unpaid_leave_days NUMERIC, absent_days NUMERIC, unworked_hours NUMERIC,
  contract_salary NUMERIC, total_earnings NUMERIC, total_allowances NUMERIC, total_bonuses NUMERIC,
  total_insurance NUMERIC, total_deductions NUMERIC, gross_income NUMERIC, net_salary NUMERIC,
  payment_status TEXT, created_by INT, updated_at TIMESTAMPTZ);
CREATE TABLE payroll_details(detail_id SERIAL PRIMARY KEY, payroll_id INT, item_code TEXT, item_name TEXT,
  item_type TEXT, calculation_formula TEXT, amount NUMERIC);
CREATE TABLE projects(project_id SERIAL PRIMARY KEY, status TEXT);
CREATE TABLE project_members(employee_id INT, project_id INT, project_allowance NUMERIC, project_role TEXT,
  is_active BOOLEAN, joined_date DATE, left_date DATE);
CREATE TABLE project_role_allowances(project_id INT, role_code TEXT, allowance_amount NUMERIC);
CREATE TABLE payroll_period_bonuses(salary_period TEXT, is_active BOOLEAN, bonus_code TEXT, bonus_name TEXT,
  calculation_type TEXT, base_amount NUMERIC);
CREATE TABLE commissions(employee_id INT, salary_period TEXT, kpi_bonus_amount NUMERIC, commission_amount NUMERIC);
CREATE TABLE public_holidays(holiday_date DATE PRIMARY KEY);
CREATE TABLE overtime_reconciliations(request_id BIGINT PRIMARY KEY, status TEXT, verified_microseconds BIGINT,
  eligible_intervals JSONB DEFAULT '[]', attendance_ids JSONB DEFAULT '[]', reviewed_by INT, decision_reason TEXT);
CREATE TABLE overtime_requests(request_id BIGSERIAL PRIMARY KEY, employee_id INT, store_id INT, work_date DATE,
  starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, status TEXT DEFAULT 'APPROVED');
-- Bản rút gọn của view thật (thật còn kiểm tra hiệu lực đơn & chữ ký nguồn).
CREATE VIEW v_overtime_verified_current AS
  SELECT r.request_id, o.employee_id, o.store_id, o.work_date, o.starts_at, o.ends_at,
         r.verified_microseconds, r.eligible_intervals, r.attendance_ids
  FROM overtime_reconciliations r JOIN overtime_requests o USING (request_id)
  WHERE r.status = 'VERIFIED' AND o.status = 'APPROVED';
"""

PERIOD = '2026-09'
SEPT_WORKDAYS = [date(2026, 9, d) for d in range(1, 31) if date(2026, 9, d).weekday() != 6]  # 26 ngày


@pytest.fixture(scope='module')
def pg():
    if not DSN:
        pytest.skip('Cần HRM_TEST_PG_DSN để chạy test SQL')
    psycopg2 = pytest.importorskip('psycopg2')
    conn = psycopg2.connect(DSN)
    if not conn.get_dsn_parameters().get('dbname', '').endswith('_test'):
        pytest.skip('HRM_TEST_PG_DSN phải trỏ tới database tên *_test (sẽ bị xóa sạch schema public)')
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(MINIMAL_SCHEMA)
    director = (MIGRATIONS / '20261104_director_exception_contract_hours_and_payslip_breakdown.sql').read_text('utf-8')
    cur.execute(director)
    cur.execute((MIGRATIONS / '20261106_prorated_allowances_shift_ot_discipline.sql').read_text('utf-8'))
    cur.execute((MIGRATIONS / '20261106_prorated_allowances_shift_ot_discipline.sql').read_text('utf-8'))  # idempotent
    cur.execute("""CREATE TRIGGER trg_sync_ot AFTER UPDATE ON overtime_reconciliations
                   FOR EACH ROW EXECUTE FUNCTION fn_sync_ot_reconciliation_to_approvals()""")
    cur.execute("INSERT INTO users DEFAULT VALUES; INSERT INTO stores(store_name) VALUES ('Q1');"
                "INSERT INTO positions(position_code, position_name) VALUES ('SALES','Nhân viên bán hàng'), ('DIRECTOR','GĐ')")
    yield cur
    conn.close()


def _employee(cur, code, *, position=1):
    cur.execute("""INSERT INTO employees(employee_code, full_name, store_id, position_id, join_date)
                   VALUES (%s, %s, 1, %s, '2026-08-01') RETURNING employee_id""", (code, code, position))
    emp = cur.fetchone()[0]
    cur.execute("""INSERT INTO contracts(employee_id, status, basic_salary, insurance_salary, start_date, working_hours_per_week)
                   VALUES (%s, 'ACTIVE', 6000000, 6000000, '2026-08-01', 48)""", (emp,))
    return emp


def _shift(cur, code):
    cur.execute('SELECT shift_id FROM work_shifts WHERE shift_code=%s', (code,))
    return cur.fetchone()[0]


def _attend(cur, emp, day, *, hours=8.0, late=0, shift='CA_SANG', start=time(8)):
    begin = datetime.combine(day, start, VIETNAM_TZ)
    elapsed = hours + (1 if shift == 'CA_FULL' else 0)
    cur.execute("""INSERT INTO attendances(employee_id, store_id, shift_id, work_date, check_in_time, check_out_time,
                   late_minutes, actual_work_hours, status) VALUES (%s,1,%s,%s,%s,%s,%s,%s,%s) RETURNING attendance_id""",
                (emp, _shift(cur, shift), day, begin, begin + timedelta(hours=elapsed), late, hours,
                 'LATE' if late > 15 else 'NORMAL'))
    return cur.fetchone()[0]


def _verified_ot(cur, emp, day, start, end, att):
    """Đơn OT đã duyệt + đối soát VERIFIED (nguồn OT duy nhất được trả lương)."""
    s, e = datetime.combine(day, start, VIETNAM_TZ), datetime.combine(day, end, VIETNAM_TZ)
    cur.execute("""INSERT INTO overtime_requests(employee_id, store_id, work_date, starts_at, ends_at)
                   VALUES (%s, 1, %s, %s, %s) RETURNING request_id""", (emp, day, s, e))
    rid = cur.fetchone()[0]
    cur.execute("""INSERT INTO overtime_reconciliations(request_id, status, verified_microseconds,
                   eligible_intervals, attendance_ids, reviewed_by) VALUES (%s, 'VERIFIED', %s, %s, %s, 1)""",
                (rid, int((e - s).total_seconds() * 1e6),
                 json.dumps([{'starts_at': s.isoformat(), 'ends_at': e.isoformat()}]), json.dumps([att])))
    return rid


def _run_payroll(cur):
    cur.execute('CALL sp_generate_monthly_payroll(%s, 1)', (PERIOD,))


def _details(cur, emp):
    cur.execute("""SELECT d.item_code, d.amount FROM payroll_details d JOIN payrolls p USING(payroll_id)
                   WHERE p.employee_id=%s AND p.salary_period=%s""", (emp, PERIOD))
    return {code: float(amount) for code, amount in cur.fetchall()}


def _payroll(cur, emp):
    cur.execute("""SELECT actual_working_days, total_earnings, total_allowances, net_salary FROM payrolls
                   WHERE employee_id=%s AND salary_period=%s""", (emp, PERIOD))
    return cur.fetchone()


@pytestmark_sql
class TestPayrollProcedure:
    def test_shift_catalog_standardized(self, pg):
        pg.execute("SELECT shift_code, work_hours, break_minutes, planned_overtime_hours FROM work_shifts ORDER BY shift_code")
        rows = {r[0]: tuple(float(x) for x in r[1:]) for r in pg.fetchall()}
        assert rows['CA_FULL'] == (8.0, 60.0, 4.0)
        assert rows['CA_SANG'] == (8.0, 0.0, 0.0)
        assert rows['CA_HANH_CHINH'] == (8.0, 60.0, 0.0)

    def test_scenarios(self, pg):
        e24 = _employee(pg, 'TZ-924')
        for d in SEPT_WORKDAYS[:24]:
            _attend(pg, e24, d)
        e27 = _employee(pg, 'TZ-927')
        for d in SEPT_WORKDAYS:
            _attend(pg, e27, d)
        _attend(pg, e27, date(2026, 9, 6))  # thêm 1 Chủ nhật = 27 công
        e_late3 = _employee(pg, 'TZ-L03')
        for i, d in enumerate(SEPT_WORKDAYS):
            _attend(pg, e_late3, d, late=20 if i < 3 else 10)
        e_late5 = _employee(pg, 'TZ-L05')
        for i, d in enumerate(SEPT_WORKDAYS):
            _attend(pg, e_late5, d, late=16 if i < 5 else 0)
        pg.execute("""INSERT INTO disciplinary_records(employee_id, salary_period, late_days)
                      VALUES (%s,'2026-08',6), (%s,'2026-07',5)""", (e_late5, e_late5))
        e19 = _employee(pg, 'TZ-919')
        for d in SEPT_WORKDAYS[:19]:
            _attend(pg, e19, d)
        e_half = _employee(pg, 'TZ-HALF')
        for d in SEPT_WORKDAYS[:20]:
            _attend(pg, e_half, d)
        _attend(pg, e_half, SEPT_WORKDAYS[20], hours=5)   # 0.5 công
        _attend(pg, e_half, SEPT_WORKDAYS[21], hours=3)   # 0 công
        e_full = _employee(pg, 'TZ-FULL')
        _attend(pg, e_full, date(2026, 9, 5), hours=12, shift='CA_FULL')  # Thứ 7: 8h công + 4h OT x1.5
        e_night = _employee(pg, 'TZ-NIGHT')
        att = _attend(pg, e_night, date(2026, 9, 7), hours=10, shift='CA_CHIEU', start=time(13))  # ra 23:00
        _verified_ot(pg, e_night, date(2026, 9, 7), time(21), time(23), att)
        e_dir = _employee(pg, 'TZ-DIR', position=2)

        _run_payroll(pg)

        d24 = _details(pg, e24)
        assert d24['CONTRACT_SALARY'] - d24['BASE_SALARY_DEDUCTION'] == 5_538_462
        assert d24['MEAL_ALLOWANCE'] == 923_077
        assert d24['ATTENDANCE_ALLOWANCE'] == 500_000
        assert 'PENALTY' not in d24

        d27 = _details(pg, e27)
        assert 'BASE_SALARY_DEDUCTION' not in d27
        assert d27['CONTRACT_SALARY'] + d27['EXTRA_WORKDAY_SALARY'] == 6_230_769
        assert d27['MEAL_ALLOWANCE'] == 1_000_000
        days27, earnings27, _, _ = _payroll(pg, e27)
        assert float(days27) == 27 and float(earnings27) == 6_230_769

        d3 = _details(pg, e_late3)
        assert d3['ATTENDANCE_ALLOWANCE'] == 250_000 and 'PENALTY' not in d3
        assert 'ATTENDANCE_ALLOWANCE' not in _details(pg, e_late5)
        assert 'ATTENDANCE_ALLOWANCE' not in _details(pg, e19)

        assert float(_payroll(pg, e_half)[0]) == 20.5

        rate = 6_000_000 / 26 / 8
        assert _details(pg, e_full)['OVERTIME'] == round(rate * 4 * 1.5)
        assert float(_payroll(pg, e_full)[0]) == 1.0
        assert _details(pg, e_night)['OVERTIME'] == round(rate * (1 * 1.5 + 1 * 2.0))

        ddir = _details(pg, e_dir)
        assert ddir['ATTENDANCE_ALLOWANCE'] == 500_000 and ddir['MEAL_ALLOWANCE'] == 1_000_000

        pg.execute("""SELECT employee_id, late_days FROM disciplinary_records
                      WHERE salary_period=%s AND status <> 'VOIDED'""", (PERIOD,))
        assert dict(pg.fetchall()) == {e_late5: 5}
        pg.execute('SELECT is_blacklisted_warning FROM employees WHERE employee_id=%s', (e_late5,))
        assert pg.fetchone()[0] is True

        # Chạy lại kỳ (DRAFT) không nhân đôi khoản mục.
        _run_payroll(pg)
        assert _details(pg, e24) == d24

    def test_only_verified_ot_and_valid_sessions_are_paid(self, pg):
        rate = 6_000_000 / 26 / 8
        # Giờ ngoài ca thô 3h, không có đơn OT → không trả OT.
        e_raw = _employee(pg, 'TZ-RAWOT')
        pg.execute("""UPDATE attendances SET overtime_hours = 3
                      WHERE attendance_id = %s""", (_attend(pg, e_raw, date(2026, 9, 9), hours=11),))
        # Phiếu duyệt OT kiểu cũ không có đối soát VERIFIED → không trả OT.
        e_legacy = _employee(pg, 'TZ-LEGACY')
        att = _attend(pg, e_legacy, date(2026, 9, 9), hours=10)
        pg.execute("INSERT INTO attendance_overtime_approvals VALUES (%s, 2, 'APPROVED', 1, 'x', now())", (att,))
        # Ca Full có thêm đơn OT 21:00–22:30 đã VERIFIED: 4h tự động + 1.5h đơn (1h thường + 0.5h đêm).
        e_full = _employee(pg, 'TZ-FULLPLUS')
        att = _attend(pg, e_full, date(2026, 9, 12), hours=13.5, shift='CA_FULL')
        _verified_ot(pg, e_full, date(2026, 9, 12), time(21), time(22, 30), att)
        # Phiên HR loại trừ (actual 0) và phiên chờ giải trình → 0 công, không lập trễ.
        e_ex = _employee(pg, 'TZ-EXCL')
        ex = _attend(pg, e_ex, date(2026, 9, 9), late=30)
        hold = _attend(pg, e_ex, date(2026, 9, 10), late=30)
        pg.execute("""UPDATE attendances SET actual_work_hours = 0,
                      attendance_context = '{"hr_review": {"review_decision": "EXCLUDED_INVALID"}}'
                      WHERE attendance_id = %s""", (ex,))
        pg.execute("""UPDATE attendances SET attendance_context = '{"hr_review": {"review_decision": "NEEDS_MORE_INFO"}}'
                      WHERE attendance_id = %s""", (hold,))
        _attend(pg, e_ex, date(2026, 9, 11))

        _run_payroll(pg)

        assert 'OVERTIME' not in _details(pg, e_raw)
        assert 'OVERTIME' not in _details(pg, e_legacy)
        assert _details(pg, e_full)['OVERTIME'] == round(rate * ((4 + 1) * 1.5 + 0.5 * 2.0))
        pg.execute('SELECT source, hours, night_hours FROM fn_payable_ot_rows(%s) WHERE employee_id = %s ORDER BY 1',
                   (PERIOD, e_full))
        assert [(s, float(h), float(n)) for s, h, n in pg.fetchall()] == [('SHIFT_PLANNED', 4.0, 0.0), ('VERIFIED', 1.5, 0.5)]
        assert float(_payroll(pg, e_ex)[0]) == 1.0
        pg.execute("SELECT 1 FROM disciplinary_records WHERE employee_id = %s", (e_ex,))
        assert pg.fetchone() is None

    def test_full_shift_ot_request_overlapping_planned_window_not_double_paid(self, pg):
        e = _employee(pg, 'TZ-OVERLAP')
        att = _attend(pg, e, date(2026, 9, 19), hours=12, shift='CA_FULL')
        _verified_ot(pg, e, date(2026, 9, 19), time(17), time(21), att)  # trùng đúng 4h OT tự động
        pg.execute('SELECT COALESCE(SUM(hours), 0) FROM fn_payable_ot_rows(%s) WHERE employee_id = %s', (PERIOD, e))
        assert float(pg.fetchone()[0]) == 4.0

    def test_monthly_ot_cap_trigger(self, pg):
        emp = _employee(pg, 'TZ-OTCAP')
        ids = [_attend(pg, emp, d, hours=8) for d in SEPT_WORKDAYS[:5]]
        for att in ids[:4]:
            pg.execute("INSERT INTO attendance_overtime_approvals VALUES (%s, 9.5, 'APPROVED', 1, 'x', now())", (att,))
        psycopg2 = pytest.importorskip('psycopg2')
        with pytest.raises(psycopg2.errors.RaiseException, match='OT_MONTHLY_CAP_EXCEEDED'):
            pg.execute("INSERT INTO attendance_overtime_approvals VALUES (%s, 3, 'APPROVED', 1, 'x', now())", (ids[4],))
        pg.execute("INSERT INTO attendance_overtime_approvals VALUES (%s, 2, 'APPROVED', 1, 'x', now())", (ids[4],))

    def test_reconciliation_trigger_sets_night_hours(self, pg):
        emp = _employee(pg, 'TZ-REC')
        att = _attend(pg, emp, date(2026, 9, 8), hours=8, shift='CA_CHIEU', start=time(13))
        pg.execute("""INSERT INTO overtime_reconciliations(request_id, status, attendance_ids, eligible_intervals)
                      VALUES (900, 'PENDING_RECONCILIATION', %s, %s)""",
                   (f'[{att}]', '[{"starts_at": "2026-09-08T21:00:00+07:00", "ends_at": "2026-09-08T23:30:00+07:00"}]'))
        pg.execute("""UPDATE overtime_reconciliations SET status='VERIFIED', verified_microseconds=9000000000,
                      reviewed_by=1 WHERE request_id=900""")
        pg.execute('SELECT approved_hours, night_hours FROM attendance_overtime_approvals WHERE attendance_id=%s', (att,))
        assert tuple(float(x) for x in pg.fetchone()) == (2.5, 1.5)


class TestScheduleSaveGuard:
    """enforce_weekly_rules dùng trong work_schedule.save (stub DB, không cần Postgres)."""

    class _Result:
        def __init__(self, rows):
            self._rows = rows

        def all(self):
            return self._rows

    class _DB:
        def __init__(self, rows):
            self.rows = rows

        async def execute(self, *_args, **_kwargs):
            return TestScheduleSaveGuard._Result(self.rows)

    def _run(self, rows, day):
        import asyncio
        from types import SimpleNamespace
        from app.core.work_schedule import enforce_weekly_rules
        data = SimpleNamespace(employee_id=1, work_date=day)
        shift = {'work_hours': 8.0, 'planned_overtime_hours': 0}
        return asyncio.run(enforce_weekly_rules(self._DB(rows), data, shift, 0))

    def test_seventh_day_is_blocked(self):
        from fastapi import HTTPException
        monday = date(2026, 9, 7)
        rows = [(monday + timedelta(days=i), 8.0) for i in range(6)]
        with pytest.raises(HTTPException) as exc:
            self._run(rows, monday + timedelta(days=6))
        assert exc.value.status_code == 409 and exc.value.detail['code'] == 'WEEKLY_DAY_OFF_REQUIRED'

    def test_over_48h_week_is_blocked_409(self):
        from fastapi import HTTPException
        monday = date(2026, 9, 7)
        rows = [(monday, 12.0)] + [(monday + timedelta(days=i), 8.0) for i in range(1, 5)]  # 44h
        with pytest.raises(HTTPException) as exc:
            self._run(rows, monday + timedelta(days=5))
        assert exc.value.status_code == 409 and exc.value.detail['code'] == 'WEEKLY_HOURS_OVER_48'

    def test_sixth_day_allowed(self):
        monday = date(2026, 9, 7)
        rows = [(monday + timedelta(days=i), 8.0) for i in range(5)]
        assert self._run(rows, monday + timedelta(days=6)) == []


@pytestmark_sql
class TestValidLateRule:
    """fn_attendance_counts_as_late phải khớp operations.is_valid_late_session (bảng công)."""

    @pytest.mark.parametrize('late,minutes,ctx,expected', [
        (20, 480, None, True),
        (15, 480, None, False),                                              # trong ân hạn
        (20, 10, None, False),                                               # phiên ≤ 15 phút
        (300, 480, None, False),                                             # trễ > 240 phút chờ HR
        (300, 480, '{"hr_review": {"review_decision": "CONFIRMED_LATE"}}', True),
        (20, 480, '{"hr_review": {"review_decision": "EXCLUDED_INVALID"}}', False),
        (20, 480, '{"hr_review": {"review_decision": "NEEDS_MORE_INFO"}}', False),
        (20, 480, '{"schedule_status": "SHIFT_MISMATCH"}', False),
    ])
    def test_matches_timesheet(self, pg, late, minutes, ctx, expected):
        pg.execute("""SELECT fn_attendance_counts_as_late(%s, now(), now() + make_interval(mins => %s),
                      %s::jsonb, 15)""", (late, minutes, ctx))
        assert pg.fetchone()[0] is expected
        from app.api.v1.endpoints.operations import is_valid_late_session
        row = {'late_minutes': late, 'check_in_time': 1, 'check_out_time': 2, 'raw_duration_minutes': minutes,
               'attendance_context': ctx, 'schedule_status': (__import__('json').loads(ctx or '{}')).get('schedule_status')}
        assert is_valid_late_session(row, 15) is expected


class TestPaidLeaveTopUp:
    """Sign-off #3: phép có lương chỉ bù cho đủ 26 công; công làm thực tế vẫn được vượt 26 (#2)."""

    def test_payable_days(self):
        from app.core.payroll_rules import payable_work_days
        assert payable_work_days(25, 2) == 26
        assert payable_work_days(24, 2) == 26
        assert payable_work_days(20, 2) == 22
        assert payable_work_days(27, 0) == 27
        assert payable_work_days(27, 1) == 27

    def test_pay(self):
        assert monthly_pay(6_000_000, 1_000_000, 500_000, 25, 0, paid_leave_days=2).base_pay == 6_000_000
        assert monthly_pay(6_000_000, 1_000_000, 500_000, 27, 0, paid_leave_days=1).base_pay == 6_230_769

    @pytestmark_sql
    def test_procedure_caps_paid_leave(self, pg):
        emp = _employee(pg, 'TZ-PAIDLV')
        for d in SEPT_WORKDAYS[:25]:
            _attend(pg, emp, d)
        for d in SEPT_WORKDAYS[25:26] + [date(2026, 9, 6)]:  # 2 ngày phép có lương
            pg.execute("""INSERT INTO attendances(employee_id, store_id, shift_id, work_date, status)
                          VALUES (%s, 1, %s, %s, 'ANNUAL_LEAVE')""", (emp, _shift(pg, 'CA_SANG'), d))
        _run_payroll(pg)
        items = _details(pg, emp)
        assert 'EXTRA_WORKDAY_SALARY' not in items and 'BASE_SALARY_DEDUCTION' not in items
        assert items['CONTRACT_SALARY'] == 6_000_000


class TestRoundingParity:
    """payroll_rules phải làm tròn giống ROUND() NUMERIC của PostgreSQL (nửa xa số 0)."""

    def test_half_away_from_zero(self):
        from app.core.payroll_rules import sql_round
        assert (round(2.5), sql_round(2.5)) == (2, 3)
        assert sql_round(3.5) == 4 and sql_round(-2.5) == -3
        assert sql_round(0.125, 2) == 0.13 and sql_round(1.005, 2) == 1.01

    def test_half_tier_on_odd_amount(self):
        from app.core.payroll_rules import attendance_allowance
        assert attendance_allowance(500_001, 3, 26) == 250_001  # 250000.5 → 250001 như SQL

    @pytestmark_sql
    def test_matches_postgres(self, pg):
        from app.core.payroll_rules import prorated_base_pay, prorated_lunch_allowance
        days = [d / 2 for d in range(0, 63)]
        for salary in (6_000_000, 7_350_001, 12_500_000):
            pg.execute('SELECT d, ROUND(%s::numeric / 26 * d, 0) FROM unnest(%s::numeric[]) d', (salary, days))
            for d, expected in pg.fetchall():
                assert prorated_base_pay(salary, float(d)) == int(expected), (salary, d)
        pg.execute('SELECT d, ROUND(1000000::numeric / 26 * LEAST(d, 26), 0) FROM unnest(%s::numeric[]) d', (days,))
        for d, expected in pg.fetchall():
            assert prorated_lunch_allowance(1_000_000, float(d)) == int(expected), d


class TestVerifiedCheckoutMetrics:
    """HR xác minh giờ ra: tính lại giờ làm, phút về sớm, giờ ngoài ca; chặn giờ ra <= giờ vào."""

    def _session(self, **kw):
        base = dict(check_in_time=datetime(2026, 9, 5, 8, 0, tzinfo=VIETNAM_TZ), work_date=date(2026, 9, 5),
                    scheduled_start=time(8), scheduled_end=time(17), scheduled_hours=8.0, break_minutes=60)
        base.update(kw)
        return base

    def test_recomputes_early_and_outside_hours(self):
        from app.api.v1.endpoints.operations import verified_checkout_metrics
        early = verified_checkout_metrics(self._session(), {}, datetime(2026, 9, 5, 16, 30, tzinfo=VIETNAM_TZ))
        assert (early['actual_work_hours'], early['early_minutes'], early['overtime_hours']) == (7.5, 30, 0.0)
        late_out = verified_checkout_metrics(self._session(), {}, datetime(2026, 9, 5, 19, 0, tzinfo=VIETNAM_TZ))
        assert (late_out['actual_work_hours'], late_out['early_minutes'], late_out['overtime_hours']) == (10.0, 0, 2.0)

    def test_uses_check_in_snapshot(self):
        from app.api.v1.endpoints.operations import verified_checkout_metrics
        ctx = {'actual': {'start_time': '08:00:00', 'end_time': '16:00:00', 'work_hours': 8.0, 'break_minutes': 0}}
        m = verified_checkout_metrics(self._session(), ctx, datetime(2026, 9, 5, 16, 0, tzinfo=VIETNAM_TZ))
        assert (m['actual_work_hours'], m['early_minutes'], m['overtime_hours']) == (8.0, 0, 0.0)

    def test_rejects_checkout_not_after_checkin(self):
        from fastapi import HTTPException
        from app.api.v1.endpoints.operations import verified_checkout_metrics
        for out in (datetime(2026, 9, 5, 8, 0, tzinfo=VIETNAM_TZ), datetime(2026, 9, 5, 7, 0, tzinfo=VIETNAM_TZ)):
            with pytest.raises(HTTPException) as err:
                verified_checkout_metrics(self._session(), {}, out)
            assert err.value.status_code == 422


def test_admin_cannot_resolve_attendance_session():
    import asyncio
    from fastapi import HTTPException
    from app.api.v1.endpoints.operations import resolve_attendance_session

    class Body:
        decision = 'CONFIRMED_LATE'
        reason = 'Kiểm tra quyền ADMIN'
        new_shift_id = None
        verified_check_out_time = None
        version = None

    with pytest.raises(HTTPException) as err:
        asyncio.run(resolve_attendance_session(session_id=1, body=Body(), user={'roles': ['ADMIN']}, db=None))
    assert err.value.status_code == 403


@pytestmark_sql
def test_imported_pit_is_deducted_from_net(pg):
    emp = _employee(pg, 'TZ-PIT')
    for d in SEPT_WORKDAYS:
        _attend(pg, emp, d)
    pg.execute("""INSERT INTO payroll_import_overrides(salary_period, employee_id, personal_income_tax)
                  VALUES (%s, %s, 1250000)""", (PERIOD, emp))
    pg.execute('SELECT net_salary FROM payrolls WHERE employee_id = %s', (emp,))
    _run_payroll(pg)
    items = _details(pg, emp)
    assert items['PIT'] == 1_250_000
    pg.execute('SELECT gross_income - net_salary FROM payrolls WHERE employee_id = %s AND salary_period = %s',
               (emp, PERIOD))
    assert float(pg.fetchone()[0]) >= 1_250_000
