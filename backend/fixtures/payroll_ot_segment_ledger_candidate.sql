-- REVIEW ONLY. Apply AFTER 20261023 exception schema, base ledger fixture,
-- and payroll_v2_candidate_procedure.sql. Not a Cloud deployment migration.
-- Local synthetic only; no Payroll/API/Attendance or production migration changes.
BEGIN;
ALTER TABLE ot9_candidate_source_runs ADD COLUMN IF NOT EXISTS synthetic_cutoff DATE;

CREATE OR REPLACE FUNCTION ot9_candidate_split_interval(
    p_start TIMESTAMPTZ,p_end TIMESTAMPTZ,p_cutoff DATE
) RETURNS TABLE(segment_start TIMESTAMPTZ,segment_end TIMESTAMPTZ,microseconds BIGINT)
LANGUAGE plpgsql AS $$
DECLARE cursor_at TIMESTAMPTZ; stop_at TIMESTAMPTZ; cutoff_at TIMESTAMPTZ;
BEGIN
    IF p_cutoff IS NULL OR p_cutoff<>date_trunc('month',p_cutoff)::date THEN
        RAISE EXCEPTION 'OT_CUTOFF_NOT_CONFIGURED';
    END IF;
    IF p_start IS NULL OR p_end IS NULL OR NOT isfinite(p_start) OR NOT isfinite(p_end) OR p_end<=p_start THEN
        RAISE EXCEPTION 'OT_INTERVAL_INVALID';
    END IF;
    cutoff_at:=p_cutoff::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh';
    IF p_start<cutoff_at AND p_end>cutoff_at THEN RAISE EXCEPTION 'OT_CUTOFF_CROSSING_HOLD'; END IF;
    IF p_start<cutoff_at THEN RAISE EXCEPTION 'OT_LEGACY_PERIOD_REQUIRED'; END IF;
    cursor_at:=p_start;
    WHILE cursor_at<p_end LOOP
        stop_at:=LEAST(p_end,((cursor_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date+1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');
        segment_start:=cursor_at; segment_end:=stop_at;
        microseconds:=(extract(epoch FROM stop_at-cursor_at)*1000000)::bigint;
        RETURN NEXT; cursor_at:=stop_at;
    END LOOP;
END $$;

-- Re-evaluate the full reconciliation BEFORE clipping its intervals to a period.
-- An unallocated scalar reduction must HOLD; it cannot be prorated by this ledger.
CREATE OR REPLACE FUNCTION ot9_candidate_expected_segments(p_run BIGINT)
RETURNS TABLE(employee_id INTEGER,request_id BIGINT,reconciliation_version INTEGER,
    source_signature TEXT,segment_start TIMESTAMPTZ,segment_end TIMESTAMPTZ,microseconds BIGINT)
LANGUAGE plpgsql STABLE AS $$
DECLARE r RECORD; o RECORD; rec RECORD; item JSONB; att RECORD; aid JSONB; a TIMESTAMPTZ; b TIMESTAMPTZ;
    lo TIMESTAMPTZ; hi TIMESTAMPTZ; cutoff_at TIMESTAMPTZ; total_us BIGINT;
    seen TSTZMULTIRANGE:='{}'; seen_employee INTEGER; part RECORD;
BEGIN
    SELECT * INTO STRICT r FROM ot9_candidate_source_runs WHERE run_id=p_run;
    IF r.synthetic_cutoff IS NULL OR r.synthetic_cutoff<>date_trunc('month',r.synthetic_cutoff)::date THEN
        RAISE EXCEPTION 'OT_CUTOFF_NOT_CONFIGURED';
    END IF;
    IF r.period_start<>date_trunc('month',r.period_start)::date OR r.period_end<>(r.period_start+interval '1 month')::date THEN
        RAISE EXCEPTION 'OT_PERIOD_INVALID';
    END IF;
    lo:=r.period_start::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh';
    hi:=r.period_end::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh';
    cutoff_at:=r.synthetic_cutoff::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh';
    IF lo<cutoff_at THEN RAISE EXCEPTION 'OT_LEGACY_PERIOD_REQUIRED'; END IF;
    FOR o IN SELECT q.* FROM overtime_requests q
        WHERE q.starts_at<hi AND q.ends_at>lo
          AND q.status IN ('DRAFT','PENDING_EMPLOYEE_CONFIRMATION','PENDING_HR','APPROVED')
        ORDER BY q.employee_id,q.request_id LOOP
        IF o.starts_at<cutoff_at AND o.ends_at>cutoff_at THEN RAISE EXCEPTION 'OT_CUTOFF_CROSSING_HOLD'; END IF;
        IF NOT EXISTS(SELECT 1 FROM ot9_candidate_run_employees s WHERE s.run_id=p_run AND s.employee_id=o.employee_id) THEN
            RAISE EXCEPTION 'OT_EMPLOYEE_OUT_OF_SCOPE';
        END IF;
        SELECT c.* INTO rec FROM overtime_reconciliations c JOIN v_overtime_verified_current v USING(request_id)
            WHERE c.request_id=o.request_id;
        IF o.status<>'APPROVED' OR NOT FOUND THEN RAISE EXCEPTION 'OT_SOURCE_NOT_VERIFIED'; END IF;
        IF EXISTS(SELECT 1 FROM overtime_reconciliation_cases c WHERE c.request_id=o.request_id AND c.status IN ('OPEN','RESPONDED')) THEN
            RAISE EXCEPTION 'OT_EXCEPTION_PENDING';
        END IF;
        IF jsonb_array_length(rec.attendance_ids)=0 THEN RAISE EXCEPTION 'OT_ATTENDANCE_SNAPSHOT_REQUIRED'; END IF;
        FOR aid IN SELECT value FROM jsonb_array_elements(rec.attendance_ids) LOOP
            IF jsonb_typeof(aid)<>'number' OR aid::text !~ '^[0-9]{1,18}$' THEN
                RAISE EXCEPTION 'OT_ATTENDANCE_SNAPSHOT_REQUIRED';
            END IF;
            SELECT x.* INTO att FROM attendances x WHERE x.attendance_id=aid::text::bigint;
            IF NOT FOUND OR att.employee_id<>o.employee_id OR att.store_id<>o.store_id
               OR att.check_in_time IS NULL OR att.check_out_time IS NULL OR att.check_out_time<=att.check_in_time
               OR COALESCE(att.attendance_context->>'schedule_status','UNKNOWN')<>'MATCHED'
               OR COALESCE(att.attendance_context->'planned'->>'store_id','')<>o.store_id::text
               OR COALESCE(att.attendance_context->'planned'->>'shift_id','')<>COALESCE(att.attendance_context->'actual'->>'shift_id','MISSING') THEN
                RAISE EXCEPTION 'OT_ATTENDANCE_SNAPSHOT_REQUIRED';
            END IF;
            IF COALESCE(att.attendance_context->'planned'->>'starts_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
               OR COALESCE(att.attendance_context->'planned'->>'ends_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
                RAISE EXCEPTION 'OT_ATTENDANCE_SNAPSHOT_REQUIRED';
            END IF;
            BEGIN
                a:=(att.attendance_context->'planned'->>'starts_at')::timestamptz;
                b:=(att.attendance_context->'planned'->>'ends_at')::timestamptz;
            EXCEPTION WHEN data_exception THEN RAISE EXCEPTION 'OT_ATTENDANCE_SNAPSHOT_REQUIRED'; END;
            IF NOT isfinite(a) OR NOT isfinite(b) OR b<=a THEN RAISE EXCEPTION 'OT_ATTENDANCE_SNAPSHOT_REQUIRED'; END IF;
            IF (a<cutoff_at AND b>cutoff_at) OR (att.check_in_time<cutoff_at AND att.check_out_time>cutoff_at) THEN
                RAISE EXCEPTION 'OT_ATTENDANCE_CUTOFF_HOLD';
            END IF;
        END LOOP;
        IF seen_employee IS DISTINCT FROM o.employee_id THEN seen:='{}'; seen_employee:=o.employee_id; END IF;
        total_us:=0;
        FOR item IN SELECT value FROM jsonb_array_elements(rec.eligible_intervals) LOOP
            IF COALESCE(item->>'starts_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
               OR COALESCE(item->>'ends_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
                RAISE EXCEPTION 'OT_INTERVAL_TIMEZONE_REQUIRED';
            END IF;
            BEGIN a:=(item->>'starts_at')::timestamptz; b:=(item->>'ends_at')::timestamptz;
            EXCEPTION WHEN data_exception THEN RAISE EXCEPTION 'OT_INTERVAL_INVALID'; END;
            IF NOT isfinite(a) OR NOT isfinite(b) OR b<=a OR a<o.starts_at OR b>o.ends_at THEN
                RAISE EXCEPTION 'OT_INTERVAL_OUTSIDE_APPROVAL';
            END IF;
            IF seen && tstzmultirange(tstzrange(a,b,'[)')) THEN RAISE EXCEPTION 'OT_LEDGER_OVERLAP'; END IF;
            seen:=seen+tstzmultirange(tstzrange(a,b,'[)'));
            total_us:=total_us+(extract(epoch FROM b-a)*1000000)::bigint;
        END LOOP;
        IF total_us IS DISTINCT FROM rec.verified_microseconds OR total_us<=0 THEN
            RAISE EXCEPTION 'OT_VERIFIED_INTERVAL_TOTAL_MISMATCH';
        END IF;
        FOR item IN SELECT value FROM jsonb_array_elements(rec.eligible_intervals) LOOP
            FOR part IN SELECT * FROM ot9_candidate_split_interval((item->>'starts_at')::timestamptz,
                    (item->>'ends_at')::timestamptz,r.synthetic_cutoff) LOOP
                IF part.segment_start>=lo AND part.segment_end<=hi THEN
                    employee_id:=o.employee_id; request_id:=o.request_id;
                    reconciliation_version:=rec.version; source_signature:=rec.source_signature;
                    segment_start:=part.segment_start; segment_end:=part.segment_end; microseconds:=part.microseconds;
                    RETURN NEXT;
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;
END $$;

-- Request instants and current signatures include Attendance in adjacent months.
CREATE OR REPLACE FUNCTION ot9_candidate_source_payload(p_run BIGINT,p_employee INTEGER DEFAULT NULL)
RETURNS JSONB LANGUAGE sql STABLE AS $$
WITH period AS (SELECT period_start::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh' lo,
    period_end::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh' hi FROM ot9_candidate_source_runs WHERE run_id=p_run),
q AS (SELECT o.* FROM overtime_requests o,period p WHERE o.starts_at<p.hi AND o.ends_at>p.lo
    AND (p_employee IS NULL OR o.employee_id=p_employee))
SELECT jsonb_build_object(
    'requests',COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY request_id) FROM q),'[]'),
    'signatures',COALESCE((SELECT jsonb_agg(jsonb_build_array(request_id,ot_reconciliation_source_signature(request_id)) ORDER BY request_id) FROM q),'[]'),
    'reconciliations',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.request_id) FROM overtime_reconciliations c JOIN q USING(request_id)),'[]'),
    'attendance',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attendance_id) FROM attendances a,period p
        WHERE (p_employee IS NULL OR a.employee_id=p_employee)
          AND a.check_in_time<p.hi AND COALESCE(a.check_out_time,'infinity'::timestamptz)>p.lo),'[]'),
    'request_events',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.event_id) FROM overtime_request_events e JOIN q USING(request_id)),'[]'),
    'reconciliation_events',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.event_id) FROM overtime_reconciliation_events e JOIN q USING(request_id)),'[]'),
    'exception_cases',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.case_id) FROM overtime_reconciliation_cases c JOIN q USING(request_id)),'[]'),
    'exception_events',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.case_event_id) FROM overtime_reconciliation_case_events e
        JOIN overtime_reconciliation_cases c USING(case_id) JOIN q USING(request_id)),'[]'))
$$;
CREATE OR REPLACE FUNCTION ot9_candidate_employee_source_fingerprint(p_run_id BIGINT,p_employee_id INTEGER)
RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT encode(sha256(convert_to(ot9_candidate_source_payload(p_run_id,p_employee_id)::text,'UTF8')),'hex')
$$;
CREATE OR REPLACE FUNCTION ot9_candidate_source_fingerprint(p_run_id BIGINT)
RETURNS TEXT LANGUAGE sql STABLE AS $$
SELECT encode(sha256(convert_to(jsonb_build_object(
    'sources',ot9_candidate_source_payload(p_run_id), 'scope',ot9_candidate_scope_fingerprint(),
    'period',(SELECT jsonb_build_array(period_start,period_end,synthetic_cutoff) FROM ot9_candidate_source_runs WHERE run_id=p_run_id),
    'decisions',(SELECT jsonb_agg(to_jsonb(d) ORDER BY employee_id) FROM ot9_candidate_employee_decisions d WHERE run_id=p_run_id),
    'segments',(SELECT jsonb_agg(to_jsonb(s) ORDER BY employee_id,request_id,segment_start) FROM ot9_candidate_verified_segments s WHERE run_id=p_run_id),
    'evidence',(SELECT to_jsonb(e) FROM ot9_candidate_payroll_period_evidence e WHERE run_id=p_run_id)
)::text,'UTF8')),'hex')
$$;

CREATE OR REPLACE FUNCTION ot9_candidate_guard_run_input() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE rid BIGINT; state TEXT;
BEGIN
    IF TG_OP='UPDATE' AND NEW.run_id<>OLD.run_id THEN RAISE EXCEPTION 'OT_RUN_MOVE_FORBIDDEN'; END IF;
    rid:=CASE WHEN TG_OP='DELETE' THEN OLD.run_id ELSE NEW.run_id END;
    SELECT status INTO STRICT state FROM ot9_candidate_source_runs WHERE run_id=rid FOR UPDATE;
    IF state='PREPARED' THEN RAISE EXCEPTION 'OT_PREPARED_INPUT_IMMUTABLE'; END IF;
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DO $$ DECLARE tab TEXT; BEGIN
    FOREACH tab IN ARRAY ARRAY['ot9_candidate_verified_segments','ot9_candidate_employee_decisions',
        'ot9_candidate_run_employees','ot9_candidate_payroll_period_evidence'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS aaa_ot9_guard_run_input ON %I',tab);
        EXECUTE format('CREATE TRIGGER aaa_ot9_guard_run_input BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ot9_candidate_guard_run_input()',tab);
    END LOOP;
END $$;
CREATE OR REPLACE FUNCTION ot9_candidate_guard_prepared_run() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status='PREPARED' THEN RAISE EXCEPTION 'OT_PREPARED_RUN_IMMUTABLE'; END IF;
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS trg_ot9_guard_prepared_run ON ot9_candidate_source_runs;
CREATE TRIGGER trg_ot9_guard_prepared_run BEFORE UPDATE OR DELETE ON ot9_candidate_source_runs
    FOR EACH ROW EXECUTE FUNCTION ot9_candidate_guard_prepared_run();

CREATE OR REPLACE FUNCTION ot9_candidate_validate_segment() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.microseconds<>(extract(epoch FROM NEW.segment_end-NEW.segment_start)*1000000)::bigint
       OR NOT EXISTS(SELECT 1 FROM ot9_candidate_expected_segments(NEW.run_id) e
            WHERE (e.employee_id,e.request_id,e.reconciliation_version,e.source_signature,e.segment_start,e.segment_end,e.microseconds)
             =(NEW.employee_id,NEW.request_id,NEW.reconciliation_version,NEW.source_signature,NEW.segment_start,NEW.segment_end,NEW.microseconds)) THEN
        RAISE EXCEPTION 'OT_SEGMENT_NOT_VERIFIED';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bbb_ot9_validate_segment ON ot9_candidate_verified_segments;
CREATE TRIGGER bbb_ot9_validate_segment BEFORE INSERT OR UPDATE ON ot9_candidate_verified_segments
    FOR EACH ROW EXECUTE FUNCTION ot9_candidate_validate_segment();

CREATE OR REPLACE FUNCTION ot9_candidate_build_segments(p_run BIGINT,p_actor INTEGER)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE r RECORD; desired JSONB; existing JSONB; problem TEXT;
BEGIN
    LOCK TABLE employees,overtime_requests,attendances,overtime_reconciliations,
        overtime_request_events,overtime_reconciliation_events,overtime_reconciliation_cases,overtime_reconciliation_case_events IN SHARE MODE;
    SELECT * INTO STRICT r FROM ot9_candidate_source_runs WHERE run_id=p_run FOR UPDATE;
    IF r.status<>'HOLD' THEN RAISE EXCEPTION 'OT_PREPARED_INPUT_IMMUTABLE'; END IF;
    BEGIN
        SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY employee_id,request_id,segment_start),'[]') INTO desired
            FROM ot9_candidate_expected_segments(p_run) e;
        SELECT COALESCE(jsonb_agg(to_jsonb(s)-ARRAY['segment_id','run_id'] ORDER BY employee_id,request_id,segment_start),'[]') INTO existing
            FROM ot9_candidate_verified_segments s WHERE run_id=p_run;
        IF desired=existing THEN RETURN jsonb_build_object('status','UNCHANGED','segments',jsonb_array_length(desired)); END IF;
        DELETE FROM ot9_candidate_verified_segments WHERE run_id=p_run;
        INSERT INTO ot9_candidate_verified_segments(run_id,employee_id,request_id,reconciliation_version,source_signature,segment_start,segment_end,microseconds)
        SELECT p_run,x.* FROM jsonb_to_recordset(desired) x(employee_id INTEGER,request_id BIGINT,reconciliation_version INTEGER,
            source_signature TEXT,segment_start TIMESTAMPTZ,segment_end TIMESTAMPTZ,microseconds BIGINT);
    EXCEPTION WHEN raise_exception THEN
        GET STACKED DIAGNOSTICS problem=MESSAGE_TEXT;
        DELETE FROM ot9_candidate_verified_segments WHERE run_id=p_run;
        UPDATE ot9_candidate_source_runs SET source_preflight_fingerprint=NULL WHERE run_id=p_run;
        INSERT INTO ot9_candidate_source_events(run_id,actor_id,event_type,detail)
            VALUES(p_run,p_actor,'HOLD',jsonb_build_object('action','LEDGER_BUILD_HOLD','code',problem));
        RETURN jsonb_build_object('status','HOLD','code',problem);
    END;
    UPDATE ot9_candidate_source_runs SET source_preflight_fingerprint=NULL WHERE run_id=p_run;
    INSERT INTO ot9_candidate_source_events(run_id,actor_id,event_type,detail)
        VALUES(p_run,p_actor,'HOLD',jsonb_build_object('action','LEDGER_BUILT','segments',jsonb_array_length(desired)));
    RETURN jsonb_build_object('status','BUILT','segments',jsonb_array_length(desired));
END $$;

CREATE OR REPLACE FUNCTION ot9_candidate_ledger_blockers(p_run BIGINT)
RETURNS TABLE(blocker_code TEXT,subject_id TEXT) LANGUAGE plpgsql STABLE AS $$
DECLARE r RECORD; desired JSONB; actual JSONB; problem TEXT;
BEGIN
    SELECT * INTO STRICT r FROM ot9_candidate_source_runs WHERE run_id=p_run;
    RETURN QUERY SELECT 'EMPLOYEE_SCOPE_NOT_CAPTURED'::text,NULL::text WHERE r.scope_captured_at IS NULL;
    RETURN QUERY SELECT 'EMPLOYEE_SCOPE_CHANGED'::text,NULL::text WHERE r.scope_fingerprint IS DISTINCT FROM ot9_candidate_scope_fingerprint();
    RETURN QUERY SELECT 'EMPLOYEE_SCOPE_EMPTY'::text,NULL::text WHERE NOT EXISTS(SELECT 1 FROM ot9_candidate_run_employees WHERE run_id=p_run);
    RETURN QUERY SELECT 'EMPLOYEE_DECISION_MISSING'::text,s.employee_id::text FROM ot9_candidate_run_employees s
        LEFT JOIN ot9_candidate_employee_decisions d USING(run_id,employee_id) WHERE s.run_id=p_run AND d.employee_id IS NULL;
    RETURN QUERY SELECT 'EMPLOYEE_DECISION_HOLD'::text,d.employee_id::text FROM ot9_candidate_employee_decisions d WHERE d.run_id=p_run AND d.decision='HOLD';
    RETURN QUERY SELECT 'EMPLOYEE_DECISION_STALE'::text,d.employee_id::text FROM ot9_candidate_employee_decisions d
        WHERE d.run_id=p_run AND d.decision<>'HOLD' AND d.source_fingerprint IS DISTINCT FROM ot9_candidate_employee_source_fingerprint(p_run,d.employee_id);
    RETURN QUERY SELECT 'PAYROLL_PERIOD_EVIDENCE_MISSING'::text,NULL::text WHERE NOT EXISTS(SELECT 1 FROM ot9_candidate_payroll_period_evidence WHERE run_id=p_run);
    RETURN QUERY SELECT 'PAYROLL_PERIOD_CLOSED'::text,NULL::text WHERE EXISTS(SELECT 1 FROM ot9_candidate_payroll_period_evidence WHERE run_id=p_run AND closed_or_paid);
    RETURN QUERY SELECT 'ATTENDANCE_INCOMPLETE'::text,a.attendance_id::text FROM attendances a JOIN ot9_candidate_run_employees s USING(employee_id)
        WHERE s.run_id=p_run AND (
          (a.check_in_time<(r.period_end::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
           AND COALESCE(a.check_out_time,'infinity')>(r.period_start::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
           AND (a.check_out_time IS NULL OR COALESCE(a.attendance_context->>'schedule_status','UNKNOWN')<>'MATCHED'))
          OR (a.check_in_time IS NULL AND a.work_date>=r.period_start AND a.work_date<r.period_end));
    RETURN QUERY SELECT 'OT_ATTENDANCE_CUTOFF_HOLD'::text,a.attendance_id::text FROM attendances a JOIN ot9_candidate_run_employees s USING(employee_id)
        WHERE s.run_id=p_run AND a.check_in_time<(r.synthetic_cutoff::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND COALESCE(a.check_out_time,'infinity')>(r.synthetic_cutoff::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND a.check_in_time<(r.period_end::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND COALESCE(a.check_out_time,'infinity')>(r.period_start::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');
    BEGIN
        SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY employee_id,request_id,segment_start),'[]') INTO desired FROM ot9_candidate_expected_segments(p_run) e;
        SELECT COALESCE(jsonb_agg(to_jsonb(s)-ARRAY['segment_id','run_id'] ORDER BY employee_id,request_id,segment_start),'[]') INTO actual
            FROM ot9_candidate_verified_segments s WHERE run_id=p_run;
        RETURN QUERY SELECT 'LEDGER_CONTENT_MISMATCH'::text,NULL::text WHERE desired<>actual;
        RETURN QUERY SELECT 'EMPLOYEE_DECISION_MISMATCH'::text,d.employee_id::text FROM ot9_candidate_employee_decisions d WHERE d.run_id=p_run AND d.decision<>'HOLD'
            AND (d.decision='VERIFIED_COMPLETE') IS DISTINCT FROM EXISTS(
                SELECT 1 FROM jsonb_array_elements(desired) x WHERE (x->>'employee_id')::integer=d.employee_id);
    EXCEPTION WHEN raise_exception THEN
        GET STACKED DIAGNOSTICS problem=MESSAGE_TEXT; blocker_code:=problem; subject_id:=NULL; RETURN NEXT;
    END;
    RETURN QUERY SELECT 'SOURCE_CHANGED_AFTER_PREFLIGHT'::text,NULL::text WHERE r.source_preflight_fingerprint IS NOT NULL
        AND r.source_preflight_fingerprint IS DISTINCT FROM ot9_candidate_source_fingerprint(p_run);
END $$;
CREATE OR REPLACE VIEW ot9_candidate_blockers AS
SELECT r.run_id,b.blocker_code,b.subject_id FROM ot9_candidate_source_runs r
CROSS JOIN LATERAL ot9_candidate_ledger_blockers(r.run_id) b;

CREATE OR REPLACE FUNCTION ot9_candidate_prepare_run(p_run_id BIGINT,p_actor_id INTEGER)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE r RECORD; ready BOOLEAN; fingerprint TEXT;
BEGIN
    -- Table SHARE locks are deliberately coarse in this review fixture. They also
    -- cover inserts/phantoms; production lock strategy still needs owner review.
    LOCK TABLE employees,overtime_requests,attendances,overtime_reconciliations,
        overtime_request_events,overtime_reconciliation_events,overtime_reconciliation_cases,overtime_reconciliation_case_events IN SHARE MODE;
    SELECT * INTO STRICT r FROM ot9_candidate_source_runs WHERE run_id=p_run_id FOR UPDATE;
    PERFORM pg_advisory_xact_lock(hashtextextended(r.period_start::text||':'||r.period_end::text,0));
    SELECT preliminarily_ready INTO ready FROM ot9_candidate_source_gate WHERE run_id=p_run_id;
    fingerprint:=ot9_candidate_source_fingerprint(p_run_id);
    IF NOT COALESCE(ready,false) OR fingerprint IS DISTINCT FROM r.source_preflight_fingerprint THEN
        RAISE EXCEPTION 'OT_SOURCE_HOLD_OR_STALE';
    END IF;
    IF r.status='PREPARED' THEN
        IF fingerprint IS DISTINCT FROM r.source_fingerprint THEN RAISE EXCEPTION 'OT_SOURCE_HOLD_OR_STALE'; END IF;
        RETURN fingerprint;
    END IF;
    INSERT INTO ot9_candidate_period_reservations(period_start,period_end,run_id) VALUES(r.period_start,r.period_end,p_run_id);
    UPDATE ot9_candidate_source_runs SET status='PREPARED',source_fingerprint=fingerprint,
        source_watermark=clock_timestamp(),prepared_by=p_actor_id,prepared_at=clock_timestamp() WHERE run_id=p_run_id;
    INSERT INTO ot9_candidate_source_events(run_id,actor_id,event_type,detail)
        VALUES(p_run_id,p_actor_id,'PREPARE',jsonb_build_object('source_fingerprint',fingerprint));
    RETURN fingerprint;
END $$;

-- Separate candidate entry point: no copied formula and no shared procedure edits.
-- Its coarse source locks last until caller COMMIT/ROLLBACK. Never expose the
-- unwrapped candidate directly in a future API without equivalent safeguards.
CREATE OR REPLACE PROCEDURE sp_generate_monthly_payroll_verified_locked_candidate(
    p_period VARCHAR,p_actor_employee_id INTEGER,p_run BIGINT
) LANGUAGE plpgsql AS $$
DECLARE ready BOOLEAN; current_fingerprint TEXT; saved_fingerprint TEXT;
BEGIN
    LOCK TABLE employees,overtime_requests,attendances,overtime_reconciliations,
        overtime_request_events,overtime_reconciliation_events,overtime_reconciliation_cases,overtime_reconciliation_case_events IN SHARE MODE;
    CALL sp_generate_monthly_payroll_verified_candidate(p_period,p_actor_employee_id,p_run);
    SELECT preliminarily_ready INTO ready FROM ot9_candidate_source_gate WHERE run_id=p_run;
    SELECT source_fingerprint INTO saved_fingerprint FROM ot9_candidate_source_runs WHERE run_id=p_run;
    current_fingerprint:=ot9_candidate_source_fingerprint(p_run);
    IF NOT COALESCE(ready,false) OR current_fingerprint IS DISTINCT FROM saved_fingerprint THEN
        RAISE EXCEPTION 'OT_PAYROLL_SOURCE_STALE';
    END IF;
END $$;
COMMIT;
