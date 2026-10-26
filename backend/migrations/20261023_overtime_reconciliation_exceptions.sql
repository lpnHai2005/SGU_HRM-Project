-- OT exception workflow. Additive only; apply only to a verified local/staging target.
-- Does not modify Attendance, Payroll, overtime requests, or historical reconciliation data.
BEGIN;
SET LOCAL lock_timeout = '10s';

-- Reopening a rejected reconciliation is a new versioned decision, never an edit
-- to the rejected event. This adds the event type without changing old rows.
ALTER TABLE public.overtime_reconciliation_events
    DROP CONSTRAINT IF EXISTS overtime_reconciliation_events_action_check;
ALTER TABLE public.overtime_reconciliation_events
    ADD CONSTRAINT overtime_reconciliation_events_action_check
    CHECK (action IN ('PREVIEW','REFRESH','VERIFY','REJECT','REOPEN'));

CREATE TABLE IF NOT EXISTS public.overtime_reconciliation_cases (
    case_id BIGSERIAL PRIMARY KEY,
    request_id BIGINT NOT NULL REFERENCES public.overtime_requests(request_id) ON DELETE RESTRICT,
    reconciliation_version INTEGER NOT NULL CHECK (reconciliation_version > 0),
    case_type VARCHAR(24) NOT NULL CHECK (case_type IN ('EXPLANATION','REVIEW_REQUEST')),
    status VARCHAR(16) NOT NULL CHECK (status IN ('OPEN','RESPONDED','CLOSED','ACCEPTED','DECLINED')),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    opened_by INTEGER NOT NULL REFERENCES public.users(user_id),
    reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
    employee_response TEXT CHECK (employee_response IS NULL OR length(trim(employee_response)) BETWEEN 3 AND 4000),
    responded_by INTEGER REFERENCES public.users(user_id),
    responded_at TIMESTAMPTZ,
    resolved_by INTEGER REFERENCES public.users(user_id),
    resolved_at TIMESTAMPTZ,
    resolution_reason TEXT CHECK (resolution_reason IS NULL OR length(trim(resolution_reason)) BETWEEN 3 AND 1000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (request_id, reconciliation_version, case_type),
    CHECK (
        (case_type = 'EXPLANATION' AND status IN ('OPEN','RESPONDED','CLOSED')) OR
        (case_type = 'REVIEW_REQUEST' AND status IN ('OPEN','ACCEPTED','DECLINED'))
    ),
    CHECK (
        (employee_response IS NULL AND responded_by IS NULL AND responded_at IS NULL) OR
        (employee_response IS NOT NULL AND responded_by IS NOT NULL AND responded_at IS NOT NULL)
    ),
    CHECK (
        (status IN ('OPEN','RESPONDED') AND resolved_by IS NULL AND resolved_at IS NULL) OR
        (status IN ('CLOSED','ACCEPTED','DECLINED') AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS ix_ot_reconciliation_cases_request
    ON public.overtime_reconciliation_cases(request_id, reconciliation_version, case_id);
CREATE INDEX IF NOT EXISTS ix_ot_reconciliation_cases_status
    ON public.overtime_reconciliation_cases(case_type, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.overtime_reconciliation_case_events (
    case_event_id BIGSERIAL PRIMARY KEY,
    case_id BIGINT NOT NULL REFERENCES public.overtime_reconciliation_cases(case_id) ON DELETE RESTRICT,
    actor_id INTEGER NOT NULL REFERENCES public.users(user_id),
    action VARCHAR(32) NOT NULL CHECK (action IN (
        'EXPLANATION_REQUESTED','EXPLANATION_SUBMITTED','EXPLANATION_CLOSED',
        'REVIEW_REQUESTED','REVIEW_ACCEPTED','REVIEW_DECLINED'
    )),
    from_status VARCHAR(16),
    to_status VARCHAR(16) NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    reason TEXT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (case_id, version)
);
CREATE INDEX IF NOT EXISTS ix_ot_reconciliation_case_events_case
    ON public.overtime_reconciliation_case_events(case_id, case_event_id);

CREATE OR REPLACE FUNCTION public.guard_ot_reconciliation_case_events_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'overtime_reconciliation_case_events is append-only'
        USING ERRCODE = '55000';
END;
$$;
DROP TRIGGER IF EXISTS trg_ot_reconciliation_case_events_immutable
    ON public.overtime_reconciliation_case_events;
CREATE TRIGGER trg_ot_reconciliation_case_events_immutable
    BEFORE UPDATE OR DELETE ON public.overtime_reconciliation_case_events
    FOR EACH ROW EXECUTE FUNCTION public.guard_ot_reconciliation_case_events_append_only();

ALTER TABLE public.overtime_reconciliation_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.overtime_reconciliation_case_events ENABLE ROW LEVEL SECURITY;

-- The backend is the only application writer. Revoke direct client access and
-- do not grant DELETE/TRUNCATE on the append-only event log.
DO $$
DECLARE role_name TEXT;
BEGIN
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format('REVOKE ALL ON TABLE public.overtime_reconciliation_cases, public.overtime_reconciliation_case_events FROM %I', role_name);
            EXECUTE format('REVOKE ALL ON SEQUENCE public.overtime_reconciliation_cases_case_id_seq, public.overtime_reconciliation_case_events_case_event_id_seq FROM %I', role_name);
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT SELECT, INSERT, UPDATE ON public.overtime_reconciliation_cases TO service_role;
        GRANT SELECT, INSERT ON public.overtime_reconciliation_case_events TO service_role;
        GRANT USAGE, SELECT ON SEQUENCE public.overtime_reconciliation_cases_case_id_seq,
            public.overtime_reconciliation_case_events_case_event_id_seq TO service_role;
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_ot_reconciliation_case_events_append_only() FROM PUBLIC;

COMMIT;
