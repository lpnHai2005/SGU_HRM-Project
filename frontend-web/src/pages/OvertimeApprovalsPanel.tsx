import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { OvertimeRequest, OvertimeRequestStatus } from '../types'
import { employeeApi, overtimeRequestApi } from '../services/api'
import { Icons } from '../components/common/Icons'
import { OVERTIME_REQUEST_STATUS_OPTIONS, overtimeStatusClass, overtimeStatusLabel } from '../components/schedule/overtimeDisplay'
import { OvertimeReconciliationSection } from '../components/schedule/OvertimeReconciliationSection'
import './OvertimeApprovalsPanel.css'

type Props = { user: any; requestId?: number }

const statusOptions: Array<{ value: OvertimeRequestStatus | ''; label: string }> = [
  { value: '', label: 'Tất cả trạng thái' },
  ...OVERTIME_REQUEST_STATUS_OPTIONS,
]
const PAGE_SIZE = 25

const actionLabels: Record<string, string> = {
  CREATE: 'Tạo đăng ký', EDIT: 'Chỉnh sửa bản nháp', SUBMIT: 'Gửi đăng ký',
  EMPLOYEE_CONFIRM: 'Nhân viên xác nhận', EMPLOYEE_DECLINE: 'Nhân viên từ chối',
  APPROVE: 'HR phê duyệt', REJECT: 'HR từ chối', CANCEL: 'Hủy đăng ký',
  REVOKE_REQUEST: 'Yêu cầu thu hồi', REVOKE_APPROVE: 'HR thu hồi OT',
  REVOKE_REJECT: 'HR từ chối thu hồi', AMEND_REQUEST: 'Đề xuất điều chỉnh OT',
  AMEND_APPROVE: 'HR duyệt thay thế', AMEND_REPLACE: 'Thay thế đơn OT gốc',
}

function todayInVietnam() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())
}

function monthRange(day: string) {
  const [year, month] = day.split('-').map(Number)
  const lastDay = new Date(year, month, 0).getDate()
  return { from: `${year}-${String(month).padStart(2, '0')}-01`, to: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}` }
}

function displayDate(day?: string | null) {
  if (!day) return '—'
  const [year, month, date] = day.slice(0, 10).split('-')
  return `${date}/${month}/${year}`
}

function displayDateTime(value?: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(value))
}

function timeOnly(value: string) {
  return new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(value))
}

function durationHours(request: OvertimeRequest) {
  const hours = Math.max(0, (new Date(request.ends_at).getTime() - new Date(request.starts_at).getTime()) / 3_600_000)
  return `${hours.toFixed(1)} giờ`
}

function requestStatusLabel(request: OvertimeRequest) {
  return overtimeStatusLabel(request.status)
}

function hasPendingRevocation(request: OvertimeRequest) {
  return Boolean(request.revoke_requested_at && !request.revoke_decided_at)
}

function errorText(error: unknown) {
  if (!(error instanceof Error)) return 'Không thể hoàn thành yêu cầu. Vui lòng thử lại.'
  try {
    const parsed = JSON.parse(error.message)
    if (parsed?.detail?.message) return parsed.detail.message
    if (parsed?.message) return parsed.message
  } catch { /* Keep the API's readable message. */ }
  return error.message || 'Không thể hoàn thành yêu cầu. Vui lòng thử lại.'
}

export function OvertimeApprovalsPanel({ user, requestId }: Props) {
  const navigate = useNavigate()
  const roles: string[] = user?.roles || []
  const isReviewer = roles.includes('ADMIN') || roles.includes('HR_MANAGER')
  const isStoreManager = roles.includes('STORE_MANAGER')
  const isEmployee = roles.includes('EMPLOYEE') && !isReviewer && !roles.includes('STORE_MANAGER')
  const today = todayInVietnam()
  const initialRange = monthRange(today)
  const [dateFrom, setDateFrom] = useState(initialRange.from)
  const [dateTo, setDateTo] = useState(initialRange.to)
  const [status, setStatus] = useState<OvertimeRequestStatus | ''>('')
  const [storeId, setStoreId] = useState('')
  const [search, setSearch] = useState('')
  const [effectiveSearch, setEffectiveSearch] = useState('')
  const [page, setPage] = useState(0)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [stores, setStores] = useState<Array<{ store_id: number; store_name: string }>>([])
  const [requests, setRequests] = useState<OvertimeRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selected, setSelected] = useState<OvertimeRequest | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [declineReason, setDeclineReason] = useState('')
  const [showReject, setShowReject] = useState(false)
  const [confirmApprove, setConfirmApprove] = useState(false)
  const [workflowAction, setWorkflowAction] = useState<'amend' | 'revoke' | 'cancel' | 'review-revoke' | 'reject-revoke' | ''>('')
  const [lifecycleReason, setLifecycleReason] = useState('')
  const [amendDate, setAmendDate] = useState(today)
  const [amendStart, setAmendStart] = useState('')
  const [amendEnd, setAmendEnd] = useState('')

  const loadList = useCallback(async () => {
    if (!dateFrom || !dateTo || dateTo < dateFrom) {
      setError('Khoảng ngày không hợp lệ. Ngày kết thúc phải từ ngày bắt đầu trở đi.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await overtimeRequestApi.list({
        date_from: dateFrom,
        date_to: dateTo,
        ...(status ? { status } : {}),
        ...(storeId && isReviewer ? { store_id: Number(storeId) } : {}),
        ...(effectiveSearch ? { q: effectiveSearch } : {}),
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      setRequests(result)
      setHasNextPage(result.length === PAGE_SIZE)
    } catch (err) {
      setError(errorText(err))
      setRequests([])
      setHasNextPage(false)
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, effectiveSearch, isReviewer, page, status, storeId])

  useEffect(() => { void loadList() }, [loadList])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setEffectiveSearch(search.trim())
      setPage(0)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    if (!isReviewer) return
    let active = true
    employeeApi.getLookups().then(result => {
      if (active) setStores(result.stores.map(store => ({ store_id: store.store_id, store_name: store.store_name })))
    }).catch(() => { if (active) setStores([]) })
    return () => { active = false }
  }, [isReviewer])

  const openDetail = useCallback(async (id: number) => {
    setDetailLoading(true)
    setError('')
    try {
      const detail = await overtimeRequestApi.detail(id)
      setSelected(detail)
      setAmendDate(detail.work_date)
      setAmendStart(detail.starts_at.slice(11, 16))
      setAmendEnd(detail.ends_at.slice(11, 16))
      setShowReject(false)
      setRejectReason('')
      setDeclineReason('')
      setConfirmApprove(false)
      setWorkflowAction('')
      setLifecycleReason('')
    } catch (err) {
      setError(errorText(err))
      setSelected(null)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    if (requestId && Number.isFinite(requestId) && requestId > 0) void openDetail(requestId)
  }, [openDetail, requestId])

  const visibleRequests = useMemo(() => requests, [requests])

  const resetFilters = () => {
    setDateFrom(initialRange.from)
    setDateTo(initialRange.to)
    setStatus('')
    setStoreId('')
    setSearch('')
    setEffectiveSearch('')
    setPage(0)
  }

  const closeDetail = () => {
    setSelected(null)
    if (requestId) navigate(isEmployee ? '/my-overtime' : '/overtime', { replace: true })
  }

  const runAction = async (action: () => Promise<OvertimeRequest>, success: string) => {
    if (!selected) return
    setWorking(true)
    setError('')
    setNotice('')
    try {
      const updated = await action()
      setSelected(await overtimeRequestApi.detail(updated.request_id))
      await loadList()
      setNotice(success)
      setShowReject(false)
      setConfirmApprove(false)
      setWorkflowAction('')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setWorking(false)
    }
  }

  const canApproveStandard = Boolean(selected && selected.request_type !== 'AMENDMENT' && isReviewer && selected.status === 'PENDING_HR'
    && selected.created_by !== user?.user_id && selected.employee_id !== user?.employee_id)
  const selectedParent = selected?.related_requests?.find(request => request.request_id === selected.parent_request_id)
  const canApproveAmendment = Boolean(selected && selected.request_type === 'AMENDMENT' && isReviewer && selected.status === 'PENDING_HR'
    && selected.created_by !== user?.user_id && selectedParent?.created_by !== user?.user_id
    && selected.employee_id !== user?.employee_id)
  const canProposeLifecycle = Boolean(selected?.lifecycle?.eligible && (
    roles.includes('ADMIN')
    || (isStoreManager && selected.store_id === user?.store_id && selected.employee_id !== user?.employee_id)
    || (roles.includes('EMPLOYEE') && selected.employee_id === user?.employee_id)
  ))
  const canReviewRevocation = Boolean(selected && isReviewer && selected.revoke_requested_at && !selected.revoke_decided_at
    && selected.revoke_requested_by !== user?.user_id && selected.created_by !== user?.user_id
    && selected.employee_id !== user?.employee_id)
  const canApprove = canApproveStandard
  const canRespond = Boolean(selected && isEmployee && selected.employee_id === user?.employee_id
    && selected.status === 'PENDING_EMPLOYEE_CONFIRMATION')
  const canCancel = Boolean(selected && ['DRAFT', 'PENDING_EMPLOYEE_CONFIRMATION', 'PENDING_HR'].includes(selected.status) && (
    isReviewer
      ? selected.created_by === user?.user_id || selected.employee_id === user?.employee_id
      : isStoreManager
        ? selected.created_by === user?.user_id && selected.store_id === user?.store_id && selected.employee_id !== user?.employee_id
        : roles.includes('EMPLOYEE') && selected.employee_id === user?.employee_id
  ) && !(selected.status === 'DRAFT' && selected.employee_id === user?.employee_id && selected.created_by !== user?.user_id))

  return (
    <section className="overtime-approvals-panel" aria-label="Danh sách đăng ký OT">
      <div className="overtime-panel-heading">
        <div>
          <h2>Đăng ký tăng ca</h2>
          <p>Đơn OT được xét duyệt riêng; phê duyệt không tự tính giờ công thực tế hoặc tiền lương.</p>
        </div>
        <span className="overtime-total-count">{visibleRequests.length} đơn · trang {page + 1}</span>
      </div>

      {notice && <div className="overtime-inline-notice is-success" role="status">{Icons.checkCircle}<span>{notice}</span></div>}
      {error && <div className="overtime-inline-notice is-error" role="alert">{Icons.alertCircle}<span>{error}</span><button type="button" onClick={() => void loadList()}>Thử lại</button></div>}

      <div className="overtime-filters">
        <label className="form-group"><span className="form-label">Từ ngày</span><input className="form-input" type="date" value={dateFrom} onChange={event => { setDateFrom(event.target.value); setPage(0) }} /></label>
        <label className="form-group"><span className="form-label">Đến ngày</span><input className="form-input" type="date" value={dateTo} onChange={event => { setDateTo(event.target.value); setPage(0) }} /></label>
        <label className="form-group"><span className="form-label">Trạng thái</span><select className="form-select" value={status} onChange={event => { setStatus(event.target.value as OvertimeRequestStatus | ''); setPage(0) }}>{statusOptions.map(option => <option key={option.value || 'all'} value={option.value}>{option.label}</option>)}</select></label>
        {isReviewer && <label className="form-group"><span className="form-label">Cửa hàng</span><select className="form-select" value={storeId} onChange={event => { setStoreId(event.target.value); setPage(0) }}><option value="">Tất cả cửa hàng</option>{stores.map(store => <option key={store.store_id} value={store.store_id}>{store.store_name}</option>)}</select></label>}
        <label className="form-group overtime-search"><span className="form-label">Tìm kiếm</span><span className="overtime-search-input">{Icons.search}<input className="form-input" value={search} onChange={event => setSearch(event.target.value)} placeholder="Mã đơn, tên/mã nhân viên, cửa hàng..." /></span></label>
        <button type="button" className="btn btn-secondary overtime-filter-reset" onClick={resetFilters}>Đặt lại</button>
        <button type="button" className="btn btn-secondary overtime-refresh" onClick={() => void loadList()} disabled={loading}>{Icons.refresh} Tải lại</button>
      </div>

      {loading ? <div className="overtime-list-skeleton" role="status" aria-label="Đang tải danh sách OT">{Array.from({ length: 5 }, (_, index) => <div key={index} className="overtime-skeleton-row"><i/><i/><i/><i/></div>)}</div> : visibleRequests.length === 0 ? (
        <div className="overtime-panel-state">Không có đăng ký OT phù hợp với bộ lọc.</div>
      ) : (
        <div className="table-container overtime-table-wrap">
          <table className="data-table overtime-requests-table">
            <thead><tr><th>Mã đơn</th><th>Nhân viên</th><th>Cửa hàng</th><th>Ngày OT</th><th>Khung giờ</th><th>Tổng giờ dự kiến</th><th>Người đăng ký</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
            <tbody>{visibleRequests.map(request => <tr key={request.request_id} onClick={() => void openDetail(request.request_id)}>
              <td><button type="button" className="overtime-request-link" onClick={event => { event.stopPropagation(); void openDetail(request.request_id) }}>OT #{request.request_id}</button></td>
              <td><strong>{request.employee_name}</strong><small>{request.employee_code || `NV #${request.employee_id}`}</small></td>
              <td>{request.store_name}</td><td>{displayDate(request.work_date)}</td>
              <td>{timeOnly(request.starts_at)}–{timeOnly(request.ends_at)}</td><td>{durationHours(request)}</td>
              <td>{request.creator_username || `User #${request.created_by}`}</td>
              <td><div className="overtime-status-stack"><span className={`calendar-overtime-chip ${overtimeStatusClass(request.status)}`}>{requestStatusLabel(request)}</span>
                {hasPendingRevocation(request) && <span className="overtime-secondary-badge is-pending">Chờ HR quyết định thu hồi</span>}
                {request.is_overdue && <span className="overtime-overdue-badge">Quá thời điểm dự kiến</span>}
              </div></td>
              <td><button type="button" className="btn btn-secondary btn-sm" onClick={event => { event.stopPropagation(); void openDetail(request.request_id) }}>{request.status === 'PENDING_HR' && isReviewer ? 'Xét duyệt' : 'Chi tiết'}</button></td>
            </tr>)}</tbody>
          </table>
        </div>
      )}

      {!loading && (visibleRequests.length > 0 || page > 0) && <nav className="overtime-pagination" aria-label="Phân trang đăng ký OT">
        <span>Trang {page + 1} · {visibleRequests.length} đơn trên trang này</span>
        <div><button type="button" className="btn btn-secondary btn-sm" onClick={() => setPage(value => Math.max(0, value - 1))} disabled={loading || page === 0}>Trang trước</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPage(value => value + 1)} disabled={loading || !hasNextPage}>Trang sau</button></div>
      </nav>}

      {detailLoading && <div className="overtime-detail-loading" role="status">Đang tải chi tiết đơn OT…</div>}
      {selected && <div className="overtime-drawer-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !working) closeDetail() }}>
        <aside className="overtime-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="overtime-detail-title">
          <header className="overtime-drawer-header"><div><span className="overtime-drawer-eyebrow">HỒ SƠ ĐĂNG KÝ TĂNG CA</span><h2 id="overtime-detail-title">OT #{selected.request_id}</h2></div><button type="button" className="btn btn-secondary btn-icon" aria-label="Đóng chi tiết" onClick={closeDetail} disabled={working}>{Icons.close}</button></header>
          <div className="overtime-drawer-content">
            <div className="overtime-detail-status"><div className="overtime-status-stack"><span className={`calendar-overtime-chip ${overtimeStatusClass(selected.status)}`}>{requestStatusLabel(selected)}</span>
              {hasPendingRevocation(selected) && <span className="overtime-secondary-badge is-pending">Chờ HR quyết định thu hồi</span>}
              {selected.is_overdue && <span className="overtime-overdue-badge">Quá thời điểm dự kiến</span>}
            </div><span>Cập nhật {displayDateTime(selected.updated_at)}</span></div>
            {selected.is_overdue && <div className="overtime-conflict-warning" role="status"><strong>Đơn quá hạn xử lý</strong><p>Khung OT đã tới thời điểm bắt đầu. Hệ thống không tự duyệt hồi tố; vui lòng xử lý theo quy trình rà soát ngoại lệ.</p></div>}
            {selected.lifecycle?.attendance_linked && <div className="overtime-conflict-warning" role="status"><strong>Đã có Attendance liên quan</strong><p>Không thể tự động thay đổi hoặc thu hồi đơn này. Mã phiên chấm công: #{selected.lifecycle.blocking_attendance_id}.</p></div>}
            {selected.revoke_requested_at && <div className="overtime-no-conflict"><strong>Yêu cầu thu hồi:</strong> {selected.revoke_reason} · {selected.revoke_decision === 'REJECTED' ? `Đã từ chối, đơn gốc vẫn hiệu lực${selected.revoke_decision_reason ? `: ${selected.revoke_decision_reason}` : ''}` : selected.status === 'REVOKED' ? 'Đã duyệt thu hồi' : 'Đang chờ HR quyết định'}</div>}
            <div className="overtime-detail-grid">
              <div><small>Nhân viên</small><strong>{selected.employee_name} · {selected.employee_code || `#${selected.employee_id}`}</strong></div>
              <div><small>Cửa hàng</small><strong>{selected.store_name}</strong></div>
              <div><small>Ngày OT</small><strong>{displayDate(selected.work_date)}</strong></div>
              <div><small>Khung giờ</small><strong>{timeOnly(selected.starts_at)}–{timeOnly(selected.ends_at)} · {durationHours(selected)}</strong></div>
              <div><small>Người đăng ký</small><strong>{selected.creator_username || `User #${selected.created_by}`}</strong></div>
              <div><small>Nhân viên xác nhận</small><strong>{selected.employee_confirmed_at ? displayDateTime(selected.employee_confirmed_at) : 'Chưa xác nhận / không áp dụng'}</strong></div>
              <div><small>Người xử lý HR</small><strong>{selected.reviewer_username ? `${selected.reviewer_username} · ${displayDateTime(selected.reviewed_at)}` : 'Chưa xử lý'}</strong></div>
              <div className="overtime-detail-wide"><small>Lý do</small><p>{selected.reason}</p></div>
              {selected.notes && <div className="overtime-detail-wide"><small>Ghi chú</small><p>{selected.notes}</p></div>}
              {selected.status === 'REJECTED' && selected.rejection_reason && <div className="overtime-detail-wide is-rejected"><small>Lý do từ chối</small><p>{selected.rejection_reason}</p></div>}
            </div>

            <section className="overtime-context-section"><h3>Lịch làm việc liên quan</h3>
              {selected.approval_context?.related_schedules.length ? <ul>{selected.approval_context.related_schedules.map(schedule => <li key={schedule.schedule_id} className={schedule.overlaps_overtime ? 'has-conflict' : ''}><span>{schedule.shift_name}</span><strong>{displayDate(schedule.work_date)} · {timeOnly(schedule.starts_at)}–{timeOnly(schedule.ends_at)}</strong>{schedule.overlaps_overtime && <em>Trùng khung giờ OT</em>}</li>)}</ul> : <p>Không có ca được phân trong ngày liên quan.</p>}
              {selected.approval_context?.conflicts.length ? <div className="overtime-conflict-warning"><strong>Phát hiện xung đột</strong>{selected.approval_context.conflicts.map((conflict, index) => <p key={`${conflict.code}-${index}`}>{conflict.message}</p>)}</div> : <div className="overtime-no-conflict">Chưa phát hiện xung đột tại thời điểm tải chi tiết. API sẽ kiểm tra lại ngay trước khi duyệt.</div>}
            </section>

            <section className="overtime-context-section"><h3>Lịch sử xử lý</h3>
              {selected.events?.length ? <ol className="overtime-event-timeline">{selected.events.map(event => <li key={event.event_id}><span className="overtime-event-dot"/><div><strong>{actionLabels[event.action] || event.action}</strong><small>{event.actor_username || `User #${event.actor_id}`} · {displayDateTime(event.created_at)}</small>{event.from_status && <span>{overtimeStatusLabel(event.from_status)} → {overtimeStatusLabel(event.to_status)}</span>}{event.reason && <p>{event.reason}</p>}</div></li>)}</ol> : <p>Chưa có lịch sử xử lý.</p>}
            </section>
            <OvertimeReconciliationSection key={`${selected.request_id}-${selected.updated_at}`} request={selected} user={user} />
          </div>

          {canApprove && <footer className="overtime-drawer-actions">
            {confirmApprove ? <div className="overtime-action-confirm"><p>Xác nhận duyệt đơn OT này? Đơn sẽ được hiển thị trên lịch dưới dạng đăng ký đã duyệt.</p><button type="button" className="btn btn-secondary" onClick={() => setConfirmApprove(false)} disabled={working}>Quay lại</button><button type="button" className="btn btn-primary" onClick={() => void runAction(() => overtimeRequestApi.approve(selected.request_id), 'Đã duyệt đơn OT.')} disabled={working}>{working ? 'Đang xử lý…' : 'Xác nhận duyệt'}</button></div> : showReject ? <div className="overtime-action-confirm"><label className="form-group"><span className="form-label">Lý do từ chối (bắt buộc)</span><textarea className="form-input" rows={3} value={rejectReason} onChange={event => setRejectReason(event.target.value)} maxLength={1000} /></label><button type="button" className="btn btn-secondary" onClick={() => setShowReject(false)} disabled={working}>Quay lại</button><button type="button" className="btn btn-danger" onClick={() => void runAction(() => overtimeRequestApi.reject(selected.request_id, rejectReason.trim()), 'Đã từ chối đơn OT.')} disabled={working || rejectReason.trim().length < 3}>{working ? 'Đang xử lý…' : 'Xác nhận từ chối'}</button></div> : <><button type="button" className="btn btn-secondary" onClick={() => setShowReject(true)}>Từ chối</button><button type="button" className="btn btn-primary" onClick={() => setConfirmApprove(true)}>Duyệt OT</button></>}
          </footer>}

          {canRespond && <footer className="overtime-drawer-actions overtime-employee-actions"><label className="form-group"><span className="form-label">Lý do từ chối (không bắt buộc)</span><textarea className="form-input" rows={2} value={declineReason} onChange={event => setDeclineReason(event.target.value)} maxLength={1000} /></label><button type="button" className="btn btn-secondary" onClick={() => void runAction(() => overtimeRequestApi.employeeDecline(selected.request_id, declineReason), 'Đã từ chối đề xuất OT.')} disabled={working}>Từ chối đề xuất</button><button type="button" className="btn btn-primary" onClick={() => void runAction(() => overtimeRequestApi.employeeConfirm(selected.request_id), 'Đã xác nhận đề xuất OT.')} disabled={working}>{working ? 'Đang xử lý…' : 'Xác nhận OT'}</button></footer>}
          {canCancel && workflowAction === '' && <footer className="overtime-drawer-actions"><button type="button" className="btn btn-danger" onClick={() => setWorkflowAction('cancel')}>Hủy đơn đang chờ</button></footer>}
          {canCancel && workflowAction === 'cancel' && <footer className="overtime-drawer-actions"><div className="overtime-action-confirm"><p>Hủy đơn OT đang chờ? Lịch sử sẽ được lưu và đơn này không còn được xử lý tiếp.</p><button type="button" className="btn btn-secondary" onClick={() => setWorkflowAction('')} disabled={working}>Giữ đơn</button><button type="button" className="btn btn-danger" onClick={() => void runAction(() => overtimeRequestApi.cancel(selected.request_id), 'Đã hủy đơn OT đang chờ.')} disabled={working}>{working ? 'Đang hủy…' : 'Xác nhận hủy'}</button></div></footer>}
          {selected.related_requests?.length ? <section className="overtime-context-section overtime-related-requests"><h3>Lịch sử điều chỉnh và đơn liên kết</h3><div>{selected.related_requests.map(request => <button type="button" key={request.request_id} className="overtime-related-request" onClick={() => void openDetail(request.request_id)}><span>OT #{request.request_id} · {request.request_type === 'AMENDMENT' ? 'Bản đề xuất thay thế' : 'Đơn gốc'}</span><strong>{displayDate(request.work_date)} · {timeOnly(request.starts_at)}–{timeOnly(request.ends_at)}</strong><small>{overtimeStatusLabel(request.status)}</small></button>)}</div></section> : null}

          {canProposeLifecycle && !workflowAction && <footer className="overtime-drawer-actions overtime-lifecycle-actions"><button type="button" className="btn btn-secondary" onClick={() => { setWorkflowAction('amend'); setLifecycleReason('') }}>Yêu cầu điều chỉnh</button><button type="button" className="btn btn-danger" onClick={() => { setWorkflowAction('revoke'); setLifecycleReason('') }}>Yêu cầu thu hồi</button></footer>}
          {canProposeLifecycle && workflowAction === 'amend' && <footer className="overtime-drawer-actions overtime-lifecycle-form"><strong>Đề xuất thay thế OT #{selected.request_id}</strong><div className="overtime-lifecycle-fields"><label className="form-group"><span className="form-label">Ngày OT mới</span><input className="form-input" type="date" value={amendDate} onChange={event => setAmendDate(event.target.value)} /></label><label className="form-group"><span className="form-label">Bắt đầu</span><input className="form-input" type="time" value={amendStart} onChange={event => setAmendStart(event.target.value)} /></label><label className="form-group"><span className="form-label">Kết thúc</span><input className="form-input" type="time" value={amendEnd} onChange={event => setAmendEnd(event.target.value)} /></label></div><label className="form-group"><span className="form-label">Lý do điều chỉnh (bắt buộc)</span><textarea className="form-input" rows={3} value={lifecycleReason} onChange={event => setLifecycleReason(event.target.value)} maxLength={1000} /></label><div><button type="button" className="btn btn-secondary" onClick={() => setWorkflowAction('')} disabled={working}>Hủy</button><button type="button" className="btn btn-primary" onClick={() => void runAction(() => overtimeRequestApi.proposeAmendment(selected.request_id, { work_date: amendDate, start_time: amendStart, end_time: amendEnd, reason: lifecycleReason.trim() }), 'Đã gửi đề xuất điều chỉnh OT.')} disabled={working || lifecycleReason.trim().length < 3 || !amendDate || !amendStart || !amendEnd}>{working ? 'Đang gửi…' : 'Gửi đề xuất'}</button></div></footer>}
          {canProposeLifecycle && workflowAction === 'revoke' && <footer className="overtime-drawer-actions overtime-lifecycle-form"><strong>Yêu cầu thu hồi OT #{selected.request_id}</strong><p>Đơn vẫn có hiệu lực cho tới khi HR/Admin quyết định. Lịch sử sẽ được giữ lại.</p><label className="form-group"><span className="form-label">Lý do thu hồi (bắt buộc)</span><textarea className="form-input" rows={3} value={lifecycleReason} onChange={event => setLifecycleReason(event.target.value)} maxLength={1000} /></label><div><button type="button" className="btn btn-secondary" onClick={() => setWorkflowAction('')} disabled={working}>Hủy</button><button type="button" className="btn btn-danger" onClick={() => void runAction(() => overtimeRequestApi.requestRevocation(selected.request_id, lifecycleReason.trim()), 'Đã gửi yêu cầu thu hồi OT.')} disabled={working || lifecycleReason.trim().length < 3}>{working ? 'Đang gửi…' : 'Gửi yêu cầu thu hồi'}</button></div></footer>}

          {canApproveAmendment && <footer className="overtime-drawer-actions">{confirmApprove ? <div className="overtime-action-confirm"><p>Duyệt bản thay thế sẽ chuyển đơn gốc sang “Đã thay thế” và kích hoạt duy nhất bản OT mới trong cùng giao dịch.</p><button type="button" className="btn btn-secondary" onClick={() => setConfirmApprove(false)} disabled={working}>Quay lại</button><button type="button" className="btn btn-primary" onClick={() => void runAction(() => overtimeRequestApi.approveAmendment(selected.request_id), 'Đã duyệt bản thay thế; đơn gốc đã được giữ trong lịch sử.')} disabled={working}>{working ? 'Đang xử lý…' : 'Duyệt bản thay thế'}</button></div> : showReject ? <div className="overtime-action-confirm"><label className="form-group"><span className="form-label">Lý do từ chối (bắt buộc)</span><textarea className="form-input" rows={3} value={rejectReason} onChange={event => setRejectReason(event.target.value)} maxLength={1000} /></label><button type="button" className="btn btn-secondary" onClick={() => setShowReject(false)} disabled={working}>Quay lại</button><button type="button" className="btn btn-danger" onClick={() => void runAction(() => overtimeRequestApi.reject(selected.request_id, rejectReason.trim()), 'Đã từ chối bản thay thế; đơn OT gốc vẫn có hiệu lực.')} disabled={working || rejectReason.trim().length < 3}>Từ chối đề xuất</button></div> : <><button type="button" className="btn btn-secondary" onClick={() => setShowReject(true)}>Từ chối thay thế</button><button type="button" className="btn btn-primary" onClick={() => setConfirmApprove(true)}>Duyệt thay thế</button></>}</footer>}

          {canReviewRevocation && <footer className="overtime-drawer-actions">{workflowAction === 'review-revoke' ? <div className="overtime-action-confirm"><p>Xác nhận thu hồi OT #{selected.request_id}? Lịch OT sẽ không còn hiệu lực và bản ghi lịch sử được giữ nguyên.</p><button type="button" className="btn btn-secondary" onClick={() => setWorkflowAction('')} disabled={working}>Quay lại</button><button type="button" className="btn btn-danger" onClick={() => void runAction(() => overtimeRequestApi.approveRevocation(selected.request_id), 'Đã thu hồi đơn OT.')} disabled={working}>Xác nhận thu hồi</button></div> : workflowAction === 'reject-revoke' ? <div className="overtime-action-confirm"><label className="form-group"><span className="form-label">Lý do từ chối thu hồi (bắt buộc)</span><textarea className="form-input" rows={3} value={lifecycleReason} onChange={event => setLifecycleReason(event.target.value)} maxLength={1000} /></label><button type="button" className="btn btn-secondary" onClick={() => setWorkflowAction('')} disabled={working}>Quay lại</button><button type="button" className="btn btn-danger" onClick={() => void runAction(() => overtimeRequestApi.rejectRevocation(selected.request_id, lifecycleReason.trim()), 'Đã từ chối thu hồi; đơn gốc vẫn có hiệu lực.')} disabled={working || lifecycleReason.trim().length < 3}>Từ chối thu hồi</button></div> : <><button type="button" className="btn btn-secondary" onClick={() => { setWorkflowAction('reject-revoke'); setLifecycleReason('') }}>Từ chối thu hồi</button><button type="button" className="btn btn-primary" onClick={() => setWorkflowAction('review-revoke')}>Duyệt thu hồi</button></>}</footer>}
        </aside>
      </div>}
    </section>
  )
}
