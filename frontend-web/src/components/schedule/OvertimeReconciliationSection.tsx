import { useCallback, useEffect, useState } from 'react'
import type { OvertimeReconciliation, OvertimeReconciliationStatus, OvertimeRequest } from '../../types'
import { ApiHttpError, overtimeReconciliationApi } from '../../services/api'

type Props = { request: OvertimeRequest; user: { user_id?: number; employee_id?: number; store_id?: number; roles?: string[] } }

const labels: Record<OvertimeReconciliationStatus, string> = {
  PENDING_RECONCILIATION: 'Chờ đối soát',
  NEEDS_REVIEW: 'Cần rà soát',
  VERIFIED: 'Đã xác nhận giờ OT',
  REJECTED: 'Đã từ chối đối soát',
}

const issueLabels: Record<string, string> = {
  NO_ATTENDANCE: 'Chưa có phiên chấm công trong khung OT.',
  INVALID_OR_OPEN_ATTENDANCE_SNAPSHOT: 'Phiên chưa checkout hoặc snapshot thời gian không hợp lệ.',
  SCHEDULE_SNAPSHOT_MISSING_OR_MISMATCH: 'Thiếu snapshot ca hoặc lịch chấm công không khớp.',
  STORE_OR_SHIFT_MISMATCH: 'Cửa hàng hoặc ca trong snapshot không khớp đơn OT.',
  OVERLAPPING_ATTENDANCE: 'Các phiên chấm công chồng thời gian; cần kiểm tra thủ công.',
}

const eventLabels: Record<string, string> = {
  PREVIEW: 'Tạo bản đối soát', REFRESH: 'Làm mới nguồn dữ liệu',
  VERIFY: 'Xác nhận giờ OT', REJECT: 'Từ chối đối soát',
}

function hours(microseconds: number | null | undefined) {
  if (microseconds == null) return '—'
  const wholeSeconds = Math.floor(microseconds / 1_000_000)
  const fraction = microseconds % 1_000_000
  const h = Math.floor(wholeSeconds / 3600)
  const m = Math.floor((wholeSeconds % 3600) / 60)
  const s = wholeSeconds % 60
  return `${h} giờ ${String(m).padStart(2, '0')} phút ${String(s).padStart(2, '0')}${fraction ? `.${String(fraction).padStart(6, '0')}` : ''} giây`
}

function dateTime(value: string | null | undefined) {
  return value ? new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(value)) : 'Chưa có'
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Không tải được dữ liệu đối soát OT.'
}

export function OvertimeReconciliationSection({ request, user }: Props) {
  const [result, setResult] = useState<OvertimeReconciliation | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setResult(await overtimeReconciliationApi.detail(request.request_id))
      setError('')
    } catch (err) {
      setResult(null)
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [request.request_id])

  useEffect(() => { void reload() }, [reload])

  const act = async (action: () => Promise<OvertimeReconciliation>, success: string) => {
    setWorking(true)
    setError('')
    setNotice('')
    try {
      setResult(await action())
      setNotice(success)
      setRejecting(false)
      setReason('')
    } catch (err) {
      if (err instanceof ApiHttpError && err.status === 409) {
        await reload()
        setError(`${errorMessage(err)} Dữ liệu mới nhất đã được tải lại; hãy kiểm tra trước khi xử lý tiếp.`)
      } else {
        setError(errorMessage(err))
      }
    } finally {
      setWorking(false)
    }
  }

  const requestApproved = request.status === 'APPROVED'
  const approved = requestApproved &&
    !(request.revoke_requested_at && !request.revoke_decided_at)
  const roles = user.roles || []
  const reviewer = roles.includes('HR_MANAGER') || roles.includes('ADMIN')
  const canPreview = approved && (reviewer || (roles.includes('STORE_MANAGER') &&
    request.store_id === user.store_id &&
    request.employee_id !== user.employee_id))
  const canDecide = approved && reviewer && request.employee_id !== user.employee_id &&
    request.created_by !== user.user_id
  const actionable = result && result.version > 0 && result.source_current &&
    ['PENDING_RECONCILIATION', 'NEEDS_REVIEW'].includes(result.status)
  const stale = result && result.version > 0 && !result.source_current
  const registeredMicroseconds = Math.max(0,
    (new Date(request.ends_at).getTime() - new Date(request.starts_at).getTime()) * 1000)

  return <section className="overtime-context-section overtime-reconciliation" aria-label="Đối soát giờ OT thực tế">
    <div className="overtime-reconciliation-heading">
      <div><h3>Đối soát giờ OT thực tế</h3><p>Duyệt đơn và xác nhận giờ thực tế là hai quyết định riêng. Giờ xác nhận chưa đồng nghĩa đã trả lương.</p></div>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void reload()} disabled={loading || working}>Tải lại</button>
    </div>
    {loading ? <p role="status">Đang tải đối soát và minh chứng chấm công…</p> : error && !result ?
      <div className="overtime-conflict-warning" role="alert">{error} <button type="button" className="btn btn-secondary btn-sm" onClick={() => void reload()}>Thử lại</button></div> : result && <>
        <div className="overtime-reconciliation-status">
          <span>Đơn OT: <strong>{request.status === 'APPROVED' ? 'Đã duyệt đăng ký' : request.status}</strong></span>
          <span className={`overtime-reconciliation-chip is-${result.effective_status.toLowerCase()}`}>
            Đối soát: {labels[result.effective_status]}
          </span>
          {result.version > 0 && <small>Phiên bản #{result.version}</small>}
        </div>
        {stale && <div className="overtime-conflict-warning" role="alert"><strong>Nguồn dữ liệu đã thay đổi</strong><p>Kết quả xác nhận cũ không còn hiệu lực. Làm mới đối soát và để HR xem lại trước khi sử dụng giờ OT.</p></div>}
        {result.review_issues.length > 0 && <div className="overtime-conflict-warning" role="status"><strong>Cần kiểm tra nguồn chấm công</strong><ul>{result.review_issues.map(issue => <li key={issue}>{issueLabels[issue] || issue}</li>)}</ul></div>}
        {notice && <div className="overtime-no-conflict" role="status">{notice}</div>}
        {error && <div className="overtime-conflict-warning" role="alert">{error}</div>}
        <div className="overtime-reconciliation-metrics">
          <div><small>Giờ OT đăng ký</small><strong>{hours(registeredMicroseconds)}</strong></div>
          <div><small>Giờ OT được HR duyệt</small><strong>{requestApproved ? hours(registeredMicroseconds) : 'Chưa duyệt'}</strong></div>
          <div><small>Attendance thực tế giao khung OT</small><strong>{hours(result.actual_microseconds)}</strong></div>
          <div><small>Giờ đề xuất sau đối soát</small><strong>{result.version ? hours(result.proposed_microseconds) : 'Chưa đối soát'}</strong></div>
          <div><small>Giờ OT đã được HR xác nhận</small><strong>{result.effective_status === 'VERIFIED' ? hours(result.verified_microseconds) : 'Chưa có hiệu lực'}</strong></div>
        </div>
        <div className="overtime-reconciliation-evidence">
          <h4>Nguồn Attendance</h4>
          {result.attendance_sources.length ? <ul>{result.attendance_sources.map(source => <li key={source.attendance_id}>
            <strong>Phiên #{source.attendance_id} · Cửa hàng #{source.store_id ?? '—'}</strong>
            <span>Vào {dateTime(source.check_in_time)} → Ra {dateTime(source.check_out_time)}</span>
            <small>Phần giao khung OT: {source.overlap_starts_at ? `${dateTime(source.overlap_starts_at)} → ${dateTime(source.overlap_ends_at)}` : 'Chưa hoàn tất'}</small>
            <small>Snapshot ca: {source.planned_starts_at ? `${dateTime(source.planned_starts_at)} → ${dateTime(source.planned_ends_at)}` : 'Thiếu snapshot'} · {source.schedule_status || 'Chưa xác định'}</small>
          </li>)}</ul> : <p>Chưa có phiên Attendance giao với khung OT.</p>}
          <h4>Khoảng giờ ngoài ca đủ điều kiện đề xuất</h4>
          {result.eligible_intervals.length ? <ul>{result.eligible_intervals.map((interval, index) => <li key={`${interval.starts_at}-${index}`}><span>{dateTime(interval.starts_at)} → {dateTime(interval.ends_at)}</span></li>)}</ul> : <p>Chưa có khoảng giờ đủ điều kiện đề xuất.</p>}
        </div>
        <div className="overtime-reconciliation-history"><h4>Lịch sử đối soát</h4>
          {result.events.length ? <ol className="overtime-event-timeline">{result.events.map(event => <li key={event.event_id}><span className="overtime-event-dot"/><div><strong>{eventLabels[event.action] || event.action} · phiên bản #{event.version}</strong><small>User #{event.actor_id} · {dateTime(event.created_at)}</small><span>{event.from_status ? `${labels[event.from_status]} → ` : ''}{labels[event.to_status]}</span>{event.reason && <p>Lý do: {event.reason}</p>}</div></li>)}</ol> : <p>Chưa có lịch sử đối soát.</p>}
        </div>
        {canPreview && <div className="overtime-reconciliation-actions"><button type="button" className="btn btn-secondary btn-sm" disabled={working || loading} onClick={() => void act(() => overtimeReconciliationApi.preview(request.request_id), result.version ? 'Đã kiểm tra lại nguồn đối soát.' : 'Đã tạo bản đối soát.')}>{working ? 'Đang xử lý…' : result.version ? 'Làm mới đối soát' : 'Xem trước đối soát'}</button></div>}
        {canDecide && actionable && <div className="overtime-reconciliation-actions">
          {rejecting ? <div className="overtime-reconciliation-reject"><label className="form-group"><span className="form-label">Lý do từ chối đối soát</span><textarea className="form-input" rows={2} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label><button type="button" className="btn btn-secondary btn-sm" disabled={working} onClick={() => setRejecting(false)}>Hủy</button><button type="button" className="btn btn-danger btn-sm" disabled={working || reason.trim().length < 3} onClick={() => void act(() => overtimeReconciliationApi.reject(request.request_id, result.version, reason.trim()), 'Đã từ chối kết quả đối soát.')}>Xác nhận từ chối</button></div> : <><button type="button" className="btn btn-secondary btn-sm" disabled={working} onClick={() => setRejecting(true)}>Từ chối đối soát</button><button type="button" className="btn btn-primary btn-sm" disabled={working || result.review_issues.length > 0 || result.proposed_microseconds <= 0} onClick={() => void act(() => overtimeReconciliationApi.verify(request.request_id, result.version), 'Đã xác nhận giờ OT thực tế; chưa đưa vào lương.')}>Xác nhận giờ OT</button></>}
        </div>}
      </>}
  </section>
}
