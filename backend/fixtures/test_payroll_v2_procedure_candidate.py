"""Local-only integration tests for the review-only Payroll v2 procedure.

Requires a disposable schema-only PostgreSQL database created from the
`mission9_synthetic` schema. Every synthetic row is rolled back at test end.
No `.env`, Supabase, production procedure, or shared payroll data is used.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from ipaddress import ip_interface

import psycopg
from psycopg.types.json import Jsonb


DATABASE = "ot_payroll_v2_candidate_20261020"
DSN = f"postgresql://postgres@127.0.0.1:5432/{DATABASE}"
PERIOD = "2026-10"
VN = timezone(timedelta(hours=7))


def _same_except_ot(before: dict, after: dict) -> None:
    allowed = {
        "payroll_id", "overtime_salary", "gross_income", "net_salary",
        "payment_status", "payment_date", "created_at", "updated_at",
        "payroll_ot_candidate_run_id",
    }
    assert {k: v for k, v in before.items() if k not in allowed} == {
        k: v for k, v in after.items() if k not in allowed
    }


def _expect_sql_error(conn, sql: str, params: tuple, expected: str) -> str:
    try:
        with conn.transaction():
            conn.execute(sql, params)
    except psycopg.Error as exc:
        message = str(exc)
        assert expected in message, message
        return message
    raise AssertionError(f"Expected PostgreSQL error containing {expected!r}")


def main() -> None:
    with psycopg.connect(DSN) as conn:
        identity = conn.execute(
            "SELECT current_database(),inet_server_addr()::text,inet_server_port()"
        ).fetchone()
        if identity != (DATABASE, "127.0.0.1/32", 5432):
            raise RuntimeError(f"Refusing unexpected/non-loopback database: {identity!r}")
        counts = conn.execute(
            "SELECT (SELECT count(*) FROM employees),(SELECT count(*) FROM payrolls),"
            "(SELECT count(*) FROM payroll_details)"
        ).fetchone()
        if counts != (0, 0, 0):
            raise RuntimeError(f"Disposable schema must begin with no rows: {counts!r}")

        conn.execute("BEGIN")
        try:
            store_id = conn.execute(
                """INSERT INTO stores(store_code,store_name,address,district,city,open_date)
                   VALUES('SYNTH-M9','Synthetic Store','Synthetic Address','Synthetic District',
                          'Ho Chi Minh City','2020-01-01') RETURNING store_id"""
            ).fetchone()[0]
            department_id = conn.execute(
                """INSERT INTO departments(department_code,department_name)
                   VALUES('SYNTH-M9','Synthetic Department') RETURNING department_id"""
            ).fetchone()[0]
            education_id = conn.execute(
                """INSERT INTO education_levels(level_code,level_name)
                   VALUES('SYNTH-M9','Synthetic') RETURNING education_level_id"""
            ).fetchone()[0]
            position_id = conn.execute(
                """INSERT INTO positions(position_code,position_name,base_salary_min,
                     base_salary_max,position_allowance,position_coefficient)
                   VALUES('SYNTH-M9','Synthetic Staff',0,30000000,350000,1.0)
                   RETURNING position_id"""
            ).fetchone()[0]
            shift_id = conn.execute(
                """INSERT INTO work_shifts(shift_code,shift_name,start_time,end_time,work_hours)
                   VALUES('SYNTH-M9','Synthetic Shift','09:00','18:00',8)
                   RETURNING shift_id"""
            ).fetchone()[0]

            employee_ids = []
            for index in (1, 2, 3):
                employee_id = conn.execute(
                """INSERT INTO employees(employee_code,first_name,last_name,gender,dob,
                         identity_card,phone,company_email,current_address,store_id,department_id,
                         position_id,education_level_id,join_date,employment_status)
                       VALUES(%s,'Synthetic',%s,'MALE','1990-01-01',%s,%s,%s,%s,
                              %s,%s,%s,%s,'2026-01-01','ACTIVE') RETURNING employee_id""",
                    (f"SYNTH-M9-{index}", f"Employee {index}", f"SYNTH-ID-{index}", f"09000000{index}",
                     f"synthetic{index}@example.invalid", f"Synthetic Address {index}",
                     store_id, department_id, position_id, education_id),
                ).fetchone()[0]
                employee_ids.append(employee_id)
            employee_with_ot, employee_no_ot, employee_legacy_final = employee_ids

            hr_user_id = conn.execute(
                """INSERT INTO users(employee_id,username,password_hash,email)
                   VALUES(NULL,'synthetic_m9_hr','not-a-secret-hash','hr@example.invalid')
                   RETURNING user_id"""
            ).fetchone()[0]
            for index, employee_id in enumerate(employee_ids, 1):
                conn.execute(
                    """INSERT INTO contracts(contract_number,employee_id,contract_type,start_date,
                         basic_salary,insurance_salary,status,signed_date,created_by,position_id,department_id)
                       VALUES(%s,%s,'FIXED_1_YEAR','2026-01-01',26000000,20000000,'ACTIVE',
                              '2026-01-01',%s,%s,%s)""",
                    (f"SYNTH-M9-{index}", employee_id, hr_user_id, position_id, department_id),
                )

            work_date = date(2026, 10, 10)
            check_in = datetime(2026, 10, 10, 9, 0, tzinfo=VN)
            check_out = datetime(2026, 10, 10, 20, 0, tzinfo=VN)
            attendance_id = conn.execute(
                """INSERT INTO attendances(employee_id,store_id,shift_id,work_date,check_in_time,
                     check_out_time,late_minutes,early_minutes,overtime_hours,actual_work_hours,status,
                     attendance_context)
                   VALUES(%s,%s,%s,%s,%s,%s,0,0,9.75,9,'NORMAL',%s) RETURNING attendance_id""",
                (employee_with_ot, store_id, shift_id, work_date, check_in, check_out,
                 Jsonb({
                     "schedule_status": "MATCHED",
                     "planned": {
                         "store_id": store_id,
                         "shift_id": shift_id,
                         "starts_at": datetime(2026, 10, 10, 9, 0, tzinfo=VN).isoformat(),
                         "ends_at": datetime(2026, 10, 10, 18, 0, tzinfo=VN).isoformat(),
                     },
                     "actual": {"shift_id": shift_id},
                 })),
            ).fetchone()[0]
            request_id = conn.execute(
                """INSERT INTO overtime_requests(employee_id,store_id,work_date,starts_at,ends_at,
                     reason,created_by,status,reviewed_by,reviewed_at)
                   VALUES(%s,%s,%s,%s,%s,'Synthetic approved overtime',%s,'APPROVED',%s,clock_timestamp())
                   RETURNING request_id""",
                (employee_with_ot, store_id, work_date,
                 datetime(2026, 10, 10, 18, 0, tzinfo=VN), check_out, hr_user_id, hr_user_id),
            ).fetchone()[0]
            conn.execute(
                """INSERT INTO attendance_overtime_approvals(attendance_id,approved_hours,decision,
                     reviewer_user_id,reason)
                   VALUES(%s,1.25,'APPROVED',%s,'Synthetic legacy source for comparison')""",
                (attendance_id, hr_user_id),
            )
            signature = conn.execute(
                "SELECT ot_reconciliation_source_signature(%s)", (request_id,)
            ).fetchone()[0]
            interval = [{
                "starts_at": datetime(2026, 10, 10, 18, 0, tzinfo=VN).isoformat(),
                "ends_at": check_out.isoformat(),
            }]
            verified_us = 2 * 60 * 60 * 1_000_000
            conn.execute(
                """INSERT INTO overtime_reconciliations(request_id,employee_id,store_id,status,
                     version,source_signature,proposed_microseconds,verified_microseconds,
                     eligible_intervals,attendance_ids,reviewed_by,reviewed_at)
                   VALUES(%s,%s,%s,'VERIFIED',1,%s,%s,%s,%s,%s,%s,clock_timestamp())""",
                (request_id, employee_with_ot, store_id, signature, verified_us, verified_us,
                 Jsonb(interval), Jsonb([attendance_id]), hr_user_id),
            )

            run_id = conn.execute(
                """INSERT INTO ot9_candidate_source_runs(period_start,period_end,source_mode,synthetic_cutoff)
                   VALUES('2026-10-01','2026-11-01','VERIFIED_ONLY','2026-10-01') RETURNING run_id"""
            ).fetchone()[0]
            assert conn.execute(
                "SELECT ot9_candidate_capture_employee_scope(%s)", (run_id,)
            ).fetchone()[0] == 3
            for employee_id in employee_ids:
                fingerprint = conn.execute(
                    "SELECT ot9_candidate_employee_source_fingerprint(%s,%s)",
                    (run_id, employee_id),
                ).fetchone()[0]
                decision = "VERIFIED_COMPLETE" if employee_id == employee_with_ot else "NO_OT_CONFIRMED"
                conn.execute(
                    """INSERT INTO ot9_candidate_employee_decisions
                       (run_id,employee_id,decision,decided_by,decided_at,source_fingerprint)
                       VALUES(%s,%s,%s,%s,clock_timestamp(),%s)""",
                    (run_id, employee_id, decision, hr_user_id, fingerprint),
                )
            conn.execute(
                """INSERT INTO ot9_candidate_verified_segments(run_id,employee_id,request_id,
                     reconciliation_version,source_signature,segment_start,segment_end,microseconds)
                   VALUES(%s,%s,%s,1,%s,%s,%s,%s)""",
                (run_id, employee_with_ot, request_id, signature,
                 datetime(2026, 10, 10, 18, 0, tzinfo=VN), check_out, verified_us),
            )
            conn.execute(
                """INSERT INTO ot9_candidate_payroll_period_evidence
                   (run_id,checked_at,closed_or_paid,evidence_fingerprint,checked_by)
                   VALUES(%s,clock_timestamp(),false,'synthetic-open-period',%s)""",
                (run_id, hr_user_id),
            )
            conn.execute("SELECT ot9_candidate_capture_preflight(%s,%s)", (run_id, hr_user_id))
            ready = conn.execute(
                "SELECT preliminarily_ready FROM ot9_candidate_source_gate WHERE run_id=%s",
                (run_id,),
            ).fetchone()[0]
            if not ready:
                blockers = conn.execute(
                    "SELECT blocker_code,subject_id FROM ot9_candidate_blockers WHERE run_id=%s",
                    (run_id,),
                ).fetchall()
                raise AssertionError(f"Synthetic source should be ready, blockers={blockers!r}")
            conn.execute("SELECT ot9_candidate_prepare_run(%s,%s)", (run_id, hr_user_id))

            # The installed procedure's second argument is named p_hr_user_id,
            # but its created_by FK in this baseline targets employees.employee_id.
            conn.execute("CALL sp_generate_monthly_payroll(%s,%s)", (PERIOD, employee_with_ot))
            before_rows = conn.execute(
                "SELECT * FROM payrolls WHERE salary_period=%s ORDER BY employee_id", (PERIOD,)
            ).fetchall()
            columns = [d.name for d in conn.execute(
                "SELECT * FROM payrolls LIMIT 0"
            ).description]
            before = {row[columns.index("employee_id")]: dict(zip(columns, row)) for row in before_rows}
            legacy_ot_salary = Decimal(str(before[employee_with_ot]["overtime_salary"]))
            assert legacy_ot_salary == Decimal("234375")
            assert before[employee_with_ot]["gross_income"] > 0
            before_ot_details = conn.execute(
                """SELECT item_code,amount FROM payroll_details d JOIN payrolls p USING(payroll_id)
                   WHERE p.employee_id=%s AND p.salary_period=%s ORDER BY item_code""",
                (employee_with_ot, PERIOD),
            ).fetchall()

            conn.execute(
                "CALL sp_generate_monthly_payroll_verified_candidate(%s,%s,%s)",
                (PERIOD, employee_with_ot, run_id),
            )
            after_rows = conn.execute(
                "SELECT * FROM payrolls WHERE salary_period=%s ORDER BY employee_id", (PERIOD,)
            ).fetchall()
            after = {row[columns.index("employee_id")]: dict(zip(columns, row)) for row in after_rows}
            assert set(before) == set(after) == set(employee_ids)
            for employee_id in employee_ids:
                _same_except_ot(before[employee_id], after[employee_id])
            assert Decimal(str(after[employee_with_ot]["overtime_salary"])) == Decimal("375000")
            assert Decimal(str(after[employee_no_ot]["overtime_salary"])) == Decimal("0")
            assert Decimal(str(after[employee_legacy_final]["overtime_salary"])) == Decimal("0")
            assert Decimal(str(after[employee_with_ot]["gross_income"])) - Decimal(str(before[employee_with_ot]["gross_income"])) == Decimal("140625")
            assert Decimal(str(after[employee_with_ot]["net_salary"])) - Decimal(str(before[employee_with_ot]["net_salary"])) == Decimal("140625")
            assert after[employee_with_ot]["payroll_ot_candidate_run_id"] == run_id
            after_ot_details = conn.execute(
                """SELECT item_code,amount FROM payroll_details d JOIN payrolls p USING(payroll_id)
                   WHERE p.employee_id=%s AND p.salary_period=%s ORDER BY item_code""",
                (employee_with_ot, PERIOD),
            ).fetchall()
            before_non_ot_details = [(code, amount) for code, amount in before_ot_details if code != "OVERTIME"]
            after_non_ot_details = [(code, amount) for code, amount in after_ot_details if code != "OVERTIME"]
            assert before_non_ot_details == after_non_ot_details
            assert ("OVERTIME", Decimal("375000")) in after_ot_details
            print("PASS PAY-V2-CAND-01: prepared source replaces legacy hours; non-OT payroll columns unchanged")

            payroll_id = after[employee_with_ot]["payroll_id"]
            conn.execute(
                "UPDATE payrolls SET payment_status='CONFIRMED',updated_at=clock_timestamp() WHERE payroll_id=%s",
                (payroll_id,),
            )
            assert conn.execute(
                "SELECT count(*) FROM payroll_finalization_snapshots WHERE payroll_id=%s",
                (payroll_id,),
            ).fetchone()[0] == 1
            draft_id = after[employee_no_ot]["payroll_id"]
            _expect_sql_error(
                conn,
                "UPDATE payrolls SET payment_status='PAID',payment_date='2026-11-05' WHERE payroll_id=%s",
                (draft_id,),
                "DRAFT payroll may only remain DRAFT or become CONFIRMED",
            )
            _expect_sql_error(
                conn,
                "INSERT INTO payrolls(employee_id,store_id,salary_period,payment_status) VALUES(%s,%s,'2026-12','PAID')",
                (employee_legacy_final, store_id),
                "New payroll must start as DRAFT",
            )
            _expect_sql_error(
                conn,
                "CALL sp_generate_monthly_payroll_verified_candidate(%s,%s,%s)",
                (PERIOD, employee_with_ot, run_id),
                "PAYROLL_FINALIZED_PERIOD_IMMUTABLE",
            )
            _expect_sql_error(
                conn,
                "UPDATE payrolls SET payment_status='NEEDS_RECALCULATION',payment_date=NULL WHERE payroll_id=%s",
                (payroll_id,),
                "cannot be reopened",
            )
            _expect_sql_error(
                conn,
                "DELETE FROM payroll_details WHERE payroll_id=%s",
                (payroll_id,),
                "Details of a finalized payroll are immutable",
            )
            conn.execute(
                "UPDATE payrolls SET payment_status='PAID',payment_date='2026-11-05',updated_at=clock_timestamp() WHERE payroll_id=%s",
                (payroll_id,),
            )
            paid = conn.execute(
                "SELECT payment_status,payment_date,net_salary FROM payrolls WHERE payroll_id=%s",
                (payroll_id,),
            ).fetchone()
            snapshots = conn.execute(
                "SELECT count(*) FROM payroll_finalization_snapshots WHERE payroll_id=%s",
                (payroll_id,),
            ).fetchone()[0]
            assert paid[0:2] == ("PAID", date(2026, 11, 5)) and snapshots == 2
            _expect_sql_error(
                conn,
                "UPDATE payrolls SET payment_status='NEEDS_RECALCULATION',payment_date=NULL WHERE payroll_id=%s",
                (payroll_id,),
                "PAID payroll is immutable",
            )
            _expect_sql_error(
                conn,
                "DELETE FROM payrolls WHERE payroll_id=%s",
                (payroll_id,),
                "Finalized payroll cannot be deleted",
            )
            paid_after = conn.execute(
                "SELECT payment_status,payment_date,net_salary FROM payrolls WHERE payroll_id=%s",
                (payroll_id,),
            ).fetchone()
            assert paid_after == paid
            assert conn.execute(
                "SELECT jsonb_array_length(details_snapshot) FROM payroll_finalization_snapshots "
                "WHERE payroll_id=%s AND finalized_status='PAID'",
                (payroll_id,),
            ).fetchone()[0] > 0
            print("PASS PAY-V2-CAND-02: CONFIRMED/PAID snapshots block recalc, reopen, and detail deletion")

            legacy_confirmed_id = after[employee_no_ot]["payroll_id"]
            legacy_paid_id = after[employee_legacy_final]["payroll_id"]
            conn.execute("ALTER TABLE payrolls DISABLE TRIGGER trg_ot9_candidate_guard_payroll")
            conn.execute("ALTER TABLE payrolls DISABLE TRIGGER trg_ot9_candidate_capture_finalization")
            conn.execute(
                "UPDATE payrolls SET payment_status='CONFIRMED' WHERE payroll_id=%s",
                (legacy_confirmed_id,),
            )
            conn.execute(
                "UPDATE payrolls SET payment_status='PAID',payment_date='2026-09-30' WHERE payroll_id=%s",
                (legacy_paid_id,),
            )
            conn.execute("ALTER TABLE payrolls ENABLE TRIGGER trg_ot9_candidate_capture_finalization")
            conn.execute("ALTER TABLE payrolls ENABLE TRIGGER trg_ot9_candidate_guard_payroll")
            assert conn.execute(
                "SELECT count(*) FROM payroll_finalization_snapshots WHERE payroll_id=%s",
                (legacy_confirmed_id,),
            ).fetchone()[0] == 0
            assert conn.execute(
                "SELECT count(*) FROM payroll_finalization_snapshots WHERE payroll_id=%s",
                (legacy_paid_id,),
            ).fetchone()[0] == 0
            assert conn.execute(
                "SELECT count(*) FROM payroll_details WHERE payroll_id=%s",
                (legacy_paid_id,),
            ).fetchone()[0] > 0
            _expect_sql_error(
                conn,
                "UPDATE payrolls SET payment_status='NEEDS_RECALCULATION' WHERE payroll_id=%s",
                (legacy_confirmed_id,),
                "cannot be reopened",
            )
            _expect_sql_error(
                conn,
                "UPDATE payrolls SET net_salary=net_salary+1 WHERE payroll_id=%s",
                (legacy_confirmed_id,),
                "Finalized payroll amounts are immutable",
            )
            _expect_sql_error(
                conn,
                "DELETE FROM payrolls WHERE payroll_id=%s",
                (legacy_confirmed_id,),
                "Finalized payroll cannot be deleted",
            )
            _expect_sql_error(
                conn,
                "DELETE FROM payroll_details WHERE payroll_id=%s",
                (legacy_confirmed_id,),
                "Details of a finalized payroll are immutable",
            )
            conn.execute(
                "UPDATE payrolls SET payment_status='PAID',payment_date='2026-11-04' WHERE payroll_id=%s",
                (legacy_confirmed_id,),
            )
            confirmed_to_paid_snapshots = conn.execute(
                "SELECT finalized_status FROM payroll_finalization_snapshots WHERE payroll_id=%s ORDER BY revision",
                (legacy_confirmed_id,),
            ).fetchall()
            assert confirmed_to_paid_snapshots == [("CONFIRMED",), ("PAID",)]
            _expect_sql_error(
                conn,
                "UPDATE payrolls SET payment_date='2026-11-06' WHERE payroll_id=%s",
                (legacy_confirmed_id,),
                "PAID payroll is immutable",
            )
            _expect_sql_error(
                conn,
                "UPDATE payrolls SET payment_status='NEEDS_RECALCULATION',payment_date=NULL WHERE payroll_id=%s",
                (legacy_paid_id,),
                "PAID payroll is immutable",
            )
            _expect_sql_error(
                conn,
                "DELETE FROM payrolls WHERE payroll_id=%s",
                (legacy_paid_id,),
                "Finalized payroll cannot be deleted",
            )
            _expect_sql_error(
                conn,
                "DELETE FROM payroll_details WHERE payroll_id=%s",
                (legacy_paid_id,),
                "Details of a finalized payroll are immutable",
            )
            assert conn.execute(
                "SELECT payment_status,payment_date FROM payrolls WHERE payroll_id=%s",
                (legacy_confirmed_id,),
            ).fetchone() == ("PAID", date(2026, 11, 4))
            assert conn.execute(
                "SELECT payment_status,payment_date FROM payrolls WHERE payroll_id=%s",
                (legacy_paid_id,),
            ).fetchone() == ("PAID", date(2026, 9, 30))
            print("PASS PAY-V2-CAND-03: preexisting CONFIRMED/PAID rows without snapshots remain immutable")

            incomplete = conn.execute(
                """INSERT INTO ot9_candidate_source_runs(period_start,period_end,source_mode,synthetic_cutoff)
                   VALUES('2026-11-01','2026-12-01','VERIFIED_ONLY','2026-11-01') RETURNING run_id"""
            ).fetchone()[0]
            conn.execute("SELECT ot9_candidate_capture_employee_scope(%s)", (incomplete,))
            conn.execute(
                "INSERT INTO ot9_candidate_payroll_period_evidence(run_id,checked_at,closed_or_paid,evidence_fingerprint,checked_by) "
                "VALUES(%s,clock_timestamp(),false,'synthetic-open-period',%s)",
                (incomplete, hr_user_id),
            )
            conn.execute("SELECT ot9_candidate_capture_preflight(%s,%s)", (incomplete, hr_user_id))
            _expect_sql_error(
                conn,
                "CALL sp_generate_monthly_payroll_verified_candidate(%s,%s,%s)",
                ("2026-11", employee_with_ot, incomplete),
                "OT_PAYROLL_SOURCE_HOLD",
            )
            assert conn.execute(
                "SELECT count(*) FROM payrolls WHERE salary_period='2026-11'"
            ).fetchone()[0] == 0
            print("PASS PAY-V2-CAND-04: incomplete source is HOLD, not zero hours or legacy fallback")

            conn.execute(
                "UPDATE attendances SET late_minutes=late_minutes+1 WHERE attendance_id=%s",
                (attendance_id,),
            )
            _expect_sql_error(
                conn,
                "CALL sp_generate_monthly_payroll_verified_candidate(%s,%s,%s)",
                (PERIOD, employee_with_ot, run_id),
                "OT_PAYROLL_SOURCE_STALE",
            )
            assert conn.execute(
                "SELECT payment_status,payment_date FROM payrolls WHERE payroll_id=%s",
                (payroll_id,),
            ).fetchone() == ("PAID", date(2026, 11, 5))
            print("PASS PAY-V2-CAND-05: changed source fails closed without altering finalized payroll")

            # DDL and all synthetic rows live only in this disposable database; roll back test rows.
            conn.rollback()
            empty_after = conn.execute(
                "SELECT (SELECT count(*) FROM employees),(SELECT count(*) FROM payrolls),"
                "(SELECT count(*) FROM payroll_details),(SELECT count(*) FROM payroll_finalization_snapshots)"
            ).fetchone()
            assert empty_after == (0, 0, 0, 0), empty_after
            print("PASS PAY-V2-CAND-06: synthetic employees, attendance, and payslips rolled back")
        except Exception:
            conn.rollback()
            raise
    print("PASS 6/6 Payroll v2 candidate procedure integration tests; no payroll rows persisted")


if __name__ == "__main__":
    main()
