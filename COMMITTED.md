# COMMITTED — Refactor Lương, Ca làm, OT & Kỷ luật đi trễ

Ngày: 2026-11-06 · Phạm vi: backend (FastAPI + SQL), frontend web, tài liệu chatbot, test.
Quy mô: 39 file sửa (+1.114 / −837 dòng) và 15 file mới. Không tính `000_base_schema.sql` và `supabase/` (xem mục 10).

## 1. Quy chế mới được áp dụng

| Hạng mục | Trước | Sau |
|---|---|---|
| Công chuẩn | Đếm theo lịch tháng (trừ CN, lễ): 24–27 | **Cố định 26**, trừ khi HR ghi đè hoặc kỳ đã chốt |
| Lương cơ bản | Lương HĐ − khấu trừ (chặn trần) | Lương HĐ / 26 × công, **không chặn trần** (27 công = 27/26) |
| PC ăn trưa & đi lại | Cố định 1.000.000đ | 1.000.000 / 26 × công, tối đa 1.000.000đ |
| PC chuyên cần | — | 500.000đ; trễ 3–4 ngày → 50%; trễ ≥ 5 ngày hoặc < 20 công → 0 |
| Đi trễ > 15' | Phạt 50.000đ/lần + trừ lương theo phút | **Bỏ phạt tiền và trừ phút**; chỉ xét chuyên cần và biên bản |
| Công ngày | Đếm ngày có check-in | < 4h = 0; 4h – < 7.5h = 0.5; ≥ 7.5h = 1 |
| Ca chuẩn | Ca sáng 7h, Ca Full 11h | Mọi ca thường 8h; **Ca Full 08–21 = 8h công + 4h OT tự động** |
| OT | 1.5 / 2.0 / 3.0; đọc phiếu duyệt legacy | Thêm **OT đêm 22:00–08:00 ×2.0**; trần **40h/tháng** (chặn cứng); **chỉ trả OT đã được HR đối soát VERIFIED** + OT tự động Ca Full; giờ ngoài ca thô không tính |
| Lịch tuần | T2–T7, nút "Hiện CN" | **T2–CN**; bắt buộc ≥ 1 ngày OFF/tuần; cảnh báo khi > 48h/tuần |
| Kỷ luật | — | ≥ 5 ngày trễ hợp lệ/tháng → biên bản tự động; 3 tháng liên tiếp → cờ `BLACK_LIST_WARNING` |

## 2. Database — `backend/migrations/20261106_prorated_allowances_shift_ot_discipline.sql` (mới, idempotent)

- **Tham số** (`payroll_policy_settings`): `PRORATE_STANDARD_DAYS`, `ATTENDANCE_ALLOWANCE`, `ATTENDANCE_ALLOWANCE_MIN_DAYS`, `MEAL_ALLOWANCE_CAP_AT_STANDARD`, `LATE_WARNING_THRESHOLD_DAYS`, `OVERTIME_RATE_NIGHT`, `MAX_MONTHLY_OT_HOURS`. Tắt `LATE_PENALTY_AMOUNT`.
- **Ca**: thêm `work_shifts.break_minutes` và `planned_overtime_hours` kèm CHECK; chuẩn hóa `CA_SANG`, `CA_CHIEU`, `CA_HANH_CHINH`, `CA_FULL`.
- **Hàm tiện ích**:
  - `fn_work_day_credit`, `fn_night_overlap_hours`, `fn_attendance_planned_ot_hours`.
  - `fn_attendance_counts_as_late`: quy tắc trễ hợp lệ, khớp `operations.is_valid_late_session`.
  - `fn_attendance_payable_hours`: giờ công được trả lương. Phiên HR loại trừ (`EXCLUDED_INVALID`) hoặc tạm giữ (`NEEDS_MORE_INFO`) tính 0; **không còn tự bù giờ check-in → check-out khi `actual_work_hours = 0`** (lỗ hổng cũ làm phiên bị loại vẫn được tính công).
  - `fn_payable_ot_rows(period)`: nguồn OT duy nhất để trả lương (VERIFIED_ONLY) = `v_overtime_verified_current` + OT tự động Ca Full, trừ phần trùng thời gian để không trả 2 lần; kèm `fn_interval_overlap_hours`.
- **OT**:
  - Cột `attendance_overtime_approvals.night_hours`.
  - `fn_employee_monthly_ot_hours` và trigger `trg_guard_monthly_ot_cap` (lỗi `OT_MONTHLY_CAP_EXCEEDED`).
  - `fn_sync_ot_reconciliation_to_approvals` ghi thêm giờ đêm.
- **Kỷ luật**:
  - Bảng `disciplinary_records`.
  - Cột `employees.is_blacklisted_warning` và `blacklisted_warning_at`.
  - `fn_evaluate_late_discipline(period)`.
- **Công chuẩn thống nhất**:
  - `fn_prorate_standard_days`.
  - View `v_payroll_period_working_days`: `applied_standard_days` = kỳ đã chốt → HR ghi đè → 26; thêm cột `calendar_working_days` để tham khảo.
  - `fn_payroll_standard_days`.
- **`sp_generate_monthly_payroll`** viết lại:
  - Khoản mới: `EXTRA_WORKDAY_SALARY`, `ATTENDANCE_ALLOWANCE`.
  - `MEAL_ALLOWANCE` tính theo công.
  - OT tách giờ thường / đêm / CN / lễ, lấy từ `fn_payable_ot_rows` (không còn đọc bảng legacy `attendance_overtime_approvals`).
  - Công ngày lấy từ `fn_attendance_payable_hours`.
  - Bỏ khoản `PENALTY`.
  - Chỉ ghi vào phiếu `DRAFT`, chạy lại không nhân đôi khoản mục.

Kèm theo `backend/migrations/20261105_allow_overdue_open_sessions.sql` (có sẵn trước refactor): unique index phiên mở theo (employee, work_date).

## 3. Backend — module mới

| File | Nội dung |
|---|---|
| `app/core/payroll_rules.py` | Luật thuần, có test: công ngày, tách giờ ca, lương / PC theo công, mức chuyên cần, OT đêm, trần OT, kiểm tra tuần T2–CN, kỳ liên tiếp cho Black-list |
| `app/core/ot_cap.py` | `committed_ot_hours`, `require_ot_within_cap`: trần 40h tính trên OT đã duyệt + OT tự động Ca Full + đơn đã duyệt chưa đối soát |
| `app/api/v1/endpoints/discipline.py` | `/discipline/records`, `/evaluate`, `/records/{id}/status`, `/blacklist/{id}/clear`, `GET/PUT /discipline/shifts` (danh mục ca, HR/GĐ sửa; ADMIN chỉ xem) |
| `scripts/apply_20261106_prorated_allowances.py` | Áp migration lên DB trong `SYNC_DATABASE_URL`, tùy chọn `--period` |

## 4. Backend — file sửa

- **`core/attendance.py`**:
  - `net_work_hours`: trừ giờ nghỉ giữa ca.
  - Ghi `break_minutes` và `planned_overtime_hours` vào `attendance_context` lúc check-in.
  - `is_session_overdue`: phiên mở quá hạn (có sẵn).
- **`core/work_schedule.py`**:
  - `enforce_weekly_rules`: chặn khi tuần không có ngày OFF (409 `WEEKLY_DAY_OFF_REQUIRED`), kiểm tra trần OT với Ca Full, trả `warnings` khi > 48h.
  - Tự đồng bộ sequence `work_schedules` (có sẵn).
- **`endpoints/work_schedules.py`**: tuần hiển thị T2 → CN.
- **`endpoints/overtime_requests.py`**, **`overtime_reconciliations.py`**: kiểm tra trần 40h khi duyệt đơn, duyệt đơn thay thế và xác nhận đối soát.
- **`endpoints/operations.py`** (Quản lý công & Đối soát đi trễ):
  - **RBAC**: `POST /attendance-sessions/{id}/resolve` chỉ cho HR_MANAGER, DIRECTOR; **ADMIN bị chặn 403** (ADMIN chỉ xem nghiệp vụ).
  - HR xác minh giờ ra (`verified_checkout_metrics`): tính lại đồng bộ `actual_work_hours`, `early_minutes`, `overtime_hours`; chặn 422 khi giờ ra ≤ giờ vào.
  - Bỏ tiền phạt.
  - Thêm `work_day_credits`, `attendance_allowance_tier`, `late_warning_report`, `is_blacklisted_warning`.
  - Công chuẩn lấy từ view thống nhất.
  - HR xác minh giờ ra có trừ giờ nghỉ (`verified_session_hours`).
- **`endpoints/attendances.py`** (Bảng công cá nhân `/my-summary`):
  - `actual_days` là công quy đổi; thêm `present_days`, `calendar_working_days`.
  - `late_arrivals.days`, `allowance_tier`, `late_warning_report` tính theo trễ hợp lệ.
  - Đọc giờ nghỉ của ca khi check-out.
  - Truy vấn view bọc trong savepoint.
  - **OT (VERIFIED_ONLY)**: `overtime.hours` = OT được trả lương (`verified_hours` + `shift_planned_hours`); giờ ngoài ca thô trả riêng ở `unverified_outside_hours`.
- **`endpoints/payrolls.py`**:
  - Chốt an toàn `ensure_payroll_ot_procedure_is_approval_gated` chấp nhận SP VERIFIED_ONLY: SP gọi `fn_payable_ot_rows` và hàm này chỉ đọc `v_overtime_verified_current`, không đọc `overtime_hours` thô hay `overtime_requests` chưa đối soát. Không sửa thì HR bị chặn 409 khi tính lương với SP mới.
  - Bóc tách `extra_workday_salary` và `attendance_allowance` từ chi tiết phiếu.
  - **Sửa lỗi `GET /payrolls/employee/{id}/annual`**: tổng năm trước lấy từ view (gồm cả phiếu DRAFT) nên lệch với danh sách tháng; nay cộng từ chính các phiếu CONFIRMED/PAID.
- **`endpoints/mobile_attendance.py`** (có sẵn): check-out theo `attendance_id`, bỏ qua phiên mở đã quá hạn.
- **`core/payroll_rules.py`**: `sql_round` làm tròn nửa xa số 0 bằng Decimal, giống `ROUND()` của PostgreSQL. Trước đây `round()` của Python làm tròn về số chẵn nên có thể lệch 1đ so với phiếu lương.
- **`main.py`**: handler `SQLAlchemyError` trả 409 / 422 / 500 với thông báo thân thiện, gồm cả `OT_MONTHLY_CAP_EXCEEDED`; không lộ câu SQL ra client.
- **`schemas/schemas.py`**: `WorkShiftOut` thêm trường ca; `PayrollOut` thêm `attendance_allowance`, `extra_workday_salary`; thêm `AttendanceLateSummary` và các trường công mới.
- **`api/v1/router.py`**: mount `/discipline`.

## 5. Frontend web

- **Mới**:
  - `components/schedule/ShiftTemplateModal.tsx`: danh mục ca, kiểm tra giờ thực = giờ công + OT.
  - `components/attendance/DisciplineAlertPanel.tsx`: biên bản và cờ Black-list, nút đánh giá lại / gỡ cờ.
  - `utils/attendanceAllowance.ts`.
- **`WorkSchedulesPage`** (+ CSS) và **`WorkScheduleDrawer`**: lịch T2–CN cố định, nút "Danh mục ca", banner cảnh báo > 48h hoặc 7/7 ngày, hiện `warnings` sau khi lưu.
- **`MonthlyAttendancePage`**: mức chuyên cần thay tiền phạt, badge "Biên bản" / `BLACK_LIST_WARNING`, panel kỷ luật, cột "x / 26 công" theo công quy đổi, Excel cột "Phụ cấp chuyên cần".
- **`AttendancePage`** (Bảng công cá nhân / Quản lý công): banner "26 công · cố định theo quy chế", thẻ ngày công = công quy đổi, thẻ đi muộn theo ngày trễ hợp lệ, bỏ "Trễ/sớm tính lương".
  - Thẻ **"Tăng ca OT (HR đã xác minh)"** chỉ hiện OT được HR đối soát VERIFIED + OT Ca Full, chia giờ thường / đêm / CN / lễ. Trước đây thẻ cộng giờ ngoài ca thô; ví dụ trên dữ liệu thật, nhân viên #4 tháng 09/2026 hiện 68,4h trong khi OT đã xác minh là 0h.
  - Thẻ "Làm thêm" đổi thành **"Giờ ngoài ca (chưa xác minh)"**, ghi rõ không tính lương.
- **`EmployeeAttendanceDetailModal`**, **`EmployeeAttendancePrintModal`**: bỏ "Phạt 50.000₫", hiển thị mức chuyên cần và công quy đổi.
- **`PayrollPage`**, **`MyPayslipPage`**: dòng PC chuyên cần, PC ăn trưa theo công, khoản phạt cũ ghi rõ "quy chế cũ, đã bãi bỏ".
- **`PayrollRegulationDialog`**: mô tả quy chế mới (công chuẩn 26, chuyên cần, OT đêm, trần 40h).
- **`services/api.ts`**, **`types/index.ts`**: `disciplineApi`, `attendanceApi.updateShift`, thông báo `WEEKLY_DAY_OFF_REQUIRED`, các type mới.

## 6. Tài liệu chatbot (RAG)

- `scripts/generate_knowledge_pdfs.py` cập nhật quy chế. Đã sinh lại TZ-DOC-01, 02, 05, 08, cả PDF trong `backend/data/knowledge_base_pdfs/` lẫn MD trong `docs/knowledge_base_sources/`.
- `scripts/evaluate_ragas.py`: đáp án chuẩn TC-01 đổi sang chuyên cần / biên bản.
- Cần chạy lại `scripts/ingest_pdfs_to_vectorstore.py` để chatbot dùng nội dung mới.

## 7. Dữ liệu test tháng 07/2026 — `scripts/seed_july_2026.py` (viết lại)

- Sinh dữ liệu bằng hàm thuần `build_july_dataset`, dùng chung luật tính công với hệ thống.
- Đọc ca theo mã và dừng nếu danh mục ca chưa chuẩn hóa; không tự sửa `work_shifts`.
- Mỗi tuần nghỉ Chủ nhật; đối soát OT có `eligible_intervals` để tính giờ đêm.
- Ghi chữ ký nguồn thật (`ot_reconciliation_source_signature`) cho đối soát OT để view OT hợp lệ nhận diện. Bản seed cũ ghi `REC_OT_x` nên OT tháng 7 không được tính.
- Chạy trực tiếp được bằng `python scripts/seed_july_2026.py` (tự thêm thư mục `backend/` vào `sys.path`).
- Kịch bản:
  - NV #5: 27/26 công.
  - NV #4: 5 ngày trễ hợp lệ → biên bản, 26.5 công.
  - NV #3: 3 ngày trễ → chuyên cần 50%, có OT đêm.

## 8. Test

| File | Nội dung |
|---|---|
| `tests/test_payroll_attendance_refactor.py` (mới) | Luật thuần, chặn phân ca tuần, test SQL chạy SP thật (24/26, 27/26, chuyên cần, nửa công, Ca Full 8h + 4h, OT đêm, trần 40h, biên bản + Black-list), đối chiếu quy tắc trễ SQL ↔ Python |
| `tests/test_seed_july_2026.py` (mới) | Nghiệm thu tháng 07/2026: dữ liệu thuần + SP lương khớp bảng công, công chuẩn 26 / lịch 27 |
| `tests/test_work_schedules.py`, `tests/test_attendance_sessions.py` | Cập nhật theo tuần T2–CN và việc ghi giờ nghỉ vào snapshot |
| `tests/test_attendance_overdue_and_resolution.py`, `tests/test_work_schedule_self_healing.py` (có sẵn) | Phiên quá hạn, tự đồng bộ sequence; cần DB local có dữ liệu |

- Bổ sung test cho các điểm sau:
  - OT chỉ trả khi đã VERIFIED (giờ ngoài ca thô và phiếu legacy không được trả).
  - Không trả 2 lần phần trùng với OT Ca Full.
  - Phiên bị loại trừ hoặc tạm giữ tính 0 công.
  - Làm tròn khớp PostgreSQL.
  - HR sửa giờ ra thì tính lại phút về sớm, giờ ngoài ca, và chặn giờ ra ≤ giờ vào.
  - ADMIN nhận 403 khi xử lý phiên.
  - Chốt an toàn SP VERIFIED_ONLY.
- **Kết quả**: 179 test liên quan pass, gồm test SQL trên Postgres 16 tạm. Test SQL chỉ chạy khi có biến `HRM_TEST_PG_DSN` trỏ tới DB tên `*_test`.
- `npm --prefix frontend-web run build` pass.

## 9. Cấu hình repo

- `.gitignore`, `backend/.gitignore`: ignore các profile `.env.cloud`, `.env.supabase-local`, `switch-env.ps1`, `*.dump`, `backend/backups/`, `supabase/seed.sql` (dump có dữ liệu cá nhân), `supabase/snippets/`, `supabase-local.md`.
- `update-supabase-cloud.md` (mới): đề xuất những gì cần áp lên Supabase Cloud.

## 10. Quyết định nghiệp vụ đã chốt (sign-off 2026-11-06) và cách áp dụng

| # | Quyết định | Áp dụng trong code |
|---|---|---|
| 1 | PC ăn trưa & đi lại **tính theo công thực tế**; phép có lương **không** được tính | Giữ nguyên: `MEAL_ALLOWANCE` = 1.000.000 / 26 × công thực tế, tối đa 1.000.000đ |
| 2 | Làm 27 công **được trả** phần vượt (`EXTRA_WORKDAY_SALARY`), không chặn trần | Giữ nguyên |
| 3 | Phép có lương **chỉ bù cho đủ 26**, không tạo công vượt chuẩn | SP: `payable_days = GREATEST(actual_days, LEAST(actual_days + paid_leave, 26))`; Python `payable_work_days`. Dùng `GREATEST` để không mâu thuẫn với #2: 27 công làm thực tế vẫn là 27; 25 công + 2 phép = 26 |
| 4 | **Bỏ hẳn luồng duyệt OT legacy**; chỉ dùng OT đã đối soát VERIFIED + OT tự động Ca Full | `PUT /payrolls/overtime-approvals/{id}` luôn trả 409 `OT_LEGACY_APPROVAL_CLOSED`; danh sách legacy chỉ để tra cứu. Chốt an toàn tính lương từ chối SP kiểu legacy. Danh sách bảng lương (cột OT đã duyệt) và file Excel import mẫu cũng đọc `fn_payable_ot_rows` |
| 5 | Vượt **48h công chuẩn/tuần → chặn cứng** (Điều 105 BLLĐ 2019) | `check_weekly_schedule` trả lỗi `WEEKLY_HOURS_OVER_48`; API phân ca trả 409; drawer phân ca chặn kèm hướng dẫn đăng ký OT. Đúng 48h (6 ca × 8h) vẫn hợp lệ |
| 6 | Thuế TNCN: **Phase 1** Kế toán tính ngoài rồi import vào phiếu DRAFT; tự động hóa ở **Phase 2** | Mẫu Excel thêm cột tùy chọn thứ 18 **"Thuế TNCN (Kế toán)"**; lưu vào `payroll_import_overrides.personal_income_tax`; SP sinh khoản `PIT` (DEDUCTION, trừ vào thực lĩnh). File mẫu cũ 17 cột vẫn import được và giữ nguyên thuế đã nhập |

## 11. Lưu ý triển khai

- Backend mới **cần migration 20261106**: check-out, `/discipline/*` và tính lương đều phụ thuộc vào nó. Supabase Local đã áp; **Supabase Cloud chưa áp**, xem `update-supabase-cloud.md`.
- Sau khi áp migration, tính lại các kỳ lương DRAFT. Phiếu CONFIRMED/PAID và công chuẩn đã khóa của kỳ cũ giữ nguyên.
- `backend/migrations/000_base_schema.sql` là ảnh chụp schema cũ, thiếu các cột `payrolls.total_earnings`…; cần quyết định cập nhật hay loại khỏi commit.
- `supabase/config.toml` và `supabase/.gitignore` là cấu hình Supabase Local dùng chung, không chứa bí mật.


---

## 12. Review-code: đối chiếu với commit Payroll của Hoangbao

### 12.1 Mốc so sánh và giới hạn bằng chứng

- Commit Payroll gần nhất trong lịch sử là **fbb905d — hoangbao2908, 2026-11-04**, tiêu đề “chỉnh sửa nhẹ lại cách tính lương, lương giờ theo hợp đồng, nêu rõ các khoản công thức tính lương chi tiết”.
- Commit trước đó cùng nhánh chức năng là **8f88643 — hoangbao2908, 2026-11-03**, chuẩn hóa giờ ca và khấu trừ chưa làm.
- HEAD khi review là **ee541ec**. Hai endpoint Payroll và Operations không có commit sau fbb905d sửa tiếp chúng. Khác biệt được mô tả dưới đây là working-tree local hiện tại, chưa phải thay đổi đã commit.
- Trạng thái: payrolls.py và operations.py đang modified; payroll_rules.py và migration 20261106 đang untracked. COMMITTED.md cũng untracked. Git author chỉ là metadata commit, không chứng minh ai sở hữu hoặc tự viết các thay đổi local.
- Review dựa trên source và migration trong workspace, không xác minh procedure đã cài trên Supabase Cloud hay database dùng chung. Migration 20261106 chưa được Git track; công thức trong đó là candidate local, không phải bằng chứng đã triển khai.

### 12.2 Các thay đổi trong ba file

#### backend/app/api/v1/endpoints/payrolls.py

1. **Guard kiểm tra procedure OT trước khi ghi phiếu**
   - Thêm chuẩn hóa định nghĩa SQL và đọc thêm định nghĩa fn_payable_ot_rows.
   - Chấp nhận procedure VERIFIED_ONLY khi procedure gọi fn_payable_ot_rows, hàm này đọc v_overtime_verified_current và không đọc overtime_hours thô hoặc overtime_requests.
   - Source hiện tại không còn nhánh fallback: procedure legacy đọc attendance_overtime_approvals bị từ chối HTTP 409; đây là fail-closed khi chưa cài procedure VERIFIED_ONLY.
   - **Rủi ro còn lại:** guard kiểm tra chuỗi SQL của procedure và function, nhưng nhánh VERIFIED_ONLY hiện kiểm tra overtime_hours trong thân function, chưa kiểm tra cùng pattern trong thân procedure. Một procedure có thể gọi fn_payable_ot_rows nhưng đồng thời cộng thêm attendances.overtime_hours thô mà vẫn lọt guard. Nên bổ sung regression test và kiểm tra procedure body trước khi xem guard là đủ chặt.

2. **Tổng hợp chi tiết phiếu**
   - actual_base_salary được tính từ lương hợp đồng trừ BASE_SALARY_DEDUCTION rồi cộng EXTRA_WORKDAY_SALARY.
   - Bổ sung các trường extra_workday_salary và attendance_allowance, và tổng phụ cấp/chi tiết cho response.
   - Payslip in cũng cộng EXTRA_WORKDAY_SALARY.
   - **Rủi ro hiển thị:** nếu một màn hình hiển thị actual_base_salary đã bao gồm công vượt chuẩn, đồng thời cộng thêm dòng EXTRA_WORKDAY_SALARY, khoản này bị đếm hai lần. Một số trang PayrollPage/MyPayslipPage đã lọc dòng riêng này; cần rà mọi export, in và client khác.

3. **Tổng thu nhập năm**
   - Bỏ phụ thuộc view v_annual_salary_summary; tổng năm được cộng từ các dòng tháng CONFIRMED/PAID để không lấy DRAFT từ view.
   - Bổ sung tổng ăn trưa và chuyên cần.
   - total_paid_months hiện đếm cả CONFIRMED và PAID. Tổng tiền không sai vì tên trường, nhưng tên có thể khiến người đọc hiểu nhầm là chỉ đếm tháng đã trả tiền.

#### backend/app/api/v1/endpoints/operations.py

1. **Bỏ phạt tiền đi trễ trong tính toán mới**
   - DEFAULT_LATE_PENALTY_AMOUNT đổi từ 50.000 thành 0; không còn đọc LATE_PENALTY_AMOUNT để tạo penalty mới.
   - Đi trễ vẫn được dùng để tính chuyên cần và lập biên bản. Thay đổi này không xóa khoản PENALTY lịch sử hoặc khoản nhập tay/import.

2. **Đồng bộ bảng công tháng**
   - Chuẩn công lấy từ view kỳ lương; mặc định 26 nếu view lỗi/chưa sẵn sàng.
   - Cộng giờ hợp lệ theo từng nhân viên/ngày và quy đổi: dưới 4 giờ = 0 công; từ 4 đến dưới 7,5 giờ = 0,5 công; từ 7,5 giờ = 1 công; tối đa 1 công/ngày.
   - Bổ sung tier chuyên cần, cảnh báo biên bản và cờ blacklist.
   - Một số truy vấn view/blacklist nằm trong nested transaction để lỗi schema không làm hỏng transaction chính.
   - **Rủi ro fallback:** nếu view thiếu, API trả chuẩn 26 mặc định. Cần cho UI biết đó là fallback, không trình bày như dữ liệu kỳ đã khóa hoặc HR override đã xác nhận.

3. **HR xác minh giờ checkout**
   - Thêm verified_check_out_time; ưu tiên break_minutes từ attendance_context snapshot, nếu thiếu mới dùng cấu hình ca.
   - Tính lại actual_work_hours, overtime_hours ghi nhận ngoài ca và early_minutes; trả 422 nếu thiếu giờ vào/ra hoặc giờ ra không sau giờ vào.
   - Đọc phiên bằng khóa hàng FOR UPDATE; RBAC xử lý hiện cho HR_MANAGER/DIRECTOR, ADMIN bị 403.
   - overtime_hours ở đây là giờ ngoài ca thực tế, không tự xác nhận đơn OT hoặc quyền tính lương.
   - Với EXCLUDED_INVALID, actual_work_hours được đặt về 0. Candidate SQL cũng loại review decision EXCLUDED_INVALID/NEEDS_MORE_INFO. Cần đảm bảo review context, lịch sử và audit luôn được ghi cùng trạng thái, kể cả các nhánh thay ca.

#### backend/app/core/payroll_rules.py — file mới, chưa được Git track

- Tập trung helper Python cho công ngày, giờ ca, lương/phụ cấp theo công, OT, trần OT, lịch tuần và cảnh báo kỷ luật.
- sql_round dùng Decimal và ROUND_HALF_UP để gần cách ROUND(NUMERIC) của PostgreSQL, tránh sai khác làm tròn kiểu ties-to-even của Python.
- Các ngưỡng cần luôn đồng bộ với SQL: chuẩn 26 ngày, 8 giờ/ngày, mốc công 4 và 7,5 giờ, ân hạn trễ 15 phút, OT 40 giờ/tháng, 48 giờ chuẩn/tuần, tối đa 6 ngày làm/tuần và khung đêm 22:00–08:00.
- Một số module local đã import helper. Nếu đưa các file import nó vào commit nhưng bỏ sót file untracked này, backend có thể lỗi import.

### 12.3 Khác biệt công thức so với baseline fbb905d

| Hạng mục | Baseline trong migration 20261104 của fbb905d | Candidate migration 20261106 trong workspace |
|---|---|---|
| Công chuẩn | Dùng fn_payroll_standard_days và dữ liệu lịch/ghi đè của kỳ | Dùng nguồn công chuẩn thống nhất: kỳ đã khóa → HR ghi đè → cấu hình, mặc định 26 |
| Công trong ngày | Nhận diện ngày làm từ trạng thái/giờ chấm công; lưu giờ thiếu gồm ngày vắng, trễ và về sớm | Cộng giờ phiên được phép tính trong ngày; dưới 4h = 0, 4 đến dưới 7,5h = 0,5, từ 7,5h = 1 |
| Lương thiếu công | Khấu trừ ngày nghỉ không lương/vắng theo đơn giá ngày, cộng phần giờ thiếu vượt số giờ đã quy cho ngày nghỉ/vắng theo đơn giá giờ; giờ thiếu gồm phút trễ/về sớm | Trừ theo phần công hưởng lương thấp hơn chuẩn: lương hợp đồng − ROUND(lương hợp đồng / công chuẩn × công hưởng lương). Không trừ trực tiếp phút trễ/về sớm khỏi lương cơ bản |
| Công vượt chuẩn | Không có EXTRA_WORKDAY_SALARY trong baseline này | Thêm phần lương vượt nếu công hưởng lương > chuẩn; không chặn ở 26 |
| Phạt đi trễ | Tạo PENALTY theo từng bản ghi có late_minutes lớn hơn tolerance, mặc định 50.000đ/lần | Không tự tạo PENALTY vì đi trễ; xử lý qua chuyên cần và biên bản |
| Ăn trưa/đi lại | Mức cấu hình cố định theo tháng | Mức cấu hình / công chuẩn × công thực tế, có cấu hình chặn trần tại công chuẩn |
| Chuyên cần | Chưa có tier này trong procedure baseline | Mặc định 500.000đ; công <20 hoặc trễ hợp lệ từ 5 ngày = 0; trễ 3–4 ngày = 50%; trễ 0–2 ngày = 100% |
| OT | Chỉ dùng attendance_overtime_approvals đã APPROVED; thường 1,5x, Chủ nhật 2x, lễ 3x | Candidate dùng reconciliation VERIFIED và OT planned ca Full; trừ phần thời gian chồng nhau; thêm đêm 22:00–08:00 2x |
| Giờ nghỉ ca | Dựa vào giờ chuẩn và snapshot ca đã có | Ca có break_minutes; tách thời gian công chuẩn/OT sau khi trừ nghỉ theo snapshot |
| Roll-up | Lương cơ bản sau khấu trừ + OT, rồi cộng phụ cấp/thưởng và trừ deduction | Giữ cấu trúc tổng quát nhưng các nguồn base, OT, ăn trưa, chuyên cần và penalty thay đổi |

**Không được suy ra candidate đang chạy trên database.** Guard API hiện từ chối procedure legacy, nhưng migration 20261106 và procedure VERIFIED_ONLY còn là file local chưa được track/triển khai. Vì vậy database còn procedure legacy sẽ bị API chặn 409 cho đến khi owner/DBA triển khai và xác minh đúng procedure/function.

### 12.4 Danh mục công thức lương trong candidate migration 20261106

Các mức mặc định có thể được payroll_policy_settings ghi đè; mô tả này là quy tắc trong source candidate.

#### Công, chuẩn và lương cơ bản

1. **Giờ công hợp lệ:** chưa check-out hoặc review decision EXCLUDED_INVALID/NEEDS_MORE_INFO = 0. Nếu actual_work_hours đã có, dùng max(actual_work_hours, 0). Chỉ khi trường này NULL mới suy từ check-out trừ check-in.
2. **Công từng ngày:** cộng giờ tính lương của các phiên trong ngày, rồi quy đổi dưới 4 giờ = 0; 4 đến dưới 7,5 giờ = 0,5; từ 7,5 giờ = 1. Một ngày tối đa 1 công.
3. **Công thực tế:** tổng công ngày quy đổi cho nhân viên thông thường. Import override có thể thay công theo công chuẩn trừ paid/unpaid leave. Director không có override có mặc định đủ công chuẩn.
4. **Công hưởng lương:** max(actual_days, min(actual_days + paid_leave_days, standard_days)). Phép có lương chỉ bù thiếu đến công chuẩn; không tạo công vượt chuẩn. Công làm thực tế vẫn có thể vượt chuẩn. Công phép không được cộng vào actual_days dùng tính ăn trưa/chuyên cần.
5. **Đơn giá ngày:** contract_salary / standard_days.
6. **Khấu trừ thiếu công:** nếu payable_days < standard_days, contract_salary − ROUND(contract_salary / standard_days × payable_days).
7. **Lương cơ bản sau điều chỉnh:** max(0, contract_salary − khấu trừ thiếu công) + EXTRA_WORKDAY_SALARY.
8. **Công vượt chuẩn:** nếu payable_days > standard_days, EXTRA_WORKDAY_SALARY = ROUND(contract_salary / standard_days × payable_days) − contract_salary. Candidate cho phép công làm thực tế 27/26; phép có lương chỉ bù tối đa đến chuẩn theo comment sign-off ngày 2026-11-06 #2/#3 trong migration.

#### Tiền OT

9. **Đơn giá giờ OT:** contract_salary / standard_days / daily_standard_hours.
10. **Giờ đủ điều kiện:** candidate fn_payable_ot_rows(period) lấy giờ từ reconciliation VERIFIED hiện hành và OT planned của ca đủ điều kiện; trừ khoảng overlap để không trả cùng thời gian hai lần. attendances.overtime_hours thô không phải chứng cứ OT được duyệt.
11. **Hệ số mặc định:** ngày thường ban ngày 1,5; khung 22:00–08:00 là 2,0; Chủ nhật dùng max(hệ số Chủ nhật 2,0, hệ số đêm 2,0), không cộng hai hệ số; lễ/Tết 3,0.
12. **Tiền OT:** ROUND(đơn giá giờ × (giờ thường × hệ số thường + giờ đêm × hệ số đêm + giờ Chủ nhật × hệ số Chủ nhật/đêm + giờ lễ × hệ số lễ), 0).
13. **Giới hạn:** helper/trigger liên quan đặt trần OT tháng 40 giờ. Cần kiểm tra cùng một cách cộng tổng giữa OT ca planned, reconciliation, đơn đang chờ và mọi đường duyệt trước khi dùng như kiểm soát payroll.

#### Phụ cấp, thưởng, bảo hiểm, khoản nhập và tổng

14. **Ăn trưa/đi lại:** mức cấu hình / standard_days × actual_days; nếu bật MEAL_ALLOWANCE_CAP_AT_STANDARD thì thay actual_days bằng min(actual_days, standard_days). Mặc định mức là 1.000.000đ.
15. **Chuyên cần:** mặc định 500.000đ. Công thực tế dưới 20 hoặc số ngày trễ hợp lệ >=5: 0; trễ 3–4 ngày: 50%; trễ 0–2 ngày: 100%.
16. **Phụ cấp chức vụ:** mức position_allowance của chức danh.
17. **Phụ cấp thâm niên:** từ 1 năm lấy mức cấu hình 1 năm; từ đủ 3 năm lấy mức 3 năm; từ đủ 5 năm lấy mức 5 năm.
18. **Phụ cấp dự án:** cộng mức thành viên dự án đang hiệu lực trong kỳ; ưu tiên mức riêng của thành viên khác 0, nếu không lấy mức theo vai trò.
19. **Thưởng kỳ:** COEFFICIENT = base_amount × position_coefficient; CONTRACT_SALARY = lương hợp đồng; loại khác = mức cố định base_amount.
20. **Thưởng năng suất:** lấy commissions.kpi_bonus_amount của kỳ.
21. **Hoa hồng:** lấy commissions.commission_amount của kỳ. SQL procedure không tự tính lại phần trăm bán hàng; nhãn hiện ghi 1% điện thoại/laptop + 3% phụ kiện.
22. **Bảo hiểm nhân viên:** từng khoản = ROUND(base đóng bảo hiểm × tỷ lệ, 0); base = insurance_salary, nếu thiếu dùng basic_salary, nếu thiếu nữa dùng 5.000.000đ. Mặc định BHXH 8%, BHYT 1,5%, BHTN 1%.
23. **Khoản bổ sung Excel:** EXTRA_COMMISSION, EXTRA_BONUS, EXTRA_ALLOWANCE, EXTRA_PENALTY được lấy từ payroll_import_overrides.
24. **Phạt đi trễ:** candidate không tạo PENALTY tự động. Khoản penalty lịch sử hoặc EXTRA_PENALTY import không bị quy tắc này xóa.
25. **Thuế TNCN:** procedure được review không tự tính PIT. Nguồn/khâu nhập PIT cần Payroll Owner xác nhận riêng.
26. **Tổng:** gross_income = earnings + allowances + bonuses; net_salary = gross_income − deductions. Deductions gồm bảo hiểm và deduction khác; BASE_SALARY_DEDUCTION đã trừ trong earnings nên roll-up loại ra để không trừ hai lần.

### 12.5 Đánh giá kiểm soát và quyết định còn thiếu

**Điểm có kiểm soát tốt trong candidate:**

- Loại phiên Attendance bị HR loại/chờ bổ sung khỏi giờ công được trả; không suy lại từ giờ vào/ra nếu actual_work_hours đã được đặt 0.
- OT trả lương tách khỏi giờ ngoài ca thô; candidate loại thời gian overlap giữa VERIFIED và OT planned.
- SQL dùng ROUND(NUMERIC); helper Python dùng Decimal/ROUND_HALF_UP.
- HR resolve khóa hàng phiên, kiểm tra giờ checkout lớn hơn giờ check-in và tính lại giờ làm, giờ sớm, giờ ngoài ca.
- Phạt tiền đi trễ được bỏ khỏi lần tính mới; không đồng nghĩa xóa khoản lịch sử.

**Cần xác nhận trước khi xem là phù hợp vận hành:**

1. Guard Payroll đã từ chối procedure legacy, nhưng cần test trường hợp procedure VERIFIED_ONLY đồng thời đọc giờ OT thô; hiện guard chưa quét overtime_hours trong chính procedure body.
2. Đối chiếu test cho quy tắc 26 công, phép có lương chỉ bù đến chuẩn, công làm thực tế vượt 26 và trần OT; source SQL/Python hiện cùng biểu thức payable days.
3. Chủ nhật ban đêm dùng hệ số lớn nhất chứ không cộng dồn; ngày lễ có ưu tiên riêng; khung đêm hiện là 22:00–08:00. HR/Payroll Owner cần đối chiếu quy chế công ty và quy định áp dụng.
4. Không cộng trùng EXTRA_WORKDAY_SALARY trên mọi màn hình, API, bảng in và export.
5. total_paid_months đếm CONFIRMED cùng PAID; nên đổi tên hoặc chú giải.
6. Procedure không tính PIT; cần chốt quy trình tính/nhập và kiểm tra khoản này không bị mất khi tính lại DRAFT.
7. Kiểm thử parity SQL/Python với làm tròn ranh giới, nhiều phiên/ngày, qua đêm, lễ/CN, giờ nghỉ, phép, review exclusion và khoảng OT giao nhau. Lần review này không chạy test.

### 12.6 Kết luận lần review

- **Thay đổi công thức:** có thay đổi nghiệp vụ thực chất ở cách quy đổi công ngày, lương cơ bản theo công, đi trễ, phụ cấp ăn trưa/chuyên cần và nguồn/hệ số OT. Không chỉ là thay đổi giao diện hoặc giải thích.
- **An toàn:** chưa đủ bằng chứng để kết luận an toàn đưa vào kỳ lương thật. Các quyết định nghiệp vụ đã được ghi nhận phê duyệt trong hội thoại; vẫn cần đối chiếu quyền phê duyệt theo quy trình nhóm, so sánh từng khoản trên fixture synthetic và DBA xác minh migration/procedure đúng môi trường trước khi tính lại DRAFT.
- **Test:** không chạy trong lần review này; số liệu test tại các mục trước là kết quả checkpoint đã ghi, không phải chạy lại.
- **Git:** không stage, commit, push, pull, merge, reset, restore hoặc clean. Không sửa code source; chỉ bổ sung review này vào tài liệu.

### 12.7 Bản đồ vị trí code đã review

- payrolls.py: guard OT dòng 72; bóc tách chi tiết dòng 145–172; tổng thu nhập năm bắt đầu dòng 612; payslip dùng EXTRA_WORKDAY_SALARY dòng 2846–2850.
- operations.py: penalty mặc định dòng 30 và policy loader dòng 171; bảng công tháng dòng 511 trở đi, quy đổi công dòng 669–691; request HR sửa checkout dòng 1265; tính metrics dòng 1295–1333; resolve/khóa phiên bắt đầu dòng 1343, cập nhật checkout quanh dòng 1422.
- payroll_rules.py: làm tròn Decimal dòng 13–26; ngưỡng nghiệp vụ dòng 28–40; quy đổi công dòng 44; lương và phụ cấp dòng 66–138 (payable_work_days dòng 122); giờ đêm/OT dòng 147–175; trần OT và quy tắc tuần dòng 185 trở đi.
- Migration candidate 20261106: giờ công loại trừ dòng 314; nguồn VERIFIED_ONLY/loại overlap dòng 336–379; tổng hợp giờ công và payable days dòng 620–690; khấu trừ/công vượt dòng 721–738; OT dòng 742–773; ăn trưa/chuyên cần dòng 820–843; bảo hiểm dòng 877–891; roll-up gross/net dòng 918–931.

### 12.8 Đính chính trạng thái bảng câu hỏi ở mục 10

Mục 10 là snapshot từ checkpoint trước, không còn phản ánh đầy đủ source candidate hiện tại:

- Câu 2 vẫn đúng với candidate: công thực tế vượt chuẩn có thể tạo EXTRA_WORKDAY_SALARY.
- Câu 3 cần đọc theo logic mới: phép có lương chỉ bù đến công chuẩn; 25 công thực tế + 2 ngày phép cho 26 công hưởng lương, còn 27 công làm thực tế vẫn có thể được trả 27/26. Source SQL ghi sign-off #2/#3; helper Python có payable_work_days cùng quy tắc.
- Câu 4: candidate migration dùng VERIFIED_ONLY và API guard hiện từ chối procedure legacy. Điều này chưa chứng minh migration/procedure đang có trên database; chưa đặt cutoff production.
- Câu 6 vẫn cần quy trình PIT riêng: procedure candidate không tự tính PIT.
- D01–D13 đã được chủ dự án phê duyệt trong trao đổi trước; tài liệu này ghi nhận approval trong hội thoại, không thay thế chữ ký/biên bản phê duyệt của Payroll Owner, Kế toán hoặc DBA nếu quy trình dự án yêu cầu.


