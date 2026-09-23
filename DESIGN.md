# TechZone HRM - Vero Design System (Linear / Attio / Vercel Minimalist)

<!-- impeccable:design-schema -->

## Design Mode

**Operate** — High-density, precision-engineered B2B HRM & retail operations platform. Scanability, razor-sharp information hierarchy, hairline 1px borders, and muted semantic status pastels inspired by Linear, Attio, and Vercel.

---

## Visual Direction

### Voice & Tone

- **Obsidian Charcoal & Paper Crisp Minimalist** — Curated neutral obsidian charcoal dark theme (`#0d0d0e`, `#151517`, `#222225`) and crisp paper light theme (`#f6f6f8`, `#ffffff`, `#e4e4e7`).
- **Precision Typography** — `Be Vietnam Pro` (with custom Vietnamese diacritics) for human readability + `JetBrains Mono` for tabular figures (`tnum`, zero-slashed currency and timestamps).
- **Hairline Precision** — Restrained radii (`4px - 8px`), crisp 1px borders, zero fuzzy neon glow, soft muted pastel badges.
- **Stark Primary Buttons & Emerald AI Accent** — Stark black/white primary action buttons paired with emerald-tinted AI Assistant triggers (`✦ Trợ lý AI`).

---

## Dual-Theme Architecture

The system provides instantaneous toggle between **Dark (Obsidian Charcoal)** and **Light (Paper Crisp)** themes via `[data-theme="dark"]` and `[data-theme="light"]`.

| Token | Dark (Obsidian Charcoal) | Light (Paper Crisp) | Usage |
|-------|--------------------------|---------------------|-------|
| `--surface-ground` | `#0d0d0e` | `#f6f6f8` | Page ground canvas |
| `--surface-card` | `#151517` | `#ffffff` | Primary cards & tables |
| `--surface-subtle` | `#1a1a1d` | `#f0f0f3` | Subtle containers & table headers |
| `--border-default` | `#222225` | `#e4e4e7` | Hairline card & input borders |
| `--border-subtle` | `#1a1a1d` | `#eeeeef` | Row dividers & subtle borders |
| `--action-primary` | `#ffffff` (text `#09090b`) | `#09090b` (text `#ffffff`) | Stark contrast primary button |
| `--ai-btn-bg` | `rgba(16, 185, 129, 0.12)` | `rgba(16, 185, 129, 0.09)` | Emerald AI Assistant button |
| `--ai-btn-text` | `#34d399` | `#059669` | AI Assistant text & icon |

---

## Component Specifications

### 1. Vero Sidebar Shell
- **Brand**: `techzone •` with glowing emerald micro-dot.
- **Workspace Selector Card**: `[ T ] TechZone Retail / Hệ thống · 18 nhân sự ⌄`.
- **Nav Groups**: Uppercase 10px tracking (`VẬN HÀNH`, `QUẢN TRỊ`, `HỆ THỐNG`).
- **Nav Items**: Sleek rounded rect `rgba(255,255,255,0.08)` active state without chunky pills. Right-aligned numerical badges (`18`, `2`, `18`).
- **Sidebar Footer**: User profile card `[ NV ] Nguyễn Văn An / Quản trị viên ⋯`.

### 2. Vero Topbar
- **Breadcrumb**: `TechZone > [Page Title]` with clean `>` separator.
- **Action Cluster**: Search icon, Theme toggle (Sun/Moon), `✦ Trợ lý AI` button, Stark primary action button (`+ Thêm mới`), and Logout.

### 3. Vero Stat Cards
- 4-part layout:
  1. Small muted label (`12px`)
  2. Bold tabular metric (`26px`, font-feature-settings: 'tnum' 1)
  3. Trend indicator (`↗ +14.2%` green or `⚠ 2 vắng` amber)
  4. Subtle sync note (`Đồng bộ phòng nhân sự · 08:30`)

### 4. Notice Callout Banner
- Emerald tinted callout (`rgba(16, 185, 129, 0.08)`) with action link `Chi tiết quy định →`.

### 5. Vero Data Tables
- Lead / Employee Cell: Avatar circle with initials + bold employee name + subtitle.
- Status Pills: Soft muted pastels (`Running`, `Working`, `Paused`, `Late`, `Nurture`, `Rejected`).
- Score Line: Progress indicator bar with monospace score value (`80` - `98`).
- Table Pagination: `Hiển thị X trên Y nhân sự` + `Trước` / `Tiếp`.

### 6. Bottom Breakdown Cards
- Card 1: `Phân bổ chi phí & Quỹ lương` (`Where the funds & hours went`).
- Card 2: `Hiệu suất phòng ban & Ca làm việc` (`Department efficiency progress bars`).

---

## Anti-Patterns Enforced
- ❌ No generic blue corporate palettes.
- ❌ No clichéd fonts (Inter, Roboto, Plus Jakarta Sans, Fraunces).
- ❌ No chunky neon pills.
- ❌ No hardcoded colors bypassing CSS variables.
- ❌ Full responsive support with mobile drawer and bottom navigation.
