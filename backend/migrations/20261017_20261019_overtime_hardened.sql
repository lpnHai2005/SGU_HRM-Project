-- =======================================================================
-- TECHZONE HRM — OT CONSOLIDATED & SECURITY HARDENED MIGRATION
-- Phạm vi: Thay thế an toàn cho 3 migration 20261017, 20261018, 20261019
-- Bảo mật: Transaction nguyên khối, lock_timeout 10s, RLS, REVOKE anon/authenticated,
--          quyền tối thiểu cho service_role, và trigger chống sửa/xóa audit events.
-- =======================================================================

BEGIN;

-- Ngăn chặn treo hệ thống nếu có tiến trình khác đang giữ lock
SET LOCAL lock_timeout = '10s';

-- -----------------------------------------------------------------------
-- PHẦN 1: Bảng chính Đề xuất OT (overtime_requests)
-- -----------------------------------------------------------------------
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
        CHECK (status IN ('DRAFT','PENDING_EMPLOYEE_CONFIRMATION','PENDING_HR','APPROVED',
                          'REJECTED','EMPLOYEE_DECLINED','CANCELLED')),
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

-- Index và Idempotency
ALTER TABLE overtime_requests ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(100);
ALTER TABLE overtime_requests ADD COLUMN IF NOT EXISTS idempotency_payload JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS uq_overtime_requests_creator_idempotency
    ON overtime_requests(created_by, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_overtime_requests_employee_interval
    ON overtime_requests(employee_id, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS ix_overtime_requests_status_date
    ON overtime_requests(status, work_date, store_id);

CREATE INDEX IF NOT EXISTS ix_overtime_requests_store_date
    ON overtime_requests(store_id, work_date, request_id);

-- -----------------------------------------------------------------------
-- PHẦN 2: Bảng Nhật ký Sự kiện OT (overtime_request_events)
-- -----------------------------------------------------------------------
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

-- -----------------------------------------------------------------------
-- PHẦN 3: Bổ sung trường notes (20261018)
-- -----------------------------------------------------------------------
ALTER TABLE overtime_requests ADD COLUMN IF NOT EXISTS notes TEXT;

-- -----------------------------------------------------------------------
-- PHẦN 4: Hỗ trợ Vòng đời Lifecycle: Thu hồi & Điều chỉnh (20261019)
-- -----------------------------------------------------------------------
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

-- -----------------------------------------------------------------------
-- PHẦN 5: Cơ chế Bảo vệ Bảng Sự kiện Append-Only (Chống Sửa/Xóa Audit)
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_overtime_events_append_only()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'overtime_request_events is append-only: UPDATE and DELETE operations are strictly prohibited'
        USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_overtime_events_immutable ON overtime_request_events;
CREATE TRIGGER trg_protect_overtime_events_immutable
    BEFORE UPDATE OR DELETE ON overtime_request_events
    FOR EACH ROW
    EXECUTE FUNCTION guard_overtime_events_append_only();

-- -----------------------------------------------------------------------
-- PHẦN 6: Bảo vệ Quyền truy cập & Kích hoạt Row Level Security (RLS)
-- -----------------------------------------------------------------------
-- 1. Bật RLS (PostgREST mặc định sẽ deny mọi request qua Data API khi không có policy)
ALTER TABLE overtime_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE overtime_request_events ENABLE ROW LEVEL SECURITY;

-- 2. Thu hồi toàn bộ quyền khỏi vai trò ẩn danh (anon) và người dùng auth (authenticated)
REVOKE ALL ON TABLE overtime_requests FROM anon, authenticated;
REVOKE ALL ON TABLE overtime_request_events FROM anon, authenticated;
REVOKE ALL ON SEQUENCE overtime_requests_request_id_seq FROM anon, authenticated;
REVOKE ALL ON SEQUENCE overtime_request_events_event_id_seq FROM anon, authenticated;

-- 3. Xóa cả quyền đã thừa hưởng từ default ACL trước khi cấp lại quyền tối thiểu.
-- GRANT đơn thuần không thu hồi UPDATE/DELETE/TRUNCATE vốn có trên bảng mới.
REVOKE ALL ON TABLE overtime_requests, overtime_request_events FROM service_role;
REVOKE ALL ON SEQUENCE overtime_requests_request_id_seq, overtime_request_events_event_id_seq FROM service_role;

-- Không cấp UPDATE/DELETE/TRUNCATE trên bảng sự kiện append-only.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE overtime_requests TO service_role;
GRANT SELECT, INSERT ON TABLE overtime_request_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE overtime_requests_request_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE overtime_request_events_event_id_seq TO service_role;

COMMIT;
