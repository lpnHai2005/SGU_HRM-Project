import { useLocation, useNavigate } from 'react-router-dom'
import { Icons } from '../common/Icons'
import { ROLE_LABELS } from '../../constants/navigation'
import { getInitials, getRoleFromUser, getRoleBadgeClass } from '../../utils/formatters'

export interface TopbarProps {
  user: any
  onLogout: () => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onToggleMobileMenu?: () => void
}

const PAGE_TITLES: Record<string, string> = {
  dashboard: 'Tổng quan',
  employees: 'Nhân sự',
  attendance: 'Chấm công',
  leave: 'Nghỉ phép',
  payroll: 'Lương & Thưởng',
  reports: 'Báo cáo & Thống kê',
  audit: 'Audit Log',
}

export function Topbar({
  user,
  onLogout,
  theme,
  onToggleTheme,
  onToggleMobileMenu,
}: TopbarProps) {
  const location = useLocation()
  const navigate = useNavigate()

  const currentRoute =
    location.pathname === '/' || location.pathname === '/dashboard'
      ? 'dashboard'
      : location.pathname.replace(/^\//, '')

  const role = getRoleFromUser(user)

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          className="mobile-menu-btn"
          onClick={onToggleMobileMenu}
          aria-label="Mở menu điều hướng"
        >
          {Icons.menu}
        </button>
        <div className="breadcrumb-nav">
          <span className="breadcrumb-root" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>TechZone</span>
          <span className="breadcrumb-separator">&gt;</span>
          <h1 className="topbar-title">{PAGE_TITLES[currentRoute] || 'Tổng quan'}</h1>
        </div>
      </div>
      <div className="topbar-right">
        <button
          className="topbar-icon-btn"
          title="Tìm kiếm hệ thống"
          onClick={() => alert('Nhấn Ctrl+K hoặc chọn trang từ menu')}
        >
          {Icons.search}
        </button>
        <button
          className="theme-toggle-btn"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Chuyển sang giao diện Sáng' : 'Chuyển sang giao diện Tối'}
          aria-label="Toggle Theme"
        >
          {theme === 'dark' ? Icons.sun : Icons.moon}
        </button>
        <button
          className="btn btn-ai"
          onClick={() => alert('✦ Trợ lý AI TechZone: Hệ thống đang kết nối trực tiếp cơ sở dữ liệu và vận hành ổn định.')}
          title="Hỏi trợ lý AI TechZone"
        >
          ✦ Trợ lý AI
        </button>
        <button
          className="btn btn-primary"
          onClick={() => navigate('/employees')}
          title="Thao tác nhanh"
        >
          + Thêm mới
        </button>
        <div className="topbar-divider"></div>
        <div className="topbar-user">
          <div className="user-avatar">{getInitials(user?.full_name || user?.username)}</div>
          <div className="user-info">
            <span className="user-name">{user?.full_name || user?.username || 'User'}</span>
            <span className="user-role">
              <span className={`role-badge ${getRoleBadgeClass(role)}`}>
                {ROLE_LABELS[role]}
              </span>
            </span>
          </div>
        </div>
        <button className="btn btn-secondary btn-sm btn-icon" onClick={onLogout} title="Đăng xuất khỏi hệ thống">
          {Icons.logOut}
        </button>
      </div>
    </header>
  )
}
