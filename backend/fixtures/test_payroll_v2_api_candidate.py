"""Local HTTP/JWT acceptance for the isolated Payroll v2 API candidate.

All rows are synthetic. The harness uses a schema-only clone of the approved
loopback fixture, starts Uvicorn on 127.0.0.1, and drops only its marked DB.
It never reads .env or the production router and never connects remotely.
"""
from __future__ import annotations

import hashlib
import httpx
import io
import json
import socket
import subprocess
import sys
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import jwt
import psycopg
import uvicorn

import test_ot_segment_ledger_candidate as ledger
from payroll_v2_api_candidate import create_app


ROOT = Path(__file__).resolve().parent
PG = Path(r"C:\Program Files\PostgreSQL\17\bin")
DB = ledger.DB
SECRET = "SYNTHETIC-ONLY-JWT-KEY-DO-NOT-USE-OUTSIDE-TEST-43"
YEAR = 2050
GUARD = ROOT / "payroll_v2_api_candidate_guard.sql"
API_SOURCE = ROOT / "payroll_v2_api_candidate.py"
TEST_SOURCE = Path(__file__)
BASELINE = ledger.BASELINE


def run_local(args):
    completed = subprocess.run([str(v) for v in args], capture_output=True, text=True,
                               encoding="utf-8", errors="replace", timeout=45)
    if completed.returncode:
        raise RuntimeError(f"Local synthetic command failed: {Path(str(args[0])).name}: {completed.stderr[-2500:]}")


def insert_employee(db, code: str, status: str) -> int:
    org = db.execute("SELECT store_id,department_id,position_id,education_level_id FROM employees WHERE employee_id=%s",
                     (ledger.LedgerTests.employee,)).fetchone()
    if not org:
        raise RuntimeError("Synthetic employee organization fixture missing")
    return db.execute("""INSERT INTO employees(employee_code,first_name,last_name,gender,dob,
        identity_card,phone,company_email,current_address,store_id,department_id,position_id,
        education_level_id,join_date,employment_status)
        VALUES(%s,'Synthetic','Reviewer','MALE','1990-01-01',%s,%s,%s,'Synthetic',%s,%s,%s,%s,'2020-01-01',%s)
        RETURNING employee_id""",
        (code, f"ID-{code[-2:]}", f"090-{code[-2:]}", f"{code.lower()}@example.invalid", *org, status)).fetchone()[0]


def add_user(db, employee_id, username: str, email: str) -> int:
    return db.execute("""INSERT INTO users(employee_id,username,password_hash,email,is_active)
        VALUES(%s,%s,'synthetic-only',%s,true) RETURNING user_id""",
        (employee_id, username, email)).fetchone()[0]


def assign_role(db, user_id: int, role: str) -> None:
    row = db.execute("SELECT role_id FROM roles WHERE role_code=%s", (role,)).fetchone()
    if row:
        role_id = row[0]
    else:
        role_id = db.execute("INSERT INTO roles(role_code,role_name) VALUES(%s,%s) RETURNING role_id",
                             (role, role.replace("_", " ").title())).fetchone()[0]
    db.execute("""INSERT INTO user_roles(user_id,role_id)
        SELECT %s,%s WHERE NOT EXISTS(SELECT 1 FROM user_roles WHERE user_id=%s AND role_id=%s)""",
        (user_id, role_id, user_id, role_id))


class ApiState:
    app = None
    server = None
    thread = None
    port = None
    runs = {}
    attendance = {}
    users = {}
    hook_enabled = False
    hook_entered = None
    hook_release = None
    guard_installed = False
    synthetic_paid_id = None


def token(username: str, *, role_claims=None, secret=SECRET) -> str:
    claims = {"sub": username, "exp": int(time.time()) + 1800}
    if role_claims is not None:
        claims["roles"] = role_claims
    return jwt.encode(claims, secret, algorithm="HS256")


def headers(username: str, *, role_claims=None):
    return {"Authorization": f"Bearer {token(username, role_claims=role_claims)}"}


def request(method: str, path: str, username: str, body=None, *, role_claims=None):
    with httpx.Client(trust_env=False, timeout=15) as client:
        return client.request(method, f"http://127.0.0.1:{ApiState.port}{path}",
                              headers=headers(username, role_claims=role_claims), json=body)


def seed_auth():
    # The shared ledger fixture supplies two ACTIVE employees and three users.
    with ledger.connect() as db:
        emp3 = insert_employee(db, "SYNTH-API-R3", "RESIGNED")
        emp4 = insert_employee(db, "SYNTH-API-R4", "RESIGNED")
        calc_user = ledger.LedgerTests.creator
        reviewer_hr = add_user(db, emp3, "synthetic_payroll_reviewer_hr", "reviewer-hr@example.invalid")
        reviewer_director = add_user(db, emp4, "synthetic_payroll_reviewer_director",
                                     "reviewer-director@example.invalid")
        manager_user = add_user(db, None, "synthetic_payroll_manager",
                                "manager@example.invalid")
        employee_user = add_user(db, None, "synthetic_payroll_employee",
                                 "employee@example.invalid")
        for user_id, role in (
            (calc_user, "HR_MANAGER"),
            (reviewer_hr, "HR_MANAGER"),
            (reviewer_director, "DIRECTOR"),
            (reviewer_director, "ADMIN"),
            (manager_user, "STORE_MANAGER"),
            (employee_user, "EMPLOYEE"),
            (ledger.LedgerTests.hr, "HR_MANAGER"),
            (ledger.LedgerTests.hr2, "ADMIN"),
        ):
            assign_role(db, user_id, role)
        ApiState.users = {
            "calculator": {"id": calc_user, "employee_id": ledger.LedgerTests.employee,
                           "username": "synthetic_creator"},
            "reviewer_hr": {"id": reviewer_hr, "employee_id": emp3,
                            "username": "synthetic_payroll_reviewer_hr"},
            "reviewer_director": {"id": reviewer_director, "employee_id": emp4,
                                  "username": "synthetic_payroll_reviewer_director"},
            "manager": {"id": manager_user, "employee_id": None,
                        "username": "synthetic_payroll_manager"},
            "employee": {"id": employee_user, "employee_id": None,
                         "username": "synthetic_payroll_employee"},
            "hr_self_beneficiary": {"id": ledger.LedgerTests.hr,
                                    "employee_id": ledger.LedgerTests.no_ot,
                                    "username": "synthetic_hr"},
            "admin_no_mapping": {"id": ledger.LedgerTests.hr2, "employee_id": None,
                                 "username": "synthetic_hr2"},
            "request_creator": {"id": ledger.LedgerTests.creator,
                                "employee_id": ledger.LedgerTests.employee,
                                "username": "synthetic_creator"},
        }
    if ApiState.users["calculator"]["id"] == ApiState.users["calculator"]["employee_id"]:
        raise RuntimeError("Fixture must prove user_id and employee_id are not interchangeable")
    # Verify the actual installed payrolls.created_by FK target before using it.
    with ledger.connect() as db:
        fk = db.execute("""SELECT pg_get_constraintdef(c.oid)
            FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
            JOIN pg_namespace n ON n.oid=t.relnamespace
            WHERE n.nspname='public' AND t.relname='payrolls' AND c.conname='fk_pr_creator'""").fetchone()
        if not fk or "REFERENCES employees(employee_id)" not in fk[0]:
            raise RuntimeError("Unexpected payrolls.created_by foreign-key contract")


def prepare_source_run(month: int) -> tuple[int, int]:
    instance = ledger.LedgerTests("test_10_retry_build_does_not_duplicate_segments_or_events")
    instance.setUp()
    try:
        instance.year = YEAR
        # The source decisions use the DB role identity, but actor id remains users.user_id.
        instance.hr = ledger.LedgerTests.hr2
        instance.hr2 = ledger.LedgerTests.hr2
        start = datetime(YEAR, month, 10, 18, tzinfo=ledger.VN)
        request_id, attendance_id = instance.request(start, start + timedelta(hours=2))
        run_id = instance.run_source(month=month, cutoff=date(2030, 1, 1))
        built = instance.build(run_id)
        if built.get("status") not in {"BUILT", "UNCHANGED"}:
            raise RuntimeError(f"Synthetic ledger build failed: {built}")
        if not instance.ready(run_id):
            raise RuntimeError(f"Synthetic ledger gate is not ready for month {month}")
        instance.prepare(run_id)
        instance.db.commit()
        return run_id, attendance_id
    finally:
        instance.db.close()


def start_server():
    control = {"period": None, "entered": None, "release": None, "enabled": False}

    def hook(operation: str, period: str):
        if control["enabled"] and operation == "confirm" and period == control["period"]:
            control["entered"].set()
            if not control["release"].wait(timeout=7):
                raise RuntimeError("Synthetic lock hook timed out")

    ApiState.control = control
    ApiState.app = create_app(DB, SECRET, after_source_locks=hook)
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    ApiState.port = sock.getsockname()[1]
    sock.close()
    config = uvicorn.Config(ApiState.app, host="127.0.0.1", port=ApiState.port,
                            log_level="error", access_log=False)
    ApiState.server = uvicorn.Server(config)
    ApiState.thread = threading.Thread(target=ApiState.server.run, name="payroll-v2-api-candidate", daemon=True)
    ApiState.thread.start()
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        try:
            response = httpx.get(f"http://127.0.0.1:{ApiState.port}/api/v1/payroll-v2-candidate/health",
                                 timeout=1, trust_env=False)
            if response.status_code == 200:
                body = response.json()
                if body != {"status": "local_candidate", "database": DB, "host": "127.0.0.1", "port": 5432}:
                    raise RuntimeError("Candidate HTTP health returned unexpected DB identity")
                return
        except httpx.HTTPError:
            pass
        time.sleep(.05)
    raise RuntimeError("Local candidate API did not start")


def stop_server():
    if ApiState.server:
        ApiState.server.should_exit = True
    if ApiState.thread:
        ApiState.thread.join(timeout=10)
        if ApiState.thread.is_alive():
            raise RuntimeError("Candidate API server did not stop; refusing DB cleanup")


class PayrollApiCandidateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ledger.LedgerTests.setUpClass()
        seed_auth()
        for month in (1, 2, 3, 4):
            ApiState.runs[month], ApiState.attendance[month] = prepare_source_run(month)
        start_server()

    def api(self, method, alias, action, user, body=None):
        return request(method, f"/api/v1/{alias}/candidate/{action}", user, body)

    def count_period(self, period):
        with ledger.connect() as db:
            return db.execute("""SELECT
                (SELECT count(*) FROM payrolls WHERE salary_period=%s),
                (SELECT count(*) FROM payroll_details d JOIN payrolls p USING(payroll_id) WHERE p.salary_period=%s),
                (SELECT count(*) FROM audit_logs WHERE entity_name='payroll_periods' AND entity_id=%s),
                (SELECT count(*) FROM payroll_finalization_snapshots s WHERE s.salary_period=%s)""",
                (period, period, period, period)).fetchone()

    def test_01_database_roles_jwt_and_mapping_are_authoritative(self):
        period = f"{YEAR}-01"
        before = self.count_period(period)
        payload = {"salary_period": period, "source_run_id": ApiState.runs[1]}
        for username in ("synthetic_payroll_manager", "synthetic_payroll_employee"):
            response = self.api("POST", "payrolls", "calculate", username, payload)
            self.assertEqual(response.status_code, 403, response.text)
        response = httpx.post(f"http://127.0.0.1:{ApiState.port}/api/v1/payrolls/candidate/calculate",
                              headers=headers("synthetic_payroll_manager", role_claims=["ADMIN"]),
                              json=payload, timeout=10, trust_env=False)
        self.assertEqual(response.status_code, 403, response.text)
        response = httpx.post(f"http://127.0.0.1:{ApiState.port}/api/v1/payrolls/candidate/calculate",
                              headers=headers("synthetic_hr2"), json=payload, timeout=10, trust_env=False)
        self.assertEqual(response.status_code, 403, response.text)
        response = httpx.post(f"http://127.0.0.1:{ApiState.port}/api/v1/payrolls/candidate/calculate",
                              json=payload, timeout=10, trust_env=False)
        self.assertEqual(response.status_code, 401, response.text)
        response = httpx.post(f"http://127.0.0.1:{ApiState.port}/api/v1/payrolls/candidate/calculate",
                              headers={"Authorization": "Bearer invalid"}, json=payload, timeout=10,
                              trust_env=False)
        self.assertEqual(response.status_code, 401, response.text)
        self.assertEqual(before, self.count_period(period), "Denied requests wrote payroll/audit data")

    def test_02_calculate_alias_retry_and_user_employee_mapping(self):
        period = f"{YEAR}-01"
        body = {"salary_period": period, "source_run_id": ApiState.runs[1]}
        response = self.api("POST", "payrolls", "calculate", "synthetic_creator", body)
        self.assertEqual(response.status_code, 200, response.text)
        first = response.json()
        self.assertEqual(first["status"], "CALCULATED")
        self.assertEqual(first["actor"], {"user_id": ApiState.users["calculator"]["id"],
                                          "employee_id": ApiState.users["calculator"]["employee_id"]})
        ids_before = first["payroll_ids"]
        self.assertEqual(len(ids_before), 2)
        with ledger.connect() as db:
            details_before_retry = db.execute(
                "SELECT count(*) FROM payroll_details d JOIN payrolls p USING(payroll_id) WHERE p.salary_period=%s",
                (period,),
            ).fetchone()[0]
        # Same run through the alias is an idempotent HTTP retry, with stable row IDs.
        response = self.api("POST", "payroll", "calculate", "synthetic_creator", body)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "UNCHANGED")
        self.assertEqual(response.json()["payroll_ids"], ids_before)
        with ledger.connect() as db:
            rows = db.execute("SELECT created_by,employee_id,payroll_ot_candidate_run_id FROM payrolls WHERE salary_period=%s", (period,)).fetchall()
            self.assertTrue(all(r[0] == ApiState.users["calculator"]["employee_id"] for r in rows))
            self.assertTrue(all(r[0] != ApiState.users["calculator"]["id"] for r in rows))
            self.assertTrue(all(r[2] == ApiState.runs[1] for r in rows))
            details_after_retry = db.execute("SELECT count(*) FROM payroll_details d JOIN payrolls p USING(payroll_id) WHERE p.salary_period=%s", (period,)).fetchone()[0]
            self.assertEqual(details_after_retry, details_before_retry, "Alias retry duplicated payroll detail rows")
            self.assertEqual(db.execute("SELECT count(*) FROM audit_logs WHERE action='PAYROLL_V2_CANDIDATE_CALCULATE' AND entity_id=%s", (period,)).fetchone()[0], 1)

    def test_03_stale_source_holds_calculate_and_confirm_without_writes(self):
        stale_period = f"{YEAR}-03"
        with ledger.connect() as db:
            db.execute("UPDATE attendances SET late_minutes=late_minutes+1 WHERE attendance_id=%s", (ApiState.attendance[3],))
        before = self.count_period(stale_period)
        response = self.api("POST", "payroll", "calculate", "synthetic_payroll_reviewer_director",
                            {"salary_period": stale_period, "source_run_id": ApiState.runs[3]})
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(response.json()["detail"]["code"], "OT_SOURCE_HOLD_OR_STALE")
        self.assertEqual(before, self.count_period(stale_period))

        period = f"{YEAR}-02"
        response = self.api("POST", "payrolls", "calculate", "synthetic_creator",
                            {"salary_period": period, "source_run_id": ApiState.runs[2]})
        self.assertEqual(response.status_code, 200, response.text)
        ids = response.json()["payroll_ids"]
        with ledger.connect() as db:
            db.execute("UPDATE attendances SET early_minutes=early_minutes+1 WHERE attendance_id=%s", (ApiState.attendance[2],))
        response = self.api("POST", "payrolls", "confirm-all", "synthetic_payroll_reviewer_hr",
                            {"salary_period": period, "source_run_id": ApiState.runs[2]})
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(response.json()["detail"]["code"], "OT_SOURCE_HOLD_OR_STALE")
        with ledger.connect() as db:
            statuses = db.execute("SELECT DISTINCT payment_status FROM payrolls WHERE payroll_id=ANY(%s)", (ids,)).fetchall()
            self.assertEqual(statuses, [("DRAFT",)])
            self.assertEqual(db.execute("SELECT count(*) FROM payroll_finalization_snapshots WHERE payroll_id=ANY(%s)", (ids,)).fetchone()[0], 0)

    def test_04_self_approval_denied_and_two_hr_confirm_requests_serialize(self):
        period = f"{YEAR}-01"
        body = {"salary_period": period, "source_run_id": ApiState.runs[1]}
        self_approval = self.api("POST", "payrolls", "confirm-all", "synthetic_creator", body)
        self.assertEqual(self_approval.status_code, 403, self_approval.text)
        beneficiary_hr = self.api("POST", "payrolls", "confirm-all", "synthetic_hr", body)
        self.assertEqual(beneficiary_hr.status_code, 403, beneficiary_hr.text)
        before = self.count_period(period)
        barrier = threading.Barrier(2)

        def confirm(alias, username):
            barrier.wait(timeout=4)
            return self.api("POST", alias, "confirm-all", username, body)

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(confirm, "payrolls", "synthetic_payroll_reviewer_hr"),
                       pool.submit(confirm, "payroll", "synthetic_payroll_reviewer_director")]
            responses = [future.result(timeout=15) for future in futures]
        self.assertEqual(sorted(r.status_code for r in responses), [200, 409], [r.text for r in responses])
        winner = next(r for r in responses if r.status_code == 200)
        self.assertEqual(winner.json()["confirmed_count"], 2)
        with ledger.connect() as db:
            self.assertEqual(db.execute("SELECT count(DISTINCT payment_status) FROM payrolls WHERE salary_period=%s", (period,)).fetchone()[0], 1)
            self.assertEqual(db.execute("SELECT count(*) FROM payrolls WHERE salary_period=%s AND payment_status='CONFIRMED'", (period,)).fetchone()[0], 2)
            self.assertEqual(db.execute("SELECT count(*) FROM payroll_finalization_snapshots WHERE salary_period=%s AND finalized_status='CONFIRMED'", (period,)).fetchone()[0], 2)
            self.assertEqual(db.execute("SELECT count(*) FROM audit_logs WHERE action='PAYROLL_V2_CANDIDATE_CONFIRM' AND entity_id=%s", (period,)).fetchone()[0], 1)
            self.assertEqual(db.execute("SELECT count(*) FROM audit_logs WHERE entity_name='payroll_periods' AND entity_id=%s", (period,)).fetchone()[0], before[2] + 1)

    def test_05_paid_and_confirmed_history_are_protected_and_no_new_paid_path(self):
        period = f"{YEAR}-01"
        with ledger.connect() as db:
            confirmed_id = db.execute("SELECT payroll_id FROM payrolls WHERE salary_period=%s AND payment_status='CONFIRMED' ORDER BY payroll_id LIMIT 1", (period,)).fetchone()[0]
            db.execute("UPDATE payrolls SET payment_status='PAID',payment_date=DATE '2050-01-31',updated_at=clock_timestamp() WHERE payroll_id=%s", (confirmed_id,))
            ApiState.synthetic_paid_id = confirmed_id
            historic_before = self.history_snapshot(period)
        run_local([PG / "psql.exe", "-X", "-h", "127.0.0.1", "-p", "5432", "-U", "postgres",
                   "-d", DB, "-v", "ON_ERROR_STOP=1", "-f", GUARD])
        ApiState.guard_installed = True
        with ledger.connect() as db:
            # The separate database guard blocks direct PAID creation and unconfirm bypasses.
            for sql, params in (
                ("UPDATE payrolls SET payment_status='DRAFT' WHERE payroll_id=%s", (confirmed_id,)),
                ("UPDATE payrolls SET payment_date=DATE '2050-02-01' WHERE payroll_id=%s", (confirmed_id,)),
                ("UPDATE payrolls SET payment_status='PAID' WHERE salary_period=%s AND payment_status='CONFIRMED'", (period,)),
                ("DELETE FROM payrolls WHERE payroll_id=%s", (confirmed_id,)),
                ("INSERT INTO payrolls(employee_id,salary_period,actual_working_days,contract_salary,actual_base_salary,gross_income,total_deduction,net_salary,payment_status) VALUES(%s,'2050-05',0,0,0,0,0,0,'PAID')", (ledger.LedgerTests.employee,)),
            ):
                with self.assertRaises(psycopg.Error):
                    with db.transaction():
                        db.execute(sql, params)
            historic_after_failed_sql = self.history_snapshot(period, db)
            self.assertEqual(historic_before, historic_after_failed_sql)

        pay = self.api("POST", "payrolls", "pay-all", "synthetic_payroll_reviewer_hr", {"salary_period": period})
        self.assertEqual(pay.status_code, 409, pay.text)
        self.assertEqual(pay.json()["detail"]["code"], "PAYROLL_PAID_IMMUTABLE")
        reopen = self.api("POST", "payroll", "reopen-period", "synthetic_payroll_reviewer_director",
                          {"salary_period": period, "reason": "Synthetic review only"})
        self.assertEqual(reopen.status_code, 409, reopen.text)
        self.assertEqual(reopen.json()["detail"]["code"], "PAYROLL_PAID_IMMUTABLE")
        reopen_alias = self.api("POST", "payrolls", "reopen-period", "synthetic_payroll_reviewer_director",
                                {"salary_period": f"{YEAR}-04", "reason": "Synthetic review only"})
        self.assertEqual(reopen_alias.status_code, 409, reopen_alias.text)
        self.assertEqual(reopen_alias.json()["detail"]["code"], "PAYROLL_REOPEN_LIFECYCLE_NOT_APPROVED")
        paid_unconfirm = self.api("POST", "payrolls", f"{ApiState.synthetic_paid_id}/unconfirm",
                                  "synthetic_payroll_reviewer_hr", {"reason": "Synthetic audit reason"})
        self.assertEqual(paid_unconfirm.status_code, 409, paid_unconfirm.text)
        self.assertEqual(paid_unconfirm.json()["detail"]["code"], "PAYROLL_PAID_IMMUTABLE")
        remaining_confirmed = self.api("POST", "payroll", f"{self.other_confirmed_id(period)}/unconfirm",
                                       "synthetic_payroll_reviewer_director", {"reason": "Synthetic audit reason"})
        self.assertEqual(remaining_confirmed.status_code, 409, remaining_confirmed.text)
        self.assertEqual(remaining_confirmed.json()["detail"]["code"], "PAYROLL_CONFIRMED_IMMUTABLE")
        recalc = self.api("POST", "payrolls", "calculate", "synthetic_creator",
                          {"salary_period": period, "source_run_id": ApiState.runs[1]})
        self.assertEqual(recalc.status_code, 409, recalc.text)
        with ledger.connect() as db:
            self.assertEqual(historic_before, self.history_snapshot(period, db))

    def other_confirmed_id(self, period):
        with ledger.connect() as db:
            return db.execute("SELECT payroll_id FROM payrolls WHERE salary_period=%s AND payment_status='CONFIRMED' ORDER BY payroll_id LIMIT 1", (period,)).fetchone()[0]

    def history_snapshot(self, period, db=None):
        own = db is None
        if own:
            db = ledger.connect()
        try:
            payrolls = db.execute("SELECT payroll_id,employee_id,payment_status,payment_date,created_by,approved_by,overtime_salary,gross_income,total_deduction,net_salary FROM payrolls WHERE salary_period=%s ORDER BY payroll_id", (period,)).fetchall()
            details = db.execute("SELECT d.detail_id,d.payroll_id,d.item_code,d.amount FROM payroll_details d JOIN payrolls p USING(payroll_id) WHERE p.salary_period=%s ORDER BY d.detail_id", (period,)).fetchall()
            snapshots = db.execute("SELECT snapshot_id,payroll_id,finalized_status,payment_date,revision,payroll_snapshot,details_snapshot FROM payroll_finalization_snapshots WHERE salary_period=%s ORDER BY snapshot_id", (period,)).fetchall()
            return payrolls, details, snapshots
        finally:
            if own:
                db.close()

    def test_06_source_locks_hold_attendance_writer_until_confirmation_commits(self):
        period = f"{YEAR}-04"
        body = {"salary_period": period, "source_run_id": ApiState.runs[4]}
        calculated = self.api("POST", "payrolls", "calculate", "synthetic_creator", body)
        self.assertEqual(calculated.status_code, 200, calculated.text)
        control = ApiState.control
        control["period"] = period
        control["entered"] = threading.Event()
        control["release"] = threading.Event()
        control["enabled"] = True
        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                confirm_future = pool.submit(self.api, "POST", "payrolls", "confirm-all",
                                             "synthetic_payroll_reviewer_hr", body)
                self.assertTrue(control["entered"].wait(timeout=5), "Confirm did not acquire source SHARE locks")
                writer_started = threading.Event()
                writer_pid = []

                def source_writer():
                    with ledger.connect(autocommit=False) as db:
                        writer_pid.append(db.info.backend_pid)
                        writer_started.set()
                        db.execute("UPDATE attendances SET early_minutes=early_minutes+1 WHERE attendance_id=%s",
                                   (ApiState.attendance[4],))
                        db.commit()

                writer_future = pool.submit(source_writer)
                self.assertTrue(writer_started.wait(timeout=3))
                blocked = False
                deadline = time.monotonic() + 4
                with ledger.connect() as observer:
                    while time.monotonic() < deadline:
                        blocked = observer.execute("SELECT cardinality(pg_blocking_pids(%s))>0", (writer_pid[0],)).fetchone()[0]
                        if blocked:
                            break
                        time.sleep(.025)
                self.assertTrue(blocked, "Attendance UPDATE was not blocked by the confirm transaction")
                self.assertFalse(writer_future.done())
                control["release"].set()
                confirm_response = confirm_future.result(timeout=10)
                self.assertEqual(confirm_response.status_code, 200, confirm_response.text)
                writer_future.result(timeout=10)
            with ledger.connect() as db:
                self.assertFalse(db.execute("SELECT preliminarily_ready FROM ot9_candidate_source_gate WHERE run_id=%s", (ApiState.runs[4],)).fetchone()[0],
                                  "Writer should commit after confirm and make source stale, requiring post-finalization policy")
            new_paid = self.api("POST", "payroll", "pay-all", "synthetic_payroll_reviewer_director",
                                {"salary_period": period})
            self.assertEqual(new_paid.status_code, 409, new_paid.text)
            self.assertEqual(new_paid.json()["detail"]["code"], "PAYROLL_NEW_PAID_DISABLED")
            reopen_confirmed = self.api("POST", "payrolls", "reopen-period", "synthetic_payroll_reviewer_hr",
                                        {"salary_period": period, "reason": "Synthetic review only"})
            self.assertEqual(reopen_confirmed.status_code, 409, reopen_confirmed.text)
            self.assertEqual(reopen_confirmed.json()["detail"]["code"], "PAYROLL_REOPEN_LIFECYCLE_NOT_APPROVED")
        finally:
            control["enabled"] = False
            if control["release"]:
                control["release"].set()


def main():
    ledger.create_fixture()
    result = None
    error = None
    server_version = None
    try:
        # Synthetic-only sequence offset proves that user_id and employee_id are distinct identifiers.
        with ledger.connect() as db:
            seq = db.execute("SELECT pg_get_serial_sequence('users','user_id')").fetchone()[0]
            if not seq:
                raise RuntimeError("users.user_id has no owned sequence to offset in the synthetic clone")
            db.execute("SELECT setval(%s::regclass, 1000, false)", (seq,))
            server_version = db.execute("SHOW server_version").fetchone()[0]
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(PayrollApiCandidateTests)
        stream = sys.stdout
        result = unittest.TextTestRunner(stream=stream, verbosity=2).run(suite)
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
            "suite": "Payroll API Contract & Integration Candidate",
            "recorded_at_utc": datetime.now(timezone.utc).isoformat(),
            "database": {"name": DB, "host": "127.0.0.1", "port": 5432, "user": "postgres",
                         "marker": ledger.MARKER, "source_schema": ledger.SOURCE,
                         "source_mode": "READ_ONLY schema-only clone; synthetic rows only",
                         "postgres_version": server_version},
            "baseline_procedure_sha256": BASELINE,
            "candidate_api_sha256": hashlib.sha256(API_SOURCE.read_bytes()).hexdigest(),
            "candidate_guard_sql_sha256": hashlib.sha256(GUARD.read_bytes()).hexdigest(),
            "test_script_sha256": hashlib.sha256(TEST_SOURCE.read_bytes()).hexdigest(),
            "test_cases": result.testsRun if result else 0,
            "test_names": sorted(name for name in dir(PayrollApiCandidateTests) if name.startswith("test_")),
            "failures": len(result.failures) if result else 0,
            "errors": len(result.errors) if result else 0,
            "skipped": len(result.skipped) if result else 0,
            "successful": bool(result and result.wasSuccessful()),
            "fixture_guard_installed": ApiState.guard_installed,
            "synthetic_paid_fixture_id": ApiState.synthetic_paid_id,
            "database_removed": removed,
            "error": error,
        }
        out_dir = ROOT / "evidence"
        out_dir.mkdir(exist_ok=True)
        target = out_dir / f"payroll-api-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}.json"
        with target.open("x", encoding="utf-8") as f:
            json.dump(evidence, f, ensure_ascii=False, indent=2, default=str)
            f.write("\n")
        print(json.dumps({"evidence": str(target.relative_to(ROOT.parent.parent)), **evidence}, ensure_ascii=False, indent=2, default=str))
    if not result or not result.wasSuccessful() or error or not removed:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
