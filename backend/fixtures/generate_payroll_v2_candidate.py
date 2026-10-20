"""Generate a review-only candidate from the verified local procedure baseline.

This script only reads the explicitly named PostgreSQL loopback database and
writes a disposable fixture SQL file. It never modifies a database or source
Payroll module. Do not point it at Supabase or a shared remote database.
"""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

import psycopg


DB_NAME = "mission9_synthetic"
EXPECTED_SHA256 = "c4b02a2a3cf126f92c5418286bd6e5b6d43583eb02b25cc0255cfc3ba12a5d28"
OUTPUT = Path(__file__).with_name("payroll_v2_candidate_procedure.sql")


def main() -> None:
    with psycopg.connect(
        host="127.0.0.1", port=5432, dbname=DB_NAME, user="postgres", connect_timeout=3
    ) as conn:
        conn.execute("BEGIN READ ONLY")
        identity = conn.execute(
            "SELECT current_database(), inet_server_addr()::text, inet_server_port()"
        ).fetchone()
        if identity != (DB_NAME, "127.0.0.1/32", 5432):
            raise RuntimeError(f"Refusing unexpected database identity: {identity!r}")
        row = conn.execute(
            """SELECT p.oid::regprocedure::text, pg_get_functiondef(p.oid)
               FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
               WHERE n.nspname='public' AND p.proname='sp_generate_monthly_payroll'
                 AND p.prokind='p' AND p.pronargs=2"""
        ).fetchone()
        if not row:
            raise RuntimeError("Verified baseline procedure was not found")
        signature, baseline = row
        digest = hashlib.sha256(baseline.encode("utf-8")).hexdigest()
        if digest != EXPECTED_SHA256:
            raise RuntimeError(
                f"Procedure baseline changed; expected {EXPECTED_SHA256}, got {digest}"
            )
        conn.rollback()

    header = (
        "CREATE OR REPLACE PROCEDURE public.sp_generate_monthly_payroll"
        "(IN p_period character varying, IN p_hr_user_id integer)"
    )
    candidate_header = (
        "CREATE OR REPLACE PROCEDURE public.sp_generate_monthly_payroll_verified_candidate"
        "(IN p_period character varying, IN p_hr_user_id integer, IN p_source_run_id bigint)"
    )
    if baseline.count(header) != 1:
        raise RuntimeError("Unexpected installed procedure signature text")
    candidate = baseline.replace(header, candidate_header, 1)

    declare = """DECLARE
    v_standard_days NUMERIC(4, 1) := 26.0;
    v_period_date DATE := TO_DATE(p_period || '-01', 'YYYY-MM-DD');
BEGIN"""
    candidate_declare = """DECLARE
    v_standard_days NUMERIC(4, 1) := 26.0;
    v_period_date DATE := TO_DATE(p_period || '-01', 'YYYY-MM-DD');
    v_source_run ot9_candidate_source_runs%ROWTYPE;
    v_source_ready BOOLEAN;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('payroll:' || p_period, 0));
    SELECT * INTO v_source_run
      FROM ot9_candidate_source_runs WHERE run_id=p_source_run_id FOR SHARE;
    IF NOT FOUND OR v_source_run.status <> 'PREPARED'
       OR v_source_run.period_start <> v_period_date
       OR v_source_run.period_end <> (v_period_date + INTERVAL '1 month')::date THEN
        RAISE EXCEPTION 'OT_PAYROLL_SOURCE_HOLD: no prepared VERIFIED_ONLY source run for period';
    END IF;
    SELECT preliminarily_ready INTO v_source_ready
      FROM ot9_candidate_source_gate WHERE run_id=p_source_run_id;
    IF NOT COALESCE(v_source_ready,FALSE)
       OR ot9_candidate_source_fingerprint(p_source_run_id) IS DISTINCT FROM v_source_run.source_fingerprint THEN
        RAISE EXCEPTION 'OT_PAYROLL_SOURCE_STALE: source run is incomplete or changed';
    END IF;
    IF EXISTS (SELECT 1 FROM payrolls
               WHERE salary_period=p_period AND payment_status <> 'DRAFT')
       OR EXISTS (SELECT 1 FROM payroll_finalization_snapshots
                  WHERE salary_period=p_period) THEN
        RAISE EXCEPTION 'PAYROLL_FINALIZED_PERIOD_IMMUTABLE: use a separately approved adjustment workflow';
    END IF;"""
    if candidate.count(declare) != 1:
        raise RuntimeError("Unexpected procedure declaration block")
    candidate = candidate.replace(declare, candidate_declare, 1)

    insert_columns = """        payment_status, created_by
    )"""
    candidate_columns = """        payment_status, created_by, payroll_ot_candidate_run_id
    )"""
    if candidate.count(insert_columns) != 1:
        raise RuntimeError("Unexpected payroll INSERT column list")
    candidate = candidate.replace(insert_columns, candidate_columns, 1)

    select_tail = """        'DRAFT' AS payment_status,
        p_hr_user_id AS created_by
    FROM employees e"""
    candidate_tail = """        'DRAFT' AS payment_status,
        p_hr_user_id AS created_by,
        p_source_run_id AS payroll_ot_candidate_run_id
    FROM employees e"""
    if candidate.count(select_tail) != 1:
        raise RuntimeError("Unexpected payroll INSERT SELECT tail")
    candidate = candidate.replace(select_tail, candidate_tail, 1)

    legacy_ot = """            SUM(CASE WHEN ota.decision='APPROVED' THEN ota.approved_hours ELSE 0 END) AS total_ot_hours,
"""
    if candidate.count(legacy_ot) != 1:
        raise RuntimeError("Expected one legacy OT aggregate in the attendance CTE")
    candidate = candidate.replace(legacy_ot, "", 1)
    legacy_join = """        FROM attendances a LEFT JOIN attendance_overtime_approvals ota ON ota.attendance_id=a.attendance_id
"""
    if candidate.count(legacy_join) != 1:
        raise RuntimeError("Expected one legacy approval join in the attendance CTE")
    candidate = candidate.replace(legacy_join, "        FROM attendances a\n", 1)
    candidate_attendance_join = """     LEFT JOIN (
         SELECT employee_id, SUM(microseconds)::NUMERIC / 3600000000 AS total_ot_hours
         FROM ot9_candidate_verified_segments
         WHERE run_id=p_source_run_id
         GROUP BY employee_id
     ) ot ON e.employee_id = ot.employee_id"""
    candidate, join_count = re.subn(
        r"(?m)^(\s*\) att ON e\.employee_id = att\.employee_id)$",
        lambda match: f"{match.group(1)}\n{candidate_attendance_join}",
        candidate,
    )
    if join_count != 1:
        raise RuntimeError("Expected one attendance aggregate join")
    if candidate.count("COALESCE(att.total_ot_hours, 0)") != 3:
        raise RuntimeError("Installed baseline OT salary expression count changed")
    candidate = candidate.replace("COALESCE(att.total_ot_hours, 0)", "COALESCE(ot.total_ot_hours, 0)")

    if "attendance_overtime_approvals" in candidate:
        raise RuntimeError("Candidate unexpectedly still references legacy OT approvals")
    if candidate.count("COALESCE(ot.total_ot_hours, 0)") != 3:
        raise RuntimeError("Candidate must preserve all three baseline OT salary expressions")
    candidate = candidate.rstrip()
    if not candidate.endswith("$procedure$;"):
        candidate += ";"

    output = """-- REVIEW-ONLY Payroll v2 candidate generated from the installed local baseline.
-- NOT a production migration. Run only in the disposable schema-only candidate DB.
-- Source DB: mission9_synthetic at 127.0.0.1:5432; read-only extraction.
-- Source signature: %s
-- Source SHA-256: %s
-- The installed formula is preserved; only its OT input is replaced by prepared
-- VERIFIED_ONLY ledger microseconds. API integration and formal production DDL
-- are intentionally not part of this candidate artifact.
BEGIN;
ALTER TABLE public.payrolls
  ADD COLUMN IF NOT EXISTS payroll_ot_candidate_run_id BIGINT
  REFERENCES public.ot9_candidate_source_runs(run_id);

CREATE TABLE IF NOT EXISTS public.payroll_finalization_snapshots (
  snapshot_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payroll_id BIGINT NOT NULL REFERENCES public.payrolls(payroll_id),
  employee_id INTEGER NOT NULL REFERENCES public.employees(employee_id),
  salary_period VARCHAR NOT NULL,
  finalized_status VARCHAR NOT NULL CHECK (finalized_status IN ('CONFIRMED','PAID')),
  payment_date DATE,
  revision INTEGER NOT NULL,
  payroll_snapshot JSONB NOT NULL,
  details_snapshot JSONB NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(payroll_id, revision)
);

CREATE OR REPLACE FUNCTION public.ot9_candidate_reject_snapshot_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Finalization snapshots are append-only';
END; $$;
DROP TRIGGER IF EXISTS trg_ot9_candidate_snapshots_immutable ON public.payroll_finalization_snapshots;
CREATE TRIGGER trg_ot9_candidate_snapshots_immutable
  BEFORE UPDATE OR DELETE ON public.payroll_finalization_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.ot9_candidate_reject_snapshot_mutation();

CREATE OR REPLACE FUNCTION public.ot9_candidate_capture_finalization()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_revision INTEGER;
BEGIN
  IF NEW.payment_status IN ('CONFIRMED','PAID') AND NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    IF OLD.payment_status='PAID' THEN
      RAISE EXCEPTION 'PAID payroll is immutable';
    END IF;
    IF OLD.payment_status='CONFIRMED' AND NEW.payment_status<>'PAID' THEN
      RAISE EXCEPTION 'CONFIRMED payroll may only transition to PAID';
    END IF;
    IF OLD.payment_status='CONFIRMED' AND NEW.payment_status='PAID'
       AND NOT EXISTS (SELECT 1 FROM public.payroll_finalization_snapshots s WHERE s.payroll_id=NEW.payroll_id) THEN
      INSERT INTO public.payroll_finalization_snapshots(
        payroll_id,employee_id,salary_period,finalized_status,payment_date,revision,
        payroll_snapshot,details_snapshot)
      SELECT OLD.payroll_id,OLD.employee_id,OLD.salary_period,'CONFIRMED',OLD.payment_date,1,
        to_jsonb(OLD),
        COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.detail_id)
          FROM public.payroll_details d WHERE d.payroll_id=OLD.payroll_id),'[]'::jsonb);
    END IF;
    SELECT COALESCE(MAX(revision),0)+1 INTO v_revision
      FROM public.payroll_finalization_snapshots WHERE payroll_id=NEW.payroll_id;
    INSERT INTO public.payroll_finalization_snapshots(
      payroll_id,employee_id,salary_period,finalized_status,payment_date,revision,
      payroll_snapshot,details_snapshot)
    SELECT NEW.payroll_id,NEW.employee_id,NEW.salary_period,NEW.payment_status,NEW.payment_date,v_revision,
      to_jsonb(NEW),
      COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.detail_id)
        FROM public.payroll_details d WHERE d.payroll_id=NEW.payroll_id),'[]'::jsonb);
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.ot9_candidate_guard_finalized_payroll()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.payment_status<>'DRAFT' THEN
      RAISE EXCEPTION 'New payroll must start as DRAFT';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    IF OLD.payment_status IN ('CONFIRMED','PAID')
       OR EXISTS (SELECT 1 FROM public.payroll_finalization_snapshots s WHERE s.payroll_id=OLD.payroll_id) THEN
      RAISE EXCEPTION 'Finalized payroll cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.payment_status='PAID' THEN RAISE EXCEPTION 'PAID payroll is immutable'; END IF;
  IF OLD.payment_status='DRAFT' AND NEW.payment_status NOT IN ('DRAFT','CONFIRMED') THEN
    RAISE EXCEPTION 'DRAFT payroll may only remain DRAFT or become CONFIRMED';
  END IF;
  IF OLD.payment_status='CONFIRMED'
     OR EXISTS (SELECT 1 FROM public.payroll_finalization_snapshots s WHERE s.payroll_id=OLD.payroll_id) THEN
    IF (to_jsonb(NEW)-ARRAY['payment_status','payment_date','updated_at','total_insurance']::text[])
       IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['payment_status','payment_date','updated_at','total_insurance']::text[]) THEN
      RAISE EXCEPTION 'Finalized payroll amounts are immutable';
    END IF;
    IF OLD.payment_status='CONFIRMED' AND NEW.payment_status NOT IN ('CONFIRMED','PAID') THEN
      RAISE EXCEPTION 'CONFIRMED payroll cannot be reopened for deletion or recalculation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_ot9_candidate_guard_payroll ON public.payrolls;
CREATE TRIGGER trg_ot9_candidate_guard_payroll
  BEFORE INSERT OR UPDATE OR DELETE ON public.payrolls
  FOR EACH ROW EXECUTE FUNCTION public.ot9_candidate_guard_finalized_payroll();
DROP TRIGGER IF EXISTS trg_ot9_candidate_capture_finalization ON public.payrolls;
CREATE TRIGGER trg_ot9_candidate_capture_finalization
  AFTER UPDATE OF payment_status ON public.payrolls
  FOR EACH ROW EXECUTE FUNCTION public.ot9_candidate_capture_finalization();

CREATE OR REPLACE FUNCTION public.ot9_candidate_guard_payroll_detail()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_payroll_id BIGINT; v_status TEXT;
BEGIN
  v_payroll_id := CASE WHEN TG_OP='DELETE' THEN OLD.payroll_id ELSE NEW.payroll_id END;
  SELECT payment_status INTO v_status FROM public.payrolls WHERE payroll_id=v_payroll_id FOR UPDATE;
  IF v_status IN ('CONFIRMED','PAID')
     OR EXISTS (SELECT 1 FROM public.payroll_finalization_snapshots s WHERE s.payroll_id=v_payroll_id) THEN
    RAISE EXCEPTION 'Details of a finalized payroll are immutable';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;
DROP TRIGGER IF EXISTS trg_ot9_candidate_guard_payroll_detail ON public.payroll_details;
CREATE TRIGGER trg_ot9_candidate_guard_payroll_detail
  BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_details
  FOR EACH ROW EXECUTE FUNCTION public.ot9_candidate_guard_payroll_detail();

%s
COMMIT;
""" % (signature, digest, candidate)
    OUTPUT.write_text(output, encoding="utf-8", newline="\n")
    print(f"Generated review-only candidate: {OUTPUT}")
    print(f"Baseline SHA-256: {digest}")


if __name__ == "__main__":
    main()
