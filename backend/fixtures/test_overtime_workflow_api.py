"""Real HTTP/auth/OT/reconciliation acceptance on a dedicated loopback synthetic DB."""

from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from uuid import uuid4

import httpx
import psycopg
import os


ORIGIN = "http://127.0.0.1:55993"
API = f"{ORIGIN}/api/v1"
TEST_DATABASE = os.getenv("OT_MISSION9_TEST_DATABASE", "ot_cutover02_m9_full_e2e")
if not TEST_DATABASE.startswith("ot_cutover02_m9_") or not TEST_DATABASE.replace("_", "").isalnum():
    raise RuntimeError("OT_MISSION9_TEST_DATABASE must use the isolated ot_cutover02_m9_* namespace")
DB = f"postgresql://postgres@127.0.0.1:5432/{TEST_DATABASE}"
PASSWORD = "OT9-local-synthetic-only!"


def expect(response: httpx.Response, status: int, label: str) -> dict:
    if response.status_code != status:
        raise AssertionError(f"{label}: HTTP {response.status_code}: {response.text[:400]}")
    return response.json()


def main() -> None:
    health = httpx.get(f"{ORIGIN}/fixture/health", timeout=10).json()
    assert health == {"database": TEST_DATABASE, "policy": "DISABLED"}
    today = (datetime.now(timezone.utc) + timedelta(hours=7)).date()
    with psycopg.connect(DB) as db:
        latest_day = db.execute("""SELECT GREATEST(
            COALESCE((SELECT max(work_date) FROM work_schedules), DATE '2000-01-01'),
            COALESCE((SELECT max(work_date) FROM overtime_requests), DATE '2000-01-01'))""").fetchone()[0]
    work_day = max(today + timedelta(days=5), latest_day + timedelta(days=3))
    later_day = work_day + timedelta(days=2)
    vn = timezone(timedelta(hours=7))
    with httpx.Client(base_url=API, timeout=20) as client:
        actors = {}
        for role in ("employee", "manager", "hr", "admin", "outsider", "second_hr"):
            login = expect(client.post("/auth/login", json={
                "username": f"ot9_{role}", "password": PASSWORD,
            }), 200, f"AUTH-{role}")
            actors[role] = {"Authorization": f"Bearer {login['access_token']}"}
            profile = expect(client.get("/auth/me", headers=actors[role]), 200, f"ME-{role}")
            assert profile["roles"] == login["roles"]
        print("PASS AUTH-01: six real logins, JWT and /auth/me via synthetic PostgreSQL")

        data = {"work_date": work_day.isoformat(), "start_time": "18:00",
                "end_time": "20:00", "reason": "Synthetic store inventory"}
        headers = {**actors["employee"], "Idempotency-Key": f"ot9-self-{uuid4().hex}"}
        created = expect(client.post("/overtime-requests", json=data, headers=headers),
                         201, "SELF-CREATE")
        request_id = created["request_id"]
        duplicate = expect(client.post("/overtime-requests", json=data, headers=headers),
                           201, "SELF-RETRY")
        assert duplicate["request_id"] == request_id
        assert expect(client.post(f"/overtime-requests/{request_id}/submit",
                                  headers=actors["employee"]), 200, "SELF-SUBMIT")["status"] == "PENDING_HR"
        assert client.post(f"/overtime-requests/{request_id}/approve",
                           headers=actors["employee"]).status_code == 403
        assert client.get(f"/overtime-requests/{request_id}",
                          headers=actors["outsider"]).status_code == 404
        approved = expect(client.post(f"/overtime-requests/{request_id}/approve",
                                      headers=actors["hr"]), 200, "SELF-APPROVE")
        assert approved["status"] == "APPROVED"
        print(f"PASS OT-SELF-01: create/submit/HR approve, retry and RBAC request={request_id}")

        attendance = expect(httpx.post(f"{ORIGIN}/fixture/attendance",
                                       json={"request_id": request_id}, timeout=10),
                            200, "ATTENDANCE-SEED")
        assert attendance["request_id"] == request_id
        expect(httpx.post(f"{ORIGIN}/fixture/test-clock", json={
            "value": datetime.combine(work_day, time(20, 1), vn).isoformat(),
        }, timeout=10), 200, "CLOCK-SELF-OT-COMPLETE")
        preview = expect(client.post(f"/overtime-reconciliations/{request_id}/preview",
                                     headers=actors["hr"]), 200, "REC-PREVIEW")
        assert preview["proposed_microseconds"] == 7_200_000_000, preview
        verified = expect(client.post(f"/overtime-reconciliations/{request_id}/verify",
                                    json={"expected_version": preview["version"]},
                                    headers=actors["hr"]), 200, "REC-VERIFY")
        assert verified["effective_status"] == "VERIFIED", verified
        assert verified["verified_microseconds"] == 7_200_000_000
        state = httpx.get(f"{ORIGIN}/fixture/state/{request_id}", timeout=10).json()
        assert state["reconciliation"]["status"] == "VERIFIED"
        assert [item["action"] for item in state["events"]] == ["CREATE", "SUBMIT", "APPROVE"]
        print("PASS OT-SELF-02: Attendance snapshot -> preview -> VERIFIED 2h, version/event")

        manager_data = {**data, "work_date": later_day.isoformat(),
                        "employee_id": 21, "store_id": 1,
                        "reason": "Synthetic manager request"}
        denied = client.post("/overtime-requests", json={**manager_data, "employee_id": 30,
                                                           "store_id": 2}, headers=actors["manager"])
        assert denied.status_code == 403, denied.text
        proposal = expect(client.post("/overtime-requests", json=manager_data,
                                      headers=actors["manager"]), 201, "MANAGER-CREATE")
        manager_id = proposal["request_id"]
        pending = expect(client.post(f"/overtime-requests/{manager_id}/submit",
                                     headers=actors["manager"]), 200, "MANAGER-SUBMIT")
        assert pending["status"] == "PENDING_EMPLOYEE_CONFIRMATION"
        assert client.post(f"/overtime-requests/{manager_id}/approve",
                           headers=actors["hr"]).status_code == 409
        notices = expect(client.get("/operations/notifications",
                                    headers=actors["employee"]), 200, "EMPLOYEE-NOTICES")
        assert any(f"request_id={manager_id}" in item.get("href", "") for item in notices)
        confirmed = expect(client.post(f"/overtime-requests/{manager_id}/employee-confirm",
                                       headers=actors["employee"]), 200, "EMPLOYEE-CONFIRM")
        assert confirmed["status"] == "PENDING_HR"
        hr_notices = expect(client.get("/operations/notifications",
                                       headers=actors["hr"]), 200, "HR-NOTICES")
        assert any(f"request_id={manager_id}" in item.get("href", "") for item in hr_notices)
        assert expect(client.post(f"/overtime-requests/{manager_id}/approve",
                                  headers=actors["hr"]), 200, "MANAGER-APPROVE")["status"] == "APPROVED"
        expect(httpx.post(f"{ORIGIN}/fixture/attendance", json={"request_id": manager_id},
                          timeout=10), 200, "MANAGER-ATTENDANCE")
        expect(httpx.post(f"{ORIGIN}/fixture/test-clock", json={
            "value": datetime.combine(later_day, time(20, 1), vn).isoformat(),
        }, timeout=10), 200, "CLOCK-MANAGER-OT-COMPLETE")
        manager_preview = expect(client.post(f"/overtime-reconciliations/{manager_id}/preview",
                                             headers=actors["hr"]), 200, "MANAGER-PREVIEW")
        assert manager_preview["proposed_microseconds"] == 7_200_000_000
        manager_verified = expect(client.post(f"/overtime-reconciliations/{manager_id}/verify",
                                              json={"expected_version": manager_preview["version"]},
                                              headers=actors["hr"]), 200, "MANAGER-VERIFY")
        assert manager_verified["effective_status"] == "VERIFIED"
        print(f"PASS OT-MANAGER-01: proposal -> notification -> employee confirm -> HR -> VERIFIED request={manager_id}")

    with psycopg.connect(DB) as db:
        database, address = db.execute("SELECT current_database(),inet_server_addr()::text").fetchone()
        assert database == TEST_DATABASE and address.startswith("127.0.0.1/")
        assert db.execute("SELECT count(*) FROM v_overtime_verified_current WHERE request_id IN (%s,%s)",
                          (request_id, manager_id)).fetchone()[0] == 2
        legacy_exists = db.execute(
            "SELECT to_regclass('public.attendance_overtime_approvals') IS NOT NULL"
        ).fetchone()[0]
        if legacy_exists:
            assert db.execute("SELECT count(*) FROM attendance_overtime_approvals").fetchone()[0] == 0
        print(f"PASS DB-01: two current VERIFIED sources; legacy table present={legacy_exists}, no legacy rows in fixture")
    httpx.post(f"{ORIGIN}/fixture/test-clock", json={"value": None}, timeout=10)


if __name__ == "__main__":
    main()
