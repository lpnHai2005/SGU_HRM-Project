import { toast } from 'sonner'
import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Printer,
  X,
  Clock,
  Calendar,
  AlertTriangle,
  AlertCircle,
  Check,
  Eye,
  ShieldCheck,
  History,
  CheckCircle2,
  HelpCircle,
  AlertOctagon,
  UserCheck,
  MoreVertical,
} from 'lucide-react'
import {
  formatDate,
  formatTime,
  formatDurationMinutes,
  formatCurrency,
  formatQualityFlag,
  formatQualityStatus,
} from '../utils/formatters'
import { api } from '../services/api'

export type TabType = 'ALL' | 'LATE' | 'GRACE' | 'EARLY' | 'REVIEW'
export type DecisionType =
  | 'CONFIRMED_RAW_WORK'
  | 'CONFIRMED_LATE'
  | 'SHIFT_REASSIGNED'
  | 'EXCLUDED_INVALID'
  | 'NEEDS_MORE_INFO'

export interface AuditHistoryEntry {
  version?: number
  action?: string
  decision?: string
  reason?: string
  old_shift_id?: number | null
  new_shift_id?: number | null
  timestamp?: string
  user_id?: number | null
  user_name?: string | null
}

export interface AttendanceSession {
  attendance_id: number
  work_date: string
  shift_id?: number | null
  shift_name?: string | null
  scheduled_start?: string | null
  scheduled_end?: string | null
  scheduled_hours?: number | null
  check_in_time?: string | null
  check_out_time?: string | null
  duration_minutes?: number | null
  raw_duration_minutes?: number | null
  net_duration_minutes?: number | null
  break_minutes?: number | null
  actual_work_hours?: number | null
  late_minutes?: number | null
  early_minutes?: number | null
  outside_hours?: number | null
  is_valid_late?: boolean
  is_grace_late?: boolean
  is_valid_early?: boolean
  is_unreviewed_late?: boolean
  is_unreviewed_early?: boolean
  session_quality_status?: string
  quality_flags?: string[]
  needs_hr_review?: boolean
  is_excluded?: boolean
  review_decision?: string
  review_status?: string
  is_overdue_open_session?: boolean
  payroll_hold?: boolean
  has_verified_ot?: boolean
  verified_ot_hours?: number | null
  ot_request_id?: number | null
  hr_review?: {
    decision?: string
    review_decision?: string
    reason?: string
    resolved_at?: string
    user_id?: number
    user_name?: string
    reviewed_by_name?: string
    reviewed_at?: string
    new_shift_id?: number
    version?: number
  } | null
  audit_history?: AuditHistoryEntry[]
  attendance_context?: {
    actual?: {
      start_time?: string
      end_time?: string
      shift_name?: string
    }
    audit_history?: AuditHistoryEntry[]
  } | null
}

export interface ShiftOption {
  shift_id: number
  shift_name: string
  start_time: string
  end_time: string
  work_hours?: number
}

export interface EmployeeSummary {
  employee_id: number
  employee_code?: string
  employee_name: string
  store_name?: string
  department_name?: string
  late_day_count?: number
  late_session_count?: number
  late_penalty_amount?: number
  verified_late_minutes?: number
  grace_late_session_count?: number
  grace_late_minutes?: number
  early_day_count?: number
  early_session_count?: number
  verified_early_minutes?: number
  unreviewed_early_minutes?: number
  working_days?: number
  actual_work_hours?: number
  scheduled_hours?: number
  needs_review_session_count?: number
  sessions?: AttendanceSession[]
}

interface EmployeeAttendanceDetailModalProps {
  employee: EmployeeSummary
  period: string
  isAdmin?: boolean
  isStoreManager?: boolean
  currentUser?: any
  onClose: () => void
  onOpenPrint: () => void
  onViewRawSession: (session: AttendanceSession) => void
  onSessionResolved?: (updatedSession?: AttendanceSession) => void
}

/**
 * Modern Subcomponent: Dialog xử lý phiên bất thường của HR
 */
export function AttendanceResolutionModal({
  session,
  availableShifts,
  decision,
  reason,
  newShiftId,
  isSubmitting,
  error,
  onDecisionChange,
  onReasonChange,
  onNewShiftIdChange,
  onCancel,
  onSubmit,
}: {
  session: AttendanceSession
  availableShifts: ShiftOption[]
  decision: DecisionType
  reason: string
  newShiftId: number | ''
  isSubmitting: boolean
  error?: string
  onDecisionChange: (d: DecisionType) => void
  onReasonChange: (r: string) => void
  onNewShiftIdChange: (id: number) => void
  onCancel: () => void
  onSubmit: () => void
}) {
  return (
    <div
      className="att-resolve-modal-overlay"
      onClick={e => {
        e.stopPropagation()
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        className="att-resolve-modal"
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
      >
        <div className="att-resolve-modal-header">
          <h3 className="att-resolve-modal-title">
            <ShieldCheck size={18} color="var(--status-info)" />
            <span>Xử lý &amp; Xác minh Phiên Chấm công #{session.attendance_id}</span>
          </h3>
          <button
            type="button"
            className="btn btn-secondary btn-sm att-modal-close-btn"
            onClick={onCancel}
            title="Đóng"
          >
            <X size={15} />
          </button>
        </div>

        <div className="att-resolve-modal-body">
          {/* Thông tin đối chiếu phiên gốc */}
          <div className="att-resolve-session-info">
            <div>
              <div className="att-info-item-label">Ngày làm việc</div>
              <div className="att-info-item-value">{formatDate(session.work_date)}</div>
            </div>
            <div>
              <div className="att-info-item-label">Ca được phân ban đầu</div>
              <div className="att-info-item-value">
                {session.shift_name || 'Chưa có ca'} (
                {session.scheduled_start
                  ? `${session.scheduled_start.slice(0, 5)} - ${session.scheduled_end?.slice(0, 5) || ''}`
                  : '--:--'}
                )
              </div>
            </div>
            <div>
              <div className="att-info-item-label">Check-in → Check-out</div>
              <div className="att-info-item-value">
                {formatTime(session.check_in_time)} →{' '}
                {session.check_out_time ? formatTime(session.check_out_time) : 'Chưa checkout'}
              </div>
            </div>
            <div>
              <div className="att-info-item-label">Lệch giờ thô</div>
              <div className="att-info-item-value">
                Trễ: {session.late_minutes ?? 0}p · Sớm: {session.early_minutes ?? 0}p
              </div>
            </div>
            <div>
              <div className="att-info-item-label">Cờ chất lượng kỹ thuật</div>
              <div
                className={`att-info-item-value ${
                  (session.session_quality_status === 'NORMAL' || !session.session_quality_status) &&
                  (!session.quality_flags || session.quality_flags.length === 0)
                    ? 'is-valid'
                    : 'is-warning'
                }`}
                style={{
                  color:
                    (session.session_quality_status === 'NORMAL' || !session.session_quality_status) &&
                    (!session.quality_flags || session.quality_flags.length === 0)
                      ? 'var(--status-info)'
                      : 'var(--status-warning)',
                }}
              >
                {formatQualityStatus(session.session_quality_status)}
                {session.quality_flags &&
                  session.quality_flags.length > 0 &&
                  ` (${session.quality_flags.map(f => formatQualityFlag(f)).join(', ')})`}
              </div>
            </div>
          </div>

          {/* Cảnh báo phiên mở quá hạn > 7 ngày nếu có */}
          {session.is_overdue_open_session && (
            <div
              style={{
                background: 'var(--status-error-bg)',
                border: '1px solid var(--status-error-border)',
                borderRadius: '8px',
                padding: '10px 14px',
                fontSize: '12px',
                color: 'var(--status-error)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <AlertOctagon size={16} />
              <span>
                <strong>CẢNH BÁO QUÁ HẠN:</strong> Phiên mở chưa checkout quá 7 ngày.
                Hệ thống tự động áp dụng lệnh khóa (HOLD) khỏi tính lương cho đến khi HR xác minh.
              </span>
            </div>
          )}

          {/* Lựa chọn quyết định xác minh của HR */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: 700,
                marginBottom: '8px',
                color: 'var(--text-primary)',
              }}
            >
              Chọn quyết định xử lý của HR{' '}
              <span className="att-required-mark" style={{ color: 'var(--status-error)' }}>
                *
              </span>
            </label>
            <div className="att-decision-cards-grid">
              {/* Quyết định mặc định: xác nhận công thực tế từ dữ liệu thô */}
              <div
                className={`att-decision-card ${decision === 'CONFIRMED_RAW_WORK' ? 'is-selected is-raw-work' : ''}`}
                onClick={() => onDecisionChange('CONFIRMED_RAW_WORK')}
              >
                <div className="att-decision-card-top">
                  <label className="att-decision-radio-label">
                    <input
                      type="radio"
                      name="decision"
                      checked={decision === 'CONFIRMED_RAW_WORK'}
                      onChange={() => onDecisionChange('CONFIRMED_RAW_WORK')}
                    />
                    <span>A. Xác nhận công loại trừ thô</span>
                  </label>
                  <span className="att-review-badge is-raw-work">Ghi nhận công thực tế</span>
                </div>
                <div className="att-decision-desc">
                  HR xác nhận phiên có thời gian làm việc thực tế dù dữ liệu kỹ thuật đang bị gắn cờ.
                </div>
                <div className="att-decision-impact">
                  • Giữ giờ công thực tế để tính ngày công; không tự xác nhận đi trễ, về sớm hợp lệ hoặc OT được duyệt.
                </div>
              </div>

              {/* CONFIRMED_LATE */}
              <div
                className={`att-decision-card ${decision === 'CONFIRMED_LATE' ? 'is-selected' : ''}`}
                onClick={() => onDecisionChange('CONFIRMED_LATE')}
              >
                <div className="att-decision-card-top">
                  <label className="att-decision-radio-label">
                    <input
                      type="radio"
                      name="decision"
                      checked={decision === 'CONFIRMED_LATE'}
                      onChange={() => onDecisionChange('CONFIRMED_LATE')}
                    />
                    <span>B. HR xác nhận đi trễ</span>
                  </label>
                  <span className="att-review-badge is-confirmed-late">Xác nhận vi phạm</span>
                </div>
                <div className="att-decision-desc">
                  Lịch phân ca ban đầu là đúng. Nhân viên vi phạm giờ vào ca làm việc thực tế.
                </div>
                <div className="att-decision-impact">
                  • Giữ nguyên dữ liệu check-in/out gốc. Tính lại số ngày và số lần đi trễ hợp lệ. Không tự động trừ 50.000₫ vào Payroll.
                </div>
              </div>

              {/* SHIFT_REASSIGNED */}
              <div
                className={`att-decision-card ${decision === 'SHIFT_REASSIGNED' ? 'is-selected' : ''}`}
                onClick={() => onDecisionChange('SHIFT_REASSIGNED')}
              >
                <div className="att-decision-card-top">
                  <label className="att-decision-radio-label">
                    <input
                      type="radio"
                      name="decision"
                      checked={decision === 'SHIFT_REASSIGNED'}
                      onChange={() => onDecisionChange('SHIFT_REASSIGNED')}
                    />
                    <span>C. HR xác nhận điều chỉnh ca</span>
                  </label>
                  <span className="att-review-badge is-shift-reassigned">Điều chỉnh phân ca</span>
                </div>
                <div className="att-decision-desc">
                  Nhân viên làm việc theo ca khác có căn cứ hợp lệ (ví dụ đổi ca có phê duyệt).
                </div>

                {decision === 'SHIFT_REASSIGNED' && (
                  <div className="att-shift-select-box" onClick={e => e.stopPropagation()}>
                    <div
                      style={{
                        fontSize: '11.5px',
                        fontWeight: 600,
                        marginBottom: '4px',
                        color: 'var(--action-primary)',
                      }}
                    >
                      Chọn ca làm việc mới có sẵn của cửa hàng:
                    </div>
                    <select
                      value={newShiftId}
                      onChange={e => onNewShiftIdChange(Number(e.target.value))}
                    >
                      {availableShifts.map(sh => (
                        <option key={sh.shift_id} value={sh.shift_id}>
                          {sh.shift_name} ({sh.start_time} - {sh.end_time}) · {sh.work_hours}h
                        </option>
                      ))}
                    </select>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      Hệ thống sẽ đối chiếu và tính lại phút trễ/sớm theo giờ của ca mới.
                    </div>
                  </div>
                )}
              </div>

              {/* EXCLUDED_INVALID */}
              <div
                className={`att-decision-card ${decision === 'EXCLUDED_INVALID' ? 'is-selected' : ''}`}
                onClick={() => onDecisionChange('EXCLUDED_INVALID')}
              >
                <div className="att-decision-card-top">
                  <label className="att-decision-radio-label">
                    <input
                      type="radio"
                      name="decision"
                      checked={decision === 'EXCLUDED_INVALID'}
                      onChange={() => onDecisionChange('EXCLUDED_INVALID')}
                    />
                    <span>D. Loại trừ phiên khỏi ngày công</span>
                  </label>
                  <span className="att-review-badge is-excluded">Loại trừ phiên</span>
                </div>
                <div className="att-decision-desc">
                  Phiên test máy, nhân viên bấm nhầm tại quầy hoặc ghi nhận sai kỹ thuật.
                </div>
                <div className="att-decision-impact">
                  • Giữ nguyên dữ liệu thô (không xóa bản ghi). Loại phiên khỏi tổng hợp công và tiền phạt.
                </div>
              </div>

              {/* NEEDS_MORE_INFO */}
              <div
                className={`att-decision-card ${decision === 'NEEDS_MORE_INFO' ? 'is-selected' : ''}`}
                onClick={() => onDecisionChange('NEEDS_MORE_INFO')}
              >
                <div className="att-decision-card-top">
                  <label className="att-decision-radio-label">
                    <input
                      type="radio"
                      name="decision"
                      checked={decision === 'NEEDS_MORE_INFO'}
                      onChange={() => onDecisionChange('NEEDS_MORE_INFO')}
                    />
                    <span>E. Chưa đủ căn cứ (Cần thêm giải trình)</span>
                  </label>
                  <span className="att-review-badge is-needs-info">Chờ giải trình</span>
                </div>
                <div className="att-decision-desc">
                  Chưa đủ giấy tờ, biên bản hoặc cần Cửa hàng trưởng bổ sung xác minh.
                </div>
                <div className="att-decision-impact">
                  • Giữ trạng thái Chờ xử lý. Khóa tạm giữ (HOLD) không đưa vào tính lương cho đến khi có giải trình.
                </div>
              </div>
            </div>
          </div>

          {/* Phần nhập Lý do & Biên bản */}
          <div className="att-reason-section">
            <label>
              Biên bản giải trình / Căn cứ xác minh của HR (Bắt buộc){' '}
              <span className="att-required-mark" style={{ color: 'var(--status-error)' }}>
                *
              </span>
            </label>
            <textarea
              className="att-reason-textarea"
              value={reason}
              onChange={e => onReasonChange(e.target.value)}
              placeholder="Nhập lý do chi tiết, số biên bản xác nhận, tài liệu đính kèm..."
            />
          </div>

          {error && (
            <div
              style={{
                color: 'var(--status-error)',
                fontSize: '12px',
                background: 'var(--status-error-bg)',
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid var(--status-error-border)',
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div className="att-resolve-modal-footer">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Hủy bỏ
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onSubmit}
            disabled={isSubmitting}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <CheckCircle2 size={14} />
            <span>Xác nhận xử lý</span>
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Modern Subcomponent: Confirm Dialog trước khi commit quyết định
 */
function AttendanceConfirmModal({
  session,
  employeeName,
  decision,
  isSubmitting,
  onCancel,
  onConfirm,
}: {
  session: AttendanceSession
  employeeName: string
  decision: DecisionType
  isSubmitting: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const decisionLabels: Record<DecisionType, string> = {
    CONFIRMED_RAW_WORK: 'Xác nhận công loại trừ thô',
    CONFIRMED_LATE: 'HR xác nhận đi trễ',
    SHIFT_REASSIGNED: 'HR xác nhận điều chỉnh ca',
    EXCLUDED_INVALID: 'Loại trừ phiên khỏi ngày công',
    NEEDS_MORE_INFO: 'Chưa đủ căn cứ, cần thêm giải trình',
  }

  return (
    <div
      className="att-resolve-modal-overlay"
      style={{ zIndex: 1200 }}
      onClick={e => {
        e.stopPropagation()
        if (!isSubmitting && e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        className="att-resolve-modal"
        style={{ maxWidth: '480px' }}
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
      >
        <div className="att-resolve-modal-header">
          <h4 style={{ margin: 0, fontSize: '15px', color: 'var(--text-primary)' }}>
            Xác nhận lưu quyết định HR?
          </h4>
          <button
            type="button"
            className="btn btn-secondary btn-sm att-modal-close-btn"
            onClick={onCancel}
          >
            <X size={14} />
          </button>
        </div>
        <div className="att-resolve-modal-body" style={{ fontSize: '13px' }}>
          <p style={{ margin: 0, lineHeight: 1.5 }}>
            Bạn đang chuẩn bị áp dụng quyết định <strong>[{decisionLabels[decision]}]</strong> cho phiên chấm công
            #{session.attendance_id} của nhân viên <strong>{employeeName}</strong>.
          </p>
          <div
            style={{
              background: 'var(--surface-subtle)',
              border: '1px solid var(--border-default)',
              borderRadius: '6px',
              padding: '10px',
              marginTop: '10px',
              fontSize: '12px',
              color: 'var(--text-secondary)',
            }}
          >
            <strong>Lưu ý:</strong> Quyết định này sẽ được ghi vào nhật ký kiểm toán hệ thống
            (audit_logs) và tính toán lại dữ liệu kỳ công ngay lập tức.
          </div>
        </div>
        <div className="att-resolve-modal-footer">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Quay lại
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onConfirm}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Đang lưu...' : 'Tôi xác nhận'}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Modern Subcomponent: Dialog xem toàn bộ nhật ký Audit Trail
 */
function AttendanceAuditHistoryModal({
  session,
  onClose,
}: {
  session: AttendanceSession
  onClose: () => void
}) {
  const historyList =
    session.audit_history || session.attendance_context?.audit_history || []

  return (
    <div
      className="att-resolve-modal-overlay"
      onClick={e => {
        e.stopPropagation()
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="att-resolve-modal"
        style={{ maxWidth: '600px' }}
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
      >
        <div className="att-resolve-modal-header">
          <h3 className="att-resolve-modal-title">
            <History size={17} color="var(--status-info)" />
            <span>Lịch sử xử lý phiên #{session.attendance_id}</span>
          </h3>
          <button
            type="button"
            className="btn btn-secondary btn-sm att-modal-close-btn"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
        <div className="att-resolve-modal-body">
          {!historyList.length ? (
            <div style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--text-tertiary)' }}>
              <History size={32} style={{ margin: '0 auto 10px', opacity: 0.35, display: 'block' }} />
              <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-secondary)' }}>
                Chưa có lịch sử phiên
              </div>
              <div style={{ fontSize: '11.5px', marginTop: '4px', color: 'var(--text-muted)' }}>
                Phiên làm việc này chưa có ghi nhận điều chỉnh hoặc xử lý nào từ HR.
              </div>
            </div>
          ) : (
            <div className="att-audit-list">
              {historyList.map((entry, idx) => (
                <div key={idx} className="att-audit-card">
                  <div className="att-audit-card-header">
                    <span className="att-audit-card-title">
                      Phiên bản #{entry.version || idx + 1}: {entry.decision || entry.action}
                    </span>
                    <span className="att-audit-card-time">
                      {entry.timestamp ? new Date(entry.timestamp).toLocaleString('vi-VN') : ''}
                    </span>
                  </div>
                  <div className="att-audit-card-reason">
                    <strong>Lý do:</strong> {entry.reason || 'Không ghi nhận lý do'}
                  </div>
                  {entry.old_shift_id !== entry.new_shift_id && (
                    <div style={{ marginTop: '4px', fontSize: '11px', color: 'var(--status-info)' }}>
                      Ca làm việc: Shift #{entry.old_shift_id} → Shift #{entry.new_shift_id}
                    </div>
                  )}
                  <div className="att-audit-card-meta">
                    Người xử lý: <strong>{entry.user_name || `User #${entry.user_id}`}</strong>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="att-resolve-modal-footer">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Đóng
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Modern Subcomponent: Dòng phiên chấm công trong bảng
 */
function AttendanceSessionTableRow({
  session,
  isFirstLateInDay,
  isAdmin,
  isStoreManager,
  onOpenResolve,
  onViewRawSession,
  onOpenAuditHistory,
}: {
  session: AttendanceSession
  isFirstLateInDay: boolean
  isAdmin?: boolean
  isStoreManager?: boolean
  onOpenResolve: (s: AttendanceSession) => void
  onViewRawSession: (s: AttendanceSession) => void
  onOpenAuditHistory: (s: AttendanceSession) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handleDocClick = (e: MouseEvent | PointerEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('.action-dropdown') || buttonRef.current?.contains(target)) {
        return
      }
      setMenuOpen(false)
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', handleDocClick, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handleDocClick, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  const handleToggleMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (menuOpen) {
      setMenuOpen(false)
      setMenuPos(null)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const menuEstimatedHeight = 110
    const openUp = spaceBelow < menuEstimatedHeight && rect.top > menuEstimatedHeight

    setMenuPos({
      top: openUp ? undefined : rect.bottom + 4,
      bottom: openUp ? window.innerHeight - rect.top + 4 : undefined,
      right: Math.max(8, window.innerWidth - rect.right),
    })
    setMenuOpen(true)
  }

  const isValid = !session.needs_hr_review && session.session_quality_status === 'NORMAL'
  const scheduledTime = session.scheduled_start
    ? `${session.scheduled_start.slice(0, 5)} - ${session.scheduled_end?.slice(0, 5) || ''}`
    : session.attendance_context?.actual?.start_time
    ? `${session.attendance_context.actual.start_time.slice(0, 5)} - ${session.attendance_context.actual.end_time?.slice(0, 5) || ''}`
    : 'Chưa có ca'

  // Phân loại trạng thái đi trễ & phạt
  const getLateStatusMeta = () => {
    if (session.review_decision === 'CONFIRMED_RAW_WORK') {
      return {
        variantClass: 'is-raw-work',
        iconKind: 'check' as const,
        label: 'HR xác nhận công thực tế từ dữ liệu thô',
        hint: 'Giữ giờ công thực tế; trạng thái này không tự xác nhận trễ, sớm hoặc OT được duyệt.',
      }
    }
    if (session.review_decision === 'CONFIRMED_LATE') {
      return {
        variantClass: 'is-late-day',
        iconKind: 'alertCircle' as const,
        label: `HR xác nhận trễ · ${session.late_minutes}p (Phạt 50.000₫)`,
        hint: 'HR đã xác nhận vi phạm trễ ca theo lịch cũ. Tính 1 lần phạt.',
      }
    }
    if (session.review_decision === 'EXCLUDED_INVALID') {
      return {
        variantClass: 'is-excluded',
        iconKind: 'check' as const,
        label: 'Đã loại trừ phiên (0₫)',
        hint: 'HR đã xác nhận loại trừ phiên không hợp lệ. Miễn trừ toàn bộ công và phạt.',
      }
    }
    if (session.review_decision === 'SHIFT_REASSIGNED') {
      return {
        variantClass: 'is-none',
        iconKind: 'check' as const,
        label: `Đã đổi ca ${(session.late_minutes ?? 0) > 0 ? `· Trễ ${session.late_minutes}p` : '(Đúng giờ)'}`,
        hint: 'HR đã điều chỉnh sang ca làm việc mới có căn cứ.',
      }
    }
    if (session.review_decision === 'NEEDS_MORE_INFO') {
      return {
        variantClass: 'is-excluded',
        iconKind: 'help' as const,
        label: 'Chờ thêm giải trình (0₫)',
        hint: 'Chờ nhân viên bổ sung hồ sơ giải trình.',
      }
    }
    if (session.is_valid_late) {
      if (isFirstLateInDay) {
        return {
          variantClass: 'is-late-day',
          iconKind: 'alertCircle' as const,
          label: `+1 ngày trễ · Trễ ${session.late_minutes}p · Phạt 50.000₫`,
          hint: 'Trễ quá hạn >15p, tính 1 ngày trễ và 1 lần phạt 50.000₫',
        }
      }
      return {
        variantClass: 'is-late-second',
        iconKind: 'alertCircle' as const,
        label: `Trễ ca 2 (0 ngày) · Trễ ${session.late_minutes}p · Phạt 50.000₫`,
        hint: 'Trễ ca 2 cùng ngày: không tăng ngày trễ nhưng vẫn tính 1 lần phạt vi phạm',
      }
    }
    if (
      session.is_grace_late ||
      (!session.needs_hr_review &&
        (session.late_minutes || 0) > 0 &&
        (session.late_minutes || 0) <= 15)
    ) {
      return {
        variantClass: 'is-grace',
        iconKind: 'clock' as const,
        label: `Trễ ${session.late_minutes}p (Trong hạn ≤15p · Miễn phạt 0₫)`,
        hint: 'Trễ trong hạn 15 phút cho phép của công ty, được miễn trừ phạt',
      }
    }
    if (
      session.needs_hr_review ||
      session.session_quality_status === 'SHORT_SESSION' ||
      session.session_quality_status === 'OPEN_SESSION' ||
      session.session_quality_status === 'NEEDS_REVIEW' ||
      (session.late_minutes ?? 0) > 0
    ) {
      return {
        variantClass: 'is-excluded',
        iconKind: 'alertTriangle' as const,
        label: `Loại trừ chờ HR (Thô: ${session.late_minutes ?? 0}p · 0₫)`,
        hint: 'Phiên bất thường / kiểm thử. Đã loại trừ khỏi ngày trễ hợp lệ.',
      }
    }
    return {
      variantClass: 'is-none',
      iconKind: 'check' as const,
      label: 'Đúng giờ (0₫)',
      hint: undefined,
    }
  }

  const lateStatus = getLateStatusMeta()
  const renderLateIcon = (size: number) => {
    if (lateStatus.iconKind === 'alertCircle') return <AlertCircle size={size} aria-hidden="true" />
    if (lateStatus.iconKind === 'help') return <HelpCircle size={size} aria-hidden="true" />
    if (lateStatus.iconKind === 'clock') return <Clock size={size} aria-hidden="true" />
    if (lateStatus.iconKind === 'alertTriangle') return <AlertTriangle size={size} aria-hidden="true" />
    return <Check size={size} aria-hidden="true" />
  }
  const techStatusLabel = isValid
    ? 'Kỹ thuật: Hợp lệ'
    : `Kỹ thuật: ${formatQualityStatus(session.session_quality_status)}`

  const auditHistoryList =
    session.audit_history || session.attendance_context?.audit_history || []
  const isReviewed = Boolean(
    (session.review_decision && session.review_decision !== 'PENDING') ||
    (session.hr_review && session.hr_review.decision && session.hr_review.decision !== 'PENDING')
  )

  const getReviewDecisionMeta = () => {
    switch (session.review_decision) {
      case 'CONFIRMED_RAW_WORK':
        return {
          label: 'HR: Xác nhận công thực tế',
          variantClass: 'is-raw-work',
          badgeClass: 'is-raw-work',
          description: 'HR đã xác nhận giờ công thực tế từ dữ liệu gốc; không tự xác nhận trễ, sớm hoặc OT.',
        }
      case 'CONFIRMED_LATE':
        return {
          label: 'HR: Xác nhận trễ',
          variantClass: 'is-confirmed-late',
          badgeClass: 'is-needs-info',
          description: 'HR đã xác nhận trễ và chấp nhận giải trình.',
        }
      case 'SHIFT_REASSIGNED':
        return {
          label: 'HR: Đã đổi ca',
          variantClass: 'is-shift-reassigned',
          badgeClass: 'is-shift-reassigned',
          description: 'HR đã điều chỉnh và gán lại ca làm việc phù hợp.',
        }
      case 'EXCLUDED_INVALID':
        return {
          label: 'HR: Đã loại trừ',
          variantClass: 'is-excluded',
          badgeClass: 'is-excluded',
          description: 'HR đã xác định phiên không hợp lệ và loại trừ khỏi bảng công.',
        }
      case 'NEEDS_MORE_INFO':
        return {
          label: 'HR: Cần thêm TT',
          variantClass: 'is-needs-info',
          badgeClass: 'is-needs-info',
          description: 'HR yêu cầu nhân viên bổ sung hồ sơ hoặc giải trình thêm.',
        }
      default:
        return null
    }
  }

  const reviewMeta = getReviewDecisionMeta()
  const latestAudit = auditHistoryList[auditHistoryList.length - 1]

  let actionBtnText = 'Hợp lệ'
  let actionBtnClass = 'btn-secondary att-btn-valid'
  let actionBtnTitle = 'Hợp lệ'
  let actionBtnIcon = <Check size={12} />

  if (session.needs_hr_review) {
    // Hành vi 2: Chờ HR thao tác (Cần can thiệp) -> Nút xanh nổi bật kêu gọi hành động
    actionBtnText = 'HR Xử lý'
    actionBtnClass = 'btn-primary att-btn-needs-review'
    actionBtnTitle = 'HR Xử lý'
    actionBtnIcon = <ShieldCheck size={12} />
  } else if (isReviewed) {
    // Hành vi 3: HR đã thao tác xử lý xong -> Giúp HR nhận biết ca đã đối soát
    actionBtnText = 'Đã xử lý'
    actionBtnClass = 'btn-secondary att-btn-reviewed'
    actionBtnTitle = 'Đã xử lý'
    actionBtnIcon = <ShieldCheck size={12} />
  } else {
    // Hành vi 1: Tự động duyệt (An toàn, hợp lệ) -> Hệ thống tự động phê chuẩn
    actionBtnText = 'Hợp lệ'
    actionBtnClass = 'btn-secondary att-btn-valid'
    actionBtnTitle = 'Hợp lệ'
    actionBtnIcon = <Check size={12} />
  }

  return (
    <tr className={!isValid ? 'session-row-flagged' : ''}>
      <td>
        <strong>{formatDate(session.work_date)}</strong>
      </td>
      <td>
        {session.attendance_context?.actual?.shift_name || session.shift_name || 'Chưa xác định'}
      </td>
      <td style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>{scheduledTime}</td>
      <td>
        <span>{formatTime(session.check_in_time)}</span>
        <span style={{ color: 'var(--text-tertiary)', margin: '0 4px' }}>→</span>
        <span>{session.check_out_time ? formatTime(session.check_out_time) : 'Chưa ra'}</span>
      </td>
      <td style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)' }}>
          {session.actual_work_hours !== undefined && session.actual_work_hours !== null
            ? `${Number(session.actual_work_hours).toFixed(1)}h công`
            : session.raw_duration_minutes
            ? formatDurationMinutes(session.raw_duration_minutes)
            : '0h'}
        </div>
        <div style={{ fontSize: '10.5px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
          {session.raw_duration_minutes ? (
            <span>Có mặt: {formatDurationMinutes(session.raw_duration_minutes)}</span>
          ) : (
            <span>Chưa checkout</span>
          )}
        </div>
        {session.has_verified_ot && (session.verified_ot_hours ?? 0) > 0 && (
          <div
            style={{
              fontSize: '11px',
              color: 'var(--status-success)',
              fontWeight: 600,
              marginTop: '3px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '3px',
            }}
            title={`Đơn OT #${session.ot_request_id} đã duyệt và đối soát`}
          >
            <span>✓ OT: {session.verified_ot_hours}h</span>
          </div>
        )}
      </td>
      <td
        style={{
          textAlign: 'center',
          whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {session.is_valid_late ? (
          <span style={{ color: 'var(--status-error)', fontWeight: 700 }}>
            Trễ {session.late_minutes}p
          </span>
        ) : (session.late_minutes ?? 0) > 0 && (session.late_minutes ?? 0) <= 15 ? (
          <span style={{ color: 'var(--status-info, #0284c7)', fontWeight: 600 }}>
            Trễ {session.late_minutes}p (Ân hạn)
          </span>
        ) : (session.late_minutes ?? 0) > 15 ? (
          <span style={{ color: 'var(--status-warning)' }} title="Phút trễ thô từ phiên bất thường">
            Trễ {session.late_minutes}p (Thô)
          </span>
        ) : session.is_valid_early ? (
          <span style={{ color: 'var(--status-warning)', fontWeight: 700 }}>
            Sớm {session.early_minutes}p
          </span>
        ) : (session.early_minutes ?? 0) > 0 ? (
          <span style={{ color: 'var(--status-warning)' }}>Sớm {session.early_minutes}p (Thô)</span>
        ) : (
          <span style={{ color: 'var(--text-tertiary)' }}>Đúng giờ</span>
        )}
      </td>
      <td style={{ textAlign: 'center' }} className="td-att-late-class">
        <div className="att-day-status-wrap">
          <button
            type="button"
            className={`att-day-status-trigger ${lateStatus.variantClass}`}
            onClick={e => e.currentTarget.focus()}
            aria-label={`${lateStatus.label} (Di chuột hoặc bấm để xem chi tiết)`}
          >
            {renderLateIcon(14)}
          </button>
          <div className="att-day-status-popover" role="tooltip">
            <span
              className={`att-day-status-pill ${lateStatus.variantClass}`}
              title={lateStatus.hint}
            >
              {renderLateIcon(11)}
              <span>{lateStatus.label}</span>
            </span>
          </div>
        </div>
      </td>
      <td style={{ textAlign: 'center' }} className="td-att-hr-status">
        <div className="att-status-triggers-group">
          <div className="att-hr-tech-wrap">
            <span
              className={`att-hr-tech-trigger ${isValid ? 'is-success' : 'is-warning'}`}
              aria-label={techStatusLabel}
            >
              {isValid ? <ShieldCheck size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}
            </span>
            <div className="att-hr-tech-popover" role="tooltip">
              <span className={`badge ${isValid ? 'badge-success' : 'badge-warning'}`}>
                {techStatusLabel}
              </span>
            </div>
          </div>

          {reviewMeta && (
            <div className="att-hr-review-wrap">
              <span
                className={`att-hr-review-trigger ${reviewMeta.variantClass}`}
                aria-label={reviewMeta.label}
              >
                <UserCheck size={14} aria-hidden="true" />
              </span>
              <div className="att-hr-review-popover" role="tooltip">
                <span className={`att-review-badge ${reviewMeta.badgeClass}`}>
                  {reviewMeta.label}
                </span>
              </div>
            </div>
          )}
        </div>
      </td>
      <td style={{ textAlign: 'center' }}>
        <div className="att-row-actions-group">
          <button
            type="button"
            className={`btn btn-sm ${actionBtnClass}`}
            onClick={() => {
              if (isStoreManager) {
                toast.error('Bạn không có quyền thao tác chức năng này')
                return
              }
              onOpenResolve(session)
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 8px',
              fontSize: '11px',
              whiteSpace: 'nowrap',
              cursor: isStoreManager ? 'not-allowed' : 'pointer',
              opacity: isStoreManager ? 0.65 : 1,
            }}
            title={actionBtnTitle}
          >
            {actionBtnIcon}
            <span>{actionBtnText}</span>
          </button>

          <button
            ref={buttonRef}
            type="button"
            className={`btn btn-secondary btn-sm btn-icon ${menuOpen ? 'active' : ''}`}
            onClick={handleToggleMenu}
            title="Tùy chọn"
            aria-label="Tùy chọn thao tác"
          >
            <MoreVertical size={14} />
          </button>
        </div>

        {menuOpen && menuPos && createPortal(
          <div
            className={`action-dropdown action-dropdown-fixed ${menuPos.bottom !== undefined ? 'dropup' : 'dropdown'}`}
            onClick={e => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: menuPos.top !== undefined ? `${menuPos.top}px` : 'auto',
              bottom: menuPos.bottom !== undefined ? `${menuPos.bottom}px` : 'auto',
              right: `${menuPos.right}px`,
              zIndex: 99999,
              minWidth: '220px',
            }}
          >
            <button
              type="button"
              className="action-dropdown-item"
              onClick={() => {
                setMenuOpen(false)
                onViewRawSession(session)
              }}
              title={
                isAdmin
                  ? 'Xem thông tin ca làm việc (Chế độ Quản trị xem dữ liệu gốc)'
                  : 'Xem thông tin ca làm việc'
              }
            >
              <Eye size={14} className="action-icon" />
              <span>Chi tiết ca làm việc phiên #{session.attendance_id}</span>
            </button>

            <button
              type="button"
              className="action-dropdown-item"
              onClick={() => {
                setMenuOpen(false)
                onOpenAuditHistory(session)
              }}
              title="Xem nhật ký lịch sử xử lý của phiên"
            >
              <History size={14} className="action-icon" />
              <span>Lịch sử xử lý phiên #{session.attendance_id}</span>
            </button>
          </div>,
          document.body
        )}
      </td>
    </tr>
  )
}

/**
 * Main Component: EmployeeAttendanceDetailModal
 */
export function EmployeeAttendanceDetailModal({
  employee,
  period,
  isAdmin,
  isStoreManager,
  currentUser,
  onClose,
  onOpenPrint,
  onViewRawSession,
  onSessionResolved,
}: EmployeeAttendanceDetailModalProps) {
  // Chỉ HR và Giám đốc được xử lý phiên chấm công (backend chặn cả CHT lẫn ADMIN).
  const cannotResolve = Boolean(
    isStoreManager ||
      !currentUser?.roles?.some((r: string) => ['HR_MANAGER', 'DIRECTOR'].includes(r))
  )

  const [activeTab, setActiveTab] = useState<TabType>('ALL')
  const [sessions, setSessions] = useState<AttendanceSession[]>(employee.sessions || [])

  // HR Resolution Dialog state
  const [resolvingSession, setResolvingSession] = useState<AttendanceSession | null>(null)
  const [resolutionDecision, setResolutionDecision] = useState<DecisionType>('CONFIRMED_RAW_WORK')
  const [resolutionReason, setResolutionReason] = useState('')
  const [resolutionNewShiftId, setResolutionNewShiftId] = useState<number | ''>('')
  const [availableShifts, setAvailableShifts] = useState<ShiftOption[]>([])
  const [submittingResolution, setSubmittingResolution] = useState(false)
  const [resolutionError, setResolutionError] = useState('')
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)

  // Audit Trail History Modal state
  const [auditViewingSession, setAuditViewingSession] = useState<AttendanceSession | null>(null)

  // ESC handler & scroll-lock
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showConfirmDialog) {
          setShowConfirmDialog(false)
        } else if (resolvingSession) {
          setResolvingSession(null)
        } else if (auditViewingSession) {
          setAuditViewingSession(null)
        } else {
          onClose()
        }
      }
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = 'unset'
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose, resolvingSession, auditViewingSession, showConfirmDialog])

  // Sync internal sessions with prop updates
  useEffect(() => {
    setSessions(employee.sessions || [])
  }, [employee.sessions])

  // Pre-fetch work shifts for reassignment dropdown
  useEffect(() => {
    api
      .get<{ shifts?: ShiftOption[] }>('/operations/work-shifts')
      .then(res => {
        if (res.shifts) {
          setAvailableShifts(res.shifts)
        }
      })
      .catch(() => {})
  }, [])

  const handleOpenResolve = (s: AttendanceSession) => {
    if (cannotResolve) {
      toast.error('Bạn không có quyền thao tác chức năng này')
      return
    }
    setResolvingSession(s)
    const existingDecision =
      s.review_decision && s.review_decision !== 'PENDING'
        ? (s.review_decision as DecisionType)
        : 'CONFIRMED_RAW_WORK'
    setResolutionDecision(existingDecision)
    setResolutionReason(s.hr_review?.reason || '')
    setResolutionNewShiftId(
      s.hr_review?.new_shift_id || s.shift_id || (availableShifts[0]?.shift_id ?? '')
    )
    setResolutionError('')
    setShowConfirmDialog(false)
  }

  const handleExecuteResolution = async () => {
    if (cannotResolve) {
      toast.error('Bạn không có quyền thao tác chức năng này')
      return
    }
    if (!resolvingSession) return
    if (!resolutionReason.trim()) {
      setResolutionError('Lý do xác minh và tham chiếu căn cứ là bắt buộc.')
      setShowConfirmDialog(false)
      return
    }
    if (resolutionDecision === 'SHIFT_REASSIGNED' && !resolutionNewShiftId) {
      setResolutionError('Vui lòng chọn ca làm việc thay thế.')
      setShowConfirmDialog(false)
      return
    }

    setSubmittingResolution(true)
    setResolutionError('')
    try {
      const payload: {
        decision: DecisionType
        reason: string
        version: number
        new_shift_id?: number
      } = {
        decision: resolutionDecision,
        reason: resolutionReason.trim(),
        version: resolvingSession.hr_review?.version ?? 0,
      }
      if (resolutionDecision === 'SHIFT_REASSIGNED') {
        payload.new_shift_id = Number(resolutionNewShiftId)
      }

      const res = await api.post<{ success: boolean; updated_session: AttendanceSession }>(
        `/operations/attendance-sessions/${resolvingSession.attendance_id}/resolve`,
        payload
      )

      if (res.success && res.updated_session) {
        setSessions(prev =>
          prev.map(item =>
            item.attendance_id === resolvingSession.attendance_id ? res.updated_session : item
          )
        )
        setResolvingSession(null)
        setShowConfirmDialog(false)
        onSessionResolved?.(res.updated_session)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi khi lưu quyết định xử lý phiên chấm công.'
      setResolutionError(msg)
      setShowConfirmDialog(false)
    } finally {
      setSubmittingResolution(false)
    }
  }

  // Danh sách các ngày đi trễ hợp lệ dạng DD/MM
  const validLateDatesList: string[] = []
  const validLateDateSet = new Set<string>()
  sessions.forEach(s => {
    if (s.is_valid_late && s.work_date) {
      const dStr = String(s.work_date).slice(0, 10)
      if (!validLateDateSet.has(dStr)) {
        validLateDateSet.add(dStr)
        try {
          const parts = dStr.split('-')
          validLateDatesList.push(`${parts[2]}/${parts[1]}`)
        } catch {
          validLateDatesList.push(dStr)
        }
      }
    }
  })

  // Đếm theo từng tab
  const lateSessions = sessions.filter(s => s.is_valid_late)
  const graceSessions = sessions.filter(
    s =>
      s.is_grace_late ||
      (!s.needs_hr_review && (s.late_minutes || 0) > 0 && (s.late_minutes || 0) <= 15)
  )
  const earlySessions = sessions.filter(s => s.is_valid_early)
  const reviewSessions = sessions.filter(
    s =>
      s.needs_hr_review ||
      s.session_quality_status !== 'NORMAL' ||
      (s.quality_flags && s.quality_flags.length > 0)
  )

  const filteredSessions = sessions.filter(s => {
    if (activeTab === 'LATE') return s.is_valid_late
    if (activeTab === 'GRACE')
      return (
        s.is_grace_late ||
        (!s.needs_hr_review && (s.late_minutes || 0) > 0 && (s.late_minutes || 0) <= 15)
      )
    if (activeTab === 'EARLY') return s.is_valid_early
    if (activeTab === 'REVIEW')
      return (
        s.needs_hr_review ||
        s.session_quality_status !== 'NORMAL' ||
        (s.quality_flags && s.quality_flags.length > 0)
      )
    return true
  })

  // Theo dõi phiên trễ đầu tiên trong ngày
  const seenLateDates = new Set<string>()
  const totalLatePenalty =
    employee.late_penalty_amount ?? (employee.late_session_count ?? 0) * 50000

  return (
    <>
      <div
        className="att-detail-modal-overlay"
        onClick={e => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
      <div
        className="att-detail-modal"
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
      >
        {/* Sticky Header */}
        <div className="att-detail-modal-header">
          <div className="att-detail-modal-title-group">
            <h2 className="att-detail-modal-title">
              <span className="att-code-badge">
                {employee.employee_code || `NV${employee.employee_id}`}
              </span>
              {employee.employee_name}
            </h2>
            <div className="att-detail-modal-sub">
              <span>{employee.store_name || 'Chi nhánh'}</span>
              <span className="sep">·</span>
              <span>{employee.department_name || 'Phòng ban'}</span>
              <span className="sep">·</span>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                Kỳ công Tháng {period}
              </span>
            </div>
          </div>
          <div className="att-detail-modal-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onOpenPrint}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <Printer size={14} />
              <span>In Bảng Công PDF</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm att-modal-close-btn"
              onClick={onClose}
              title="Đóng (Phím ESC)"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="att-detail-modal-body">
          {/* Dải 4 Thẻ Summary của riêng nhân sự */}
          <div className="att-employee-kpi-grid">
            {/* KPI 1: Đi trễ quá hạn (>15p) & Tiền phạt */}
            <div className="att-emp-kpi-card is-late">
              <div className="att-emp-kpi-label">Đi trễ quá hạn (&gt;15p)</div>
              <div className="att-emp-kpi-value">
                {employee.late_day_count ?? 0} <span className="unit">ngày</span>
              </div>
              <div className="att-emp-kpi-sub">
                <strong>{employee.late_session_count ?? 0}</strong> lần phạt ·{' '}
                <strong>{employee.verified_late_minutes ?? 0}</strong> phút trễ
              </div>
              {validLateDatesList.length > 0 && (
                <div
                  className="att-emp-kpi-dates"
                  title="Danh sách các ngày đi trễ hợp lệ trong kỳ"
                >
                  Ngày trễ: <strong>{validLateDatesList.join(', ')}</strong>
                </div>
              )}
              <div
                style={{
                  marginTop: '6px',
                  paddingTop: '6px',
                  borderTop: '1px dashed var(--status-error-border)',
                  fontSize: '11px',
                  color: 'var(--status-error)',
                  fontWeight: 600,
                }}
              >
                Tiền phạt vi phạm quy chế: {formatCurrency(totalLatePenalty)}
              </div>
            </div>

            {/* KPI 2: Trễ trong hạn ≤15p (Ân hạn) */}
            <div className="att-emp-kpi-card is-grace">
              <div className="att-emp-kpi-label">Trễ trong hạn ≤15p (Ân hạn)</div>
              <div className="att-emp-kpi-value">
                {employee.grace_late_session_count ?? 0} <span className="unit">lần</span>
              </div>
              <div className="att-emp-kpi-sub">
                <strong>{employee.grace_late_minutes ?? 0}</strong> phút trễ
              </div>
              <div className="att-emp-kpi-note">
                Chính sách ân hạn công ty: <strong>Miễn phạt 0₫</strong>
              </div>
            </div>

            {/* KPI 3: Về sớm */}
            <div className="att-emp-kpi-card is-early">
              <div className="att-emp-kpi-label">Về sớm hợp lệ</div>
              <div className="att-emp-kpi-value">
                {employee.early_day_count ?? 0} <span className="unit">ngày</span>
              </div>
              <div className="att-emp-kpi-sub">
                <strong>{employee.early_session_count ?? 0}</strong> lần ·{' '}
                <strong>{employee.verified_early_minutes ?? 0}</strong> phút sớm
              </div>
              {(employee.unreviewed_early_minutes ?? 0) > 0 && (
                <div className="att-emp-kpi-note is-raw-warning">
                  +{employee.unreviewed_early_minutes}p thô chờ rà soát
                </div>
              )}
            </div>

            {/* KPI 4: Giờ làm & Phiên cần HR rà soát */}
            <div
              className={`att-emp-kpi-card ${
                (employee.needs_review_session_count ?? 0) > 0 ? 'is-review' : 'is-time'
              }`}
            >
              <div className="att-emp-kpi-label">Giờ thực tế / Phân ca</div>
              <div className="att-emp-kpi-value">
                {employee.actual_work_hours?.toFixed(1) ?? '0.0'}{' '}
                <span className="unit">h</span>{' '}
                <span className="sub-val">/ {employee.scheduled_hours?.toFixed(1) ?? '0.0'}h</span>
              </div>
              <div className="att-emp-kpi-sub">
                {employee.working_days ?? 0} ngày làm việc thực tế
              </div>
              {(employee.needs_review_session_count ?? 0) > 0 ? (
                <div
                  className="att-emp-kpi-note att-emp-kpi-note-icon"
                  style={{ color: 'var(--status-warning)', fontWeight: 600 }}
                >
                  <AlertTriangle size={13} aria-hidden="true" style={{ flexShrink: 0 }} />
                  <span>Có {employee.needs_review_session_count} phiên cần HR xử lý</span>
                </div>
              ) : (
                <div
                  className="att-emp-kpi-note att-emp-kpi-note-icon"
                  style={{ color: 'var(--status-success)', fontStyle: 'normal' }}
                >
                  <CheckCircle2 size={13} aria-hidden="true" style={{ flexShrink: 0 }} />
                  <span>100% phiên đã chuẩn hóa</span>
                </div>
              )}
            </div>
          </div>

          {/* Dải Tab Lọc Phiên Chuẩn */}
          <div className="att-detail-tabs-bar">
            <button
              type="button"
              className={`att-tab-btn ${activeTab === 'ALL' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('ALL')}
            >
              Tất cả phiên ({sessions.length})
            </button>
            <button
              type="button"
              className={`att-tab-btn is-late-tab ${activeTab === 'LATE' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('LATE')}
            >
              Đi trễ quá hạn ({lateSessions.length})
            </button>
            <button
              type="button"
              className={`att-tab-btn ${activeTab === 'GRACE' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('GRACE')}
            >
              Trễ trong hạn ≤15p ({graceSessions.length})
            </button>
            <button
              type="button"
              className={`att-tab-btn is-early-tab ${activeTab === 'EARLY' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('EARLY')}
            >
              Về sớm ({earlySessions.length})
            </button>
            <button
              type="button"
              className={`att-tab-btn is-review-tab ${activeTab === 'REVIEW' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('REVIEW')}
            >
              Cần HR rà soát ({reviewSessions.length})
            </button>
          </div>

          {/* Bảng Danh sách Phiên Chấm Công Chi Tiết */}
          <div className="att-detail-table-wrapper">
            <table className="att-detail-table">
              <thead>
                <tr>
                  <th style={{ width: '82px' }}>Ngày công</th>
                  <th>Ca làm việc</th>
                  <th style={{ width: '95px' }}>Khung giờ ca</th>
                  <th style={{ width: '135px' }}>Check-in → Check-out</th>
                  <th style={{ width: '105px', textAlign: 'center' }}>THỜI LƯỢNG</th>
                  <th style={{ width: '115px', textAlign: 'center' }}>Phút trễ / sớm</th>
                  <th style={{ width: '110px', textAlign: 'center' }}>Phân loại Đi trễ &amp; Phạt</th>
                  <th style={{ width: '100px', textAlign: 'center' }}>Trạng thái &amp; Đánh giá HR</th>
                  <th style={{ width: '126px', minWidth: '126px', textAlign: 'center' }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {filteredSessions.length > 0 ? (
                  filteredSessions.map(s => {
                    const workDateStr = s.work_date ? String(s.work_date).slice(0, 10) : ''
                    let isFirstLate = false
                    if (s.is_valid_late) {
                      if (!seenLateDates.has(workDateStr)) {
                        seenLateDates.add(workDateStr)
                        isFirstLate = true
                      }
                    }

                    return (
                      <AttendanceSessionTableRow
                        key={s.attendance_id}
                        session={s}
                        isFirstLateInDay={isFirstLate}
                        isAdmin={isAdmin}
                        isStoreManager={cannotResolve}
                        onOpenResolve={handleOpenResolve}
                        onViewRawSession={onViewRawSession}
                        onOpenAuditHistory={setAuditViewingSession}
                      />
                    )
                  })
                ) : (
                  <tr>
                    <td
                      colSpan={9}
                      style={{
                        textAlign: 'center',
                        padding: '24px',
                        color: 'var(--text-tertiary)',
                      }}
                    >
                      Không có phiên chấm công nào trong tab này.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer Pop-up */}
        <div className="att-detail-modal-footer">
          <div className="att-detail-footer-note">
            <span>
              ℹ️ Dữ liệu phiên được đồng bộ chuẩn xác từ máy chấm công. Các phiên bất thường đã được
              loại trừ độc lập khỏi thống kê đi trễ để đảm bảo tính công bằng trước khi HR rà soát.
            </span>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Đóng bảng
          </button>
        </div>
      </div>
      </div>

      {/* HR Resolution Modal */}
      {resolvingSession && (
        <AttendanceResolutionModal
          session={resolvingSession}
          availableShifts={availableShifts}
          decision={resolutionDecision}
          reason={resolutionReason}
          newShiftId={resolutionNewShiftId}
          isSubmitting={submittingResolution}
          error={resolutionError}
          onDecisionChange={setResolutionDecision}
          onReasonChange={setResolutionReason}
          onNewShiftIdChange={setResolutionNewShiftId}
          onCancel={() => setResolvingSession(null)}
          onSubmit={() => {
            if (!resolutionReason.trim()) {
              setResolutionError('Vui lòng nhập lý do / biên bản giải trình.')
              return
            }
            setShowConfirmDialog(true)
          }}
        />
      )}

      {/* Confirm Dialog */}
      {showConfirmDialog && resolvingSession && (
        <AttendanceConfirmModal
          session={resolvingSession}
          employeeName={employee.employee_name}
          decision={resolutionDecision}
          isSubmitting={submittingResolution}
          onCancel={() => setShowConfirmDialog(false)}
          onConfirm={handleExecuteResolution}
        />
      )}

      {/* Audit History Modal */}
      {auditViewingSession && (
        <AttendanceAuditHistoryModal
          session={auditViewingSession}
          onClose={() => setAuditViewingSession(null)}
        />
      )}
    </>
  )
}
