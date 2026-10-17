import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
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
}

export function PayrollOvertimePanel({ period }: { period: string }) {
  const { user } = useAuth()
  const [rows, setRows] = useState<OvertimeRow[]>([])
  const [drafts, setDrafts] = useState<Record<number, { hours: string; reason: string }>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await api.get<OvertimeRow[]>('/payrolls/overtime-approvals', { period })
      setRows(data)
      setError('')
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
    void load()
  }, [load])

  const decide = async (row: OvertimeRow, decision: 'APPROVED' | 'REJECTED') => {
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
                        disabled={isSelf}
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
                        disabled={isSelf}
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
                            disabled={busy !== null}
                            onClick={() => void decide(row, 'APPROVED')}
                          >
                            {Icons.check} Duyệt
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            disabled={busy !== null}
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
                          : 'Chờ duyệt'}
                      </small>
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

