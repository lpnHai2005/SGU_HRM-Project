import { useEffect, useState } from 'react'
import { workShiftApi } from '../../services/api'
import type { WorkShiftCatalogItem, WorkShiftUpdate } from '../../types'

type Props = {
  isOpen: boolean
  canEdit: boolean
  onClose: () => void
  onSaved: (message: string) => void
}

const toMinutes = (value: string) => {
  const [h, m] = value.slice(0, 5).split(':').map(Number)
  return h * 60 + m
}

/** Giờ có mặt − nghỉ giữa ca. Ca qua đêm được tính sang ngày hôm sau. */
function netShiftHours(start: string, end: string, breakMinutes: number) {
  const elapsed = (toMinutes(end) - toMinutes(start) + 24 * 60) % (24 * 60)
  return (elapsed - breakMinutes) / 60
}

const formatHours = (value: number) => value.toFixed(2).replace(/\.?0+$/, '')

const toForm = (shift: WorkShiftCatalogItem): WorkShiftUpdate => ({
  shift_name: shift.shift_name,
  start_time: shift.start_time.slice(0, 5),
  end_time: shift.end_time.slice(0, 5),
  work_hours: Number(shift.work_hours),
  break_minutes: Number(shift.break_minutes ?? 0),
  is_active: shift.is_active ?? true,
})

/** Danh mục ca: HR / Giám đốc chỉnh khung giờ, giờ nghỉ giữa ca và định mức giờ công của từng ca. */
export function ShiftTemplateModal({ isOpen, canEdit, onClose, onSaved }: Props) {
  const [shifts, setShifts] = useState<WorkShiftCatalogItem[]>([])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<WorkShiftUpdate | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    let active = true
    workShiftApi.list()
      .then(rows => { if (active) { setShifts(rows); setError('') } })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : 'Không tải được danh mục ca.') })
    return () => { active = false }
  }, [isOpen])

  if (!isOpen) return null

  const net = form ? netShiftHours(form.start_time, form.end_time, form.break_minutes) : 0
  const mismatch = form ? Math.abs(net - form.work_hours) > 0.01 : false

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form || editingId === null || mismatch) return
    setSaving(true)
    try {
      const saved = await workShiftApi.update(editingId, form)
      setShifts(rows => rows.map(row => (row.shift_id === editingId ? { ...row, ...saved } : row)))
      setEditingId(null)
      setForm(null)
      onSaved(`Đã cập nhật ca "${saved.shift_name}". Lượt chấm công cũ giữ nguyên giờ ca lúc check-in.`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Không lưu được ca làm việc.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" role="presentation"
      onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose() }}>
      <section className="modal work-schedule-dialog shift-template-modal" role="dialog" aria-modal="true"
        aria-labelledby="shift-template-title">
        <header className="modal-header">
          <h2 id="shift-template-title">Danh mục ca làm việc</h2>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Đóng</button>
        </header>

        <div className="work-schedule-dialog-form">
          <p className="form-hint">
            Định mức giờ công của ca = khung giờ − nghỉ giữa ca. Ca bán lẻ nghỉ luân phiên tại cửa hàng nên để nghỉ 0 phút
            (VD Ca sáng 08:00–16:00 = 8h); ca văn phòng có giờ nghỉ trưa thì nhập số phút nghỉ.
            Lượt chấm công đã có không thay đổi.
          </p>
          {error && <div className="work-schedule-error" role="alert">{error}</div>}

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ca</th>
                  <th>Khung giờ</th>
                  <th>Nghỉ giữa ca</th>
                  <th>Định mức</th>
                  <th>Trạng thái</th>
                  {canEdit && <th aria-label="Thao tác" />}
                </tr>
              </thead>
              <tbody>
                {shifts.map(shift => (
                  <tr key={shift.shift_id}>
                    <td><strong>{shift.shift_name}</strong><br /><small>{shift.shift_code}</small></td>
                    <td>{shift.start_time.slice(0, 5)}–{shift.end_time.slice(0, 5)}</td>
                    <td>{shift.break_minutes ? `${shift.break_minutes} phút` : 'Không trừ (nghỉ luân phiên)'}</td>
                    <td>{formatHours(Number(shift.work_hours))}h/ca</td>
                    <td>{shift.is_active === false ? 'Ngừng dùng' : 'Đang dùng'}</td>
                    {canEdit && (
                      <td>
                        <button type="button" className="btn btn-secondary btn-sm"
                          onClick={() => { setEditingId(shift.shift_id); setForm(toForm(shift)); setError('') }}>
                          Sửa
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {canEdit && form && (
            <form onSubmit={save} className="shift-template-form">
              <label className="form-group">
                <span className="form-label">Tên ca</span>
                <input className="form-input" value={form.shift_name} required minLength={2}
                  onChange={e => setForm({ ...form, shift_name: e.target.value })} />
              </label>
              <div className="shift-template-grid">
                <label className="form-group">
                  <span className="form-label">Bắt đầu</span>
                  <input type="time" className="form-input" value={form.start_time} required
                    onChange={e => setForm({ ...form, start_time: e.target.value })} />
                </label>
                <label className="form-group">
                  <span className="form-label">Kết thúc</span>
                  <input type="time" className="form-input" value={form.end_time} required
                    onChange={e => setForm({ ...form, end_time: e.target.value })} />
                </label>
                <label className="form-group">
                  <span className="form-label">Nghỉ giữa ca không tính giờ (phút)</span>
                  <input type="number" className="form-input" min={0} max={240} step={15} value={form.break_minutes}
                    onChange={e => setForm({ ...form, break_minutes: Number(e.target.value) })} />
                </label>
                <label className="form-group">
                  <span className="form-label">Định mức giờ công/ca</span>
                  <input type="number" className="form-input" min={0.5} max={24} step={0.5} value={form.work_hours}
                    onChange={e => setForm({ ...form, work_hours: Number(e.target.value) })} />
                </label>
                <label className="work-schedule-checkbox-toggle">
                  <input type="checkbox" checked={form.is_active}
                    onChange={e => setForm({ ...form, is_active: e.target.checked })} />
                  <span>Đang sử dụng</span>
                </label>
              </div>
              <p className={mismatch ? 'work-schedule-error' : 'form-hint'} role={mismatch ? 'alert' : undefined}>
                Khung giờ − nghỉ = {formatHours(net)}h
                {mismatch ? ` — phải bằng định mức giờ công (${formatHours(form.work_hours)}h).` : ' = định mức giờ công.'}
              </p>
              <footer className="modal-footer">
                <button type="button" className="btn btn-secondary" disabled={saving}
                  onClick={() => { setEditingId(null); setForm(null) }}>Hủy</button>
                <button type="submit" className="btn btn-primary" disabled={saving || mismatch}>
                  {saving ? 'Đang lưu...' : 'Lưu ca'}
                </button>
              </footer>
            </form>
          )}
        </div>
      </section>
    </div>
  )
}
