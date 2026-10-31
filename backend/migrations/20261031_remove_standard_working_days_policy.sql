-- ==============================================================================
-- Migration: Xóa tham số cố định STANDARD_WORKING_DAYS khỏi payroll_policy_settings
-- Mục đích: Chuyển đổi hoàn toàn sang mô hình Ngày công chuẩn linh hoạt theo lịch
--           làm việc thực tế & ngày lễ (Điều 112, 98 BLLĐ 2019) tại View 
--           v_payroll_period_working_days và Tab "Lịch Lễ, Tết & Công chuẩn".
-- ==============================================================================

DELETE FROM public.payroll_policy_settings 
WHERE setting_key = 'STANDARD_WORKING_DAYS';

COMMENT ON TABLE public.payroll_policy_settings IS 
'Bảng lưu trữ tham số quy chế lương (phụ cấp, hệ số OT, bảo hiểm, phạt trễ). Không còn chứa STANDARD_WORKING_DAYS do ngày công chuẩn đã được quản lý động theo kỳ lương.';

