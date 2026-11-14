import { useState } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Toaster, toast } from 'sonner'
import { Icons } from '../components/common/Icons'
import { ErrorBoundary } from '../components/common/ErrorBoundary'
import { ConfirmHost, confirmAction } from '../components/common/ConfirmDialog'
import { UserAccessPage } from '../pages/UserAccessPage'
import { StoresPage } from '../pages/StoreManagementPage'
import { AuditLogPage } from '../pages/AuditLogPage'
import { adminApi } from '../services/api'
import { getInitials } from '../utils/formatters'

const NAV = [
  { path: '/admin/users', label: 'Tài khoản & Phân quyền', icon: 'shield' },
  { path: '/admin/stores', label: 'Cửa hàng & GPS', icon: 'store' },
  { path: '/admin/audit', label: 'Nhật ký kiểm toán', icon: 'fileText' },
  { path: '/admin/maintenance', label: 'Bảo trì dữ liệu', icon: 'settings' },
]

function MaintenancePage() {
  const [busy, setBusy] = useState(false)
  const [lastResult, setLastResult] = useState<string | null>(null)

  const sync = async () => {
    if (!(await confirmAction('Quét toàn bộ nhân viên và đồng bộ trạng thái nhân viên, tài khoản theo hợp đồng hiện hành?'))) return
    setBusy(true)
    try {
      const res = await adminApi.syncEmployeeStatuses()
      setLastResult(res.message)
      toast.success(res.message)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Đồng bộ thất bại')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-container">
      <div className="page-header" style={{ marginBottom: 16 }}>
        <h1 className="page-title">Bảo trì dữ liệu</h1>
        <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
          Tác vụ hệ thống chạy thủ công, thay cho job đầu ngày.
        </p>
      </div>
      <div className="card" style={{ padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <strong>Đồng bộ trạng thái nhân viên theo hợp đồng</strong>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
            Áp quy tắc hiệu lực hợp đồng lên toàn bộ nhân viên và khóa/mở tài khoản tương ứng.
          </p>
          {lastResult && <p style={{ margin: '8px 0 0', fontSize: 13 }}>{lastResult}</p>}
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={sync} disabled={busy}>
          {Icons.refresh} {busy ? 'Đang đồng bộ…' : 'Đồng bộ ngay'}
        </button>
      </div>
    </div>
  )
}

export interface AdminAppProps {
  user: any
  onLogout: () => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
}

/** Module quản trị hệ thống: chỉ chứa tác vụ ghi của ADMIN, không dùng chung menu/route với app nghiệp vụ. */
export function AdminApp({ user, onLogout, theme, onToggleTheme }: AdminAppProps) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const title = NAV.find(n => n.path === pathname)?.label || 'Quản trị hệ thống'

  const go = (path: string) => { navigate(path); setMobileOpen(false) }

  return (
    <div className="app-layout">
      <Toaster richColors closeButton theme={theme} position="top-right" />
      <ConfirmHost />
      <div className={`sidebar-backdrop ${mobileOpen ? 'open' : ''}`} onClick={() => setMobileOpen(false)} aria-hidden="true" />
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand"><span>techzone</span><span className="sidebar-brand-dot"></span></div>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-section">
            <div className="nav-section-title">Quản trị hệ thống</div>
            {NAV.map(item => (
              <div
                key={item.path}
                className={`nav-item ${pathname === item.path ? 'active' : ''}`}
                onClick={() => go(item.path)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') go(item.path) }}
                role="link"
                tabIndex={0}
                aria-current={pathname === item.path ? 'page' : undefined}
              >
                {Icons[item.icon]}
                <span className="nav-item-label">{item.label}</span>
              </div>
            ))}
          </div>
        </nav>
      </aside>

      <header className="topbar">
        <div className="topbar-left">
          <button className="mobile-menu-btn" onClick={() => setMobileOpen(v => !v)} aria-label="Mở menu">{Icons.menu}</button>
          <div className="breadcrumb-nav">
            <span className="breadcrumb-root">TechZone</span>
            <span className="breadcrumb-separator">&gt;</span>
            <h1 className="topbar-title">{title}</h1>
          </div>
        </div>
        <div className="topbar-right">
          <button
            className="theme-toggle-btn"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Chuyển sang giao diện Sáng' : 'Chuyển sang giao diện Tối'}
            aria-label="Toggle Theme"
          >
            {theme === 'dark' ? Icons.sun : Icons.moon}
          </button>
          <div className="topbar-divider"></div>
          <div className="topbar-user">
            <div className="user-avatar">{getInitials(user?.full_name || user?.username)}</div>
            <div className="user-info">
              <span className="user-name">{user?.full_name || user?.username}</span>
              <span className="user-role"><span className="role-badge">Quản trị viên</span></span>
            </div>
          </div>
          <button className="btn btn-secondary btn-sm btn-icon" onClick={onLogout} title="Đăng xuất khỏi hệ thống">{Icons.logOut}</button>
        </div>
      </header>

      <main className="main-content">
        <ErrorBoundary>
          <Routes>
            <Route path="/admin" element={<Navigate to="/admin/users" replace />} />
            <Route path="/admin/users" element={<UserAccessPage currentUserId={user.user_id} />} />
            <Route path="/admin/stores" element={<StoresPage />} />
            <Route path="/admin/audit" element={<AuditLogPage user={user} />} />
            <Route path="/admin/maintenance" element={<MaintenancePage />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </ErrorBoundary>
      </main>
    </div>
  )
}
