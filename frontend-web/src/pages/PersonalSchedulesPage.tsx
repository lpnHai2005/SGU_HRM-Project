import { useEffect, useState, useMemo, Fragment } from 'react'
import { api, employeeApi, overtimeRequestApi, userService } from '../services/api'
import { operationToday } from './ActivityPage'
import { OvertimeRequestDrawer } from '../components/schedule/OvertimeRequestDrawer'
import { overtimeStatusClass, overtimeStatusLabel } from '../components/schedule/overtimeDisplay'
import { Icons } from '../components/common/Icons'
import { EmptyState } from '../components/common/EmptyState'
import { StatCard } from '../components/common/StatCard'
import type { Lookups, OvertimeRequest } from '../types'
import './WorkSchedulesPage.css'

interface PersonalScheduleRow {
  schedule_id: number
  work_date: string
  shift_id: number
  shift_name: string
  start_time: string
  end_time: string
  store_name: string
}

interface StandardShiftItem {
  shift_id: number
  shift_name: string
  start_time: string
  end_time: string
  work_hours?: number
}

interface MergedOvertimeSlot {
  start: string
  end: string
  hours: number
  reasons: string[]
  statuses: string[]
  requestIds: number[]
}

const localDateStr = (d: Date) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const getWeekdayName = (dateStr: string) => {
  const d = new Date(dateStr)
  const days = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy']
  return days[d.getDay()]
}

const getShiftOrderRank = (shift: { shift_name?: string; shift_code?: string; shift_id?: number }) => {
  const name = (shift.shift_name || '').toLowerCase()
  const code = (shift.shift_code || '').toUpperCase()

  // Thứ tự yêu cầu: Ca sáng bán lẻ -> Ca chiều bán lẻ -> Ca hành chính văn phòng -> Ca toàn thời gian cuối tuần
  if (code === 'CA_SANG' || name.includes('sáng')) return 1
  if (code === 'CA_CHIEU' || name.includes('chiều')) return 2
  if (code === 'CA_HANH_CHINH' || name.includes('hành chính') || name.includes('văn phòng')) return 3
  if (code === 'CA_FULL' || name.includes('toàn thời gian') || name.includes('cuối tuần')) return 4
  return 10 + (shift.shift_id || 0)
}

const calculateShiftHours = (startTime?: string, endTime?: string) => {
  if (!startTime || !endTime) return 0
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)
  let diff = (eh * 60 + em) - (sh * 60 + sm)
  if (diff <= 0) diff += 24 * 60
  return diff / 60
}

// Hợp nhất (Merge) các khoảng OT trùng lặp hoặc chồng chéo thời gian trong cùng một ngày
const mergeOvertimeRequests = (requests: OvertimeRequest[]): MergedOvertimeSlot[] => {
  if (!requests.length) return []

  const parsed = requests.map(r => {
    const startStr = r.starts_at.slice(11, 16)
    const endStr = r.ends_at.slice(11, 16)
    const [sh, sm] = startStr.split(':').map(Number)
    const [eh, em] = endStr.split(':').map(Number)
    let sMin = sh * 60 + sm
    let eMin = eh * 60 + em
    if (eMin <= sMin) eMin += 24 * 60
    return {
      startMin: sMin,
      endMin: eMin,
      startStr,
      endStr,
      reason: r.reason,
      status: r.status,
      requestId: r.request_id
    }
  })

  parsed.sort((a, b) => a.startMin - b.startMin)

  const merged: MergedOvertimeSlot[] = []
  let cur = parsed[0]
  let curReasons = [cur.reason].filter(Boolean)
  let curStatuses = [cur.status]
  let curIds = [cur.requestId]

  for (let i = 1; i < parsed.length; i++) {
    const next = parsed[i]
    if (next.startMin <= cur.endMin) {
      if (next.endMin > cur.endMin) {
        cur.endMin = next.endMin
        cur.endStr = next.endStr
      }
      if (next.reason && !curReasons.includes(next.reason)) {
        curReasons.push(next.reason)
      }
      if (!curStatuses.includes(next.status)) {
        curStatuses.push(next.status)
      }
      curIds.push(next.requestId)
    } else {
      const hours = Math.round(((cur.endMin - cur.startMin) / 60) * 10) / 10
      merged.push({
        start: cur.startStr,
        end: cur.endStr,
        hours,
        reasons: curReasons,
        statuses: curStatuses,
        requestIds: curIds
      })
      cur = next
      curReasons = [cur.reason].filter(Boolean)
      curStatuses = [cur.status]
      curIds = [cur.requestId]
    }
  }

  const hours = Math.round(((cur.endMin - cur.startMin) / 60) * 10) / 10
  merged.push({
    start: cur.startStr,
    end: cur.endStr,
    hours,
    reasons: curReasons,
    statuses: curStatuses,
    requestIds: curIds
  })

  return merged
}

export function PersonalSchedulesPage({ user: providedUser }: { user?: any } = {}) {
  const user = providedUser || userService.get()
  const today = operationToday()
  const [selectedDate, setSelectedDate] = useState(() => today)
  const [view, setView] = useState<'calendar' | 'table'>('calendar')
  const [lookups, setLookups] = useState<Lookups | null>(null)
  const [rows, setRows] = useState<PersonalScheduleRow[]>([])
  const [overtimeRequests, setOvertimeRequests] = useState<OvertimeRequest[]>([])
  const [error, setError] = useState('')
  const [overtimeError, setOvertimeError] = useState('')
  const [notice, setNotice] = useState('')
  const [overtimeOpen, setOvertimeOpen] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [actionBusy, setActionBusy] = useState<number | null>(null)
  const [actionError, setActionError] = useState('')
  const [declineRequestId, setDeclineRequestId] = useState<number | null>(null)
  const [declineReason, setDeclineReason] = useState('')

  const roles: string[] = user?.roles || []
  const canCreateOwnRequest = Boolean(user?.employee_id && roles.includes('EMPLOYEE') && !roles.includes('STORE_MANAGER'))

  // Tải lookups danh mục ca làm việc
  useEffect(() => {
    let active = true
    employeeApi.getLookups()
      .then(res => { if (active) setLookups(res) })
      .catch(() => {})
    return () => { active = false }
  }, [])

  // Tính toán 7 ngày trong tuần theo selectedDate (Bắt đầu từ Thứ 2 đến Chủ nhật)
  const weekDays = useMemo(() => {
    const [y, m, d] = selectedDate.split('-').map(Number)
    const cur = new Date(y, m - 1, d)
    const dayOfWeek = cur.getDay() // 0 = Chủ nhật, 1 = Thứ 2...
    const diff = cur.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1)
    const monday = new Date(cur.setDate(diff))

    const dayNames = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
    const days: Array<{ date: string; dayName: string; dayNum: string; isToday: boolean }> = []

    for (let i = 0; i < 7; i++) {
      const target = new Date(monday)
      target.setDate(monday.getDate() + i)
      const ds = localDateStr(target)
      days.push({
        date: ds,
        dayName: dayNames[i],
        dayNum: `${String(target.getDate()).padStart(2, '0')}/${String(target.getMonth() + 1).padStart(2, '0')}`,
        isToday: ds === today
      })
    }
    return days
  }, [selectedDate, today])

  // Kỳ tháng cần tải (hỗ trợ cả trường hợp tuần giao thoa giữa 2 tháng)
  const neededPeriods = useMemo(() => {
    if (view === 'calendar') {
      const p1 = weekDays[0].date.slice(0, 7)
      const p2 = weekDays[6].date.slice(0, 7)
      return p1 === p2 ? [p1] : [p1, p2]
    }
    return [selectedDate.slice(0, 7)]
  }, [view, weekDays, selectedDate])

  // Tải danh sách ca cá nhân
  useEffect(() => {
    let live = true
    Promise.all(neededPeriods.map(p => api.get<PersonalScheduleRow[]>('/mobile-attendance/my-schedules', { period: p })))
      .then(results => {
        if (!live) return
        const map = new Map<number, PersonalScheduleRow>()
        results.flat().forEach(r => map.set(r.schedule_id, r))
        setRows(Array.from(map.values()))
        setError('')
      })
      .catch((requestError: unknown) => {
        if (live) setError(requestError instanceof Error ? requestError.message : 'Không tải được lịch làm việc.')
      })
    return () => { live = false }
  }, [neededPeriods])

  // Tải đăng ký OT
  useEffect(() => {
    if (!user?.employee_id) return
    let live = true
    const dateFrom = view === 'calendar' ? weekDays[0].date : `${selectedDate.slice(0, 7)}-01`
    const lastDayOfMonth = new Date(Number(selectedDate.slice(0, 4)), Number(selectedDate.slice(5, 7)), 0).getDate()
    const dateTo = view === 'calendar' ? weekDays[6].date : `${selectedDate.slice(0, 7)}-${String(lastDayOfMonth).padStart(2, '0')}`

    overtimeRequestApi.list({ date_from: dateFrom, date_to: dateTo, employee_id: Number(user.employee_id), limit: 200 })
      .then(value => { if (live) { setOvertimeRequests(value); setOvertimeError('') } })
      .catch((requestError: unknown) => { if (live) setOvertimeError(requestError instanceof Error ? requestError.message : 'Không tải được đăng ký OT.') })
    return () => { live = false }
  }, [view, weekDays, selectedDate, user?.employee_id, refresh])

  // Danh mục tất cả các ca (buổi) chuẩn của TechZone theo thứ tự:
  // 1. Ca sáng bán lẻ -> 2. Ca chiều bán lẻ -> 3. Ca hành chính văn phòng -> 4. Ca toàn thời gian cuối tuần
  const allShifts = useMemo(() => {
    const list: StandardShiftItem[] = lookups?.work_shifts && lookups.work_shifts.length > 0
      ? lookups.work_shifts.map(s => ({
          shift_id: s.shift_id,
          shift_name: s.shift_name,
          start_time: s.start_time,
          end_time: s.end_time,
          work_hours: calculateShiftHours(s.start_time, s.end_time)
        }))
      : [
          { shift_id: 1, shift_name: 'Ca sáng bán lẻ', start_time: '08:00:00', end_time: '16:00:00', work_hours: 7.0 },
          { shift_id: 2, shift_name: 'Ca chiều bán lẻ', start_time: '13:00:00', end_time: '21:00:00', work_hours: 8.0 },
          { shift_id: 4, shift_name: 'Ca hành chính văn phòng', start_time: '08:00:00', end_time: '17:00:00', work_hours: 8.0 },
          { shift_id: 3, shift_name: 'Ca toàn thời gian cuối tuần', start_time: '08:00:00', end_time: '21:00:00', work_hours: 11.0 },
        ]

    const map = new Map<number, StandardShiftItem>()
    list.forEach(s => map.set(s.shift_id, s))
    rows.forEach(r => {
      if (!map.has(r.shift_id)) {
        map.set(r.shift_id, {
          shift_id: r.shift_id,
          shift_name: r.shift_name,
          start_time: r.start_time,
          end_time: r.end_time,
          work_hours: calculateShiftHours(r.start_time, r.end_time)
        })
      }
    })
    const sorted = Array.from(map.values())
    sorted.sort((a, b) => getShiftOrderRank(a) - getShiftOrderRank(b))
    return sorted
  }, [lookups, rows])

  // Điều hướng kỳ / tuần
  const handlePrev = () => {
    if (view === 'calendar') {
      const [y, m, d] = selectedDate.split('-').map(Number)
      const cur = new Date(y, m - 1, d)
      cur.setDate(cur.getDate() - 7)
      setSelectedDate(localDateStr(cur))
    } else {
      const [y, m] = selectedDate.slice(0, 7).split('-').map(Number)
      const prev = new Date(y, m - 2, 1)
      setSelectedDate(localDateStr(prev))
    }
  }

  const handleNext = () => {
    if (view === 'calendar') {
      const [y, m, d] = selectedDate.split('-').map(Number)
      const cur = new Date(y, m - 1, d)
      cur.setDate(cur.getDate() + 7)
      setSelectedDate(localDateStr(cur))
    } else {
      const [y, m] = selectedDate.slice(0, 7).split('-').map(Number)
      const next = new Date(y, m, 1)
      setSelectedDate(localDateStr(next))
    }
  }

  const handleToday = () => {
    setSelectedDate(today)
  }

  // Xác nhận / Từ chối đề xuất OT từ cấp trên
  const confirmOvertime = async (requestId: number) => {
    setActionBusy(requestId)
    setActionError('')
    try {
      await overtimeRequestApi.employeeConfirm(requestId)
      setNotice(`Đã xác nhận đề xuất OT #${requestId}; request đã chuyển sang chờ HR duyệt.`)
      setRefresh(value => value + 1)
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : 'Không thể xác nhận đăng ký OT.')
    } finally {
      setActionBusy(null)
    }
  }

  const declineOvertime = async (requestId: number) => {
    setActionBusy(requestId)
    setActionError('')
    try {
      await overtimeRequestApi.employeeDecline(requestId, declineReason)
      setNotice(`Đã từ chối đề xuất OT #${requestId}.`)
      setDeclineRequestId(null)
      setDeclineReason('')
      setRefresh(value => value + 1)
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : 'Không thể từ chối đăng ký OT.')
    } finally {
      setActionBusy(null)
    }
  }

  // Thống kê giờ công tuần (cho view calendar)
  const weekStats = useMemo(() => {
    const weekDates = new Set(weekDays.map(w => w.date))
    const weekShifts = rows.filter(r => weekDates.has(r.work_date))
    const regularHours = Math.round(weekShifts.reduce((sum, r) => sum + calculateShiftHours(r.start_time, r.end_time), 0) * 10) / 10

    let otHours = 0
    let otCount = 0
    weekDays.forEach(d => {
      const dayOts = overtimeRequests.filter(r => r.work_date === d.date)
      const merged = mergeOvertimeRequests(dayOts)
      otCount += dayOts.length
      otHours += merged.reduce((s, m) => s + m.hours, 0)
    })
    otHours = Math.round(otHours * 10) / 10
    const totalHours = Math.round((regularHours + otHours) * 10) / 10

    return {
      shiftsCount: weekShifts.length,
      regularHours,
      otHours,
      otCount,
      totalHours
    }
  }, [weekDays, rows, overtimeRequests])

  // Thống kê giờ công tháng (cho view table)
  const monthStats = useMemo(() => {
    const currentMonth = selectedDate.slice(0, 7)
    const monthShifts = rows.filter(r => r.work_date.startsWith(currentMonth))
    const regularHours = Math.round(monthShifts.reduce((sum, r) => sum + calculateShiftHours(r.start_time, r.end_time), 0) * 10) / 10
    return {
      shiftsCount: monthShifts.length,
      regularHours
    }
  }, [rows, selectedDate])

  const todayShift = useMemo(() => {
    return rows.find(r => r.work_date === today)
  }, [rows, today])

  // Nhãn thời gian hiển thị trên toolbar
  const periodLabel = useMemo(() => {
    if (view === 'calendar') {
      const start = weekDays[0]
      const end = weekDays[6]
      const year = end.date.slice(0, 4)
      return `Tuần ${start.dayNum} – ${end.dayNum}/${year}`
    }
    const [y, m] = selectedDate.slice(0, 7).split('-')
    return `Tháng ${m}/${y}`
  }, [view, weekDays, selectedDate])

  return (
    <div className="page-container personal-schedules-container">
      {/* 1. Header Row chuẩn theo Vero Design System */}
      <header className="fund-header-row page-header" style={{ marginBottom: 16 }}>
        <div className="fund-header-title">
          <h1 className="page-title">Lịch ca &amp; Phân công</h1>
          <p className="page-subtitle">
            Thời khóa biểu phân ca theo buổi và đăng ký tăng ca TechZone (Chế độ xem cá nhân).
          </p>
        </div>
        <div className="fund-actions-bar">
          {canCreateOwnRequest && (
            <button type="button" className="btn btn-primary" onClick={() => setOvertimeOpen(true)}>
              {Icons.plus}
              <span>+ Đăng ký OT</span>
            </button>
          )}
        </div>
      </header>

      {/* 2. Mini KPI Summary Bar (Tối ưu cho cá nhân & Tổng hợp giờ công tuần/tháng) */}
      <div className="stat-grid-4 kpi-hover-grid" style={{ marginBottom: 16 }}>
        <StatCard
          icon={Icons.calendar}
          iconColor="blue"
          label={view === 'calendar' ? 'CA TRONG TUẦN' : 'TỔNG CA PHÂN CÔNG'}
          value={`${view === 'calendar' ? weekStats.shiftsCount : monthStats.shiftsCount} ca`}
          footerNote={view === 'calendar' ? periodLabel : `Kỳ ${selectedDate.slice(5, 7)}/${selectedDate.slice(0, 4)}`}
        />
        <StatCard
          icon={Icons.clockOutline}
          iconColor="blue"
          label={view === 'calendar' ? 'TỔNG GIỜ TRONG TUẦN' : 'TỔNG GIỜ DỰ KIẾN'}
          value={`${view === 'calendar' ? weekStats.totalHours : monthStats.regularHours} giờ`}
          footerNote={view === 'calendar' ? `${weekStats.regularHours}h ca chính + ${weekStats.otHours}h OT` : 'Theo lịch chuẩn phân công'}
        />
        <StatCard
          icon={Icons.user}
          iconColor={todayShift ? 'green' : 'amber'}
          label="CA HÔM NAY"
          value={todayShift ? todayShift.shift_name : 'Nghỉ'}
          footerNote={todayShift ? `${todayShift.start_time?.slice(0, 5)} – ${todayShift.end_time?.slice(0, 5)}` : 'Hôm nay không có ca'}
        />
        <StatCard
          icon={Icons.chart}
          iconColor={overtimeRequests.length > 0 ? 'amber' : 'blue'}
          label="ĐĂNG KÝ OT"
          value={`${overtimeRequests.length} đơn`}
          footerNote={overtimeRequests.length > 0 ? `${overtimeRequests.filter(r => ['APPROVED', 'CONFIRMED'].includes(r.status)).length} đơn đã duyệt` : 'Chưa có đăng ký'}
        />
      </div>

      {/* 3. Khối Card Lịch Phân Công (Dựa vào class="work-schedule-card") */}
      <section className="work-schedule-card">
        {/* Navigation Toolbar */}
        <div className="work-schedule-toolbar">
          <div className="toolbar-nav-group">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handlePrev}
              aria-label={view === 'calendar' ? 'Tuần trước' : 'Tháng trước'}
            >
              ‹ Trước
            </button>
            <strong className="toolbar-period-label">
              {periodLabel}
            </strong>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleNext}
              aria-label={view === 'calendar' ? 'Tuần sau' : 'Tháng sau'}
            >
              Sau ›
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleToday}
            >
              Hôm nay
            </button>
          </div>

          {/* View Mode Tabs: Lịch (Thời khóa biểu buổi) & DS (Danh sách) */}
          <div className="toolbar-view-tabs" role="tablist">
            <button
              type="button"
              className={`view-tab-btn ${view === 'calendar' ? 'active' : ''}`}
              onClick={() => setView('calendar')}
              title="Thời khóa biểu phân ca theo buổi (Tránh đi nhầm ca)"
            >
              Lịch
            </button>
            <button
              type="button"
              className={`view-tab-btn ${view === 'table' ? 'active' : ''}`}
              onClick={() => setView('table')}
              title="Danh sách ca làm việc dạng bảng"
            >
              DS
            </button>
          </div>
        </div>

        {notice && <p className="work-schedule-notice" role="status">{notice}</p>}
        {error && <p className="work-schedule-error" role="alert">{error}</p>}

        {/* Chế độ xem Lịch: Thời khóa biểu dạng Buổi theo class="calendar-week-container" */}
        {view === 'calendar' ? (
          <div className="calendar-week-container">
            <div className="calendar-week-table-wrap">
              <table className="calendar-week-table">
                <thead>
                  <tr>
                    <th className="week-col-shift-header">Ca làm việc / Buổi</th>
                    {weekDays.map(d => (
                      <th
                        key={d.date}
                        className={`week-col-header ${d.isToday ? 'is-today' : ''} ${d.date === selectedDate ? 'is-selected' : ''}`}
                        onClick={() => setSelectedDate(d.date)}
                        title={d.isToday ? 'Hôm nay' : undefined}
                      >
                        <div className="week-header-dayname">{d.dayName}</div>
                        <div className="week-header-daynum">{d.dayNum}</div>
                        {d.isToday && <span className="today-badge-pill">Hôm nay</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allShifts.map(shift => (
                    <tr key={shift.shift_id} className="week-shift-row">
                      <td className="week-shift-label-cell">
                        <div className="week-shift-title">{shift.shift_name}</div>
                        <div className="week-shift-hours mono">
                          {shift.start_time?.slice(0, 5)} – {shift.end_time?.slice(0, 5)}
                        </div>
                        <span className="week-shift-tag">{shift.work_hours || calculateShiftHours(shift.start_time, shift.end_time)}h</span>
                      </td>

                      {weekDays.map(d => {
                        const assigned = rows.find(r => r.work_date === d.date && r.shift_id === shift.shift_id)
                        const isToday = d.isToday

                        return (
                          <td
                            key={d.date}
                            className={`week-grid-cell ${isToday ? 'is-today-cell' : ''} ${assigned ? 'has-schedules' : 'is-empty'}`}
                          >
                            <div className="week-cell-content">
                              {assigned ? (
                                <div className="personal-week-card">
                                  <div className="personal-week-card-title">
                                    <span style={{ fontSize: '13px' }}>✓</span>
                                    <span>Được phân ca</span>
                                  </div>
                                  <div className="personal-week-card-store" title={assigned.store_name}>
                                    {assigned.store_name}
                                  </div>
                                </div>
                              ) : (
                                <div className="personal-week-empty-slot">
                                  —
                                </div>
                              )}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}

                  {/* Hàng dành riêng cho OT trong ngày (Gom nhóm không chồng chéo & Thẻ chữ nhật đồng bộ) */}
                  <tr key="row-overtime" className="week-shift-row week-shift-row-overtime">
                    <td className="week-shift-label-cell">
                      <div className="week-shift-title">OT trong ngày</div>
                      <div className="week-shift-hours">Tăng ca ngoài giờ</div>
                      <span className="week-shift-tag week-shift-tag--ot">OT</span>
                    </td>

                    {weekDays.map(d => {
                      const dayOts = overtimeRequests.filter(r => r.work_date === d.date)
                      const mergedOts = mergeOvertimeRequests(dayOts)

                      return (
                        <td
                          key={d.date}
                          className={`week-grid-cell week-grid-cell-overtime ${d.isToday ? 'is-today-cell' : ''}`}
                        >
                          <div className="week-cell-content">
                            {mergedOts.length > 0 ? (
                              <div className="personal-week-ot-list">
                                {mergedOts.map((ot, idx) => (
                                  <div key={`ot-${idx}`} className="personal-week-ot-card">
                                    <div className="personal-week-ot-header">
                                      <span className="personal-week-ot-pill">OT</span>
                                      <span className="mono">{ot.start}–{ot.end}</span>
                                      <span style={{ marginLeft: 'auto', fontSize: '0.72rem' }}>({ot.hours}h)</span>
                                    </div>
                                    {ot.reasons.length > 0 && (
                                      <div className="personal-week-ot-meta" title={ot.reasons.join(', ')}>
                                        {ot.reasons.join(', ')}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="personal-week-empty-slot">—</div>
                            )}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                </tbody>

                {/* Footer tổng hợp giờ công dự kiến trong tuần */}
                <tfoot>
                  <tr className="week-summary-row">
                    <td className="week-shift-label-cell" style={{ fontWeight: 700 }}>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 700 }}>Tổng giờ / ngày</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Ca chính + Làm thêm</div>
                    </td>
                    {weekDays.map(d => {
                      const dayShifts = rows.filter(r => r.work_date === d.date)
                      const shiftHours = dayShifts.reduce((sum, r) => sum + calculateShiftHours(r.start_time, r.end_time), 0)
                      const dayOts = mergeOvertimeRequests(overtimeRequests.filter(r => r.work_date === d.date))
                      const otHours = dayOts.reduce((sum, o) => sum + o.hours, 0)
                      const totalDayHours = Math.round((shiftHours + otHours) * 10) / 10

                      return (
                        <td
                          key={d.date}
                          className={`week-grid-cell week-summary-cell ${d.isToday ? 'is-today-cell' : ''}`}
                          style={{ textAlign: 'center', verticalAlign: 'middle', padding: '8px 4px' }}
                        >
                          {totalDayHours > 0 ? (
                            <div>
                              <div className="mono" style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--action-primary)' }}>
                                {totalDayHours}h
                              </div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: '2px', lineHeight: 1.2 }}>
                                {shiftHours > 0 && `${shiftHours}h`}
                                {shiftHours > 0 && otHours > 0 && ' + '}
                                {otHours > 0 && <span style={{ color: 'var(--status-warning, #d97706)', fontWeight: 600 }}>{otHours}h OT</span>}
                              </div>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>0h (Nghỉ)</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ) : (
          /* Chế độ xem Danh sách (DS View) bằng table-container */
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '220px' }}>Ngày &amp; Thứ</th>
                  <th>Ca làm việc</th>
                  <th style={{ width: '160px' }}>Khung giờ</th>
                  <th>Cửa hàng / Chi nhánh</th>
                  <th style={{ width: '130px', textAlign: 'center' }}>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const isToday = row.work_date === today
                  const isPast = row.work_date < today
                  const weekday = getWeekdayName(row.work_date)
                  const isWeekend = weekday === 'Chủ nhật' || weekday === 'Thứ Bảy'

                  return (
                    <tr key={row.schedule_id} style={isToday ? { background: 'color-mix(in srgb, var(--action-primary) 6%, transparent)' } : undefined}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span className="mono" style={{ fontWeight: 600 }}>
                            {row.work_date.split('-').reverse().join('/')}
                          </span>
                          <span style={{ fontSize: '0.8rem', color: isWeekend ? 'var(--status-warning)' : 'var(--text-secondary)' }}>
                            ({weekday})
                          </span>
                          {isToday && (
                            <span className="status-pill active" style={{ fontSize: '10px', padding: '1px 6px' }}>
                              Hôm nay
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <strong>{row.shift_name}</strong>
                      </td>
                      <td>
                        <span className="mono" style={{ fontWeight: 500, fontSize: '0.85rem' }}>
                          {row.start_time?.slice(0, 5)} – {row.end_time?.slice(0, 5)}
                        </span>
                      </td>
                      <td>{row.store_name}</td>
                      <td style={{ textAlign: 'center' }}>
                        {isPast ? (
                          <span className="status-pill completed">Đã qua</span>
                        ) : isToday ? (
                          <span className="status-pill active">Đang làm</span>
                        ) : (
                          <span className="status-pill pending">Sắp tới</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {!rows.length && !error && (
              <EmptyState
                icon={Icons.calendar}
                title="Không có lịch làm việc"
                description={`Chưa có ca làm việc nào được phân công trong kỳ tháng ${selectedDate.slice(5, 7)}/${selectedDate.slice(0, 4)}.`}
              />
            )}
          </div>
        )}
      </section>

      {/* 4. Section Đăng ký OT của tôi */}
      <section className="card personal-overtime-section" style={{ marginTop: 24, padding: 20 }} aria-label="Đăng ký OT của tôi">
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
          <div>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>Đăng ký OT của tôi</h2>
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              Đề xuất OT không làm thay đổi ca làm việc chính thức.
            </p>
          </div>
          {canCreateOwnRequest && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOvertimeOpen(true)}>
              {Icons.plus}
              <span>+ Đăng ký OT</span>
            </button>
          )}
        </header>

        {overtimeError && <p className="work-schedule-error" role="alert">{overtimeError}</p>}
        {actionError && <p className="work-schedule-error" role="alert">{actionError}</p>}

        {overtimeRequests.length ? (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '110px' }}>Mã đơn</th>
                  <th style={{ width: '130px' }}>Ngày</th>
                  <th style={{ width: '140px' }}>Thời gian</th>
                  <th>Lý do</th>
                  <th style={{ width: '160px' }}>Trạng thái</th>
                  <th style={{ width: '180px', textAlign: 'center' }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {overtimeRequests.map(request => (
                  <Fragment key={request.request_id}>
                    <tr>
                      <td className="mono" style={{ fontWeight: 600 }}>OT #{request.request_id}</td>
                      <td className="mono">{request.work_date.split('-').reverse().join('/')}</td>
                      <td className="mono">{request.starts_at.slice(11, 16)} – {request.ends_at.slice(11, 16)}</td>
                      <td>{request.reason}</td>
                      <td>
                        <span className={`calendar-overtime-chip ${overtimeStatusClass(request.status)}`}>
                          {overtimeStatusLabel(request.status)}
                        </span>
                      </td>
                      <td className="personal-overtime-actions" style={{ textAlign: 'center' }}>
                        {request.status === 'PENDING_EMPLOYEE_CONFIRMATION' ? (
                          <div style={{ display: 'inline-flex', gap: 6 }}>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              disabled={actionBusy === request.request_id}
                              onClick={() => void confirmOvertime(request.request_id)}
                            >
                              Xác nhận
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              disabled={actionBusy === request.request_id}
                              onClick={() => { setDeclineRequestId(request.request_id); setDeclineReason('') }}
                            >
                              Từ chối
                            </button>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                        )}
                      </td>
                    </tr>
                    {declineRequestId === request.request_id && (
                      <tr key={`decline-${request.request_id}`}>
                        <td colSpan={6}>
                          <div className="personal-overtime-decline" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--surface-subtle)', borderRadius: 'var(--radius-sm)' }}>
                            <label htmlFor={`decline-reason-${request.request_id}`} style={{ fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                              Lý do từ chối:
                            </label>
                            <input
                              id={`decline-reason-${request.request_id}`}
                              className="form-input"
                              style={{ flex: 1 }}
                              maxLength={1000}
                              placeholder="Nhập lý do từ chối (không bắt buộc)..."
                              value={declineReason}
                              onChange={event => setDeclineReason(event.target.value)}
                              disabled={actionBusy === request.request_id}
                            />
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => setDeclineRequestId(null)}
                              disabled={actionBusy === request.request_id}
                            >
                              Giữ đề xuất
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              onClick={() => void declineOvertime(request.request_id)}
                              disabled={actionBusy === request.request_id}
                            >
                              {actionBusy === request.request_id ? 'Đang gửi…' : 'Xác nhận từ chối'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !overtimeError && (
            <p className="day-overtime-empty" style={{ margin: '14px 0 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              Chưa có đăng ký OT trong kỳ này.
            </p>
          )
        )}
      </section>

      {/* 5. Drawer đăng ký OT */}
      {canCreateOwnRequest && (
        <OvertimeRequestDrawer
          isOpen={overtimeOpen}
          onClose={() => setOvertimeOpen(false)}
          user={user}
          employees={[]}
          lookups={null}
          initialDate={operationToday()}
          initialStoreId={user?.store_id ? Number(user.store_id) : undefined}
          fixedEmployeeId={Number(user.employee_id)}
          onSuccess={message => { setNotice(message); setRefresh(value => value + 1) }}
        />
      )}
    </div>
  )
}
