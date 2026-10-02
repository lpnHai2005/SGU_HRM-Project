BEGIN;
CREATE TABLE IF NOT EXISTS mobile_store_geofences (
    store_id INTEGER PRIMARY KEY REFERENCES stores(store_id),
    latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    radius_meters INTEGER NOT NULL DEFAULT 150 CHECK (radius_meters BETWEEN 10 AND 5000),
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS mobile_attendance_proofs (
    proof_id BIGSERIAL PRIMARY KEY,
    request_id UUID NOT NULL,
    employee_id INTEGER NOT NULL REFERENCES employees(employee_id),
    store_id INTEGER NOT NULL REFERENCES stores(store_id),
    attendance_id BIGINT REFERENCES attendances(attendance_id),
    check_type VARCHAR(10) NOT NULL CHECK (check_type IN ('CHECK_IN','CHECK_OUT')),
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    accuracy_meters DOUBLE PRECISION NOT NULL,
    distance_meters DOUBLE PRECISION NOT NULL,
    radius_meters INTEGER NOT NULL,
    photo_url TEXT NOT NULL,
    photo_nonce UUID NOT NULL UNIQUE,
    verification_status VARCHAR(40) NOT NULL,
    result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (employee_id, request_id)
);
CREATE INDEX IF NOT EXISTS idx_mobile_proofs_employee ON mobile_attendance_proofs(employee_id, created_at DESC);
COMMIT;
