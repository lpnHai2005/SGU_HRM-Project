# Đề xuất cập nhật Supabase Cloud — refactor Lương / Ca / OT / Kỷ luật

Ngày lập: 2026-11-06 · Người lập: nhánh refactor chấm công – lương (TechZone HRM)

Tài liệu này liệt kê những gì **Supabase Local đã có mà Supabase Cloud chưa có**, để Project Owner xem xét và áp lên Cloud. Chưa có thao tác nào ghi lên Cloud: so sánh được làm offline giữa DB local và bản dump schema `public` của Cloud chụp lúc 06:20 ngày 2026-11-06 (sau mốc này Cloud có thay đổi thì cần so lại).

## 1. Tóm tắt

Toàn bộ khác biệt nằm trong **một migration idempotent**:
`backend/migrations/20261106_prorated_allowances_shift_ot_discipline.sql`

Cloud đã có đủ các migration trước đó, đến hết `20261105_allow_overdue_open_sessions.sql`. Không có khác biệt nào khác về bảng, cột, index hay dữ liệu.

**Backend mới phụ thuộc migration này.** Nếu deploy code mà chưa áp migration:
- check-out lỗi, vì cần cột `work_shifts.planned_overtime_hours`;
- các API `/discipline/*` lỗi, vì cần bảng `disciplinary_records`;
- tính lương lỗi, vì cần các hàm mới.

## 2. Thay đổi schema

| Loại | Đối tượng | Mô tả |
|---|---|---|
| Bảng mới | `disciplinary_records` | Biên bản đi trễ tự động (`LATE_WARNING_REPORT`): UNIQUE (employee, kỳ, loại), trạng thái OPEN / ACKNOWLEDGED / VOIDED, `is_auto`, `details` JSONB; index `ix_disciplinary_records_period` |
| Cột mới | `work_shifts.planned_overtime_hours` NUMERIC(4,2) DEFAULT 0 | Giờ OT tự động của ca. Kèm CHECK `ck_work_shifts_planned_ot` và `ck_work_shifts_break_minutes` |
| Cột mới | `attendance_overtime_approvals.night_hours` NUMERIC(5,2) | Giờ OT đêm 22:00–08:00 (hệ số 2.0) |
| Cột mới | `employees.is_blacklisted_warning` BOOLEAN DEFAULT false, `employees.blacklisted_warning_at` TIMESTAMPTZ | Cờ BLACK_LIST_WARNING khi có biên bản 3 tháng liên tiếp |
| Cột mới | `payroll_import_overrides.personal_income_tax` NUMERIC(15,2) NOT NULL DEFAULT 0, CHECK ≥ 0 | Thuế TNCN do Kế toán import (Phase 1); SP sinh khoản `PIT` |
| Trigger mới | `trg_guard_monthly_ot_cap` trên `attendance_overtime_approvals` | Chặn cứng tổng OT vượt 40h/tháng (lỗi `OT_MONTHLY_CAP_EXCEEDED`) |
| View thay đổi | `v_payroll_period_working_days` | `applied_standard_days` = kỳ đã chốt → HR ghi đè → **26**. Trước đây là số ngày theo lịch tháng (trừ Chủ nhật và lễ). Thêm cột cuối `calendar_working_days` để tham khảo |

## 3. Hàm và stored procedure

| Hàm | Trạng thái | Mục đích |
|---|---|---|
| `fn_work_day_credit(numeric)` | Mới | Quy đổi công/ngày: < 4h = 0; 4h – < 7.5h = 0.5; ≥ 7.5h = 1 |
| `fn_night_overlap_hours(timestamptz, timestamptz)` | Mới | Số giờ nằm trong khung đêm 22:00–08:00 |
| `fn_attendance_planned_ot_hours(bigint)` | Mới | OT tự động của Ca Full (4h), không cần đơn OT |
| `fn_attendance_counts_as_late(...)` | Mới | Quy tắc "trễ hợp lệ", giống hệt bảng công. Dùng chung cho tính lương và lập biên bản |
| `fn_attendance_payable_hours(...)` | Mới | Giờ công được trả lương; phiên HR loại trừ / tạm giữ = 0 |
| `fn_interval_overlap_hours(...)` | Mới | Số giờ trùng giữa 2 khoảng thời gian |
| `fn_payable_ot_rows(varchar)` | Mới | Nguồn OT trả lương duy nhất (VERIFIED_ONLY): `v_overtime_verified_current` + OT tự động Ca Full. Cần view `v_overtime_verified_current`, Cloud đã có |
| `fn_employee_monthly_ot_hours(...)`, `fn_guard_monthly_ot_cap()` | Mới | Trần 40h OT/tháng |
| `fn_evaluate_late_discipline(varchar)` | Mới | ≥ 5 ngày trễ hợp lệ → biên bản; 3 tháng liên tiếp → cờ Black-list |
| `fn_prorate_standard_days()` | Mới | Đọc `PRORATE_STANDARD_DAYS` (mặc định 26) |
| `fn_payroll_standard_days(varchar)` | Thay thế | Fallback chuyển từ "đếm lịch tháng" sang 26 / HR ghi đè |
| `fn_sync_ot_reconciliation_to_approvals()` | Thay thế | Ghi thêm `night_hours` từ `eligible_intervals` khi đối soát VERIFIED |
| `sp_generate_monthly_payroll(varchar, int)` | Thay thế | Xem mục 5 |

## 4. Dữ liệu cấu hình sẽ thay đổi

**`payroll_policy_settings`**: thêm 7 khóa (`ON CONFLICT DO NOTHING`, không ghi đè giá trị Cloud đang có) và tắt 1 khóa.

| Khóa | Giá trị | Ghi chú |
|---|---|---|
| `PRORATE_STANDARD_DAYS` | 26 | Công chuẩn cố định |
| `ATTENDANCE_ALLOWANCE` | 500.000 | Phụ cấp chuyên cần |
| `ATTENDANCE_ALLOWANCE_MIN_DAYS` | 20 | Dưới 20 công → mất chuyên cần |
| `MEAL_ALLOWANCE_CAP_AT_STANDARD` | 1 | PC ăn trưa tối đa ở 26 công |
| `LATE_WARNING_THRESHOLD_DAYS` | 5 | Ngưỡng lập biên bản |
| `OVERTIME_RATE_NIGHT` | 2.0 | OT đêm |
| `MAX_MONTHLY_OT_HOURS` | 40 | Trần OT tháng |
| `LATE_PENALTY_AMOUNT` | 50.000 → **is_active = false** | Bãi bỏ phạt tiền đi trễ |

**`work_shifts`** (danh mục ca):

| Mã ca | Cloud hiện tại | Sau migration |
|---|---|---|
| `CA_SANG` 08–16 | 7h công, nghỉ 60' | **8h**, nghỉ 0 (ăn luân phiên) |
| `CA_CHIEU` 13–21 | 8h, nghỉ 0 | Giữ nguyên |
| `CA_HANH_CHINH` 08–17 | 8h, nghỉ 60' | Giữ nguyên |
| `CA_FULL` 08–21 | 11h công, nghỉ 120' | **8h công + 4h OT tự động**, nghỉ 60' |

## 5. Ảnh hưởng nghiệp vụ khi tính lại kỳ DRAFT

- Lương CB = Lương HĐ / 26 × công. **Không chặn trần**: 27 công nhận 27/26 lương HĐ, phần vượt nằm ở khoản mới `EXTRA_WORKDAY_SALARY`.
- PC ăn trưa & đi lại = 1.000.000 / 26 × công, tối đa 1.000.000đ.
- Thêm khoản `ATTENDANCE_ALLOWANCE`: đủ 500k; trễ 3–4 ngày còn 50%; trễ ≥ 5 ngày hoặc dưới 20 công thì 0.
- **Không còn sinh khoản `PENALTY`**, không trừ lương theo phút đi trễ.
- OT đêm tính hệ số 2.0; Ca Full tự cộng 4h OT.
- **OT chỉ trả khi đơn đã được HR đối soát VERIFIED**. Phiếu duyệt kiểu cũ trong `attendance_overtime_approvals` mà không có bản đối soát VERIFIED hợp lệ sẽ không còn được trả. Trên bản sao Cloud có 4 phiếu như vậy, đều là dữ liệu seed tháng 07/2026 (kỳ DRAFT) mang chữ ký nguồn giả `REC_OT_x`.
- Phiên HR loại trừ / chờ giải trình không còn được tính công.
- Phép có lương chỉ bù cho đủ 26 công, không tạo `EXTRA_WORKDAY_SALARY`.
- Khoản `PIT` lấy từ cột Thuế TNCN trong file Excel import.
- Phải deploy **cùng lúc** backend mới. Chốt an toàn tính lương ở backend cũ sẽ chặn 409 với SP mới, vì SP mới không còn đọc `attendance_overtime_approvals`.
- Chỉ tính lại phiếu **DRAFT**. Phiếu CONFIRMED/PAID giữ nguyên, kể cả công chuẩn đã khóa của kỳ. Trên dữ liệu Cloud hiện tại: 08/2026 = 22, 09/2026 = 24, 10/2026 = 27 (do có 1 phiếu CONFIRMED).

## 6. Đề xuất các bước áp lên Cloud (Project Owner thực hiện)

1. Sao lưu Cloud (`pg_dump` schema `public`) trước khi áp.
2. Áp `20261106_prorated_allowances_shift_ot_discipline.sql` trong một transaction. Migration idempotent, chạy lại an toàn; local đã chạy thử 2 lần liên tiếp trên bản sao dữ liệu Cloud mà không lỗi.
3. Kiểm tra nhanh:
   - `SELECT shift_code, work_hours, break_minutes, planned_overtime_hours FROM work_shifts;`
   - `SELECT salary_period, applied_standard_days, calendar_working_days FROM v_payroll_period_working_days WHERE salary_period >= '2026-07';`
4. Deploy backend + frontend của nhánh refactor cùng lúc hoặc ngay sau bước 2.
5. HR tính lại các kỳ DRAFT cần dùng. Nếu muốn kỳ 10/2026 theo 26 công thì mở lại phiếu CONFIRMED của kỳ đó trước khi tính.
6. Tùy chọn: chạy `SELECT fn_evaluate_late_discipline('2026-10');` để lập biên bản kỳ gần nhất.
7. Tùy chọn (không thuộc DB): nạp lại vector store chatbot, vì tài liệu TZ-DOC-01/02/05/08 đã cập nhật quy chế mới (`python scripts/ingest_pdfs_to_vectorstore.py`).

## 7. Không cần áp lên Cloud

- `backend/migrations/000_base_schema.sql` là ảnh chụp schema cũ dùng dựng local, **thiếu** các cột Cloud đã có (`payrolls.total_earnings`, `total_allowances`, `total_bonuses`, `total_deductions`, `daily_standard_hours`, `absent_days`). Không chạy file này lên Cloud. Nên cập nhật lại nó từ schema Cloud nếu còn dùng để dựng local.
- `backend/scripts/seed_july_2026.py` là dữ liệu test tháng 07/2026, chỉ dùng cho local. Không chạy trên Cloud.
