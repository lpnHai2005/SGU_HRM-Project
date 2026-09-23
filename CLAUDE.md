# SGU HRM - TechZone HRM System

## Tổng quan dự án
Hệ thống Quản lý Nhân sự cho chuỗi cửa hàng TechZone (bán lẻ thiết bị công nghệ).
- **Backend**: FastAPI + Supabase PostgreSQL
- **Frontend**: React (Vite)
- **Database**: Supabase (PostgreSQL)
- **Auth**: JWT Bearer Token + RBAC

## Cấu trúc thư mục

```
SGU-HRM-Project/
├── backend/                    # FastAPI Backend
│   ├── app/
│   │   ├── api/
│   │   │   ├── deps.py        # Dependencies: get_current_user, require_roles, RBAC
│   │   │   └── v1/
│   │   │       ├── router.py   # Main API router
│   │   │       └── endpoints/  # API endpoints
│   │   │           ├── auth.py       # Authentication (login/logout)
│   │   │           ├── users.py      # User management
│   │   │           ├── employees.py  # Employee CRUD + contracts + promotions
│   │   │           ├── attendances.py # Check-in/out + shift schedules
│   │   │           ├── leaves.py     # Leave requests + approval workflow
│   │   │           ├── payrolls.py   # Payroll + commissions + projects
│   │   │           ├── roles.py       # RBAC roles & permissions
│   │   │           ├── reports.py     # Reports
│   │   │           └── ai_copilot.py # AI Copilot
│   │   ├── core/
│   │   │   ├── config.py      # Settings từ .env
│   │   │   ├── database.py    # SQLAlchemy async session
│   │   │   └── security.py    # JWT encode/decode
│   │   ├── models/
│   │   │   └── entities.py    # SQLAlchemy ORM models
│   │   └── schemas/
│   │       └── schemas.py     # Pydantic schemas
│   ├── .env                   # Config (không commit)
│   ├── requirements.txt
│   └── run.py
├── frontend-web/              # React Frontend (Vite)
│   ├── src/
│   ├── .env                   # VITE_API_URL=http://localhost:8000/api/v1
│   └── package.json
└── CLAUDE.md                 # File này - context cho Claude Code
```

## Database Schema (Supabase PostgreSQL)

### 1. RBAC - Phân quyền
| Table | Columns | Mô tả |
|-------|---------|--------|
| `roles` | role_id, role_code, role_name, description | Các vai trò: ADMIN, HR_MANAGER, STORE_MANAGER, EMPLOYEE |
| `permissions` | permission_id, permission_code, permission_name, module | Quyền chi tiết theo module |
| `role_permissions` | role_id, permission_id | Map vai trò ↔ quyền |
| `user_roles` | user_id, role_id, assigned_at | Map user ↔ vai trò |

### 2. Người dùng & Nhật ký
| Table | Columns | Mô tả |
|-------|---------|--------|
| `users` | user_id, employee_id, username, password_hash, email, phone, avatar_url, is_active, last_login | Tài khoản đăng nhập |
| `audit_logs` | log_id, user_id, action, entity_name, entity_id, old_values (JSONB), new_values (JSONB), ip_address, created_at | Nhật ký hành động |

### 3. Tổ chức
| Table | Columns | Mô tả |
|-------|---------|--------|
| `departments` | department_id, department_code, department_name, parent_id, is_active | Phòng ban |
| `stores` | store_id, store_code, store_name, address, district, city, phone, email, manager_employee_id, open_date, is_active | Cửa hàng |
| `education_levels` | education_level_id, level_code, level_name, description | Bằng cấp |
| `positions` | position_id, position_code, position_name, base_salary_min, base_salary_max, position_allowance, position_coefficient, is_store_role | Chức vụ |

### 4. Nhân sự
| Table | Columns | Mô tả |
|-------|---------|--------|
| `employees` | employee_id, employee_code, first_name, last_name, full_name (generated), gender, dob, identity_card, identity_issued_date, identity_issued_place, phone, personal_email, company_email, permanent_address, current_address, avatar, store_id, department_id, position_id, education_level_id, join_date, resignation_date, employment_status, bank_account_number, bank_name, tax_code, insurance_code | Hồ sơ nhân viên |
| `contracts` | contract_id, contract_number, employee_id, contract_type, start_date, end_date, basic_salary, insurance_salary, signed_date, status | Hợp đồng lao động |
| `position_histories` | history_id, employee_id, old_position_id, new_position_id, old_store_id, new_store_id, decision_number, effective_date, reason | Lịch sử thăng chức/điều chuyển |

### 5. Chấm công & Ca làm
| Table | Columns | Mô tả |
|-------|---------|--------|
| `work_shifts` | shift_id, shift_code, shift_name, start_time, end_time, work_hours, is_active | Ca làm việc |
| `work_schedules` | schedule_id, employee_id, store_id, shift_id, work_date, notes | Phân ca (unique: employee_id + work_date) |
| `attendances` | attendance_id, employee_id, store_id, shift_id, work_date, check_in_time, check_out_time, late_minutes, early_minutes, overtime_hours, actual_work_hours, status, notes | Bảng chấm công |

### 6. Nghỉ phép
| Table | Columns | Mô tả |
|-------|---------|--------|
| `leave_types` | leave_type_id, type_code, type_name, is_paid, max_days_allowed | Loại đơn nghỉ |
| `leave_requests` | request_id, employee_id, leave_type_id, start_date, end_date, total_days, reason, status, attachment_url, store_manager_id, store_approved_at, store_manager_note, hr_approver_id, hr_approved_at, rejection_reason, created_at | Đơn xin nghỉ |

### 7. Lương & Thưởng
| Table | Columns | Mô tả |
|-------|---------|--------|
| `employee_sales` | sale_record_id, employee_id, store_id, salary_period, phone_revenue, laptop_revenue, accessory_revenue, total_revenue, target_kpi, kpi_achievement_rate | Doanh số bán lẻ |
| `commissions` | commission_id, sale_record_id, employee_id, salary_period, commission_rate, commission_amount | Hoa hồng |
| `payrolls` | payroll_id, employee_id, salary_period, standard_working_days, actual_working_days, paid_leave_days, unpaid_leave_days, unworked_hours, time_deduction_amount, contract_salary, actual_base_salary, overtime_salary, position_allowance, seniority_allowance, project_allowance, meal_transport_allowance, commission_amount, bonus_amount, holiday_bonus, productivity_bonus, gross_income, bhxh_amount, bhyt_amount, bhtn_amount, total_insurance, personal_income_tax, penalty_deduction, total_deduction, net_salary, payment_status, payment_date | Bảng lương |
| `payroll_details` | detail_id, payroll_id, item_code, item_name, item_type, calculation_formula, amount, notes | Chi tiết lương |

### 8. Dự án
| Table | Columns | Mô tả |
|-------|---------|--------|
| `projects` | project_id, project_code, project_name, description, start_date, end_date, status, budget | Dự án |
| `project_members` | project_member_id, project_id, employee_id, role_in_project, project_allowance, joined_date, left_date, is_active | Thành viên dự án |

## API Endpoints

### Base URL: `/api/v1`

| Endpoint | Method | Auth | Role | Mô tả |
|----------|--------|------|------|-------|
| **Auth** ||||
| `/auth/login` | POST | ❌ | - | Đăng nhập, trả JWT token |
| `/auth/me` | GET | ✅ | - | Lấy thông tin user hiện tại |
| **Users** ||||
| `/users` | GET | ✅ | ADMIN | Danh sách users |
| `/users` | POST | ✅ | ADMIN | Tạo user mới |
| `/users/{id}` | PUT | ✅ | ADMIN | Cập nhật user |
| `/users/{id}/roles` | PUT | ✅ | ADMIN | Gán role cho user |
| **Employees** ||||
| `/employees` | GET | ✅ | - | Danh sách nhân viên |
| `/employees/metadata/lookups` | GET | ❌ | - | Danh mục (dept, store, position, edu) |
| `/employees/{id}` | GET | ✅ | - | Chi tiết nhân viên |
| `/employees` | POST | ✅ | ADMIN, HR_MANAGER | Tạo nhân viên mới |
| `/employees/{id}` | PUT | ✅ | ADMIN, HR_MANAGER | Cập nhật nhân viên |
| `/employees/{id}` | DELETE | ✅ | ADMIN, HR_MANAGER | Thôi việc (RESIGNED) |
| `/employees/{id}/promote` | POST | ✅ | ADMIN, HR_MANAGER | Thăng chức/điều chuyển |
| `/employees/contracts` | GET | ✅ | - | Danh sách hợp đồng |
| `/employees/contracts` | POST | ✅ | ADMIN, HR_MANAGER | Tạo hợp đồng |
| **Attendances** ||||
| `/attendances` | GET | ✅ | - | Danh sách chấm công |
| `/attendances/my-history` | GET | ✅ | - | Lịch sử chấm công của tôi |
| `/attendances/check-in` | POST | ✅ | - | Check-in vào ca |
| `/attendances/check-out` | POST | ✅ | - | Check-out khỏi ca |
| `/attendances/shift-schedules` | GET | ✅ | - | Danh sách phân ca |
| `/attendances/shift-schedules` | POST | ✅ | STORE_MANAGER, HR, ADMIN | Phân ca |
| **Leaves** ||||
| `/leaves/types` | GET | ❌ | - | Danh mục loại nghỉ phép |
| `/leaves` | GET | ✅ | - | Danh sách đơn nghỉ |
| `/leaves` | POST | ✅ | - | Nộp đơn nghỉ |
| `/leaves/{id}/approve-store` | POST | ✅ | STORE_MANAGER, ADMIN | Duyệt cấp 1 |
| `/leaves/{id}/approve-hr` | POST | ✅ | HR_MANAGER, ADMIN | Duyệt cấp 2 |
| `/leaves/{id}/reject` | POST | ✅ | STORE_MANAGER, HR, ADMIN | Từ chối |
| `/leaves/balances/me` | GET | ✅ | - | Số dư phép của tôi |
| `/leaves/balances/{emp_id}` | GET | ✅ | - | Số dư phép nhân viên |
| **Payrolls** ||||
| `/payrolls` | GET | ✅ | - | Danh sách bảng lương |
| `/payrolls/{id}` | GET | ✅ | - | Chi tiết phiếu lương |
| `/payrolls/calculate` | POST | ✅ | HR_MANAGER, ADMIN | Chạy tính lương |
| `/payrolls/sales-records` | POST | ✅ | STORE_MANAGER, HR, ADMIN | Ghi nhận doanh số |
| `/payrolls/generate/{month}` | POST | ✅ | HR_MANAGER, ADMIN | Chốt lương tháng |
| `/payrolls/annual-summary/{emp_id}` | GET | ✅ | - | Tổng hợp thu nhập năm |
| **Roles & Permissions** ||||
| `/roles` | GET | ✅ | - | Danh sách roles |
| `/roles/rbac-matrix` | GET | ✅ | ADMIN | Ma trận RBAC |

## Quy ước Code

### Đặt tên
- **Database**: snake_case (employees, employee_id, full_name)
- **Python**: snake_case (employee_id, first_name)
- **API JSON**: camelCase (employeeId, firstName, fullName)
- **Tables**: plural (employees, not employee)
- **Foreign Keys**: `{table}_id` (employee_id, store_id)

### Mã nhân viên
- Format: `TZ-XXX` (VD: TZ-001, TZ-002)

### Mã hợp đồng
- Format: `HDLD-TZ-XXX-YYYY` (VD: HDLD-TZ-001-2026)

### Trạng thái nhân viên
- `PROBATION` - Thử việc
- `ACTIVE` - Đang làm việc
- `RESIGNED` - Đã thôi việc

### Trạng thái đơn nghỉ
- `PENDING` - Chờ duyệt
- `STORE_APPROVED` - Đã duyệt cấp 1 (Cửa hàng trưởng)
- `HR_APPROVED` - Đã duyệt cấp 2 (HR)
- `REJECTED` - Từ chối

### RBAC Roles
| Role | Mô tả | Quyền |
|------|-------|-------|
| ADMIN | Quản trị hệ thống | Toàn quyền |
| HR_MANAGER | Quản lý nhân sự | Quản lý nhân sự, duyệt nghỉ cấp 2, tính lương |
| STORE_MANAGER | Cửa hàng trưởng | Quản lý cửa hàng, duyệt nghỉ cấp 1 |
| EMPLOYEE | Nhân viên | Xem thông tin cá nhân, nộp đơn nghỉ, check-in/out |

### JWT Token
- Algorithm: HS256
- Expire: 480 phút (8 giờ)
- Payload chứa: sub (username), exp, roles, permissions

### Stored Procedures
- `sp_calculate_monthly_commission(period)` - Tính hoa hồng
- `sp_generate_monthly_payroll(period, hr_id)` - Tạo bảng lương

### Views
- `v_annual_salary_summary` - View tổng hợp thu nhập năm

## Environment Variables

### Backend (.env)
```env
PROJECT_NAME="TechZone HRM API"
API_V1_STR="/api/v1"
DATABASE_URL="postgresql+asyncpg://..."
SYNC_DATABASE_URL="postgresql://..."
JWT_SECRET_KEY="..."
ALGORITHM="HS256"
ACCESS_TOKEN_EXPIRE_MINUTES=480
CORS_ORIGINS=[...]
```

### Frontend (.env)
```env
VITE_API_URL=http://localhost:8000/api/v1
VITE_APP_NAME=TechZone HRM
```

## Chạy ứng dụng

```bash
# Backend
cd backend
pip install -r requirements.txt
python run.py
# Server: http://localhost:8000
# Docs: http://localhost:8000/docs

# Frontend
cd frontend-web
npm install
npm run dev
# App: http://localhost:5173
```

## Ghi chú quan trọng

1. **Full name generation**: PostgreSQL generated column: `(last_name || ' ' || first_name)`
2. **Promotion workflow**: Tự động update User role nếu thăng lên STORE_MANAGER
3. **Leave type ID = 6**: Loại nghỉ việc - tự động set employee status = RESIGNED
4. **Leave workflow**: PENDING → STORE_APPROVED → HR_APPROVED (2 cấp duyệt)
5. **Payroll calculation**: Chạy stored procedures, không insert trực tiếp
6. **Audit logging**: Tất cả thay đổi được ghi vào audit_logs với old_values/new_values JSONB
