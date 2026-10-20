"""Checkpoint 44 local-only lock, freshness, and run-lifecycle acceptance.

Uses the existing marked schema-only PostgreSQL clone harness. The tested API
is a review candidate; no production router, .env, cloud DB, or Git is used.
"""
from __future__ import annotations

import hashlib
import json
import socket
import subprocess
import sys
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from pathlib import Path

import httpx
import psycopg
import uvicorn

import test_ot_segment_ledger_candidate as ledger
import test_payroll_v2_api_candidate as cp43
from payroll_v2_api_candidate import create_app


ROOT = Path(__file__).resolve().parent
PG = Path(r"C:\Program Files\PostgreSQL\17\bin")
DB = ledger.DB
API_SOURCE = ROOT / "payroll_v2_api_candidate.py"
SQL_SOURCE = ROOT / "payroll_v2_checkpoint44_lifecycle.sql"
TEST_SOURCE = Path(__file__)
YEAR = 2050
CONTROL = {"period": None, "entered": None, "release": None, "enabled": False}
RESULT = {"app": None, "server": None, "thread": None, "port": None,
          "runs": {}, "attendance": {}, "api_started": False}
OBSERVED = {}


def run_local(args):
    done = subprocess.run([str(v) for v in args], capture_output=True, text=True,
                          encoding="utf-8", errors="replace", timeout=45)
    if done.returncode:
        raise RuntimeError(f"Synthetic local command failed: {Path(str(args[0])).name}: {done.stderr[-2000:]}")


def start_server():
    def hook(operation: str, period: str):
        if CONTROL["enabled"] and operation == "confirm" and period == CONTROL["period"]:
            CONTROL["entered"].set()
            if not CONTROL["release"].wait(timeout=10):
                raise RuntimeError("Checkpoint 44 concurrency hook timed out")

    RESULT["app"] = create_app(DB, cp43.SECRET, after_source_locks=hook,
                               lock_strategy="serializable", lifecycle_enabled=True)
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    RESULT["port"] = sock.getsockname()[1]
    sock.close()
    cp43.ApiState.port = RESULT["port"]
    RESULT["server"] = uvicorn.Server(uvicorn.Config(
        RESULT["app"], host="127.0.0.1", port=RESULT["port"],
        log_level="error", access_log=False))
    RESULT["thread"] = threading.Thread(target=RESULT["server"].run,
                                        name="payroll-v2-cp44-candidate", daemon=True)
    RESULT["thread"].start()
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        try:
            response = httpx.get(f"http://127.0.0.1:{RESULT['port']}/api/v1/payroll-v2-candidate/health",
                                 timeout=1, trust_env=False)
            if response.status_code == 200:
                expected = {"status": "local_candidate", "database": DB,
                            "host": "127.0.0.1", "port": 5432}
                if response.json() != expected:
                    raise RuntimeError("Candidate API health returned unexpected DB identity")
                RESULT["api_started"] = True
                return
        except httpx.HTTPError:
            pass
        time.sleep(.05)
    raise RuntimeError("Checkpoint 44 loopback API did not start")


def stop_server():
    if RESULT["server"]:
        RESULT["server"].should_exit = True
    if RESULT["thread"]:
        RESULT["thread"].join(timeout=10)
        if RESULT["thread"].is_alive():
            raise RuntimeError("Refusing database cleanup while API server is alive")


def api(method, path, username, body=None):
    if path.startswith(("payrolls/", "payroll/")):
        route = f"/api/v1/{path}"
    else:
        route = f"/api/v1/payroll-v2-candidate/{path}"
    return cp43.request(method, route, username, body)


def counts(period: str):
    with ledger.connect() as db:
        return db.execute("""SELECT
            (SELECT count(*) FROM payrolls WHERE salary_period=%s),
            (SELECT count(*) FROM payroll_details d JOIN payrolls p USING(payroll_id) WHERE p.salary_period=%s),
            (SELECT count(*) FROM payroll_finalization_snapshots WHERE salary_period=%s),
            (SELECT count(*) FROM audit_logs WHERE entity_name='payroll_periods' AND entity_id=%s)""",
            (period, period, period, period)).fetchone()


def snapshots(period: str):
    with ledger.connect() as db:
        return db.execute("""SELECT payroll_id,finalized_status,payment_date,revision,
                                   payroll_snapshot,details_snapshot
                              FROM payroll_finalization_snapshots
                             WHERE salary_period=%s ORDER BY payroll_id,revision""", (period,)).fetchall()


class Checkpoint44Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ledger.LedgerTests.setUpClass()
        cp43.seed_auth()
        for month in (5, 6, 7, 8, 9):
            run_id, attendance_id = cp43.prepare_source_run(month)
            RESULT["runs"][month] = run_id
            RESULT["attendance"][month] = attendance_id
        start_server()

    @classmethod
    def tearDownClass(cls):
        stop_server()

    def test_01_serializable_confirm_does_not_block_attendance_writer(self):
        period = f"{YEAR}-05"
        run_id = RESULT["runs"][5]
        calculated = api("POST", "payrolls/candidate/calculate", "synthetic_creator",
                         {"salary_period": period, "source_run_id": run_id})
        self.assertEqual(calculated.status_code, 200, calculated.text)

        CONTROL.update(period=period, entered=threading.Event(), release=threading.Event(), enabled=True)
        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                confirm = pool.submit(api, "POST", "payrolls/candidate/confirm-all",
                                      "synthetic_payroll_reviewer_hr",
                                      {"salary_period": period, "source_run_id": run_id})
                self.assertTrue(CONTROL["entered"].wait(timeout=5), "Confirm did not reach source-read barrier")
                writer_started = threading.Event()
                writer_pid = []

                def attendance_writer():
                    with ledger.connect(autocommit=False) as db:
                        writer_pid.append(db.info.backend_pid)
                        writer_started.set()
                        db.execute("UPDATE attendances SET early_minutes=early_minutes+1 WHERE attendance_id=%s",
                                   (RESULT["attendance"][5],))
                        db.commit()

                writer = pool.submit(attendance_writer)
                self.assertTrue(writer_started.wait(timeout=3))
                writer.result(timeout=3)
                OBSERVED["attendance_writer_committed_while_confirm_paused"] = True
                with ledger.connect() as observer:
                    self.assertEqual(observer.execute(
                        "SELECT cardinality(pg_blocking_pids(%s))", (writer_pid[0],)).fetchone()[0], 0,
                        "Attendance writer must not be blocked by a relation SHARE lock")
                CONTROL["release"].set()
                confirm_response = confirm.result(timeout=15)
                OBSERVED["attendance_race_confirm_http"] = confirm_response.status_code
                self.assertIn(confirm_response.status_code, (200, 409), confirm_response.text)
                if confirm_response.status_code == 409:
                    self.assertIn(confirm_response.json()["detail"]["code"],
                                  {"PAYROLL_CONCURRENT_SOURCE_CHANGE", "OT_SOURCE_HOLD_OR_STALE"})
                    self.assertEqual(counts(period)[2], 0, "Rejected concurrent confirm wrote a finalization snapshot")
                else:
                    self.assertEqual(confirm_response.json()["status"], "CONFIRMED")
                    self.assertEqual(confirm_response.json()["source_state"], "CONFIRMED_STALE")
                    self.assertTrue(confirm_response.json()["payment_hold"])
                    refresh = api("POST", f"runs/{run_id}/refresh", "synthetic_payroll_reviewer_hr", {})
                    self.assertEqual(refresh.status_code, 200, refresh.text)
                    self.assertEqual(refresh.json()["state"], "CONFIRMED_STALE")
                    OBSERVED["attendance_race_effective_state"] = refresh.json()["state"]
                    paid = api("POST", "payrolls/candidate/pay-all", "synthetic_payroll_reviewer_hr",
                               {"salary_period": period})
                    self.assertEqual(paid.status_code, 409, paid.text)
                    self.assertEqual(paid.json()["detail"]["code"], "PAYROLL_CONFIRMED_SOURCE_STALE_HOLD")
                    frozen = snapshots(period)
                    refreshed_again = api("POST", f"runs/{run_id}/refresh", "synthetic_payroll_reviewer_hr", {})
                    self.assertEqual(refreshed_again.json()["state"], "CONFIRMED_STALE")
                    self.assertEqual(snapshots(period), frozen, "Finalization snapshot changed after stale recheck")
        finally:
            CONTROL["enabled"] = False
            if CONTROL["release"]:
                CONTROL["release"].set()

    def test_02_confirmed_source_stale_is_sticky_and_snapshot_is_immutable(self):
        period = f"{YEAR}-08"
        run_id = RESULT["runs"][8]
        calculated = api("POST", "payrolls/candidate/calculate", "synthetic_creator",
                         {"salary_period": period, "source_run_id": run_id})
        self.assertEqual(calculated.status_code, 200, calculated.text)
        confirmed = api("POST", "payrolls/candidate/confirm-all", "synthetic_payroll_reviewer_hr",
                        {"salary_period": period, "source_run_id": run_id})
        self.assertEqual(confirmed.status_code, 200, confirmed.text)
        self.assertEqual(confirmed.json()["source_state"], "CONFIRMED")
        self.assertFalse(confirmed.json()["payment_hold"])
        frozen = snapshots(period)
        with ledger.connect() as db:
            db.execute("UPDATE attendances SET late_minutes=late_minutes+1 WHERE attendance_id=%s",
                       (RESULT["attendance"][8],))
        refreshed = api("POST", f"runs/{run_id}/refresh", "synthetic_payroll_reviewer_hr", {})
        self.assertEqual(refreshed.status_code, 200, refreshed.text)
        self.assertEqual(refreshed.json()["state"], "CONFIRMED_STALE")
        status = api("GET", f"runs/{run_id}/status", "synthetic_payroll_reviewer_hr")
        self.assertEqual(status.status_code, 200, status.text)
        self.assertEqual(status.json()["effective_state"], "CONFIRMED_STALE")
        paid = api("POST", "payroll/candidate/pay-all", "synthetic_payroll_reviewer_director",
                   {"salary_period": period})
        self.assertEqual(paid.status_code, 409, paid.text)
        self.assertEqual(paid.json()["detail"]["code"], "PAYROLL_CONFIRMED_SOURCE_STALE_HOLD")
        self.assertEqual(snapshots(period), frozen, "Staleness must not mutate confirmed snapshots")
        self.assertEqual(counts(period)[0], 2)

    def test_03_stale_prepared_run_invalidation_releases_reservation_and_allows_replacement(self):
        period = f"{YEAR}-06"
        stale_id = RESULT["runs"][6]
        with ledger.connect() as db:
            db.execute("UPDATE attendances SET late_minutes=late_minutes+1 WHERE attendance_id=%s",
                       (RESULT["attendance"][6],))
        status = api("GET", f"runs/{stale_id}/status", "synthetic_payroll_reviewer_hr")
        self.assertEqual(status.status_code, 200, status.text)
        self.assertEqual(status.json()["effective_state"], "STALE")
        refreshed = api("POST", f"runs/{stale_id}/refresh", "synthetic_payroll_reviewer_hr", {})
        self.assertEqual(refreshed.status_code, 200, refreshed.text)
        self.assertEqual(refreshed.json()["state"], "STALE")

        # Model upstream HR re-verification on synthetic rows only: refresh the
        # source signature after the Attendance correction. This is fixture SQL,
        # not an OT API or production verification test.
        with ledger.connect() as db:
            db.execute("""UPDATE overtime_reconciliations r
                            SET source_signature=ot_reconciliation_source_signature(r.request_id)
                           FROM overtime_requests o
                          WHERE o.request_id=r.request_id AND o.work_date>=DATE '2050-06-01'
                            AND o.work_date<DATE '2050-07-01'""")
        source_fixture = ledger.LedgerTests("test_01_exact_daily_month_year_and_microsecond_split")
        source_fixture.setUp()
        try:
            source_fixture.year = YEAR
            replacement = source_fixture.run_source(month=6, cutoff=date(2030, 1, 1))
            source_fixture.db.commit()
        finally:
            source_fixture.db.close()
        invalidate = api("POST", f"runs/{stale_id}/invalidate", "synthetic_payroll_reviewer_hr",
                         {"expected_version": refreshed.json()["version"],
                          "reason": "Synthetic source changed; replace run",
                          "replacement_run_id": replacement})
        self.assertEqual(invalidate.status_code, 200, invalidate.text)
        self.assertEqual(invalidate.json()["state"], "REPLACED")
        self.assertTrue(invalidate.json()["released_period_reservation"])
        with ledger.connect() as db:
            self.assertEqual(db.execute("SELECT status FROM ot9_candidate_source_runs WHERE run_id=%s",
                                        (stale_id,)).fetchone()[0], "HOLD")
            self.assertEqual(db.execute("SELECT count(*) FROM ot9_candidate_period_reservations WHERE run_id=%s",
                                        (stale_id,)).fetchone()[0], 0)
            events_before = db.execute("SELECT count(*) FROM ot9_candidate_run_lifecycle_events WHERE run_id=%s",
                                        (stale_id,)).fetchone()[0]
            with self.assertRaises(psycopg.Error):
                with db.transaction():
                    db.execute("DELETE FROM ot9_candidate_run_lifecycle_events WHERE run_id=%s", (stale_id,))
            self.assertEqual(db.execute("SELECT count(*) FROM ot9_candidate_run_lifecycle_events WHERE run_id=%s",
                                        (stale_id,)).fetchone()[0], events_before)
        builder = ledger.LedgerTests("test_01_exact_daily_month_year_and_microsecond_split")
        builder.setUp()
        try:
            builder.year = YEAR
            built = builder.build(replacement)
            self.assertIn(built.get("status"), {"BUILT", "UNCHANGED"}, str(built))
            self.assertTrue(builder.ready(replacement), "Synthetic replacement source must be ready after fixture revalidation")
            builder.prepare(replacement)
            builder.db.commit()
        finally:
            builder.db.close()
        RESULT["runs"]["replacement_6"] = replacement
        with ledger.connect() as db:
            new = db.execute("SELECT status FROM ot9_candidate_source_runs WHERE run_id=%s", (replacement,)).fetchone()[0]
            reservation = db.execute("SELECT run_id FROM ot9_candidate_period_reservations WHERE period_start=DATE '2050-06-01'").fetchone()[0]
        self.assertEqual(new, "PREPARED")
        self.assertEqual(reservation, replacement)
        retry = api("POST", f"runs/{stale_id}/invalidate", "synthetic_payroll_reviewer_hr",
                    {"expected_version": refreshed.json()["version"],
                     "reason": "Synthetic source changed; replace run"})
        self.assertEqual(retry.status_code, 409, retry.text)
        stale_status = api("GET", f"runs/{stale_id}/status", "synthetic_payroll_reviewer_hr")
        self.assertEqual(stale_status.json()["state"], "REPLACED")
        self.assertEqual(stale_status.json()["replacement_run_id"], replacement)

    def test_04_run_with_draft_payroll_cannot_be_replaced_automatically(self):
        period = f"{YEAR}-07"
        run_id = RESULT["runs"][7]
        calculate = api("POST", "payroll/candidate/calculate", "synthetic_creator",
                        {"salary_period": period, "source_run_id": run_id})
        self.assertEqual(calculate.status_code, 200, calculate.text)
        before = counts(period)
        with ledger.connect() as db:
            db.execute("UPDATE attendances SET early_minutes=early_minutes+1 WHERE attendance_id=%s",
                       (RESULT["attendance"][7],))
        refresh = api("POST", f"runs/{run_id}/refresh", "synthetic_payroll_reviewer_hr", {})
        self.assertEqual(refresh.status_code, 200, refresh.text)
        self.assertEqual(refresh.json()["state"], "STALE")
        invalidate = api("POST", f"runs/{run_id}/invalidate", "synthetic_payroll_reviewer_hr",
                         {"expected_version": refresh.json()["version"],
                          "reason": "Synthetic source changed; review draft first"})
        self.assertEqual(invalidate.status_code, 409, invalidate.text)
        self.assertEqual(invalidate.json()["detail"]["code"], "OT_SOURCE_RUN_HAS_PAYROLL_ROWS")
        self.assertEqual(counts(period), before)
        self.assertEqual(api("GET", f"runs/{run_id}/status", "synthetic_payroll_reviewer_hr").json()["state"], "STALE")

    def test_05_serializable_gate_detects_phantom_ot_request_before_pay(self):
        period = f"{YEAR}-09"
        run_id = RESULT["runs"][9]
        calculated = api("POST", "payrolls/candidate/calculate", "synthetic_creator",
                         {"salary_period": period, "source_run_id": run_id})
        self.assertEqual(calculated.status_code, 200, calculated.text)
        CONTROL.update(period=period, entered=threading.Event(), release=threading.Event(), enabled=True)
        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                confirm = pool.submit(api, "POST", "payroll/candidate/confirm-all",
                                      "synthetic_payroll_reviewer_hr",
                                      {"salary_period": period, "source_run_id": run_id})
                self.assertTrue(CONTROL["entered"].wait(timeout=5), "Confirm did not reach source-read barrier")
                inserted = threading.Event()

                def insert_pending_request():
                    with ledger.connect(autocommit=False) as db:
                        db.execute("""INSERT INTO overtime_requests(
                            employee_id,store_id,work_date,starts_at,ends_at,reason,created_by,status)
                            SELECT %s,%s,DATE '2050-09-11',TIMESTAMPTZ '2050-09-11 18:00:00+07',
                                   TIMESTAMPTZ '2050-09-11 19:00:00+07','Synthetic phantom request',%s,'DRAFT'""",
                                   (ledger.LedgerTests.employee, ledger.LedgerTests.store,
                                    ledger.LedgerTests.creator))
                        db.commit()
                        inserted.set()

                writer = pool.submit(insert_pending_request)
                writer.result(timeout=3)
                self.assertTrue(inserted.is_set(), "Concurrent source phantom did not commit while confirm was paused")
                OBSERVED["phantom_request_committed_while_confirm_paused"] = True
                CONTROL["release"].set()
                response = confirm.result(timeout=15)
                OBSERVED["phantom_confirm_http"] = response.status_code
                self.assertIn(response.status_code, (200, 409), response.text)
                if response.status_code == 200:
                    self.assertEqual(response.json()["source_state"], "CONFIRMED_STALE")
                    self.assertTrue(response.json()["payment_hold"])
                    refreshed = api("POST", f"runs/{run_id}/refresh", "synthetic_payroll_reviewer_hr", {})
                    self.assertEqual(refreshed.status_code, 200, refreshed.text)
                    self.assertEqual(refreshed.json()["state"], "CONFIRMED_STALE")
                    paid = api("POST", "payrolls/candidate/pay-all", "synthetic_payroll_reviewer_hr",
                               {"salary_period": period})
                    self.assertEqual(paid.status_code, 409, paid.text)
                    self.assertEqual(paid.json()["detail"]["code"], "PAYROLL_CONFIRMED_SOURCE_STALE_HOLD")
                    OBSERVED["phantom_after_confirm_hold"] = paid.json()["detail"]["code"]
                else:
                    self.assertEqual(counts(period)[2], 0, "Serialization-conflicted confirm wrote a snapshot")
                    refreshed = api("POST", f"runs/{run_id}/refresh", "synthetic_payroll_reviewer_hr", {})
                    self.assertEqual(refreshed.json()["state"], "STALE")
                    OBSERVED["phantom_after_confirm_hold"] = "NO_CONFIRMATION_SNAPSHOT"
        finally:
            CONTROL["enabled"] = False
            if CONTROL["release"]:
                CONTROL["release"].set()


def main():
    result = None
    error = None
    version = None
    removed = False
    ledger.create_fixture()
    try:
        with ledger.connect("postgres") as admin:
            identity = admin.execute("SELECT host(inet_server_addr()),inet_server_port(),current_user").fetchone()
        if identity != ("127.0.0.1", 5432, "postgres"):
            raise RuntimeError("PostgreSQL target is not the verified local loopback fixture")
        run_local([PG / "psql.exe", "-X", "-h", "127.0.0.1", "-p", "5432", "-U", "postgres",
                   "-d", DB, "-v", "ON_ERROR_STOP=1", "-f", ROOT / "payroll_v2_api_candidate_guard.sql"])
        run_local([PG / "psql.exe", "-X", "-h", "127.0.0.1", "-p", "5432", "-U", "postgres",
                   "-d", DB, "-v", "ON_ERROR_STOP=1", "-f", SQL_SOURCE])
        with ledger.connect() as db:
            version = db.execute("SHOW server_version").fetchone()[0]
            seq = db.execute("SELECT pg_get_serial_sequence('users','user_id')").fetchone()[0]
            db.execute("SELECT setval(%s::regclass,1000,false)", (seq,))
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(Checkpoint44Tests)
        result = unittest.TextTestRunner(stream=sys.stdout, verbosity=2).run(suite)
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
        raise
    finally:
        try:
            stop_server()
        except Exception as exc:
            error = error or f"server-stop: {type(exc).__name__}: {exc}"
        removed = ledger.cleanup_fixture()
        evidence = {
            "suite": "Payroll v2 Checkpoint 44 locking/freshness/lifecycle candidate",
            "recorded_at_utc": datetime.now(timezone.utc).isoformat(),
            "database": {"name": DB, "host": "127.0.0.1", "port": 5432, "user": "postgres",
                         "marker": ledger.MARKER, "postgres_version": version,
                         "source_mode": "schema-only clone; synthetic rows only"},
            "lock_strategy": "SERIALIZABLE + period advisory lock + row-scoped run/payroll/actor locks",
            "test_cases": result.testsRun if result else 0,
            "test_names": [
                "serializable confirm does not block Attendance writer",
                "confirmed source stale is sticky; pay holds; snapshot immutable",
                "stale prepared run invalidation releases reservation; replacement prepares",
                "run with DRAFT payroll rows cannot be replaced automatically",
                "serializable source gate detects phantom OT request"],
            "failures": len(result.failures) if result else 0,
            "errors": len(result.errors) if result else 0,
            "skipped": len(result.skipped) if result else 0,
            "successful": bool(result and result.wasSuccessful()),
            "api_source_sha256": hashlib.sha256(API_SOURCE.read_bytes()).hexdigest(),
            "lifecycle_sql_sha256": hashlib.sha256(SQL_SOURCE.read_bytes()).hexdigest(),
            "test_source_sha256": hashlib.sha256(TEST_SOURCE.read_bytes()).hexdigest(),
            "observed_concurrency": OBSERVED,
            "database_removed": removed,
            "error": error,
        }
        out = ROOT / "evidence" / f"payroll-v2-cp44-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}.json"
        out.parent.mkdir(exist_ok=True)
        with out.open("x", encoding="utf-8") as f:
            json.dump(evidence, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(json.dumps({"evidence": str(out.relative_to(ROOT.parent.parent)), **evidence},
                         ensure_ascii=False, indent=2))
    if not result or not result.wasSuccessful() or error or not removed:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
