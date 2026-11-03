import { useEffect, useState, useMemo } from 'react'
import {
  Download,
  Printer,
  FileText,
  AlertTriangle,
  Check,
  X,
  Clock,
  Scale,
  AlertCircle,
  ShieldCheck,
  Calendar,
  Code,
} from 'lucide-react'
import { api } from '../services/api'
import { MonthPicker } from '../components/common/MonthPicker'
import {
  formatDate,
  formatTime,
  formatDurationMinutes,
  formatCurrency,
  formatQualityFlag,
  formatQualityStatus,
} from '../utils/formatters'
import { MonthlyVerifiedOvertimePanel } from './MonthlyVerifiedOvertimePanel'
import { EmployeeAttendanceDetailModal } from './EmployeeAttendanceDetailModal'
import { EmployeeAttendancePrintModal } from './EmployeeAttendancePrintModal'
import { scheduleLabels } from './ActivityPage'
import './MonthlyAttendancePage.css'

type QuickStatusType = 'ALL' | 'LATE' | 'EARLY' | 'REVIEW' | 'STANDARD'

function getValidLateDates(sessions: any[] = []): string[] {
  const dates: string[] = []
  const seen = new Set<string>()
  sessions.forEach(s => {
    if (s.is_valid_late && s.work_date) {
      const dStr = String(s.work_date).slice(0, 10)
      if (!seen.has(dStr)) {
        seen.add(dStr)
        const parts = dStr.split('-')
        dates.push(parts.length === 3 ? `${parts[2]}/${parts[1]}` : dStr)
      }
    }
  })
  return dates
}

export function MonthlyAttendancePage({ user }: { user: any }) {
  const isAdmin = Boolean(user?.roles?.includes('ADMIN') || user?.role === 'ADMIN')
  const [period, setPeriod] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [filters, setFilters] = useState({ employee_id: '', department_id: '', store_id: '' })
  const [searchTerm, setSearchTerm] = useState('')
  const [quickStatus, setQuickStatus] = useState<QuickStatusType>('ALL')

  const [options, setOptions] = useState<any>({ employees: [], departments: [], stores: [] })
  const [rows, setRows] = useState<any[]>([])
  const [summary, setSummary] = useState<any>(null)
  const [policySettings, setPolicySettings] = useState<{ tolerance: number; penalty: number }>({
    tolerance: 15,
    penalty: 50000,
  })

  // Ngày công chuẩn động của kỳ (tính từ v_payroll_period_working_days)
  const [standardWorkingDays, setStandardWorkingDays] = useState<number>(26)
  const [standardDaysInfo, setStandardDaysInfo] = useState<any | null>(null)

  // Modals state
  const [selectedEmployeeForDetail, setSelectedEmployeeForDetail] = useState<any | null>(null)
  const [selectedEmployeeForPrint, setSelectedEmployeeForPrint] = useState<any | null>(null)
  const [selectedSession, setSelectedSession] = useState<any | null>(null)
  const [showAdminRawJson, setShowAdminRawJson] = useState(false)

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const branch =
    user?.roles?.includes('STORE_MANAGER') &&
    !user?.roles?.some((r: string) => ['ADMIN', 'HR_MANAGER', 'DIRECTOR'].includes(r))

  const isStoreManager = Boolean(
    branch ||
      user?.role === 'STORE_MANAGER'
  )

  useEffect(() => {
    api.get('/operations/filter-options').then(setOptions).catch(e => setError(e.message))
  }, [])

  const [refreshCount, setRefreshCount] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    api
      .get<any>(
        '/operations/monthly-attendance',
        Object.fromEntries(Object.entries({ period, ...filters }).filter(([, v]) => v !== ''))
      )
      .then(data => {
        if (active) {
          const freshEmployees = data.employees || []
          setRows(freshEmployees)
          setSummary(data.summary || null)
          if (data.standard_working_days !== undefined) {
            setStandardWorkingDays(Number(data.standard_working_days))
          }
          if (data.standard_working_days_info) {
            setStandardDaysInfo(data.standard_working_days_info)
          }
          if (data.late_tolerance_minutes !== undefined && data.late_penalty_amount !== undefined) {
            setPolicySettings({
              tolerance: data.late_tolerance_minutes,
              penalty: data.late_penalty_amount,
            })
          }
          if (selectedEmployeeForDetail) {
            const updated = freshEmployees.find(
              (e: any) => e.employee_id === selectedEmployeeForDetail.employee_id
            )
            if (updated) setSelectedEmployeeForDetail(updated)
          }
          setError('')
        }
      })
      .catch(e => {
        if (active) setError(e.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [period, filters, refreshCount])

  // Lọc danh sách theo searchTerm và quickStatus
  const filteredRows = useMemo(() => {
    return rows.filter(p => {
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase().trim()
        const code = (p.employee_code || '').toLowerCase()
        const name = (p.employee_name || '').toLowerCase()
        if (!code.includes(term) && !name.includes(term)) return false
      }

      if (quickStatus === 'LATE') {
        if ((p.late_day_count || 0) <= 0) return false
      } else if (quickStatus === 'EARLY') {
        if ((p.early_day_count || 0) <= 0) return false
      } else if (quickStatus === 'REVIEW') {
        const reviewCount = p.needs_review_session_count ?? p.flagged_sessions_count ?? 0
        if (reviewCount <= 0) return false
      } else if (quickStatus === 'STANDARD') {
        const hasLate = (p.late_day_count || 0) > 0
        const hasEarly = (p.early_day_count || 0) > 0
        const hasReview = (p.needs_review_session_count ?? p.flagged_sessions_count ?? 0) > 0
        if (hasLate || hasEarly || hasReview) return false
      }

      return true
    })
  }, [rows, searchTerm, quickStatus])

  // Xuất CSV chuẩn HR
  const exportCsv = () => {
    const headings = [
      'Mã NV',
      'Họ và tên',
      'Cửa hàng',
      'Phòng ban',
      'Kỳ công',
      `Công thực tế / ${standardWorkingDays} công`,
      'Giờ phân ca (h)',
      'Giờ thực tế (h)',
      'SỐ NGÀY ĐI TRỄ (>15p)',
      'Các ngày đi trễ (DD/MM)',
      'Số lần phạt đi trễ (>15p)',
      'Tổng phút trễ quá hạn',
      'Tiền phạt đi trễ (VNĐ)',
      'Số lần trễ trong hạn ≤15p (Miễn phạt)',
      'SỐ NGÀY VỀ SỚM',
      'Phút về sớm',
      'Phép có lương (ngày)',
      'Nghỉ không lương (ngày)',
      'OT đối soát VERIFIED (h)',
      'Ngoài ca thô (h)',
      'Phiên cần HR rà soát',
      'Phút trễ thô chờ rà soát',
      'Kết luận đánh giá HR',
    ]

    let sumPresentDays = 0
    let sumSchedHours = 0
    let sumActualHours = 0
    let sumLateDays = 0
    let sumLateSessions = 0
    let sumLateMinutes = 0
    let sumLatePenalty = 0
    let sumGraceLateSessions = 0
    let sumEarlyDays = 0
    let sumEarlyMinutes = 0
    let sumPaidLeave = 0
    let sumUnpaidLeave = 0
    let sumVerifiedOt = 0
    let verifiedOtSourceUnavailable = false
    let sumOutsideSchedule = 0
    let sumReviewSessions = 0
    let sumRawLateMins = 0

    const values = filteredRows.map(p => {
      const lateDates = (p.late_dates && p.late_dates.length > 0)
        ? p.late_dates.map((d: string) => {
            const parts = d.split('-')
            return parts.length === 3 ? `${parts[2]}/${parts[1]}` : d
          }).join('; ')
        : getValidLateDates(p.sessions || []).join('; ')

      const presentDays = p.working_days ?? 0
      const schedHours = p.scheduled_hours ?? 0
      const actualHours = p.actual_work_hours ?? 0
      const lateDays = p.late_day_count ?? 0
      const lateSessions = p.late_session_count ?? 0
      const lateMins = p.verified_late_minutes ?? 0
      const latePenalty = p.late_penalty_amount ?? (lateSessions * policySettings.penalty)
      const graceSessions = p.grace_late_session_count ?? 0
      const earlyDays = p.early_day_count ?? 0
      const earlyMins = p.verified_early_minutes ?? 0
      const paidLeave = p.paid_leave_days ?? 0
      const unpaidLeave = p.unpaid_leave_days ?? 0
      const verifiedOt = p.verified_ot_hours ?? 0
      const verifiedOtKnown = p.verified_ot_source_available !== false
      if (!verifiedOtKnown) verifiedOtSourceUnavailable = true
      const outsideSchedule = p.outside_schedule_hours ?? p.overtime_hours ?? 0
      const reviewSessions = p.needs_review_session_count ?? p.flagged_sessions_count ?? 0
      const rawLateMins = p.raw_late_minutes ?? 0

      sumPresentDays += presentDays
      sumSchedHours += schedHours
      sumActualHours += actualHours
      sumLateDays += lateDays
      sumLateSessions += lateSessions
      sumLateMinutes += lateMins
      sumLatePenalty += latePenalty
      sumGraceLateSessions += graceSessions
      sumEarlyDays += earlyDays
      sumEarlyMinutes += earlyMins
      sumPaidLeave += paidLeave
      sumUnpaidLeave += unpaidLeave
      sumVerifiedOt += verifiedOt
      sumOutsideSchedule += outsideSchedule
      sumReviewSessions += reviewSessions
      sumRawLateMins += (p.unreviewed_late_minutes ?? 0)

      const hrConclusion =
        reviewSessions > 0
          ? `Cần rà soát ${reviewSessions} phiên`
          : lateDays > 0 || earlyDays > 0
          ? `Trễ ${lateDays} ngày (-${formatCurrency(latePenalty)}) / Sớm ${earlyDays} ngày`
          : 'Đúng giờ / Đạt chuẩn'

      return [
        p.employee_code || `NV${p.employee_id}`,
        p.employee_name,
        p.store_name || '—',
        p.department_name || '—',
        period,
        `${presentDays} / ${standardWorkingDays}`,
        schedHours.toFixed(2),
        actualHours.toFixed(2),
        lateDays,
        lateDates || '—',
        lateSessions,
        lateMins,
        latePenalty,
        graceSessions,
        earlyDays,
        earlyMins,
        paidLeave,
        unpaidLeave,
        verifiedOtKnown ? verifiedOt.toFixed(2) : 'CHƯA CÓ NGUỒN',
        outsideSchedule.toFixed(2),
        reviewSessions,
        p.unreviewed_late_minutes ?? 0,
        hrConclusion,
      ]
    })

    // Dòng TỔNG CỘNG
    const totalRow = [
      'TỔNG CỘNG',
      `${filteredRows.length} nhân sự`,
      '—',
      '—',
      period,
      `${sumPresentDays} ngày`,
      sumSchedHours.toFixed(2),
      sumActualHours.toFixed(2),
      sumLateDays,
      '—',
      sumLateSessions,
      sumLateMinutes,
      sumLatePenalty,
      sumGraceLateSessions,
      sumEarlyDays,
      sumEarlyMinutes,
      sumPaidLeave,
      sumUnpaidLeave,
      verifiedOtSourceUnavailable ? 'CHƯA CÓ NGUỒN' : sumVerifiedOt.toFixed(2),
      sumOutsideSchedule.toFixed(2),
      sumReviewSessions,
      sumRawLateMins,
      '—',
    ]

    const cell = (v: any) =>
      '"' + String(v ?? '').replace(/^[=+@-]/, "'$&").replaceAll('"', '""') + '"'
    const csvContent =
      '\ufeff' + [headings, ...values, totalRow].map(r => r.map(cell).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `Bang_Cong_Chuan_HR_${period}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page-container hr-attendance-overhaul">
      {/* 1. Header trang & Banner Quy định */}
      <div className="hr-att-header">
        <div>
          <h1 className="hr-att-title">Quản lý công &amp; Đối soát Đi trễ</h1>
          <p className="hr-att-subtitle">
            Bảng tổng hợp công chuẩn Enterprise HRM. Tách biệt rõ ràng giữa{' '}
            <strong className="text-muted-notice">Ngoài ca (ghi nhận thô)</strong>,{' '}
            <strong className="text-verified-notice">OT đối soát (VERIFIED)</strong> và{' '}
            <strong className="text-late-notice">Đi trễ hợp lệ (sau 15p ân hạn)</strong>.
          </p>
        </div>

        {/* Banner Quy định Công ty áp dụng */}
        <div className="hr-policy-banner">
          <Scale size={16} className="hr-policy-icon" />
          <span className="hr-policy-text">
            <strong>Quy định công ty:</strong> Thời gian trễ cho phép tối đa (LATE_TOLERANCE_MINUTES):{' '}
            <span className="badge-policy">15 phút (Không phạt)</span> · Mức phạt đi trễ quá hạn (&gt;15p):{' '}
            <span className="badge-penalty">50.000 ₫/lần</span> · Công chuẩn kỳ {period}:{' '}
            <strong>{standardWorkingDays} ngày công</strong>
            {standardDaysInfo && (
              <span style={{ fontSize: '11px', opacity: 0.85, marginLeft: '4px' }}>
                ({standardDaysInfo.is_manual_override
                  ? 'Ghi đè thủ công'
                  : standardDaysInfo.is_locked
                  ? 'Kỳ đã chốt lương'
                  : `Lịch thực tế: ${standardDaysInfo.calendar_days} ngày - ${standardDaysInfo.sundays_count} CN${
                      standardDaysInfo.holidays_count ? ` - ${standardDaysInfo.holidays_count} ngày Lễ` : ''
                    }`})
              </span>
            )}.
          </span>
        </div>
      </div>

      {/* 2. Thanh công cụ lọc chuẩn mực doanh nghiệp */}
      <section className="card hr-att-filter-card">
        <div className="hr-filter-item">
          <MonthPicker value={period} onChange={setPeriod} label="Kỳ công" />
        </div>

        <div className="hr-filter-item">
          <span className="form-label">Tìm kiếm nhân sự</span>
          <div className="search-input-wrapper">
            <input
              type="text"
              className="form-input"
              placeholder="Mã NV hoặc Họ tên..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button
                type="button"
                className="clear-search-btn"
                onClick={() => setSearchTerm('')}
                title="Xóa tìm kiếm"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="hr-filter-item">
          <span className="form-label">Phòng ban</span>
          <select
            className="form-select"
            value={filters.department_id}
            onChange={e => setFilters({ ...filters, department_id: e.target.value })}
          >
            <option value="">Tất cả</option>
            {(options.departments || []).map((o: any) => (
              <option key={o.id || o.department_id} value={o.id || o.department_id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>

        <div className="hr-filter-item">
          <span className="form-label">Cửa hàng</span>
          <select
            className="form-select"
            disabled={branch}
            value={branch ? user.store_id : filters.store_id}
            onChange={e => setFilters({ ...filters, store_id: e.target.value })}
          >
            <option value="">Tất cả</option>
            {(options.stores || []).map((o: any) => (
              <option key={o.id || o.store_id} value={o.id || o.store_id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>

        <div className="hr-filter-item">
          <span className="form-label">Trạng thái đối soát</span>
          <select
            className="form-select"
            value={quickStatus}
            onChange={e => setQuickStatus(e.target.value as QuickStatusType)}
          >
            <option value="ALL">Tất cả</option>
            <option value="LATE">Có ngày đi trễ</option>
            <option value="EARLY">Có ngày về sớm</option>
            <option value="REVIEW">Cần HR rà soát</option>
            <option value="STANDARD">Đúng giờ / Đạt chuẩn</option>
          </select>
        </div>

        <div className="hr-filter-actions">
          <button
            className="btn btn-primary hr-export-csv-btn"
            onClick={exportCsv}
            disabled={loading || !!error || filteredRows.length === 0}
            title="Xuất file CSV chuẩn HR có UTF-8 BOM và dòng tổng cộng"
          >
            <Download size={14} />
            <span>Xuất CSV</span>
          </button>
        </div>
      </section>

      {/* 3. Dải 5 Thẻ KPI Đầu Trang Tương Tác (Interactive KPI Strip) */}
      {summary && (
        <div className="monthly-kpi-grid">
          {/* KPI 1: Đi trễ quá hạn (>15p) & Phạt */}
          <div
            className={`monthly-kpi-card is-interactive ${quickStatus === 'LATE' ? 'is-active is-late' : ''}`}
            onClick={() => setQuickStatus(quickStatus === 'LATE' ? 'ALL' : 'LATE')}
            title="Nhấp để lọc danh sách nhân viên có ngày đi trễ quá hạn"
          >
            <div className="monthly-kpi-label">Đi trễ quá hạn (&gt;15p)</div>
            <div className="monthly-kpi-value">
              {summary.total_late_days ?? 0}{' '}
              <small style={{ fontSize: 13, fontWeight: 'normal' }}>ngày</small>
            </div>
            <div className="monthly-kpi-sub">
              {summary.total_late_sessions ?? 0} lần phạt · {summary.total_late_minutes ?? 0}p ·{' '}
              {summary.employees_with_late ?? 0} nhân sự
            </div>
            <div className="monthly-kpi-penalty-sub">
              Giảm trừ chuyên cần dự kiến:{' '}
              <strong>
                -{formatCurrency(summary.total_late_penalty_amount || (summary.total_late_sessions || 0) * policySettings.penalty)}
              </strong>
              {summary.total_grace_late_sessions > 0 && (
                <span style={{ color: '#059669', marginLeft: 4 }}>
                  (Kèm {summary.total_grace_late_sessions} lần ≤15p miễn phạt)
                </span>
              )}
            </div>
          </div>

          {/* KPI 2: Về sớm hợp lệ */}
          <div
            className={`monthly-kpi-card is-interactive ${quickStatus === 'EARLY' ? 'is-active is-early' : ''}`}
            onClick={() => setQuickStatus(quickStatus === 'EARLY' ? 'ALL' : 'EARLY')}
            title="Nhấp để lọc danh sách nhân viên có ngày về sớm"
          >
            <div className="monthly-kpi-label">Về sớm hợp lệ (Tổng ngày)</div>
            <div className="monthly-kpi-value">
              {summary.total_early_days ?? 0}{' '}
              <small style={{ fontSize: 13, fontWeight: 'normal' }}>ngày</small>
            </div>
            <div className="monthly-kpi-sub">
              {summary.total_early_sessions ?? 0} phiên · {summary.total_early_minutes ?? 0}p ·{' '}
              {summary.employees_with_early ?? 0} nhân sự
            </div>
          </div>

          {/* KPI 3: Phiên cần HR xác minh / rà soát */}
          <div
            className={`monthly-kpi-card is-interactive ${quickStatus === 'REVIEW' ? 'is-active is-review' : ''}`}
            onClick={() => setQuickStatus(quickStatus === 'REVIEW' ? 'ALL' : 'REVIEW')}
            title="Nhấp để lọc nhân viên có phiên bất thường cần HR xác minh"
          >
            <div className="monthly-kpi-label">Phiên cần HR xác minh / rà soát</div>
            <div className="monthly-kpi-value">
              {summary.total_needs_review_sessions ?? summary.flagged_sessions ?? 0}{' '}
              <small style={{ fontSize: 13, fontWeight: 'normal' }}>phiên</small>
            </div>
            <div className="monthly-kpi-sub">
              Phiên ngắn ≤15p, lệch ca, thiếu checkout (Đã loại trừ khỏi trễ)
            </div>
          </div>

          {/* KPI 4: Nhân sự có dữ liệu công */}
          <div
            className={`monthly-kpi-card is-interactive ${quickStatus === 'ALL' ? 'is-active is-standard' : ''}`}
            onClick={() => {
              setQuickStatus('ALL')
              setSearchTerm('')
            }}
            title="Nhấp để xem toàn bộ danh sách nhân sự"
          >
            <div className="monthly-kpi-label">Nhân sự có dữ liệu công</div>
            <div className="monthly-kpi-value">
              {summary.with_attendance}{' '}
              <small
                style={{ fontSize: 13, fontWeight: 'normal', color: 'var(--text-tertiary)' }}
              >
                / {summary.total_employees} người
              </small>
            </div>
            <div className="monthly-kpi-sub">
              {summary.without_attendance} nhân sự chưa phát sinh phiên chấm
            </div>
          </div>

          {/* KPI 5: Nghỉ phép & OT đối soát */}
          <div className="monthly-kpi-card">
            <div className="monthly-kpi-label">Nghỉ phép &amp; OT đối soát</div>
            <div className="monthly-kpi-value">
              {summary.verified_ot_source_available === false
                ? '—'
                : (summary.total_verified_ot_hours ?? 0)}{' '}
              <small style={{ fontSize: 13, fontWeight: 'normal' }}>giờ OT</small>
            </div>
            <div className="monthly-kpi-sub">
              {summary.verified_ot_source_available === false
                ? 'Nguồn OT VERIFIED chưa được cài đặt; không thể xác nhận tổng giờ OT. · '
                : ''}
              {summary.total_paid_leave_days ?? 0}d phép có lương (AL) ·{' '}
              {summary.total_unpaid_leave_days ?? 0}d không lương (UL)
            </div>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-danger" style={{ margin: '12px 0' }}>
          {error}
        </p>
      )}

      {/* 4. Bảng chính phẳng 100% (hr-master-attendance-table) */}
      {loading ? (
        <div className="card hr-table-empty">
          <p>Đang tải dữ liệu bảng công đối soát…</p>
        </div>
      ) : (
        <section className="card hr-master-table-card">
          <div className="table-responsive">
            <table className="hr-master-attendance-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', minWidth: '210px' }}>NHÂN VIÊN</th>
                  <th style={{ textAlign: 'center', minWidth: '135px' }}>CÔNG &amp; GIỜ LÀM</th>
                  <th style={{ textAlign: 'center', minWidth: '175px' }} className="th-highlight-late">
                    ĐI TRỄ QUÁ HẠN (&gt;15P)
                  </th>
                  <th style={{ textAlign: 'center', minWidth: '130px' }}>VỀ SỚM HỢP LỆ</th>
                  <th style={{ textAlign: 'center', minWidth: '140px' }}>NGOÀI CA &amp; OT ĐỐI SOÁT</th>
                  <th style={{ textAlign: 'center', minWidth: '110px' }}>NGHỈ PHÉP</th>
                  <th style={{ textAlign: 'left', minWidth: '160px' }}>TRẠNG THÁI ĐÁNH GIÁ</th>
                  <th style={{ textAlign: 'center', minWidth: '155px' }} className="th-sticky-actions">THAO TÁC</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(p => {
                  const outsideHours = (
                    p.outside_schedule_hours ??
                    p.overtime_hours ??
                    0
                  ).toFixed(2)
                  const verifiedOt = (p.verified_ot_hours ?? 0).toFixed(2)
                  const verifiedOtKnown = p.verified_ot_source_available !== false
                  const reviewCount =
                    p.needs_review_session_count ?? p.flagged_sessions_count ?? 0
                  const lateDates = (p.late_dates && p.late_dates.length > 0)
                    ? p.late_dates.map((d: string) => {
                        const parts = d.split('-')
                        return parts.length === 3 ? `${parts[2]}/${parts[1]}` : d
                      })
                    : getValidLateDates(p.sessions || [])
                  const unreviewedLateMins = p.unreviewed_late_minutes ?? 0
                  const unreviewedEarlyMins = p.unreviewed_early_minutes ?? 0
                  const sessionTotal = p.sessions?.length || 0
                  const latePenalty = p.late_penalty_amount ?? (p.late_session_count || 0) * policySettings.penalty

                  return (
                    <tr key={p.employee_id} className="hr-master-row">
                      {/* Cột 1: NHÂN VIÊN */}
                      <td style={{ textAlign: 'left' }}>
                        <div className="hr-emp-cell">
                          <div className="hr-emp-line1">
                            {p.employee_code && (
                              <span className="hr-emp-code-badge">[{p.employee_code}]</span>
                            )}
                            <button
                              type="button"
                              className="hr-emp-name-btn"
                              onClick={() => setSelectedEmployeeForDetail(p)}
                              title="Bấm để xem chi tiết từng phiên"
                            >
                              {p.employee_name}
                            </button>
                            {reviewCount > 0 && (
                              <span
                                className="hr-emp-review-badge"
                                title="Có phiên bất thường loại trừ khỏi thống kê trễ, cần HR xác minh"
                              >
                                <AlertTriangle size={11} />
                                <span>{reviewCount} phiên rà soát</span>
                              </span>
                            )}
                          </div>
                          <div className="hr-emp-sub">
                            {p.store_name || 'Chi nhánh chưa gán'} · {p.department_name || 'Phòng ban'}
                          </div>
                        </div>
                      </td>

                      {/* Cột 2: CÔNG & GIỜ LÀM */}
                      <td style={{ textAlign: 'center' }}>
                        <div className="hr-hours-line1">
                          <strong>
                            {p.working_days ?? 0} / {p.standard_working_days ?? standardWorkingDays} công
                          </strong>
                        </div>
                        <div className="hr-sub-meta">
                          {(p.actual_work_hours ?? 0).toFixed(2)}h thực tế / {(p.scheduled_hours ?? 0).toFixed(2)}h ca
                          {p.scheduled_days !== undefined && ` (${p.scheduled_days} ca)`}
                        </div>
                      </td>

                      {/* Cột 3: ĐI TRỄ QUÁ HẠN (>15P) - Compact tối đa 3 dòng */}
                      <td style={{ textAlign: 'center' }} className="td-highlight-late">
                        <div className="hr-metric-unified-box">
                          {/* Dòng 1: Pill Số ngày trễ & badge tiền phạt nằm cùng hàng ngang */}
                          <div className="hr-metric-line1">
                            {p.late_day_count > 0 ? (
                              <span className="hr-pill-late-day">
                                {p.late_day_count} ngày trễ
                              </span>
                            ) : (
                              <span className="hr-pill-zero-day">0 ngày</span>
                            )}
                            {p.late_session_count > 0 && latePenalty > 0 && (
                              <span className="hr-penalty-pill">
                                -{formatCurrency(latePenalty)}
                              </span>
                            )}
                          </div>

                          {/* Dòng 2: Y lần phạt (Zp) · Ngày: DD/MM */}
                          <div className="hr-metric-line2">
                            {p.late_session_count > 0 ? (
                              <>
                                <strong>{p.late_session_count}</strong> lần ({p.verified_late_minutes ?? 0}p)
                                {lateDates.length > 0 && (
                                  <span className="hr-metric-dates-inline" title={`Chi tiết ngày: ${lateDates.join(', ')}`}>
                                    {' '}· Ngày: {lateDates.slice(0, 2).join(', ')}{lateDates.length > 2 ? ` (+${lateDates.length - 2})` : ''}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-muted" style={{ fontSize: '11px' }}>Không vi phạm</span>
                            )}
                          </div>

                          {/* Dòng 3: Kèm M lần ≤15p (0₫) và +Kp chờ rà soát */}
                          {((p.grace_late_session_count ?? 0) > 0 || unreviewedLateMins > 0) && (
                            <div className="hr-metric-line3">
                              {(p.grace_late_session_count ?? 0) > 0 && (
                                <span className="hr-grace-tag" title="Phiên trễ trong hạn 15 phút đầu ca được miễn phạt">
                                  Kèm {p.grace_late_session_count} lần ≤15p (0₫)
                                </span>
                              )}
                              {unreviewedLateMins > 0 && (
                                <span
                                  className="hr-metric-raw-diff"
                                  title="Phút trễ thô từ phiên bất thường cần HR rà soát"
                                >
                                  +{unreviewedLateMins}p thô chờ rà soát
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Cột 4: VỀ SỚM HỢP LỆ - Compact */}
                      <td style={{ textAlign: 'center' }}>
                        <div className="hr-metric-unified-box">
                          <div className="hr-metric-line1">
                            {p.early_day_count > 0 ? (
                              <span className="hr-pill-early-day">
                                {p.early_day_count} ngày sớm
                              </span>
                            ) : (
                              <span className="hr-pill-zero-day">0 ngày</span>
                            )}
                          </div>
                          <div className="hr-metric-line2">
                            {p.early_session_count > 0 ? (
                              <>
                                <strong>{p.early_session_count}</strong> phiên ({p.verified_early_minutes ?? 0}p)
                              </>
                            ) : (
                              <span className="text-muted" style={{ fontSize: '11px' }}>Không về sớm</span>
                            )}
                          </div>
                          {unreviewedEarlyMins > 0 && (
                            <div className="hr-metric-line3">
                              <span
                                className="hr-metric-raw-diff"
                                title="Phút sớm thô từ phiên bất thường cần HR rà soát"
                              >
                                +{unreviewedEarlyMins}p thô chờ rà soát
                              </span>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Cột 5: NGOÀI CA & OT ĐỐI SOÁT */}
                      <td style={{ textAlign: 'center' }}>
                        <div className="hr-ot-cell">
                          <div className="hr-ot-verified">
                            OT đối soát:{' '}
                            <strong
                              style={{
                                color: verifiedOtKnown && verifiedOt > 0 ? '#059669' : 'inherit',
                              }}
                              title={verifiedOtKnown
                                ? 'Chỉ tính khoảng VERIFIED hiện hành từ nguồn đối soát OT.'
                                : 'Nguồn đối soát OT VERIFIED chưa được cài đặt; chưa thể xác nhận số giờ.'}
                            >
                              {verifiedOtKnown ? `${verifiedOt}h` : '—'}
                            </strong>
                          </div>
                          <div className="hr-ot-raw" title="Tổng số giờ ghi nhận ngoài khung ca (chưa duyệt OT)">
                            Ngoài ca thô: {outsideHours}h
                          </div>
                        </div>
                      </td>

                      {/* Cột 6: NGHỈ PHÉP */}
                      <td style={{ textAlign: 'center' }}>
                        <div className="hr-leave-cell">
                          <div>
                            Có lương: <strong>{p.paid_leave_days ?? 0}d</strong>
                          </div>
                          <div className="hr-leave-unpaid">
                            Không lương: <strong>{p.unpaid_leave_days ?? 0}d</strong>
                          </div>
                        </div>
                      </td>

                      {/* Cột 7: TRẠNG THÁI ĐÁNH GIÁ */}
                      <td style={{ textAlign: 'left' }}>
                        <div className="summary-status-tags">
                          {p.late_day_count > 0 && (
                            <span className="summary-tag tag-late">
                              <AlertCircle size={12} />
                              <span>Đi trễ: {p.late_day_count} ngày (-{formatCurrency(latePenalty)})</span>
                            </span>
                          )}
                          {p.early_day_count > 0 && (
                            <span className="summary-tag tag-early">
                              <Clock size={12} />
                              <span>Về sớm: {p.early_day_count} ngày</span>
                            </span>
                          )}
                          {reviewCount > 0 && (
                            <span className="summary-tag tag-review">
                              <AlertTriangle size={12} />
                              <span>Cần HR rà soát: {reviewCount} phiên</span>
                            </span>
                          )}
                          {p.late_day_count === 0 &&
                            p.early_day_count === 0 &&
                            reviewCount === 0 && (
                              <span className="summary-tag tag-standard">
                                <Check size={12} />
                                <span>Đúng giờ / Đạt chuẩn</span>
                              </span>
                            )}
                        </div>
                      </td>

                      {/* Cột 8: THAO TÁC (ACTIONS) - Sticky column */}
                      <td style={{ textAlign: 'center' }} className="td-sticky-actions">
                        <div className="hr-actions-cell">
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm hr-btn-detail"
                            onClick={() => setSelectedEmployeeForDetail(p)}
                            title="Mở pop-up xem danh sách chi tiết các phiên chấm công"
                          >
                            <FileText size={13} />
                            <span>Chi tiết</span>
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline btn-sm hr-btn-pdf"
                            onClick={() => setSelectedEmployeeForPrint(p)}
                            title="Mở bảng xem trước & in bảng công cá nhân chuẩn A4"
                          >
                            <Printer size={13} />
                            <span>Xuất PDF</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {!filteredRows.length && (
            <div className="hr-table-empty">
              <p>Không có dữ liệu nhân sự phù hợp với điều kiện lọc hiện tại.</p>
              {(searchTerm || quickStatus !== 'ALL') && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setSearchTerm('')
                    setQuickStatus('ALL')
                  }}
                >
                  Xóa bộ lọc để xem tất cả
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {/* 5. POP-UP MODAL CHI TIẾT CÔNG NHÂN VIÊN */}
      {selectedEmployeeForDetail && (
        <EmployeeAttendanceDetailModal
          employee={selectedEmployeeForDetail}
          period={period}
          isAdmin={isAdmin}
          isStoreManager={isStoreManager}
          currentUser={user}
          onClose={() => setSelectedEmployeeForDetail(null)}
          onOpenPrint={() => {
            setSelectedEmployeeForPrint(selectedEmployeeForDetail)
          }}
          onViewRawSession={session => {
            setShowAdminRawJson(false)
            setSelectedSession(session)
          }}
          onSessionResolved={() => {
            setRefreshCount(c => c + 1)
          }}
        />
      )}

      {/* 6. POP-UP XEM TRƯỚC & XUẤT BẢNG CÔNG PDF CÁ NHÂN CHUẨN HRM */}
      {selectedEmployeeForPrint && (
        <EmployeeAttendancePrintModal
          employee={selectedEmployeeForPrint}
          period={period}
          standardWorkingDays={standardWorkingDays}
          onClose={() => setSelectedEmployeeForPrint(null)}
        />
      )}

      {/* 7. MODAL CHI TIẾT PHIÊN CHẤM CÔNG - z-index: 1200 */}
      {selectedSession && (
        <div
          className="raw-session-modal-overlay"
          style={{ zIndex: 1200 }}
          onClick={() => {
            setSelectedSession(null)
            setShowAdminRawJson(false)
          }}
        >
          <div className="raw-session-modal" onClick={e => e.stopPropagation()}>
            <div className="raw-session-modal-header">
              <h3 style={{ margin: 0, fontSize: 16 }}>
                Chi tiết ca làm việc phiên #{selectedSession.attendance_id}
              </h3>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setSelectedSession(null)
                  setShowAdminRawJson(false)
                }}
              >
                <X size={16} />
              </button>
            </div>
            <div className="raw-session-modal-body">
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 12,
                  marginBottom: 14,
                }}
              >
                <div>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
                    Ngày nghiệp vụ (work_date):
                  </span>
                  <div>
                    <strong>{formatDate(selectedSession.work_date)}</strong>
                  </div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
                    Ca làm việc:
                  </span>
                  <div>
                    <strong>
                      {selectedSession.shift_name ||
                        selectedSession.attendance_context?.actual?.shift_name ||
                        'Chưa xác định'}
                    </strong>
                  </div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
                    Giờ Check-in thực tế:
                  </span>
                  <div>
                    <strong>
                      {selectedSession.check_in_time
                        ? new Date(selectedSession.check_in_time).toLocaleString('vi-VN')
                        : '—'}
                    </strong>
                  </div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
                    Giờ Check-out thực tế:
                  </span>
                  <div>
                    <strong>
                      {selectedSession.check_out_time
                        ? new Date(selectedSession.check_out_time).toLocaleString('vi-VN')
                        : 'Chưa check-out'}
                    </strong>
                  </div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
                    Thời lượng &amp; Giờ công thực tế:
                  </span>
                  <div>
                    <strong>
                      {selectedSession.actual_work_hours !== undefined && selectedSession.actual_work_hours !== null
                        ? `${Number(selectedSession.actual_work_hours).toFixed(1)} giờ công`
                        : `${formatDurationMinutes(selectedSession.raw_duration_minutes)}`}
                    </strong>{' '}
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                      (Có mặt {formatDurationMinutes(selectedSession.raw_duration_minutes)})
                    </span>
                  </div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
                    Đối chiếu lịch ca (Schedule status):
                  </span>
                  <div>
                    <strong>
                      {scheduleLabels[selectedSession.schedule_status] ||
                        selectedSession.schedule_status}
                    </strong>
                  </div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
                    Phút trễ thô / Hợp lệ:
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <strong>{selectedSession.late_minutes ?? 0} phút</strong>
                    {selectedSession.is_valid_late ? (
                      <span className="badge badge-error" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <AlertCircle size={11} /> Hợp lệ (&gt;15p)
                      </span>
                    ) : (selectedSession.late_minutes ?? 0) > 0 && (selectedSession.late_minutes ?? 0) <= 15 ? (
                      <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <Clock size={11} /> Trong hạn ân hạn (≤15p · Miễn phạt)
                      </span>
                    ) : (
                      <span className="badge badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <AlertTriangle size={11} /> Chưa xác minh / Loại trừ
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
                    Phút sớm thô / Hợp lệ:
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <strong>{selectedSession.early_minutes ?? 0} phút</strong>
                    {selectedSession.is_valid_early ? (
                      <span className="badge badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <Clock size={11} /> Hợp lệ
                      </span>
                    ) : (
                      <span className="badge badge-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <AlertTriangle size={11} /> Chưa xác minh / Loại trừ
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
                    Trạng thái chất lượng:
                  </span>
                  <div>
                    <strong>{formatQualityStatus(selectedSession.session_quality_status)}</strong>
                  </div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
                    Các cờ cảnh báo:
                  </span>
                  <div>
                    <strong>
                      {selectedSession.quality_flags?.length
                        ? selectedSession.quality_flags.map((f: string) => formatQualityFlag(f)).join(', ')
                        : 'Không có'}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Khối Thông tin ca làm việc dạng text trực quan chuẩn HR/Manager */}
              {(() => {
                const ctx = selectedSession.attendance_context || {}
                const actualShift = ctx.actual || {}
                const scheduleStatus = ctx.schedule_status || selectedSession.schedule_status

                const shiftName = actualShift.shift_name || selectedSession.shift_name || 'Ca làm việc'
                const shiftId = actualShift.shift_id || selectedSession.shift_id
                const startTime =
                  actualShift.start_time?.slice(0, 5) ||
                  selectedSession.scheduled_start?.slice(0, 5) ||
                  '--:--'
                const endTime =
                  actualShift.end_time?.slice(0, 5) ||
                  selectedSession.scheduled_end?.slice(0, 5) ||
                  '--:--'
                const shiftHours =
                  actualShift.work_hours ??
                  selectedSession.scheduled_hours ??
                  (selectedSession.actual_work_hours || 0)

                let statusLabel = 'Chưa đối soát'
                let statusBadgeClass = 'badge-secondary'
                if (scheduleStatus === 'MATCHED') {
                  statusLabel = '✓ Đúng ca phân công (Khớp lịch)'
                  statusBadgeClass = 'badge-success'
                } else if (scheduleStatus === 'SHIFT_MISMATCH') {
                  statusLabel = '⚠️ Làm lệch phân ca quy định'
                  statusBadgeClass = 'badge-warning'
                } else if (scheduleStatus === 'UNSCHEDULED') {
                  statusLabel = '⚠️ Làm việc ngoài lịch phân ca'
                  statusBadgeClass = 'badge-warning'
                }

                return (
                  <div className="att-shift-info-card">
                    <div className="att-shift-info-header">
                      <span className="att-shift-info-title">
                        <Calendar size={15} color="#2563eb" />
                        Thông tin ca làm việc
                      </span>
                      <span className={`badge ${statusBadgeClass}`}>
                        {statusLabel}
                      </span>
                    </div>

                    <div className="att-shift-info-grid">
                      <div className="att-shift-info-item">
                        <span className="att-shift-info-label">Tên ca:</span>
                        <strong className="att-shift-info-val">
                          {shiftName} {shiftId ? `(#${shiftId})` : ''}
                        </strong>
                      </div>

                      <div className="att-shift-info-item">
                        <span className="att-shift-info-label">Giờ bắt đầu - Kết thúc:</span>
                        <strong className="att-shift-info-val">
                          {startTime} – {endTime}
                        </strong>
                      </div>

                      <div className="att-shift-info-item">
                        <span className="att-shift-info-label">Định mức giờ:</span>
                        <strong className="att-shift-info-val">
                          {shiftHours} giờ / ca
                        </strong>
                      </div>

                      <div className="att-shift-info-item">
                        <span className="att-shift-info-label">Trạng thái khớp lịch:</span>
                        <strong className="att-shift-info-val">
                          {statusLabel}
                        </strong>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* KHỐI JSON GỐC: Chỉ ADMIN mới xem được khi bấm nút 'Xem dữ liệu gốc' trong menu phụ */}
              {isAdmin && showAdminRawJson && (
                <div className="admin-raw-json-panel">
                  <div className="admin-raw-json-header">
                    <span className="admin-raw-json-title">
                      <Code size={13} color="#6366f1" />
                      Dữ liệu gốc (attendance_context payload - Chế độ Quản trị viên)
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowAdminRawJson(false)}
                      title="Đóng khối JSON"
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 2,
                        display: 'flex',
                        alignItems: 'center',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                  <pre className="admin-raw-json-pre">
                    {JSON.stringify(selectedSession.attendance_context || {}, null, 2)}
                  </pre>
                </div>
              )}
            </div>
            <div className="raw-session-modal-footer">
              {isAdmin && (
                <div className="admin-auxiliary-menu">
                  <button
                    type="button"
                    className="btn btn-outline btn-sm admin-raw-btn"
                    onClick={() => setShowAdminRawJson(v => !v)}
                    title="Menu phụ kỹ thuật dành riêng cho ADMIN"
                  >
                    <Code size={13} />
                    <span>{showAdminRawJson ? 'Ẩn dữ liệu gốc' : 'Xem dữ liệu gốc'}</span>
                  </button>
                </div>
              )}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setSelectedSession(null)
                  setShowAdminRawJson(false)
                }}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. Panel Đối soát OT Tháng */}
      <div style={{ marginTop: 28 }}>
        <MonthlyVerifiedOvertimePanel
          period={period}
          storeId={filters.store_id}
          employeeId={filters.employee_id}
          user={user}
          attendanceSessions={rows.flatMap((p: any) =>
            (p.sessions || []).map((s: any) => ({
              ...s,
              employee_name: p.employee_name,
              employee_code: p.employee_code,
              store_name: p.store_name,
              department_name: p.department_name,
            }))
          )}
        />
      </div>
    </div>
  )
}
