# Product

<!-- impeccable:product-schema 1 -->

## Platform

web | mobile

## Stack

- Frontend Web: React + TypeScript + Vite
- Frontend Mobile: React Native (Expo)
- Backend: Python + FastAPI
- Database: Supabase PostgreSQL
- AI: LangGraph + LangChain + pgvector (deferred)

## Users

| Role | Vietnamese label | Primary job |
|------|-----------------|-------------|
| ADMIN | Quản trị viên hệ thống | System administration, audit logs |
| HR_MANAGER | Trưởng phòng Nhân sự | Personnel, payroll, leave Level 2 approval, reporting |
| STORE_MANAGER | Cửa hàng trưởng | Branch operations, attendance confirmation, leave Level 1 approval |
| EMPLOYEE | Nhân viên | Check-in/out, submit leave, view payslip |

Employees work in retail technology stores (TechZone). Web is used at branch PCs and HR offices; mobile is used on the shop floor and off-site.

## Product Purpose

TechZone HRM automates the full employee lifecycle for a technology retail chain: personnel records, shift scheduling, attendance, two-level leave approval, sales-linked commission, and monthly payroll with payslip printing. It replaces paper-and-spreadsheet management and gives each role a focused interface aligned to their daily work.

## Positioning

The HRM system built for retail tech chains — where attendance happens on the shop floor, commissions are product-linked, and payroll is auditable down to the individual sale. Web handles administrative depth; mobile handles real-time field operations (check-in, quick approvals).

## Operating Context

**Environments:** Branch POS PCs (web), HR office PCs (web), manager/employee smartphones (mobile). High-frequency mobile use is on the shop floor with variable connectivity.

**Rituals and documents:**
- Daily: Employees check in/out via mobile or web.
- Daily: Store Managers review and confirm branch attendance.
- Weekly/biweekly: HR runs payroll, reviews pending leaves.
- Monthly: Payslips are printed and distributed.

**Shift hours (Vietnamese):**
- Ca Sáng: 08:00–16:00
- Ca Chiều: 13:00–21:00
- Ca Full: 08:00–21:00

Late check-in threshold: 08:15.

**Commission categories (TechZone):**
- Phone & Laptop: 1%
- Accessories: 3%

**KPI Bonus thresholds:**
- ≥100% target → 1,000,000 VND
- ≥120% target → 2,000,000 VND

## Capabilities and Constraints

**Authentication:** Supabase Auth. Four roles: ADMIN, HR_MANAGER, STORE_MANAGER, EMPLOYEE. Role changes on promotion are automatic via API.

**Leave approval flow:** `PENDING → STORE_APPROVED → HR_APPROVED` or `REJECTED`. Two-level approval (Store Manager → HR Manager).

**Leave types:** ANNUAL (phép năm), SICK (ốm đau), MATERNITY (thai sản), RESIGNATION (nghỉ việc).

**Salary formula (contract-based, monthly):**
```
GROSS = Base Salary + OT Pay + Allowance + Commission + KPI Bonus
  Base = (Contract Salary / 26) × Actual Work Days
  OT = (Salary / 26 / 8) × OT Hours × 1.5

NET = GROSS − Insurance (10.5%)
  Insurance = BHXH 8% + BHYT 1.5% + BHTN 1%
```

**Attendance rules:** Check-in after 08:15 = Late; late arrivals count as OT. Commission tracked per sales category.

**Mobile scope:** Web and mobile share the same API. Mobile is not offline-first — check-in/check-out requires connectivity. No local caching or offline sync.

**AI features (deferred):** RAG for HR policy Q&A, employee retention prediction.

**Test accounts:** `admin`, `hr_manager`, `store_mgr_q1`, `staff_dung`, `tech_em` (password: `123456`).

**UI language:** Vietnamese throughout (labels, navigation, messages, errors).

## Brand Commitments

- Brand: **TechZone** (technology retail chain)
- Legal entity/name: not established in scope
- No existing design system, brand guide, or color palette confirmed

## Evidence on Hand

- `HRM-Project-Workflow.md` — full product specification including DB schema (23 tables), API routes, RBAC matrix, commission/salary formulas, task distribution, and 5-week plan
- `Nhóm HTTT.docx` — team document (not reviewed in detail)
- No committed visual assets, logo, or existing UI code

## Product Principles

1. **Role-precision:** Every interface element is scoped to what that role needs right now; no role sees admin-only functions.
2. **Field-ready mobile:** Mobile prioritises speed and scanability over feature depth — the shop floor has no keyboard.
3. **Auditability:** Every personnel action, approval, payroll run, and attendance record is traceable; payroll is breakable-down verifiable.
4. **Retail math, not HR software tropes:** Commission and KPI are core business facts, not afterthoughts — they appear where the employee sees their pay, not buried in reports.
5. **Bilingual data, Vietnamese interface:** Database columns may stay English; the user never sees raw column names.

## Accessibility & Inclusion

No product-specific accessibility requirement was established. Standard Vietnamese-language compliance is the baseline (WCAG 2.1 AA target for web; platform heuristics for mobile).
