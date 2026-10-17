import { AccountPage } from './pages/AccountPage'
import { MonthlyAttendancePage } from './pages/MonthlyAttendancePage'
import { StoresPage } from './pages/StoreManagementPage'
import { toast } from 'sonner'
import { Toaster } from 'sonner'
import { ActivityPage } from './pages/ActivityPage'
import { PersonalSchedulesPage } from './pages/PersonalSchedulesPage'
import { assignedShift } from './services/assignedShift'
import { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import './App.css'
import { useAuth } from './contexts/AuthContext'
import { Icons } from './components/common/Icons'
import { Sidebar } from './components/layout/Sidebar'
import { Topbar } from './components/layout/Topbar'
import { BottomNav } from './components/layout/BottomNav'
import { getRoleFromUser } from './utils/formatters'
import { canAccessPath } from './constants/navigation'
import { UserAccessPage } from './pages/UserAccessPage'
import { SalesCommissionPage } from './pages/SalesCommissionPage'
import { MyPayslipPage } from './pages/MyPayslipPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { ContractsMovementPage } from './pages/ContractsMovementPage'
import { ContractManagementPage } from './pages/ContractManagementPage'
import { ResignationManagementPage } from './pages/ResignationManagementPage'
import { PayrollFundPage } from './pages/PayrollFundPage'
import { PayrollSettlementsPage } from './pages/PayrollSettlementsPage'

// Pages
import { LoginPage } from './pages/LoginPage'
import { OverviewPage } from './pages/OverviewPage'
import { EmployeeListPage } from './pages/EmployeeListPage'
import { AttendancePage } from './pages/AttendancePage'
import { LeaveRequestsPage } from './pages/LeaveRequestsPage'
import { PayrollPage } from './pages/PayrollPage'
import { ReportsPage } from './pages/ReportsPage'
import { AuditLogPage } from './pages/AuditLogPage'
import { WorkSchedulesPage } from './pages/WorkSchedulesPage'

// ProtectedRoute: chặn EMPLOYEE truy cập các trang quản lý
function ProtectedRoute({ children, path }: { children: React.ReactNode; path: string }) {
  const { user } = useAuth()
  if (!canAccessPath(path, user)) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        gap: '16px',
        padding: '24px',
        textAlign: 'center',
      }}>
        <div>{Icons.lock}</div>
        <h2 style={{ margin: 0, fontSize: '20px' }}>Không có quyền truy cập</h2>
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
          Bạn không có quyền truy cập trang này. Vui lòng liên hệ quản trị viên.
        </p>
      </div>
    )
  }
  return <>{children}</>
}

export function App() {
  const { user, isAuthenticated, isLoading, logout } = useAuth()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [attendanceLoading, setAttendanceLoading] = useState(false)

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('techzone_theme') as 'light' | 'dark') || 'light'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('techzone_theme', theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'))
  }

  const handleLogin = () => {
    // Handled automatically by AuthProvider state
  }

  const handleLogout = async () => {
    await logout()
  }

  const handleCheckIn = async () => {
    setAttendanceLoading(true)
    try {
      const { attendanceApi } = await import('./services/api')
      const shift = await assignedShift()
      if (!shift) throw new Error('Chưa có ca được phân công phù hợp. Liên hệ quản lý.')
      const result = await attendanceApi.checkIn({ shift_id: shift.shift_id })
      toast(result.message)
    } catch (err: any) {
      toast(err.message || 'Check-in thất bại')
    } finally {
      setAttendanceLoading(false)
    }
  }

  const handleCheckOut = async () => {
    setAttendanceLoading(true)
    try {
      const { attendanceApi } = await import('./services/api')
      const result = await attendanceApi.checkOut({})
      toast(result.message)
    } catch (err: any) {
      toast(err.message || 'Check-out thất bại')
    } finally {
      setAttendanceLoading(false)
    }
  }

  if (isLoading) {
    return (
      <div className="login-page">
        <div className="login-container">
          <div style={{ textAlign: 'center', padding: '60px' }}>
            <div style={{ fontSize: '32px', marginBottom: '16px' }}>{Icons.techzone}</div>
            <p>Đang tải hệ thống TechZone...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage onLogin={handleLogin} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  const userRole = getRoleFromUser(user)

  return (
    <div className="app-layout"><Toaster richColors closeButton theme={theme} position="top-right" />
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        role={userRole}
        user={user}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />
      <Topbar
        user={user}
        onLogout={handleLogout}
        theme={theme}
        onToggleTheme={toggleTheme}
        onToggleMobileMenu={() => setMobileMenuOpen(prev => !prev)}
      />
      <main className="main-content">
        <Routes>
          <Route
            path="/"
            element={
              <OverviewPage
                user={user}
                onCheckIn={handleCheckIn}
                onCheckOut={handleCheckOut}
                attendanceLoading={attendanceLoading}
              />
            }
          />
          <Route path="/dashboard" element={<Navigate to="/" replace />} />
          <Route path="/account" element={<AccountPage user={user}/>} />
          <Route path="/stores" element={<ProtectedRoute path="/stores"><StoresPage/></ProtectedRoute>} />
          <Route path="/users" element={<ProtectedRoute path="/users"><UserAccessPage currentUserId={user!.user_id} /></ProtectedRoute>} />
          <Route path="/employees" element={<ProtectedRoute path="/employees"><EmployeeListPage user={user} /></ProtectedRoute>} />
          <Route path="/contracts" element={<ProtectedRoute path="/contracts"><ContractManagementPage user={user} /></ProtectedRoute>} />
          <Route path="/resignations" element={<ProtectedRoute path="/resignations"><ResignationManagementPage user={user} /></ProtectedRoute>} />
          <Route path="/activity" element={<ProtectedRoute path="/activity"><ActivityPage user={user} /></ProtectedRoute>} />
          <Route path="/my-activity" element={<ProtectedRoute path="/my-activity"><ActivityPage user={user} personal /></ProtectedRoute>} />
          <Route path="/my-schedules" element={<ProtectedRoute path="/my-schedules"><PersonalSchedulesPage /></ProtectedRoute>} />
          <Route path="/my-attendance" element={<ProtectedRoute path="/my-attendance"><AttendancePage key="personal" user={user} personal /></ProtectedRoute>} />
          <Route path="/attendance" element={<ProtectedRoute path="/attendance"><MonthlyAttendancePage user={user}/></ProtectedRoute>} />
          <Route path="/work-schedules" element={<ProtectedRoute path="/work-schedules"><WorkSchedulesPage user={user} /></ProtectedRoute>} />
          <Route path="/leave" element={<LeaveRequestsPage user={user} />} />
          <Route path="/my-leave" element={<ProtectedRoute path="/my-leave"><LeaveRequestsPage user={user} personal /></ProtectedRoute>} />
          <Route path="/payroll" element={<ProtectedRoute path="/payroll"><PayrollPage user={user} /></ProtectedRoute>} />
          <Route path="/payroll-fund" element={<ProtectedRoute path="/payroll-fund"><PayrollFundPage branch={userRole === 'STORE_MANAGER'} /></ProtectedRoute>} />
          <Route path="/settlements" element={<ProtectedRoute path="/settlements"><PayrollSettlementsPage /></ProtectedRoute>} />
          <Route path="/my-payroll" element={<ProtectedRoute path="/my-payroll"><MyPayslipPage user={user} employeeId={user?.employee_id || undefined} /></ProtectedRoute>} />
          <Route path="/my-contracts" element={<Navigate to="/my-payroll?tab=contracts" replace />} />
          <Route path="/sales" element={<ProtectedRoute path="/sales"><SalesCommissionPage /></ProtectedRoute>} />
          <Route path="/projects" element={<ProtectedRoute path="/projects"><ProjectsPage /></ProtectedRoute>} />
          <Route path="/reports" element={<ProtectedRoute path="/reports"><ReportsPage user={user} /></ProtectedRoute>} />
          <Route path="/audit" element={<ProtectedRoute path="/audit"><AuditLogPage user={user} /></ProtectedRoute>} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <BottomNav
        onOpenMenu={() => setMobileMenuOpen(true)}
        user={user}
      />
    </div>
  )
}

export default App
