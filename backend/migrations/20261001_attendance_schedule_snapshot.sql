-- Keep schedule comparison independent from the summary attendance status.
-- Legacy rows remain NULL: the original assigned schedule cannot be reconstructed.
BEGIN;
ALTER TABLE attendances ADD COLUMN IF NOT EXISTS attendance_context JSONB;
COMMIT;
