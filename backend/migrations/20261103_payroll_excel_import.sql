-- =========================================================================
-- TECHZONE HRM - MIGRATION: PAYROLL EXCEL IMPORT SUPPORT
-- Migration ID: 20261103_payroll_excel_import
-- Created at: 2026-11-03
-- =========================================================================

-- 1. HÀM TÍNH NGÀY CÔNG CHUẨN DÙNG CHUNG (fn_payroll_standard_days)
CREATE OR REPLACE FUNCTION public.fn_payroll_standard_days(p_period VARCHAR)
RETURNS NUMERIC LANGUAGE plpgsql STABLE AS $$
DECLARE v NUMERIC;
BEGIN
    -- View đã gộp: kỳ khóa -> override cấp kỳ -> đếm lịch trừ CN & lễ
    SELECT applied_standard_days INTO v
    FROM public.v_payroll_period_working_days WHERE salary_period = p_period;

    IF v IS NULL THEN  -- kỳ nằm ngoài phạm vi view (2020-2040)
        SELECT COUNT(*) INTO v
        FROM generate_series(TO_DATE(p_period || '-01', 'YYYY-MM-DD'),
                             (TO_DATE(p_period || '-01', 'YYYY-MM-DD') + INTERVAL '1 month - 1 day')::DATE,
                             INTERVAL '1 day') d
        WHERE EXTRACT(DOW FROM d) <> 0
          AND NOT EXISTS (SELECT 1 FROM public.public_holidays h WHERE h.holiday_date = d::DATE);
    END IF;

    IF v IS NULL OR v <= 0 THEN v := 26.0; END IF;
    RETURN v;
END $$;


-- 2. BẢNG NHẬT KÝ ĐỢT IMPORT (payroll_import_batches)
CREATE TABLE IF NOT EXISTS public.payroll_import_batches (
    batch_id        BIGSERIAL PRIMARY KEY,
    salary_period   VARCHAR(7)   NOT NULL,
    file_name       VARCHAR(255) NOT NULL,
    imported_by     INTEGER REFERENCES public.users(user_id),
    imported_at     TIMESTAMPTZ  NOT NULL DEFAULT clock_timestamp(),
    created_count   INTEGER NOT NULL DEFAULT 0,
    updated_count   INTEGER NOT NULL DEFAULT 0,
    deleted_count   INTEGER NOT NULL DEFAULT 0,
    total_gross     NUMERIC(15,2) NOT NULL DEFAULT 0,   -- của các NV bị ảnh hưởng, sau khi tính
    total_net       NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_insurance NUMERIC(15,2) NOT NULL DEFAULT 0,
    status          VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVERTED')),
    reverted_at     TIMESTAMPTZ,
    reverted_by     INTEGER REFERENCES public.users(user_id)
);
CREATE INDEX IF NOT EXISTS idx_payroll_import_batches_period ON public.payroll_import_batches(salary_period);


-- 3. BẢNG OVERRIDE THEO NHÂN VIÊN (payroll_import_overrides)
CREATE TABLE IF NOT EXISTS public.payroll_import_overrides (
    salary_period     VARCHAR(7) NOT NULL,
    employee_id       INTEGER    NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
    batch_id          BIGINT REFERENCES public.payroll_import_batches(batch_id) ON DELETE SET NULL,
    -- NULL = theo chấm công. Có giá trị = (công chuẩn - công thực tế) tại lúc nhập.
    unpaid_leave_days NUMERIC(5,2) CHECK (unpaid_leave_days >= 0),
    paid_leave_days   NUMERIC(5,2) CHECK (paid_leave_days >= 0),            -- chỉ để báo cáo
    extra_commission  NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (extra_commission >= 0),
    extra_bonus       NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (extra_bonus >= 0),
    extra_allowance   NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (extra_allowance >= 0),
    extra_penalty     NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (extra_penalty >= 0),
    note              VARCHAR(255),
    imported_by       INTEGER REFERENCES public.users(user_id),
    imported_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (salary_period, employee_id),
    CONSTRAINT chk_pio_days_pair CHECK ((unpaid_leave_days IS NULL) = (paid_leave_days IS NULL)),
    CONSTRAINT chk_pio_not_empty CHECK (unpaid_leave_days IS NOT NULL
        OR extra_commission > 0 OR extra_bonus > 0 OR extra_allowance > 0 OR extra_penalty > 0)
);

ALTER TABLE public.payroll_import_batches   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_import_overrides ENABLE ROW LEVEL SECURITY;


-- 4. CẬP NHẬT STORED PROCEDURE sp_generate_monthly_payroll
CREATE OR REPLACE PROCEDURE public.sp_generate_monthly_payroll(
    IN p_period VARCHAR(7),
    IN p_hr_user_id INTEGER
)
LANGUAGE plpgsql
AS $$
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
BEGIN
    v_period_date := TO_DATE(p_period || '-01', 'YYYY-MM-DD');

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

    -- 3. KHỞI TẠO BẢN GHI KHUNG (Skeleton) TRONG BẢNG payrolls
    DELETE FROM payroll_details 
    WHERE payroll_id IN (
        SELECT payroll_id 
        FROM payrolls 
        WHERE salary_period = p_period AND payment_status IN ('DRAFT', 'NEEDS_RECALCULATION')
    );

    DELETE FROM payrolls 
    WHERE salary_period = p_period AND payment_status IN ('DRAFT', 'NEEDS_RECALCULATION');

    INSERT INTO payrolls (
        employee_id, store_id, salary_period, standard_working_days, 
        actual_working_days, paid_leave_days, unpaid_leave_days, unworked_hours,
        contract_salary, total_earnings, total_allowances, total_bonuses,
        total_insurance, total_deductions, gross_income, net_salary,
        payment_status, created_by
    )
    SELECT 
        s.employee_id, s.store_id, p_period, v_standard_days,
        GREATEST(0.0, v_standard_days - s.unpaid), s.paid, s.unpaid,
        ROUND(s.unpaid * 8.0 + s.late_early_minutes / 60.0, 2),
        s.contract_salary, 0, 0, 0, 0, 0, 0, 0, 'DRAFT', p_hr_user_id
    FROM (
        SELECT 
            e.employee_id, e.store_id,
            COALESCE(ov.unpaid_leave_days,
                     GREATEST(COALESCE(att.unpaid_leave_days, 0), COALESCE(lr.unpaid_days, 0))) AS unpaid,
            COALESCE(ov.paid_leave_days,
                     GREATEST(COALESCE(att.paid_leave_days, 0), COALESCE(lr.paid_days, 0)))     AS paid,
            COALESCE(att.total_late_early_minutes, 0) AS late_early_minutes,  -- trễ/sớm luôn theo máy
            COALESCE(c.basic_salary, 8000000)         AS contract_salary
        FROM employees e
        LEFT JOIN contracts c ON e.employee_id = c.employee_id AND c.status = 'ACTIVE'
        LEFT JOIN public.payroll_import_overrides ov 
               ON ov.salary_period = p_period AND ov.employee_id = e.employee_id
        LEFT JOIN (
            SELECT 
                a.employee_id,
                COUNT(CASE WHEN a.status = 'NORMAL' THEN 1 END)::NUMERIC AS worked_days,
                COUNT(CASE WHEN a.status = 'ANNUAL_LEAVE' THEN 1 END)::NUMERIC AS paid_leave_days,
                COUNT(CASE WHEN a.status = 'UNPAID_LEAVE' THEN 1 END)::NUMERIC AS unpaid_leave_days,
                SUM(COALESCE(a.late_minutes, 0) + COALESCE(a.early_minutes, 0)) AS total_late_early_minutes,
                SUM(CASE WHEN a.late_minutes > v_late_tolerance THEN v_late_penalty ELSE 0 END) AS total_late_penalty
            FROM attendances a
            WHERE TO_CHAR(a.work_date, 'YYYY-MM') = p_period
            GROUP BY a.employee_id
        ) att ON e.employee_id = att.employee_id
        LEFT JOIN (
            SELECT 
                req.employee_id,
                COALESCE(SUM(CASE WHEN lt.is_paid = TRUE THEN req.total_days ELSE 0 END), 0) AS paid_days,
                COALESCE(SUM(CASE WHEN lt.is_paid = FALSE THEN req.total_days ELSE 0 END), 0) AS unpaid_days
            FROM leave_requests req
            JOIN leave_types lt ON req.leave_type_id = lt.leave_type_id
            WHERE req.status = 'HR_APPROVED'
              AND (TO_CHAR(req.start_date, 'YYYY-MM') = p_period OR TO_CHAR(req.end_date, 'YYYY-MM') = p_period)
            GROUP BY req.employee_id
        ) lr ON e.employee_id = lr.employee_id
        WHERE e.employment_status IN ('ACTIVE', 'PROBATION')
    ) s;

    -- 4. TÍNH TIỀN LÀM THÊM GIỜ (OT)
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT 
        p.payroll_id, 
        'OVERTIME', 
        'Tiền làm thêm giờ (Tăng ca OT)', 
        'EARNING',
        CONCAT(
            'Lương 1h: ', ROUND(p.contract_salary / v_standard_days / 8.0, 0), 'đ | ',
            CASE WHEN ot.ot_normal_hours > 0 THEN CONCAT('Thường: ', ot.ot_normal_hours, 'h x ', ROUND(v_ot_rate_normal * 100, 0), '% ') ELSE '' END,
            CASE WHEN ot.ot_weekend_hours > 0 THEN CONCAT('Chủ nhật: ', ot.ot_weekend_hours, 'h x ', ROUND(v_ot_rate_weekend * 100, 0), '% ') ELSE '' END,
            CASE WHEN ot.ot_holiday_hours > 0 THEN CONCAT('Lễ/Tết: ', ot.ot_holiday_hours, 'h x ', ROUND(v_ot_rate_holiday * 100, 0), '%') ELSE '' END
        ),
        ROUND(
            (p.contract_salary / v_standard_days / 8.0) * (
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

    -- 5. BOTTOM-UP: TÍNH TOÁN CÁC CẤU PHẦN KHÁC VÀO payroll_details

    -- 5.1. Lương hợp đồng (EARNING)
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'CONTRACT_SALARY', 'Lương cơ bản theo hợp đồng lao động', 'EARNING',
           CONCAT('Mức lương quy định hợp đồng: ', p.contract_salary, ' đ'), p.contract_salary
    FROM payrolls p
    WHERE p.salary_period = p_period;

    -- 5.2. Khấu trừ lương cơ bản theo thời gian (DEDUCTION)
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'BASE_SALARY_DEDUCTION', 'Khấu trừ lương cơ bản dựa vào thời gian', 'DEDUCTION',
           CONCAT('Thiếu ', p.unworked_hours, ' giờ (gồm ', p.unpaid_leave_days, ' ngày nghỉ không hưởng lương & đi trễ) - Công thức: (Lương HĐ / ', v_standard_days, ') * Ngày nghỉ'),
           ROUND(
               (p.unpaid_leave_days * (p.contract_salary / v_standard_days))
               + (GREATEST(0.0, p.unworked_hours - (p.unpaid_leave_days * 8.0)) * (p.contract_salary / v_standard_days / 8.0)),
               0
           )
    FROM payrolls p
    WHERE p.salary_period = p_period
      AND ROUND((p.unpaid_leave_days * (p.contract_salary / v_standard_days)) + (GREATEST(0.0, p.unworked_hours - (p.unpaid_leave_days * 8.0)) * (p.contract_salary / v_standard_days / 8.0)), 0) > 0;

    -- 5.3. Phụ cấp chức vụ (ALLOWANCE)
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'POSITION_ALLOWANCE', 'Phụ cấp trách nhiệm chức vụ', 'ALLOWANCE',
           CONCAT('Định mức chức danh: ', pos.position_name),
           COALESCE(pos.position_allowance, 0)
    FROM payrolls p
    JOIN employees e ON p.employee_id = e.employee_id
    JOIN positions pos ON e.position_id = pos.position_id
    WHERE p.salary_period = p_period AND COALESCE(pos.position_allowance, 0) > 0;

    -- 5.4. Phụ cấp thâm niên (ALLOWANCE) - Đọc động từ payroll_policy_settings
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'SENIORITY_ALLOWANCE', 'Phụ cấp thâm niên công tác', 'ALLOWANCE',
           CASE 
               WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 5 THEN CONCAT('Thâm niên ≥ 5 năm (', EXTRACT(YEAR FROM age(v_period_date, e.join_date)), ' năm): ', v_seniority_5y::BIGINT, ' đ')
               WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 3 THEN CONCAT('Thâm niên ≥ 3 năm (', EXTRACT(YEAR FROM age(v_period_date, e.join_date)), ' năm): ', v_seniority_3y::BIGINT, ' đ')
               WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 1 THEN CONCAT('Thâm niên ≥ 1 năm (', EXTRACT(YEAR FROM age(v_period_date, e.join_date)), ' năm): ', v_seniority_1y::BIGINT, ' đ')
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

    -- 5.5. Phụ cấp dự án theo Vai trò nội bộ (ALLOWANCE)
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'PROJECT_ALLOWANCE', 'Phụ cấp tham gia dự án & chiến dịch', 'ALLOWANCE',
           'Phụ cấp theo vai trò thành viên các dự án chuỗi bán lẻ đang chạy',
           pm.total_prj_allowance
    FROM payrolls p
    JOIN (
        SELECT 
            pm_inner.employee_id,
            SUM(COALESCE(NULLIF(pm_inner.project_allowance, 0), pra.allowance_amount, 0)) AS total_prj_allowance
        FROM project_members pm_inner
        JOIN projects prj ON pm_inner.project_id = prj.project_id
        LEFT JOIN project_role_allowances pra 
               ON pm_inner.project_id = pra.project_id AND pm_inner.project_role = pra.role_code
        WHERE pm_inner.is_active = TRUE
          AND prj.status IN ('IN_PROGRESS', 'ACTIVE')
          AND TO_CHAR(pm_inner.joined_date, 'YYYY-MM') <= p_period
          AND (pm_inner.left_date IS NULL OR TO_CHAR(pm_inner.left_date, 'YYYY-MM') >= p_period)
        GROUP BY pm_inner.employee_id
    ) pm ON p.employee_id = pm.employee_id
    WHERE p.salary_period = p_period AND pm.total_prj_allowance > 0;

    -- 5.6. Phụ cấp cơm trưa & xăng xe (ALLOWANCE)
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'MEAL_ALLOWANCE', 'Phụ cấp cơm trưa & xăng xe', 'ALLOWANCE',
           'Chế độ phúc lợi cố định toàn chuỗi', v_meal_allowance
    FROM payrolls p
    WHERE p.salary_period = p_period AND v_meal_allowance > 0;

    -- 5.7. Thưởng sự kiện & Lễ Tết theo kỳ lương (BONUS)
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT 
        p.payroll_id, 
        ppb.bonus_code, 
        ppb.bonus_name, 
        'BONUS',
        CASE 
            WHEN ppb.calculation_type = 'COEFFICIENT' THEN
                CONCAT(ppb.base_amount::BIGINT, ' VNĐ cơ sở * Hệ số chức vụ (', COALESCE(pos.position_coefficient, 1.00), ')')
            WHEN ppb.calculation_type = 'CONTRACT_SALARY' THEN
                'Thưởng 1 tháng lương cơ bản theo hợp đồng lao động'
            ELSE
                CONCAT('Mức thưởng cố định: ', ppb.base_amount::BIGINT, ' VNĐ')
        END,
        ROUND(
            CASE 
                WHEN ppb.calculation_type = 'COEFFICIENT' THEN
                    ppb.base_amount * COALESCE(pos.position_coefficient, 1.00)
                WHEN ppb.calculation_type = 'CONTRACT_SALARY' THEN
                    p.contract_salary
                ELSE
                    ppb.base_amount
            END, 
            0
        )
    FROM payrolls p
    JOIN employees e ON p.employee_id = e.employee_id
    JOIN positions pos ON e.position_id = pos.position_id
    JOIN payroll_period_bonuses ppb ON ppb.salary_period = p_period AND ppb.is_active = TRUE
    WHERE p.salary_period = p_period;

    -- 5.8. Thưởng năng suất theo quy định KPI (BONUS)
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'PRODUCTIVITY_BONUS', 'Thưởng năng suất hoàn thành vượt KPI', 'BONUS',
           'Thưởng nóng đạt/vượt định mức KPI doanh số',
           comm.kpi_bonus_amount
    FROM payrolls p
    JOIN commissions comm ON p.employee_id = comm.employee_id AND comm.salary_period = p_period
    WHERE p.salary_period = p_period AND COALESCE(comm.kpi_bonus_amount, 0) > 0;

    -- 5.9. Hoa hồng bán lẻ (BONUS)
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'COMMISSION', 'Hoa hồng bán lẻ thiết bị công nghệ', 'BONUS',
           '1% Điện thoại & Laptop + 3% Phụ kiện',
           comm.commission_amount
    FROM payrolls p
    JOIN commissions comm ON p.employee_id = comm.employee_id AND comm.salary_period = p_period
    WHERE p.salary_period = p_period AND COALESCE(comm.commission_amount, 0) > 0;

    -- 5.10. BẢO HIỂM BẮT BUỘC - TÁCH BIỆT RÕ RÀNG 3 KHOẢN (BHXH, BHYT, BHTN)
    -- 5.10.1. Bảo hiểm Xã hội (BHXH)
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'BHXH', 
           CONCAT('Bảo hiểm Xã hội (BHXH ', ROUND(v_bhxh_rate * 100, 2), '%)'), 
           'DEDUCTION',
           CONCAT(ROUND(v_bhxh_rate * 100, 2), '% * Lương đóng bảo hiểm'),
           ROUND(COALESCE(c.insurance_salary, c.basic_salary, 5000000) * v_bhxh_rate, 0)
    FROM payrolls p
    LEFT JOIN contracts c ON p.employee_id = c.employee_id AND c.status = 'ACTIVE'
    WHERE p.salary_period = p_period AND v_bhxh_rate > 0;

    -- 5.10.2. Bảo hiểm Y tế (BHYT)
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'BHYT', 
           CONCAT('Bảo hiểm Y tế (BHYT ', ROUND(v_bhyt_rate * 100, 2), '%)'), 
           'DEDUCTION',
           CONCAT(ROUND(v_bhyt_rate * 100, 2), '% * Lương đóng bảo hiểm'),
           ROUND(COALESCE(c.insurance_salary, c.basic_salary, 5000000) * v_bhyt_rate, 0)
    FROM payrolls p
    LEFT JOIN contracts c ON p.employee_id = c.employee_id AND c.status = 'ACTIVE'
    WHERE p.salary_period = p_period AND v_bhyt_rate > 0;

    -- 5.10.3. Bảo hiểm Thất nghiệp (BHTN)
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'BHTN', 
           CONCAT('Bảo hiểm Thất nghiệp (BHTN ', ROUND(v_bhtn_rate * 100, 2), '%)'), 
           'DEDUCTION',
           CONCAT(ROUND(v_bhtn_rate * 100, 2), '% * Lương đóng bảo hiểm'),
           ROUND(COALESCE(c.insurance_salary, c.basic_salary, 5000000) * v_bhtn_rate, 0)
    FROM payrolls p
    LEFT JOIN contracts c ON p.employee_id = c.employee_id AND c.status = 'ACTIVE'
    WHERE p.salary_period = p_period AND v_bhtn_rate > 0;

    -- 5.11. Phạt vi phạm đi muộn (DEDUCTION)
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'PENALTY', 
           CONCAT('Phạt vi phạm quy chế chấm công (Đi muộn > ', v_late_tolerance::INT, ' phút)'), 
           'DEDUCTION',
           CONCAT(v_late_penalty::BIGINT, ' VNĐ / lần đi muộn'),
           att.total_late_penalty
    FROM payrolls p
    JOIN (
        SELECT a.employee_id, SUM(CASE WHEN a.late_minutes > v_late_tolerance THEN v_late_penalty ELSE 0 END) AS total_late_penalty
        FROM attendances a
        WHERE TO_CHAR(a.work_date, 'YYYY-MM') = p_period
        GROUP BY a.employee_id
    ) att ON p.employee_id = att.employee_id
    WHERE p.salary_period = p_period AND COALESCE(att.total_late_penalty, 0) > 0;

    -- 5.12. CÁC KHOẢN BỔ SUNG & KHẤU TRỪ TỪ EXCEL IMPORT OVERRIDES
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

    -- 6. BOTTOM-UP ROLL-UP: TỔNG HỢP TOÁN HỌC TỪ payroll_details NGƯỢC LÊN payrolls
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
$$;

