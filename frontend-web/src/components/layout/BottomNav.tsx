import { useLocation, useNavigate } from 'react-router-dom'
import { Icons } from '../common/Icons'
import type { UserRole } from '../../types'

export interface BottomNavProps {
  onOpenMenu: () => void
  role: UserRole
}

export function BottomNav({ onOpenMenu, role }: BottomNavProps) {
  const location = useLocation()
  const navigate = useNavigate()

  const currentRoute =
    location.pathname === '/' || location.pathname === '/dashboard'
      ? 'dashboard'
      : location.pathname.replace(/^\//, '')

  const primaryItems = [
    { id: 'dashboard', path: '/', label: 'Tổng quan', icon: 'dashboard' },
    { id: 'attendance', path: '/attendance', label: 'Bảng Công', icon: 'clock' },
    { id: 'leave', path: '/leave', label: 'Nghỉ phép', icon: 'calendar' },
    {
      id: role === 'EMPLOYEE' ? 'payroll' : 'employees',
      path: role === 'EMPLOYEE' ? '/payroll' : '/employees',
      label: role === 'EMPLOYEE' ? 'Lương' : 'Nhân sự',
      icon: role === 'EMPLOYEE' ? 'wallet' : 'users',
    },
  ]

  return (
    <nav className="mobile-bottom-nav" aria-label="Điều hướng chính di động">
      {primaryItems.map((item) => (
        <button
          key={item.id}
          className={`bottom-nav-item ${currentRoute === item.id ? 'active' : ''}`}
          onClick={() => navigate(item.path)}
        >
          <span className="bottom-nav-icon">{Icons[item.icon]}</span>
          <span className="bottom-nav-label">{item.label}</span>
        </button>
      ))}
      <button
        className={`bottom-nav-item ${['reports', 'audit', 'payroll'].includes(currentRoute) && role !== 'EMPLOYEE' ? 'active' : ''}`}
        onClick={onOpenMenu}
        aria-label="Thêm chức năng"
      >
        <span className="bottom-nav-icon">{Icons.menu}</span>
        <span className="bottom-nav-label">Thêm</span>
      </button>
    </nav>
  )
}

