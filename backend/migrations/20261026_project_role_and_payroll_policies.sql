-- =========================================================================
-- MIGRATION: 20261026_project_role_and_payroll_policies.sql
-- Mô tả: Chuẩn hóa Phụ cấp Dự án theo Vai trò Nội bộ & Động hóa Chính sách Lương
-- =========================================================================

-- 1. DANH MỤC VAI TRÒ NỘI BỘ DỰ ÁN (project_roles)
CREATE TABLE IF NOT EXISTS public.project_roles (
    role_code VARCHAR(50) PRIMARY KEY,
    role_name VARCHAR(100) NOT NULL,
    description TEXT,
    display_order INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Seed danh mục vai trò dự án chuẩn
INSERT INTO public.project_roles (role_code, role_name, description, display_order) VALUES
('PROJECT_LEAD', 'Trưởng dự án (Project Lead)', 'Chịu trách nhiệm toàn diện về tiến độ và kết quả dự án', 1),
('TECH_LEAD', 'Trưởng nhóm Kỹ thuật (Tech Lead)', 'Phụ trách giải pháp kỹ thuật, triển khai công nghệ', 2),
('CORE_MEMBER', 'Thành viên Nòng cốt (Core Member)', 'Trực tiếp thực thi các gói công việc trọng yếu', 3),
('KEY_MEMBER', 'Thành viên Chủ chốt (Key Member)', 'Tham gia phụ trách các nhiệm vụ quan trọng của chiến dịch', 4),
('MEMBER', 'Thành viên (Member)', 'Tham gia hỗ trợ thực hiện nhiệm vụ được giao', 5)
ON CONFLICT (role_code) DO UPDATE SET 
    role_name = EXCLUDED.role_name,
    description = EXCLUDED.description,
    display_order = EXCLUDED.display_order;

-- 2. ĐỊNH MỨC PHỤ CẤP THEO VAI TRÒ DỰ ÁN (project_role_allowances)
CREATE TABLE IF NOT EXISTS public.project_role_allowances (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES public.projects(project_id) ON DELETE CASCADE,
    role_code VARCHAR(50) NOT NULL REFERENCES public.project_roles(role_code) ON UPDATE CASCADE,
    allowance_amount NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (allowance_amount >= 0),
    notes VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_project_role_allowance UNIQUE (project_id, role_code)
);

CREATE INDEX IF NOT EXISTS idx_project_role_allowances_prj ON public.project_role_allowances(project_id);

-- Migrate / Seed định mức từ các thành viên dự án hiện có
INSERT INTO public.project_role_allowances (project_id, role_code, allowance_amount, notes)
SELECT pm.project_id, pm.project_role, MAX(pm.project_allowance), 'Định mức khởi tạo từ dữ liệu thành viên hiện hữu'
FROM public.project_members pm
WHERE pm.project_role IS NOT NULL
GROUP BY pm.project_id, pm.project_role
ON CONFLICT (project_id, role_code) DO UPDATE SET 
    allowance_amount = EXCLUDED.allowance_amount;

-- Đảm bảo các vai trò chuẩn khác trong dự án nếu chưa có thì có mức mặc định hợp lý
INSERT INTO public.project_role_allowances (project_id, role_code, allowance_amount, notes)
SELECT p.project_id, 'MEMBER', 500000.00, 'Định mức thành viên thông thường'
FROM public.projects p
ON CONFLICT (project_id, role_code) DO NOTHING;

-- 3. CẤU HÌNH THAM SỐ CHÍNH SÁCH LƯƠNG DOANH NGHIỆP (payroll_policy_settings)
CREATE TABLE IF NOT EXISTS public.payroll_policy_settings (
    setting_id SERIAL PRIMARY KEY,
    setting_key VARCHAR(50) UNIQUE NOT NULL,
    setting_name VARCHAR(150) NOT NULL,
    setting_group VARCHAR(50) NOT NULL,
    numeric_value NUMERIC(15, 2) NOT NULL,
    unit VARCHAR(20) DEFAULT 'VND',
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER REFERENCES public.users(user_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_policy_settings_group ON public.payroll_policy_settings(setting_group);

INSERT INTO public.payroll_policy_settings (setting_key, setting_name, setting_group, numeric_value, unit, description) VALUES
('LATE_TOLERANCE_MINUTES', 'Thời gian trễ cho phép tối đa', 'PENALTY', 15.0, 'PHUT', 'Số phút đi trễ tối đa không bị trừ tiền phạt vi phạm'),
('LATE_PENALTY_AMOUNT', 'Tiền phạt mỗi lần đi trễ quá hạn', 'PENALTY', 50000.0, 'VND', 'Số tiền phạt trừ vào lương cho mỗi lần vi phạm check-in trễ quá hạn'),
('MEAL_TRANSPORT_ALLOWANCE', 'Phụ cấp cơm trưa và xăng xe', 'ALLOWANCE', 1000000.0, 'VND', 'Mức phụ cấp sinh hoạt cố định hàng tháng cho nhân sự toàn chuỗi'),
('STANDARD_WORKING_DAYS', 'Định mức ngày công chuẩn tháng', 'ATTENDANCE', 26.0, 'NGAY', 'Số ngày làm việc tiêu chuẩn định mức trong một tháng'),
('OVERTIME_RATE_NORMAL', 'Hệ số lương làm thêm giờ ngày thường', 'ATTENDANCE', 1.5, 'HE_SO', 'Tỷ lệ trả lương tăng ca theo Luật Lao động (150%)'),
('BHXH_EMPLOYEE_RATE', 'Tỷ lệ đóng BHXH người lao động', 'INSURANCE', 0.08, 'TY_LE', 'Bảo hiểm Xã hội trích nộp từ lương nhân viên (8%)'),
('BHYT_EMPLOYEE_RATE', 'Tỷ lệ đóng BHYT người lao động', 'INSURANCE', 0.015, 'TY_LE', 'Bảo hiểm Y tế trích nộp từ lương nhân viên (1.5%)'),
('BHTN_EMPLOYEE_RATE', 'Tỷ lệ đóng BHTN người lao động', 'INSURANCE', 0.01, 'TY_LE', 'Bảo hiểm Thất nghiệp trích nộp từ lương nhân viên (1%)')
ON CONFLICT (setting_key) DO UPDATE SET
    numeric_value = EXCLUDED.numeric_value,
    setting_name = EXCLUDED.setting_name,
    setting_group = EXCLUDED.setting_group,
    unit = EXCLUDED.unit,
    description = EXCLUDED.description;

-- 4. QUY CHẾ THƯỞNG LỄ, TẾT & SỰ KIỆN THEO KỲ LƯƠNG (payroll_period_bonuses)
CREATE TABLE IF NOT EXISTS public.payroll_period_bonuses (
    bonus_id SERIAL PRIMARY KEY,
    salary_period VARCHAR(7) NOT NULL,
    bonus_code VARCHAR(50) NOT NULL,
    bonus_name VARCHAR(150) NOT NULL,
    calculation_type VARCHAR(30) NOT NULL, -- 'FIXED_AMOUNT', 'COEFFICIENT', 'CONTRACT_SALARY'
    base_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
    applies_to VARCHAR(50) DEFAULT 'ALL',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER REFERENCES public.users(user_id),
    CONSTRAINT uq_period_bonus_item UNIQUE (salary_period, bonus_code)
);

CREATE INDEX IF NOT EXISTS idx_payroll_period_bonuses_period ON public.payroll_period_bonuses(salary_period);

-- Seed mẫu thưởng lễ 2/9 cho kỳ 2026-09 và thưởng Tết cho kỳ 2026-02
INSERT INTO public.payroll_period_bonuses (salary_period, bonus_code, bonus_name, calculation_type, base_amount, applies_to) VALUES
('2026-09', 'HOLIDAY_BONUS', 'Thưởng Lễ Quốc khánh 2/9', 'COEFFICIENT', 1000000.0, 'ALL'),
('2026-02', 'TET_BONUS', 'Thưởng Tết Nguyên Đán Bính Ngọ 2026', 'COEFFICIENT', 5000000.0, 'ALL')
ON CONFLICT (salary_period, bonus_code) DO NOTHING;
