-- Add optional scheduling context without changing attendance or payroll data.
ALTER TABLE overtime_requests ADD COLUMN IF NOT EXISTS notes TEXT;
