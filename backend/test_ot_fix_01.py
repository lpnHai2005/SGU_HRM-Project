"""OT-FIX-01 policy and API checks; no database connection or migration."""

import unittest
from contextlib import contextmanager
from datetime import date, datetime, timezone
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from app.api.deps import get_current_user
from app.api.v1.endpoints import payrolls
from app.core.config import Settings, settings
from app.core.database import get_db
from app.core.ot_registration_policy import legacy_decision_locked, period_overlaps_policy
from app.schemas.schemas import BatchPayrollStatusRequest, CalculatePayrollRequest


@contextmanager
def policy(mode="DISABLED", cutoff=None):
    with patch.object(settings, "OT_REGISTRATION_POLICY_MODE", mode), patch.object(
        settings, "OT_REGISTRATION_POLICY_EFFECTIVE_FROM", cutoff
    ):
        yield


class Result:
    def __init__(self, value=None):
        self.value = value

    def first(self):
        return self.value

    def scalar_one_or_none(self):
        return self.value

    def mappings(self):
        return self

    def all(self):
        return self.value


class FakeDatabase:
    def __init__(self, work_date=date(2026, 10, 17), unresolved=True, finalized=False, old_decision=None):
        self.work_date = work_date
        self.unresolved = unresolved
        self.finalized = finalized
        self.old_decision = old_decision
        self.statements = []
        self.commits = 0

    async def execute(self, statement, *_args, **_kwargs):
        sql = str(statement)
        self.statements.append(sql)
        if "SELECT a.attendance_id,a.work_date,a.overtime_hours,a.check_out_time" in sql:
            return Result({"attendance_id": 11, "work_date": self.work_date,
                "overtime_hours": 1.5, "check_out_time": datetime.now(timezone.utc),
                "old_hours": None, "old_decision": None})
        if "SELECT 1 FROM payrolls WHERE salary_period" in sql:
            return Result((1,) if self.finalized else None)
        if "SELECT 1 FROM attendances" in sql:
            return Result((1,) if self.unresolved else None)
        if "FROM attendances a JOIN employees e" in sql:
            return Result([{"attendance_id": 11, "work_date": self.work_date,
                "actual_overtime_hours": 1.5, "approved_hours": 1 if self.old_decision else None,
                "decision": self.old_decision}])
        if "SELECT calculated_at FROM payroll_calculation_runs" in sql:
            return Result(datetime.now(timezone.utc))
        if "pg_get_functiondef" in sql:
            return Result("""CREATE PROCEDURE sp_generate_monthly_payroll AS
                SELECT SUM(CASE WHEN ota.decision='APPROVED' THEN ota.approved_hours ELSE 0 END) AS total_ot_hours
                FROM attendances a LEFT JOIN attendance_overtime_approvals ota USING(attendance_id)""")
        return Result(None)

    async def commit(self):
        self.commits += 1

    @property
    def writes(self):
        return [sql for sql in self.statements if sql.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE", "CALL"))]


ADMIN = {"user_id": 3, "employee_id": 3, "roles": ["ADMIN"]}
HR = {"user_id": 4, "employee_id": 4, "roles": ["HR_MANAGER"]}
EMPLOYEE = {"user_id": 5, "employee_id": 5, "roles": ["EMPLOYEE"]}
DECISION = payrolls.OvertimeDecision(approved_hours=1, decision="APPROVED", reason="Reviewed hours")


class OTFix01Tests(unittest.IsolatedAsyncioTestCase):
    def test_default_disabled_and_config_requires_cutoff(self):
        self.assertEqual(Settings(_env_file=None).OT_REGISTRATION_POLICY_MODE, "DISABLED")
        with self.assertRaises(ValueError):
            Settings(_env_file=None, OT_REGISTRATION_POLICY_MODE="LEGACY_ONLY_BEFORE_CUTOFF")

    def test_vietnam_business_day_including_overnight_shift(self):
        # Checkout can be on the 18th; the attendance work_date is still the 17th.
        with policy("LEGACY_ONLY_BEFORE_CUTOFF", date(2026, 10, 18)):
            self.assertFalse(legacy_decision_locked(date(2026, 10, 17)))
            self.assertTrue(legacy_decision_locked(date(2026, 10, 18)))
            self.assertFalse(period_overlaps_policy("2026-09"))
            self.assertTrue(period_overlaps_policy("2026-10"))

    async def test_before_cutoff_legacy_decision_still_writes(self):
        db = FakeDatabase(work_date=date(2026, 10, 16))
        with policy("LEGACY_ONLY_BEFORE_CUTOFF", date(2026, 10, 17)):
            result = await payrolls.decide_overtime(11, DECISION, current_user=HR, db=db)
        self.assertEqual(result["decision"], "APPROVED")
        self.assertEqual(db.commits, 1)
        self.assertEqual(len(db.writes), 2)  # approval and audit

    async def test_after_cutoff_both_decisions_and_retries_write_nothing(self):
        db = FakeDatabase()
        with policy("LEGACY_ONLY_BEFORE_CUTOFF", date(2026, 10, 17)):
            for decision in (DECISION, payrolls.OvertimeDecision(
                approved_hours=0, decision="REJECTED", reason="Reviewed hours"), DECISION):
                with self.assertRaises(HTTPException) as caught:
                    await payrolls.decide_overtime(11, decision, current_user=HR, db=db)
                self.assertEqual(caught.exception.status_code, 409)
                self.assertEqual(caught.exception.detail["code"], "OT_LEGACY_APPROVAL_CLOSED")
        self.assertEqual(db.writes, [])
        self.assertEqual(db.commits, 0)

    async def test_get_remains_readable_and_marks_locked_rows(self):
        db = FakeDatabase(old_decision="APPROVED")
        with policy("LEGACY_ONLY_BEFORE_CUTOFF", date(2026, 10, 17)):
            rows = await payrolls.list_overtime_approvals(period="2026-10", current_user=HR, db=db)
            pending = await payrolls.list_overtime_approvals(
                period="2026-10", current_user=HR, db=FakeDatabase())
        self.assertTrue(rows[0]["legacy_decision_locked"])
        self.assertEqual(rows[0]["decision"], "APPROVED")
        self.assertIn("lịch sử", rows[0]["actual_overtime_label"])
        self.assertIn("chưa xác nhận OT được phép", pending[0]["actual_overtime_label"])
        self.assertEqual(db.writes, [])

    async def test_calculate_and_confirm_hold_before_writes(self):
        db = FakeDatabase()
        with policy("LEGACY_ONLY_BEFORE_CUTOFF", date(2026, 10, 17)):
            with self.assertRaises(HTTPException) as caught:
                await payrolls.calculate_payroll(CalculatePayrollRequest(salary_period="2026-10"),
                    current_user=ADMIN, db=db)
            self.assertEqual(caught.exception.detail["code"], "OT_PAYROLL_REVIEW_REQUIRED")
            with self.assertRaises(HTTPException) as caught:
                await payrolls.confirm_all_payrolls(BatchPayrollStatusRequest(salary_period="2026-10"),
                    current_user=ADMIN, db=db)
            self.assertEqual(caught.exception.detail["code"], "OT_PAYROLL_REVIEW_REQUIRED")
        self.assertEqual(db.writes, [])
        self.assertEqual(db.commits, 0)

    async def test_new_period_hold_without_overtime_and_prior_period_allowed(self):
        db = FakeDatabase(unresolved=False)
        with policy("NEW_PERIOD_HOLD", date(2026, 10, 17)):
            with self.assertRaises(HTTPException) as caught:
                await payrolls.ensure_ot_period_policy(db, "2026-10")
            self.assertEqual(caught.exception.detail["code"], "OT_PAYROLL_PERIOD_ON_HOLD")
            await payrolls.ensure_ot_period_policy(db, "2026-09")
        self.assertEqual(db.writes, [])

    async def test_confirmed_and_paid_payroll_are_not_recalculated_or_changed(self):
        for status in ("CONFIRMED", "PAID"):
            with self.subTest(status=status):
                db = FakeDatabase(finalized=True)
                with policy("LEGACY_ONLY_BEFORE_CUTOFF", date(2026, 10, 17)):
                    with self.assertRaises(HTTPException) as caught:
                        await payrolls.calculate_payroll(CalculatePayrollRequest(salary_period="2026-10"),
                            current_user=ADMIN, db=db)
                self.assertEqual(caught.exception.status_code, 409)
                self.assertEqual(db.writes, [])
                self.assertEqual(db.commits, 0)

    async def test_legacy_mode_allows_period_without_new_overtime(self):
        db = FakeDatabase(unresolved=False)
        with policy("LEGACY_ONLY_BEFORE_CUTOFF", date(2026, 10, 17)):
            await payrolls.ensure_ot_period_policy(db, "2026-10")
        guard_sql = next(sql for sql in db.statements if "SELECT 1 FROM attendances" in sql)
        self.assertIn("ota.decision='APPROVED' AND ota.approved_hours>0", guard_sql)
        self.assertEqual(db.writes, [])

    async def test_both_router_aliases_and_rbac(self):
        app = FastAPI()
        app.include_router(payrolls.router, prefix="/api/v1/payrolls")
        app.include_router(payrolls.router, prefix="/api/v1/payroll")
        db = FakeDatabase()
        user = HR.copy()
        async def test_db():
            yield db
        async def test_user():
            return user
        app.dependency_overrides[get_db] = test_db
        app.dependency_overrides[get_current_user] = test_user
        with policy("LEGACY_ONLY_BEFORE_CUTOFF", date(2026, 10, 17)):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                for prefix in ("/api/v1/payrolls", "/api/v1/payroll"):
                    response = await client.put(f"{prefix}/overtime-approvals/11", json=DECISION.model_dump())
                    self.assertEqual(response.status_code, 409)
                    self.assertEqual(response.json()["detail"]["code"], "OT_LEGACY_APPROVAL_CLOSED")
                    response = await client.post(f"{prefix}/generate/2026-10")
                    self.assertEqual(response.status_code, 409)
                    self.assertEqual(response.json()["detail"]["code"], "OT_PAYROLL_REVIEW_REQUIRED")
                user = EMPLOYEE
                response = await client.put("/api/v1/payrolls/overtime-approvals/11", json=DECISION.model_dump())
                self.assertEqual(response.status_code, 403)
                response = await client.get("/api/v1/payroll/overtime-approvals?period=2026-10")
                self.assertEqual(response.status_code, 403)
        self.assertEqual(db.writes, [])
        self.assertEqual(db.commits, 0)


if __name__ == "__main__":
    unittest.main()
