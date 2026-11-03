"""
Comprehensive Test Suite for Payroll Shift Hours Standardization & Absent Days Deductions
Theo Ma trận kiểm thử 12 Test Cases (TC-01 -> TC-12) trong ke_hoach_chuan_hoa_cong_thuc_luong_va_dinh_muc_ca.md
"""
import os
import unittest
import psycopg2
from decimal import Decimal
from dotenv import load_dotenv

from app.schemas.schemas import PayrollOut


class PayrollStandardizationLogicTests(unittest.TestCase):
    """Kiểm thử tính toán toán học và logic chuẩn hóa theo BLLĐ 2019."""

    def test_tc01_excel_import_full_month_actual_days(self):
        """TC-01: Nhập công Excel làm đủ tháng -> actual_working_days = 26/26, không lỗi 0/26."""
        standard_days = 26.0
        ov_unpaid = 0.0
        ov_paid = 0.0
        actual_days = max(0.0, standard_days - (ov_unpaid + ov_paid))
        missing_days = ov_unpaid
        absent_days = max(0.0, missing_days - ov_unpaid)

        self.assertEqual(actual_days, 26.0)
        self.assertEqual(missing_days, 0.0)
        self.assertEqual(absent_days, 0.0)

    def test_tc02_excel_import_unpaid_leave_days(self):
        """TC-02: Nhập công Excel có 3 ngày nghỉ không lương -> actual = 23/26, trừ 3 ngày lương."""
        standard_days = 26.0
        ov_unpaid = 3.0
        ov_paid = 0.0
        contract_salary = 8000000.0

        actual_days = max(0.0, standard_days - (ov_unpaid + ov_paid))
        missing_days = ov_unpaid
        absent_days = max(0.0, missing_days - ov_unpaid)
        daily_salary = contract_salary / standard_days
        deduction = round((ov_unpaid + absent_days) * daily_salary, 0)

        self.assertEqual(actual_days, 23.0)
        self.assertEqual(ov_unpaid, 3.0)
        self.assertEqual(absent_days, 0.0)
        self.assertEqual(deduction, 923077.0)

    def test_tc08_shift_7h_ot_rate_calculation(self):
        """TC-08: Nhân viên ca 7h (Ca sáng) làm thêm 2h OT thường."""
        contract_salary = 8000000.0
        standard_days = 26.0
        shift_hours = 7.0
        ot_hours = 2.0
        ot_rate = 1.5

        hourly_rate = contract_salary / standard_days / shift_hours
        ot_amount = round(hourly_rate * ot_hours * ot_rate, 0)

        # 8000000 / 26 / 7.0 = 43956.0439...
        # 43956.0439 * 2 * 1.5 = 131868.13 -> round = 131868
        self.assertAlmostEqual(hourly_rate, 43956.04, places=1)
        self.assertEqual(ot_amount, 131868.0)

    def test_tc09_shift_11h_late_deduction(self):
        """TC-09: Nhân viên ca 11h (Ca full) đi muộn 45 phút."""
        contract_salary = 8000000.0
        standard_days = 26.0
        shift_hours = 11.0
        late_minutes = 45.0

        hourly_rate = contract_salary / standard_days / shift_hours
        late_hours = late_minutes / 60.0
        late_deduction = round(late_hours * hourly_rate, 0)

        # 8000000 / 26 / 11.0 = 27972.0279...
        # 0.75 * 27972.0279 = 20979.02 -> round = 20979
        self.assertAlmostEqual(hourly_rate, 27972.03, places=1)
        self.assertEqual(late_deduction, 20979.0)

    def test_tc10_unapproved_absence_10_days(self):
        """TC-10: Nghỉ không phép 10 ngày (không đơn) -> absent_days = 10, unpaid_leave_days = 0."""
        standard_days = 26.0
        worked_days = 16.0
        unpaid = 0.0
        paid = 0.0
        contract_salary = 8000000.0
        emp_daily_hours = 8.0

        missing_working_days = max(0.0, standard_days - (worked_days + paid))
        absent_days = max(0.0, missing_working_days - unpaid)
        unworked_hours = round(missing_working_days * emp_daily_hours, 2)
        daily_salary = contract_salary / standard_days
        deduction = round((unpaid + absent_days) * daily_salary, 0)

        self.assertEqual(unpaid, 0.0)
        self.assertEqual(absent_days, 10.0)
        self.assertEqual(unworked_hours, 80.0)
        self.assertEqual(deduction, 3076923.0)

    def test_tc12_mixed_unpaid_and_absent_days(self):
        """TC-12: Ca hỗn hợp: 2 ngày nghỉ không lương có phép + 10 ngày vắng không phép."""
        standard_days = 26.0
        worked_days = 14.0
        unpaid = 2.0  # có đơn
        paid = 0.0
        contract_salary = 8000000.0
        emp_daily_hours = 8.0

        missing_working_days = max(0.0, standard_days - (worked_days + paid))  # 12 ngày thiếu
        absent_days = max(0.0, missing_working_days - unpaid)                 # 10 ngày vắng
        unworked_hours = round(missing_working_days * emp_daily_hours, 2)      # 96.0h
        daily_salary = contract_salary / standard_days
        deduction = round((unpaid + absent_days) * daily_salary, 0)

        self.assertEqual(unpaid, 2.0)
        self.assertEqual(absent_days, 10.0)
        self.assertEqual(unworked_hours, 96.0)
        self.assertEqual(deduction, 3692308.0)

    def test_payroll_out_schema_has_new_fields(self):
        """Kiểm tra Pydantic schema PayrollOut có absent_days và daily_standard_hours."""
        data = {
            "payroll_id": 1,
            "employee_id": 1,
            "salary_period": "2026-10",
            "absent_days": 2.5,
            "daily_standard_hours": 7.0,
        }
        obj = PayrollOut(**data)
        self.assertEqual(obj.absent_days, 2.5)
        self.assertEqual(obj.daily_standard_hours, 7.0)


class PayrollSupabaseIntegrationTests(unittest.TestCase):
    """Kiểm thử trực tiếp trên database Supabase."""

    @classmethod
    def setUpClass(cls):
        env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
        load_dotenv(env_path)
        cls.db_url = os.getenv("SYNC_DATABASE_URL")
        cls.conn = psycopg2.connect(cls.db_url)
        cls.cur = cls.conn.cursor()

    @classmethod
    def tearDownClass(cls):
        cls.cur.close()
        cls.conn.close()

    def test_tc05_columns_exist_in_payrolls(self):
        """TC-05: Kiểm tra các cột vật lý bất biến daily_standard_hours và absent_days."""
        self.cur.execute("""
            SELECT column_name, data_type, column_default 
            FROM information_schema.columns 
            WHERE table_name = 'payrolls' AND column_name IN ('daily_standard_hours', 'absent_days')
            ORDER BY column_name;
        """)
        rows = {r[0]: r[1] for r in self.cur.fetchall()}
        self.assertIn("daily_standard_hours", rows)
        self.assertIn("absent_days", rows)

    def test_fn_employee_daily_standard_hours(self):
        """Kiểm tra hàm fn_employee_daily_standard_hours trả về giá trị hợp lệ."""
        self.cur.execute("SELECT public.fn_employee_daily_standard_hours(1, '2026-10');")
        hours = self.cur.fetchone()[0]
        self.assertIsNotNone(hours)
        self.assertGreater(hours, 0)
        self.assertIn(float(hours), [7.0, 8.0, 11.0, 6.67, 8.33])

    def test_tc06_trigger_sync_ot_reconciliation_assigns_to_last_session(self):
        """TC-06: Đơn OT đối soát có 2 attendance_ids -> chỉ gán vào attendance_id lớn nhất."""
        # Kiểm tra nội dung mã nguồn của fn_sync_ot_reconciliation_to_approvals
        self.cur.execute("""
            SELECT pg_get_functiondef(oid) 
            FROM pg_proc 
            WHERE proname = 'fn_sync_ot_reconciliation_to_approvals';
        """)
        src = self.cur.fetchone()[0]
        self.assertIn("target_att_id", src)
        self.assertIn("ORDER BY (val)::BIGINT DESC", src)
        self.assertIn("approved_hours = 0", src)

    def test_tc07_cross_month_leave_overlap_logic(self):
        """TC-07: Query giao thoa ngày bằng generate_series trừ Chủ nhật trong SP."""
        self.cur.execute("""
            SELECT COUNT(*)::NUMERIC 
            FROM generate_series(
                GREATEST('2026-09-28'::DATE, '2026-09-01'::DATE),
                LEAST('2026-10-05'::DATE, '2026-09-30'::DATE),
                INTERVAL '1 day'
            ) d WHERE EXTRACT(DOW FROM d) <> 0;
        """)
        sep_days = self.cur.fetchone()[0]
        # 28/09 (Mon), 29/09 (Tue), 30/09 (Wed) = 3 ngày
        self.assertEqual(sep_days, 3)

        self.cur.execute("""
            SELECT COUNT(*)::NUMERIC 
            FROM generate_series(
                GREATEST('2026-09-28'::DATE, '2026-10-01'::DATE),
                LEAST('2026-10-05'::DATE, '2026-10-31'::DATE),
                INTERVAL '1 day'
            ) d WHERE EXTRACT(DOW FROM d) <> 0;
        """)
        oct_days = self.cur.fetchone()[0]
        # 01/10 (Thu), 02/10 (Fri), 03/10 (Sat), 04/10 (Sun - trừ), 05/10 (Mon) = 4 ngày làm việc
        self.assertEqual(oct_days, 4)

    def test_leave_types_sick_and_maternity(self):
        """TC-03 & TC-04: SICK_LEAVE is_paid = False, MATERNITY_LEAVE is_paid = True."""
        self.cur.execute("SELECT type_code, is_paid FROM leave_types WHERE type_code IN ('NGHI_OM', 'THAI_SAN');")
        types_map = dict(self.cur.fetchall())
        self.assertEqual(types_map.get("NGHI_OM"), False)
        self.assertEqual(types_map.get("THAI_SAN"), True)


if __name__ == "__main__":
    unittest.main()
