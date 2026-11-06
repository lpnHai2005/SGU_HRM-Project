import io
import unittest
from decimal import Decimal
import openpyxl
from openpyxl.styles import Protection

from app.core.payroll_import import (
    EXPECTED_HEADERS,
    FIRST_DATA_ROW,
    ImportFileError,
    _norm,
    classify_import_rows,
    parse_import_workbook,
    sanitize_file_name,
)


def create_test_excel(
    period="2026-10",
    stamp="2026-11-02T09:15:03.123456+00:00",
    headers=None,
    data_rows=None,
    corrupt_c1=False,
    corrupt_b1=False,
) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active

    # Row 1
    ws.cell(row=1, column=1, value="TECHZONE HRM - NHẬP CÔNG & KHOẢN BỔ SUNG")
    b1_text = "Sai kỳ" if corrupt_b1 else f"Kỳ lương: {period}"
    ws.cell(row=1, column=2, value=b1_text)
    if not corrupt_c1:
        ws.cell(row=1, column=3, value=f"Mốc dữ liệu: {stamp}")

    # Row 2
    ws.cell(row=2, column=1, value="Hướng dẫn nhập liệu")

    # Row 3 (Headers)
    hdrs = headers if headers is not None else EXPECTED_HEADERS
    for col_idx, h in enumerate(hdrs, start=1):
        ws.cell(row=3, column=col_idx, value=h)

    # Data Rows
    if data_rows:
        for r_idx, row in enumerate(data_rows, start=FIRST_DATA_ROW):
            for c_idx, val in enumerate(row, start=1):
                cell = ws.cell(row=r_idx, column=c_idx)
                if isinstance(val, str) and val.startswith("="):
                    cell.value = val
                else:
                    cell.value = val

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


class FakeResult:
    def __init__(self, value=None):
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def fetchall(self):
        return self._value if isinstance(self._value, list) else []

    def first(self):
        return self._value


class FakeDbRow:
    def __init__(self, d):
        self._mapping = d

    def __getitem__(self, idx):
        # idx 0: salary_period, 1: employee_id
        if idx == 1:
            return self._mapping.get("employee_id")
        return list(self._mapping.values())[idx]


class FakeDatabaseForClassify:
    def __init__(self, standard_days="27.0", employees=None, overrides=None, approved_ot=None, adjustments=None):
        self.standard_days = standard_days
        self.employees = employees or [
            (1, "TZ-001", "Nguyen Van A", "ACTIVE"),
            (2, "TZ-002", "Tran Van B", "ACTIVE"),
            (3, "TZ-003", "Le Van C", "ACTIVE"),
        ]
        self.overrides = overrides or []  # list of dicts
        self.approved_ot = approved_ot or []
        self.adjustments = adjustments or []

    async def execute(self, statement, params=None):
        sql = str(statement)
        if "fn_payroll_standard_days" in sql:
            return FakeResult(self.standard_days)
        if "FROM employees" in sql:
            return FakeResult(self.employees)
        if "FROM public.payroll_import_overrides" in sql:
            return FakeResult([FakeDbRow(d) for d in self.overrides])
        if "fn_payable_ot_rows" in sql:
            return FakeResult(self.approved_ot)
        if "payroll_manual_adjustments" in sql:
            return FakeResult(self.adjustments)
        return FakeResult()


class PayrollImportParserUnitTests(unittest.TestCase):
    def test_sanitize_file_name(self):
        self.assertEqual(sanitize_file_name("..\\..\\a\x01.xlsx"), "a.xlsx")
        self.assertEqual(sanitize_file_name(None), "import.xlsx")
        self.assertEqual(sanitize_file_name(""), "import.xlsx")
        self.assertEqual(sanitize_file_name("normal_name.xlsx"), "normal_name.xlsx")

    def test_corrupted_structure_rejected(self):
        # Not a zip / xlsx
        with self.assertRaises(ImportFileError) as ctx:
            parse_import_workbook(b"not an excel file", "2026-10")
        self.assertIn(".xlsx", str(ctx.exception))

        # Corrupt B1 (wrong period)
        excel_bad_b1 = create_test_excel(corrupt_b1=True)
        with self.assertRaises(ImportFileError) as ctx:
            parse_import_workbook(excel_bad_b1, "2026-10")
        self.assertIn("Kỳ lương", str(ctx.exception))

        # Missing C1
        excel_no_c1 = create_test_excel(corrupt_c1=True)
        with self.assertRaises(ImportFileError) as ctx:
            parse_import_workbook(excel_no_c1, "2026-10")
        self.assertIn("mốc dữ liệu", str(ctx.exception))

        # Corrupt Headers
        excel_bad_hdr = create_test_excel(headers=["Mã NV", "Họ tên"])
        with self.assertRaises(ImportFileError) as ctx:
            parse_import_workbook(excel_bad_hdr, "2026-10")
        self.assertIn("mẫu", str(ctx.exception))

    def test_row_limit_500(self):
        # 500 rows should pass
        rows_500 = [["TZ-%03d" % i] + [None] * 16 for i in range(1, 501)]
        excel_500 = create_test_excel(data_rows=rows_500)
        stamp, rows, errors = parse_import_workbook(excel_500, "2026-10")
        self.assertEqual(len(rows), 500)
        self.assertEqual(len(errors), 0)

        # 501 rows with data should raise ImportFileError
        rows_501 = [["TZ-%03d" % i] + [None] * 16 for i in range(1, 502)]
        excel_501 = create_test_excel(data_rows=rows_501)
        with self.assertRaises(ImportFileError) as ctx:
            parse_import_workbook(excel_501, "2026-10")
        self.assertIn("500", str(ctx.exception))

    def test_duplicate_employee_code_in_file(self):
        rows = [
            ["TZ-001", "A", None, None, None, None, None, 26, 0, None, None, None, 0, 0, 0, 0, None],
            ["TZ-001", "A", None, None, None, None, None, 25, 0, None, None, None, 0, 0, 0, 0, None],
        ]
        excel_dup = create_test_excel(data_rows=rows)
        _, valid_rows, errors = parse_import_workbook(excel_dup, "2026-10")
        self.assertEqual(len(valid_rows), 1)
        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0]["row_index"], 5)
        self.assertIn("lặp lại", errors[0]["reason"])

    def test_number_cell_validation(self):
        # Non-numeric string and boolean
        rows = [
            ["TZ-001", "A", None, None, None, None, None, "24,5", 0, None, None, None, 0, 0, 0, 0, None],
            ["TZ-002", "B", None, None, None, None, None, True, 0, None, None, None, 0, 0, 0, 0, None],
        ]
        excel = create_test_excel(data_rows=rows)
        _, valid_rows, errors = parse_import_workbook(excel, "2026-10")
        self.assertEqual(len(valid_rows), 1)  # "24,5" can be parsed as 245 or checked if comma replaced
        # Check that boolean True was rejected
        self.assertTrue(any("Ô phải là số" in e["reason"] for e in errors))

    def test_uncalculated_formula_detection(self):
        # A formula without cached evaluation in data_only
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.cell(row=1, column=1, value="TECHZONE HRM")
        ws.cell(row=1, column=2, value="Kỳ lương: 2026-10")
        ws.cell(row=1, column=3, value="Mốc dữ liệu: 2026-11-02T00:00:00")
        ws.cell(row=2, column=1, value="HD")
        for idx, h in enumerate(EXPECTED_HEADERS, 1):
            ws.cell(row=3, column=idx, value=h)

        # Row 4: H contains formula `=27-1` but openpyxl hasn't evaluated it
        ws.cell(row=4, column=1, value="TZ-001")
        ws.cell(row=4, column=8, value="=27-1")
        ws.cell(row=4, column=9, value=0)

        buf = io.BytesIO()
        wb.save(buf)
        _, valid_rows, errors = parse_import_workbook(buf.getvalue(), "2026-10")
        self.assertEqual(len(valid_rows), 0)
        self.assertEqual(len(errors), 1)
        self.assertIn("chưa được Excel tính", errors[0]["reason"])

    def test_empty_rows_and_missing_employee_code(self):
        rows = [
            [None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None, None],
            [None, None, None, None, None, None, None, 25, 0, None, None, None, 0, 0, 0, 0, None],
        ]
        excel = create_test_excel(data_rows=rows)
        _, valid_rows, errors = parse_import_workbook(excel, "2026-10")
        # Row 4 is completely empty -> skipped
        # Row 5 has data but missing code -> error
        self.assertEqual(len(valid_rows), 0)
        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0]["row_index"], 5)
        self.assertIn("Thiếu mã nhân viên", errors[0]["reason"])


class PayrollImportClassifyUnitTests(unittest.IsolatedAsyncioTestCase):
    async def test_classify_pair_validation_and_bounds(self):
        db = FakeDatabaseForClassify(standard_days="27.0")
        # 1. Has cong but no phep
        res1 = await classify_import_rows(db, "2026-10", [{
            "row_index": 4, "employee_code": "TZ-001", "actual_working_days": 25.0, "paid_leave_days": None,
            "extra_commission": 0, "extra_bonus": 0, "extra_allowance": 0, "extra_penalty": 0, "note": None
        }])
        self.assertEqual(len(res1["invalid_records"]), 1)
        self.assertIn("phải nhập Phép", res1["invalid_records"][0]["reason"])

        # 2. Cong > std (28 > 27)
        res2 = await classify_import_rows(db, "2026-10", [{
            "row_index": 4, "employee_code": "TZ-001", "actual_working_days": 28.0, "paid_leave_days": 0.0,
            "extra_commission": 0, "extra_bonus": 0, "extra_allowance": 0, "extra_penalty": 0, "note": None
        }])
        self.assertEqual(len(res2["invalid_records"]), 1)
        self.assertIn("vượt công chuẩn", res2["invalid_records"][0]["reason"])

        # 3. Phep > cong (10 > 5)
        res3 = await classify_import_rows(db, "2026-10", [{
            "row_index": 4, "employee_code": "TZ-001", "actual_working_days": 5.0, "paid_leave_days": 10.0,
            "extra_commission": 0, "extra_bonus": 0, "extra_allowance": 0, "extra_penalty": 0, "note": None
        }])
        self.assertEqual(len(res3["invalid_records"]), 1)
        self.assertIn("không thể vượt quá công thực tế", res3["invalid_records"][0]["reason"])

        # 4. Decimal precision > 2 digits
        res4 = await classify_import_rows(db, "2026-10", [{
            "row_index": 4, "employee_code": "TZ-001", "actual_working_days": 24.125, "paid_leave_days": 0.0,
            "extra_commission": 0, "extra_bonus": 0, "extra_allowance": 0, "extra_penalty": 0, "note": None
        }])
        self.assertEqual(len(res4["invalid_records"]), 1)
        self.assertIn("2 chữ số thập phân", res4["invalid_records"][0]["reason"])

        # 5. Money with decimals or > 100M
        res5 = await classify_import_rows(db, "2026-10", [{
            "row_index": 4, "employee_code": "TZ-001", "actual_working_days": 26.0, "paid_leave_days": 0.0,
            "extra_commission": 1500000.5, "extra_bonus": 105000000, "extra_allowance": 0, "extra_penalty": 0, "note": None
        }])
        self.assertGreaterEqual(len(res5["invalid_records"]), 2)

    async def test_classify_actions_create_update_delete_unchanged(self):
        # Override for TZ-001 already in DB
        db_ov = [{
            "salary_period": "2026-10", "employee_id": 1, "batch_id": 10,
            "unpaid_leave_days": Decimal("1.00"), "paid_leave_days": Decimal("0.00"),
            "extra_commission": Decimal("1000000.00"), "extra_bonus": Decimal("500000.00"),
            "extra_allowance": Decimal("0.00"), "extra_penalty": Decimal("0.00"),
            "note": "Bonus"
        }]
        db = FakeDatabaseForClassify(standard_days="27.0", overrides=db_ov)

        # TZ-001: identical -> UNCHANGED
        # TZ-002: new data -> CREATE
        # TZ-003: empty row and no override -> UNCHANGED
        rows = [
            {
                "row_index": 4, "employee_code": "TZ-001", "actual_working_days": 26.0, "paid_leave_days": 0.0,
                "extra_commission": 1000000, "extra_bonus": 500000, "extra_allowance": 0, "extra_penalty": 0, "note": "Bonus"
            },
            {
                "row_index": 5, "employee_code": "TZ-002", "actual_working_days": 27.0, "paid_leave_days": 0.0,
                "extra_commission": 0, "extra_bonus": 2000000, "extra_allowance": 0, "extra_penalty": 0, "note": None
            },
            {
                "row_index": 6, "employee_code": "TZ-003", "actual_working_days": None, "paid_leave_days": None,
                "extra_commission": 0, "extra_bonus": 0, "extra_allowance": 0, "extra_penalty": 0, "note": None
            }
        ]
        res = await classify_import_rows(db, "2026-10", rows)
        actions = {a["employee_code"]: a["action"] for a in res["actions"]}
        self.assertEqual(actions["TZ-001"], "UNCHANGED")
        self.assertEqual(actions["TZ-002"], "CREATE")
        self.assertEqual(actions["TZ-003"], "UNCHANGED")

        # Test DELETE: empty row for employee having existing override
        rows_del = [{
            "row_index": 4, "employee_code": "TZ-001", "actual_working_days": None, "paid_leave_days": None,
            "extra_commission": 0, "extra_bonus": 0, "extra_allowance": 0, "extra_penalty": 0, "note": None
        }]
        res_del = await classify_import_rows(db, "2026-10", rows_del)
        self.assertEqual(res_del["actions"][0]["action"], "DELETE")

        # Test UPDATE: different data for employee having existing override
        rows_upd = [{
            "row_index": 4, "employee_code": "TZ-001", "actual_working_days": 25.0, "paid_leave_days": 1.0,
            "extra_commission": 2000000, "extra_bonus": 500000, "extra_allowance": 0, "extra_penalty": 0, "note": "Bonus"
        }]
        res_upd = await classify_import_rows(db, "2026-10", rows_upd)
        self.assertEqual(res_upd["actions"][0]["action"], "UPDATE")

    async def test_formula_float_epsilon_and_decimal_safety(self):
        # Excel formula result 26.900000000000002, money 1499999.9999999998
        db_ov = [{
            "salary_period": "2026-10", "employee_id": 1, "batch_id": 10,
            "unpaid_leave_days": Decimal("0.10"), "paid_leave_days": Decimal("0.00"),
            "extra_commission": Decimal("1500000.00"), "extra_bonus": Decimal("0.00"),
            "extra_allowance": Decimal("0.00"), "extra_penalty": Decimal("0.00"),
            "note": None
        }]
        db = FakeDatabaseForClassify(standard_days="27.0", overrides=db_ov)

        rows = [{
            "row_index": 4, "employee_code": "TZ-001",
            "actual_working_days": 26.900000000000002, "paid_leave_days": 0.0,
            "extra_commission": 1499999.9999999998, "extra_bonus": 0, "extra_allowance": 0, "extra_penalty": 0,
            "note": None
        }]
        res = await classify_import_rows(db, "2026-10", rows)
        self.assertEqual(len(res["invalid_records"]), 0)
        # 27 - 26.9 = 0.10 unpaid -> matches db_ov -> UNCHANGED
        self.assertEqual(res["actions"][0]["action"], "UNCHANGED")
        self.assertEqual(res["actions"][0]["unpaid_leave_days"], 0.1)


if __name__ == "__main__":
    unittest.main()



class PayrollImportPitColumnTests(unittest.IsolatedAsyncioTestCase):
    """Sign-off #6 (Phase 1): Kế toán import Thuế TNCN ở cột tùy chọn thứ 18."""

    ROW = ["TZ-001", "A", None, None, None, None, None, 26, 0, None, None, None, 0, 0, 0, 0, None]

    def test_pit_column_is_parsed(self):
        from app.core.payroll_import import OPTIONAL_PIT_HEADER
        excel = create_test_excel(headers=EXPECTED_HEADERS + [OPTIONAL_PIT_HEADER], data_rows=[self.ROW + [1_250_000]])
        _, rows, errors = parse_import_workbook(excel, "2026-10")
        self.assertEqual(errors, [])
        self.assertEqual(rows[0]["personal_income_tax"], 1_250_000)

    def test_old_17_column_template_keeps_existing_tax(self):
        _, rows, errors = parse_import_workbook(create_test_excel(data_rows=[self.ROW]), "2026-10")
        self.assertEqual(errors, [])
        self.assertIsNone(rows[0]["personal_income_tax"])

    async def test_classify_keeps_or_updates_tax(self):
        db_ov = [{"salary_period": "2026-10", "employee_id": 1, "batch_id": 1,
                  "unpaid_leave_days": Decimal("1.00"), "paid_leave_days": Decimal("0.00"),
                  "extra_commission": Decimal("0"), "extra_bonus": Decimal("0"), "extra_allowance": Decimal("0"),
                  "extra_penalty": Decimal("0"), "personal_income_tax": Decimal("800000.00"), "note": None}]
        db = FakeDatabaseForClassify(standard_days="27.0", overrides=db_ov)
        base = {"row_index": 4, "employee_code": "TZ-001", "actual_working_days": 26.0, "paid_leave_days": 0.0,
                "extra_commission": 0, "extra_bonus": 0, "extra_allowance": 0, "extra_penalty": 0, "note": None}
        kept = await classify_import_rows(db, "2026-10", [dict(base, personal_income_tax=None)])
        self.assertEqual(kept["actions"][0]["action"], "UNCHANGED")
        self.assertEqual(kept["actions"][0]["personal_income_tax"], 800000)
        changed = await classify_import_rows(db, "2026-10", [dict(base, personal_income_tax=900000)])
        self.assertEqual(changed["actions"][0]["action"], "UPDATE")
        self.assertEqual(changed["actions"][0]["personal_income_tax"], 900000)
        bad = await classify_import_rows(db, "2026-10", [dict(base, personal_income_tax=-5)])
        self.assertTrue(any(e["field"] == "personal_income_tax" for e in bad["invalid_records"]))
