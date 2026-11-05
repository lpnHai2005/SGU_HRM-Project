import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Icons } from '../components/common/Icons'
import { IDLE_LOGOUT_FLAG } from '../utils/idleWatch'

export interface LoginPageProps {
  onLogin: () => void
}

function getLoginErrorMessage(error: unknown): string {
  if (error instanceof TypeError) {
    return 'Không thể kết nối máy chủ. Kiểm tra mạng và cấu hình địa chỉ API của môi trường đang dùng.'
  }
  return error instanceof Error && error.message ? error.message : 'Đăng nhập thất bại'
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(() =>
    sessionStorage.getItem(IDLE_LOGOUT_FLAG) ? 'Phiên đăng nhập đã kết thúc do không hoạt động. Vui lòng đăng nhập lại.' : ''
  )
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    sessionStorage.removeItem(IDLE_LOGOUT_FLAG)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      await login(username, password)
      onLogin()
    } catch (err: any) {
      setError(getLoginErrorMessage(err))
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

          <div className="login-footer-notice">
            TechZone Enterprise HRM v2.5 • Mọi truy cập đều được ghi nhật ký bảo mật
          </div>
        </div>
      </div>
    </div>
  )
}
