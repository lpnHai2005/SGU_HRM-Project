/**
 * Đơn thôi việc của tôi — nhân viên tự nộp, theo dõi và rút đơn đang chờ duyệt.
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Icons } from '../components/common/Icons'
import { EmptyState } from '../components/common/EmptyState'
import { DatePicker } from '../components/common/DatePicker'
import { confirmAction } from '../components/common/ConfirmDialog'
import { resignationApi } from '../services/resignationService'
import { formatDate } from '../utils/formatters'
import { getContractTypeLabel } from '../types/contract'
import {
  type MyResignation,
  RESIGNATION_STATUS_BADGE,
  RESIGNATION_STATUS_LABELS,
  RESIGNATION_REASON_PRESETS,
} from '../types/resignation'

const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
// Khớp backend (relativedelta months=1): 31/01 -> 28/02
const oneMonthLater = (d: Date) => {
  const lastDayOfNextMonth = new Date(d.getFullYear(), d.getMonth() + 2, 0).getDate()
  return new Date(d.getFullYear(), d.getMonth() + 1, Math.min(d.getDate(), lastDayOfNextMonth))
}
const MAX_FILE_SIZE = 10 * 1024 * 1024

export function MyResignationPage() {
  const [items, setItems] = useState<MyResignation[]>([])
  const [contracts, setContracts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [contractId, setContractId] = useState<number | ''>('')
  const [lastDay, setLastDay] = useState(() => localDate(oneMonthLater(new Date())))
  const [reason, setReason] = useState('')
  const [file, setFile] = useState<File | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [mine, active] = await Promise.all([resignationApi.listMine(), resignationApi.getMyActiveContracts()])
      setItems(mine)
      setContracts(active)
      if (active.length === 1) setContractId(active[0].contract_id)
    } catch (err: any) {
      toast.error(err?.message || 'Không tải được đơn thôi việc')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const hasPending = items.some(i => i.status === 'PENDING')
  const minLastDay = localDate(oneMonthLater(new Date()))

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    e.target.value = ''
    if (!selected) return
    if (selected.size > MAX_FILE_SIZE) return toast.error('Dung lượng file không được vượt quá 10MB')
    setFile(selected)
  }

  const submit = async () => {
    if (!contractId) return toast.error('Vui lòng chọn hợp đồng')
    if (lastDay < minLastDay) return toast.error(`Ngày làm việc cuối dự kiến phải từ ${formatDate(minLastDay)} trở đi (ít nhất 1 tháng)`)
    if (reason.trim().length < 5) return toast.error('Lý do cần ít nhất 5 ký tự')
    setSubmitting(true)
    try {
      const attachment_url = file ? (await resignationApi.uploadAttachment(file)).file_url : undefined
      await resignationApi.submitMine({ contract_id: Number(contractId), requested_last_working_date: lastDay, reason: reason.trim(), attachment_url })
      toast.success('Đã nộp đơn thôi việc, vui lòng chờ phòng Nhân sự duyệt')
      setShowForm(false)
      setReason('')
      setFile(null)
      load()
    } catch (err: any) {
      toast.error(err?.message || 'Nộp đơn thất bại')
    } finally {
      setSubmitting(false)
    }
  }

  const cancel = async (id: number) => {
    if (!(await confirmAction('Rút đơn thôi việc này?'))) return
    try {
      await resignationApi.cancelMine(id)
      toast.success('Đã rút đơn thôi việc')
      load()
    } catch (err: any) {
      toast.error(err?.message || 'Rút đơn thất bại')
    }
  }

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">Đơn thôi việc</h1>
          <p className="page-subtitle">Nộp đơn xin thôi việc và theo dõi kết quả phê duyệt từ phòng Nhân sự</p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => setShowForm(true)}
          disabled={loading || hasPending || contracts.length === 0}
          title={hasPending ? 'Bạn đang có đơn chờ duyệt' : contracts.length === 0 ? 'Không có hợp đồng đang hiệu lực' : undefined}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          {Icons.plus}<span>Nộp đơn thôi việc</span>
        </button>
      </div>

      <div className="card">
        {loading ? (
          <div style={{ padding: '32px', textAlign: 'center' }}>{Icons.loader}</div>
        ) : items.length === 0 ? (
          <EmptyState icon={Icons.clipboardList} title="Chưa có đơn thôi việc" description="Các đơn bạn nộp sẽ hiển thị tại đây." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Mã đơn</th>
                  <th>Hợp đồng</th>
                  <th>Ngày nộp</th>
                  <th>Ngày nghỉ dự kiến</th>
                  <th>Ngày nghỉ được duyệt</th>
                  <th>Lý do</th>
                  <th>Trạng thái</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map(r => (
                  <tr key={r.resignation_id}>
                    <td>#{r.resignation_id}</td>
                    <td>
                      <div>{r.contract_number}</div>
                      {r.contract_type && <div style={{ fontSize: '12px', opacity: 0.7 }}>{getContractTypeLabel(r.contract_type)}</div>}
                    </td>
                    <td>{formatDate(r.submitted_date)}</td>
                    <td>{formatDate(r.requested_last_working_date)}</td>
                    <td>{r.approved_last_working_date ? formatDate(r.approved_last_working_date) : '—'}</td>
                    <td style={{ maxWidth: '280px' }}>
                      <div>{r.reason}</div>
                      {r.attachment_url && (
                        <a href={r.attachment_url} target="_blank" rel="noreferrer" style={{ fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          {Icons.fileText} Xem file đính kèm
                        </a>
                      )}
                      {r.rejection_reason && <div style={{ fontSize: '12px', color: 'var(--color-danger, #dc2626)' }}>Lý do từ chối: {r.rejection_reason}</div>}
                    </td>
                    <td><span className={RESIGNATION_STATUS_BADGE[r.status]}>{RESIGNATION_STATUS_LABELS[r.status]}</span></td>
                    <td>
                      {r.status === 'PENDING' && (
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => cancel(r.resignation_id)}>Rút đơn</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => !submitting && setShowForm(false)}>
          <div className="modal" style={{ maxWidth: '520px' }} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="my-resignation-title">
            <div className="modal-header">
              <h3 className="modal-title" id="my-resignation-title">Nộp đơn thôi việc</h3>
              <button type="button" className="modal-close" onClick={() => setShowForm(false)} aria-label="Đóng">{Icons.close}</button>
            </div>
            <div className="modal-body" style={{ padding: '20px' }}>
              <div className="form-group" style={{ marginBottom: '14px' }}>
                <label className="form-label" htmlFor="my-resignation-contract">Hợp đồng đang hiệu lực</label>
                <select
                  id="my-resignation-contract"
                  className="form-input"
                  value={contractId}
                  onChange={e => setContractId(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">-- Chọn hợp đồng --</option>
                  {contracts.map(c => (
                    <option key={c.contract_id} value={c.contract_id}>
                      {c.contract_number} · {getContractTypeLabel(c.contract_type)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: '14px' }}>
                <DatePicker
                  label="Ngày làm việc cuối dự kiến"
                  value={lastDay}
                  onChange={setLastDay}
                  min={minLastDay}
                />
                <small style={{ display: 'block', marginTop: '4px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Sớm nhất {formatDate(minLastDay)} (ít nhất 1 tháng kể từ hôm nay)
                </small>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="my-resignation-reason">Lý do thôi việc</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                  {RESIGNATION_REASON_PRESETS.map(p => (
                    <button key={p} type="button" className="btn btn-secondary btn-sm" onClick={() => setReason(p)}>{p}</button>
                  ))}
                </div>
                <textarea
                  id="my-resignation-reason"
                  className="form-input"
                  rows={4}
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Trình bày lý do thôi việc..."
                />
              </div>
              <div className="form-group" style={{ marginTop: '14px', marginBottom: 0 }}>
                <label className="form-label" htmlFor="my-resignation-file">Đính kèm đơn xin thôi việc (File PDF hoặc hình ảnh chụp đơn giấy)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-sm)', padding: '10px' }}>
                  <input id="my-resignation-file" type="file" accept=".pdf,image/png,image/jpeg,image/webp" onChange={pickFile} disabled={submitting} style={{ display: 'none' }} />
                  <label htmlFor="my-resignation-file" className="btn btn-secondary btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', margin: 0 }}>
                    {Icons.upload}<span>Chọn tệp...</span>
                  </label>
                  <span style={{ flex: 1, minWidth: 0, fontSize: '12px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {file ? `${file.name} (${(file.size / 1024).toFixed(0)} KB)` : 'PDF, PNG, JPG, WebP (tối đa 10MB)'}
                  </span>
                  {file && (
                    <button type="button" className="modal-close" onClick={() => setFile(null)} aria-label="Bỏ tệp đính kèm" disabled={submitting}>{Icons.x}</button>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)} disabled={submitting}>Hủy</button>
              <button type="button" className="btn btn-primary" onClick={submit} disabled={submitting}>
                {submitting ? (file ? 'Đang tải tệp & nộp...' : 'Đang nộp...') : 'Nộp đơn'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
