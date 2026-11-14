import { useMemo, useState } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Toaster, toast } from 'sonner'
import { Icons } from '../components/common/Icons'
import { ErrorBoundary } from '../components/common/ErrorBoundary'
import { ConfirmHost, confirmAction } from '../components/common/ConfirmDialog'
import { UserAccessPage } from '../pages/UserAccessPage'
import { StoresPage } from '../pages/StoreManagementPage'
import { AuditLogPage } from '../pages/AuditLogPage'
import { AccountPage } from '../pages/AccountPage'
import { OverviewPage } from '../pages/OverviewPage'
import { PersonalSchedulesPage } from '../pages/PersonalSchedulesPage'
import { AttendancePage } from '../pages/AttendancePage'
import { LeaveRequestsPage } from '../pages/LeaveRequestsPage'
import { OvertimeRequestsPage } from '../pages/OvertimeRequestsPage'
import { MyResignationPage } from '../pages/MyResignationPage'
import { MyPayslipPage } from '../pages/MyPayslipPage'
import { ProjectsPage } from '../pages/ProjectsPage'
import { ActivityPage } from '../pages/ActivityPage'
import { StaffScope, toStaffRoles } from '../contexts/AuthContext'
import { adminApi } from '../services/api'
import { getInitials } from '../utils/formatters'

const NAV = [
  { path: '/admin/users', label: 'Tài khoản & Phân quyền', icon: 'shield', section: 'Quản trị hệ thống' },
  { path: '/admin/stores', label: 'Cửa hàng & GPS', icon: 'store', section: 'Quản trị hệ thống' },
  { path: '/admin/audit', label: 'Nhật ký kiểm toán', icon: 'fileText', section: 'Quản trị hệ thống' },
  { path: '/admin/maintenance', label: 'Bảo trì dữ liệu', icon: 'settings', section: 'Quản trị hệ thống' },
  // Phần cá nhân: dùng đúng đường dẫn của app chính để liên kết nội bộ giữa các trang vẫn chạy.
  { path: '/admin/home', label: 'Trang chủ cá nhân', icon: 'dashboard', section: 'Cá nhân', personal: true },
  { path: '/my-attendance', label: 'Bảng công cá nhân', icon: 'clock', section: 'Cá nhân', personal: true },
  { path: '/my-schedules', label: 'Lịch ca & Phân công', icon: 'calendar', section: 'Cá nhân', personal: true },
  { path: '/my-activity', label: 'Nhật ký làm việc', icon: 'chart', section: 'Cá nhân', personal: true },
  { path: '/my-projects', label: 'Dự án của tôi', icon: 'briefcase', section: 'Cá nhân', personal: true },
  { path: '/my-payroll', label: 'Lương & Hợp đồng', icon: 'wallet', section: 'Cá nhân', personal: true },
  { path: '/my-leave', label: 'Đơn nghỉ phép', icon: 'leave', section: 'Đơn từ của tôi', personal: true },
  { path: '/my-overtime', label: 'Đơn OT', icon: 'clock', section: 'Đơn từ của tôi', personal: true },
  { path: '/my-resignation', label: 'Đơn thôi việc', icon: 'clipboardList', section: 'Đơn từ của tôi', personal: true },
  { path: '/admin/account', label: 'Tài khoản cá nhân', icon: 'user', section: 'Tài khoản' },
]

function MaintenancePage() {
  const [busy, setBusy] = useState(false)
  const [lastResult, setLastResult] = useState<string | null>(null)
  const [backingUp, setBackingUp] = useState(false)

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

  const backup = async () => {
    if (!(await confirmAction('Tải bản sao lưu toàn bộ database? File chứa dữ liệu nhạy cảm (lương, CCCD, tài khoản ngân hàng, mật khẩu đã băm) — chỉ lưu ở nơi an toàn.'))) return
    setBackingUp(true)
    try {
      const blob = await adminApi.backupDatabase()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `techzone_hrm_backup_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}.sql`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Đã tải bản sao lưu')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sao lưu thất bại')
    } finally {
      setBackingUp(false)
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
      <div className="card" style={{ padding: 16, marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <strong>Sao lưu database</strong>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
            Tải file .sql (schema public: cấu trúc, dữ liệu, procedure, view). Khôi phục thủ công bằng psql.
          </p>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={backup} disabled={backingUp}>
          {Icons.download} {backingUp ? 'Đang sao lưu…' : 'Tải bản sao lưu'}
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
  onCheckIn: () => void
  onCheckOut: () => void
  attendanceLoading: boolean
}

/**
 * Module quản trị hệ thống. Phần "Cá nhân" cho phép ADMIN dùng các trang tự phục vụ như một nhân viên:
 * backend đổi ADMIN thành EMPLOYEE ở router nghiệp vụ (staff_scope), frontend làm tương tự bằng StaffScope.
 */
export function AdminApp({ user, onLogout, theme, onToggleTheme, onCheckIn, onCheckOut, attendanceLoading }: AdminAppProps) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const staffUser = useMemo(() => ({ ...user, roles: toStaffRoles(user?.roles || []) }), [user])
  // Trang cá nhân cần tài khoản gắn hồ sơ nhân viên; admin thuần chỉ có Tài khoản cá nhân.
  const nav = NAV.filter(item => !item.personal || Boolean(user?.employee_id))
  const sections = [...new Set(nav.map(n => n.section))]
  const title = nav.find(n => n.path === pathname)?.label || 'Quản trị hệ thống'
  const staff = (page: React.ReactNode) => user?.employee_id ? <StaffScope>{page}</StaffScope> : <Navigate to="/admin/account" replace />

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
          {sections.map(section => (
          <div key={section} className="nav-section">
            <div className="nav-section-title">{section}</div>
            {nav.filter(item => item.section === section).map(item => (
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
          ))}
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
          <div className="topbar-user" role="button" tabIndex={0} onClick={() => go('/admin/account')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') go('/admin/account') }} title="Tài khoản cá nhân">
            {user?.avatar_url
              ? <img src={user.avatar_url} alt="" className="user-avatar-img" />
              : <div className="user-avatar">{getInitials(user?.full_name || user?.username)}</div>}
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
            <Route path="/admin/account" element={<StaffScope><AccountPage user={staffUser} /></StaffScope>} />
            <Route path="/account" element={<Navigate to="/admin/account" replace />} />
            <Route path="/admin/home" element={staff(<OverviewPage user={staffUser} onCheckIn={onCheckIn} onCheckOut={onCheckOut} attendanceLoading={attendanceLoading} />)} />
            <Route path="/my-attendance" element={staff(<AttendancePage key="personal" user={staffUser} personal />)} />
            <Route path="/my-schedules" element={staff(<PersonalSchedulesPage />)} />
            <Route path="/my-activity" element={staff(<ActivityPage user={staffUser} personal />)} />
            <Route path="/my-projects" element={staff(<ProjectsPage personal />)} />
            <Route path="/my-payroll" element={staff(<MyPayslipPage user={staffUser} employeeId={user?.employee_id || undefined} />)} />
            <Route path="/my-contracts" element={<Navigate to="/my-payroll?tab=contracts" replace />} />
            <Route path="/my-leave" element={staff(<LeaveRequestsPage user={staffUser} personal />)} />
            <Route path="/my-overtime" element={staff(<OvertimeRequestsPage user={staffUser} personal />)} />
            <Route path="/my-resignation" element={staff(<MyResignationPage />)} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </ErrorBoundary>
      </main>
    </div>
  )
}
