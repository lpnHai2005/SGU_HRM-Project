-- Migration: Add weekdays and end_date columns to fixed_schedule_rules
BEGIN;
ALTER TABLE fixed_schedule_rules ADD COLUMN IF NOT EXISTS weekdays varchar(50) DEFAULT '1,2,3,4,5,6';
ALTER TABLE fixed_schedule_rules ADD COLUMN IF NOT EXISTS end_date date;
COMMIT;
