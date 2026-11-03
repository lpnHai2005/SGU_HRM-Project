-- =========================================================================
-- MIGRATION: 20261104_standardize_payroll_shift_hours_and_unpaid_deductions.sql
-- Mô tả:
-- 1. Bổ sung cột daily_standard_hours và absent_days vào bảng payrolls.
-- 2. Thêm hàm fn_employee_daily_standard_hours xác định định mức giờ ca của từng nhân viên.
-- 3. Cập nhật Trigger fn_sync_ot_reconciliation_to_approvals: gán giờ vào phiên cuối, tránh nhân đôi.
-- 4. Cập nhật sp_generate_monthly_payroll:
--    - Tương thích 100% tính năng Excel Import (COALESCE ov.unpaid_leave_days) & sửa lỗi hiển thị "Công thực tế: 0/26".
--    - Tách bạch rõ ràng unpaid_leave_days (có phép) và absent_days (vắng không phép).
--    - Xử lý chuẩn nghỉ ốm đau (trừ lương) và thai sản (hưởng chế độ).
--    - Xử lý đơn nghỉ xuyên tháng chính xác bằng giao thoa ngày.
--    - Tính lương 1 giờ và tiền OT theo đúng định mức giờ ca của từng người.
--    - Giữ nguyên tên khoản phạt "Phạt vi phạm quy chế chấm công".
-- =========================================================================

-- 1. BỔ SUNG CỘT daily_standard_hours VÀ absent_days VÀO BẢNG payrolls
ALTER TABLE public.payrolls 
ADD COLUMN IF NOT EXISTS daily_standard_hours NUMERIC(4, 2) DEFAULT 8.00,
ADD COLUMN IF NOT EXISTS absent_days NUMERIC(5, 2) DEFAULT 0.00;


-- 2. HÀM XÁC ĐỊNH ĐỊNH MỨC GIỜ CHUẨN MỖI NGÀY CỦA TỪNG NHÂN VIÊN
CREATE OR REPLACE FUNCTION public.fn_employee_daily_standard_hours(
    p_employee_id INTEGER,
    p_period VARCHAR
)
RETURNS NUMERIC(4, 2)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_hours NUMERIC(4, 2);
    v_start_date DATE;
    v_end_date DATE;
BEGIN
    v_start_date := TO_DATE(p_period || '-01', 'YYYY-MM-DD');
    v_end_date := (v_start_date + INTERVAL '1 month - 1 day')::DATE;

    -- Ưu tiên 1: Tính trung bình định mức giờ của các ca được phân công trong tháng
    SELECT ROUND(AVG(sh.work_hours), 2) INTO v_hours
    FROM public.work_schedules ws
    JOIN public.work_shifts sh ON ws.shift_id = sh.shift_id
    WHERE ws.employee_id = p_employee_id
      AND ws.work_date >= v_start_date AND ws.work_date <= v_end_date
      AND ws.cancelled_at IS NULL
      AND sh.work_hours > 0;

    -- Ưu tiên 2: Nếu chưa xếp lịch ca, lấy theo hợp đồng lao động đang hoạt động (working_hours_per_week / 6 ngày)
    IF v_hours IS NULL OR v_hours <= 0 THEN
        SELECT ROUND(COALESCE(c.working_hours_per_week, 48.0) / 6.0, 2) INTO v_hours
        FROM public.contracts c
        WHERE c.employee_id = p_employee_id AND c.status = 'ACTIVE'
        ORDER BY c.start_date DESC LIMIT 1;
    END IF;

    -- Ưu tiên 3: Mặc định chuẩn 8.0 giờ nếu không có thông tin
    IF v_hours IS NULL OR v_hours <= 0 THEN
        v_hours := 8.00;
    END IF;

    RETURN v_hours;
END;
$$;


-- 3. CẬP NHẬT TRIGGER ĐỒNG BỘ OT: GÁN TRỌN VẸN VÀO PHIÊN CUỐI CÙNG, TRÁNH LỆCH LÀM TRÒN & NHÂN ĐÔI
CREATE OR REPLACE FUNCTION public.fn_sync_ot_reconciliation_to_approvals()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $func$
DECLARE
    att_id_val TEXT;
    att_id BIGINT;
    target_att_id BIGINT;
    v_total_hours NUMERIC(5, 2);
BEGIN
    IF NEW.status = 'VERIFIED' AND COALESCE(NEW.verified_microseconds, 0) > 0 THEN
        v_total_hours := ROUND(NEW.verified_microseconds / 3600000000.0, 2);
        
        IF NEW.attendance_ids IS NOT NULL AND jsonb_array_length(NEW.attendance_ids) > 0 THEN
            -- Xác định phiên làm việc cuối cùng (max ID) để nhận toàn bộ số giờ làm thêm
            SELECT (val)::BIGINT INTO target_att_id
            FROM jsonb_array_elements_text(NEW.attendance_ids) val
            ORDER BY (val)::BIGINT DESC
            LIMIT 1;

            FOR att_id_val IN SELECT jsonb_array_elements_text(NEW.attendance_ids) LOOP
                att_id := att_id_val::BIGINT;

                IF att_id = target_att_id THEN
                    -- Phiên chính nhận toàn bộ giờ OT đã duyệt
                    UPDATE public.attendances
                    SET overtime_hours = GREATEST(COALESCE(overtime_hours, 0), v_total_hours),
                        updated_at = clock_timestamp()
                    WHERE attendance_id = att_id;

                    INSERT INTO public.attendance_overtime_approvals (
                        attendance_id, approved_hours, decision, reviewer_user_id, reason, updated_at
                    )
                    VALUES (
                        att_id, 
                        v_total_hours, 
                        'APPROVED', 
                        NEW.reviewed_by, 
                        COALESCE(NEW.decision_reason, CONCAT('Đối soát OT Request #', NEW.request_id, ' (VERIFIED)')),
                        clock_timestamp()
                    )
                    ON CONFLICT (attendance_id) DO UPDATE SET
                        approved_hours = EXCLUDED.approved_hours,
                        decision = EXCLUDED.decision,
                        reviewer_user_id = EXCLUDED.reviewer_user_id,
                        reason = EXCLUDED.reason,
                        updated_at = clock_timestamp();
                ELSE
                    -- Các phiên phụ trong cùng ngày không gán trùng giờ OT
                    INSERT INTO public.attendance_overtime_approvals (
                        attendance_id, approved_hours, decision, reviewer_user_id, reason, updated_at
                    )
                    VALUES (
                        att_id, 
                        0, 
                        'APPROVED', 
                        NEW.reviewed_by, 
                        CONCAT('Giờ OT đã được gộp đối soát vào phiên #', target_att_id),
                        clock_timestamp()
                    )
                    ON CONFLICT (attendance_id) DO UPDATE SET
                        approved_hours = 0,
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
                    attendance_id, approved_hours, decision, reviewer_user_id, reason, updated_at
                )
                VALUES (
                    att_id, 
                    0, 
                    'REJECTED', 
                    NEW.reviewed_by, 
                    COALESCE(NEW.decision_reason, CONCAT('Từ chối đối soát OT Request #', NEW.request_id)),
                    clock_timestamp()
                )
                ON CONFLICT (attendance_id) DO UPDATE SET
                    approved_hours = 0,
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


-- 4. CẬP NHẬT STORED PROCEDURE CHÍNH: sp_generate_monthly_payroll
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
        WHERE salary_period = p_period AND payment_status IN ('DRAFT', 'NEEDS_RECALCULATION')
    );

    DELETE FROM payrolls 
    WHERE salary_period = p_period AND payment_status IN ('DRAFT', 'NEEDS_RECALCULATION');

    -- 4. KHỞI TẠO BẢN GHI KHUNG TRONG payrolls (KÈM CỘT daily_standard_hours VÀ absent_days BẤT BIẾN)
    INSERT INTO payrolls (
        employee_id, store_id, salary_period, standard_working_days, daily_standard_hours,
        actual_working_days, paid_leave_days, unpaid_leave_days, absent_days, unworked_hours,
        contract_salary, total_earnings, total_allowances, total_bonuses,
        total_insurance, total_deductions, gross_income, net_salary,
        payment_status, created_by
    )
    SELECT 
        s.employee_id, s.store_id, p_period, v_standard_days, s.emp_daily_hours,
        s.actual_working_days, s.paid, s.unpaid,
        -- TÁCH BẠCH NGÀY VẮNG KHÔNG PHÉP: GREATEST(0, missing_working_days - unpaid)
        GREATEST(0.0, s.missing_working_days - s.unpaid) AS absent_days,
        -- unworked_hours tính theo đúng định mức giờ ca của từng người (s.emp_daily_hours)
        ROUND(s.missing_working_days * s.emp_daily_hours + s.late_early_minutes / 60.0, 2),
        s.contract_salary, 0, 0, 0, 0, 0, 0, 0, 'DRAFT', p_hr_user_id
    FROM (
        SELECT 
            e.employee_id, e.store_id,
            COALESCE(ov.unpaid_leave_days,
                     GREATEST(COALESCE(att.unpaid_leave_days, 0), COALESCE(lr.unpaid_days, 0))) AS unpaid,
            COALESCE(ov.paid_leave_days,
                     GREATEST(COALESCE(att.paid_leave_days, 0), COALESCE(lr.paid_days, 0)))     AS paid,
            -- CÔNG THỰC TẾ: Với nhân viên nhập Excel, công thực tế = công chuẩn - (nghỉ không lương + nghỉ có lương).
            -- Với máy chấm công, lấy worked_days. Nhờ đó nhân viên nhập Excel không bị hiển thị lỗi "Công thực tế: 0/26".
            CASE 
                WHEN ov.employee_id IS NOT NULL OR ov.unpaid_leave_days IS NOT NULL OR ov.paid_leave_days IS NOT NULL THEN
                    GREATEST(0.0, v_standard_days - (COALESCE(ov.unpaid_leave_days, 0.0) + COALESCE(ov.paid_leave_days, 0.0)))
                ELSE
                    COALESCE(att.worked_days, 0.0)
            END AS actual_working_days,
            -- TƯƠNG THÍCH 100% EXCEL: Ưu tiên ov.unpaid_leave_days nếu có file Excel import.
            -- Nếu không có file Excel, tự động khấu trừ ngày thiếu công so với công chuẩn (bao quát nghỉ không phép).
            COALESCE(
                ov.unpaid_leave_days,
                GREATEST(0.0, v_standard_days - (
                    COALESCE(att.worked_days, 0.0) + 
                    COALESCE(ov.paid_leave_days, GREATEST(COALESCE(att.paid_leave_days, 0), COALESCE(lr.paid_days, 0)))
                ))
            ) AS missing_working_days,
            public.fn_employee_daily_standard_hours(e.employee_id, p_period) AS emp_daily_hours,
            COALESCE(att.total_late_early_minutes, 0) AS late_early_minutes,
            COALESCE(c.basic_salary, 8000000)         AS contract_salary
        FROM employees e
        LEFT JOIN contracts c ON e.employee_id = c.employee_id AND c.status = 'ACTIVE'
        LEFT JOIN public.payroll_import_overrides ov 
               ON ov.salary_period = p_period AND ov.employee_id = e.employee_id
        LEFT JOIN (
            SELECT 
                a.employee_id,
                COUNT(DISTINCT a.work_date) FILTER (
                    WHERE a.check_in_time IS NOT NULL 
                       OR a.actual_work_hours > 0 
                       OR a.status IN ('NORMAL', 'LATE', 'EARLY', 'LATE_AND_EARLY', 'OVERTIME')
                )::NUMERIC AS worked_days,
                -- Phép có lương: Phép năm (ANNUAL_LEAVE) & Thai sản (MATERNITY_LEAVE theo leave_types is_paid=True)
                COUNT(CASE WHEN a.status IN ('ANNUAL_LEAVE', 'MATERNITY_LEAVE') THEN 1 END)::NUMERIC AS paid_leave_days,
                -- Phép không lương: Nghỉ không lương (UNPAID_LEAVE) & Nghỉ ốm đau (SICK_LEAVE do BHXH chi trả)
                COUNT(CASE WHEN a.status IN ('UNPAID_LEAVE', 'SICK_LEAVE') THEN 1 END)::NUMERIC AS unpaid_leave_days,
                -- Miễn trừ phút trễ trong ngưỡng ân hạn
                SUM((CASE WHEN a.late_minutes > v_late_tolerance THEN a.late_minutes ELSE 0 END) + COALESCE(a.early_minutes, 0)) AS total_late_early_minutes,
                SUM(CASE WHEN a.late_minutes > v_late_tolerance THEN v_late_penalty ELSE 0 END) AS total_late_penalty
            FROM attendances a
            WHERE TO_CHAR(a.work_date, 'YYYY-MM') = p_period
            GROUP BY a.employee_id
        ) att ON e.employee_id = att.employee_id
        LEFT JOIN (
            -- XỬ LÝ CHÍNH XÁC ĐƠN NGHỈ XUYÊN THÁNG: Chỉ đếm số ngày làm việc (trừ Chủ nhật) nằm trong kỳ lương
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
        WHERE e.employment_status IN ('ACTIVE', 'PROBATION')
    ) s;

    -- 5. TÍNH TIỀN LÀM THÊM GIỜ (OT): ĐƠN GIÁ THEO ĐỊNH MỨC GIỜ CỦA NHÂN SỰ
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT 
        p.payroll_id, 
        'OVERTIME', 
        'Tiền làm thêm giờ (Tăng ca OT)', 
        'EARNING',
        CONCAT(
            'Lương 1h: ', ROUND(p.contract_salary / v_standard_days / p.daily_standard_hours, 0), 'đ (Ca ', p.daily_standard_hours, 'h) | ',
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

    -- 6. LƯƠNG HỢP ĐỒNG (EARNING)
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'CONTRACT_SALARY', 'Lương cơ bản theo hợp đồng lao động', 'EARNING',
           CONCAT('Mức lương quy định hợp đồng: ', p.contract_salary, ' đ'), p.contract_salary
    FROM payrolls p
    WHERE p.salary_period = p_period;

    -- 7. KHẤU TRỪ LƯƠNG CƠ BẢN DỰA VÀO THỜI GIAN (DEDUCTION) - TÁCH RÕ NGHỈ KHÔNG LƯƠNG & VẮNG KHÔNG PHÉP
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT 
        p.payroll_id, 
        'BASE_SALARY_DEDUCTION', 
        'Khấu trừ lương cơ bản dựa vào thời gian', 
        'DEDUCTION',
        CONCAT('Thiếu ', p.unworked_hours, ' giờ (gồm ', p.unpaid_leave_days, ' ngày nghỉ không lương + ', p.absent_days, 
               ' ngày vắng không phép & trễ/sớm) - Định mức ca: ', p.daily_standard_hours, 'h'),
        ROUND(
            ((p.unpaid_leave_days + p.absent_days) * (p.contract_salary / v_standard_days))
            + (GREATEST(0.0, p.unworked_hours - ((p.unpaid_leave_days + p.absent_days) * p.daily_standard_hours)) 
               * (p.contract_salary / v_standard_days / p.daily_standard_hours)),
            0
        )
    FROM payrolls p
    WHERE p.salary_period = p_period
      AND ROUND(
            ((p.unpaid_leave_days + p.absent_days) * (p.contract_salary / v_standard_days))
            + (GREATEST(0.0, p.unworked_hours - ((p.unpaid_leave_days + p.absent_days) * p.daily_standard_hours)) 
               * (p.contract_salary / v_standard_days / p.daily_standard_hours)),
            0
        ) > 0;

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
    FROM payrolls p LEFT JOIN contracts c ON p.employee_id = c.employee_id AND c.status = 'ACTIVE'
    WHERE p.salary_period = p_period AND v_bhxh_rate > 0;

    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'BHYT', CONCAT('Bảo hiểm Y tế (BHYT ', ROUND(v_bhyt_rate * 100, 2), '%)'), 'DEDUCTION',
           CONCAT(ROUND(v_bhyt_rate * 100, 2), '% * Lương đóng bảo hiểm'),
           ROUND(COALESCE(c.insurance_salary, c.basic_salary, 5000000) * v_bhyt_rate, 0)
    FROM payrolls p LEFT JOIN contracts c ON p.employee_id = c.employee_id AND c.status = 'ACTIVE'
    WHERE p.salary_period = p_period AND v_bhyt_rate > 0;

    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'BHTN', CONCAT('Bảo hiểm Thất nghiệp (BHTN ', ROUND(v_bhtn_rate * 100, 2), '%)'), 'DEDUCTION',
           CONCAT(ROUND(v_bhtn_rate * 100, 2), '% * Lương đóng bảo hiểm'),
           ROUND(COALESCE(c.insurance_salary, c.basic_salary, 5000000) * v_bhtn_rate, 0)
    FROM payrolls p LEFT JOIN contracts c ON p.employee_id = c.employee_id AND c.status = 'ACTIVE'
    WHERE p.salary_period = p_period AND v_bhtn_rate > 0;

    -- 11. PHẠT VI PHẠM QUY CHẾ CHẤM CÔNG (GIỮ NGUYÊN TÊN GỐC QUY CHẾ)
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

