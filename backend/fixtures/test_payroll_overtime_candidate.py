"""Local-only tests of review-only OT source ledger; no Payroll procedure calls."""
from __future__ import annotations

import json
import random
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from ipaddress import ip_interface
from pathlib import Path

import psycopg

DATABASE = "ot_cutover02_m9_full_e2e"
DSN = f"postgresql://postgres@127.0.0.1:5432/{DATABASE}"
SQL = Path(__file__).with_name("payroll_overtime_candidate_schema.sql")
VN = timezone(timedelta(hours=7))


def split_by_month(start: datetime, end: datetime) -> list[tuple[datetime, datetime]]:
    """Split half-open UTC instants at local Vietnam month boundaries, no rounding."""
    if start.tzinfo is None or end.tzinfo is None or end <= start:
        raise ValueError("Invalid aware interval")
    current = start.astimezone(VN)
    finish = end.astimezone(VN)
    segments = []
    while current < finish:
        year, month = current.year, current.month
        boundary = datetime(year + (month == 12), month % 12 + 1, 1, tzinfo=VN)
        next_stop = min(finish, boundary)
        segments.append((current, next_stop))
        current = next_stop
    return segments


def test_concurrent_period_prepare() -> None:
    with psycopg.connect(DSN) as db:
        identity, address = db.execute(
            "SELECT current_database(),inet_server_addr()::text").fetchone()
        if identity != DATABASE or not ip_interface(address).ip.is_loopback:
            raise RuntimeError("Refusing non-synthetic/non-loopback candidate concurrency test")
        year = 2100 + random.SystemRandom().randint(0, 7000)
        month = random.SystemRandom().randint(1, 12)
        period_start = date(year, month, 1)
        period_end = date(year + (month == 12), month % 12 + 1, 1)
        run_ids = []
        for _ in range(2):
            run_id = db.execute("""INSERT INTO ot9_candidate_source_runs
                (period_start,period_end,source_mode)
                VALUES(%s,%s,'VERIFIED_ONLY') RETURNING run_id""",
                (period_start, period_end)).fetchone()[0]
            db.execute("SELECT ot9_candidate_capture_employee_scope(%s)", (run_id,))
            db.execute("""INSERT INTO ot9_candidate_employee_decisions
                (run_id,employee_id,decision,decided_by,decided_at,source_fingerprint)
                SELECT %s,s.employee_id,'NO_OT_CONFIRMED',4,clock_timestamp(),
                       ot9_candidate_employee_source_fingerprint(%s,s.employee_id)
                FROM ot9_candidate_run_employees s WHERE s.run_id=%s""",
                (run_id, run_id, run_id))
            db.execute("""INSERT INTO ot9_candidate_payroll_period_evidence
                (run_id,checked_at,closed_or_paid,evidence_fingerprint,checked_by)
                VALUES(%s,clock_timestamp(),false,'synthetic-concurrency-open',4)""",
                (run_id,))
            db.execute("SELECT ot9_candidate_capture_preflight(%s,4)", (run_id,))
            if not db.execute("""SELECT preliminarily_ready FROM ot9_candidate_source_gate
                WHERE run_id=%s""", (run_id,)).fetchone()[0]:
                raise AssertionError("Synthetic concurrency candidate was not ready")
            run_ids.append(run_id)

    barrier = threading.Barrier(2)

    def prepare(run_id: int) -> str:
        with psycopg.connect(DSN) as db:
            barrier.wait()
            try:
                db.execute("SELECT ot9_candidate_prepare_run(%s,4)", (run_id,)).fetchone()
                return "PREPARED"
            except psycopg.errors.UniqueViolation:
                db.rollback()
                return "PERIOD_CONFLICT"

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(prepare, run_ids))
    assert sorted(outcomes) == ["PERIOD_CONFLICT", "PREPARED"]
    with psycopg.connect(DSN) as db:
        statuses = db.execute("""SELECT status FROM ot9_candidate_source_runs
            WHERE run_id=ANY(%s) ORDER BY status""", (run_ids,)).fetchall()
    assert statuses == [("HOLD",), ("PREPARED",)]
    print("PASS PAY-CAND-08: concurrent same-period prepare serializes to one winner")


def main() -> None:
    with psycopg.connect(DSN) as db:
        identity, address = db.execute("SELECT current_database(),inet_server_addr()::text").fetchone()
        if identity != DATABASE or not ip_interface(address).ip.is_loopback:
            raise RuntimeError("Refusing non-synthetic/non-loopback database")
        db.execute(SQL.read_text(encoding="utf-8"))
        print("PASS PAY-CAND-01: additive standalone ledger schema on local synthetic PostgreSQL")

        # All scenarios below roll back. Real payroll tables/procedure are untouched.
        db.execute("SAVEPOINT candidate_cases")
        run = db.execute("""INSERT INTO ot9_candidate_source_runs(period_start,period_end,source_mode)
            VALUES('2026-10-01','2026-11-01','VERIFIED_ONLY') RETURNING run_id""").fetchone()[0]
        scoped_count = db.execute("SELECT ot9_candidate_capture_employee_scope(%s)", (run,)).fetchone()[0]
        assert scoped_count >= 1
        empty = db.execute("SELECT preliminarily_ready,verified_microseconds FROM ot9_candidate_source_gate WHERE run_id=%s", (run,)).fetchone()
        assert empty == (False, 0)
        print("PASS PAY-CAND-02: empty, unscoped decision ledger remains HOLD, never implies 0 payable OT")

        verified = db.execute("""SELECT request_id,employee_id,version,eligible_intervals,
            verified_microseconds FROM v_overtime_verified_current ORDER BY request_id LIMIT 1""").fetchone()
        assert verified is not None
        request_id, employee_id, version, intervals, expected_us = verified
        signature = db.execute("SELECT ot_reconciliation_source_signature(%s)", (request_id,)).fetchone()[0]
        employee_fingerprint = db.execute(
            "SELECT ot9_candidate_employee_source_fingerprint(%s,%s)",
            (run, employee_id)).fetchone()[0]
        db.execute("""INSERT INTO ot9_candidate_employee_decisions
            (run_id,employee_id,decision,decided_by,decided_at,source_fingerprint)
            VALUES(%s,%s,'VERIFIED_COMPLETE',4,clock_timestamp(),%s)""",
            (run, employee_id, employee_fingerprint))
        total_us = 0
        for interval in intervals:
            start = datetime.fromisoformat(interval["starts_at"])
            end = datetime.fromisoformat(interval["ends_at"])
            for segment_start, segment_end in split_by_month(start, end):
                duration = segment_end - segment_start
                microseconds = (duration.days * 86_400_000_000
                                + duration.seconds * 1_000_000 + duration.microseconds)
                total_us += microseconds
                db.execute("""INSERT INTO ot9_candidate_verified_segments
                    (run_id,employee_id,request_id,reconciliation_version,source_signature,
                     segment_start,segment_end,microseconds)
                    VALUES(%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (run, employee_id, request_id, version, signature,
                     segment_start, segment_end, microseconds))
        assert total_us == expected_us
        duplicate_failed = False
        db.execute("SAVEPOINT duplicate_segment")
        try:
            first = db.execute("""SELECT employee_id,request_id,reconciliation_version,source_signature,
                segment_start,segment_end,microseconds FROM ot9_candidate_verified_segments
                WHERE run_id=%s LIMIT 1""", (run,)).fetchone()
            db.execute("""INSERT INTO ot9_candidate_verified_segments
                (run_id,employee_id,request_id,reconciliation_version,source_signature,
                 segment_start,segment_end,microseconds)
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s)""", (run, *first))
        except psycopg.errors.UniqueViolation:
            duplicate_failed = True
            db.execute("ROLLBACK TO SAVEPOINT duplicate_segment")
        assert duplicate_failed
        db.execute("SAVEPOINT overlapping_segment")
        overlaps_failed = False
        first_segment = db.execute("""SELECT employee_id,request_id,reconciliation_version,
            source_signature,segment_start,segment_end,microseconds
            FROM ot9_candidate_verified_segments WHERE run_id=%s ORDER BY segment_id LIMIT 1""",
            (run,)).fetchone()
        try:
            db.execute("""INSERT INTO ot9_candidate_verified_segments
                (run_id,employee_id,request_id,reconciliation_version,source_signature,
                 segment_start,segment_end,microseconds)
                VALUES(%s,%s,%s,%s,%s,%s+interval '1 second',%s+interval '1 second',%s)""",
                (run, *first_segment))
        except psycopg.errors.RaiseException:
            overlaps_failed = True
            db.execute("ROLLBACK TO SAVEPOINT overlapping_segment")
        assert overlaps_failed
        print("PASS PAY-CAND-03: verified totals, exact retry unique, overlapping candidate segments rejected")

        total_before = db.execute("""SELECT SUM(microseconds) FROM ot9_candidate_verified_segments
            WHERE run_id=%s""", (run,)).fetchone()[0]
        first_segment_id = db.execute("""SELECT segment_id FROM ot9_candidate_verified_segments
            WHERE run_id=%s ORDER BY segment_id LIMIT 1""", (run,)).fetchone()[0]
        db.execute("""UPDATE ot9_candidate_verified_segments SET microseconds=microseconds-1
            WHERE segment_id=%s""", (first_segment_id,))
        mismatch_codes = {row[0] for row in db.execute("""SELECT blocker_code
            FROM ot9_candidate_blockers WHERE run_id=%s""", (run,)).fetchall()}
        assert "VERIFIED_SEGMENT_TOTAL_MISMATCH" in mismatch_codes
        db.execute("""UPDATE ot9_candidate_verified_segments SET microseconds=microseconds+1
            WHERE segment_id=%s""", (first_segment_id,))
        assert db.execute("""SELECT SUM(microseconds) FROM ot9_candidate_verified_segments
            WHERE run_id=%s""", (run,)).fetchone()[0] == total_before

        other_employee = db.execute("""SELECT employee_id FROM ot9_candidate_run_employees
            WHERE run_id=%s AND employee_id<>%s ORDER BY employee_id LIMIT 1""",
            (run, employee_id)).fetchone()[0]
        other_fingerprint = db.execute(
            "SELECT ot9_candidate_employee_source_fingerprint(%s,%s)",
            (run, other_employee)).fetchone()[0]
        db.execute("""INSERT INTO ot9_candidate_employee_decisions
            (run_id,employee_id,decision,decided_by,decided_at,source_fingerprint)
            VALUES(%s,%s,'NO_OT_CONFIRMED',4,clock_timestamp(),%s)""",
            (run, other_employee, other_fingerprint))
        assert db.execute("SELECT status FROM ot9_candidate_source_runs WHERE run_id=%s", (run,)).fetchone()[0] == "HOLD"
        assert db.execute("""SELECT NOT preliminarily_ready FROM ot9_candidate_source_gate
            WHERE run_id=%s""", (run,)).fetchone()[0]
        db.execute("""INSERT INTO ot9_candidate_payroll_period_evidence
            (run_id,checked_at,closed_or_paid,evidence_fingerprint,checked_by)
            VALUES(%s,clock_timestamp(),false,'synthetic-open-period',4)""", (run,))
        db.execute("SELECT ot9_candidate_capture_preflight(%s,4)", (run,))
        attendance_id = db.execute("""SELECT attendance_id FROM attendances
            WHERE employee_id=%s AND work_date>='2026-10-01' AND work_date<'2026-11-01'
            ORDER BY attendance_id LIMIT 1""", (employee_id,)).fetchone()[0]
        db.execute("UPDATE attendances SET late_minutes=late_minutes+1 WHERE attendance_id=%s",
                   (attendance_id,))
        blockers = db.execute("""SELECT blocker_code FROM ot9_candidate_blockers
            WHERE run_id=%s""", (run,)).fetchall()
        assert any(code == "SOURCE_CHANGED_AFTER_PREFLIGHT" for (code,) in blockers)
        assert db.execute("""SELECT NOT preliminarily_ready FROM ot9_candidate_source_gate
            WHERE run_id=%s""", (run,)).fetchone()[0]
        print("PASS PAY-CAND-04: explicit NO_OT is not enough; post-preflight Attendance mutation invalidates gate")

        db.execute("SAVEPOINT candidate_prepare_cases")
        complete_run, competing_run = [
            db.execute("""INSERT INTO ot9_candidate_source_runs
                (period_start,period_end,source_mode)
                VALUES(%s,%s,'VERIFIED_ONLY') RETURNING run_id""",
                (period_start, period_end)).fetchone()[0]
            for period_start, period_end in (("2099-01-01","2099-02-01"),
                                             ("2099-01-01","2099-02-01"))
        ]
        for candidate_run in (complete_run, competing_run):
            assert db.execute("SELECT ot9_candidate_capture_employee_scope(%s)",
                              (candidate_run,)).fetchone()[0] >= 1
            db.execute("""INSERT INTO ot9_candidate_employee_decisions
                (run_id,employee_id,decision,decided_by,decided_at,source_fingerprint)
                SELECT %s,s.employee_id,'NO_OT_CONFIRMED',4,clock_timestamp(),
                       ot9_candidate_employee_source_fingerprint(%s,s.employee_id)
                FROM ot9_candidate_run_employees s WHERE s.run_id=%s""",
                (candidate_run, candidate_run, candidate_run))
            db.execute("""INSERT INTO ot9_candidate_payroll_period_evidence
                (run_id,checked_at,closed_or_paid,evidence_fingerprint,checked_by)
                VALUES(%s,clock_timestamp(),false,'synthetic-open-period',4)""",
                (candidate_run,))
            db.execute("SELECT ot9_candidate_capture_preflight(%s,4)", (candidate_run,))
            assert db.execute("""SELECT preliminarily_ready FROM ot9_candidate_source_gate
                WHERE run_id=%s""", (candidate_run,)).fetchone()[0]
        prepared_fingerprint = db.execute(
            "SELECT ot9_candidate_prepare_run(%s,4)", (complete_run,)).fetchone()[0]
        assert prepared_fingerprint
        db.execute("SAVEPOINT competing_candidate_prepare")
        duplicate_period_failed = False
        try:
            db.execute("SELECT ot9_candidate_prepare_run(%s,4)", (competing_run,)).fetchone()
        except psycopg.errors.UniqueViolation:
            duplicate_period_failed = True
            db.execute("ROLLBACK TO SAVEPOINT competing_candidate_prepare")
        assert duplicate_period_failed
        assert db.execute("""SELECT status FROM ot9_candidate_source_runs
            WHERE run_id=%s""", (competing_run,)).fetchone()[0] == "HOLD"

        closed_run = db.execute("""INSERT INTO ot9_candidate_source_runs
            (period_start,period_end,source_mode)
            VALUES('2099-02-01','2099-03-01','VERIFIED_ONLY') RETURNING run_id""").fetchone()[0]
        db.execute("SELECT ot9_candidate_capture_employee_scope(%s)", (closed_run,))
        db.execute("""INSERT INTO ot9_candidate_employee_decisions
            (run_id,employee_id,decision,decided_by,decided_at,source_fingerprint)
            SELECT %s,s.employee_id,'NO_OT_CONFIRMED',4,clock_timestamp(),
                   ot9_candidate_employee_source_fingerprint(%s,s.employee_id)
            FROM ot9_candidate_run_employees s WHERE s.run_id=%s""",
            (closed_run, closed_run, closed_run))
        db.execute("""INSERT INTO ot9_candidate_payroll_period_evidence
            (run_id,checked_at,closed_or_paid,evidence_fingerprint,checked_by)
            VALUES(%s,clock_timestamp(),true,'synthetic-paid-period',4)""", (closed_run,))
        db.execute("SELECT ot9_candidate_capture_preflight(%s,4)", (closed_run,))
        assert db.execute("""SELECT NOT preliminarily_ready FROM ot9_candidate_source_gate
            WHERE run_id=%s""", (closed_run,)).fetchone()[0]
        assert db.execute("""SELECT blocker_code FROM ot9_candidate_blockers
            WHERE run_id=%s AND blocker_code='PAYROLL_PERIOD_CLOSED'""",
            (closed_run,)).fetchone() == ("PAYROLL_PERIOD_CLOSED",)
        db.execute("ROLLBACK TO SAVEPOINT candidate_prepare_cases")
        print("PASS PAY-CAND-07: complete explicit no-OT coverage prepares once; paid period and duplicate run are blocked")

        db.execute("""INSERT INTO ot9_candidate_source_events(run_id,actor_id,event_type,detail)
            VALUES(%s,4,'HOLD',%s::jsonb)""", (run, json.dumps({"reason": "test"})))
        db.execute("SAVEPOINT event_immutability")
        immutable = False
        try:
            db.execute("DELETE FROM ot9_candidate_source_events WHERE run_id=%s", (run,))
        except psycopg.errors.ObjectNotInPrerequisiteState:
            immutable = True
            db.execute("ROLLBACK TO SAVEPOINT event_immutability")
        assert immutable
        db.execute("ROLLBACK TO SAVEPOINT candidate_cases")
        print("PASS PAY-CAND-05: append-only event, synthetic decision rows rolled back")

        start = datetime(2026, 10, 31, 23, 30, tzinfo=VN)
        end = datetime(2026, 11, 1, 1, 30, tzinfo=VN)
        parts = split_by_month(start, end)
        assert len(parts) == 2 and sum(((b - a) for a, b in parts), timedelta()) == timedelta(hours=2)
        assert parts[0][1] == parts[1][0] == datetime(2026, 11, 1, tzinfo=VN)
        print("PASS PAY-CAND-06: cross-month half-open split at Vietnam midnight; 2h conserved")

    test_concurrent_period_prepare()


if __name__ == "__main__":
    main()
