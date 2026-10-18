-- OT-CUTOVER-02. Additive only. Apply only to a verified local/staging target.
-- Never changes Attendance, Payroll, legacy approvals, or existing OT requests.
BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.overtime_reconciliations (
    request_id BIGINT PRIMARY KEY REFERENCES public.overtime_requests(request_id),
    employee_id INTEGER NOT NULL REFERENCES public.employees(employee_id),
    store_id INTEGER NOT NULL REFERENCES public.stores(store_id),
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING_RECONCILIATION'
        CHECK (status IN ('PENDING_RECONCILIATION','NEEDS_REVIEW','VERIFIED','REJECTED')),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    source_signature TEXT NOT NULL,
    proposed_microseconds BIGINT NOT NULL DEFAULT 0 CHECK (proposed_microseconds >= 0),
    verified_microseconds BIGINT CHECK (verified_microseconds >= 0),
    eligible_intervals JSONB NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(eligible_intervals) = 'array'),
    attendance_ids JSONB NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(attendance_ids) = 'array'),
    review_issues JSONB NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(review_issues) = 'array'),
    reviewed_by INTEGER REFERENCES public.users(user_id),
    reviewed_at TIMESTAMPTZ,
    decision_reason TEXT,
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CHECK (verified_microseconds IS NULL OR verified_microseconds <= proposed_microseconds),
    CHECK (status <> 'VERIFIED' OR
        (verified_microseconds > 0 AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
         AND review_issues = '[]'::jsonb)),
    CHECK (status <> 'REJECTED' OR
        (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
         AND length(trim(COALESCE(decision_reason,''))) >= 3))
);
CREATE INDEX IF NOT EXISTS ix_ot_reconciliations_employee_status
    ON public.overtime_reconciliations(employee_id, status, request_id);
CREATE INDEX IF NOT EXISTS ix_ot_reconciliations_store_status
    ON public.overtime_reconciliations(store_id, status, request_id);

CREATE TABLE IF NOT EXISTS public.overtime_reconciliation_events (
    event_id BIGSERIAL PRIMARY KEY,
    request_id BIGINT NOT NULL REFERENCES public.overtime_reconciliations(request_id),
    actor_id INTEGER NOT NULL REFERENCES public.users(user_id),
    action VARCHAR(24) NOT NULL CHECK (action IN ('PREVIEW','REFRESH','VERIFY','REJECT')),
    from_status VARCHAR(30),
    to_status VARCHAR(30) NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    reason TEXT,
    old_values JSONB,
    new_values JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (request_id, version)
);
CREATE INDEX IF NOT EXISTS ix_ot_reconciliation_events_request
    ON public.overtime_reconciliation_events(request_id, event_id);

CREATE OR REPLACE FUNCTION public.guard_ot_reconciliation_events_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'overtime_reconciliation_events is append-only'
        USING ERRCODE = '55000';
END;
$$;
DROP TRIGGER IF EXISTS trg_ot_reconciliation_events_immutable
    ON public.overtime_reconciliation_events;
CREATE TRIGGER trg_ot_reconciliation_events_immutable
    BEFORE UPDATE OR DELETE ON public.overtime_reconciliation_events
    FOR EACH ROW EXECUTE FUNCTION public.guard_ot_reconciliation_events_append_only();

-- This fingerprint covers every request field and every overlapping attendance row.
-- It detects late check-out, new/deleted sessions, store/snapshot edits and OT lifecycle edits.
-- It deliberately ignores mutable current work_schedules: Attendance uses its check-in snapshot.
CREATE OR REPLACE FUNCTION public.ot_reconciliation_source_signature(p_request_id BIGINT)
RETURNS TEXT LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
    SELECT md5(to_jsonb(o)::text || ':' || COALESCE((
        SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attendance_id)::text
        FROM public.attendances a
        WHERE a.employee_id = o.employee_id
          AND a.check_in_time IS NOT NULL
          AND a.check_in_time < o.ends_at
          AND (a.check_out_time IS NULL OR a.check_out_time > o.starts_at)
    ), '[]'))
    FROM public.overtime_requests o WHERE o.request_id = p_request_id;
$$;

-- Only this read surface may later be considered as a Payroll source after separate approval.
-- A stale VERIFIED row stays in history but disappears from this view automatically.
CREATE OR REPLACE VIEW public.v_overtime_verified_current
WITH (security_invoker = true) AS
SELECT r.request_id, r.employee_id, r.store_id, o.work_date,
       o.starts_at, o.ends_at, r.version, r.verified_microseconds,
       r.eligible_intervals, r.attendance_ids, r.reviewed_by, r.reviewed_at
FROM public.overtime_reconciliations r
JOIN public.overtime_requests o USING (request_id)
WHERE r.status = 'VERIFIED' AND o.status = 'APPROVED'
  AND o.revoke_requested_at IS NULL
  AND r.source_signature = public.ot_reconciliation_source_signature(r.request_id);

ALTER TABLE public.overtime_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.overtime_reconciliation_events ENABLE ROW LEVEL SECURITY;

-- Supabase roles may not exist in standalone PostgreSQL. Revoke inherited default ACL
-- before granting service_role the minimum rights; no direct client Data API access.
DO $$
DECLARE role_name TEXT;
BEGIN
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format('REVOKE ALL ON TABLE public.overtime_reconciliations, public.overtime_reconciliation_events, public.v_overtime_verified_current FROM %I', role_name);
            EXECUTE format('REVOKE ALL ON SEQUENCE public.overtime_reconciliation_events_event_id_seq FROM %I', role_name);
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT SELECT, INSERT, UPDATE ON public.overtime_reconciliations TO service_role;
        GRANT SELECT, INSERT ON public.overtime_reconciliation_events TO service_role;
        GRANT SELECT ON public.v_overtime_verified_current TO service_role;
        GRANT USAGE, SELECT ON SEQUENCE public.overtime_reconciliation_events_event_id_seq TO service_role;
        GRANT EXECUTE ON FUNCTION public.ot_reconciliation_source_signature(BIGINT) TO service_role;
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.ot_reconciliation_source_signature(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_ot_reconciliation_events_append_only() FROM PUBLIC;

COMMIT;
