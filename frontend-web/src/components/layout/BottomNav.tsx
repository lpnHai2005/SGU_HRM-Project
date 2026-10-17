import { useLocation, useNavigate } from 'react-router-dom'
import { Icons } from '../common/Icons'
import { navigationForUser } from '../../constants/navigation'
import type { NavigationUser } from '../../constants/navigation'

export interface BottomNavProps {
  onOpenMenu: () => void
  user: NavigationUser | null
}

export function BottomNav({ onOpenMenu, user }: BottomNavProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const visible = navigationForUser(user)
  const manager = user?.roles?.some(role => ['ADMIN', 'DIRECTOR', 'HR_MANAGER', 'STORE_MANAGER'].includes(role))
  const preferred = manager
    ? ['dashboard', 'attendance', 'leave', 'employees']
    : ['dashboard', 'my-attendance-staff', 'leave-staff', 'my-payroll-staff']
  const primaryItems = preferred.flatMap(id => visible.filter(item => item.id === id))
  const compactLabels: Record<string, string> = {
    dashboard: 'Trang chủ', attendance: 'Bảng công', leave: 'Đơn từ', employees: 'Nhân sự',
    'my-attendance-staff': 'Bảng công', 'leave-staff': 'Đơn từ', 'my-payroll-staff': 'Lương',
  }
  return (
    <nav className="mobile-bottom-nav" aria-label="Điều hướng chính di động">
      {primaryItems.map(item => (
        <button key={item.id} className={`bottom-nav-item ${location.pathname === item.path ? 'active' : ''}`} onClick={() => navigate(item.path)}>
          <span className="bottom-nav-icon">{Icons[item.icon]}</span>
          <span className="bottom-nav-label">{compactLabels[item.id] || item.label}</span>
        </button>
      ))}
      <button className={`bottom-nav-item ${!primaryItems.some(item => item.path === location.pathname) ? 'active' : ''}`} onClick={onOpenMenu} aria-label="Thêm chức năng">
        <span className="bottom-nav-icon">{Icons.menu}</span>
        <span className="bottom-nav-label">Thêm</span>
      </button>
    </nav>
  )
}
