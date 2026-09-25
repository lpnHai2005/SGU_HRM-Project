# HRM System Implementation Workflow - 5 WEEKS

## Project Overview

**Project:** HRM System for Technology Retail Business (TechZone)  
**Team:**
- Huỳnh Viễn Thông (3123411287)
- Lê Phan Nguyên Hải (3123411081)
- Võ Hoàng Bảo (3123411030)
- Đoàn Trung Kiên (3123411166)

**Tech Stack:**
- Frontend Web: React + TypeScript + Vite
- Frontend Mobile: React Native (Expo)
- Backend: Python + FastAPI
- Database: Supabase PostgreSQL
- AI: LangGraph + LangChain + pgvector (DO LAST)

---

## 5-WEEK PROJECT TIMELINE

```
WEEK 1: Foundation        → Setup + DB + Auth
WEEK 2: Core Modules      → Personnel + Leave + Attendance  
WEEK 3: Business Modules → Sales + Payroll + Payslip
WEEK 4: Reports & Polish → Dashboard + UI + Export
WEEK 5: Integration      → Testing + Demo
```

---

## WEEK 1: Foundation

### 1.1 Project Structure

```
SGU_HRM-Project/
├── backend/              # FastAPI
│   ├── app/api/         # /auth, /employees, /leave, /attendance, /payroll, /reports
│   ├── app/core/        # config, security
│   ├── app/db/          # supabase connection
│   ├── requirements.txt
│   └── main.py
├── frontend-web/        # React Web (Vite)
│   └── src/
├── frontend-mobile/     # React Native (Expo)
│   └── App.tsx
└── supabase/migrations/ # SQL scripts
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

### 1.4 Frontend Web Setup
- [ ] Vite + React + TypeScript project
- [ ] Install: React Router, TailwindCSS, Recharts, TanStack Query
- [ ] Setup project structure
- [ ] Create base layout components

### 1.5 Frontend Mobile Setup (React Native / Expo)
- [ ] Expo project setup
- [ ] Install: React Navigation, NativeWind/Tailwind, Axios
- [ ] Setup project structure (shared API service layer)
- [ ] Create base navigation structure

---

## WEEK 2: Core Modules

### 2.1 Personnel Management

**API:**
- [ ] GET/POST/PUT/DELETE `/api/employees`
- [ ] Auto-generate code (TZ-xxx)
- [ ] Contract CRUD
- [ ] POST `/api/promotions` - Thăng cấp + auto role change

**Web Frontend:**
- [ ] Employee list (filter by store/department/status)
- [ ] Add/Edit/Delete employee
- [ ] Promotion form

**Mobile Frontend:**
- [ ] Employee list (basic view)
- [ ] Add employee form
- [ ] Employee detail view
- [ ] Manager: View branch employees

### 2.2 Leave Requests (2-Level Approval & Direct HR Approval)

**Status Flow:** `PENDING → STORE_APPROVED → HR_APPROVED` (hoặc HR duyệt thẳng `PENDING → HR_APPROVED`), `REJECTED` hoặc `CANCELLED`.
*Lưu ý:* HR có thể duyệt thẳng Cấp 2 kể cả trước khi Cửa hàng trưởng duyệt Cấp 1; các công đoạn không áp dụng trong chi tiết đơn hiển thị nhãn "Không áp dụng" thay vì "Chưa xử lý".

**Leave Types:** ANNUAL (phép năm), SICK (ốm đau), MATERNITY (thai sản), RESIGNATION (nghỉ việc), VIEC_RIENG, KHONG_LUONG

**API:**
- [x] POST `/api/leave-requests` - Submit
- [x] POST `/api/leave-requests/{id}/approve-level1` - Store Manager (Cấp 1)
- [x] POST `/api/leave-requests/{id}/approve-level2` - HR Manager (Cấp 2 / Duyệt thẳng)
- [x] POST `/api/leave-requests/{id}/reject`

**Web Frontend:**
- [x] Submit leave request form
- [x] Leave balance display
- [x] Pending requests list (Manager)
- [x] Approve/Reject buttons
- [x] Calendar view of leaves

**Mobile Frontend:**
- [ ] Submit leave request form
- [ ] Leave balance display
- [ ] My leave requests list
- [ ] Manager: Pending requests list + Approve/Reject
- [ ] Push notifications for status updates

### 2.3 Attendance

**Shifts:** Ca Sáng (08h-16h), Ca Chiều (13h-21h), Ca Full (08h-21h)

**Rules:** Check-in sau 08:15 = Late, sau giờ = OT

**API:**
- [ ] POST `/api/attendances/check-in`
- [ ] POST `/api/attendances/check-out`
- [ ] POST `/api/shift-schedules` - Assign shift

**Web Frontend:**
- [ ] Check-in/Check-out button
- [ ] My attendance calendar
- [ ] My payroll & payslip
- [ ] My leave requests
- [ ] My profile
- [ ] Manager: Daily attendance + Shift roster + Approvals

**Mobile Frontend:**
- [ ] **Check-in/Check-out (PRIMARY)**
- [ ] My attendance history
- [ ] My shift schedule
- [ ] Manager: View branch attendance
- [ ] Manager: Approve pending attendance edits

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
- [ ] GET `/api/payrolls/employee/{id}/annual` - Annual summary

### 3.3 Payroll & Payslip

**Web Frontend:**
- [ ] Run payroll button (HR)
- [ ] Payroll detail with formula
- [ ] View monthly payslip
- [ ] **Print phiếu lương tháng (PDF)**
- [ ] **Print bảng lương năm (PDF)**

**Mobile Frontend:**
- [ ] View my payslip (monthly)
- [ ] View salary breakdown
- [ ] Annual income summary
- [ ] **Print/In phiếu lương tháng**
- [ ] **Print/In bảng lương năm**

---

## WEEK 4: Reports & Polish

### 4.1 Statistics & Dashboard

**Reports:**
- [ ] Monthly status (Active/On-leave/Resigned)
- [ ] By education level
- [ ] By salary range (<7M, 7-12M, 12-20M, >20M)
- [ ] By seniority (<1yr, 1-3yr, >3yr)

**Web Frontend:**
- [ ] Dashboard with charts (Recharts)
- [ ] Export PDF/Excel

**Mobile Frontend:**
- [ ] Basic dashboard view
- [ ] Charts (simplified)

### 4.2 UI/UX Polish

**Web Frontend:**
- [ ] Responsive design
- [ ] Role-based navigation
- [ ] Print-optimized CSS

**Mobile Frontend:**
- [ ] Touch-friendly UI components
- [ ] Offline support (cache attendance)
- [ ] Push notifications setup

### 4.3 Shared API Service
- [ ] Create shared API service layer (TypeScript)
- [ ] Use same endpoints for Web & Mobile
- [ ] Handle token refresh (Supabase Auth)
- [ ] Error handling utilities

---

## WEEK 5: Integration & Demo

### 5.1 Integration Testing

- [ ] Test all API endpoints
- [ ] Test role-based access
- [ ] Test print functionality
- [ ] Fix bugs

**Mobile Testing:**
- [ ] Test check-in/out on iOS/Android
- [ ] Test offline mode
- [ ] Test push notifications

### 5.2 Demo Scenarios

**Step 1: Admin (`admin`)** - Web only
- Show RBAC permissions
- Show Audit Log

**Step 2: Employee (`staff_dung`)** - Web + Mobile
- **Web:** View profile, attendance history, payroll
- **Mobile:** Check-in/out, Submit leave, View salary
- **Demo print:** Phiếu lương tháng (Mobile)

**Step 3: Store Manager (`store_mgr_q1`)** - Web + Mobile
- **Web:** Full branch management, view employees
- **Mobile:** Quick approve leave (Level 1), View branch attendance

**Step 4: HR Manager (`hr_manager`)** - Web + Mobile
- **Web:** Run payroll, Dashboard charts, Promote employee
- **Mobile:** Quick approve leave (Level 2), Push notifications

---

## Task Distribution

| Week | Thông | Hải | Bảo | Kiên |
|------|-------|-----|-----|------|
| 1 | Setup + DB  | Setup + Auth    | Web scaffold       | Mobile scaffold |
| 2 | Auth + RBAC | Personnel       | Leave (Web)        | Leave (Mobile - All roles) |
| 3 | Payroll API | Sales/Commission| Payroll (Web)      | Attendance (Mobile) |
| 4 | Reports API | Dashboard (Web) | UI Polish          | Dashboard (Mobile - All roles) |
| 5 | Integration | Demo prep (Web) | Demo prep (Mobile) | Testing |

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

---

## Mobile App Notes (React Native / Expo)

### Why Expo?
- Faster setup, easier deployment
- Can generate iOS/Android APK without Mac
- Push notifications support
- Can share via QR code for testing

### Key Mobile Features (Priority)

**Employee Features:**
1. **Check-in/Check-out** - Main mobile feature
2. **View salary/payslip** - Employee self-service
3. **Submit leave request** - On-the-go submission
4. **View attendance history** - Personal records

**Manager Features (Mobile):**
1. **Approve leave requests (Level 1/2)** - Quick approval on the go
2. **View branch attendance** - Daily overview
3. **View branch reports** - Basic stats
4. **Push notifications** - Alerts for pending approvals

### Web vs Mobile Focus

| Feature | Web (All Roles) | Mobile (All Roles) |
|---------|-----------------|-------------------|
| Personnel CRUD | ✓ Full | ✓ Full |
| Leave approval | ✓ Full | ✓ Quick approve |
| Attendance | ✓ Manage + Check-in | ✓ Check-in/out + View |
| Payroll | ✓ Full | ✓ View/Print |
| Reports | ✓ Full | ✓ View |
| Notifications | ✗ | ✓ Push alerts |

> **Note:** Cả Web và Mobile đều có đầy đủ chức năng cho tất cả roles. Mobile tập trung vào tính năng nhanh (check-in, quick approve).
