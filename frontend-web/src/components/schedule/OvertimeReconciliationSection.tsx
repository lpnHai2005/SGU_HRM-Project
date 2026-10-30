import { useCallback, useEffect, useMemo, useState } from 'react'
import type { OvertimeReconciliation, OvertimeReconciliationStatus, OvertimeRequest } from '../../types'
import { ApiHttpError, overtimeReconciliationApi } from '../../services/api'
import { Icons } from '../common/Icons'
import { toast } from 'sonner'

type Props = { request: OvertimeRequest; user: { user_id?: number; employee_id?: number; store_id?: number; roles?: string[] }; highlightCaseId?: number }
type ExceptionAction =
  | { kind: 'request_explanation' }
  | { kind: 'respond'; caseId: number }
  | { kind: 'request_review' }
  | { kind: 'close'; caseId: number }
  | { kind: 'review_decision'; caseId: number; decision: 'ACCEPT' | 'REJECT' }

const labels: Record<OvertimeReconciliationStatus, string> = {
  PENDING_RECONCILIATION: 'Chờ đối soát',
  NEEDS_REVIEW: 'Cần rà soát',
  VERIFIED: 'Đã xác nhận giờ OT',
  REJECTED: 'Đã từ chối đối soát',
}

const executionLabels: Record<string, string> = {
  NOT_STARTED: 'Chưa đến giờ OT',
  IN_PROGRESS: 'Đang trong thời gian OT',
  ENDED: 'Đã kết thúc, có Attendance đã checkout',
  ATTENDANCE_INCOMPLETE: 'Attendance chưa hoàn tất',
}

const executionMessages: Record<string, string> = {
  NOT_STARTED: 'Chưa đến giờ thực hiện OT. Chưa có Attendance ở thời điểm này là bình thường.',
  IN_PROGRESS: 'Nhân viên đang trong thời gian OT. Dữ liệu chấm công chưa hoàn tất; hệ thống sẽ chờ kết thúc khung OT.',
  ATTENDANCE_INCOMPLETE: 'Khung OT đã kết thúc nhưng dữ liệu Attendance chưa đầy đủ. Cần kiểm tra, chưa kết luận nhân viên vắng mặt.',
}

const MULTIPLIER_OPTIONS = [
  { value: '1.5', label: 'Ngày làm việc bình thường', rate: '1,5×', desc: 'Tối thiểu 1,5× theo quy định pháp luật' },
  { value: '2.0', label: 'Ngày nghỉ hằng tuần (Chủ nhật)', rate: '2,0×', desc: 'Tối thiểu 2,0× theo quy định pháp luật' },
  { value: '3.0', label: 'Ngày lễ, Tết, ngày nghỉ hưởng lương', rate: '3,0×', desc: 'Tối thiểu 3,0× theo quy định pháp luật' },
] as const

const issueDetails: Record<string, { title: string; severity: string; reason: string; action: string; owner: string }> = {
  NO_ATTENDANCE: {
    title: 'Chưa có phiên Attendance trong khung OT',
    severity: 'Cần đối chiếu',
    reason: 'Khung OT đã kết thúc nhưng chưa tìm thấy phiên chấm công phù hợp.',
    action: 'HR yêu cầu nhân viên giải trình và chuyển sai lệch cho Attendance owner xử lý theo quy trình được duyệt.',
    owner: 'HR/Admin xem xét; Attendance owner xử lý dữ liệu chấm công.',
  },
  ATTENDANCE_CHECKOUT_MISSING: {
    title: 'Phiên chấm công chưa checkout',
    severity: 'Chưa đủ dữ liệu',
    reason: 'Có check-in liên quan nhưng phiên chưa có thời điểm kết thúc.',
    action: 'Kiểm tra với nhân viên; chỉ người có thẩm quyền Attendance mới được điều chỉnh dữ liệu.',
    owner: 'HR/Admin xem xét; Attendance owner xử lý dữ liệu chấm công.',
  },
  INVALID_OR_OPEN_ATTENDANCE_SNAPSHOT: {
    title: 'Snapshot thời gian Attendance không hợp lệ',
    severity: 'Không thể xác minh',
    reason: 'Timestamp thiếu múi giờ, khoảng giờ không hợp lệ hoặc dữ liệu cũ chưa phân loại được.',
    action: 'Đối chiếu bản ghi Attendance và yêu cầu Attendance owner xác minh.',
    owner: 'HR/Admin xem xét; Attendance owner xác minh nguồn.',
  },
  SCHEDULE_SNAPSHOT_MISSING_OR_MISMATCH: {
    title: 'Thiếu snapshot ca hoặc lịch không khớp',
    severity: 'Chặn xác nhận',
    reason: 'Attendance không có snapshot lịch phân công khớp để tách giờ ngoài ca.',
    action: 'Không xác nhận giờ OT; chuyển Attendance owner kiểm tra snapshot.',
    owner: 'HR/Admin xem xét; Attendance owner kiểm tra snapshot.',
  },
  STORE_OR_SHIFT_MISMATCH: {
    title: 'Cửa hàng hoặc ca không khớp đơn OT',
    severity: 'Cần xác minh',
    reason: 'Thông tin ca/cửa hàng trong snapshot khác phạm vi của đơn OT.',
    action: 'Đối chiếu đơn OT và lịch phân công; không tự sửa snapshot.',
    owner: 'HR/Admin xem xét cùng Attendance owner.',
  },
  OVERLAPPING_ATTENDANCE: {
    title: 'Các phiên Attendance chồng lấn',
    severity: 'Chặn xác nhận',
    reason: 'Có nhiều phiên ghi nhận cùng một khoảng thời gian.',
    action: 'Giữ đối soát ở trạng thái cần rà soát để tránh cộng trùng giờ.',
    owner: 'HR/Admin xem xét; Attendance owner xác minh phiên.',
  },
}

const eventLabels: Record<string, string> = {
  PREVIEW: 'Tạo bản đối soát', REFRESH: 'Làm mới nguồn dữ liệu',
  VERIFY: 'Xác nhận giờ OT', REJECT: 'Từ chối đối soát', REOPEN: 'Mở phiên đối soát mới',
}

const caseActionLabels: Record<string, string> = {
  EXPLANATION_REQUESTED: 'HR yêu cầu giải trình',
  EXPLANATION_SUBMITTED: 'Nhân viên đã giải trình',
  EXPLANATION_CLOSED: 'Đóng yêu cầu giải trình',
  REVIEW_REQUESTED: 'Nhân viên yêu cầu xem xét lại',
  REVIEW_ACCEPTED: 'HR mở phiên đối soát mới',
  REVIEW_DECLINED: 'HR từ chối yêu cầu xem xét',
}

const caseStatusLabels: Record<string, string> = {
  OPEN: 'Đang chờ xử lý', RESPONDED: 'Đã có phản hồi', CLOSED: 'Đã đóng',
  ACCEPTED: 'Đã mở phiên mới', DECLINED: 'Đã từ chối yêu cầu',
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

export function OvertimeReconciliationSection({ request, user, highlightCaseId }: Props) {
  const [result, setResult] = useState<OvertimeReconciliation | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [refreshFailed, setRefreshFailed] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [reason, setReason] = useState('')
  const [verifyNote, setVerifyNote] = useState('')
  const [exceptionAction, setExceptionAction] = useState<ExceptionAction | null>(null)
  const [exceptionText, setExceptionText] = useState('')
  const [reopening, setReopening] = useState(false)
  const [reopenReason, setReopenReason] = useState('')

  const isSunday = useMemo(() => {
    try {
      return new Date(request.work_date).getDay() === 0
    } catch {
      return false
    }
  }, [request.work_date])
  const [multiplier, setMultiplier] = useState<'1.5' | '2.0' | '3.0'>(isSunday ? '2.0' : '1.5')

  const reload = useCallback(async (): Promise<string | null> => {
    setLoading(true)
    setError('')
    try {
      setResult(await overtimeReconciliationApi.detail(request.request_id))
      setError('')
      setRefreshFailed(false)
      return null
    } catch (err) {
      const message = errorMessage(err)
      setError(message)
      setRefreshFailed(true)
      return message
    } finally {
      setLoading(false)
    }
  }, [request.request_id])

  useEffect(() => {
    let active = true
    overtimeReconciliationApi.detail(request.request_id)
      .then(data => {
        if (!active) return
        setResult(data)
        setError('')
      })
      .catch(err => {
        if (active) setError(errorMessage(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [request.request_id])

  useEffect(() => {
    if (!highlightCaseId || !result) return
    requestAnimationFrame(() => document.getElementById(`ot-reconciliation-case-${highlightCaseId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }, [highlightCaseId, result])

  const act = async (action: () => Promise<OvertimeReconciliation>, success: string) => {
    setWorking(true)
    setError('')
    setNotice('')
    try {
      setResult(await action())
      setRefreshFailed(false)
      setNotice(success)
      toast.success(success)
      setRejecting(false)
      setReason('')
      setReopening(false)
      setReopenReason('')
    } catch (err) {
      const msg = errorMessage(err)
      toast.error(msg)
      if (err instanceof ApiHttpError && err.status === 409) {
        const refreshError = await reload()
        setError(refreshError
          ? `${msg} Không tải được dữ liệu mới nhất: ${refreshError}. Nội dung đang hiển thị có thể đã cũ; hãy thử tải lại trước khi quyết định.`
          : `${msg} Dữ liệu mới nhất đã được tải lại; hãy kiểm tra trước khi xử lý tiếp.`)
      } else {
        setError(msg)
      }
    } finally {
      setWorking(false)
    }
  }

  const actOnException = async () => {
    if (!result || !exceptionAction) return
    const textValue = exceptionText.trim()
    if (textValue.length < 3) {
      setError('Nhập nội dung hoặc lý do tối thiểu 3 ký tự.')
      return
    }
    setWorking(true)
    setError('')
    setNotice('')
    try {
      if (exceptionAction.kind === 'request_explanation') {
        await overtimeReconciliationApi.requestExplanation(request.request_id, result.version, textValue)
      } else if (exceptionAction.kind === 'respond') {
        const item = (result.exception_cases || []).find(row => row.case_id === exceptionAction.caseId)
        if (!item) throw new Error('Không tìm thấy hồ sơ giải trình cần phản hồi.')
        await overtimeReconciliationApi.respondToExplanation(request.request_id, item.case_id, item.version, textValue)
      } else if (exceptionAction.kind === 'request_review') {
        await overtimeReconciliationApi.requestReview(request.request_id, result.version, textValue)
      } else if (exceptionAction.kind === 'close') {
        const item = (result.exception_cases || []).find(row => row.case_id === exceptionAction.caseId)
        if (!item) throw new Error('Không tìm thấy hồ sơ giải trình cần đóng.')
        await overtimeReconciliationApi.closeExplanation(request.request_id, item.case_id, item.version, textValue)
      } else {
        const item = (result.exception_cases || []).find(row => row.case_id === exceptionAction.caseId)
        if (!item) throw new Error('Không tìm thấy yêu cầu xem xét cần xử lý.')
        await overtimeReconciliationApi.decideReview(request.request_id, item.case_id, item.version,
          item.reconciliation_version, exceptionAction.decision, textValue)
      }
      const action = exceptionAction
      setExceptionAction(null)
      setExceptionText('')
      const refreshError = await reload()
      if (refreshError) setError(`Đã lưu thao tác nhưng không tải lại được hồ sơ: ${refreshError}`)
      else setNotice(action.kind === 'request_explanation' ? 'Đã gửi yêu cầu giải trình; hồ sơ sẽ chờ HR xử lý.'
        : action.kind === 'respond' ? 'Đã gửi giải trình cho HR.'
          : action.kind === 'request_review' ? 'Đã gửi yêu cầu xem xét lại.'
            : action.kind === 'close' ? 'Đã đóng hồ sơ giải trình theo thao tác HR.'
              : action.decision === 'ACCEPT' ? 'Đã mở phiên đối soát mới ở trạng thái cần rà soát.'
                : 'Đã từ chối yêu cầu xem xét; kết quả REJECTED cũ được giữ nguyên.')
    } catch (err) {
      if (err instanceof ApiHttpError && err.status === 409) {
        const refreshError = await reload()
        setError(refreshError
          ? `${errorMessage(err)} Không tải được hồ sơ mới nhất: ${refreshError}. Hãy tải lại trước khi thử tiếp.`
          : `${errorMessage(err)} Hồ sơ mới nhất đã được tải lại; hãy kiểm tra trước khi thử tiếp.`)
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
  const canPreview = approved && (roles.includes('HR_MANAGER') || roles.includes('ADMIN'))
  const canDecide = approved && (roles.includes('HR_MANAGER') || roles.includes('ADMIN')) && request.employee_id !== user.employee_id &&
    request.created_by !== user.user_id
  const isAssignedEmployee = request.employee_id === user.employee_id
  const actionable = result && !refreshFailed && result.version > 0 && result.source_current &&
    result.reconciliation_window_open &&
    ['PENDING_RECONCILIATION', 'NEEDS_REVIEW'].includes(result.status)
  const stale = result && result.version > 0 && !result.source_current
  const exceptionCases = result?.exception_cases || []
  const explanationCase = exceptionCases.find(item => item.case_type === 'EXPLANATION' && item.reconciliation_version === result?.version)
  const reviewCase = exceptionCases.find(item => item.case_type === 'REVIEW_REQUEST' && item.reconciliation_version === result?.version)
  const explanationBlocksDecision = explanationCase?.status === 'OPEN'
  const registeredMicroseconds = Math.max(0,
    (new Date(request.ends_at).getTime() - new Date(request.starts_at).getTime()) * 1000)

  return <section className="overtime-context-section overtime-reconciliation" aria-label="Đối soát giờ OT thực tế">
    <div className="overtime-reconciliation-heading">
      <div><h3>Đối soát giờ OT thực tế</h3><p>Duyệt đơn và xác nhận giờ thực tế là hai quyết định riêng. Giờ xác nhận chưa đồng nghĩa đã trả lương.</p></div>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void reload()} disabled={loading || working}>Tải lại</button>
    </div>
    {loading && !result ? <p role="status">Đang tải đối soát và minh chứng chấm công…</p> : error && !result ?
      <div className="overtime-conflict-warning" role="alert">{error} <button type="button" className="btn btn-secondary btn-sm" onClick={() => void reload()}>Thử lại</button></div> : result && <>
        {loading && <p className="overtime-reconciliation-refreshing" role="status">Đang cập nhật dữ liệu nguồn…</p>}
        <div className="overtime-reconciliation-status">
          <span>Đơn OT: <strong>{request.status === 'APPROVED' ? 'Đã duyệt đăng ký' : request.status}</strong></span>
          <span className="overtime-reconciliation-chip">
            Thực hiện: {executionLabels[result.execution_status || ''] || 'Chưa xác định'}
          </span>
          <span className={`overtime-reconciliation-chip is-${(result.display_status || result.effective_status).toLowerCase()}`}>
            Đối soát: {labels[result.display_status || result.effective_status]}
          </span>
          {result.version > 0 && <small>Phiên bản #{result.version}</small>}
        </div>
        {stale && <div className="overtime-conflict-warning" role="alert"><strong>Nguồn dữ liệu đã thay đổi</strong><p>Kết quả xác nhận cũ không còn hiệu lực. Làm mới đối soát và để HR xem lại trước khi sử dụng giờ OT.</p></div>}
        {(!result.reconciliation_window_open || (result.execution_status === 'ATTENDANCE_INCOMPLETE' && result.review_issues.length === 0)) && executionMessages[result.execution_status || ''] &&
          <div className="overtime-reconciliation-execution-note" role="status">{executionMessages[result.execution_status || '']}</div>}
        {result.review_issues.length > 0 && <div className="overtime-conflict-warning" role="status"><strong>Cần kiểm tra nguồn chấm công</strong><ul>{result.review_issues.map(issue => {
          const detail = issueDetails[issue]
          return <li key={issue}><strong>{detail?.title || 'Vấn đề dữ liệu nguồn'}</strong><small>Mã: {issue} · Mức: {detail?.severity || 'Cần rà soát'}</small><span>{detail?.reason || 'Cần kiểm tra dữ liệu nguồn.'}</span><span>{detail?.action || 'Không xác nhận OT khi nguồn chưa rõ.'}</span><small>Phụ trách: {detail?.owner || 'HR/Admin và Attendance owner.'}</small></li>
        })}</ul></div>}
        {roles.includes('ADMIN') && !roles.includes('HR_MANAGER') && <div className="overtime-reconciliation-readonly-note" role="note">Admin dùng quyền đối soát hiện có; thao tác bị chặn nếu đơn do chính tài khoản tạo hoặc dành cho chính nhân viên đó.</div>}
        {notice && <div className="overtime-no-conflict" role="status">{notice}</div>}
        {error && <div className="overtime-conflict-warning" role="alert">{error}</div>}
        <div className="overtime-reconciliation-metrics">
          <div><small>Giờ OT đăng ký</small><strong>{hours(registeredMicroseconds)}</strong></div>
          <div><small>Giờ OT được HR duyệt</small><strong>{requestApproved ? hours(registeredMicroseconds) : 'Chưa duyệt'}</strong></div>
          <div><small>Attendance thực tế giao khung OT</small><strong>{hours(result.actual_microseconds)}</strong></div>
          <div><small>Giờ đề xuất sau đối soát</small><strong>{result.version ? hours(result.proposed_microseconds) : 'Chưa đối soát'}</strong></div>
          <div>
            <small>Giờ OT đã được HR xác nhận</small>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
              <strong>{result.effective_status === 'VERIFIED' ? hours(result.verified_microseconds) : 'Chưa có hiệu lực'}</strong>
              {result.effective_status === 'VERIFIED' && (
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '4px',
                    backgroundColor: (result.decision_reason || '').includes('3.0') || (result.decision_reason || '').includes('3x')
                      ? 'rgba(124, 58, 237, 0.15)'
                      : (result.decision_reason || '').includes('2.0') || (result.decision_reason || '').includes('2x') || isSunday
                      ? 'rgba(217, 119, 6, 0.15)'
                      : 'rgba(37, 99, 235, 0.15)',
                    color: (result.decision_reason || '').includes('3.0') || (result.decision_reason || '').includes('3x')
                      ? '#7c3aed'
                      : (result.decision_reason || '').includes('2.0') || (result.decision_reason || '').includes('2x') || isSunday
                      ? '#b45309'
                      : '#1d4ed8',
                  }}
                >
                  Hệ số: {(result.decision_reason || '').includes('3.0') || (result.decision_reason || '').includes('3x')
                    ? '3,0× (Lễ, Tết)'
                    : (result.decision_reason || '').includes('2.0') || (result.decision_reason || '').includes('2x') || isSunday
                    ? '2,0× (Nghỉ CN)'
                    : '1,5× (Ngày thường)'}
                </span>
              )}
            </div>
          </div>
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
        {result.exception_workflow_available === false && <div className="overtime-reconciliation-readonly-note" role="status">Luồng giải trình/xem xét chưa được cài trên database đang kết nối. Các chức năng đối soát hiện có vẫn hoạt động; không có trạng thái ngoại lệ nào được giả lập.</div>}
        {exceptionCases.length > 0 && <section className="ot-exception-cases" aria-label="Hồ sơ ngoại lệ đối soát">
          <h4>Giải trình và yêu cầu xem xét</h4>
          {exceptionCases.map(item => <article id={`ot-reconciliation-case-${item.case_id}`} className={`ot-exception-case${highlightCaseId === item.case_id ? ' is-highlighted' : ''}`} key={item.case_id}>
            <header><strong>{item.case_type === 'EXPLANATION' ? 'Yêu cầu giải trình' : 'Yêu cầu xem xét lại'}</strong><span className={`ot-exception-state is-${item.status.toLowerCase()}`}>{caseStatusLabels[item.status] || item.status}</span><small>Đối soát phiên #{item.reconciliation_version} · hồ sơ #{item.case_id}</small></header>
            <p><strong>Lý do:</strong> {item.reason}</p>
            {item.employee_response && <p><strong>Phản hồi nhân viên:</strong> {item.employee_response}</p>}
            {item.resolution_reason && <p><strong>Kết quả xử lý:</strong> {item.resolution_reason}</p>}
            <ol className="ot-exception-timeline">{item.events.map(event => <li key={event.case_event_id}><strong>{caseActionLabels[event.action] || event.action}</strong><small>User #{event.actor_id} · {dateTime(event.created_at)}</small>{event.reason && <span>{event.reason}</span>}</li>)}</ol>
            <div className="overtime-reconciliation-actions">
              {isAssignedEmployee && item.case_type === 'EXPLANATION' && item.status === 'OPEN' && <button type="button" className="btn btn-primary btn-sm" disabled={working} onClick={() => { setExceptionText(''); setExceptionAction({ kind: 'respond', caseId: item.case_id }) }}>Gửi giải trình</button>}
              {canDecide && item.case_type === 'EXPLANATION' && ['OPEN', 'RESPONDED'].includes(item.status) && <button type="button" className="btn btn-secondary btn-sm" disabled={working} onClick={() => { setExceptionText(''); setExceptionAction({ kind: 'close', caseId: item.case_id }) }}>Đóng yêu cầu giải trình</button>}
              {canDecide && item.case_type === 'REVIEW_REQUEST' && item.status === 'OPEN' && <>
                <button type="button" className="btn btn-primary btn-sm" disabled={working} onClick={() => { setExceptionText(''); setExceptionAction({ kind: 'review_decision', caseId: item.case_id, decision: 'ACCEPT' }) }}>Mở lại đối soát</button>
                <button type="button" className="btn btn-danger btn-sm" disabled={working} onClick={() => { setExceptionText(''); setExceptionAction({ kind: 'review_decision', caseId: item.case_id, decision: 'REJECT' }) }}>Từ chối yêu cầu xem xét</button>
              </>}
            </div>
          </article>)}
        </section>}
        {result.exception_workflow_available && canDecide && actionable && !explanationCase && <div className="overtime-reconciliation-actions">
          <button type="button" className="btn btn-secondary btn-sm" disabled={working} onClick={() => { setExceptionText(''); setExceptionAction({ kind: 'request_explanation' }) }}>Yêu cầu giải trình</button>
        </div>}
        {result.exception_workflow_available && isAssignedEmployee && result.status === 'REJECTED' && result.request_eligible !== false && !reviewCase && <div className="overtime-reconciliation-actions">
          <button type="button" className="btn btn-secondary btn-sm" disabled={working} onClick={() => { setExceptionText(''); setExceptionAction({ kind: 'request_review' }) }}>Yêu cầu xem xét lại</button>
        </div>}
        {exceptionAction && <div className="ot-exception-form" aria-label="Biểu mẫu xử lý ngoại lệ OT">
          <label className="form-group"><span className="form-label">{exceptionAction.kind === 'request_explanation' ? 'Lý do cần nhân viên giải trình' : exceptionAction.kind === 'respond' ? 'Nội dung giải trình' : exceptionAction.kind === 'request_review' ? 'Lý do yêu cầu xem xét lại' : exceptionAction.kind === 'close' ? 'Lý do HR đóng hồ sơ giải trình' : exceptionAction.decision === 'ACCEPT' ? 'Căn cứ mở phiên đối soát mới' : 'Lý do từ chối yêu cầu xem xét'}</span>
            <textarea className="form-input" rows={3} maxLength={4000} value={exceptionText} onChange={event => setExceptionText(event.target.value)} />
          </label>
          <div className="ot-exception-form-note">Chỉ lưu nội dung văn bản. Hồ sơ này không sửa Attendance và không tự tạo giờ OT được xác nhận.</div>
          <div className="overtime-reconciliation-actions"><button type="button" className="btn btn-secondary btn-sm" disabled={working} onClick={() => { setExceptionAction(null); setExceptionText('') }}>Hủy</button><button type="button" className="btn btn-primary btn-sm" disabled={working || exceptionText.trim().length < 3} onClick={() => void actOnException()}>{working ? 'Đang lưu…' : 'Xác nhận'}</button></div>
        </div>}
        {canPreview && <div className="overtime-reconciliation-actions"><button type="button" className="btn btn-secondary btn-sm" disabled={working || loading || !result.reconciliation_window_open || ['OPEN', 'RESPONDED'].includes(explanationCase?.status || '')} title={!result.reconciliation_window_open ? 'Preview mở sau khi khung OT kết thúc.' : explanationCase && ['OPEN', 'RESPONDED'].includes(explanationCase.status) ? 'Đóng hồ sơ giải trình trước khi làm mới nguồn.' : undefined} onClick={() => void act(() => overtimeReconciliationApi.preview(request.request_id), result.version ? 'Đã kiểm tra lại nguồn đối soát.' : 'Đã tạo bản đối soát.')}>{working ? 'Đang xử lý…' : !result.reconciliation_window_open ? (result.execution_status === 'NOT_STARTED' ? 'Chưa đến giờ OT' : 'Đang trong thời gian OT') : result.version ? 'Làm mới đối soát' : 'Xem trước đối soát'}</button></div>}
        {canDecide && actionable && <div className="overtime-reconciliation-actions">
          {explanationBlocksDecision ? (
            <span className="ot-exception-inline-note" role="status">Đang chờ nhân viên giải trình; HR cần nhận phản hồi hoặc đóng hồ sơ thủ công.</span>
          ) : rejecting ? (
            <div className="overtime-reconciliation-reject">
              <label className="form-group">
                <span className="form-label">Lý do từ chối đối soát</span>
                <textarea className="form-input" rows={2} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} />
              </label>
              <button type="button" className="btn btn-secondary btn-sm" disabled={working} onClick={() => setRejecting(false)}>Hủy</button>
              <button type="button" className="btn btn-danger btn-sm" disabled={working || reason.trim().length < 3} onClick={() => void act(() => overtimeReconciliationApi.reject(request.request_id, result.version, reason.trim()), 'Đã từ chối kết quả đối soát.')}>Xác nhận từ chối</button>
            </div>
          ) : verifying ? (
            <div className="overtime-reconciliation-verify-form" style={{ width: '100%', padding: '14px 16px', background: 'var(--surface-subtle)', borderRadius: '10px', border: '1px solid var(--border-default)', marginTop: '8px' }}>
              <div style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--text-primary)', marginBottom: '4px' }}>
                Chọn hệ số tính lương làm thêm giờ (Bắt buộc)
              </div>
              <p style={{ margin: '0 0 12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                Tiền lương OT = Số giờ làm thêm thực tế hợp lệ × Tiền lương giờ thực trả × Hệ số tương ứng theo quy định pháp luật.
              </p>

              <div style={{ display: 'grid', gap: '8px', marginBottom: '12px' }}>
                {MULTIPLIER_OPTIONS.map(opt => (
                  <label
                    key={opt.value}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      border: `1.5px solid ${multiplier === opt.value ? 'var(--primary-color, #2563eb)' : 'var(--border-default)'}`,
                      background: multiplier === opt.value ? 'rgba(37, 99, 235, 0.05)' : 'var(--surface-card)',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      name="ot_multiplier"
                      value={opt.value}
                      checked={multiplier === opt.value}
                      onChange={() => setMultiplier(opt.value)}
                      style={{ accentColor: 'var(--primary-color, #2563eb)', cursor: 'pointer' }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{opt.label}</strong>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: '4px',
                            backgroundColor: opt.value === '3.0' ? 'rgba(124, 58, 237, 0.12)' : opt.value === '2.0' ? 'rgba(217, 119, 6, 0.12)' : 'rgba(37, 99, 235, 0.12)',
                            color: opt.value === '3.0' ? '#7c3aed' : opt.value === '2.0' ? '#d97706' : '#2563eb',
                          }}
                        >
                          {opt.rate}
                        </span>
                      </div>
                      <small style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>{opt.desc}</small>
                    </div>
                  </label>
                ))}
              </div>

              <label className="form-group" style={{ marginBottom: '12px' }}>
                <span className="form-label" style={{ fontSize: '12px' }}>Ghi chú thẩm định đối soát (không bắt buộc)</span>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Nhập ghi chú hoặc căn cứ đối soát (nếu có)..."
                  value={verifyNote}
                  onChange={e => setVerifyNote(e.target.value)}
                  maxLength={500}
                />
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={working}
                  onClick={() => { setVerifying(false); setVerifyNote(''); }}
                >
                  Hủy
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={working || !multiplier}
                  onClick={() => {
                    const selectedOpt = MULTIPLIER_OPTIONS.find(o => o.value === multiplier);
                    const reasonPayload = `[Hệ số: ${multiplier}x - ${selectedOpt?.label || 'OT'}]${verifyNote.trim() ? ` ${verifyNote.trim()}` : ''}`;
                    void act(
                      () => overtimeReconciliationApi.verify(request.request_id, result.version, reasonPayload),
                      `Đã xác nhận giờ OT thực tế với hệ số ${multiplier}×.`
                    );
                    setVerifying(false);
                  }}
                >
                  {working ? 'Đang lưu…' : `Xác nhận giờ OT (Hệ số ${multiplier}×)`}
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={working}
                onClick={() => setRejecting(true)}
              >
                Từ chối đối soát
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={working || result.review_issues.length > 0 || result.proposed_microseconds <= 0}
                onClick={() => setVerifying(true)}
              >
                Xác minh OT
              </button>
            </>
          )}
        </div>}

        {canDecide && ['VERIFIED', 'REJECTED'].includes(result.status) && (
          <div className="overtime-reconciliation-actions" style={{ marginTop: '12px', borderTop: '1px dashed var(--border-default)', paddingTop: '12px' }}>
            {reopening ? (
              <div className="overtime-reconciliation-reopen-form" style={{ width: '100%', padding: '14px 16px', background: 'var(--surface-subtle)', borderRadius: '10px', border: '1px solid var(--border-default)' }}>
                <div style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--color-warning, #d97706)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {Icons.undo || Icons.refresh} Hoàn tác kết quả đối soát OT
                </div>
                <p style={{ margin: '0 0 10px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Thao tác này sẽ mở lại trạng thái đối soát (chuyển về chờ đối soát / rà soát lại). 
                  Chỉ được phép khi Kỳ công/Bảng lương tháng này <strong>CHƯA chốt (Draft/Open)</strong>. 
                  Nếu bảng lương đã chốt (CONFIRMED/PAID), hệ thống sẽ khóa dữ liệu để bảo đảm tính toàn vẹn báo cáo kế toán.
                </p>
                <label className="form-group" style={{ marginBottom: '10px' }}>
                  <span className="form-label">Lý do hoàn tác (Bắt buộc, tối thiểu 3 ký tự)</span>
                  <textarea
                    className="form-input"
                    rows={2}
                    maxLength={1000}
                    placeholder="Ví dụ: Phát hiện sai lệch dữ liệu chấm công, cần đối chiếu lại ca làm việc hoặc điều chỉnh hệ số OT..."
                    value={reopenReason}
                    onChange={e => setReopenReason(e.target.value)}
                  />
                </label>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={working}
                    onClick={() => { setReopening(false); setReopenReason(''); }}
                  >
                    Hủy
                  </button>
                  <button
                    type="button"
                    className="btn btn-warning btn-sm"
                    style={{ backgroundColor: '#d97706', color: '#fff', borderColor: '#d97706' }}
                    disabled={working || reopenReason.trim().length < 3}
                    onClick={() => {
                      void act(
                        () => overtimeReconciliationApi.reopen(request.request_id, result.version, reopenReason.trim()),
                        'Đã hoàn tác kết quả đối soát OT thành công; hồ sơ đã được mở lại để kiểm tra/xác minh lại.'
                      )
                    }}
                  >
                    {working ? 'Đang hoàn tác…' : 'Xác nhận hoàn tác đối soát'}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', flexWrap: 'wrap', gap: 8 }}>
                <small style={{ color: 'var(--text-secondary)' }}>
                  {result.status === 'VERIFIED'
                    ? 'Đơn đã được xác nhận giờ OT hợp lệ. Cần điều chỉnh lại hoặc phát hiện sai sót?'
                    : 'Đơn đã bị từ chối đối soát. Cần xem xét lại dữ liệu ca hoặc hệ số?'}
                </small>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={working}
                  onClick={() => { setReopening(true); setReopenReason(''); }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                >
                  {Icons.undo} Hoàn tác đối soát
                </button>
              </div>
            )}
          </div>
        )}
      </>}
  </section>
}
