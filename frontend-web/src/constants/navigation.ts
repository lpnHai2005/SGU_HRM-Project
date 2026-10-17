import type { UserRole } from '../types'
export type NavigationUser = { roles: string[]; permissions?: string[]; employee_id?: number | null; store_id?: number | null }

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Quản trị viên', DIRECTOR: 'Giám đốc',
  HR_MANAGER: 'Trưởng phòng NS', STORE_MANAGER: 'Cửa hàng trưởng', EMPLOYEE: 'Nhân viên',
}
export const LEAVE_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Chờ duyệt', STORE_APPROVED: 'Cửa hàng đã duyệt',
  HR_APPROVED: 'Đã duyệt', REJECTED: 'Từ chối', CANCELLED: 'Đã hủy',
}
export interface NavItemConfig {
  id: string
  path: string
  label: string
  icon: string
  section: string
  roles: UserRole[]
  hiddenFor?: UserRole[]
  requiresEmployee?: boolean
  requiresStore?: boolean
  permission?: string
}
const managers: UserRole[] = ['ADMIN', 'DIRECTOR', 'HR_MANAGER', 'STORE_MANAGER']
const financeManagers: UserRole[] = ['ADMIN', 'DIRECTOR', 'HR_MANAGER']
const all: UserRole[] = [...managers, 'EMPLOYEE']
// Every item has a route; pages with unfinished workflows display their limits.
// The backend still enforces record-level scope.
export const NAVIGATION: NavItemConfig[] = [
  { id: 'dashboard', path: '/', label: 'Trang chủ', icon: 'dashboard', section: 'Trang chủ', roles: all },
  { id: 'stores', path: '/stores', label: 'Quản lý cửa hàng & GPS', icon: 'store', section: 'Quản trị hệ thống', roles: ['ADMIN', 'DIRECTOR'] },
  { id: 'users', path: '/users', label: 'Tài khoản & Phân quyền', icon: 'shield', section: 'Quản trị hệ thống', roles: ['ADMIN', 'DIRECTOR', 'HR_MANAGER'] },
  { id: 'audit', path: '/audit', label: 'Nhật ký kiểm toán', icon: 'fileText', section: 'Quản trị hệ thống', roles: ['ADMIN', 'DIRECTOR', 'HR_MANAGER'] },
  { id: 'employees', path: '/employees', label: 'Quản lý nhân viên', icon: 'users', section: 'Nhân sự', roles: managers },
  { id: 'contracts', path: '/contracts', label: 'Hợp đồng & Biến động nhân sự', icon: 'fileText', section: 'Nhân sự', roles: managers },
  { id: 'resignations', path: '/resignations', label: 'Quản lý thôi việc', icon: 'clipboardList', section: 'Nhân sự', roles: ['ADMIN', 'DIRECTOR', 'HR_MANAGER'] },
  { id: 'work-schedules', path: '/work-schedules', label: 'Quản lý lịch làm việc', icon: 'calendar', section: 'Vận hành', roles: managers },
  { id: 'attendance', path: '/attendance', label: 'Quản lý công & OT', icon: 'clock', section: 'Vận hành', roles: managers },
  { id: 'leave', path: '/leave', label: 'Quản lý đơn từ', icon: 'clipboardList', section: 'Vận hành', roles: managers },
  { id: 'activity', path: '/activity', label: 'Nhật ký đội ngũ', icon: 'chart', section: 'Vận hành', roles: managers },
  { id: 'projects', path: '/projects', label: 'Quản lý dự án', icon: 'briefcase', section: 'Vận hành', roles: managers },
  { id: 'sales', path: '/sales', label: 'Doanh số & Hoa hồng', icon: 'trendingUp', section: 'Kinh doanh & Tài chính', roles: managers },
  { id: 'payroll-fund', path: '/payroll-fund', label: 'Quỹ lương', icon: 'dollar', section: 'Kinh doanh & Tài chính', roles: financeManagers },
  { id: 'payroll', path: '/payroll', label: 'Quản lý bảng lương', icon: 'wallet', section: 'Kinh doanh & Tài chính', roles: financeManagers },
  { id: 'settlements', path: '/settlements', label: 'Thanh toán & Đối soát', icon: 'checkCircle', section: 'Kinh doanh & Tài chính', roles: financeManagers },
  { id: 'reports', path: '/reports', label: 'Trung tâm báo cáo & KPI', icon: 'chart', section: 'Báo cáo', roles: managers },
  { id: 'my-schedules', path: '/my-schedules', label: 'Lịch ca của tôi', icon: 'calendar', section: 'Cá nhân', roles: ['STORE_MANAGER'], hiddenFor: ['DIRECTOR', 'ADMIN'], requiresEmployee: true },
  { id: 'my-attendance', path: '/my-attendance', label: 'Bảng công của tôi', icon: 'clock', section: 'Cá nhân', roles: ['STORE_MANAGER'], hiddenFor: ['DIRECTOR', 'ADMIN'], requiresEmployee: true },
  { id: 'my-activity', path: '/my-activity', label: 'Nhật ký của tôi', icon: 'chart', section: 'Cá nhân', roles: ['STORE_MANAGER'], hiddenFor: ['DIRECTOR', 'ADMIN'], requiresEmployee: true },
  { id: 'my-leave', path: '/my-leave', label: 'Nghỉ phép của tôi', icon: 'leave', section: 'Cá nhân', roles: managers, requiresEmployee: true },
  { id: 'my-payroll', path: '/my-payroll', label: 'Lương & Hợp đồng của tôi', icon: 'wallet', section: 'Cá nhân', roles: managers, requiresEmployee: true },
  { id: 'my-attendance-staff', path: '/my-attendance', label: 'Bảng công cá nhân', icon: 'clock', section: 'Công việc của tôi', roles: ['EMPLOYEE'], requiresEmployee: true },
  { id: 'my-schedules-staff', path: '/my-schedules', label: 'Lịch ca & Phân công', icon: 'calendar', section: 'Công việc của tôi', roles: ['EMPLOYEE'], requiresEmployee: true },
  { id: 'my-activity-staff', path: '/my-activity', label: 'Nhật ký làm việc', icon: 'chart', section: 'Công việc của tôi', roles: ['EMPLOYEE'], requiresEmployee: true },
  { id: 'projects-staff', path: '/projects', label: 'Dự án tham gia', icon: 'briefcase', section: 'Công việc của tôi', roles: ['EMPLOYEE'], requiresEmployee: true },
  { id: 'leave-staff', path: '/leave', label: 'Nghỉ phép & Đơn của tôi', icon: 'fileText', section: 'Đơn từ', roles: ['EMPLOYEE'] },
  { id: 'my-payroll-staff', path: '/my-payroll', label: 'Lương & Hợp đồng', icon: 'wallet', section: 'Thu nhập', roles: ['EMPLOYEE'], requiresEmployee: true },
]
export function canAccessNavigation(item: NavItemConfig, user: NavigationUser | null | undefined): boolean {
  if (!user) return false
  const userRoles = (user.roles || []) as UserRole[]

  // Xác định effectiveRole - DIRECTOR là role cao nhất
  const effectiveRole = (['DIRECTOR', 'ADMIN', 'HR_MANAGER', 'STORE_MANAGER', 'EMPLOYEE'] as const)
    .find(role => userRoles.includes(role)) || 'EMPLOYEE'

  // Kiểm tra user có vai trò phù hợp với item không
  const hasRoleAccess = item.roles.some(r => userRoles.includes(r))
  if (!hasRoleAccess) return false

  // Kiểm tra hiddenFor
  if (item.hiddenFor?.includes(effectiveRole)) return false

  // DIRECTOR là role cao nhất - xem được tất cả trang quản lý được gán cho DIRECTOR
  if (effectiveRole === 'DIRECTOR') {
    if (item.requiresEmployee && !user.employee_id) return false
    return true
  }

  // STORE_MANAGER cần có store_id cho các trang chi nhánh
  if (effectiveRole === 'STORE_MANAGER' && !user.store_id &&
      ['/employees', '/contracts', '/work-schedules', '/attendance', '/leave', '/activity', '/projects', '/sales', '/reports'].includes(item.path)) return false

  if (item.requiresEmployee && !user.employee_id) return false
  if (item.requiresStore && !user.store_id) return false
  if (item.permission && !userRoles.includes('ADMIN') && !user.permissions?.includes(item.permission)) return false
  return true
}
export function navigationForUser(user: NavigationUser | null | undefined): NavItemConfig[] {
  return NAVIGATION.filter(item => canAccessNavigation(item, user))
}
export function canAccessPath(path: string, user: NavigationUser | null | undefined): boolean {
  return NAVIGATION.some(item => item.path === path && canAccessNavigation(item, user))
}
