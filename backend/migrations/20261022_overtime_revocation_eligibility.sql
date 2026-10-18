-- OT-CUTOVER-03A. Additive eligibility patch; apply after 20261021.
-- No historical request, reconciliation, Attendance, or Payroll row is changed.
BEGIN;
SET LOCAL lock_timeout = '10s';

-- A rejected revocation remains in the audit fields, but the request becomes
-- eligible again. A pending or inconsistent decision is held conservatively.
CREATE OR REPLACE FUNCTION public.ot_reconciliation_request_eligible(p_request_id BIGINT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.overtime_requests o
        WHERE o.request_id = p_request_id
          AND o.status = 'APPROVED'
          AND o.revoked_at IS NULL
          AND (
              (o.revoke_requested_at IS NULL
               AND o.revoke_decision IS NULL AND o.revoke_decided_at IS NULL)
              OR
              (o.revoke_requested_at IS NOT NULL
               AND o.revoke_decision = 'REJECTED'
               AND o.revoke_decided_at IS NOT NULL)
          )
    );
$$;

-- The existing source signature hashes the whole request and overlapping
-- Attendance rows. Rejection changes that signature, so an old VERIFIED result
-- does not reappear until preview and HR verification are repeated.
CREATE OR REPLACE VIEW public.v_overtime_verified_current
WITH (security_invoker = true) AS
SELECT r.request_id, r.employee_id, r.store_id, o.work_date,
       o.starts_at, o.ends_at, r.version, r.verified_microseconds,
       r.eligible_intervals, r.attendance_ids, r.reviewed_by, r.reviewed_at
FROM public.overtime_reconciliations r
JOIN public.overtime_requests o USING (request_id)
WHERE r.status = 'VERIFIED'
  AND public.ot_reconciliation_request_eligible(r.request_id)
  AND r.source_signature = public.ot_reconciliation_source_signature(r.request_id);

REVOKE ALL ON FUNCTION public.ot_reconciliation_request_eligible(BIGINT) FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT EXECUTE ON FUNCTION public.ot_reconciliation_request_eligible(BIGINT)
            TO service_role;
    END IF;
END;
$$;
COMMIT;
