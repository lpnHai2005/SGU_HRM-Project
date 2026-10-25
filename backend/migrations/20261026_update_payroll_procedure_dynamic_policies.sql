-- =========================================================================
-- MIGRATION: 20261026_update_payroll_procedure_dynamic_policies.sql
-- Mô tả: Cập nhật sp_generate_monthly_payroll đọc động từ payroll_policy_settings,
--        payroll_period_bonuses và project_role_allowances
-- =========================================================================

CREATE OR REPLACE PROCEDURE public.sp_generate_monthly_payroll(IN p_period character varying, IN p_hr_user_id integer)
 LANGUAGE plpgsql
AS $procedure$
    DECLARE
        v_standard_days NUMERIC(4, 1) := 26.0;
        v_late_tolerance NUMERIC(4, 1) := 15.0;
        v_late_penalty NUMERIC(15, 2) := 50000.0;
        v_meal_allowance NUMERIC(15, 2) := 1000000.0;
        v_ot_rate NUMERIC(4, 2) := 1.5;
        v_bhxh_rate NUMERIC(6, 4) := 0.08;
        v_bhyt_rate NUMERIC(6, 4) := 0.015;
        v_bhtn_rate NUMERIC(6, 4) := 0.01;
        v_total_ins_rate NUMERIC(6, 4) := 0.105;
        v_period_date DATE := TO_DATE(p_period || '-01', 'YYYY-MM-DD');
    BEGIN
        -- 0. NẠP CÁC THAM SỐ CHÍNH SÁCH ĐỘNG TỪ payroll_policy_settings (CÓ FALLBACK AN TOÀN)
        SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'STANDARD_WORKING_DAYS' AND is_active = TRUE), 26.0) INTO v_standard_days;
        SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'LATE_TOLERANCE_MINUTES' AND is_active = TRUE), 15.0) INTO v_late_tolerance;
        SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'LATE_PENALTY_AMOUNT' AND is_active = TRUE), 50000.0) INTO v_late_penalty;
        SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'MEAL_TRANSPORT_ALLOWANCE' AND is_active = TRUE), 1000000.0) INTO v_meal_allowance;
        SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'OVERTIME_RATE_NORMAL' AND is_active = TRUE), 1.5) INTO v_ot_rate;
        SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'BHXH_EMPLOYEE_RATE' AND is_active = TRUE), 0.08) INTO v_bhxh_rate;
        SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'BHYT_EMPLOYEE_RATE' AND is_active = TRUE), 0.015) INTO v_bhyt_rate;
        SELECT COALESCE((SELECT numeric_value FROM public.payroll_policy_settings WHERE setting_key = 'BHTN_EMPLOYEE_RATE' AND is_active = TRUE), 0.01) INTO v_bhtn_rate;
        v_total_ins_rate := v_bhxh_rate + v_bhyt_rate + v_bhtn_rate;

        -- 1. Xóa chi tiết và bảng lương nháp cũ của kỳ nếu có (đảm bảo tính idempotent)
        DELETE FROM payroll_details WHERE payroll_id IN (SELECT payroll_id FROM payrolls WHERE salary_period = p_period AND payment_status = 'DRAFT');
        DELETE FROM payrolls WHERE salary_period = p_period AND payment_status = 'DRAFT';

        -- 2. Khởi tạo bản ghi khung (Header Skeleton) trong bảng payrolls với các cột định mức
        INSERT INTO payrolls (
            employee_id, store_id, salary_period, standard_working_days, 
            actual_working_days, paid_leave_days, unpaid_leave_days, unworked_hours,
            contract_salary, total_earnings, total_allowances, total_bonuses,
            total_insurance, total_deductions, gross_income, net_salary,
            payment_status, created_by
        )
        SELECT 
            e.employee_id,
            e.store_id,
            p_period AS salary_period,
            v_standard_days AS standard_working_days,
            GREATEST(0.0, v_standard_days - GREATEST(COALESCE(att.unpaid_leave_days, 0), COALESCE(lr.unpaid_days, 0))) AS actual_working_days,
            GREATEST(COALESCE(att.paid_leave_days, 0), COALESCE(lr.paid_days, 0)) AS paid_leave_days,
            GREATEST(COALESCE(att.unpaid_leave_days, 0), COALESCE(lr.unpaid_days, 0)) AS unpaid_leave_days,
            ROUND(
                (GREATEST(COALESCE(att.unpaid_leave_days, 0), COALESCE(lr.unpaid_days, 0)) * 8.0)
                + (COALESCE(att.total_late_early_minutes, 0) / 60.0),
                2
            ) AS unworked_hours,
            COALESCE(c.basic_salary, 8000000) AS contract_salary,
            0, 0, 0, 0, 0, 0, 0,
            'DRAFT' AS payment_status,
            p_hr_user_id AS created_by
        FROM employees e
        LEFT JOIN contracts c ON e.employee_id = c.employee_id AND c.status = 'ACTIVE'
        LEFT JOIN (
            SELECT 
                a.employee_id,
                COUNT(CASE WHEN a.status = 'NORMAL' THEN 1 END)::NUMERIC AS worked_days,
                COUNT(CASE WHEN a.status = 'ANNUAL_LEAVE' THEN 1 END)::NUMERIC AS paid_leave_days,
                COUNT(CASE WHEN a.status = 'UNPAID_LEAVE' THEN 1 END)::NUMERIC AS unpaid_leave_days,
                SUM(CASE WHEN ota.decision = 'APPROVED' THEN ota.approved_hours ELSE 0 END) AS total_ot_hours,
                SUM(a.late_minutes + a.early_minutes) AS total_late_early_minutes,
                SUM(CASE WHEN a.late_minutes > v_late_tolerance THEN v_late_penalty ELSE 0 END) AS total_late_penalty
            FROM attendances a
            LEFT JOIN attendance_overtime_approvals ota ON ota.attendance_id = a.attendance_id
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

        -- 3. BOTTOM-UP: TÍNH TOÁN VÀ GHI TRỰC TIẾP TỪNG DÒNG CẤU PHẦN VÀO payroll_details (GỐC DỮ LIỆU)

        -- 3.1. Lương hợp đồng (EARNING)
        INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
        SELECT p.payroll_id, 'CONTRACT_SALARY', 'Lương cơ bản theo hợp đồng lao động', 'EARNING',
               CONCAT('Mức lương quy định hợp đồng: ', p.contract_salary, ' đ'), p.contract_salary
        FROM payrolls p
        WHERE p.salary_period = p_period;

        -- 3.2. Khấu trừ lương cơ bản theo thời gian (DEDUCTION)
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

        -- 3.3. Tiền làm thêm giờ (EARNING) - Tính theo giờ OT đã được HR duyệt và hệ số v_ot_rate
        INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
        SELECT p.payroll_id, 'OVERTIME', 'Tiền làm thêm giờ (Tăng ca OT)', 'EARNING',
           CONCAT('Số giờ OT * (Lương CB / ', v_standard_days, ' / 8) * ', ROUND(v_ot_rate * 100, 0), '%'),
           ROUND(COALESCE(att.total_ot_hours, 0) * (p.contract_salary / v_standard_days / 8.0) * v_ot_rate, 0)
        FROM payrolls p
        JOIN (
            SELECT a.employee_id, SUM(CASE WHEN ota.decision = 'APPROVED' THEN ota.approved_hours ELSE 0 END) AS total_ot_hours
            FROM attendances a
            LEFT JOIN attendance_overtime_approvals ota ON ota.attendance_id = a.attendance_id
            WHERE TO_CHAR(a.work_date, 'YYYY-MM') = p_period
            GROUP BY a.employee_id
        ) att ON p.employee_id = att.employee_id
        WHERE p.salary_period = p_period
          AND ROUND(COALESCE(att.total_ot_hours, 0) * (p.contract_salary / v_standard_days / 8.0) * v_ot_rate, 0) > 0;

        -- 3.4. Phụ cấp chức vụ (ALLOWANCE)
        INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
        SELECT p.payroll_id, 'POSITION_ALLOWANCE', 'Phụ cấp trách nhiệm chức vụ', 'ALLOWANCE',
               'Định mức phụ cấp theo vị trí công việc đảm nhiệm',
               COALESCE(pos.position_allowance, 0)
        FROM payrolls p
        JOIN employees e ON p.employee_id = e.employee_id
        JOIN positions pos ON e.position_id = pos.position_id
        WHERE p.salary_period = p_period AND COALESCE(pos.position_allowance, 0) > 0;

        -- 3.5. Phụ cấp thâm niên (ALLOWANCE)
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

        -- 3.6. Phụ cấp dự án theo Vai trò nội bộ (ALLOWANCE)
        -- Sử dụng bảng định mức vai trò project_role_allowances (ưu tiên override_allowance nếu cá nhân có gán riêng)
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

        -- 3.7. Phụ cấp cơm trưa & xăng xe (ALLOWANCE) - Lấy động từ payroll_policy_settings
        INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
        SELECT p.payroll_id, 'MEAL_ALLOWANCE', 'Phụ cấp cơm trưa & xăng xe', 'ALLOWANCE',
               'Chế độ phúc lợi cố định toàn chuỗi', v_meal_allowance
        FROM payrolls p
        WHERE p.salary_period = p_period AND v_meal_allowance > 0;

        -- 3.8. Thưởng sự kiện & Lễ Tết theo kỳ lương (BONUS) - Lấy động từ payroll_period_bonuses
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

        -- 3.9. Thưởng năng suất theo quy định KPI (BONUS)
        INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
        SELECT p.payroll_id, 'PRODUCTIVITY_BONUS', 'Thưởng năng suất hoàn thành vượt KPI', 'BONUS',
               'Thưởng nóng đạt/vượt định mức KPI doanh số',
               comm.kpi_bonus_amount
        FROM payrolls p
        JOIN commissions comm ON p.employee_id = comm.employee_id AND comm.salary_period = p_period
        WHERE p.salary_period = p_period AND COALESCE(comm.kpi_bonus_amount, 0) > 0;

        -- 3.10. Hoa hồng bán lẻ (BONUS)
        INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
        SELECT p.payroll_id, 'COMMISSION', 'Hoa hồng bán lẻ thiết bị công nghệ', 'BONUS',
               '1% Điện thoại & Laptop + 3% Phụ kiện',
               comm.commission_amount
        FROM payrolls p
        JOIN commissions comm ON p.employee_id = comm.employee_id AND comm.salary_period = p_period
        WHERE p.salary_period = p_period AND COALESCE(comm.commission_amount, 0) > 0;

        -- 3.11. Bảo hiểm bắt buộc (DEDUCTION) - Tính theo tỷ lệ động
        INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
        SELECT p.payroll_id, 'INSURANCE', 
               CONCAT('Bảo hiểm bắt buộc (BHXH ', ROUND(v_bhxh_rate*100, 1), '%, BHYT ', ROUND(v_bhyt_rate*100, 1), '%, BHTN ', ROUND(v_bhtn_rate*100, 1), '%)'), 
               'DEDUCTION',
               CONCAT(ROUND(v_total_ins_rate * 100, 1), '% * Lương đóng bảo hiểm'),
               ROUND(COALESCE(c.insurance_salary, c.basic_salary, 5000000) * v_total_ins_rate, 0)
        FROM payrolls p
        LEFT JOIN contracts c ON p.employee_id = c.employee_id AND c.status = 'ACTIVE'
        WHERE p.salary_period = p_period;

        -- 3.12. Phạt vi phạm đi muộn (DEDUCTION) - Lấy động từ v_late_penalty và v_late_tolerance
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

        -- 4. BOTTOM-UP ROLL-UP: TỔNG HỢP TOÁN HỌC TỪ payroll_details NGƯỢC LÊN payrolls
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
