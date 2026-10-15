import { useState, useEffect, useMemo } from 'react'
import { Icons } from '../common/Icons'
import { DatePicker } from '../common/DatePicker'
import { workScheduleApi } from '../../services/api'
import type { Employee, Lookups, WorkSchedule, WorkScheduleWrite } from '../../types'

export interface WorkScheduleDrawerProps {
  isOpen: boolean
  onClose: () => void
  initialMode?: 'daily' | 'recurring'
  initialDate?: string
  initialShiftId?: number
  initialStoreId?: number
  user: any
  lookups: Lookups | null
  employees: Employee[]
  existingSchedules: WorkSchedule[]
  onSuccess: (message: string) => void
}

const todayVietnam = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

const WEEKDAY_OPTIONS = [
  { label: 'T2', value: 1, name: 'Thứ Hai' },
  { label: 'T3', value: 2, name: 'Thứ Ba' },
  { label: 'T4', value: 3, name: 'Thứ Tư' },
  { label: 'T5', value: 4, name: 'Thứ Năm' },
  { label: 'T6', value: 5, name: 'Thứ Sáu' },
  { label: 'T7', value: 6, name: 'Thứ Bảy' },
  { label: 'CN', value: 7, name: 'Chủ Nhật' },
]

export function WorkScheduleDrawer({
  isOpen,
  onClose,
  initialMode = 'daily',
  initialDate,
  initialShiftId = 1,
  initialStoreId,
  user,
  lookups,
  employees,
  existingSchedules,
  onSuccess,
}: WorkScheduleDrawerProps) {
  const roles: string[] = user?.roles || []
  const isStoreManager = roles.includes('STORE_MANAGER') && !roles.includes('ADMIN') && !roles.includes('HR_MANAGER')

  const [mode, setMode] = useState<'daily' | 'recurring'>(initialMode)
  const [storeId, setStoreId] = useState<number>(() => {
    if (isStoreManager && user?.store_id) return Number(user.store_id)
    if (initialStoreId) return Number(initialStoreId)
    return lookups?.stores[0]?.store_id || 1
  })
  const [shiftId, setShiftId] = useState<number>(initialShiftId || 1)
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([])
  const [employeeSearch, setEmployeeSearch] = useState('')
  const [notes, setNotes] = useState('')
  const [reason, setReason] = useState('Phân ca theo kế hoạch tuần')

  // Daily mode state
  const [workDate, setWorkDate] = useState<string>(initialDate || todayVietnam())

  // Recurring mode state
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5, 6]) // Default Mon-Sat
  const [startDate, setStartDate] = useState<string>(initialDate || todayVietnam())
  const [hasEndDate, setHasEndDate] = useState<boolean>(false)
  const [endDate, setEndDate] = useState<string>('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Sync state when drawer opens or initial props change
  useEffect(() => {
    if (isOpen) {
      setMode(initialMode)
      if (initialDate) {
        setWorkDate(initialDate)
        setStartDate(initialDate >= todayVietnam() ? initialDate : todayVietnam())
      }
      if (initialShiftId) setShiftId(initialShiftId)
      if (isStoreManager && user?.store_id) {
        setStoreId(Number(user.store_id))
      } else if (initialStoreId) {
        setStoreId(Number(initialStoreId))
      }
      setError('')
      setReason(initialMode === 'recurring' ? 'Phân ca cố định theo kế hoạch' : 'Phân ca theo kế hoạch tuần')
    }
  }, [isOpen, initialMode, initialDate, initialShiftId, initialStoreId, isStoreManager, user])

  // Shift list (4 standard shifts)
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

  const selectedShift = useMemo(
    () => standardShifts.find(s => s.shift_id === shiftId) || standardShifts[0],
    [standardShifts, shiftId]
  )

  // Filter assignable employees in store
  const assignableEmployees = useMemo(() => {
    return employees.filter(emp => {
      const isEligible = emp.employment_status === 'ACTIVE' || emp.employment_status === 'PROBATION'
      if (!isEligible) return false
      if (storeId && emp.store_id && emp.store_id !== storeId) return false
      return true
    })
  }, [employees, storeId])

  const filteredEmployees = useMemo(() => {
    const q = employeeSearch.toLowerCase().trim()
    if (!q) return assignableEmployees
    return assignableEmployees.filter(emp =>
      (emp.full_name || '').toLowerCase().includes(q) ||
      (emp.employee_code || '').toLowerCase().includes(q) ||
      (emp.position_name || '').toLowerCase().includes(q)
    )
  }, [assignableEmployees, employeeSearch])

  // Toggle employee selection
  const toggleEmployee = (empId: number) => {
    if (isStoreManager && empId === user?.employee_id) return
    setSelectedEmployeeIds(prev =>
      prev.includes(empId) ? prev.filter(id => id !== empId) : [...prev, empId]
    )
  }

  const toggleSelectAll = () => {
    const eligibleIds = filteredEmployees
      .filter(e => !(isStoreManager && e.employee_id === user?.employee_id))
      .map(e => e.employee_id)

    const allSelected = eligibleIds.every(id => selectedEmployeeIds.includes(id))
    if (allSelected) {
      setSelectedEmployeeIds(prev => prev.filter(id => !eligibleIds.includes(id)))
    } else {
      setSelectedEmployeeIds(prev => Array.from(new Set([...prev, ...eligibleIds])))
    }
  }

  // Toggle weekday for recurring mode
  const toggleWeekday = (val: number) => {
    setWeekdays(prev => {
      if (prev.includes(val)) {
        if (prev.length === 1) return prev
        return prev.filter(v => v !== val)
      }
      return [...prev, val].sort((a, b) => a - b)
    })
  }

  // Preview conflict detection
  const previewConflicts = useMemo(() => {
    const conflicts: string[] = []
    if (selectedEmployeeIds.length === 0) return conflicts

    if (mode === 'daily') {
      for (const empId of selectedEmployeeIds) {
        const emp = employees.find(e => e.employee_id === empId)
        const name = emp?.full_name || `NV #${empId}`
        const match = existingSchedules.find(
          s => s.employee_id === empId && s.work_date === workDate && !s.cancelled_at
        )
        if (match) {
          conflicts.push(`${name} đã được phân ${match.shift_name} vào ngày ${workDate}`)
        }
      }
    }
    return conflicts
  }, [selectedEmployeeIds, mode, workDate, existingSchedules, employees])

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (selectedEmployeeIds.length === 0) {
      setError('Vui lòng chọn ít nhất một nhân viên.')
      return
    }
    if (!reason.trim() || reason.trim().length < 3) {
      setError('Vui lòng nhập lý do phân ca (tối thiểu 3 ký tự).')
      return
    }

    setSaving(true)
    setError('')

    try {
      if (mode === 'daily') {
        const assignments: WorkScheduleWrite[] = selectedEmployeeIds.map(empId => ({
          employee_id: empId,
          store_id: storeId,
          shift_id: shiftId,
          work_date: workDate,
          notes: notes.trim() || undefined,
          reason: reason.trim(),
        }))

        if (assignments.length === 1) {
          await workScheduleApi.create(assignments[0])
        } else {
          await workScheduleApi.createBatch(assignments)
        }
        onSuccess(`Đã phân ca thành công cho ${assignments.length} nhân viên vào ngày ${workDate}.`)
        onClose()
      } else {
        if (weekdays.length === 0) {
          setError('Vui lòng chọn ít nhất một thứ lặp lại trong tuần.')
          setSaving(false)
          return
        }
        if (startDate < todayVietnam()) {
          setError('Ngày bắt đầu ca cố định không được ở trong quá khứ.')
          setSaving(false)
          return
        }
        if (hasEndDate && endDate && endDate < startDate) {
          setError('Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu.')
          setSaving(false)
          return
        }

        const weekdayStr = weekdays.join(',')
        const assignments = selectedEmployeeIds.map(empId => ({
          employee_id: empId,
          store_id: storeId,
          shift_id: shiftId,
          work_date: startDate,
          notes: notes.trim() || 'Phân ca nhân viên chính thức',
          weekdays: weekdayStr,
          end_date: hasEndDate && endDate ? endDate : undefined,
        }))

        if (assignments.length === 1) {
          await workScheduleApi.assignFixed(assignments[0])
        } else {
          await workScheduleApi.assignFixedBatch(assignments)
        }

        onSuccess(`Đã thiết lập ca cố định thành công cho ${assignments.length} nhân viên.`)
        onClose()
      }
    } catch (err: any) {
      const detail = err.response?.data?.detail
      if (typeof detail === 'string') {
        setError(detail)
      } else if (detail && typeof detail === 'object') {
        if (detail.code === 'SCHEDULE_CONFLICT') {
          setError('Phát hiện trùng lịch làm việc với ca đã được phân công trước đó.')
        } else {
          setError(JSON.stringify(detail))
        }
      } else {
        setError(err.message || 'Không thể lưu phân ca làm việc.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="drawer-overlay" onClick={e => { if (e.target === e.currentTarget && !saving) onClose() }}>
      <aside className="schedule-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header className="schedule-drawer-header">
          <div className="schedule-drawer-header-info">
            <h2 id="drawer-title" className="schedule-drawer-title">
              {mode === 'daily' ? 'Phân ca làm việc theo ngày' : 'Thiết lập ca cố định'}
            </h2>
            <p className="schedule-drawer-subtitle">
              {mode === 'daily'
                ? 'Phân công ca cụ thể cho một ngày làm việc; không tự động lặp lại.'
                : 'Quy tắc lặp lại hằng tuần, sinh lịch trong cửa sổ 90 ngày.'}
            </p>
          </div>
          <button type="button" className="drawer-close-btn" onClick={onClose} disabled={saving} aria-label="Đóng">
            {Icons.close}
          </button>
        </header>

        {/* Mode Segmented Control */}
        <div className="schedule-mode-toggle" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'daily'}
            className={`schedule-mode-btn ${mode === 'daily' ? 'active' : ''}`}
            onClick={() => setMode('daily')}
            disabled={saving}
          >
            {Icons.calendar}
            <span>Phân ca theo ngày</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'recurring'}
            className={`schedule-mode-btn ${mode === 'recurring' ? 'active' : ''}`}
            onClick={() => setMode('recurring')}
            disabled={saving}
          >
            {Icons.refresh}
            <span>Ca cố định (Lặp tuần)</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="schedule-drawer-form">
          {error && <div className="work-schedule-error" role="alert">{error}</div>}

          {/* Store Selection */}
          <div className="form-group">
            <label className="form-label">
              <span>Cửa hàng / Chi nhánh</span>
              {isStoreManager && <span className="label-badge">Cửa hàng của bạn</span>}
            </label>
            <select
              className="form-select"
              value={storeId}
              disabled={isStoreManager || saving}
              onChange={e => setStoreId(Number(e.target.value))}
            >
              {lookups?.stores.map(store => (
                <option key={store.store_id} value={store.store_id}>
                  {store.store_name}
                </option>
              ))}
            </select>
          </div>

          {/* Shift Selection Cards */}
          <div className="form-group">
            <label className="form-label">
              <span>Ca làm việc (Danh mục chuẩn)</span>
              <span className="label-badge">{selectedShift.work_hours}h công chuẩn</span>
            </label>
            <div className="shift-cards-grid">
              {standardShifts.map(s => {
                const isSelected = s.shift_id === shiftId
                return (
                  <button
                    key={s.shift_id}
                    type="button"
                    className={`shift-card-option ${isSelected ? 'selected' : ''}`}
                    onClick={() => setShiftId(s.shift_id)}
                    disabled={saving}
                  >
                    <div className="shift-card-header">
                      <span className="shift-card-name">{s.shift_name}</span>
                      <span className="shift-card-hours">{s.work_hours}h</span>
                    </div>
                    <div className="shift-card-time">
                      {s.start_time.slice(0, 5)} – {s.end_time.slice(0, 5)}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Mode specific fields */}
          {mode === 'daily' ? (
            <div className="form-group">
              <DatePicker
                key={workDate}
                value={workDate}
                label="Ngày làm việc"
                disabled={saving}
                onChange={date => setWorkDate(date)}
              />
              <small className="form-hint">Ca chỉ áp dụng cho ngày này, không phát sinh chuỗi lặp.</small>
            </div>
          ) : (
            <div className="recurring-settings-panel">
              <div className="form-group">
                <label className="form-label">Lặp lại vào các thứ</label>
                <div className="weekday-pill-group">
                  {WEEKDAY_OPTIONS.map(day => {
                    const isChecked = weekdays.includes(day.value)
                    return (
                      <button
                        key={day.value}
                        type="button"
                        className={`weekday-pill ${isChecked ? 'active' : ''}`}
                        onClick={() => toggleWeekday(day.value)}
                        disabled={saving}
                        title={day.name}
                      >
                        {day.label}
                      </button>
                    )
                  })}
                </div>
                <small className="form-hint">Mặc định Thứ Hai đến Thứ Bảy; có thể chọn thêm Chủ Nhật.</small>
              </div>

              <div className="form-group">
                <DatePicker
                  key={startDate}
                  value={startDate}
                  label="Ngày bắt đầu áp dụng"
                  disabled={saving}
                  onChange={date => setStartDate(date)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Thời hạn quy tắc</label>
                <div className="radio-options-row">
                  <label className="radio-option-label">
                    <input
                      type="radio"
                      name="duration"
                      checked={!hasEndDate}
                      onChange={() => setHasEndDate(false)}
                      disabled={saving}
                    />
                    <span>Không có ngày kết thúc (tiếp diễn)</span>
                  </label>
                  <label className="radio-option-label">
                    <input
                      type="radio"
                      name="duration"
                      checked={hasEndDate}
                      onChange={() => {
                        setHasEndDate(true)
                        if (!endDate) setEndDate(startDate)
                      }}
                      disabled={saving}
                    />
                    <span>Kết thúc vào ngày</span>
                  </label>
                </div>
                {hasEndDate && (
                  <div style={{ marginTop: '10px' }}>
                    <DatePicker
                      key={endDate || startDate}
                      value={endDate || startDate}
                      label="Ngày kết thúc"
                      disabled={saving}
                      onChange={date => setEndDate(date)}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Employee Multi-selection */}
          <div className="form-group">
            <div className="employee-selection-header">
              <label className="form-label" style={{ margin: 0 }}>
                <span>Chọn nhân viên ({selectedEmployeeIds.length} đã chọn)</span>
              </label>
              <button
                type="button"
                className="btn-link-sm"
                onClick={toggleSelectAll}
                disabled={saving}
              >
                {filteredEmployees.every(e => selectedEmployeeIds.includes(e.employee_id))
                  ? 'Bỏ chọn tất cả'
                  : 'Chọn tất cả'}
              </button>
            </div>

            {/* Quick search input */}
            <div className="employee-search-bar">
              <span className="search-icon">{Icons.search}</span>
              <input
                type="text"
                className="form-input employee-search-input"
                placeholder="Tìm nhân viên theo tên hoặc mã NV..."
                value={employeeSearch}
                onChange={e => setEmployeeSearch(e.target.value)}
                disabled={saving}
              />
            </div>

            {/* Selected chips list */}
            {selectedEmployeeIds.length > 0 && (
              <div className="selected-employee-chips">
                {selectedEmployeeIds.map(id => {
                  const emp = employees.find(e => e.employee_id === id)
                  return (
                    <span key={id} className="employee-chip">
                      <span>{emp?.full_name || `NV #${id}`}</span>
                      <button
                        type="button"
                        className="chip-remove"
                        onClick={() => toggleEmployee(id)}
                        disabled={saving}
                      >
                        ×
                      </button>
                    </span>
                  )
                })}
              </div>
            )}

            {/* Scrollable employee list */}
            <div className="employee-select-list">
              {filteredEmployees.length === 0 ? (
                <div className="employee-list-empty">Không tìm thấy nhân viên phù hợp</div>
              ) : (
                filteredEmployees.map(emp => {
                  const isSelected = selectedEmployeeIds.includes(emp.employee_id)
                  const isSelf = isStoreManager && emp.employee_id === user?.employee_id
                  return (
                    <label
                      key={emp.employee_id}
                      className={`employee-select-item ${isSelected ? 'selected' : ''} ${isSelf ? 'disabled' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={isSelf || saving}
                        onChange={() => toggleEmployee(emp.employee_id)}
                      />
                      <div className="employee-info-col">
                        <div className="employee-info-main">
                          <strong className="employee-name">{emp.full_name}</strong>
                          <span className="employee-code">{emp.employee_code || `NV-${emp.employee_id}`}</span>
                        </div>
                        <div className="employee-info-sub">
                          <span>{emp.position_name || 'Nhân viên'}</span>
                          {isSelf && <span className="self-notice">• Không được tự phân ca</span>}
                        </div>
                      </div>
                    </label>
                  )
                })
              )}
            </div>
          </div>

          {/* Notes & Reason */}
          <div className="form-group">
            <label className="form-label">Ghi chú phân ca</label>
            <input
              type="text"
              className="form-input"
              maxLength={255}
              placeholder="VD: Phân ca theo kế hoạch tuần, tăng cường cuối tuần..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
              disabled={saving}
            />
          </div>

          <div className="form-group">
            <label className="form-label">
              <span>Lý do phân ca</span>
              <span className="label-required">*</span>
            </label>
            <input
              type="text"
              className="form-input"
              minLength={3}
              maxLength={255}
              required
              value={reason}
              onChange={e => setReason(e.target.value)}
              disabled={saving}
            />
          </div>

          {/* Preview & Alerts */}
          {previewConflicts.length > 0 && (
            <div className="work-schedule-warning-box">
              <span className="warning-icon">{Icons.alertTriangle}</span>
              <div className="warning-content">
                <strong>Cảnh báo trùng ca:</strong>
                <ul>
                  {previewConflicts.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Drawer Actions */}
          <footer className="schedule-drawer-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={saving}
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving || selectedEmployeeIds.length === 0 || reason.trim().length < 3}
            >
              {saving ? 'Đang lưu...' : mode === 'daily' ? 'Lưu phân ca' : 'Lưu ca cố định'}
            </button>
          </footer>
        </form>
      </aside>
    </div>
  )
}
