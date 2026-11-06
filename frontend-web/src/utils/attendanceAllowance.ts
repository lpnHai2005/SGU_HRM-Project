/** Nhãn mức phụ cấp chuyên cần 500.000đ theo quy chế lũy tiến. */
export function allowanceTierLabel(tier?: string | null): string {
  switch (tier) {
    case 'FULL': return 'Chuyên cần 100%'
    case 'HALF': return 'Chuyên cần 50%'
    case 'LATE_REPORT': return 'Mất chuyên cần (≥5 lần trễ)'
    case 'NOT_ENOUGH_DAYS': return 'Mất chuyên cần (< 20 công)'
    default: return '—'
  }
}
