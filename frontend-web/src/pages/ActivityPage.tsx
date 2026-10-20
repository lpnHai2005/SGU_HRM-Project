import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../services/api'
import { DatePicker } from '../components/common/DatePicker'
import { Icons } from '../components/common/Icons'
import './ActivityPage.css'

export const operationToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
export const attendanceLabels: Record<string, string> = {
  NORMAL: 'Đúng giờ', LATE: 'Đi muộn', EARLY: 'Về sớm', LATE_AND_EARLY: 'Đi muộn & về sớm',
  OVERTIME: 'Giờ ngoài ca ghi nhận', ANNUAL_LEAVE: 'Nghỉ phép', UNPAID_LEAVE: 'Nghỉ không lương',
  SICK_LEAVE: 'Nghỉ ốm', MATERNITY_LEAVE: 'Nghỉ thai sản',
}
export const scheduleLabels: Record<string, string> = {
  MATCHED: 'Khớp lịch', UNSCHEDULED: 'Không có lịch', SHIFT_MISMATCH: 'Khác lịch',
  LEGACY_UNKNOWN: 'Chưa có snapshot',
}

type ActivityProof = {
  proof_id: number
  check_type: 'CHECK_IN' | 'CHECK_OUT'
  latitude: number
  longitude: number
  verification_status: string
}
type ActivitySession = {
  attendance_id: number
  work_date: string
  check_in_time?: string | null
  check_out_time?: string | null
  actual_work_hours?: number | null
  late_minutes?: number | null
  early_minutes?: number | null
  overtime_hours?: number | null
  status: string
  schedule_status: string
  shift_name?: string | null
  attendance_store_name?: string | null
  proofs?: ActivityProof[]
}
type Person = {
  employee_id: number
  employee_name: string
  department_name?: string | null
  store_name?: string | null
  sessions: ActivitySession[]
}
export type ActivityData = { summary: Record<string, number>; employees: Person[] }
type ProofViewerData = {
  proof: ActivityProof
  employee: Person
  session: ActivitySession
}

function ProtectedProofImage({ proofId, size, alt, zoom = 1 }: { proofId: number; size: 'thumb' | 'full'; alt: string; zoom?: number }) {
  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)
  const [failureReason, setFailureReason] = useState('')
  useEffect(() => {
    let active = true
    let objectUrl = ''
    setSrc('')
    setFailed(false)
    setFailureReason('')
    api.getBlob(`/operations/activity/proofs/${proofId}`, { size })
      .then(blob => {
        if (!active) return
        if (!blob.type.startsWith('image/')) throw new Error('API không trả về dữ liệu ảnh hợp lệ.')
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      })
      .catch(reason => {
        if (!active) return
        const message = reason instanceof Error ? reason.message : 'Không tải được ảnh minh chứng.'
        if (import.meta.env.DEV) console.warn('[ActivityProof] image proxy request failed', { proofId, size, message })
        setFailed(true)
        setFailureReason(message)
      })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [proofId, size])
  if (failed) return <span className="activity-proof-fallback" role="img" aria-label="Không tải được ảnh" title={failureReason}>{Icons.imageOff}<small>{size === 'full' ? failureReason : 'Không tải được ảnh'}</small></span>
  if (!src) return <span className="activity-proof-fallback" aria-label="Đang tải ảnh">{Icons.image}<small>Đang tải</small></span>
  return <img src={src} alt={alt} onError={() => {
    if (import.meta.env.DEV) console.warn('[ActivityProof] browser could not decode image response', { proofId, size })
    setFailed(true)
    setFailureReason('Dữ liệu ảnh nhận được không đọc được. Hãy tải lại hoặc báo quản trị viên.')
  }} style={size === 'full' ? { transform: `scale(${zoom})` } : undefined} />
}

export function ActivityPage({ user, personal = false }: { user: any; personal?: boolean }) {
  const [search] = useSearchParams()
  const [day, setDay] = useState(operationToday)
  const [filters, setFilters] = useState({ employee_id: '', department_id: '', store_id: '' })
  const [applied, setApplied] = useState({ day, ...filters })
  const [group, setGroup] = useState('auto')
  const [kind, setKind] = useState(search.get('kind') || 'all')
  const [data, setData] = useState<ActivityData | null>(null)
  const [options, setOptions] = useState<any>({ employees: [], departments: [], stores: [] })
  const [error, setError] = useState('')
  const [viewer, setViewer] = useState<ProofViewerData | null>(null)
  const [zoom, setZoom] = useState(1)
  const manager = user?.roles?.some((role: string) => ['ADMIN', 'DIRECTOR', 'HR_MANAGER', 'STORE_MANAGER'].includes(role)) && !personal
  const storeOnly = user?.roles?.includes('STORE_MANAGER') && !user.roles.some((role: string) => ['ADMIN', 'HR_MANAGER', 'DIRECTOR'].includes(role))

  useEffect(() => {
    let active = true
    api.get('/operations/filter-options')
      .then(value => { if (active) setOptions(value) })
      .catch(reason => { if (active) setError(reason.message) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    setData(null)
    const params = Object.fromEntries(Object.entries({ ...applied, personal: !manager }).filter(([, value]) => value !== ''))
    api.get<ActivityData>('/operations/activity', params)
      .then(value => { if (active) { setData(value); setError('') } })
      .catch(reason => { if (active) setError(reason.message) })
    return () => { active = false }
  }, [applied, manager])

  const grouped = useMemo(() => {
    const result: Record<string, Person[]> = {}
    const mode = group === 'auto'
      ? (applied.employee_id ? 'none' : (applied.store_id || storeOnly) ? (applied.department_id ? 'employee' : 'department') : 'store')
      : group
    for (const person of data?.employees || []) {
      if (kind === 'working' && !person.sessions.some(session => session.check_in_time && !session.check_out_time)) continue
      if (kind === 'late' && !person.sessions.some(session => Number(session.late_minutes) > 15)) continue
      if (!['all', 'working', 'late'].includes(kind) && !person.sessions.some(session => session.status === kind)) continue
      const key = mode === 'none' ? 'Danh sách'
        : mode === 'employee' ? person.employee_name
          : mode === 'department' ? (person.department_name || 'Chưa có phòng ban')
            : `${person.store_name || 'Chưa có cửa hàng'}${group === 'auto' && !applied.department_id ? ' / ' + (person.department_name || 'Chưa có phòng ban') : ''}`
      ;(result[key] ??= []).push(person)
    }
    return result
  }, [data, kind, group, applied, storeOnly])

  const summaryLabels: Record<string, string> = {
    total: 'Tổng nhân viên', checked_in: 'Đã chấm công', working: 'Đang làm việc',
    finished: 'Đã kết thúc', not_checked_in: 'Chưa chấm công', late: 'Đi muộn', early: 'Về sớm', overtime: 'Giờ ngoài ca ghi nhận',
  }
  const time = (value?: string | null) => value
    ? new Date(value).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' })
    : '—'
  const openProof = (proof: ActivityProof, employee: Person, session: ActivitySession) => {
    setZoom(1)
    setViewer({ proof, employee, session })
  }

  return <div className="page-container operations-page">
    <h1>Nhật ký làm việc &amp; Hoạt động</h1>
    <div className="card operations-filters">
      <DatePicker value={day} onChange={setDay} label="Ngày tham chiếu" />
      {manager && (['employee_id', 'department_id', 'store_id'] as const).map((key, index) => (
        <label key={key}>{['Nhân viên', 'Phòng ban', 'Cửa hàng'][index]}
          <select className="form-select" value={storeOnly && key === 'store_id' ? String(user.store_id) : filters[key]}
            disabled={storeOnly && key === 'store_id'} onChange={event => setFilters({ ...filters, [key]: event.target.value })}>
            <option value="">Tất cả</option>
            {(index === 0 ? options.employees : index === 1 ? options.departments : options.stores)
              .map((item: any) => <option key={item.id || item.employee_id} value={item.id || item.employee_id}>{item.name || item.full_name}</option>)}
          </select>
        </label>
      ))}
      <button className="btn btn-primary" onClick={() => setApplied({ day, ...filters })}>Lọc</button>
      <button className="btn btn-secondary" onClick={() => {
        const empty = { employee_id: '', department_id: '', store_id: '' }
        const today = operationToday()
        setDay(today); setFilters(empty); setApplied({ day: today, ...empty }); setGroup('auto'); setKind('all')
      }}>Đặt lại</button>
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="stat-grid-4 kpi-hover-grid">
      {Object.entries(summaryLabels).map(([key, label]) => <div className="card" style={{ padding: 16 }} key={key}>
        <span>{label}</span><h2>{data?.summary[key] ?? '—'}</h2>
      </div>)}
    </div>
    <div className="operations-toolbar">
      <label>Nhóm theo <select className="form-select" value={group} onChange={event => setGroup(event.target.value)}>
        {Object.entries({ auto: 'Tự động', store: 'Cửa hàng', department: 'Phòng ban', employee: 'Nhân viên', none: 'Không nhóm' })
          .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Trạng thái <select className="form-select" value={kind} onChange={event => setKind(event.target.value)}>
        {Object.entries({ all: 'Tất cả', working: 'Đang làm', late: 'Đi muộn (số phút)', ...attendanceLabels })
          .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
    </div>
    {!data && !error && <p>Đang tải…</p>}
    {data && !Object.keys(grouped).length && <p>Không có dữ liệu phù hợp.</p>}
    {Object.entries(grouped).map(([name, people]) => <section className="card activity-group-card" key={name}>
      <h3>{name}</h3>
      {people.map(person => <details key={person.employee_id} open={!!applied.employee_id}>
        <summary><span className="activity-expand-indicator" aria-hidden="true">{Icons.chevronRight}</span><strong>{person.employee_name}</strong> · {person.department_name} · {person.sessions.length} phiên {person.sessions.length ? '' : '— Chưa chấm công'}</summary>
        <div className="table-container"><table className="data-table">
          <thead><tr>{['Ca / Cửa hàng', 'Vào', 'Ra', 'Giờ làm', 'Trễ (phút)', 'Sớm (phút)', 'Giờ ngoài ca ghi nhận', 'Trạng thái', 'Đối chiếu lịch', 'Minh chứng'].map(label => <th key={label}>{label}</th>)}</tr></thead>
          <tbody>{person.sessions.map(session => <tr key={session.attendance_id}>
            <td>{session.shift_name}<br />{session.attendance_store_name}</td>
            <td>{time(session.check_in_time)}</td><td>{time(session.check_out_time)}</td>
            <td>{session.actual_work_hours ?? '—'}</td><td>{session.late_minutes ?? 0}</td>
            <td>{session.early_minutes ?? 0}</td><td>{session.overtime_hours ?? 0}</td>
            <td>{attendanceLabels[session.status] || session.status}</td>
            <td>{scheduleLabels[session.schedule_status] || session.schedule_status}</td>
            <td><div className="activity-proof-list">
              {(session.proofs || []).length ? session.proofs?.map(proof => <button type="button" className={`activity-proof-view ${proof.check_type === 'CHECK_IN' ? 'is-check-in' : 'is-check-out'}`}
                key={proof.proof_id} onClick={() => openProof(proof, person, session)}
                aria-label={proof.check_type === 'CHECK_IN' ? 'Xem ảnh check-in' : 'Xem ảnh check-out'}>
                {Icons.eye}
                <span>{proof.check_type === 'CHECK_IN' ? 'Vào' : 'Ra'}</span>
              </button>) : <span className="activity-no-proof">{Icons.imageOff}Chưa có ảnh</span>}
            </div></td>
          </tr>)}</tbody>
        </table></div>
      </details>)}
    </section>)}
    {viewer && <div className="activity-proof-overlay" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) setViewer(null)
    }}>
      <section className="activity-proof-dialog" role="dialog" aria-modal="true" aria-labelledby="activity-proof-title">
        <header><div><h2 id="activity-proof-title">Minh chứng chấm công</h2><p>{viewer.proof.check_type === 'CHECK_IN' ? 'Check-in' : 'Check-out'} · {viewer.employee.employee_name}</p></div>
          <button type="button" className="activity-proof-close" onClick={() => setViewer(null)} aria-label="Đóng">{Icons.close}</button></header>
        <div className="activity-proof-content">
          <div className="activity-proof-image-pane"><ProtectedProofImage proofId={viewer.proof.proof_id} size="full" alt="Ảnh minh chứng chấm công" zoom={zoom} /></div>
          <aside className="activity-proof-details">
            <h3>Thông tin chấm công</h3>
            <dl>
              <dt>Nhân viên</dt><dd><strong className="activity-proof-employee">{viewer.employee.employee_name}</strong></dd>
              <dt>Thời gian</dt><dd>Vào {time(viewer.session.check_in_time)} · Ra {time(viewer.session.check_out_time)}</dd>
              <dt>Cửa hàng</dt><dd>{viewer.session.attendance_store_name || viewer.employee.store_name || '—'}</dd>
              <dt>Tọa độ GPS</dt><dd>{viewer.proof.latitude.toFixed(6)}, {viewer.proof.longitude.toFixed(6)}</dd>
              <dt>Trạng thái</dt><dd>{attendanceLabels[viewer.session.status] || viewer.session.status}</dd>
              <dt>Đối chiếu ca</dt><dd><span className={`activity-proof-status ${viewer.session.schedule_status === 'MATCHED' ? 'is-matched' : ['SHIFT_MISMATCH', 'UNSCHEDULED'].includes(viewer.session.schedule_status) ? `is-${viewer.session.schedule_status.toLowerCase().replace('_', '-')}` : 'is-unknown'}`}>
                {scheduleLabels[viewer.session.schedule_status] || viewer.session.schedule_status}
              </span></dd>
            </dl>
          </aside>
        </div>
        <footer><button type="button" className="btn btn-secondary" onClick={() => setZoom(value => Math.max(.75, value - .25))}>{Icons.zoomOut} Thu nhỏ</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" className="btn btn-secondary" onClick={() => setZoom(value => Math.min(2.5, value + .25))}>{Icons.zoomIn} Phóng to</button>
          <button type="button" className="btn btn-primary" onClick={() => setViewer(null)}>Đóng</button></footer>
      </section>
    </div>}
  </div>
}
