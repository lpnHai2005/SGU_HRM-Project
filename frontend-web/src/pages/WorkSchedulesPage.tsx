import { useEffect, useMemo, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { EmptyState } from '../components/common/EmptyState'
import { Icons } from '../components/common/Icons'
import { DatePicker } from '../components/common/DatePicker'
import { employeeApi, workScheduleApi } from '../services/api'
import { WorkScheduleDrawer } from '../components/schedule/WorkScheduleDrawer'
import { WorkScheduleCalendar } from '../components/schedule/WorkScheduleCalendar'
import type { Employee, Lookups, WorkSchedule, WorkScheduleQuery, WorkScheduleWrite } from '../types'
import './WorkSchedulesPage.css'

type ViewMode = 'month' | 'week' | 'day' | 'table'

type DialogState =
  | { action: 'edit'; schedule: WorkSchedule }
  | { action: 'cancel'; schedule: WorkSchedule }
  | null

const localDate = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

const displayDate = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString('vi-VN')
const displayTime = (value: string) => value.slice(0, 5)
const nextSunday = (value: string) => {
  const date = new Date(`${value}T12:00:00`)
  date.setDate(date.getDate() + ((7 - date.getDay()) % 7))
  return localDate(date)
}

function moveDate(value: string, view: ViewMode, direction: number) {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (view === 'day') date.setDate(date.getDate() + direction)
  if (view === 'week' || view === 'table') date.setDate(date.getDate() + direction * 7)
  if (view === 'month') {
    const targetMonth = new Date(year, month - 1 + direction, 1)
    const lastDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate()
    targetMonth.setDate(Math.min(day, lastDay))
    return localDate(targetMonth)
  }
  return localDate(date)
}

function periodLabel(value: string, view: ViewMode) {
  const date = new Date(`${value}T00:00:00`)
  if (view === 'day') return date.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
  if (view === 'month') return date.toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' })
  const monday = new Date(date)
  monday.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  const saturday = new Date(monday)
  saturday.setDate(monday.getDate() + 5)
  return `${monday.toLocaleDateString('vi-VN')} – ${saturday.toLocaleDateString('vi-VN')}`
}

export function WorkSchedulesPage({ user }: { user: any }) {
  const [searchParams] = useSearchParams()
  const urlEmployeeId = searchParams.get('employee_id')

  const roles: string[] = user?.roles || []
  const isStoreManager = roles.includes('STORE_MANAGER') && !roles.includes('ADMIN') && !roles.includes('HR_MANAGER')
  const canManage = roles.includes('ADMIN') || roles.includes('HR_MANAGER') || roles.includes('STORE_MANAGER')

  const [selectedDate, setSelectedDate] = useState(today)
  const [view, setView] = useState<ViewMode>('week')
  const [employeeFilter, setEmployeeFilter] = useState(urlEmployeeId || '')
  const [departmentFilter, setDepartmentFilter] = useState('')
  const [positionFilter, setPositionFilter] = useState('')
  const [shiftFilter, setShiftFilter] = useState('')
  const [storeFilter, setStoreFilter] = useState(isStoreManager && user?.store_id ? String(user.store_id) : '')
  const [includeCancelled, setIncludeCancelled] = useState(false)
  const [showSunday, setShowSunday] = useState(false)

  const [schedules, setSchedules] = useState<WorkSchedule[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [lookups, setLookups] = useState<Lookups | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [cancelFixedScope, setCancelFixedScope] = useState<'day_only' | 'stop_rule'>('day_only')
  const [editFixedScope, setEditFixedScope] = useState<'day_only' | 'future'>('day_only')
  const [effectiveDate, setEffectiveDate] = useState(today)
  const [fixedWeekdays, setFixedWeekdays] = useState('1,2,3,4,5,6')
  const [fixedEndDate, setFixedEndDate] = useState<string | null>(null)
  const [fixedRuleStart, setFixedRuleStart] = useState<string | null>(null)
  const [form, setForm] = useState<WorkScheduleWrite | null>(null)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0)

  // Drawer state
  const [drawerState, setDrawerState] = useState<{
    isOpen: boolean
    mode: 'daily' | 'recurring'
    date?: string
    shiftId?: number
  }>({
    isOpen: false,
    mode: 'daily',
  })

  // Load lookups and employees once
  useEffect(() => {
    let active = true
    Promise.all([employeeApi.getLookups(), employeeApi.getAll()])
      .then(([lookupData, employeeData]) => {
        if (!active) return
        setLookups(lookupData)
        setEmployees(employeeData)
      })
      .catch((err: unknown) => {
        if (active) setError(`Không tải được danh mục lịch (GET /employees/metadata/lookups hoặc /employees): ${err instanceof Error ? err.message : 'Lỗi không xác định.'}`)
      })
    return () => { active = false }
  }, [])

  // Sync url param if provided
  useEffect(() => {
    if (urlEmployeeId) {
      setEmployeeFilter(urlEmployeeId)
    }
  }, [urlEmployeeId])

  // Fetch schedules
  const fetchSchedules = useCallback(async () => {
    const params: WorkScheduleQuery = {
      day: selectedDate,
      view: view === 'table' ? 'week' : view,
      include_cancelled: includeCancelled,
    }
    if (employeeFilter) params.employee_id = Number(employeeFilter)
    if (departmentFilter) params.department_id = Number(departmentFilter)
    if (positionFilter) params.position_id = Number(positionFilter)
    if (shiftFilter) params.shift_id = Number(shiftFilter)
    if (storeFilter) params.store_id = Number(storeFilter)

    return workScheduleApi.getAll(params)
  }, [selectedDate, view, employeeFilter, departmentFilter, positionFilter, shiftFilter, storeFilter, includeCancelled])

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchSchedules()
      .then(rows => {
        if (active) {
          setSchedules(rows)
          setError('')
        }
      })
      .catch((err: unknown) => {
        if (active) setError(`Không tải được lịch làm việc (GET /work-schedules): ${err instanceof Error ? err.message : 'Lỗi không xác định.'}`)
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [fetchSchedules, refresh])

  const sortedSchedules = useMemo(
    () => [...schedules].sort((a, b) =>
      a.work_date.localeCompare(b.work_date) ||
      a.start_time.localeCompare(b.start_time) ||
      a.employee_name.localeCompare(b.employee_name)
    ),
    [schedules],
  )

  const openDrawer = (mode: 'daily' | 'recurring', date?: string, shiftId?: number) => {
    setDrawerState({
      isOpen: true,
      mode,
      date: date || selectedDate,
      shiftId: shiftId || 1,
    })
  }

  const closeDrawer = () => {
    setDrawerState(prev => ({ ...prev, isOpen: false }))
  }

  const handleDrawerSuccess = (msg: string) => {
    setNotice(msg)
    // Reload schedules without resetting filter or view state
    setRefresh(v => v + 1)
  }

  const beginEdit = (schedule: WorkSchedule) => {
    setForm({
      employee_id: schedule.employee_id,
      store_id: schedule.store_id,
      shift_id: schedule.shift_id,
      work_date: schedule.work_date,
      notes: schedule.notes || '',
      reason: '',
    })
    setReason('')
    setEditFixedScope('day_only')
    setEffectiveDate(schedule.work_date >= today() ? schedule.work_date : today())
    setFixedWeekdays('1,2,3,4,5,6')
    setFixedEndDate(null)
    setFixedRuleStart(null)
    if (schedule.fixed_rule_id) {
      workScheduleApi.getFixedRules(schedule.employee_id).then(rules => {
        const rule = rules.find((item: any) => item.rule_id === schedule.fixed_rule_id)
        if (rule) {
          setFixedWeekdays(rule.weekdays || '1,2,3,4,5,6')
          setFixedEndDate(rule.end_date || null)
          setFixedRuleStart(rule.start_date || null)
        }
      }).catch(() => setError('Không tải được quy tắc ca cố định để chỉnh sửa.'))
    }
    setDialog({ action: 'edit', schedule })
    setNotice('')
  }

  const beginCancel = (schedule: WorkSchedule) => {
    setReason('')
    setCancelFixedScope('day_only')
    setEffectiveDate(schedule.work_date >= today() ? schedule.work_date : today())
    setDialog({ action: 'cancel', schedule })
    setNotice('')
  }

  const closeDialog = () => {
    if (saving) return
    setDialog(null)
    setForm(null)
    setReason('')
  }

  const submitDialog = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!dialog || reason.trim().length < 3) return
    setSaving(true)
    setError('')
    try {
      if (dialog.action === 'edit') {
        if (!form) return
        if (dialog.schedule.fixed_rule_id && editFixedScope === 'future') {
          await workScheduleApi.updateFixed(dialog.schedule.fixed_rule_id, {
            effective_date: effectiveDate,
            shift_id: form.shift_id,
            weekdays: fixedWeekdays,
            notes: form.notes || 'Phân ca nhân viên chính thức',
            end_date: fixedEndDate,
            reason: reason.trim(),
          })
          setNotice(`Đã cập nhật mọi ca cố định từ ${displayDate(effectiveDate)} trở đi.`)
        } else {
          await workScheduleApi.update(dialog.schedule.schedule_id, { ...form, reason: reason.trim() })
          setNotice('Đã cập nhật lịch làm việc của ngày được chọn.')
        }
      } else {
        // Cancel action
        if (dialog.schedule.fixed_rule_id && cancelFixedScope === 'stop_rule') {
          // Stop entire fixed rule
          await workScheduleApi.stopFixed(dialog.schedule.fixed_rule_id, reason.trim(), effectiveDate)
          setNotice(`Đã dừng ca cố định từ ${displayDate(effectiveDate)}; giữ nguyên lịch sử đã chấm công.`)
        } else {
          // Cancel only this occurrence
          await workScheduleApi.cancel(dialog.schedule.schedule_id, reason.trim())
          setNotice('Đã hủy lịch làm việc cho ngày này. Lịch được giữ lại trong lịch sử đối chiếu.')
        }
      }
      setDialog(null)
      setForm(null)
      setReason('')
      setRefresh(v => v + 1)
    } catch (err: any) {
      const detail = err.response?.data?.detail
      setError(typeof detail === 'string' ? detail : (err.message || 'Không thể lưu thay đổi lịch.'))
    } finally {
      setSaving(false)
    }
  }

  const shiftOptions = lookups?.work_shifts || []
  const storeOptions = lookups?.stores || []

  return (
    <div className="page-container work-schedules-page">
      {/* Page Header */}
      <header className="page-header work-schedules-header">
        <div>
          <h1 className="page-title">Quản lý lịch làm việc</h1>
          <p className="page-subtitle">
            Phân công ca làm việc theo ngày và ca cố định; theo dõi thời khóa biểu qua lịch Tháng, Tuần, Ngày.
          </p>
        </div>
        {canManage && (
          <div className="work-schedule-header-actions">
            <button
              type="button"
              className="btn btn-secondary btn-fixed-shift"
              onClick={() => openDrawer('recurring')}
              title="Thiết lập ca cố định lặp lại hằng tuần"
            >
              <span className="btn-icon-custom">{Icons.refresh}</span>
              <span>+ Ca cố định</span>
            </button>
            <button
              type="button"
              className="btn btn-primary btn-daily-shift"
              onClick={() => openDrawer('daily')}
              title="Phân ca làm việc theo ngày cụ thể"
            >
              <span className="btn-icon-custom">{Icons.plus}</span>
              <span>+ Phân ca</span>
            </button>
          </div>
        )}
      </header>

      {/* Filter Section */}
      <section className="work-schedule-filters" aria-label="Bộ lọc lịch làm việc">
        <DatePicker
          key={selectedDate}
          value={selectedDate}
          label="Ngày tham chiếu"
          onChange={date => { setLoading(true); setSelectedDate(date) }}
        />

        {/* View Mode Selector */}
        <label className="form-group">
          <span className="form-label">Chế độ xem</span>
          <select
            className="form-select"
            value={view}
            onChange={event => { setLoading(true); setView(event.target.value as ViewMode) }}
          >
            <option value="week">Tuần (Thời khóa biểu)</option>
            <option value="month">Tháng</option>
            <option value="day">Ngày (Chi tiết ca)</option>
            <option value="table">Bảng danh sách</option>
          </select>
        </label>

        {/* Store Filter */}
        <label className="form-group">
          <span className="form-label">Cửa hàng</span>
          <select
            className="form-select"
            value={storeFilter}
            disabled={isStoreManager}
            onChange={event => { setLoading(true); setStoreFilter(event.target.value) }}
          >
            {!isStoreManager && <option value="">Tất cả cửa hàng</option>}
            {storeOptions
              .filter(store => !isStoreManager || store.store_id === user?.store_id)
              .map(store => (
                <option key={store.store_id} value={store.store_id}>
                  {store.store_name}
                </option>
              ))}
          </select>
        </label>

        {/* Employee Filter */}
        <label className="form-group">
          <span className="form-label">Nhân viên</span>
          <select
            className="form-select"
            value={employeeFilter}
            onChange={event => { setLoading(true); setEmployeeFilter(event.target.value) }}
          >
            <option value="">Tất cả nhân viên</option>
            {employees.map(employee => (
              <option key={employee.employee_id} value={employee.employee_id}>
                {employee.full_name || `${employee.last_name} ${employee.first_name}`}
              </option>
            ))}
          </select>
        </label>

        {/* Shift Filter */}
        <label className="form-group">
          <span className="form-label">Ca làm việc</span>
          <select
            className="form-select"
            value={shiftFilter}
            onChange={event => { setLoading(true); setShiftFilter(event.target.value) }}
          >
            <option value="">Tất cả ca làm</option>
            {shiftOptions.map(shift => (
              <option key={shift.shift_id} value={shift.shift_id}>
                {shift.shift_name} ({displayTime(shift.start_time)}–{displayTime(shift.end_time)})
              </option>
            ))}
          </select>
        </label>

        {/* Department Filter */}
        <label className="form-group">
          <span className="form-label">Phòng ban</span>
          <select
            className="form-select"
            value={departmentFilter}
            onChange={event => { setLoading(true); setDepartmentFilter(event.target.value) }}
          >
            <option value="">Tất cả phòng ban</option>
            {lookups?.departments.map(department => (
              <option key={department.department_id} value={department.department_id}>
                {department.department_name}
              </option>
            ))}
          </select>
        </label>

        {/* Position Filter */}
        <label className="form-group">
          <span className="form-label">Chức vụ</span>
          <select
            className="form-select"
            value={positionFilter}
            onChange={e => { setLoading(true); setPositionFilter(e.target.value) }}
          >
            <option value="">Tất cả chức vụ</option>
            {lookups?.positions.map(p => (
              <option key={p.position_id} value={p.position_id}>
                {p.position_name}
              </option>
            ))}
          </select>
        </label>

        {/* Additional Toggles */}
        <div className="work-schedule-filter-toggles">
          {view === 'week' && (
            <label className="work-schedule-checkbox-toggle">
              <input
                type="checkbox"
                checked={showSunday}
                onChange={e => setShowSunday(e.target.checked)}
              />
              <span>Hiện Chủ nhật</span>
            </label>
          )}

          <label className="work-schedule-checkbox-toggle">
            <input
              type="checkbox"
              checked={includeCancelled}
              onChange={event => { setLoading(true); setIncludeCancelled(event.target.checked) }}
            />
            <span>Hiện lịch đã hủy</span>
          </label>
        </div>
      </section>

      {/* Main Content Area */}
      <section className="work-schedule-card">
        {/* Navigation Toolbar */}
        <div className="work-schedule-toolbar">
          <div className="toolbar-nav-group">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => { setLoading(true); setSelectedDate(value => moveDate(value, view, -1)) }}
              aria-label="Kỳ trước"
            >
              ‹ Trước
            </button>
            <strong className="toolbar-period-label">{periodLabel(selectedDate, view)}</strong>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => { setLoading(true); setSelectedDate(value => moveDate(value, view, 1)) }}
              aria-label="Kỳ sau"
            >
              Sau ›
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                const date = today()
                setLoading(true)
                setSelectedDate(date)
                setRefresh(value => value + 1)
              }}
            >
              Hôm nay
            </button>
          </div>

          {/* Quick View switcher tabs */}
          <div className="toolbar-view-tabs" role="tablist">
            <button
              type="button"
              className={`view-tab-btn ${view === 'week' ? 'active' : ''}`}
              onClick={() => setView('week')}
            >
              Tuần
            </button>
            <button
              type="button"
              className={`view-tab-btn ${view === 'month' ? 'active' : ''}`}
              onClick={() => setView('month')}
            >
              Tháng
            </button>
            <button
              type="button"
              className={`view-tab-btn ${view === 'day' ? 'active' : ''}`}
              onClick={() => setView('day')}
            >
              Ngày
            </button>
            <button
              type="button"
              className={`view-tab-btn ${view === 'table' ? 'active' : ''}`}
              onClick={() => setView('table')}
            >
              Bảng
            </button>
          </div>
        </div>

        {/* Notices and Alerts */}
        {notice && <div className="work-schedule-notice" role="status">{notice}</div>}
        {error && <div className="work-schedule-error" role="alert">{error}</div>}

        {/* Calendar or Table View */}
        {loading ? (
          <div className="work-schedule-loading">Đang tải lịch làm việc...</div>
        ) : view !== 'table' ? (
          <WorkScheduleCalendar
            view={view}
            selectedDate={selectedDate}
            schedules={schedules}
            lookups={lookups}
            showSunday={showSunday}
            user={user}
            onSelectDate={date => setSelectedDate(date)}
            onSelectView={v => setView(v)}
            onOpenDrawer={(date, shiftId) => openDrawer('daily', date, shiftId)}
            onEditSchedule={s => beginEdit(s)}
            onCancelSchedule={s => beginCancel(s)}
          />
        ) : sortedSchedules.length === 0 ? (
          <EmptyState
            icon={Icons.calendar}
            title="Không có lịch làm việc"
            description="Thử đổi thời gian hoặc bộ lọc để xem lịch được phân công."
          />
        ) : (
          <div className="table-container">
            <table className="data-table work-schedule-table">
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th>Nhân viên</th>
                  <th>Chức vụ</th>
                  <th>Phòng ban</th>
                  <th>Cửa hàng</th>
                  <th>Ca làm</th>
                  <th>Nguồn</th>
                  <th>Ghi chú</th>
                  <th>Trạng thái</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {sortedSchedules.map(schedule => {
                  const isFixed = Boolean(schedule.fixed_rule_id)
                  const isSelf = schedule.employee_id === user?.employee_id
                  const isCancelled = Boolean(schedule.cancelled_at)

                  return (
                    <tr key={schedule.schedule_id} className={isCancelled ? 'is-cancelled' : ''}>
                      <td>{displayDate(schedule.work_date)}</td>
                      <td>
                        <strong>{schedule.employee_name}</strong>
                      </td>
                      <td>{(schedule as any).position_name || '—'}</td>
                      <td>
                        {lookups?.departments.find(d => d.department_id === schedule.department_id)?.department_name || '—'}
                      </td>
                      <td>{schedule.store_name}</td>
                      <td>
                        <strong>{schedule.shift_name}</strong>
                        <br />
                        <span>{displayTime(schedule.start_time)}–{displayTime(schedule.end_time)}</span>
                      </td>
                      <td>
                        <span className={`source-pill ${isFixed ? 'fixed' : 'daily'}`}>
                          {isFixed ? '↻ Ca cố định' : '+ Theo ngày'}
                        </span>
                      </td>
                      <td>{schedule.notes || '—'}</td>
                      <td>
                        <span className={`work-schedule-status ${isCancelled ? 'cancelled' : 'active'}`}>
                          {isCancelled ? 'Đã hủy' : 'Đang hiệu lực'}
                        </span>
                      </td>
                      <td className="work-schedule-actions">
                        {!isCancelled && (
                          <>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              disabled={isSelf || (schedule.employment_status !== 'ACTIVE' && schedule.employment_status !== 'PROBATION')}
                              title={
                                isSelf
                                  ? 'Không thể tự sửa lịch của bản thân.'
                                  : schedule.employment_status !== 'ACTIVE' && schedule.employment_status !== 'PROBATION'
                                  ? 'Không thể sửa ca khi nhân viên đang nghỉ việc.'
                                  : 'Chỉnh sửa ca'
                              }
                              onClick={() => beginEdit(schedule)}
                            >
                              Sửa
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              disabled={isSelf}
                              title={isSelf ? 'Không được tự hủy lịch của bản thân.' : 'Hủy phân ca'}
                              onClick={() => beginCancel(schedule)}
                            >
                              Hủy
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && (
          <div className="work-schedule-count">
            {schedules.length} lịch phân công trong kỳ đang xem
          </div>
        )}
      </section>

      {/* Edit / Cancel Dialog */}
      {dialog && (
        <div
          className="modal-overlay"
          role="presentation"
          onMouseDown={event => { if (event.target === event.currentTarget) closeDialog() }}
        >
          <section
            className="modal work-schedule-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="work-schedule-dialog-title"
          >
            <header className="modal-header">
              <h2 id="work-schedule-dialog-title">
                {dialog.action === 'edit' ? 'Chỉnh sửa phân ca' : 'Hủy lịch phân công'}
              </h2>
              <button type="button" className="btn btn-secondary" onClick={closeDialog} disabled={saving}>
                Đóng
              </button>
            </header>

            <form onSubmit={submitDialog} className="work-schedule-dialog-form">
              {dialog.action === 'edit' && form && (
                <>
                  <label className="form-group">
                    <span className="form-label">Nhân viên</span>
                    <input className="form-input" value={dialog.schedule.employee_name} disabled />
                  </label>

                  <div className="work-schedule-date-group">
                    <DatePicker
                      key={`${dialog.schedule.schedule_id}-${form.work_date}`}
                      value={form.work_date}
                      label="Ngày làm việc"
                      disabled={Boolean(dialog.schedule.fixed_rule_id)}
                      onChange={date => setForm(current => (current ? { ...current, work_date: date } : current))}
                    />
                    {Boolean(dialog.schedule.fixed_rule_id) && (
                      <small className="form-hint">
                        Lịch thuộc ca cố định: để đổi ngày làm, hãy hủy ngày này và phân lịch mới.
                      </small>
                    )}
                  </div>

                  {dialog.schedule.fixed_rule_id && (
                    <div className="form-group cancel-fixed-scope-options">
                      <span className="form-label">Phạm vi chỉnh sửa ca cố định</span>
                      <div className="radio-options-column">
                        <label className="radio-option-label">
                          <input type="radio" name="edit_scope" checked={editFixedScope === 'day_only'} onChange={() => setEditFixedScope('day_only')} />
                          <span>Chỉ ngày này ({displayDate(dialog.schedule.work_date)})</span>
                        </label>
                        <label className="radio-option-label">
                          <input type="radio" name="edit_scope" checked={editFixedScope === 'future'} onChange={() => setEditFixedScope('future')} />
                          <span>Từ ngày hiệu lực trở đi (toàn bộ ca tương lai)</span>
                        </label>
                      </div>
                      {editFixedScope === 'future' && (
                        <>
                          <DatePicker key={`effective-${effectiveDate}`} value={effectiveDate} label="Ngày bắt đầu áp dụng" onChange={date => {
                            const aligned = fixedWeekdays === '7' ? nextSunday(date) : date
                            setEffectiveDate(aligned)
                            if (fixedWeekdays === '7' && fixedEndDate) setFixedEndDate(aligned)
                          }} disabled={saving} />
                          <small className="form-hint">Những ca trước ngày này và các ngày đã hủy vẫn được giữ nguyên. Quy tắc bắt đầu {fixedRuleStart ? displayDate(fixedRuleStart) : 'đang tải...'}; ngày hiệu lực tối đa trong 90 ngày tới.</small>
                          <label className="form-label">Lặp lại vào các thứ</label>
                          <div className="weekday-pill-group">
                            {[1, 2, 3, 4, 5, 6, 7].map(day => {
                              const selected = fixedWeekdays.split(',').includes(String(day))
                              return <button key={day} type="button" className={`weekday-pill ${selected ? 'active' : ''}`} onClick={() => {
                                const next = new Set(fixedWeekdays.split(',').map(Number))
                                if (selected && next.size > 1) next.delete(day)
                                else next.add(day)
                                setFixedWeekdays([...next].sort((a, b) => a - b).join(','))
                                if (day === 7 && !selected) {
                                  const sunday = nextSunday(effectiveDate)
                                  setEffectiveDate(sunday)
                                  if (fixedEndDate) setFixedEndDate(sunday)
                                }
                              }}>{day === 7 ? 'CN' : `T${day + 1}`}</button>
                            })}
                          </div>
                          <label className="radio-option-label">
                            <input type="checkbox" checked={Boolean(fixedEndDate)} onChange={event => setFixedEndDate(event.target.checked ? effectiveDate : null)} />
                            <span>Có ngày kết thúc</span>
                          </label>
                          {fixedEndDate && <DatePicker key={`end-${fixedEndDate}`} value={fixedEndDate} label="Ngày kết thúc" onChange={date => setFixedEndDate(date)} disabled={saving} />}
                        </>
                      )}
                    </div>
                  )}

                  <label className="form-group">
                    <span className="form-label">Cửa hàng</span>
                    <select
                      className="form-select"
                      value={form.store_id}
                      disabled={isStoreManager || (Boolean(dialog.schedule.fixed_rule_id) && editFixedScope === 'future')}
                      onChange={event => setForm(current => (current ? { ...current, store_id: Number(event.target.value) } : current))}
                    >
                      {storeOptions
                        .filter(store => !isStoreManager || store.store_id === user?.store_id)
                        .map(store => (
                          <option key={store.store_id} value={store.store_id}>
                            {store.store_name}
                          </option>
                        ))}
                      {!storeOptions.some(store => store.store_id === dialog.schedule.store_id) && (
                        <option value={dialog.schedule.store_id}>{dialog.schedule.store_name}</option>
                      )}
                    </select>
                  </label>

                  <label className="form-group">
                    <span className="form-label">Ca làm việc</span>
                    <select
                      className="form-select"
                      value={form.shift_id}
                      onChange={event => {
                        const shift = shiftOptions.find(item => item.shift_id === Number(event.target.value))
                        if (dialog.schedule.fixed_rule_id && editFixedScope === 'future' && shift?.shift_name.toLowerCase().includes('cuối tuần')) {
                          setFixedWeekdays('7')
                          const sunday = nextSunday(effectiveDate)
                          setEffectiveDate(sunday)
                          if (fixedEndDate) setFixedEndDate(sunday)
                        }
                        setForm(current => (current ? { ...current, shift_id: Number(event.target.value) } : current))
                      }}
                      required
                    >
                      {shiftOptions.map(shift => (
                        <option key={shift.shift_id} value={shift.shift_id}>
                          {shift.shift_name} ({displayTime(shift.start_time)}–{displayTime(shift.end_time)})
                        </option>
                      ))}
                      {!shiftOptions.some(shift => shift.shift_id === dialog.schedule.shift_id) && (
                        <option value={dialog.schedule.shift_id}>
                          {dialog.schedule.shift_name} ({displayTime(dialog.schedule.start_time)}–{displayTime(dialog.schedule.end_time)})
                        </option>
                      )}
                    </select>
                  </label>

                  <label className="form-group">
                    <span className="form-label">Ghi chú</span>
                    <input
                      className="form-input"
                      maxLength={255}
                      value={form.notes || ''}
                      onChange={event => setForm(current => (current ? { ...current, notes: event.target.value } : current))}
                    />
                  </label>
                </>
              )}

              {dialog.action === 'cancel' && dialog.schedule.fixed_rule_id && (
                <div className="form-group cancel-fixed-scope-options">
                  <span className="form-label">Phạm vi hủy ca cố định</span>
                  <div className="radio-options-column">
                    <label className="radio-option-label">
                      <input
                        type="radio"
                        name="cancel_scope"
                        checked={cancelFixedScope === 'day_only'}
                        onChange={() => setCancelFixedScope('day_only')}
                      />
                      <div>
                        <strong>Chỉ hủy ngày này ({displayDate(dialog.schedule.work_date)})</strong>
                        <p className="radio-desc">Giữ nguyên quy tắc lặp hằng tuần cho các tuần tiếp theo.</p>
                      </div>
                    </label>
                    <label className="radio-option-label">
                      <input
                        type="radio"
                        name="cancel_scope"
                        checked={cancelFixedScope === 'stop_rule'}
                        onChange={() => setCancelFixedScope('stop_rule')}
                      />
                      <div>
                        <strong>Dừng toàn bộ ca cố định</strong>
                        <p className="radio-desc">Dừng quy tắc và hủy toàn bộ lịch trong tương lai chưa phát sinh chấm công.</p>
                      </div>
                    </label>
                    {cancelFixedScope === 'stop_rule' && (
                      <DatePicker key={`stop-${effectiveDate}`} value={effectiveDate} label="Ngày hiệu lực dừng" onChange={setEffectiveDate} disabled={saving} />
                    )}
                  </div>
                </div>
              )}

              <label className="form-group">
                <span className="form-label">
                  Lý do {dialog.action === 'cancel' ? 'hủy' : 'chỉnh sửa'} <span className="label-required">*</span>
                </span>
                <textarea
                  className="form-input"
                  rows={3}
                  minLength={3}
                  maxLength={500}
                  placeholder="Nhập lý do điều chỉnh lịch phân ca..."
                  value={reason}
                  onChange={event => setReason(event.target.value)}
                  required
                />
              </label>

              {dialog.action === 'edit' && (
                <p className="work-schedule-dialog-hint">
                  Lịch đã được dùng để ghi nhận chấm công không thể chỉnh sửa trực tiếp vì snapshot chấm công được bảo lưu.
                </p>
              )}

              <footer className="work-schedule-dialog-actions">
                <button type="button" className="btn btn-secondary" onClick={closeDialog} disabled={saving}>
                  Quay lại
                </button>
                <button
                  type="submit"
                  className={`btn ${dialog.action === 'cancel' ? 'btn-danger' : 'btn-primary'}`}
                  disabled={saving || reason.trim().length < 3 || (dialog.action === 'edit' && !form)}
                >
                  {saving ? 'Đang lưu...' : dialog.action === 'edit' ? 'Lưu thay đổi' : 'Xác nhận hủy'}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {/* Unified Drawer */}
      <WorkScheduleDrawer
        isOpen={drawerState.isOpen}
        onClose={closeDrawer}
        initialMode={drawerState.mode}
        initialDate={drawerState.date}
        initialShiftId={drawerState.shiftId}
        user={user}
        lookups={lookups}
        employees={employees}
        existingSchedules={schedules}
        onSuccess={handleDrawerSuccess}
      />
    </div>
  )
}
