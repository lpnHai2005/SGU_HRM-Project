---
name: Retail HRM Modernist
colors:
  surface: '#f9f9fb'
  surface-dim: '#d9dadc'
  surface-bright: '#f9f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3f5'
  surface-container: '#edeef0'
  surface-container-high: '#e8e8ea'
  surface-container-highest: '#e2e2e4'
  on-surface: '#1a1c1d'
  on-surface-variant: '#47464a'
  inverse-surface: '#2f3132'
  inverse-on-surface: '#f0f0f2'
  outline: '#78767b'
  outline-variant: '#c8c5ca'
  surface-tint: '#5f5e60'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#1c1b1d'
  on-primary-container: '#858386'
  inverse-primary: '#c8c6c8'
  secondary: '#5e5e67'
  on-secondary: '#ffffff'
  secondary-container: '#e0dee9'
  on-secondary-container: '#62626b'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#00174b'
  on-tertiary-container: '#497cff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e5e1e4'
  primary-fixed-dim: '#c8c6c8'
  on-primary-fixed: '#1c1b1d'
  on-primary-fixed-variant: '#474649'
  secondary-fixed: '#e3e1ec'
  secondary-fixed-dim: '#c7c5d0'
  on-secondary-fixed: '#1a1b23'
  on-secondary-fixed-variant: '#46464f'
  tertiary-fixed: '#dbe1ff'
  tertiary-fixed-dim: '#b4c5ff'
  on-tertiary-fixed: '#00174b'
  on-tertiary-fixed-variant: '#003ea8'
  background: '#f9f9fb'
  on-background: '#1a1c1d'
  surface-variant: '#e2e2e4'
typography:
  headline-xl:
    fontFamily: Be Vietnam Pro
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
  headline-lg:
    fontFamily: Be Vietnam Pro
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-md:
    fontFamily: Be Vietnam Pro
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  headline-sm:
    fontFamily: Be Vietnam Pro
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Be Vietnam Pro
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-lg-medium:
    fontFamily: Be Vietnam Pro
    fontSize: 16px
    fontWeight: '500'
    lineHeight: 24px
  body-md:
    fontFamily: Be Vietnam Pro
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-md-medium:
    fontFamily: Be Vietnam Pro
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  label-md:
    fontFamily: Be Vietnam Pro
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
  label-sm:
    fontFamily: Be Vietnam Pro
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
  label-xs:
    fontFamily: Be Vietnam Pro
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  margin: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
---

## Brand & Style

This design system is tailored for operational precision, frontline employee clarity, and executive oversight in retail store environments. It combines high-end enterprise SaaS restraint with mobile-first tactical ergonomics.

### Personality & Tone
- **Authoritative & Discreet:** Avoids loud novelty hues; communicates stability, precision, and compliance.
- **Pragmatic & Focused:** Streamlines high-frequency daily routines—such as shift check-ins, biometric time-tracking, schedule adjustments, and leave requests—into low-friction touch flows.
- **Sophisticated Craft:** Leverages neutral zinc balances, razor-thin borders, and crisp Vietnamese-optimized typography to maintain a premium feel.

### Design Style
The system employs an **Editorial Minimalist Enterprise** aesthetic. Depth is established through subtle 1px surface delineation and soft surface elevation rather than heavy dropshadows or loud gradients. Information hierarchy relies on strict font weights and status indicators rather than decorative chrome.

## Colors

The palette is engineered around high-contrast monochrome foundations supplemented by semantic operational tokens.

### Foundations & Surfaces
- **Canvas / App Background:** `#F6F6F8` (Soft neutral wash preventing eye fatigue under store lighting)
- **Surface / Card Background:** `#FFFFFF` (Crisp separation from canvas)
- **Primary / Brand Action:** `#09090B` (Deep zinc, paired strictly with `#FFFFFF` text)
- **Muted Surface / Subdued Fill:** `#F4F4F5`
- **Structural Border:** `#E4E4E7` (1px subtle demarcation)

### Typography & Contrast
- **Text Primary:** `#09090B` (High-contrast readability for shift dates and metrics)
- **Text Secondary:** `#52525B` (Secondary labels, supporting timestamps, empty states)
- **Text Muted / Placeholder:** `#A1A1AA`

### Semantic Feedback System
Semantic accents use soft-tint backgrounds paired with saturated foreground indicators:
- **Success (Checked in, Approved):** Foreground `#16A34A`, Background `#DCFCE7`, Border `#BBF7D0`
- **Warning (Late arrival, Pending approval):** Foreground `#D97706`, Background `#FEF3C7`, Border `#FDE68A`
- **Error (Missed shift, Rejected):** Foreground `#DC2626`, Background `#FEE2E2`, Border `#FECACA`
- **Information / System (Shift swap, Roster updates):** Foreground `#2563EB`, Background `#DBEAFE`, Border `#BFDBFE`

## Typography

The typography system relies on **Be Vietnam Pro** across all viewport levels. Specifically engineered for Vietnamese diacritics, it preserves vertical rhythm and avoids awkward clipping on lowercase and uppercase accented vowels (such as ệ, ơ, ư, ặ).

### Editorial Hierarchy Rules
- **Headline XL / LG:** Reserved for high-level summaries (monthly logged hours, biometric check-in confirmation).
- **Body & Numerical Data:** Digits (shift timers, currency values in payroll, dates) must always align with corresponding line-height tiers.
- **Micro-labels:** Used strictly inside status chips, category headers, and segmented tab strips.

## Layout & Spacing

The layout is built around an uncompromising **8px spatial grid** with a 4px half-step for micro-alignment within badges and form field adornments.

### Layout Philosophy & Screen Adaptation
- **Mobile First Canvas:** Standard margin is `1rem` (16px), giving maximum screen real estate to rosters and shift tables.
- **One-Handed Zone:** All primary interactions (Punch In/Out slider, date filter anchors, quick-actions) live within the bottom 60% of the display.
- **Vertical Rhythm:**
  - Card-to-Card separation: `0.75rem` (12px) to `1rem` (16px).
  - Internal Card Padding: `1rem` (16px) standard, `1.25rem` (20px) for highlighted dashboard widgets.
  - Form field vertical stack gap: `1rem` (16px).
- **Minimum Touch Target:** All interactive controls (tabs, dropdown toggles, calendar day selectors) adhere strictly to a `≥ 44px` bounding box.

## Elevation & Depth

Depth is established primarily using clean hairline boundaries, avoiding heavy dropped shadows.

### Elevation Levels
- **Level 0 (Flat Canvas):** `#F6F6F8` background surface.
- **Level 1 (Default Card & Containers):** Solid `#FFFFFF` fill with a `1px solid #E4E4E7` boundary and an ultra-subtle ambient lift: `box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05)`.
- **Level 2 (Active Sheets & Sticky Headers):** `#FFFFFF` fill with `box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05)`.
- **Level 3 (Modals & Bottom Action Drawers):** `#FFFFFF` fill with `box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.04)`.

## Shapes

The geometric framework balances contemporary precision with ergonomic touch friendliness.

### Radius Scale
- **Cards & Primary Modules:** `12px` to `16px` (`rounded-lg` to `rounded-xl`). Used for roster containers, daily summaries, and performance overview pods.
- **Buttons & Input Fields:** `12px` (`rounded-lg`). Ensures seamless visual continuity between inputs and primary triggers.
- **Status Tags & Semantic Chips:** `6px` to `8px` (`rounded-md`). Sharp enough to be recognized as metadata, soft enough to avoid harsh corners.
- **Avatars & Action Bubbles:** Fully circular (`rounded-full` / `9999px`).

## Components

### Buttons
- **Primary:** Background `#09090B`, text `#FFFFFF`, border `none`, border-radius `12px`, height `48px` (large touch profile). Hover/Active state transitions to `#27272A`.
- **Secondary / Outlined:** Background `#FFFFFF`, text `#09090B`, border `1px solid #E4E4E7`, border-radius `12px`, height `48px`.
- **Destructive:** Background `#FEE2E2`, text `#DC2626`, border `1px solid #FECACA`, border-radius `12px`, height `48px`.

### Status Badges & Chips
- Structure: Soft background wash + 6px solid accent status dot on the left + `12px` medium text.
- Never use heavy solid saturated chips for non-interactive indicators.
- **Approved/Active:** Background `#DCFCE7`, text `#16A34A`, dot `#16A34A`.
- **Pending/Late:** Background `#FEF3C7`, text `#D97706`, dot `#D97706`.
- **Absent/Rejected:** Background `#FEE2E2`, text `#DC2626`, dot `#DC2626`.

### Cards
- Structure: Background `#FFFFFF`, border `1px solid #E4E4E7`, border-radius `16px`, shadow `0 1px 3px rgba(0, 0, 0, 0.05)`.
- Padding: `16px` uniform.
- Header: Title in `body-lg-medium` `#09090B` paired with contextual status badge right-aligned.

### Input Fields & Selectors
- Container: Height `48px`, border-radius `12px`, border `1px solid #E4E4E7`, background `#FFFFFF`.
- Typography: Input text `14px` Regular `#09090B`, placeholder `#A1A1AA`.
- Focus State: Border color `#09090B` with `0 0 0 1px #09090B` (crisp mono-ring).
- Icon Affordance: Left/Right 20px monochrome stroke icons (`#71717A`).

### Iconography
- Strict line style (Lucide / Phosphor style), `20px` default bounding box, `1.75px` stroke weight.
- Color: Inherits parent text token (`#09090B` for active/interactive, `#71717A` for ancillary).
- No colorful emoji icons or filled cartoon badges.

### Attendance Check-in Bar
- Dedicated bottom component: Height `56px`, high-contrast `#09090B` surface or swipe-to-confirm mechanism. Integrated GPS/Wi-Fi indicator badge on the top right.