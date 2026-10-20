"""Local-only PostgreSQL acceptance for a review-only OT segment ledger.

Creates a marked, schema-only disposable clone of mission9_synthetic. Never
loads .env, copies rows, connects remotely, or installs into the source database.
All fixtures are synthetic; the marked database is dropped in finally.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parent
PG = Path(r"C:\Program Files\PostgreSQL\17\bin")
DB = "ot_ledger_synthetic_20261020"
SOURCE = "mission9_synthetic"
MARKER = "TECHZONE_SYNTHETIC_OT_LEDGER_20261020"
VN = timezone(timedelta(hours=7))
CUTOFF = date(2030, 1, 1)  # Simulated ONLY. Not an actual rollout decision.
OWNED = False
BASELINE = 'c4b02a2a3cf126f92c5418286bd6e5b6d43583eb02b25cc0255cfc3ba12a5d28'


def connect(database=DB, *, autocommit=True):
    if database not in {DB, SOURCE, "postgres"}:
        raise RuntimeError("Database not allowlisted")
    conn = psycopg.connect(host="127.0.0.1", port=5432, dbname=database,
                           user="postgres", connect_timeout=3, autocommit=autocommit)
    identity = conn.execute(
        "SELECT current_database(),host(inet_server_addr()),inet_server_port(),current_user"
    ).fetchone()
    if identity != (database, "127.0.0.1", 5432, "postgres"):
        conn.close()
        raise RuntimeError("Refusing unexpected/non-loopback identity")
    conn.execute("SET statement_timeout='10s'")
    conn.execute("SET lock_timeout='8s'")
    return conn


def command(args):
    completed = subprocess.run([str(a) for a in args], capture_output=True, text=True,
                               encoding="utf-8", errors="replace", timeout=40)
    if completed.returncode:
        raise RuntimeError(f"Local fixture tool failed: {Path(str(args[0])).name}\n{completed.stderr[-2500:]}")


def create_fixture():
    global OWNED
    with connect("postgres") as admin:
        if admin.execute("SELECT 1 FROM pg_database WHERE datname=%s", (DB,)).fetchone():
            raise RuntimeError("Refusing to overwrite a preexisting fixture database")
    with connect(SOURCE) as source:
        source.execute("BEGIN READ ONLY")
        if source.execute("SELECT to_regclass('public.overtime_reconciliations'),"
                          "to_regclass('public.v_overtime_verified_current')").fetchone() != (
                              "overtime_reconciliations", "v_overtime_verified_current"):
            raise RuntimeError("Local source schema dependencies missing")
        definition=source.execute("SELECT pg_get_functiondef('public.sp_generate_monthly_payroll(character varying,integer)'::regprocedure)").fetchone()[0]
        if hashlib.sha256(definition.encode('utf-8')).hexdigest()!=BASELINE:
            raise RuntimeError('Local procedure baseline changed; owner review required')
        source.execute("ROLLBACK")
    with tempfile.TemporaryDirectory(prefix="techzone-ot-ledger-schema-") as temp:
        dump = Path(temp) / "schema-only.sql"
        command([PG / "pg_dump.exe", "-h", "127.0.0.1", "-p", "5432", "-U", "postgres",
                 "--schema-only", "--no-owner", "--no-privileges", "--file", dump, SOURCE])
        with connect("postgres") as admin:
            admin.execute(sql.SQL("CREATE DATABASE {} OWNER postgres").format(sql.Identifier(DB)))
            admin.execute(sql.SQL("COMMENT ON DATABASE {} IS {}").format(sql.Identifier(DB), sql.Literal(MARKER)))
            OWNED = True
        command([PG / "psql.exe", "-X", "-h", "127.0.0.1", "-p", "5432", "-U", "postgres",
                 "-d", DB, "-v", "ON_ERROR_STOP=1", "-f", dump])
    with connect() as db:
        definition=db.execute("SELECT pg_get_functiondef('public.sp_generate_monthly_payroll(character varying,integer)'::regprocedure)").fetchone()[0]
        if hashlib.sha256(definition.encode('utf-8')).hexdigest()!=BASELINE:
            raise RuntimeError('Restored baseline differs from reviewed baseline')
        if db.execute("SELECT (SELECT count(*) FROM employees),(SELECT count(*) FROM payrolls),"
                      "(SELECT count(*) FROM attendances)").fetchone() != (0, 0, 0):
            raise RuntimeError("Schema-only clone unexpectedly contains rows")
    for fixture in ("../migrations/20261023_overtime_reconciliation_exceptions.sql",
                    "payroll_overtime_candidate_schema.sql", "payroll_v2_candidate_procedure.sql",
                    "payroll_ot_segment_ledger_candidate.sql"):
        command([PG / "psql.exe", "-X", "-h", "127.0.0.1", "-p", "5432", "-U", "postgres",
                 "-d", DB, "-v", "ON_ERROR_STOP=1", "-f", ROOT / fixture])


def cleanup_fixture():
    global OWNED
    with connect("postgres") as admin:
        row = admin.execute("SELECT pg_get_userbyid(datdba),datistemplate,"
                            "shobj_description(oid,'pg_database') FROM pg_database WHERE datname=%s", (DB,)).fetchone()
        if row != ("postgres", False, MARKER):
            raise RuntimeError("Refusing cleanup: database marker/owner mismatch")
        if admin.execute("SELECT count(*) FROM pg_stat_activity WHERE datname=%s", (DB,)).fetchone()[0]:
            raise RuntimeError("Refusing cleanup: fixture still has open sessions")
        admin.execute(sql.SQL("DROP DATABASE {}").format(sql.Identifier(DB)))
        removed=admin.execute("SELECT count(*) FROM pg_database WHERE datname=%s", (DB,)).fetchone()[0] == 0
        if removed: OWNED=False
        return removed


def us(delta):
    return (delta.days * 86400 + delta.seconds) * 1_000_000 + delta.microseconds


class LedgerTests(unittest.TestCase):
    counter = 0

    @classmethod
    def setUpClass(cls):
        with connect() as db:
            cls.store = db.execute("""INSERT INTO stores(store_code,store_name,address,district,city,open_date)
                VALUES('SYNTH-LEDGER','Synthetic Ledger','Synthetic','Synthetic','Synthetic','2020-01-01') RETURNING store_id""").fetchone()[0]
            dept = db.execute("INSERT INTO departments(department_code,department_name) VALUES('SYNTH','Synthetic') RETURNING department_id").fetchone()[0]
            edu = db.execute("INSERT INTO education_levels(level_code,level_name) VALUES('SYNTH','Synthetic') RETURNING education_level_id").fetchone()[0]
            pos = db.execute("""INSERT INTO positions(position_code,position_name,base_salary_min,base_salary_max)
                VALUES('SYNTH','Synthetic',0,30000000) RETURNING position_id""").fetchone()[0]
            cls.employees = []
            for i in (1, 2):
                cls.employees.append(db.execute("""INSERT INTO employees(employee_code,first_name,last_name,gender,dob,
                    identity_card,phone,company_email,current_address,store_id,department_id,position_id,education_level_id,join_date,employment_status)
                    VALUES(%s,'Synthetic','Ledger','MALE','1990-01-01',%s,%s,%s,'Synthetic',%s,%s,%s,%s,'2020-01-01','ACTIVE') RETURNING employee_id""",
                    (f'SYNTH-L{i}', f'SYNTH-ID{i}', f'09000000{i}', f'ledger{i}@example.invalid', cls.store, dept, pos, edu)).fetchone()[0])
            cls.employee, cls.no_ot = cls.employees
            cls.creator = db.execute("""INSERT INTO users(employee_id,username,password_hash,email)
                VALUES(%s,'synthetic_creator','synthetic-only','creator@example.invalid') RETURNING user_id""", (cls.employee,)).fetchone()[0]
            cls.hr = db.execute("""INSERT INTO users(employee_id,username,password_hash,email)
                VALUES(%s,'synthetic_hr','synthetic-only','hr@example.invalid') RETURNING user_id""", (cls.no_ot,)).fetchone()[0]
            cls.hr2 = db.execute("""INSERT INTO users(employee_id,username,password_hash,email)
                VALUES(NULL,'synthetic_hr2','synthetic-only','hr2@example.invalid') RETURNING user_id""").fetchone()[0]
            cls.shift = db.execute("""INSERT INTO work_shifts(shift_code,shift_name,start_time,end_time,work_hours)
                VALUES('SYNTH','Synthetic','08:00','16:00',8) RETURNING shift_id""").fetchone()[0]

    def setUp(self):
        LedgerTests.counter += 1
        self.year = 2040 + LedgerTests.counter
        self.db = connect(autocommit=False)
        self.addCleanup(self.db.close)
        self.addCleanup(self.db.rollback)

    def instant(self, month=10, day=10, hour=18, minute=0, microsecond=0):
        return datetime(self.year, month, day, hour, minute, microsecond=microsecond, tzinfo=VN)

    def request(self, start=None, end=None, intervals=None, verified=None, status="APPROVED"):
        start = start or self.instant()
        end = end or start + timedelta(hours=2)
        context={'schedule_status':'MATCHED','planned':{'store_id':self.store,'shift_id':self.shift,
            'starts_at':start.replace(hour=8,minute=0,second=0,microsecond=0).isoformat(),
            'ends_at':start.replace(hour=16,minute=0,second=0,microsecond=0).isoformat()},
            'actual':{'shift_id':self.shift}}
        att = self.db.execute("""INSERT INTO attendances(employee_id,store_id,shift_id,work_date,check_in_time,check_out_time,
            actual_work_hours,status,attendance_context) VALUES(%s,%s,%s,%s,%s,%s,2,'NORMAL',%s) RETURNING attendance_id""",
            (self.employee, self.store, self.shift, start.date(), start, end, Jsonb(context))).fetchone()[0]
        req = self.db.execute("""INSERT INTO overtime_requests(employee_id,store_id,work_date,starts_at,ends_at,reason,created_by,status,reviewed_by,reviewed_at)
            VALUES(%s,%s,%s,%s,%s,'Synthetic OT',%s,%s,%s,clock_timestamp()) RETURNING request_id""",
            (self.employee,self.store,start.date(),start,end,self.creator,status,self.hr if status=='APPROVED' else None)).fetchone()[0]
        intervals = intervals if intervals is not None else [(start,end)]
        total = sum(us(b-a) for a,b in intervals)
        verified = total if verified is None else verified
        self.db.execute("""INSERT INTO overtime_reconciliations(request_id,employee_id,store_id,status,source_signature,
            proposed_microseconds,verified_microseconds,eligible_intervals,attendance_ids,reviewed_by,reviewed_at)
            VALUES(%s,%s,%s,'VERIFIED',ot_reconciliation_source_signature(%s),%s,%s,%s,%s,%s,clock_timestamp())""",
            (req,self.employee,self.store,req,max(total,verified),verified,
             Jsonb([{'starts_at':a.isoformat(),'ends_at':b.isoformat()} for a,b in intervals]),Jsonb([att]),self.hr))
        return req, att

    def run_source(self, month=10, cutoff=CUTOFF, with_ot=True, decisions=True):
        begin = date(self.year,month,1)
        finish = date(self.year+(month==12), month%12+1,1)
        run = self.db.execute("""INSERT INTO ot9_candidate_source_runs(period_start,period_end,source_mode,synthetic_cutoff)
            VALUES(%s,%s,'VERIFIED_ONLY',%s) RETURNING run_id""",(begin,finish,cutoff)).fetchone()[0]
        self.db.execute("SELECT ot9_candidate_capture_employee_scope(%s)",(run,))
        if decisions:
            for emp in self.employees:
                self.db.execute("""INSERT INTO ot9_candidate_employee_decisions(run_id,employee_id,decision,decided_by,decided_at,source_fingerprint)
                    VALUES(%s,%s,%s,%s,clock_timestamp(),ot9_candidate_employee_source_fingerprint(%s,%s))""",
                    (run,emp,'VERIFIED_COMPLETE' if emp==self.employee and with_ot else 'NO_OT_CONFIRMED',
                     self.hr2 if emp==self.no_ot else self.hr,run,emp))
        self.db.execute("""INSERT INTO ot9_candidate_payroll_period_evidence(run_id,checked_at,closed_or_paid,evidence_fingerprint,checked_by)
            VALUES(%s,clock_timestamp(),false,'synthetic-open',%s)""",(run,self.hr))
        return run

    def build(self, run):
        return self.db.execute("SELECT ot9_candidate_build_segments(%s,%s)",(run,self.hr)).fetchone()[0]

    def ready(self, run):
        self.db.execute("SELECT ot9_candidate_capture_preflight(%s,%s)",(run,self.hr))
        return self.gate(run)

    def gate(self, run):
        return self.db.execute("SELECT preliminarily_ready FROM ot9_candidate_source_gate WHERE run_id=%s",(run,)).fetchone()[0]

    def prepare(self, run):
        return self.db.execute("SELECT ot9_candidate_prepare_run(%s,%s)",(run,self.hr)).fetchone()[0]

    def fails(self, statement, params, message):
        with self.assertRaisesRegex(psycopg.Error,message):
            with self.db.transaction():
                self.db.execute(statement,params)

    def test_01_exact_daily_month_year_and_microsecond_split(self):
        for begin,end in [
            (self.instant(10,31,23,59,999999).replace(second=59),self.instant(11,1,0,0,1)),
            (self.instant(12,31,23,30),datetime(self.year+1,1,1,1,30,tzinfo=VN)),
            (datetime(2044,2,28,23,tzinfo=VN),datetime(2044,3,1,1,tzinfo=VN)),
        ]:
            rows=self.db.execute("SELECT * FROM ot9_candidate_split_interval(%s,%s,%s)",(begin,end,CUTOFF)).fetchall()
            self.assertEqual(sum(row[2] for row in rows),us(end-begin))
            self.assertTrue(all(us(b-a)==amount and amount>0 for a,b,amount in rows))
            self.assertTrue(all(rows[i][1]==rows[i+1][0] for i in range(len(rows)-1)))
        self.assertEqual(self.db.execute("SELECT sum(microseconds) FROM ot9_candidate_split_interval(%s,%s,%s)",
            (self.instant(10,31,23,59,999999).replace(second=59).astimezone(timezone.utc),self.instant(11,1,0,0,1).astimezone(timezone.utc),CUTOFF)).fetchone()[0],2)

    def test_02_cross_month_builder_conserves_full_verified_source(self):
        start=self.instant(10,31,23,30,123456); end=self.instant(11,1,1,30,654321)
        self.request(start,end)
        runs=[self.run_source(month=m) for m in (10,11)]
        totals=[]
        for run in runs:
            self.assertEqual(self.build(run)['status'],'BUILT')
            self.assertTrue(self.ready(run)); self.prepare(run)
            totals.append(self.db.execute("SELECT sum(microseconds) FROM ot9_candidate_verified_segments WHERE run_id=%s",(run,)).fetchone()[0])
        self.assertEqual(sum(totals),us(end-start))
        self.assertEqual(totals[0],us(self.instant(11,1,0)-start))
        self.assertEqual(totals[1],us(end-self.instant(11,1,0)))

    def test_03_cutoff_crossing_holds_even_when_verified_part_is_after(self):
        cutoff=date(self.year,11,1)
        start=self.instant(10,31,23); end=self.instant(11,1,1)
        self.request(start,end,[(self.instant(11,1,0),end)])
        run=self.run_source(11,cutoff)
        self.assertEqual(self.build(run),{'status':'HOLD','code':'OT_CUTOFF_CROSSING_HOLD'})
        self.assertFalse(self.ready(run))
        self.assertEqual(self.db.execute("SELECT count(*) FROM ot9_candidate_verified_segments WHERE run_id=%s",(run,)).fetchone()[0],0)

    def test_04_cutoff_boundary_and_legacy_period(self):
        cutoff=date(self.year,10,1); start=self.instant(10,1,0)
        self.request(start,start+timedelta(hours=1))
        run=self.run_source(10,cutoff); self.assertEqual(self.build(run)['status'],'BUILT'); self.assertTrue(self.ready(run))
        before=self.run_source(9,cutoff,with_ot=False)
        self.assertEqual(self.build(before)['code'],'OT_LEGACY_PERIOD_REQUIRED')
        self.fails("SELECT * FROM ot9_candidate_split_interval(%s,%s,%s)",(start,start,CUTOFF),'OT_INTERVAL_INVALID')
        self.fails("SELECT * FROM ot9_candidate_split_interval(%s,%s,%s)",(start,start+timedelta(hours=1),date(self.year,10,2)),'OT_CUTOFF_NOT_CONFIGURED')

    def test_05_partial_scalar_verified_is_hold_not_prorated(self):
        self.request(verified=3_600_000_000)
        run=self.run_source(); self.assertEqual(self.build(run)['code'],'OT_VERIFIED_INTERVAL_TOTAL_MISMATCH'); self.assertFalse(self.ready(run))

    def test_06_multiple_disjoint_sessions_and_daily_split(self):
        start=self.instant(10,10,22); end=self.instant(10,11,3)
        self.request(start,end,[(start,start+timedelta(hours=1)),(self.instant(10,11,0),end)])
        run=self.run_source(); self.assertEqual(self.build(run)['segments'],2); self.assertTrue(self.ready(run))
        self.assertEqual(self.db.execute("SELECT sum(microseconds) FROM ot9_candidate_verified_segments WHERE run_id=%s",(run,)).fetchone()[0],4*3_600_000_000)

    def test_07_overlap_is_hold_and_adjacency_is_valid(self):
        a,_=self.request(); b,_=self.request(self.instant(hour=19),self.instant(hour=21))
        self.db.execute("UPDATE overtime_reconciliations SET source_signature=ot_reconciliation_source_signature(request_id) WHERE request_id=ANY(%s)",([a,b],))
        run=self.run_source(); self.assertEqual(self.build(run)['code'],'OT_LEDGER_OVERLAP'); self.assertFalse(self.ready(run))
        self.year+=100
        self.request(); self.request(self.instant(hour=20),self.instant(hour=21))
        run=self.run_source(); self.assertEqual(self.build(run)['segments'],2); self.assertTrue(self.ready(run))

    def test_08_explicit_no_ot_and_missing_decisions(self):
        run=self.run_source(with_ot=False,decisions=False)
        self.assertEqual(self.build(run)['status'],'UNCHANGED'); self.assertFalse(self.ready(run))
        for employee in self.employees:
            self.db.execute("""INSERT INTO ot9_candidate_employee_decisions(run_id,employee_id,decision,decided_by,decided_at,source_fingerprint)
                VALUES(%s,%s,'NO_OT_CONFIRMED',%s,clock_timestamp(),ot9_candidate_employee_source_fingerprint(%s,%s))""",(run,employee,self.hr2 if employee==self.no_ot else self.hr,run,employee))
        self.assertTrue(self.ready(run)); self.prepare(run)

    def test_09_unverified_pending_and_missing_attendance_hold(self):
        req,att=self.request()
        self.db.execute("UPDATE attendances SET check_out_time=NULL WHERE attendance_id=%s",(att,))
        run=self.run_source(); self.assertEqual(self.build(run)['code'],'OT_SOURCE_NOT_VERIFIED'); self.assertFalse(self.ready(run))
        self.db.execute("UPDATE overtime_requests SET status='PENDING_HR' WHERE request_id=%s",(req,))
        self.assertEqual(self.build(run)['code'],'OT_SOURCE_NOT_VERIFIED')

    def test_10_retry_build_does_not_duplicate_segments_or_events(self):
        self.request(); run=self.run_source()
        self.assertEqual(self.build(run)['status'],'BUILT')
        self.assertEqual(self.build(run)['status'],'UNCHANGED')
        self.assertEqual(self.db.execute("SELECT count(*) FROM ot9_candidate_source_events WHERE run_id=%s AND detail->>'action'='LEDGER_BUILT'",(run,)).fetchone()[0],1)
        self.assertEqual(self.db.execute("SELECT count(*) FROM ot9_candidate_verified_segments WHERE run_id=%s",(run,)).fetchone()[0],1)

    def test_11_forgery_and_prepared_mutation_are_rejected(self):
        self.request(); run=self.run_source(); self.build(run)
        self.fails("UPDATE ot9_candidate_verified_segments SET microseconds=microseconds+1 WHERE run_id=%s",(run,),'OT_SEGMENT_NOT_VERIFIED')
        self.assertTrue(self.ready(run)); self.prepare(run)
        for statement in ["DELETE FROM ot9_candidate_verified_segments WHERE run_id=%s",
                          "UPDATE ot9_candidate_employee_decisions SET decision='HOLD',reason='Synthetic' WHERE run_id=%s",
                          "UPDATE ot9_candidate_payroll_period_evidence SET closed_or_paid=true WHERE run_id=%s",
                          "UPDATE ot9_candidate_source_runs SET synthetic_cutoff='2031-01-01' WHERE run_id=%s"]:
            self.fails(statement,(run,),'IMMUTABLE')
        self.fails("DELETE FROM ot9_candidate_source_events WHERE run_id=%s",(run,),'append-only')

    def test_12_cross_month_attendance_change_invalidates_both_runs(self):
        req,att=self.request(self.instant(10,31,23),self.instant(11,1,1))
        runs=[self.run_source(m) for m in (10,11)]
        for run in runs: self.build(run); self.assertTrue(self.ready(run)); self.prepare(run)
        self.db.execute("UPDATE attendances SET late_minutes=late_minutes+1 WHERE attendance_id=%s",(att,))
        for run in runs:
            self.assertFalse(self.gate(run))
            self.fails("SELECT ot9_candidate_prepare_run(%s,%s)",(run,self.hr),'OT_SOURCE_HOLD_OR_STALE')

    def test_13_revocation_and_version_change_invalidate(self):
        req,_=self.request(); run=self.run_source(); self.build(run); self.ready(run); self.prepare(run)
        self.db.execute("UPDATE overtime_requests SET revoke_requested_by=%s,revoke_requested_at=clock_timestamp(),revoke_reason='Synthetic' WHERE request_id=%s",(self.creator,req))
        self.assertFalse(self.gate(run))
        self.db.execute("UPDATE overtime_requests SET revoke_decided_by=%s,revoke_decided_at=clock_timestamp(),revoke_decision='REJECTED' WHERE request_id=%s",(self.hr,req))
        self.assertFalse(self.gate(run))  # eligibility restored, signature still stale
        self.db.execute("UPDATE overtime_reconciliations SET version=version+1,source_signature=ot_reconciliation_source_signature(request_id) WHERE request_id=%s",(req,))
        self.assertFalse(self.gate(run))  # old ledger version cannot silently become valid

    def parallel(self, action, runs, distinct_actors=False):
        self.db.commit()  # Workers must see the committed synthetic setup.
        barrier=threading.Barrier(2)
        def worker(item):
            index,run=item
            with connect() as conn:
                barrier.wait(timeout=5)
                try:
                    return conn.execute(f"SELECT {action}(%s,%s)",(run,self.hr2 if distinct_actors and index else self.hr)).fetchone()[0]
                except psycopg.errors.UniqueViolation:
                    return 'PERIOD_CONFLICT'
        with ThreadPoolExecutor(max_workers=2) as pool:
            return list(pool.map(worker,enumerate(runs)))

    def test_14_concurrent_build_one_event(self):
        self.request(); run=self.run_source()
        outcomes=self.parallel('ot9_candidate_build_segments',[run,run])
        self.assertEqual(sorted(item['status'] for item in outcomes),['BUILT','UNCHANGED'])
        self.assertEqual(self.db.execute("SELECT count(*) FROM ot9_candidate_source_events WHERE run_id=%s AND detail->>'action'='LEDGER_BUILT'",(run,)).fetchone()[0],1)

    def test_15_concurrent_period_prepare_one_winner(self):
        self.request(); runs=[self.run_source(),self.run_source()]
        for run in runs: self.build(run); self.assertTrue(self.ready(run))
        outcomes=self.parallel('ot9_candidate_prepare_run',runs,distinct_actors=True)
        self.assertEqual(outcomes.count('PERIOD_CONFLICT'),1)
        self.assertEqual(self.db.execute("SELECT count(*) FROM ot9_candidate_source_runs WHERE run_id=ANY(%s) AND status='PREPARED'",(runs,)).fetchone()[0],1)
        self.assertEqual(self.db.execute("SELECT count(*) FROM ot9_candidate_source_events WHERE run_id=ANY(%s) AND event_type='PREPARE'",(runs,)).fetchone()[0],1)
        self.assertTrue(self.db.execute("""SELECT r.prepared_by=e.actor_id FROM ot9_candidate_source_runs r
            JOIN ot9_candidate_source_events e USING(run_id) WHERE r.run_id=ANY(%s) AND e.event_type='PREPARE'""",(runs,)).fetchone()[0])

    def test_16_concurrent_same_run_retry_one_transition(self):
        self.request(); run=self.run_source(); self.build(run); self.ready(run)
        outcomes=self.parallel('ot9_candidate_prepare_run',[run,run])
        self.assertEqual(outcomes[0],outcomes[1])
        self.assertEqual(self.db.execute("SELECT count(*) FROM ot9_candidate_source_events WHERE run_id=%s AND event_type='PREPARE'",(run,)).fetchone()[0],1)

    def test_17_source_writer_waits_for_prepare_then_gate_stales(self):
        req,att=self.request(); run=self.run_source(); self.build(run); self.ready(run)
        self.db.commit()
        holder=connect(autocommit=False)
        try:
            holder.execute("SELECT ot9_candidate_prepare_run(%s,%s)",(run,self.hr))
            pid_box=[]; started=threading.Event()
            def writer():
                with connect() as conn:
                    pid_box.append(conn.info.backend_pid); started.set()
                    conn.execute("UPDATE attendances SET early_minutes=early_minutes+1 WHERE attendance_id=%s",(att,))
            with ThreadPoolExecutor(max_workers=1) as pool:
                future=pool.submit(writer); self.assertTrue(started.wait(3))
                deadline=time.monotonic()+4; blocked=False
                while time.monotonic()<deadline:
                    blocked=self.db.execute("SELECT cardinality(pg_blocking_pids(%s))>0",(pid_box[0],)).fetchone()[0]
                    if blocked: break
                    time.sleep(.02)
                self.assertTrue(blocked,'No evidence that source writer waited for source lock')
                self.assertFalse(future.done()); holder.commit(); future.result(timeout=5)
            self.assertFalse(self.gate(run))
        finally:
            holder.rollback(); holder.close()

    def test_18_pending_exception_holds_and_closure_requires_new_certification(self):
        req,_=self.request(); run=self.run_source()
        case=self.db.execute("""INSERT INTO overtime_reconciliation_cases(request_id,reconciliation_version,case_type,status,opened_by,reason)
            VALUES(%s,1,'EXPLANATION','OPEN',%s,'Synthetic explanation') RETURNING case_id""",(req,self.hr)).fetchone()[0]
        self.assertEqual(self.build(run)['code'],'OT_EXCEPTION_PENDING'); self.assertFalse(self.ready(run))
        self.db.execute("""UPDATE overtime_reconciliation_cases SET status='CLOSED',resolved_by=%s,resolved_at=clock_timestamp(),
            resolution_reason='Synthetic resolved' WHERE case_id=%s""",(self.hr,case))
        self.assertEqual(self.build(run)['status'],'BUILT'); self.assertFalse(self.ready(run))
        self.db.execute("""UPDATE ot9_candidate_employee_decisions SET source_fingerprint=ot9_candidate_employee_source_fingerprint(run_id,employee_id)
            WHERE run_id=%s""",(run,))
        self.assertTrue(self.ready(run)); self.prepare(run)
        self.db.execute("UPDATE overtime_reconciliation_cases SET version=version+1 WHERE case_id=%s",(case,))
        self.assertFalse(self.gate(run))

    def test_19_missing_snapshot_never_becomes_verified_ledger(self):
        req,att=self.request()
        self.db.execute("UPDATE attendances SET attendance_context=%s WHERE attendance_id=%s",(Jsonb({'schedule_status':'MATCHED'}),att))
        self.db.execute("UPDATE overtime_reconciliations SET source_signature=ot_reconciliation_source_signature(request_id) WHERE request_id=%s",(req,))
        run=self.run_source(); self.assertEqual(self.build(run)['code'],'OT_ATTENDANCE_SNAPSHOT_REQUIRED'); self.assertFalse(self.ready(run))

    def test_20_snapshot_shift_crossing_cutoff_holds(self):
        req,att=self.request(self.instant(11,1,7),self.instant(11,1,9))
        context={'schedule_status':'MATCHED','planned':{'store_id':self.store,'shift_id':self.shift,
            'starts_at':self.instant(10,31,22).isoformat(),'ends_at':self.instant(11,1,6).isoformat()},'actual':{'shift_id':self.shift}}
        self.db.execute("UPDATE attendances SET attendance_context=%s WHERE attendance_id=%s",(Jsonb(context),att))
        self.db.execute("UPDATE overtime_reconciliations SET source_signature=ot_reconciliation_source_signature(request_id) WHERE request_id=%s",(req,))
        run=self.run_source(11,date(self.year,11,1)); self.assertEqual(self.build(run)['code'],'OT_ATTENDANCE_CUTOFF_HOLD'); self.assertFalse(self.ready(run))

    def test_21_no_ot_cannot_hide_attendance_crossing_cutoff(self):
        req,_=self.request(self.instant(10,31,23),self.instant(11,1,1))
        self.db.execute("UPDATE overtime_requests SET status='REJECTED',rejection_reason='Synthetic rejection' WHERE request_id=%s",(req,))
        run=self.run_source(11,date(self.year,11,1),with_ot=False)
        self.assertEqual(self.build(run)['status'],'UNCHANGED'); self.assertFalse(self.ready(run))
        self.assertIn(('OT_ATTENDANCE_CUTOFF_HOLD',),self.db.execute("SELECT blocker_code FROM ot9_candidate_blockers WHERE run_id=%s",(run,)).fetchall())

    def test_22_timezone_required_and_split_is_session_independent(self):
        req,_=self.request()
        self.db.execute("UPDATE overtime_reconciliations SET eligible_intervals=%s WHERE request_id=%s",
            (Jsonb([{'starts_at':self.instant().replace(tzinfo=None).isoformat(),'ends_at':self.instant(hour=20).replace(tzinfo=None).isoformat()}]),req))
        run=self.run_source(); self.assertEqual(self.build(run)['code'],'OT_INTERVAL_TIMEZONE_REQUIRED')
        self.db.execute("SET LOCAL TIME ZONE 'UTC'")
        self.assertEqual(self.db.execute("SELECT sum(microseconds) FROM ot9_candidate_split_interval(%s,%s,%s)",
            (self.instant(10,31,23,59,999999).replace(second=59),self.instant(11,1,0,0,1),CUTOFF)).fetchone()[0],2)

    def payroll_rows(self):
        return self.db.execute("SELECT to_jsonb(p) FROM payrolls p WHERE salary_period=%s ORDER BY employee_id",
            (f'{self.year}-10',)).fetchall()

    def payroll_details(self):
        return self.db.execute("""SELECT p.employee_id,d.item_code,d.item_name,d.item_type,d.calculation_formula,d.amount
            FROM payroll_details d JOIN payrolls p USING(payroll_id) WHERE p.salary_period=%s AND d.item_code<>'OVERTIME'
            ORDER BY p.employee_id,d.item_code""",(f'{self.year}-10',)).fetchall()

    def calculate(self, conn, run):
        conn.execute("CALL sp_generate_monthly_payroll_verified_locked_candidate(%s,%s,%s)",
            (f'{self.year}-10',self.no_ot,run))  # baseline created_by is an Employee FK

    def test_23_full_non_ot_components_match_baseline_and_finalized_stays_immutable(self):
        req,att=self.request()
        regular_context={'schedule_status':'MATCHED','planned':{'store_id':self.store,'shift_id':self.shift,
            'starts_at':self.instant(10,9,8).isoformat(),'ends_at':self.instant(10,9,16).isoformat()},'actual':{'shift_id':self.shift}}
        self.db.execute("""INSERT INTO attendances(employee_id,store_id,shift_id,work_date,check_in_time,check_out_time,
            late_minutes,early_minutes,actual_work_hours,status,attendance_context)
            VALUES(%s,%s,%s,%s,%s,%s,20,10,7.5,'LATE_AND_EARLY',%s)""",
            (self.employee,self.store,self.shift,date(self.year,10,9),self.instant(10,9,8,20),self.instant(10,9,15,50),Jsonb(regular_context)))
        self.db.execute("""UPDATE positions SET position_allowance=350000,position_coefficient=1.2
            WHERE position_id=(SELECT position_id FROM employees WHERE employee_id=%s)""",(self.employee,))
        for emp in self.employees:
            self.db.execute("""INSERT INTO contracts(contract_number,employee_id,contract_type,start_date,basic_salary,insurance_salary,signed_date,status)
                VALUES(%s,%s,'INDEFINITE','2020-01-01',26000000,20000000,'2020-01-01','ACTIVE')""",(f'SYNTH-C{emp}-{self.year}',emp))
        project=self.db.execute("""INSERT INTO projects(project_code,project_name,start_date)
            VALUES(%s,'Synthetic project','2020-01-01') RETURNING project_id""",(f'SYNTH-P{self.year}',)).fetchone()[0]
        self.db.execute("INSERT INTO project_members(project_id,employee_id,project_allowance,joined_date) VALUES(%s,%s,675000,'2020-01-01')",(project,self.employee))
        sale=self.db.execute("""INSERT INTO employee_sales(employee_id,store_id,salary_period,phone_revenue)
            VALUES(%s,%s,%s,42000000) RETURNING sale_record_id""",(self.employee,self.store,f'{self.year}-10')).fetchone()[0]
        self.db.execute("""INSERT INTO commissions(sale_record_id,employee_id,salary_period,commission_amount,kpi_bonus_amount)
            VALUES(%s,%s,%s,420000,210000)""",(sale,self.employee,f'{self.year}-10'))
        for i,paid in enumerate((True,False),1):
            kind=self.db.execute("INSERT INTO leave_types(type_code,type_name,is_paid) VALUES(%s,'Synthetic leave',%s) RETURNING leave_type_id",
                (f'SYNTH-T{self.year}-{i}',paid)).fetchone()[0]
            self.db.execute("""INSERT INTO leave_requests(employee_id,leave_type_id,start_date,end_date,total_days,reason,status)
                VALUES(%s,%s,%s,%s,%s,'Synthetic approved leave','HR_APPROVED')""",
                (self.employee,kind,date(self.year,10,i),date(self.year,10,i)+timedelta(days=i-1),i))
        self.db.execute("""INSERT INTO attendance_overtime_approvals(attendance_id,approved_hours,decision,reviewer_user_id,reason)
            VALUES(%s,1.25,'APPROVED',%s,'Synthetic legacy comparator')""",(att,self.hr))
        self.db.execute("CALL sp_generate_monthly_payroll(%s,%s)",(f'{self.year}-10',self.no_ot))
        before=self.payroll_rows(); details=self.payroll_details()
        run=self.run_source(); self.build(run); self.assertTrue(self.ready(run)); self.prepare(run)
        self.calculate(self.db,run)
        after=self.payroll_rows()
        ignored={'payroll_id','created_at','updated_at','payroll_ot_candidate_run_id','overtime_salary','gross_income','net_salary'}
        for (old,),(new,) in zip(before,after):
            self.assertEqual({k:v for k,v in old.items() if k not in ignored},{k:v for k,v in new.items() if k not in ignored})
        self.assertEqual(details,self.payroll_details())
        target=next(row[0] for row in after if row[0]['employee_id']==self.employee)
        for field in ('position_allowance','seniority_allowance','project_allowance','meal_transport_allowance','commission_amount',
                      'holiday_bonus','productivity_bonus','time_deduction_amount','bhxh_amount','bhyt_amount','bhtn_amount','penalty_deduction'):
            self.assertGreater(target[field],0,field)
        self.assertEqual(target['paid_leave_days'],1); self.assertEqual(target['unpaid_leave_days'],2)
        self.assertEqual(target['overtime_salary'],375000)
        payroll=target['payroll_id']
        self.db.execute("UPDATE payrolls SET payment_status='CONFIRMED' WHERE payroll_id=%s",(payroll,))
        finalized=self.payroll_rows()
        self.fails("CALL sp_generate_monthly_payroll_verified_locked_candidate(%s,%s,%s)",
            (f'{self.year}-10',self.no_ot,run),'PAYROLL_FINALIZED_PERIOD_IMMUTABLE')
        self.assertEqual(finalized,self.payroll_rows()); self.assertEqual(details,self.payroll_details())

    def test_24_concurrent_candidate_calculations_serialize_without_duplicate_rows(self):
        self.request(); run=self.run_source(); self.build(run); self.ready(run); self.prepare(run); self.db.commit()
        barrier=threading.Barrier(2)
        def worker():
            with connect() as conn:
                barrier.wait(timeout=5); self.calculate(conn,run)
                return 'CALCULATED'
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes=list(pool.map(lambda _:worker(),range(2)))
        self.assertEqual(outcomes,['CALCULATED','CALCULATED'])
        self.assertEqual(self.db.execute("SELECT count(*),count(DISTINCT employee_id) FROM payrolls WHERE salary_period=%s",(f'{self.year}-10',)).fetchone(),(2,2))
        self.assertFalse(self.db.execute("""SELECT 1 FROM payroll_details d JOIN payrolls p USING(payroll_id) WHERE p.salary_period=%s
            GROUP BY d.payroll_id,d.item_code HAVING count(*)>1""",(f'{self.year}-10',)).fetchall())

    def test_25_source_writer_waits_during_calculation_then_recalc_is_blocked(self):
        _,att=self.request(); run=self.run_source(); self.build(run); self.ready(run); self.prepare(run); self.db.commit()
        holder=connect(autocommit=False)
        try:
            self.calculate(holder,run)
            pid_box=[]; started=threading.Event()
            def writer():
                with connect() as conn:
                    pid_box.append(conn.info.backend_pid); started.set()
                    conn.execute("UPDATE attendances SET late_minutes=late_minutes+1 WHERE attendance_id=%s",(att,))
            with ThreadPoolExecutor(max_workers=1) as pool:
                future=pool.submit(writer); self.assertTrue(started.wait(3))
                deadline=time.monotonic()+4; blocked=False
                while time.monotonic()<deadline:
                    blocked=self.db.execute("SELECT cardinality(pg_blocking_pids(%s))>0",(pid_box[0],)).fetchone()[0]
                    if blocked: break
                    time.sleep(.02)
                self.assertTrue(blocked); self.assertFalse(future.done()); holder.commit(); future.result(timeout=5)
            prior=self.payroll_rows(); self.assertFalse(self.gate(run))
            self.fails("CALL sp_generate_monthly_payroll_verified_locked_candidate(%s,%s,%s)",
                (f'{self.year}-10',self.no_ot,run),'OT_PAYROLL_SOURCE_STALE')
            self.assertEqual(prior,self.payroll_rows())
        finally:
            holder.rollback(); holder.close()

    def test_26_transaction_interruption_rolls_back_calculation_and_retry_succeeds(self):
        self.request(); run=self.run_source(); self.build(run); self.ready(run); self.prepare(run); self.db.commit()
        with connect(autocommit=False) as transaction:
            self.calculate(transaction,run); transaction.rollback()
        self.assertEqual(self.payroll_rows(),[])
        self.calculate(self.db,run)
        self.assertEqual(len(self.payroll_rows()),2)
        self.assertEqual(self.db.execute("SELECT count(*) FROM ot9_candidate_source_events WHERE run_id=%s AND event_type='PREPARE'",(run,)).fetchone()[0],1)


def main():
    evidence={'database':DB,'host':'127.0.0.1','port':5432,'user':'postgres',
              'source_schema_only':SOURCE,'simulated_cutoff':CUTOFF.isoformat(),
              'baseline_sha256':BASELINE,'actual_cutoff':'NOT_SET','policy':'DISABLED','api_browser_staging':'NOT_RUN'}
    try:
        create_fixture()
        result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(LedgerTests))
        evidence.update(tests_run=result.testsRun,failures=[t.id() for t,_ in result.failures],
                        errors=[t.id() for t,_ in result.errors],skips=[t.id() for t,_ in result.skipped])
        evidence['pass']=result.testsRun-len(result.failures)-len(result.errors)-len(result.skipped)
        evidence['test_cases']=[]
        for name in unittest.defaultTestLoader.getTestCaseNames(LedgerTests):
            full=f'__main__.LedgerTests.{name}'
            status='FAIL' if full in evidence['failures'] else 'ERROR' if full in evidence['errors'] else 'SKIP' if full in evidence['skips'] else 'PASS'
            evidence['test_cases'].append({'name':name,'status':status})
        with connect('postgres') as admin:
            evidence['postgres_version']=admin.execute('SELECT version()').fetchone()[0]
    finally:
        if OWNED: evidence['database_removed']=cleanup_fixture()
        out=ROOT/'evidence'; out.mkdir(exist_ok=True)
        stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        for name in ['payroll_ot_segment_ledger_candidate.sql','test_ot_segment_ledger_candidate.py']:
            evidence.setdefault('sha256',{})[name]=hashlib.sha256((ROOT/name).read_bytes()).hexdigest()
        path=out/f'ot-ledger-{stamp}.json'
        with path.open('x',encoding='utf-8') as f: json.dump(evidence,f,indent=2)
        print('Evidence:',path)
    return 0 if result.wasSuccessful() else 1


if __name__=='__main__':
    raise SystemExit(main())
