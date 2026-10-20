-- REVIEW-ONLY Payroll v2 source candidate. LOCAL SYNTHETIC DATABASE ONLY.
-- This file is intentionally not a migration and never changes payrolls or payroll_details.
-- Payroll owner must approve D01-D13, cutoff, completeness and installed procedure baseline.
BEGIN;

CREATE TABLE IF NOT EXISTS ot9_candidate_source_runs (
    run_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    source_mode TEXT NOT NULL CHECK (source_mode = 'VERIFIED_ONLY'),
    status TEXT NOT NULL DEFAULT 'HOLD' CHECK (status IN ('HOLD','PREPARED')),
    source_watermark TIMESTAMPTZ,
    source_fingerprint TEXT,
    prepared_by INTEGER REFERENCES users(user_id),
    prepared_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CHECK (period_start < period_end),
    CHECK (status <> 'PREPARED' OR
           (source_watermark IS NOT NULL AND source_fingerprint IS NOT NULL
            AND prepared_by IS NOT NULL AND prepared_at IS NOT NULL))
);
ALTER TABLE ot9_candidate_source_runs
    ADD COLUMN IF NOT EXISTS scope_captured_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS scope_fingerprint TEXT,
    ADD COLUMN IF NOT EXISTS source_preflight_fingerprint TEXT;

CREATE TABLE IF NOT EXISTS ot9_candidate_run_employees (
    run_id BIGINT NOT NULL REFERENCES ot9_candidate_source_runs(run_id),
    employee_id INTEGER NOT NULL REFERENCES employees(employee_id),
    employment_status TEXT NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (run_id, employee_id)
);

CREATE TABLE IF NOT EXISTS ot9_candidate_payroll_period_evidence (
    run_id BIGINT PRIMARY KEY REFERENCES ot9_candidate_source_runs(run_id),
    checked_at TIMESTAMPTZ NOT NULL,
    closed_or_paid BOOLEAN NOT NULL,
    evidence_fingerprint TEXT NOT NULL,
    checked_by INTEGER NOT NULL REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS ot9_candidate_employee_decisions (
    run_id BIGINT NOT NULL REFERENCES ot9_candidate_source_runs(run_id),
    employee_id INTEGER NOT NULL REFERENCES employees(employee_id),
    decision TEXT NOT NULL CHECK (decision IN ('VERIFIED_COMPLETE','NO_OT_CONFIRMED','HOLD')),
    reason TEXT,
    decided_by INTEGER REFERENCES users(user_id),
    decided_at TIMESTAMPTZ,
    source_fingerprint TEXT,
    PRIMARY KEY (run_id, employee_id),
    CHECK (decision = 'HOLD' OR
           (decided_by IS NOT NULL AND decided_at IS NOT NULL AND source_fingerprint IS NOT NULL)),
    CHECK (decision <> 'HOLD' OR length(trim(COALESCE(reason,''))) >= 3)
);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ot9_candidate_decision_scope') THEN
        ALTER TABLE ot9_candidate_employee_decisions
            ADD CONSTRAINT fk_ot9_candidate_decision_scope
            FOREIGN KEY (run_id, employee_id)
            REFERENCES ot9_candidate_run_employees(run_id, employee_id);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS ot9_candidate_verified_segments (
    segment_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id BIGINT NOT NULL,
    employee_id INTEGER NOT NULL,
    request_id BIGINT NOT NULL REFERENCES overtime_requests(request_id),
    reconciliation_version INTEGER NOT NULL CHECK (reconciliation_version > 0),
    source_signature TEXT NOT NULL,
    segment_start TIMESTAMPTZ NOT NULL,
    segment_end TIMESTAMPTZ NOT NULL,
    microseconds BIGINT NOT NULL CHECK (microseconds > 0),
    FOREIGN KEY (run_id, employee_id)
        REFERENCES ot9_candidate_employee_decisions(run_id, employee_id),
    CHECK (segment_end > segment_start),
    UNIQUE (run_id, request_id, segment_start, segment_end)
);
CREATE INDEX IF NOT EXISTS ix_ot9_candidate_segments_employee_period
    ON ot9_candidate_verified_segments(run_id, employee_id, segment_start);

CREATE TABLE IF NOT EXISTS ot9_candidate_source_events (
    event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES ot9_candidate_source_runs(run_id),
    actor_id INTEGER NOT NULL REFERENCES users(user_id),
    event_type TEXT NOT NULL CHECK (event_type IN ('HOLD','PREPARE','INVALIDATE')),
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE FUNCTION ot9_candidate_events_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'OT candidate events are append-only' USING ERRCODE='55000';
END; $$;
DROP TRIGGER IF EXISTS trg_ot9_candidate_events_immutable ON ot9_candidate_source_events;
CREATE TRIGGER trg_ot9_candidate_events_immutable
    BEFORE UPDATE OR DELETE ON ot9_candidate_source_events
    FOR EACH ROW EXECUTE FUNCTION ot9_candidate_events_append_only();

CREATE OR REPLACE FUNCTION ot9_candidate_scope_fingerprint()
RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.employee_id)::text, '[]'),
                                   'UTF8')), 'hex')
    FROM employees e WHERE e.employment_status IN ('ACTIVE','PROBATION')
$$;

CREATE OR REPLACE FUNCTION ot9_candidate_employee_source_fingerprint(
    p_run_id BIGINT, p_employee_id INTEGER
) RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_start DATE;
    v_end DATE;
    v_payload JSONB;
BEGIN
    SELECT period_start, period_end INTO STRICT v_start, v_end
    FROM ot9_candidate_source_runs WHERE run_id = p_run_id;
    SELECT jsonb_build_object(
        'requests', COALESCE((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.request_id)
            FROM overtime_requests o WHERE o.employee_id=p_employee_id
              AND o.work_date>=v_start AND o.work_date<v_end), '[]'::jsonb),
        'attendance', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attendance_id)
            FROM attendances a WHERE a.employee_id=p_employee_id
              AND a.work_date>=v_start AND a.work_date<v_end), '[]'::jsonb),
        'verified', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.request_id)
            FROM v_overtime_verified_current v WHERE v.employee_id=p_employee_id
              AND v.work_date>=v_start AND v.work_date<v_end), '[]'::jsonb),
        'request_events', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.event_id)
            FROM overtime_request_events e JOIN overtime_requests o USING(request_id)
            WHERE o.employee_id=p_employee_id AND o.work_date>=v_start AND o.work_date<v_end),
            '[]'::jsonb),
        'reconciliation_events', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.event_id)
            FROM overtime_reconciliation_events e JOIN overtime_requests o USING(request_id)
            WHERE o.employee_id=p_employee_id AND o.work_date>=v_start AND o.work_date<v_end),
            '[]'::jsonb)
    ) INTO v_payload;
    RETURN encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex');
END $$;

CREATE OR REPLACE FUNCTION ot9_candidate_source_fingerprint(p_run_id BIGINT)
RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_start DATE;
    v_end DATE;
    v_payload JSONB;
BEGIN
    SELECT period_start, period_end INTO STRICT v_start, v_end
    FROM ot9_candidate_source_runs WHERE run_id = p_run_id;
    SELECT jsonb_build_object(
        'scope', ot9_candidate_scope_fingerprint(),
        'requests', COALESCE((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.request_id)
            FROM overtime_requests o WHERE o.work_date>=v_start AND o.work_date<v_end), '[]'::jsonb),
        'attendance', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attendance_id)
            FROM attendances a WHERE a.work_date>=v_start AND a.work_date<v_end), '[]'::jsonb),
        'verified', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.request_id)
            FROM v_overtime_verified_current v WHERE v.work_date>=v_start AND v.work_date<v_end), '[]'::jsonb),
        'request_events', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.event_id)
            FROM overtime_request_events e JOIN overtime_requests o USING(request_id)
            WHERE o.work_date>=v_start AND o.work_date<v_end), '[]'::jsonb),
        'reconciliation_events', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.event_id)
            FROM overtime_reconciliation_events e JOIN overtime_requests o USING(request_id)
            WHERE o.work_date>=v_start AND o.work_date<v_end), '[]'::jsonb),
        'payroll_evidence', COALESCE((SELECT to_jsonb(p)
            FROM ot9_candidate_payroll_period_evidence p
            JOIN ot9_candidate_source_runs r USING(run_id)
            WHERE p.run_id=p_run_id), '{}'::jsonb)
    ) INTO v_payload;
    RETURN encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex');
END $$;

CREATE OR REPLACE FUNCTION ot9_candidate_capture_employee_scope(p_run_id BIGINT)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
    v_run ot9_candidate_source_runs%ROWTYPE;
    v_count INTEGER;
BEGIN
    SELECT * INTO STRICT v_run FROM ot9_candidate_source_runs
    WHERE run_id=p_run_id FOR UPDATE;
    IF v_run.status <> 'HOLD' THEN
        RAISE EXCEPTION 'Only a HOLD candidate run can capture employee scope';
    END IF;
    IF v_run.scope_captured_at IS NOT NULL THEN
        RETURN (SELECT count(*) FROM ot9_candidate_run_employees WHERE run_id=p_run_id);
    END IF;
    INSERT INTO ot9_candidate_run_employees(run_id,employee_id,employment_status)
    SELECT p_run_id,employee_id,employment_status FROM employees
    WHERE employment_status IN ('ACTIVE','PROBATION')
    ORDER BY employee_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    UPDATE ot9_candidate_source_runs SET scope_captured_at=clock_timestamp(),
        scope_fingerprint=ot9_candidate_scope_fingerprint()
    WHERE run_id=p_run_id;
    RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION ot9_candidate_capture_preflight(p_run_id BIGINT, p_actor_id INTEGER)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
    v_fingerprint TEXT;
BEGIN
    PERFORM 1 FROM ot9_candidate_source_runs WHERE run_id=p_run_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Candidate run not found'; END IF;
    v_fingerprint := ot9_candidate_source_fingerprint(p_run_id);
    UPDATE ot9_candidate_source_runs SET source_preflight_fingerprint=v_fingerprint,
        source_watermark=clock_timestamp()
    WHERE run_id=p_run_id AND status='HOLD';
    IF NOT FOUND THEN RAISE EXCEPTION 'Only a HOLD candidate run can be preflighted'; END IF;
    INSERT INTO ot9_candidate_source_events(run_id,actor_id,event_type,detail)
    VALUES(p_run_id,p_actor_id,'HOLD',
           jsonb_build_object('action','SOURCE_PREFLIGHT','fingerprint',v_fingerprint));
    RETURN v_fingerprint;
END $$;

CREATE TABLE IF NOT EXISTS ot9_candidate_period_reservations (
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    run_id BIGINT NOT NULL UNIQUE REFERENCES ot9_candidate_source_runs(run_id),
    PRIMARY KEY (period_start, period_end)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ot9_candidate_prepared_period
    ON ot9_candidate_source_runs(period_start,period_end) WHERE status='PREPARED';

CREATE OR REPLACE FUNCTION ot9_candidate_prepare_run(p_run_id BIGINT, p_actor_id INTEGER)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
    v_run ot9_candidate_source_runs%ROWTYPE;
    v_ready BOOLEAN;
    v_fingerprint TEXT;
BEGIN
    SELECT * INTO STRICT v_run FROM ot9_candidate_source_runs
    WHERE run_id=p_run_id FOR UPDATE;
    PERFORM pg_advisory_xact_lock(hashtextextended(
        v_run.period_start::text || ':' || v_run.period_end::text, 0));
    IF v_run.status <> 'HOLD' THEN
        RAISE EXCEPTION 'Candidate run is not on HOLD';
    END IF;
    SELECT preliminarily_ready INTO v_ready
    FROM ot9_candidate_source_gate WHERE run_id=p_run_id;
    IF NOT COALESCE(v_ready,FALSE) THEN
        RAISE EXCEPTION 'Candidate source gate is incomplete or stale';
    END IF;
    v_fingerprint := ot9_candidate_source_fingerprint(p_run_id);
    IF v_fingerprint <> v_run.source_preflight_fingerprint THEN
        RAISE EXCEPTION 'Candidate sources changed after preflight';
    END IF;
    INSERT INTO ot9_candidate_period_reservations(period_start,period_end,run_id)
    VALUES(v_run.period_start,v_run.period_end,p_run_id);
    UPDATE ot9_candidate_source_runs SET status='PREPARED',source_fingerprint=v_fingerprint,
        source_watermark=clock_timestamp(),prepared_by=p_actor_id,prepared_at=clock_timestamp()
    WHERE run_id=p_run_id;
    INSERT INTO ot9_candidate_source_events(run_id,actor_id,event_type,detail)
    VALUES(p_run_id,p_actor_id,'PREPARE',
           jsonb_build_object('source_fingerprint',v_fingerprint));
    RETURN v_fingerprint;
END $$;

CREATE OR REPLACE FUNCTION ot9_candidate_reject_overlapping_segment()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(
        NEW.run_id::text || ':' || NEW.employee_id::text, 0));
    IF EXISTS (SELECT 1 FROM ot9_candidate_verified_segments s
        WHERE s.run_id=NEW.run_id AND s.request_id=NEW.request_id
          AND s.segment_start=NEW.segment_start AND s.segment_end=NEW.segment_end
          AND s.segment_id<>COALESCE(NEW.segment_id,-1)) THEN
        RETURN NEW;
    END IF;
    IF EXISTS (SELECT 1 FROM ot9_candidate_verified_segments s
        WHERE s.run_id=NEW.run_id AND s.employee_id=NEW.employee_id
          AND s.segment_id<>COALESCE(NEW.segment_id,-1)
          AND s.segment_start<NEW.segment_end AND s.segment_end>NEW.segment_start) THEN
        RAISE EXCEPTION 'Candidate segments for an employee may not overlap';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ot9_candidate_segments_no_overlap ON ot9_candidate_verified_segments;
CREATE TRIGGER trg_ot9_candidate_segments_no_overlap
    BEFORE INSERT OR UPDATE ON ot9_candidate_verified_segments
    FOR EACH ROW EXECUTE FUNCTION ot9_candidate_reject_overlapping_segment();

CREATE OR REPLACE VIEW ot9_candidate_blockers AS
SELECT r.run_id, 'EMPLOYEE_SCOPE_NOT_CAPTURED'::TEXT AS blocker_code, NULL::TEXT AS subject_id
FROM ot9_candidate_source_runs r WHERE r.scope_captured_at IS NULL
UNION ALL
SELECT r.run_id, 'EMPLOYEE_SCOPE_CHANGED', NULL::TEXT
FROM ot9_candidate_source_runs r
WHERE r.scope_fingerprint IS NOT NULL
  AND r.scope_fingerprint<>ot9_candidate_scope_fingerprint()
UNION ALL
SELECT r.run_id, 'EMPLOYEE_SCOPE_EMPTY', NULL::TEXT
FROM ot9_candidate_source_runs r
WHERE r.scope_captured_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM ot9_candidate_run_employees s WHERE s.run_id=r.run_id)
UNION ALL
SELECT r.run_id, 'PERIOD_NOT_CALENDAR_MONTH', NULL::TEXT
FROM ot9_candidate_source_runs r
WHERE r.period_start<>date_trunc('month',r.period_start)::date
   OR r.period_end<>(r.period_start+interval '1 month')::date
UNION ALL
SELECT s.run_id, 'EMPLOYEE_DECISION_MISSING', s.employee_id::TEXT
FROM ot9_candidate_run_employees s
LEFT JOIN ot9_candidate_employee_decisions d USING(run_id,employee_id)
WHERE d.employee_id IS NULL
UNION ALL
SELECT d.run_id, 'EMPLOYEE_DECISION_STALE', d.employee_id::TEXT
FROM ot9_candidate_employee_decisions d
WHERE d.decision<>'HOLD'
  AND d.source_fingerprint<>ot9_candidate_employee_source_fingerprint(d.run_id,d.employee_id)
UNION ALL
SELECT r.run_id, 'REQUEST_UNRESOLVED', o.request_id::TEXT
FROM ot9_candidate_source_runs r JOIN overtime_requests o
  ON o.work_date>=r.period_start AND o.work_date<r.period_end
LEFT JOIN v_overtime_verified_current v ON v.request_id=o.request_id
WHERE o.status IN ('DRAFT','PENDING_EMPLOYEE_CONFIRMATION','PENDING_HR')
   OR (o.status='APPROVED' AND (v.request_id IS NULL OR o.revoke_requested_at IS NOT NULL
       AND o.revoke_decided_at IS NULL OR o.replaced_by_request_id IS NOT NULL))
UNION ALL
SELECT r.run_id, 'REQUEST_EMPLOYEE_OUT_OF_SCOPE', o.request_id::TEXT
FROM ot9_candidate_source_runs r JOIN overtime_requests o
  ON o.work_date>=r.period_start AND o.work_date<r.period_end
WHERE o.status IN ('DRAFT','PENDING_EMPLOYEE_CONFIRMATION','PENDING_HR','APPROVED')
  AND NOT EXISTS (SELECT 1 FROM ot9_candidate_run_employees s
      WHERE s.run_id=r.run_id AND s.employee_id=o.employee_id)
UNION ALL
SELECT s.run_id, 'ATTENDANCE_INCOMPLETE', a.attendance_id::TEXT
FROM ot9_candidate_run_employees s JOIN ot9_candidate_source_runs r USING(run_id)
JOIN attendances a ON a.employee_id=s.employee_id
  AND a.work_date>=r.period_start AND a.work_date<r.period_end
WHERE a.check_in_time IS NULL OR a.check_out_time IS NULL
   OR COALESCE(a.attendance_context->>'schedule_status','LEGACY_UNKNOWN')<>'MATCHED'
UNION ALL
SELECT r.run_id, 'PAYROLL_PERIOD_EVIDENCE_MISSING', NULL::TEXT
FROM ot9_candidate_source_runs r
LEFT JOIN ot9_candidate_payroll_period_evidence p USING(run_id)
WHERE p.run_id IS NULL
UNION ALL
SELECT r.run_id, 'PAYROLL_PERIOD_CLOSED', NULL::TEXT
FROM ot9_candidate_source_runs r JOIN ot9_candidate_payroll_period_evidence p USING(run_id)
WHERE p.closed_or_paid
UNION ALL
SELECT r.run_id, 'SOURCE_CHANGED_AFTER_PREFLIGHT', NULL::TEXT
FROM ot9_candidate_source_runs r
WHERE r.source_preflight_fingerprint IS NOT NULL
  AND r.source_preflight_fingerprint<>ot9_candidate_source_fingerprint(r.run_id)
UNION ALL
SELECT s.run_id, 'NO_OT_CONTRADICTED', d.employee_id::TEXT
FROM ot9_candidate_employee_decisions d JOIN ot9_candidate_run_employees s
  USING(run_id,employee_id) JOIN ot9_candidate_source_runs r USING(run_id)
WHERE d.decision='NO_OT_CONFIRMED' AND EXISTS (
    SELECT 1 FROM overtime_requests o WHERE o.employee_id=d.employee_id
      AND o.work_date>=r.period_start AND o.work_date<r.period_end
      AND o.status IN ('DRAFT','PENDING_EMPLOYEE_CONFIRMATION','PENDING_HR','APPROVED'))
UNION ALL
SELECT s.run_id, 'VERIFIED_COMPLETE_WITHOUT_SEGMENT', d.employee_id::TEXT
FROM ot9_candidate_employee_decisions d JOIN ot9_candidate_run_employees s
  USING(run_id,employee_id)
WHERE d.decision='VERIFIED_COMPLETE' AND NOT EXISTS (
    SELECT 1 FROM ot9_candidate_verified_segments seg
    WHERE seg.run_id=d.run_id AND seg.employee_id=d.employee_id)
UNION ALL
SELECT r.run_id, 'VERIFIED_SEGMENT_TOTAL_MISMATCH', v.request_id::TEXT
FROM ot9_candidate_source_runs r JOIN v_overtime_verified_current v
  ON v.work_date>=r.period_start AND v.work_date<r.period_end
LEFT JOIN ot9_candidate_verified_segments seg
  ON seg.run_id=r.run_id AND seg.request_id=v.request_id
GROUP BY r.run_id,v.request_id,v.verified_microseconds
HAVING COALESCE(SUM(seg.microseconds),0)<>v.verified_microseconds
UNION ALL
SELECT seg.run_id, 'SEGMENT_SOURCE_STALE', seg.segment_id::TEXT
FROM ot9_candidate_verified_segments seg JOIN ot9_candidate_source_runs r USING(run_id)
LEFT JOIN v_overtime_verified_current v ON v.request_id=seg.request_id
LEFT JOIN overtime_reconciliations rec ON rec.request_id=seg.request_id
WHERE v.request_id IS NULL OR v.version<>seg.reconciliation_version
   OR rec.source_signature<>seg.source_signature
   OR v.employee_id<>seg.employee_id
   OR seg.segment_start<(r.period_start::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
   OR seg.segment_end>(r.period_end::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');

-- Read-only gate. Zero OT is valid only with explicit NO_OT_CONFIRMED for every
-- captured employee; current request, attendance, payroll and source fingerprints are rechecked.
CREATE OR REPLACE VIEW ot9_candidate_source_gate AS
SELECT r.run_id, r.period_start, r.period_end, r.status,
       (SELECT COUNT(*) FROM ot9_candidate_employee_decisions d
        WHERE d.run_id=r.run_id) AS decided_employees,
       (SELECT COUNT(*) FROM ot9_candidate_employee_decisions d
        WHERE d.run_id=r.run_id AND d.decision='HOLD') AS held_employees,
       (SELECT COUNT(*) FROM ot9_candidate_verified_segments s
        WHERE s.run_id=r.run_id) AS segments,
       COALESCE((SELECT SUM(s.microseconds) FROM ot9_candidate_verified_segments s
        WHERE s.run_id=r.run_id),0) AS verified_microseconds,
       r.source_preflight_fingerprint IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM ot9_candidate_blockers b WHERE b.run_id=r.run_id)
         AS preliminarily_ready,
       (SELECT COUNT(*) FROM ot9_candidate_run_employees e
        WHERE e.run_id=r.run_id) AS scoped_employees,
       (SELECT COUNT(*) FROM ot9_candidate_blockers b
        WHERE b.run_id=r.run_id) AS blocker_count
FROM ot9_candidate_source_runs r;

COMMIT;
