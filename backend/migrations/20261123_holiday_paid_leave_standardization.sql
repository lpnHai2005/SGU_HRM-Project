-- =========================================================================
-- TECHZONE HRM - MIGRATION: HOLIDAY PAID LEAVE STANDARDIZATION
-- Migration ID: 20261123_holiday_paid_leave_standardization
-- Mô tả:
--  1. Bổ sung cột holiday_paid_days trên bảng payrolls.
--  2. Cập nhật v_payroll_period_working_days & fn_payroll_standard_days:
--     ngày công chuẩn tự động chỉ trừ Chủ nhật (không trừ ngày Lễ khỏi mẫu số),
--     bảo toàn bất biến các kỳ đã CONFIRMED / PAID qua locked_standard_days.
--  3. Sao lưu & chuyển đổi payroll_period_overrides cho kỳ chưa khóa có ngày Lễ (idempotent).
--  4. Tạo hàm fn_employee_holiday_paid_days(employee_id, period) đếm ngày Lễ hưởng nguyên lương.
--  5. Cập nhật sp_generate_monthly_payroll (3 tham số): cộng holiday_paid_days như paid_leave_days
--     và tách ngày Lễ khỏi subquery wk (công thường) để không tính trùng.
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- 1. BỔ SUNG CỘT holiday_paid_days VÀO BẢNG payrolls
-- -------------------------------------------------------------------------
ALTER TABLE public.payrolls
ADD COLUMN IF NOT EXISTS holiday_paid_days NUMERIC(5, 2) NOT NULL DEFAULT 0.00;

-- -------------------------------------------------------------------------
-- 2. CẬP NHẬT VIEW v_payroll_period_working_days & HÀM fn_payroll_standard_days
-- -------------------------------------------------------------------------
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
    COUNT(md.work_date) FILTER (WHERE md.day_of_week <> 0)::NUMERIC(4, 1) AS auto_standard_days,
    o.override_working_days AS manual_standard_days,
    cp.locked_standard_days,
    COALESCE(
        cp.locked_standard_days,
        o.override_working_days,
        COUNT(md.work_date) FILTER (WHERE md.day_of_week <> 0)
    )::NUMERIC(4, 1) AS applied_standard_days,
    (o.override_working_days IS NOT NULL) AS is_manual_override,
    (cp.locked_standard_days IS NOT NULL) AS is_locked,
    o.reason,
    o.updated_at
FROM month_days md
LEFT JOIN public.public_holidays h ON md.work_date = h.holiday_date
LEFT JOIN public.payroll_period_overrides o ON md.salary_period = o.salary_period
LEFT JOIN closed_periods cp ON md.salary_period = cp.salary_period
GROUP BY md.salary_period, md.calendar_days, o.override_working_days, o.reason, o.updated_at, cp.locked_standard_days;

COMMENT ON VIEW public.v_payroll_period_working_days IS
    'View tính toán động ngày công chuẩn 2020-2040 (chỉ trừ Chủ nhật; ngày Lễ hưởng lương tính qua holiday_paid_days). Tự động khóa bất biến nếu kỳ lương đã CONFIRMED/PAID.';

CREATE OR REPLACE FUNCTION public.fn_payroll_standard_days(p_period VARCHAR)
RETURNS NUMERIC LANGUAGE plpgsql STABLE AS $$
DECLARE v NUMERIC;
BEGIN
    SELECT applied_standard_days INTO v
    FROM public.v_payroll_period_working_days WHERE salary_period = p_period;

    IF v IS NULL THEN  -- kỳ nằm ngoài phạm vi view (2020-2040)
        SELECT COUNT(*) INTO v
        FROM generate_series(TO_DATE(p_period || '-01', 'YYYY-MM-DD'),
                             (TO_DATE(p_period || '-01', 'YYYY-MM-DD') + INTERVAL '1 month - 1 day')::DATE,
                             INTERVAL '1 day') d
        WHERE EXTRACT(DOW FROM d) <> 0;
    END IF;

    IF v IS NULL OR v <= 0 THEN v := 26.0; END IF;
    RETURN v;
END $$;

-- -------------------------------------------------------------------------
-- 3. CHUYỂN ĐỔI payroll_period_overrides CHO KỲ CHƯA KHÓA CÓ NGÀY LỄ (IDEMPOTENT)
-- -------------------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('public.payroll_period_overrides_bak_20261123') IS NULL THEN
        CREATE TABLE public.payroll_period_overrides_bak_20261123 AS
        SELECT * FROM public.payroll_period_overrides;

        UPDATE public.payroll_period_overrides o
        SET override_working_days = o.override_working_days + v.holidays_count
        FROM public.v_payroll_period_working_days v
        WHERE v.salary_period = o.salary_period
          AND v.holidays_count > 0
          AND NOT EXISTS (
              SELECT 1 FROM public.payrolls p
              WHERE p.salary_period = o.salary_period
                AND p.payment_status IN ('CONFIRMED', 'PAID')
          );

        UPDATE public.payrolls p
        SET payment_status = 'NEEDS_RECALCULATION',
            updated_at = clock_timestamp()
        WHERE p.payment_status = 'DRAFT'
          AND EXISTS (
              SELECT 1
              FROM public.payroll_period_overrides o
              JOIN public.v_payroll_period_working_days v ON v.salary_period = o.salary_period
              WHERE o.salary_period = p.salary_period
                AND v.holidays_count > 0
          );
    END IF;
END $$;

-- -------------------------------------------------------------------------
-- 4. HÀM ĐẾM NGÀY NGHỈ LỄ/TẾT HƯỞNG NGUYÊN LƯƠNG THEO NHÂN VIÊN
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_employee_holiday_paid_days(
    p_employee_id INTEGER,
    p_period VARCHAR
) RETURNS NUMERIC(5, 2)
LANGUAGE sql STABLE
AS $$
    WITH bounds AS (
        SELECT TO_DATE(p_period || '-01', 'YYYY-MM-DD') AS p_start,
               (TO_DATE(p_period || '-01', 'YYYY-MM-DD') + INTERVAL '1 month - 1 day')::DATE AS p_end
    )
    SELECT COALESCE((
        SELECT COUNT(*)::NUMERIC(5, 2)
        FROM bounds b
        CROSS JOIN public.public_holidays h
        JOIN public.employees e ON e.employee_id = p_employee_id
        WHERE h.holiday_date BETWEEN b.p_start AND b.p_end
          AND EXTRACT(DOW FROM h.holiday_date) <> 0
          -- (2) Nhân viên đang trong quan hệ lao động tại ngày Lễ
          AND h.holiday_date >= e.join_date
          AND h.holiday_date <= COALESCE(e.resignation_date, h.holiday_date)
          -- (3) Có hợp đồng hiệu lực tại từng ngày Lễ (hỗ trợ chuyển thử việc -> chính thức giữa tháng)
          AND EXISTS (
              SELECT 1
              FROM public.contracts c
              WHERE c.employee_id = p_employee_id
                AND c.status IN ('ACTIVE', 'EXPIRED', 'TERMINATED')
                AND c.start_date <= h.holiday_date
                AND COALESCE(c.termination_date, c.end_date, h.holiday_date) >= h.holiday_date
          )
          -- (4a) Loại trừ đơn nghỉ thai sản đã duyệt (nguồn SP: leave_requests)
          AND NOT EXISTS (
              SELECT 1
              FROM public.leave_requests req
              JOIN public.leave_types lt ON req.leave_type_id = lt.leave_type_id
              WHERE req.employee_id = p_employee_id
                AND req.status = 'HR_APPROVED'
                AND lt.type_code = 'THAI_SAN'
                AND h.holiday_date BETWEEN req.start_date AND req.end_date
          )
          -- (4b) Loại trừ chấm công thai sản (nguồn SP: attendances)
          AND NOT EXISTS (
              SELECT 1
              FROM public.attendances a
              WHERE a.employee_id = p_employee_id
                AND a.work_date = h.holiday_date
                AND a.status = 'MATERNITY_LEAVE'
          )
    ), 0.00);
$$;

REVOKE ALL ON FUNCTION public.fn_employee_holiday_paid_days(INTEGER, VARCHAR) FROM PUBLIC, anon, authenticated;

-- -------------------------------------------------------------------------
-- 5. CẬP NHẬT STORED PROCEDURE sp_generate_monthly_payroll (3 THAM SỐ)
-- -------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE public.sp_generate_monthly_payroll(
    IN p_period character varying,
    IN p_hr_user_id integer,
    IN p_employee_id integer DEFAULT NULL
)
LANGUAGE plpgsql
AS $procedure$
DECLARE
    v_standard_days NUMERIC(5, 2);
    v_ot_rate_normal NUMERIC(5, 2);
    v_ot_rate_weekend NUMERIC(5, 2);
    v_ot_rate_holiday NUMERIC(5, 2);
    v_late_tolerance NUMERIC(5, 2);
    v_late_penalty NUMERIC(15, 2);
    v_meal_allowance NUMERIC(15, 2);
    v_seniority_1y NUMERIC(15, 2);
    v_seniority_3y NUMERIC(15, 2);
    v_seniority_5y NUMERIC(15, 2);
    v_bhxh_rate NUMERIC(15, 4);
    v_bhyt_rate NUMERIC(15, 4);
    v_bhtn_rate NUMERIC(15, 4);
    v_total_ins_rate NUMERIC(15, 4);
    v_period_date DATE;
    v_period_end DATE;
BEGIN
    v_period_date := TO_DATE(p_period || '-01', 'YYYY-MM-DD');
    v_period_end := (v_period_date + INTERVAL '1 month - 1 day')::DATE;

    -- 1. ĐỌC THAM SỐ ĐỘNG TỪ BẢNG payroll_policy_settings
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'OVERTIME_RATE_NORMAL' AND is_active = TRUE), 1.50) INTO v_ot_rate_normal;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'OVERTIME_RATE_WEEKEND' AND is_active = TRUE), 2.00) INTO v_ot_rate_weekend;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'OVERTIME_RATE_HOLIDAY' AND is_active = TRUE), 3.00) INTO v_ot_rate_holiday;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'LATE_TOLERANCE_MINUTES' AND is_active = TRUE), 15.0) INTO v_late_tolerance;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'LATE_PENALTY_AMOUNT' AND is_active = TRUE), 50000.0) INTO v_late_penalty;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'MEAL_TRANSPORT_ALLOWANCE' AND is_active = TRUE), 1000000.0) INTO v_meal_allowance;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'SENIORITY_ALLOWANCE_1Y' AND is_active = TRUE), 500000.0) INTO v_seniority_1y;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'SENIORITY_ALLOWANCE_3Y' AND is_active = TRUE), 1000000.0) INTO v_seniority_3y;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'SENIORITY_ALLOWANCE_5Y' AND is_active = TRUE), 1500000.0) INTO v_seniority_5y;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'BHXH_EMPLOYEE_RATE' AND is_active = TRUE), 0.0800) INTO v_bhxh_rate;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'BHYT_EMPLOYEE_RATE' AND is_active = TRUE), 0.0150) INTO v_bhyt_rate;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'BHTN_EMPLOYEE_RATE' AND is_active = TRUE), 0.0100) INTO v_bhtn_rate;
    v_total_ins_rate := v_bhxh_rate + v_bhyt_rate + v_bhtn_rate;

    -- 2. XÁC ĐỊNH NGÀY CÔNG CHUẨN CỦA KỲ LƯƠNG
    v_standard_days := public.fn_payroll_standard_days(p_period);

    -- 3. DỌN DẸP DỮ LIỆU DRAFT CŨ
    DELETE FROM payroll_details
    WHERE payroll_id IN (
        SELECT payroll_id FROM payrolls
        WHERE salary_period = p_period
          AND (p_employee_id IS NULL OR employee_id = p_employee_id)
          AND payment_status IN ('DRAFT', 'NEEDS_RECALCULATION')
    );

    DELETE FROM payrolls
    WHERE salary_period = p_period
      AND (p_employee_id IS NULL OR employee_id = p_employee_id)
      AND payment_status IN ('DRAFT', 'NEEDS_RECALCULATION');

    -- 4. KHỞI TẠO BẢN GHI KHUNG TRONG payrolls (CÓ NGOẠI LỆ GIÁM ĐỐC & NGÀY LỄ HƯỞNG LƯƠNG)
    INSERT INTO payrolls (
        employee_id, store_id, salary_period, standard_working_days, daily_standard_hours,
        actual_working_days, actual_work_hours, paid_leave_days, holiday_paid_days, unpaid_leave_days, absent_days, unworked_hours,
        contract_salary, total_earnings, total_allowances, total_bonuses,
        total_insurance, total_deductions, gross_income, net_salary,
        payment_status, created_by
    )
    SELECT
        s.employee_id, s.store_id, p_period, v_standard_days, s.emp_daily_hours,
        s.actual_working_days, s.work_hours, s.paid, s.holiday_paid, s.unpaid,
        -- TÁCH BẠCH NGÀY VẮNG KHÔNG PHÉP: GREATEST(0, missing_working_days - unpaid)
        GREATEST(0.0, s.missing_working_days - s.unpaid) AS absent_days,
        -- GIỜ THIẾU (tính theo giờ, đã áp quyết định HR trong attendance_context.hr_review):
        -- giờ chuẩn - giờ phép có lương - giờ nghỉ Lễ có lương - giờ được tính.
        -- Nhân viên nhập Excel giữ quy tắc cũ.
        ROUND(CASE
            WHEN s.director_default THEN 0.0
            WHEN s.has_override THEN s.missing_working_days * s.emp_daily_hours + s.late_early_minutes / 60.0
            ELSE GREATEST(0.0, (v_standard_days - s.paid - s.holiday_paid) * s.emp_daily_hours - s.work_hours)
        END, 2),
        s.contract_salary, 0, 0, 0, 0, 0, 0, 0, 'DRAFT', p_hr_user_id
    FROM (
        SELECT
            e.employee_id, e.store_id,
            COALESCE(ov.unpaid_leave_days,
                     GREATEST(COALESCE(att.unpaid_leave_days, 0), COALESCE(lr.unpaid_days, 0))) AS unpaid,
            COALESCE(ov.paid_leave_days,
                     GREATEST(COALESCE(att.paid_leave_days, 0), COALESCE(lr.paid_days, 0)))     AS paid,
            -- NGÀY LỄ HƯỞNG NGUYÊN LƯƠNG (giữ 0 cho nhánh Excel override có ghi đè công)
            CASE
                WHEN ov.unpaid_leave_days IS NOT NULL THEN 0.00
                ELSE public.fn_employee_holiday_paid_days(e.employee_id, p_period)
            END AS holiday_paid,
            -- CÔNG THỰC TẾ:
            -- 1. Nếu là GIÁM ĐỐC (pos.position_code = 'DIRECTOR'): Không chấm công, mặc định đủ công thường = std - holiday_paid
            -- 2. Với nhân viên nhập Excel, giữ nguyên quy tắc cũ.
            -- 3. Với nhân viên chấm công, lấy worked_days (đã loại ngày Lễ để không tính trùng).
            CASE
                WHEN pos.position_code = 'DIRECTOR' AND ov.employee_id IS NULL AND ov.unpaid_leave_days IS NULL AND ov.paid_leave_days IS NULL THEN
                    GREATEST(0.0, v_standard_days - public.fn_employee_holiday_paid_days(e.employee_id, p_period))
                WHEN ov.employee_id IS NOT NULL OR ov.unpaid_leave_days IS NOT NULL OR ov.paid_leave_days IS NOT NULL THEN
                    GREATEST(0.0, v_standard_days - (COALESCE(ov.unpaid_leave_days, 0.0) + COALESCE(ov.paid_leave_days, 0.0)))
                ELSE
                    COALESCE(wk.worked_days, 0.0)
            END AS actual_working_days,
            -- NGÀY THIẾU CÔNG:
            -- Nếu là GIÁM ĐỐC và không có Excel override: missing_working_days = 0.0
            CASE
                WHEN pos.position_code = 'DIRECTOR' AND ov.employee_id IS NULL AND ov.unpaid_leave_days IS NULL AND ov.paid_leave_days IS NULL THEN
                    0.0
                ELSE
                    COALESCE(
                        ov.unpaid_leave_days,
                        GREATEST(0.0, v_standard_days - (
                            COALESCE(wk.worked_days, 0.0)
                            + COALESCE(ov.paid_leave_days, GREATEST(COALESCE(att.paid_leave_days, 0), COALESCE(lr.paid_days, 0)))
                            + CASE
                                WHEN ov.unpaid_leave_days IS NOT NULL THEN 0.00
                                ELSE public.fn_employee_holiday_paid_days(e.employee_id, p_period)
                              END
                        ))
                    )
            END AS missing_working_days,
            public.fn_employee_daily_standard_hours(e.employee_id, p_period) AS emp_daily_hours,
            COALESCE(wk.work_hours, 0.0) AS work_hours,
            (pos.position_code = 'DIRECTOR' AND ov.employee_id IS NULL) AS director_default,
            (ov.employee_id IS NOT NULL) AS has_override,
            -- Giám đốc không trừ trễ/sớm nếu không chấm công
            CASE
                WHEN pos.position_code = 'DIRECTOR' AND ov.employee_id IS NULL THEN 0.0
                ELSE COALESCE(att.total_late_early_minutes, 0)
            END AS late_early_minutes,
            c.basic_salary                             AS contract_salary
        FROM employees e
        JOIN positions pos ON e.position_id = pos.position_id
        JOIN LATERAL public.fn_payroll_contract(e.employee_id, v_period_date, v_period_end) c ON TRUE
        LEFT JOIN public.payroll_import_overrides ov
               ON ov.salary_period = p_period AND ov.employee_id = e.employee_id
        LEFT JOIN (
            SELECT
                a.employee_id,
                -- Phép có lương: Phép năm & Thai sản (chỉ đếm trên ngày làm việc thực tế, trừ Chủ nhật & Ngày lễ để không trùng holiday_paid_days)
                COUNT(CASE WHEN a.status IN ('ANNUAL_LEAVE', 'MATERNITY_LEAVE')
                           AND EXTRACT(DOW FROM a.work_date) <> 0
                           AND NOT EXISTS (SELECT 1 FROM public.public_holidays h WHERE h.holiday_date = a.work_date)
                      THEN 1 END)::NUMERIC AS paid_leave_days,
                -- Phép không lương: Nghỉ không lương & Nghỉ ốm đau (chỉ đếm trên ngày làm việc thực tế, trừ Chủ nhật & Ngày lễ)
                COUNT(CASE WHEN a.status IN ('UNPAID_LEAVE', 'SICK_LEAVE')
                           AND EXTRACT(DOW FROM a.work_date) <> 0
                           AND NOT EXISTS (SELECT 1 FROM public.public_holidays h WHERE h.holiday_date = a.work_date)
                      THEN 1 END)::NUMERIC AS unpaid_leave_days,
                -- Miễn trừ phút trễ trong ngưỡng ân hạn
                SUM((CASE WHEN a.late_minutes > v_late_tolerance THEN a.late_minutes ELSE 0 END) + COALESCE(a.early_minutes, 0)) AS total_late_early_minutes,
                SUM(CASE WHEN a.late_minutes > v_late_tolerance THEN v_late_penalty ELSE 0 END) AS total_late_penalty
            FROM attendances a
            WHERE TO_CHAR(a.work_date, 'YYYY-MM') = p_period
              AND (p_employee_id IS NULL OR a.employee_id = p_employee_id)
            GROUP BY a.employee_id
        ) att ON e.employee_id = att.employee_id
        LEFT JOIN (
            -- NGÀY & GIỜ ĐƯỢC TÍNH (công thường): tách ngày Lễ ra khỏi worked_days & work_hours để không tính trùng với holiday_paid_days
            SELECT d.employee_id,
                   COUNT(*) FILTER (WHERE d.day_hours > 0 AND NOT d.is_holiday)::NUMERIC AS worked_days,
                   ROUND(COALESCE(SUM(d.day_hours) FILTER (WHERE NOT d.is_holiday), 0), 2) AS work_hours
            FROM (
                SELECT a.employee_id, a.work_date,
                       EXISTS (SELECT 1 FROM public.public_holidays h WHERE h.holiday_date = a.work_date) AS is_holiday,
                       SUM(public.fn_attendance_payable_hours(
                           a.attendance_context, a.actual_work_hours, a.check_in_time, a.check_out_time,
                           a.late_minutes,
                           COALESCE(sh.work_hours, NULLIF(a.attendance_context->'actual'->>'work_hours', '')::NUMERIC),
                           ota.approved_hours, v_late_tolerance,
                           a.work_date,
                           COALESCE(sh.start_time, NULLIF(a.attendance_context->'actual'->>'start_time', '')::TIME),
                           COALESCE(sh.end_time, NULLIF(a.attendance_context->'actual'->>'end_time', '')::TIME),
                           COALESCE(NULLIF(a.attendance_context->'actual'->>'break_minutes', '')::INTEGER, sh.break_minutes)
                       )) AS day_hours
                FROM attendances a
                LEFT JOIN work_shifts sh ON sh.shift_id = a.shift_id
                LEFT JOIN attendance_overtime_approvals ota
                       ON ota.attendance_id = a.attendance_id AND ota.decision = 'APPROVED'
                WHERE a.work_date BETWEEN v_period_date AND v_period_end
                  AND (p_employee_id IS NULL OR a.employee_id = p_employee_id)
                GROUP BY a.employee_id, a.work_date
            ) d
            GROUP BY d.employee_id
        ) wk ON e.employee_id = wk.employee_id
        LEFT JOIN (
            -- Đơn xin nghỉ đã duyệt (chỉ đếm ngày làm việc thực tế: trừ Chủ nhật và Ngày lễ public_holidays)
            SELECT
                req.employee_id,
                COALESCE(SUM(CASE WHEN lt.is_paid = TRUE THEN
                    (SELECT COUNT(*)::NUMERIC
                     FROM generate_series(
                         GREATEST(req.start_date, v_period_date),
                         LEAST(req.end_date, v_period_end),
                         INTERVAL '1 day'
                     ) d WHERE EXTRACT(DOW FROM d) <> 0
                       AND NOT EXISTS (SELECT 1 FROM public.public_holidays h WHERE h.holiday_date = d::DATE))
                ELSE 0 END), 0) AS paid_days,
                COALESCE(SUM(CASE WHEN lt.is_paid = FALSE THEN
                    (SELECT COUNT(*)::NUMERIC
                     FROM generate_series(
                         GREATEST(req.start_date, v_period_date),
                         LEAST(req.end_date, v_period_end),
                         INTERVAL '1 day'
                     ) d WHERE EXTRACT(DOW FROM d) <> 0
                       AND NOT EXISTS (SELECT 1 FROM public.public_holidays h WHERE h.holiday_date = d::DATE))
                ELSE 0 END), 0) AS unpaid_days
            FROM leave_requests req
            JOIN leave_types lt ON req.leave_type_id = lt.leave_type_id
            WHERE req.status = 'HR_APPROVED'
              AND req.start_date <= v_period_end
              AND req.end_date >= v_period_date
              AND (p_employee_id IS NULL OR req.employee_id = p_employee_id)
            GROUP BY req.employee_id
        ) lr ON e.employee_id = lr.employee_id
        WHERE public.fn_payroll_employee_eligible(e.employee_id, v_period_date, v_period_end)
          AND (p_employee_id IS NULL OR e.employee_id = p_employee_id)
          AND e.employee_id NOT IN (
              SELECT employee_id FROM payrolls
              WHERE salary_period = p_period AND (p_employee_id IS NULL OR employee_id = p_employee_id)
          )
    ) s;

    -- 5. TÍNH TIỀN LÀM THÊM GIỜ (OT): ĐƠN GIÁ THEO ĐỊNH MỨC GIỜ CỦA NHÂN SỰ
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT
        p.payroll_id,
        'OVERTIME',
        'Tiền làm thêm giờ (Tăng ca OT)',
        'EARNING',
        CONCAT(
            'Lương 1h: ', ROUND(p.contract_salary / v_standard_days / p.daily_standard_hours, 0)::BIGINT, 'đ (Ca ', p.daily_standard_hours, 'h) | ',
            CASE WHEN ot.ot_normal_hours > 0 THEN CONCAT('Thường: ', ROUND(ot.ot_normal_hours, 2), 'h x ', ROUND(v_ot_rate_normal * 100, 0), '% ') ELSE '' END,
            CASE WHEN ot.ot_weekend_hours > 0 THEN CONCAT('Chủ nhật: ', ROUND(ot.ot_weekend_hours, 2), 'h x ', ROUND(v_ot_rate_weekend * 100, 0), '% ') ELSE '' END,
            CASE WHEN ot.ot_holiday_hours > 0 THEN CONCAT('Lễ/Tết: ', ROUND(ot.ot_holiday_hours, 2), 'h x ', ROUND(v_ot_rate_holiday * 100, 0), '%') ELSE '' END
        ),
        ROUND(
            (p.contract_salary / v_standard_days / p.daily_standard_hours) * (
                (COALESCE(ot.ot_normal_hours, 0) * v_ot_rate_normal) +
                (COALESCE(ot.ot_weekend_hours, 0) * v_ot_rate_weekend) +
                (COALESCE(ot.ot_holiday_hours, 0) * v_ot_rate_holiday)
            ),
            0
        )
    FROM payrolls p
    JOIN (
        SELECT
            a.employee_id,
            SUM(CASE
                WHEN h.holiday_date IS NOT NULL THEN 0
                WHEN EXTRACT(DOW FROM a.work_date) = 0 THEN 0
                ELSE COALESCE(ota.approved_hours, 0)
            END) AS ot_normal_hours,
            SUM(CASE
                WHEN h.holiday_date IS NOT NULL THEN 0
                WHEN EXTRACT(DOW FROM a.work_date) = 0 THEN COALESCE(ota.approved_hours, 0)
                ELSE 0
            END) AS ot_weekend_hours,
            SUM(CASE
                WHEN h.holiday_date IS NOT NULL THEN COALESCE(ota.approved_hours, 0)
                ELSE 0
            END) AS ot_holiday_hours
        FROM attendances a
        JOIN attendance_overtime_approvals ota ON a.attendance_id = ota.attendance_id AND ota.decision = 'APPROVED'
        LEFT JOIN public.public_holidays h ON a.work_date = h.holiday_date
        WHERE TO_CHAR(a.work_date, 'YYYY-MM') = p_period
          AND (p_employee_id IS NULL OR a.employee_id = p_employee_id)
        GROUP BY a.employee_id
    ) ot ON p.employee_id = ot.employee_id
    WHERE p.salary_period = p_period
      AND (p_employee_id IS NULL OR p.employee_id = p_employee_id)
      AND ((ot.ot_normal_hours * v_ot_rate_normal) + (ot.ot_weekend_hours * v_ot_rate_weekend) + (ot.ot_holiday_hours * v_ot_rate_holiday)) > 0;

    -- 6. LƯƠNG HỢP ĐỒNG (EARNING): CÓ KÈM ĐƠN GIÁ NGÀY/GIỜ RÕ RÀNG
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'CONTRACT_SALARY', 'Lương cơ bản theo hợp đồng lao động', 'EARNING',
           CONCAT('Mức lương quy định hợp đồng: ', p.contract_salary::BIGINT, ' đ | Đơn giá: ',
                  ROUND(p.contract_salary / v_standard_days, 0)::BIGINT, ' đ/ngày (Ca ', p.daily_standard_hours, 'h)'),
           p.contract_salary
    FROM payrolls p
    WHERE p.salary_period = p_period
      AND (p_employee_id IS NULL OR p.employee_id = p_employee_id);

    -- 7. KHẤU TRỪ LƯƠNG CƠ BẢN THEO GIỜ THIẾU (đã áp quyết định HR)
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT
        p.payroll_id,
        'BASE_SALARY_DEDUCTION',
        'Khấu trừ lương cơ bản dựa vào thời gian',
        'DEDUCTION',
        CASE
            WHEN EXISTS (SELECT 1 FROM public.payroll_import_overrides ov
                         WHERE ov.salary_period = p_period AND ov.employee_id = p.employee_id) THEN
                CONCAT('Khấu trừ theo dữ liệu Excel: thiếu ', p.unworked_hours, 'h × ',
                       ROUND(p.contract_salary / v_standard_days / p.daily_standard_hours, 0)::BIGINT, ' đ/giờ')
            ELSE
                CONCAT('Thiếu ', p.unworked_hours, 'h / chuẩn ', ROUND(v_standard_days * p.daily_standard_hours, 2),
                       'h (thực tế ', p.actual_work_hours, 'h',
                       CASE WHEN p.paid_leave_days > 0 THEN CONCAT(' + phép có lương ', p.paid_leave_days, ' ngày') ELSE '' END,
                       CASE WHEN p.holiday_paid_days > 0 THEN CONCAT(' + nghỉ Lễ ', p.holiday_paid_days, ' ngày') ELSE '' END,
                       ') × ', ROUND(p.contract_salary / v_standard_days / p.daily_standard_hours, 0)::BIGINT, ' đ/giờ')
        END,
        ROUND(p.unworked_hours * (p.contract_salary / v_standard_days / p.daily_standard_hours), 0)
    FROM payrolls p
    WHERE p.salary_period = p_period
      AND (p_employee_id IS NULL OR p.employee_id = p_employee_id)
      AND ROUND(p.unworked_hours * (p.contract_salary / v_standard_days / p.daily_standard_hours), 0) > 0;

    -- 8. CÁC KHOẢN PHỤ CẤP (ALLOWANCE)
    -- Phụ cấp chức vụ
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'POSITION_ALLOWANCE', 'Phụ cấp trách nhiệm chức vụ', 'ALLOWANCE',
           CONCAT('Định mức chức danh: ', pos.position_name), COALESCE(pos.position_allowance, 0)
    FROM payrolls p
    JOIN employees e ON p.employee_id = e.employee_id
    JOIN positions pos ON e.position_id = pos.position_id
    WHERE p.salary_period = p_period
      AND (p_employee_id IS NULL OR p.employee_id = p_employee_id)
      AND COALESCE(pos.position_allowance, 0) > 0;

    -- Phụ cấp thâm niên
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'SENIORITY_ALLOWANCE', 'Phụ cấp thâm niên công tác', 'ALLOWANCE',
           CASE
               WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 5 THEN CONCAT('Thâm niên ≥ 5 năm: ', v_seniority_5y::BIGINT, ' đ')
               WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 3 THEN CONCAT('Thâm niên ≥ 3 năm: ', v_seniority_3y::BIGINT, ' đ')
               WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 1 THEN CONCAT('Thâm niên ≥ 1 năm: ', v_seniority_1y::BIGINT, ' đ')
               ELSE 'Dưới 1 năm công tác'
           END,
           CASE
               WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 5 THEN v_seniority_5y
               WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 3 THEN v_seniority_3y
               WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 1 THEN v_seniority_1y
               ELSE 0
           END
    FROM payrolls p
    JOIN employees e ON p.employee_id = e.employee_id
    WHERE p.salary_period = p_period
      AND (p_employee_id IS NULL OR p.employee_id = p_employee_id)
      AND (CASE
               WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 5 THEN v_seniority_5y
               WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 3 THEN v_seniority_3y
               WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 1 THEN v_seniority_1y
               ELSE 0
           END) > 0;

    -- Phụ cấp dự án
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
    WHERE p.salary_period = p_period
      AND (p_employee_id IS NULL OR p.employee_id = p_employee_id)
      AND pm.total_prj_allowance > 0;

    -- Phụ cấp cơm trưa & xăng xe
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'MEAL_ALLOWANCE', 'Phụ cấp cơm trưa & xăng xe', 'ALLOWANCE',
           'Chế độ phúc lợi cố định toàn chuỗi', v_meal_allowance
    FROM payrolls p
    WHERE p.salary_period = p_period
      AND (p_employee_id IS NULL OR p.employee_id = p_employee_id)
      AND v_meal_allowance > 0;

    -- 9. CÁC KHOẢN THƯỞNG (BONUS)
    -- Thưởng sự kiện / Lễ Tết
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, ppb.bonus_code, ppb.bonus_name, 'BONUS',
        CASE
            WHEN ppb.calculation_type = 'COEFFICIENT' THEN
                CONCAT(ppb.base_amount::BIGINT, ' VNĐ cơ sở * Hệ số (', COALESCE(pos.position_coefficient, 1.00), ')')
            WHEN ppb.calculation_type = 'CONTRACT_SALARY' THEN
                'Thưởng 1 tháng lương cơ bản theo HĐLĐ'
            ELSE
                CONCAT('Mức thưởng cố định: ', ppb.base_amount::BIGINT, ' VNĐ')
        END,
        ROUND(
            CASE
                WHEN ppb.calculation_type = 'COEFFICIENT' THEN ppb.base_amount * COALESCE(pos.position_coefficient, 1.00)
                WHEN ppb.calculation_type = 'CONTRACT_SALARY' THEN p.contract_salary
                ELSE ppb.base_amount
            END, 0
        )
    FROM payrolls p
    JOIN employees e ON p.employee_id = e.employee_id
    JOIN positions pos ON e.position_id = pos.position_id
    JOIN payroll_period_bonuses ppb ON ppb.salary_period = p_period AND ppb.is_active = TRUE
    WHERE p.salary_period = p_period
      AND (p_employee_id IS NULL OR p.employee_id = p_employee_id);

    -- Thưởng năng suất KPI & Hoa hồng
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'PRODUCTIVITY_BONUS', 'Thưởng năng suất hoàn thành vượt KPI', 'BONUS',
           'Thưởng nóng đạt/vượt định mức KPI doanh số', comm.kpi_bonus_amount
    FROM payrolls p
    JOIN commissions comm ON p.employee_id = comm.employee_id AND comm.salary_period = p_period
    WHERE p.salary_period = p_period
      AND (p_employee_id IS NULL OR p.employee_id = p_employee_id)
      AND COALESCE(comm.kpi_bonus_amount, 0) > 0;

    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'COMMISSION', 'Hoa hồng bán lẻ thiết bị công nghệ', 'BONUS',
           '1% Điện thoại & Laptop + 3% Phụ kiện', comm.commission_amount
    FROM payrolls p
    JOIN commissions comm ON p.employee_id = comm.employee_id AND comm.salary_period = p_period
    WHERE p.salary_period = p_period
      AND (p_employee_id IS NULL OR p.employee_id = p_employee_id)
      AND COALESCE(comm.commission_amount, 0) > 0;

    -- 10. BẢO HIỂM BẮT BUỘC (BHXH 8%, BHYT 1.5%, BHTN 1%)
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'BHXH', CONCAT('Bảo hiểm Xã hội (BHXH ', ROUND(v_bhxh_rate * 100, 2), '%)'), 'DEDUCTION',
           CONCAT(ROUND(v_bhxh_rate * 100, 2), '% * Lương đóng bảo hiểm'),
           ROUND(COALESCE(c.insurance_salary, c.basic_salary, 5000000) * v_bhxh_rate, 0)
    FROM payrolls p LEFT JOIN LATERAL public.fn_payroll_contract(p.employee_id, v_period_date, v_period_end) c ON TRUE
    WHERE p.salary_period = p_period
      AND (p_employee_id IS NULL OR p.employee_id = p_employee_id)
      AND v_bhxh_rate > 0;

    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'BHYT', CONCAT('Bảo hiểm Y tế (BHYT ', ROUND(v_bhyt_rate * 100, 2), '%)'), 'DEDUCTION',
           CONCAT(ROUND(v_bhyt_rate * 100, 2), '% * Lương đóng bảo hiểm'),
           ROUND(COALESCE(c.insurance_salary, c.basic_salary, 5000000) * v_bhyt_rate, 0)
    FROM payrolls p LEFT JOIN LATERAL public.fn_payroll_contract(p.employee_id, v_period_date, v_period_end) c ON TRUE
    WHERE p.salary_period = p_period
      AND (p_employee_id IS NULL OR p.employee_id = p_employee_id)
      AND v_bhyt_rate > 0;

    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'BHTN', CONCAT('Bảo hiểm Thất nghiệp (BHTN ', ROUND(v_bhtn_rate * 100, 2), '%)'), 'DEDUCTION',
           CONCAT(ROUND(v_bhtn_rate * 100, 2), '% * Lương đóng bảo hiểm'),
           ROUND(COALESCE(c.insurance_salary, c.basic_salary, 5000000) * v_bhtn_rate, 0)
    FROM payrolls p LEFT JOIN LATERAL public.fn_payroll_contract(p.employee_id, v_period_date, v_period_end) c ON TRUE
    WHERE p.salary_period = p_period
      AND (p_employee_id IS NULL OR p.employee_id = p_employee_id)
      AND v_bhtn_rate > 0;

    -- 11. PHẠT VI PHẠM QUY CHẾ CHẤM CÔNG
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'PENALTY',
           CONCAT('Phạt vi phạm quy chế chấm công (Đi muộn > ', v_late_tolerance::INT, ' phút)'),
           'DEDUCTION',
           CONCAT(v_late_penalty::BIGINT, ' VNĐ / lần đi muộn quá hạn'),
           att.total_late_penalty
    FROM payrolls p
    JOIN (
        SELECT a.employee_id, SUM(CASE WHEN a.late_minutes > v_late_tolerance THEN v_late_penalty ELSE 0 END) AS total_late_penalty
        FROM attendances a
        WHERE TO_CHAR(a.work_date, 'YYYY-MM') = p_period
          AND (p_employee_id IS NULL OR a.employee_id = p_employee_id)
        GROUP BY a.employee_id
    ) att ON p.employee_id = att.employee_id
    WHERE p.salary_period = p_period
      AND (p_employee_id IS NULL OR p.employee_id = p_employee_id)
      AND COALESCE(att.total_late_penalty, 0) > 0;

    -- 12. CÁC KHOẢN BỔ SUNG & KHẤU TRỪ TỪ EXCEL IMPORT OVERRIDES
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, x.code, x.name, x.type, COALESCE(ov.note, 'Nhập từ file Excel'), x.amount
    FROM payrolls p
    JOIN public.payroll_import_overrides ov ON ov.salary_period = p_period AND ov.employee_id = p.employee_id
    CROSS JOIN LATERAL (VALUES
        ('EXTRA_COMMISSION', 'Hoa hồng ngoài POS',          'BONUS',     ov.extra_commission),
        ('EXTRA_BONUS',      'Thưởng bổ sung',              'BONUS',     ov.extra_bonus),
        ('EXTRA_ALLOWANCE',  'Phụ cấp đặc thù',             'ALLOWANCE', ov.extra_allowance),
        ('EXTRA_PENALTY',    'Khấu trừ vi phạm / bồi hoàn', 'DEDUCTION', ov.extra_penalty)
    ) AS x(code, name, type, amount)
    WHERE p.salary_period = p_period
      AND (p_employee_id IS NULL OR p.employee_id = p_employee_id)
      AND x.amount > 0;

    -- 13. BOTTOM-UP ROLL-UP LÊN BẢNG payrolls
    UPDATE payrolls p
    SET
        total_earnings = GREATEST(0.0,
            COALESCE((SELECT amount FROM payroll_details WHERE payroll_id = p.payroll_id AND item_code = 'CONTRACT_SALARY'), 0)
            - COALESCE((SELECT amount FROM payroll_details WHERE payroll_id = p.payroll_id AND item_code = 'BASE_SALARY_DEDUCTION'), 0)
            + COALESCE((SELECT amount FROM payroll_details WHERE payroll_id = p.payroll_id AND item_code = 'OVERTIME'), 0)
        ),
        total_allowances = COALESCE((
            SELECT SUM(amount) FROM payroll_details
            WHERE payroll_id = p.payroll_id AND item_type = 'ALLOWANCE'
        ), 0),
        total_bonuses = COALESCE((
            SELECT SUM(amount) FROM payroll_details
            WHERE payroll_id = p.payroll_id AND item_type = 'BONUS'
        ), 0),
        total_insurance = COALESCE((
            SELECT SUM(amount) FROM payroll_details
            WHERE payroll_id = p.payroll_id AND item_code IN ('BHXH', 'BHYT', 'BHTN', 'INSURANCE')
        ), 0),
        total_deductions = COALESCE((
            SELECT SUM(amount) FROM payroll_details
            WHERE payroll_id = p.payroll_id AND item_type = 'DEDUCTION' AND item_code != 'BASE_SALARY_DEDUCTION'
        ), 0),
        gross_income = (
            GREATEST(0.0,
                COALESCE((SELECT amount FROM payroll_details WHERE payroll_id = p.payroll_id AND item_code = 'CONTRACT_SALARY'), 0)
                - COALESCE((SELECT amount FROM payroll_details WHERE payroll_id = p.payroll_id AND item_code = 'BASE_SALARY_DEDUCTION'), 0)
                + COALESCE((SELECT amount FROM payroll_details WHERE payroll_id = p.payroll_id AND item_code = 'OVERTIME'), 0)
            )
            + COALESCE((SELECT SUM(amount) FROM payroll_details WHERE payroll_id = p.payroll_id AND item_type = 'ALLOWANCE'), 0)
            + COALESCE((SELECT SUM(amount) FROM payroll_details WHERE payroll_id = p.payroll_id AND item_type = 'BONUS'), 0)
        ),
        net_salary = (
            GREATEST(0.0,
                COALESCE((SELECT amount FROM payroll_details WHERE payroll_id = p.payroll_id AND item_code = 'CONTRACT_SALARY'), 0)
                - COALESCE((SELECT amount FROM payroll_details WHERE payroll_id = p.payroll_id AND item_code = 'BASE_SALARY_DEDUCTION'), 0)
                + COALESCE((SELECT amount FROM payroll_details WHERE payroll_id = p.payroll_id AND item_code = 'OVERTIME'), 0)
            )
            + COALESCE((SELECT SUM(amount) FROM payroll_details WHERE payroll_id = p.payroll_id AND item_type = 'ALLOWANCE'), 0)
            + COALESCE((SELECT SUM(amount) FROM payroll_details WHERE payroll_id = p.payroll_id AND item_type = 'BONUS'), 0)
            - COALESCE((SELECT SUM(amount) FROM payroll_details WHERE payroll_id = p.payroll_id AND item_type = 'DEDUCTION' AND item_code != 'BASE_SALARY_DEDUCTION'), 0)
        ),
        updated_at = clock_timestamp()
    WHERE p.salary_period = p_period
      AND (p_employee_id IS NULL OR p.employee_id = p_employee_id);
END;
$procedure$;

REVOKE ALL ON PROCEDURE public.sp_generate_monthly_payroll(character varying, integer, integer) FROM PUBLIC, anon, authenticated;

COMMIT;
