import { useEffect, useState, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../contexts/AuthContext'
import { authApi, api } from '../services/api'
import { Icons } from '../components/common/Icons'
import { ROLE_LABELS } from '../constants/navigation'
import { getInitials, getRoleFromUser, getRoleBadgeClass, formatTime } from '../utils/formatters'
import { PersonalSchedulesPage } from './PersonalSchedulesPage'
import { assignedShift } from '../services/assignedShift'
import type { TodayAttendanceStatus, UserProfile } from '../types'
import {
  Camera,
  Upload,
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
  UserCheck,
  RefreshCw,
  Building2,
  Mail,
  Phone,
  MapPin,
  Clock,
  Sparkles,
  CheckCircle2,
  AlertCircle
} from 'lucide-react'
import './AccountPage.css'

interface AccountPageProps {
  user: any
}

type TabType = 'overview' | 'avatar' | 'security' | 'schedule'

export function AccountPage({ user }: AccountPageProps) {
  const { refreshUser } = useAuth()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabType>('overview')

  // Avatar state
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [avatarFileName, setAvatarFileName] = useState<string>('')
  const [avatarFileSize, setAvatarFileSize] = useState<number>(0)
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
  const [isDragActive, setIsDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Password state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [isChangingPassword, setIsChangingPassword] = useState(false)

  // Shift & Attendance state
  const [today, setToday] = useState<TodayAttendanceStatus | null>(null)
  const [shift, setShift] = useState<Awaited<ReturnType<typeof assignedShift>>>(null)

  // Load Profile and Attendance Info
  const loadProfile = async () => {
    setIsLoading(true)
    try {
      const data = await authApi.getMe()
      setProfile(data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không tải được thông tin tài khoản')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadProfile()
  }, [])

  useEffect(() => {
    let isSubscribed = true
    Promise.all([
      api.get<TodayAttendanceStatus>('/attendances/today-status').catch(() => null),
      assignedShift().catch(() => null)
    ]).then(([statusRes, shiftRes]) => {
      if (isSubscribed) {
        setToday(statusRes)
        setShift(shiftRes)
      }
    })
    return () => {
      isSubscribed = false
    }
  }, [])

  const p = profile || user || {}
  const role = getRoleFromUser(p)

  // ==========================================
  // AVATAR HANDLING (Base64 & Image Preview)
  // ==========================================
  const handleFileChange = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Vui lòng chọn tệp hình ảnh hợp lệ (PNG, JPG, WebP)')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Dung lượng hình ảnh vượt quá giới hạn 5MB')
      return
    }

    setAvatarFileName(file.name)
    setAvatarFileSize(file.size)

    // Đọc ảnh thành chuỗi Data URL Base64 để preview và gửi lên backend
    const reader = new FileReader()
    reader.onload = (e) => {
      if (typeof e.target?.result === 'string') {
        setAvatarPreview(e.target.result)
      }
    }
    reader.readAsDataURL(file)
  }

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFileChange(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragActive(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFileChange(file)
  }

  const handleSaveAvatar = async () => {
    if (!avatarPreview) {
      toast.warning('Vui lòng chọn ảnh trước khi bấm lưu')
      return
    }

    setIsUploadingAvatar(true)
    try {
      // Gửi chuỗi base64 ảnh lên backend giải mã và lưu trữ qua storage
      const res = await authApi.uploadAvatar({ avatar_base64: avatarPreview })
      toast.success(res.message || 'Cập nhật ảnh đại diện thành công!')

      // Cập nhật lại state cục bộ và state toàn cục trong AuthContext
      setAvatarPreview(null)
      await loadProfile()
      await refreshUser()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không cập nhật được ảnh đại diện')
    } finally {
      setIsUploadingAvatar(false)
    }
  }

  const handleCancelAvatar = () => {
    setAvatarPreview(null)
    setAvatarFileName('')
    setAvatarFileSize(0)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ==========================================
  // PASSWORD HANDLING
  // ==========================================
  const passwordStrength = useMemo(() => {
    if (!newPassword) return { score: 0, text: '', color: 'transparent', percent: 0 }
    let score = 0
    if (newPassword.length >= 6) score += 1
    if (newPassword.length >= 8) score += 1
    if (/[A-Z]/.test(newPassword) && /[a-z]/.test(newPassword)) score += 1
    if (/[0-9]/.test(newPassword)) score += 1
    if (/[^A-Za-z0-9]/.test(newPassword)) score += 1

    if (score <= 1) return { score: 1, text: 'Rất yếu', color: '#ef4444', percent: 25 }
    if (score === 2) return { score: 2, text: 'Yếu', color: '#f97316', percent: 50 }
    if (score === 3) return { score: 3, text: 'Khá tốt', color: '#eab308', percent: 75 }
    return { score: 4, text: 'Rất mạnh', color: '#10b981', percent: 100 }
  }, [newPassword])

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!currentPassword) {
      toast.warning('Vui lòng nhập mật khẩu hiện tại')
      return
    }
    if (newPassword.length < 6) {
      toast.warning('Mật khẩu mới phải có ít nhất 6 ký tự')
      return
    }
    if (newPassword.trim() !== newPassword) {
      toast.warning('Mật khẩu không được chứa khoảng trắng ở đầu hoặc cuối')
      return
    }
    if (newPassword === currentPassword) {
      toast.warning('Mật khẩu mới phải khác mật khẩu hiện tại')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.warning('Xác nhận mật khẩu mới không trùng khớp')
      return
    }

    setIsChangingPassword(true)
    try {
      const res = await authApi.changePassword(currentPassword, newPassword)
      toast.success(res.message || 'Đổi mật khẩu thành công!')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Đổi mật khẩu thất bại')
    } finally {
      setIsChangingPassword(false)
    }
  }

  return (
    <div className="page-container account-page-container">
      {/* 1. HERO PROFILE CARD */}
      <div className="account-hero-card">
        <div className="account-hero-backdrop" />

        <div className="account-hero-content">
          <div className="account-hero-left">
            {/* Avatar Circle */}
            <div
              className="account-avatar-wrapper"
              onClick={() => {
                setActiveTab('avatar')
                fileInputRef.current?.click()
              }}
              title="Nhấp để đổi ảnh đại diện"
            >
              {p.avatar_url ? (
                <img src={p.avatar_url} alt={p.full_name || p.username} className="account-avatar-img" />
              ) : (
                <div className="account-avatar-initials">
                  {getInitials(p.full_name || p.username)}
                </div>
              )}
              <div className="account-avatar-overlay-btn">
                <Camera size={13} />
                <span>Đổi ảnh</span>
              </div>
            </div>

            {/* User Meta Information */}
            <div className="account-hero-meta">
              <h1 className="account-hero-name">{p.full_name || p.username}</h1>
              <div className="account-hero-badges">
                <span className={`role-badge ${getRoleBadgeClass(role)}`}>
                  {ROLE_LABELS[role]}
                </span>
                {p.employee_code && (
                  <span className="account-code-pill">
                    Mã NV: {p.employee_code}
                  </span>
                )}
                <span className="account-pill-status">
                  <span className="account-status-dot" />
                  Đang hoạt động
                </span>
              </div>

              <div className="account-hero-quickinfo">
                {p.email && (
                  <span className="account-quickinfo-item">
                    <Mail size={13} /> {p.email}
                  </span>
                )}
                {p.phone && (
                  <span className="account-quickinfo-item">
                    <Phone size={13} /> {p.phone}
                  </span>
                )}
                {p.store_name && (
                  <span className="account-quickinfo-item">
                    <MapPin size={13} /> {p.store_name}
                  </span>
                )}
                {p.department_name && (
                  <span className="account-quickinfo-item">
                    <Building2 size={13} /> {p.department_name}
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={loadProfile}
            disabled={isLoading}
            title="Làm mới thông tin"
          >
            <RefreshCw size={14} className={isLoading ? 'spin' : ''} />
            Làm mới
          </button>
        </div>
      </div>

      {/* 2. TAB NAVIGATION */}
      <div className="account-nav-tabs">
        <button
          type="button"
          className={`account-tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <UserCheck size={16} />
          Thông tin tài khoản
        </button>

        <button
          type="button"
          className={`account-tab-btn ${activeTab === 'avatar' ? 'active' : ''}`}
          onClick={() => setActiveTab('avatar')}
        >
          <Camera size={16} />
          Đổi ảnh đại diện
        </button>

        <button
          type="button"
          className={`account-tab-btn ${activeTab === 'security' ? 'active' : ''}`}
          onClick={() => setActiveTab('security')}
        >
          <ShieldCheck size={16} />
          Đổi mật khẩu
        </button>

        {p.employee_id && (
          <button
            type="button"
            className={`account-tab-btn ${activeTab === 'schedule' ? 'active' : ''}`}
            onClick={() => setActiveTab('schedule')}
          >
            <Clock size={16} />
            Ca & Giờ công hôm nay
          </button>
        )}
      </div>

      {/* 3. TAB 1: OVERVIEW & PROFILE INFO */}
      {activeTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Card: Hồ sơ nhân sự */}
          <div className="account-card">
            <div className="account-card-header">
              <h2 className="account-card-title">Hồ sơ Nhân sự & Đơn vị công tác</h2>
              <p className="account-card-desc">Thông tin hồ sơ nhân viên được đồng bộ từ phòng Nhân sự.</p>
            </div>

            <div className="account-fields-grid">
              <div className="account-field-item">
                <span className="account-field-label">Mã nhân viên</span>
                <span className="account-field-value">{p.employee_code || 'Chưa liên kết'}</span>
              </div>
              <div className="account-field-item">
                <span className="account-field-label">Họ và tên</span>
                <span className="account-field-value">{p.full_name || p.username}</span>
              </div>
              <div className="account-field-item">
                <span className="account-field-label">Phòng ban</span>
                <span className="account-field-value">{p.department_name || 'Khối vận hành'}</span>
              </div>
              <div className="account-field-item">
                <span className="account-field-label">Chức danh / Vị trí</span>
                <span className="account-field-value">{p.position_name || 'Nhân sự TechZone'}</span>
              </div>
              <div className="account-field-item">
                <span className="account-field-label">Cửa hàng chi nhánh</span>
                <span className="account-field-value">{p.store_name || 'Văn phòng trụ sở'}</span>
              </div>
              <div className="account-field-item">
                <span className="account-field-label">Số điện thoại liên hệ</span>
                <span className="account-field-value">{p.phone || 'Chưa cập nhật'}</span>
              </div>
            </div>

            {p.employee_id && (
              <div style={{ marginTop: 20, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Link className="btn btn-secondary btn-sm" to="/my-payroll">
                  {Icons.wallet} Xem phiếu lương của tôi
                </Link>
                <Link className="btn btn-secondary btn-sm" to="/my-attendance">
                  Xem bảng công cá nhân
                </Link>
              </div>
            )}
          </div>

          {/* Card: Tài khoản & Bảo mật hệ thống */}
          <div className="account-card">
            <div className="account-card-header">
              <h2 className="account-card-title">Thông tin Đăng nhập & Quyền hạn</h2>
              <p className="account-card-desc">Thông tin tài khoản xác thực định danh trong chuỗi cửa hàng.</p>
            </div>

            <div className="account-fields-grid">
              <div className="account-field-item">
                <span className="account-field-label">Tên đăng nhập (Username)</span>
                <span className="account-field-value">{p.username}</span>
              </div>
              <div className="account-field-item">
                <span className="account-field-label">Email tài khoản</span>
                <span className="account-field-value">{p.email || 'Chưa cập nhật'}</span>
              </div>
              <div className="account-field-item">
                <span className="account-field-label">Mã định danh User ID</span>
                <span className="account-field-value">#{p.user_id}</span>
              </div>
              <div className="account-field-item">
                <span className="account-field-label">Vai trò truy cập</span>
                <span className="account-field-value">{ROLE_LABELS[role]}</span>
              </div>
            </div>

            {p.permissions && p.permissions.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <span className="account-field-label" style={{ display: 'block', marginBottom: 8 }}>
                  Danh mục chức năng được phân quyền ({p.permissions.length} quyền)
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 160, overflowY: 'auto' }}>
                  {p.permissions.map((perm: string) => (
                    <span
                      key={perm}
                      style={{
                        padding: '3px 8px',
                        background: 'var(--surface-subtle)',
                        borderRadius: 6,
                        fontSize: 11,
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      {perm}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. TAB 2: UPLOAD AVATAR */}
      {activeTab === 'avatar' && (
        <div className="account-card">
          <div className="account-card-header">
            <h2 className="account-card-title">Thay đổi Ảnh đại diện (Avatar)</h2>
            <p className="account-card-desc">
              Hỗ trợ tải lên ảnh trực tiếp hoặc qua chuỗi Base64. Hình ảnh sẽ được giải mã và lưu trữ an toàn, tự động đồng bộ trên toàn hệ thống.
            </p>
          </div>

          <input
            type="file"
            ref={fileInputRef}
            onChange={onFileInputChange}
            accept="image/png,image/jpeg,image/webp"
            style={{ display: 'none' }}
          />

          <div className="avatar-upload-grid">
            {/* Cột trái: Trình chọn & Kéo thả ảnh */}
            <div>
              <div
                className={`avatar-dropzone ${isDragActive ? 'drag-active' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault()
                  setIsDragActive(true)
                }}
                onDragLeave={() => setIsDragActive(false)}
                onDrop={handleDrop}
              >
                <div className="avatar-dropzone-icon">
                  <Upload size={24} />
                </div>
                <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                  Kéo thả ảnh vào đây hoặc nhấp để chọn tệp
                </h3>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                  Hỗ trợ định dạng JPG, PNG hoặc WebP. Dung lượng tối đa 5MB.
                </p>

                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ marginTop: 16 }}
                  onClick={(e) => {
                    e.stopPropagation()
                    fileInputRef.current?.click()
                  }}
                >
                  <Camera size={14} /> Chọn ảnh từ máy tính
                </button>
              </div>

              {avatarFileName && (
                <div
                  style={{
                    marginTop: 12,
                    padding: '8px 14px',
                    borderRadius: 8,
                    background: 'var(--surface-subtle)',
                    fontSize: 12,
                    color: 'var(--text-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>📁 {avatarFileName} ({(avatarFileSize / 1024).toFixed(1)} KB)</span>
                  <span style={{ color: '#10b981', fontWeight: 600 }}>✓ Đã mã hóa Base64 sẵn sàng</span>
                </div>
              )}
            </div>

            {/* Cột phải: Xem trước (Live Preview) */}
            <div className="avatar-preview-box">
              <span className="account-field-label" style={{ marginBottom: 12 }}>
                {avatarPreview ? 'Xem trước ảnh đại diện mới' : 'Ảnh đại diện hiện tại'}
              </span>

              <div className="avatar-preview-frame">
                {avatarPreview ? (
                  <img src={avatarPreview} alt="Preview Avatar" />
                ) : p.avatar_url ? (
                  <img src={p.avatar_url} alt={p.full_name || p.username} />
                ) : (
                  <div className="account-avatar-initials" style={{ width: '100%', height: '100%' }}>
                    {getInitials(p.full_name || p.username)}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                {avatarPreview && (
                  <>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={handleSaveAvatar}
                      disabled={isUploadingAvatar}
                    >
                      <Sparkles size={14} />
                      {isUploadingAvatar ? 'Đang tải lên...' : 'Lưu ảnh đại diện'}
                    </button>

                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={handleCancelAvatar}
                      disabled={isUploadingAvatar}
                    >
                      Hủy chọn
                    </button>
                  </>
                )}
                {!avatarPreview && p.avatar_url && (
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-tertiary)' }}>
                    Ảnh đại diện đã được lưu trữ an toàn. Nhấp "Chọn ảnh từ máy tính" để thay đổi.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. TAB 3: CHANGE PASSWORD */}
      {activeTab === 'security' && (
        <div className="account-card">
          <div className="account-card-header">
            <h2 className="account-card-title">Đổi mật khẩu tài khoản</h2>
            <p className="account-card-desc">
              Để bảo vệ an toàn cho dữ liệu cửa hàng, vui lòng sử dụng mật khẩu mạnh kết hợp chữ hoa, chữ thường và chữ số.
            </p>
          </div>

          <form onSubmit={handleChangePassword} className="account-form">
            {/* Mật khẩu hiện tại */}
            <div className="account-form-group">
              <label htmlFor="currentPassword">Mật khẩu hiện tại</label>
              <div className="password-input-container">
                <input
                  id="currentPassword"
                  type={showCurrent ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Nhập mật khẩu bạn đang dùng"
                  required
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowCurrent(!showCurrent)}
                  tabIndex={-1}
                  aria-label="Toggle password visibility"
                >
                  {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Mật khẩu mới */}
            <div className="account-form-group">
              <label htmlFor="newPassword">Mật khẩu mới</label>
              <div className="password-input-container">
                <input
                  id="newPassword"
                  type={showNew ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Tối thiểu 6 ký tự"
                  required
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowNew(!showNew)}
                  tabIndex={-1}
                  aria-label="Toggle password visibility"
                >
                  {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              {/* Strength Meter */}
              {newPassword && (
                <div className="password-strength-wrap">
                  <div className="password-strength-track">
                    <div
                      className="password-strength-fill"
                      style={{
                        width: `${passwordStrength.percent}%`,
                        backgroundColor: passwordStrength.color,
                      }}
                    />
                  </div>
                  <div className="password-strength-text" style={{ color: passwordStrength.color }}>
                    <span>Độ bảo mật: {passwordStrength.text}</span>
                    <span>{passwordStrength.percent}%</span>
                  </div>
                </div>
              )}
            </div>

            {/* Xác nhận mật khẩu mới */}
            <div className="account-form-group">
              <label htmlFor="confirmPassword">Xác nhận mật khẩu mới</label>
              <div className="password-input-container">
                <input
                  id="confirmPassword"
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Nhập lại mật khẩu mới"
                  required
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowConfirm(!showConfirm)}
                  tabIndex={-1}
                  aria-label="Toggle password visibility"
                >
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {confirmPassword && newPassword !== confirmPassword && (
                <span style={{ fontSize: 12, color: '#ef4444', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <AlertCircle size={12} /> Mật khẩu xác nhận không khớp
                </span>
              )}
              {confirmPassword && newPassword === confirmPassword && (
                <span style={{ fontSize: 12, color: '#10b981', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <CheckCircle2 size={12} /> Mật khẩu xác nhận đã trùng khớp
                </span>
              )}
            </div>

            <div style={{ marginTop: 10 }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isChangingPassword}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                <KeyRound size={16} />
                {isChangingPassword ? 'Đang xử lý...' : 'Xác nhận cập nhật mật khẩu'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 6. TAB 4: WORK SHIFT & ATTENDANCE TODAY */}
      {activeTab === 'schedule' && p.employee_id && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="account-card">
            <div className="account-card-header">
              <h2 className="account-card-title">Ca và giờ công hôm nay</h2>
              <p className="account-card-desc">Theo dõi phiên làm việc thực tế và trạng thái điểm danh trong ngày.</p>
            </div>

            <div className="account-fields-grid">
              <div className="account-field-item">
                <span className="account-field-label">Ca phân công</span>
                <span className="account-field-value">{shift?.shift_name || 'Chưa phân ca'}</span>
              </div>
              <div className="account-field-item">
                <span className="account-field-label">Cửa hàng làm việc</span>
                <span className="account-field-value">{shift?.store_name || p.store_name || 'Chưa có'}</span>
              </div>
              <div className="account-field-item">
                <span className="account-field-label">Khung giờ ca</span>
                <span className="account-field-value">
                  {shift ? `${shift.start_time.slice(0, 5)} – ${shift.end_time.slice(0, 5)}` : 'Chưa có'}
                </span>
              </div>
              <div className="account-field-item">
                <span className="account-field-label">Trạng thái vào / ra</span>
                <span className="account-field-value">
                  {today?.can_check_out
                    ? '🟢 Đã vào ca (Đang làm)'
                    : today?.has_checked_out
                    ? '⚪ Đã ra ca (Hoàn thành)'
                    : '🟡 Chưa vào ca'}
                </span>
              </div>
              <div className="account-field-item">
                <span className="account-field-label">Thời điểm Check-in</span>
                <span className="account-field-value">
                  {today?.check_in_time ? formatTime(today.check_in_time) : 'Chưa điểm danh'}
                </span>
              </div>
              <div className="account-field-item">
                <span className="account-field-label">Thời điểm Check-out</span>
                <span className="account-field-value">
                  {today?.check_out_time ? formatTime(today.check_out_time) : 'Chưa điểm danh'}
                </span>
              </div>
              <div className="account-field-item">
                <span className="account-field-label">Số giờ công thực tế</span>
                <span className="account-field-value">
                  {today?.actual_work_hours !== undefined ? `${today.actual_work_hours} giờ` : '0 giờ'}
                </span>
              </div>
            </div>

            <div style={{ marginTop: 20, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Link className="btn btn-secondary btn-sm" to="/my-attendance">
                Xem chi tiết bảng công cá nhân
              </Link>
              <Link className="btn btn-secondary btn-sm" to="/my-schedules">
                Xem lịch ca làm việc tuần này
              </Link>
            </div>
          </div>

          <PersonalSchedulesPage />
        </div>
      )}
    </div>
  )
}
export default AccountPage
