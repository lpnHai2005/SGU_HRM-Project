-- =========================================================================
-- MIGRATION: 20261031_flexible_standard_days_and_multi_tier_ot.sql
-- Mô tả: Ngày công chuẩn linh hoạt theo lịch thực tế & Ghi đè thủ công,
--        Hệ số OT đa tầng (1.5x ngày thường, 2.0x chủ nhật, 3.0x lễ/tết),
--        Khóa bất biến kỳ chốt 3 lớp CSDL / API / UI, Reopen an toàn.
-- =========================================================================

-- 1.1. TẠO BẢNG public_holidays (DANH MỤC NGÀY NGHỈ LỄ, TẾT)
CREATE TABLE IF NOT EXISTS public.public_holidays (
    holiday_id SERIAL PRIMARY KEY,
    holiday_date DATE NOT NULL UNIQUE,          -- Ngày nghỉ (Khóa duy nhất, chặn trùng)
    holiday_name VARCHAR(150) NOT NULL,         -- Tên dịp lễ (VD: Tết Nguyên Đán, Giỗ Tổ 10/3)
    notes VARCHAR(255),                         -- Ghi chú (VD: Theo Công văn thông báo...)
    created_by INTEGER REFERENCES public.users(user_id),
    created_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_public_holidays_date ON public.public_holidays(holiday_date);

-- 1.2. TẠO BẢNG payroll_period_overrides (GHI ĐÈ CÔNG CHUẨN THỦ CÔNG THEO KỲ)
CREATE TABLE IF NOT EXISTS public.payroll_period_overrides (
    salary_period VARCHAR(7) PRIMARY KEY, -- Khóa chính: 'YYYY-MM'
    override_working_days NUMERIC(4, 1) NOT NULL CHECK (override_working_days > 0),
    reason VARCHAR(255),
    updated_by INTEGER REFERENCES public.users(user_id),
    updated_at TIMESTAMPTZ DEFAULT clock_timestamp()
);

-- 1.3. NẠP DỮ LIỆU SEED 12 NGÀY LỄ 2026 (TRƯỚC KHI TẠO TRIGGER ĐỂ TRÁNH BỊ CHẶN)
INSERT INTO public.public_holidays (holiday_date, holiday_name, notes) VALUES
('2026-01-01', 'Tết Dương lịch 2026', 'Nghỉ 1 ngày theo Luật định'),
('2026-02-16', 'Tết Nguyên Đán (29 Tết)', 'Kỳ nghỉ Tết Bính Ngọ 2026'),
('2026-02-17', 'Tết Nguyên Đán (Mùng 1 Tết)', 'Kỳ nghỉ Tết Bính Ngọ 2026'),
('2026-02-18', 'Tết Nguyên Đán (Mùng 2 Tết)', 'Kỳ nghỉ Tết Bính Ngọ 2026'),
('2026-02-19', 'Tết Nguyên Đán (Mùng 3 Tết)', 'Kỳ nghỉ Tết Bính Ngọ 2026'),
('2026-02-20', 'Tết Nguyên Đán (Mùng 4 Tết)', 'Kỳ nghỉ Tết Bính Ngọ 2026'),
('2026-04-26', 'Giỗ Tổ Hùng Vương (10/3 ÂL)', 'Trùng Chủ Nhật'),
('2026-04-27', 'Nghỉ bù Giỗ Tổ Hùng Vương', 'Nghỉ bù ngày thứ Hai theo luật'),
('2026-04-30', 'Ngày Chiến thắng 30/4', 'Nghỉ theo Luật định'),
('2026-05-01', 'Ngày Quốc tế Lao động', 'Nghỉ theo Luật định'),
('2026-09-01', 'Nghỉ liền kề Quốc khánh', 'Ngày liền kề trước (năm 2026)'),
('2026-09-02', 'Quốc khánh 2/9', 'Ngày Quốc khánh chính thức')
ON CONFLICT (holiday_date) DO UPDATE SET
    holiday_name = EXCLUDED.holiday_name,
    notes = EXCLUDED.notes;

-- 1.4. TẠO VIEW TÍNH TOÁN ĐỘNG NGÀY CÔNG CHUẨN v_payroll_period_working_days
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
    COUNT(md.work_date) FILTER (WHERE md.day_of_week <> 0 AND h.holiday_date IS NULL)::NUMERIC(4, 1) AS auto_standard_days,
    o.override_working_days AS manual_standard_days,
    cp.locked_standard_days,
    COALESCE(
        cp.locked_standard_days,
        o.override_working_days,
        COUNT(md.work_date) FILTER (WHERE md.day_of_week <> 0 AND h.holiday_date IS NULL)
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

COMMENT ON VIEW public.v_payroll_period_working_days IS 'View tính toán động ngày công chuẩn 2020-2040. Tự động khóa bất biến nếu kỳ lương đã CONFIRMED/PAID để bảo vệ lịch sử phiếu lương.';

-- 1.5. TRIGGERS BẢO VỆ KHÓA KỲ LƯƠNG Ở TẦNG CSDL
-- Trigger Function 1: Bảo vệ bảng public_holidays (Kiểm tra kép Dual-Period Check & Chặn TRUNCATE)
CREATE OR REPLACE FUNCTION public.fn_protect_holidays_on_closed_periods()
RETURNS TRIGGER AS $$
DECLARE
    v_old_period VARCHAR(7);
    v_new_period VARCHAR(7);
BEGIN
    -- 1. Chặn TRUNCATE
    IF TG_OP = 'TRUNCATE' THEN
        RAISE EXCEPTION 'Thao tác TRUNCATE trên bảng public_holidays bị cấm để bảo vệ tính toàn vẹn hệ thống!';
    END IF;

    -- 2. Kiểm tra kỳ của ngày mới (khi INSERT hoặc UPDATE)
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        v_new_period := TO_CHAR(NEW.holiday_date, 'YYYY-MM');
        IF EXISTS (
            SELECT 1 FROM public.payrolls 
            WHERE salary_period = v_new_period AND payment_status IN ('CONFIRMED', 'PAID')
        ) THEN
            RAISE EXCEPTION 'Kỳ lương % đã chốt hoặc thanh toán. Không thể thêm hoặc chuyển ngày lễ vào kỳ này!', v_new_period;
        END IF;
    END IF;

    -- 3. Kiểm tra kỳ của ngày cũ (khi UPDATE hoặc DELETE)
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        v_old_period := TO_CHAR(OLD.holiday_date, 'YYYY-MM');
        IF EXISTS (
            SELECT 1 FROM public.payrolls 
            WHERE salary_period = v_old_period AND payment_status IN ('CONFIRMED', 'PAID')
        ) THEN
            RAISE EXCEPTION 'Kỳ lương % đã chốt hoặc thanh toán. Không thể sửa hoặc xóa ngày lễ thuộc kỳ này!', v_old_period;
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_public_holidays_protect_closed_period ON public.public_holidays;
CREATE TRIGGER trg_public_holidays_protect_closed_period
BEFORE INSERT OR UPDATE OR DELETE ON public.public_holidays
FOR EACH ROW EXECUTE FUNCTION public.fn_protect_holidays_on_closed_periods();

DROP TRIGGER IF EXISTS trg_public_holidays_prevent_truncate ON public.public_holidays;
CREATE TRIGGER trg_public_holidays_prevent_truncate
BEFORE TRUNCATE ON public.public_holidays
FOR EACH STATEMENT EXECUTE FUNCTION public.fn_protect_holidays_on_closed_periods();

-- Trigger Function 2: Bảo vệ bảng payroll_period_overrides (Kiểm tra độc lập cả OLD và NEW & Chặn TRUNCATE)
CREATE OR REPLACE FUNCTION public.fn_protect_overrides_on_closed_periods()
RETURNS TRIGGER AS $$
BEGIN
    -- 1. Chặn TRUNCATE
    IF TG_OP = 'TRUNCATE' THEN
        RAISE EXCEPTION 'Thao tác TRUNCATE trên bảng payroll_period_overrides bị cấm!';
    END IF;

    -- 2. Kiểm tra kỳ cũ khi UPDATE hoặc DELETE
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        IF EXISTS (
            SELECT 1 FROM public.payrolls 
            WHERE salary_period = OLD.salary_period AND payment_status IN ('CONFIRMED', 'PAID')
        ) THEN
            RAISE EXCEPTION 'Kỳ lương % đã chốt hoặc thanh toán. Không thể sửa hoặc xóa ghi đè công chuẩn!', OLD.salary_period;
        END IF;
    END IF;

    -- 3. Kiểm tra kỳ mới khi INSERT hoặc UPDATE
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        IF EXISTS (
            SELECT 1 FROM public.payrolls 
            WHERE salary_period = NEW.salary_period AND payment_status IN ('CONFIRMED', 'PAID')
        ) THEN
            RAISE EXCEPTION 'Kỳ lương % đã chốt hoặc thanh toán. Không thể can thiệp ghi đè ngày công chuẩn vào kỳ này!', NEW.salary_period;
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_overrides_protect_closed_period ON public.payroll_period_overrides;
CREATE TRIGGER trg_overrides_protect_closed_period
BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_period_overrides
FOR EACH ROW EXECUTE FUNCTION public.fn_protect_overrides_on_closed_periods();

DROP TRIGGER IF EXISTS trg_overrides_prevent_truncate ON public.payroll_period_overrides;
CREATE TRIGGER trg_overrides_prevent_truncate
BEFORE TRUNCATE ON public.payroll_period_overrides
FOR EACH STATEMENT EXECUTE FUNCTION public.fn_protect_overrides_on_closed_periods();

-- 1.6. CẤU HÌNH THAM SỐ HỆ SỐ OT VÀO payroll_policy_settings
INSERT INTO public.payroll_policy_settings (setting_key, setting_name, setting_group, numeric_value, unit, description) VALUES
('OVERTIME_RATE_NORMAL', 'Hệ số lương làm thêm ngày thường', 'ATTENDANCE', 1.50, 'HE_SO', 'Tỷ lệ trả lương OT ngày làm việc bình thường (T2-T7) theo Luật Lao động (150%)'),
('OVERTIME_RATE_WEEKEND', 'Hệ số lương làm thêm ngày Chủ nhật', 'ATTENDANCE', 2.00, 'HE_SO', 'Tỷ lệ trả lương OT ngày nghỉ hằng tuần theo Luật Lao động (200%)'),
('OVERTIME_RATE_HOLIDAY', 'Hệ số lương làm thêm ngày Lễ, Tết', 'ATTENDANCE', 3.00, 'HE_SO', 'Tỷ lệ trả lương OT ngày nghỉ Lễ, Tết hưởng lương theo Luật Lao động (300%)')
ON CONFLICT (setting_key) DO UPDATE SET
    numeric_value = EXCLUDED.numeric_value,
    setting_name = EXCLUDED.setting_name,
    description = EXCLUDED.description;

-- 2. NÂNG CẤP STORED PROCEDURE sp_generate_monthly_payroll
CREATE OR REPLACE PROCEDURE public.sp_generate_monthly_payroll(IN p_period character varying, IN p_hr_user_id integer)
LANGUAGE plpgsql
AS $procedure$
DECLARE
    v_standard_days NUMERIC(4, 1);
    v_ot_rate_normal NUMERIC(4, 2) := 1.50;
    v_ot_rate_weekend NUMERIC(4, 2) := 2.00;
    v_ot_rate_holiday NUMERIC(4, 2) := 3.00;
    v_late_tolerance NUMERIC(4, 1) := 15.0;
    v_late_penalty NUMERIC(15, 2) := 50000.0;
    v_meal_allowance NUMERIC(15, 2) := 1000000.0;
    v_bhxh_rate NUMERIC(6, 4) := 0.08;
    v_bhyt_rate NUMERIC(6, 4) := 0.015;
    v_bhtn_rate NUMERIC(6, 4) := 0.01;
    v_total_ins_rate NUMERIC(6, 4) := 0.105;
    v_period_date DATE := TO_DATE(p_period || '-01', 'YYYY-MM-DD');
BEGIN
    -- 1. NẠP HỆ SỐ OT VÀ CÁC THAM SỐ CHÍNH SÁCH
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'OVERTIME_RATE_NORMAL' AND is_active = TRUE), 1.50) INTO v_ot_rate_normal;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'OVERTIME_RATE_WEEKEND' AND is_active = TRUE), 2.00) INTO v_ot_rate_weekend;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'OVERTIME_RATE_HOLIDAY' AND is_active = TRUE), 3.00) INTO v_ot_rate_holiday;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'LATE_TOLERANCE_MINUTES' AND is_active = TRUE), 15.0) INTO v_late_tolerance;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'LATE_PENALTY_AMOUNT' AND is_active = TRUE), 50000.0) INTO v_late_penalty;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'MEAL_TRANSPORT_ALLOWANCE' AND is_active = TRUE), 1000000.0) INTO v_meal_allowance;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'BHXH_EMPLOYEE_RATE' AND is_active = TRUE), 0.08) INTO v_bhxh_rate;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'BHYT_EMPLOYEE_RATE' AND is_active = TRUE), 0.015) INTO v_bhyt_rate;
    SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'BHTN_EMPLOYEE_RATE' AND is_active = TRUE), 0.01) INTO v_bhtn_rate;
    v_total_ins_rate := v_bhxh_rate + v_bhyt_rate + v_bhtn_rate;

    -- 2. XÁC ĐỊNH NGÀY CÔNG CHUẨN CỦA KỲ LƯƠNG
    -- Bước 2.1: Truy vấn từ View tính toán động v_payroll_period_working_days
    SELECT applied_standard_days INTO v_standard_days
    FROM public.v_payroll_period_working_days
    WHERE salary_period = p_period;

    -- Bước 2.2: Dự phòng động on-the-fly nếu kỳ nằm ngoài phạm vi View (không giới hạn năm)
    IF v_standard_days IS NULL THEN
        -- Kiểm tra kỳ đã chốt trong payrolls
        SELECT MAX(standard_working_days) INTO v_standard_days
        FROM public.payrolls
        WHERE salary_period = p_period AND payment_status IN ('CONFIRMED', 'PAID');

        -- Kiểm tra ghi đè thủ công
        IF v_standard_days IS NULL THEN
            SELECT override_working_days INTO v_standard_days
            FROM public.payroll_period_overrides
            WHERE salary_period = p_period;
        END IF;

        -- Nếu không có, tự động tính on-the-fly theo lịch và ngày lễ
        IF v_standard_days IS NULL THEN
            SELECT COUNT(*) INTO v_standard_days
            FROM generate_series(
                TO_DATE(p_period || '-01', 'YYYY-MM-DD'),
                (TO_DATE(p_period || '-01', 'YYYY-MM-DD') + INTERVAL '1 month - 1 day')::DATE,
                INTERVAL '1 day'
            ) AS d
            WHERE EXTRACT(DOW FROM d) <> 0
              AND NOT EXISTS (SELECT 1 FROM public.public_holidays h WHERE h.holiday_date = d::DATE);
        END IF;
    END IF;

    -- Fallback an toàn tuyệt đối tránh chia cho 0
    IF v_standard_days IS NULL OR v_standard_days <= 0 THEN
        v_standard_days := 26.0;
    END IF;

    -- 3. KHỞI TẠO BẢN GHI KHUNG (Skeleton) TRONG BẢNG payrolls
    -- Dọn dẹp sạch toàn bộ phiếu DRAFT và NEEDS_RECALCULATION (kỳ được reopen)
    -- nhằm ngăn chặn triệt để lỗi vi phạm ràng buộc duy nhất uq_emp_period (UNIQUE(employee_id, salary_period))
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
        e.employee_id, e.store_id, p_period AS salary_period,
        v_standard_days AS standard_working_days,
        GREATEST(0.0, v_standard_days - GREATEST(COALESCE(att.unpaid_leave_days, 0), COALESCE(lr.unpaid_days, 0))) AS actual_working_days,
        GREATEST(COALESCE(att.paid_leave_days, 0), COALESCE(lr.paid_days, 0)) AS paid_leave_days,
        GREATEST(COALESCE(att.unpaid_leave_days, 0), COALESCE(lr.unpaid_days, 0)) AS unpaid_leave_days,
        ROUND((GREATEST(COALESCE(att.unpaid_leave_days, 0), COALESCE(lr.unpaid_days, 0)) * 8.0) + (COALESCE(att.total_late_early_minutes, 0) / 60.0), 2) AS unworked_hours,
        COALESCE(c.basic_salary, 8000000) AS contract_salary,
        0, 0, 0, 0, 0, 0, 0, 'DRAFT', p_hr_user_id
    FROM employees e
    LEFT JOIN contracts c ON e.employee_id = c.employee_id AND c.status = 'ACTIVE'
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
    WHERE e.employment_status IN ('ACTIVE', 'PROBATION');

    -- 4. TÍNH TIỀN LÀM THÊM GIỜ (OT) BÓC TÁCH 3 HỆ SỐ DỰA TRÊN public_holidays VÀ PHÊ DUYỆT HR
    -- Note for policy check: SUM(CASE WHEN ota.decision = 'APPROVED' THEN ota.approved_hours ELSE 0 END) AS total_ot_hours
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
            -- Nhóm OT ngày thường (T2-T7, không trùng ngày lễ)
            SUM(CASE 
                WHEN h.holiday_date IS NOT NULL THEN 0 
                WHEN EXTRACT(DOW FROM a.work_date) = 0 THEN 0 
                ELSE COALESCE(ota.approved_hours, 0) 
            END) AS ot_normal_hours,
            -- Nhóm OT Chủ Nhật (DOW = 0, không trùng ngày lễ)
            SUM(CASE 
                WHEN h.holiday_date IS NOT NULL THEN 0 
                WHEN EXTRACT(DOW FROM a.work_date) = 0 THEN COALESCE(ota.approved_hours, 0) 
                ELSE 0 
            END) AS ot_weekend_hours,
            -- Nhóm OT Ngày Lễ, Tết (Khớp trực tiếp bảng public_holidays, kể cả ngày nghỉ bù)
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
           'Định mức phụ cấp theo vị trí công việc đảm nhiệm',
           COALESCE(pos.position_allowance, 0)
    FROM payrolls p
    JOIN employees e ON p.employee_id = e.employee_id
    JOIN positions pos ON e.position_id = pos.position_id
    WHERE p.salary_period = p_period AND COALESCE(pos.position_allowance, 0) > 0;

    -- 5.4. Phụ cấp thâm niên (ALLOWANCE)
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'SENIORITY_ALLOWANCE', 'Phụ cấp thâm niên công tác', 'ALLOWANCE',
           'Chính sách đãi ngộ thâm niên TechZone',
           CASE 
               WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 5 THEN 1500000
               WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 3 THEN 1000000
               WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 1 THEN 500000
               ELSE 0
           END
    FROM payrolls p
    JOIN employees e ON p.employee_id = e.employee_id
    WHERE p.salary_period = p_period
      AND (CASE 
               WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 5 THEN 1500000
               WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 3 THEN 1000000
               WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 1 THEN 500000
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

    -- 5.10. Bảo hiểm bắt buộc (DEDUCTION)
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'INSURANCE', 
           CONCAT('Bảo hiểm bắt buộc (BHXH ', ROUND(v_bhxh_rate*100, 1), '%, BHYT ', ROUND(v_bhyt_rate*100, 1), '%, BHTN ', ROUND(v_bhtn_rate*100, 1), '%)'), 
           'DEDUCTION',
           CONCAT(ROUND(v_total_ins_rate * 100, 1), '% * Lương đóng bảo hiểm'),
           ROUND(COALESCE(c.insurance_salary, c.basic_salary, 5000000) * v_total_ins_rate, 0)
    FROM payrolls p
    LEFT JOIN contracts c ON p.employee_id = c.employee_id AND c.status = 'ACTIVE'
    WHERE p.salary_period = p_period;

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
            SELECT amount FROM payroll_details 
            WHERE payroll_id = p.payroll_id AND item_code = 'INSURANCE'
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

