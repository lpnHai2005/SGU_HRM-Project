# HRM System Implementation Workflow - 5 WEEKS

## Project Overview

**Project:** HRM System for Technology Retail Business (TechZone)  
**Team:**
- Huỳnh Viễn Thông (3123411287) 
- Lê Phan Nguyên Hải (3123411081)
- Võ Hoàng Bảo (3123411030)
- Đoàn Trung Kiên (3123411166)

**Tech Stack:**
- Frontend: React + TypeScript + Vite
- Backend: Python + FastAPI
- Database: Supabase PostgreSQL
- AI: LangGraph + LangChain + pgvector (DO LAST)

---

## 5-WEEK PROJECT TIMELINE

```
WEEK 1: Foundation        → Setup + DB + Auth
WEEK 2: Core Modules      → Personnel + Leave + Attendance  
WEEK 3: Business Modules  → Sales + Payroll + Payslip
WEEK 4: Reports & Polish  → Dashboard + UI + Export
WEEK 5: Integration       → Testing + Demo
```

---

## WEEK 1: Foundation

### 1.1 Project Structure

```
SGU_HRM-Project/
├── backend/              # FastAPI
│   ├── app/api/          # /auth, /employees, /leave, /attendance, /payroll, /reports
│   ├── app/core/         # config, security
│   ├── app/db/           # supabase connection
│   ├── requirements.txt
│   └── main.py
├── frontend/             # React + Vite
│   └── src/
└── supabase/migrations/  # SQL scripts
```

### 1.2 Database Schema (23 Tables)

**Reference Tables:** `stores`, `departments`, `positions`, `education_levels`, `work_shifts`, `leave_types`, `salary_components`

**Core Tables:** `employees`, `employee_contracts`, `employee_history`, `users`, `roles`, `role_permissions`, `audit_logs`

**Business Tables:** `shift_schedules`, `attendances`, `leave_requests`, `leave_balances`, `sales_records`, `commissions`, `kpi_targets`, `payrolls`, `payroll_details`

### 1.3 Authentication & RBAC

| Role | Description |
|------|-------------|
| ADMIN | Quản trị viên hệ thống |
| HR_MANAGER | Trưởng phòng Nhân sự |
| STORE_MANAGER | Cửa hàng trưởng |
| EMPLOYEE | Nhân viên |

**Test Accounts:** `admin`, `hr_manager`, `store_mgr_q1`, `staff_dung`, `tech_em` (password: `123456`)

---

## WEEK 2: Core Modules

### 2.1 Personnel Management

**API:**
- [ ] GET/POST/PUT/DELETE `/api/employees`
- [ ] Auto-generate code (TZ-xxx)
- [ ] Contract CRUD
- [ ] POST `/api/promotions` - Thăng cấp + auto role change

**Frontend:**
- [ ] Employee list (filter by store/department/status)
- [ ] Add/Edit/Delete employee
- [ ] Promotion form

### 2.2 Leave Requests (2-Level Approval)

**Status Flow:** `PENDING → STORE_APPROVED → HR_APPROVED` hoặc `REJECTED`

**Leave Types:** ANNUAL (phép năm), SICK (ốm đau), MATERNITY (thai sản), RESIGNATION (nghỉ việc)

**API:**
- [ ] POST `/api/leave-requests` - Submit
- [ ] POST `/api/leave-requests/{id}/approve-level1` - Store Manager
- [ ] POST `/api/leave-requests/{id}/approve-level2` - HR Manager
- [ ] POST `/api/leave-requests/{id}/reject`

**Frontend:**
- [ ] Submit leave request form
- [ ] Leave balance display
- [ ] Pending requests list (Manager)
- [ ] Approve/Reject buttons

### 2.3 Attendance

**Shifts:** Ca Sáng (08h-16h), Ca Chiều (13h-21h), Ca Full (08h-21h)

**Rules:** Check-in sau 08:15 = Late, sau giờ = OT

**API:**
- [ ] POST `/api/attendances/check-in`
- [ ] POST `/api/attendances/check-out`
- [ ] POST `/api/shift-schedules` - Assign shift

**Frontend:**
- [ ] Check-in/Check-out button
- [ ] My attendance calendar
- [ ] Manager: Daily attendance + Shift roster

---

## WEEK 3: Business Modules

### 3.1 Sales & Commission (TechZone)

**Commission Rates:**
| Category | Rate |
|----------|------|
| Phone & Laptop | 1% |
| Accessories | 3% |

**KPI Bonus:** >=100% → 1,000,000 VND | >=120% → 2,000,000 VND

**API:**
- [ ] POST `/api/sales-records`
- [ ] GET `/api/commissions/calculate/{month}`

### 3.2 Payroll Calculation

**Salary Formula:**
```
GROSS = Base Salary + OT Pay + Allowance + Commission + KPI Bonus
  Base = (Contract Salary / 26) × Actual Days
  OT = (Salary / 26 / 8) × OT Hours × 1.5

NET = GROSS - Insurance (10.5%) - Penalty
  Insurance = BHXH 8% + BHYT 1.5% + BHTN 1%
```

**Example (staff_dung - 220 triệu):**
```
- Base: 8,000,000
- Phone 150M × 1% = 1,500,000
- Laptop 70M × 1% = 700,000
- KPI 100% = 1,000,000
- GROSS: ~11,200,000
- Insurance 10.5%: ~840,000
- NET: ~10,360,000
```

**API:**
- [ ] GET `/api/payroll/generate/{month}`
- [ ] GET `/api/payrolls/{id}` - Detail with breakdown

**Frontend:**
- [ ] Run payroll button (HR)
- [ ] Payroll detail with formula
- [ ] View monthly payslip
- [ ] **Print phiếu lương tháng (PDF)**
- [ ] **Print bảng lương năm (PDF)**

---

## WEEK 4: Reports & Polish

### 4.1 Statistics & Dashboard

**Reports:**
- [ ] Monthly status (Active/On-leave/Resigned)
- [ ] By education level
- [ ] By salary range (<7M, 7-12M, 12-20M, >20M)
- [ ] By seniority (<1yr, 1-3yr, >3yr)

**Frontend:**
- [ ] Dashboard with charts (Recharts)
- [ ] Export PDF/Excel

### 4.2 UI/UX Polish

- [ ] Responsive design
- [ ] Role-based navigation
- [ ] Print-optimized CSS

---

## WEEK 5: Integration & Demo

### 5.1 Integration Testing

- [ ] Test all API endpoints
- [ ] Test role-based access
- [ ] Test print functionality
- [ ] Fix bugs

### 5.2 Demo Scenarios

**Step 1: Admin (`admin`)**
- Show RBAC permissions
- Show Audit Log

**Step 2: Employee (`staff_dung`)**
- Check-in attendance
- Submit leave request
- View salary (220M sales)
- **Print phiếu lương tháng**

**Step 3: Store Manager (`store_mgr_q1`)**
- View only Q1 employees
- Approve leave (Level 1)

**Step 4: HR Manager (`hr_manager`)**
- Approve leave (Level 2)
- **Promote employee** → show permission change
- Run payroll
- Show Dashboard charts

---

## Task Distribution

| Week | Thông | Hải | Bảo | Kiên |
|------|-------|-----|-----|------|
| 1 | Setup + DB | Setup + Auth | Frontend scaffold | DB migration |
| 2 | Auth + RBAC | Personnel | Leave | Attendance |
| 3 | Payroll API | Sales/Commission | Payroll FE | Payslip/Print |
| 4 | Reports API | Dashboard | UI Polish | Export |
| 5 | Integration | Demo prep | Demo prep | Testing |

---

## Milestones

| Week | Deliverables |
|------|--------------|
| Week 1 | Setup + DB + Auth working |
| Week 2 | Personnel + Leave + Attendance |
| Week 3 | Sales + Payroll + Payslip |
| Week 4 | Dashboard + Polish |
| Week 5 | Demo ready |

---

## RBAC Matrix

| Function | Admin | HR Manager | Store Manager | Employee |
|----------|:-----:|:----------:|:-------------:|:--------:|
| Quản trị tài khoản, Audit Log | ✓ | View | ✗ | ✗ |
| Thêm/Sửa/Xóa nhân sự | View | ✓ | ✗ | ✗ |
| Hợp đồng, Lương CB | View | ✓ | ✗ | ✗ |
| Xem NV chi nhánh | ✓ | ✓ | ✓ | ✗ |
| Phân ca làm việc | ✗ | Monitor | ✓ | View |
| Chấm công | ✗ | ✗ | Confirm | ✓ |
| Gửi đơn nghỉ | ✗ | ✗ | ✓ | ✓ |
| Duyệt cấp 1 (Cửa hàng) | ✗ | ✗ | ✓ | ✗ |
| Duyệt cấp 2 (HR) | ✗ | ✓ | ✗ | ✗ |
| Chốt công, tính lương | ✗ | ✓ | ✗ | ✗ |
| Xem & In lương | ✗ | ✓ | Own | **Own** |
| Báo cáo thống kê | ✗ | ✓ | Branch | ✗ |

---

## Key Business Rules

1. **Work Shifts:** Sáng (08h-16h), Chiều (13h-21h), Full (08h-21h)
2. **Late Detection:** Check-in after 08:15
3. **OT Rate:** 1.5x hourly rate
4. **Commission:** Phone/Laptop 1%, Accessories 3%
5. **KPI Bonus:** >=100% → 1M, >=120% → 2M
6. **Insurance:** 10.5% (BHXH 8%, BHYT 1.5%, BHTN 1%)
7. **Approval:** Store Manager → HR Manager

---

## AI Features (SKIP - Do Last)

- [ ] RAG for HR Policy Q&A
- [ ] Employee retention prediction
