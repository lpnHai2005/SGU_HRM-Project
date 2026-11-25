-- Keep regular attendance hours inside the fixed shift captured at check-in.
-- This is additive: it replaces only the existing payable-hours function and
-- does not create tables or change monetary payroll formulas.
-- Apply after the migration that defines the 12-argument function used by the
-- current sp_generate_monthly_payroll procedure.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_attendance_payable_hours(
    p_context JSONB,
    p_actual_hours NUMERIC,
    p_check_in TIMESTAMPTZ,
    p_check_out TIMESTAMPTZ,
    p_late_minutes INTEGER,
    p_shift_hours NUMERIC,
    p_approved_ot_hours NUMERIC,
    p_grace_minutes NUMERIC,
    p_work_date DATE,
    p_shift_start TIME,
    p_shift_end TIME,
    p_break_minutes INTEGER
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS $$
DECLARE
    v_context JSONB := COALESCE(p_context, '{}'::JSONB);
    v_actual JSONB;
    v_review JSONB;
    v_decision TEXT;
    v_shift_start TIME;
    v_shift_end TIME;
    v_shift_hours NUMERIC;
    v_break_minutes INTEGER;
    v_window_start TIMESTAMPTZ;
    v_window_end TIMESTAMPTZ;
    v_midpoint TIMESTAMPTZ;
    v_window_hours NUMERIC;
    v_window_net_hours NUMERIC;
    v_overlap_hours NUMERIC;
    v_credited_before_break NUMERIC;
    v_break_hours NUMERIC := 0;
    v_cap_hours NUMERIC;
BEGIN
    IF p_check_in IS NULL OR p_check_out IS NULL OR p_check_out <= p_check_in THEN
        RETURN 0.0;
    END IF;

    v_review := COALESCE(v_context->'hr_review', '{}'::JSONB);
    v_actual := COALESCE(v_context->'actual', '{}'::JSONB);
    v_decision := COALESCE(v_review->>'review_decision', '');

    IF v_decision IN ('EXCLUDED_INVALID', 'NEEDS_MORE_INFO')
       OR COALESCE(p_actual_hours, 0) <= 0 THEN
        RETURN 0.0;
    END IF;

    -- An HR reassignment makes the newly assigned shift authoritative.
    -- Otherwise the immutable check-in snapshot takes precedence over a shift
    -- definition that may have been edited later.
    IF v_decision = 'SHIFT_REASSIGNED' THEN
        v_shift_start := p_shift_start;
        v_shift_end := p_shift_end;
        v_shift_hours := p_shift_hours;
        v_break_minutes := p_break_minutes;
    ELSE
        v_shift_start := COALESCE(NULLIF(v_actual->>'start_time', '')::TIME, p_shift_start);
        v_shift_end := COALESCE(NULLIF(v_actual->>'end_time', '')::TIME, p_shift_end);
        v_shift_hours := COALESCE(NULLIF(v_actual->>'work_hours', '')::NUMERIC, p_shift_hours);
        v_break_minutes := COALESCE(NULLIF(v_actual->>'break_minutes', '')::INTEGER, p_break_minutes, 0);
    END IF;

    IF p_work_date IS NULL OR v_shift_start IS NULL OR v_shift_end IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0001',
            MESSAGE = 'PAYROLL_FIXED_SHIFT_REQUIRED: attendance has no resolvable assigned shift';
    END IF;

    v_break_minutes := GREATEST(0, COALESCE(v_break_minutes, 0));
    v_window_start := (p_work_date + v_shift_start) AT TIME ZONE 'Asia/Ho_Chi_Minh';
    v_window_end := (
        p_work_date + v_shift_end
        + CASE WHEN v_shift_end <= v_shift_start THEN INTERVAL '1 day' ELSE INTERVAL '0 day' END
    ) AT TIME ZONE 'Asia/Ho_Chi_Minh';

    v_window_hours := GREATEST(0, EXTRACT(EPOCH FROM (v_window_end - v_window_start)) / 3600.0);
    v_window_net_hours := GREATEST(0, v_window_hours - v_break_minutes / 60.0);

    -- Use only the intersection of attendance and assigned shift. Staying
    -- before/after the shift cannot replace late or early minutes.
    v_overlap_hours := LEAST(
        GREATEST(0, COALESCE(p_actual_hours, 0)),
        GREATEST(0, EXTRACT(EPOCH FROM (
            LEAST(p_check_out, v_window_end) - GREATEST(p_check_in, v_window_start)
        )) / 3600.0)
    );

    v_credited_before_break := v_overlap_hours;
    IF v_decision = 'CONFIRMED_RAW_WORK'
       AND NULLIF(v_review->>'credited_work_hours', '') IS NOT NULL THEN
        v_credited_before_break := LEAST(
            v_overlap_hours,
            GREATEST(0, (v_review->>'credited_work_hours')::NUMERIC)
        );
    END IF;

    v_midpoint := v_window_start + ((v_window_end - v_window_start) * 0.5);
    IF v_break_minutes > 0 AND p_check_in <= v_midpoint AND p_check_out >= v_midpoint THEN
        v_break_hours := LEAST(v_credited_before_break, v_break_minutes / 60.0);
    END IF;

    -- Never trust a configured work_hours value greater than the shift window.
    v_cap_hours := CASE
        WHEN COALESCE(v_shift_hours, 0) > 0 THEN LEAST(v_shift_hours, v_window_net_hours)
        ELSE v_window_net_hours
    END;

    -- p_late_minutes, p_approved_ot_hours and p_grace_minutes remain in the
    -- signature for caller compatibility; none may add to regular shift hours.
    RETURN ROUND(GREATEST(0, LEAST(v_cap_hours, v_credited_before_break - v_break_hours)), 2);
END;
$$;

COMMENT ON FUNCTION public.fn_attendance_payable_hours(
    JSONB, NUMERIC, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, NUMERIC, NUMERIC, NUMERIC, DATE, TIME, TIME, INTEGER
) IS 'Regular payable attendance time is the check-in/check-out intersection with the assigned shift, less applicable break and capped at scheduled work hours. Late-grace minutes and time outside the shift are not added.';

COMMIT;
