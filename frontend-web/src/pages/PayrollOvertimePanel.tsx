import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Link } from 'react-router-dom'
import { api } from '../services/api'
import { Icons } from '../components/common/Icons'
import { useAuth } from '../contexts/AuthContext'

type OvertimeRow = {
  attendance_id: number
  employee_id: number
  employee_code: string
  full_name: string
  work_date: string
  actual_overtime_hours: number
  approved_hours: number | null
  decision: string | null
  reason: string | null
  legacy_decision_locked: boolean
  legacy_decision_message: string | null
  actual_overtime_label: string
}

export function PayrollOvertimePanel({ period, mode = 'legacy' }: { period: string; mode?: 'legacy' | 'history' }) {
  const { user } = useAuth()
  const [rows, setRows] = useState<OvertimeRow[]>([])
  const [drafts, setDrafts] = useState<Record<number, { hours: string; reason: string }>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<number | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await api.get<OvertimeRow[]>('/payrolls/overtime-approvals', { period })
      setRows(data)
      setError('')
      setHistoryLoaded(true)
      setDrafts(
        Object.fromEntries(
          data.map(r => [
            r.attendance_id,
            { hours: String(r.approved_hours ?? r.actual_overtime_hours), reason: r.reason || '' },
          ])
        )
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được quyết định OT')
    }
  }, [period])

  useEffect(() => {
    if (mode === 'legacy') void load()
  }, [load, mode])

  const decide = async (row: OvertimeRow, decision: 'APPROVED' | 'REJECTED') => {
    if (row.legacy_decision_locked) return
    if (user?.employee_id && row.employee_id === user.employee_id) {
      toast.warning('Bạn không thể tự phê duyệt tăng ca của chính mình')
      return
    }
    const draft = drafts[row.attendance_id]
    if (!draft?.reason.trim() || draft.reason.trim().length < 3) {
      toast.warning('Vui lòng nhập lý do ít nhất 3 ký tự')
      return
    }
    setBusy(row.attendance_id)
    try {
      await api.put(`/payrolls/overtime-approvals/${row.attendance_id}`, {
        approved_hours: decision === 'REJECTED' ? 0 : Number(draft.hours),
        decision,
        reason: draft.reason.trim(),
      })
      toast.success('Đã lưu quyết định OT')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Không duyệt được OT')
    } finally {
      setBusy(null)
    }
  }

  if (mode === 'history') {
    return (
      <section className="card payroll-ot-history-entry" style={{ padding: 20 }} aria-label="Quy trình OT mới và lịch sử OT cũ">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0 }}>Đăng ký &amp; đối soát OT</h2>
            <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)' }}>
              Phê duyệt và xác minh giờ OT được thực hiện trong quy trình OT riêng. Quyết định OT cũ bên dưới chỉ để tra cứu.
            </p>
          </div>
          <Link className="btn btn-primary" to="/overtime?tab=reconciliation">Mở đối soát OT</Link>
        </div>

        <div style={{ marginTop: 14, borderTop: '1px solid var(--border-default)', paddingTop: 12 }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            aria-expanded={historyOpen}
            onClick={() => {
              const nextOpen = !historyOpen
              setHistoryOpen(nextOpen)
              if (nextOpen && !historyLoaded) void load()
            }}
          >
            {historyOpen ? 'Ẩn lịch sử quyết định OT cũ' : 'Xem lịch sử quyết định OT cũ'}
          </button>
          {historyOpen && (
            <div style={{ marginTop: 12 }}>
              {error && <p role="alert">{error}</p>}
              {!rows.length && !error && <p>Không có quyết định OT cũ trong kỳ {period}.</p>}
              {!!rows.length && <div className="table-container"><table className="data-table">
                <thead><tr><th>Nhân viên</th><th>Ngày</th><th>OT thực tế</th><th>OT đã duyệt</th><th>Trạng thái lịch sử</th></tr></thead>
                <tbody>{rows.map(row => <tr key={row.attendance_id}>
                  <td><strong>{row.full_name}</strong><div>{row.employee_code} · Phiên #{row.attendance_id}</div></td>
                  <td>{new Date(`${row.work_date}T00:00:00`).toLocaleDateString('vi-VN')}</td>
                  <td>{row.actual_overtime_hours}</td>
                  <td>{row.approved_hours ?? '—'}</td>
                  <td>{row.decision === 'APPROVED' ? `Đã duyệt ${row.approved_hours} giờ` : row.decision === 'REJECTED' ? 'Đã từ chối' : 'Chưa có quyết định'}<small style={{ display: 'block' }}>{row.actual_overtime_label}</small></td>
                </tr>)}</tbody>
              </table></div>}
            </div>
          )}
        </div>
      </section>
    )
  }

  return (
    <section className="card" style={{ padding: 20 }}>
      <h2>Giờ OT thực tế & được duyệt</h2>
      <p>Chỉ giờ OT đã duyệt được đưa vào lần tính lương tiếp theo. Kỳ đã duyệt không chỉnh trực tiếp.</p>
      {error && <p role="alert">{error}</p>}
      {!rows.length && !error && <p>Chưa có phiên OT đã kết thúc trong kỳ.</p>}
      {!!rows.length && (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nhân viên</th>
                <th>Ngày</th>
                <th>OT thực tế</th>
                <th>OT duyệt (giờ)</th>
                <th>Lý do</th>
                <th>Quyết định</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const isSelf = Boolean(user?.employee_id && row.employee_id === user.employee_id)
                return (
                  <tr key={row.attendance_id}>
                    <td>
                      <strong>{row.full_name}</strong>
                      <div>{row.employee_code} · Phiên #{row.attendance_id}</div>
                    </td>
                    <td>{new Date(`${row.work_date}T00:00:00`).toLocaleDateString('vi-VN')}</td>
                    <td>{row.actual_overtime_hours}</td>
                    <td>
                      <input
                        className="form-input"
                        type="number"
                        min="0"
                        max={row.actual_overtime_hours}
                        step="0.01"
                        style={{ width: 90 }}
                        disabled={isSelf || row.legacy_decision_locked}
                        value={drafts[row.attendance_id]?.hours ?? ''}
                        onChange={e =>
                          setDrafts({
                            ...drafts,
                            [row.attendance_id]: { ...drafts[row.attendance_id], hours: e.target.value },
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="form-input"
                        aria-label={`Lý do OT ${row.attendance_id}`}
                        disabled={isSelf || row.legacy_decision_locked}
                        value={drafts[row.attendance_id]?.reason ?? ''}
                        onChange={e =>
                          setDrafts({
                            ...drafts,
                            [row.attendance_id]: { ...drafts[row.attendance_id], reason: e.target.value },
                          })
                        }
                      />
                    </td>
                    <td>
                      {isSelf ? (
                        <div style={{ color: 'var(--color-warning, #d97706)', fontStyle: 'italic', fontSize: '12px' }}>
                          (Không thể tự duyệt)
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={busy !== null || row.legacy_decision_locked}
                            onClick={() => void decide(row, 'APPROVED')}
                          >
                            {Icons.check} Duyệt
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            disabled={busy !== null || row.legacy_decision_locked}
                            onClick={() => void decide(row, 'REJECTED')}
                          >
                            {Icons.x} Từ chối
                          </button>
                        </div>
                      )}
                      <small>
                        {row.decision === 'APPROVED'
                          ? `Đã duyệt ${row.approved_hours} giờ`
                          : row.decision === 'REJECTED'
                          ? 'Đã từ chối'
                          : 'Chưa xác nhận OT được phép'}
                      </small>
                      <small style={{ display: 'block' }}>{row.actual_overtime_label}</small>
                      {row.legacy_decision_locked && <small role="status" style={{ display: 'block', color: 'var(--color-warning, #a15c00)' }}>{row.legacy_decision_message}</small>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

