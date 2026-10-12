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
    { id: 'stores', label: 'Quản lý cửa hàng', icon: 'store', section: 'Vận hành' },
    { id: 'dashboard', label: 'Tổng quan', icon: 'dashboard', section: 'Vận hành' },
    { id: 'attendance', label: 'Quản lý công', icon: 'clock', section: 'Vận hành' },
    { id: 'work-schedules', label: 'Quản lý lịch làm việc', icon: 'calendar', section: 'Vận hành' },
    { id: 'leave', label: 'Nghỉ phép', icon: 'calendar', section: 'Vận hành' },
    { id: 'employees', label: 'Nhân sự', icon: 'users', section: 'Quản trị' },
    { id: 'payroll', label: 'Lương & Thưởng', icon: 'wallet', section: 'Quản trị' },
    { id: 'my-schedules', label: 'Lịch ca & Phân công', icon: 'calendar', section: 'Cá nhân' },
    { id: 'my-attendance', label: 'Bảng công cá nhân', icon: 'clock', section: 'Cá nhân' },
    { id: 'activity', label: 'Nhật ký làm việc & Hoạt động', icon: 'chart', section: 'Cá nhân' },
    { id: 'reports', label: 'Báo cáo', icon: 'chart', section: 'Hệ thống' },
    { id: 'audit', label: 'Audit Log', icon: 'shield', section: 'Hệ thống' },
  ],
  HR_MANAGER: [
    { id: 'dashboard', label: 'Tổng quan', icon: 'dashboard', section: 'Vận hành' },
    { id: 'attendance', label: 'Quản lý công', icon: 'clock', section: 'Vận hành' },
    { id: 'work-schedules', label: 'Quản lý lịch làm việc', icon: 'calendar', section: 'Vận hành' },
    { id: 'leave', label: 'Nghỉ phép', icon: 'calendar', section: 'Vận hành' },
    { id: 'employees', label: 'Nhân sự', icon: 'users', section: 'Quản trị' },
    { id: 'payroll', label: 'Lương & Thưởng', icon: 'wallet', section: 'Quản trị' },
    { id: 'my-schedules', label: 'Lịch ca & Phân công', icon: 'calendar', section: 'Cá nhân' },
    { id: 'my-attendance', label: 'Bảng công cá nhân', icon: 'clock', section: 'Cá nhân' },
    { id: 'activity', label: 'Nhật ký làm việc & Hoạt động', icon: 'chart', section: 'Cá nhân' },
    { id: 'reports', label: 'Báo cáo', icon: 'chart', section: 'Hệ thống' },
  ],
  STORE_MANAGER: [
    { id: 'dashboard', label: 'Tổng quan', icon: 'dashboard', section: 'Vận hành' },
    { id: 'attendance', label: 'Quản lý công', icon: 'clock', section: 'Vận hành' },
    { id: 'work-schedules', label: 'Quản lý lịch làm việc', icon: 'calendar', section: 'Vận hành' },
    { id: 'leave', label: 'Nghỉ phép', icon: 'calendar', section: 'Vận hành' },
    { id: 'employees', label: 'Nhân viên CH', icon: 'users', section: 'Quản trị' },
    { id: 'payroll', label: 'Bảng lương CH', icon: 'wallet', section: 'Quản trị' },
    { id: 'my-schedules', label: 'Lịch ca & Phân công', icon: 'calendar', section: 'Cá nhân' },
    { id: 'my-attendance', label: 'Bảng công cá nhân', icon: 'clock', section: 'Cá nhân' },
    { id: 'activity', label: 'Nhật ký làm việc & Hoạt động', icon: 'chart', section: 'Cá nhân' },
  ],
  EMPLOYEE: [
    { id: 'dashboard', label: 'Trang chủ', icon: 'dashboard', section: 'Cá nhân' },
    { id: 'my-attendance', label: 'Bảng công cá nhân', icon: 'clock', section: 'Cá nhân' },
    { id: 'my-schedules', label: 'Lịch ca & Phân công', icon: 'calendar', section: 'Cá nhân' },
    { id: 'leave', label: 'Đơn từ', icon: 'fileText', section: 'Cá nhân' },
    { id: 'activity', label: 'Nhật ký làm việc & Hoạt động', icon: 'chart', section: 'Cá nhân' },
  ],
}
