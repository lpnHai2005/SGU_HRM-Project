-- Migration: Add DIRECTOR role and related data for leave/resignation approval workflow
-- Date: 2026-10-20
-- Purpose: Implement No Self-Approval principle - HR/Admin leave requests must be approved by DIRECTOR

-- 1. Thêm role DIRECTOR vào bảng roles
INSERT INTO roles (role_code, role_name, description)
VALUES ('DIRECTOR', 'Giám đốc', 'Quản lý cấp cao nhất - phê duyệt đơn nghỉ/thôi việc của HR và Admin')
ON CONFLICT (role_code) DO NOTHING;

-- 2. Thêm position DIRECTOR vào bảng positions
INSERT INTO positions (position_code, position_name, base_salary_min, base_salary_max, position_allowance, position_coefficient, is_store_role)
VALUES ('DIRECTOR', 'Giám đốc', 50000000, 100000000, 10000000, 3.0, false)
ON CONFLICT (position_code) DO NOTHING;

-- 3. Thêm department Ban Giám đốc (BGD)
INSERT INTO departments (department_code, department_name, parent_id, is_active)
VALUES ('BGD', 'Ban Giám đốc', NULL, true)
ON CONFLICT (department_code) DO NOTHING;

-- 4. Thêm cột director_approver_id vào leave_requests để theo dõi ai duyệt (HR hay DIRECTOR)
ALTER TABLE leave_requests
ADD COLUMN IF NOT EXISTS director_approver_id INTEGER REFERENCES employees(employee_id);
ALTER TABLE leave_requests
ADD COLUMN IF NOT EXISTS director_approved_at TIMESTAMP WITH TIME ZONE;

-- 5. Tạo employee record cho Giám đốc (full_name là generated column nên không cần insert)
-- Check xem đã có education_level chưa, nếu chưa tạo mới
INSERT INTO education_levels (level_code, level_name, description)
VALUES ('UNIV', 'Đại học', 'Trình độ Đại học')
ON CONFLICT (level_code) DO NOTHING;

INSERT INTO employees (
    employee_code, first_name, last_name,
    gender, dob, identity_card, phone,
    personal_email, company_email,
    current_address, department_id, position_id,
    education_level_id, join_date, employment_status
) VALUES (
    'TZ-DIR', 'Nguyễn', 'Văn Giám Đốc',
    'MALE', '1980-01-01', '000000000001', '0909000001',
    'director@techzone.vn', 'director@techzone.vn',
    'Hà Nội',
    (SELECT department_id FROM departments WHERE department_code = 'BGD'),
    (SELECT position_id FROM positions WHERE position_code = 'DIRECTOR'),
    (SELECT COALESCE(
        (SELECT education_level_id FROM education_levels WHERE level_code = 'UNIV'),
        (SELECT education_level_id FROM education_levels LIMIT 1)
    )),
    '2024-01-01', 'ACTIVE'
) ON CONFLICT (employee_code) DO NOTHING;

-- 6. Tạo user account cho Giám đốc với password: 123456
-- Bcrypt hash for '123456': $2b$12$k2MmJ.m3rfIqhI6BjdWsceOmzNwWxDgMqkcLe9c8QpK/kiuMcldt6
INSERT INTO users (username, password_hash, email, phone, employee_id, is_active)
VALUES (
    'director',
    '$2b$12$k2MmJ.m3rfIqhI6BjdWsceOmzNwWxDgMqkcLe9c8QpK/kiuMcldt6',
    'director@techzone.vn',
    '0909000001',
    (SELECT employee_id FROM employees WHERE employee_code = 'TZ-DIR'),
    true
) ON CONFLICT (username) DO NOTHING;

-- 7. Gán role DIRECTOR cho user director
INSERT INTO user_roles (user_id, role_id, assigned_by)
SELECT
    u.user_id, r.role_id, 1
FROM users u
CROSS JOIN roles r
WHERE u.username = 'director' AND r.role_code = 'DIRECTOR'
ON CONFLICT DO NOTHING;

-- 8. Cập nhật comment cho resignation_requests status
COMMENT ON COLUMN resignation_requests.status IS 'PENDING, APPROVED, REJECTED, CANCELLED';
