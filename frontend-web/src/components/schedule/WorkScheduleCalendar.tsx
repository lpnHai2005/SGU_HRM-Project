import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icons } from '../common/Icons'
import type { WorkSchedule, Lookups } from '../../types'
import type { OvertimeRequest } from '../../types'
import { overtimeCompactStatusLabel, overtimeStatusClass, overtimeStatusLabel } from './overtimeDisplay'

export interface WorkScheduleCalendarProps {
  view: 'month' | 'week' | 'day'
  selectedDate: string // YYYY-MM-DD
  schedules: WorkSchedule[]
  overtimeRequests: OvertimeRequest[]
  lookups: Lookups | null
  showSunday: boolean
  user: any
  onSelectDate: (date: string) => void
  onSelectView: (view: 'month' | 'week' | 'day') => void
  onOpenDrawer: (date?: string, shiftId?: number) => void
  onEditSchedule: (schedule: WorkSchedule) => void
  onCancelSchedule: (schedule: WorkSchedule) => void
  canCreateOvertime: boolean
  onOpenOvertimeDrawer: (date: string, employeeId?: number, storeId?: number) => void
}

const displayTime = (v: string) => v ? v.slice(0, 5) : ''

const localDateStr = (d: Date) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function WorkScheduleCalendar({
  view,
  selectedDate,
  schedules,
  overtimeRequests,
  lookups,
  showSunday,
  user,
  onSelectDate,
  onSelectView,
  onOpenDrawer,
  onEditSchedule,
  onCancelSchedule,
  canCreateOvertime,
  onOpenOvertimeDrawer,
}: WorkScheduleCalendarProps) {
  const navigate = useNavigate()
  const [hoveredCell, setHoveredCell] = useState<{ date: string; shiftId: number } | null>(null)

  // Standard shifts (4 shifts)
  const standardShifts = useMemo(() => {
    if (lookups?.work_shifts && lookups.work_shifts.length > 0) {
      return lookups.work_shifts
    }
    return [
      { shift_id: 1, shift_name: 'Ca Sáng', start_time: '08:00:00', end_time: '16:00:00', work_hours: 7.0 },
      { shift_id: 2, shift_name: 'Ca Chiều', start_time: '13:00:00', end_time: '21:00:00', work_hours: 7.0 },
      { shift_id: 3, shift_name: 'Ca Full cuối tuần', start_time: '08:00:00', end_time: '21:00:00', work_hours: 11.0 },
      { shift_id: 4, shift_name: 'Ca Hành chính', start_time: '08:00:00', end_time: '17:00:00', work_hours: 8.0 },
    ]
  }, [lookups])

  // Current today string
  const todayStr = useMemo(
    () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }),
    []
  )

  // Map schedules by date and shift
  const schedulesByDateAndShift = useMemo(() => {
    const map = new Map<string, WorkSchedule[]>()
    for (const s of schedules) {
      const key = `${s.work_date}__${s.shift_id}`
      const list = map.get(key) || []
      list.push(s)
      map.set(key, list)
    }
    return map
  }, [schedules])

  // Map schedules by date
  const schedulesByDate = useMemo(() => {
    const map = new Map<string, WorkSchedule[]>()
    for (const s of schedules) {
      const list = map.get(s.work_date) || []
      list.push(s)
      map.set(s.work_date, list)
    }
    return map
  }, [schedules])

  const overtimeByDate = useMemo(() => {
    const map = new Map<string, OvertimeRequest[]>()
    for (const request of overtimeRequests) {
      if (['REVOKED', 'REPLACED', 'REJECTED', 'EMPLOYEE_DECLINED', 'CANCELLED'].includes(request.status)) continue
      const list = map.get(request.work_date) || []
      list.push(request)
      map.set(request.work_date, list)
    }
    return map
  }, [overtimeRequests])

  const overtimeChip = (request: OvertimeRequest, compact = false) => (
    <button key={request.request_id} type="button" className={`calendar-overtime-chip ${overtimeStatusClass(request.status)} ${compact ? 'is-compact' : ''}`}
      aria-label={`Mở đơn OT ${request.request_id}: ${request.employee_name}, ${overtimeStatusLabel(request.status)}`}
      title={`OT #${request.request_id} · ${request.employee_name} · ${request.starts_at.slice(11, 16)}–${request.ends_at.slice(11, 16)} · ${overtimeStatusLabel(request.status)}`}
      data-overtime-request-id={request.request_id}
      onClick={event => {
        event.stopPropagation()
        const roles: string[] = user?.roles || []
        const isStandaloneEmployee = roles.includes('EMPLOYEE')
          && !roles.some(role => ['ADMIN', 'HR_MANAGER', 'STORE_MANAGER', 'DIRECTOR'].includes(role))
        navigate(`${isStandaloneEmployee ? '/my-overtime' : '/overtime'}?request_id=${request.request_id}`)
      }}>
      <strong>{compact ? 'OT' : request.employee_name}</strong>
      <span>{request.starts_at.slice(11, 16)}–{request.ends_at.slice(11, 16)}</span>
      <small>{compact ? overtimeCompactStatusLabel(request.status) : overtimeStatusLabel(request.status)} · #{request.request_id}</small>
    </button>
  )

  // --- Week Days calculation ---
  const weekDays = useMemo(() => {
    const [y, m, d] = selectedDate.split('-').map(Number)
    const cur = new Date(y, m - 1, d)
    // Monday is start of week
    const dayOfWeek = cur.getDay() // 0 = Sun, 1 = Mon ...
    const diff = cur.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1)
    const monday = new Date(cur.setDate(diff))

    const count = showSunday ? 7 : 6
    const days: Array<{ date: string; dayName: string; dayNum: string; isToday: boolean }> = []
    const dayNames = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

    for (let i = 0; i < count; i++) {
      const target = new Date(monday)
      target.setDate(monday.getDate() + i)
      const ds = localDateStr(target)
      days.push({
        date: ds,
        dayName: dayNames[i],
        dayNum: `${target.getDate()}/${target.getMonth() + 1}`,
        isToday: ds === todayStr,
      })
    }
    return days
  }, [selectedDate, showSunday, todayStr])

  // --- Month Grid calculation ---
  const monthGrid = useMemo(() => {
    const [y, m] = selectedDate.split('-').map(Number)
    const firstDay = new Date(y, m - 1, 1)
    const lastDay = new Date(y, m, 0)
    const daysInMonth = lastDay.getDate()

    // 0 = Sun, 1 = Mon ...
    let startDayOfWeek = firstDay.getDay()
    // adjust so Monday is index 0
    startDayOfWeek = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1

    const cells: Array<{
      date: string
      dayNumber: number
      isCurrentMonth: boolean
      isToday: boolean
    }> = []

    // Previous month padding
    const prevMonthLastDay = new Date(y, m - 1, 0).getDate()
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const prevDate = new Date(y, m - 2, prevMonthLastDay - i)
      const ds = localDateStr(prevDate)
      cells.push({
        date: ds,
        dayNumber: prevMonthLastDay - i,
        isCurrentMonth: false,
        isToday: ds === todayStr,
      })
    }

    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
      const curDate = new Date(y, m - 1, i)
      const ds = localDateStr(curDate)
      cells.push({
        date: ds,
        dayNumber: i,
        isCurrentMonth: true,
        isToday: ds === todayStr,
      })
    }

    // Next month padding to fill weeks (up to 35 or 42 cells)
    const remaining = (7 - (cells.length % 7)) % 7
    for (let i = 1; i <= remaining; i++) {
      const nextDate = new Date(y, m, i)
      const ds = localDateStr(nextDate)
      cells.push({
        date: ds,
        dayNumber: i,
        isCurrentMonth: false,
        isToday: ds === todayStr,
      })
    }

    return cells
  }, [selectedDate, todayStr])

  // =========================================================================
  // RENDER: WEEK VIEW
  // =========================================================================
  if (view === 'week') {
    return (
      <div className="calendar-week-container">
        <div className="calendar-week-table-wrap">
          <table className="calendar-week-table">
            <thead>
              <tr>
                <th className="week-col-shift-header">Ca làm việc</th>
                {weekDays.map(d => (
                  <th
                    key={d.date}
                    className={`week-col-header ${d.isToday ? 'is-today' : ''} ${d.date === selectedDate ? 'is-selected' : ''}`}
                    onClick={() => onSelectDate(d.date)}
                  >
                    <div className="week-header-dayname">{d.dayName}</div>
                    <div className="week-header-daynum">{d.dayNum}</div>
                    {d.isToday && <span className="today-indicator-dot" title="Hôm nay" />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {standardShifts.map(shift => (
                <tr key={shift.shift_id} className="week-shift-row">
                  <td className="week-shift-label-cell">
                    <div className="week-shift-title">{shift.shift_name}</div>
                    <div className="week-shift-hours">
                      {displayTime(shift.start_time)} – {displayTime(shift.end_time)}
                    </div>
                    <span className="week-shift-tag">{shift.work_hours}h</span>
                  </td>

                  {weekDays.map(d => {
                    const cellKey = `${d.date}__${shift.shift_id}`
                    const cellSchedules = schedulesByDateAndShift.get(cellKey) || []
                    const activeCount = cellSchedules.filter(s => !s.cancelled_at).length
                    const cellOvertime = overtimeByDate.get(d.date) || []
                    const isHovered = hoveredCell?.date === d.date && hoveredCell?.shiftId === shift.shift_id

                    return (
                      <td
                        key={d.date}
                        className={`week-grid-cell ${d.isToday ? 'is-today-cell' : ''} ${cellSchedules.length > 0 ? 'has-schedules' : 'is-empty'}`}
                        onMouseEnter={() => setHoveredCell({ date: d.date, shiftId: shift.shift_id })}
                        onMouseLeave={() => setHoveredCell(null)}
                      >
                        <div className="week-cell-content">
                          {activeCount > 0 ? (
                            <>
                              <div className="week-cell-badge-row">
                                <span className="week-cell-count-pill" title={`${activeCount} nhân viên được phân ca`}>
                                  {Icons.users} {activeCount} NV
                                </span>
                                <button
                                  type="button"
                                  className="cell-add-mini-btn"
                                  title={`Phân thêm nhân viên vào ${shift.shift_name} (${d.dayName} ${d.dayNum})`}
                                  onClick={e => {
                                    e.stopPropagation()
                                    onOpenDrawer(d.date, shift.shift_id)
                                  }}
                                >
                                  +
                                </button>
                              </div>

                              <div className="week-cell-emp-list">
                                {cellSchedules.slice(0, 3).map(s => {
                                  const isFixed = Boolean(s.fixed_rule_id)
                                  return (
                                    <div
                                      key={s.schedule_id}
                                      className={`week-emp-tag ${s.cancelled_at ? 'is-cancelled' : ''} ${isFixed ? 'is-fixed' : 'is-daily'}`}
                                      onClick={() => onEditSchedule(s)}
                                      title={`${s.employee_name} (${isFixed ? '↻ Ca cố định' : '+ Theo ngày'}) - Bấm để xem/sửa`}
                                    >
                                      <span className="source-icon" aria-hidden="true">
                                        {isFixed ? '↻' : '+'}
                                      </span>
                                      <span className="emp-name-text">{s.employee_name}</span>
                                      {canCreateOvertime && <button type="button" className="week-emp-ot-btn" aria-label={`Đăng ký OT cho ${s.employee_name} ngày ${d.date}`}
                                        title={`Đăng ký OT cho ${s.employee_name}`} onClick={event => { event.stopPropagation(); onOpenOvertimeDrawer(d.date, s.employee_id, s.store_id) }}>{Icons.plus}</button>}
                                    </div>
                                  )
                                })}
                                {cellSchedules.length > 3 && (
                                  <div
                                    className="week-emp-more"
                                    onClick={() => {
                                      onSelectDate(d.date)
                                      onSelectView('day')
                                    }}
                                  >
                                    +{cellSchedules.length - 3} người khác
                                  </div>
                                )}
                              </div>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="week-cell-empty-btn"
                              title={`Phân ca cho ${shift.shift_name} ngày ${d.dayName} ${d.dayNum}`}
                              onClick={() => onOpenDrawer(d.date, shift.shift_id)}
                            >
                              <span className="empty-plus">+</span>
                              <span className="empty-label">Phân ca</span>
                            </button>
                          )}
                          {/* Overtime is now displayed in its dedicated 'OT trong ngày' row */}
                        </div>

                        {/* Tooltip on Desktop hover */}
                        {isHovered && cellSchedules.length > 0 && (
                          <div className="week-cell-tooltip" role="tooltip">
                            <div className="tooltip-header">
                              <strong>{shift.shift_name}</strong> • {d.dayName} {d.dayNum}
                            </div>
                            <div className="tooltip-sub">
                              {displayTime(shift.start_time)}–{displayTime(shift.end_time)} ({shift.work_hours}h)
                            </div>
                            <ul className="tooltip-emp-list">
                              {cellSchedules.map(s => (
                                <li key={s.schedule_id} className={s.cancelled_at ? 'is-cancelled' : ''}>
                                  <span className="tooltip-source-badge">
                                    {s.fixed_rule_id ? '↻ Ca cố định' : '+ Theo ngày'}
                                  </span>
                                  <strong className="tooltip-name">{s.employee_name}</strong>
                                  {s.position_name && <span className="tooltip-pos">({s.position_name})</span>}
                                  {s.notes && <span className="tooltip-notes">• {s.notes}</span>}
                                  {s.cancelled_at && <span className="tooltip-cancelled-label">[Đã hủy]</span>}
                                </li>
                              ))}
                            </ul>
                            <div className="tooltip-hint">Click thẻ để sửa / hủy lịch</div>
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}

              {/* Dedicated Row for 'OT trong ngày' */}
              <tr key="row-overtime" className="week-shift-row week-shift-row-overtime">
                <td className="week-shift-label-cell">
                  <div className="week-shift-title">OT trong ngày</div>
                  <div className="week-shift-hours">Tăng ca ngoài giờ</div>
                  <span className="week-shift-tag week-shift-tag--ot">OT</span>
                </td>

                {weekDays.map(d => {
                  const cellOvertime = overtimeByDate.get(d.date) || []

                  return (
                    <td
                      key={d.date}
                      className={`week-grid-cell week-grid-cell-overtime ${d.isToday ? 'is-today-cell' : ''} ${cellOvertime.length > 0 ? 'has-overtime' : 'is-empty'}`}
                    >
                      <div className="week-cell-content">
                        {cellOvertime.length > 0 && (
                          <div className="calendar-overtime-list">
                            {cellOvertime.map(request => overtimeChip(request, true))}
                          </div>
                        )}
                        {canCreateOvertime && (
                          <button
                            type="button"
                            className="calendar-overtime-add"
                            onClick={event => {
                              event.stopPropagation()
                              onOpenOvertimeDrawer(d.date)
                            }}
                          >
                            + Đăng ký OT
                          </button>
                        )}
                      </div>
                    </td>
                  )
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // =========================================================================
  // RENDER: MONTH VIEW
  // =========================================================================
  if (view === 'month') {
    const weekHeaders = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

    return (
      <div className="calendar-month-container">
        <div className="calendar-month-grid">
          {/* Weekday headers */}
          <div className="month-header-row">
            {weekHeaders.map(dayName => (
              <div key={dayName} className="month-header-cell">
                {dayName}
              </div>
            ))}
          </div>

          {/* Month Day Cells */}
          <div className="month-cells-grid">
            {monthGrid.map(cell => {
              const daySchedules = schedulesByDate.get(cell.date) || []
              const activeSchedules = daySchedules.filter(s => !s.cancelled_at)
              const distinctShifts = Array.from(new Set(activeSchedules.map(s => s.shift_id)))
              const totalEmployees = activeSchedules.length
              const dayOvertime = overtimeByDate.get(cell.date) || []
              const isSelected = cell.date === selectedDate

              return (
                <div
                  key={cell.date}
                  className={`month-day-cell ${cell.isCurrentMonth ? 'current-month' : 'other-month'} ${cell.isToday ? 'is-today-cell' : ''} ${isSelected ? 'is-selected-cell' : ''}`}
                  onClick={() => {
                    onSelectDate(cell.date)
                    onSelectView('day')
                  }}
                  title={`Ngày ${cell.date}: ${totalEmployees} nhân viên. Click để xem chi tiết ngày`}
                >
                  <div className="month-day-cell-top">
                    <span className={`month-day-num ${cell.isToday ? 'today-badge' : ''}`}>
                      {cell.dayNumber}
                    </span>
                    {totalEmployees > 0 && (
                      <span className="month-day-nv-count">
                        {totalEmployees} NV
                      </span>
                    )}
                    {canCreateOvertime && <button type="button" className="month-overtime-add" aria-label={`Đăng ký OT ngày ${cell.date}`} title="Đăng ký OT"
                      onClick={event => { event.stopPropagation(); onOpenOvertimeDrawer(cell.date) }}>{Icons.plus}</button>}
                  </div>

                  <div className="month-day-content">
                    {totalEmployees > 0 ? (
                      <div className="month-shift-dots">
                        {distinctShifts.map(sId => {
                          const shift = standardShifts.find(s => s.shift_id === sId)
                          const countInShift = activeSchedules.filter(s => s.shift_id === sId).length
                          return (
                            <div key={sId} className="month-shift-summary-pill">
                              <span className="pill-dot" />
                              <span className="pill-name">{shift?.shift_name || 'Ca'}:</span>
                              <span className="pill-count">{countInShift}</span>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      cell.isCurrentMonth && (
                        <div className="month-day-empty">
                          <span>Chưa có ca</span>
                        </div>
                      )
                    )}
                    {dayOvertime.length > 0 && <div className="calendar-overtime-list">{dayOvertime.slice(0, 2).map(request => overtimeChip(request, true))}{dayOvertime.length > 2 && <small>+{dayOvertime.length - 2} đơn OT</small>}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  // =========================================================================
  // RENDER: DAY VIEW
  // =========================================================================
  const daySchedules = schedulesByDate.get(selectedDate) || []
  const dayOvertime = overtimeByDate.get(selectedDate) || []

  return (
    <div className="calendar-day-container">
      <div className="day-view-shifts-grid">
        {standardShifts.map(shift => {
          const shiftSchedules = daySchedules.filter(s => s.shift_id === shift.shift_id)
          const activeSchedules = shiftSchedules.filter(s => !s.cancelled_at)

          return (
            <section key={shift.shift_id} className="day-shift-card">
              <header className="day-shift-card-header">
                <div className="day-shift-card-info">
                  <h3 className="day-shift-title">{shift.shift_name}</h3>
                  <p className="day-shift-hours">
                    {displayTime(shift.start_time)} – {displayTime(shift.end_time)} ({shift.work_hours} giờ công)
                  </p>
                </div>
                <div className="day-shift-card-actions">
                  <span className="day-shift-badge">
                    {activeSchedules.length} nhân viên
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => onOpenDrawer(selectedDate, shift.shift_id)}
                    title={`Phân thêm nhân viên vào ${shift.shift_name}`}
                  >
                    {Icons.plus} Phân ca
                  </button>
                </div>
              </header>

              <div className="day-shift-card-body">
                {shiftSchedules.length === 0 ? (
                  <div className="day-shift-empty">
                    <span>Chưa có nhân viên nào được phân công ca này trong ngày.</span>
                  </div>
                ) : (
                  <div className="day-shift-emp-list">
                    {shiftSchedules.map(schedule => {
                      const isFixed = Boolean(schedule.fixed_rule_id)
                      const isSelf = schedule.employee_id === user?.employee_id
                      const isCancelled = Boolean(schedule.cancelled_at)

                      return (
                        <div
                          key={schedule.schedule_id}
                          className={`day-emp-card ${isCancelled ? 'is-cancelled' : ''}`}
                        >
                          <div className="day-emp-card-main">
                            <div className="day-emp-header">
                              <strong className="day-emp-name">{schedule.employee_name}</strong>
                              <span className={`source-pill ${isFixed ? 'fixed' : 'daily'}`}>
                                {isFixed ? '↻ Ca cố định' : '+ Theo ngày'}
                              </span>
                              {isCancelled && <span className="status-pill-cancelled">Đã hủy</span>}
                            </div>
                            <div className="day-emp-meta">
                              <span>{schedule.position_name || 'Nhân viên'}</span>
                              <span className="dot-sep">•</span>
                              <span>{schedule.store_name}</span>
                              {schedule.notes && (
                                <>
                                  <span className="dot-sep">•</span>
                                  <span className="day-emp-notes">"{schedule.notes}"</span>
                                </>
                              )}
                            </div>
                          </div>

                          {!isCancelled && (
                            <div className="day-emp-card-actions">
                              {canCreateOvertime && <button type="button" className="btn btn-secondary btn-sm day-overtime-add" title={`Đăng ký OT cho ${schedule.employee_name}`}
                                onClick={() => onOpenOvertimeDrawer(selectedDate, schedule.employee_id, schedule.store_id)}>{Icons.plus} OT</button>}
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                disabled={isSelf}
                                title={isSelf ? 'Không thể tự sửa lịch của bản thân.' : 'Chỉnh sửa lịch'}
                                onClick={() => onEditSchedule(schedule)}
                              >
                                Sửa
                              </button>
                              <button
                                type="button"
                                className="btn btn-danger btn-sm"
                                disabled={isSelf}
                                title={isSelf ? 'Không thể tự hủy lịch của bản thân.' : 'Hủy phân công'}
                                onClick={() => onCancelSchedule(schedule)}
                              >
                                Hủy
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </section>
          )
        })}
      </div>
      {(dayOvertime.length > 0 || canCreateOvertime) && <section className="day-overtime-section" aria-label="Đăng ký OT trong ngày">
        <header><div><h3>Đăng ký tăng ca</h3><p>Đề xuất OT độc lập với ca làm việc chính thức.</p></div>{canCreateOvertime && <button type="button" className="btn btn-secondary btn-sm" onClick={() => onOpenOvertimeDrawer(selectedDate)}>{Icons.plus} Đăng ký OT</button>}</header>
        {dayOvertime.length > 0 ? <div className="day-overtime-list">{dayOvertime.map(request => overtimeChip(request))}</div> : <p className="day-overtime-empty">Chưa có đăng ký OT trong ngày này.</p>}
      </section>}
    </div>
  )
}
