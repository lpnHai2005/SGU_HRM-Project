BEGIN;
CREATE TABLE IF NOT EXISTS fixed_schedule_rules (
 rule_id bigserial PRIMARY KEY,
 employee_id integer NOT NULL REFERENCES employees(employee_id),
 store_id integer NOT NULL REFERENCES stores(store_id),
 shift_id integer NOT NULL REFERENCES work_shifts(shift_id),
 start_date date NOT NULL, notes varchar(255) NOT NULL,
 created_by integer NOT NULL REFERENCES users(user_id),
 created_at timestamptz NOT NULL DEFAULT now(), stopped_at timestamptz,
 last_error text
);
CREATE UNIQUE INDEX IF NOT EXISTS fixed_schedule_one_active ON fixed_schedule_rules(employee_id) WHERE stopped_at IS NULL;
ALTER TABLE work_schedules ADD COLUMN IF NOT EXISTS fixed_rule_id bigint REFERENCES fixed_schedule_rules(rule_id);
CREATE UNIQUE INDEX IF NOT EXISTS fixed_schedule_occurrence ON work_schedules(fixed_rule_id,work_date) WHERE fixed_rule_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS fixed_schedule_audits (
 audit_id bigserial PRIMARY KEY, rule_id bigint NOT NULL REFERENCES fixed_schedule_rules(rule_id),
 actor_id integer NOT NULL, action text NOT NULL, reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
