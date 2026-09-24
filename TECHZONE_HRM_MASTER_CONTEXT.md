# TECHZONE HRM - HỒ SƠ NGỮ CẢNH MASTER TOÀN DỰ ÁN & TIẾN ĐỘ THỰC HIỆN
> **TÀI LIỆU DUY NHẤT DÙNG LÀM NGỮ CẢNH ĐẦY ĐỦ CHO AI ASSISTANT / CLAUDE / CHATGPT**  
> *(Khi bắt đầu phiên làm việc mới, bạn chỉ cần nạp tệp này - không cần đính kèm thêm các tệp Markdown khác)*  
> **Cập nhật gần nhất:** Tuần 4 - Đã hoàn thành 100% Core Backend, Auth/RBAC, Payroll API & Reports API.

---

## 1. THÔNG TIN DỰ ÁN & ĐỘI NGŨ THỰC HIỆN

* **Tên đề tài:** Hệ thống Thông tin Quản lý Nhân sự Đa nền tảng (HRM) cho Chuỗi Bán lẻ Thiết bị Công nghệ TechZone.
* **Đơn vị đào tạo:** Trường Đại học Sài Gòn (SGU) - Khoa Công nghệ Thông tin.
* **Học phần tích hợp:** 
  1. *Hệ thống thông tin doanh nghiệp (Mã HP: 841065)* - Trọng tâm: Quy trình chuỗi bán lẻ, CSDL chuẩn 3NF, Views, Stored Procedures, Quản trị phân quyền, Báo cáo thống kê.
  2. *Công nghệ phần mềm (Mã HP: 841403)* - Trọng tâm: Quy trình Agile Scrum, SRS, Thiết kế Kiến trúc REST API 3-Tier, UML Diagrams, Test Plan & Automation.
* **Đội ngũ phát triển (Nhóm 4 thành viên):**
  1. **Huỳnh Viễn Thông (Nhóm trưởng - Bạn đang tương tác với vai trò này):** MSSV `3123411287` - Phụ trách Kiến trúc Hệ thống, Backend FastAPI Core, CSDL Supabase, Auth JWT & RBAC, Động cơ Tính lương (`sp_generate_monthly_payroll`), API Tiền lương & Báo cáo thống kê, Lead Tích hợp & AI Copilot.
  2. **Lê Phan Nguyên Hải:** MSSV `3123411081` - Frontend Web Quản trị React Vite, Giao diện Nhân sự, Hợp đồng, Nhập doanh số 3 ngành hàng, Dashboard Recharts, Slide & Kịch bản Demo.
  3. **Võ Hoàng Bảo:** MSSV `3123411030` - Frontend Mobile Touch (Capacitor/Responsive), Luồng Đơn từ nghỉ phép 2 cấp, Giao diện Xem Phiếu lương & Tra cứu công thức, Tối ưu UX.
  4. **Đoàn Trung Kiên:** MSSV `3123411166` - DDL Migration 26 bảng Supabase, Phân ca & Chấm công 5 trạng thái, CSS In phiếu lương A4, Test Lead (Black-box Testing).

---

## 2. BÀI TOÁN KINH DOANH & ĐẶC THÙ CHUỖI TECHZONE

Doanh nghiệp **Công ty TNHH Bán Lẻ Công Nghệ TechZone** chuyên phân phối thiết bị số chính hãng:
* **Ngành hàng:** 
  1. *Điện thoại thông minh* (iPhone, Samsung Galaxy, Xiaomi...)
  2. *Laptop & Máy tính bảng* (MacBook, Dell XPS, Asus ROG...)
  3. *Linh phụ kiện biên lợi nhuận cao* (AirPods, Sạc dự phòng, Cáp sạc PD/GaN, Chuột, Bàn phím cơ...)
* **Cơ cấu tổ chức:**
  - **Trụ sở chính (HQ):** Ban Giám Đốc (BOD), Phòng Nhân sự (HR), Kế toán (ACC), Kinh doanh/Marketing.
  - **Khối Cửa hàng Chi nhánh (Stores):** Flagship Quận 1, Quận 3, Quận 6, Bình Thạnh, Tân Bình... Mỗi cửa hàng có 1 Cửa hàng trưởng (Store Manager) và đội ngũ nhân viên xoay ca (Sales, Tech, Cashier).
* **3 Đặc thù nhân sự cốt lõi bắt buộc hệ thống phải giải quyết:**
  1. **Làm việc xoay ca (Shifts):** Ca Sáng (08:00 - 16:00), Ca Chiều (13:00 - 21:00), Ca Full. Đi muộn > 15 phút bị phạt 50.000đ/lần và bị trừ lương cơ bản theo phút.
  2. **Đãi ngộ gắn liền Doanh số (Hoa hồng công nghệ):**
     - Hoa hồng Điện thoại & Laptop: **1.0%** doanh số.
     - Hoa hồng Phụ kiện: **3.0%** doanh số.
     - Thưởng vượt KPI tháng: $\ge 100\%$ thưởng nóng **1.000.000đ**; $\ge 120\%$ thưởng nóng **2.000.000đ**.
  3. **Quy trình phê duyệt trực tuyến 2 cấp:** Cửa hàng trưởng duyệt Cấp 1 sơ bộ $\rightarrow$ Trưởng phòng HR duyệt Cấp 2 chính thức (đơn nghỉ phép, thai sản, thôi việc).

---

## 3. CÔNG THỨC LƯƠNG & CHÍNH SÁCH ĐÃ CHỐT VỚI GIẢNG VIÊN (100% CHUẨN XÁC)

```
[THU NHẬP GROSS] = Lương cơ bản thực hưởng + Tăng ca OT + 3 Loại phụ cấp + 2 Loại thưởng + Hoa hồng bán lẻ
[THỰC LĨNH NET]  = GROSS - Bảo hiểm bắt buộc 10.5% - Phạt đi muộn - Thuế TNCN
```

1. **Lương cơ bản bị trừ theo thời gian (Unworked Hours Deduction):**
   - Đơn giá ngày công chuẩn (26 ngày) = `contract_salary / 26`.
   - Đơn giá giờ = `contract_salary / (26 * 8)`.
   - Tiền bị trừ: `time_deduction_amount = (ngày_nghỉ_ko_lương * lương_ngày) + (phút_trễ / 60 * lương_giờ)`.
   - Lương CB thực nhận: `actual_base_salary = GREATEST(0, contract_salary - time_deduction_amount)`.
2. **Tiền làm thêm giờ (Overtime):** `overtime_salary = overtime_hours * (basic_salary / 26 / 8) * 1.5`.
3. **3 Loại Phụ cấp quy định:**
   - *Phụ cấp chức vụ:* `position_allowance` theo bảng `positions` (Giám đốc: 5tr, CHT: 3tr, NV: 0đ).
   - *Phụ cấp thâm niên (`join_date`):* <1 năm: 0đ; 1-3 năm: 500.000đ; 3-5 năm: 1.000.000đ; $\ge$5 năm: 1.500.000đ.
   - *Phụ cấp dự án:* `project_allowance` tổng từ bảng `project_members` (các dự án mở điểm bán đang chạy).
   - *Phụ cấp cơm xe cố định:* 1.000.000đ/tháng.
4. **2 Loại Tiền thưởng:**
   - *Thưởng lễ theo hệ số chức vụ:* `holiday_bonus = 1.000.000đ × position_coefficient` (Hệ số chức vụ cấu hình trong bảng `positions`, ví dụ: Giám đốc 2.50, CHT 1.50, Nhân viên 1.00).
   - *Thưởng năng suất theo KPI:* `productivity_bonus` (1.000.000đ hoặc 2.000.000đ từ doanh số).
5. **Trích trừ Bảo hiểm bắt buộc (10.5%):**
   - Lương đóng bảo hiểm: `insurance_salary` (quy định trong hợp đồng).
   - BHXH (8%) + BHYT (1.5%) + BHTN (1%) = **10.5%**.
6. **Minh bạch 12 cấu phần:** Tự động lưu 12 dòng giải trình chi tiết vào bảng `payroll_details` để nhân viên tự tra cứu minh bạch.

---

## 4. TECH STACK & CẤU TRÚC KỸ THUẬT

```
SGU_HRM-Project/
├── backend/                              # FastAPI (Python 3.11+)
│   ├── app/
│   │   ├── api/
│   │   │   ├── deps.py                  # get_current_user, require_roles (RBAC)
│   │   │   └── v1/
│   │   │       ├── router.py             # Main API Router
│   │   │       └── endpoints/
│   │   │           ├── auth.py          # /auth (login/me)
│   │   │           ├── users.py         # /users (CRUD + gán quyền)
│   │   │           ├── roles.py         # /roles (ma trận RBAC)
│   │   │           ├── employees.py     # /employees (hồ sơ, hợp đồng, thăng chức)
│   │   │           ├── attendances.py   # /attendances (check-in/out, phân ca)
│   │   │           ├── leaves.py        # /leaves (duyệt đơn 2 cấp)
│   │   │           ├── payrolls.py      # /payrolls (Lương, hoa hồng, dự án, xuất Excel/A4) [THÔNG]
│   │   │           ├── reports.py       # /reports (Dashboard, 4 View CSDL, xuất Excel/CSV) [THÔNG]
│   │   │           └── audit_logs.py    # /audit-logs (nhật ký hành vi)
│   │   ├── core/
│   │   │   ├── config.py                # Biến môi trường .env
│   │   │   ├── database.py              # AsyncSessionLocal kết nối Supabase
│   │   │   ├── security.py              # JWT Bearer, băm mật khẩu Bcrypt
│   │   │   ├── vietnamese_number.py     # [MỚI] Đọc số tiền ra chữ tiếng Việt chuẩn kế toán
│   │   │   └── excel_exporter.py        # [MỚI] Xuất file Excel .xlsx chuyên nghiệp TechZone
│   │   ├── models/entities.py           # SQLAlchemy ORM Models
│   │   └── schemas/schemas.py           # Pydantic v2 Schemas
│   ├── requirements.txt
│   └── run.py                           # Chạy Uvicorn port 8000
├── frontend-web/                         # React 18 + TypeScript + Vite + TailwindCSS
│   ├── src/
│   │   ├── pages/                       # Dashboard, EmployeeList, Attendance, Leave, Payroll, Reports
│   │   ├── services/api.ts              # Axios/Fetch API Client kết nối Backend
│   │   └── types/                       # Interfaces TypeScript
│   └── package.json
└── supabase_techzone_hrm.sql             # Script SQL 26 bảng 3NF, 4 Views, 2 Stored Procedures
```

* **Cơ sở dữ liệu Supabase Cloud (PostgreSQL 15+):** 
  - Connection Pooler: `aws-0-ap-southeast-1.pooler.supabase.com:5432`
  - 26 bảng quan hệ chuẩn hóa 3NF.
  - 4 Views: `v_monthly_hr_status_report`, `v_hr_demographics_report`, `v_annual_salary_summary`, `v_user_active_permissions`.
  - 2 Stored Procedures: `sp_calculate_monthly_commission(period)`, `sp_generate_monthly_payroll(period, hr_id)`.

---

## 5. TỔNG KẾT CHI TIẾT CÁC CÔNG VIỆC THÔNG ĐÃ HOÀN THÀNH (100%)

### 5.1. TUẦN 1: Setup Hệ thống & CSDL Supabase
* Khởi tạo cấu trúc Backend FastAPI (Asyncio, Pydantic v2, SQLAlchemy 2.0).
* Cấu hình biến môi trường `.env`, kết nối thành công Supabase PostgreSQL Pooler.
* Thiết kế và chạy hoàn tất script CSDL 26 bảng chuẩn 3NF, thiết lập đầy đủ khóa ngoại, chỉ mục (Index) và quan hệ Cascade.

### 5.2. TUẦN 1 & 2: Phân hệ Xác thực & Phân quyền Bảo mật (Auth & RBAC)
* Xây dựng `/api/v1/auth/login` cấp phát JWT Token (HS256, thời hạn 480 phút).
* Mã hóa mật khẩu an toàn chuẩn doanh nghiệp bằng Bcrypt.
* Viết Middleware kiểm tra quyền hạn `require_roles(["ADMIN", "HR_MANAGER", "STORE_MANAGER", "EMPLOYEE"])`.
* Xây dựng cơ chế ghi nhật ký thanh tra tự động `audit_logs` (lưu `old_values` và `new_values` dưới dạng JSONB).
* Viết API quản lý Người dùng (`/users`), gán vai trò (`/users/{id}/roles`), xem ma trận phân quyền (`/roles/matrix`).

### 5.3. TUẦN 2: Hồ sơ Nhân sự, Hợp đồng & Thăng chức Bổ nhiệm
* Viết API Quản lý Nhân sự (`/employees`): Tự động sinh mã nhân viên chuẩn `TZ-xxx`.
* Viết API Quản lý Hợp đồng lao động (`/employees/contracts`): Tự động sinh mã `HDLD-TZ-xxx-yyyy`.
* Viết API Thăng chức & Bổ nhiệm (`/employees/promotions`): Tự động ghi lịch sử `position_histories` và **tự động cập nhật vai trò RBAC** của User (ví dụ: Nhân viên thăng lên Cửa hàng trưởng $\rightarrow$ tự động gán role `STORE_MANAGER`).

### 5.4. TUẦN 3: Phân hệ Payroll API (Tiền lương, Hoa hồng & Dự án)
* **Động cơ Chốt lương tự động (`/payrolls/calculate` & `/payrolls/generate/{month}`):**
  - Tự động gọi `sp_calculate_monthly_commission` để tính hoa hồng bán lẻ 3 nhóm ngành hàng (ĐT 1%, Laptop 1%, Phụ kiện 3%) và thưởng nóng KPI.
  - Tự động gọi `sp_generate_monthly_payroll` tính toán số giờ làm việc thiếu, giảm trừ thời gian, tính 3 phụ cấp (Chức vụ, Thâm niên, Dự án), 2 khoản thưởng (Lễ theo hệ số, KPI), trích nộp bảo hiểm 10.5%.
  - Tự động bẻ nhỏ 12 dòng giải trình cấu phần chi tiết vào bảng `payroll_details`.
* **API Quản lý Bảng lương (`/payrolls`):**
  - Hỗ trợ lọc theo `period`, `store_id`, `employee_id`, `payment_status`.
  - Phân quyền RBAC chặt chẽ: Admin/HR xem toàn chuỗi; Cửa hàng trưởng chỉ thấy nhân viên cửa hàng mình; Nhân viên chỉ thấy phiếu lương của mình (Rubric III.3.2.3).
* **API In Phiếu lương A4 (`/payrolls/{id}/payslip` - Rubric III.3.2.4):**
  - Xuất dữ liệu bản in phiếu lương tháng chuẩn doanh nghiệp.
  - Tích hợp hàm `currency_to_vietnamese_words`: **Tự động đọc số tiền thực nhận (Net) bằng chữ tiếng Việt** (VD: *"Mười triệu ba trăm sáu mươi nghìn đồng"*).
* **Quy trình Phê duyệt Lương:**
  - `PUT /payrolls/{id}/status`: Cập nhật trạng thái phiếu (`DRAFT` $\rightarrow$ `CONFIRMED` $\rightarrow$ `PAID`).
  - `POST /payrolls/confirm-all`: Duyệt chốt hàng loạt toàn bộ bảng lương trong tháng.
  - `POST /payrolls/pay-all`: Xác nhận chuyển khoản thanh toán lương toàn chuỗi.
* **Bảng lương Năm (`/payrolls/annual-summary/{emp_id}` - Rubric III.3.2.5):**
  - Truy vấn View `v_annual_salary_summary` tổng hợp thu nhập 12 tháng phục vụ quyết toán thuế và in phiếu năm A4.
* **Quản lý Doanh số Bán lẻ & Hoa hồng (Week 3.1):**
  - `POST /payrolls/sales-records`: Nhập doanh số 3 ngành hàng (ĐT, Laptop, Phụ kiện), tự động tính hoa hồng.
  - `GET /payrolls/sales-records`: Danh sách doanh số theo kỳ/cửa hàng.
  - `GET /payrolls/sales-records/me`: Nhân viên tự theo dõi doanh thu và tiến độ đạt KPI trên Mobile App (ESS).
  - `GET /payrolls/commissions`: Bảng tổng hợp hoa hồng bán lẻ toàn chuỗi.
  - `GET /payrolls/commissions/me`: Nhân viên tra cứu hoa hồng cá nhân.
* **Quản lý Dự án & Phụ cấp Dự án (`MOD-07`):**
  - CRUD Danh mục dự án mở rộng điểm bán (`/payrolls/projects`).
  - Gán nhân viên vào dự án kèm định mức phụ cấp `project_allowance` hàng tháng (`/payrolls/projects/{id}/members`).
* **Xuất Dữ liệu Bảng lương:**
  - `GET /payrolls/export/excel`: Xuất file Excel (`.xlsx`) định dạng chuyên nghiệp TechZone Blue, đầy đủ cột thu nhập - giảm trừ và dòng Tổng cộng.
  - `GET /payrolls/export/csv`: Xuất file CSV (UTF-8 BOM hiển thị tiếng Việt chuẩn).

### 5.5. TUẦN 4: Phân hệ Reports API (Báo cáo Thống kê & Dashboard)
* **Thẻ KPI Dashboard Quản trị (`/reports/dashboard-stats`):**
  - Thống kê thời gian thực: Số nhân sự đang làm, số cửa hàng hoạt động, số đơn nghỉ phép chờ duyệt, quỹ lương Net tháng này, tổng doanh thu chuỗi và tỷ lệ chấm công trong ngày.
* **Báo cáo Biến động Nhân sự theo Tháng (`/reports/monthly-status` - Rubric III.3.1.4):**
  - Truy vấn View `v_monthly_hr_status_report`: Số nhân viên đang làm (`ACTIVE`, `PROBATION`), nghỉ phép dài ngày/thai sản (`ON_LEAVE`), đã thôi việc (`RESIGNED`), tổng biên chế toàn chuỗi kèm biểu đồ xu hướng tuyển dụng 6 tháng.
* **Báo cáo Cơ cấu Nhân sự Đa chiều (`/reports/demographics` - Rubric III.3.1.5):**
  - Truy vấn View `v_hr_demographics_report` phân nhóm dữ liệu phục vụ vẽ biểu đồ Recharts:
    1. *Cơ cấu trình độ học vấn:* Đại học, Cao đẳng, Trung cấp, THPT.
    2. *Phân bổ khung bậc mức lương:* Dưới 7 triệu, Từ 7 - 12 triệu, Từ 12 - 20 triệu, Trên 20 triệu.
    3. *Phân bổ thâm niên công tác:* Dưới 1 năm, Từ 1 - 3 năm, Từ 3 - 5 năm, Trên 5 năm.
    4. Hỗ trợ lọc riêng theo từng chi nhánh cửa hàng.
* **Báo cáo Chi phí & Quỹ lương theo Chi nhánh (`/reports/payroll-fund`):**
  - Thống kê chi tiết quỹ lương của từng cửa hàng: Tổng lương CB, OT, phụ cấp, hoa hồng, bảo hiểm và lương thực chi.
* **Báo cáo Hiệu suất Bán lẻ & Tỷ lệ đạt KPI (`/reports/sales-performance`):**
  - Phân tích cơ cấu doanh thu 3 nhóm ngành hàng và xếp hạng nhân viên bán hàng xuất sắc nhất.
* **Xuất Báo cáo Quản trị ra Excel & CSV (Đặc tả 9.5):**
  - `GET /reports/export/demographics/excel`: Xuất báo cáo nhân sự, học vấn, thâm niên ra file `.xlsx`.
  - `GET /reports/export/demographics/csv`: Xuất file CSV.
  - `GET /reports/export/payroll-summary/excel`: Xuất báo cáo tổng hợp chi phí quỹ lương chi nhánh ra file `.xlsx`.

---

## 6. KẾT QUẢ KIỂM THỬ THỰC TẾ (AUTOMATED TEST SUITE)

Bộ kiểm thử tự động toàn diện gồm **27/27 Test Cases** đã chạy trực tiếp trên CSDL Supabase và đạt kết quả **PASS 100%**:

```
=== 1. AUTHENTICATING TEST ACCOUNTS ===
Admin login: OK
Employee (staff_dung) login: OK
Store Manager (store_mgr_q1) login: OK

=== 2. TESTING PAYROLL CALCULATION & SALES ===
Record sales (240M, 120% KPI): OK
Sales records listed: 3 records
Employee self sales view: OK
Commissions calculated: 3 records
Payroll calculated successfully: 6 employees

=== 3. TESTING PAYROLL QUERIES & RBAC ===
Admin sees all: 6 payrolls
Employee sees only self: 1 payroll (employee_id=4)
Store Manager sees store employees: 3 payrolls
Payroll #32 details line items: 9 items
Payslip generated: Net=27,722,500.0 VND
In words: Hai mươi bảy triệu bảy trăm hai mươi hai nghìn năm trăm đồng
Payroll #32 updated to CONFIRMED: OK
Confirm all payrolls: OK
Annual salary summary: OK

=== 4. TESTING PROJECTS & ALLOWANCES (MOD-07) ===
Projects list: 3 projects
Payroll Excel export: OK (6989 bytes)
Payroll CSV export: OK (1796 bytes)

=== 5. TESTING REPORTS API (MOD-09) ===
Dashboard Stats: Active Emps=6, Stores=5, Fund=129,043,975.0 VND
Monthly Status (Rubric III.3.1.4): Active=6 (75.0%), On-leave=1, Resigned=1
Demographics (Rubric III.3.1.5): Edu groups=5, Salary brackets=3, Seniority groups=1
Payroll Fund Summary: Units=4, Total Headcount=6
Sales Performance: Staff=3, Grand Total=515,000,000.0 VND
Audit Logs (Rubric II.2): 10 logs retrieved
Demographics Excel export: OK (6594 bytes)
Demographics CSV export: OK (1792 bytes)
Payroll Fund Excel export: OK (6146 bytes)

>>> ALL 27 TESTS IN THE TEST SUITE PASSED SUCCESSFULLY! <<<
```

Mã nguồn Frontend Web (`tsc -b && vite build`) cũng đã được build thử nghiệm và vượt qua 100% trong 654ms không một lỗi cú pháp.

---

## 7. DANH SÁCH TÀI KHOẢN TEST SẴN CÓ ĐỂ DEMO HỘI ĐỒNG (MẬT KHẨU: 123456)

| Tài khoản (Username) | Mật khẩu | Vai trò (Role) | Nhân sự đại diện | Kịch bản Demo thực chiến |
| :--- | :---: | :---: | :--- | :--- |
| `admin` | `123456` | `ADMIN` | Quản trị viên hệ thống | Cấu hình hệ thống, quản lý tài khoản, xem ma trận RBAC, xem nhật ký `audit_logs`. |
| `hr_manager` | `123456` | `HR_MANAGER` | Huỳnh Thị Kim Yến (Trưởng phòng HR) | Duyệt đơn nghỉ phép Cấp 2, Thăng chức nhân viên $\rightarrow$ tự đổi quyền, Bấm nút chốt lương toàn chuỗi, Xem Dashboard phân tích nhân sự, Xuất Excel báo cáo. |
| `store_mgr_q1` | `123456` | `STORE_MANAGER` | Lê Hoàng Nam (CHT Quận 1) | Quản lý nhân viên chi nhánh Q1, Duyệt đơn nghỉ phép Cấp 1, Phân ca làm việc, Nhập doanh số bán lẻ chi nhánh. |
| `staff_dung` | `123456` | `EMPLOYEE` | Trần Quốc Dũng (NV Bán hàng Q1) | Check-in/out ca làm việc trên Mobile, Nộp đơn nghỉ phép, Xem thành tích bán 220tr, Xem phiếu lương tháng và in phiếu lương PDF chuẩn A4. |
| `tech_em` | `123456` | `EMPLOYEE` | Phan Thị Én (Kỹ thuật viên Q3) | Chấm công, xem lịch làm việc, xem lương cá nhân. |

---

## 8. CÁC BƯỚC TIẾP THEO CỦA DỰ ÁN (ROADMAP CHO CÁC THÀNH VIÊN)

1. **Hải & Bảo (Frontend Web & Mobile):**
   - Ráp nối giao diện Bảng lương và In phiếu lương tháng vào các nút bấm gọi `payrollApi.getPayslip()` và `payrollApi.confirmAll()`.
   - Gắn biểu đồ Recharts trên trang `ReportsPage` gọi dữ liệu từ `reportApi.getDemographics()` và `reportApi.getMonthlyStatus()`.
   - Gắn các nút "Xuất Excel" gọi trực tiếp link tải file từ Backend.
2. **Kiên (DB & Testing):**
   - Viết tài liệu Test Execution Report từ 27 test cases đã được Thông tự động hóa thành công.
3. **Thông (Lead Integration):**
   - Sẵn sàng kích hoạt extension `pgvector` và module **AI HR Copilot (LangGraph + RAG)** để tạo điểm nhấn bứt phá điểm 10 trước hội đồng chấm thi.
