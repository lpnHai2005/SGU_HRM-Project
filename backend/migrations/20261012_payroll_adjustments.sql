CREATE TABLE IF NOT EXISTS payroll_manual_adjustments (
    payroll_id INTEGER PRIMARY KEY REFERENCES payrolls(payroll_id) ON DELETE CASCADE,
    addition_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (addition_amount >= 0),
    deduction_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (deduction_amount >= 0),
    reason TEXT NOT NULL,
    edited_by INTEGER NOT NULL REFERENCES users(user_id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE payroll_manual_adjustments IS 'Audited HR/Admin adjustments on DRAFT payslips only; amount deltas are reflected in payroll gross, deductions and net.';
