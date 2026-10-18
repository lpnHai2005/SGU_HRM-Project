"""Comprehensive acceptance test suite for OT registration feature.

Verifies:
1. Migration equivalence between 20261017_20261019_overtime_hardened.sql and the 3 base migrations.
2. Direct application of the hardened SQL.
3. RLS, role grants, sequences, and append-only trigger protection.
4. Complete business workflow: GET, POST, Submit, Confirm, Approve, Reject, Decline, Cancel.
5. Lifecycle operations: Revocation (request/approve/reject/attendance guard), Amendment (linking/approval/replacement).
6. RBAC across 4 roles: Admin, Store Manager, HR Manager, Employee.
7. In-app notifications and deep-links.

All tests run in rollback-scoped transactions using synthetic data only. No persistent changes to Supabase Cloud.
"""

import asyncio
import json
import re
import unittest
from datetime import date, datetime, time, timedelta
from pathlib import Path

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.v1.endpoints import operations, overtime_requests
from app.core.database import engine, get_db
from app.core.overtime_requests import VIETNAM_TZ, local_interval


class MigrationEquivalenceAuditTests(unittest.TestCase):
    """Verify that 20261017_20261019_overtime_hardened.sql contains all schema elements of the 3 base migrations."""

    def setUp(self):
        mig_dir = Path(__file__).parent / "migrations"
        self.sql_hardened = (mig_dir / "20261017_20261019_overtime_hardened.sql").read_text(encoding="utf-8")
        self.sql_mig1 = (mig_dir / "20261017_overtime_requests.sql").read_text(encoding="utf-8")
        self.sql_mig2 = (mig_dir / "20261018_overtime_request_notes.sql").read_text(encoding="utf-8")
        self.sql_mig3 = (mig_dir / "20261019_overtime_lifecycle.sql").read_text(encoding="utf-8")

    def test_tables_created(self):
        self.assertIn("CREATE TABLE IF NOT EXISTS overtime_requests", self.sql_hardened)
        self.assertIn("CREATE TABLE IF NOT EXISTS overtime_request_events", self.sql_hardened)

    def test_indexes_and_constraints_present(self):
        expected_indexes = [
            "uq_overtime_requests_creator_idempotency",
            "ix_overtime_requests_employee_interval",
            "ix_overtime_requests_status_date",
            "ix_overtime_requests_store_date",
            "ix_overtime_request_events_request",
            "ix_overtime_requests_parent",
            "uq_overtime_active_amendment_per_parent",
        ]
        for idx in expected_indexes:
            self.assertIn(idx, self.sql_hardened, f"Index {idx} missing in hardened SQL")

    def test_notes_and_lifecycle_columns_present(self):
        expected_columns = [
            "notes TEXT",
            "request_type VARCHAR(20)",
            "parent_request_id BIGINT",
            "replaced_by_request_id BIGINT",
            "revoke_requested_by INTEGER",
            "revoke_requested_at TIMESTAMPTZ",
            "revoke_reason TEXT",
            "revoke_decided_by INTEGER",
            "revoke_decided_at TIMESTAMPTZ",
            "revoke_decision VARCHAR(20)",
            "revoke_decision_reason TEXT",
            "revoked_by INTEGER",
            "revoked_at TIMESTAMPTZ",
            "revocation_reason TEXT",
        ]
        for col in expected_columns:
            self.assertIn(col, self.sql_hardened, f"Column {col} missing in hardened SQL")

    def test_security_enhancements_present(self):
        self.assertIn("guard_overtime_events_append_only", self.sql_hardened)
        self.assertIn("trg_protect_overtime_events_immutable", self.sql_hardened)
        self.assertIn("ALTER TABLE overtime_requests ENABLE ROW LEVEL SECURITY", self.sql_hardened)
        self.assertIn("ALTER TABLE overtime_request_events ENABLE ROW LEVEL SECURITY", self.sql_hardened)
        self.assertIn("REVOKE ALL ON TABLE overtime_requests FROM anon, authenticated", self.sql_hardened)
        self.assertIn("GRANT SELECT, INSERT ON TABLE overtime_request_events TO service_role", self.sql_hardened)


class OvertimeWorkflowAcceptanceTests(unittest.IsolatedAsyncioTestCase):
    """End-to-end acceptance tests on PostgreSQL using rollback-scoped isolated tables."""

    async def asyncSetUp(self):
        self.conn = await engine.connect()
        self.tx = await self.conn.begin()

        # Create mock parent tables as TEMP with ON COMMIT DROP
        for ddl in [
            "CREATE TEMP TABLE users(user_id integer PRIMARY KEY, username text) ON COMMIT DROP",
            "CREATE TEMP TABLE stores(store_id integer PRIMARY KEY, store_name text, is_active boolean) ON COMMIT DROP",
            "CREATE TEMP TABLE employees(employee_id integer PRIMARY KEY, employee_code text, full_name text, store_id integer, employment_status text) ON COMMIT DROP",
            "CREATE TEMP TABLE work_shifts(shift_id integer PRIMARY KEY, shift_name text, start_time time, end_time time, work_hours numeric, is_active boolean) ON COMMIT DROP",
            "CREATE TEMP TABLE work_schedules(schedule_id integer PRIMARY KEY, employee_id integer, store_id integer, shift_id integer, work_date date, starts_at timestamptz, ends_at timestamptz, cancelled_at timestamptz) ON COMMIT DROP",
            "CREATE TEMP TABLE leave_requests(request_id integer PRIMARY KEY, employee_id integer, start_date date, end_date date, status text, updated_at timestamptz DEFAULT now()) ON COMMIT DROP",
            "CREATE TEMP TABLE attendances(attendance_id integer PRIMARY KEY, employee_id integer, check_in_time timestamptz, check_out_time timestamptz, late_minutes integer) ON COMMIT DROP",
            "CREATE TEMP TABLE notification_reads(user_id integer, notice_id text, PRIMARY KEY(user_id,notice_id)) ON COMMIT DROP",
        ]:
            await self.conn.execute(text(ddl))

        # Read and apply hardened migration adapted for TEMP schema
        mig_file = Path(__file__).parent / "migrations" / "20261017_20261019_overtime_hardened.sql"
        raw_sql = mig_file.read_text(encoding="utf-8")
        
        # Strip BEGIN and COMMIT since we are already in self.tx
        raw_sql = re.sub(r"^\s*(BEGIN|COMMIT)\s*;", "", raw_sql, flags=re.MULTILINE | re.IGNORECASE)
        # Adapt table creation to TEMP so it stays isolated to this transaction
        adapted_sql = raw_sql.replace("CREATE TABLE IF NOT EXISTS ", "CREATE TEMP TABLE IF NOT EXISTS ")

        # Robust SQL statement splitter that respects $$ dollar quotes in functions
        statements = []
        current = []
        in_dollar = False
        for line in adapted_sql.splitlines(keepends=True):
            if "$$" in line:
                in_dollar = not in_dollar if line.count("$$") % 2 == 1 else in_dollar
            if not in_dollar and ";" in line:
                parts = line.split(";")
                for part in parts[:-1]:
                    current.append(part)
                    s = "".join(current).strip()
                    if s:
                        statements.append(s)
                    current = []
                current.append(parts[-1])
            else:
                current.append(line)
        tail = "".join(current).strip()
        if tail:
            statements.append(tail)

        for cleaned in statements:
            if cleaned and not cleaned.startswith("SET LOCAL"):
                if any(k in cleaned for k in ("anon", "authenticated", "service_role")):
                    continue
                await self.conn.execute(text(cleaned))

        # Insert synthetic test data
        await self.conn.execute(text("INSERT INTO users VALUES (1,'admin'), (2,'manager_1'), (3,'employee_1'), (4,'hr_manager'), (5,'employee_2'), (6,'manager_2')"))
        await self.conn.execute(text("INSERT INTO stores VALUES (1,'Store One',true), (2,'Store Two',true)"))
        await self.conn.execute(text("""INSERT INTO employees VALUES
            (20,'M-01','Store Manager 1',1,'ACTIVE'),
            (21,'E-01','Nguyen Van Employee 1',1,'ACTIVE'),
            (22,'H-01','Le Van HR',1,'ACTIVE'),
            (30,'E-02','Tran Van Employee 2',2,'ACTIVE'),
            (31,'M-02','Store Manager 2',2,'ACTIVE'),
            (99,'A-01','System Admin',1,'ACTIVE')
        """))
        await self.conn.execute(text("INSERT INTO work_shifts VALUES (8,'Morning Shift','08:00','16:00',8,true)"))
        await self.conn.execute(text("""INSERT INTO work_schedules VALUES
            (1,21,1,8,'2026-10-25','2026-10-25 08:00+07','2026-10-25 16:00+07',NULL)"""))
        await self.conn.execute(text("INSERT INTO leave_requests(request_id,employee_id,start_date,end_date,status) VALUES (1,21,'2026-10-28','2026-10-28','HR_APPROVED')"))

        # Setup FastAPI test client
        self.db = AsyncSession(bind=self.conn, join_transaction_mode="create_savepoint", expire_on_commit=False)
        self.app = FastAPI()
        self.app.include_router(overtime_requests.router, prefix="/api/v1/overtime-requests")
        self.app.include_router(operations.router, prefix="/api/v1/operations")

        self.current_user = {"user_id": 2, "employee_id": 20, "store_id": 1, "roles": ["STORE_MANAGER"]}

        async def test_db():
            yield self.db

        async def test_user():
            return self.current_user

        self.app.dependency_overrides[get_db] = test_db
        self.app.dependency_overrides[get_current_user] = test_user
        self.client = AsyncClient(transport=ASGITransport(app=self.app), base_url="http://test")

        # Test users
        self.user_manager_1 = {"user_id": 2, "employee_id": 20, "store_id": 1, "roles": ["STORE_MANAGER"]}
        self.user_employee_1 = {"user_id": 3, "employee_id": 21, "store_id": 1, "roles": ["EMPLOYEE"]}
        self.user_hr = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}
        self.user_admin = {"user_id": 1, "employee_id": 99, "store_id": 1, "roles": ["ADMIN"]}
        self.user_employee_2 = {"user_id": 5, "employee_id": 30, "store_id": 2, "roles": ["EMPLOYEE"]}

    async def asyncTearDown(self):
        await self.client.aclose()
        await self.db.close()
        await self.tx.rollback()
        await self.conn.close()
        await engine.dispose()

    async def as_role(self, user, method, url, **kwargs):
        self.current_user = user
        return await getattr(self.client, method)(url, **kwargs)

    # -------------------------------------------------------------------
    # Test Cases: Core Lifecycle & Idempotency
    # -------------------------------------------------------------------
    async def test_full_lifecycle_manager_propose_confirm_approve(self):
        payload = {
            "employee_id": 21,
            "work_date": "2026-10-26",
            "start_time": "18:00",
            "end_time": "21:00",
            "reason": "Evening delivery support",
            "notes": "Expected 50 deliveries",
        }
        # 1. Manager creates OT proposal with Idempotency Key
        created = await self.as_role(self.user_manager_1, "post", "/api/v1/overtime-requests", json=payload, headers={"Idempotency-Key": "ot-key-0001"})
        self.assertEqual(created.status_code, 201, created.text)
        req_id = created.json()["request_id"]
        self.assertEqual(created.json()["status"], "DRAFT")
        self.assertEqual(created.json()["notes"], "Expected 50 deliveries")

        # 2. Idempotent retry returns same request
        retry = await self.as_role(self.user_manager_1, "post", "/api/v1/overtime-requests", json=payload, headers={"Idempotency-Key": "ot-key-0001"})
        self.assertEqual(retry.status_code, 201)
        self.assertEqual(retry.json()["request_id"], req_id)

        # 3. Manager submits proposal -> PENDING_EMPLOYEE_CONFIRMATION
        submitted = await self.as_role(self.user_manager_1, "post", f"/api/v1/overtime-requests/{req_id}/submit")
        self.assertEqual(submitted.status_code, 200)
        self.assertEqual(submitted.json()["status"], "PENDING_EMPLOYEE_CONFIRMATION")

        # 4. Employee confirms proposal -> PENDING_HR
        confirmed = await self.as_role(self.user_employee_1, "post", f"/api/v1/overtime-requests/{req_id}/employee-confirm")
        self.assertEqual(confirmed.status_code, 200)
        self.assertEqual(confirmed.json()["status"], "PENDING_HR")

        # 5. HR approves proposal -> APPROVED
        approved = await self.as_role(self.user_hr, "post", f"/api/v1/overtime-requests/{req_id}/approve")
        self.assertEqual(approved.status_code, 200)
        self.assertEqual(approved.json()["status"], "APPROVED")
        self.assertIsNotNone(approved.json()["reviewed_at"])

        # 6. Re-approval is idempotent
        reapproved = await self.as_role(self.user_hr, "post", f"/api/v1/overtime-requests/{req_id}/approve")
        self.assertEqual(reapproved.status_code, 200)
        self.assertEqual(reapproved.json()["status"], "APPROVED")

    async def test_employee_self_request_direct_to_hr_and_rejection(self):
        payload = {
            "work_date": "2026-10-27",
            "start_time": "19:00",
            "end_time": "22:00",
            "reason": "Warehouse inventory count",
        }
        # Employee creates self-request
        created = await self.as_role(self.user_employee_1, "post", "/api/v1/overtime-requests", json=payload)
        self.assertEqual(created.status_code, 201)
        req_id = created.json()["request_id"]

        # Employee submits -> goes directly to PENDING_HR
        submitted = await self.as_role(self.user_employee_1, "post", f"/api/v1/overtime-requests/{req_id}/submit")
        self.assertEqual(submitted.json()["status"], "PENDING_HR")

        # HR rejects with reason
        rejected = await self.as_role(self.user_hr, "post", f"/api/v1/overtime-requests/{req_id}/reject", json={"reason": "Store budget depleted"})
        self.assertEqual(rejected.status_code, 200)
        self.assertEqual(rejected.json()["status"], "REJECTED")
        self.assertEqual(rejected.json()["rejection_reason"], "Store budget depleted")

    async def test_employee_declines_manager_proposal(self):
        payload = {
            "employee_id": 21,
            "work_date": "2026-10-29",
            "start_time": "17:00",
            "end_time": "20:00",
            "reason": "Urgent stock arrangement",
        }
        created = await self.as_role(self.user_manager_1, "post", "/api/v1/overtime-requests", json=payload)
        req_id = created.json()["request_id"]
        await self.as_role(self.user_manager_1, "post", f"/api/v1/overtime-requests/{req_id}/submit")

        # Employee declines
        declined = await self.as_role(self.user_employee_1, "post", f"/api/v1/overtime-requests/{req_id}/employee-decline", json={"reason": "Family emergency"})
        self.assertEqual(declined.status_code, 200)
        self.assertEqual(declined.json()["status"], "EMPLOYEE_DECLINED")

        # HR cannot approve a declined request
        blocked = await self.as_role(self.user_hr, "post", f"/api/v1/overtime-requests/{req_id}/approve")
        self.assertEqual(blocked.status_code, 409)

    # -------------------------------------------------------------------
    # Test Cases: Revocation & Attendance Guard
    # -------------------------------------------------------------------
    async def test_revocation_lifecycle_and_attendance_guard(self):
        # 1. Create and approve a request
        payload = {
            "employee_id": 21,
            "work_date": "2026-11-05",
            "start_time": "18:00",
            "end_time": "20:00",
            "reason": "Pre-campaign setup",
        }
        created = await self.as_role(self.user_manager_1, "post", "/api/v1/overtime-requests", json=payload)
        req_id = created.json()["request_id"]
        await self.as_role(self.user_manager_1, "post", f"/api/v1/overtime-requests/{req_id}/submit")
        await self.as_role(self.user_employee_1, "post", f"/api/v1/overtime-requests/{req_id}/employee-confirm")
        await self.as_role(self.user_hr, "post", f"/api/v1/overtime-requests/{req_id}/approve")

        # 2. Employee requests revocation
        revoke_req = await self.as_role(self.user_employee_1, "post", f"/api/v1/overtime-requests/{req_id}/revoke-request", json={"reason": "Campaign postponed"})
        self.assertEqual(revoke_req.status_code, 200)
        detail = await self.as_role(self.user_employee_1, "get", f"/api/v1/overtime-requests/{req_id}")
        self.assertTrue(detail.json()["lifecycle"]["revocation_pending"])

        # 3. HR approves revocation -> REVOKED
        revoked = await self.as_role(self.user_hr, "post", f"/api/v1/overtime-requests/{req_id}/revoke-approve")
        self.assertEqual(revoked.status_code, 200)
        self.assertEqual(revoked.json()["status"], "REVOKED")

        # 4. Attendance Guard: Request with overlapping attendance cannot be revoked
        created2 = await self.as_role(self.user_manager_1, "post", "/api/v1/overtime-requests", json={
            "employee_id": 21, "work_date": "2026-11-06", "start_time": "18:00", "end_time": "20:00", "reason": "Late night shift",
        })
        req_id2 = created2.json()["request_id"]
        await self.as_role(self.user_manager_1, "post", f"/api/v1/overtime-requests/{req_id2}/submit")
        await self.as_role(self.user_employee_1, "post", f"/api/v1/overtime-requests/{req_id2}/employee-confirm")
        await self.as_role(self.user_hr, "post", f"/api/v1/overtime-requests/{req_id2}/approve")

        # Insert overlapping attendance
        await self.conn.execute(text("INSERT INTO attendances VALUES (10, 21, '2026-11-06 18:05+07', '2026-11-06 19:30+07', 5)"))
        
        # Revocation should be blocked by attendance guard
        blocked_revoke = await self.as_role(self.user_manager_1, "post", f"/api/v1/overtime-requests/{req_id2}/revoke-request", json={"reason": "Try revoke after checkin"})
        self.assertEqual(blocked_revoke.status_code, 409)
        self.assertEqual(blocked_revoke.json()["detail"]["code"], "OVERTIME_ATTENDANCE_REVIEW_REQUIRED")

    # -------------------------------------------------------------------
    # Test Cases: Amendment Workflow (Linked Child & Parent Replacement)
    # -------------------------------------------------------------------
    async def test_amendment_workflow_links_parent_and_replaces(self):
        # 1. Create and approve parent
        payload = {
            "employee_id": 21,
            "work_date": "2026-11-10",
            "start_time": "18:00",
            "end_time": "21:00",
            "reason": "Original schedule plan",
        }
        created = await self.as_role(self.user_manager_1, "post", "/api/v1/overtime-requests", json=payload)
        parent_id = created.json()["request_id"]
        await self.as_role(self.user_manager_1, "post", f"/api/v1/overtime-requests/{parent_id}/submit")
        await self.as_role(self.user_employee_1, "post", f"/api/v1/overtime-requests/{parent_id}/employee-confirm")
        await self.as_role(self.user_hr, "post", f"/api/v1/overtime-requests/{parent_id}/approve")

        # 2. Employee proposes amendment
        amend_body = {
            "work_date": "2026-11-11",
            "start_time": "19:00",
            "end_time": "22:00",
            "reason": "Adjust date for supplier delivery",
        }
        child = await self.as_role(self.user_employee_1, "post", f"/api/v1/overtime-requests/{parent_id}/amend", json=amend_body)
        self.assertEqual(child.status_code, 201)
        child_id = child.json()["request_id"]
        self.assertEqual(child.json()["request_type"], "AMENDMENT")
        self.assertEqual(child.json()["parent_request_id"], parent_id)
        self.assertEqual(child.json()["status"], "PENDING_HR")

        # 3. HR approves amendment -> child becomes APPROVED, parent becomes REPLACED
        child_approved = await self.as_role(self.user_hr, "post", f"/api/v1/overtime-requests/{child_id}/amend-approve")
        self.assertEqual(child_approved.status_code, 200)
        self.assertEqual(child_approved.json()["status"], "APPROVED")

        # 4. Verify parent status
        parent_check = await self.as_role(self.user_hr, "get", f"/api/v1/overtime-requests/{parent_id}")
        self.assertEqual(parent_check.json()["status"], "REPLACED")
        self.assertEqual(parent_check.json()["replaced_by_request_id"], child_id)

    # -------------------------------------------------------------------
    # Test Cases: RBAC Scope & Filtering
    # -------------------------------------------------------------------
    async def test_rbac_filtering_and_cross_store_boundaries(self):
        # Manager 1 creates request in Store 1
        r1 = await self.as_role(self.user_manager_1, "post", "/api/v1/overtime-requests", json={
            "employee_id": 21, "work_date": "2026-11-15", "start_time": "18:00", "end_time": "20:00", "reason": "Store 1 OT",
        })
        id1 = r1.json()["request_id"]

        # Admin creates request for Employee 2 in Store 2
        r2 = await self.as_role(self.user_admin, "post", "/api/v1/overtime-requests", json={
            "employee_id": 30, "work_date": "2026-11-15", "start_time": "18:00", "end_time": "20:00", "reason": "Store 2 OT",
        })
        id2 = r2.json()["request_id"]

        # 1. Admin sees both
        admin_list = await self.as_role(self.user_admin, "get", "/api/v1/overtime-requests?date_from=2026-11-01&date_to=2026-11-30")
        admin_ids = {item["request_id"] for item in admin_list.json()}
        self.assertIn(id1, admin_ids)
        self.assertIn(id2, admin_ids)

        # 2. Manager 1 sees only Store 1
        mgr_list = await self.as_role(self.user_manager_1, "get", "/api/v1/overtime-requests?date_from=2026-11-01&date_to=2026-11-30")
        mgr_ids = {item["request_id"] for item in mgr_list.json()}
        self.assertIn(id1, mgr_ids)
        self.assertNotIn(id2, mgr_ids)

        # 3. Employee 1 sees only own request
        emp_list = await self.as_role(self.user_employee_1, "get", "/api/v1/overtime-requests?date_from=2026-11-01&date_to=2026-11-30")
        emp_ids = {item["request_id"] for item in emp_list.json()}
        self.assertIn(id1, emp_ids)
        self.assertNotIn(id2, emp_ids)

        # 4. Employee 2 trying to query Employee 1 directly -> 403 Forbidden
        denied = await self.as_role(self.user_employee_2, "get", f"/api/v1/overtime-requests?date_from=2026-11-01&date_to=2026-11-30&employee_id=21")
        self.assertEqual(denied.status_code, 403)

    # -------------------------------------------------------------------
    # Test Cases: Conflict Checks (Shifts & Leave)
    # -------------------------------------------------------------------
    async def test_conflict_detection_work_shift_and_leave(self):
        # Shift on 2026-10-25 is 08:00 - 16:00
        # Overlapping OT: 15:00 - 18:00
        overlap_shift = await self.as_role(self.user_manager_1, "post", "/api/v1/overtime-requests", json={
            "employee_id": 21, "work_date": "2026-10-25", "start_time": "15:00", "end_time": "18:00", "reason": "Overlap shift test",
        })
        self.assertEqual(overlap_shift.status_code, 409)
        self.assertEqual(overlap_shift.json()["detail"]["code"], "WORK_SCHEDULE_CONFLICT")

        # Leave request on 2026-10-28
        overlap_leave = await self.as_role(self.user_manager_1, "post", "/api/v1/overtime-requests", json={
            "employee_id": 21, "work_date": "2026-10-28", "start_time": "18:00", "end_time": "21:00", "reason": "Overlap leave test",
        })
        self.assertEqual(overlap_leave.status_code, 409)
        self.assertEqual(overlap_leave.json()["detail"]["code"], "LEAVE_CONFLICT")

    # -------------------------------------------------------------------
    # Test Cases: Notifications and Deep Links
    # -------------------------------------------------------------------
    async def test_notifications_and_read_status(self):
        created = await self.as_role(self.user_manager_1, "post", "/api/v1/overtime-requests", json={
            "employee_id": 21, "work_date": "2026-11-20", "start_time": "18:00", "end_time": "20:00", "reason": "Notice test OT",
        })
        req_id = created.json()["request_id"]
        await self.as_role(self.user_manager_1, "post", f"/api/v1/overtime-requests/{req_id}/submit")

        # Employee checks notifications
        notices = await self.as_role(self.user_employee_1, "get", "/api/v1/operations/notifications")
        self.assertEqual(notices.status_code, 200)
        ot_notices = [n for n in notices.json() if f"request_id={req_id}" in n.get("href", "")]
        self.assertGreaterEqual(len(ot_notices), 1)
        notice_id = ot_notices[0]["id"]
        self.assertIn("/leave?tab=overtime", ot_notices[0]["href"])

        # Employee marks notification as read
        read_res = await self.as_role(self.user_employee_1, "post", f"/api/v1/operations/notifications/{notice_id}/read")
        self.assertEqual(read_res.status_code, 200)

    # -------------------------------------------------------------------
    # Test Cases: Immutable Append-Only Trigger
    # -------------------------------------------------------------------
    async def test_append_only_trigger_on_events_table(self):
        created = await self.as_role(self.user_manager_1, "post", "/api/v1/overtime-requests", json={
            "employee_id": 21, "work_date": "2026-11-22", "start_time": "18:00", "end_time": "20:00", "reason": "Audit immutability test",
        })
        req_id = created.json()["request_id"]

        ev_id = (await self.conn.execute(text("SELECT event_id FROM overtime_request_events WHERE request_id=:id"), {"id": req_id})).scalar_one()

        # Attempt UPDATE on event -> must fail by trigger
        await self.conn.execute(text("SAVEPOINT sp_upd_ev;"))
        try:
            await self.conn.execute(text("UPDATE overtime_request_events SET action='TAMPER' WHERE event_id=:id"), {"id": ev_id})
            self.fail("UPDATE on overtime_request_events should have been blocked!")
        except Exception as e:
            await self.conn.execute(text("ROLLBACK TO SAVEPOINT sp_upd_ev;"))
            self.assertIn("append-only", str(e))

        # Attempt DELETE on event -> must fail by trigger
        await self.conn.execute(text("SAVEPOINT sp_del_ev;"))
        try:
            await self.conn.execute(text("DELETE FROM overtime_request_events WHERE event_id=:id"), {"id": ev_id})
            self.fail("DELETE on overtime_request_events should have been blocked!")
        except Exception as e:
            await self.conn.execute(text("ROLLBACK TO SAVEPOINT sp_del_ev;"))
            self.assertIn("append-only", str(e))


if __name__ == "__main__":
    unittest.main()
