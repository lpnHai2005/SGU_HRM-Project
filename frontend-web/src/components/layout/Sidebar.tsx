import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Icons } from '../common/Icons'
import { navigationForUser, ROLE_LABELS, type NavItemConfig, type NavSubItemConfig } from '../../constants/navigation'
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

  const handleNavigate = (path: string) => {
    navigate(path)
    if (onCloseMobile) onCloseMobile()
  }

  const userKey = `${user?.user_id || ''}-${(user?.roles || []).join(',')}-${user?.employee_id || ''}-${user?.store_id || ''}`
  // Memoize navigation items with stable key to prevent re-creation
  const navItems = useMemo<NavItemConfig[]>(() => navigationForUser(user), [userKey])

  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    navItems.forEach((item: NavItemConfig) => {
      if (item.children?.some((c: NavSubItemConfig) => c.path === location.pathname)) {
        initial[item.id] = true
      }
    })
    return initial
  })

  useEffect(() => {
    setExpandedItems(prev => {
      let changed = false
      const next = { ...prev }
      navItems.forEach((item: NavItemConfig) => {
        if (item.children?.some((c: NavSubItemConfig) => c.path === location.pathname)) {
          if (!next[item.id]) {
            next[item.id] = true
            changed = true
          }
        }
      })
      return changed ? next : prev
    })
  }, [location.pathname, navItems])

  // Group items by section
  const sections = navItems.reduce<Record<string, NavItemConfig[]>>((acc, item: NavItemConfig) => {
    const sec = item.section || 'Chung'
    if (!acc[sec]) acc[sec] = []
    acc[sec].push(item)
    return acc
  }, {})

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

        <div className="workspace-selector" onClick={() => handleNavigate('/')} title="TechZone Retail">
          <div className="workspace-badge">T</div>
          {!collapsed && (
            <div className="workspace-info">
              <div className="workspace-title-row">
                <span className="workspace-name">TechZone Retail</span>
                <span className="workspace-chevron">{Icons.chevronDown}</span>
              </div>
            </div>
          )}
        </div>

        <nav className="sidebar-nav">
          {Object.entries(sections).map(([section, items]) => (
            <div key={section} className="nav-section">
              {!collapsed && <div className="nav-section-title">{section}</div>}
              {items.map((item: NavItemConfig) => {
                const hasChildren = item.children && item.children.length > 0
                const isExpanded = Boolean(expandedItems[item.id])
                const isChildActive = hasChildren && item.children!.some((c: NavSubItemConfig) => c.path === location.pathname)
                const isActive = (location.pathname === item.path || (item.path === '/' && location.pathname === '/dashboard')) || isChildActive

                if (hasChildren) {
                  return (
                    <div key={item.id} className="nav-item-group">
                      <div
                        className={`nav-item nav-item-parent ${isActive ? 'active' : ''}`}
                        onClick={() => {
                          if (collapsed) {
                            onToggle()
                            setExpandedItems(prev => ({ ...prev, [item.id]: true }))
                          } else {
                            setExpandedItems(prev => ({ ...prev, [item.id]: !prev[item.id] }))
                          }
                        }}
                        onKeyDown={event => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            if (collapsed) {
                              onToggle()
                              setExpandedItems(prev => ({ ...prev, [item.id]: true }))
                            } else {
                              setExpandedItems(prev => ({ ...prev, [item.id]: !prev[item.id] }))
                            }
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        aria-expanded={isExpanded}
                        title={item.label}
                      >
                        {Icons[item.icon] || Icons.clipboardList}
                        {!collapsed && <span className="nav-item-label">{item.label}</span>}
                        {!collapsed && (
                          <span
                            className="nav-item-arrow"
                            style={{
                              transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                              transition: 'transform 0.2s ease',
                              opacity: 0.7,
                            }}
                          >
                            {Icons.chevronDown}
                          </span>
                        )}
                      </div>

                      {!collapsed && isExpanded && (
                        <div className="nav-submenu">
                          {item.children!.map((child: NavSubItemConfig) => {
                            const isSubActive = location.pathname === child.path
                            return (
                              <div
                                key={child.id}
                                className={`nav-subitem ${isSubActive ? 'active' : ''}`}
                                onClick={() => handleNavigate(child.path)}
                                onKeyDown={event => {
                                  if (event.key === 'Enter' || event.key === ' ') handleNavigate(child.path)
                                }}
                                role="link"
                                tabIndex={0}
                                aria-current={isSubActive ? 'page' : undefined}
                                title={child.label}
                              >
                                {child.icon && (
                                  <span className="nav-subitem-icon">
                                    {Icons[child.icon]}
                                  </span>
                                )}
                                <span className="nav-subitem-label">{child.label}</span>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                }

                return (
                  <div
                    key={item.id}
                    className={`nav-item ${isActive ? 'active' : ''}`}
                    onClick={() => handleNavigate(item.path)}
                    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') handleNavigate(item.path) }}
                    role="link"
                    tabIndex={0}
                    aria-current={location.pathname === item.path ? 'page' : undefined}
                    title={item.label}
                  >
                    {Icons[item.icon]}
                    {!collapsed && <span className="nav-item-label">{item.label}</span>}
                  </div>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user-card" role="button" tabIndex={0} onClick={() => handleNavigate('/account')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') handleNavigate('/account') }} title={user?.full_name || user?.username}>
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="" className="sidebar-user-avatar-img" />
            ) : (
              <div className="sidebar-user-avatar">{getInitials(user?.full_name || user?.username)}</div>
            )}
            {!collapsed && (
              <>
                <div className="sidebar-user-info">
                  <span className="sidebar-user-name">{user?.full_name || user?.username || 'User'}</span>
                  <span className="sidebar-user-role">{ROLE_LABELS[role]}</span>
                </div>
                <span className="sidebar-user-options">{Icons.moreVertical}</span>
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
