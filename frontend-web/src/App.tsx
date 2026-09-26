import { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import './App.css'
import { useAuth } from './contexts/AuthContext'
import { Icons } from './components/common/Icons'
import { Sidebar } from './components/layout/Sidebar'
import { Topbar } from './components/layout/Topbar'
import { BottomNav } from './components/layout/BottomNav'
import { getRoleFromUser } from './utils/formatters'

// Pages
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { EmployeeListPage } from './pages/EmployeeListPage'
import { AttendancePage } from './pages/AttendancePage'
import { LeaveRequestsPage } from './pages/LeaveRequestsPage'
import { PayrollPage } from './pages/PayrollPage'
import { ReportsPage } from './pages/ReportsPage'
import { AuditLogPage } from './pages/AuditLogPage'

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
      const result = await attendanceApi.checkIn({ shift_id: 1 })
      alert(result.message)
      window.location.reload()
    } catch (err: any) {
      alert(err.message || 'Check-in thất bại')
    } finally {
      setAttendanceLoading(false)
    }
  }

  const handleCheckOut = async () => {
    setAttendanceLoading(true)
    try {
      const { attendanceApi } = await import('./services/api')
      const result = await attendanceApi.checkOut({})
      alert(result.message)
      window.location.reload()
    } catch (err: any) {
      alert(err.message || 'Check-out thất bại')
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
    <div className="app-layout">
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
              <DashboardPage
                user={user}
                onCheckIn={handleCheckIn}
                onCheckOut={handleCheckOut}
                attendanceLoading={attendanceLoading}
              />
            }
          />
          <Route path="/dashboard" element={<Navigate to="/" replace />} />
          <Route path="/employees" element={<EmployeeListPage user={user} />} />
          <Route path="/attendance" element={<AttendancePage user={user} />} />
          <Route path="/leave" element={<LeaveRequestsPage user={user} />} />
          <Route path="/payroll" element={<PayrollPage user={user} />} />
          <Route path="/reports" element={<ReportsPage user={user} />} />
          <Route path="/audit" element={<AuditLogPage user={user} />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <BottomNav
        onOpenMenu={() => setMobileMenuOpen(true)}
        role={userRole}
      />
    </div>
  )
}

export default App
