import { useEffect, useMemo, useState } from 'react'
import { EmptyState } from '../components/common/EmptyState'
import { Icons } from '../components/common/Icons'
import { DatePicker } from '../components/common/DatePicker'
import { employeeApi, workScheduleApi } from '../services/api'
import type { Employee, Lookups, WorkSchedule, WorkScheduleQuery, WorkScheduleWrite } from '../types'
import './WorkSchedulesPage.css'

type ViewMode = WorkScheduleQuery['view']
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

const today = () => localDate(new Date())

const displayDate = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString('vi-VN')
const displayTime = (value: string) => value.slice(0, 5)

function moveDate(value: string, view: ViewMode, direction: number) {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (view === 'day') date.setDate(date.getDate() + direction)
  if (view === 'week') date.setDate(date.getDate() + direction * 7)
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
  const roles: string[] = user?.roles || []
  const isStoreManager = roles.includes('STORE_MANAGER') && !roles.includes('ADMIN') && !roles.includes('HR_MANAGER')
  const [selectedDate, setSelectedDate] = useState(today)
  const [view, setView] = useState<ViewMode>('week')
  const [employeeFilter, setEmployeeFilter] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState('')
  const [storeFilter, setStoreFilter] = useState(isStoreManager && user?.store_id ? String(user.store_id) : '')
  const [includeCancelled, setIncludeCancelled] = useState(false)
  const [schedules, setSchedules] = useState<WorkSchedule[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [lookups, setLookups] = useState<Lookups | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [form, setForm] = useState<WorkScheduleWrite | null>(null)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([employeeApi.getLookups(), employeeApi.getAll()])
      .then(([lookupData, employeeData]) => {
        if (!active) return
        setLookups(lookupData)
        setEmployees(employeeData)
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Không tải được danh mục lịch làm việc.')
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    const params: WorkScheduleQuery = { day: selectedDate, view, include_cancelled: includeCancelled }
    if (employeeFilter) params.employee_id = Number(employeeFilter)
    if (departmentFilter) params.department_id = Number(departmentFilter)
    if (storeFilter) params.store_id = Number(storeFilter)

    workScheduleApi.getAll(params)
      .then(rows => {
        if (active) {
          setSchedules(rows)
          setError('')
        }
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Không tải được lịch làm việc.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [selectedDate, view, employeeFilter, departmentFilter, storeFilter, includeCancelled])

  const sortedSchedules = useMemo(
    () => [...schedules].sort((a, b) => a.work_date.localeCompare(b.work_date) || a.start_time.localeCompare(b.start_time) || a.employee_name.localeCompare(b.employee_name)),
    [schedules],
  )

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
    setDialog({ action: 'edit', schedule })
    setNotice('')
  }

  const beginCancel = (schedule: WorkSchedule) => {
    setReason('')
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
        await workScheduleApi.update(dialog.schedule.schedule_id, { ...form, reason: reason.trim() })
        setNotice('Đã cập nhật lịch làm việc.')
      } else {
        await workScheduleApi.cancel(dialog.schedule.schedule_id, reason.trim())
        setNotice('Đã hủy lịch làm việc. Lịch được giữ lại trong lịch sử.')
      }
      setDialog(null)
      setForm(null)
      setReason('')
      const params: WorkScheduleQuery = { day: selectedDate, view, include_cancelled: includeCancelled }
      if (employeeFilter) params.employee_id = Number(employeeFilter)
      if (departmentFilter) params.department_id = Number(departmentFilter)
      if (storeFilter) params.store_id = Number(storeFilter)
      setSchedules(await workScheduleApi.getAll(params))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Không thể lưu thay đổi lịch.')
    } finally {
      setSaving(false)
    }
  }

  const shiftOptions = lookups?.work_shifts || []
  const storeOptions = lookups?.stores || []

  return (
    <div className="page-container work-schedules-page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Lịch làm việc</h1>
          <p className="page-subtitle">Xem lịch theo nhân viên, phòng ban, cửa hàng và thời gian; chỉnh sửa hoặc hủy lịch đã phân công.</p>
        </div>
      </header>

      <section className="work-schedule-filters" aria-label="Bộ lọc lịch làm việc">
        <label className="form-group">
          <span className="form-label">Ngày tham chiếu</span>
          <DatePicker key={selectedDate} value={selectedDate} label="Ngày tham chiếu" onChange={date => { setLoading(true); setSelectedDate(date) }} />
        </label>
        <label className="form-group">
          <span className="form-label">Hiển thị</span>
          <select className="form-select" value={view} onChange={event => { setLoading(true); setView(event.target.value as ViewMode) }}>
            <option value="day">Ngày</option>
            <option value="week">Tuần (Thứ 2 – Thứ 7)</option>
            <option value="month">Tháng</option>
          </select>
        </label>
        <label className="form-group">
          <span className="form-label">Nhân viên</span>
          <select className="form-select" value={employeeFilter} onChange={event => { setLoading(true); setEmployeeFilter(event.target.value) }}>
            <option value="">Tất cả nhân viên</option>
            {employees.map(employee => (
              <option key={employee.employee_id} value={employee.employee_id}>
                {employee.full_name || `${employee.last_name} ${employee.first_name}`}
              </option>
            ))}
          </select>
        </label>
        <label className="form-group">
          <span className="form-label">Phòng ban</span>
          <select className="form-select" value={departmentFilter} onChange={event => { setLoading(true); setDepartmentFilter(event.target.value) }}>
            <option value="">Tất cả phòng ban</option>
            {lookups?.departments.map(department => <option key={department.department_id} value={department.department_id}>{department.department_name}</option>)}
          </select>
        </label>
        <label className="form-group">
          <span className="form-label">Cửa hàng</span>
          <select className="form-select" value={storeFilter} disabled={isStoreManager} onChange={event => { setLoading(true); setStoreFilter(event.target.value) }}>
            {!isStoreManager && <option value="">Tất cả cửa hàng</option>}
            {storeOptions.filter(store => !isStoreManager || store.store_id === user?.store_id).map(store => (
              <option key={store.store_id} value={store.store_id}>{store.store_name}</option>
            ))}
          </select>
        </label>
        <label className="work-schedule-cancelled-toggle">
          <input type="checkbox" checked={includeCancelled} onChange={event => { setLoading(true); setIncludeCancelled(event.target.checked) }} />
          Hiện lịch đã hủy
        </label>
      </section>

      <section className="work-schedule-card">
        <div className="work-schedule-toolbar">
          <button type="button" className="btn btn-secondary" onClick={() => { setLoading(true); setSelectedDate(value => moveDate(value, view, -1)) }} aria-label="Kỳ trước">‹ Trước</button>
          <strong>{periodLabel(selectedDate, view)}</strong>
          <button type="button" className="btn btn-secondary" onClick={() => { setLoading(true); setSelectedDate(value => moveDate(value, view, 1)) }} aria-label="Kỳ sau">Sau ›</button>
          <button type="button" className="btn btn-secondary" onClick={() => { const date = today(); if (date !== selectedDate) setLoading(true); setSelectedDate(date) }}>Hôm nay</button>
        </div>

        {notice && <div className="work-schedule-notice" role="status">{notice}</div>}
        {error && <div className="work-schedule-error" role="alert">{error}</div>}

        {loading ? <div className="work-schedule-loading">Đang tải lịch làm việc...</div> : sortedSchedules.length === 0 ? (
          <EmptyState icon={Icons.calendar} title="Không có lịch làm việc" description="Thử đổi thời gian hoặc bộ lọc để xem lịch được phân công." />
        ) : (
          <div className="table-container">
            <table className="data-table work-schedule-table">
              <thead>
                <tr>
                  <th>Ngày</th><th>Nhân viên</th><th>Phòng ban</th><th>Cửa hàng</th><th>Ca làm</th><th>Ghi chú</th><th>Trạng thái</th><th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {sortedSchedules.map(schedule => (
                  <tr key={schedule.schedule_id} className={schedule.cancelled_at ? 'is-cancelled' : ''}>
                    <td>{displayDate(schedule.work_date)}</td>
                    <td>{schedule.employee_name}</td>
                    <td>{lookups?.departments.find(department => department.department_id === schedule.department_id)?.department_name || '—'}</td>
                    <td>{schedule.store_name}</td>
                    <td><strong>{schedule.shift_name}</strong><br /><span>{displayTime(schedule.start_time)}–{displayTime(schedule.end_time)}</span></td>
                    <td>{schedule.notes || '—'}</td>
                    <td><span className={`work-schedule-status ${schedule.cancelled_at ? 'cancelled' : 'active'}`}>{schedule.cancelled_at ? 'Đã hủy' : 'Đang hiệu lực'}</span></td>
                    <td className="work-schedule-actions">
                      {!schedule.cancelled_at && <>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={schedule.employment_status !== 'ACTIVE' && schedule.employment_status !== 'PROBATION'}
                          title={schedule.employment_status !== 'ACTIVE' && schedule.employment_status !== 'PROBATION' ? 'Không thể sửa ca khi nhân viên đang nghỉ việc hoặc đã nghỉ việc.' : undefined}
                          onClick={() => beginEdit(schedule)}
                        >Sửa</button>
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => beginCancel(schedule)}>Hủy</button>
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && <div className="work-schedule-count">{sortedSchedules.length} lịch trong kỳ đang xem</div>}
      </section>

      {dialog && (
        <div className="modal-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeDialog() }}>
          <section className="modal work-schedule-dialog" role="dialog" aria-modal="true" aria-labelledby="work-schedule-dialog-title">
            <header className="modal-header">
              <h2 id="work-schedule-dialog-title">{dialog.action === 'edit' ? 'Chỉnh sửa lịch' : 'Hủy lịch phân công'}</h2>
              <button type="button" className="btn btn-secondary" onClick={closeDialog} disabled={saving}>Đóng</button>
            </header>
            <form onSubmit={submitDialog} className="work-schedule-dialog-form">
              {dialog.action === 'edit' && form && (
                <>
                  <label className="form-group">
                    <span className="form-label">Nhân viên</span>
                    <input className="form-input" value={dialog.schedule.employee_name} disabled />
                  </label>
                  <div className="work-schedule-date-group">
                    <DatePicker key={`${dialog.schedule.schedule_id}-${form.work_date}`} value={form.work_date} label="Ngày làm việc" disabled={Boolean(dialog.schedule.fixed_rule_id)} onChange={date => setForm(current => current ? { ...current, work_date: date } : current)} />
                    {Boolean(dialog.schedule.fixed_rule_id) && <small>Lịch thuộc ca cố định: muốn đổi ngày, hãy hủy ngày này rồi phân lịch mới.</small>}
                  </div>
                  <label className="form-group">
                    <span className="form-label">Cửa hàng</span>
                    <select className="form-select" value={form.store_id} disabled={isStoreManager} onChange={event => setForm(current => current ? { ...current, store_id: Number(event.target.value) } : current)}>
                      {storeOptions.filter(store => !isStoreManager || store.store_id === user?.store_id).map(store => <option key={store.store_id} value={store.store_id}>{store.store_name}</option>)}
                      {!storeOptions.some(store => store.store_id === dialog.schedule.store_id) && <option value={dialog.schedule.store_id}>{dialog.schedule.store_name}</option>}
                    </select>
                  </label>
                  <label className="form-group">
                    <span className="form-label">Ca làm</span>
                    <select className="form-select" value={form.shift_id} onChange={event => setForm(current => current ? { ...current, shift_id: Number(event.target.value) } : current)} required>
                      {shiftOptions.map(shift => <option key={shift.shift_id} value={shift.shift_id}>{shift.shift_name} ({displayTime(shift.start_time)}–{displayTime(shift.end_time)})</option>)}
                      {!shiftOptions.some(shift => shift.shift_id === dialog.schedule.shift_id) && <option value={dialog.schedule.shift_id}>{dialog.schedule.shift_name} ({displayTime(dialog.schedule.start_time)}–{displayTime(dialog.schedule.end_time)})</option>}
                    </select>
                  </label>
                  <label className="form-group">
                    <span className="form-label">Ghi chú</span>
                    <input className="form-input" maxLength={255} value={form.notes || ''} onChange={event => setForm(current => current ? { ...current, notes: event.target.value } : current)} />
                  </label>
                </>
              )}
              <label className="form-group">
                <span className="form-label">Lý do {dialog.action === 'cancel' ? 'hủy' : 'chỉnh sửa'}</span>
                <textarea className="form-input" rows={3} minLength={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} required />
              </label>
              {dialog.action === 'edit' && <p className="work-schedule-dialog-hint">Lịch đã được dùng để ghi nhận chấm công không thể chỉnh sửa vì snapshot chấm công cần được giữ nguyên.</p>}
              <footer className="work-schedule-dialog-actions">
                <button type="button" className="btn btn-secondary" onClick={closeDialog} disabled={saving}>Quay lại</button>
                <button type="submit" className={`btn ${dialog.action === 'cancel' ? 'btn-danger' : 'btn-primary'}`} disabled={saving || reason.trim().length < 3 || (dialog.action === 'edit' && !form)}>
                  {saving ? 'Đang lưu...' : dialog.action === 'edit' ? 'Lưu thay đổi' : 'Xác nhận hủy'}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}
