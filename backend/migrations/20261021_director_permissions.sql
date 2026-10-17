-- Migration: Assign default permissions to DIRECTOR role
-- Date: 2026-10-21
-- Purpose: Grant standard supervisory and approval permissions to DIRECTOR in role_permissions table

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_code = 'DIRECTOR'
  AND p.permission_code IN (
    'employee:view_all',
    'payroll:view_all',
    'report:demographics',
    'report:hr_monthly',
    'audit:view',
    'store:view_own',
    'leave:approve_hr'
  )
ON CONFLICT DO NOTHING;
