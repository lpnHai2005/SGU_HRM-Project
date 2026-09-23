import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { authApi } from '../services/api'
import { Icons } from '../components/common/Icons'
import type { TestAccountResponse } from '../types'

export interface LoginPageProps {
  onLogin: () => void
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [testAccounts, setTestAccounts] = useState<TestAccountResponse[]>([])
  const [showTestAccounts, setShowTestAccounts] = useState(true)

  useEffect(() => {
    authApi
      .getTestAccounts()
      .then(setTestAccounts)
      .catch(() => setShowTestAccounts(false))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      await login(username, password)
      onLogin()
    } catch (err: any) {
      setError(err.message || 'Đăng nhập thất bại')
    } finally {
      setIsLoading(false)
    }
  }

  const quickLogin = async (testUsername: string) => {
    setUsername(testUsername)
    setPassword('123456')
    setError('')
    setIsLoading(true)

    try {
      await login(testUsername, '123456')
      onLogin()
    } catch (err: any) {
      setError(err.message || 'Đăng nhập thất bại')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <div className="login-logo">{Icons.techzone}</div>
            <h1 className="login-title">TechZone HRM</h1>
            <p className="login-subtitle">Hệ thống Quản trị Nguồn nhân lực & Bán lẻ</p>
          </div>

          <form className="login-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label" htmlFor="username">Tài khoản nhân sự</label>
              <input
                type="text"
                id="username"
                className="form-input"
                placeholder="Nhập tên đăng nhập hoặc mã NV"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                disabled={isLoading}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="password">Mật khẩu xác thực</label>
              <input
                type="password"
                id="password"
                className="form-input"
                placeholder="Nhập mật khẩu"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={isLoading}
              />
            </div>

            {error && (
              <div className="alert alert-error" style={{ marginBottom: '14px' }}>
                {Icons.alertCircle}
                <span>{error}</span>
              </div>
            )}

            <button type="submit" className="btn btn-primary login-submit-btn" disabled={isLoading}>
              {isLoading ? 'Đang xác thực hệ thống...' : 'Đăng nhập Cổng Doanh nghiệp'}
            </button>
          </form>

          {showTestAccounts && testAccounts.length > 0 && (
            <div className="login-quick-access">
              <p className="login-quick-access-title">Tài khoản demo kiểm thử vai trò</p>
              <div className="quick-access-grid">
                {testAccounts.slice(0, 4).map((account) => (
                  <button
                    key={account.username}
                    className="quick-access-btn"
                    onClick={() => quickLogin(account.username)}
                    disabled={isLoading}
                  >
                    <span className="role">{account.username}</span>
                    <span className="desc">{account.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="login-footer-notice">
            TechZone Enterprise HRM v2.4 • Mọi truy cập đều được ghi nhật ký bảo mật
          </div>
        </div>
      </div>
    </div>
  )
}
