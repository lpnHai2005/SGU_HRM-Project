-- Run atomically before deploying the Work Schedule API.
ALTER TABLE work_schedules ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE work_schedules ADD COLUMN IF NOT EXISTS starts_at timestamptz;
ALTER TABLE work_schedules ADD COLUMN IF NOT EXISTS ends_at timestamptz;
UPDATE work_schedules w SET
 starts_at=(w.work_date+s.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh',
 ends_at=(w.work_date+s.end_time+CASE WHEN s.end_time<=s.start_time THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE 'Asia/Ho_Chi_Minh'
FROM work_shifts s WHERE s.shift_id=w.shift_id AND w.starts_at IS NULL;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM work_schedules a JOIN work_schedules b
 ON a.employee_id=b.employee_id AND a.schedule_id<b.schedule_id
 AND a.cancelled_at IS NULL AND b.cancelled_at IS NULL
 AND a.starts_at<b.ends_at AND b.starts_at<a.ends_at) THEN
 RAISE EXCEPTION 'Existing schedule overlap; reconcile source data before migration';
 END IF;
END $$;
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='work_schedules'::regclass AND contype='u'
 AND pg_get_constraintdef(oid) = 'UNIQUE (employee_id, work_date)'
 LOOP EXECUTE format('ALTER TABLE work_schedules DROP CONSTRAINT %I',c.conname); END LOOP;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS work_schedules_active_assignment
 ON work_schedules(employee_id,work_date,shift_id) WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS work_schedules_calendar ON work_schedules(work_date,employee_id,schedule_id);
CREATE TABLE IF NOT EXISTS work_schedule_audits (
 audit_id bigserial PRIMARY KEY, schedule_id bigint NOT NULL REFERENCES work_schedules(schedule_id),
 actor_id integer NOT NULL, action varchar(20) NOT NULL, reason text NOT NULL,
 old_values jsonb, new_values jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
