-- Migration: Update uq_attendance_open_session unique index
-- Scope unique open session to (employee_id, work_date)
-- Allows historical overdue open sessions to remain unclosed while pending HR resolution
-- without blocking new check-in sessions on new work dates.

BEGIN;

DROP INDEX IF EXISTS uq_attendance_open_session;

CREATE UNIQUE INDEX uq_attendance_open_session ON attendances(employee_id, work_date)
    WHERE check_in_time IS NOT NULL AND check_out_time IS NULL;

COMMIT;
