-- Additive OT request workflow. Apply in a transaction before deploying OT request API.
-- Existing attendance_overtime_approvals and attendance/payroll data are untouched.
CREATE TABLE IF NOT EXISTS overtime_requests (
    request_id BIGSERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(employee_id),
    store_id INTEGER NOT NULL REFERENCES stores(store_id),
    work_date DATE NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    reason TEXT NOT NULL CHECK (length(trim(reason)) >= 3),
    created_by INTEGER NOT NULL REFERENCES users(user_id),
    idempotency_key VARCHAR(100),
    idempotency_payload JSONB,
    status VARCHAR(40) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT','PENDING_EMPLOYEE_CONFIRMATION','PENDING_HR','APPROVED','REJECTED','EMPLOYEE_DECLINED','CANCELLED')),
    employee_confirmed_at TIMESTAMPTZ,
    employee_responded_at TIMESTAMPTZ,
    reviewed_by INTEGER REFERENCES users(user_id),
    reviewed_at TIMESTAMPTZ,
    rejection_reason TEXT,
    cancelled_by INTEGER REFERENCES users(user_id),
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CHECK (ends_at > starts_at),
    CHECK (status <> 'APPROVED' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
    CHECK (status <> 'REJECTED' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND length(trim(COALESCE(rejection_reason,''))) >= 3)),
    CHECK (status <> 'CANCELLED' OR (cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL))
);

ALTER TABLE overtime_requests ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(100);
ALTER TABLE overtime_requests ADD COLUMN IF NOT EXISTS idempotency_payload JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS uq_overtime_requests_creator_idempotency
    ON overtime_requests(created_by,idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_overtime_requests_employee_interval
    ON overtime_requests(employee_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS ix_overtime_requests_status_date
    ON overtime_requests(status, work_date, store_id);
CREATE INDEX IF NOT EXISTS ix_overtime_requests_store_date
    ON overtime_requests(store_id, work_date, request_id);

CREATE TABLE IF NOT EXISTS overtime_request_events (
    event_id BIGSERIAL PRIMARY KEY,
    request_id BIGINT NOT NULL REFERENCES overtime_requests(request_id),
    actor_id INTEGER NOT NULL REFERENCES users(user_id),
    action VARCHAR(40) NOT NULL,
    from_status VARCHAR(40),
    to_status VARCHAR(40) NOT NULL,
    reason TEXT,
    old_values JSONB,
    new_values JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ix_overtime_request_events_request
    ON overtime_request_events(request_id, event_id);

COMMENT ON TABLE overtime_requests IS 'Proposed overtime workflow independent from attendance actual time and payroll approval rows.';
COMMENT ON TABLE overtime_request_events IS 'Append-only status transition and change audit for overtime requests.';

