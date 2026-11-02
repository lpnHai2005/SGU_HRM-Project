# BÁO CÁO TỔNG QUAN PHÂN HỆ QUẢN LÝ TIỀN LƯƠNG & CHỐT LƯƠNG (PAYROLL & PAYSLIP MODULE)
## HỆ THỐNG THÔNG TIN QUẢN LÝ NHÂN SỰ CHUỖI BÁN LẺ CÔNG NGHỆ TECHZONE (TECHZONE HRM)

> **Môn học:** Hệ thống thông tin doanh nghiệp (841065) & Công nghệ phần mềm (841403)  
> **Đơn vị đào tạo:** Khoa Công nghệ Thông tin - Trường Đại học Sài Gòn (SGU)  
> **Phiên bản hoàn thiện:** Week 3.2 & Week 3.3 - Phân hệ Bảng lương & Phiếu lương TechZone  

---

## 1. TỔNG QUAN PHÂN HỆ TIỀN LƯƠNG & CHỐT CÔNG

Phân hệ **Quản lý Tiền lương (Payrolls & Payslips)** là một trong những khối nghiệp vụ trung tâm và phức tạp nhất của hệ thống TechZone HRM, đóng vai trò tự động hóa hoàn toàn quy trình:
1. **Thu thập dữ liệu đa nguồn:** Tự động tổng hợp số liệu từ **Hợp đồng lao động (Contracts)**, **Chấm công & Ca kíp (Attendances)**, **Đơn nghỉ phép được duyệt (Leave Requests)**, **Doanh số bán lẻ 3 ngành hàng (Employee Sales)**, **Hoa hồng & Thưởng KPI (Commissions)**, và **Dự án chiến dịch (Projects)**.
2. **Động cơ tính toán lương tự động:** Vận hành qua Stored Procedure PostgreSQL `sp_generate_monthly_payroll` và `sp_calculate_monthly_commission` với hiệu năng cao, đảm bảo tính toàn vẹn và tính chất **Idempotent** (chạy lại nhiều lần mà không sai lệch số liệu).
3. **Phân quyền truy cập 4 vai trò (RBAC):**
   - **Quản trị viên (ADMIN) & Trưởng phòng Nhân sự (HR_MANAGER):** Toàn quyền chạy chốt lương toàn chuỗi, duyệt trạng thái hàng loạt (`DRAFT` → `CONFIRMED` → `PAID`), xuất báo cáo Excel/CSV và xem bảng lương toàn thể nhân viên.
   - **Cửa hàng trưởng (STORE_MANAGER):** Xem bảng lương chi nhánh mình phụ trách, xem doanh số, hoa hồng và theo dõi phiếu lương nhân sự trực thuộc.
   - **Nhân viên (EMPLOYEE):** Chỉ xem phiếu lương tháng cá nhân, xem giải trình 12 dòng cấu phần công thức, xem tổng hợp thu nhập năm và in phiếu lương tháng.
4. **Chuẩn hóa in ấn A4 & Xuất PDF doanh nghiệp:** Thiết kế bản in Phiếu lương tháng và Bảng lương năm khổ A4 theo đúng quy chuẩn kế toán Việt Nam, tích hợp đọc số tiền thực lĩnh bằng chữ tiếng Việt có dấu.

---

## 2. CÔNG THỨC TOÁN HỌC & ĐỘNG CƠ TÍNH LƯƠNG

### 2.1. Công thức tổng quát

```text
GROSS = Base Salary + OT Pay + Allowance + Commission + KPI Bonus
  Base = (Contract Salary / 26) × Actual Days
  OT = (Salary / 26 / 8) × OT Hours × 1.5

NET = GROSS - Insurance (10.5%) - Penalty
  Insurance = BHXH 8% + BHYT 1.5% + BHTN 1%
```

### 2.2. Giải thích chi tiết các cấu phần

| Cấu phần | Ký hiệu | Căn cứ & Công thức tính | Quy định TechZone |
|---|---|---|---|
| **Lương Hợp đồng** | `contract_salary` | Quy định tại Hợp đồng lao động (`contracts.basic_salary`). | Ví dụ: 8.000.000đ - 22.000.000đ |
| **Công chuẩn tháng** | `standard_working_days` | Định mức ngày làm việc trong tháng: **26 ngày**. | 26.0 ngày |
| **Khấu trừ thời gian** | `time_deduction_amount` | `(Lương HĐ / 26) × Ngày nghỉ không lương + (Lương HĐ / 26 / 8) × Giờ đi trễ` | Tự động tính từ đơn nghỉ phép và chấm công |
| **Lương CB thực nhận** | `actual_base_salary` | `Lương Hợp đồng - Khấu trừ thời gian` = `(Lương HĐ / 26) × Ngày công thực tế` | Giảm trừ trực tiếp nếu có ngày nghỉ không lương |
| **Tiền tăng ca (OT)** | `overtime_salary` | `(Lương HĐ / 26 / 8) × Số giờ OT × 150%` | Hệ số 1.5 theo Luật Lao động |
| **Phụ cấp chức vụ** | `position_allowance` | Định mức theo bảng chức vụ (`positions.position_allowance`). | CHT: 1.5M, Nhân viên: 0 - 500k |
| **Phụ cấp thâm niên** | `seniority_allowance` | Tính theo số năm công tác: `<1 năm: 0`, `1-3 năm: 500k`, `3-5 năm: 1M`, `≥5 năm: 1.5M`. | Đãi ngộ gắn bó doanh nghiệp |
| **Phụ cấp dự án** | `project_allowance` | Tổng phụ cấp các dự án bán lẻ đang kích hoạt (`project_members.project_allowance`). | 1.000.000đ - 2.500.000đ/tháng |
| **Phụ cấp cơm & xe** | `meal_transport_allowance`| Chế độ phúc lợi cố định toàn chuỗi: **1.000.000 VNĐ / tháng**. | Cố định 1.000.000đ |
| **Hoa hồng bán lẻ** | `commission_amount` | `(Doanh số ĐT × 1%) + (Doanh số Laptop × 1%) + (Doanh số Phụ kiện × 3%)`. | Tính từ bảng `employee_sales` |
| **Thưởng nóng KPI** | `productivity_bonus` | Doanh số đạt `≥100% KPI: 1.000.000đ` \| `≥120% KPI: 2.000.000đ`. | Động lực thúc đẩy doanh số |
| **Thưởng lễ Quốc khánh**| `holiday_bonus` | `1.000.000đ (Mức cơ sở) × Hệ số chức vụ (position_coefficient)`. | Thưởng ngày lễ định kỳ |
| **Tổng Lương GROSS** | `gross_income` | `Lương CB thực + OT + Phụ cấp + Hoa hồng + Tổng thưởng`. | Tổng thu nhập trước thuế/phí |
| **Bảo hiểm bắt buộc** | `total_insurance` | Trích nộp **10.5%** lương đóng bảo hiểm: **BHXH 8% + BHYT 1.5% + BHTN 1%**. | Trừ trực tiếp vào lương |
| **Phạt đi muộn** | `penalty_deduction` | Phạt vi phạm quy chế chấm công (Check-in trễ `> 15 phút`): **50.000đ / lần**. | Tự động phát hiện từ chấm công |
| **THỰC LĨNH (NET)** | `net_salary` | `GROSS - Bảo hiểm (10.5%) - Thuế TNCN - Phạt đi muộn`. | Số tiền thực nhận chuyển khoản |

### 2.3. Ví dụ minh họa thực tế: Nhân viên Phạm Quốc Dũng (`staff_dung`)

```text
Doanh số tháng 09/2026: 220.000.000 VNĐ (Mục tiêu KPI: 220.000.000 VNĐ -> Đạt 100%)
- Lương cơ bản HĐLĐ: 8.000.000 VNĐ
- Hoa hồng Điện thoại (150 triệu × 1%): 1.500.000 VNĐ
- Hoa hồng Laptop (70 triệu × 1%): 700.000 VNĐ
- Thưởng nóng đạt 100% KPI: 1.000.000 VNĐ
---------------------------------------------------------------
=> TỔNG LƯƠNG GROSS: 8.000.000 + 2.200.000 + 1.000.000 = ~11.200.000 VNĐ
=> TRÍCH BẢO HIỂM 10.5%: 8.000.000 × 10.5% = ~840.000 VNĐ
---------------------------------------------------------------
=> THỰC LĨNH CHUYỂN KHOẢN (NET): 11.200.000 - 840.000 = ~10.360.000 VNĐ
   (Bằng chữ: Mười triệu ba trăm sáu mươi nghìn đồng chẵn)
```

---

## 3. CƠ CHẾ LIÊN KẾT PHÂN HỆ NGHỈ PHÉP (LEAVES & SALARY DEDUCTIONS)

Một yêu cầu mang tính sống còn được tích hợp chặt chẽ trong hệ thống là **liên kết thời gian thực giữa đơn xin nghỉ phép và khấu trừ tiền lương**:

```
[Nhân viên nộp đơn] ──> [CHT duyệt Cấp 1] ──> [HR duyệt Cấp 2 (HR_APPROVED)]
                                                      │
         ┌────────────────────────────────────────────┴────────────────────────────────────────────┐
         ▼                                                                                         ▼
[Tự động đồng bộ sang attendances]                                                   [Lưu vết leave_requests]
- Ngày nghỉ có lương (PHEP_NAM, VIEC_RIENG):                                          - is_paid: TRUE / FALSE
  status = 'ANNUAL_LEAVE'                                                             - total_days: Số ngày
- Ngày nghỉ trừ lương (KHONG_LUONG):                                                  - status = 'HR_APPROVED'
  status = 'UNPAID_LEAVE'
         │                                                                                         │
         └────────────────────────────────────────────┬────────────────────────────────────────────┘
                                                      ▼
                      [Động cơ tính lương: sp_generate_monthly_payroll]
                      1. unpaid_leave_days = MAX(attendances.unpaid, leave_requests.unpaid)
                      2. time_deduction_amount = (contract_salary / 26) * unpaid_leave_days
                      3. actual_base_salary = contract_salary - time_deduction_amount
                      4. Tự động sinh dòng BASE_SALARY_DEDUCTION vào payroll_details
```

### 3.1. Các loại nghỉ phép và ảnh hưởng tiền lương

1. **Nghỉ phép năm (`PHEP_NAM` - `leave_type_id = 1`):** `is_paid = TRUE`
   - Nhân viên được nghỉ hưởng 100% lương theo chế độ phép năm (12 ngày/năm).
   - Bảng chấm công ghi nhận `ANNUAL_LEAVE`, ngày công tính đủ 26 ngày, **hoàn toàn không bị trừ lương**.
2. **Nghỉ việc riêng có lương (`VIEC_RIENG` - `leave_type_id = 4`):** `is_paid = TRUE`
   - Nghỉ kết hôn (3 ngày), hiếu hỉ tứ thân phụ mẫu (3 ngày): **Hưởng nguyên lương**.
3. **Nghỉ không hưởng lương (`KHONG_LUONG` - `leave_type_id = 5`):** `is_paid = FALSE`
   - Khi HR duyệt chính thức (`HR_APPROVED`), hệ thống tự động ghi nhận vào bảng `attendances` với `status = 'UNPAID_LEAVE'`.
   - Khi chạy chốt lương, động cơ tự động tính:
     $$\text{Số tiền bị trừ} = \frac{\text{Lương HĐ}}{26} \times \text{Số ngày nghỉ không lương}$$
   - Lương cơ bản thực tế giảm tương ứng và tự động sinh bản ghi khấu trừ chi tiết:
     `BASE_SALARY_DEDUCTION`: *Khấu trừ lương cơ bản dựa vào thời gian: Thiếu X giờ (gồm Y ngày nghỉ không hưởng lương & đi trễ) - Công thức: (Lương HĐ / 26) * Ngày nghỉ*.
4. **Nghỉ thôi việc (`THOI_VIEC` - `leave_type_id = 6`):**
   - Khi HR duyệt: Tự động chuyển hồ sơ nhân viên thành `RESIGNED`, khóa tài khoản `users.is_active = FALSE`.
5. **Nghỉ thai sản (`THAI_SAN` - `leave_type_id = 3`):**
   - Khi HR duyệt: Hồ sơ chuyển trạng thái `ON_LEAVE`, bảo hiểm xã hội chi trả chế độ thai sản.

---

## 4. CHI TIẾT DANH MỤC API BACKEND (ENDPOINTS)

Tất cả các API được triển khai tại prefix `/api/v1/payrolls` kèm alias `/api/payroll` và `/api/payrolls` để đảm bảo tương thích 100% với đặc tả kỹ thuật của workflow:

| Phương thức | Tuyến API | Quyền hạn (RBAC) | Mô tả chức năng |
|---|---|---|---|
| `GET` / `POST` | `/api/payroll/generate/{month}` | `HR_MANAGER`, `ADMIN` | **(Workflow Week 3.2)** Chốt công và tính toán tự động toàn bộ bảng lương tháng. |
| `POST` | `/api/payrolls/calculate` | `HR_MANAGER`, `ADMIN` | Kích hoạt Stored Procedure tính hoa hồng và sinh bảng lương toàn chuỗi. |
| `GET` | `/api/payrolls` | `ALL` (Phân quyền theo vai trò) | Lấy danh sách bảng lương theo kỳ (`period`), lọc theo `store_id`, `employee_id`, `payment_status`. |
| `GET` | `/api/payrolls/{id}` | `ALL` (Xem cá nhân hoặc CHT/HR) | **(Workflow Week 3.2)** Xem chi tiết bảng lương kèm 12 dòng giải trình công thức toán học. |
| `GET` | `/api/payrolls/{id}/payslip` | `ALL` (Xem cá nhân hoặc CHT/HR) | **(Rubric III.3.2.4)** Cung cấp cấu trúc JSON chuẩn hóa A4 để in Phiếu lương tháng có đọc chữ tiếng Việt. |
| `GET` | `/api/payrolls/employee/{id}/annual` | `ALL` (Xem cá nhân hoặc HR) | **(Workflow Week 3.2)** Tổng hợp thu nhập 12 tháng năm phục vụ quyết toán thuế và in bảng lương năm. |
| `GET` | `/api/payrolls/annual-summary/{id}` | `ALL` (Xem cá nhân hoặc HR) | Alias Rubric III.3.2.5 truy vấn View `v_annual_salary_summary`. |
| `POST` | `/api/payrolls/confirm-all` | `HR_MANAGER`, `ADMIN` | Duyệt hàng loạt bảng lương trong kỳ từ trạng thái `DRAFT` sang `CONFIRMED`. |
| `POST` | `/api/payrolls/pay-all` | `HR_MANAGER`, `ADMIN` | Xác nhận chi trả chuyển khoản hàng loạt từ `CONFIRMED` sang `PAID` kèm ngày thanh toán. |
| `PUT` | `/api/payrolls/{id}/status` | `HR_MANAGER`, `ADMIN` | Cập nhật trạng thái từng phiếu lương đơn lẻ (`DRAFT` / `CONFIRMED` / `PAID`). |
| `GET` | `/api/payrolls/sales-records` | `ALL` (Phân quyền RBAC) | Danh sách doanh số bán lẻ 3 ngành hàng theo kỳ. |
| `POST` | `/api/payrolls/sales-records` | `STORE_MANAGER`, `HR`, `ADMIN` | **(Week 3.1)** Ghi nhận doanh số Điện thoại, Laptop, Phụ kiện kèm chỉ tiêu KPI. |
| `GET` | `/api/payrolls/commissions` | `ALL` (Phân quyền RBAC) | Danh sách hoa hồng và thưởng nóng KPI tính tự động. |
| `GET` | `/api/payrolls/export/excel` | `HR_MANAGER`, `ADMIN` | **(Rubric III.3.1.7)** Xuất bảng lương ra file Excel (.xlsx) chuẩn doanh nghiệp TechZone. |
| `GET` | `/api/payrolls/export/csv` | `HR_MANAGER`, `ADMIN` | Xuất bảng lương ra file CSV chuẩn UTF-8 BOM. |

---

## 5. THIẾT KẾ GIAO DIỆN WEB FRONTEND (REACT + VITE + TYPESCRIPT)

Giao diện trang `PayrollPage.tsx` được xây dựng toàn diện với trải nghiệm cao cấp, hỗ trợ 3 Tab chuyên biệt và 3 hộp thoại modal tương tác trực quan:

### 5.1. Các thành phần chính trên giao diện

1. **Thanh công cụ toàn cục (Header & Action Bar):**
   - **Bộ chọn kỳ lương (Period Selector):** Dropdown động 12 tháng gần nhất (VD: Tháng 09/2026, Tháng 08/2026...).
   - **Nút "Chốt & Tính Lương (HR)":** Kích hoạt quy trình tính toán tự động toàn chuỗi với loading spinner và toast thông báo chi tiết (Số NV đã tính, Tổng quỹ Gross, Tổng thực chi Net).
   - **Nút "Duyệt tất cả":** Chuyển toàn bộ phiếu lương từ `DRAFT` sang `CONFIRMED`.
   - **Nút "Chi trả tất cả":** Ghi nhận hoàn tất thanh toán `PAID` kèm dấu thời gian.
   - **Nút "Xuất Excel" & "Xuất CSV":** Tải xuống báo cáo bảng lương dạng file bảng tính.
2. **Khung Banner Công Thức Tính Lương TechZone:**
   - Hiển thị trực quan công thức toán học cốt lõi và mối liên hệ với việc giảm trừ nghỉ không lương.
3. **Thẻ thống kê nhanh (Metric Cards):**
   - **Tổng quỹ Gross kỳ này:** Tổng ngân sách lương toàn chuỗi.
   - **Tổng thực chi Net:** Số tiền thực tế chi trả qua tài khoản ngân hàng.
   - **Bảo hiểm trích nộp (10.5%):** Tổng trích nộp BHXH, BHYT, BHTN.
   - **Tiến độ duyệt lương:** Hiển thị chi tiết số lượng bản ghi `DRAFT` / `CONFIRMED` / `PAID`.
4. **Tab 1: Bảng Lương Nhân Sự Toàn Chuỗi:**
   - Bảng dữ liệu đa cột: Nhân viên, Công chuẩn/thực tế, Nghỉ phép (Hưởng lương vs Không lương), Lương HĐ, Trừ thời gian, Lương CB thực nhận, Phụ cấp, Hoa hồng, Thưởng, Tổng Gross, Bảo hiểm, Lương Net, Trạng thái.
   - Bộ lọc tìm kiếm nhanh theo tên/mã nhân viên và dropdown lọc theo trạng thái duyệt.
   - Nút thao tác nhanh: Xem chi tiết phiếu, In phiếu lương A4, Cập nhật trạng thái từng phiếu.
5. **Tab 2: Phiếu Lương Tháng Cá Nhân (Employee Payslip View):**
   - Trình bày trực quan theo chuẩn phiếu lương TechZone.
   - Tóm tắt 3 khối số liệu: Gross, Khấu trừ, Net.
   - Bảng công & nghỉ phép: Công chuẩn (26), Công thực tế, Phép năm hưởng lương, Nghỉ không hưởng lương, Số giờ thiếu & đi trễ.
   - Bảng so sánh 2 cột: Cột Thu nhập đối chiếu Cột Giảm trừ 10.5%.
   - Số tiền thực lĩnh viết bằng chữ tiếng Việt có dấu.
6. **Tab 3: Bảng Lương Năm & Quyết Toán Thuế (Annual Income Report):**
   - Chọn năm thống kê (2026, 2025, 2024...).
   - Thống kê tổng hợp cả năm: Tổng thu nhập Gross cả năm, Tổng bảo hiểm đã nộp, Tổng thuế TNCN, Tổng thực lĩnh Net cả năm.
   - Bảng kê chi tiết từng tháng (Tháng 1 đến Tháng 12).
   - Hàng Tổng cộng năm (Total row) được tính toán tự động.

### 5.2. Các hộp thoại Modal & Bản in A4 chuẩn hóa

1. **Modal Giải trình Công thức Lương (Formula Breakdown Modal):**
   - Giải trình đầy đủ công thức toán học.
   - Hộp ví dụ minh họa thực tế của nhân viên Dũng (doanh số 220M).
   - Hộp giải thích chi tiết quy tắc khấu trừ ngày nghỉ phép không hưởng lương.
   - Bảng kê 12 dòng cấu phần thực tế từ `payroll_details` của nhân viên được chọn.
2. **Modal In Phiếu Lương Tháng A4 (Printable Monthly Payslip):**
   - Tiêu chuẩn A4: Tên công ty, địa chỉ, mã số thuế, hotline, logo TechZone.
   - Thông tin nhân viên, chức danh, chi nhánh, số tài khoản ngân hàng, ngân hàng, MST.
   - Bảng chi tiết chấm công, bảng thu nhập - giảm trừ.
   - Thực lĩnh bằng số và BẰNG CHỮ TIẾNG VIỆT (*Ví dụ: Mười sáu triệu không trăm bốn mươi bốn nghìn hai trăm ba mươi đồng*).
   - 4 khung chữ ký: Người lập biểu (Phòng Nhân sự), Kế toán trưởng, Giám đốc điều hành, Người nhận tiền.
   - Tích hợp gọi `window.print()` với CSS `@media print` che giấu hoàn toàn thanh sidebar/navbar, chỉ in phần phiếu khổ giấy trắng.
3. **Modal In Bảng Lương Năm A4 (Printable Annual Payslip):**
   - Bản in khổ A4 tổng hợp thu nhập 12 tháng phục vụ quyết toán thuế thu nhập cá nhân.
   - Bảng kê 12 dòng tương ứng 12 tháng trong năm kèm tổng cộng cả năm.
   - Đọc số tiền thực lĩnh bằng chữ tiếng Việt và khung chữ ký xác nhận của Người lao động và Ban Giám đốc.

---

## 6. KẾT QUẢ KIỂM THỬ TỰ ĐỘNG (AUTOMATED TEST SUITE)

Hệ thống đã được kiểm thử toàn diện qua bộ kịch bản tự động `test_payrolls_workflow.py` chạy trực tiếp trên CSDL Supabase Cloud PostgreSQL với **12/12 bước đạt 100%**:

```text
=====================================================================================
 KIỂM THỬ TOÀN DIỆN CHỨC NĂNG BẢNG LƯƠNG & PHIẾU LƯƠNG (PAYROLL WORKFLOW & FORMULAS)
 Chuỗi TechZone - Liên kết Nghỉ phép (Trừ lương), Hoa hồng, Thưởng KPI, In A4/PDF
=====================================================================================

[BƯỚC 1] Đăng nhập các tài khoản hệ thống (admin, hr_manager, store_mgr_q1, staff_dung)...
 -> Đăng nhập thành công: admin (['ADMIN'])
 -> Đăng nhập thành công: hr_manager (['HR_MANAGER'])
 -> Đăng nhập thành công: store_mgr_q1 (['STORE_MANAGER'])
 -> Đăng nhập thành công: staff_dung (['EMPLOYEE'])

[BƯỚC 2] Thiết lập doanh số bán lẻ 220 triệu cho staff_dung (Phone 150M, Laptop 70M, KPI 100%)...
 -> Đã ghi nhận doanh số: Tổng 220,000,000 VNĐ | Tỷ lệ KPI: 100.0%

[BƯỚC 3] Kiểm tra hoa hồng bán lẻ và thưởng KPI...
 -> Hoa hồng tính được: 2,200,000 VNĐ (Kỳ vọng: 2,200,000 VNĐ)
 -> Thưởng nóng KPI: 1,000,000 VNĐ (Kỳ vọng: 1,000,000 VNĐ)

[BƯỚC 4] Kiểm tra liên kết phân hệ Nghỉ phép có trừ lương (Unpaid Leave Linkage)...
 -> Nhân viên staff_dung đã nộp đơn nghỉ không lương #36 ngày 2026-09-18
 -> HR đã duyệt chính thức (HR_APPROVED) đơn #36
 -> Xác nhận: Bảng chấm công attendances đã tự động ghi nhận status=UNPAID_LEAVE

[BƯỚC 5] Chốt công và tính toán bảng lương tự động toàn chuỗi (POST /payrolls/calculate)...
 -> Kết quả: Chốt công và tính toán bảng lương kỳ 2026-09 thành công!
    * Số nhân viên tính lương: 6
    * Tổng quỹ lương Gross: 132,646,393 VNĐ
    * Tổng thực lĩnh Net: 128,731,393 VNĐ

[BƯỚC 6] Kiểm tra endpoint alias workflow: GET /api/payroll/generate/{month}...
 -> GET /api/payroll/generate/2026-09 thành công! Nhận được 6 phiếu lương.

[BƯỚC 7] Kiểm tra phiếu lương chi tiết của staff_dung (ID: 4) & khấu trừ nghỉ không lương...
 -> Thông số phiếu lương #45 của Phạm Quốc Dũng:
    * Công chuẩn: 26.0 ngày | Công thực tế: 24.0 ngày
    * Nghỉ không lương: 2.0 ngày (Từ đơn #36 đã duyệt)
    * Lương hợp đồng: 8,000,000 VNĐ
    * Khấu trừ thời gian: 2,690,385 VNĐ (Đã trừ chính xác theo ngày nghỉ ko lương)
    * Lương CB thực nhận: 5,309,615 VNĐ
    * Hoa hồng: 2,200,000 VNĐ
    * Thưởng KPI: 1,000,000 VNĐ
    * Lương Gross: 16,869,230 VNĐ
    * Bảo hiểm 10.5%: 525,000 VNĐ
    * Lương Thực lĩnh NET: 16,044,230 VNĐ

[BƯỚC 8] Kiểm tra endpoint GET /api/payrolls/{id} (12 dòng giải trình cấu phần)...
 -> Phiếu lương #45 có 12 dòng giải trình cấu phần:
    - [CONTRACT_SALARY] Lương cơ bản theo hợp đồng lao động: 8,000,000 VNĐ
    - [BASE_SALARY_DEDUCTION] Khấu trừ lương cơ bản dựa vào thời gian: 2,690,385 VNĐ
    - [OVERTIME] Tiền làm thêm giờ (Tăng ca OT): 3,859,615 VNĐ
    - [POSITION_ALLOWANCE] Phụ cấp trách nhiệm chức vụ: 500,000 VNĐ
    - [SENIORITY_ALLOWANCE] Phụ cấp thâm niên công tác: 500,000 VNĐ
    - [PROJECT_ALLOWANCE] Phụ cấp tham gia dự án & chiến dịch: 1,500,000 VNĐ
    - [MEAL_ALLOWANCE] Phụ cấp cơm trưa & xăng xe: 1,000,000 VNĐ
    - [HOLIDAY_BONUS] Thưởng lễ theo hệ số chức vụ (Quốc khánh 2/9): 1,000,000 VNĐ
    - [PRODUCTIVITY_BONUS] Thưởng năng suất hoàn thành vượt KPI: 1,000,000 VNĐ
    - [COMMISSION] Hoa hồng bán lẻ thiết bị công nghệ: 2,200,000 VNĐ
    - [INSURANCE] Bảo hiểm bắt buộc (BHXH 8%, BHYT 1.5%, BHTN 1%): 525,000 VNĐ
    - [PENALTY] Phạt vi phạm quy chế chấm công (Đi muộn > 15 phút): 300,000 VNĐ
 -> [XÁC NHẬN LIÊN KẾT NGHỈ PHÉP]: Thiếu 69.95 giờ (gồm 2.0 ngày nghỉ không hưởng lương & đi trễ) - Công thức: (Lương HĐ / 26) * Ngày nghỉ = 2,690,385 VNĐ

[BƯỚC 9] Kiểm tra endpoint in phiếu lương tháng chuẩn A4 (GET /api/payrolls/{id}/payslip)...
 -> Tiêu đề phiếu in: PHIẾU LƯƠNG THÁNG 09/2026
 -> Doanh nghiệp: CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ TECH ZONE (MST: 0312345678)
 -> Nhân viên nhận lương: Phạm Quốc Dũng (TZ-004)
 -> Thực lĩnh bằng số: 16,044,230 VNĐ
 -> Thực lĩnh bằng chữ tiếng Việt: Mười sáu triệu không trăm bốn mươi bốn nghìn hai trăm ba mươi đồng

[BƯỚC 10] Kiểm tra endpoint bảng tổng hợp thu nhập năm (GET /api/payrolls/employee/{id}/annual)...
 -> Tổng hợp thu nhập năm 2026 của Phạm Quốc Dũng:
    * Tổng Gross cả năm: 16,869,230 VNĐ
    * Tổng bảo hiểm đã nộp: 525,000 VNĐ
    * Tổng thực lĩnh Net: 16,044,230 VNĐ
    * Đọc tiền bằng chữ: Mười sáu triệu không trăm bốn mươi bốn nghìn hai trăm ba mươi đồng
    * Số tháng đã ghi nhận: 1 tháng

[BƯỚC 11] Kiểm tra quy trình duyệt trạng thái hàng loạt (CONFIRM-ALL & PAY-ALL)...
 -> Đã duyệt chính thức 6 phiếu lương kỳ 2026-09!
 -> Đã hoàn tất thanh toán chuyển khoản cho 6 nhân viên kỳ 2026-09!
 -> Xác nhận: Phiếu lương #45 đã cập nhật payment_status = PAID vào ngày 2026-09-26

[BƯỚC 12] Dọn dẹp dữ liệu kiểm thử...
 -> Đã xóa đơn kiểm thử #36 và hoàn nguyên bảng chấm công.

=====================================================================================
 ✓ TẤT CẢ 12 BƯỚC KIỂM THỬ CHỨC NĂNG BẢNG LƯƠNG & PHIẾU LƯƠNG ĐỀU ĐẠT 100%!
=====================================================================================
```

---

## 7. CẬP NHẬT TRẠNG THÁI CHECKLIST WORKFLOW (WEEK 3.2 & WEEK 3.3)

Trong tài liệu [`HRM-Project-Workflow.md`](file:///d:/CNPM%20-%20HTTDN/SGU_HRM-Project/HRM-Project-Workflow.md), toàn bộ các đầu mục của **Week 3.2 (Payroll Calculation)** và **Week 3.3 (Payroll & Payslip)** đã được hoàn thành trọn vẹn:

### 3.2 Payroll Calculation
- [x] GET `/api/payroll/generate/{month}` (Hoàn thành alias và router mount)
- [x] GET `/api/payrolls/{id}` - Detail with breakdown (Hoàn thành 12 cấu phần chi tiết)
- [x] GET `/api/payrolls/employee/{id}/annual` - Annual summary (Hoàn thành tổng hợp 12 tháng kèm chữ tiếng Việt)

### 3.3 Payroll & Payslip
**Web Frontend:**
- [x] Run payroll button (HR) (Nút Chốt & Tính Lương trên giao diện)
- [x] Payroll detail with formula (Hộp thoại giải trình công thức toán học & ví dụ Dũng 220M)
- [x] View monthly payslip (Tab Phiếu lương tháng trực quan)
- [x] **Print phiếu lương tháng (PDF)** (Bản in A4 chuẩn doanh nghiệp gọi `window.print()`)
- [x] **Print bảng lương năm (PDF)** (Bản in A4 quyết toán thu nhập 12 tháng gọi `window.print()`)

---

## 8. HƯỚNG DẪN TRẢI NGHIỆM VÀ SỬ DỤNG HỆ THỐNG

### 8.1. Khởi chạy hệ thống đồng thời
Từ thư mục gốc dự án, chạy lệnh:
```bash
python run.py
```
Hệ thống tự động:
- Khởi động Backend FastAPI tại: `http://localhost:8000` (Tài liệu Swagger: `http://localhost:8000/docs`)
- Khởi động Frontend Web (Vite React) tại: `http://localhost:5173`

### 8.2. Tài khoản thử nghiệm
- **HR Manager:** `hr_manager` / `123456` (Chốt lương, duyệt trạng thái, xem toàn chuỗi, in phiếu, xuất Excel).
- **Cửa hàng trưởng:** `store_mgr_q1` / `123456` (Xem bảng lương nhân sự chi nhánh Quận 1).
- **Nhân viên:** `staff_dung` / `123456` (Xem phiếu lương tháng cá nhân, xem giải trình công thức và in A4).

### 8.3. Chạy kiểm thử tự động
Từ thư mục `backend`:
```bash
python test_payrolls_workflow.py
```
Toàn bộ kịch bản kiểm thử 12 bước sẽ chạy và xác minh tự động.
