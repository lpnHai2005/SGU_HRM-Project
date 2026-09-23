import { useNavigate, useLocation } from 'react-router-dom'
import { Icons } from '../common/Icons'
import { NAV_ITEMS, ROLE_LABELS } from '../../constants/navigation'
import { getInitials } from '../../utils/formatters'
import type { UserRole } from '../../types'

export interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
  role: UserRole
  user?: any
  mobileOpen?: boolean
  onCloseMobile?: () => void
}

export function Sidebar({
  collapsed,
  onToggle,
  role,
  user,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const location = useLocation()
  const navigate = useNavigate()

  const currentRoute =
    location.pathname === '/' || location.pathname === '/dashboard'
      ? 'dashboard'
      : location.pathname.replace(/^\//, '')

  const handleNavigate = (id: string) => {
    const targetPath = id === 'dashboard' ? '/' : `/${id}`
    navigate(targetPath)
    if (onCloseMobile) onCloseMobile()
  }

  const navItems = NAV_ITEMS[role] || []

  // Group items by section
  const sections = navItems.reduce((acc, item) => {
    const sec = item.section || 'Chung'
    if (!acc[sec]) acc[sec] = []
    acc[sec].push(item)
    return acc
  }, {} as Record<string, typeof navItems>)

  return (
    <>
      <div
        className={`sidebar-backdrop ${mobileOpen ? 'open' : ''}`}
        onClick={onCloseMobile}
        aria-hidden="true"
      />
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          {collapsed ? (
            <div className="sidebar-brand-collapsed" title="TechZone HRM">
              {Icons.techzone}
            </div>
          ) : (
            <div className="sidebar-brand">
              <span>techzone</span>
              <span className="sidebar-brand-dot"></span>
            </div>
          )}
          {mobileOpen && (
            <button className="sidebar-mobile-close" onClick={onCloseMobile} aria-label="Đóng menu">
              {Icons.close}
            </button>
          )}
        </div>

        <div className="workspace-selector" onClick={() => handleNavigate('dashboard')} title="TechZone Retail">
          <div className="workspace-badge">T</div>
          {!collapsed && (
            <div className="workspace-info">
              <div className="workspace-title-row">
                <span className="workspace-name">TechZone Retail</span>
                <span className="workspace-chevron">⌄</span>
              </div>
            </div>
          )}
        </div>

        <nav className="sidebar-nav">
          {Object.entries(sections).map(([section, items]) => (
            <div key={section} className="nav-section">
              {!collapsed && <div className="nav-section-title">{section}</div>}
              {items.map((item) => (
                <div
                  key={item.id}
                  className={`nav-item ${currentRoute === item.id ? 'active' : ''}`}
                  onClick={() => handleNavigate(item.id)}
                  title={item.label}
                >
                  {Icons[item.icon]}
                  {!collapsed && <span className="nav-item-label">{item.label}</span>}
                </div>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user-card" title={user?.full_name || user?.username}>
            <div className="sidebar-user-avatar">{getInitials(user?.full_name || user?.username)}</div>
            {!collapsed && (
              <>
                <div className="sidebar-user-info">
                  <span className="sidebar-user-name">{user?.full_name || user?.username || 'User'}</span>
                  <span className="sidebar-user-role">{ROLE_LABELS[role]}</span>
                </div>
                <span className="sidebar-user-options">⋯</span>
              </>
            )}
          </div>
          <button
            className="sidebar-toggle"
            onClick={onToggle}
            title={collapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
          >
            {collapsed ? Icons.chevronRight : Icons.chevronLeft}
          </button>
        </div>
      </aside>
    </>
  )
}
