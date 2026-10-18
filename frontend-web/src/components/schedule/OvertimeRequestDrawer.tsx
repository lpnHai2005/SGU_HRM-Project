import { useEffect, useMemo, useRef, useState } from 'react'
import { DatePicker } from '../common/DatePicker'
import { Icons } from '../common/Icons'
import { overtimeRequestApi } from '../../services/api'
import type { Employee, Lookups } from '../../types'

type Props = {
  isOpen: boolean
  user: any
  employees: Employee[]
  lookups: Lookups | null
  onClose: () => void
  onSuccess: (message: string) => void
  initialDate: string
  initialStoreId?: number
  initialEmployeeId?: number
  fixedEmployeeId?: number
}

type BatchResult = { employeeId: number; requestId?: number; succeeded: boolean; message: string }

const todayVietnam = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())

function makeIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() || `ot-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`
}

export function OvertimeRequestDrawer({
  isOpen, user, employees, lookups, onClose, onSuccess, initialDate, initialStoreId, initialEmployeeId, fixedEmployeeId,
}: Props) {
  const roles: string[] = user?.roles || []
  const isStoreManager = roles.includes('STORE_MANAGER') && !roles.includes('ADMIN') && !roles.includes('HR_MANAGER')
  const isEmployeeOnly = roles.includes('EMPLOYEE') && !roles.some(role => ['ADMIN', 'HR_MANAGER', 'STORE_MANAGER'].includes(role))
  const isSelfOnly = fixedEmployeeId !== undefined || isEmployeeOnly
  const [storeId, setStoreId] = useState<number>(Number(initialStoreId || user?.store_id || lookups?.stores[0]?.store_id || 0))
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>(fixedEmployeeId ? [fixedEmployeeId] : [])
  const [employeeSearch, setEmployeeSearch] = useState('')
  const [workDate, setWorkDate] = useState(initialDate || todayVietnam())
  const [startTime, setStartTime] = useState('18:00')
  const [endTime, setEndTime] = useState('20:00')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [retryLocked, setRetryLocked] = useState(false)
  const [batchComplete, setBatchComplete] = useState(false)
  const [batchResults, setBatchResults] = useState<BatchResult[]>([])
  const batchKey = useRef<string | null>(null)
  const submitting = useRef(false)
  const lastContext = useRef('')

  const context = `${initialDate}|${initialStoreId || ''}|${initialEmployeeId || ''}|${fixedEmployeeId || ''}`
  useEffect(() => {
    if (!isOpen || lastContext.current === context) return
    lastContext.current = context
    setWorkDate(initialDate || todayVietnam())
    setStoreId(Number(fixedEmployeeId ? user?.store_id : initialStoreId || user?.store_id || lookups?.stores[0]?.store_id || 0))
    setSelectedEmployeeIds(fixedEmployeeId ? [fixedEmployeeId] : initialEmployeeId ? [initialEmployeeId] : isSelfOnly && user?.employee_id ? [Number(user.employee_id)] : [])
    setRetryLocked(false)
    setBatchComplete(false)
    setBatchResults([])
    batchKey.current = null
    setFieldErrors({})
    setFormError('')
  }, [isOpen, context, initialDate, initialStoreId, initialEmployeeId, fixedEmployeeId, user, lookups, isSelfOnly])

  const employeeOptions = useMemo(() => employees.filter(employee => {
    const eligible = employee.employment_status === 'ACTIVE' || employee.employment_status === 'PROBATION'
    const inStore = fixedEmployeeId
      ? employee.employee_id === fixedEmployeeId
      : isSelfOnly
        ? employee.employee_id === user?.employee_id
        : Number(employee.store_id) === storeId
    const search = employeeSearch.trim().toLocaleLowerCase('vi-VN')
    const name = employee.full_name || `${employee.last_name} ${employee.first_name}`
    const matchesSearch = !search || `${name} ${employee.employee_code || ''}`.toLocaleLowerCase('vi-VN').includes(search)
    return eligible && inStore && matchesSearch
  }), [employees, fixedEmployeeId, isSelfOnly, user?.employee_id, storeId, employeeSearch])

  const estimatedHours = useMemo(() => {
    const [startHour, startMinute] = startTime.split(':').map(Number)
    const [endHour, endMinute] = endTime.split(':').map(Number)
    let minutes = endHour * 60 + endMinute - (startHour * 60 + startMinute)
    if (minutes <= 0) minutes += 24 * 60
    return minutes / 60
  }, [startTime, endTime])

  const employeeName = (id: number) => {
    const employee = employees.find(row => row.employee_id === id)
    return employee?.full_name || `NV #${id}`
  }

  const validate = () => {
    const errors: Record<string, string> = {}
    if (!storeId && !isSelfOnly) errors.store = 'Chọn cửa hàng trước khi đăng ký.'
    if (!selectedEmployeeIds.length) errors.employee = 'Chọn ít nhất một nhân viên.'
    if (!workDate) errors.date = 'Chọn ngày tăng ca.'
    if (!startTime) errors.start = 'Chọn giờ bắt đầu.'
    if (!endTime) errors.end = 'Chọn giờ kết thúc.'
    if (startTime && endTime && startTime === endTime) errors.end = 'Giờ kết thúc phải khác giờ bắt đầu.'
    if (reason.trim().length < 3) errors.reason = 'Nhập lý do ít nhất 3 ký tự.'
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const toggleEmployee = (employeeId: number) => {
    if (isSelfOnly) return
    if (retryLocked && batchResults.some(result => result.employeeId === employeeId && result.succeeded)) return
    setSelectedEmployeeIds(current => current.includes(employeeId)
      ? current.filter(id => id !== employeeId)
      : [...current, employeeId])
    setFieldErrors(current => ({ ...current, employee: '' }))
  }

  const handleSave = async (submit: boolean) => {
    if (submitting.current || batchComplete || !validate()) return
    submitting.current = true
    setSaving(true)
    setFormError('')
    const batch = batchKey.current || (batchKey.current = makeIdempotencyKey())
    const attemptedEmployees = [...selectedEmployeeIds]
    const outcomes: BatchResult[] = []
    try {
      for (const employeeId of attemptedEmployees) {
        let requestId: number | undefined
        try {
          const created = await overtimeRequestApi.create({
            employee_id: employeeId,
            store_id: storeId || undefined,
            work_date: workDate,
            start_time: startTime,
            end_time: endTime,
            reason: reason.trim(),
            notes: notes.trim() || undefined,
          }, `${batch}-${employeeId}`)
          requestId = created.request_id
          if (submit) await overtimeRequestApi.submit(created.request_id)
          outcomes.push({ employeeId, requestId, succeeded: true, message: submit ? 'Đã gửi đăng ký.' : 'Đã lưu bản nháp.' })
        } catch (error) {
          const detail = error instanceof Error ? error.message : 'Không thể xử lý đơn OT này.'
          outcomes.push({ employeeId, requestId, succeeded: false, message: detail })
        }
      }
      setBatchResults(current => {
        const byEmployee = new Map(current.map(result => [result.employeeId, result]))
        outcomes.forEach(result => byEmployee.set(result.employeeId, result))
        return [...byEmployee.values()]
      })
      const failures = outcomes.filter(result => !result.succeeded)
      const successes = outcomes.filter(result => result.succeeded)
      if (failures.length) {
        setSelectedEmployeeIds(failures.map(result => result.employeeId))
        setRetryLocked(true)
        setFormError(`${successes.length} đơn hoàn tất, ${failures.length} đơn cần xử lý. Xem kết quả theo từng nhân viên bên dưới; chỉ các đơn lỗi còn được chọn để thử lại.`)
        if (successes.length) onSuccess(`Đã xử lý ${successes.length}/${attemptedEmployees.length} đơn OT; các đơn lỗi được giữ lại để thử lại.`)
      } else {
        setRetryLocked(false)
        setBatchComplete(true)
        setFormError('')
        batchKey.current = null
        onSuccess(`${successes.length} đơn OT ${submit ? 'đã gửi đăng ký' : 'đã lưu nháp'} thành công.`)
      }
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="drawer-overlay" onClick={event => { if (event.target === event.currentTarget && !saving) onClose() }}>
      <aside className="schedule-drawer overtime-drawer" role="dialog" aria-modal="true" aria-labelledby="overtime-drawer-title">
        <header className="schedule-drawer-header">
          <div className="schedule-drawer-header-info">
            <h2 id="overtime-drawer-title" className="schedule-drawer-title">Đăng ký tăng ca</h2>
            <p className="schedule-drawer-subtitle">Tạo đề xuất tăng ca để gửi nhân viên xác nhận và HR phê duyệt.</p>
          </div>
          <button type="button" className="drawer-close-btn" onClick={onClose} disabled={saving} aria-label="Đóng">{Icons.close}</button>
        </header>

        <form className="schedule-drawer-form overtime-drawer-form" onSubmit={event => { event.preventDefault(); void handleSave(true) }}>
          {formError && <div className="work-schedule-error" role="alert">{formError}</div>}

          {!isSelfOnly && (
            <div className="form-group">
              <label className="form-label" htmlFor="overtime-store">Cửa hàng <span className="label-required">*</span></label>
              <select id="overtime-store" className="form-select" value={storeId || ''} disabled={isStoreManager || retryLocked || saving || batchComplete}
                onChange={event => { setStoreId(Number(event.target.value)); setSelectedEmployeeIds([]); setFieldErrors(current => ({ ...current, store: '', employee: '' })) }}>
                {!isStoreManager && <option value="">Chọn cửa hàng</option>}
                {(lookups?.stores || []).filter(store => !isStoreManager || store.store_id === user?.store_id).map(store =>
                  <option key={store.store_id} value={store.store_id}>{store.store_name}</option>)}
              </select>
              {fieldErrors.store && <small className="field-error">{fieldErrors.store}</small>}
            </div>
          )}

          {!isSelfOnly && (
            <div className="form-group">
              <div className="employee-selection-header">
                <label className="form-label" htmlFor="overtime-employee-search">Nhân viên ({selectedEmployeeIds.length} đã chọn) <span className="label-required">*</span></label>
                {!isStoreManager && <input id="overtime-employee-search" className="form-input overtime-employee-search" placeholder="Tìm tên hoặc mã nhân viên"
                  value={employeeSearch} disabled={retryLocked || saving || batchComplete} onChange={event => setEmployeeSearch(event.target.value)} />}
              </div>
              {fieldErrors.employee && <small className="field-error">{fieldErrors.employee}</small>}
              {initialEmployeeId && <small className="form-hint">Nhân viên được chọn từ lịch; có thể chọn thêm người nhận đơn riêng.</small>}
              <div className="overtime-employee-list">
                {employeeOptions.length ? employeeOptions.map(employee => {
                  const name = employee.full_name || `${employee.last_name} ${employee.first_name}`
                  return <label key={employee.employee_id} className={`employee-select-item ${selectedEmployeeIds.includes(employee.employee_id) ? 'selected' : ''}`}>
                    <input type="checkbox" checked={selectedEmployeeIds.includes(employee.employee_id)} disabled={saving || batchComplete || retryLocked && batchResults.some(result => result.employeeId === employee.employee_id && result.succeeded)}
                      onChange={() => toggleEmployee(employee.employee_id)} />
                    <span className="employee-info-col"><span className="employee-info-main"><strong className="employee-name">{name}</strong><small className="employee-code">{employee.employee_code || `NV-${employee.employee_id}`}</small></span>
                      <small className="employee-info-sub">{employee.position_name || 'Nhân viên'} · {employee.store_name || `Cửa hàng #${employee.store_id}`}</small></span>
                  </label>
                }) : <p className="overtime-empty-employees">Không có nhân viên đủ điều kiện trong cửa hàng đã chọn.</p>}
              </div>
            </div>
          )}

          {isSelfOnly && <div className="overtime-self-summary"><span className="overtime-self-icon">{Icons.user}</span><span><small>Nhân viên đăng ký</small><strong>{user?.full_name || employeeName(Number(fixedEmployeeId || user?.employee_id))}</strong></span></div>}

          <div className="form-group">
            <DatePicker value={workDate} label="Ngày tăng ca" disabled={saving || retryLocked || batchComplete}
              onChange={date => { setWorkDate(date); setFieldErrors(current => ({ ...current, date: '' })) }} />
            {fieldErrors.date && <small className="field-error">{fieldErrors.date}</small>}
          </div>

          <div className="overtime-time-row">
            <div className="form-group">
              <label className="form-label" htmlFor="overtime-start">Giờ bắt đầu <span className="label-required">*</span></label>
              <input id="overtime-start" className="form-input" type="time" value={startTime} disabled={saving || retryLocked || batchComplete}
                onChange={event => { setStartTime(event.target.value); setFieldErrors(current => ({ ...current, start: '' })) }} />
              {fieldErrors.start && <small className="field-error">{fieldErrors.start}</small>}
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="overtime-end">Giờ kết thúc <span className="label-required">*</span></label>
              <input id="overtime-end" className="form-input" type="time" value={endTime} disabled={saving || retryLocked || batchComplete}
                onChange={event => { setEndTime(event.target.value); setFieldErrors(current => ({ ...current, end: '' })) }} />
              {fieldErrors.end && <small className="field-error">{fieldErrors.end}</small>}
            </div>
          </div>
          <div className="overtime-estimate"><span>{Icons.clockOutline} Tổng giờ dự kiến</span><strong>{estimatedHours.toFixed(2)} giờ</strong><small>Tham khảo · giờ kết thúc sớm hơn giờ bắt đầu được hiểu là qua ngày hôm sau.</small></div>

          <div className="form-group">
            <label className="form-label" htmlFor="overtime-reason">Lý do tăng ca <span className="label-required">*</span></label>
            <textarea id="overtime-reason" className="form-input overtime-textarea" rows={3} maxLength={1000} value={reason} disabled={saving || retryLocked || batchComplete}
              onChange={event => { setReason(event.target.value); setFieldErrors(current => ({ ...current, reason: '' })) }} placeholder="Nêu công việc hoặc nhu cầu cần tăng ca" />
            {fieldErrors.reason && <small className="field-error">{fieldErrors.reason}</small>}
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="overtime-notes">Ghi chú</label>
            <textarea id="overtime-notes" className="form-input overtime-textarea" rows={2} maxLength={500} value={notes} disabled={saving || retryLocked || batchComplete}
              onChange={event => setNotes(event.target.value)} placeholder="Thông tin bổ sung (không bắt buộc)" />
          </div>
          {selectedEmployeeIds.length > 1 && <p className="overtime-batch-hint">Hệ thống tạo {selectedEmployeeIds.length} đơn riêng; từng nhân viên xác nhận và HR duyệt độc lập.</p>}
          {retryLocked && <p className="overtime-batch-hint">Một phần đơn đã tạo. Thông tin đăng ký được khóa để retry an toàn; có thể bỏ chọn nhân viên chưa tạo được rồi gửi tiếp.</p>}

          {batchResults.length > 0 && <section className="overtime-batch-results" aria-label="Kết quả từng đơn OT">
            <h3>{batchComplete ? 'Kết quả đăng ký' : 'Kết quả theo từng nhân viên'}</h3>
            <ul>{batchResults.map(result => <li key={result.employeeId} className={result.succeeded ? 'is-success' : 'is-error'}>
              <span><strong>{employeeName(result.employeeId)}</strong>{result.requestId && <small>OT #{result.requestId}</small>}</span>
              <span className="overtime-batch-result-message">{result.message}</span>
              <b>{result.succeeded ? 'Thành công' : 'Cần xử lý'}</b>
            </li>)}</ul>
          </section>}

          {batchComplete ? <footer className="schedule-drawer-footer"><span className="overtime-batch-complete">Tất cả đơn đã được xử lý thành công.</span><button type="button" className="btn btn-primary" onClick={onClose}>Đóng</button></footer> : <footer className="schedule-drawer-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Hủy</button>
            <button type="button" className="btn btn-secondary" onClick={() => void handleSave(false)} disabled={saving || retryLocked && !selectedEmployeeIds.length}>{saving ? 'Đang lưu…' : retryLocked ? 'Thử lại đơn lỗi' : 'Lưu nháp'}</button>
            <button type="submit" className="btn btn-primary" disabled={saving || retryLocked && !selectedEmployeeIds.length}>{saving ? 'Đang gửi…' : retryLocked ? 'Gửi lại đơn lỗi' : 'Gửi đăng ký'}</button>
          </footer>}
        </form>
      </aside>
    </div>
  )
}
