"""OT request migration and API integration tests using rollback-scoped PostgreSQL tables."""
import asyncio
import unittest
from uuid import uuid4
from datetime import date, time, timedelta
from pathlib import Path

from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient, ReadError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.v1.endpoints import operations
from app.api.v1.endpoints import overtime_requests
from app.core.database import engine, get_db
from app.core.config import settings
from app.core.overtime_requests import VIETNAM_TZ, local_interval, require_transition


class _SchemaGuardResult:
    def __init__(self, row):
        self.row = row

    def mappings(self):
        return self

    def one(self):
        return self.row


class _SchemaGuardDatabase:
    def __init__(self, row):
        self.row = row

    async def execute(self, _statement):
        return _SchemaGuardResult(self.row)


class OvertimeSchemaGuardTests(unittest.IsolatedAsyncioTestCase):
    async def test_missing_ot_relations_return_actionable_503(self):
        from fastapi import HTTPException

        db = _SchemaGuardDatabase({"requests": None, "events": None})
        with self.assertRaises(HTTPException) as raised:
            await overtime_requests._require_overtime_schema(db)

        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(raised.exception.detail["code"], "OT_SCHEMA_NOT_INSTALLED")
        self.assertEqual(raised.exception.detail["missing_relations"], ["overtime_requests", "overtime_request_events"])

    async def test_installed_ot_relations_pass_schema_guard(self):
        db = _SchemaGuardDatabase({"requests": "overtime_requests", "events": "overtime_request_events"})
        await overtime_requests._require_overtime_schema(db)

    async def test_employee_create_returns_actionable_503_when_schema_is_missing(self):
        db = _SchemaGuardDatabase({"requests": None, "events": None})
        app = FastAPI()
        app.include_router(overtime_requests.router, prefix="/overtime-requests")

        async def test_db():
            yield db

        async def test_user():
            return {"user_id": 7, "employee_id": 21, "store_id": 1, "roles": ["EMPLOYEE"]}

        app.dependency_overrides[get_db] = test_db
        app.dependency_overrides[get_current_user] = test_user
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/overtime-requests", json={
                "work_date": "2026-10-25", "start_time": "18:00", "end_time": "20:00",
                "reason": "Inventory preparation",
            })

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"]["code"], "OT_SCHEMA_NOT_INSTALLED")


class OvertimeTimeRules(unittest.TestCase):
    def test_overnight_is_vietnam_aware_and_end_is_next_day(self):
        start, end = local_interval(date(2026, 10, 20), time(22), time(2))
        self.assertEqual(start.tzinfo, VIETNAM_TZ)
        self.assertEqual(start.isoformat(), "2026-10-20T22:00:00+07:00")
        self.assertEqual(end.isoformat(), "2026-10-21T02:00:00+07:00")

    def test_equal_times_and_offset_times_are_rejected(self):
        from fastapi import HTTPException
        with self.assertRaises(HTTPException):
            local_interval(date(2026, 10, 20), time(8), time(8))
        with self.assertRaises(HTTPException):
            local_interval(date(2026, 10, 20), time.fromisoformat("08:00+07:00"), time(9))

    def test_state_machine_rejects_skipping_employee_confirmation(self):
        from fastapi import HTTPException
        require_transition("PENDING_HR", {"PENDING_HR"}, "approve")
        with self.assertRaises(HTTPException):
            require_transition("DRAFT", {"PENDING_HR"}, "approve")


class OvertimeRequestPostgresTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.conn = await engine.connect()
        self.tx = await self.conn.begin()
        self.user = {"user_id": 2, "employee_id": 20, "store_id": 1, "roles": ["STORE_MANAGER"]}
        for ddl in [
            "CREATE TEMP TABLE users(user_id integer PRIMARY KEY,username text) ON COMMIT DROP",
            "CREATE TEMP TABLE stores(store_id integer PRIMARY KEY,store_name text,is_active boolean) ON COMMIT DROP",
            "CREATE TEMP TABLE employees(employee_id integer PRIMARY KEY,employee_code text,full_name text,store_id integer,employment_status text) ON COMMIT DROP",
            "CREATE TEMP TABLE work_shifts(shift_id integer PRIMARY KEY,shift_name text,start_time time,end_time time,work_hours numeric,is_active boolean) ON COMMIT DROP",
            "CREATE TEMP TABLE work_schedules(schedule_id integer PRIMARY KEY,employee_id integer,store_id integer,shift_id integer,work_date date,starts_at timestamptz,ends_at timestamptz,cancelled_at timestamptz) ON COMMIT DROP",
            "CREATE TEMP TABLE leave_requests(request_id integer PRIMARY KEY,employee_id integer,start_date date,end_date date,status text,updated_at timestamptz DEFAULT now()) ON COMMIT DROP",
            "CREATE TEMP TABLE attendances(attendance_id integer PRIMARY KEY,employee_id integer,check_in_time timestamptz,check_out_time timestamptz,late_minutes integer) ON COMMIT DROP",
            "CREATE TEMP TABLE notification_reads(user_id integer,notice_id text,PRIMARY KEY(user_id,notice_id)) ON COMMIT DROP",
        ]:
            await self.conn.execute(text(ddl))
        migration = Path(__file__).parent / "migrations" / "20261017_overtime_requests.sql"
        # Shadow migrated tables as TEMP so this test cannot change shared Supabase schema.
        sql = migration.read_text(encoding="utf-8").replace(
            "CREATE TABLE IF NOT EXISTS ", "CREATE TEMP TABLE IF NOT EXISTS ")
        for statement in (part.strip() for part in sql.split(";")):
            if statement:
                await self.conn.execute(text(statement))
        notes_migration = Path(__file__).parent / "migrations" / "20261018_overtime_request_notes.sql"
        notes_sql = notes_migration.read_text(encoding="utf-8")
        for statement in (part.strip() for part in notes_sql.split(";")):
            if statement:
                await self.conn.execute(text(statement))
        lifecycle_migration = Path(__file__).parent / "migrations" / "20261019_overtime_lifecycle.sql"
        lifecycle_sql = lifecycle_migration.read_text(encoding="utf-8")
        for statement in (part.strip() for part in lifecycle_sql.split(";")):
            if statement:
                await self.conn.execute(text(statement))
        for statement in (part.strip() for part in lifecycle_sql.split(";")):
            if statement:
                await self.conn.execute(text(statement))
        # Applying the additive migration again must be safe.
        for statement in (part.strip() for part in notes_sql.split(";")):
            if statement:
                await self.conn.execute(text(statement))
        # Reapplying the base migration must also remain safe.
        for statement in (part.strip() for part in sql.split(";")):
            if statement:
                await self.conn.execute(text(statement))
        await self.conn.execute(text("INSERT INTO users VALUES (1,'admin'),(2,'manager'),(3,'employee'),(4,'hr'),(5,'outsider')"))
        await self.conn.execute(text("INSERT INTO stores VALUES (1,'Branch One',true),(2,'Branch Two',true)"))
        await self.conn.execute(text("""INSERT INTO employees VALUES
            (20,'M-20','Store Manager',1,'ACTIVE'),(21,'E-21','Employee One',1,'ACTIVE'),
            (22,'H-22','HR Manager',1,'ACTIVE'),(30,'E-30','Employee Two',2,'ACTIVE'),
            (99,'A-99','Admin Profile',1,'ACTIVE')"""))
        await self.conn.execute(text("INSERT INTO work_shifts VALUES (8,'Shift A','09:00','17:00',8,true)"))
        await self.conn.execute(text("""INSERT INTO work_schedules VALUES
            (1,21,1,8,'2026-10-21','2026-10-21 09:00+07','2026-10-21 17:00+07',NULL)"""))
        await self.conn.execute(text("INSERT INTO leave_requests(request_id,employee_id,start_date,end_date,status) VALUES (1,21,'2026-10-24','2026-10-24','PENDING')"))
        self.db = AsyncSession(bind=self.conn, join_transaction_mode="create_savepoint", expire_on_commit=False)
        self.app = FastAPI()
        self.app.include_router(overtime_requests.router, prefix="/overtime-requests")
        self.app.include_router(operations.router, prefix="/operations")
        async def test_db():
            yield self.db
        async def test_user():
            return self.user
        self.app.dependency_overrides[get_db] = test_db
        self.app.dependency_overrides[get_current_user] = test_user
        self.client = AsyncClient(transport=ASGITransport(app=self.app), base_url="http://test")

    async def asyncTearDown(self):
        await self.client.aclose()
        await self.db.close()
        await self.tx.rollback()
        await self.conn.close()
        await engine.dispose()

    async def as_user(self, user, method, url, **kwargs):
        self.user = user
        return await getattr(self.client, method)(url, **kwargs)

    @staticmethod
    def payload(day="2026-10-20", start="18:00", end="20:00", employee_id=21, reason="Customer launch support"):
        return {"employee_id": employee_id, "work_date": day, "start_time": start,
                "end_time": end, "reason": reason, "notes": "Coverage for evening delivery"}

    async def test_role_state_machine_validation_audit_and_idempotency(self):
        manager = {"user_id": 2, "employee_id": 20, "store_id": 1, "roles": ["STORE_MANAGER"]}
        employee = {"user_id": 3, "employee_id": 21, "store_id": 1, "roles": ["EMPLOYEE"]}
        hr = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}
        admin_hr = {"user_id": 1, "employee_id": 99, "store_id": 1, "roles": ["ADMIN", "HR_MANAGER"]}

        hr_self_request = await self.as_user(hr, "post", "/overtime-requests", json=self.payload(employee_id=22))
        self.assertEqual(hr_self_request.status_code, 403)
        denied_self = await self.as_user(manager, "post", "/overtime-requests", json=self.payload(employee_id=20))
        self.assertEqual(denied_self.status_code, 403)
        denied_other_store = await self.as_user(manager, "post", "/overtime-requests", json=self.payload(employee_id=30))
        self.assertEqual(denied_other_store.status_code, 403)

        created = await self.as_user(manager, "post", "/overtime-requests", json=self.payload(), headers={"Idempotency-Key": "manager-ot-0001"})
        self.assertEqual(created.status_code, 201, created.text)
        request_id = created.json()["request_id"]
        self.assertEqual(created.json()["notes"], "Coverage for evening delivery")
        retry = await self.as_user(manager, "post", "/overtime-requests", json=self.payload(), headers={"Idempotency-Key": "manager-ot-0001"})
        self.assertEqual(retry.status_code, 201)
        self.assertEqual(retry.json()["request_id"], request_id)
        self.assertEqual((await self.db.execute(text("SELECT count(*) FROM overtime_request_events WHERE request_id=:id"), {"id": request_id})).scalar_one(), 1)
        self.assertEqual((await self.as_user(employee, "patch", f"/overtime-requests/{request_id}", json={"reason": "Employee cannot edit another user's proposal"})).status_code, 403)
        edited = await self.as_user(manager, "patch", f"/overtime-requests/{request_id}", json={"reason": "Updated customer launch coverage", "notes": "Updated coverage details"})
        self.assertEqual(edited.status_code, 200, edited.text)
        # The same idempotency payload still resolves to the original request after an allowed draft edit.
        retry_after_edit = await self.as_user(manager, "post", "/overtime-requests", json=self.payload(), headers={"Idempotency-Key": "manager-ot-0001"})
        self.assertEqual(retry_after_edit.json()["request_id"], request_id)
        self.assertEqual(retry_after_edit.json()["reason"], "Updated customer launch coverage")
        self.assertEqual(retry_after_edit.json()["notes"], "Updated coverage details")
        self.assertEqual((await self.db.execute(text("SELECT count(*) FROM overtime_request_events WHERE request_id=:id"), {"id": request_id})).scalar_one(), 2)

        submitted = await self.as_user(manager, "post", f"/overtime-requests/{request_id}/submit")
        self.assertEqual(submitted.json()["status"], "PENDING_EMPLOYEE_CONFIRMATION")
        hidden_from_other = await self.as_user({"user_id": 5, "employee_id": 30, "store_id": 2, "roles": ["EMPLOYEE"]}, "get", f"/overtime-requests/{request_id}")
        self.assertEqual(hidden_from_other.status_code, 404)
        confirmed = await self.as_user(employee, "post", f"/overtime-requests/{request_id}/employee-confirm")
        self.assertEqual(confirmed.json()["status"], "PENDING_HR")
        self.assertEqual((await self.as_user(manager, "post", f"/overtime-requests/{request_id}/approve")).status_code, 403)
        approved = await self.as_user(hr, "post", f"/overtime-requests/{request_id}/approve")
        self.assertEqual(approved.json()["status"], "APPROVED")
        events_before_retry = (await self.db.execute(text("SELECT count(*) FROM overtime_request_events WHERE request_id=:id"), {"id": request_id})).scalar_one()
        approved_retry = await self.as_user(hr, "post", f"/overtime-requests/{request_id}/approve")
        self.assertEqual(approved_retry.json()["status"], "APPROVED")
        self.assertEqual((await self.db.execute(text("SELECT count(*) FROM overtime_request_events WHERE request_id=:id"), {"id": request_id})).scalar_one(), events_before_retry)

        # A request creator cannot approve their own proposal, even when they hold both roles.
        own_created = await self.as_user(admin_hr, "post", "/overtime-requests", json=self.payload(day="2026-10-22"))
        self.assertEqual(own_created.status_code, 201)
        own_id = own_created.json()["request_id"]
        await self.as_user(admin_hr, "post", f"/overtime-requests/{own_id}/submit")
        await self.as_user(employee, "post", f"/overtime-requests/{own_id}/employee-confirm")
        self.assertEqual((await self.as_user(admin_hr, "post", f"/overtime-requests/{own_id}/approve")).status_code, 403)
        self.assertEqual((await self.as_user(hr, "post", f"/overtime-requests/{own_id}/approve")).json()["status"], "APPROVED")

        # Employee-created request goes straight to HR; rejection requires a reason and replay is harmless.
        self_payload = self.payload(day="2026-10-26", start="22:00", end="02:00", employee_id=None)
        own = await self.as_user(employee, "post", "/overtime-requests", json=self_payload)
        self.assertEqual(own.status_code, 201, own.text)
        self.assertEqual(own.json()["starts_at"], "2026-10-26T22:00:00+07:00")
        self.assertEqual(own.json()["ends_at"], "2026-10-27T02:00:00+07:00")
        own_id = own.json()["request_id"]
        submitted = await self.as_user(employee, "post", f"/overtime-requests/{own_id}/submit")
        self.assertEqual(submitted.json()["status"], "PENDING_HR")
        self.assertEqual((await self.as_user(hr, "post", f"/overtime-requests/{own_id}/reject", json={})).status_code, 422)
        rejected = await self.as_user(hr, "post", f"/overtime-requests/{own_id}/reject", json={"reason": "Budget not approved"})
        self.assertEqual(rejected.json()["status"], "REJECTED")
        event_count = (await self.db.execute(text("SELECT count(*) FROM overtime_request_events WHERE request_id=:id"), {"id": own_id})).scalar_one()
        await self.as_user(hr, "post", f"/overtime-requests/{own_id}/reject", json={"reason": "Changed reason"})
        self.assertEqual((await self.db.execute(text("SELECT count(*) FROM overtime_request_events WHERE request_id=:id"), {"id": own_id})).scalar_one(), event_count)

        manager_proposal = await self.as_user(manager, "post", "/overtime-requests", json=self.payload(day="2026-10-27"))
        declined_id = manager_proposal.json()["request_id"]
        await self.as_user(manager, "post", f"/overtime-requests/{declined_id}/submit")
        declined = await self.as_user(employee, "post", f"/overtime-requests/{declined_id}/employee-decline", json={"reason": "Cannot attend that date"})
        self.assertEqual(declined.json()["status"], "EMPLOYEE_DECLINED")

        transferred = await self.as_user(manager, "post", "/overtime-requests", json=self.payload(day="2026-10-30"))
        transferred_id = transferred.json()["request_id"]
        await self.as_user(manager, "post", f"/overtime-requests/{transferred_id}/submit")
        await self.db.execute(text("UPDATE employees SET store_id=2 WHERE employee_id=21"))
        self.assertEqual((await self.as_user(employee, "post", f"/overtime-requests/{transferred_id}/employee-confirm")).status_code, 409)
        await self.db.execute(text("UPDATE employees SET store_id=1 WHERE employee_id=21"))
        await self.as_user(employee, "post", f"/overtime-requests/{transferred_id}/cancel")

        # Same employee/time without the same idempotency key is a conflict; schedule and leave conflicts are blocked.
        conflict = await self.as_user(manager, "post", "/overtime-requests", json=self.payload())
        self.assertEqual(conflict.status_code, 409)
        schedule_conflict = await self.as_user(manager, "post", "/overtime-requests", json=self.payload(day="2026-10-21", start="16:00", end="18:00"))
        self.assertEqual(schedule_conflict.status_code, 409)
        leave_conflict = await self.as_user(manager, "post", "/overtime-requests", json=self.payload(day="2026-10-24"))
        self.assertEqual(leave_conflict.status_code, 409)

        # Reusing the key with different content is rejected; cancel is terminal and idempotent.
        different_payload = await self.as_user(manager, "post", "/overtime-requests", json=self.payload(day="2026-10-28"), headers={"Idempotency-Key": "manager-ot-0001"})
        self.assertEqual(different_payload.status_code, 409)
        draft = await self.as_user(employee, "post", "/overtime-requests", json=self.payload(day="2026-10-29", employee_id=None))
        draft_id = draft.json()["request_id"]
        cancelled = await self.as_user(employee, "post", f"/overtime-requests/{draft_id}/cancel")
        self.assertEqual(cancelled.json()["status"], "CANCELLED")
        count = (await self.db.execute(text("SELECT count(*) FROM overtime_request_events WHERE request_id=:id"), {"id": draft_id})).scalar_one()
        await self.as_user(employee, "post", f"/overtime-requests/{draft_id}/cancel")
        self.assertEqual((await self.db.execute(text("SELECT count(*) FROM overtime_request_events WHERE request_id=:id"), {"id": draft_id})).scalar_one(), count)

    async def test_in_app_notifications_follow_employee_confirmation_and_role_scope(self):
        manager = {"user_id": 2, "employee_id": 20, "store_id": 1, "roles": ["STORE_MANAGER"]}
        employee = {"user_id": 3, "employee_id": 21, "store_id": 1, "roles": ["EMPLOYEE"]}
        hr = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}
        created = await self.as_user(manager, "post", "/overtime-requests", json=self.payload(day="2026-11-02"))
        request_id = created.json()["request_id"]
        await self.as_user(manager, "post", f"/overtime-requests/{request_id}/submit")
        employee_notices = await self.as_user(employee, "get", "/operations/notifications")
        submit_event_id = (await self.db.execute(text("SELECT event_id FROM overtime_request_events WHERE request_id=:id AND action='SUBMIT'"), {"id": request_id})).scalar_one()
        employee_notice = next(item for item in employee_notices.json() if item["id"] == f"overtime-event-{submit_event_id}")
        self.assertEqual(employee_notice["href"], f"/leave?tab=overtime&request_id={request_id}")
        marked_read = await self.as_user(employee, "post", f"/operations/notifications/{employee_notice['id']}/read")
        self.assertEqual(marked_read.status_code, 200)
        await self.as_user(employee, "post", f"/overtime-requests/{request_id}/employee-confirm")
        hr_notices = await self.as_user(hr, "get", "/operations/notifications")
        confirm_event_id = (await self.db.execute(text("SELECT event_id FROM overtime_request_events WHERE request_id=:id AND action='EMPLOYEE_CONFIRM'"), {"id": request_id})).scalar_one()
        hr_notice = next(item for item in hr_notices.json() if item["id"] == f"overtime-event-{confirm_event_id}")
        self.assertEqual(hr_notice["href"], f"/leave?tab=overtime&request_id={request_id}")

        schedules_before_reject = (await self.db.execute(text("SELECT count(*) FROM work_schedules"))).scalar_one()
        rejected = await self.as_user(hr, "post", f"/overtime-requests/{request_id}/reject", json={"reason": "Operational coverage is not required"})
        self.assertEqual(rejected.json()["status"], "REJECTED")
        self.assertEqual((await self.db.execute(text("SELECT count(*) FROM work_schedules"))).scalar_one(), schedules_before_reject)
        reject_event_id = (await self.db.execute(text("SELECT event_id FROM overtime_request_events WHERE request_id=:id AND action='REJECT'"), {"id": request_id})).scalar_one()
        for recipient in (manager, employee):
            notices = await self.as_user(recipient, "get", "/operations/notifications")
            notice = next(item for item in notices.json() if item["id"] == f"overtime-event-{reject_event_id}")
            self.assertEqual(notice["href"], f"/leave?tab=overtime&request_id={request_id}")
        retry = await self.as_user(hr, "post", f"/overtime-requests/{request_id}/reject", json={"reason": "Retry"})
        self.assertEqual(retry.json()["status"], "REJECTED")
        self.assertEqual((await self.db.execute(text("SELECT count(*) FROM overtime_request_events WHERE request_id=:id AND action='REJECT'"), {"id": request_id})).scalar_one(), 1)

        declined_request = await self.as_user(manager, "post", "/overtime-requests", json=self.payload(day="2026-11-05"))
        declined_id = declined_request.json()["request_id"]
        await self.as_user(manager, "post", f"/overtime-requests/{declined_id}/submit")
        await self.as_user(employee, "post", f"/overtime-requests/{declined_id}/employee-decline", json={"reason": "Cannot attend"})
        self.assertEqual((await self.as_user(hr, "post", f"/overtime-requests/{declined_id}/approve")).status_code, 409)
        self.assertEqual((await self.db.execute(text("SELECT status FROM overtime_requests WHERE request_id=:id"), {"id": declined_id})).scalar_one(), "EMPLOYEE_DECLINED")
        declined_event_id = (await self.db.execute(text("SELECT event_id FROM overtime_request_events WHERE request_id=:id AND action='EMPLOYEE_DECLINE'"), {"id": declined_id})).scalar_one()
        manager_notices = await self.as_user(manager, "get", "/operations/notifications")
        self.assertTrue(any(item["id"] == f"overtime-event-{declined_event_id}" for item in manager_notices.json()))

        cancelled_request = await self.as_user(manager, "post", "/overtime-requests", json=self.payload(day="2026-11-06"))
        cancelled_id = cancelled_request.json()["request_id"]
        await self.as_user(manager, "post", f"/overtime-requests/{cancelled_id}/submit")
        await self.as_user(employee, "post", f"/overtime-requests/{cancelled_id}/cancel")
        cancel_event_id = (await self.db.execute(text("SELECT event_id FROM overtime_request_events WHERE request_id=:id AND action='CANCEL'"), {"id": cancelled_id})).scalar_one()
        manager_notices = await self.as_user(manager, "get", "/operations/notifications")
        self.assertTrue(any(item["id"] == f"overtime-event-{cancel_event_id}" for item in manager_notices.json()))

    async def test_approval_rechecks_schedule_and_approved_request_stays_linked_not_materialized(self):
        manager = {"user_id": 2, "employee_id": 20, "store_id": 1, "roles": ["STORE_MANAGER"]}
        employee = {"user_id": 3, "employee_id": 21, "store_id": 1, "roles": ["EMPLOYEE"]}
        hr = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}
        created = await self.as_user(manager, "post", "/overtime-requests", json=self.payload(day="2026-11-03"))
        request_id = created.json()["request_id"]
        await self.as_user(manager, "post", f"/overtime-requests/{request_id}/submit")
        await self.as_user(employee, "post", f"/overtime-requests/{request_id}/employee-confirm")
        detail = await self.as_user(hr, "get", f"/overtime-requests/{request_id}")
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertTrue(detail.json()["events"][-1]["actor_username"])
        self.assertEqual(detail.json()["approval_context"]["related_schedules"], [])
        self.assertEqual(detail.json()["approval_context"]["conflicts"], [])

        schedule_count = (await self.db.execute(text("SELECT count(*) FROM work_schedules"))).scalar_one()
        approved = await self.as_user(hr, "post", f"/overtime-requests/{request_id}/approve")
        self.assertEqual(approved.json()["status"], "APPROVED")
        listed = await self.as_user(hr, "get", "/overtime-requests", params={"date_from": "2026-11-03", "date_to": "2026-11-03", "status": "APPROVED"})
        self.assertEqual([item["request_id"] for item in listed.json()], [request_id])
        self.assertEqual((await self.db.execute(text("SELECT count(*) FROM work_schedules"))).scalar_one(), schedule_count)
        approve_event_id = (await self.db.execute(text("SELECT event_id FROM overtime_request_events WHERE request_id=:id AND action='APPROVE'"), {"id": request_id})).scalar_one()
        for recipient in (manager, employee):
            notices = await self.as_user(recipient, "get", "/operations/notifications")
            self.assertTrue(any(item["id"] == f"overtime-event-{approve_event_id}" for item in notices.json()))

        # An employee's own request goes directly to HR and approval remains separate from official shifts.
        employee_request = await self.as_user(employee, "post", "/overtime-requests", json=self.payload(day="2026-11-07", employee_id=None))
        employee_request_id = employee_request.json()["request_id"]
        submitted = await self.as_user(employee, "post", f"/overtime-requests/{employee_request_id}/submit")
        self.assertEqual(submitted.json()["status"], "PENDING_HR")
        schedule_count_before_employee_approval = (await self.db.execute(text("SELECT count(*) FROM work_schedules"))).scalar_one()
        employee_approved = await self.as_user(hr, "post", f"/overtime-requests/{employee_request_id}/approve")
        self.assertEqual(employee_approved.json()["status"], "APPROVED")
        self.assertEqual((await self.db.execute(text("SELECT count(*) FROM work_schedules"))).scalar_one(), schedule_count_before_employee_approval)
        self_approve_event = (await self.db.execute(text("SELECT event_id FROM overtime_request_events WHERE request_id=:id AND action='APPROVE'"), {"id": employee_request_id})).scalar_one()
        employee_notices = await self.as_user(employee, "get", "/operations/notifications")
        self.assertTrue(any(item["id"] == f"overtime-event-{self_approve_event}" for item in employee_notices.json()))

        second = await self.as_user(manager, "post", "/overtime-requests", json=self.payload(day="2026-11-04"))
        second_id = second.json()["request_id"]
        await self.as_user(manager, "post", f"/overtime-requests/{second_id}/submit")
        await self.as_user(employee, "post", f"/overtime-requests/{second_id}/employee-confirm")
        await self.db.execute(text("""INSERT INTO work_schedules(schedule_id,employee_id,store_id,shift_id,work_date,starts_at,ends_at,cancelled_at)
            VALUES (2,21,1,8,'2026-11-04','2026-11-04 18:00+07','2026-11-04 20:00+07',NULL)"""))
        conflict_detail = await self.as_user(hr, "get", f"/overtime-requests/{second_id}")
        self.assertEqual(len(conflict_detail.json()["approval_context"]["conflicts"]), 1)
        blocked = await self.as_user(hr, "post", f"/overtime-requests/{second_id}/approve")
        self.assertEqual(blocked.status_code, 409)


    async def test_admin_scope_and_review_permissions(self):
        manager = {"user_id": 2, "employee_id": 20, "store_id": 1, "roles": ["STORE_MANAGER"]}
        employee = {"user_id": 3, "employee_id": 21, "store_id": 1, "roles": ["EMPLOYEE"]}
        admin = {"user_id": 1, "employee_id": 99, "store_id": 1, "roles": ["ADMIN"]}

        manager_created = await self.as_user(manager, "post", "/overtime-requests", json=self.payload(day="2026-11-02"))
        self.assertEqual(manager_created.status_code, 201, manager_created.text)
        manager_id = manager_created.json()["request_id"]
        await self.as_user(manager, "post", f"/overtime-requests/{manager_id}/submit")
        await self.as_user(employee, "post", f"/overtime-requests/{manager_id}/employee-confirm")

        other_store_created = await self.as_user(admin, "post", "/overtime-requests", json=self.payload(day="2026-11-04", employee_id=30))
        self.assertEqual(other_store_created.status_code, 201, other_store_created.text)
        other_store_id = other_store_created.json()["request_id"]

        admin_list = await self.as_user(admin, "get", "/overtime-requests")
        self.assertEqual(admin_list.status_code, 200)
        self.assertEqual({row["request_id"] for row in admin_list.json()}, {manager_id, other_store_id})

        manager_list = await self.as_user(manager, "get", "/overtime-requests")
        self.assertEqual(manager_list.status_code, 200)
        self.assertEqual({row["request_id"] for row in manager_list.json()}, {manager_id})

        employee_list = await self.as_user(employee, "get", "/overtime-requests")
        self.assertEqual(employee_list.status_code, 200)
        self.assertEqual({row["request_id"] for row in employee_list.json()}, {manager_id})

        approved = await self.as_user(admin, "post", f"/overtime-requests/{manager_id}/approve")
        self.assertEqual(approved.status_code, 200, approved.text)
        self.assertEqual(approved.json()["status"], "APPROVED")

    async def test_list_search_and_api_pagination_preserve_rbac_scope(self):
        manager = {"user_id": 2, "employee_id": 20, "store_id": 1, "roles": ["STORE_MANAGER"]}
        employee = {"user_id": 3, "employee_id": 21, "store_id": 1, "roles": ["EMPLOYEE"]}
        admin = {"user_id": 1, "employee_id": 99, "store_id": 1, "roles": ["ADMIN"]}

        own_store = await self.as_user(manager, "post", "/overtime-requests", json=self.payload(
            day="2026-11-02", reason="Employee One evening delivery"))
        other_store = await self.as_user(admin, "post", "/overtime-requests", json=self.payload(
            day="2026-11-04", employee_id=30, reason="Employee Two inventory support"))
        self.assertEqual(own_store.status_code, 201, own_store.text)
        self.assertEqual(other_store.status_code, 201, other_store.text)
        own_id = own_store.json()["request_id"]
        other_id = other_store.json()["request_id"]

        first_page = await self.as_user(admin, "get",
            "/overtime-requests?date_from=2026-11-01&date_to=2026-11-30&limit=1&offset=0")
        second_page = await self.as_user(admin, "get",
            "/overtime-requests?date_from=2026-11-01&date_to=2026-11-30&limit=1&offset=1")
        self.assertEqual([row["request_id"] for row in first_page.json()], [other_id])
        self.assertEqual([row["request_id"] for row in second_page.json()], [own_id])

        hr_search = await self.as_user({"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]},
            "get", "/overtime-requests?date_from=2026-11-01&date_to=2026-11-30&q=Employee%20Two")
        self.assertEqual([row["request_id"] for row in hr_search.json()], [other_id])

        employee_search = await self.as_user(employee, "get",
            "/overtime-requests?date_from=2026-11-01&date_to=2026-11-30&q=Employee%20Two")
        self.assertEqual(employee_search.json(), [])
        employee_own_search = await self.as_user(employee, "get",
            "/overtime-requests?date_from=2026-11-01&date_to=2026-11-30&q=Employee%20One")
        self.assertEqual([row["request_id"] for row in employee_own_search.json()], [own_id])

    async def _approved_request(self, day="2026-11-10", creator=None, start="18:00", end="20:00"):
        manager = {"user_id": 2, "employee_id": 20, "store_id": 1, "roles": ["STORE_MANAGER"]}
        employee = {"user_id": 3, "employee_id": 21, "store_id": 1, "roles": ["EMPLOYEE"]}
        hr = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}
        creator = creator or manager
        created = await self.as_user(creator, "post", "/overtime-requests", json=self.payload(day=day, start=start, end=end))
        self.assertEqual(created.status_code, 201, created.text)
        request_id = created.json()["request_id"]
        submitted = await self.as_user(creator, "post", f"/overtime-requests/{request_id}/submit")
        self.assertIn(submitted.json()["status"], {"PENDING_EMPLOYEE_CONFIRMATION", "PENDING_HR"})
        if submitted.json()["status"] == "PENDING_EMPLOYEE_CONFIRMATION":
            confirmed = await self.as_user(employee, "post", f"/overtime-requests/{request_id}/employee-confirm")
            self.assertEqual(confirmed.json()["status"], "PENDING_HR")
        approved = await self.as_user(hr, "post", f"/overtime-requests/{request_id}/approve")
        self.assertEqual(approved.status_code, 200, approved.text)
        self.assertEqual(approved.json()["status"], "APPROVED")
        return request_id

    async def test_revoke_approval_reason_rbac_audit_notifications_and_attendance_guard(self):
        manager = {"user_id": 2, "employee_id": 20, "store_id": 1, "roles": ["STORE_MANAGER"]}
        employee = {"user_id": 3, "employee_id": 21, "store_id": 1, "roles": ["EMPLOYEE"]}
        hr = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}
        admin_hr = {"user_id": 1, "employee_id": 99, "store_id": 1, "roles": ["ADMIN", "HR_MANAGER"]}
        outsider = {"user_id": 5, "employee_id": 30, "store_id": 2, "roles": ["EMPLOYEE"]}

        request_id = await self._approved_request("2026-11-10", creator=admin_hr)
        missing_reason = await self.as_user(manager, "post", f"/overtime-requests/{request_id}/revoke-request", json={})
        self.assertEqual(missing_reason.status_code, 422)
        hidden = await self.as_user(outsider, "post", f"/overtime-requests/{request_id}/revoke-request", json={"reason": "Wrong store"})
        self.assertEqual(hidden.status_code, 404)

        requested = await self.as_user(admin_hr, "post", f"/overtime-requests/{request_id}/revoke-request", json={"reason": "Coverage no longer needed"})
        self.assertEqual(requested.status_code, 200, requested.text)
        self.assertEqual(requested.json()["status"], "APPROVED")
        revoke_detail = await self.as_user(employee, "get", f"/overtime-requests/{request_id}")
        self.assertTrue(revoke_detail.json()["lifecycle"]["revocation_pending"])
        retry = await self.as_user(admin_hr, "post", f"/overtime-requests/{request_id}/revoke-request", json={"reason": "Coverage no longer needed"})
        self.assertEqual(retry.status_code, 200)
        self.assertEqual((await self.db.execute(text("SELECT count(*) FROM overtime_request_events WHERE request_id=:id AND action='REVOKE_REQUEST'"), {"id": request_id})).scalar_one(), 1)

        self_approval = await self.as_user(admin_hr, "post", f"/overtime-requests/{request_id}/revoke-approve")
        self.assertEqual(self_approval.status_code, 403)
        approved = await self.as_user(hr, "post", f"/overtime-requests/{request_id}/revoke-approve")
        self.assertEqual(approved.status_code, 200, approved.text)
        self.assertEqual(approved.json()["status"], "REVOKED")
        events = (await self.db.execute(text("SELECT action,actor_id,reason FROM overtime_request_events WHERE request_id=:id ORDER BY event_id"), {"id": request_id})).mappings().all()
        self.assertEqual(sum(event["action"] == "REVOKE_APPROVE" for event in events), 1)
        self.assertEqual(events[-1]["actor_id"], hr["user_id"])
        self.assertEqual(events[-1]["reason"], "Coverage no longer needed")
        for recipient in (employee, manager):
            notices = await self.as_user(recipient, "get", "/operations/notifications")
            self.assertTrue(any(item["href"] == f"/leave?tab=overtime&request_id={request_id}" for item in notices.json()))

        blocked_id = await self._approved_request("2026-11-11")
        await self.db.execute(text("INSERT INTO attendances(attendance_id,employee_id,check_in_time,check_out_time,late_minutes) VALUES(900,21,'2026-11-11 18:15+07'::timestamptz,'2026-11-11 19:00+07'::timestamptz,0)"))
        blocked = await self.as_user(manager, "post", f"/overtime-requests/{blocked_id}/revoke-request", json={"reason": "Cancel after attendance"})
        self.assertEqual(blocked.status_code, 409)
        self.assertEqual(blocked.json()["detail"]["code"], "OVERTIME_ATTENDANCE_REVIEW_REQUIRED")
        self.assertEqual((await self.db.execute(text("SELECT status FROM overtime_requests WHERE request_id=:id"), {"id": blocked_id})).scalar_one(), "APPROVED")
        blocked_amendment = await self.as_user(employee, "post", f"/overtime-requests/{blocked_id}/amend", json={
            "work_date": "2026-11-12", "start_time": "21:00", "end_time": "23:00", "reason": "Change after attendance",
        })
        self.assertEqual(blocked_amendment.status_code, 409)
        self.assertEqual(blocked_amendment.json()["detail"]["code"], "OVERTIME_ATTENDANCE_REVIEW_REQUIRED")

        target_attendance_parent = await self._approved_request("2026-11-19")
        await self.db.execute(text("INSERT INTO attendances(attendance_id,employee_id,check_in_time,check_out_time,late_minutes) VALUES(901,21,'2026-11-20 21:15+07'::timestamptz,'2026-11-20 22:00+07'::timestamptz,0)"))
        target_attendance_amendment = await self.as_user(employee, "post", f"/overtime-requests/{target_attendance_parent}/amend", json={
            "work_date": "2026-11-20", "start_time": "21:00", "end_time": "23:00", "reason": "Change overlaps an attendance session",
        })
        self.assertEqual(target_attendance_amendment.status_code, 409)
        self.assertEqual(target_attendance_amendment.json()["detail"]["code"], "OVERTIME_ATTENDANCE_REVIEW_REQUIRED")

        rejected_revoke_id = await self._approved_request("2026-11-13")
        pending_revoke = await self.as_user(employee, "post", f"/overtime-requests/{rejected_revoke_id}/revoke-request", json={"reason": "Schedule now unnecessary"})
        self.assertEqual(pending_revoke.status_code, 200)
        rejected_revoke = await self.as_user(hr, "post", f"/overtime-requests/{rejected_revoke_id}/revoke-reject", json={"reason": "Coverage remains required"})
        self.assertEqual(rejected_revoke.status_code, 200, rejected_revoke.text)
        self.assertEqual(rejected_revoke.json()["status"], "APPROVED")
        self.assertEqual(rejected_revoke.json()["revoke_decision"], "REJECTED")

    async def test_amendment_approval_rejection_on_behalf_overnight_and_history(self):
        manager = {"user_id": 2, "employee_id": 20, "store_id": 1, "roles": ["STORE_MANAGER"]}
        employee = {"user_id": 3, "employee_id": 21, "store_id": 1, "roles": ["EMPLOYEE"]}
        hr = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}

        parent_id = await self._approved_request("2026-11-12")
        body = {"work_date": "2026-11-13", "start_time": "21:00", "end_time": "23:00", "reason": "Customer launch moved"}
        first_proposal = await self.as_user(employee, "post", f"/overtime-requests/{parent_id}/amend", json=body)
        retry_proposal = await self.as_user(employee, "post", f"/overtime-requests/{parent_id}/amend", json=body)
        self.assertEqual(first_proposal.status_code, 201, first_proposal.text)
        self.assertEqual(retry_proposal.status_code, 201, retry_proposal.text)
        child_id = first_proposal.json()["request_id"]
        self.assertEqual(retry_proposal.json()["request_id"], child_id)
        self.assertEqual(first_proposal.json()["status"], "PENDING_HR")
        blocked_revoke = await self.as_user(employee, "post", f"/overtime-requests/{parent_id}/revoke-request", json={"reason": "Cannot revoke while amendment is pending"})
        self.assertEqual(blocked_revoke.status_code, 409)
        self.assertEqual(blocked_revoke.json()["detail"]["code"], "OVERTIME_AMENDMENT_PENDING")
        self.assertEqual((await self.db.execute(text("SELECT count(*) FROM overtime_request_events WHERE request_id=:id AND action='AMEND_REQUEST'"), {"id": child_id})).scalar_one(), 1)
        wrong_approval_path = await self.as_user(hr, "post", f"/overtime-requests/{child_id}/approve")
        self.assertEqual(wrong_approval_path.status_code, 409)
        approved_child = await self.as_user(hr, "post", f"/overtime-requests/{child_id}/amend-approve")
        self.assertEqual(approved_child.status_code, 200, approved_child.text)
        self.assertEqual(approved_child.json()["status"], "APPROVED")
        parent = await self.as_user(hr, "get", f"/overtime-requests/{parent_id}")
        self.assertEqual(parent.json()["status"], "REPLACED")
        self.assertEqual(parent.json()["replaced_by_request_id"], child_id)
        active = (await self.db.execute(text("SELECT count(*) FROM overtime_requests WHERE request_id IN (:parent,:child) AND status='APPROVED'"), {"parent": parent_id, "child": child_id})).scalar_one()
        self.assertEqual(active, 1)
        self.assertIn(child_id, {item["request_id"] for item in parent.json()["related_requests"]})

        rejected_parent_id = await self._approved_request("2026-11-14")
        rejected_proposal = await self.as_user(manager, "post", f"/overtime-requests/{rejected_parent_id}/amend", json={
            "work_date": "2026-11-15", "start_time": "22:00", "end_time": "02:00", "reason": "Overnight replacement request",
        })
        self.assertEqual(rejected_proposal.status_code, 201, rejected_proposal.text)
        rejected_child_id = rejected_proposal.json()["request_id"]
        self.assertEqual(rejected_proposal.json()["status"], "PENDING_EMPLOYEE_CONFIRMATION")
        premature = await self.as_user(hr, "post", f"/overtime-requests/{rejected_child_id}/amend-approve")
        self.assertEqual(premature.status_code, 409)
        confirmed = await self.as_user(employee, "post", f"/overtime-requests/{rejected_child_id}/employee-confirm")
        self.assertEqual(confirmed.json()["status"], "PENDING_HR")
        self.assertTrue(confirmed.json()["ends_at"].startswith("2026-11-16T02:00:00+07:00"))
        rejected = await self.as_user(hr, "post", f"/overtime-requests/{rejected_child_id}/reject", json={"reason": "Insufficient staffing evidence"})
        self.assertEqual(rejected.json()["status"], "REJECTED")
        original = await self.as_user(hr, "get", f"/overtime-requests/{rejected_parent_id}")
        self.assertEqual(original.json()["status"], "APPROVED")
        self.assertIsNone(original.json()["replaced_by_request_id"])

        admin_creator = {"user_id": 1, "employee_id": 99, "store_id": 1, "roles": ["ADMIN"]}
        self_approval_parent = await self._approved_request("2026-11-16", creator=admin_creator)
        self_approval_child = await self.as_user(admin_creator, "post", f"/overtime-requests/{self_approval_parent}/amend", json={
            "work_date": "2026-11-17", "start_time": "21:00", "end_time": "23:00", "reason": "Admin-requested amendment",
        })
        self_approval_child_id = self_approval_child.json()["request_id"]
        await self.as_user(employee, "post", f"/overtime-requests/{self_approval_child_id}/employee-confirm")
        self_approval_blocked = await self.as_user(admin_creator, "post", f"/overtime-requests/{self_approval_child_id}/amend-approve")
        self.assertEqual(self_approval_blocked.status_code, 403)
        approved_by_other_hr = await self.as_user(hr, "post", f"/overtime-requests/{self_approval_child_id}/amend-approve")
        self.assertEqual(approved_by_other_hr.status_code, 200)

    async def test_overdue_requests_are_visible_and_never_auto_approved(self):
        manager = {"user_id": 2, "employee_id": 20, "store_id": 1, "roles": ["STORE_MANAGER"]}
        employee = {"user_id": 3, "employee_id": 21, "store_id": 1, "roles": ["EMPLOYEE"]}
        hr = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}
        created = await self.as_user(manager, "post", "/overtime-requests", json=self.payload(day="2026-11-17"))
        request_id = created.json()["request_id"]
        await self.as_user(manager, "post", f"/overtime-requests/{request_id}/submit")
        await self.as_user(employee, "post", f"/overtime-requests/{request_id}/employee-confirm")
        await self.db.execute(text("UPDATE overtime_requests SET starts_at=clock_timestamp()-interval '1 hour',ends_at=clock_timestamp()+interval '1 hour' WHERE request_id=:id"), {"id": request_id})
        detail = await self.as_user(hr, "get", f"/overtime-requests/{request_id}")
        self.assertTrue(detail.json()["is_overdue"])
        self.assertEqual(detail.json()["overdue_state"], "PENDING_HR_OVERDUE")
        rejected_auto = await self.as_user(hr, "post", f"/overtime-requests/{request_id}/approve")
        self.assertEqual(rejected_auto.status_code, 409)
        self.assertEqual(rejected_auto.json()["detail"]["code"], "OVERTIME_EXCEPTION_REVIEW_REQUIRED")
        yesterday = (date.today() - timedelta(days=1)).isoformat()
        retroactive = await self.as_user(employee, "post", "/overtime-requests", json=self.payload(day=yesterday, employee_id=None))
        self.assertEqual(retroactive.status_code, 409)
        self.assertEqual(retroactive.json()["detail"]["code"], "OVERTIME_EXCEPTION_REVIEW_REQUIRED")

        pending_employee = await self.as_user(manager, "post", "/overtime-requests", json=self.payload(day="2026-11-18"))
        pending_employee_id = pending_employee.json()["request_id"]
        await self.as_user(manager, "post", f"/overtime-requests/{pending_employee_id}/submit")
        await self.db.execute(text("UPDATE overtime_requests SET starts_at=clock_timestamp()-interval '1 hour',ends_at=clock_timestamp()+interval '1 hour' WHERE request_id=:id"), {"id": pending_employee_id})
        warning = await self.as_user(employee, "get", f"/overtime-requests/{pending_employee_id}")
        self.assertEqual(warning.json()["overdue_state"], "PENDING_EMPLOYEE_CONFIRMATION_OVERDUE")
        late_confirmation = await self.as_user(employee, "post", f"/overtime-requests/{pending_employee_id}/employee-confirm")
        self.assertEqual(late_confirmation.status_code, 409)


@unittest.skipUnless(__import__("sqlalchemy").engine.make_url(settings.DATABASE_URL).host in {"127.0.0.1", "localhost"},
                     "True multi-connection race test runs only against an explicitly local test PostgreSQL")
class OvertimeConcurrentCreateTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.schema = "ot_test_" + uuid4().hex
        migration = (Path(__file__).parent / "migrations" / "20261017_overtime_requests.sql").read_text(encoding="utf-8")
        async with engine.begin() as conn:
            await conn.execute(text(f'CREATE SCHEMA "{self.schema}"'))
            await conn.execute(text(f'SET LOCAL search_path TO "{self.schema}",public'))
            for ddl in [
                "CREATE TABLE users(user_id integer PRIMARY KEY,username text)",
                "CREATE TABLE stores(store_id integer PRIMARY KEY,store_name text,is_active boolean)",
                "CREATE TABLE employees(employee_id integer PRIMARY KEY,employee_code text,full_name text,store_id integer,employment_status text)",
                "CREATE TABLE work_shifts(shift_id integer PRIMARY KEY,shift_name text,start_time time,end_time time,work_hours numeric,is_active boolean)",
                "CREATE TABLE work_schedules(schedule_id integer PRIMARY KEY,employee_id integer,store_id integer,shift_id integer,work_date date,starts_at timestamptz,ends_at timestamptz,cancelled_at timestamptz)",
                "CREATE TABLE leave_requests(request_id integer PRIMARY KEY,employee_id integer,start_date date,end_date date,total_days numeric,status text,updated_at timestamptz DEFAULT now())",
                "CREATE TABLE attendances(attendance_id integer PRIMARY KEY,employee_id integer,check_in_time timestamptz,check_out_time timestamptz,late_minutes integer)",
                "CREATE TABLE notification_reads(user_id integer,notice_id text,PRIMARY KEY(user_id,notice_id))",
            ]:
                await conn.execute(text(ddl))
            for statement in (part.strip() for part in migration.split(";")):
                if statement:
                    await conn.execute(text(statement))
            notes_migration = (Path(__file__).parent / "migrations" / "20261018_overtime_request_notes.sql").read_text(encoding="utf-8")
            for statement in (part.strip() for part in notes_migration.split(";")):
                if statement:
                    await conn.execute(text(statement))
            lifecycle_migration = (Path(__file__).parent / "migrations" / "20261019_overtime_lifecycle.sql").read_text(encoding="utf-8")
            for statement in (part.strip() for part in lifecycle_migration.split(";")):
                if statement:
                    await conn.execute(text(statement))
            await conn.execute(text("INSERT INTO users VALUES (2,'manager'),(3,'employee'),(4,'hr_one'),(5,'other_employee'),(6,'hr_two'),(7,'other_manager')"))
            await conn.execute(text("INSERT INTO stores VALUES (1,'Local Branch',true),(2,'Other Branch',true)"))
            await conn.execute(text("INSERT INTO employees VALUES (20,'M-20','Store Manager',1,'ACTIVE'),(21,'E-21','Employee One',1,'ACTIVE'),(22,'H-22','HR Manager One',1,'ACTIVE'),(23,'H-23','HR Manager Two',1,'ACTIVE'),(30,'E-30','Other Branch Employee',2,'ACTIVE'),(31,'M-31','Other Branch Manager',2,'ACTIVE')"))
            await conn.execute(text("INSERT INTO work_shifts VALUES (8,'Shift A','09:00','17:00',8,true)"))
        self.app = FastAPI()
        self.app.include_router(overtime_requests.router, prefix="/overtime-requests")
        self.app.include_router(operations.router, prefix="/operations")
        self.user = {"user_id": 2, "employee_id": 20, "store_id": 1, "roles": ["STORE_MANAGER"]}
        self.test_users = {
            2: self.user,
            3: {"user_id": 3, "employee_id": 21, "store_id": 1, "roles": ["EMPLOYEE"]},
            4: {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]},
            5: {"user_id": 5, "employee_id": 30, "store_id": 2, "roles": ["EMPLOYEE"]},
            6: {"user_id": 6, "employee_id": 23, "store_id": 1, "roles": ["HR_MANAGER"]},
            7: {"user_id": 7, "employee_id": 31, "store_id": 2, "roles": ["STORE_MANAGER"]},
        }
        async def test_db():
            async with AsyncSession(engine, expire_on_commit=False) as session:
                await session.execute(text(f'SET search_path TO "{self.schema}",public'))
                yield session
        async def test_user(request: Request):
            user_id = request.headers.get("X-Test-User-ID")
            return self.test_users.get(int(user_id), self.user) if user_id else self.user
        self.app.dependency_overrides[get_db] = test_db
        self.app.dependency_overrides[get_current_user] = test_user
        self.client = AsyncClient(transport=ASGITransport(app=self.app), base_url="http://test")

    async def asyncTearDown(self):
        await self.client.aclose()
        async with engine.begin() as conn:
            await conn.execute(text(f'DROP SCHEMA IF EXISTS "{self.schema}" CASCADE'))
        await engine.dispose()

    async def as_concurrent_user(self, user, method, url, **kwargs):
        headers = dict(kwargs.pop("headers", {}))
        headers["X-Test-User-ID"] = str(user["user_id"])
        return await getattr(self.client, method)(url, headers=headers, **kwargs)

    async def test_concurrent_overlapping_create_serializes_on_employee(self):
        payload = {"employee_id": 21, "work_date": "2026-10-20", "start_time": "18:00",
                   "end_time": "20:00", "reason": "Concurrent overtime proposal"}
        responses = await asyncio.gather(
            self.client.post("/overtime-requests", json=payload, headers={"Idempotency-Key": "concurrent-ot-a"}),
            self.client.post("/overtime-requests", json=payload, headers={"Idempotency-Key": "concurrent-ot-b"}),
        )
        self.assertEqual(sorted(response.status_code for response in responses), [201, 409])
        async with engine.connect() as conn:
            await conn.execute(text(f'SET search_path TO "{self.schema}",public'))
            count = (await conn.execute(text("SELECT count(*) FROM overtime_requests"))).scalar_one()
            self.assertEqual(count, 1)

    async def test_two_hr_approvals_for_one_request_create_one_transition(self):
        manager = {"user_id": 2, "employee_id": 20, "store_id": 1, "roles": ["STORE_MANAGER"]}
        employee = {"user_id": 3, "employee_id": 21, "store_id": 1, "roles": ["EMPLOYEE"]}
        hr_one = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}
        hr_two = {"user_id": 6, "employee_id": 23, "store_id": 1, "roles": ["HR_MANAGER"]}
        other_employee = self.test_users[5]
        other_manager = self.test_users[7]
        created = await self.as_concurrent_user(manager, "post", "/overtime-requests", json={
            "employee_id": 21, "work_date": "2026-10-20", "start_time": "18:00",
            "end_time": "20:00", "reason": "Concurrent HR approval coverage",
        })
        self.assertEqual(created.status_code, 201, created.text)
        request_id = created.json()["request_id"]
        await self.as_concurrent_user(manager, "post", f"/overtime-requests/{request_id}/submit")
        confirmed = await self.as_concurrent_user(employee, "post", f"/overtime-requests/{request_id}/employee-confirm")
        self.assertEqual(confirmed.json()["status"], "PENDING_HR")

        responses = await asyncio.gather(
            self.as_concurrent_user(hr_one, "post", f"/overtime-requests/{request_id}/approve"),
            self.as_concurrent_user(hr_two, "post", f"/overtime-requests/{request_id}/approve"),
        )
        self.assertEqual([response.status_code for response in responses], [200, 200])
        self.assertEqual({response.json()["status"] for response in responses}, {"APPROVED"})
        async with engine.connect() as conn:
            await conn.execute(text(f'SET search_path TO "{self.schema}",public'))
            approvals = (await conn.execute(text("SELECT count(*) FROM overtime_request_events WHERE request_id=:id AND action='APPROVE'"), {"id": request_id})).scalar_one()
            decisions = (await conn.execute(text("SELECT count(*) FROM overtime_requests WHERE request_id=:id AND status='APPROVED' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL"), {"id": request_id})).scalar_one()
            reviewer_id = (await conn.execute(text("SELECT reviewed_by FROM overtime_requests WHERE request_id=:id"), {"id": request_id})).scalar_one()
            actor_id = (await conn.execute(text("SELECT actor_id FROM overtime_request_events WHERE request_id=:id AND action='APPROVE'"), {"id": request_id})).scalar_one()
            schedules = (await conn.execute(text("SELECT count(*) FROM work_schedules"))).scalar_one()
        self.assertEqual(approvals, 1)
        self.assertEqual(decisions, 1)
        self.assertEqual(reviewer_id, actor_id)
        self.assertIn(actor_id, {hr_one["user_id"], hr_two["user_id"]})
        self.assertEqual(schedules, 0)

        async with engine.connect() as conn:
            await conn.execute(text(f'SET search_path TO "{self.schema}",public'))
            approve_event_id = (await conn.execute(text("SELECT event_id FROM overtime_request_events WHERE request_id=:id AND action='APPROVE'"), {"id": request_id})).scalar_one()
        expected_notice_id = f"overtime-event-{approve_event_id}"
        notice_roles = (employee, manager, hr_two if actor_id == hr_one["user_id"] else hr_one)
        for recipient in notice_roles:
            first_poll = await self.as_concurrent_user(recipient, "get", "/operations/notifications")
            second_poll = await self.as_concurrent_user(recipient, "get", "/operations/notifications")
            first_matches = [item for item in first_poll.json() if item["id"] == expected_notice_id]
            second_matches = [item for item in second_poll.json() if item["id"] == expected_notice_id]
            self.assertEqual(len(first_matches), 1)
            self.assertEqual(len(second_matches), 1)
            href = first_matches[0]["href"]
            self.assertEqual(href, f"/leave?tab=overtime&request_id={request_id}")
            detail = await self.as_concurrent_user(recipient, "get", f"/overtime-requests/{request_id}")
            self.assertEqual(detail.status_code, 200)
            self.assertEqual(detail.json()["request_id"], request_id)

        actor = hr_one if actor_id == hr_one["user_id"] else hr_two
        actor_notices = await self.as_concurrent_user(actor, "get", "/operations/notifications")
        self.assertFalse(any(item["id"] == expected_notice_id for item in actor_notices.json()))
        for outsider in (other_employee, other_manager):
            notices = await self.as_concurrent_user(outsider, "get", "/operations/notifications")
            self.assertFalse(any(item["id"] == expected_notice_id for item in notices.json()))
            hidden = await self.as_concurrent_user(outsider, "get", f"/overtime-requests/{request_id}")
            self.assertEqual(hidden.status_code, 404)

    async def test_concurrent_amendment_retry_approval_and_notification_deduplication(self):
        manager = self.test_users[2]
        employee = self.test_users[3]
        hr_one = self.test_users[4]
        hr_two = self.test_users[6]
        other_employee = self.test_users[5]
        original = await self.as_concurrent_user(manager, "post", "/overtime-requests", json={
            "employee_id": 21, "work_date": "2026-11-18", "start_time": "18:00",
            "end_time": "20:00", "reason": "Concurrent amendment original",
        })
        self.assertEqual(original.status_code, 201, original.text)
        parent_id = original.json()["request_id"]
        await self.as_concurrent_user(manager, "post", f"/overtime-requests/{parent_id}/submit")
        confirmed = await self.as_concurrent_user(employee, "post", f"/overtime-requests/{parent_id}/employee-confirm")
        self.assertEqual(confirmed.json()["status"], "PENDING_HR")
        original_approved = await self.as_concurrent_user(hr_one, "post", f"/overtime-requests/{parent_id}/approve")
        self.assertEqual(original_approved.json()["status"], "APPROVED")

        amendment_body = {"work_date": "2026-11-19", "start_time": "21:00", "end_time": "23:00",
                          "reason": "Concurrent replacement request"}
        proposals = await asyncio.gather(
            self.as_concurrent_user(employee, "post", f"/overtime-requests/{parent_id}/amend", json=amendment_body),
            self.as_concurrent_user(employee, "post", f"/overtime-requests/{parent_id}/amend", json=amendment_body),
        )
        self.assertEqual([response.status_code for response in proposals], [201, 201])
        child_id = proposals[0].json()["request_id"]
        self.assertEqual(proposals[1].json()["request_id"], child_id)
        self.assertEqual(proposals[0].json()["status"], "PENDING_HR")

        decisions = await asyncio.gather(
            self.as_concurrent_user(hr_one, "post", f"/overtime-requests/{child_id}/amend-approve"),
            self.as_concurrent_user(hr_two, "post", f"/overtime-requests/{child_id}/amend-approve"),
        )
        self.assertEqual([response.status_code for response in decisions], [200, 200])
        async with engine.connect() as conn:
            await conn.execute(text(f'SET search_path TO "{self.schema}",public'))
            approval_events = (await conn.execute(text("SELECT count(*) FROM overtime_request_events WHERE request_id=:id AND action='AMEND_APPROVE'"), {"id": child_id})).scalar_one()
            replacement_events = (await conn.execute(text("SELECT count(*) FROM overtime_request_events WHERE request_id=:id AND action='AMEND_REPLACE'"), {"id": parent_id})).scalar_one()
            active_count = (await conn.execute(text("SELECT count(*) FROM overtime_requests WHERE request_id IN (:parent,:child) AND status='APPROVED'"), {"parent": parent_id, "child": child_id})).scalar_one()
            actor_id = (await conn.execute(text("SELECT actor_id FROM overtime_request_events WHERE request_id=:id AND action='AMEND_APPROVE'"), {"id": child_id})).scalar_one()
            child_event_id = (await conn.execute(text("SELECT event_id FROM overtime_request_events WHERE request_id=:id AND action='AMEND_APPROVE'"), {"id": child_id})).scalar_one()
        self.assertEqual(approval_events, 1)
        self.assertEqual(replacement_events, 1)
        self.assertEqual(active_count, 1)
        self.assertIn(actor_id, {hr_one["user_id"], hr_two["user_id"]})
        other_hr = hr_two if actor_id == hr_one["user_id"] else hr_one
        for recipient in (manager, employee, other_hr):
            first = await self.as_concurrent_user(recipient, "get", "/operations/notifications")
            retry = await self.as_concurrent_user(recipient, "get", "/operations/notifications")
            notice_id = f"overtime-event-{child_event_id}"
            self.assertEqual(sum(item["id"] == notice_id for item in first.json()), 1)
            self.assertEqual(sum(item["id"] == notice_id for item in retry.json()), 1)
            matching_notice = next(item for item in first.json() if item["id"] == notice_id)
            self.assertEqual(matching_notice["href"], f"/leave?tab=overtime&request_id={child_id}")
            detail = await self.as_concurrent_user(recipient, "get", f"/overtime-requests/{child_id}")
            self.assertEqual(detail.status_code, 200)
        hidden_child = await self.as_concurrent_user(other_employee, "get", f"/overtime-requests/{child_id}")
        self.assertEqual(hidden_child.status_code, 404)

        revoke_original = await self.as_concurrent_user(manager, "post", "/overtime-requests", json={
            "employee_id": 21, "work_date": "2026-11-21", "start_time": "18:00",
            "end_time": "20:00", "reason": "Concurrent revocation original",
        })
        revoke_id = revoke_original.json()["request_id"]
        await self.as_concurrent_user(manager, "post", f"/overtime-requests/{revoke_id}/submit")
        await self.as_concurrent_user(employee, "post", f"/overtime-requests/{revoke_id}/employee-confirm")
        await self.as_concurrent_user(hr_one, "post", f"/overtime-requests/{revoke_id}/approve")
        revoke_request = await self.as_concurrent_user(manager, "post", f"/overtime-requests/{revoke_id}/revoke-request", json={"reason": "Concurrent coverage cancellation"})
        self.assertEqual(revoke_request.status_code, 200)
        revoke_decisions = await asyncio.gather(
            self.as_concurrent_user(hr_one, "post", f"/overtime-requests/{revoke_id}/revoke-approve"),
            self.as_concurrent_user(hr_two, "post", f"/overtime-requests/{revoke_id}/revoke-approve"),
        )
        self.assertEqual([response.status_code for response in revoke_decisions], [200, 200])
        async with engine.connect() as conn:
            await conn.execute(text(f'SET search_path TO "{self.schema}",public'))
            revoke_events = (await conn.execute(text("SELECT count(*) FROM overtime_request_events WHERE request_id=:id AND action='REVOKE_APPROVE'"), {"id": revoke_id})).scalar_one()
            revoked_status = (await conn.execute(text("SELECT status FROM overtime_requests WHERE request_id=:id"), {"id": revoke_id})).scalar_one()
            revoke_event_id = (await conn.execute(text("SELECT event_id FROM overtime_request_events WHERE request_id=:id AND action='REVOKE_APPROVE'"), {"id": revoke_id})).scalar_one()
            revoke_actor_id = (await conn.execute(text("SELECT actor_id FROM overtime_request_events WHERE request_id=:id AND action='REVOKE_APPROVE'"), {"id": revoke_id})).scalar_one()
        self.assertEqual(revoke_events, 1)
        self.assertEqual(revoked_status, "REVOKED")
        revoke_notice_id = f"overtime-event-{revoke_event_id}"
        revoke_other_hr = hr_two if revoke_actor_id == hr_one["user_id"] else hr_one
        for recipient in (manager, employee, revoke_other_hr):
            notices = await self.as_concurrent_user(recipient, "get", "/operations/notifications")
            matching = [item for item in notices.json() if item["id"] == revoke_notice_id]
            self.assertEqual(len(matching), 1)
            self.assertEqual(matching[0]["href"], f"/leave?tab=overtime&request_id={revoke_id}")

    async def test_create_retry_after_committed_request_response_is_lost(self):
        import httpx

        class DropFirstResponseTransport(ASGITransport):
            dropped = False

            async def handle_async_request(self, request):
                response = await super().handle_async_request(request)
                if not self.dropped:
                    self.dropped = True
                    raise ReadError("simulated connection loss after server commit", request=request)
                return response

        manager = self.test_users[2]
        transport = DropFirstResponseTransport(app=self.app)
        retry_client = AsyncClient(transport=transport, base_url="http://test")
        payload = {"employee_id": 21, "work_date": "2026-10-25", "start_time": "18:00",
                   "end_time": "20:00", "reason": "Retry after lost response"}
        headers = {"Idempotency-Key": "lost-response-recovery-01", "X-Test-User-ID": str(manager["user_id"])}
        try:
            with self.assertRaises(httpx.ReadError):
                await retry_client.post("/overtime-requests", json=payload, headers=headers)
        finally:
            await retry_client.aclose()

        async with engine.connect() as conn:
            await conn.execute(text(f'SET search_path TO "{self.schema}",public'))
            committed_id = (await conn.execute(text("SELECT request_id FROM overtime_requests WHERE created_by=:creator AND idempotency_key=:key"), {
                "creator": manager["user_id"], "key": headers["Idempotency-Key"],
            })).scalar_one()

        retry = await self.as_concurrent_user(manager, "post", "/overtime-requests", json=payload,
                                               headers={"Idempotency-Key": headers["Idempotency-Key"]})
        self.assertEqual(retry.status_code, 201)
        self.assertEqual(retry.json()["request_id"], committed_id)
        async with engine.connect() as conn:
            await conn.execute(text(f'SET search_path TO "{self.schema}",public'))
            request_count = (await conn.execute(text("SELECT count(*) FROM overtime_requests WHERE created_by=:creator AND idempotency_key=:key"), {
                "creator": manager["user_id"], "key": headers["Idempotency-Key"],
            })).scalar_one()
            create_events = (await conn.execute(text("SELECT count(*) FROM overtime_request_events WHERE request_id=:id AND action='CREATE'"), {
                "id": committed_id,
            })).scalar_one()
        self.assertEqual(request_count, 1)
        self.assertEqual(create_events, 1)


if __name__ == "__main__":
    unittest.main()
