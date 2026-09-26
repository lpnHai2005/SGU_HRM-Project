-- Multiple sessions per day; preserves every existing attendance row.
BEGIN;
ALTER TABLE attendances DROP CONSTRAINT IF EXISTS uq_attendance;
ALTER TABLE attendances DROP CONSTRAINT IF EXISTS attendances_status_check;
ALTER TABLE attendances ADD CONSTRAINT attendances_status_check CHECK (status IN (
    'NORMAL', 'LATE', 'EARLY', 'LATE_AND_EARLY', 'OVERTIME', 'ABSENT',
    'ANNUAL_LEAVE', 'SICK_LEAVE', 'UNPAID_LEAVE', 'MATERNITY_LEAVE'
));
-- Fail safely if legacy data contains multiple open sessions; do not delete history.
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_open_session ON attendances(employee_id)
    WHERE check_in_time IS NOT NULL AND check_out_time IS NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_session_history
    ON attendances(employee_id, check_in_time DESC, attendance_id DESC);
COMMIT;
