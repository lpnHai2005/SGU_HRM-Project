-- Review-only additive guard for the local Payroll v2 API candidate.
-- NOT a production migration. Apply only after payroll_v2_candidate_procedure.sql
-- inside the marked synthetic loopback clone. New PAID transitions are disabled.
BEGIN;

CREATE OR REPLACE FUNCTION public.ot9_candidate_guard_finalized_payroll()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.payment_status <> 'DRAFT' THEN
      RAISE EXCEPTION 'PAYROLL_CANDIDATE_NEW_ROWS_MUST_BE_DRAFT';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP='DELETE' THEN
    IF OLD.payment_status IN ('CONFIRMED','PAID')
       OR EXISTS (SELECT 1 FROM public.payroll_finalization_snapshots s WHERE s.payroll_id=OLD.payroll_id) THEN
      RAISE EXCEPTION 'PAYROLL_CANDIDATE_FINALIZED_IMMUTABLE';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.payment_status='PAID' THEN
    RAISE EXCEPTION 'PAYROLL_PAID_IMMUTABLE';
  END IF;
  IF OLD.payment_status='DRAFT' AND NEW.payment_status NOT IN ('DRAFT','CONFIRMED') THEN
    RAISE EXCEPTION 'PAYROLL_CANDIDATE_INVALID_TRANSITION';
  END IF;
  IF OLD.payment_status='CONFIRMED' THEN
    IF NEW.payment_status <> 'CONFIRMED' THEN
      RAISE EXCEPTION 'PAYROLL_CONFIRMED_IMMUTABLE';
    END IF;
    IF (to_jsonb(NEW)-ARRAY['updated_at']::text[]) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['updated_at']::text[]) THEN
      RAISE EXCEPTION 'PAYROLL_CONFIRMED_IMMUTABLE';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

COMMIT;
