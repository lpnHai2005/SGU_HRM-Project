# TechZone HRM - Vero Design System (Linear / Attio / Vercel Minimalist)

<!-- impeccable:design-schema -->

Nguồn sự thật: `frontend-web/src/index.css` (tokens + component gốc) và `frontend-web/src/App.css` (layout shell, bảng, badge). Khi file này và code lệch nhau, code thắng — hãy cập nhật file này.

## Design Mode

**Operate** — High-density B2B HRM & retail operations platform. Scanability, sharp information hierarchy, hairline 1px borders, muted semantic pastels inspired by Linear, Attio, and Vercel.

---

## Visual Direction

- **Obsidian Charcoal & Paper Crisp** — neutral charcoal dark theme (`#0d0d0e`, `#151517`, `#222225`) and crisp paper light theme (`#f6f6f8`, `#ffffff`, `#e4e4e7`).
- **Typography** — `Be Vietnam Pro` (Google Fonts, 400–800) for UI text; `JetBrains Mono` with `font-feature-settings: 'tnum' 1` for metrics, currency, timestamps.
- **Hairline precision** — radii `4px–10px`, 1px borders, near-invisible shadows, no glow.
- **Stark primary + emerald AI accent** — black/white primary buttons; emerald-tinted `✦ Trợ lý AI` button.

---

## Theme Architecture

- Themes: `[data-theme="light"]` (also `:root` default) and `[data-theme="dark"]`, set on `<html>`.
- `App.tsx` stores the choice in `localStorage['techzone_theme']`, **default `light`**. A `prefers-color-scheme: dark` fallback exists in CSS but is overridden once `data-theme` is set.

### Surface, border, action tokens

| Token | Light (Paper Crisp) | Dark (Obsidian Charcoal) | Usage |
|-------|---------------------|--------------------------|-------|
| `--surface-ground` | `#f6f6f8` | `#0d0d0e` | Page canvas |
| `--surface-card` | `#ffffff` | `#151517` | Cards, tables |
| `--surface-subtle` | `#f0f0f3` | `#1a1a1d` | Table headers, subtle containers |
| `--surface-elevated` | `#ffffff` | `#1e1e22` | Popovers, modals |
| `--sidebar-bg` | `#fafafa` | `#09090b` | Sidebar |
| `--topbar-bg` | `#ffffff` | `#0d0d0e` | Topbar |
| `--border-default` | `#e4e4e7` | `#222225` | Card & input borders |
| `--border-subtle` | `#eeeeef` | `#1a1a1d` | Row dividers |
| `--border-strong` | `#d4d4d8` | `#2e2e33` | Emphasized borders |
| `--text-primary` / `-secondary` / `-muted` | `#09090b` / `#52525b` / `#a1a1aa` | `#f4f4f5` / `#a1a1aa` / `#71717a` | Text |
| `--action-primary` (+ `-text`) | `#09090b` (text `#fff`) | `#ffffff` (text `#09090b`) | Primary button |
| `--ai-btn-bg` / `--ai-btn-text` | `rgba(16,185,129,.09)` / `#059669` | `rgba(16,185,129,.12)` / `#34d399` | AI button |

### Semantic status tokens

`--status-{success|warning|error|info|neutral}` plus `-bg` and `-border` variants. Light text: `#059669 / #d97706 / #dc2626 / #0284c7 / #52525b`; dark text: `#34d399 / #fbbf24 / #f87171 / #38bdf8 / #a1a1aa`. Backgrounds are the same hue at 10–12% alpha. `--status-{success|warning|error}-solid` are theme-independent fills for use under white text.

### Role badge tokens

`--role-{admin|director|hr|manager|employee}-{bg|text|border}`: ADMIN = stark black/charcoal, DIRECTOR = violet, HR_MANAGER = sky, STORE_MANAGER = emerald, EMPLOYEE = neutral gray.

### Scales

| Group | Values |
|-------|--------|
| Font size | `--text-2xs` 11 · `xs` 12 · `sm` 13 · `base` 14 · `md` 15 · `lg` 17 · `xl` 20 · `2xl` 24 · `3xl` 28 (px) |
| Spacing | `--space-1..8`: 4 · 8 · 12 · 16 · 20 · 24 · 32 (px) |
| Radius | `--radius-xs` 4 · `sm` 6 · `md` 8 · `lg` 10 · `full` 9999 (px) |
| Motion | `--duration-fast` 120ms · `base` 180ms · `slow` 240ms · `--ease-out` `cubic-bezier(0.16,1,0.3,1)` |
| Layout | `--sidebar-width` 240px · `--sidebar-collapsed` 60px · `--topbar-height` 52px · `--content-max-width` 1440px |

---

## Component Specifications

### 1. Sidebar (`components/layout/Sidebar.tsx`)
- **Brand**: `techzone` + emerald dot; collapsed mode shows the TechZone icon only.
- **Workspace selector**: `[ T ] TechZone Retail ⌄` — links to `/`.
- **Nav sections**: generated from `constants/navigation.ts` by role. Section titles are 10px uppercase, `letter-spacing: 0.08em`. Sections include `Trang chủ`, `Quản trị hệ thống`, `Nhân sự`, `Vận hành`, `Kinh doanh & Tài chính`, `Báo cáo`, `Cá nhân` (managers) and `Công việc của tôi`, `Thu nhập` (employees).
- **Nav items**: rounded rect, active = `--sidebar-active-bg`. Expandable parent items with a rotating chevron and sub-items (e.g. `Quản lý đơn từ → Đơn nghỉ phép / Đơn OT`).
- **Footer**: user card (avatar or initials, full name, role label, `⋯`) linking to `/account`, plus collapse/expand toggle.
- **Mobile (≤768px)**: sidebar becomes an off-canvas drawer with backdrop.

### 2. Topbar (`components/layout/Topbar.tsx`)
- **Left**: mobile menu button + breadcrumb `TechZone > [Page title]`.
- **Right cluster**: search icon, theme toggle (sun/moon), `✦ Trợ lý AI` (opens `AiChatbotWidget`; shows `AI` on mobile), primary `+ Thêm mới` (→ `/employees`), divider, `NotificationBell`, user chip with role badge (→ `/account`), logout icon button.

### 3. Bottom Nav (`components/layout/BottomNav.tsx`, mobile only)
- 4 role-based shortcuts + `Thêm` (opens sidebar drawer). Managers: Trang chủ, Bảng công, Đơn từ, Nhân sự. Employees: Trang chủ, Bảng công, Đơn từ, Lương.

### 4. Stat Card (`components/common/StatCard.tsx`)
- Header: muted label (12px) + optional icon chip (`blue | green | amber | red`).
- Value: `1.75rem` (28px), JetBrains Mono, `tnum`, `letter-spacing: -0.03em`.
- Optional trend row: `↗` up / `↘` down / `⚠` warning.
- Optional footer note.
- Clickable variant with keyboard support and `.is-active` state (used as filter tiles). Grid: `.stat-grid-4`.

### 5. Data Tables & Status Badges
- Employee cell: initials avatar + bold name + muted subtitle.
- `badge-status` (App.css) — muted pastel pills. Domain statuses map to visual classes: `running` = active/approved (emerald), `paused` = draft/pending (amber), `scheduled` = cancelled/neutral (gray), `rejected` = rejected/terminated (red). See `types/contract.ts`, `types/resignation.ts`.
- `status-pill` (index.css) — `active|success`, `pending|warning`, `rejected|error`, `neutral`, plus attendance-specific `is-late-day`, `is-grace`, `is-excluded`, ...
- Footer: record count (`Hiển thị X / Y bản ghi`) + pagination.

### 6. Home page (`pages/OverviewPage.tsx`)
- Managers see tabs: `Quản lý báo cáo tổng hợp` with 4-up metrics, `Tỷ lệ hiện diện hôm nay`, `Cơ cấu xử lý đơn từ & nghỉ phép`, `Quỹ lương & Doanh số`. Employees see the attendance hero + personal attendance.

---

## Rules

- ❌ No generic blue corporate palette.
- ❌ No clichéd fonts (Inter, Roboto, Plus Jakarta Sans, Fraunces).
- ❌ No chunky neon pills or glow.
- ❌ No hardcoded colors in new code — use tokens above.
- ✅ Responsive: drawer sidebar + bottom nav on mobile; breakpoints 1024 / 768 / 640 / 480px; dedicated `@media print` styles for payslips, leave forms and reports.

## Known Debt (code chưa tuân thủ rule)

- Hardcoded hex colors remain outside `index.css` in print CSS/print modals (intentional: A4 paper stays white), solid fills paired with white text, and some `badge-*` dark-theme overrides.
- `--primary-color` is a legacy alias of `--action-primary`; prefer `--action-primary` in new code.
- `.nav-item-badge` CSS exists but the sidebar renders no count badges.
- `DashboardPage.tsx` only supplies `AttendanceHero` and its props type; its other dashboard sections (e.g. `Phân bổ chi phí & Quỹ lương`) are not rendered anywhere.
