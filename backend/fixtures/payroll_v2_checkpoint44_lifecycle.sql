-- CHECKPOINT 44 REVIEW-ONLY lifecycle extension.
-- This is NOT a migration. Apply only inside the marked, disposable PostgreSQL
-- synthetic clone. It does not alter payrolls or payroll_details.
BEGIN;

-- Keep the existing prepared-run guard closed except for one validated,
-- transaction-local PREPARED -> HOLD invalidation transition. This is a
-- synthetic candidate exception, not a production authorization mechanism.
CREATE OR REPLACE FUNCTION public.ot9_candidate_guard_prepared_run()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='PREPARED' THEN
    IF NEW.status='HOLD'
       AND current_setting('ot9.allow_prepared_run_invalidation', true)=OLD.run_id::text
       AND NEW.source_fingerprint IS NULL
       AND NEW.source_watermark IS NULL
       AND NEW.prepared_by IS NULL
       AND NEW.prepared_at IS NULL
       AND (to_jsonb(NEW)-ARRAY['status','source_fingerprint','source_watermark',
                                'prepared_by','prepared_at']::text[])
           IS NOT DISTINCT FROM
           (to_jsonb(OLD)-ARRAY['status','source_fingerprint','source_watermark',
                                'prepared_by','prepared_at']::text[]) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'OT_PREPARED_RUN_IMMUTABLE';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;

CREATE TABLE IF NOT EXISTS public.ot9_candidate_run_lifecycle (
    run_id BIGINT PRIMARY KEY REFERENCES public.ot9_candidate_source_runs(run_id),
    state TEXT NOT NULL CHECK (state IN (
        'HOLD','PREPARED','STALE','CONFIRMED','CONFIRMED_STALE','INVALIDATED','REPLACED'
    )),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    source_fingerprint TEXT,
    checked_fingerprint TEXT,
    replacement_run_id BIGINT REFERENCES public.ot9_candidate_source_runs(run_id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CHECK ((state='REPLACED' AND replacement_run_id IS NOT NULL)
        OR (state<>'REPLACED' AND replacement_run_id IS NULL))
);

CREATE TABLE IF NOT EXISTS public.ot9_candidate_run_lifecycle_events (
    event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES public.ot9_candidate_source_runs(run_id),
    version INTEGER NOT NULL CHECK (version > 0),
    actor_id INTEGER NOT NULL REFERENCES public.users(user_id),
    event_type TEXT NOT NULL CHECK (event_type IN (
        'SOURCE_STALE','CONFIRM','INVALIDATE','REPLACE'
    )),
    from_state TEXT NOT NULL,
    to_state TEXT NOT NULL,
    expected_fingerprint TEXT,
    observed_fingerprint TEXT,
    reason TEXT,
    replacement_run_id BIGINT REFERENCES public.ot9_candidate_source_runs(run_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(run_id,version),
    CHECK (event_type NOT IN ('INVALIDATE','REPLACE') OR length(trim(COALESCE(reason,''))) >= 5),
    CHECK ((event_type='REPLACE' AND replacement_run_id IS NOT NULL)
        OR (event_type<>'REPLACE' AND replacement_run_id IS NULL))
);

CREATE OR REPLACE FUNCTION public.ot9_candidate_lifecycle_events_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'OT candidate lifecycle events are append-only'
        USING ERRCODE='55000';
END; $$;
DROP TRIGGER IF EXISTS trg_ot9_candidate_lifecycle_events_immutable
    ON public.ot9_candidate_run_lifecycle_events;
CREATE TRIGGER trg_ot9_candidate_lifecycle_events_immutable
    BEFORE UPDATE OR DELETE ON public.ot9_candidate_run_lifecycle_events
    FOR EACH ROW EXECUTE FUNCTION public.ot9_candidate_lifecycle_events_append_only();

-- Backfill only the synthetic candidate state. No source or payroll rows change.
INSERT INTO public.ot9_candidate_run_lifecycle(run_id,state,version,source_fingerprint)
SELECT run_id,CASE WHEN status='PREPARED' THEN 'PREPARED' ELSE 'HOLD' END,
       1,source_fingerprint
FROM public.ot9_candidate_source_runs
ON CONFLICT (run_id) DO NOTHING;

COMMIT;
