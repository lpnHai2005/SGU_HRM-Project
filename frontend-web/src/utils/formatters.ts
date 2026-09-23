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
  const roleName = user.role || user.roles?.[0] || 'EMPLOYEE'
  if (typeof roleName === 'string') {
    const upper = roleName.toUpperCase()
    if (upper.includes('ADMIN')) return 'ADMIN'
    if (upper.includes('HR')) return 'HR_MANAGER'
    if (upper.includes('STORE') || upper.includes('MANAGER')) return 'STORE_MANAGER'
  }
  return 'EMPLOYEE'
}

export function getRoleBadgeClass(role: UserRole): string {
  switch (role) {
    case 'ADMIN':
      return 'admin'
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
