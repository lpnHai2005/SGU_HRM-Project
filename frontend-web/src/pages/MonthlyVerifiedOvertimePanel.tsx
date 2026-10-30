import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Eye, Clock, RefreshCw, Check, XCircle, Info, ExternalLink, Calendar, User, Building, MapPin } from 'lucide-react'
import { Icons } from '../components/common/Icons'
import { overtimeReconciliationApi, overtimeRequestApi } from '../services/api'
import type { OvertimeReconciliation, OvertimeRequest } from '../types'
import { formatDate, formatDateTime, formatTime } from '../utils/formatters'

interface Props {
  period: string
  storeId?: string | number
  employeeId?: string | number
  user?: any
  attendanceSessions?: any[]
}

export interface VerifiedOvertimeItem {
  request_id: number
  employee_id: number
  employee_name: string
  employee_code?: string | null
  store_name: string
  work_date: string
  starts_at: string
  ends_at: string
  approved_hours: number
  verified_hours: number
  attendance_ids: number[]
  attendance_sources?: Array<{
    attendance_id: number
    store_id: number | null
    check_in_time: string
    check_out_time: string | null
    overlap_starts_at: string | null
    overlap_ends_at: string | null
    schedule_status: string | null
    planned_starts_at?: string | null
    planned_ends_at?: string | null
  }>
  reviewed_at: string | null
  reviewed_by: number | null
  decision_reason?: string | null
  effective_status: string
  reconciliation?: OvertimeReconciliation
  request?: OvertimeRequest
}

// Helper: Chuyển đổi khoảng thời gian bắt đầu -> kết thúc thành chuỗi hiển thị 1h40m hoặc Xh Ym
export function getIntervalDurationDisplay(startsAt: string, endsAt: string, fallbackHours?: number): string {
  if (startsAt && endsAt) {
    const diffMs = new Date(endsAt).getTime() - new Date(startsAt).getTime()
    if (!isNaN(diffMs) && diffMs > 0) {
      const totalMinutes = Math.round(diffMs / 60000)
      const h = Math.floor(totalMinutes / 60)
      const m = totalMinutes % 60
      if (h === 0) return `${m}m`
      if (m === 0) return `${h}h`
      return `${h}h${m}m`
    }
  }
  if (fallbackHours && fallbackHours > 0) {
    const totalMinutes = Math.round(fallbackHours * 60)
    const h = Math.floor(totalMinutes / 60)
    const m = totalMinutes % 60
    if (h === 0) return `${m}m`
    if (m === 0) return `${h}h`
    return `${h}h${m}m`
  }
  return '—'
}

// Helper: Lấy hệ số tính lương OT theo quy định pháp luật (1.5x ngày thường, 2.0x ngày nghỉ CN, 3.0x lễ tết)
export function getOvertimeMultiplier(row: VerifiedOvertimeItem): { rate: string; label: string; color: string; bg: string } {
  const reason = (row.decision_reason || '').toLowerCase()
  if (reason.includes('3.0') || reason.includes('3x') || reason.includes('lễ') || reason.includes('tết')) {
    return { rate: '3,0×', label: 'Ngày lễ, Tết, ngày nghỉ hưởng lương (3,0×)', color: '#7c3aed', bg: 'rgba(124, 58, 237, 0.12)' }
  }
  if (reason.includes('2.0') || reason.includes('2x') || reason.includes('chủ nhật') || reason.includes('nghỉ hằng tuần')) {
    return { rate: '2,0×', label: 'Ngày nghỉ hằng tuần - Chủ nhật (2,0×)', color: '#b45309', bg: 'rgba(217, 119, 6, 0.12)' }
  }
  if (reason.includes('1.5') || reason.includes('1.5x') || reason.includes('ngày thường') || reason.includes('bình thường')) {
    return { rate: '1,5×', label: 'Ngày làm việc bình thường (1,5×)', color: '#1d4ed8', bg: 'rgba(37, 99, 235, 0.12)' }
  }
  try {
    const d = new Date(row.work_date)
    if (d.getDay() === 0) {
      return { rate: '2,0×', label: 'Ngày nghỉ hằng tuần - Chủ nhật (2,0×)', color: '#b45309', bg: 'rgba(217, 119, 6, 0.12)' }
    }
  } catch {}
  return { rate: '1,5×', label: 'Ngày làm việc bình thường (1,5×)', color: '#1d4ed8', bg: 'rgba(37, 99, 235, 0.12)' }
}

// Helper: Chuyển đổi giờ OT hợp lệ (VERIFIED) sang định dạng phút trực quan kèm giờ thập phân (vd: 0.39h -> 23 phút)
export function formatVerifiedHoursDisplay(hours: number): { minutesText: string; hoursText: string } {
  if (!hours || isNaN(hours) || hours <= 0) {
    return { minutesText: '0 phút', hoursText: '0.00h' }
  }
  const totalMinutes = Math.round(hours * 60)
  const minutesText = totalMinutes >= 60
    ? `${Math.floor(totalMinutes / 60)}h${totalMinutes % 60 > 0 ? (totalMinutes % 60) + 'm' : ''}`
    : `${totalMinutes} phút`
  const hoursText = `${hours.toFixed(2)}h`
  return { minutesText, hoursText }
}

function getMonthRange(period: string) {
  const [yearStr, monthStr] = period.split('-')
  const year = parseInt(yearStr, 10)
  const month = parseInt(monthStr, 10)
  const lastDay = new Date(year, month, 0).getDate()
  const dateFrom = `${period}-01`
  const dateTo = `${period}-${String(lastDay).padStart(2, '0')}`
  return { dateFrom, dateTo }
}

export function MonthlyVerifiedOvertimePanel({ period, storeId, employeeId, attendanceSessions = [] }: Props) {
  const [items, setItems] = useState<VerifiedOvertimeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detailItem, setDetailItem] = useState<VerifiedOvertimeItem | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { dateFrom, dateTo } = getMonthRange(period)

      const recParams: {
        status?: string
        date_from?: string
        date_to?: string
        store_id?: number
        limit?: number
      } = {
        date_from: dateFrom,
        date_to: dateTo,
        limit: 100,
      }
      if (storeId) {
        recParams.store_id = Number(storeId)
      }

      const reqFilterParams: {
        date_from: string
        date_to: string
        store_id?: number
        employee_id?: number
        limit: number
      } = {
        date_from: dateFrom,
        date_to: dateTo,
        limit: 200,
      }
      if (storeId) {
        reqFilterParams.store_id = Number(storeId)
      }
      if (employeeId) {
        reqFilterParams.employee_id = Number(employeeId)
      }

      const [reconciliations, requests] = await Promise.all([
        overtimeReconciliationApi.list(recParams).catch(() => [] as OvertimeReconciliation[]),
        overtimeRequestApi.list(reqFilterParams).catch(() => [] as OvertimeRequest[]),
      ])

      const requestMap = new Map<number, OvertimeRequest>()
      requests.forEach(r => requestMap.set(r.request_id, r))

      // Nối bảng đối soát với đơn OT
      const merged: VerifiedOvertimeItem[] = []
      for (const rec of reconciliations) {
        // Chỉ nhận các đơn đã đối soát (VERIFIED hoặc REJECTED)
        const isVerified = rec.effective_status === 'VERIFIED' || rec.status === 'VERIFIED'
        const isRejected = rec.effective_status === 'REJECTED' || rec.status === 'REJECTED'
        if (!isVerified && !isRejected) continue

        const req = requestMap.get(rec.request_id)
        if (employeeId && req && req.employee_id !== Number(employeeId)) {
          continue
        }

        const startsAt = req?.starts_at || rec.eligible_intervals?.[0]?.starts_at || ''
        const endsAt = req?.ends_at || rec.eligible_intervals?.[0]?.ends_at || ''
        const approvedHours = startsAt && endsAt
          ? (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 3_600_000
          : 0
        const verifiedHours = (rec.verified_microseconds ?? 0) / 3_600_000_000

        merged.push({
          request_id: rec.request_id,
          employee_id: req?.employee_id || 0,
          employee_name: req?.employee_name || `Nhân viên #${rec.request_id}`,
          employee_code: req?.employee_code || null,
          store_name: req?.store_name || `Cửa hàng`,
          work_date: req?.work_date || (startsAt ? startsAt.slice(0, 10) : ''),
          starts_at: startsAt,
          ends_at: endsAt,
          approved_hours: approvedHours > 0 ? approvedHours : verifiedHours,
          verified_hours: verifiedHours,
          attendance_ids: rec.attendance_ids || [],
          attendance_sources: rec.attendance_sources || [],
          reviewed_at: rec.reviewed_at || null,
          reviewed_by: rec.reviewed_by || null,
          decision_reason: rec.decision_reason || req?.reason || null,
          effective_status: rec.effective_status || rec.status || 'VERIFIED',
          reconciliation: rec,
          request: req,
        })
      }

      // Sắp xếp theo ngày làm việc giảm dần
      merged.sort((a, b) => (b.work_date > a.work_date ? 1 : b.work_date < a.work_date ? -1 : b.request_id - a.request_id))
      setItems(merged)
    } catch (err: any) {
      setError(err?.message || 'Không thể tải dữ liệu đối soát giờ OT từ Supabase')
    } finally {
      setLoading(false)
    }
  }, [period, storeId, employeeId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const totalVerifiedHours = items.reduce((sum, item) => sum + (item.effective_status === 'VERIFIED' ? item.verified_hours : 0), 0)
  const totalVerifiedMinutes = Math.round(totalVerifiedHours * 60)
  const uniqueEmployees = new Set(items.map(item => item.employee_id).filter(id => id > 0)).size

  // Helper tìm thông tin phiên chấm công đối chiếu
  const findSessionInfo = (attId: number) => {
    return attendanceSessions.find(s => s.attendance_id === attId)
  }

  return (
    <section className="card monthly-verified-ot-card">
      {/* Header gọn gàng, đồng bộ phong cách hệ thống */}
      <header className="card-header">
        <div className="header-left">
          <h2 className="card-title">
            <Clock size={16} style={{ color: 'var(--color-success, #16a34a)' }} />
            Giờ OT đối soát thành công trong tháng ({period})
            <span
              className="badge"
              style={{
                backgroundColor: 'rgba(22, 163, 74, 0.12)',
                color: '#15803d',
                fontWeight: 600,
                fontSize: '11px',
                padding: '2px 7px',
                borderRadius: '4px',
              }}
            >
              CHỈ XEM (VERIFIED)
            </span>
          </h2>
          <p className="card-subtitle">
            Dữ liệu đối soát từ Supabase (Quản lý Đăng ký & Đối soát OT). Chỉ các khoảng OT đã đối chiếu thành công với phiên chấm công thực tế mới được ghi nhận tính lương.
          </p>
        </div>

        <div className="header-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void loadData()}
            disabled={loading}
            title="Làm mới bảng"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Làm mới
          </button>
          <Link
            to="/overtime?tab=reconciliation"
            className="btn btn-secondary btn-sm"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}
          >
            Quản lý Đăng ký & Đối soát OT →
          </Link>
        </div>
      </header>

      {/* Dải thống kê mỏng (KPI Strip) - Không chiếm nhiều diện tích */}
      <div className="kpi-strip">
        <div className="kpi-metric">
          <span>Tổng giờ OT hợp lệ:</span>
          <strong className="success">
            {totalVerifiedMinutes >= 60
              ? `${Math.floor(totalVerifiedMinutes / 60)}h${totalVerifiedMinutes % 60 > 0 ? (totalVerifiedMinutes % 60) + 'm' : ''} (${totalVerifiedHours.toFixed(2)}h)`
              : `${totalVerifiedMinutes} phút (${totalVerifiedHours.toFixed(2)}h)`}
          </strong>
        </div>
        <div className="kpi-sep" />
        <div className="kpi-metric">
          <span>Số lượt đơn đã đối soát:</span>
          <strong>{items.length} đơn</strong>
        </div>
        <div className="kpi-sep" />
        <div className="kpi-metric">
          <span>Nhân sự ghi nhận OT:</span>
          <strong>{uniqueEmployees} nhân sự</strong>
        </div>
      </div>

      {/* Nội dung bảng */}
      {loading ? (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
          Đang tải dữ liệu đối soát giờ OT từ Supabase…
        </div>
      ) : error ? (
        <div
          role="alert"
          style={{
            margin: '12px',
            padding: '10px 14px',
            color: 'var(--color-danger, #dc2626)',
            background: 'rgba(239, 68, 68, 0.08)',
            borderRadius: '6px',
            fontSize: '12.5px',
          }}
        >
          {error}
        </div>
      ) : items.length === 0 ? (
        <div
          style={{
            padding: '24px 16px',
            textAlign: 'center',
            color: 'var(--text-secondary)',
            fontSize: '12.5px',
          }}
        >
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
            Chưa có giờ OT nào được đối soát thành công (VERIFIED) trong kỳ {period}
          </div>
          <div>
            Hệ thống chỉ hiển thị giờ OT sau khi đơn đăng ký đã được duyệt 2 cấp và khớp với dữ liệu chấm công thực tế.
          </div>
        </div>
      ) : (
        <div className="table-container" style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 70 }}>Mã đơn</th>
                <th>Nhân viên</th>
                <th>Cửa hàng</th>
                <th style={{ width: 85 }}>Ngày làm</th>
                <th style={{ width: 95 }}>Khung giờ</th>
                <th style={{ width: 80 }}>Giờ đăng ký</th>
                <th style={{ width: 105, color: 'var(--color-success, #16a34a)' }}>Giờ OT hợp lệ</th>
                <th style={{ width: 75, textAlign: 'center' }}>Hệ số OT</th>
                <th style={{ width: 95 }}>Đối chiếu phiên</th>
                <th style={{ width: 90 }}>Trạng thái</th>
                <th style={{ textAlign: 'center', width: 65 }}>Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              {items.map(row => {
                const verifiedDisplay = formatVerifiedHoursDisplay(row.verified_hours)
                const registeredDuration = getIntervalDurationDisplay(row.starts_at, row.ends_at, row.approved_hours)
                const isVerified = row.effective_status === 'VERIFIED'
                const isRejected = row.effective_status === 'REJECTED'
                const mult = getOvertimeMultiplier(row)

                return (
                  <tr key={row.request_id}>
                    <td>
                      <Link
                        to={`/overtime?request_id=${row.request_id}`}
                        style={{ fontWeight: 600, color: 'var(--primary-color, #2563eb)', textDecoration: 'none' }}
                        title="Xem đơn OT trong Quản lý Đăng ký & Đối soát OT"
                      >
                        #{row.request_id}
                      </Link>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{row.employee_name}</div>
                      {row.employee_code && (
                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                          {row.employee_code}
                        </div>
                      )}
                    </td>
                    <td>{row.store_name}</td>
                    <td>{formatDate(row.work_date)}</td>
                    <td>
                      {row.starts_at && row.ends_at
                        ? `${formatTime(row.starts_at)} → ${formatTime(row.ends_at)}`
                        : '—'}
                    </td>
                    {/* Cột Giờ đăng ký: Hiển thị 1h40m gọn gàng (đã xóa span giờ thập phân) */}
                    <td>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        {registeredDuration}
                      </span>
                    </td>
                    {/* Cột Giờ OT hợp lệ (VERIFIED): Hiển thị 23 phút gọn gàng trong badge xanh lá (đã xóa span giờ thập phân) */}
                    <td>
                      {isVerified ? (
                        <span
                          style={{
                            fontWeight: 700,
                            color: 'var(--color-success, #16a34a)',
                            backgroundColor: 'rgba(22, 163, 74, 0.08)',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            display: 'inline-block',
                          }}
                        >
                          {verifiedDisplay.minutesText}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-secondary)', fontSize: '11.5px' }}>0 phút</span>
                      )}
                    </td>
                    {/* Cột Hệ số OT: 1,5× (Ngày thường) | 2,0× (Nghỉ CN) | 3,0× (Lễ, Tết) */}
                    <td style={{ textAlign: 'center' }}>
                      {isVerified ? (
                        <span
                          className="badge"
                          title={`Hệ số tính lương OT: ${mult.label}`}
                          style={{
                            backgroundColor: mult.bg,
                            color: mult.color,
                            fontWeight: 700,
                            fontSize: '11px',
                            padding: '2px 7px',
                            borderRadius: '4px',
                            cursor: 'help',
                          }}
                        >
                          {mult.rate}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-tertiary)', fontSize: '11.5px' }}>—</span>
                      )}
                    </td>
                    {/* Cột Đối chiếu phiên: Hiển thị Phiên #48 và cho phép click xem chi tiết */}
                    <td>
                      {row.attendance_ids && row.attendance_ids.length > 0 ? (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {row.attendance_ids.map(attId => {
                            const sess = findSessionInfo(attId)
                            const tooltip = sess
                              ? `Phiên #${attId}: ${sess.shift_name || 'Ca làm'} (${formatTime(sess.check_in_time)} → ${sess.check_out_time ? formatTime(sess.check_out_time) : 'Chưa ra'})`
                              : `Phiên #${attId}. Nhấn để xem chi tiết đối soát.`
                            return (
                              <button
                                key={attId}
                                type="button"
                                className="att-session-pill"
                                onClick={() => setDetailItem(row)}
                                title={tooltip}
                              >
                                Phiên #{attId}
                              </button>
                            )
                          })}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-secondary)', fontSize: '11.5px' }}>—</span>
                      )}
                    </td>
                    {/* Cột Trạng thái: Có tooltip & lý do từ chối nếu có */}
                    <td>
                      {isVerified ? (
                        <span
                          className="badge"
                          title={row.decision_reason ? `Hợp lệ đối soát: ${row.decision_reason}` : 'Đã đối chiếu thành công với phiên chấm công thực tế, đủ điều kiện tính lương'}
                          style={{
                            backgroundColor: 'rgba(22, 163, 74, 0.12)',
                            color: '#15803d',
                            fontWeight: 600,
                            fontSize: '11px',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            cursor: 'help',
                          }}
                        >
                          <Check size={12} strokeWidth={2.5} /> VERIFIED
                        </span>
                      ) : isRejected ? (
                        <div>
                          <span
                            className="badge"
                            title={row.decision_reason ? `Lý do từ chối: ${row.decision_reason}` : 'Bị từ chối đối soát'}
                            style={{
                              backgroundColor: 'rgba(239, 68, 68, 0.12)',
                              color: '#b91c1c',
                              fontWeight: 600,
                              fontSize: '11px',
                              padding: '3px 8px',
                              borderRadius: '4px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              cursor: 'help',
                            }}
                          >
                            <XCircle size={12} strokeWidth={2.5} /> REJECTED
                          </span>
                          {row.decision_reason && (
                            <div style={{ fontSize: '10.5px', color: 'var(--color-danger, #dc2626)', marginTop: 2, maxWidth: 140 }}>
                              {row.decision_reason}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="badge" style={{ fontSize: '11px', padding: '3px 8px' }}>
                          {row.effective_status}
                        </span>
                      )}
                    </td>
                    {/* Cột Chi tiết: Nút icon con mắt */}
                    <td style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '4px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        onClick={() => setDetailItem(row)}
                        title="Xem chi tiết đối soát giờ OT"
                      >
                        <Eye size={14} />
                        <span style={{ fontSize: '11px' }}>Chi tiết</span>
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* MODAL XEM CHI TIẾT ĐỐI SOÁT GIỜ OT */}
      {detailItem && (
        <div
          className="modal-overlay"
          onMouseDown={e => {
            if (e.target === e.currentTarget) setDetailItem(null)
          }}
        >
          <div className="modal ot-reconcile-detail-dialog">
            <header className="modal-header">
              <div>
                <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '15px' }}>
                  <Eye size={18} style={{ color: 'var(--primary-color, #2563eb)' }} />
                  Chi tiết đối soát đơn OT #{detailItem.request_id}
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Nhân viên: <strong>{detailItem.employee_name}</strong> {detailItem.employee_code ? `(${detailItem.employee_code})` : ''} · Ngày làm việc: {formatDate(detailItem.work_date)}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setDetailItem(null)}
                title="Đóng cửa sổ"
                style={{ padding: '4px 8px' }}
              >
                {Icons.close}
              </button>
            </header>

            <div className="modal-body" style={{ padding: '16px', maxHeight: '72vh', overflowY: 'auto' }}>
              {/* Grid 2 cột thông tin đối chiếu */}
              <div className="ot-detail-grid">
                {/* Khối 1: Đơn OT đã duyệt */}
                <div className="ot-detail-box">
                  <div className="ot-detail-box-title" style={{ color: 'var(--primary-color, #2563eb)' }}>
                    Đơn đăng ký OT đã duyệt
                  </div>
                  <div className="ot-detail-item">
                    <span className="ot-detail-label">Cửa hàng / Chi nhánh:</span>
                    <span className="ot-detail-val">{detailItem.store_name}</span>
                  </div>
                  <div className="ot-detail-item">
                    <span className="ot-detail-label">Khung giờ duyệt:</span>
                    <span className="ot-detail-val">
                      {detailItem.starts_at && detailItem.ends_at
                        ? `${formatTime(detailItem.starts_at)} → ${formatTime(detailItem.ends_at)}`
                        : '—'}
                    </span>
                  </div>
                  <div className="ot-detail-item">
                    <span className="ot-detail-label">Thời lượng đăng ký:</span>
                    <span className="ot-detail-val">
                      <strong>{getIntervalDurationDisplay(detailItem.starts_at, detailItem.ends_at, detailItem.approved_hours)}</strong>
                      {' '}({detailItem.approved_hours.toFixed(2)}h)
                    </span>
                  </div>
                  <div className="ot-detail-item">
                    <span className="ot-detail-label">Lý do tăng ca:</span>
                    <span className="ot-detail-val" style={{ maxWidth: '60%' }}>
                      {detailItem.request?.reason || detailItem.decision_reason || 'Tăng ca ca làm việc'}
                    </span>
                  </div>
                </div>

                {/* Khối 2: Kết quả đối soát hợp lệ */}
                <div className="ot-detail-box">
                  <div className="ot-detail-box-title" style={{ color: 'var(--color-success, #16a34a)' }}>
                    Kết quả đối soát tính lương
                  </div>
                  <div className="ot-detail-item">
                    <span className="ot-detail-label">Trạng thái đối soát:</span>
                    <span className="ot-detail-val">
                      <span
                        className="badge"
                        style={{
                          backgroundColor: detailItem.effective_status === 'VERIFIED' ? 'rgba(22, 163, 74, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                          color: detailItem.effective_status === 'VERIFIED' ? '#15803d' : '#b91c1c',
                          padding: '2px 6px',
                          fontSize: '11px',
                          borderRadius: '4px',
                        }}
                      >
                        {detailItem.effective_status}
                      </span>
                    </span>
                  </div>
                  <div className="ot-detail-item">
                    <span className="ot-detail-label">Giờ OT hợp lệ (VERIFIED):</span>
                    <span className="ot-detail-val" style={{ color: 'var(--color-success, #16a34a)' }}>
                      <strong>{formatVerifiedHoursDisplay(detailItem.verified_hours).minutesText}</strong>
                      {' '}({detailItem.verified_hours.toFixed(2)}h)
                    </span>
                  </div>
                  <div className="ot-detail-item">
                    <span className="ot-detail-label">Hệ số tính lương OT:</span>
                    <span className="ot-detail-val" style={{ fontWeight: 700, color: getOvertimeMultiplier(detailItem).color }}>
                      {getOvertimeMultiplier(detailItem).rate} ({getOvertimeMultiplier(detailItem).label})
                    </span>
                  </div>
                  <div className="ot-detail-item">
                    <span className="ot-detail-label">Thời điểm đối soát:</span>
                    <span className="ot-detail-val">
                      {detailItem.reviewed_at ? formatDateTime(detailItem.reviewed_at) : 'Hệ thống tự động'}
                    </span>
                  </div>
                  <div className="ot-detail-item">
                    <span className="ot-detail-label">Người thẩm định:</span>
                    <span className="ot-detail-val">
                      {detailItem.reviewed_by ? `Nhân sự #${detailItem.reviewed_by}` : 'HR / Hệ thống tự động'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Khối 3: Chi tiết các phiên chấm công đối chiếu */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Calendar size={14} />
                  Phiên chấm công đối chiếu thực tế (Attendance Sessions)
                </div>

                {detailItem.attendance_ids && detailItem.attendance_ids.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {detailItem.attendance_ids.map(attId => {
                      const sess = findSessionInfo(attId)
                      const source = detailItem.attendance_sources?.find(s => s.attendance_id === attId)

                      const checkIn = sess?.check_in_time || source?.check_in_time
                      const checkOut = sess?.check_out_time || source?.check_out_time
                      const overlapStart = source?.overlap_starts_at
                      const overlapEnd = source?.overlap_ends_at

                      return (
                        <div
                          key={attId}
                          style={{
                            padding: '10px 14px',
                            background: 'var(--surface-subtle)',
                            borderRadius: '6px',
                            border: '1px solid var(--border-subtle)',
                            fontSize: '12px',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                              Mã phiên chấm công: #{attId} · {sess?.shift_name || 'Phiên làm việc'}
                            </div>
                            <span
                              className="badge"
                              style={{
                                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                                color: '#1d4ed8',
                                fontSize: '10.5px',
                                padding: '1px 6px',
                                borderRadius: '4px',
                              }}
                            >
                              {sess?.status || 'ĐÃ CHẤM CÔNG'}
                            </span>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
                            <div>
                              <span style={{ color: 'var(--text-secondary)' }}>Giờ vào thực tế: </span>
                              <strong>{checkIn ? formatTime(checkIn) : '—'}</strong>
                            </div>
                            <div>
                              <span style={{ color: 'var(--text-secondary)' }}>Giờ ra thực tế: </span>
                              <strong>{checkOut ? formatTime(checkOut) : 'Chưa check-out'}</strong>
                            </div>
                            {overlapStart && overlapEnd && (
                              <div style={{ gridColumn: '1 / -1', color: 'var(--color-success, #16a34a)', fontWeight: 500 }}>
                                Khoảng giao nhau hợp lệ (Overlap): {formatTime(overlapStart)} → {formatTime(overlapEnd)}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div style={{ padding: '10px', background: 'var(--surface-subtle)', borderRadius: '6px', color: 'var(--text-secondary)', fontSize: '12px' }}>
                    Không có phiên chấm công nào gắn với đơn đối soát này.
                  </div>
                )}
              </div>

              {/* Khối 4: Giải thích quy tắc đối soát cho Quản lý */}
              <div
                style={{
                  padding: '10px 14px',
                  background: 'rgba(37, 99, 235, 0.05)',
                  border: '1px solid rgba(37, 99, 235, 0.15)',
                  borderRadius: '6px',
                  fontSize: '11.5px',
                  lineHeight: '1.5',
                  color: 'var(--text-secondary)',
                }}
              >
                <strong style={{ color: 'var(--primary-color, #2563eb)' }}>ℹ️ Nguyên tắc tính lương OT TechZone HRM:</strong> Tiền lương OT được tính trên số giờ làm thêm thực tế hợp lệ, được xác minh theo dữ liệu chấm công và quy trình phê duyệt OT của công ty, nhân với tiền lương giờ thực trả và hệ số tương ứng theo quy định pháp luật (Ngày thường: tối thiểu 1,5×; Ngày nghỉ hằng tuần CN: tối thiểu 2,0×; Ngày lễ/Tết: tối thiểu 3,0×).
              </div>
            </div>

            <footer className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px' }}>
              <Link
                to={`/overtime?request_id=${detailItem.request_id}&tab=reconciliation`}
                className="btn btn-secondary btn-sm"
                style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}
              >
                <ExternalLink size={13} />
                Mở trong Quản lý Đăng ký & Đối soát OT →
              </Link>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setDetailItem(null)}
              >
                Đóng
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  )
}
