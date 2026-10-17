-- Migration: Resignation Management & Contract Constraints Update
-- Date: 2026-10-17

-- 1. Create resignation_requests table
CREATE TABLE IF NOT EXISTS resignation_requests (
    resignation_id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    contract_id INTEGER NOT NULL REFERENCES contracts(contract_id) ON DELETE CASCADE,
    submitted_date DATE NOT NULL,
    requested_last_working_date DATE NOT NULL,
    reason TEXT NOT NULL,
    attachment_url VARCHAR(500),
    notes TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    rejection_reason TEXT,
    approved_last_working_date DATE,
    created_by INTEGER NOT NULL REFERENCES users(user_id),
    approved_by INTEGER REFERENCES users(user_id),
    approved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Indexes for fast filtering & joins
CREATE INDEX IF NOT EXISTS idx_resignation_employee ON resignation_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_resignation_contract ON resignation_requests(contract_id);
CREATE INDEX IF NOT EXISTS idx_resignation_status ON resignation_requests(status);

-- 3. Update contracts status check constraint to include DRAFT, ACTIVE, EXPIRED, TERMINATED, CANCELLED
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_status_check;
ALTER TABLE contracts ADD CONSTRAINT contracts_status_check 
    CHECK (status IN ('DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'CANCELLED'));

-- 4. Update contracts contract_type check constraint
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_contract_type_check;
ALTER TABLE contracts ADD CONSTRAINT contracts_contract_type_check 
    CHECK (contract_type IN ('PROBATION', 'FIXED_TERM', 'FIXED_1_YEAR', 'FIXED_2_YEAR', 'FIXED_3_YEAR', 'INDEFINITE'));
