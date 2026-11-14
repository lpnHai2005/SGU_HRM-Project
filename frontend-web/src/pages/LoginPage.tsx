import { useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { Icons } from '../components/common/Icons'
import { IDLE_LOGOUT_FLAG } from '../utils/idleWatch'

export interface LoginPageProps {
  onLogin: () => void
  portal?: 'staff' | 'admin'
}

function getLoginErrorMessage(error: unknown): string {
  if (error instanceof TypeError) {
    return 'Không thể kết nối máy chủ. Kiểm tra mạng và cấu hình địa chỉ API của môi trường đang dùng.'
  }
  return error instanceof Error && error.message ? error.message : 'Đăng nhập thất bại'
}

export function LoginPage({ onLogin, portal = 'staff' }: LoginPageProps) {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
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
      await login(username, password, portal)
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
            <h1 className="login-title">{portal === 'admin' ? 'TechZone HRM · Quản trị hệ thống' : 'TechZone HRM'}</h1>
            <p className="login-subtitle">{portal === 'admin' ? 'Cổng dành riêng cho Quản trị viên' : 'Hệ thống Quản trị Nguồn nhân lực & Bán lẻ'}</p>
          </div>

          <form className="login-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label" htmlFor="username">{portal === 'admin' ? 'Tài khoản quản trị' : 'Tài khoản nhân sự'}</label>
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
              <div className="login-password-field">
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  className="form-input"
                  placeholder="Nhập mật khẩu"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  disabled={isLoading}
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  aria-pressed={showPassword}
                  disabled={isLoading}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
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
