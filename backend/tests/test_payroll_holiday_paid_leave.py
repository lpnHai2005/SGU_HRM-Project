"""
Comprehensive Test Suite for Holiday Paid-Leave Standardization (TC-H01 -> TC-H15)
Theo kế hoạch: docs/ke_hoach_chuan_hoa_ngay_nghi_le_va_tinh_luong.md

Mọi bài test tích hợp DB đều chạy trong transaction riêng và ROLLBACK ở tearDown,
không để lại bất kỳ dữ liệu thử nghiệm nào trên Supabase.
"""
import os
import unittest
from datetime import date, datetime
from decimal import Decimal

import psycopg2
from dotenv import load_dotenv
from fastapi import HTTPException

from app.api.v1.endpoints.payrolls import (
    _build_actual_base_salary_formula,
    ensure_fresh_payroll,
    ensure_payroll_ot_procedure_is_approval_gated,
    ensure_payroll_procedure_supports_import,
    reconcile_leaves_for_added_holiday,
)
from app.schemas.schemas import PayrollOut, PublicHolidayOut


class _FakeMappings:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _FakeScalars:
    def __init__(self, values):
        self._values = values

    def all(self):
        return self._values


class _FakeResult:
    def __init__(self, scalar=None, rows=None, first_row=None, mappings=None, scalars=None):
        self._scalar = scalar
        self._rows = rows or []
        self._first_row = first_row
        self._mappings = mappings or []
        self._scalars = scalars or []

    def scalar(self):
        return self._scalar

    def scalar_one_or_none(self):
        return self._scalar

    def fetchall(self):
        return self._rows

    def first(self):
        return self._first_row

    def mappings(self):
        return _FakeMappings(self._mappings)

    def scalars(self):
        return _FakeScalars(self._scalars)


class _FakeAsyncDB:
    """In-memory fake AsyncSession for unit-testing ensure_fresh_payroll & Hướng A."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    async def execute(self, stmt, params=None):
        sql = str(stmt)
        self.calls.append((sql, params))
        if self.responses:
            return self.responses.pop(0)
        return _FakeResult()


class HolidayPaidLeaveUnitTests(unittest.IsolatedAsyncioTestCase):
    """Unit tests cho formula, schema, guard ensure_fresh_payroll và Hướng A."""

    def test_schema_fields_present(self):
        p = PayrollOut(payroll_id=1, employee_id=1, salary_period="2026-02", holiday_paid_days=5.0)
        self.assertEqual(p.holiday_paid_days, 5.0)

        h = PublicHolidayOut(
            holiday_id=1,
            holiday_date=date(2026, 2, 17),
            holiday_name="Tết Nguyên Đán",
            warning="Có 2 bản ghi chấm công",
            adjusted_leaves_count=1,
        )
        self.assertEqual(h.adjusted_leaves_count, 1)
        self.assertIn("2 bản ghi", h.warning)

    def test_tc_h03_formula_includes_paid_leave_and_holiday_in_both_branches(self):
        """TC-H03: Công thức hiển thị cả nhánh không khấu trừ lẫn nhánh khấu trừ đều có paid_leave & holiday."""
        no_ded = _build_actual_base_salary_formula(
            contract_sal=24_000_000,
            std_days=24,
            act_days=17,
            paid_days=2,
            hol_days=5,
            time_ded=0,
        )
        self.assertIn("17 ngày làm + 2 phép + 5 lễ", no_ded)
        self.assertIn("24 ngày chuẩn", no_ded)

        with_ded = _build_actual_base_salary_formula(
            contract_sal=24_000_000,
            std_days=24,
            act_days=18,
            paid_days=0,
            hol_days=5,
            time_ded=1_000_000,
            ded_form="Thiếu 8h",
        )
        self.assertIn("18 ngày làm + 5 lễ", with_ded)
        self.assertIn("Thiếu 8h", with_ded)

    async def test_tc_h09_ensure_fresh_payroll_blocks_needs_recalc(self):
        """TC-H09: Chặn duyệt khi còn bản ghi NEEDS_RECALCULATION."""
        db = _FakeAsyncDB([
            _FakeResult(scalar=datetime(2026, 2, 28, 10, 0, 0)),  # payroll_calculation_runs
            _FakeResult(first_row=None),                          # ot changed
            _FakeResult(first_row=(1,)),                          # NEEDS_RECALCULATION found
        ])
        with self.assertRaises(HTTPException) as ctx:
            await ensure_fresh_payroll(db, "2026-02")
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("Cần tính lại", ctx.exception.detail)

    async def test_tc_h09_ensure_fresh_payroll_blocks_stale_standard_days(self):
        """TC-H09: Chặn duyệt khi DRAFT.standard_working_days lệch v.applied_standard_days."""
        db = _FakeAsyncDB([
            _FakeResult(scalar=datetime(2026, 2, 28, 10, 0, 0)),  # payroll_calculation_runs
            _FakeResult(first_row=None),                          # ot changed
            _FakeResult(first_row=None),                          # NEEDS_RECALCULATION = none
            _FakeResult(first_row=(1,)),                          # std_mismatch found
        ])
        with self.assertRaises(HTTPException) as ctx:
            await ensure_fresh_payroll(db, "2026-02")
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("Ngày công chuẩn", ctx.exception.detail)

    async def test_tc_h15_reconcile_leaves_for_added_holiday_huong_a(self):
        """TC-H15: Hướng A hoàn trả ngày phép, hủy đơn nếu còn 0 ngày, xóa attendance nghỉ phép, cảnh báo check-in."""
        db = _FakeAsyncDB([
            # 1. SELECT leave_requests overlapping
            _FakeResult(mappings=[
                {
                    "request_id": 101,
                    "employee_id": 10,
                    "start_date": date(2026, 11, 17),
                    "end_date": date(2026, 11, 17),
                    "total_days": Decimal("1.0"),
                    "status": "HR_APPROVED",
                    "type_code": "PHEP_NAM",
                },
                {
                    "request_id": 102,
                    "employee_id": 11,
                    "start_date": date(2026, 11, 16),
                    "end_date": date(2026, 11, 17),
                    "total_days": Decimal("2.0"),
                    "status": "HR_APPROVED",
                    "type_code": "PHEP_NAM",
                },
            ]),
            # Leave 101: count_leave_days -> SELECT holiday_date -> [2026-11-17] => new_days = 0
            _FakeResult(scalars=[date(2026, 11, 17)]),
            _FakeResult(),  # UPDATE leave 101 -> CANCELLED
            _FakeResult(),  # INSERT audit_logs for 101
            _FakeResult(),  # DELETE attendances for 101
            # Leave 102: count_leave_days -> SELECT holiday_date -> [2026-11-17] => new_days = 1
            _FakeResult(scalars=[date(2026, 11, 17)]),
            _FakeResult(),  # UPDATE leave 102 -> total_days = 1
            _FakeResult(),  # INSERT audit_logs for 102
            _FakeResult(),  # DELETE attendances for 102
            # COUNT check-ins on holiday
            _FakeResult(scalar=2),
        ])

        adjusted, warning = await reconcile_leaves_for_added_holiday(
            db, date(2026, 11, 17), "Ngày Lễ Test", actor_user_id=1
        )
        self.assertEqual(adjusted, 2)
        self.assertIsNotNone(warning)
        self.assertIn("2 nhân sự chấm công thực tế", warning)
        self.assertIn("2 đơn trùng ngày", warning)

        update_calls = [(sql, params) for sql, params in db.calls if "UPDATE leave_requests" in sql]
        self.assertEqual(len(update_calls), 2)
        self.assertIn("status = 'CANCELLED'", update_calls[0][0])
        self.assertEqual(update_calls[0][1]["rid"], 101)
        self.assertEqual(update_calls[1][1]["rid"], 102)
        self.assertEqual(update_calls[1][1]["new_days"], 1.0)


class HolidayPaidLeaveSupabaseIntegrationTests(unittest.TestCase):
    """
    Kiểm thử tích hợp trực tiếp trên PostgreSQL/Supabase với ROLLBACK tuyệt đối.
    Chạy thực tế fn_payroll_standard_days, v_payroll_period_working_days,
    fn_employee_holiday_paid_days và CALL sp_generate_monthly_payroll(...).
    """

    @classmethod
    def setUpClass(cls):
        env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
        load_dotenv(env_path)
        cls.db_url = os.getenv("SYNC_DATABASE_URL")
        if not cls.db_url:
            raise unittest.SkipTest("SYNC_DATABASE_URL không được cấu hình")

    def setUp(self):
        self.conn = psycopg2.connect(self.db_url)
        self.conn.autocommit = False
        self.cur = self.conn.cursor()

        # Lấy sẵn store_id, department_id, education_level_id, position_id (nhân viên thường), shift_id 8h, user_id
        self.cur.execute("SELECT store_id FROM stores ORDER BY store_id LIMIT 1;")
        self.store_id = self.cur.fetchone()[0]
        self.cur.execute("SELECT department_id FROM departments ORDER BY department_id LIMIT 1;")
        self.dept_id = self.cur.fetchone()[0]
        self.cur.execute("SELECT education_level_id FROM education_levels ORDER BY education_level_id LIMIT 1;")
        self.edu_id = self.cur.fetchone()[0]
        self.cur.execute(
            "SELECT position_id FROM positions WHERE position_code <> 'DIRECTOR' ORDER BY position_id LIMIT 1;"
        )
        self.pos_id = self.cur.fetchone()[0]
        self.cur.execute(
            "SELECT shift_id FROM work_shifts WHERE shift_name ILIKE '%hành chính%' ORDER BY shift_id LIMIT 1;"
        )
        row = self.cur.fetchone()
        if not row:
            self.cur.execute("SELECT shift_id FROM work_shifts ORDER BY shift_id LIMIT 1;")
            row = self.cur.fetchone()
        self.shift_id = row[0]
        self.cur.execute("SELECT user_id FROM users ORDER BY user_id LIMIT 1;")
        self.hr_user_id = self.cur.fetchone()[0]
        self.cur.execute("SELECT type_code, leave_type_id FROM leave_types;")
        self.leave_types = dict(self.cur.fetchall())
        self._emp_seq = 0

    def tearDown(self):
        self.conn.rollback()
        self.cur.close()
        self.conn.close()

    def _create_test_employee(
        self,
        code: str,
        join_date: date,
        basic_salary: float = 24_000_000,
        contract_start: date = None,
        contract_end: date = None,
        contract_status: str = "ACTIVE",
        resign_date: date = None,
        employment_status: str = "ACTIVE",
    ) -> int:
        self._emp_seq += 1
        c_start = contract_start or join_date
        cccd = f"079999{self._emp_seq:06d}"
        phone = f"090999{self._emp_seq:04d}"
        self.cur.execute(
            """
            INSERT INTO employees (
                employee_code, first_name, last_name, gender, dob, identity_card,
                phone, company_email, current_address, store_id, department_id,
                position_id, education_level_id, join_date, resignation_date, employment_status
            )
            VALUES (%s, %s, %s, 'MALE', '1995-01-01', %s, %s, %s, 'Test Addr', %s, %s, %s, %s, %s, %s, %s)
            RETURNING employee_id
            """,
            (
                code,
                "Test",
                code,
                cccd,
                phone,
                f"{code.lower()}@test.local",
                self.store_id,
                self.dept_id,
                self.pos_id,
                self.edu_id,
                join_date,
                resign_date,
                employment_status,
            ),
        )
        emp_id = self.cur.fetchone()[0]
        self.cur.execute(
            """
            INSERT INTO contracts (
                employee_id, contract_number, contract_type, start_date, end_date,
                basic_salary, insurance_salary, signed_date, status
            )
            VALUES (%s, %s, 'FIXED_1_YEAR', %s, %s, %s, %s, %s, %s)
            """,
            (
                emp_id,
                f"HD-{code}",
                c_start,
                contract_end,
                basic_salary,
                basic_salary,
                c_start,
                contract_status,
            ),
        )
        return emp_id

    def _insert_normal_attendance(
        self,
        emp_id: int,
        work_date: date,
        shift_start="08:00",
        shift_end="17:00",
        actual_work_hours: float = 9.0,
    ):
        cin = f"{work_date} {shift_start}:00+07:00"
        cout = f"{work_date} {shift_end}:00+07:00"
        self.cur.execute(
            """
            INSERT INTO attendances (
                employee_id, store_id, shift_id, work_date, check_in_time, check_out_time,
                actual_work_hours, status, late_minutes, early_minutes, overtime_hours
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, 'NORMAL', 0, 0, 0)
            RETURNING attendance_id
            """,
            (emp_id, self.store_id, self.shift_id, work_date, cin, cout, actual_work_hours),
        )
        return self.cur.fetchone()[0]

    def _generate_and_fetch_payroll(self, period: str, emp_id: int):
        self.cur.execute(
            "CALL public.sp_generate_monthly_payroll(%s, %s, %s);",
            (period, self.hr_user_id, None),
        )
        self.cur.execute(
            """
            SELECT p.payroll_id, p.standard_working_days, p.actual_working_days,
                   p.paid_leave_days, p.holiday_paid_days, p.unpaid_leave_days,
                   p.absent_days, p.unworked_hours, p.contract_salary,
                   p.total_earnings, p.gross_income, p.net_salary,
                   COALESCE((SELECT amount FROM payroll_details
                             WHERE payroll_id = p.payroll_id AND item_code = 'BASE_SALARY_DEDUCTION'), 0) AS ded,
                   COALESCE((SELECT amount FROM payroll_details
                             WHERE payroll_id = p.payroll_id AND item_code = 'OVERTIME'), 0) AS ot_amt
            FROM payrolls p
            WHERE p.salary_period = %s AND p.employee_id = %s
            """,
            (period, emp_id),
        )
        row = self.cur.fetchone()
        self.assertIsNotNone(row, f"Không tìm thấy payroll cho emp {emp_id} kỳ {period}")
        keys = [
            "payroll_id", "std", "actual", "paid", "holiday", "unpaid",
            "absent", "unworked_hours", "contract_salary", "total_earnings",
            "gross", "net", "ded", "ot_amt",
        ]
        return dict(zip(keys, row))

    def test_sp_passes_backend_guards(self):
        """Xác minh SP hiện tại trên Supabase vượt qua toàn bộ guard của backend."""
        self.cur.execute(
            """
            SELECT pg_get_functiondef(p.oid)
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'sp_generate_monthly_payroll' AND p.pronargs = 3
            """
        )
        body = self.cur.fetchone()[0]
        self.assertIn("holiday_paid_days", body)
        self.assertIn("fn_employee_holiday_paid_days", body)
        self.assertNotIn("overtime_requests", body.lower())

        import asyncio

        class _SyncWrap:
            async def execute(self_inner, *_a, **_kw):
                return _FakeResult(scalar=body)

        asyncio.run(ensure_payroll_ot_procedure_is_approval_gated(_SyncWrap()))
        asyncio.run(ensure_payroll_procedure_supports_import(_SyncWrap()))

    def test_tc_h01_h02_h03_h04_h05_february_2026_matrix(self):
        """
        TC-H01..H05 trên kỳ 2026-02 (28 ngày, 4 CN, 5 ngày Tết 16-20/02 -> std=24):
        - TC-H01: đi làm đủ 19 ngày -> actual=19, holiday=5, ded=0, lương CB thực=24M
        - TC-H02: đi làm 18 ngày + 1 ngày nghỉ không lương -> actual=18, holiday=5, ded=1M, lương CB thực=23M
        - TC-H03: đi làm 17 ngày + 2 ngày phép năm -> actual=17, paid=2, holiday=5, ded=0, lương CB thực=24M
        - TC-H04: vào làm sau Tết (21/02), đi làm đủ 6 ngày còn lại -> holiday=0, actual=6, lương CB thực=6M
        - TC-H05: nghỉ không lương cả tháng 01/02..28/02 -> vẫn hưởng holiday=5 (chính sách 4.a)
        """
        feb_holidays = {date(2026, 2, d) for d in range(16, 21)}
        feb_workdays = [
            date(2026, 2, d)
            for d in range(1, 29)
            if date(2026, 2, d).weekday() != 6 and date(2026, 2, d) not in feb_holidays
        ]
        self.assertEqual(len(feb_workdays), 19)

        e1 = self._create_test_employee("TCH01", date(2025, 1, 1), 24_000_000)
        e2 = self._create_test_employee("TCH02", date(2025, 1, 1), 24_000_000)
        e3 = self._create_test_employee("TCH03", date(2025, 1, 1), 24_000_000)
        e4 = self._create_test_employee("TCH04", date(2026, 2, 21), 24_000_000)
        e5 = self._create_test_employee("TCH05", date(2025, 1, 1), 24_000_000)

        # e1: đủ 19 ngày làm việc
        for d in feb_workdays:
            self._insert_normal_attendance(e1, d)

        # e2: 18 ngày làm việc + 1 ngày nghỉ không lương (02/02)
        for d in feb_workdays[1:]:
            self._insert_normal_attendance(e2, d)
        self.cur.execute(
            """
            INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, total_days, reason, status)
            VALUES (%s, %s, %s, %s, 1, 'Test unpaid', 'HR_APPROVED')
            """,
            (e2, self.leave_types["KHONG_LUONG"], feb_workdays[0], feb_workdays[0]),
        )

        # e3: 17 ngày làm việc + 2 ngày phép năm (02/02, 03/02)
        for d in feb_workdays[2:]:
            self._insert_normal_attendance(e3, d)
        self.cur.execute(
            """
            INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, total_days, reason, status)
            VALUES (%s, %s, %s, %s, 2, 'Test paid', 'HR_APPROVED')
            """,
            (e3, self.leave_types["PHEP_NAM"], feb_workdays[0], feb_workdays[1]),
        )

        # e4: vào làm 21/02, đi làm đủ 6 ngày (21,23,24,25,26,27/02 -> 28/02 là T7 = 7 ngày; chờ check)
        after_tet_days = [d for d in feb_workdays if d >= date(2026, 2, 21)]
        # Chỉ chấm đúng 6 ngày đầu từ 21/02 để khớp đúng mô tả TC-H04 (hoặc check số ngày thực tế)
        for d in after_tet_days[:6]:
            self._insert_normal_attendance(e4, d)

        # e5: nghỉ không lương cả tháng 01/02..28/02
        self.cur.execute(
            """
            INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, total_days, reason, status)
            VALUES (%s, %s, '2026-02-01', '2026-02-28', 19, 'Unpaid full month', 'HR_APPROVED')
            """,
            (e5, self.leave_types["KHONG_LUONG"]),
        )

        r1 = self._generate_and_fetch_payroll("2026-02", e1)
        r2 = self._generate_and_fetch_payroll("2026-02", e2)
        r3 = self._generate_and_fetch_payroll("2026-02", e3)
        r4 = self._generate_and_fetch_payroll("2026-02", e4)
        r5 = self._generate_and_fetch_payroll("2026-02", e5)

        # TC-H01
        self.assertEqual(float(r1["std"]), 24.0)
        self.assertEqual(float(r1["actual"]), 19.0)
        self.assertEqual(float(r1["holiday"]), 5.0)
        self.assertEqual(float(r1["ded"]), 0.0)
        self.assertEqual(float(r1["total_earnings"]), 24_000_000.0)

        # TC-H02
        self.assertEqual(float(r2["std"]), 24.0)
        self.assertEqual(float(r2["actual"]), 18.0)
        self.assertEqual(float(r2["holiday"]), 5.0)
        self.assertEqual(float(r2["unpaid"]), 1.0)
        self.assertEqual(float(r2["ded"]), 1_000_000.0)
        self.assertEqual(float(r2["total_earnings"]), 23_000_000.0)

        # TC-H03
        self.assertEqual(float(r3["actual"]), 17.0)
        self.assertEqual(float(r3["paid"]), 2.0)
        self.assertEqual(float(r3["holiday"]), 5.0)
        self.assertEqual(float(r3["ded"]), 0.0)
        self.assertEqual(float(r3["total_earnings"]), 24_000_000.0)

        # TC-H04
        self.assertEqual(float(r4["holiday"]), 0.0)
        self.assertEqual(float(r4["actual"]), 6.0)
        self.assertEqual(float(r4["ded"]), 18_000_000.0)
        self.assertEqual(float(r4["total_earnings"]), 6_000_000.0)

        # TC-H05 (4.a: vẫn hưởng 5 ngày Lễ khi nghỉ không lương)
        self.assertEqual(float(r5["holiday"]), 5.0)
        self.assertEqual(float(r5["actual"]), 0.0)
        self.assertEqual(float(r5["ded"]), 19_000_000.0)
        self.assertEqual(float(r5["total_earnings"]), 5_000_000.0)

    def test_tc_h06_sunday_holiday_not_double_counted(self):
        """TC-H06: 2026-04 có 26/04 (CN), 27/04 (T2 bù), 30/04 (T5) -> holidays_count=2, holiday_paid_days=2."""
        self.cur.execute(
            """
            SELECT auto_standard_days, holidays_count
            FROM public.v_payroll_period_working_days
            WHERE salary_period = '2026-04'
            """
        )
        std, hcnt = self.cur.fetchone()
        self.assertEqual(float(std), 26.0)
        self.assertEqual(int(hcnt), 2)

        e = self._create_test_employee("TCH06", date(2025, 1, 1), 26_000_000)
        self.cur.execute("SELECT public.fn_employee_holiday_paid_days(%s, '2026-04');", (e,))
        self.assertEqual(float(self.cur.fetchone()[0]), 2.0)

    def test_tc_h07_h08_holiday_work_excluded_from_normal_wk(self):
        """
        TC-H07 & TC-H08: Làm 8h trong ngày Lễ (2026-04-30) không cộng vào actual_working_days / wk,
        và KHÔNG bù 1:1 cho 1 ngày thường bị vắng (nhân viên nghỉ 1 ngày thường vẫn bị trừ 1 ngày).
        """
        apr_holidays = {date(2026, 4, 27), date(2026, 4, 30)}
        apr_workdays = [
            date(2026, 4, d)
            for d in range(1, 31)
            if date(2026, 4, d).weekday() != 6 and date(2026, 4, d) not in apr_holidays
        ]
        self.assertEqual(len(apr_workdays), 24)

        e = self._create_test_employee("TCH08", date(2025, 1, 1), 26_000_000)
        # Đi làm 23 ngày thường (vắng 1 ngày thường) + đi làm 8h ngày Lễ 30/04
        for d in apr_workdays[1:]:
            self._insert_normal_attendance(e, d)
        att_hol = self._insert_normal_attendance(e, date(2026, 4, 30))

        # Có 2h OT duyệt ngày Lễ để xác minh OT 300% vẫn hoạt động bình thường
        self.cur.execute(
            """
            INSERT INTO attendance_overtime_approvals (
                attendance_id, decision, approved_hours, reviewer_user_id, reason
            )
            VALUES (%s, 'APPROVED', 2.0, %s, 'OT Lễ test')
            """,
            (att_hol, self.hr_user_id),
        )

        r = self._generate_and_fetch_payroll("2026-04", e)
        self.assertEqual(float(r["std"]), 26.0)
        self.assertEqual(float(r["holiday"]), 2.0)
        self.assertEqual(float(r["actual"]), 23.0)  # KHÔNG được tính thành 24!
        self.assertEqual(float(r["absent"]), 1.0)
        self.assertEqual(float(r["ded"]), 1_000_000.0)  # Vẫn bị trừ 1 ngày vắng!
        # OT 300%: 26M / 26 / 8 * 2 * 3.0 = 750,000
        self.assertEqual(float(r["ot_amt"]), 750_000.0)

    def test_tc_h10_closed_periods_remain_immutable(self):
        """TC-H10: Kỳ đã chốt/thanh toán (2026-08, 2026-09, 2026-10) giữ nguyên số liệu & khóa công chuẩn."""
        self.cur.execute(
            """
            SELECT salary_period, applied_standard_days, is_locked
            FROM public.v_payroll_period_working_days
            WHERE salary_period = '2026-09'
            """
        )
        period, applied, is_locked = self.cur.fetchone()
        self.assertTrue(is_locked)
        self.assertEqual(float(applied), 24.0)

        self.cur.execute(
            """
            SELECT COUNT(*), MAX(holiday_paid_days), MIN(standard_working_days)
            FROM payrolls
            WHERE salary_period = '2026-09' AND payment_status = 'PAID'
            """
        )
        cnt, max_hol, min_std = self.cur.fetchone()
        self.assertGreater(cnt, 0)
        self.assertEqual(float(max_hol), 0.0)
        self.assertEqual(float(min_std), 24.0)

    def test_tc_h11_manual_override_with_holiday_paid_days(self):
        """TC-H11: Override công chuẩn 2026-02 = 24, NV đi làm 14 ngày + 5 Lễ -> thiếu 5 ngày (40h) -> trừ 5M."""
        self.cur.execute(
            """
            INSERT INTO payroll_period_overrides (salary_period, override_working_days, reason, updated_by)
            VALUES ('2026-02', 24.0, 'Test override', %s)
            ON CONFLICT (salary_period) DO UPDATE SET override_working_days = EXCLUDED.override_working_days
            """,
            (self.hr_user_id,),
        )
        feb_holidays = {date(2026, 2, d) for d in range(16, 21)}
        feb_workdays = [
            date(2026, 2, d)
            for d in range(1, 29)
            if date(2026, 2, d).weekday() != 6 and date(2026, 2, d) not in feb_holidays
        ]
        e = self._create_test_employee("TCH11", date(2025, 1, 1), 24_000_000)
        for d in feb_workdays[:14]:
            self._insert_normal_attendance(e, d)

        r = self._generate_and_fetch_payroll("2026-02", e)
        self.assertEqual(float(r["std"]), 24.0)
        self.assertEqual(float(r["actual"]), 14.0)
        self.assertEqual(float(r["holiday"]), 5.0)
        self.assertEqual(float(r["unworked_hours"]), 40.0)
        self.assertEqual(float(r["ded"]), 5_000_000.0)
        self.assertEqual(float(r["total_earnings"]), 19_000_000.0)

    def test_tc_h12_contract_transition_probation_to_official(self):
        """TC-H12: HĐ thử việc EXPIRED 01/01–20/02 + HĐ chính thức ACTIVE từ 21/02 -> vẫn hưởng đủ 5 ngày Tết."""
        e = self._create_test_employee(
            "TCH12",
            join_date=date(2026, 1, 1),
            basic_salary=24_000_000,
            contract_start=date(2026, 2, 21),
            contract_status="ACTIVE",
        )
        self.cur.execute(
            """
            INSERT INTO contracts (
                employee_id, contract_number, contract_type, start_date, end_date,
                basic_salary, insurance_salary, signed_date, status
            )
            VALUES (%s, 'HD-TCH12-PROB', 'PROBATION', '2026-01-01', '2026-02-20', 20000000, 20000000, '2026-01-01', 'EXPIRED')
            """,
            (e,),
        )
        self.cur.execute("SELECT public.fn_employee_holiday_paid_days(%s, '2026-02');", (e,))
        self.assertEqual(float(self.cur.fetchone()[0]), 5.0)

    def test_tc_h13_maternity_excluded_but_sick_unpaid_kept(self):
        """TC-H13: THAI_SAN trùng 18/02 -> chỉ hưởng 4 ngày Lễ; NGHI_OM/KHONG_LUONG trùng lễ -> vẫn hưởng 5."""
        e_mat = self._create_test_employee("TCH13M", date(2025, 1, 1))
        e_sick = self._create_test_employee("TCH13S", date(2025, 1, 1))

        self.cur.execute(
            """
            INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, total_days, reason, status)
            VALUES (%s, %s, '2026-02-18', '2026-02-18', 1, 'Maternity test', 'HR_APPROVED')
            """,
            (e_mat, self.leave_types["THAI_SAN"]),
        )
        self.cur.execute(
            """
            INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, total_days, reason, status)
            VALUES (%s, %s, '2026-02-16', '2026-02-20', 5, 'Sick test', 'HR_APPROVED')
            """,
            (e_sick, self.leave_types["NGHI_OM"]),
        )

        self.cur.execute("SELECT public.fn_employee_holiday_paid_days(%s, '2026-02');", (e_mat,))
        self.assertEqual(float(self.cur.fetchone()[0]), 4.0)

        self.cur.execute("SELECT public.fn_employee_holiday_paid_days(%s, '2026-02');", (e_sick,))
        self.assertEqual(float(self.cur.fetchone()[0]), 5.0)

    def test_tc_h14_excel_import_override_keeps_holiday_zero_no_double_pay(self):
        """TC-H14: Bản ghi payroll_import_overrides có unpaid_leave_days=0 -> holiday_paid_days=0, actual=24, ded=0."""
        e = self._create_test_employee("TCH14", date(2025, 1, 1), 24_000_000)
        self.cur.execute(
            """
            INSERT INTO payroll_import_overrides (
                salary_period, employee_id, unpaid_leave_days, paid_leave_days, note, imported_by
            )
            VALUES ('2026-02', %s, 0.0, 0.0, 'Excel full month', %s)
            """,
            (e, self.hr_user_id),
        )
        r = self._generate_and_fetch_payroll("2026-02", e)
        self.assertEqual(float(r["std"]), 24.0)
        self.assertEqual(float(r["holiday"]), 0.0)
        self.assertEqual(float(r["actual"]), 24.0)
        self.assertEqual(float(r["ded"]), 0.0)
        self.assertEqual(float(r["total_earnings"]), 24_000_000.0)


if __name__ == "__main__":
    unittest.main()
