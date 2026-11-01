import type { UserRole } from '../types'

export function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return '0 VNĐ'
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '--/--/----'
  const d = new Date(dateStr)
  return d.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function formatTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '--:--'
  const d = new Date(dateStr)
  return d.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '--'
  return `${formatDate(dateStr)} ${formatTime(dateStr)}`
}

export function getInitials(name: string | null | undefined): string {
  if (!name) return '??'
  return name
    .trim()
    .split(/\s+/)
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function getRoleFromUser(user: any): UserRole {
  if (!user) return 'EMPLOYEE'
  const roles = [user.role, ...(Array.isArray(user.roles) ? user.roles : [])]
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.toUpperCase())
  // Ưu tiên theo thứ tự: ADMIN > DIRECTOR > HR_MANAGER > STORE_MANAGER
  for (const role of ['ADMIN', 'DIRECTOR', 'HR_MANAGER', 'STORE_MANAGER'] as const) {
    if (roles.includes(role)) return role
  }
  return 'EMPLOYEE'
}

export function getRoleBadgeClass(role: UserRole): string {
  switch (role) {
    case 'ADMIN':
      return 'admin'
    case 'DIRECTOR':
      return 'director'
    case 'HR_MANAGER':
      return 'hr'
    case 'STORE_MANAGER':
      return 'manager'
    case 'EMPLOYEE':
      return 'employee'
    default:
      return 'employee'
  }
}

export function formatDurationMinutes(minutes?: number | null): string {
  if (minutes == null || isNaN(minutes) || minutes <= 0) return '0p'
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h === 0) return `${m}p`
  if (m === 0) return `${h}h`
  return `${h}h ${m}p`
}

export function formatQualityFlag(flag: string): string {
  switch (flag) {
    case 'SHORT_SESSION':
      return 'Phiên ngắn ≤15p'
    case 'OPEN_SESSION':
      return 'Phiên chưa checkout'
    case 'OVERDUE_OPEN_SESSION':
      return 'Quá hạn 7 ngày chưa checkout'
    case 'SHIFT_MISMATCH':
      return 'Lệch lịch phân ca'
    case 'UNSCHEDULED':
      return 'Ngoài lịch phân ca'
    case 'EXCESSIVE_LATE':
      return 'Trễ quá 4h (Chờ HR rà soát)'
    case 'EXCESSIVE_EARLY':
      return 'Sớm quá 4h (Chờ HR rà soát)'
    case 'NORMAL':
      return 'Hợp lệ'
    default:
      return flag
  }
}

export function formatQualityStatus(status?: string): string {
  switch (status) {
    case 'NORMAL':
      return 'Hợp lệ'
    case 'SHORT_SESSION':
      return 'Phiên ngắn bất thường (≤15p)'
    case 'OPEN_SESSION':
      return 'Chưa checkout'
    case 'OVERDUE_OPEN_SESSION':
      return 'Quá hạn 7 ngày'
    case 'NEEDS_REVIEW':
      return 'Cần HR rà soát'
    case 'FLAGGED':
      return 'Có cờ cảnh báo'
    default:
      return status || 'Chưa xác định'
  }
}

