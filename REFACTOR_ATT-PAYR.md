# REFACTOR ATT-PAYR — Tiến độ hoàn thành

Cập nhật: 2026-11-06

## Trạng thái tổng

| Hạng mục | Trạng thái |
|---|---|
| Migration SQL idempotent | ✅ Xong — `backend/migrations/20261106_prorated_allowances_shift_ot_discipline.sql` (đã chạy 2 lần liên tiếp trên Postgres 16 test) |
| Stored procedure `sp_generate_monthly_payroll` | ✅ Xong |
| Backend Python | ✅ Xong |
| Unit test + test SQL | ✅ 179 test liên quan pass (gồm test SQL trên Postgres 16 tạm), frontend build pass — nghiệm thu cuối 2026-11-06 |
| Quyết định nghiệp vụ (sign-off) | ✅ 6/6 đã chốt và áp dụng — xem mục J |
| Công chuẩn thống nhất 26 | ✅ Bảng công, tổng hợp cá nhân, import, SP lương cùng một nguồn |
| Seed tháng 07/2026 | ✅ Chuẩn hóa theo ca cố định — `scripts/seed_july_2026.py` |
| Supabase Local | ✅ Đã sao chép dữ liệu cloud + áp migration 20261106 (chỉ local) |
| Frontend | ✅ Xong — `npm --prefix frontend-web run build` pass, 0 lỗi |
| Tài liệu RAG chatbot | ✅ Xong — sinh lại TZ-DOC-01/02/05/08 (PDF + MD) theo quy chế mới |
| Áp migration lên Supabase | ✅ Local đã áp · Cloud: **không đụng tới** (xem Cam kết môi trường) |

## A. Lương & phụ cấp (công chuẩn cố định 26)

- [x] Lương CB = lương HĐ ÷ 26 × công hưởng lương. **Không chặn trần công làm thực tế**: 27/26 công → khoản mới `EXTRA_WORKDAY_SALARY` (6.000.000 → 6.230.769đ). Phép có lương chỉ bù cho đủ 26 (sign-off #3).
- [x] Thiếu công → `BASE_SALARY_DEDUCTION` = phần chênh lệch. **Bỏ trừ tiền theo phút đi trễ/về sớm.**
- [x] PC ăn trưa & đi lại (`MEAL_ALLOWANCE`) = 1.000.000 ÷ 26 × công thực tế, chặn trần 26 công (tham số `MEAL_ALLOWANCE_CAP_AT_STANDARD`, 0 = không chặn).
- [x] PC chuyên cần (`ATTENDANCE_ALLOWANCE`, 500.000đ): công < 20 hoặc trễ >15' ≥ 5 lần → 0; 3–4 lần → 50%; còn lại 100%.
- [x] Bãi bỏ phạt tiền `PENALTY` (-50.000đ/lần): SP không sinh khoản này, `LATE_PENALTY_AMOUNT` bị tắt, dashboard chấm công không còn hiển thị tiền phạt.
- [x] Giám đốc: mặc định đủ 26 công, đủ PC ăn trưa & chuyên cần.
- [x] Tham số mới trong `payroll_policy_settings`: `PRORATE_STANDARD_DAYS`, `ATTENDANCE_ALLOWANCE`, `ATTENDANCE_ALLOWANCE_MIN_DAYS`, `MEAL_ALLOWANCE_CAP_AT_STANDARD`, `LATE_WARNING_THRESHOLD_DAYS`, `OVERTIME_RATE_NIGHT`, `MAX_MONTHLY_OT_HOURS`.

## B. Công ngày & danh mục ca

- [x] Quy đổi công/ngày (`fn_work_day_credit`): < 4h = 0; 4h–< 7.5h = 0.5; ≥ 7.5h = 1.0 (tối đa 1 công/ngày, cộng gộp các phiên trong ngày).
- [x] `work_shifts` thêm `break_minutes`, `planned_overtime_hours`. Chuẩn hóa theo mã ca hiện có:
  - `CA_SANG` 08–16, 8h, ăn trưa luân phiên (không trừ giờ)
  - `CA_CHIEU` 13–21, 8h
  - `CA_HANH_CHINH` 08–17, trừ 1h nghỉ = 8h
  - `CA_FULL` 08–21, trừ 1h = 12h → **8h công + 4h OT tự động** (`work_hours` 12 → 8)
- [x] Check-out trừ nghỉ giữa ca (`net_work_hours`); nghỉ giữa ca được chụp vào `attendance_context` lúc check-in.
- [x] HR xác minh giờ ra (`operations.py`, `verified_check_out_time`) cũng trừ nghỉ giữa ca (`verified_session_hours`).

## C. Phân ca T2–CN & OT

- [x] API tuần `view=week` trả T2 → CN; lịch web luôn hiển thị 7 ngày (bỏ nút "Hiện Chủ nhật").
- [x] Phân ca: **chặn** khi nhân viên không còn ngày OFF trong tuần (409 `WEEKLY_DAY_OFF_REQUIRED`) và **chặn** khi > 48h công chuẩn/tuần (409 `WEEKLY_HOURS_OVER_48`, sign-off #5).
- [x] Modal "Danh mục ca" (`ShiftTemplateModal`) — HR/Giám đốc sửa giờ ca, nghỉ giữa ca, OT tự động; API `PUT /discipline/shifts/{id}` kiểm tra giờ thực tế = giờ công + OT.
- [x] OT đêm 22:00–08:00 hệ số 2.0: `attendance_overtime_approvals.night_hours` tính từ `eligible_intervals` khi xác nhận đối soát; duyệt kiểu cũ ước lượng từ giờ check-out.
- [x] Trần 40h OT/tháng — chặn cứng 3 lớp: duyệt đơn OT / duyệt đơn thay thế / xác nhận đối soát (`app/core/ot_cap.py`), phân ca `CA_FULL` (+4h), và trigger DB `trg_guard_monthly_ot_cap`.

## D. Kỷ luật & Black-list

- [x] Bảng `disciplinary_records` (`LATE_WARNING_REPORT`), cột `employees.is_blacklisted_warning`.
- [x] `fn_evaluate_late_discipline(period)`: ≥ 5 ngày trễ >15' → lập biên bản (tự hủy nếu dữ liệu công được sửa lại < 5); biên bản 3 tháng liên tiếp → gắn cờ BLACK_LIST_WARNING. Tự chạy trong SP tính lương.
- [x] API `/discipline/records`, `/discipline/evaluate`, `/discipline/records/{id}/status`, `/discipline/blacklist/{id}/clear`.
- [x] Trang Chấm công tháng: panel cảnh báo kỷ luật, badge "Biên bản" / "BLACK_LIST_WARNING", mức chuyên cần thay cho tiền phạt.
- [x] Gỡ chữ "Phạt 50.000₫" khỏi modal chi tiết chấm công, bản in bảng công, dialog quy chế lương; phiếu lương cũ có `PENALTY` ghi rõ "quy chế cũ, đã bãi bỏ".

## E. Tài liệu chatbot (RAG)

- [x] `scripts/generate_knowledge_pdfs.py` cập nhật quy chế mới; đã sinh lại `backend/data/knowledge_base_pdfs/TZ-DOC-01/02/05/08` và `docs/knowledge_base_sources/*.md`.
- [x] Bộ đánh giá `scripts/evaluate_ragas.py` TC-01 đổi đáp án chuẩn sang chuyên cần/biên bản.

## F. Công chuẩn thống nhất 26 & bảng công

- [x] Migration 20261106 mục 5b: `v_payroll_period_working_days.applied_standard_days` = kỳ đã chốt → HR ghi đè → `PRORATE_STANDARD_DAYS` (26); số ngày theo lịch (trừ CN, lễ) chuyển sang cột tham khảo `calendar_working_days`. `fn_payroll_standard_days` và SP tính lương đọc cùng nguồn.
- [x] Bảng công tháng (`/operations` monthly) và tổng hợp chấm công cá nhân (`/attendances` summary): "công" = công quy đổi 0 / 0.5 / 1 (giống phiếu lương); thêm `present_days` = số ngày có mặt.
- [x] Web: cột "x / 26 công", banner "Cố định theo quy chế; lịch tháng có N ngày làm việc", bản in & modal chi tiết hiển thị công quy đổi; dialog quy chế lương sửa mô tả công chuẩn.

## G. Seed & nghiệm thu tháng 07/2026

- [x] `scripts/seed_july_2026.py` viết lại: đọc ca theo mã (CA_SANG/CA_CHIEU/CA_FULL), dừng nếu danh mục ca chưa chuẩn; không tự sửa `work_shifts`; giờ làm ca sáng 08–16 = 8h (trước đây ghi 7h); mọi tuần nghỉ Chủ nhật (bỏ ca Chủ nhật 12/07 vi phạm ngày OFF, chuyển kịch bản sang 13/07); đối soát OT có `eligible_intervals` để tính giờ đêm; bỏ chú thích phạt 50k; chạy đánh giá kỷ luật sau khi seed.
- [x] Kịch bản (lương HĐ 6.000.000đ): NV #5 27/26 công → 6.230.769đ, PC ăn trưa 1.000.000đ, chuyên cần 100%, Ca Full Thứ 7 8h + 4h OT; NV #4 6 ngày trễ → mất chuyên cần + biên bản, ngày 9 = 0.5 công → 26.5 công; NV #3 3 ngày trễ → chuyên cần 250.000đ, OT 21:00–23:00 (1h thường + 1h đêm x2.0), phiên 5 phút = 0 công → 26 công.
- [x] `tests/test_seed_july_2026.py`: 9 test thuần + 6 test SQL (SP tháng 07 khớp bảng công, công chuẩn 26 / lịch 27, biên bản chỉ NV #4, OT tự động Ca Full).

## H. Đồng bộ trang công, sửa lỗi lương năm, dữ liệu test từ cloud (2026-11-06)

- [x] **Bảng công cá nhân / Quản lý công** (`AttendancePage`): bỏ diễn giải "N ngày lịch − Chủ nhật − lễ"; hiển thị "26 công · cố định theo quy chế (lịch tháng có N ngày làm việc)"; thẻ ngày công = công quy đổi + số ngày có mặt; bỏ "Trễ/sớm tính lương"; thẻ đi muộn đếm **ngày trễ hợp lệ** + mức chuyên cần + biên bản. API `/attendances/my-summary` trả `late_arrivals.days/allowance_tier/late_warning_report`, `working_days.calendar_working_days`.
- [x] **Quản lý công & Đối soát đi trễ** và phiếu lương dùng chung quy tắc trễ hợp lệ: hàm SQL `fn_attendance_counts_as_late` (khớp `operations.is_valid_late_session`: HR xác nhận/loại trừ, lệch ca, phiên ≤ 15 phút, trễ > 240 phút chờ rà soát). SP lương và `fn_evaluate_late_discipline` không còn đếm mọi phiên `late_minutes > 15`. Đã kiểm chứng trên dữ liệu thật: số công và ngày trễ của 2 trang khớp nhau cho mọi nhân viên kỳ 09 và 10/2026.
- [x] **Lỗi `GET /payrolls/employee/{id}/annual`**: (1) DB local thiếu cột `payrolls.total_earnings...` (schema local dựng từ `000_base_schema.sql` cũ) → hết lỗi sau khi đồng bộ schema từ cloud; (2) tổng năm lấy từ view `v_annual_salary_summary` cộng cả phiếu DRAFT (VD NV #2: 6 tháng / 99,5tr trong khi danh sách chỉ 2 tháng đã chốt / 31,1tr) → nay cộng trực tiếp từ các phiếu CONFIRMED/PAID, khớp từng dòng tháng.
- [x] **Dữ liệu test**: sao chép một lần (chỉ đọc cloud, `pg_dump` 17) toàn bộ schema + dữ liệu `public` của Supabase Cloud vào Supabase Local; 56/56 bảng khớp số dòng. Sao lưu local trước đó: scratchpad `dbcopy/local_backup_before_cloud_copy.sql`. Sau đó áp lại migration 20261106 lên local (2 lần, idempotent).
- Lưu ý: kỳ 08, 09/2026 (PAID) và 10/2026 (có 1 phiếu CONFIRMED) giữ công chuẩn đã khóa (22 / 24 / 27). Muốn kỳ 10/2026 theo 26 công: HR mở lại phiếu CONFIRMED rồi tính lại kỳ.

## Cam kết môi trường

Kể từ 2026-11-06, mọi thao tác phát triển, migration, seed và test của refactor này **chỉ chạy trên Supabase Local** (`techzone-hrm-local`, 127.0.0.1:55322). **Không kết nối, đọc, ghi, migrate hay seed lên Supabase Cloud** (`backend/.env.cloud`), không `supabase link` / `db push`, không chuyển profile `cloud`. Lần sao chép dữ liệu ở mục H là lần đọc cloud duy nhất, theo yêu cầu trực tiếp của chủ dự án; cần dữ liệu mới thì dùng bản local đã sao chép.

## Kiểm thử

- `backend/tests/test_payroll_attendance_refactor.py`: 24/26, 27/26 công, chuyên cần 3/5 lần trễ, < 20 công, nửa công, ca Full 13h → 8h + 4h OT, OT đêm x2.0, trần 40h, biên bản 5 ngày + Black-list, chặn ngày thứ 7.
- Test SQL cần `HRM_TEST_PG_DSN` trỏ tới DB rỗng tên `*_test` (tự skip nếu không có).
- Đã cập nhật 4 test cũ theo quy tắc mới: tuần T2–CN (`test_work_schedules.py`), snapshot nghỉ giữa ca (`test_attendance_sessions.py`).
- Nghiệm thu cuối 2026-11-06: 157 test (thêm 8 test đối chiếu quy tắc trễ SQL ↔ bảng công); trước đó 149 test (refactor, tháng 07, phân ca, chấm công, OT, đối soát, import) pass, gồm test SQL trên Postgres 16 tạm; frontend build pass.
- `test_attendance_overdue_and_resolution.py`, `test_work_schedule_self_healing.py` cần dữ liệu seed trên Supabase local (DB đang trống → lỗi khóa ngoại `employee_id=4`), không phải lỗi code.
- Toàn bộ suite: các lỗi còn lại đều có sẵn từ trước / do môi trường (Windows `ProactorEventLoop` với psycopg async, test kết nối Supabase), không liên quan refactor.

## Việc còn lại / lưu ý

- [x] Áp migration lên Supabase **Local** (đã xong).
- [x] **Tính lại** các kỳ DRAFT-only `2026-01`, `2026-02`, `2026-07`; kỳ `2026-10` có phiếu CONFIRMED nên được backend giữ nguyên theo guard.
- [x] Backend mới cần migration (check-out đọc `work_shifts.break_minutes`) — local đã đáp ứng.
- [ ] Phiếu lương cũ có khoản `PENALTY` vẫn hiển thị như cũ (dữ liệu lịch sử).
- [x] Seed dữ liệu tháng 07/2026 trên Local, tính lại kỳ lương và đối chiếu công; chi tiết ở checkpoint nghiệm thu bên dưới.
- [ ] Nạp lại vector store chatbot: chưa chạy vì thiếu `MISTRAL_API_KEY` và script hiện có thể xóa vector cũ rồi ghi embedding NULL.
- [x] ~~Tài liệu RAG còn ghi phạt 50.000đ~~ — đã cập nhật.
- [x] ~~HR xác minh check-out chưa trừ nghỉ giữa ca~~ — đã sửa.

## Checkpoint nghiệm thu Local — 2026-11-06

### Môi trường và an toàn dữ liệu

- Chỉ dùng container Supabase Local `techzone-hrm-local`, trạng thái `healthy`, cổng host `55322`; backend runtime xác nhận `127.0.0.1:55322/postgres`, schema `public`.
- `OT_REGISTRATION_POLICY_MODE=DISABLED`; không kết nối hoặc ghi Supabase Cloud.
- Trước thao tác ghi, tạo backup PostgreSQL dạng custom tại `%TEMP%/techzone_hrm_local_before_refactor_20261106.dump` (1.290.513 bytes, SHA-256 `6665823085B18B0777146E68C0B4E36BFE0A3229255CED1244351B4C5D014062`). Chưa thực hiện restore drill.

### Seed và tính lại Payroll

- Seed tháng 07/2026: **PASS LOCAL**. Lệnh trực tiếp `python scripts/seed_july_2026.py` không import được `app` do script không thêm thư mục backend vào `sys.path`; chạy tương đương bằng `python -m scripts.seed_july_2026` từ `backend/` thành công.
- Script seed đã xóa 2 event đối soát OT cũ gắn với các yêu cầu tháng 7 trước khi tạo fixture mới; thao tác chỉ ở Local và có backup trước đó. Không có case ngoại lệ hoặc minh chứng ảnh liên kết với các phiên bị thay thế.
- Seed đã tạo 81 lịch, 81 phiên chấm công, 4 đơn OT được đối soát và 1 biên bản đi trễ. Kết quả kiểm tra: NV #3 = 26/26 công, 3 ngày trễ hợp lệ; NV #4 = 26,5/26 công, 5 ngày trễ hợp lệ; NV #5 = 27/26 công, 0 ngày trễ hợp lệ.
- Đã tính lại các kỳ DRAFT-only `2026-01`, `2026-02`, `2026-07` qua hàm nghiệp vụ `execute_payroll_calculation` của backend với actor HR_MANAGER local đã xác minh. Mỗi kỳ có 6 phiếu DRAFT sau tính lại.
- Tổng kết quả sau tính lại: `2026-01` gross 57.500.000 / net 46.632.500; `2026-02` gross 109.500.000 / net 98.632.500; `2026-07` gross 103.433.293 / net 92.565.793.
- Kỳ `2026-10` **SKIP có chủ đích**: trong cùng kỳ có 1 phiếu CONFIRMED và 5 DRAFT; guard backend trả HTTP 409 cho toàn kỳ. Không tính lại hay sửa kỳ này.
- Sau thao tác, digest của 12 phiếu CONFIRMED/PAID và 73 chi tiết tương ứng khớp chính xác với baseline trước thao tác. Dữ liệu PENALTY lịch sử vẫn có 5 dòng, tổng 950.000; không có PENALTY mới trong các kỳ được tính lại.

### Kiểm thử và việc còn lại

- `tests/test_seed_july_2026.py`: **9 PASS, 6 SKIP**. Sáu test SQL bị skip vì không cấu hình `HRM_TEST_PG_DSN`; các kết quả trên database Local được xác minh riêng bằng truy vấn sau thao tác.
- Nạp lại vector store chatbot: **BLOCKED / NOT RUN**. `MISTRAL_API_KEY` không có trong cấu hình local hoặc process. Script hiện tại khi thiếu key vẫn xóa các chunk `TZ-DOC%` hiện có rồi nạp lại với embedding `NULL`; trước thao tác đã có 89 chunk tài liệu TechZone và 3 embedding NULL. Không chạy để tránh làm mất vector đang dùng. Cần cấu hình khóa embedding trong môi trường local theo quy trình bảo mật, không gửi khóa qua chat, rồi rà soát chế độ fail-closed trước khi chạy lại.
- Mục “phiếu lương cũ hiển thị PENALTY” chưa kiểm tra giao diện trình duyệt; chỉ xác nhận các dòng dữ liệu lịch sử còn nguyên.
- Không sửa source ứng dụng, `.env`, Git hoặc dữ liệu Cloud trong checkpoint này.

## I. OT chỉ tính khi HR xác minh, chốt rủi ro trước merge (2026-11-06)

- [x] Thẻ "Tăng ca OT" (Bảng công cá nhân) chỉ hiển thị OT HR đã đối soát VERIFIED + OT tự động Ca Full; giờ ngoài ca thô tách sang thẻ "Giờ ngoài ca (chưa xác minh)", không tính lương. Kiểm chứng local: NV #4 kỳ 09/2026 có 68,4h ngoài ca thô → 0h OT.
- [x] SP lương VERIFIED_ONLY qua `fn_payable_ot_rows`; công ngày qua `fn_attendance_payable_hours` (phiên EXCLUDED_INVALID / NEEDS_MORE_INFO = 0, bỏ suy giờ khi actual = 0). Chốt an toàn backend cập nhật để chấp nhận SP mới.
- [x] ADMIN bị chặn 403 khi xử lý / sửa giờ phiên chấm công.
- [x] HR sửa giờ ra: tính lại `early_minutes`, `overtime_hours`; chặn giờ ra ≤ giờ vào.
- [x] Làm tròn tiền trong `payroll_rules.py` khớp `ROUND()` PostgreSQL.
- [x] Seed tháng 07: chữ ký đối soát thật, chạy trực tiếp được; đã seed lại và tính lại kỳ 07/2026 (toàn DRAFT) trên Local — OT #3 277.644đ, #4 432.692đ, #5 376.803đ.
- [x] Kế toán / HR đã chốt 6 điểm nghiệp vụ — áp dụng ở mục J.

## J. Áp dụng quyết định nghiệp vụ & nghiệm thu cuối (2026-11-06)

### Quyết định đã chốt → thay đổi

- [x] **#1 PC ăn trưa theo công thực tế, phép có lương không tính** — giữ nguyên (đã đúng).
- [x] **#2 27 công được trả phần vượt `EXTRA_WORKDAY_SALARY`** — giữ nguyên (đã đúng).
- [x] **#3 Phép có lương chỉ bù cho đủ 26** — SP: `payable_days = GREATEST(actual_days, LEAST(actual_days + paid_leave, 26))`; Python `payable_work_days`. Dùng `GREATEST` để giữ quyết định #2 (27 công làm thực tế vẫn = 27). Ví dụ: 25 công + 2 phép = 26 (trước đây 27).
- [x] **#4 Bỏ hẳn luồng OT legacy, chỉ VERIFIED + OT Ca Full** — `PUT /payrolls/overtime-approvals/{id}` luôn 409 `OT_LEGACY_APPROVAL_CLOSED` ở mọi chế độ; danh sách cũ chỉ tra cứu (nút duyệt bị khóa). Chốt an toàn tính lương **từ chối SP kiểu legacy**. Cột "OT đã duyệt" ở danh sách bảng lương và cột OT trong file Excel import mẫu chuyển sang `fn_payable_ot_rows`.
- [x] **#5 Vượt 48h/tuần chặn cứng** — `check_weekly_schedule` → lỗi `WEEKLY_HOURS_OVER_48`; API phân ca 409; drawer phân ca chặn (không còn hỏi "vẫn tiếp tục?"), hướng dẫn đăng ký OT. 6 ca × 8h = 48h vẫn hợp lệ.
- [x] **#6 Thuế TNCN Phase 1 = Kế toán import** — trước đây file import **không có** cột thuế nên không có đường đưa PIT vào phiếu. Đã thêm cột tùy chọn thứ 18 "Thuế TNCN (Kế toán)" (mẫu tải về có sẵn cột), lưu `payroll_import_overrides.personal_income_tax`, SP sinh khoản `PIT` trừ vào thực lĩnh. File mẫu cũ 17 cột vẫn import được và giữ nguyên thuế đã nhập. Tự động tính PIT: Phase 2.

### Nghiệm thu trên Supabase Local (chỉ Local, không đụng Cloud)

- Áp migration 20261106 bản cuối: thành công; chốt an toàn VERIFIED_ONLY: OK trên DB thật.
- Tính lại các kỳ toàn DRAFT qua `execute_payroll_calculation` (actor `hr_manager`):

  | Kỳ | Phiếu | Gross | Net | PENALTY mới |
  |---|---|---|---|---|
  | 2026-01 | 7 | 59.500.000 | 47.792.500 | 0 |
  | 2026-02 | 7 | 118.000.000 | 106.292.500 | 0 |
  | 2026-07 | 7 | 105.433.293 | 93.725.793 | 0 |

- Số phiếu tăng từ 6 lên 7 so với checkpoint trước do NV #6 (TZ-006) trên Local đã được đổi `ON_LEAVE` → `ACTIVE` lúc 01:16 UTC ngày 2026-11-06 (sau checkpoint, không phải do refactor); SP lập phiếu cho mọi nhân viên ACTIVE/PROBATION.
- OT kỳ 07/2026 từ nguồn VERIFIED: NV #3 = 277.644đ (1h thường + 1h đêm ×2.0), NV #4 = 432.692đ (5h), NV #5 = 376.803đ (1,5h đối soát + 4h Ca Full).
- Digest toàn bộ phiếu CONFIRMED/PAID + chi tiết **không đổi** trước/sau thao tác. Kỳ 2026-10 (có phiếu CONFIRMED) không tính lại.

### Kiểm thử

- 179 test pass: refactor (OT VERIFIED_ONLY, phiên loại trừ = 0 công, phép bù đủ 26, PIT import trừ vào net, 48h chặn 409, làm tròn khớp PostgreSQL, HR sửa giờ ra, ADMIN 403), nghiệm thu tháng 07, chốt an toàn SP, chính sách OT legacy, import Excel (cột thuế, mẫu cũ 17 cột), phân ca, chấm công. Test SQL chạy trên Postgres 16 tạm (`HRM_TEST_PG_DSN`).
- `npm --prefix frontend-web run build`: pass.

### Còn lại

- [ ] Nạp lại vector store chatbot — vẫn chờ `MISTRAL_API_KEY` và chế độ fail-closed của script.
- [ ] Áp lên Supabase Cloud — chỉ Project Owner thực hiện theo `update-supabase-cloud.md`; migration và backend phải deploy cùng lúc.
- [ ] Phase 2: tự động tính Thuế TNCN.
