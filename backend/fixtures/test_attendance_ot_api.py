"""Local-only Attendance API -> OT reconciliation acceptance on synthetic PostgreSQL.

Run from backend with OT_MISSION9_ATTENDANCE_TEST=1 and the dedicated loopback
database configured explicitly. All writes are enclosed in a rolled-back transaction.
"""

from __future__ import annotations

import asyncio
import os
from datetime import date, datetime, time, timedelta, timezone
from ipaddress import ip_address
from urllib.parse import urlsplit
from unittest.mock import patch

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import auth, attendances, overtime_reconciliations, overtime_requests
from app.core.attendance import VIETNAM_TZ
from app.core.config import settings
from app.core.database import engine, get_db


EXPECTED_DATABASE = os.getenv("OT_MISSION9_TEST_DATABASE", "ot_cutover02_m9_full_e2e")
TEST_PASSWORD = "OT9-local-synthetic-only!"
# Database fixtures use future work dates; keep the reconciliation API clock
# deterministic so the E2E tests validate completed windows rather than today's date.
overtime_reconciliations._utc_now = lambda: datetime(2035, 1, 1, tzinfo=timezone.utc)


def _require_local_fixture() -> None:
    parsed = urlsplit(settings.DATABASE_URL)
    if (
        os.getenv("OT_MISSION9_ATTENDANCE_TEST") != "1"
        or not parsed.hostname
        or not ip_address(parsed.hostname).is_loopback
        or parsed.path.lstrip("/") != EXPECTED_DATABASE
        or settings.OT_REGISTRATION_POLICY_MODE != "DISABLED"
    ):
        raise RuntimeError(
            "Refusing Attendance E2E: requires explicit opt-in, the dedicated "
            "loopback synthetic DB, and OT policy DISABLED."
        )


def _expect(response: Response, status: int, label: str) -> dict:
    if response.status_code != status:
        raise AssertionError(
            f"{label}: expected HTTP {status}, got {response.status_code}: "
            f"{response.text[:500]}"
        )
    return response.json()


async def _identity_and_counts(connection) -> tuple[dict, tuple[int, ...]]:
    row = (await connection.execute(text("""SELECT current_database() AS database,
        inet_server_addr()::text AS address, pg_is_in_recovery() AS recovery"""))).mappings().one()
    database, address = row["database"], row["address"]
    if (database != EXPECTED_DATABASE or not address
            or not ip_address(address.split("/")[0]).is_loopback
            or row["recovery"]):
        raise RuntimeError("Refusing writes: connected PostgreSQL identity is not the local fixture.")

    fixture_actors = (await connection.execute(text("""SELECT count(*)
        FROM users u JOIN employees e USING(employee_id)
        WHERE (u.username,e.employee_id) IN (
            ('ot9_employee',21),('ot9_manager',20),('ot9_hr',22),('ot9_outsider',30))"""))).scalar_one()
    if fixture_actors != 4:
        raise RuntimeError("Refusing writes: expected synthetic Mission 9 actors are missing.")

    relations = (await connection.execute(text("""SELECT
        to_regclass('public.attendances') IS NOT NULL
        AND to_regclass('public.work_schedules') IS NOT NULL
        AND to_regclass('public.work_shifts') IS NOT NULL
        AND to_regclass('public.overtime_requests') IS NOT NULL
        AND to_regclass('public.overtime_reconciliations') IS NOT NULL
        AND to_regclass('public.overtime_reconciliation_events') IS NOT NULL
        AND to_regclass('public.v_overtime_verified_current') IS NOT NULL"""))).scalar_one()
    if not relations:
        raise RuntimeError("Refusing writes: required Attendance or OT fixture schema is incomplete.")

    counts = (await connection.execute(text("""SELECT
        (SELECT count(*) FROM attendances),
        (SELECT count(*) FROM work_schedules),
        (SELECT count(*) FROM overtime_requests),
        (SELECT count(*) FROM overtime_reconciliations),
        (SELECT count(*) FROM overtime_reconciliation_events),
        (SELECT count(*) FROM audit_logs)"""))).one()
    return dict(row), tuple(counts)


async def _next_synthetic_day(connection) -> date:
    row = (await connection.execute(text("""SELECT GREATEST(
        CURRENT_DATE + 3,
        COALESCE((SELECT max(work_date) FROM work_schedules), CURRENT_DATE) + 2,
        COALESCE((SELECT max(work_date) FROM overtime_requests), CURRENT_DATE) + 2,
        COALESCE((SELECT max(end_date) FROM leave_requests), CURRENT_DATE) + 2,
        COALESCE((SELECT max(check_out_time)::date FROM attendances), CURRENT_DATE) + 2
    ) AS day"""))).mappings().one()
    return row["day"]


async def _add_schedule(connection, work_date: date) -> None:
    starts_at = datetime.combine(work_date, time(9), VIETNAM_TZ)
    ends_at = datetime.combine(work_date, time(17), VIETNAM_TZ)
    await connection.execute(text("""INSERT INTO work_schedules
        (employee_id,store_id,shift_id,work_date,starts_at,ends_at)
        VALUES(21,1,8,:day,:starts_at,:ends_at)"""), {
        "day": work_date, "starts_at": starts_at, "ends_at": ends_at,
    })


async def _adapt_synthetic_attendance_schema(connection) -> list[str]:
    required_columns = {
        "early_minutes": "INTEGER NOT NULL DEFAULT 0",
        "actual_work_hours": "NUMERIC(8,2) NOT NULL DEFAULT 0",
        "overtime_hours": "NUMERIC(8,2) NOT NULL DEFAULT 0",
        "status": "VARCHAR(40) NOT NULL DEFAULT 'NORMAL'",
        "notes": "TEXT",
    }
    present = set((await connection.execute(text("""SELECT column_name
        FROM information_schema.columns
        WHERE table_schema='public' AND table_name='attendances'"""))).scalars())
    missing = [name for name in required_columns if name not in present]
    for name in missing:
        await connection.execute(text(
            f"ALTER TABLE public.attendances ADD COLUMN {name} {required_columns[name]}"
        ))
    return missing


async def _create_and_approve(client: AsyncClient, employee_headers: dict,
                              hr_headers: dict, work_date: date, key: str) -> int:
    payload = {
        "work_date": work_date.isoformat(),
        "start_time": "18:00",
        "end_time": "20:00",
        "reason": "Synthetic Attendance API integration acceptance",
    }
    headers = {**employee_headers, "Idempotency-Key": key}
    created = _expect(await client.post("/api/v1/overtime-requests",
                                        json=payload, headers=headers), 201, f"{key}-CREATE")
    retried = _expect(await client.post("/api/v1/overtime-requests",
                                        json=payload, headers=headers), 201, f"{key}-RETRY")
    request_id = created["request_id"]
    assert retried["request_id"] == request_id, "Idempotent retry created another OT request"
    _expect(await client.post(f"/api/v1/overtime-requests/{request_id}/submit",
                              headers=employee_headers), 200, f"{key}-SUBMIT")
    approved = _expect(await client.post(f"/api/v1/overtime-requests/{request_id}/approve",
                                         headers=hr_headers), 200, f"{key}-APPROVE")
    assert approved["status"] == "APPROVED", approved
    return request_id


async def main() -> None:
    _require_local_fixture()

    async with engine.connect() as preflight:
        async with preflight.begin():
            await preflight.execute(text("SET TRANSACTION READ ONLY"))
            await _identity_and_counts(preflight)

    async with engine.connect() as connection:
        transaction = await connection.begin()
        try:
            await _identity_and_counts(connection)
            missing_attendance_columns = await _adapt_synthetic_attendance_schema(connection)
            base_day = await _next_synthetic_day(connection)

            # The local OT fixture predates the complete Attendance schema.
            # Missing columns and an absent network table are transaction-scoped
            # adapters; this is not deployment-schema evidence.
            if missing_attendance_columns:
                print("TEST_SCHEMA_ADAPTER: transaction-only Attendance columns added: "
                      + ", ".join(missing_attendance_columns))
            network_table_exists = (await connection.execute(text(
                "SELECT to_regclass('public.store_web_attendance_networks') IS NOT NULL"
            ))).scalar_one()
            if network_table_exists:
                print("PASS SCHEMA: web-network table from migration 20261012 is installed")
            else:
                await connection.execute(text("""CREATE TEMP TABLE store_web_attendance_networks (
                    store_id INTEGER NOT NULL, network CIDR NOT NULL
                ) ON COMMIT DROP"""))
                print("TEST_SCHEMA_ADAPTER: temporary empty web-network table; "
                      "migration 20261012 is not installed in this fixture")
            for offset in (0, 1, 2):
                await _add_schedule(connection, base_day + timedelta(days=offset))

            app = FastAPI()
            app.include_router(auth.router, prefix="/api/v1/auth")
            app.include_router(attendances.router, prefix="/api/v1/attendances")
            app.include_router(overtime_requests.router, prefix="/api/v1/overtime-requests")
            app.include_router(overtime_reconciliations.router,
                               prefix="/api/v1/overtime-reconciliations")

            async def test_db():
                async with AsyncSession(
                    bind=connection, join_transaction_mode="create_savepoint",
                    expire_on_commit=False,
                ) as session:
                    yield session

            app.dependency_overrides[get_db] = test_db
            transport = ASGITransport(app=app, client=("127.0.0.1", 52000))
            async with AsyncClient(transport=transport, base_url="http://127.0.0.1") as client:
                actors: dict[str, dict] = {}
                for actor in ("employee", "manager", "hr", "outsider"):
                    login = _expect(await client.post("/api/v1/auth/login", json={
                        "username": f"ot9_{actor}", "password": TEST_PASSWORD,
                    }), 200, f"AUTH-{actor}")
                    headers = {"Authorization": f"Bearer {login['access_token']}"}
                    profile = _expect(await client.get("/api/v1/auth/me", headers=headers),
                                      200, f"ME-{actor}")
                    assert profile["roles"] == login["roles"]
                    actors[actor] = headers
                print("PASS AUTH: real login, JWT validation, /auth/me for Employee, Manager, HR, outsider")

                work_date = base_day
                request_id = await _create_and_approve(
                    client, actors["employee"], actors["hr"], work_date, "m9-att-api-main"
                )

                # Cross-store employee targeting is denied before any Attendance write.
                check_in_at = datetime.combine(work_date, time(17, 59), VIETNAM_TZ)
                with patch.object(attendances, "local_now", return_value=check_in_at):
                    denied = await client.post("/api/v1/attendances/check-in",
                        json={"employee_id": 30, "shift_id": 8}, headers=actors["employee"])
                    assert denied.status_code == 403, denied.text

                    started = _expect(await client.post("/api/v1/attendances/check-in",
                        json={"shift_id": 8}, headers=actors["employee"]), 201, "ATT-CHECK-IN")
                    assert started["schedule_status"] == "MATCHED", started
                    attendance_id = started["attendance_id"]

                    manager_proxy_checkout = await client.post(
                        "/api/v1/attendances/check-out",
                        json={"attendance_id": attendance_id},
                        headers=actors["manager"],
                    )
                    assert manager_proxy_checkout.status_code == 403, manager_proxy_checkout.text
                    still_open = (await connection.execute(text(
                        "SELECT check_out_time FROM attendances WHERE attendance_id=:id"
                    ), {"id": attendance_id})).scalar_one()
                    assert still_open is None, "A denied proxy checkout must leave Attendance unchanged"

                    duplicate_in = await client.post("/api/v1/attendances/check-in",
                        json={"shift_id": 8}, headers=actors["employee"])
                    assert duplicate_in.status_code == 409, duplicate_in.text

                history = _expect(await client.get(
                    f"/api/v1/attendances/my-history?period={work_date:%Y-%m}",
                    headers=actors["employee"]), 200, "ATT-HISTORY-OPEN")
                assert any(row["attendance_id"] == attendance_id
                           and row["check_out_time"] is None for row in history)

                check_out_at = datetime.combine(work_date, time(20), VIETNAM_TZ)
                with patch.object(attendances, "local_now", return_value=check_out_at):
                    closed = _expect(await client.post("/api/v1/attendances/check-out",
                        json={}, headers=actors["employee"]), 200, "ATT-CHECK-OUT")
                    assert closed["attendance_id"] == attendance_id
                    duplicate_out = await client.post("/api/v1/attendances/check-out",
                        json={"attendance_id": attendance_id}, headers=actors["employee"])
                    assert duplicate_out.status_code == 409, duplicate_out.text

                checked = _expect(await client.get(
                    f"/api/v1/attendances/my-history?period={work_date:%Y-%m}",
                    headers=actors["employee"]), 200, "ATT-HISTORY-CLOSED")
                actual = next(row for row in checked if row["attendance_id"] == attendance_id)
                assert actual["check_in_time"] and actual["check_out_time"]
                assert actual["attendance_context"]["schedule_status"] == "MATCHED"
                assert actual["attendance_context"]["planned"]["starts_at"]
                assert actual["attendance_context"]["actual"]["shift_id"] == 8
                print("PASS ATT-01: API-created Attendance check-in/out, MATCHED snapshot, retry conflicts, history")

                preview = _expect(await client.post(
                    f"/api/v1/overtime-reconciliations/{request_id}/preview",
                    headers=actors["hr"]), 200, "REC-PREVIEW")
                assert preview["proposed_microseconds"] == 7_200_000_000, preview
                assert preview["review_issues"] == [], preview
                assert len(preview["attendance_ids"]) == 1
                employee_verify = await client.post(
                    f"/api/v1/overtime-reconciliations/{request_id}/verify",
                    json={"expected_version": preview["version"]},
                    headers=actors["employee"])
                assert employee_verify.status_code == 403, employee_verify.text
                verified = _expect(await client.post(
                    f"/api/v1/overtime-reconciliations/{request_id}/verify",
                    json={"expected_version": preview["version"]},
                    headers=actors["hr"]), 200, "REC-VERIFY")
                assert verified["effective_status"] == "VERIFIED"
                assert verified["verified_microseconds"] == 7_200_000_000
                assert verified["payable_microseconds"] == 7_200_000_000
                print("PASS ATT-02: real reconciliation API VERIFIED exactly 2h; Employee verify denied")

                missing_day = base_day + timedelta(days=3)
                missing_id = await _create_and_approve(
                    client, actors["employee"], actors["hr"], missing_day, "m9-att-api-missing"
                )
                missing_preview = _expect(await client.post(
                    f"/api/v1/overtime-reconciliations/{missing_id}/preview",
                    headers=actors["hr"]), 200, "REC-MISSING-PREVIEW")
                assert "NO_ATTENDANCE" in missing_preview["review_issues"], missing_preview
                missing_verify = await client.post(
                    f"/api/v1/overtime-reconciliations/{missing_id}/verify",
                    json={"expected_version": missing_preview["version"]},
                    headers=actors["hr"])
                assert missing_verify.status_code == 409, missing_verify.text
                print("PASS ATT-03: missing Attendance fails closed; no payable hours can be verified")

                open_day = base_day + timedelta(days=1)
                open_id = await _create_and_approve(
                    client, actors["employee"], actors["hr"], open_day, "m9-att-api-open"
                )
                open_at = datetime.combine(open_day, time(17, 59), VIETNAM_TZ)
                with patch.object(attendances, "local_now", return_value=open_at):
                    open_row = _expect(await client.post("/api/v1/attendances/check-in",
                        json={"shift_id": 8}, headers=actors["employee"]), 201, "ATT-OPEN-CHECK-IN")
                open_preview = _expect(await client.post(
                    f"/api/v1/overtime-reconciliations/{open_id}/preview",
                    headers=actors["hr"]), 200, "REC-OPEN-PREVIEW")
                assert open_preview["proposed_microseconds"] == 0, open_preview
                assert any(issue in open_preview["review_issues"] for issue in (
                    "INVALID_OR_OPEN_ATTENDANCE_SNAPSHOT", "ATTENDANCE_CHECKOUT_MISSING",
                    "NO_ATTENDANCE"
                )), open_preview
                open_verify = await client.post(
                    f"/api/v1/overtime-reconciliations/{open_id}/verify",
                    json={"expected_version": open_preview["version"]},
                    headers=actors["hr"])
                assert open_verify.status_code == 409, open_verify.text
                open_close_at = datetime.combine(open_day, time(20), VIETNAM_TZ)
                with patch.object(attendances, "local_now", return_value=open_close_at):
                    _expect(await client.post("/api/v1/attendances/check-out",
                        json={"attendance_id": open_row["attendance_id"]},
                        headers=actors["employee"]), 200, "ATT-OPEN-CHECK-OUT")
                refreshed = _expect(await client.post(
                    f"/api/v1/overtime-reconciliations/{open_id}/preview",
                    headers=actors["hr"]), 200, "REC-OPEN-REFRESH")
                assert refreshed["proposed_microseconds"] == 7_200_000_000, refreshed
                open_verified = _expect(await client.post(
                    f"/api/v1/overtime-reconciliations/{open_id}/verify",
                    json={"expected_version": refreshed["version"]},
                    headers=actors["hr"]), 200, "REC-OPEN-VERIFY")
                assert open_verified["verified_microseconds"] == 7_200_000_000
                print("PASS ATT-04: open Attendance is fail-closed; checkout then refresh enables 2h verification")

                # NO_PROXY applies to Manager writes too; the role can still record
                # its own attendance when its authenticated account maps to an employee.
                manager_day = base_day + timedelta(days=2)
                manager_at = datetime.combine(manager_day, time(17, 59), VIETNAM_TZ)
                before_manager_proxy = (await connection.execute(text(
                    "SELECT count(*) FROM attendances WHERE employee_id=21"
                ))).scalar_one()
                with patch.object(attendances, "local_now", return_value=manager_at):
                    denied_proxy = await client.post("/api/v1/attendances/check-in",
                        json={"employee_id": 21, "shift_id": 8},
                        headers=actors["manager"])
                    assert denied_proxy.status_code == 403, denied_proxy.text
                after_manager_proxy = (await connection.execute(text(
                    "SELECT count(*) FROM attendances WHERE employee_id=21"
                ))).scalar_one()
                assert after_manager_proxy == before_manager_proxy, "Denied proxy check-in wrote Attendance"

                with patch.object(attendances, "local_now", return_value=manager_at):
                    manager_self = _expect(await client.post("/api/v1/attendances/check-in",
                        json={"shift_id": 8}, headers=actors["manager"]), 201,
                        "ATT-MANAGER-SELF-CHECK-IN")
                owner = (await connection.execute(text(
                    "SELECT employee_id FROM attendances WHERE attendance_id=:id"
                ), {"id": manager_self["attendance_id"]})).scalar_one()
                assert owner == 20, f"Manager self check-in was recorded for employee {owner}"
                manager_checkout = datetime.combine(manager_day, time(20), VIETNAM_TZ)
                with patch.object(attendances, "local_now", return_value=manager_checkout):
                    _expect(await client.post("/api/v1/attendances/check-out",
                        json={"attendance_id": manager_self["attendance_id"]},
                        headers=actors["manager"]), 200, "ATT-MANAGER-SELF-CHECK-OUT")
                outsider_read = await client.get(
                    f"/api/v1/overtime-requests/{request_id}",
                    headers=actors["outsider"])
                assert outsider_read.status_code == 404, outsider_read.text
                print("PASS NO_PROXY: Manager proxy check-in/out returned 403 without writes; Manager self check-in/out succeeded")

                persisted = (await connection.execute(text("""SELECT a.check_in_time,a.check_out_time,
                    a.attendance_context,r.status,r.verified_microseconds,
                    (SELECT array_agg(e.action ORDER BY e.event_id)
                     FROM overtime_reconciliation_events e WHERE e.request_id=:request) AS actions
                    FROM attendances a JOIN overtime_reconciliations r ON r.request_id=:request
                    WHERE a.attendance_id=:attendance AND r.request_id=:request"""), {
                    "attendance": attendance_id, "request": request_id,
                })).mappings().first()
                assert persisted and persisted["check_in_time"] and persisted["check_out_time"]
                assert persisted["status"] == "VERIFIED"
                assert persisted["verified_microseconds"] == 7_200_000_000
                assert persisted["actions"] == ["PREVIEW", "VERIFY"]
        finally:
            await transaction.rollback()

    async with engine.connect() as verification:
        async with verification.begin():
            await verification.execute(text("SET TRANSACTION READ ONLY"))
            _, after_counts = await _identity_and_counts(verification)
            if after_counts != _before_counts:
                raise AssertionError(
                    f"Fixture rows were not rolled back: before={_before_counts}, after={after_counts}"
                )
    await engine.dispose()
    print("PASS ROLLBACK: synthetic Attendance, OT, reconciliation and audit rows left no persistent changes")


if __name__ == "__main__":
    _require_local_fixture()
    _before_counts: tuple[int, ...]

    async def _run() -> None:
        global _before_counts
        _require_local_fixture()
        async with engine.connect() as connection:
            async with connection.begin():
                await connection.execute(text("SET TRANSACTION READ ONLY"))
                _, _before_counts = await _identity_and_counts(connection)
        await main()

    asyncio.run(_run())
