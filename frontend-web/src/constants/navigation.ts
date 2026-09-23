import type { UserRole } from '../types'

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Quản trị viên',
  HR_MANAGER: 'Trưởng phòng NS',
  STORE_MANAGER: 'Cửa hàng trưởng',
  EMPLOYEE: 'Nhân viên',
}

export const LEAVE_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Chờ duyệt',
  STORE_APPROVED: 'Cửa hàng đã duyệt',
  HR_APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  CANCELLED: 'Đã hủy',
}

export interface NavItemConfig {
  id: string
  label: string
  icon: string
  section?: string
  badge?: number | string
}

export const NAV_ITEMS: Record<UserRole, NavItemConfig[]> = {
  ADMIN: [
    { id: 'dashboard', label: 'Tổng quan', icon: 'dashboard', section: 'Vận hành' },
    { id: 'attendance', label: 'Chấm công', icon: 'clock', section: 'Vận hành' },
    { id: 'leave', label: 'Nghỉ phép', icon: 'calendar', section: 'Vận hành' },
    { id: 'employees', label: 'Nhân sự', icon: 'users', section: 'Quản trị' },
    { id: 'payroll', label: 'Lương & Thưởng', icon: 'wallet', section: 'Quản trị' },
    { id: 'reports', label: 'Báo cáo', icon: 'chart', section: 'Hệ thống' },
    { id: 'audit', label: 'Audit Log', icon: 'shield', section: 'Hệ thống' },
  ],
  HR_MANAGER: [
    { id: 'dashboard', label: 'Tổng quan', icon: 'dashboard', section: 'Vận hành' },
    { id: 'attendance', label: 'Chấm công', icon: 'clock', section: 'Vận hành' },
    { id: 'leave', label: 'Nghỉ phép', icon: 'calendar', section: 'Vận hành' },
    { id: 'employees', label: 'Nhân sự', icon: 'users', section: 'Quản trị' },
    { id: 'payroll', label: 'Lương & Thưởng', icon: 'wallet', section: 'Quản trị' },
    { id: 'reports', label: 'Báo cáo', icon: 'chart', section: 'Hệ thống' },
  ],
  STORE_MANAGER: [
    { id: 'dashboard', label: 'Tổng quan', icon: 'dashboard', section: 'Vận hành' },
    { id: 'attendance', label: 'Chấm công', icon: 'clock', section: 'Vận hành' },
    { id: 'leave', label: 'Nghỉ phép', icon: 'calendar', section: 'Vận hành' },
    { id: 'employees', label: 'Nhân viên CH', icon: 'users', section: 'Quản trị' },
    { id: 'payroll', label: 'Bảng lương CH', icon: 'wallet', section: 'Quản trị' },
  ],
  EMPLOYEE: [
    { id: 'dashboard', label: 'Tổng quan', icon: 'dashboard', section: 'Cá nhân' },
    { id: 'attendance', label: 'Chấm công', icon: 'clock', section: 'Cá nhân' },
    { id: 'leave', label: 'Nghỉ phép', icon: 'calendar', section: 'Cá nhân' },
    { id: 'payroll', label: 'Phiếu lương', icon: 'wallet', section: 'Cá nhân' },
  ],
}
