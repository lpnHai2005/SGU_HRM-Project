-- Thời giờ làm việc trên hợp đồng: chỉ nhận 40 / 44 / 48 giờ/tuần.
-- fn_employee_daily_standard_hours dùng giá trị này / 6 làm giờ chuẩn/ngày cho lương giờ, OT, trừ giờ.
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS working_hours_per_week INTEGER DEFAULT 48;
UPDATE contracts SET working_hours_per_week = 48 WHERE working_hours_per_week IS NULL;
ALTER TABLE contracts ALTER COLUMN working_hours_per_week SET NOT NULL;
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS chk_contracts_working_hours_per_week;
ALTER TABLE contracts ADD CONSTRAINT chk_contracts_working_hours_per_week
    CHECK (working_hours_per_week IN (40, 44, 48));
COMMENT ON COLUMN contracts.working_hours_per_week IS 'Thời giờ làm việc (giờ/tuần): 40, 44 hoặc 48';
