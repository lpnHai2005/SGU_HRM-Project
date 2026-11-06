-- =========================================================================
-- MIGRATION: 20261106_prorated_allowances_shift_ot_discipline.sql
-- Mô tả (idempotent, chạy lại an toàn):
-- 1. Tham số chính sách: công chuẩn cố định 26, PC chuyên cần 500k lũy tiến,
--    OT đêm x2.0, trần OT 40h/tháng; bãi bỏ phạt tiền đi trễ (-50.000đ/lần).
-- 2. Chuẩn hóa danh mục ca: mọi ca thường = 8h (1 công); ca Full 08–21
--    = 13h − 1h nghỉ = 12h = 8h công chuẩn + 4h OT tự động.
-- 3. Hàm tiện ích: quy đổi công ngày (0/0.5/1), giờ OT đêm 22:00–08:00.
-- 4. Chặn cứng OT tháng vượt 40h ở tầng DB (trigger trên attendance_overtime_approvals).
-- 5. Kỷ luật: bảng disciplinary_records, cờ BLACK_LIST_WARNING trên employees,
--    hàm fn_evaluate_late_discipline(period).
-- 5b. Công chuẩn thống nhất 26 (view v_payroll_period_working_days + fn_payroll_standard_days):
--    bảng công, phiếu lương, import và SP cùng một nguồn; HR vẫn ghi đè được theo kỳ.
-- 6. sp_generate_monthly_payroll: lương CB & PC ăn trưa theo công thực tế /26,
--    cho phép 27/26 công vượt lương HĐ, PC chuyên cần lũy tiến, OT đêm x2.0.
-- =========================================================================

-- 1. THAM SỐ CHÍNH SÁCH ------------------------------------------------------
INSERT INTO public.payroll_policy_settings (setting_key, setting_name, setting_group, numeric_value, unit, description) VALUES
('PRORATE_STANDARD_DAYS', 'Công chuẩn quy đổi lương tháng', 'ATTENDANCE', 26.0, 'NGAY', 'Mẫu số chia lương cơ bản & phụ cấp ăn trưa theo công thực tế (26 công = 208 giờ)'),
('ATTENDANCE_ALLOWANCE', 'Phụ cấp chuyên cần', 'ALLOWANCE', 500000.0, 'VND', 'Đủ 100% khi công >= 20 và trễ >15 phút < 3 lần; 3–4 lần còn 50%; >= 5 lần hoặc công < 20 mất 100%'),
('ATTENDANCE_ALLOWANCE_MIN_DAYS', 'Số công tối thiểu hưởng chuyên cần', 'ATTENDANCE', 20.0, 'NGAY', 'Dưới mức này mất 100% phụ cấp chuyên cần'),
('MEAL_ALLOWANCE_CAP_AT_STANDARD', 'Chặn trần PC ăn trưa ở công chuẩn', 'ALLOWANCE', 1.0, 'CO/KHONG', '1 = PC ăn trưa & đi lại tối đa bằng mức cấu hình khi làm >= 26 công; 0 = tính vượt trần'),
('LATE_WARNING_THRESHOLD_DAYS', 'Số ngày trễ >15 phút để lập biên bản', 'PENALTY', 5.0, 'NGAY', 'Đạt mốc này trong tháng sẽ tự động lập biên bản kỷ luật và cắt 100% chuyên cần'),
('OVERTIME_RATE_NIGHT', 'Hệ số lương làm thêm ca đêm (22:00–08:00)', 'ATTENDANCE', 2.00, 'HE_SO', 'Giờ OT nằm trong khung 22:00–08:00 hưởng 200%'),
('MAX_MONTHLY_OT_HOURS', 'Trần giờ làm thêm mỗi tháng', 'ATTENDANCE', 40.0, 'GIO', 'Hệ thống chặn cứng mọi duyệt OT làm tổng OT tháng vượt mức này')
ON CONFLICT (setting_key) DO NOTHING;

-- Bãi bỏ phạt tiền mặt đi trễ để tuân thủ Bộ luật Lao động (Điều 127).
UPDATE public.payroll_policy_settings
SET is_active = FALSE,
    description = 'ĐÃ BÃI BỎ (20261106): không trừ tiền phạt đi trễ; vi phạm xử lý qua phụ cấp chuyên cần & biên bản kỷ luật'
WHERE setting_key = 'LATE_PENALTY_AMOUNT' AND is_active IS DISTINCT FROM FALSE;


-- 2. CHUẨN HÓA DANH MỤC CA ---------------------------------------------------
ALTER TABLE public.work_shifts
    ADD COLUMN IF NOT EXISTS break_minutes INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS planned_overtime_hours NUMERIC(4, 2) NOT NULL DEFAULT 0;

DO $$
BEGIN
    ALTER TABLE public.work_shifts ADD CONSTRAINT ck_work_shifts_break_minutes CHECK (break_minutes BETWEEN 0 AND 240);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
    ALTER TABLE public.work_shifts ADD CONSTRAINT ck_work_shifts_planned_ot CHECK (planned_overtime_hours BETWEEN 0 AND 12);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Ca sáng bán lẻ 08:00–16:00: đủ 8h (ăn trưa luân phiên 30', không trừ giờ).
UPDATE public.work_shifts SET start_time = '08:00', end_time = '16:00', work_hours = 8.0,
       break_minutes = 0, planned_overtime_hours = 0
WHERE shift_code = 'CA_SANG';
-- Ca chiều bán lẻ 13:00–21:00: 8h (ăn tối luân phiên).
UPDATE public.work_shifts SET start_time = '13:00', end_time = '21:00', work_hours = 8.0,
       break_minutes = 0, planned_overtime_hours = 0
WHERE shift_code = 'CA_CHIEU';
-- Ca hành chính 08:00–17:00: trừ 1h nghỉ trưa 12:00–13:00 = 8h.
UPDATE public.work_shifts SET start_time = '08:00', end_time = '17:00', work_hours = 8.0,
       break_minutes = 60, planned_overtime_hours = 0
WHERE shift_code = 'CA_HANH_CHINH';
-- Ca Full cuối tuần 08:00–21:00: 13h − 1h nghỉ = 12h = 8h công chuẩn + 4h OT.
UPDATE public.work_shifts SET start_time = '08:00', end_time = '21:00', work_hours = 8.0,
       break_minutes = 60, planned_overtime_hours = 4.0
WHERE shift_code = 'CA_FULL';

DO $$
BEGIN
    INSERT INTO public.work_shifts (shift_code, shift_name, start_time, end_time, work_hours, is_active, break_minutes, planned_overtime_hours)
    SELECT v.code, v.name, v.st::time, v.et::time, 8.0, TRUE, v.brk, v.ot
    FROM (VALUES
        ('CA_SANG', 'Ca sáng bán lẻ', '08:00', '16:00', 0, 0.0),
        ('CA_CHIEU', 'Ca chiều bán lẻ', '13:00', '21:00', 0, 0.0),
        ('CA_HANH_CHINH', 'Ca hành chính văn phòng', '08:00', '17:00', 60, 0.0),
        ('CA_FULL', 'Ca Full cuối tuần (8h + 4h OT)', '08:00', '21:00', 60, 4.0)
    ) AS v(code, name, st, et, brk, ot)
    WHERE NOT EXISTS (SELECT 1 FROM public.work_shifts w WHERE w.shift_code = v.code);
EXCEPTION WHEN others THEN
    RAISE NOTICE 'Bỏ qua tạo ca mặc định: %', SQLERRM;
END $$;


-- 3. HÀM TIỆN ÍCH ------------------------------------------------------------
-- Quy đổi giờ làm thực tế trong ngày ra công: < 4h = 0; 4h–<7.5h = 0.5; >= 7.5h = 1.0.
CREATE OR REPLACE FUNCTION public.fn_work_day_credit(p_hours NUMERIC)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN COALESCE(p_hours, 0) < 4.0 THEN 0.0
        WHEN p_hours < 7.5 THEN 0.5
        ELSE 1.0
    END::NUMERIC;
$$;

-- Số giờ của [p_start, p_end) nằm trong khung đêm 22:00–08:00 (giờ Việt Nam).
CREATE OR REPLACE FUNCTION public.fn_night_overlap_hours(p_start TIMESTAMPTZ, p_end TIMESTAMPTZ)
RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_day DATE;
    v_last DATE;
    v_lo TIMESTAMPTZ;
    v_hi TIMESTAMPTZ;
    v_total NUMERIC := 0;
BEGIN
    IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
        RETURN 0;
    END IF;
    v_day := (p_start AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE - 1;
    v_last := (p_end AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE;
    WHILE v_day <= v_last LOOP
        v_lo := GREATEST(p_start, (v_day + TIME '22:00') AT TIME ZONE 'Asia/Ho_Chi_Minh');
        v_hi := LEAST(p_end, (v_day + 1 + TIME '08:00') AT TIME ZONE 'Asia/Ho_Chi_Minh');
        IF v_hi > v_lo THEN
            v_total := v_total + EXTRACT(EPOCH FROM (v_hi - v_lo)) / 3600.0;
        END IF;
        v_day := v_day + 1;
    END LOOP;
    RETURN ROUND(v_total, 2);
END;
$$;

-- Giờ OT tự động của ca Full (phần vượt 8h công chuẩn, tối đa planned_overtime_hours).
CREATE OR REPLACE FUNCTION public.fn_attendance_planned_ot_hours(p_attendance_id BIGINT)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
    SELECT COALESCE(ROUND(LEAST(sh.planned_overtime_hours,
                                GREATEST(0, COALESCE(a.actual_work_hours, 0) - sh.work_hours)), 2), 0)
    FROM public.attendances a
    JOIN public.work_shifts sh ON sh.shift_id = a.shift_id
    WHERE a.attendance_id = p_attendance_id
      AND a.check_out_time IS NOT NULL
      AND sh.planned_overtime_hours > 0;
$$;


-- Lần trễ hợp lệ — cùng quy tắc với bảng công (operations.is_valid_late_session):
-- HR xác nhận trễ → tính; HR loại trừ / chờ giải trình → không tính; còn lại cần đủ check-in/out,
-- trễ > ân hạn, không lệch/ngoài ca, phiên > 15 phút và trễ ≤ 240 phút (trễ quá dài chờ HR rà soát).
CREATE OR REPLACE FUNCTION public.fn_attendance_counts_as_late(
    p_late_minutes INTEGER, p_check_in TIMESTAMPTZ, p_check_out TIMESTAMPTZ,
    p_context JSONB, p_tolerance NUMERIC DEFAULT 15)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_context->'hr_review'->>'review_decision' = 'CONFIRMED_LATE' THEN TRUE
        WHEN p_context->'hr_review'->>'review_decision' IN ('EXCLUDED_INVALID', 'NEEDS_MORE_INFO') THEN FALSE
        WHEN COALESCE(p_late_minutes, 0) <= p_tolerance THEN FALSE
        WHEN p_check_in IS NULL OR p_check_out IS NULL THEN FALSE
        WHEN COALESCE(p_context->>'schedule_status', '') IN ('SHIFT_MISMATCH', 'UNSCHEDULED', 'OUTSIDE_SHIFT', 'INVALID_TIME') THEN FALSE
        WHEN p_check_out - p_check_in <= INTERVAL '15 minutes' THEN FALSE
        WHEN p_late_minutes > 240 THEN FALSE
        ELSE TRUE
    END
$$;


-- 4. OT: GIỜ ĐÊM & TRẦN 40H/THÁNG -------------------------------------------
ALTER TABLE public.attendance_overtime_approvals
    ADD COLUMN IF NOT EXISTS night_hours NUMERIC(5, 2);

-- Tổng OT tháng của nhân viên (đã duyệt + OT tự động ca Full), bỏ qua 1 phiên nếu cần.
CREATE OR REPLACE FUNCTION public.fn_employee_monthly_ot_hours(
    p_employee_id INTEGER, p_period VARCHAR, p_exclude_attendance_id BIGINT DEFAULT NULL
)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
    SELECT COALESCE(SUM(GREATEST(
               CASE WHEN ota.decision = 'APPROVED' THEN COALESCE(ota.approved_hours, 0) ELSE 0 END,
               public.fn_attendance_planned_ot_hours(a.attendance_id))), 0)
    FROM public.attendances a
    LEFT JOIN public.attendance_overtime_approvals ota ON ota.attendance_id = a.attendance_id
    WHERE a.employee_id = p_employee_id
      AND TO_CHAR(a.work_date, 'YYYY-MM') = p_period
      AND (p_exclude_attendance_id IS NULL OR a.attendance_id <> p_exclude_attendance_id);
$$;

CREATE OR REPLACE FUNCTION public.fn_guard_monthly_ot_cap()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_cap NUMERIC;
    v_employee INTEGER;
    v_period VARCHAR;
    v_existing NUMERIC;
    v_new NUMERIC;
BEGIN
    IF NEW.decision <> 'APPROVED' OR COALESCE(NEW.approved_hours, 0) <= 0 THEN
        RETURN NEW;
    END IF;
    -- Chỉ kiểm tra khi số giờ duyệt tăng lên (dữ liệu cũ đã vượt trần không bị khóa khi sửa giảm).
    IF TG_OP = 'UPDATE' AND OLD.decision = 'APPROVED'
       AND COALESCE(NEW.approved_hours, 0) <= COALESCE(OLD.approved_hours, 0) THEN
        RETURN NEW;
    END IF;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings
                     WHERE setting_key = 'MAX_MONTHLY_OT_HOURS' AND is_active = TRUE), 40.0) INTO v_cap;
    SELECT a.employee_id, TO_CHAR(a.work_date, 'YYYY-MM') INTO v_employee, v_period
    FROM public.attendances a WHERE a.attendance_id = NEW.attendance_id;
    IF v_employee IS NULL THEN
        RETURN NEW;
    END IF;
    v_existing := public.fn_employee_monthly_ot_hours(v_employee, v_period, NEW.attendance_id);
    v_new := v_existing + GREATEST(NEW.approved_hours, public.fn_attendance_planned_ot_hours(NEW.attendance_id));
    IF v_new > v_cap THEN
        RAISE EXCEPTION 'OT_MONTHLY_CAP_EXCEEDED: tổng OT tháng % sẽ là %h, vượt trần %h (đã có %h)',
            v_period, ROUND(v_new, 2), v_cap, ROUND(v_existing, 2)
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_monthly_ot_cap ON public.attendance_overtime_approvals;
CREATE TRIGGER trg_guard_monthly_ot_cap
    BEFORE INSERT OR UPDATE ON public.attendance_overtime_approvals
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_monthly_ot_cap();

-- Trigger đồng bộ đối soát OT: bổ sung night_hours tính từ eligible_intervals.
CREATE OR REPLACE FUNCTION public.fn_sync_ot_reconciliation_to_approvals()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $func$
DECLARE
    att_id_val TEXT;
    att_id BIGINT;
    target_att_id BIGINT;
    v_total_hours NUMERIC(5, 2);
    v_night_hours NUMERIC(5, 2);
BEGIN
    IF NEW.status = 'VERIFIED' AND COALESCE(NEW.verified_microseconds, 0) > 0 THEN
        v_total_hours := ROUND(NEW.verified_microseconds / 3600000000.0, 2);
        SELECT LEAST(v_total_hours, COALESCE(SUM(public.fn_night_overlap_hours(
                   (iv->>'starts_at')::TIMESTAMPTZ, (iv->>'ends_at')::TIMESTAMPTZ)), 0))
        INTO v_night_hours
        FROM jsonb_array_elements(COALESCE(NEW.eligible_intervals, '[]'::jsonb)) iv;

        IF NEW.attendance_ids IS NOT NULL AND jsonb_array_length(NEW.attendance_ids) > 0 THEN
            SELECT (val)::BIGINT INTO target_att_id
            FROM jsonb_array_elements_text(NEW.attendance_ids) val
            ORDER BY (val)::BIGINT DESC
            LIMIT 1;

            FOR att_id_val IN SELECT jsonb_array_elements_text(NEW.attendance_ids) LOOP
                att_id := att_id_val::BIGINT;

                IF att_id = target_att_id THEN
                    UPDATE public.attendances
                    SET overtime_hours = GREATEST(COALESCE(overtime_hours, 0), v_total_hours),
                        updated_at = clock_timestamp()
                    WHERE attendance_id = att_id;

                    INSERT INTO public.attendance_overtime_approvals (
                        attendance_id, approved_hours, night_hours, decision, reviewer_user_id, reason, updated_at
                    )
                    VALUES (
                        att_id, v_total_hours, v_night_hours, 'APPROVED', NEW.reviewed_by,
                        COALESCE(NEW.decision_reason, CONCAT('Đối soát OT Request #', NEW.request_id, ' (VERIFIED)')),
                        clock_timestamp()
                    )
                    ON CONFLICT (attendance_id) DO UPDATE SET
                        approved_hours = EXCLUDED.approved_hours,
                        night_hours = EXCLUDED.night_hours,
                        decision = EXCLUDED.decision,
                        reviewer_user_id = EXCLUDED.reviewer_user_id,
                        reason = EXCLUDED.reason,
                        updated_at = clock_timestamp();
                ELSE
                    INSERT INTO public.attendance_overtime_approvals (
                        attendance_id, approved_hours, night_hours, decision, reviewer_user_id, reason, updated_at
                    )
                    VALUES (
                        att_id, 0, 0, 'APPROVED', NEW.reviewed_by,
                        CONCAT('Giờ OT đã được gộp đối soát vào phiên #', target_att_id),
                        clock_timestamp()
                    )
                    ON CONFLICT (attendance_id) DO UPDATE SET
                        approved_hours = 0,
                        night_hours = 0,
                        decision = EXCLUDED.decision,
                        reviewer_user_id = EXCLUDED.reviewer_user_id,
                        reason = EXCLUDED.reason,
                        updated_at = clock_timestamp();
                END IF;
            END LOOP;
        END IF;
    ELSIF NEW.status = 'REJECTED' THEN
        IF NEW.attendance_ids IS NOT NULL AND jsonb_array_length(NEW.attendance_ids) > 0 THEN
            FOR att_id_val IN SELECT jsonb_array_elements_text(NEW.attendance_ids) LOOP
                att_id := att_id_val::BIGINT;
                INSERT INTO public.attendance_overtime_approvals (
                    attendance_id, approved_hours, night_hours, decision, reviewer_user_id, reason, updated_at
                )
                VALUES (
                    att_id, 0, 0, 'REJECTED', NEW.reviewed_by,
                    COALESCE(NEW.decision_reason, CONCAT('Từ chối đối soát OT Request #', NEW.request_id)),
                    clock_timestamp()
                )
                ON CONFLICT (attendance_id) DO UPDATE SET
                    approved_hours = 0,
                    night_hours = 0,
                    decision = 'REJECTED',
                    reviewer_user_id = EXCLUDED.reviewer_user_id,
                    reason = EXCLUDED.reason,
                    updated_at = clock_timestamp();
            END LOOP;
        END IF;
    END IF;
    RETURN NEW;
END;
$func$;


-- 4b. GIỜ CÔNG & OT ĐƯỢC TRẢ LƯƠNG ------------------------------------------
-- Giờ công của phiên được tính lương — khớp bảng công (operations.valid_work_rows):
-- phiên chưa check-out, HR loại trừ (EXCLUDED_INVALID) hoặc tạm giữ chờ giải trình (NEEDS_MORE_INFO) = 0.
-- Không suy giờ từ check-in/out khi actual_work_hours = 0 (HR loại trừ đặt về 0).
CREATE OR REPLACE FUNCTION public.fn_attendance_payable_hours(
    p_actual_hours NUMERIC, p_check_in TIMESTAMPTZ, p_check_out TIMESTAMPTZ, p_context JSONB)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_check_in IS NULL OR p_check_out IS NULL THEN 0
        WHEN p_context->'hr_review'->>'review_decision' IN ('EXCLUDED_INVALID', 'NEEDS_MORE_INFO') THEN 0
        WHEN p_actual_hours IS NOT NULL THEN GREATEST(p_actual_hours, 0)
        ELSE GREATEST(EXTRACT(EPOCH FROM (p_check_out - p_check_in)) / 3600.0, 0)
    END
$$;

CREATE OR REPLACE FUNCTION public.fn_interval_overlap_hours(
    p_a_start TIMESTAMPTZ, p_a_end TIMESTAMPTZ, p_b_start TIMESTAMPTZ, p_b_end TIMESTAMPTZ)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
    SELECT GREATEST(0, EXTRACT(EPOCH FROM (LEAST(p_a_end, p_b_end) - GREATEST(p_a_start, p_b_start))) / 3600.0)
$$;

-- Nguồn OT duy nhất để trả lương (VERIFIED_ONLY):
--   VERIFIED      : đơn OT đã được HR đối soát VERIFIED và còn hiệu lực (v_overtime_verified_current);
--   SHIFT_PLANNED : OT tự động của ca có planned_overtime_hours (Ca Full 4h) trên phiên được trả lương,
--                   trừ phần trùng thời gian với đơn OT đã VERIFIED (không trả hai lần).
-- Giờ ngoài ca thô từ máy chấm công (attendances.overtime_hours) KHÔNG được tính.
CREATE OR REPLACE FUNCTION public.fn_payable_ot_rows(p_period VARCHAR)
RETURNS TABLE (employee_id INTEGER, work_date DATE, source VARCHAR, hours NUMERIC, night_hours NUMERIC)
LANGUAGE sql STABLE AS $$
    WITH verified AS (
        SELECT v.employee_id, v.work_date, v.request_id,
               ROUND(v.verified_microseconds / 3600000000.0, 2) AS hours,
               COALESCE(NULLIF(v.eligible_intervals, '[]'::jsonb),
                        jsonb_build_array(jsonb_build_object('starts_at', v.starts_at, 'ends_at', v.ends_at))) AS intervals
        FROM public.v_overtime_verified_current v
        WHERE TO_CHAR(v.work_date, 'YYYY-MM') = p_period AND COALESCE(v.verified_microseconds, 0) > 0
    ),
    verified_iv AS (
        SELECT ve.employee_id, ve.work_date, ve.request_id,
               (iv->>'starts_at')::TIMESTAMPTZ AS s, (iv->>'ends_at')::TIMESTAMPTZ AS e
        FROM verified ve, jsonb_array_elements(ve.intervals) iv
    ),
    planned AS (
        SELECT a.employee_id, a.work_date,
               public.fn_attendance_planned_ot_hours(a.attendance_id) AS hours,
               w.window_end - make_interval(secs => (sh.planned_overtime_hours * 3600)::double precision) AS window_start,
               w.window_end
        FROM public.attendances a
        JOIN public.work_shifts sh ON sh.shift_id = a.shift_id
        CROSS JOIN LATERAL (SELECT ((a.work_date + sh.end_time
                                     + CASE WHEN sh.end_time <= sh.start_time THEN INTERVAL '1 day' ELSE INTERVAL '0' END)
                                    AT TIME ZONE 'Asia/Ho_Chi_Minh') AS window_end) w
        WHERE TO_CHAR(a.work_date, 'YYYY-MM') = p_period
          AND sh.planned_overtime_hours > 0
          AND public.fn_attendance_payable_hours(a.actual_work_hours, a.check_in_time, a.check_out_time,
                                                 a.attendance_context) > 0
    )
    SELECT ve.employee_id, ve.work_date, 'VERIFIED'::VARCHAR, ve.hours,
           LEAST(ve.hours, ROUND(COALESCE((SELECT SUM(public.fn_night_overlap_hours(i.s, i.e))
                                           FROM verified_iv i WHERE i.request_id = ve.request_id), 0), 2))
    FROM verified ve
    UNION ALL
    SELECT p.employee_id, p.work_date, 'SHIFT_PLANNED'::VARCHAR, x.hours,
           LEAST(x.hours, public.fn_night_overlap_hours(p.window_end - make_interval(secs => (x.hours * 3600)::double precision),
                                                        p.window_end))
    FROM planned p
    CROSS JOIN LATERAL (
        SELECT ROUND(GREATEST(0, p.hours - COALESCE((
            SELECT SUM(public.fn_interval_overlap_hours(i.s, i.e, p.window_start, p.window_end))
            FROM verified_iv i WHERE i.employee_id = p.employee_id AND i.work_date = p.work_date), 0)), 2) AS hours
    ) x
    WHERE x.hours > 0
$$;


-- 5. KỶ LUẬT & BLACK-LIST ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.disciplinary_records (
    record_id      BIGSERIAL PRIMARY KEY,
    employee_id    INTEGER NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
    salary_period  VARCHAR(7) NOT NULL CHECK (salary_period ~ '^\d{4}-\d{2}$'),
    record_type    VARCHAR(40) NOT NULL DEFAULT 'LATE_WARNING_REPORT'
                   CHECK (record_type IN ('LATE_WARNING_REPORT')),
    late_days      INTEGER NOT NULL DEFAULT 0 CHECK (late_days >= 0),
    details        JSONB NOT NULL DEFAULT '{}'::jsonb,
    status         VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'VOIDED')),
    is_auto        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (employee_id, salary_period, record_type)
);
CREATE INDEX IF NOT EXISTS ix_disciplinary_records_period ON public.disciplinary_records(salary_period, record_type);

ALTER TABLE public.employees
    ADD COLUMN IF NOT EXISTS is_blacklisted_warning BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS blacklisted_warning_at TIMESTAMPTZ;

-- Đánh giá kỷ luật đi trễ của 1 kỳ: lập/hủy biên bản tự động, gắn cờ Black-list.
-- Trả về số biên bản đang hiệu lực của kỳ.
CREATE OR REPLACE FUNCTION public.fn_evaluate_late_discipline(p_period VARCHAR)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
    v_tolerance NUMERIC;
    v_threshold NUMERIC;
    v_prev1 VARCHAR := TO_CHAR(TO_DATE(p_period || '-01', 'YYYY-MM-DD') - INTERVAL '1 month', 'YYYY-MM');
    v_prev2 VARCHAR := TO_CHAR(TO_DATE(p_period || '-01', 'YYYY-MM-DD') - INTERVAL '2 month', 'YYYY-MM');
    v_count INTEGER;
BEGIN
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings
                     WHERE setting_key = 'LATE_TOLERANCE_MINUTES' AND is_active = TRUE), 15.0) INTO v_tolerance;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings
                     WHERE setting_key = 'LATE_WARNING_THRESHOLD_DAYS' AND is_active = TRUE), 5.0) INTO v_threshold;

    CREATE TEMP TABLE IF NOT EXISTS tmp_late_days (employee_id INTEGER PRIMARY KEY, late_days INTEGER, dates JSONB) ON COMMIT DROP;
    DELETE FROM tmp_late_days;
    INSERT INTO tmp_late_days
    SELECT x.employee_id, COUNT(*)::INTEGER, jsonb_agg(x.work_date ORDER BY x.work_date)
    FROM (
        SELECT a.employee_id, a.work_date
        FROM public.attendances a
        WHERE TO_CHAR(a.work_date, 'YYYY-MM') = p_period
          AND public.fn_attendance_counts_as_late(a.late_minutes, a.check_in_time, a.check_out_time, a.attendance_context, v_tolerance)
        GROUP BY a.employee_id, a.work_date
    ) x
    GROUP BY x.employee_id;

    INSERT INTO public.disciplinary_records (employee_id, salary_period, record_type, late_days, details)
    SELECT t.employee_id, p_period, 'LATE_WARNING_REPORT', t.late_days,
           jsonb_build_object('late_dates', t.dates, 'threshold_days', v_threshold, 'grace_minutes', v_tolerance)
    FROM tmp_late_days t
    WHERE t.late_days >= v_threshold
    ON CONFLICT (employee_id, salary_period, record_type) DO UPDATE SET
        late_days = EXCLUDED.late_days,
        details = EXCLUDED.details,
        status = CASE WHEN public.disciplinary_records.status = 'VOIDED' AND public.disciplinary_records.is_auto
                      THEN 'OPEN' ELSE public.disciplinary_records.status END,
        updated_at = clock_timestamp();

    -- Biên bản tự động không còn đủ điều kiện (dữ liệu chấm công đã được điều chỉnh) -> hủy.
    UPDATE public.disciplinary_records d
    SET status = 'VOIDED', updated_at = clock_timestamp()
    WHERE d.salary_period = p_period AND d.record_type = 'LATE_WARNING_REPORT' AND d.is_auto
      AND d.status = 'OPEN'
      AND COALESCE((SELECT t.late_days FROM tmp_late_days t WHERE t.employee_id = d.employee_id), 0) < v_threshold;

    -- 3 tháng liên tiếp có biên bản -> gắn cờ BLACK_LIST_WARNING (HR tự gỡ sau khi xử lý).
    UPDATE public.employees e
    SET is_blacklisted_warning = TRUE, blacklisted_warning_at = COALESCE(e.blacklisted_warning_at, clock_timestamp())
    WHERE e.is_blacklisted_warning = FALSE
      AND (SELECT COUNT(DISTINCT d.salary_period) FROM public.disciplinary_records d
           WHERE d.employee_id = e.employee_id AND d.record_type = 'LATE_WARNING_REPORT'
             AND d.status <> 'VOIDED' AND d.salary_period IN (p_period, v_prev1, v_prev2)) = 3;

    SELECT COUNT(*) INTO v_count FROM public.disciplinary_records
    WHERE salary_period = p_period AND record_type = 'LATE_WARNING_REPORT' AND status <> 'VOIDED';
    RETURN v_count;
END;
$$;


-- 5b. CÔNG CHUẨN THỐNG NHẤT 26 CÔNG ------------------------------------------
-- Bảng công, phiếu lương, import Excel và SP cùng đọc fn_payroll_standard_days:
-- kỳ đã chốt (CONFIRMED/PAID) giữ số đã khóa → HR ghi đè cấp kỳ → PRORATE_STANDARD_DAYS (26).
-- Số ngày làm việc theo lịch (trừ CN & lễ) chỉ còn để tham khảo: cột calendar_working_days.
CREATE TABLE IF NOT EXISTS public.payroll_period_overrides (
    salary_period VARCHAR(7) PRIMARY KEY,
    override_working_days NUMERIC(4, 1) NOT NULL CHECK (override_working_days > 0),
    reason VARCHAR(255),
    updated_by INTEGER REFERENCES public.users(user_id),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION public.fn_prorate_standard_days()
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        (SELECT NULLIF(numeric_value, 0) FROM public.payroll_policy_settings
         WHERE setting_key = 'PRORATE_STANDARD_DAYS' AND is_active = TRUE AND numeric_value > 0),
        26.0)
$$;

CREATE OR REPLACE VIEW public.v_payroll_period_working_days AS
WITH months AS (
    SELECT
        TO_CHAR(m, 'YYYY-MM') AS salary_period,
        m::DATE AS start_date,
        (m + INTERVAL '1 month - 1 day')::DATE AS end_date,
        EXTRACT(DAY FROM (m + INTERVAL '1 month - 1 day'))::INT AS calendar_days
    FROM generate_series(DATE '2020-01-01', DATE '2040-12-01', INTERVAL '1 month') AS m
),
month_days AS (
    SELECT
        m.salary_period,
        m.calendar_days,
        d::DATE AS work_date,
        EXTRACT(DOW FROM d)::INT AS day_of_week
    FROM months m,
         generate_series(m.start_date, m.end_date, INTERVAL '1 day') AS d
),
closed_periods AS (
    SELECT
        salary_period,
        MAX(standard_working_days) AS locked_standard_days
    FROM public.payrolls
    WHERE payment_status IN ('CONFIRMED', 'PAID')
    GROUP BY salary_period
)
SELECT
    md.salary_period,
    md.calendar_days,
    COUNT(md.work_date) FILTER (WHERE md.day_of_week = 0)::INT AS sundays_count,
    COUNT(h.holiday_date) FILTER (WHERE md.day_of_week <> 0)::INT AS holidays_count,
    public.fn_prorate_standard_days()::NUMERIC(4, 1) AS auto_standard_days,
    o.override_working_days AS manual_standard_days,
    cp.locked_standard_days,
    COALESCE(
        cp.locked_standard_days,
        o.override_working_days,
        public.fn_prorate_standard_days()
    )::NUMERIC(4, 1) AS applied_standard_days,
    (o.override_working_days IS NOT NULL) AS is_manual_override,
    (cp.locked_standard_days IS NOT NULL) AS is_locked,
    o.reason,
    o.updated_at,
    COUNT(md.work_date) FILTER (WHERE md.day_of_week <> 0 AND h.holiday_date IS NULL)::NUMERIC(4, 1) AS calendar_working_days
FROM month_days md
LEFT JOIN public.public_holidays h ON md.work_date = h.holiday_date
LEFT JOIN public.payroll_period_overrides o ON md.salary_period = o.salary_period
LEFT JOIN closed_periods cp ON md.salary_period = cp.salary_period
GROUP BY md.salary_period, md.calendar_days, o.override_working_days, o.reason, o.updated_at, cp.locked_standard_days;

COMMENT ON VIEW public.v_payroll_period_working_days IS
    'Công chuẩn thống nhất: kỳ đã chốt → HR ghi đè → PRORATE_STANDARD_DAYS (26). calendar_working_days chỉ để tham khảo.';

CREATE OR REPLACE FUNCTION public.fn_payroll_standard_days(p_period VARCHAR)
RETURNS NUMERIC LANGUAGE plpgsql STABLE AS $$
DECLARE v NUMERIC;
BEGIN
    SELECT applied_standard_days INTO v
    FROM public.v_payroll_period_working_days WHERE salary_period = p_period;
    IF v IS NULL OR v <= 0 THEN
        v := COALESCE(
            (SELECT override_working_days FROM public.payroll_period_overrides WHERE salary_period = p_period),
            public.fn_prorate_standard_days());
    END IF;
    RETURN v;
END $$;


-- 5c. THUẾ TNCN NHẬP TỪ EXCEL (Phase 1) -----------------------------------------
ALTER TABLE public.payroll_import_overrides
    ADD COLUMN IF NOT EXISTS personal_income_tax NUMERIC(15, 2) NOT NULL DEFAULT 0;
DO $$ BEGIN
    ALTER TABLE public.payroll_import_overrides
        ADD CONSTRAINT ck_payroll_import_overrides_pit CHECK (personal_income_tax >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- 6. STORED PROCEDURE TÍNH LƯƠNG ---------------------------------------------
CREATE OR REPLACE PROCEDURE public.sp_generate_monthly_payroll(IN p_period character varying, IN p_hr_user_id integer)
LANGUAGE plpgsql
AS $procedure$
DECLARE
    v_standard_days NUMERIC(5, 2);
    v_ot_rate_normal NUMERIC(5, 2);
    v_ot_rate_weekend NUMERIC(5, 2);
    v_ot_rate_holiday NUMERIC(5, 2);
    v_ot_rate_night NUMERIC(5, 2);
    v_late_tolerance NUMERIC(5, 2);
    v_late_threshold NUMERIC(5, 2);
    v_meal_allowance NUMERIC(15, 2);
    v_meal_cap BOOLEAN;
    v_attendance_allowance NUMERIC(15, 2);
    v_attendance_min_days NUMERIC(5, 2);
    v_seniority_1y NUMERIC(15, 2);
    v_seniority_3y NUMERIC(15, 2);
    v_seniority_5y NUMERIC(15, 2);
    v_bhxh_rate NUMERIC(15, 4);
    v_bhyt_rate NUMERIC(15, 4);
    v_bhtn_rate NUMERIC(15, 4);
    v_period_date DATE;
    v_period_end DATE;
BEGIN
    v_period_date := TO_DATE(p_period || '-01', 'YYYY-MM-DD');
    v_period_end := (v_period_date + INTERVAL '1 month - 1 day')::DATE;

    -- 1. THAM SỐ ĐỘNG
    -- Công chuẩn thống nhất với bảng công: kỳ đã chốt → HR ghi đè → PRORATE_STANDARD_DAYS (26).
    v_standard_days := public.fn_payroll_standard_days(p_period);
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'OVERTIME_RATE_NORMAL' AND is_active = TRUE), 1.50) INTO v_ot_rate_normal;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'OVERTIME_RATE_WEEKEND' AND is_active = TRUE), 2.00) INTO v_ot_rate_weekend;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'OVERTIME_RATE_HOLIDAY' AND is_active = TRUE), 3.00) INTO v_ot_rate_holiday;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'OVERTIME_RATE_NIGHT' AND is_active = TRUE), 2.00) INTO v_ot_rate_night;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'LATE_TOLERANCE_MINUTES' AND is_active = TRUE), 15.0) INTO v_late_tolerance;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'LATE_WARNING_THRESHOLD_DAYS' AND is_active = TRUE), 5.0) INTO v_late_threshold;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'MEAL_TRANSPORT_ALLOWANCE' AND is_active = TRUE), 1000000.0) INTO v_meal_allowance;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'MEAL_ALLOWANCE_CAP_AT_STANDARD' AND is_active = TRUE), 1.0) <> 0 INTO v_meal_cap;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'ATTENDANCE_ALLOWANCE' AND is_active = TRUE), 500000.0) INTO v_attendance_allowance;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'ATTENDANCE_ALLOWANCE_MIN_DAYS' AND is_active = TRUE), 20.0) INTO v_attendance_min_days;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'SENIORITY_ALLOWANCE_1Y' AND is_active = TRUE), 500000.0) INTO v_seniority_1y;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'SENIORITY_ALLOWANCE_3Y' AND is_active = TRUE), 1000000.0) INTO v_seniority_3y;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'SENIORITY_ALLOWANCE_5Y' AND is_active = TRUE), 1500000.0) INTO v_seniority_5y;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'BHXH_EMPLOYEE_RATE' AND is_active = TRUE), 0.0800) INTO v_bhxh_rate;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'BHYT_EMPLOYEE_RATE' AND is_active = TRUE), 0.0150) INTO v_bhyt_rate;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'BHTN_EMPLOYEE_RATE' AND is_active = TRUE), 0.0100) INTO v_bhtn_rate;
    IF v_standard_days IS NULL OR v_standard_days <= 0 THEN v_standard_days := 26.0; END IF;

    -- 2. KỶ LUẬT ĐI TRỄ CỦA KỲ (lập biên bản trước khi tính chuyên cần)
    PERFORM public.fn_evaluate_late_discipline(p_period);

    -- 3. DỌN DẸP DỮ LIỆU DRAFT CŨ
    DELETE FROM payroll_details
    WHERE payroll_id IN (
        SELECT payroll_id FROM payrolls
        WHERE salary_period = p_period AND payment_status IN ('DRAFT', 'NEEDS_RECALCULATION')
    );
    DELETE FROM payrolls
    WHERE salary_period = p_period AND payment_status IN ('DRAFT', 'NEEDS_RECALCULATION');

    -- 4. SỐ LIỆU CÔNG THEO NHÂN VIÊN (bảng tạm dùng cho các bước sau)
    DROP TABLE IF EXISTS tmp_payroll_work;
    CREATE TEMP TABLE tmp_payroll_work ON COMMIT DROP AS
    SELECT
        e.employee_id, e.store_id,
        (pos.position_code = 'DIRECTOR' AND ov.employee_id IS NULL) AS is_director_default,
        (ov.employee_id IS NOT NULL) AS is_override,
        COALESCE(ov.unpaid_leave_days,
                 GREATEST(COALESCE(att.unpaid_leave_days, 0), COALESCE(lr.unpaid_days, 0))) AS unpaid,
        COALESCE(ov.paid_leave_days,
                 GREATEST(COALESCE(att.paid_leave_days, 0), COALESCE(lr.paid_days, 0)))     AS paid,
        COALESCE(att.credit_days, 0.0) AS credit_days,
        CASE WHEN pos.position_code = 'DIRECTOR' AND ov.employee_id IS NULL THEN 0
             ELSE COALESCE(att.late_days, 0) END AS late_days,
        public.fn_employee_daily_standard_hours(e.employee_id, p_period) AS emp_daily_hours,
        COALESCE(c.basic_salary, 8000000) AS contract_salary
    FROM employees e
    JOIN positions pos ON e.position_id = pos.position_id
    LEFT JOIN contracts c ON e.employee_id = c.employee_id AND c.status = 'ACTIVE'
    LEFT JOIN public.payroll_import_overrides ov
           ON ov.salary_period = p_period AND ov.employee_id = e.employee_id
    LEFT JOIN (
        SELECT d.employee_id,
               SUM(public.fn_work_day_credit(d.day_hours)) AS credit_days,
               COUNT(*) FILTER (WHERE d.is_late_day)::INTEGER AS late_days,
               SUM(d.paid_flag)::NUMERIC AS paid_leave_days,
               SUM(d.unpaid_flag)::NUMERIC AS unpaid_leave_days
        FROM (
            SELECT a.employee_id, a.work_date,
                   SUM(public.fn_attendance_payable_hours(a.actual_work_hours, a.check_in_time, a.check_out_time,
                                                          a.attendance_context)) AS day_hours,
                   BOOL_OR(public.fn_attendance_counts_as_late(a.late_minutes, a.check_in_time, a.check_out_time,
                                                               a.attendance_context, v_late_tolerance)) AS is_late_day,
                   MAX(CASE WHEN a.status IN ('ANNUAL_LEAVE', 'MATERNITY_LEAVE') THEN 1 ELSE 0 END) AS paid_flag,
                   MAX(CASE WHEN a.status IN ('UNPAID_LEAVE', 'SICK_LEAVE') THEN 1 ELSE 0 END) AS unpaid_flag
            FROM attendances a
            WHERE TO_CHAR(a.work_date, 'YYYY-MM') = p_period
            GROUP BY a.employee_id, a.work_date
        ) d
        GROUP BY d.employee_id
    ) att ON e.employee_id = att.employee_id
    LEFT JOIN (
        SELECT
            req.employee_id,
            COALESCE(SUM(CASE WHEN lt.is_paid = TRUE THEN
                (SELECT COUNT(*)::NUMERIC FROM generate_series(GREATEST(req.start_date, v_period_date),
                     LEAST(req.end_date, v_period_end), INTERVAL '1 day') d WHERE EXTRACT(DOW FROM d) <> 0)
            ELSE 0 END), 0) AS paid_days,
            COALESCE(SUM(CASE WHEN lt.is_paid = FALSE THEN
                (SELECT COUNT(*)::NUMERIC FROM generate_series(GREATEST(req.start_date, v_period_date),
                     LEAST(req.end_date, v_period_end), INTERVAL '1 day') d WHERE EXTRACT(DOW FROM d) <> 0)
            ELSE 0 END), 0) AS unpaid_days
        FROM leave_requests req
        JOIN leave_types lt ON req.leave_type_id = lt.leave_type_id
        WHERE req.status = 'HR_APPROVED'
          AND req.start_date <= v_period_end
          AND req.end_date >= v_period_date
        GROUP BY req.employee_id
    ) lr ON e.employee_id = lr.employee_id
    WHERE e.employment_status IN ('ACTIVE', 'PROBATION')
      AND e.employee_id NOT IN (SELECT employee_id FROM payrolls WHERE salary_period = p_period);

    -- Công thực tế: Giám đốc mặc định đủ công; Excel = chuẩn − nghỉ; còn lại = tổng công quy đổi.
    ALTER TABLE tmp_payroll_work ADD COLUMN actual_days NUMERIC, ADD COLUMN payable_days NUMERIC;
    UPDATE tmp_payroll_work SET
        actual_days = CASE
            WHEN is_director_default THEN v_standard_days
            WHEN is_override THEN GREATEST(0.0, v_standard_days - (COALESCE(unpaid, 0) + COALESCE(paid, 0)))
            ELSE credit_days END;
    UPDATE tmp_payroll_work SET
        -- Phép có lương chỉ bù cho đủ công chuẩn, không tạo công vượt chuẩn (sign-off 2026-11-06 #3);
        -- công làm thực tế vẫn được vượt 26 (EXTRA_WORKDAY_SALARY, sign-off #2).
        payable_days = CASE WHEN is_director_default THEN v_standard_days
                            ELSE GREATEST(actual_days, LEAST(actual_days + COALESCE(paid, 0), v_standard_days)) END;

    -- 5. KHUNG BẢNG LƯƠNG
    INSERT INTO payrolls (
        employee_id, store_id, salary_period, standard_working_days, daily_standard_hours,
        actual_working_days, paid_leave_days, unpaid_leave_days, absent_days, unworked_hours,
        contract_salary, total_earnings, total_allowances, total_bonuses,
        total_insurance, total_deductions, gross_income, net_salary,
        payment_status, created_by
    )
    SELECT
        w.employee_id, w.store_id, p_period, v_standard_days, w.emp_daily_hours,
        w.actual_days, w.paid, w.unpaid,
        CASE WHEN w.is_director_default THEN 0.0
             ELSE GREATEST(0.0, v_standard_days - w.actual_days - w.paid - w.unpaid) END,
        ROUND(GREATEST(0.0, v_standard_days - w.payable_days) * w.emp_daily_hours, 2),
        w.contract_salary, 0, 0, 0, 0, 0, 0, 0, 'DRAFT', p_hr_user_id
    FROM tmp_payroll_work w;

    -- 6. LƯƠNG CƠ BẢN THEO CÔNG: lương HĐ / 26 × (công thực tế + phép có lương)
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'CONTRACT_SALARY', 'Lương cơ bản theo hợp đồng lao động', 'EARNING',
           CONCAT('Mức lương HĐ: ', p.contract_salary::BIGINT, ' đ | Đơn giá: ',
                  ROUND(p.contract_salary / v_standard_days, 0)::BIGINT, ' đ/công (', v_standard_days::INT, ' công chuẩn)'),
           p.contract_salary
    FROM payrolls p
    WHERE p.salary_period = p_period AND p.payment_status = 'DRAFT';

    -- Thiếu công -> khấu trừ phần chênh lệch (không còn trừ theo phút đi trễ).
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'BASE_SALARY_DEDUCTION', 'Khấu trừ lương cơ bản do thiếu công', 'DEDUCTION',
           CONCAT('Công hưởng lương: ', trim_scale(w.payable_days), '/', v_standard_days::INT,
                  ' (', trim_scale(w.actual_days), ' công làm', CASE WHEN w.paid > 0 THEN CONCAT(' + ', trim_scale(w.paid), ' phép') ELSE '' END,
                  ') | Thiếu ', trim_scale(v_standard_days - w.payable_days), ' công × ',
                  ROUND(p.contract_salary / v_standard_days, 0)::BIGINT, ' đ'),
           p.contract_salary - ROUND(p.contract_salary / v_standard_days * w.payable_days, 0)
    FROM payrolls p JOIN tmp_payroll_work w USING (employee_id)
    WHERE p.salary_period = p_period AND p.payment_status = 'DRAFT' AND w.payable_days < v_standard_days
      AND p.contract_salary - ROUND(p.contract_salary / v_standard_days * w.payable_days, 0) > 0;

    -- Vượt công chuẩn (VD 27/26) -> cho phép lương CB vượt mức HĐ.
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'EXTRA_WORKDAY_SALARY', 'Lương công vượt chuẩn', 'EARNING',
           CONCAT(trim_scale(w.payable_days - v_standard_days), ' công vượt × ',
                  ROUND(p.contract_salary / v_standard_days, 0)::BIGINT, ' đ (', trim_scale(w.payable_days), '/', v_standard_days::INT, ' công)'),
           ROUND(p.contract_salary / v_standard_days * w.payable_days, 0) - p.contract_salary
    FROM payrolls p JOIN tmp_payroll_work w USING (employee_id)
    WHERE p.salary_period = p_period AND p.payment_status = 'DRAFT' AND w.payable_days > v_standard_days;

    -- 7. TIỀN LÀM THÊM GIỜ (VERIFIED_ONLY): đơn OT HR đã đối soát VERIFIED + OT tự động ca Full;
    --    giờ ngoài ca thô không tính; tách giờ đêm 22:00–08:00 x2.0
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT
        p.payroll_id, 'OVERTIME', 'Tiền làm thêm giờ (Tăng ca OT)', 'EARNING',
        CONCAT(
            'Lương 1h: ', ROUND(p.contract_salary / v_standard_days / p.daily_standard_hours, 0)::BIGINT, 'đ | ',
            CASE WHEN ot.normal_h > 0 THEN CONCAT('Thường: ', ROUND(ot.normal_h, 2), 'h x ', ROUND(v_ot_rate_normal * 100, 0), '% ') ELSE '' END,
            CASE WHEN ot.night_h > 0 THEN CONCAT('Đêm: ', ROUND(ot.night_h, 2), 'h x ', ROUND(v_ot_rate_night * 100, 0), '% ') ELSE '' END,
            CASE WHEN ot.sunday_h > 0 THEN CONCAT('Chủ nhật: ', ROUND(ot.sunday_h, 2), 'h x ', ROUND(GREATEST(v_ot_rate_weekend, v_ot_rate_night) * 100, 0), '% ') ELSE '' END,
            CASE WHEN ot.holiday_h > 0 THEN CONCAT('Lễ/Tết: ', ROUND(ot.holiday_h, 2), 'h x ', ROUND(v_ot_rate_holiday * 100, 0), '%') ELSE '' END
        ),
        ROUND((p.contract_salary / v_standard_days / p.daily_standard_hours) * (
            ot.normal_h * v_ot_rate_normal + ot.night_h * v_ot_rate_night
            + ot.sunday_h * GREATEST(v_ot_rate_weekend, v_ot_rate_night) + ot.holiday_h * v_ot_rate_holiday), 0)
    FROM payrolls p
    JOIN (
        SELECT x.employee_id,
               SUM(CASE WHEN x.is_holiday OR x.is_sunday THEN 0 ELSE x.hours - x.night END) AS normal_h,
               SUM(CASE WHEN x.is_holiday OR x.is_sunday THEN 0 ELSE x.night END) AS night_h,
               SUM(CASE WHEN NOT x.is_holiday AND x.is_sunday THEN x.hours ELSE 0 END) AS sunday_h,
               SUM(CASE WHEN x.is_holiday THEN x.hours ELSE 0 END) AS holiday_h
        FROM (
            SELECT r.employee_id,
                   (h.holiday_date IS NOT NULL) AS is_holiday,
                   (EXTRACT(DOW FROM r.work_date) = 0) AS is_sunday,
                   r.hours,
                   r.night_hours AS night
            FROM public.fn_payable_ot_rows(p_period) r
            LEFT JOIN public.public_holidays h ON r.work_date = h.holiday_date
        ) x
        GROUP BY x.employee_id
    ) ot ON p.employee_id = ot.employee_id
    WHERE p.salary_period = p_period AND p.payment_status = 'DRAFT'
      AND (ot.normal_h + ot.night_h + ot.sunday_h + ot.holiday_h) > 0;

    -- 8. PHỤ CẤP
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'POSITION_ALLOWANCE', 'Phụ cấp trách nhiệm chức vụ', 'ALLOWANCE',
           CONCAT('Định mức chức danh: ', pos.position_name), COALESCE(pos.position_allowance, 0)
    FROM payrolls p
    JOIN employees e ON p.employee_id = e.employee_id
    JOIN positions pos ON e.position_id = pos.position_id
    WHERE p.salary_period = p_period AND p.payment_status = 'DRAFT' AND COALESCE(pos.position_allowance, 0) > 0;

    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'SENIORITY_ALLOWANCE', 'Phụ cấp thâm niên công tác', 'ALLOWANCE',
           CASE
               WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 5 THEN CONCAT('Thâm niên ≥ 5 năm: ', v_seniority_5y::BIGINT, ' đ')
               WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 3 THEN CONCAT('Thâm niên ≥ 3 năm: ', v_seniority_3y::BIGINT, ' đ')
               ELSE CONCAT('Thâm niên ≥ 1 năm: ', v_seniority_1y::BIGINT, ' đ')
           END,
           CASE
               WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 5 THEN v_seniority_5y
               WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 3 THEN v_seniority_3y
               ELSE v_seniority_1y
           END
    FROM payrolls p
    JOIN employees e ON p.employee_id = e.employee_id
    WHERE p.salary_period = p_period AND p.payment_status = 'DRAFT'
      AND EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 1;

    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'PROJECT_ALLOWANCE', 'Phụ cấp tham gia dự án & chiến dịch', 'ALLOWANCE',
           'Phụ cấp theo vai trò thành viên dự án đang chạy', pm.total_prj_allowance
    FROM payrolls p
    JOIN (
        SELECT pm_inner.employee_id,
               SUM(COALESCE(NULLIF(pm_inner.project_allowance, 0), pra.allowance_amount, 0)) AS total_prj_allowance
        FROM project_members pm_inner
        JOIN projects prj ON pm_inner.project_id = prj.project_id
        LEFT JOIN project_role_allowances pra
               ON pm_inner.project_id = pra.project_id AND pm_inner.project_role = pra.role_code
        WHERE pm_inner.is_active = TRUE AND prj.status IN ('IN_PROGRESS', 'ACTIVE')
          AND TO_CHAR(pm_inner.joined_date, 'YYYY-MM') <= p_period
          AND (pm_inner.left_date IS NULL OR TO_CHAR(pm_inner.left_date, 'YYYY-MM') >= p_period)
        GROUP BY pm_inner.employee_id
    ) pm ON p.employee_id = pm.employee_id
    WHERE p.salary_period = p_period AND p.payment_status = 'DRAFT' AND pm.total_prj_allowance > 0;

    -- Phụ cấp ăn trưa & đi lại: tính theo công thực tế /26 (chặn trần tùy cấu hình).
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'MEAL_ALLOWANCE', 'Phụ cấp ăn trưa & đi lại', 'ALLOWANCE',
           CONCAT(v_meal_allowance::BIGINT, ' đ ÷ ', v_standard_days::INT, ' × ',
                  trim_scale(CASE WHEN v_meal_cap THEN LEAST(w.actual_days, v_standard_days) ELSE w.actual_days END),
                  ' công thực tế', CASE WHEN v_meal_cap AND w.actual_days > v_standard_days THEN ' (chặn trần)' ELSE '' END),
           ROUND(v_meal_allowance / v_standard_days *
                 CASE WHEN v_meal_cap THEN LEAST(w.actual_days, v_standard_days) ELSE w.actual_days END, 0)
    FROM payrolls p JOIN tmp_payroll_work w USING (employee_id)
    WHERE p.salary_period = p_period AND p.payment_status = 'DRAFT' AND v_meal_allowance > 0 AND w.actual_days > 0;

    -- Phụ cấp chuyên cần lũy tiến.
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'ATTENDANCE_ALLOWANCE', 'Phụ cấp chuyên cần', 'ALLOWANCE',
           CONCAT('Trễ >', v_late_tolerance::INT, ' phút: ', w.late_days, ' lần | Công: ', trim_scale(w.actual_days), ' | ',
                  CASE WHEN w.late_days >= 3 THEN '50% (trễ 3–4 lần)' ELSE '100%' END),
           ROUND(v_attendance_allowance * CASE WHEN w.late_days >= 3 THEN 0.5 ELSE 1.0 END, 0)
    FROM payrolls p JOIN tmp_payroll_work w USING (employee_id)
    WHERE p.salary_period = p_period AND p.payment_status = 'DRAFT' AND v_attendance_allowance > 0
      AND w.actual_days >= v_attendance_min_days AND w.late_days < v_late_threshold;

    -- 9. THƯỞNG
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, ppb.bonus_code, ppb.bonus_name, 'BONUS',
        CASE
            WHEN ppb.calculation_type = 'COEFFICIENT' THEN
                CONCAT(ppb.base_amount::BIGINT, ' VNĐ cơ sở * Hệ số (', COALESCE(pos.position_coefficient, 1.00), ')')
            WHEN ppb.calculation_type = 'CONTRACT_SALARY' THEN 'Thưởng 1 tháng lương cơ bản theo HĐLĐ'
            ELSE CONCAT('Mức thưởng cố định: ', ppb.base_amount::BIGINT, ' VNĐ')
        END,
        ROUND(CASE
                WHEN ppb.calculation_type = 'COEFFICIENT' THEN ppb.base_amount * COALESCE(pos.position_coefficient, 1.00)
                WHEN ppb.calculation_type = 'CONTRACT_SALARY' THEN p.contract_salary
                ELSE ppb.base_amount
              END, 0)
    FROM payrolls p
    JOIN employees e ON p.employee_id = e.employee_id
    JOIN positions pos ON e.position_id = pos.position_id
    JOIN payroll_period_bonuses ppb ON ppb.salary_period = p_period AND ppb.is_active = TRUE
    WHERE p.salary_period = p_period AND p.payment_status = 'DRAFT';

    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'PRODUCTIVITY_BONUS', 'Thưởng năng suất hoàn thành vượt KPI', 'BONUS',
           'Thưởng nóng đạt/vượt định mức KPI doanh số', comm.kpi_bonus_amount
    FROM payrolls p
    JOIN commissions comm ON p.employee_id = comm.employee_id AND comm.salary_period = p_period
    WHERE p.salary_period = p_period AND p.payment_status = 'DRAFT' AND COALESCE(comm.kpi_bonus_amount, 0) > 0;

    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'COMMISSION', 'Hoa hồng bán lẻ thiết bị công nghệ', 'BONUS',
           '1% Điện thoại & Laptop + 3% Phụ kiện', comm.commission_amount
    FROM payrolls p
    JOIN commissions comm ON p.employee_id = comm.employee_id AND comm.salary_period = p_period
    WHERE p.salary_period = p_period AND p.payment_status = 'DRAFT' AND COALESCE(comm.commission_amount, 0) > 0;

    -- 10. BẢO HIỂM BẮT BUỘC
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'BHXH', CONCAT('Bảo hiểm Xã hội (BHXH ', ROUND(v_bhxh_rate * 100, 2), '%)'), 'DEDUCTION',
           CONCAT(ROUND(v_bhxh_rate * 100, 2), '% * Lương đóng bảo hiểm'),
           ROUND(COALESCE(c.insurance_salary, c.basic_salary, 5000000) * v_bhxh_rate, 0)
    FROM payrolls p LEFT JOIN contracts c ON p.employee_id = c.employee_id AND c.status = 'ACTIVE'
    WHERE p.salary_period = p_period AND p.payment_status = 'DRAFT' AND v_bhxh_rate > 0;

    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'BHYT', CONCAT('Bảo hiểm Y tế (BHYT ', ROUND(v_bhyt_rate * 100, 2), '%)'), 'DEDUCTION',
           CONCAT(ROUND(v_bhyt_rate * 100, 2), '% * Lương đóng bảo hiểm'),
           ROUND(COALESCE(c.insurance_salary, c.basic_salary, 5000000) * v_bhyt_rate, 0)
    FROM payrolls p LEFT JOIN contracts c ON p.employee_id = c.employee_id AND c.status = 'ACTIVE'
    WHERE p.salary_period = p_period AND p.payment_status = 'DRAFT' AND v_bhyt_rate > 0;

    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'BHTN', CONCAT('Bảo hiểm Thất nghiệp (BHTN ', ROUND(v_bhtn_rate * 100, 2), '%)'), 'DEDUCTION',
           CONCAT(ROUND(v_bhtn_rate * 100, 2), '% * Lương đóng bảo hiểm'),
           ROUND(COALESCE(c.insurance_salary, c.basic_salary, 5000000) * v_bhtn_rate, 0)
    FROM payrolls p LEFT JOIN contracts c ON p.employee_id = c.employee_id AND c.status = 'ACTIVE'
    WHERE p.salary_period = p_period AND p.payment_status = 'DRAFT' AND v_bhtn_rate > 0;

    -- 11. ĐÃ BÃI BỎ khoản PENALTY (phạt tiền đi trễ). Vi phạm chỉ ảnh hưởng chuyên cần & biên bản.

    -- 12. KHOẢN BỔ SUNG TỪ EXCEL IMPORT
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, x.code, x.name, x.type, COALESCE(ov.note, 'Nhập từ file Excel'), x.amount
    FROM payrolls p
    JOIN public.payroll_import_overrides ov ON ov.salary_period = p_period AND ov.employee_id = p.employee_id
    CROSS JOIN LATERAL (VALUES
        ('EXTRA_COMMISSION', 'Hoa hồng ngoài POS',          'BONUS',     ov.extra_commission),
        ('EXTRA_BONUS',      'Thưởng bổ sung',              'BONUS',     ov.extra_bonus),
        ('EXTRA_ALLOWANCE',  'Phụ cấp đặc thù',             'ALLOWANCE', ov.extra_allowance),
        ('EXTRA_PENALTY',    'Khấu trừ vi phạm / bồi hoàn', 'DEDUCTION', ov.extra_penalty),
        -- Thuế TNCN do Kế toán tính bên ngoài và import (sign-off #6, Phase 1); Phase 2 mới tự tính.
        ('PIT',              'Thuế thu nhập cá nhân (TNCN)', 'DEDUCTION', ov.personal_income_tax)
    ) AS x(code, name, type, amount)
    WHERE p.salary_period = p_period AND p.payment_status = 'DRAFT' AND x.amount > 0;

    -- 13. ROLL-UP LÊN payrolls
    UPDATE payrolls p
    SET
        total_earnings = s.earnings,
        total_allowances = s.allowances,
        total_bonuses = s.bonuses,
        total_insurance = s.insurance,
        total_deductions = s.deductions,
        gross_income = s.earnings + s.allowances + s.bonuses,
        net_salary = s.earnings + s.allowances + s.bonuses - s.deductions,
        updated_at = clock_timestamp()
    FROM (
        SELECT d.payroll_id,
               GREATEST(0.0,
                   COALESCE(SUM(d.amount) FILTER (WHERE d.item_code IN ('CONTRACT_SALARY', 'EXTRA_WORKDAY_SALARY', 'OVERTIME')), 0)
                   - COALESCE(SUM(d.amount) FILTER (WHERE d.item_code = 'BASE_SALARY_DEDUCTION'), 0)) AS earnings,
               COALESCE(SUM(d.amount) FILTER (WHERE d.item_type = 'ALLOWANCE'), 0) AS allowances,
               COALESCE(SUM(d.amount) FILTER (WHERE d.item_type = 'BONUS'), 0) AS bonuses,
               COALESCE(SUM(d.amount) FILTER (WHERE d.item_code IN ('BHXH', 'BHYT', 'BHTN', 'INSURANCE')), 0) AS insurance,
               COALESCE(SUM(d.amount) FILTER (WHERE d.item_type = 'DEDUCTION' AND d.item_code <> 'BASE_SALARY_DEDUCTION'), 0) AS deductions
        FROM payroll_details d
        JOIN payrolls px ON px.payroll_id = d.payroll_id AND px.salary_period = p_period AND px.payment_status = 'DRAFT'
        GROUP BY d.payroll_id
    ) s
    WHERE p.payroll_id = s.payroll_id AND p.salary_period = p_period;
END;
$procedure$;
