"""OT reconciliation tests. PostgreSQL integration requires an explicit loopback DB."""

import asyncio
from datetime import datetime, timezone
import json
import os
import unittest

from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.api.deps import get_current_user
from app.api.v1.endpoints import overtime_reconciliations
from app.core.database import get_db
from app.core.ot_reconciliation import reconcile_intervals


def timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value)


def attendance(attendance_id: int, check_in: str, check_out: str | None,
               regular_start="2026-10-25T09:00:00+07:00",
               regular_end="2026-10-25T17:00:00+07:00", store_id=1):
    return {"attendance_id": attendance_id, "store_id": store_id,
            "check_in_time": timestamp(check_in),
            "check_out_time": timestamp(check_out) if check_out else None,
            "attendance_context": {
                "schedule_status": "MATCHED",
                "planned": {"store_id": store_id, "shift_id": 8,
                            "starts_at": regular_start, "ends_at": regular_end},
                "actual": {"shift_id": 8},
            }}


class IntervalTests(unittest.TestCase):
    def preview(self, rows, start="2026-10-25T17:00:00+07:00",
                end="2026-10-25T19:00:00+07:00"):
        return reconcile_intervals(timestamp(start), timestamp(end), 1, rows)

    def test_exact_short_and_long_work(self):
        exact = self.preview([attendance(1, "2026-10-25T09:00:00+07:00",
                                         "2026-10-25T19:00:00+07:00")])
        short = self.preview([attendance(1, "2026-10-25T09:00:00+07:00",
                                         "2026-10-25T18:00:00+07:00")])
        long = self.preview([attendance(1, "2026-10-25T09:00:00+07:00",
                                        "2026-10-25T20:00:00+07:00")])
        self.assertEqual([exact.proposed_microseconds, short.proposed_microseconds,
                          long.proposed_microseconds], [7_200_000_000, 3_600_000_000, 7_200_000_000])
        self.assertEqual(exact.issues, [])

    def test_no_attendance_and_open_session_require_review(self):
        self.assertIn("NO_ATTENDANCE", self.preview([]).issues)
        opened = self.preview([attendance(1, "2026-10-25T17:00:00+07:00", None)])
        self.assertEqual(opened.proposed_microseconds, 0)
        self.assertEqual(opened.status, "NEEDS_REVIEW")

    def test_multiple_sessions_are_added_without_double_counting(self):
        rows = [attendance(1, "2026-10-25T17:00:00+07:00", "2026-10-25T18:00:00+07:00"),
                attendance(2, "2026-10-25T18:00:00+07:00", "2026-10-25T19:00:00+07:00")]
        result = self.preview(rows)
        self.assertEqual(result.proposed_microseconds, 7_200_000_000)
        self.assertEqual(result.issues, [])

    def test_overlapping_sessions_are_deduplicated_and_held(self):
        rows = [attendance(1, "2026-10-25T17:00:00+07:00", "2026-10-25T19:00:00+07:00"),
                attendance(2, "2026-10-25T18:00:00+07:00", "2026-10-25T19:00:00+07:00")]
        result = self.preview(rows)
        self.assertEqual(result.proposed_microseconds, 7_200_000_000)
        self.assertIn("OVERLAPPING_ATTENDANCE", result.issues)

    def test_overnight_cross_month_and_fractional_seconds(self):
        row = attendance(1, "2026-10-31T14:00:00+07:00",
                         "2026-11-01T01:00:00.500000+07:00",
                         "2026-10-31T14:00:00+07:00", "2026-10-31T22:00:00+07:00")
        result = self.preview([row], "2026-10-31T22:00:00+07:00",
                              "2026-11-01T02:00:00+07:00")
        self.assertEqual(result.proposed_microseconds, 10_800_500_000)
        self.assertEqual(result.issues, [])

    def test_regular_shift_and_wrong_store_are_not_payable(self):
        within = self.preview([attendance(1, "2026-10-25T09:00:00+07:00",
                                          "2026-10-25T19:00:00+07:00")],
                              "2026-10-25T16:00:00+07:00", "2026-10-25T18:00:00+07:00")
        self.assertEqual(within.proposed_microseconds, 3_600_000_000)
        wrong = self.preview([attendance(1, "2026-10-25T17:00:00+07:00",
                                           "2026-10-25T19:00:00+07:00", store_id=2)])
        self.assertEqual(wrong.proposed_microseconds, 0)
        self.assertIn("STORE_OR_SHIFT_MISMATCH", wrong.issues)

    def test_missing_snapshot_is_held(self):
        row = attendance(1, "2026-10-25T17:00:00+07:00", "2026-10-25T19:00:00+07:00")
        row["attendance_context"] = None
        result = self.preview([row])
        self.assertEqual(result.status, "NEEDS_REVIEW")
        self.assertEqual(result.proposed_microseconds, 0)


LOCAL_URL = os.getenv("OT_CUTOVER_TEST_DATABASE_URL", "")
try:
    parsed = make_url(LOCAL_URL) if LOCAL_URL else None
    LOCAL_VERIFIED = bool(parsed and parsed.host in {"localhost", "127.0.0.1"}
                          and (parsed.database or "").startswith("ot_cutover02_"))
except Exception:
    LOCAL_VERIFIED = False


@unittest.skipUnless(LOCAL_VERIFIED, "Set an explicit loopback ot_cutover02_* test database URL")
class ReconciliationPostgresTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine(LOCAL_URL, pool_pre_ping=True)
        self.conn = await self.engine.connect()
        self.tx = await self.conn.begin()
        self.db = AsyncSession(bind=self.conn, join_transaction_mode="create_savepoint",
                               expire_on_commit=False)
        self.user = {"user_id": 2, "employee_id": 20, "store_id": 1,
                     "roles": ["STORE_MANAGER"]}
        self.app = FastAPI()
        self.app.include_router(overtime_reconciliations.router, prefix="/overtime-reconciliations")

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
        await self.engine.dispose()

    async def as_user(self, user, method, path, **kwargs):
        self.user = user
        return await getattr(self.client, method)(path, **kwargs)

    async def seed(self, start="2026-10-25 17:00+07", end="2026-10-25 19:00+07",
                   check_out="2026-10-25 19:00+07", employee=21,
                   regular_start="2026-10-25T09:00:00+07:00",
                   regular_end="2026-10-25T17:00:00+07:00"):
        req = (await self.conn.execute(text("""INSERT INTO overtime_requests
            (employee_id,store_id,work_date,starts_at,ends_at,reason,created_by,status,
             reviewed_by,reviewed_at) VALUES(:employee,1,:work_date,:start,:end,
             'Synthetic overtime',2,'APPROVED',4,clock_timestamp()) RETURNING request_id"""),
            {"employee": employee, "work_date": timestamp(start).date(),
             "start": timestamp(start), "end": timestamp(end)})).scalar_one()
        attendance_id = None
        if check_out is not None:
            context = {"schedule_status": "MATCHED",
                       "planned": {"store_id": 1, "shift_id": 8,
                                   "starts_at": regular_start, "ends_at": regular_end},
                       "actual": {"shift_id": 8}}
            attendance_id = (await self.conn.execute(text("""INSERT INTO attendances
                (employee_id,store_id,shift_id,work_date,check_in_time,check_out_time,attendance_context)
                VALUES(:employee,1,8,:work_date,:in_time,:out_time,CAST(:context AS jsonb))
                RETURNING attendance_id"""), {
                    "employee": employee, "work_date": timestamp(start).date(),
                    "in_time": timestamp(regular_start), "out_time": timestamp(check_out),
                    "context": json.dumps(context),
                })).scalar_one()
        return req, attendance_id

    async def test_preview_verify_rbac_retry_and_audit(self):
        request_id, attendance_id = await self.seed()
        manager = self.user
        employee = {"user_id": 3, "employee_id": 21, "store_id": 1, "roles": ["EMPLOYEE"]}
        outsider = {"user_id": 5, "employee_id": 30, "store_id": 2, "roles": ["EMPLOYEE"]}
        hr = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}
        admin = {"user_id": 1, "employee_id": 99, "store_id": 1, "roles": ["ADMIN"]}
        path = f"/overtime-reconciliations/{request_id}"
        before = await self.as_user(employee, "get", path)
        self.assertEqual(before.status_code, 200)
        self.assertEqual(before.json()["version"], 0)
        self.assertEqual(before.json()["actual_microseconds"], 7_200_000_000)
        self.assertEqual(before.json()["attendance_sources"][0]["attendance_id"], attendance_id)
        self.assertEqual((await self.as_user(outsider, "get", path)).status_code, 404)
        self.assertEqual((await self.as_user(employee, "post", path + "/preview")).status_code, 403)
        preview = await self.as_user(manager, "post", path + "/preview")
        self.assertEqual(preview.status_code, 200, preview.text)
        self.assertEqual(preview.json()["proposed_microseconds"], 7_200_000_000)
        self.assertEqual(preview.json()["actual_microseconds"], 7_200_000_000)
        self.assertEqual(preview.json()["status"], "PENDING_RECONCILIATION")
        self.assertEqual((await self.as_user(manager, "post", path + "/verify",
                                             json={"expected_version": 1})).status_code, 403)
        self.assertEqual((await self.as_user(employee, "post", path + "/verify",
                                              json={"expected_version": 1})).status_code, 403)
        verified = await self.as_user(hr, "post", path + "/verify",
                                      json={"expected_version": 1})
        self.assertEqual(verified.status_code, 200, verified.text)
        self.assertEqual(verified.json()["effective_status"], "VERIFIED")
        self.assertEqual(verified.json()["payable_microseconds"], 7_200_000_000)
        retry = await self.as_user(hr, "post", path + "/verify",
                                   json={"expected_version": 1})
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(retry.json()["version"], 2)
        self.assertEqual((await self.as_user(admin, "get", path)).status_code, 200)
        employee_list = await self.as_user(employee, "get", "/overtime-reconciliations")
        self.assertEqual(employee_list.status_code, 200)
        self.assertIn(request_id, [item["request_id"] for item in employee_list.json()])
        self.assertTrue(all(item["employee_id"] == 21 for item in employee_list.json()))
        self.assertEqual((await self.as_user(outsider, "get", "/overtime-reconciliations")).json(), [])
        admin_list = await self.as_user(admin, "get", "/overtime-reconciliations")
        self.assertEqual(admin_list.status_code, 200)
        self.assertEqual(admin_list.json()[0]["effective_status"], "VERIFIED")
        self.assertEqual((await self.conn.execute(text("""SELECT count(*) FROM overtime_reconciliation_events
            WHERE request_id=:id"""), {"id": request_id})).scalar_one(), 2)

    async def test_second_approved_request_cannot_claim_same_verified_interval(self):
        first_id, _ = await self.seed()
        hr = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}
        admin = {"user_id": 1, "employee_id": 99, "store_id": 1, "roles": ["ADMIN"]}
        first_path = f"/overtime-reconciliations/{first_id}"
        await self.as_user(hr, "post", first_path + "/preview")
        verified = await self.as_user(hr, "post", first_path + "/verify",
                                      json={"expected_version": 1})
        self.assertEqual(verified.status_code, 200, verified.text)
        second_id = (await self.conn.execute(text("""INSERT INTO overtime_requests
            (employee_id,store_id,work_date,starts_at,ends_at,reason,created_by,status,
             reviewed_by,reviewed_at) VALUES(21,1,'2026-10-25',:start,:end,
             'Synthetic overlap',2,'APPROVED',4,clock_timestamp()) RETURNING request_id"""), {
            "start": timestamp("2026-10-25T18:00:00+07:00"),
            "end": timestamp("2026-10-25T20:00:00+07:00"),
        })).scalar_one()
        second_path = f"/overtime-reconciliations/{second_id}"
        preview = await self.as_user(admin, "post", second_path + "/preview")
        self.assertEqual(preview.status_code, 200, preview.text)
        duplicate = await self.as_user(admin, "post", second_path + "/verify",
                                       json={"expected_version": 1})
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(duplicate.json()["detail"]["code"], "OT_VERIFIED_INTERVAL_CONFLICT")

    async def test_source_changes_invalidate_verified_without_changing_history(self):
        request_id, attendance_id = await self.seed()
        manager = self.user
        hr = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}
        path = f"/overtime-reconciliations/{request_id}"
        await self.as_user(manager, "post", path + "/preview")
        self.assertEqual((await self.as_user(hr, "post", path + "/verify",
                                             json={"expected_version": 1})).status_code, 200)
        await self.conn.execute(text("""UPDATE attendances SET check_out_time='2026-10-25 18:00+07',
            updated_at=clock_timestamp() WHERE attendance_id=:id"""), {"id": attendance_id})
        stale = await self.as_user(hr, "get", path)
        self.assertEqual(stale.json()["status"], "VERIFIED")
        self.assertEqual(stale.json()["effective_status"], "NEEDS_REVIEW")
        self.assertEqual(stale.json()["payable_microseconds"], 0)
        queue = await self.as_user(hr, "get", "/overtime-reconciliations",
                                   params={"status": "NEEDS_REVIEW"})
        self.assertEqual(queue.status_code, 200, queue.text)
        self.assertIn(request_id, [item["request_id"] for item in queue.json()])
        self.assertEqual((await self.conn.execute(text("""SELECT count(*) FROM v_overtime_verified_current
            WHERE request_id=:id"""), {"id": request_id})).scalar_one(), 0)
        refresh = await self.as_user(manager, "post", path + "/preview")
        self.assertEqual(refresh.json()["status"], "NEEDS_REVIEW")
        self.assertEqual(refresh.json()["proposed_microseconds"], 3_600_000_000)
        self.assertEqual(refresh.json()["version"], 3)
        self.assertEqual((await self.as_user(hr, "post", path + "/verify",
                                             json={"expected_version": 2})).status_code, 409)
        self.assertEqual((await self.as_user(hr, "post", path + "/verify",
                                             json={"expected_version": 3})).status_code, 200)

    async def test_no_attendance_rejection_and_wrong_scope(self):
        request_id, _ = await self.seed(check_out=None)
        hr = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}
        wrong_manager = {"user_id": 2, "employee_id": 20, "store_id": 2,
                         "roles": ["STORE_MANAGER"]}
        path = f"/overtime-reconciliations/{request_id}"
        self.assertEqual((await self.as_user(wrong_manager, "post", path + "/preview")).status_code, 403)
        preview = await self.as_user(hr, "post", path + "/preview")
        self.assertEqual(preview.json()["status"], "NEEDS_REVIEW")
        self.assertEqual((await self.as_user(hr, "post", path + "/verify",
                                             json={"expected_version": 1})).status_code, 409)
        rejected = await self.as_user(hr, "post", path + "/reject",
                                      json={"expected_version": 1, "reason": "No completed attendance"})
        self.assertEqual(rejected.status_code, 200, rejected.text)
        self.assertEqual(rejected.json()["status"], "REJECTED")
        self.assertEqual(rejected.json()["payable_microseconds"], 0)

    async def test_manager_evidence_does_not_expose_another_store(self):
        request_id, attendance_id = await self.seed()
        manager = self.user
        await self.conn.execute(text("""UPDATE attendances SET
            check_out_time=:checkout WHERE attendance_id=:id"""), {
            "checkout": timestamp("2026-10-25T18:00:00+07:00"), "id": attendance_id,
        })
        await self.conn.execute(text("""INSERT INTO attendances
            (employee_id,store_id,work_date,check_in_time,check_out_time,attendance_context)
            VALUES(21,2,DATE '2026-10-25',:start,:end,'{}'::jsonb)"""), {
            "start": timestamp("2026-10-25T18:00:00+07:00"),
            "end": timestamp("2026-10-25T19:00:00+07:00"),
        })
        path = f"/overtime-reconciliations/{request_id}"
        manager_result = (await self.as_user(manager, "get", path)).json()
        employee = {"user_id": 3, "employee_id": 21, "store_id": 1, "roles": ["EMPLOYEE"]}
        employee_result = (await self.as_user(employee, "get", path)).json()
        self.assertEqual([row["store_id"] for row in manager_result["attendance_sources"]], [1])
        self.assertEqual(manager_result["actual_microseconds"], 3_600_000_000)
        self.assertEqual([row["store_id"] for row in employee_result["attendance_sources"]], [1, 2])
        self.assertEqual(employee_result["actual_microseconds"], 7_200_000_000)
        await self.as_user(manager, "post", path + "/preview")
        manager_review = (await self.as_user(manager, "get", path)).json()
        self.assertEqual(manager_review["attendance_ids"], [attendance_id])
        self.assertEqual(manager_review["events"][0]["new_values"], {})
        manager_list = (await self.as_user(manager, "get", "/overtime-reconciliations")).json()
        self.assertEqual(next(item for item in manager_list if item["request_id"] == request_id)["attendance_ids"], [])

    async def test_request_lifecycle_change_invalidates_verified(self):
        request_id, _ = await self.seed()
        hr = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}
        path = f"/overtime-reconciliations/{request_id}"
        await self.as_user(hr, "post", path + "/preview")
        await self.as_user(hr, "post", path + "/verify", json={"expected_version": 1})
        await self.conn.execute(text("""UPDATE overtime_requests SET status='REVOKED',
            revoked_by=4,revoked_at=clock_timestamp(),revocation_reason='Synthetic revoke',
            updated_at=clock_timestamp() WHERE request_id=:id"""), {"id": request_id})
        row = (await self.as_user(hr, "get", path)).json()
        self.assertEqual(row["effective_status"], "NEEDS_REVIEW")
        self.assertEqual(row["payable_microseconds"], 0)

    async def test_rejected_revocation_needs_fresh_verification_before_view_returns_hours(self):
        request_id, _ = await self.seed()
        hr = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}
        path = f"/overtime-reconciliations/{request_id}"
        self.assertEqual((await self.as_user(hr, "post", path + "/preview")).status_code, 200)
        self.assertEqual((await self.as_user(hr, "post", path + "/verify",
                                             json={"expected_version": 1})).status_code, 200)
        async def view_count():
            return (await self.conn.execute(text("""SELECT count(*) FROM v_overtime_verified_current
                WHERE request_id=:id"""), {"id": request_id})).scalar_one()

        self.assertEqual(await view_count(), 1)  # Never requested revocation.
        await self.conn.execute(text("""UPDATE overtime_requests SET
            revoke_requested_by=2,revoke_requested_at=clock_timestamp(),
            revoke_reason='Synthetic request',updated_at=clock_timestamp()
            WHERE request_id=:id"""), {"id": request_id})
        self.assertEqual(await view_count(), 0)
        pending = (await self.as_user(hr, "get", path)).json()
        self.assertEqual((pending["status"], pending["effective_status"],
                          pending["payable_microseconds"]), ("VERIFIED", "NEEDS_REVIEW", 0))
        self.assertEqual((await self.as_user(hr, "post", path + "/preview")).status_code, 409)
        self.assertEqual((await self.as_user(hr, "post", path + "/verify",
                                             json={"expected_version": 2})).status_code, 409)

        await self.conn.execute(text("""UPDATE overtime_requests SET
            revoke_decision='REJECTED',revoke_decided_by=4,
            revoke_decided_at=clock_timestamp(),revoke_decision_reason='Keep OT',
            updated_at=clock_timestamp() WHERE request_id=:id"""), {"id": request_id})
        self.assertTrue((await self.conn.execute(text("""SELECT
            public.ot_reconciliation_request_eligible(:id)"""), {"id": request_id})).scalar_one())
        self.assertEqual(await view_count(), 0)  # Old signature cannot become payable again.
        stale = (await self.as_user(hr, "get", path)).json()
        self.assertEqual(stale["effective_status"], "NEEDS_REVIEW")
        queue = (await self.as_user(hr, "get", "/overtime-reconciliations",
                                    params={"status": "NEEDS_REVIEW"})).json()
        self.assertIn(request_id, [item["request_id"] for item in queue])
        refreshed = await self.as_user(hr, "post", path + "/preview")
        self.assertEqual(refreshed.status_code, 200, refreshed.text)
        self.assertEqual((refreshed.json()["status"], refreshed.json()["version"]),
                         ("NEEDS_REVIEW", 3))
        self.assertEqual((await self.as_user(hr, "post", path + "/verify",
                                             json={"expected_version": 2})).status_code, 409)
        verified = await self.as_user(hr, "post", path + "/verify",
                                      json={"expected_version": 3})
        self.assertEqual(verified.status_code, 200, verified.text)
        self.assertEqual(verified.json()["payable_microseconds"], 7_200_000_000)
        self.assertEqual(await view_count(), 1)
        self.assertEqual((await self.conn.execute(text("""SELECT count(*)
            FROM overtime_reconciliation_events WHERE request_id=:id"""),
            {"id": request_id})).scalar_one(), 4)

    async def test_approved_revoke_replacement_and_terminal_statuses_exclude_view(self):
        request_id, _ = await self.seed()
        hr = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}
        path = f"/overtime-reconciliations/{request_id}"
        await self.as_user(hr, "post", path + "/preview")
        await self.as_user(hr, "post", path + "/verify", json={"expected_version": 1})
        async def excluded(target_id):
            self.assertFalse((await self.conn.execute(text(
                "SELECT public.ot_reconciliation_request_eligible(:id)"
            ), {"id": target_id})).scalar_one())
            self.assertEqual((await self.conn.execute(text(
                "SELECT count(*) FROM v_overtime_verified_current WHERE request_id=:id"
            ), {"id": target_id})).scalar_one(), 0)
            response = await self.as_user(hr, "get", f"/overtime-reconciliations/{target_id}")
            self.assertEqual(response.json()["payable_microseconds"], 0)
            self.assertEqual((await self.as_user(hr, "post",
                                             f"/overtime-reconciliations/{target_id}/preview")).status_code, 409)

        await self.conn.execute(text("""UPDATE overtime_requests SET
            revoke_requested_at=clock_timestamp(),revoke_requested_by=2,
            revoke_reason='Synthetic revoke',revoke_decision='APPROVED',
            revoke_decided_by=4,revoke_decided_at=clock_timestamp(),
            status='REVOKED',revoked_by=4,revoked_at=clock_timestamp(),
            revocation_reason='Synthetic revoke' WHERE request_id=:id"""), {"id": request_id})
        await excluded(request_id)
        replacement_id, _ = await self.seed(employee=22)
        parent_id, _ = await self.seed()
        await self.conn.execute(text("""UPDATE overtime_requests SET status='REPLACED',
            replaced_by_request_id=:replacement WHERE request_id=:id"""),
            {"id": parent_id, "replacement": replacement_id})
        await excluded(parent_id)
        rejected_id, _ = await self.seed()
        await self.conn.execute(text("""UPDATE overtime_requests SET status='REJECTED',
            rejection_reason='Synthetic rejection' WHERE request_id=:id"""),
            {"id": rejected_id})
        await excluded(rejected_id)
        cancelled_id, _ = await self.seed()
        await self.conn.execute(text("""UPDATE overtime_requests SET status='CANCELLED',
            cancelled_by=2,cancelled_at=clock_timestamp() WHERE request_id=:id"""),
            {"id": cancelled_id})
        await excluded(cancelled_id)

    async def test_decision_timestamp_without_rejection_is_not_eligible(self):
        request_id, _ = await self.seed()
        await self.conn.execute(text("""UPDATE overtime_requests SET
            revoke_requested_by=2,revoke_requested_at=clock_timestamp(),
            revoke_decided_at=clock_timestamp(),revoke_decision=NULL
            WHERE request_id=:id"""), {"id": request_id})
        eligible = (await self.conn.execute(text(
            "SELECT public.ot_reconciliation_request_eligible(:id)"
        ), {"id": request_id})).scalar_one()
        self.assertFalse(eligible)
        self.assertEqual((await self.as_user(self.user, "post",
                                             f"/overtime-reconciliations/{request_id}/preview")).status_code, 409)

    async def test_rejected_revocation_cannot_reclaim_an_interval_verified_elsewhere(self):
        original_id, _ = await self.seed()
        hr = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}
        admin = {"user_id": 1, "employee_id": 99, "store_id": 1, "roles": ["ADMIN"]}
        original_path = f"/overtime-reconciliations/{original_id}"
        await self.as_user(hr, "post", original_path + "/preview")
        self.assertEqual((await self.as_user(hr, "post", original_path + "/verify",
                                             json={"expected_version": 1})).status_code, 200)
        await self.conn.execute(text("""UPDATE overtime_requests SET
            revoke_requested_by=2,revoke_requested_at=clock_timestamp(),
            revoke_reason='Synthetic request' WHERE request_id=:id"""), {"id": original_id})
        competing_id = (await self.conn.execute(text("""INSERT INTO overtime_requests
            (employee_id,store_id,work_date,starts_at,ends_at,reason,created_by,status,
             reviewed_by,reviewed_at) VALUES(21,1,DATE '2026-10-25',:start,:end,
             'Synthetic competing OT',2,'APPROVED',4,clock_timestamp()) RETURNING request_id"""), {
            "start": timestamp("2026-10-25T17:00:00+07:00"),
            "end": timestamp("2026-10-25T19:00:00+07:00"),
        })).scalar_one()
        competing_path = f"/overtime-reconciliations/{competing_id}"
        self.assertEqual((await self.as_user(admin, "post", competing_path + "/preview")).status_code, 200)
        self.assertEqual((await self.as_user(admin, "post", competing_path + "/verify",
                                             json={"expected_version": 1})).status_code, 200)
        await self.conn.execute(text("""UPDATE overtime_requests SET
            revoke_decision='REJECTED',revoke_decided_by=4,
            revoke_decided_at=clock_timestamp(),revoke_decision_reason='Keep request'
            WHERE request_id=:id"""), {"id": original_id})
        refreshed = await self.as_user(hr, "post", original_path + "/preview")
        self.assertEqual(refreshed.status_code, 200, refreshed.text)
        conflict = await self.as_user(hr, "post", original_path + "/verify",
                                      json={"expected_version": refreshed.json()["version"]})
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json()["detail"]["code"], "OT_VERIFIED_INTERVAL_CONFLICT")
        active_ids = (await self.conn.execute(text("""SELECT request_id
            FROM v_overtime_verified_current WHERE employee_id=21
              AND starts_at<:ends_at AND ends_at>:starts_at"""), {
            "starts_at": timestamp("2026-10-25T17:00:00+07:00"),
            "ends_at": timestamp("2026-10-25T19:00:00+07:00"),
        })).scalars().all()
        self.assertEqual(active_ids, [competing_id])

    async def test_event_trigger_rejects_update_and_delete(self):
        request_id, _ = await self.seed()
        await self.as_user(self.user, "post", f"/overtime-reconciliations/{request_id}/preview")
        for verb in ("UPDATE", "DELETE"):
            with self.subTest(verb=verb):
                nested = await self.conn.begin_nested()
                try:
                    if verb == "UPDATE":
                        await self.conn.execute(text("""UPDATE overtime_reconciliation_events
                            SET action='REJECT' WHERE request_id=:id"""), {"id": request_id})
                    else:
                        await self.conn.execute(text("""DELETE FROM overtime_reconciliation_events
                            WHERE request_id=:id"""), {"id": request_id})
                except Exception:
                    await nested.rollback()
                else:
                    await nested.rollback()
                    self.fail(f"{verb} unexpectedly modified append-only event")


@unittest.skipUnless(LOCAL_VERIFIED, "Set an explicit loopback ot_cutover02_* test database URL")
class ReconciliationConcurrencyTests(unittest.IsolatedAsyncioTestCase):
    async def test_two_hr_verifications_create_one_decision_and_event(self):
        await self._two_hr_scenario(revocation_rejected=False)

    async def test_two_hr_after_rejected_revocation_create_one_decision(self):
        await self._two_hr_scenario(revocation_rejected=True)

    async def _two_hr_scenario(self, *, revocation_rejected: bool):
        engine = create_async_engine(LOCAL_URL, pool_pre_ping=True)
        request_id = attendance_id = None
        try:
            async with engine.begin() as conn:
                day = (await conn.execute(text("""SELECT COALESCE(MAX(work_date),
                    DATE '2026-10-26') + 1 FROM overtime_requests
                    WHERE employee_id=21"""))).scalar_one()
                day_text = day.isoformat()
                context = {"schedule_status": "MATCHED",
                           "planned": {"store_id": 1, "shift_id": 8,
                                       "starts_at": f"{day_text}T09:00:00+07:00",
                                       "ends_at": f"{day_text}T17:00:00+07:00"},
                           "actual": {"shift_id": 8}}
                request_id = (await conn.execute(text("""INSERT INTO overtime_requests
                    (employee_id,store_id,work_date,starts_at,ends_at,reason,created_by,status,
                     reviewed_by,reviewed_at) VALUES(21,1,:day,:start,:end,
                     'Synthetic concurrency',2,'APPROVED',4,clock_timestamp()) RETURNING request_id"""),
                    {"day": day, "start": timestamp(f"{day_text}T17:00:00+07:00"),
                     "end": timestamp(f"{day_text}T19:00:00+07:00")})).scalar_one()
                if revocation_rejected:
                    await conn.execute(text("""UPDATE overtime_requests SET
                        revoke_requested_by=2,revoke_requested_at=clock_timestamp(),
                        revoke_reason='Synthetic request',revoke_decision='REJECTED',
                        revoke_decided_by=4,revoke_decided_at=clock_timestamp(),
                        revoke_decision_reason='Keep OT' WHERE request_id=:id"""),
                        {"id": request_id})
                attendance_id = (await conn.execute(text("""INSERT INTO attendances
                    (employee_id,store_id,shift_id,work_date,check_in_time,check_out_time,attendance_context)
                    VALUES(21,1,8,:day,:start,:end,CAST(:context AS jsonb))
                    RETURNING attendance_id"""), {
                    "day": day, "start": timestamp(f"{day_text}T09:00:00+07:00"),
                    "end": timestamp(f"{day_text}T19:00:00+07:00"),
                    "context": json.dumps(context),
                })).scalar_one()
            async with AsyncSession(engine, expire_on_commit=False) as session:
                await overtime_reconciliations.preview_reconciliation(
                    request_id,
                    user={"user_id": 2, "employee_id": 20, "store_id": 1,
                          "roles": ["STORE_MANAGER"]}, db=session)

            async def decide(user_id, employee_id):
                async with AsyncSession(engine, expire_on_commit=False) as session:
                    try:
                        await overtime_reconciliations._decide(
                            session, request_id,
                            {"user_id": user_id, "employee_id": employee_id,
                             "store_id": 1, "roles": ["HR_MANAGER"]},
                            1, "VERIFIED", None)
                        return 200
                    except HTTPException as exc:
                        await session.rollback()
                        return exc.status_code

            outcomes = await asyncio.gather(decide(4, 22), decide(6, 23))
            self.assertEqual(sorted(outcomes), [200, 409])
            async with engine.connect() as conn:
                result = (await conn.execute(text("""SELECT status,version,verified_microseconds
                    FROM overtime_reconciliations WHERE request_id=:id"""),
                    {"id": request_id})).mappings().one()
                event_count = (await conn.execute(text("""SELECT count(*)
                    FROM overtime_reconciliation_events WHERE request_id=:id"""),
                    {"id": request_id})).scalar_one()
                payable_count = (await conn.execute(text("""SELECT count(*)
                    FROM v_overtime_verified_current WHERE request_id=:id"""),
                    {"id": request_id})).scalar_one()
            self.assertEqual((result["status"], result["version"], event_count,
                              payable_count), ("VERIFIED", 2, 2, 1))
        finally:
            # The event table is append-only. Synthetic rows remain only in this
            # dedicated TEMP cluster, which is stopped/removed after acceptance.
            await engine.dispose()


if __name__ == "__main__":
    unittest.main()
