"""OT reconciliation tests. PostgreSQL integration requires an explicit loopback DB."""

import asyncio
from datetime import datetime, timezone
import json
import os
import unittest
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.api.deps import get_current_user
from app.api.v1.endpoints import operations, overtime_reconciliations
from app.core.database import get_db
from app.core.ot_reconciliation import derive_execution_status, reconcile_intervals


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
        self.assertIn("ATTENDANCE_CHECKOUT_MISSING", opened.issues)
        self.assertNotIn("INVALID_OR_OPEN_ATTENDANCE_SNAPSHOT", opened.issues)

    def test_execution_status_is_independent_of_reconciliation_issues(self):
        start = timestamp("2026-10-25T17:00:00+07:00")
        end = timestamp("2026-10-25T19:00:00+07:00")
        self.assertEqual(derive_execution_status(
            start, end, [], now=timestamp("2026-10-25T16:00:00+07:00")), "NOT_STARTED")
        self.assertEqual(derive_execution_status(
            start, end, [], now=timestamp("2026-10-25T18:00:00+07:00")), "IN_PROGRESS")
        open_row = attendance(1, "2026-10-25T17:00:00+07:00", None)
        self.assertEqual(derive_execution_status(
            start, end, [open_row], now=timestamp("2026-10-25T18:00:00+07:00")), "IN_PROGRESS")
        self.assertEqual(derive_execution_status(
            start, end, [], now=timestamp("2026-10-25T20:00:00+07:00")), "ATTENDANCE_INCOMPLETE")
        self.assertEqual(derive_execution_status(
            start, end, [open_row], now=timestamp("2026-10-25T20:00:00+07:00")), "ATTENDANCE_INCOMPLETE")
        closed = attendance(2, "2026-10-25T17:00:00+07:00", "2026-10-25T19:00:00+07:00")
        self.assertEqual(derive_execution_status(
            start, end, [closed], now=timestamp("2026-10-25T20:00:00+07:00")), "ENDED")

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

    def test_open_attendance_does_not_hide_missing_snapshot(self):
        row = attendance(1, "2026-10-25T17:00:00+07:00", None)
        row["attendance_context"] = None
        result = self.preview([row])
        self.assertIn("ATTENDANCE_CHECKOUT_MISSING", result.issues)
        self.assertIn("SCHEDULE_SNAPSHOT_MISSING_OR_MISMATCH", result.issues)

    def test_mismatched_shift_snapshot_is_held(self):
        row = attendance(1, "2026-10-25T17:00:00+07:00", "2026-10-25T19:00:00+07:00")
        row["attendance_context"]["actual"]["shift_id"] = 99
        result = self.preview([row])
        self.assertEqual(result.proposed_microseconds, 0)
        self.assertIn("STORE_OR_SHIFT_MISMATCH", result.issues)


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
        # The synthetic rows below use October 2026 dates. Keep PostgreSQL tests
        # deterministic as calendar time advances beyond or before those dates.
        self.clock = patch.object(
            overtime_reconciliations, "_utc_now",
            return_value=datetime(2035, 1, 1, tzinfo=timezone.utc),
        )
        self.clock.start()
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
        self.clock.stop()

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
        manager_preview = await self.as_user(manager, "post", path + "/preview")
        self.assertEqual(manager_preview.status_code, 403)
        self.assertEqual((await self.conn.execute(text("""SELECT count(*)
            FROM overtime_reconciliations WHERE request_id=:id"""), {"id": request_id})).scalar_one(), 0)
        self.assertEqual((await self.conn.execute(text("""SELECT count(*)
            FROM overtime_reconciliation_events WHERE request_id=:id"""), {"id": request_id})).scalar_one(), 0)
        preview = await self.as_user(hr, "post", path + "/preview")
        self.assertEqual(preview.status_code, 200, preview.text)
        self.assertEqual(preview.json()["proposed_microseconds"], 7_200_000_000)
        self.assertEqual(preview.json()["actual_microseconds"], 7_200_000_000)
        self.assertEqual(preview.json()["status"], "PENDING_RECONCILIATION")
        self.assertEqual((await self.as_user(manager, "post", path + "/reject",
                                             json={"expected_version": 1,
                                                   "reason": "Out-of-role test"})).status_code, 403)
        unchanged = (await self.as_user(hr, "get", path)).json()
        self.assertEqual(unchanged["version"], 1)
        self.assertEqual([event["action"] for event in unchanged["events"]], ["PREVIEW"])
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
        outsider_list = (await self.as_user(
            outsider, "get", "/overtime-reconciliations"
        )).json()
        self.assertTrue(all(item["employee_id"] == outsider["employee_id"]
                            for item in outsider_list))
        self.assertNotIn(request_id, [item["request_id"] for item in outsider_list])
        admin_list = await self.as_user(admin, "get", "/overtime-reconciliations")
        self.assertEqual(admin_list.status_code, 200)
        self.assertEqual(admin_list.json()[0]["effective_status"], "VERIFIED")
        self.assertEqual((await self.conn.execute(text("""SELECT count(*) FROM overtime_reconciliation_events
            WHERE request_id=:id"""), {"id": request_id})).scalar_one(), 2)

    async def test_preview_and_decision_are_blocked_before_ot_end_without_writes(self):
        request_id, _ = await self.seed(check_out=None)
        hr = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}
        path = f"/overtime-reconciliations/{request_id}"
        for now, expected in [
            (timestamp("2026-10-25T16:00:00+07:00"), "NOT_STARTED"),
            (timestamp("2026-10-25T18:00:00+07:00"), "IN_PROGRESS"),
        ]:
            with patch.object(overtime_reconciliations, "_utc_now", return_value=now):
                preview = await self.as_user(hr, "post", path + "/preview")
                self.assertEqual(preview.status_code, 409, preview.text)
                self.assertEqual(preview.json()["detail"]["code"], "OT_RECONCILIATION_NOT_READY")
                self.assertEqual(preview.json()["detail"]["execution_status"], expected)
                decision = await self.as_user(hr, "post", path + "/verify",
                                              json={"expected_version": 1})
                self.assertEqual(decision.status_code, 409)
                self.assertEqual(decision.json()["detail"]["code"], "OT_RECONCILIATION_NOT_READY")
            self.assertEqual((await self.conn.execute(text(
                "SELECT count(*) FROM overtime_reconciliations WHERE request_id=:id"),
                {"id": request_id})).scalar_one(), 0)
            self.assertEqual((await self.conn.execute(text(
                "SELECT count(*) FROM overtime_reconciliation_events WHERE request_id=:id"),
                {"id": request_id})).scalar_one(), 0)

        with patch.object(overtime_reconciliations, "_utc_now",
                          return_value=timestamp("2026-10-25T20:00:00+07:00")):
            preview = await self.as_user(hr, "post", path + "/preview")
            self.assertEqual(preview.status_code, 200, preview.text)
            self.assertEqual(preview.json()["execution_status"], "ATTENDANCE_INCOMPLETE")
            self.assertTrue(preview.json()["reconciliation_window_open"])
            self.assertIn("NO_ATTENDANCE", preview.json()["review_issues"])
            self.assertEqual(preview.json()["effective_status"], "NEEDS_REVIEW")

    async def test_reconciliation_list_date_store_filters_and_invalid_range(self):
        first_id, _ = await self.seed(
            start="2026-10-25 17:00+07", end="2026-10-25 19:00+07",
            check_out="2026-10-25 19:00+07",
            regular_start="2026-10-25T09:00:00+07:00",
            regular_end="2026-10-25T17:00:00+07:00",
        )
        second_id, _ = await self.seed(
            start="2026-10-26 17:00+07", end="2026-10-26 19:00+07",
            check_out="2026-10-26 19:00+07",
            regular_start="2026-10-26T09:00:00+07:00",
            regular_end="2026-10-26T17:00:00+07:00",
        )
        hr = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}
        await self.as_user(hr, "post", f"/overtime-reconciliations/{first_id}/preview")
        await self.as_user(hr, "post", f"/overtime-reconciliations/{second_id}/preview")

        selected_day = await self.as_user(
            hr, "get", "/overtime-reconciliations",
            params={"date_from": "2026-10-25", "date_to": "2026-10-25", "store_id": 1},
        )
        self.assertEqual(selected_day.status_code, 200, selected_day.text)
        self.assertEqual([item["request_id"] for item in selected_day.json()], [first_id])

        no_matching_store = await self.as_user(
            hr, "get", "/overtime-reconciliations",
            params={"date_from": "2026-10-25", "date_to": "2026-10-26", "store_id": 999},
        )
        self.assertEqual(no_matching_store.status_code, 200, no_matching_store.text)
        self.assertEqual(no_matching_store.json(), [])

        invalid_range = await self.as_user(
            hr, "get", "/overtime-reconciliations",
            params={"date_from": "2026-10-26", "date_to": "2026-10-25"},
        )
        self.assertEqual(invalid_range.status_code, 422)

    async def test_rec12a_shift_catalog_change_keeps_attendance_snapshot(self):
        request_id, attendance_id = await self.seed()
        hr = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}
        path = f"/overtime-reconciliations/{request_id}"

        preview = await self.as_user(hr, "post", path + "/preview")
        self.assertEqual(preview.json()["proposed_microseconds"], 7_200_000_000)
        verified = await self.as_user(hr, "post", path + "/verify",
                                      json={"expected_version": preview.json()["version"]})
        original_signature = verified.json()["source_signature"]
        original_snapshot = (await self.conn.execute(text(
            "SELECT attendance_context FROM attendances WHERE attendance_id=:id"),
            {"id": attendance_id})).scalar_one()
        event_count = (await self.conn.execute(text(
            "SELECT count(*) FROM overtime_reconciliation_events WHERE request_id=:id"),
            {"id": request_id})).scalar_one()

        await self.conn.execute(text("""UPDATE work_shifts
            SET start_time='10:00',end_time='18:00' WHERE shift_id=8"""))

        current_signature = (await self.conn.execute(text(
            "SELECT public.ot_reconciliation_source_signature(:id)"),
            {"id": request_id})).scalar_one()
        current_snapshot = (await self.conn.execute(text(
            "SELECT attendance_context FROM attendances WHERE attendance_id=:id"),
            {"id": attendance_id})).scalar_one()
        detail = await self.as_user(hr, "get", path)
        self.assertEqual(current_snapshot, original_snapshot)
        self.assertEqual(current_signature, original_signature)
        self.assertEqual(detail.json()["effective_status"], "VERIFIED")
        self.assertEqual(detail.json()["payable_microseconds"], 7_200_000_000)
        self.assertEqual((await self.conn.execute(text(
            "SELECT count(*) FROM overtime_reconciliation_events WHERE request_id=:id"),
            {"id": request_id})).scalar_one(), event_count)

    async def test_rec12b_historical_attendance_snapshot_change_invalidates_verified(self):
        request_id, attendance_id = await self.seed()
        hr = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}
        path = f"/overtime-reconciliations/{request_id}"

        preview = await self.as_user(hr, "post", path + "/preview")
        verified = await self.as_user(hr, "post", path + "/verify",
                                      json={"expected_version": preview.json()["version"]})
        original_signature = verified.json()["source_signature"]
        original_events = (await self.conn.execute(text("""SELECT action,version
            FROM overtime_reconciliation_events WHERE request_id=:id ORDER BY event_id"""),
            {"id": request_id})).all()

        await self.conn.execute(text("""UPDATE attendances SET attendance_context =
            jsonb_set(attendance_context, '{planned,ends_at}', '"2026-10-25T18:00:00+07:00"')
            WHERE attendance_id=:id"""), {"id": attendance_id})
        changed_signature = (await self.conn.execute(text(
            "SELECT public.ot_reconciliation_source_signature(:id)"),
            {"id": request_id})).scalar_one()
        self.assertNotEqual(changed_signature, original_signature)

        stale = await self.as_user(hr, "get", path)
        self.assertEqual(stale.json()["effective_status"], "NEEDS_REVIEW")
        self.assertEqual(stale.json()["payable_microseconds"], 0)
        old_decision = await self.as_user(
            hr, "post", path + "/verify",
            json={"expected_version": verified.json()["version"]})
        self.assertEqual(old_decision.status_code, 409)
        self.assertEqual(old_decision.json()["detail"]["code"], "OT_RECONCILIATION_STALE")

        refreshed = await self.as_user(hr, "post", path + "/preview")
        self.assertEqual(refreshed.json()["proposed_microseconds"], 3_600_000_000)
        reverified = await self.as_user(
            hr, "post", path + "/verify",
            json={"expected_version": refreshed.json()["version"]})
        self.assertEqual(reverified.json()["effective_status"], "VERIFIED")
        self.assertEqual(reverified.json()["verified_microseconds"], 3_600_000_000)
        events = (await self.conn.execute(text("""SELECT action,version
            FROM overtime_reconciliation_events WHERE request_id=:id ORDER BY event_id"""),
            {"id": request_id})).all()
        self.assertEqual(events[:len(original_events)], original_events)
        self.assertEqual([action for action, _ in events],
                         ["PREVIEW", "VERIFY", "REFRESH", "VERIFY"])

    async def test_rec12c_missing_snapshot_fails_closed(self):
        request_id, attendance_id = await self.seed()
        hr = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}
        await self.conn.execute(text(
            "UPDATE attendances SET attendance_context=NULL WHERE attendance_id=:id"),
            {"id": attendance_id})
        path = f"/overtime-reconciliations/{request_id}"

        preview = await self.as_user(hr, "post", path + "/preview")
        self.assertIn("SCHEDULE_SNAPSHOT_MISSING_OR_MISMATCH",
                      preview.json()["review_issues"])
        self.assertEqual(preview.json()["proposed_microseconds"], 0)
        decision = await self.as_user(hr, "post", path + "/verify",
                                      json={"expected_version": preview.json()["version"]})
        self.assertEqual(decision.status_code, 409)
        self.assertEqual(decision.json()["detail"]["code"],
                         "OT_RECONCILIATION_NEEDS_REVIEW")
        self.assertEqual((await self.conn.execute(text(
            "SELECT count(*) FROM v_overtime_verified_current WHERE request_id=:id"),
            {"id": request_id})).scalar_one(), 0)

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
        await self.as_user(hr, "post", path + "/preview")
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
        self.assertEqual((await self.as_user(manager, "post", path + "/preview")).status_code, 403)
        refresh = await self.as_user(hr, "post", path + "/preview")
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
        manager_preview = await self.as_user(manager, "post", path + "/preview")
        self.assertEqual(manager_preview.status_code, 403)
        untouched = (await self.as_user(manager, "get", path)).json()
        self.assertEqual(untouched["version"], 0)
        self.assertEqual(untouched["events"], [])
        hr = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}
        await self.as_user(hr, "post", path + "/preview")
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
        hr = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}
        self.assertEqual((await self.as_user(hr, "post",
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
        hr = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}
        await self.as_user(hr, "post", f"/overtime-reconciliations/{request_id}/preview")
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


    async def test_explanation_requires_response_or_manual_hr_close_before_decision(self):
        request_id, _ = await self.seed()
        hr = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}
        employee = {"user_id": 3, "employee_id": 21, "store_id": 1, "roles": ["EMPLOYEE"]}
        path = f"/overtime-reconciliations/{request_id}"
        preview = await self.as_user(hr, "post", path + "/preview")
        self.assertEqual(preview.status_code, 200, preview.text)
        opened = await self.as_user(hr, "post", path + "/explanation-requests",
                                    json={"expected_version": preview.json()["version"],
                                          "reason": "Thiếu thông tin về phiên chấm công."})
        self.assertEqual(opened.status_code, 201, opened.text)
        case = opened.json()
        self.assertEqual((case["case_type"], case["status"], case["reconciliation_version"]),
                         ("EXPLANATION", "OPEN", preview.json()["version"]))

        pending_decision = await self.as_user(
            hr, "post", path + "/verify",
            json={"expected_version": preview.json()["version"]})
        self.assertEqual(pending_decision.status_code, 409)
        self.assertEqual(pending_decision.json()["detail"]["code"], "OT_EXPLANATION_PENDING")
        self.assertEqual((await self.as_user(
            hr, "post", path + f"/explanation-cases/{case['case_id']}/close",
            json={"expected_case_version": 1, "reason": "Đóng thủ công sau khi đã liên hệ."})).status_code, 200)
        verified = await self.as_user(
            hr, "post", path + "/verify",
            json={"expected_version": preview.json()["version"]})
        self.assertEqual(verified.status_code, 200, verified.text)
        self.assertEqual(verified.json()["effective_status"], "VERIFIED")
        case_events = (await self.conn.execute(text("""SELECT action,version
            FROM overtime_reconciliation_case_events WHERE case_id=:id ORDER BY case_event_id"""),
            {"id": case["case_id"]})).all()
        self.assertEqual(case_events, [("EXPLANATION_REQUESTED", 1), ("EXPLANATION_CLOSED", 2)])

    async def test_employee_explanation_scoped_response_is_audited_and_allows_hr_decision(self):
        request_id, _ = await self.seed()
        hr = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}
        employee = {"user_id": 3, "employee_id": 21, "store_id": 1, "roles": ["EMPLOYEE"]}
        outsider = {"user_id": 5, "employee_id": 30, "store_id": 2, "roles": ["EMPLOYEE"]}
        manager = {"user_id": 2, "employee_id": 20, "store_id": 1, "roles": ["STORE_MANAGER"]}
        path = f"/overtime-reconciliations/{request_id}"
        preview = await self.as_user(hr, "post", path + "/preview")
        case = (await self.as_user(hr, "post", path + "/explanation-requests",
            json={"expected_version": preview.json()["version"], "reason": "Cần xác nhận tình huống chấm công."})).json()
        response_path = path + f"/explanation-cases/{case['case_id']}/respond"
        payload = {"expected_case_version": 1, "response": "Tôi đã hoàn tất ca OT theo phân công."}
        self.assertEqual((await self.as_user(outsider, "post", response_path, json=payload)).status_code, 404)
        self.assertEqual((await self.as_user(manager, "post", response_path, json=payload)).status_code, 403)
        response = await self.as_user(employee, "post", response_path, json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "RESPONDED")
        retry = await self.as_user(employee, "post", response_path, json=payload)
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(retry.json()["version"], 2)
        verified = await self.as_user(hr, "post", path + "/verify",
                                      json={"expected_version": preview.json()["version"]})
        self.assertEqual(verified.status_code, 200, verified.text)
        self.assertEqual(verified.json()["effective_status"], "VERIFIED")
        persisted = (await self.conn.execute(text("""SELECT status,employee_response,resolved_by
            FROM overtime_reconciliation_cases WHERE case_id=:id"""), {"id": case["case_id"]})).one()
        self.assertEqual(persisted[0], "CLOSED")
        self.assertEqual(persisted[1], payload["response"])
        self.assertEqual(persisted[2], hr["user_id"])

    async def test_review_decline_preserves_rejection_and_enforces_one_request_per_version(self):
        request_id, _ = await self.seed()
        hr = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}
        employee = {"user_id": 3, "employee_id": 21, "store_id": 1, "roles": ["EMPLOYEE"]}
        path = f"/overtime-reconciliations/{request_id}"
        preview = await self.as_user(hr, "post", path + "/preview")
        rejected = await self.as_user(hr, "post", path + "/reject",
                                      json={"expected_version": preview.json()["version"],
                                            "reason": "Thiếu dữ liệu đủ điều kiện."})
        rejected_version = rejected.json()["version"]
        appeal = await self.as_user(employee, "post", path + "/review-requests",
                                    json={"expected_reconciliation_version": rejected_version,
                                          "reason": "Đề nghị kiểm tra lại dữ liệu ca."})
        self.assertEqual(appeal.status_code, 201, appeal.text)
        case = appeal.json()
        decision = await self.as_user(hr, "post", path + f"/review-requests/{case['case_id']}/decision",
            json={"expected_case_version": 1, "expected_reconciliation_version": rejected_version,
                  "decision": "REJECT", "reason": "Không có căn cứ thay đổi kết quả."})
        self.assertEqual(decision.status_code, 200, decision.text)
        self.assertEqual(decision.json()["reconciliation"]["status"], "REJECTED")
        self.assertEqual(decision.json()["case"]["status"], "DECLINED")
        rec = (await self.conn.execute(text("""SELECT status,version,decision_reason
            FROM overtime_reconciliations WHERE request_id=:id"""), {"id": request_id})).one()
        self.assertEqual((rec[0], rec[1], rec[2]), ("REJECTED", rejected_version, "Thiếu dữ liệu đủ điều kiện."))
        duplicate = await self.as_user(employee, "post", path + "/review-requests",
            json={"expected_reconciliation_version": rejected_version,
                  "reason": "Gửi lại không được phép."})
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual((await self.conn.execute(text("""SELECT count(*)
            FROM public.overtime_reconciliation_cases
            WHERE request_id=:id AND case_type='REVIEW_REQUEST'"""), {"id": request_id})).scalar_one(), 1)

    async def test_admin_keeps_backend_reconciliation_decision_rights_but_manager_cannot_reopen(self):
        request_id, _ = await self.seed()
        hr = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}
        employee = {"user_id": 3, "employee_id": 21, "store_id": 1, "roles": ["EMPLOYEE"]}
        manager = {"user_id": 2, "employee_id": 20, "store_id": 1, "roles": ["STORE_MANAGER"]}
        admin = {"user_id": 1, "employee_id": 99, "store_id": 1, "roles": ["ADMIN"]}
        path = f"/overtime-reconciliations/{request_id}"
        preview = await self.as_user(hr, "post", path + "/preview")
        rejected = await self.as_user(hr, "post", path + "/reject",
                                      json={"expected_version": preview.json()["version"],
                                            "reason": "Synthetic rejection before Admin review."})
        rec_version = rejected.json()["version"]
        appeal = await self.as_user(employee, "post", path + "/review-requests",
                                    json={"expected_reconciliation_version": rec_version,
                                          "reason": "Đề nghị Admin xem xét hồ sơ."})
        case_id = appeal.json()["case_id"]
        payload = {"expected_case_version": 1, "expected_reconciliation_version": rec_version,
                   "decision": "ACCEPT", "reason": "Admin mở phiên kiểm tra theo quyền hiện hành."}
        decision_path = path + f"/review-requests/{case_id}/decision"
        manager_denial = await self.as_user(manager, "post", decision_path, json=payload)
        self.assertEqual(manager_denial.status_code, 403)
        before_version = (await self.conn.execute(text(
            "SELECT version FROM overtime_reconciliations WHERE request_id=:id"),
            {"id": request_id})).scalar_one()
        self.assertEqual(before_version, rec_version)
        accepted = await self.as_user(admin, "post", decision_path, json=payload)
        self.assertEqual(accepted.status_code, 200, accepted.text)
        self.assertEqual(accepted.json()["reconciliation"]["status"], "NEEDS_REVIEW")
        self.assertEqual(accepted.json()["reconciliation"]["payable_microseconds"], 0)

    async def test_accepted_review_opens_needs_review_and_stale_source_cannot_be_verified(self):
        request_id, attendance_id = await self.seed()
        hr = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}
        employee = {"user_id": 3, "employee_id": 21, "store_id": 1, "roles": ["EMPLOYEE"]}
        path = f"/overtime-reconciliations/{request_id}"
        preview = await self.as_user(hr, "post", path + "/preview")
        rejected = await self.as_user(hr, "post", path + "/reject",
                                      json={"expected_version": preview.json()["version"],
                                            "reason": "Yêu cầu ban đầu chưa đủ căn cứ."})
        old_version = rejected.json()["version"]
        await self.conn.execute(text("""UPDATE attendances SET check_out_time=:checkout
            WHERE attendance_id=:attendance"""), {
            "checkout": timestamp("2026-10-25T18:00:00+07:00"), "attendance": attendance_id,
        })
        appeal = await self.as_user(employee, "post", path + "/review-requests",
                                    json={"expected_reconciliation_version": old_version,
                                          "reason": "Attendance đã được xác minh bổ sung."})
        self.assertEqual(appeal.status_code, 201, appeal.text)
        case = appeal.json()
        opened = await self.as_user(hr, "post", path + f"/review-requests/{case['case_id']}/decision",
            json={"expected_case_version": 1, "expected_reconciliation_version": old_version,
                  "decision": "ACCEPT", "reason": "Mở vòng mới để rà soát dữ liệu hiện hành."})
        self.assertEqual(opened.status_code, 200, opened.text)
        new_rec = opened.json()["reconciliation"]
        self.assertEqual((new_rec["status"], new_rec["version"], new_rec["source_current"],
                          new_rec["payable_microseconds"]), ("NEEDS_REVIEW", old_version + 1, False, 0))
        self.assertEqual((await self.conn.execute(text("""SELECT count(*) FROM v_overtime_verified_current
            WHERE request_id=:id"""), {"id": request_id})).scalar_one(), 0)
        stale_verify = await self.as_user(hr, "post", path + "/verify",
                                          json={"expected_version": new_rec["version"]})
        self.assertEqual(stale_verify.status_code, 409)
        self.assertEqual(stale_verify.json()["detail"]["code"], "OT_RECONCILIATION_STALE")
        refreshed = await self.as_user(hr, "post", path + "/preview")
        self.assertEqual(refreshed.json()["version"], old_version + 2)
        verified = await self.as_user(hr, "post", path + "/verify",
                                      json={"expected_version": refreshed.json()["version"]})
        self.assertEqual(verified.status_code, 200, verified.text)
        self.assertEqual(verified.json()["effective_status"], "VERIFIED")
        actions = (await self.conn.execute(text("""SELECT action FROM overtime_reconciliation_events
            WHERE request_id=:id ORDER BY event_id"""), {"id": request_id})).scalars().all()
        self.assertEqual(actions, ["PREVIEW", "REJECT", "REOPEN", "REFRESH", "VERIFY"])
        self.assertEqual((await self.conn.execute(text("""SELECT status FROM overtime_reconciliation_cases
            WHERE case_id=:id"""), {"id": case["case_id"]})).scalar_one(), "ACCEPTED")

    async def test_case_notifications_target_employee_hr_and_creator_with_case_deep_link(self):
        request_id, _ = await self.seed()
        manager = {"user_id": 2, "employee_id": 20, "store_id": 1, "roles": ["STORE_MANAGER"]}
        hr = {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]}
        employee = {"user_id": 3, "employee_id": 21, "store_id": 1, "roles": ["EMPLOYEE"]}
        outsider = {"user_id": 5, "employee_id": 30, "store_id": 2, "roles": ["EMPLOYEE"]}
        path = f"/overtime-reconciliations/{request_id}"
        preview = await self.as_user(hr, "post", path + "/preview")
        opened = await self.as_user(hr, "post", path + "/explanation-requests",
                                    json={"expected_version": preview.json()["version"],
                                          "reason": "Cần nhân viên bổ sung giải trình."})
        self.assertEqual(opened.status_code, 201, opened.text)
        case_id = opened.json()["case_id"]
        second_hr = {"user_id": 6, "employee_id": 23, "store_id": 1, "roles": ["HR_MANAGER"]}
        for recipient in (employee, manager, second_hr):
            notices = await operations.notifications(recipient, self.db)
            item = next((notice for notice in notices
                         if notice["id"].startswith("overtime-reconciliation-case-")
                         and notice.get("overtime_case_id") == case_id), None)
            self.assertIsNotNone(item, f"missing case notification for {recipient['roles']}")
            self.assertIn(f"request_id={request_id}", item["href"])
            self.assertIn(f"case_id={case_id}", item["href"])
        outsider_notices = await operations.notifications(outsider, self.db)
        self.assertFalse(any(notice.get("overtime_case_id") == case_id for notice in outsider_notices))


@unittest.skipUnless(LOCAL_VERIFIED, "Set an explicit loopback ot_cutover02_* test database URL")

class ReconciliationConcurrencyTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.clock = patch.object(
            overtime_reconciliations, "_utc_now",
            return_value=datetime(2035, 1, 1, tzinfo=timezone.utc),
        )
        self.clock.start()

    async def asyncTearDown(self):
        self.clock.stop()

    async def test_two_hr_verifications_create_one_decision_and_event(self):
        await self._two_hr_scenario(revocation_rejected=False)

    async def test_two_hr_after_rejected_revocation_create_one_decision(self):
        await self._two_hr_scenario(revocation_rejected=True)

    async def test_two_hr_accept_same_review_request_creates_one_reopen_version(self):
        engine = create_async_engine(LOCAL_URL, pool_pre_ping=True)
        try:
            async with engine.begin() as conn:
                day = (await conn.execute(text("""SELECT COALESCE(MAX(work_date),
                    DATE '2026-10-26') + 1 FROM overtime_requests WHERE employee_id=21"""))).scalar_one()
                day_text = day.isoformat()
                request_id = (await conn.execute(text("""INSERT INTO overtime_requests
                    (employee_id,store_id,work_date,starts_at,ends_at,reason,created_by,status,
                     reviewed_by,reviewed_at) VALUES(21,1,:day,:start,:end,
                     'Synthetic exception concurrency',2,'APPROVED',4,clock_timestamp()) RETURNING request_id"""), {
                         "day": day, "start": timestamp(f"{day_text}T17:00:00+07:00"),
                         "end": timestamp(f"{day_text}T19:00:00+07:00"),
                     })).scalar_one()
                context = {"schedule_status": "MATCHED", "planned": {
                    "store_id": 1, "shift_id": 8,
                    "starts_at": f"{day_text}T09:00:00+07:00",
                    "ends_at": f"{day_text}T17:00:00+07:00"}, "actual": {"shift_id": 8}}
                await conn.execute(text("""INSERT INTO attendances
                    (employee_id,store_id,shift_id,work_date,check_in_time,check_out_time,attendance_context)
                    VALUES(21,1,8,:day,:start,:end,CAST(:context AS jsonb))"""), {
                        "day": day, "start": timestamp(f"{day_text}T09:00:00+07:00"),
                        "end": timestamp(f"{day_text}T19:00:00+07:00"), "context": json.dumps(context),
                    })
            async with AsyncSession(engine, expire_on_commit=False) as session:
                preview = await overtime_reconciliations.preview_reconciliation(
                    request_id, user={"user_id": 4, "employee_id": 22, "store_id": 1,
                                      "roles": ["HR_MANAGER"]}, db=session)
            async with AsyncSession(engine, expire_on_commit=False) as session:
                rejected = await overtime_reconciliations.reject_reconciliation(
                    request_id, overtime_reconciliations.ReconciliationRejection(
                        expected_version=preview["version"], reason="Synthetic rejection for appeal."),
                    user={"user_id": 4, "employee_id": 22, "store_id": 1,
                          "roles": ["HR_MANAGER"]}, db=session)
            rejected_version = rejected["version"]
            async with AsyncSession(engine, expire_on_commit=False) as session:
                appeal = await overtime_reconciliations.create_review_request(
                    request_id, overtime_reconciliations.ReviewRequestCreate(
                        expected_reconciliation_version=rejected_version,
                        reason="Synthetic request to reopen."),
                    user={"user_id": 3, "employee_id": 21, "store_id": 1,
                          "roles": ["EMPLOYEE"]}, db=session)
            case_id = appeal["case_id"]

            async def accept(user_id, employee_id):
                async with AsyncSession(engine, expire_on_commit=False) as session:
                    try:
                        await overtime_reconciliations.decide_review_request(
                            request_id, case_id,
                            overtime_reconciliations.ReviewRequestDecision(
                                expected_case_version=1,
                                expected_reconciliation_version=rejected_version,
                                decision="ACCEPT", reason="Synthetic HR acceptance."),
                            user={"user_id": user_id, "employee_id": employee_id,
                                  "store_id": 1, "roles": ["HR_MANAGER"]}, db=session)
                        return 200
                    except HTTPException as exc:
                        await session.rollback()
                        return exc.status_code

            outcomes = await asyncio.gather(accept(4, 22), accept(6, 23))
            self.assertEqual(sorted(outcomes), [200, 409])
            async with engine.connect() as conn:
                reconciliation = (await conn.execute(text("""SELECT status,version,verified_microseconds
                    FROM overtime_reconciliations WHERE request_id=:id"""), {"id": request_id})).one()
                reopen_count = (await conn.execute(text("""SELECT count(*)
                    FROM overtime_reconciliation_events WHERE request_id=:id AND action='REOPEN'"""),
                    {"id": request_id})).scalar_one()
                accepted_event_count = (await conn.execute(text("""SELECT count(*)
                    FROM overtime_reconciliation_case_events WHERE case_id=:id AND action='REVIEW_ACCEPTED'"""),
                    {"id": case_id})).scalar_one()
            self.assertEqual(reconciliation, ("NEEDS_REVIEW", rejected_version + 1, None))
            self.assertEqual((reopen_count, accepted_event_count), (1, 1))
        finally:
            await engine.dispose()

    async def test_rec12d_source_mutation_wins_race_against_hr_verify(self):
        engine = create_async_engine(LOCAL_URL, pool_pre_ping=True)
        try:
            async with engine.begin() as conn:
                day = (await conn.execute(text("""SELECT COALESCE(MAX(work_date),
                    DATE '2026-10-26') + 1 FROM overtime_requests WHERE employee_id=21"""))).scalar_one()
                day_text = day.isoformat()
                starts_at = timestamp(f"{day_text}T18:00:00+07:00")
                ends_at = timestamp(f"{day_text}T20:00:00+07:00")
                context = {"schedule_status": "MATCHED",
                           "planned": {"store_id": 1, "shift_id": 8,
                                       "starts_at": f"{day_text}T09:00:00+07:00",
                                       "ends_at": f"{day_text}T17:00:00+07:00"},
                           "actual": {"shift_id": 8}}
                request_id = (await conn.execute(text("""INSERT INTO overtime_requests
                    (employee_id,store_id,work_date,starts_at,ends_at,reason,created_by,status,
                     reviewed_by,reviewed_at) VALUES(21,1,:day,:start,:end,
                     'REC-12 synthetic source race',2,'APPROVED',4,clock_timestamp())
                    RETURNING request_id"""), {
                    "day": day, "start": starts_at, "end": ends_at,
                })).scalar_one()
                attendance_id = (await conn.execute(text("""INSERT INTO attendances
                    (employee_id,store_id,shift_id,work_date,check_in_time,check_out_time,
                     attendance_context) VALUES(21,1,8,:day,:check_in,:check_out,
                     CAST(:context AS jsonb)) RETURNING attendance_id"""), {
                    "day": day, "check_in": timestamp(f"{day_text}T09:00:00+07:00"),
                    "check_out": ends_at, "context": json.dumps(context),
                })).scalar_one()

            hr = {"user_id": 4, "employee_id": 22, "store_id": 1,
                  "roles": ["HR_MANAGER"]}
            async with AsyncSession(engine, expire_on_commit=False) as session:
                preview = await overtime_reconciliations.preview_reconciliation(
                    request_id, user=hr, db=session)
            self.assertEqual(preview["proposed_microseconds"], 7_200_000_000)

            updater = await engine.connect()
            update_tx = await updater.begin()
            await updater.execute(text("""UPDATE attendances SET attendance_context =
                jsonb_set(attendance_context, '{planned,ends_at}',
                    to_jsonb(CAST(:new_end AS text)))
                WHERE attendance_id=:attendance"""), {
                "new_end": f"{day_text}T18:00:00+07:00",
                "attendance": attendance_id,
            })

            async def verify():
                async with AsyncSession(engine, expire_on_commit=False) as session:
                    try:
                        return await overtime_reconciliations._decide(
                            session, request_id, hr, preview["version"], "VERIFIED", None)
                    except HTTPException as error:
                        await session.rollback()
                        return error

            verify_task = asyncio.create_task(verify())
            await asyncio.sleep(0.2)
            self.assertFalse(verify_task.done(), "Verification must wait for the in-flight source mutation")
            await update_tx.commit()
            await updater.close()

            outcome = await verify_task
            self.assertIsInstance(outcome, HTTPException)
            self.assertEqual(outcome.status_code, 409)
            self.assertEqual(outcome.detail["code"], "OT_RECONCILIATION_STALE")

            async with AsyncSession(engine, expire_on_commit=False) as session:
                detail = await overtime_reconciliations.get_reconciliation(
                    request_id, user=hr, db=session)
                self.assertEqual(detail["effective_status"], "NEEDS_REVIEW")
                self.assertEqual(detail["payable_microseconds"], 0)
                self.assertEqual([event["action"] for event in detail["events"]], ["PREVIEW"])
        finally:
            await engine.dispose()

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
                    user={"user_id": 4, "employee_id": 22, "store_id": 1,
                          "roles": ["HR_MANAGER"]}, db=session)

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
