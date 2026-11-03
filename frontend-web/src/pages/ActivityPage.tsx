import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../services/api'
import { DatePicker } from '../components/common/DatePicker'
import { Icons } from '../components/common/Icons'
import { formatQualityFlag } from '../utils/formatters'
import { CreditCard, ShieldCheck } from 'lucide-react'
import {
  AttendanceResolutionModal,
  type DecisionType,
  type ShiftOption,
} from './EmployeeAttendanceDetailModal'
import './MonthlyAttendancePage.css'
import './ActivityPage.css'

export const operationToday = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

export const attendanceLabels: Record<string, string> = {
  NORMAL: 'Đúng giờ',
  LATE: 'Đi muộn',
  EARLY: 'Về sớm',
  LATE_AND_EARLY: 'Đi muộn & về sớm',
  OVERTIME: 'Giờ ngoài ca ghi nhận',
  ANNUAL_LEAVE: 'Nghỉ phép',
  UNPAID_LEAVE: 'Nghỉ không lương',
  SICK_LEAVE: 'Nghỉ ốm',
  MATERNITY_LEAVE: 'Nghỉ thai sản',
}

export const scheduleLabels: Record<string, string> = {
  MATCHED: 'Khớp ca',
  UNSCHEDULED: 'Ngoài lịch ca',
  SHIFT_MISMATCH: 'Sai ca phân công',
  LEGACY_UNKNOWN: 'Chưa có snapshot',
}

export const qualityLabels: Record<string, { label: string; className: string }> = {
  NORMAL: { label: 'Bình thường', className: 'badge-quality-normal' },
  SHORT_SESSION: { label: 'Phiên ngắn (≤15p)', className: 'badge-quality-short' },
  NEEDS_REVIEW: { label: 'Cần HR rà soát', className: 'badge-quality-review' },
  OUTSIDE_SHIFT: { label: 'Lệch khung ca', className: 'badge-quality-outside' },
  OPEN_SESSION: { label: 'Chưa check-out', className: 'badge-quality-open' },
}

/** Format duration into readable Hh Mm (e.g., 8h 00m, 8h 10m, 45m) */
export function formatDurationDetailed(minutes?: number | null): string {
  if (minutes === null || minutes === undefined) return '—'
  if (minutes === 0) return '0m'
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}m`
}

export function formatDurationMinutes(minutes?: number | null): string {
  return formatDurationDetailed(minutes)
}

export type ActivityProof = {
  proof_id: number
  check_type: 'CHECK_IN' | 'CHECK_OUT'
  latitude: number
  longitude: number
  distance_meters?: number | null
  radius_meters?: number | null
  verification_status: string
}

export type ActivitySession = {
  attendance_id: number
  work_date: string
  check_in_time?: string | null
  check_out_time?: string | null
  actual_work_hours?: number | null
  raw_duration_minutes?: number | null
  net_duration_minutes?: number | null
  break_minutes?: number | null
  scheduled_start?: string | null
  scheduled_end?: string | null
  scheduled_hours?: number | null
  late_minutes?: number | null
  early_minutes?: number | null
  is_valid_late?: boolean
  is_grace_late?: boolean
  is_valid_early?: boolean
  outside_schedule_hours?: number | null
  overtime_hours?: number | null
  has_verified_ot?: boolean
  verified_ot_hours?: number | null
  ot_request_id?: number | null
  ot_reconciliation_status?: string | null
  ot_request_status?: string | null
  status: string
  schedule_status: string
  shift_reconciliation?: string
  entry_evaluation?: string
  session_quality_status?: 'NORMAL' | 'SHORT_SESSION' | 'NEEDS_REVIEW' | 'OUTSIDE_SHIFT' | 'OPEN_SESSION'
  quality_flags?: string[]
  review_status?: string
  shift_name?: string | null
  shift_id?: number | null
  attendance_store_name?: string | null
  proofs?: ActivityProof[]
  review_decision?: string | null
  hr_review?: { reason?: string; version?: number; new_shift_id?: number } | null
  needs_hr_review?: boolean
  missing_proof?: boolean
}

export type Person = {
  employee_id: number
  employee_code?: string | null
  employee_name: string
  department_name?: string | null
  store_name?: string | null
  sessions: ActivitySession[]
  flagged_sessions_count?: number
  short_sessions_count?: number
}

export type ActivityData = {
  day?: string
  from_date?: string
  to_date?: string
  is_date_range?: boolean
  summary: Record<string, number>
  employees: Person[]
  late_tolerance_minutes?: number
  late_penalty_amount?: number
}

type ProofViewerData = {
  proof: ActivityProof
  employee: Person
  session: ActivitySession
}

function ProtectedProofImage({
  proofId,
  size,
  alt,
  zoom = 1,
}: {
  proofId: number
  size: 'thumb' | 'full'
  alt: string
  zoom?: number
}) {
  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)
  const [failureReason, setFailureReason] = useState('')

  useEffect(() => {
    let active = true
    let objectUrl = ''
    setSrc('')
    setFailed(false)
    setFailureReason('')
    api
      .getBlob(`/operations/activity/proofs/${proofId}`, { size })
      .then(blob => {
        if (!active) return
        if (!blob.type.startsWith('image/'))
          throw new Error('API không trả về dữ liệu ảnh hợp lệ.')
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      })
      .catch(reason => {
        if (!active) return
        const message =
          reason instanceof Error ? reason.message : 'Không tải được ảnh minh chứng.'
        if (import.meta.env.DEV)
          console.warn('[ActivityProof] image proxy request failed', {
            proofId,
            size,
            message,
          })
        setFailed(true)
        setFailureReason(message)
      })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [proofId, size])

  if (failed)
    return (
      <span
        className="activity-proof-fallback"
        role="img"
        aria-label="Không tải được ảnh"
        title={failureReason}
      >
        {Icons.imageOff}
        <small>{size === 'full' ? failureReason : 'Không tải được ảnh'}</small>
      </span>
    )
  if (!src)
    return (
      <span className="activity-proof-fallback" aria-label="Đang tải ảnh">
        {Icons.image}
        <small>Đang tải</small>
      </span>
    )
  return (
    <img
      src={src}
      alt={alt}
      onError={() => {
        if (import.meta.env.DEV)
          console.warn('[ActivityProof] browser could not decode image response', {
            proofId,
            size,
          })
        setFailed(true)
        setFailureReason(
          'Dữ liệu ảnh nhận được không đọc được. Hãy tải lại hoặc báo quản trị viên.'
        )
      }}
      style={size === 'full' ? { transform: `scale(${zoom})` } : undefined}
    />
  )
}

export function ActivityPage({
  user,
  personal = false,
}: {
  user: any
  personal?: boolean
}) {
  const [search] = useSearchParams()
  const todayStr = useMemo(() => operationToday(), [])

  // Date Filter Modes & Presets (Mục 8)
  const [dateMode, setDateMode] = useState<'single' | 'range'>('single')
  const [preset, setPreset] = useState<string>('today')
  const [day, setDay] = useState(todayStr)
  const [fromDate, setFromDate] = useState(todayStr)
  const [toDate, setToDate] = useState(todayStr)

  const [filters, setFilters] = useState({
    employee_id: '',
    department_id: '',
    store_id: '',
  })
  const [applied, setApplied] = useState({
    dateMode: 'single',
    day: todayStr,
    fromDate: todayStr,
    toDate: todayStr,
    ...filters,
  })

  const [group, setGroup] = useState('auto')
  const [kind, setKind] = useState(search.get('kind') || 'all')
  const [searchTerm, setSearchTerm] = useState('')
  const [data, setData] = useState<ActivityData | null>(null)
  const [options, setOptions] = useState<any>({
    employees: [],
    departments: [],
    stores: [],
  })
  const [error, setError] = useState('')
  const [viewer, setViewer] = useState<ProofViewerData | null>(null)
  const [zoom, setZoom] = useState(1)

  // HR Resolution State (ATT-UI-05B Mục 5)
  const [resolvingSession, setResolvingSession] = useState<any | null>(null)
  const [availableShifts, setAvailableShifts] = useState<ShiftOption[]>([])
  const [resolutionDecision, setResolutionDecision] = useState<DecisionType>('CONFIRMED_LATE')
  const [resolutionReason, setResolutionReason] = useState('')
  const [resolutionNewShiftId, setResolutionNewShiftId] = useState<number | ''>('')
  const [submittingResolution, setSubmittingResolution] = useState(false)
  const [resolutionError, setResolutionError] = useState('')
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  // Pre-fetch work shifts for resolution reassignment
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

  const isStoreManager = Boolean(
    (user?.roles?.includes('STORE_MANAGER') &&
      !user?.roles?.some((role: string) =>
        ['ADMIN', 'HR_MANAGER', 'DIRECTOR'].includes(role)
      )) ||
      user?.role === 'STORE_MANAGER'
  )
  // Chỉ HR và Giám đốc được xử lý phiên chấm công.
  const canResolveSession = Boolean(user?.roles?.some((role: string) => ['HR_MANAGER', 'DIRECTOR'].includes(role)))

  const handleOpenResolveSession = (session: ActivitySession) => {
    if (isStoreManager) {
      alert('Bạn không có quyền thao tác chức năng này')
      return
    }
    setResolvingSession(session)
    const existingDecision =
      session.review_decision && session.review_decision !== 'PENDING'
        ? (session.review_decision as DecisionType)
        : 'CONFIRMED_LATE'
    setResolutionDecision(existingDecision)
    setResolutionReason(session.hr_review?.reason || '')
    setResolutionNewShiftId(
      session.hr_review?.new_shift_id || session.shift_id || (availableShifts[0]?.shift_id ?? '')
    )
    setResolutionError('')
  }

  const handleExecuteResolution = async () => {
    if (isStoreManager) {
      alert('Bạn không có quyền thao tác chức năng này')
      return
    }
    if (!resolvingSession) return
    if (!resolutionReason.trim()) {
      setResolutionError('Lý do xác minh và tham chiếu căn cứ là bắt buộc.')
      return
    }
    if (resolutionDecision === 'SHIFT_REASSIGNED' && !resolutionNewShiftId) {
      setResolutionError('Vui lòng chọn ca làm việc thay thế.')
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

      const res = await api.post<{ success: boolean; updated_session: any }>(
        `/operations/attendance-sessions/${resolvingSession.attendance_id}/resolve`,
        payload
      )

      if (res.success) {
        setResolvingSession(null)
        setRefreshTrigger(prev => prev + 1)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi khi lưu quyết định xử lý phiên chấm công.'
      setResolutionError(msg)
    } finally {
      setSubmittingResolution(false)
    }
  }

  const manager =
    user?.roles?.some((role: string) =>
      ['ADMIN', 'DIRECTOR', 'HR_MANAGER', 'STORE_MANAGER'].includes(role)
    ) && !personal
  const storeOnly =
    user?.roles?.includes('STORE_MANAGER') &&
    !user.roles.some((role: string) =>
      ['ADMIN', 'HR_MANAGER', 'DIRECTOR'].includes(role)
    )

  // Fetch filter options
  useEffect(() => {
    let active = true
    api
      .get('/operations/filter-options')
      .then(value => {
        if (active) setOptions(value)
      })
      .catch(reason => {
        if (active) setError(reason.message)
      })
    return () => {
      active = false
    }
  }, [])

  // Apply Date Preset helper
  const handleSelectPreset = (newPreset: string) => {
    setPreset(newPreset)
    const now = new Date()

    if (newPreset === 'today') {
      setDateMode('single')
      setDay(todayStr)
      setFromDate(todayStr)
      setToDate(todayStr)
    } else if (newPreset === 'yesterday') {
      setDateMode('single')
      const yDate = new Date(now)
      yDate.setDate(yDate.getDate() - 1)
      const yStr = yDate.toLocaleDateString('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
      })
      setDay(yStr)
      setFromDate(yStr)
      setToDate(yStr)
    } else if (newPreset === '7days') {
      setDateMode('range')
      const start7 = new Date(now)
      start7.setDate(start7.getDate() - 6)
      const start7Str = start7.toLocaleDateString('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
      })
      setFromDate(start7Str)
      setToDate(todayStr)
    } else if (newPreset === 'this_month') {
      setDateMode('range')
      const y = now.getFullYear()
      const m = String(now.getMonth() + 1).padStart(2, '0')
      const startMStr = `${y}-${m}-01`
      setFromDate(startMStr)
      setToDate(todayStr)
    } else {
      setDateMode('range')
    }
  }

  // Fetch Activity Data
  useEffect(() => {
    let active = true
    setData(null)

    const params: Record<string, any> = {
      personal: !manager,
    }

    if (applied.dateMode === 'range') {
      params.from_date = applied.fromDate
      params.to_date = applied.toDate
    } else {
      params.day = applied.day
    }

    if (applied.employee_id) params.employee_id = applied.employee_id
    if (applied.department_id) params.department_id = applied.department_id
    if (applied.store_id) params.store_id = applied.store_id

    api
      .get<ActivityData>('/operations/activity', params)
      .then(value => {
        if (active) {
          setData(value)
          setError('')
        }
      })
      .catch(reason => {
        if (active) setError(reason.message)
      })

    return () => {
      active = false
    }
  }, [applied, manager, refreshTrigger])

  // Filter and Group employees & sessions
  const grouped = useMemo(() => {
    const result: Record<string, Person[]> = {}
    const isMultiDay = applied.dateMode === 'range' && applied.fromDate !== applied.toDate

    const mode =
      group === 'auto'
        ? applied.employee_id
          ? 'none'
          : applied.store_id || storeOnly
          ? applied.department_id
            ? 'employee'
            : 'department'
          : isMultiDay
          ? 'date'
          : 'store'
        : group

    for (const person of data?.employees || []) {
      // Search filter
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase()
        const matchesName = person.employee_name.toLowerCase().includes(q)
        const matchesCode = (person.employee_code || '').toLowerCase().includes(q)
        if (!matchesName && !matchesCode) continue
      }

      // Status filter
      if (
        kind === 'working' &&
        !person.sessions.some(s => s.check_in_time && !s.check_out_time)
      )
        continue
      if (
        kind === 'late' &&
        !person.sessions.some(s => s.is_valid_late || (s.late_minutes ?? 0) > 15)
      )
        continue
      if (
        kind === 'early' &&
        !person.sessions.some(s => s.is_valid_early || (s.early_minutes ?? 0) > 0)
      )
        continue
      if (
        kind === 'flagged' &&
        !person.sessions.some(
          s =>
            (s.session_quality_status && s.session_quality_status !== 'NORMAL') ||
            (s.quality_flags && s.quality_flags.length > 0)
        )
      )
        continue
      if (
        kind === 'short' &&
        !person.sessions.some(s => s.session_quality_status === 'SHORT_SESSION')
      )
        continue
      if (
        !['all', 'working', 'late', 'early', 'flagged', 'short'].includes(kind) &&
        !person.sessions.some(s => s.status === kind)
      )
        continue

      // Grouping keys
      if (mode === 'none') {
        ;(result['Danh sách tổng hợp'] ??= []).push(person)
      } else if (mode === 'employee') {
        const key = person.employee_code
          ? `[${person.employee_code}] ${person.employee_name}`
          : person.employee_name
        ;(result[key] ??= []).push(person)
      } else if (mode === 'department') {
        const key = person.department_name || 'Chưa có phòng ban'
        ;(result[key] ??= []).push(person)
      } else if (mode === 'date') {
        // Multi-day grouping: split person sessions by work_date
        const datesMap: Record<string, ActivitySession[]> = {}
        for (const s of person.sessions) {
          const dStr = s.work_date ? String(s.work_date).slice(0, 10) : 'Chưa có ngày'
          ;(datesMap[dStr] ??= []).push(s)
        }
        if (person.sessions.length === 0) {
          const emptyKey = applied.day || applied.fromDate
          ;(result[emptyKey] ??= []).push(person)
        } else {
          for (const [dStr, dSessions] of Object.entries(datesMap)) {
            const datePerson: Person = {
              ...person,
              sessions: dSessions,
            }
            ;(result[dStr] ??= []).push(datePerson)
          }
        }
      } else {
        // Default Store
        const key =
          `${person.store_name || 'Chưa có cửa hàng'}${
            group === 'auto' && !applied.department_id
              ? ' / ' + (person.department_name || 'Chưa có phòng ban')
              : ''
          }`
        ;(result[key] ??= []).push(person)
      }
    }
    return result
  }, [data, kind, group, applied, storeOnly, searchTerm])

  const time = (value?: string | null) =>
    value
      ? new Date(value).toLocaleTimeString('vi-VN', {
          timeZone: 'Asia/Ho_Chi_Minh',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '—'

  const openProof = (
    proof: ActivityProof,
    employee: Person,
    session: ActivitySession
  ) => {
    setZoom(1)
    setViewer({ proof, employee, session })
  }

  // Export CSV handler (Mục 8)
  const handleExportCsv = () => {
    if (!data?.employees?.length) {
      alert('Không có dữ liệu để xuất CSV.')
      return
    }

    const headers = [
      'Ngày',
      'Mã NV',
      'Họ và tên',
      'Cửa hàng',
      'Phòng ban',
      'Ca làm việc',
      'Khung giờ ca',
      'Check-in',
      'Check-out',
      'Thời lượng thô',
      'Giờ tính công',
      'Nghỉ giữa ca',
      'Trễ (phút)',
      'Sớm (phút)',
      'Ngoài ca (giờ)',
      'OT VERIFIED (giờ)',
      'Đối chiếu ca',
      'Đánh giá vào/ra',
      'Chất lượng phiên',
      'Cờ cảnh báo',
    ]

    const rows: string[][] = []

    for (const person of data.employees) {
      if (!person.sessions.length) {
        rows.push([
          applied.dateMode === 'range' ? `${applied.fromDate} đến ${applied.toDate}` : applied.day,
          person.employee_code || '',
          person.employee_name,
          person.store_name || '',
          person.department_name || '',
          'Chưa phân ca',
          '—',
          '—',
          '—',
          '—',
          '0',
          '0',
          '0',
          '0',
          '0',
          '0',
          '—',
          'Chưa chấm công',
          'Chưa chấm công',
          '',
        ])
      } else {
        for (const s of person.sessions) {
          const rawDuration = s.raw_duration_minutes
            ? formatDurationDetailed(s.raw_duration_minutes)
            : '—'
          const workHours = s.actual_work_hours !== null && s.actual_work_hours !== undefined
            ? `${Number(s.actual_work_hours).toFixed(1)}h`
            : '0h'
          const breakM = s.break_minutes != null ? `${s.break_minutes}p` : '—'
          const schedTime = s.scheduled_start && s.scheduled_end
            ? `${s.scheduled_start.slice(0, 5)} - ${s.scheduled_end.slice(0, 5)}`
            : '—'

          rows.push([
            s.work_date ? String(s.work_date).slice(0, 10) : applied.day,
            person.employee_code || '',
            person.employee_name,
            s.attendance_store_name || person.store_name || '',
            person.department_name || '',
            s.shift_name || 'Chưa gán ca',
            schedTime,
            s.check_in_time ? time(s.check_in_time) : '—',
            s.check_out_time ? time(s.check_out_time) : 'Chưa ra',
            rawDuration,
            workHours,
            breakM,
            String(s.late_minutes ?? 0),
            String(s.early_minutes ?? 0),
            String(s.outside_schedule_hours ?? s.overtime_hours ?? 0),
            String(s.verified_ot_hours ?? 0),
            s.shift_reconciliation || scheduleLabels[s.schedule_status] || s.schedule_status,
            s.entry_evaluation || 'Đúng giờ',
            qualityLabels[s.session_quality_status || 'NORMAL']?.label || 'Bình thường',
            (s.quality_flags || []).map((f: string) => formatQualityFlag(f)).join('; '),
          ])
        }
      }
    }

    const csvContent =
      '\uFEFF' +
      [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join(
        '\r\n'
      )

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `NhatKyChamCong_${applied.dateMode === 'range' ? `${applied.fromDate}_${applied.toDate}` : applied.day}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  // Summary Metrics from API
  const summary = data?.summary || {}

  return (
    <div className="page-container operations-page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, padding: 0, border: 'none' }}>
            Nhật ký làm việc &amp; Hoạt động
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
            Đối soát trực quan tình hình làm việc, tính giờ công thực tế và kiểm tra minh chứng theo ca
          </p>
        </div>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleExportCsv}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 38 }}
          title="Xuất bảng dữ liệu hiện hành ra file Excel CSV"
        >
          {Icons.download}
          <span>Xuất CSV</span>
        </button>
      </div>

      {/* BỘ LỌC THỜI GIAN & ĐỐI TƯỢNG (MỤC 8) */}
      <div className="card activity-filter-card">
        {/* Preset Range Selector */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div className="date-preset-pills">
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', marginRight: 4 }}>
              Kỳ tra cứu:
            </span>
            <button
              type="button"
              className={`date-preset-btn ${preset === 'today' ? 'is-active' : ''}`}
              onClick={() => handleSelectPreset('today')}
            >
              Hôm nay
            </button>
            <button
              type="button"
              className={`date-preset-btn ${preset === 'yesterday' ? 'is-active' : ''}`}
              onClick={() => handleSelectPreset('yesterday')}
            >
              Hôm qua
            </button>
            <button
              type="button"
              className={`date-preset-btn ${preset === '7days' ? 'is-active' : ''}`}
              onClick={() => handleSelectPreset('7days')}
            >
              7 ngày qua
            </button>
            <button
              type="button"
              className={`date-preset-btn ${preset === 'this_month' ? 'is-active' : ''}`}
              onClick={() => handleSelectPreset('this_month')}
            >
              Tháng này
            </button>
            <button
              type="button"
              className={`date-preset-btn ${preset === 'custom' ? 'is-active' : ''}`}
              onClick={() => handleSelectPreset('custom')}
            >
              Tùy chọn khoảng ngày
            </button>
          </div>

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
              Chế độ:{' '}
              <strong>{dateMode === 'range' ? 'Khoảng ngày (Tối đa 31 ngày)' : 'Một ngày'}</strong>
            </span>
          </div>
        </div>

        {/* Date Inputs & Dimension Filters */}
        <div className="date-inputs-row">
          {dateMode === 'single' ? (
            <DatePicker value={day} onChange={setDay} label="Ngày tham chiếu" />
          ) : (
            <>
              <DatePicker value={fromDate} onChange={setFromDate} label="Từ ngày" />
              <DatePicker value={toDate} onChange={setToDate} label="Đến ngày" />
            </>
          )}

          {manager &&
            (['employee_id', 'department_id', 'store_id'] as const).map(
              (key, index) => (
                <label key={key} className="filter-select-label">
                  <span className="form-label">{['Nhân viên', 'Phòng ban', 'Cửa hàng'][index]}</span>
                  <select
                    className="form-select"
                    value={
                      storeOnly && key === 'store_id'
                        ? String(user.store_id)
                        : filters[key]
                    }
                    disabled={storeOnly && key === 'store_id'}
                    onChange={event =>
                      setFilters({ ...filters, [key]: event.target.value })
                    }
                  >
                    <option value="">Tất cả</option>
                    {(index === 0
                      ? options.employees
                      : index === 1
                      ? options.departments
                      : options.stores
                    ).map((item: any) => (
                      <option
                        key={item.id || item.employee_id}
                        value={item.id || item.employee_id}
                      >
                        {item.name || item.full_name}
                      </option>
                    ))}
                  </select>
                </label>
              )
            )}

          <button
            type="button"
            className="btn btn-primary"
            onClick={() =>
              setApplied({
                dateMode,
                day,
                fromDate,
                toDate,
                ...filters,
              })
            }
          >
            Lọc dữ liệu
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              const empty = { employee_id: '', department_id: '', store_id: '' }
              setPreset('today')
              setDateMode('single')
              setDay(todayStr)
              setFromDate(todayStr)
              setToDate(todayStr)
              setFilters(empty)
              setApplied({
                dateMode: 'single',
                day: todayStr,
                fromDate: todayStr,
                toDate: todayStr,
                ...empty,
              })
              setGroup('auto')
              setKind('all')
              setSearchTerm('')
            }}
          >
            Đặt lại
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-danger" style={{ margin: '4px 0' }}>
          ⚠️ {error}
        </p>
      )}

      {/* DẢI 8 THẺ KPI CHUẨN 2 HÀNG (MỤC 7) */}
      <div className="kpi-8-grid">
        <div className="kpi-card" style={{ '--kpi-accent': '#2563eb' } as any}>
          <span className="kpi-card-title">Nhân viên theo lịch</span>
          <div className="kpi-card-value">
            {summary.scheduled_employees !== undefined ? summary.scheduled_employees : summary.total ?? '—'}
            <span className="kpi-card-unit">người</span>
          </div>
          <span className="kpi-card-subtext">Có ca phân công hợp lệ</span>
        </div>

        <div className="kpi-card" style={{ '--kpi-accent': '#059669' } as any}>
          <span className="kpi-card-title">Đã chấm công</span>
          <div className="kpi-card-value">
            {summary.checked_in ?? '—'}
            <span className="kpi-card-unit">người</span>
          </div>
          <span className="kpi-card-subtext">Đã phát sinh lượt check-in</span>
        </div>

        <div className="kpi-card" style={{ '--kpi-accent': '#0284c7' } as any}>
          <span className="kpi-card-title">Đang làm việc</span>
          <div className="kpi-card-value">
            {summary.working ?? '—'}
            <span className="kpi-card-unit">người</span>
          </div>
          <span className="kpi-card-subtext">Đang trong ca (chưa check-out)</span>
        </div>

        <div className="kpi-card" style={{ '--kpi-accent': '#94a3b8' } as any}>
          <span className="kpi-card-title">Chưa chấm công</span>
          <div className="kpi-card-value">
            {summary.not_checked_in ?? '—'}
            <span className="kpi-card-unit">người</span>
          </div>
          <span className="kpi-card-subtext">Thuộc lịch nhưng chưa vào ca</span>
        </div>

        <div className="kpi-card" style={{ '--kpi-accent': '#dc2626' } as any}>
          <span className="kpi-card-title">⚠️ Đi muộn</span>
          <div className="kpi-card-value">
            {summary.late_employees !== undefined ? summary.late_employees : summary.late ?? '—'}
            <span className="kpi-card-unit">người vi phạm</span>
          </div>
          <span className="kpi-card-subtext">
            {summary.late_sessions !== undefined ? `${summary.late_sessions} phiên đi muộn` : 'Chi tiết các phiên trễ'}
          </span>
        </div>

        <div className="kpi-card" style={{ '--kpi-accent': '#d97706' } as any}>
          <span className="kpi-card-title">⚠️ Về sớm</span>
          <div className="kpi-card-value">
            {summary.early_employees !== undefined ? summary.early_employees : summary.early ?? '—'}
            <span className="kpi-card-unit">người về sớm</span>
          </div>
          <span className="kpi-card-subtext">
            {summary.early_sessions !== undefined ? `${summary.early_sessions} phiên về sớm` : 'Chi tiết phiên sớm'}
          </span>
        </div>

        <div className="kpi-card" style={{ '--kpi-accent': '#e11d48' } as any}>
          <span className="kpi-card-title">⚠️ Phiên cần rà soát</span>
          <div className="kpi-card-value">
            {summary.flagged_sessions ?? '—'}
            <span className="kpi-card-unit">phiên</span>
          </div>
          <span className="kpi-card-subtext">Bất thường &amp; chờ HR xác minh</span>
        </div>

        <div className="kpi-card" style={{ '--kpi-accent': '#f59e0b' } as any}>
          <span className="kpi-card-title">⚠️ Phiên ngắn (≤15p)</span>
          <div className="kpi-card-value">
            {summary.short_sessions ?? '—'}
            <span className="kpi-card-unit">phiên</span>
          </div>
          <span className="kpi-card-subtext">Chỉ số theo dõi kỹ thuật</span>
        </div>
      </div>

      {/* TOOLBAR TÙY CHỌN HIỂN THỊ */}
      <div className="operations-toolbar" style={{ marginTop: 4 }}>
        <label>
          Tìm kiếm nhân viên
          <input
            type="text"
            className="form-input"
            placeholder="Tên hoặc mã nhân viên..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </label>

        <label>
          Nhóm dữ liệu theo
          <select
            className="form-select"
            value={group}
            onChange={event => setGroup(event.target.value)}
          >
            {Object.entries({
              auto: 'Tự động (Theo bối cảnh)',
              date: 'Ngày làm việc',
              store: 'Cửa hàng',
              department: 'Phòng ban',
              employee: 'Nhân viên',
              none: 'Không nhóm',
            }).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Bộ lọc trạng thái phiên
          <select
            className="form-select"
            value={kind}
            onChange={event => setKind(event.target.value)}
          >
            {Object.entries({
              all: 'Tất cả trạng thái',
              working: 'Đang làm việc (chưa ra)',
              late: 'Đi muộn (>15p)',
              early: 'Về sớm (>0p)',
              flagged: '⚠️ Có phiên cần rà soát',
              short: '⏱️ Phiên ngắn (≤15p)',
              ...attendanceLabels,
            }).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!data && !error && <p>Đang tải dữ liệu chấm công…</p>}
      {data && !Object.keys(grouped).length && (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)' }}>
          Không tìm thấy lượt chấm công nào phù hợp với bộ lọc đã chọn.
        </div>
      )}

      {/* DANH SÁCH NHÓM & BẢNG CHI TIẾT PHIÊN (MỤC 6) */}
      {Object.entries(grouped).map(([groupTitle, people]) => (
        <section className="card activity-group-card" key={groupTitle}>
          <div className="activity-date-group-title">
            <span>{groupTitle}</span>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-tertiary)' }}>
              {people.length} nhân viên · {people.reduce((acc, p) => acc + p.sessions.length, 0)} phiên
            </span>
          </div>

          {people.map(person => {
            const flaggedCount = person.sessions.filter(
              s =>
                (s.session_quality_status && s.session_quality_status !== 'NORMAL') ||
                (s.quality_flags && s.quality_flags.length > 0)
            ).length

            return (
              <details key={`${groupTitle}-${person.employee_id}`} open={!!applied.employee_id || people.length <= 5}>
                <summary>
                  <span className="activity-expand-indicator" aria-hidden="true">
                    {Icons.chevronRight}
                  </span>
                  <strong>
                    {person.employee_code ? `[${person.employee_code}] ` : ''}
                    {person.employee_name}
                  </strong>
                  {' · '}
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {person.store_name || 'Chưa gán CH'} · {person.department_name || 'Chưa gán PB'}
                  </span>
                  {' · '}
                  <span style={{ fontWeight: 600 }}>
                    {person.sessions.length} phiên
                    {person.sessions.length === 0 ? ' (Chưa phát sinh check-in)' : ''}
                  </span>

                  {flaggedCount > 0 && (
                    <span
                      className="person-flag-badge"
                      title={`${flaggedCount} phiên bất thường cần kiểm tra`}
                    >
                      ⚠️ {flaggedCount} phiên cần rà soát
                    </span>
                  )}
                </summary>

                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ width: 140 }}>Ca làm &amp; Khung giờ</th>
                        <th style={{ width: 65, textAlign: 'center' }}>Vào</th>
                        <th style={{ width: 65, textAlign: 'center' }}>Ra</th>
                        <th style={{ width: 130 }}>Thời lượng</th>
                        <th style={{ width: 75, textAlign: 'right' }}>Trễ</th>
                        <th style={{ width: 65, textAlign: 'right' }}>Sớm</th>
                        <th style={{ width: 85, textAlign: 'center' }}>Ngoài ca (ghi nhận)</th>
                        <th style={{ width: 115, textAlign: 'center' }}>OT đã VERIFIED</th>
                        <th style={{ width: 110, textAlign: 'center' }}>Đối chiếu ca</th>
                        <th style={{ width: 135, textAlign: 'center' }}>Đánh giá vào/ra</th>
                        <th style={{ width: 120, textAlign: 'center' }}>Chất lượng phiên</th>
                        <th style={{ width: 95, textAlign: 'center' }}>Minh chứng</th>
                      </tr>
                    </thead>
                    <tbody>
                      {person.sessions.map(session => {
                        const isLateViolation = Boolean(session.is_valid_late || (session.late_minutes && session.late_minutes > 15))
                        const isGraceLate = Boolean(session.is_grace_late || (session.late_minutes && session.late_minutes > 0 && session.late_minutes <= 15))
                        const isEarlyViolation = Boolean(session.is_valid_early || (session.early_minutes && session.early_minutes > 0))

                        let qualityLabel = 'Bình thường'
                        let qualityClass = 'badge-quality-normal'

                        if (session.session_quality_status && session.session_quality_status !== 'NORMAL') {
                          const qObj = qualityLabels[session.session_quality_status]
                          qualityLabel = qObj?.label || session.session_quality_status
                          qualityClass = qObj?.className || 'badge-quality-review'
                        } else if (isLateViolation) {
                          qualityLabel = `Đi trễ (${session.late_minutes}p)`
                          qualityClass = 'badge-quality-late'
                        } else if (isEarlyViolation) {
                          qualityLabel = `Về sớm (${session.early_minutes}p)`
                          qualityClass = 'badge-quality-early'
                        } else if (isGraceLate) {
                          qualityLabel = `Trễ ${session.late_minutes}p (Ân hạn)`
                          qualityClass = 'badge-quality-grace'
                        }

                        const rawDurationFmt = formatDurationDetailed(session.raw_duration_minutes)
                        const outsideHours = session.outside_schedule_hours ?? session.overtime_hours ?? 0
                        const breakMinutes = session.break_minutes

                        // Attendance hours follow the recorded check-in/check-out duration.
                        const workHoursText =
                          session.actual_work_hours !== null && session.actual_work_hours !== undefined
                            ? `${Number(session.actual_work_hours).toFixed(1)}h công`
                            : session.raw_duration_minutes
                            ? formatDurationDetailed(session.raw_duration_minutes)
                            : '0h'

                        // Shift reconciliation badge class
                        const reconcClass =
                          session.shift_reconciliation === 'Khớp ca'
                            ? 'badge-reconc-matched'
                            : session.shift_reconciliation === 'Sai ca phân công'
                            ? 'badge-reconc-mismatch'
                            : session.shift_reconciliation === 'Ngoài lịch ca'
                            ? 'badge-reconc-unscheduled'
                            : session.shift_reconciliation === 'Đã xác nhận đổi ca'
                            ? 'badge-reconc-reassigned'
                            : 'badge-reconc-unknown'

                        // Entry evaluation badge class
                        const evalText = session.entry_evaluation || 'Đúng giờ'
                        const evalClass = evalText.startsWith('Đi trễ')
                          ? 'badge-eval-late'
                          : evalText.includes('Ân hạn')
                          ? 'badge-eval-grace'
                          : evalText.startsWith('Về sớm')
                          ? 'badge-eval-early'
                          : evalText.includes('·')
                          ? 'badge-eval-mixed'
                          : evalText.includes('Chưa')
                          ? 'badge-eval-open'
                          : 'badge-eval-ontime'

                        return (
                          <tr key={session.attendance_id}>
                            {/* 1. Ca làm & Khung giờ */}
                            <td>
                              <div className="scheduled-shift-box">
                                <span className="scheduled-shift-title">
                                  {session.shift_name || 'Chưa gán ca'}
                                </span>
                                {session.scheduled_start && session.scheduled_end && (
                                  <span className="scheduled-shift-time">
                                    ({session.scheduled_start.slice(0, 5)} -{' '}
                                    {session.scheduled_end.slice(0, 5)})
                                  </span>
                                )}
                                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                  {session.attendance_store_name || person.store_name}
                                </span>
                              </div>
                            </td>

                            {/* 2. Giờ vào */}
                            <td style={{ textAlign: 'center', fontWeight: 600 }}>
                              {time(session.check_in_time)}
                            </td>

                            {/* 3. Giờ ra */}
                            <td style={{ textAlign: 'center', fontWeight: 600 }}>
                              {session.check_out_time ? time(session.check_out_time) : (
                                <span style={{ color: '#2563eb', fontSize: 11.5 }}>Chưa ra</span>
                              )}
                            </td>

                            {/* 4. Thời lượng: Thô + Tính công + Nghỉ */}
                            <td>
                              <div className="duration-box">
                                <span className="duration-raw">{rawDurationFmt}</span>
                                <span className="duration-work">
                                  Tính công: <strong>{workHoursText}</strong>
                                </span>
                                {breakMinutes != null && breakMinutes > 0 && (
                                  <span className="duration-break">
                                    Nghỉ theo ca (tham khảo): {formatDurationDetailed(breakMinutes)}
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* 5. Trễ */}
                            <td style={{ textAlign: 'right' }}>
                              {session.is_valid_late ? (
                                <span style={{ color: '#dc2626', fontWeight: 700 }}>
                                  Trễ {session.late_minutes}p
                                </span>
                              ) : (session.late_minutes ?? 0) > 0 && (session.late_minutes ?? 0) <= 15 ? (
                                <span style={{ color: '#059669', fontWeight: 600 }}>
                                  Trễ {session.late_minutes}p (Ân hạn)
                                </span>
                              ) : (session.late_minutes ?? 0) > 15 ? (
                                <span style={{ color: '#dc2626' }}>
                                  Trễ {session.late_minutes}p
                                </span>
                              ) : (
                                <span style={{ color: 'var(--text-tertiary)' }}>0p</span>
                              )}
                            </td>

                            {/* 6. Sớm */}
                            <td style={{ textAlign: 'right' }}>
                              {session.is_valid_early || (session.early_minutes ?? 0) > 0 ? (
                                <span style={{ color: '#d97706', fontWeight: 600 }}>
                                  Sớm {session.early_minutes}p
                                </span>
                              ) : (
                                <span style={{ color: 'var(--text-tertiary)' }}>0p</span>
                              )}
                            </td>

                            {/* 7. Ngoài ca ghi nhận (thực tế) */}
                            <td style={{ textAlign: 'center' }}>
                              {outsideHours > 0 ? (
                                <span className="outside-schedule-val">
                                  {outsideHours}h
                                </span>
                              ) : (
                                <span style={{ color: 'var(--text-tertiary)' }}>0h</span>
                              )}
                            </td>

                            {/* 8. OT đã VERIFIED */}
                            <td style={{ textAlign: 'center' }}>
                              {session.has_verified_ot && (session.verified_ot_hours ?? 0) > 0 ? (
                                <span
                                  className="badge-ot-verified"
                                  title={`Đơn OT #${session.ot_request_id} đã duyệt & đối soát VERIFIED`}
                                >
                                  ✓ {session.verified_ot_hours}h (VERIFIED)
                                </span>
                              ) : session.ot_request_id && session.ot_request_status === 'APPROVED' ? (
                                <span className="badge-ot-pending" title={`Đơn OT #${session.ot_request_id} đang chờ đối soát`}>
                                  Chờ đối soát
                                </span>
                              ) : (
                                <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                              )}
                            </td>

                            {/* 9. Đối chiếu ca (Nhóm A) */}
                            <td style={{ textAlign: 'center' }}>
                              <span className={`badge-reconc ${reconcClass}`}>
                                {session.shift_reconciliation ||
                                  scheduleLabels[session.schedule_status] ||
                                  session.schedule_status}
                              </span>
                            </td>

                            {/* 10. Đánh giá giờ vào/ra (Nhóm B) */}
                            <td style={{ textAlign: 'center' }}>
                              <span className={`badge-eval ${evalClass}`}>
                                {evalText}
                              </span>
                            </td>

                            {/* 11. Chất lượng phiên (Nhóm C) */}
                            <td style={{ textAlign: 'center' }}>
                              <div>
                                <span
                                  className={qualityClass}
                                  title={session.quality_flags?.map(f => formatQualityFlag(f)).join(', ') || ''}
                                >
                                  {qualityLabel}
                                </span>
                              </div>
                              {session.quality_flags && session.quality_flags.length > 0 && (
                                <div style={{ fontSize: '10px', color: 'var(--status-warning)', marginTop: 2 }}>
                                  {session.quality_flags.map(f => formatQualityFlag(f)).join(' · ')}
                                </div>
                              )}
                              {/* ATT-UI-05B Mục 5: Nút HR Xử lý cho các phiên bất thường */}
                              {manager &&
                                (session.session_quality_status === 'NEEDS_REVIEW' ||
                                  session.needs_hr_review ||
                                  (session.quality_flags && session.quality_flags.length > 0) ||
                                  session.session_quality_status === 'SHORT_SESSION' ||
                                  session.session_quality_status === 'OPEN_SESSION' ||
                                  isLateViolation) && (
                                  <div style={{ marginTop: 4 }}>
                                    <button
                                      type="button"
                                      className="hr-resolve-action-btn"
                                      onClick={() => {
                                        if (!canResolveSession) {
                                          alert('Bạn không có quyền thao tác chức năng này')
                                          return
                                        }
                                        handleOpenResolveSession(session)
                                      }}
                                      title={
                                        !canResolveSession
                                          ? 'Bạn không có quyền thao tác chức năng này'
                                          : 'HR Ra quyết định xử lý cho phiên chấm công này'
                                      }
                                      style={!canResolveSession ? { opacity: 0.65, cursor: 'not-allowed' } : undefined}
                                    >
                                      <ShieldCheck size={12} />
                                      <span>HR Xử lý</span>
                                    </button>
                                  </div>
                                )}
                            </td>

                            {/* 12. Minh chứng (ATT-UI-05B Mục 2) */}
                            <td style={{ textAlign: 'center' }}>
                              <div className="activity-proof-list" style={{ justifyContent: 'center' }}>
                                {(session.proofs || []).length ? (
                                  session.proofs?.map(proof => (
                                    <button
                                      type="button"
                                      className={`activity-proof-view ${
                                        proof.check_type === 'CHECK_IN'
                                          ? 'is-check-in'
                                          : 'is-check-out'
                                      }`}
                                      key={proof.proof_id}
                                      onClick={() => openProof(proof, person, session)}
                                      aria-label={
                                        proof.check_type === 'CHECK_IN'
                                          ? 'Xem ảnh check-in'
                                          : 'Xem ảnh check-out'
                                      }
                                      title={proof.check_type === 'CHECK_IN' ? 'Ảnh minh chứng Check-in' : 'Ảnh minh chứng Check-out'}
                                    >
                                      {Icons.eye}
                                      <span>{proof.check_type === 'CHECK_IN' ? 'Vào' : 'Ra'}</span>
                                    </button>
                                  ))
                                ) : session.missing_proof ? (
                                  <span
                                    className="activity-missing-proof-badge"
                                    title="Phiên chấm công thiếu minh chứng ảnh bắt buộc"
                                  >
                                    Thiếu minh chứng
                                  </span>
                                ) : (
                                  <span
                                    className="activity-card-proof-badge"
                                    title="Chấm công qua thiết bị thẻ từ / vân tay tại cửa hàng"
                                  >
                                    <CreditCard size={12} />
                                    <span>Chấm qua thẻ</span>
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            )
          })}
        </section>
      ))}

      {/* MODAL XEM ẢNH MINH CHỨNG & THÔNG TIN ĐỐI SOÁT */}
      {viewer && (
        <div
          className="activity-proof-overlay"
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setViewer(null)
          }}
        >
          <section
            className="activity-proof-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="activity-proof-title"
          >
            <header>
              <div>
                <h2 id="activity-proof-title">Minh chứng chấm công</h2>
                <p>
                  {viewer.proof.check_type === 'CHECK_IN' ? 'Check-in' : 'Check-out'} ·{' '}
                  {viewer.employee.employee_name}
                </p>
              </div>
              <button
                type="button"
                className="activity-proof-close"
                onClick={() => setViewer(null)}
                aria-label="Đóng"
              >
                {Icons.close}
              </button>
            </header>
            <div className="activity-proof-content">
              <div className="activity-proof-image-pane">
                <ProtectedProofImage
                  proofId={viewer.proof.proof_id}
                  size="full"
                  alt="Ảnh minh chứng chấm công"
                  zoom={zoom}
                />
              </div>
              <aside className="activity-proof-details">
                <h3>Chi tiết đối soát phiên làm việc</h3>
                <dl>
                  <dt>Nhân viên</dt>
                  <dd>
                    <strong className="activity-proof-employee">
                      {viewer.employee.employee_code ? `[${viewer.employee.employee_code}] ` : ''}
                      {viewer.employee.employee_name}
                    </strong>
                  </dd>

                  <dt>Ca làm quy định</dt>
                  <dd>
                    {viewer.session.shift_name || 'Chưa gán ca'}
                    {viewer.session.scheduled_start &&
                      viewer.session.scheduled_end &&
                      ` (${viewer.session.scheduled_start.slice(0, 5)} - ${viewer.session.scheduled_end.slice(0, 5)})`}
                  </dd>

                  <dt>Thời gian thực tế</dt>
                  <dd>
                    Vào: <strong>{time(viewer.session.check_in_time)}</strong> · Ra:{' '}
                    <strong>{time(viewer.session.check_out_time)}</strong>
                  </dd>

                  <dt>Thời lượng &amp; Giờ công</dt>
                  <dd>
                    Có mặt: {formatDurationDetailed(viewer.session.raw_duration_minutes)} · Tính công:{' '}
                    <strong>
                      {viewer.session.actual_work_hours !== null && viewer.session.actual_work_hours !== undefined
                        ? `${viewer.session.actual_work_hours} giờ`
                        : '0 giờ'}
                    </strong>
                  </dd>

                  <dt>A. Đối chiếu ca</dt>
                  <dd>
                    <span className="badge-reconc badge-reconc-matched">
                      {viewer.session.shift_reconciliation ||
                        scheduleLabels[viewer.session.schedule_status] ||
                        viewer.session.schedule_status}
                    </span>
                  </dd>

                  <dt>B. Đánh giá giờ vào/ra</dt>
                  <dd>
                    <strong>{viewer.session.entry_evaluation || 'Đúng giờ'}</strong>
                  </dd>

                  <dt>C. Chất lượng phiên</dt>
                  <dd>
                    <span
                      className={
                        qualityLabels[viewer.session.session_quality_status || 'NORMAL']?.className ||
                        'badge-quality-normal'
                      }
                    >
                      {qualityLabels[viewer.session.session_quality_status || 'NORMAL']?.label ||
                        'Bình thường'}
                    </span>
                    {viewer.session.quality_flags && viewer.session.quality_flags.length > 0 && (
                      <div style={{ fontSize: '11px', color: 'var(--status-warning)', marginTop: 4 }}>
                        Cờ: {viewer.session.quality_flags.map(f => formatQualityFlag(f)).join(', ')}
                      </div>
                    )}
                  </dd>

                  <dt>Tọa độ GPS thiết bị</dt>
                  <dd>
                    {viewer.proof.latitude.toFixed(6)}, {viewer.proof.longitude.toFixed(6)}
                  </dd>
                  {viewer.proof.distance_meters !== null && viewer.proof.distance_meters !== undefined && (
                    <>
                      <dt>Khoảng cách kiểm tra</dt>
                      <dd>
                        {Math.round(viewer.proof.distance_meters)}m (bán kính cho phép: {viewer.proof.radius_meters || 100}m)
                      </dd>
                    </>
                  )}
                </dl>
              </aside>
            </div>
            <footer>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setZoom(value => Math.max(0.75, value - 0.25))}
              >
                {Icons.zoomOut} Thu nhỏ
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setZoom(value => Math.min(2.5, value + 0.25))}
              >
                {Icons.zoomIn} Phóng to
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setViewer(null)}
              >
                Đóng
              </button>
            </footer>
          </section>
        </div>
      )}

      {/* HR Resolution Modal (ATT-UI-05B Item 5) */}
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
          onSubmit={handleExecuteResolution}
        />
      )}
    </div>
  )
}

