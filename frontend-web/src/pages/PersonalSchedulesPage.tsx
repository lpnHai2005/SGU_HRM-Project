import { useEffect, useState } from 'react'
import { api, overtimeRequestApi, userService } from '../services/api'
import { Fragment } from 'react'
import { operationToday } from './ActivityPage'
import { MonthPicker } from '../components/common/MonthPicker'
import { OvertimeRequestDrawer } from '../components/schedule/OvertimeRequestDrawer'
import { overtimeStatusClass, overtimeStatusLabel } from '../components/schedule/overtimeDisplay'
import type { OvertimeRequest } from '../types'

export function PersonalSchedulesPage({ user: providedUser }: { user?: any } = {}) {
  const user = providedUser || userService.get()
  const [period, setPeriod] = useState(operationToday().slice(0, 7))
  const [rows, setRows] = useState<any[]>([])
  const [overtimeRequests, setOvertimeRequests] = useState<OvertimeRequest[]>([])
  const [error, setError] = useState('')
  const [overtimeError, setOvertimeError] = useState('')
  const [notice, setNotice] = useState('')
  const [overtimeOpen, setOvertimeOpen] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [actionBusy, setActionBusy] = useState<number | null>(null)
  const [actionError, setActionError] = useState('')
  const [declineRequestId, setDeclineRequestId] = useState<number | null>(null)
  const [declineReason, setDeclineReason] = useState('')
  const roles: string[] = user?.roles || []
  const canCreateOwnRequest = Boolean(user?.employee_id && (roles.includes('EMPLOYEE') || roles.includes('ADMIN')) && !roles.includes('STORE_MANAGER'))
  const lastDay = new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0).getDate()
  const dateFrom = `${period}-01`
  const dateTo = `${period}-${String(lastDay).padStart(2, '0')}`

  const confirmOvertime = async (requestId: number) => {
    setActionBusy(requestId)
    setActionError('')
    try {
      await overtimeRequestApi.employeeConfirm(requestId)
      setNotice(`Đã xác nhận đề xuất OT #${requestId}; request đã chuyển sang chờ HR duyệt.`)
      setRefresh(value => value + 1)
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : 'Không thể xác nhận đăng ký OT.')
    } finally {
      setActionBusy(null)
    }
  }

  const declineOvertime = async (requestId: number) => {
    setActionBusy(requestId)
    setActionError('')
    try {
      await overtimeRequestApi.employeeDecline(requestId, declineReason)
      setNotice(`Đã từ chối đề xuất OT #${requestId}.`)
      setDeclineRequestId(null)
      setDeclineReason('')
      setRefresh(value => value + 1)
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : 'Không thể từ chối đăng ký OT.')
    } finally {
      setActionBusy(null)
    }
  }

  useEffect(() => {
    let live = true
    api.get<any[]>('/mobile-attendance/my-schedules', { period })
      .then(value => { if (live) { setRows(value); setError('') } })
      .catch((requestError: unknown) => { if (live) setError(requestError instanceof Error ? requestError.message : 'Không tải được lịch làm việc.') })
    return () => { live = false }
  }, [period])

  useEffect(() => {
    if (!user?.employee_id) return
    let live = true
    overtimeRequestApi.list({ date_from: dateFrom, date_to: dateTo, employee_id: Number(user.employee_id), limit: 200 })
      .then(value => { if (live) { setOvertimeRequests(value); setOvertimeError('') } })
      .catch((requestError: unknown) => { if (live) setOvertimeError(requestError instanceof Error ? requestError.message : 'Không tải được đăng ký OT.') })
    return () => { live = false }
  }, [dateFrom, dateTo, user?.employee_id, refresh])

  return <section className="card personal-schedules-page" style={{ padding: 24 }}>
    <div className="personal-schedules-heading">
      <div><h1>Lịch ca & Phân công</h1><p>Lịch chính thức và đăng ký tăng ca được hiển thị thành hai phần riêng.</p></div>
      {canCreateOwnRequest && <button type="button" className="btn btn-primary" onClick={() => setOvertimeOpen(true)}>+ Đăng ký OT</button>}
    </div>
    <MonthPicker value={period} onChange={setPeriod} label="Tháng tra cứu" />
    {notice && <p className="work-schedule-notice" role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    <div className="table-container"><table className="data-table"><thead><tr><th>Ngày</th><th>Ca</th><th>Giờ làm</th><th>Cửa hàng</th></tr></thead><tbody>
      {rows.map(row => <tr key={row.schedule_id}><td>{row.work_date.split('-').reverse().join('/')}</td><td>{row.shift_name}</td><td>{row.start_time?.slice(0, 5)} – {row.end_time?.slice(0, 5)}</td><td>{row.store_name}</td></tr>)}
    </tbody></table>{!rows.length && !error && <p>Chưa có lịch trong kỳ này.</p>}</div>

    <section className="personal-overtime-section" aria-label="Đăng ký OT của tôi">
      <header><div><h2>Đăng ký OT của tôi</h2><p>Đề xuất OT không làm thay đổi ca làm việc chính thức.</p></div>{canCreateOwnRequest && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOvertimeOpen(true)}>+ Đăng ký OT</button>}</header>
      {overtimeError && <p role="alert">{overtimeError}</p>}
      {actionError && <p role="alert">{actionError}</p>}
      {overtimeRequests.length ? <div className="table-container"><table className="data-table"><thead><tr><th>Mã đơn</th><th>Ngày</th><th>Thời gian</th><th>Lý do</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>
        {overtimeRequests.map(request => <Fragment key={request.request_id}>
          <tr key={request.request_id}><td>OT #{request.request_id}</td><td>{request.work_date.split('-').reverse().join('/')}</td><td>{request.starts_at.slice(11, 16)}–{request.ends_at.slice(11, 16)}</td><td>{request.reason}</td><td><span className={`calendar-overtime-chip ${overtimeStatusClass(request.status)}`}>{overtimeStatusLabel(request.status)}</span></td><td className="personal-overtime-actions">
            {request.status === 'PENDING_EMPLOYEE_CONFIRMATION' ? <><button type="button" className="btn btn-primary btn-sm" disabled={actionBusy === request.request_id} onClick={() => void confirmOvertime(request.request_id)}>Xác nhận</button><button type="button" className="btn btn-danger btn-sm" disabled={actionBusy === request.request_id} onClick={() => { setDeclineRequestId(request.request_id); setDeclineReason('') }}>Từ chối</button></> : <span>—</span>}
          </td></tr>
          {declineRequestId === request.request_id && <tr key={`decline-${request.request_id}`}><td colSpan={6}><div className="personal-overtime-decline"><label htmlFor={`decline-reason-${request.request_id}`}>Lý do từ chối (không bắt buộc)</label><input id={`decline-reason-${request.request_id}`} className="form-input" maxLength={1000} value={declineReason} onChange={event => setDeclineReason(event.target.value)} disabled={actionBusy === request.request_id} /><button type="button" className="btn btn-secondary btn-sm" onClick={() => setDeclineRequestId(null)} disabled={actionBusy === request.request_id}>Giữ đề xuất</button><button type="button" className="btn btn-danger btn-sm" onClick={() => void declineOvertime(request.request_id)} disabled={actionBusy === request.request_id}>{actionBusy === request.request_id ? 'Đang gửi…' : 'Xác nhận từ chối'}</button></div></td></tr>}
        </Fragment>)}
      </tbody></table></div> : !overtimeError && <p className="day-overtime-empty">Chưa có đăng ký OT trong tháng này.</p>}
    </section>

    {canCreateOwnRequest && <OvertimeRequestDrawer isOpen={overtimeOpen} onClose={() => setOvertimeOpen(false)} user={user} employees={[]} lookups={null}
      initialDate={operationToday()} initialStoreId={user?.store_id ? Number(user.store_id) : undefined} fixedEmployeeId={Number(user.employee_id)}
      onSuccess={message => { setNotice(message); setRefresh(value => value + 1) }} />}
  </section>
}
