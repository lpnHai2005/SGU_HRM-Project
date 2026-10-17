-- ==============================================================================
-- Migration: 20261021_sync_contract_insurance_salary.sql
-- Mô tả: Đồng bộ toàn bộ insurance_salary trong bảng contracts bằng 100% basic_salary
-- Quy định: Căn cứ đóng bảo hiểm bắt buộc tự động tính theo 100% lương cơ bản HĐ
-- ==============================================================================

UPDATE contracts
SET insurance_salary = basic_salary
WHERE basic_salary IS NOT NULL
  AND (insurance_salary IS NULL OR insurance_salary != basic_salary);
