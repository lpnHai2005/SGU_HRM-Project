ALTER TABLE payrolls
    DROP CONSTRAINT IF EXISTS payrolls_payment_status_check;

ALTER TABLE payrolls
    ADD CONSTRAINT payrolls_payment_status_check
    CHECK (payment_status IN ('DRAFT', 'NEEDS_RECALCULATION', 'CONFIRMED', 'PAID'));

COMMENT ON COLUMN payrolls.payment_status IS
    'DRAFT, NEEDS_RECALCULATION, CONFIRMED, or PAID. Reopening a paid period changes the HRM state only and does not reverse a bank transfer.';

