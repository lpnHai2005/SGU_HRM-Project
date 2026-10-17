-- =============================================================================
-- Contract Management Enhancement Migration
-- Purpose: Add status, audit fields, and contract management features
-- Author: Claude Opus 5.5
-- Date: 2026-10-18
-- =============================================================================

-- 1. Add new status column (replacing old contract_status)
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'DRAFT';

-- 2. Migrate existing data
UPDATE contracts SET status = 'ACTIVE' WHERE contract_status = 'ACTIVE';
UPDATE contracts SET status = 'TERMINATED' WHERE contract_status = 'TERMINATED';
-- All other contracts remain as DRAFT

-- 3. Add audit fields
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(user_id);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS activated_at TIMESTAMP;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS activated_by INTEGER REFERENCES users(user_id);

-- 4. Add termination fields
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS termination_date DATE;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS termination_reason TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS terminated_by INTEGER REFERENCES users(user_id);

-- 5. Add contract history link
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS previous_contract_id INTEGER REFERENCES contracts(contract_id);

-- 6. Add file URL
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_file_url VARCHAR(500);

-- 7. Add notes
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS notes TEXT;

-- 8. Add position and department references (for contract snapshot)
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS position_id INTEGER REFERENCES positions(position_id);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(department_id);

-- 9. Drop old unused columns if they exist
ALTER TABLE contracts DROP COLUMN IF EXISTS salary_percentage;
ALTER TABLE contracts DROP COLUMN IF EXISTS working_hours_per_week;

-- 10. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);
CREATE INDEX IF NOT EXISTS idx_contracts_employee_id ON contracts(employee_id);
CREATE INDEX IF NOT EXISTS idx_contracts_start_date ON contracts(start_date);
CREATE INDEX IF NOT EXISTS idx_contracts_end_date ON contracts(end_date);
CREATE INDEX IF NOT EXISTS idx_contracts_previous_contract_id ON contracts(previous_contract_id);

-- 11. Add comments for documentation
COMMENT ON COLUMN contracts.status IS 'DRAFT, ACTIVE, EXPIRED, TERMINATED, CANCELLED';
COMMENT ON COLUMN contracts.contract_type IS 'PROBATION, FIXED_TERM, INDEFINITE';
