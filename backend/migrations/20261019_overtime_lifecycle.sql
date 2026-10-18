-- Additive lifecycle support for approved OT revocation and linked amendments.
-- This migration preserves all request/event rows and never touches Attendance/Payroll.
ALTER TABLE overtime_requests
    ADD COLUMN IF NOT EXISTS request_type VARCHAR(20) NOT NULL DEFAULT 'STANDARD',
    ADD COLUMN IF NOT EXISTS parent_request_id BIGINT REFERENCES overtime_requests(request_id),
    ADD COLUMN IF NOT EXISTS replaced_by_request_id BIGINT REFERENCES overtime_requests(request_id),
    ADD COLUMN IF NOT EXISTS revoke_requested_by INTEGER REFERENCES users(user_id),
    ADD COLUMN IF NOT EXISTS revoke_requested_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS revoke_reason TEXT,
    ADD COLUMN IF NOT EXISTS revoke_decided_by INTEGER REFERENCES users(user_id),
    ADD COLUMN IF NOT EXISTS revoke_decided_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS revoke_decision VARCHAR(20),
    ADD COLUMN IF NOT EXISTS revoke_decision_reason TEXT,
    ADD COLUMN IF NOT EXISTS revoked_by INTEGER REFERENCES users(user_id),
    ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS revocation_reason TEXT;

ALTER TABLE overtime_requests DROP CONSTRAINT IF EXISTS overtime_requests_status_check;
ALTER TABLE overtime_requests DROP CONSTRAINT IF EXISTS ck_overtime_request_lifecycle_status;
ALTER TABLE overtime_requests ADD CONSTRAINT ck_overtime_request_lifecycle_status
    CHECK (status IN ('DRAFT','PENDING_EMPLOYEE_CONFIRMATION','PENDING_HR','APPROVED',
                      'REJECTED','EMPLOYEE_DECLINED','CANCELLED','REVOKED','REPLACED'));

ALTER TABLE overtime_requests DROP CONSTRAINT IF EXISTS ck_overtime_request_type;
ALTER TABLE overtime_requests ADD CONSTRAINT ck_overtime_request_type
    CHECK ((request_type = 'STANDARD' AND parent_request_id IS NULL)
        OR (request_type = 'AMENDMENT' AND parent_request_id IS NOT NULL));

ALTER TABLE overtime_requests DROP CONSTRAINT IF EXISTS ck_overtime_request_revoke_decision;
ALTER TABLE overtime_requests ADD CONSTRAINT ck_overtime_request_revoke_decision
    CHECK (revoke_decision IS NULL OR revoke_decision IN ('APPROVED','REJECTED'));

ALTER TABLE overtime_requests DROP CONSTRAINT IF EXISTS ck_overtime_request_revoked_metadata;
ALTER TABLE overtime_requests ADD CONSTRAINT ck_overtime_request_revoked_metadata
    CHECK (status <> 'REVOKED' OR
           (revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND length(trim(COALESCE(revocation_reason,''))) >= 3));

ALTER TABLE overtime_requests DROP CONSTRAINT IF EXISTS ck_overtime_request_replaced_metadata;
ALTER TABLE overtime_requests ADD CONSTRAINT ck_overtime_request_replaced_metadata
    CHECK (status <> 'REPLACED' OR replaced_by_request_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS ix_overtime_requests_parent
    ON overtime_requests(parent_request_id, request_id) WHERE parent_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_overtime_active_amendment_per_parent
    ON overtime_requests(parent_request_id)
    WHERE request_type='AMENDMENT'
      AND status IN ('DRAFT','PENDING_EMPLOYEE_CONFIRMATION','PENDING_HR','APPROVED');

COMMENT ON COLUMN overtime_requests.request_type IS 'STANDARD or linked AMENDMENT replacement proposal.';
COMMENT ON COLUMN overtime_requests.replaced_by_request_id IS 'Approved replacement - original stays in history with REPLACED status.';
COMMENT ON COLUMN overtime_requests.revoke_requested_at IS 'Pending revocation metadata - final decision is also recorded in append-only events.';
