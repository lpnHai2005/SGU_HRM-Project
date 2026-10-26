-- REVIEW-ONLY Payroll v2 candidate generated from the installed local baseline.
-- NOT a production migration. Run only in the disposable schema-only candidate DB.
-- Source DB: mission9_synthetic at 127.0.0.1:5432; read-only extraction.
-- Source signature: sp_generate_monthly_payroll(character varying,integer)
-- Source SHA-256: c4b02a2a3cf126f92c5418286bd6e5b6d43583eb02b25cc0255cfc3ba12a5d28
-- The installed formula is preserved; only its OT input is replaced by prepared
-- VERIFIED_ONLY ledger microseconds. API integration and formal production DDL
-- are intentionally not part of this candidate artifact.
BEGIN;
ALTER TABLE public.payrolls
  ADD COLUMN IF NOT EXISTS payroll_ot_candidate_run_id BIGINT
  REFERENCES public.ot9_candidate_source_runs(run_id);

CREATE TABLE IF NOT EXISTS public.payroll_finalization_snapshots (
  snapshot_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payroll_id BIGINT NOT NULL REFERENCES public.payrolls(payroll_id),
  employee_id INTEGER NOT NULL REFERENCES public.employees(employee_id),
  salary_period VARCHAR NOT NULL,
  finalized_status VARCHAR NOT NULL CHECK (finalized_status IN ('CONFIRMED','PAID')),
  payment_date DATE,
  revision INTEGER NOT NULL,
  payroll_snapshot JSONB NOT NULL,
  details_snapshot JSONB NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(payroll_id, revision)
);

CREATE OR REPLACE FUNCTION public.ot9_candidate_reject_snapshot_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Finalization snapshots are append-only';
END; $$;
DROP TRIGGER IF EXISTS trg_ot9_candidate_snapshots_immutable ON public.payroll_finalization_snapshots;
CREATE TRIGGER trg_ot9_candidate_snapshots_immutable
  BEFORE UPDATE OR DELETE ON public.payroll_finalization_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.ot9_candidate_reject_snapshot_mutation();

CREATE OR REPLACE FUNCTION public.ot9_candidate_capture_finalization()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_revision INTEGER;
BEGIN
  IF NEW.payment_status IN ('CONFIRMED','PAID') AND NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    IF OLD.payment_status='PAID' THEN
      RAISE EXCEPTION 'PAID payroll is immutable';
    END IF;
    IF OLD.payment_status='CONFIRMED' AND NEW.payment_status<>'PAID' THEN
      RAISE EXCEPTION 'CONFIRMED payroll may only transition to PAID';
    END IF;
    IF OLD.payment_status='CONFIRMED' AND NEW.payment_status='PAID'
       AND NOT EXISTS (SELECT 1 FROM public.payroll_finalization_snapshots s WHERE s.payroll_id=NEW.payroll_id) THEN
      INSERT INTO public.payroll_finalization_snapshots(
        payroll_id,employee_id,salary_period,finalized_status,payment_date,revision,
        payroll_snapshot,details_snapshot)
      SELECT OLD.payroll_id,OLD.employee_id,OLD.salary_period,'CONFIRMED',OLD.payment_date,1,
        to_jsonb(OLD),
        COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.detail_id)
          FROM public.payroll_details d WHERE d.payroll_id=OLD.payroll_id),'[]'::jsonb);
    END IF;
    SELECT COALESCE(MAX(revision),0)+1 INTO v_revision
      FROM public.payroll_finalization_snapshots WHERE payroll_id=NEW.payroll_id;
    INSERT INTO public.payroll_finalization_snapshots(
      payroll_id,employee_id,salary_period,finalized_status,payment_date,revision,
      payroll_snapshot,details_snapshot)
    SELECT NEW.payroll_id,NEW.employee_id,NEW.salary_period,NEW.payment_status,NEW.payment_date,v_revision,
      to_jsonb(NEW),
      COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.detail_id)
        FROM public.payroll_details d WHERE d.payroll_id=NEW.payroll_id),'[]'::jsonb);
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.ot9_candidate_guard_finalized_payroll()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.payment_status<>'DRAFT' THEN
      RAISE EXCEPTION 'New payroll must start as DRAFT';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    IF OLD.payment_status IN ('CONFIRMED','PAID')
       OR EXISTS (SELECT 1 FROM public.payroll_finalization_snapshots s WHERE s.payroll_id=OLD.payroll_id) THEN
      RAISE EXCEPTION 'Finalized payroll cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.payment_status='PAID' THEN RAISE EXCEPTION 'PAID payroll is immutable'; END IF;
  IF OLD.payment_status='DRAFT' AND NEW.payment_status NOT IN ('DRAFT','CONFIRMED') THEN
    RAISE EXCEPTION 'DRAFT payroll may only remain DRAFT or become CONFIRMED';
  END IF;
  IF OLD.payment_status='CONFIRMED'
     OR EXISTS (SELECT 1 FROM public.payroll_finalization_snapshots s WHERE s.payroll_id=OLD.payroll_id) THEN
    IF (to_jsonb(NEW)-ARRAY['payment_status','payment_date','updated_at','total_insurance']::text[])
       IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['payment_status','payment_date','updated_at','total_insurance']::text[]) THEN
      RAISE EXCEPTION 'Finalized payroll amounts are immutable';
    END IF;
    IF OLD.payment_status='CONFIRMED' AND NEW.payment_status NOT IN ('CONFIRMED','PAID') THEN
      RAISE EXCEPTION 'CONFIRMED payroll cannot be reopened for deletion or recalculation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_ot9_candidate_guard_payroll ON public.payrolls;
CREATE TRIGGER trg_ot9_candidate_guard_payroll
  BEFORE INSERT OR UPDATE OR DELETE ON public.payrolls
  FOR EACH ROW EXECUTE FUNCTION public.ot9_candidate_guard_finalized_payroll();
DROP TRIGGER IF EXISTS trg_ot9_candidate_capture_finalization ON public.payrolls;
CREATE TRIGGER trg_ot9_candidate_capture_finalization
  AFTER UPDATE OF payment_status ON public.payrolls
  FOR EACH ROW EXECUTE FUNCTION public.ot9_candidate_capture_finalization();

CREATE OR REPLACE FUNCTION public.ot9_candidate_guard_payroll_detail()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_payroll_id BIGINT; v_status TEXT;
BEGIN
  v_payroll_id := CASE WHEN TG_OP='DELETE' THEN OLD.payroll_id ELSE NEW.payroll_id END;
  SELECT payment_status INTO v_status FROM public.payrolls WHERE payroll_id=v_payroll_id FOR UPDATE;
  IF v_status IN ('CONFIRMED','PAID')
     OR EXISTS (SELECT 1 FROM public.payroll_finalization_snapshots s WHERE s.payroll_id=v_payroll_id) THEN
    RAISE EXCEPTION 'Details of a finalized payroll are immutable';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;
DROP TRIGGER IF EXISTS trg_ot9_candidate_guard_payroll_detail ON public.payroll_details;
CREATE TRIGGER trg_ot9_candidate_guard_payroll_detail
  BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_details
  FOR EACH ROW EXECUTE FUNCTION public.ot9_candidate_guard_payroll_detail();

CREATE OR REPLACE PROCEDURE public.sp_generate_monthly_payroll_verified_candidate(IN p_period character varying, IN p_hr_user_id integer, IN p_source_run_id bigint)
 LANGUAGE plpgsql
AS $procedure$
DECLARE
    v_standard_days NUMERIC(4, 1) := 26.0;
    v_period_date DATE := TO_DATE(p_period || '-01', 'YYYY-MM-DD');
    v_source_run ot9_candidate_source_runs%ROWTYPE;
    v_source_ready BOOLEAN;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('payroll:' || p_period, 0));
    SELECT * INTO v_source_run
      FROM ot9_candidate_source_runs WHERE run_id=p_source_run_id FOR SHARE;
    IF NOT FOUND OR v_source_run.status <> 'PREPARED'
       OR v_source_run.period_start <> v_period_date
       OR v_source_run.period_end <> (v_period_date + INTERVAL '1 month')::date THEN
        RAISE EXCEPTION 'OT_PAYROLL_SOURCE_HOLD: no prepared VERIFIED_ONLY source run for period';
    END IF;
    SELECT preliminarily_ready INTO v_source_ready
      FROM ot9_candidate_source_gate WHERE run_id=p_source_run_id;
    IF NOT COALESCE(v_source_ready,FALSE)
       OR ot9_candidate_source_fingerprint(p_source_run_id) IS DISTINCT FROM v_source_run.source_fingerprint THEN
        RAISE EXCEPTION 'OT_PAYROLL_SOURCE_STALE: source run is incomplete or changed';
    END IF;
    IF EXISTS (SELECT 1 FROM payrolls
               WHERE salary_period=p_period AND payment_status <> 'DRAFT')
       OR EXISTS (SELECT 1 FROM payroll_finalization_snapshots
                  WHERE salary_period=p_period) THEN
        RAISE EXCEPTION 'PAYROLL_FINALIZED_PERIOD_IMMUTABLE: use a separately approved adjustment workflow';
    END IF;
    -- Xóa chi tiết và bảng lương nháp cũ của kỳ nếu có để tính lại (hoặc đã có khi chạy lại)
    DELETE FROM payroll_details WHERE payroll_id IN (SELECT payroll_id FROM payrolls WHERE salary_period = p_period AND payment_status = 'DRAFT');
    DELETE FROM payrolls WHERE salary_period = p_period AND payment_status = 'DRAFT';

    -- Chèn bản ghi lương mới
    INSERT INTO payrolls (
        employee_id, store_id, salary_period, standard_working_days, 
        actual_working_days, paid_leave_days, unpaid_leave_days, unworked_hours,
        contract_salary, time_deduction_amount, actual_base_salary, overtime_salary, 
        position_allowance, seniority_allowance, project_allowance, meal_transport_allowance,
        commission_amount, holiday_bonus, productivity_bonus, bonus_amount,
        gross_income, bhxh_amount, bhyt_amount, bhtn_amount, 
        personal_income_tax, penalty_deduction, total_deduction, net_salary, 
        payment_status, created_by, payroll_ot_candidate_run_id
    )
    SELECT 
        e.employee_id,
        e.store_id,
        p_period AS salary_period,
        v_standard_days AS standard_working_days,
        -- Ngày công thực tế = Công chuẩn (26) trừ đi ngày nghỉ không lương
        GREATEST(0.0, v_standard_days - GREATEST(COALESCE(att.unpaid_leave_days, 0), COALESCE(lr.unpaid_days, 0))) AS actual_working_days,
        GREATEST(COALESCE(att.paid_leave_days, 0), COALESCE(lr.paid_days, 0)) AS paid_leave_days,
        GREATEST(COALESCE(att.unpaid_leave_days, 0), COALESCE(lr.unpaid_days, 0)) AS unpaid_leave_days,
        -- Tổng giờ làm việc thiếu: Nghỉ không lương (8h/ngày) + số phút đi trễ quy đổi ra giờ
        ROUND(
            (GREATEST(COALESCE(att.unpaid_leave_days, 0), COALESCE(lr.unpaid_days, 0)) * 8.0)
            + (COALESCE(att.total_late_early_minutes, 0) / 60.0),
            2
        ) AS unworked_hours,
        COALESCE(c.basic_salary, 8000000) AS contract_salary,
        -- Lương cơ bản bị trừ dựa vào thời gian: (ngày nghỉ ko lương * lương ngày) + (giờ đi trễ * lương giờ)
        ROUND(
            (GREATEST(COALESCE(att.unpaid_leave_days, 0), COALESCE(lr.unpaid_days, 0)) * (COALESCE(c.basic_salary, 8000000) / v_standard_days))
            + ((COALESCE(att.total_late_early_minutes, 0) / 60.0) * (COALESCE(c.basic_salary, 8000000) / v_standard_days / 8.0)),
            0
        ) AS time_deduction_amount,
        -- Lương cơ bản thực nhận = contract_salary - time_deduction_amount = (contract_salary / 26) * actual_working_days (trừ đi trễ)
        GREATEST(0,
            COALESCE(c.basic_salary, 8000000) - ROUND(
                (GREATEST(COALESCE(att.unpaid_leave_days, 0), COALESCE(lr.unpaid_days, 0)) * (COALESCE(c.basic_salary, 8000000) / v_standard_days))
                + ((COALESCE(att.total_late_early_minutes, 0) / 60.0) * (COALESCE(c.basic_salary, 8000000) / v_standard_days / 8.0)),
                0
            )
        ) AS actual_base_salary,
        ROUND(COALESCE(ot.total_ot_hours, 0) * (COALESCE(c.basic_salary, 8000000) / v_standard_days / 8.0) * 1.5, 0) AS overtime_salary,
        -- 1. Phụ cấp theo chức vụ
        COALESCE(pos.position_allowance, 0) AS position_allowance,
        -- 2. Phụ cấp theo thâm niên (tính từ e.join_date: <1 năm: 0; 1-3 năm: 500k; 3-5 năm: 1M; >=5 năm: 1.5M)
        CASE 
            WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 5 THEN 1500000
            WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 3 THEN 1000000
            WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 1 THEN 500000
            ELSE 0
        END AS seniority_allowance,
        -- 3. Phụ cấp theo dự án (tổng phụ cấp các dự án nhân viên đang tham gia)
        COALESCE(pm.total_prj_allowance, 0) AS project_allowance,
        1000000 AS meal_transport_allowance,
        COALESCE(comm.commission_amount, 0) AS commission_amount,
        -- Thưởng lễ theo hệ số chức vụ (Mức cơ sở 1.000.000 VNĐ * position_coefficient)
        ROUND(1000000 * COALESCE(pos.position_coefficient, 1.00), 0) AS holiday_bonus,
        -- Thưởng năng suất theo quy định KPI
        COALESCE(comm.kpi_bonus_amount, 0) AS productivity_bonus,
        -- Tổng thưởng = Thưởng lễ hệ số + Thưởng năng suất KPI
        (ROUND(1000000 * COALESCE(pos.position_coefficient, 1.00), 0) + COALESCE(comm.kpi_bonus_amount, 0)) AS bonus_amount,
        -- Tổng thu nhập Gross = Base thực + OT + Phụ cấp CV + Thâm niên + Dự án + Cơm xe + Hoa hồng + Tổng thưởng
        (
            GREATEST(0,
                COALESCE(c.basic_salary, 8000000) - ROUND(
                    (GREATEST(COALESCE(att.unpaid_leave_days, 0), COALESCE(lr.unpaid_days, 0)) * (COALESCE(c.basic_salary, 8000000) / v_standard_days))
                    + ((COALESCE(att.total_late_early_minutes, 0) / 60.0) * (COALESCE(c.basic_salary, 8000000) / v_standard_days / 8.0)),
                    0
                )
            )
            + ROUND(COALESCE(ot.total_ot_hours, 0) * (COALESCE(c.basic_salary, 8000000) / v_standard_days / 8.0) * 1.5, 0)
            + COALESCE(pos.position_allowance, 0)
            + (CASE 
                WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 5 THEN 1500000
                WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 3 THEN 1000000
                WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 1 THEN 500000
                ELSE 0
               END)
            + COALESCE(pm.total_prj_allowance, 0)
            + 1000000
            + COALESCE(comm.commission_amount, 0)
            + (ROUND(1000000 * COALESCE(pos.position_coefficient, 1.00), 0) + COALESCE(comm.kpi_bonus_amount, 0))
        ) AS gross_income,
        -- Bảo hiểm 10.5% (BHXH 8%, BHYT 1.5%, BHTN 1%) tính trên insurance_salary hoặc basic_salary
        ROUND(COALESCE(c.insurance_salary, c.basic_salary, 5000000) * 0.08, 0) AS bhxh_amount,
        ROUND(COALESCE(c.insurance_salary, c.basic_salary, 5000000) * 0.015, 0) AS bhyt_amount,
        ROUND(COALESCE(c.insurance_salary, c.basic_salary, 5000000) * 0.01, 0) AS bhtn_amount,
        0 AS personal_income_tax,
        COALESCE(att.total_late_penalty, 0) AS penalty_deduction,
        (
            ROUND(COALESCE(c.insurance_salary, c.basic_salary, 5000000) * 0.105, 0)
            + COALESCE(att.total_late_penalty, 0)
        ) AS total_deduction,
        -- Thực lĩnh Net Salary = GROSS - Insurance (10.5%) - Penalty
        (
            (
                GREATEST(0,
                    COALESCE(c.basic_salary, 8000000) - ROUND(
                        (GREATEST(COALESCE(att.unpaid_leave_days, 0), COALESCE(lr.unpaid_days, 0)) * (COALESCE(c.basic_salary, 8000000) / v_standard_days))
                        + ((COALESCE(att.total_late_early_minutes, 0) / 60.0) * (COALESCE(c.basic_salary, 8000000) / v_standard_days / 8.0)),
                        0
                    )
                )
                + ROUND(COALESCE(ot.total_ot_hours, 0) * (COALESCE(c.basic_salary, 8000000) / v_standard_days / 8.0) * 1.5, 0)
                + COALESCE(pos.position_allowance, 0)
                + (CASE 
                    WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 5 THEN 1500000
                    WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 3 THEN 1000000
                    WHEN EXTRACT(YEAR FROM age(v_period_date, e.join_date)) >= 1 THEN 500000
                    ELSE 0
                   END)
                + COALESCE(pm.total_prj_allowance, 0)
                + 1000000
                + COALESCE(comm.commission_amount, 0)
                + (ROUND(1000000 * COALESCE(pos.position_coefficient, 1.00), 0) + COALESCE(comm.kpi_bonus_amount, 0))
            )
            - (
                ROUND(COALESCE(c.insurance_salary, c.basic_salary, 5000000) * 0.105, 0)
                + COALESCE(att.total_late_penalty, 0)
            )
        ) AS net_salary,
        'DRAFT' AS payment_status,
        p_hr_user_id AS created_by,
        p_source_run_id AS payroll_ot_candidate_run_id
    FROM employees e
    JOIN positions pos ON e.position_id = pos.position_id
    LEFT JOIN contracts c ON e.employee_id = c.employee_id AND c.status = 'ACTIVE'
    LEFT JOIN commissions comm ON e.employee_id = comm.employee_id AND comm.salary_period = p_period
    LEFT JOIN (
        SELECT 
            employee_id,
            COUNT(CASE WHEN a.status = 'NORMAL' THEN 1 END)::NUMERIC AS worked_days,
            COUNT(CASE WHEN a.status = 'ANNUAL_LEAVE' THEN 1 END)::NUMERIC AS paid_leave_days,
            COUNT(CASE WHEN a.status = 'UNPAID_LEAVE' THEN 1 END)::NUMERIC AS unpaid_leave_days,
            SUM(a.late_minutes + a.early_minutes) AS total_late_early_minutes,
            SUM(CASE WHEN a.late_minutes > 15 THEN 50000 ELSE 0 END) AS total_late_penalty
        FROM attendances a
        WHERE TO_CHAR(work_date, 'YYYY-MM') = p_period
        GROUP BY employee_id
    ) att ON e.employee_id = att.employee_id
     LEFT JOIN (
         SELECT employee_id, SUM(microseconds)::NUMERIC / 3600000000 AS total_ot_hours
         FROM ot9_candidate_verified_segments
         WHERE run_id=p_source_run_id
         GROUP BY employee_id
     ) ot ON e.employee_id = ot.employee_id
    -- LIÊN KẾT TRỰC TIẾP VỚI MODULE NGHỈ PHÉP (LEAVE REQUESTS HR_APPROVED)
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
    LEFT JOIN (
        SELECT employee_id, SUM(project_allowance) AS total_prj_allowance
        FROM project_members
        WHERE is_active = TRUE
        GROUP BY employee_id
    ) pm ON e.employee_id = pm.employee_id
    WHERE e.employment_status IN ('ACTIVE', 'PROBATION');

    -- Tự động sinh chi tiết cách tính lương vào bảng payroll_details để nhân viên xem (III.3.2.3)
    -- 1. Lương hợp đồng
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'CONTRACT_SALARY', 'Lương cơ bản theo hợp đồng lao động', 'EARNING', 
           CONCAT('Mức lương quy định hợp đồng: ', p.contract_salary, ' đ'), p.contract_salary
    FROM payrolls p WHERE p.salary_period = p_period;

    -- 2. Khấu trừ lương cơ bản theo thời gian (nếu có thiếu giờ/nghỉ ko lương)
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'BASE_SALARY_DEDUCTION', 'Khấu trừ lương cơ bản dựa vào thời gian', 'DEDUCTION', 
           CONCAT('Thiếu ', p.unworked_hours, ' giờ (gồm ', p.unpaid_leave_days, ' ngày nghỉ không hưởng lương & đi trễ) - Công thức: (Lương HĐ / 26) * Ngày nghỉ'), p.time_deduction_amount
    FROM payrolls p WHERE p.salary_period = p_period AND p.time_deduction_amount > 0;

    -- 3. Tiền tăng ca OT
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'OVERTIME', 'Tiền làm thêm giờ (Tăng ca OT)', 'EARNING', 
           'Số giờ OT * (Lương CB / 26 / 8) * 150%', p.overtime_salary
    FROM payrolls p WHERE p.salary_period = p_period AND p.overtime_salary > 0;

    -- 4. Phụ cấp chức vụ
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'POSITION_ALLOWANCE', 'Phụ cấp trách nhiệm chức vụ', 'ALLOWANCE', 
           'Định mức phụ cấp theo vị trí công việc đảm nhiệm', p.position_allowance
    FROM payrolls p WHERE p.salary_period = p_period AND p.position_allowance > 0;

    -- 5. Phụ cấp thâm niên
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'SENIORITY_ALLOWANCE', 'Phụ cấp thâm niên công tác', 'ALLOWANCE', 
           'Chính sách đãi ngộ thâm niên TechZone', p.seniority_allowance
    FROM payrolls p WHERE p.salary_period = p_period AND p.seniority_allowance > 0;

    -- 6. Phụ cấp dự án
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'PROJECT_ALLOWANCE', 'Phụ cấp tham gia dự án & chiến dịch', 'ALLOWANCE', 
           'Phụ cấp theo vai trò thành viên các dự án chuỗi bán lẻ đang chạy', p.project_allowance
    FROM payrolls p WHERE p.salary_period = p_period AND p.project_allowance > 0;

    -- 7. Phụ cấp cơm trưa xăng xe
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'MEAL_ALLOWANCE', 'Phụ cấp cơm trưa & xăng xe', 'ALLOWANCE', 
           'Chế độ phúc lợi cố định', p.meal_transport_allowance
    FROM payrolls p WHERE p.salary_period = p_period;

    -- 8. Thưởng lễ theo hệ số chức vụ
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'HOLIDAY_BONUS', 'Thưởng lễ theo hệ số chức vụ (Quốc khánh 2/9)', 'BONUS', 
           CONCAT('1.000.000 VNĐ cơ sở * Hệ số chức vụ = ', p.holiday_bonus, ' đ'), p.holiday_bonus
    FROM payrolls p WHERE p.salary_period = p_period AND p.holiday_bonus > 0;

    -- 9. Thưởng năng suất theo quy định KPI
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'PRODUCTIVITY_BONUS', 'Thưởng năng suất hoàn thành vượt KPI', 'BONUS', 
           'Thưởng nóng đạt/vượt định mức KPI doanh số', p.productivity_bonus
    FROM payrolls p WHERE p.salary_period = p_period AND p.productivity_bonus > 0;

    -- 10. Hoa hồng bán lẻ
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'COMMISSION', 'Hoa hồng bán lẻ thiết bị công nghệ', 'BONUS', 
           '1% Điện thoại & Laptop + 3% Phụ kiện', p.commission_amount
    FROM payrolls p WHERE p.salary_period = p_period AND p.commission_amount > 0;

    -- 11. Bảo hiểm bắt buộc
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'INSURANCE', 'Bảo hiểm bắt buộc (BHXH 8%, BHYT 1.5%, BHTN 1%)', 'DEDUCTION', 
           '10.5% * Lương đóng bảo hiểm', (p.bhxh_amount + p.bhyt_amount + p.bhtn_amount)
    FROM payrolls p WHERE p.salary_period = p_period;

    -- 12. Phạt vi phạm đi muộn
    INSERT INTO payroll_details (payroll_id, item_code, item_name, item_type, calculation_formula, amount)
    SELECT p.payroll_id, 'PENALTY', 'Phạt vi phạm quy chế chấm công (Đi muộn > 15 phút)', 'DEDUCTION', 
           '50.000 VNĐ / lần đi muộn', p.penalty_deduction
    FROM payrolls p WHERE p.salary_period = p_period AND p.penalty_deduction > 0;
END;
$procedure$;
COMMIT;
