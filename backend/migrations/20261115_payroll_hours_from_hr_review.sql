-- Bảng lương đọc ĐÚNG số giờ / số ngày của bảng công sau khi HR xử lý phiên (attendance_context.hr_review).
-- Quyết định: làm việc theo GIỜ, bỏ công quy đổi (0 / 0,5 / 1 công).
--
-- 1. Index biểu thức cho quyết định HR trong attendance_context (JSONB) — không tạo bảng mới.
-- 2. fn_attendance_payable_hours: giờ được tính của MỘT phiên, cùng quy tắc với summarize_work_sessions (Python):
--      chưa check-out → 0; EXCLUDED_INVALID / NEEDS_MORE_INFO → 0;
--      CONFIRMED_RAW_WORK → hr_review.credited_work_hours (giờ trong khung ca); còn lại → actual_work_hours.
-- 3. Bổ sung credited_work_hours cho các phiên CONFIRMED_RAW_WORK đã xử lý trước migration.
-- 4. payrolls.actual_work_hours: số giờ được tính dùng để trả lương.
-- 5. sp_generate_monthly_payroll: actual_working_days = số ngày có giờ được tính; giờ thiếu =
--    giờ chuẩn - giờ phép có lương - giờ được tính; khấu trừ = giờ thiếu × đơn giá giờ.
--    Không trừ thêm phút trễ/sớm (đã nằm trong giờ được tính). Nhân viên nhập Excel (payroll_import_overrides)
--    và Giám đốc giữ quy tắc cũ. Phạt đi muộn, OT, phụ cấp, bảo hiểm giữ nguyên.

BEGIN;

-- Điều kiện trước: PL/pgSQL không kiểm tra hàm phụ thuộc lúc tạo procedure, nên thiếu hàm thì
-- migration vẫn "thành công" nhưng tính lương lỗi lúc chạy. Dừng sớm với thông báo rõ ràng.
DO $$
DECLARE
    v_missing TEXT;
BEGIN
    SELECT string_agg(req.sig, ', ') INTO v_missing
    FROM (VALUES
        ('public.fn_payroll_standard_days(character varying)'),
        ('public.fn_payroll_contract(integer,date,date)'),
        ('public.fn_payroll_employee_eligible(integer,date,date)'),
        ('public.fn_employee_daily_standard_hours(integer,character varying)')
    ) AS req(sig)
    WHERE to_regprocedure(req.sig) IS NULL;
    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'Thiếu hàm: %. Áp các migration trước (20261103_payroll_excel_import, 20261104_director_exception_contract_hours_and_payslip_breakdown, 20261106_payroll_eligibility_by_period) rồi chạy lại.', v_missing;
    END IF;
    IF to_regclass('public.payroll_import_overrides') IS NULL
       OR to_regclass('public.attendance_overtime_approvals') IS NULL
       OR to_regclass('public.v_payroll_period_working_days') IS NULL THEN
        RAISE EXCEPTION 'Thiếu bảng/view lương (payroll_import_overrides, attendance_overtime_approvals, v_payroll_period_working_days).';
    END IF;
END $$;

DROP INDEX IF EXISTS public.idx_attendances_hr_review_decision;
CREATE INDEX idx_attendances_hr_review_decision
    ON public.attendances ((attendance_context->'hr_review'->>'review_decision'), work_date);

CREATE OR REPLACE FUNCTION public.fn_attendance_payable_hours(
    p_context JSONB, p_actual_hours NUMERIC, p_check_in TIMESTAMPTZ, p_check_out TIMESTAMPTZ)
RETURNS NUMERIC
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
    SELECT CASE
        WHEN p_check_in IS NULL OR p_check_out IS NULL THEN 0.0
        WHEN COALESCE(p_context->'hr_review'->>'review_decision', '') IN ('EXCLUDED_INVALID', 'NEEDS_MORE_INFO') THEN 0.0
        WHEN p_context->'hr_review'->>'review_decision' = 'CONFIRMED_RAW_WORK'
             AND p_context->'hr_review'->>'credited_work_hours' IS NOT NULL
            THEN GREATEST(0.0, (p_context->'hr_review'->>'credited_work_hours')::NUMERIC)
        ELSE GREATEST(0.0, COALESCE(p_actual_hours, 0.0))
    END
$$;

-- Phiên "Xác nhận công loại trừ thô" xử lý trước migration: chỉ công nhận giờ nằm trong khung ca
-- (ca hiện tại của phiên, thiếu thì lấy snapshot ca lúc check-in; ca qua đêm cộng 1 ngày; giờ Việt Nam).
UPDATE public.attendances a
SET attendance_context = jsonb_set(a.attendance_context, '{hr_review}',
        (a.attendance_context->'hr_review') || jsonb_build_object(
            'raw_work_hours', x.raw_hours,
            'credited_work_hours', x.credited,
            'hr_excluded_hours', ROUND(x.raw_hours - x.credited, 2))),
    updated_at = NOW()
FROM (
    SELECT a2.attendance_id,
           GREATEST(COALESCE(a2.actual_work_hours, 0), 0) AS raw_hours,
           CASE WHEN w.win_start IS NULL OR w.win_end IS NULL THEN GREATEST(COALESCE(a2.actual_work_hours, 0), 0)
                ELSE LEAST(GREATEST(COALESCE(a2.actual_work_hours, 0), 0),
                           ROUND((GREATEST(0, EXTRACT(EPOCH FROM (LEAST(a2.check_out_time, w.win_end)
                                                                  - GREATEST(a2.check_in_time, w.win_start)))) / 3600.0)::NUMERIC, 2))
           END AS credited
    FROM public.attendances a2
    LEFT JOIN public.work_shifts sh ON sh.shift_id = a2.shift_id
    CROSS JOIN LATERAL (
        SELECT COALESCE(sh.start_time, (a2.attendance_context->'actual'->>'start_time')::TIME) AS st,
               COALESCE(sh.end_time, (a2.attendance_context->'actual'->>'end_time')::TIME) AS et
    ) t
    CROSS JOIN LATERAL (
        SELECT (a2.work_date + t.st) AT TIME ZONE 'Asia/Ho_Chi_Minh' AS win_start,
               (a2.work_date + t.et + CASE WHEN t.et <= t.st THEN INTERVAL '1 day' ELSE INTERVAL '0' END)
                   AT TIME ZONE 'Asia/Ho_Chi_Minh' AS win_end
    ) w
    WHERE a2.attendance_context->'hr_review'->>'review_decision' = 'CONFIRMED_RAW_WORK'
      AND NOT (a2.attendance_context->'hr_review' ? 'credited_work_hours')
      AND a2.check_in_time IS NOT NULL AND a2.check_out_time IS NOT NULL
) x
WHERE a.attendance_id = x.attendance_id;

-- NULL = phiếu tạo trước migration (API khi đó tính giờ trực tiếp từ bảng công).
ALTER TABLE public.payrolls ADD COLUMN IF NOT EXISTS actual_work_hours NUMERIC(6, 2);
COMMENT ON COLUMN public.payrolls.actual_work_hours IS
    'Giờ được tính lương trong kỳ (đã áp quyết định HR) — khớp CÔNG & GIỜ LÀM của bảng công tháng';

CREATE OR REPLACE PROCEDURE public.sp_generate_monthly_payroll(IN p_period character varying, IN p_hr_user_id integer)
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
    v_missing TEXT;
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

    -- Không tự bịa lương: thiếu hợp đồng trong kỳ thì dừng cả kỳ để HR xử lý.
    SELECT string_agg(e.employee_code, ', ' ORDER BY e.employee_code) INTO v_missing
    FROM employees e
    WHERE public.fn_payroll_employee_eligible(e.employee_id, v_period_date, v_period_end)
      AND NOT EXISTS (SELECT 1 FROM public.fn_payroll_contract(e.employee_id, v_period_date, v_period_end));
    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'PAYROLL_CONTRACT_MISSING: %', v_missing;
    END IF;

    -- 3. DỌN DẸP DỮ LIỆU DRAFT CŨ
    DELETE FROM payroll_details 
    WHERE payroll_id IN (
        SELECT payroll_id FROM payrolls 
        WHERE salary_period = p_period AND payment_status IN ('DRAFT', 'NEEDS_RECALCULATION')
    );

    DELETE FROM payrolls 
    WHERE salary_period = p_period AND payment_status IN ('DRAFT', 'NEEDS_RECALCULATION');

    -- 4. KHỞI TẠO BẢN GHI KHUNG TRONG payrolls (CÓ NGOẠI LỆ GIÁM ĐỐC)
    INSERT INTO payrolls (
        employee_id, store_id, salary_period, standard_working_days, daily_standard_hours,
        actual_working_days, actual_work_hours, paid_leave_days, unpaid_leave_days, absent_days, unworked_hours,
        contract_salary, total_earnings, total_allowances, total_bonuses,
        total_insurance, total_deductions, gross_income, net_salary,
        payment_status, created_by
    )
    SELECT 
        s.employee_id, s.store_id, p_period, v_standard_days, s.emp_daily_hours,
        s.actual_working_days, s.work_hours, s.paid, s.unpaid,
        -- TÁCH BẠCH NGÀY VẮNG KHÔNG PHÉP: GREATEST(0, missing_working_days - unpaid)
        GREATEST(0.0, s.missing_working_days - s.unpaid) AS absent_days,
        -- GIỜ THIẾU (tính theo giờ, đã áp quyết định HR trong attendance_context.hr_review):
        -- giờ chuẩn - giờ phép có lương - giờ được tính. Đi trễ / về sớm đã làm giảm giờ được tính
        -- nên không trừ thêm phút trễ/sớm (tránh trừ hai lần). Nhân viên nhập Excel giữ quy tắc cũ.
        ROUND(CASE
            WHEN s.director_default THEN 0.0
            WHEN s.has_override THEN s.missing_working_days * s.emp_daily_hours + s.late_early_minutes / 60.0
            ELSE GREATEST(0.0, (v_standard_days - s.paid) * s.emp_daily_hours - s.work_hours)
        END, 2),
        s.contract_salary, 0, 0, 0, 0, 0, 0, 0, 'DRAFT', p_hr_user_id
    FROM (
        SELECT 
            e.employee_id, e.store_id,
            COALESCE(ov.unpaid_leave_days,
                     GREATEST(COALESCE(att.unpaid_leave_days, 0), COALESCE(lr.unpaid_days, 0))) AS unpaid,
            COALESCE(ov.paid_leave_days,
                     GREATEST(COALESCE(att.paid_leave_days, 0), COALESCE(lr.paid_days, 0)))     AS paid,
            -- CÔNG THỰC TẾ:
            -- 1. Nếu là GIÁM ĐỐC (pos.position_code = 'DIRECTOR'): Không chấm công, mặc định 100% công chuẩn nếu không có Excel override
            -- 2. Với nhân viên nhập Excel, công thực tế = công chuẩn - (nghỉ không lương + nghỉ có lương).
            -- 3. Với nhân viên chấm công, lấy worked_days.
            CASE 
                WHEN pos.position_code = 'DIRECTOR' AND ov.employee_id IS NULL AND ov.unpaid_leave_days IS NULL AND ov.paid_leave_days IS NULL THEN
                    v_standard_days
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
                            COALESCE(wk.worked_days, 0.0) + 
                            COALESCE(ov.paid_leave_days, GREATEST(COALESCE(att.paid_leave_days, 0), COALESCE(lr.paid_days, 0)))
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
        LEFT JOIN LATERAL public.fn_payroll_contract(e.employee_id, v_period_date, v_period_end) c ON TRUE
        LEFT JOIN public.payroll_import_overrides ov 
               ON ov.salary_period = p_period AND ov.employee_id = e.employee_id
        LEFT JOIN (
            SELECT 
                a.employee_id,
                -- Phép có lương: Phép năm & Thai sản
                COUNT(CASE WHEN a.status IN ('ANNUAL_LEAVE', 'MATERNITY_LEAVE') THEN 1 END)::NUMERIC AS paid_leave_days,
                -- Phép không lương: Nghỉ không lương & Nghỉ ốm đau
                COUNT(CASE WHEN a.status IN ('UNPAID_LEAVE', 'SICK_LEAVE') THEN 1 END)::NUMERIC AS unpaid_leave_days,
                -- Miễn trừ phút trễ trong ngưỡng ân hạn
                SUM((CASE WHEN a.late_minutes > v_late_tolerance THEN a.late_minutes ELSE 0 END) + COALESCE(a.early_minutes, 0)) AS total_late_early_minutes,
                SUM(CASE WHEN a.late_minutes > v_late_tolerance THEN v_late_penalty ELSE 0 END) AS total_late_penalty
            FROM attendances a
            WHERE TO_CHAR(a.work_date, 'YYYY-MM') = p_period
            GROUP BY a.employee_id
        ) att ON e.employee_id = att.employee_id
        LEFT JOIN (
            -- NGÀY & GIỜ ĐƯỢC TÍNH: cùng quy tắc với bảng công tháng (summarize_work_sessions)
            SELECT d.employee_id,
                   COUNT(*) FILTER (WHERE d.day_hours > 0)::NUMERIC AS worked_days,
                   ROUND(SUM(d.day_hours), 2) AS work_hours
            FROM (
                SELECT a.employee_id, a.work_date,
                       SUM(public.fn_attendance_payable_hours(
                           a.attendance_context, a.actual_work_hours, a.check_in_time, a.check_out_time)) AS day_hours
                FROM attendances a
                WHERE a.work_date BETWEEN v_period_date AND v_period_end
                GROUP BY a.employee_id, a.work_date
            ) d
            GROUP BY d.employee_id
        ) wk ON e.employee_id = wk.employee_id
        LEFT JOIN (
            -- Đơn xin nghỉ đã duyệt
            SELECT 
                req.employee_id,
                COALESCE(SUM(CASE WHEN lt.is_paid = TRUE THEN 
                    (SELECT COUNT(*)::NUMERIC 
                     FROM generate_series(
                         GREATEST(req.start_date, v_period_date),
                         LEAST(req.end_date, v_period_end),
                         INTERVAL '1 day'
                     ) d WHERE EXTRACT(DOW FROM d) <> 0)
                ELSE 0 END), 0) AS paid_days,
                COALESCE(SUM(CASE WHEN lt.is_paid = FALSE THEN 
                    (SELECT COUNT(*)::NUMERIC 
                     FROM generate_series(
                         GREATEST(req.start_date, v_period_date),
                         LEAST(req.end_date, v_period_end),
                         INTERVAL '1 day'
                     ) d WHERE EXTRACT(DOW FROM d) <> 0)
                ELSE 0 END), 0) AS unpaid_days
            FROM leave_requests req
            JOIN leave_types lt ON req.leave_type_id = lt.leave_type_id
            WHERE req.status = 'HR_APPROVED'
              AND req.start_date <= v_period_end
              AND req.end_date >= v_period_date
            GROUP BY req.employee_id
        ) lr ON e.employee_id = lr.employee_id
        WHERE public.fn_payroll_employee_eligible(e.employee_id, v_period_date, v_period_end)
          AND e.employee_id NOT IN (SELECT employee_id FROM payrolls WHERE salary_period = p_period)
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
        GROUP BY a.employee_id
    ) ot ON p.employee_id = ot.employee_id
    WHERE p.salary_period = p_period
      AND ((ot.ot_normal_hours * v_ot_rate_normal) + (ot.ot_weekend_hours * v_ot_rate_weekend) + (ot.ot_holiday_hours * v_ot_rate_holiday)) > 0;

    -- 6. LƯƠNG HỢP ĐỒNG (EARNING): CÓ KÈM ĐƠN GIÁ NGÀY/GIỜ RÕ RÀNG
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'CONTRACT_SALARY', 'Lương cơ bản theo hợp đồng lao động', 'EARNING',
           CONCAT('Mức lương quy định hợp đồng: ', p.contract_salary::BIGINT, ' đ | Đơn giá: ', 
                  ROUND(p.contract_salary / v_standard_days, 0)::BIGINT, ' đ/ngày (Ca ', p.daily_standard_hours, 'h)'), 
           p.contract_salary
    FROM payrolls p
    WHERE p.salary_period = p_period;

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
                       ') × ', ROUND(p.contract_salary / v_standard_days / p.daily_standard_hours, 0)::BIGINT, ' đ/giờ')
        END,
        ROUND(p.unworked_hours * (p.contract_salary / v_standard_days / p.daily_standard_hours), 0)
    FROM payrolls p
    WHERE p.salary_period = p_period
      AND ROUND(p.unworked_hours * (p.contract_salary / v_standard_days / p.daily_standard_hours), 0) > 0;

    -- 8. CÁC KHOẢN PHỤ CẤP (ALLOWANCE)
    -- Phụ cấp chức vụ
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'POSITION_ALLOWANCE', 'Phụ cấp trách nhiệm chức vụ', 'ALLOWANCE',
           CONCAT('Định mức chức danh: ', pos.position_name), COALESCE(pos.position_allowance, 0)
    FROM payrolls p
    JOIN employees e ON p.employee_id = e.employee_id
    JOIN positions pos ON e.position_id = pos.position_id
    WHERE p.salary_period = p_period AND COALESCE(pos.position_allowance, 0) > 0;

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
    WHERE p.salary_period = p_period AND pm.total_prj_allowance > 0;

    -- Phụ cấp cơm trưa & xăng xe
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'MEAL_ALLOWANCE', 'Phụ cấp cơm trưa & xăng xe', 'ALLOWANCE',
           'Chế độ phúc lợi cố định toàn chuỗi', v_meal_allowance
    FROM payrolls p
    WHERE p.salary_period = p_period AND v_meal_allowance > 0;

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
    WHERE p.salary_period = p_period;

    -- Thưởng năng suất KPI & Hoa hồng
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'PRODUCTIVITY_BONUS', 'Thưởng năng suất hoàn thành vượt KPI', 'BONUS',
           'Thưởng nóng đạt/vượt định mức KPI doanh số', comm.kpi_bonus_amount
    FROM payrolls p
    JOIN commissions comm ON p.employee_id = comm.employee_id AND comm.salary_period = p_period
    WHERE p.salary_period = p_period AND COALESCE(comm.kpi_bonus_amount, 0) > 0;

    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'COMMISSION', 'Hoa hồng bán lẻ thiết bị công nghệ', 'BONUS',
           '1% Điện thoại & Laptop + 3% Phụ kiện', comm.commission_amount
    FROM payrolls p
    JOIN commissions comm ON p.employee_id = comm.employee_id AND comm.salary_period = p_period
    WHERE p.salary_period = p_period AND COALESCE(comm.commission_amount, 0) > 0;

    -- 10. BẢO HIỂM BẮT BUỘC (BHXH 8%, BHYT 1.5%, BHTN 1%)
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'BHXH', CONCAT('Bảo hiểm Xã hội (BHXH ', ROUND(v_bhxh_rate * 100, 2), '%)'), 'DEDUCTION',
           CONCAT(ROUND(v_bhxh_rate * 100, 2), '% * Lương đóng bảo hiểm'),
           ROUND(COALESCE(c.insurance_salary, c.basic_salary, 5000000) * v_bhxh_rate, 0)
    FROM payrolls p LEFT JOIN LATERAL public.fn_payroll_contract(p.employee_id, v_period_date, v_period_end) c ON TRUE
    WHERE p.salary_period = p_period AND v_bhxh_rate > 0;

    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'BHYT', CONCAT('Bảo hiểm Y tế (BHYT ', ROUND(v_bhyt_rate * 100, 2), '%)'), 'DEDUCTION',
           CONCAT(ROUND(v_bhyt_rate * 100, 2), '% * Lương đóng bảo hiểm'),
           ROUND(COALESCE(c.insurance_salary, c.basic_salary, 5000000) * v_bhyt_rate, 0)
    FROM payrolls p LEFT JOIN LATERAL public.fn_payroll_contract(p.employee_id, v_period_date, v_period_end) c ON TRUE
    WHERE p.salary_period = p_period AND v_bhyt_rate > 0;

    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'BHTN', CONCAT('Bảo hiểm Thất nghiệp (BHTN ', ROUND(v_bhtn_rate * 100, 2), '%)'), 'DEDUCTION',
           CONCAT(ROUND(v_bhtn_rate * 100, 2), '% * Lương đóng bảo hiểm'),
           ROUND(COALESCE(c.insurance_salary, c.basic_salary, 5000000) * v_bhtn_rate, 0)
    FROM payrolls p LEFT JOIN LATERAL public.fn_payroll_contract(p.employee_id, v_period_date, v_period_end) c ON TRUE
    WHERE p.salary_period = p_period AND v_bhtn_rate > 0;

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
        GROUP BY a.employee_id
    ) att ON p.employee_id = att.employee_id
    WHERE p.salary_period = p_period AND COALESCE(att.total_late_penalty, 0) > 0;

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
    WHERE p.salary_period = p_period AND x.amount > 0;

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
    WHERE p.salary_period = p_period;
END;
$procedure$;

COMMIT;
