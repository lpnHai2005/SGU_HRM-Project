"""Fail-closed payroll OT procedure checks without touching database rows."""
import unittest

from fastapi import HTTPException

from app.api.v1.endpoints.payrolls import (
    CalculatePayrollRequest,
    calculate_payroll,
    ensure_payroll_ot_procedure_is_approval_gated,
)


class Result:
    def __init__(self, value=None):
        self.value = value

    def scalar_one_or_none(self):
        return self.value

    def first(self):
        return None


class FakeDatabase:
    def __init__(self, procedure_body):
        self.procedure_body = procedure_body
        self.statements = []

    async def execute(self, statement, *_args, **_kwargs):
        sql = str(statement)
        self.statements.append(sql)
        if "pg_get_functiondef" in sql:
            return Result(self.procedure_body)
        return Result()


class PayrollOvertimeProcedureGuardTests(unittest.IsolatedAsyncioTestCase):
    async def test_approved_ot_procedure_is_accepted(self):
        db = FakeDatabase("""CREATE PROCEDURE sp_generate_monthly_payroll AS
            SELECT SUM(CASE WHEN ota.decision='APPROVED' THEN ota.approved_hours ELSE 0 END) AS total_ot_hours
            FROM attendances a LEFT JOIN attendance_overtime_approvals ota ON ota.attendance_id=a.attendance_id;""")

        await ensure_payroll_ot_procedure_is_approval_gated(db)

    async def test_legacy_raw_attendance_hours_are_rejected(self):
        db = FakeDatabase("""CREATE PROCEDURE sp_generate_monthly_payroll AS
            SELECT SUM(overtime_hours) AS total_ot_hours FROM attendances;""")

        with self.assertRaises(HTTPException) as raised:
            await ensure_payroll_ot_procedure_is_approval_gated(db)

        self.assertEqual(raised.exception.status_code, 409)
        self.assertIn("Không có dữ liệu lương nào được thay đổi", raised.exception.detail)

    async def test_new_request_workflow_is_not_a_payroll_input(self):
        db = FakeDatabase("""CREATE PROCEDURE sp_generate_monthly_payroll AS
            SELECT SUM(CASE WHEN ota.decision='APPROVED' THEN ota.approved_hours ELSE 0 END) AS total_ot_hours
            FROM attendances a LEFT JOIN attendance_overtime_approvals ota ON ota.attendance_id=a.attendance_id
            LEFT JOIN overtime_requests r ON r.employee_id=a.employee_id;""")

        with self.assertRaises(HTTPException) as raised:
            await ensure_payroll_ot_procedure_is_approval_gated(db)

        self.assertEqual(raised.exception.status_code, 409)

    async def test_calculation_stops_before_any_payroll_write_on_legacy_procedure(self):
        db = FakeDatabase("SELECT SUM(overtime_hours) AS total_ot_hours FROM attendances")

        with self.assertRaises(HTTPException) as raised:
            await calculate_payroll(
                CalculatePayrollRequest(salary_period="2026-10"),
                current_user={"user_id": 7, "employee_id": 7, "roles": ["HR_MANAGER"]},
                db=db,
            )

        self.assertEqual(raised.exception.status_code, 409)
        self.assertFalse(any("CALL sp_calculate_monthly_commission" in sql for sql in db.statements))
        self.assertFalse(any("DELETE FROM payrolls" in sql or "DELETE FROM payroll_details" in sql for sql in db.statements))
        self.assertFalse(any("CALL sp_generate_monthly_payroll" in sql for sql in db.statements))


if __name__ == "__main__":
    unittest.main()
