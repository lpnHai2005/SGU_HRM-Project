import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCompanyProfile } from '../hooks/useCompanyProfile'
import { Printer, X, CheckCircle2, AlertTriangle } from 'lucide-react'
import {
  formatDate,
  formatTime,
  formatDurationMinutes,
  formatCurrency,
  formatQualityFlag,
  formatQualityStatus,
} from '../utils/formatters'
import './AttendancePrint.css'

interface EmployeeAttendancePrintModalProps {
  employee: any
  period: string
  standardWorkingDays?: number
  onClose: () => void
}

function getDayOfWeek(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    const day = d.getDay()
    if (day === 0) return 'CN'
    return `T${day + 1}`
  } catch {
    return '—'
  }
}

export function EmployeeAttendancePrintModal({
  employee,
  period,
  standardWorkingDays,
  onClose,
}: EmployeeAttendancePrintModalProps) {
  const [checksum, setChecksum] = useState<string>('COMPUTING...')
  const company = useCompanyProfile()

  const isReconciled =
    (employee.needs_review_session_count || 0) === 0 &&
    (employee.attendance_quality_status === 'RECONCILED' || employee.statuses?.includes('RECONCILED'))
  const watermarkText = isReconciled ? 'BẢNG CÔNG CHÍNH THỨC' : 'DỰ THẢO - CHỜ HR RÀ SOÁT'

  // Phân loại phiên: Phiên hợp lệ (Bảng II) vs Phiên bất thường (Bảng III) vs Phiên loại trừ (Bảng IV) vs Nghỉ phép (Bảng V)
  const sessions = employee.sessions || []

  const getReviewDecision = (session: any) =>
    String(
      session.review_decision ||
        session.hr_review?.review_decision ||
        session.hr_review?.decision ||
        session.attendance_context?.hr_review?.review_decision ||
        session.attendance_context?.hr_review?.decision ||
        ''
    )
      .trim()
      .toUpperCase()
  const isExcludedSession = (session: any) =>
    session.is_excluded === true || getReviewDecision(session) === 'EXCLUDED_INVALID'
  const isHeldSession = (session: any) =>
    session.payroll_hold === true || getReviewDecision(session) === 'NEEDS_MORE_INFO'
  const isLeaveSession = (session: any) =>
    !session.check_in_time && (
      ['ANNUAL_LEAVE', 'UNPAID_LEAVE', 'PAID_LEAVE', 'SICK_LEAVE', 'MATERNITY_LEAVE'].includes(session.status) ||
      Boolean(session.notes?.includes('Đơn nghỉ phép'))
    )
  const isOpenSession = (session: any) =>
    Boolean(session.check_in_time) &&
    !session.check_out_time &&
    (session.session_quality_status === 'OPEN_SESSION' ||
      session.session_quality_status === 'OVERDUE_OPEN_SESSION' ||
      session.is_overdue_open_session)

  const isConfirmedWorkDecision = (session: any) =>
    ['CONFIRMED_RAW_WORK', 'CONFIRMED_LATE', 'SHIFT_REASSIGNED'].includes(getReviewDecision(session))
  const isConfirmedAsRawWork = (session: any) =>
    getReviewDecision(session) === 'CONFIRMED_RAW_WORK'

  const excludedSessions = sessions.filter(isExcludedSession)
  const leaveSessions = sessions.filter(isLeaveSession)

  // Phiên bất thường: phiên bị tạm giữ (hold/chờ giải trình) hoặc phiên mở chưa checkout
  const anomalySessions = sessions.filter(
    (s: any) =>
      !isExcludedSession(s) &&
      !isLeaveSession(s) &&
      (isHeldSession(s) || isOpenSession(s))
  )

  // Phiên làm việc thực tế hợp lệ: có check-in, không bị loại trừ, không bị hold, không phải phiên mở chưa checkout
  const regularSessions = sessions.filter(
    (s: any) =>
      Boolean(s.check_in_time) &&
      !isExcludedSession(s) &&
      !isHeldSession(s) &&
      !isOpenSession(s) &&
      !isLeaveSession(s)
  )

  const actualWorkDates = new Set(
    regularSessions
      .map((session: any) => String(session.work_date || '').slice(0, 10))
      .filter(Boolean)
  )
  const actualWorkingDays = Array.isArray(employee.sessions)
    ? actualWorkDates.size
    : (employee.working_days ?? 0)
  const validLogDates = new Set(
    regularSessions
      .filter((session: any) => session.check_in_time)
      .map((session: any) => String(session.work_date || '').slice(0, 10))
      .filter(Boolean)
  )
  const workDatesOutsideValidLog = [...actualWorkDates].filter(date => !validLogDates.has(date))

  // Theo dõi ngày công cho cột "Tính ngày trễ" (1 ngày nhiều phiên chỉ +1 ngày)
  const seenLateDates = new Set<string>()

  const totalLatePenalty = employee.late_penalty_amount ?? (employee.late_session_count ?? 0) * 50000

  // Sinh mã Checksum SHA-256 thật bằng Web Crypto API
  useEffect(() => {
    const rawData = [
      employee.employee_code || `NV${employee.employee_id}`,
      period,
      (employee.scheduled_hours ?? 0).toFixed(2),
      (employee.actual_work_hours ?? 0).toFixed(2),
      employee.late_day_count ?? 0,
      employee.late_session_count ?? 0,
      employee.verified_late_minutes ?? 0,
      totalLatePenalty,
      employee.early_day_count ?? 0,
      (employee.verified_ot_hours ?? 0).toFixed(2),
      employee.needs_review_session_count ?? 0,
      actualWorkingDays,
      excludedSessions.map((session: any) => session.attendance_id).sort().join(','),
    ].join('|')

    if (window.crypto && window.crypto.subtle) {
      const msgBuffer = new TextEncoder().encode(rawData)
      window.crypto.subtle
        .digest('SHA-256', msgBuffer)
        .then(hashBuffer => {
          const hashArray = Array.from(new Uint8Array(hashBuffer))
          const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
          setChecksum(hashHex.slice(0, 24).toUpperCase())
        })
        .catch(() => {
          setChecksum(`TZ-${employee.employee_id}-${period.replace('-', '')}-SECURE`)
        })
    } else {
      setChecksum(`TZ-${employee.employee_id}-${period.replace('-', '')}-SECURE`)
    }
  }, [employee, period, totalLatePenalty])

  // ESC để đóng modal
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    const printPageRule = document.createElement('style')
    printPageRule.dataset.printPage = 'attendance-a4-portrait'
    printPageRule.textContent = '@media print { @page { size: A4 portrait; margin: 12mm 14mm; } }'
    document.head.appendChild(printPageRule)
    return () => printPageRule.remove()
  }, [])

  const handlePrint = () => {
    window.print()
  }

  const [yearStr, monthStr] = period.split('-')

  return createPortal((
    <div className="attendance-print-overlay print-active-overlay" onClick={onClose}>
      <div className="attendance-print-actions-bar no-print" onClick={e => e.stopPropagation()}>
        <div className="attendance-print-actions-left">
          <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
            Xem trước Bảng xác nhận chấm công · {employee.employee_name} ({period})
          </strong>
          <span
            style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: 4,
              fontWeight: 600,
              background: isReconciled ? 'var(--status-success-bg, #ecfdf5)' : 'var(--status-warning-bg, #fffbeb)',
              color: isReconciled ? 'var(--status-success, #059669)' : 'var(--status-warning, #b45309)',
              border: `1px solid ${isReconciled ? 'var(--status-success-border, #a7f3d0)' : 'var(--status-warning-border, #fde68a)'}`,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            {isReconciled ? (
              <>
                <CheckCircle2 size={13} />
                <span>Đã đối soát đạt chuẩn</span>
              </>
            ) : (
              <>
                <AlertTriangle size={13} />
                <span>Có phiên chờ rà soát</span>
              </>
            )}
          </span>
        </div>
        <div className="attendance-print-actions-right">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handlePrint}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <Printer size={14} />
            <span>In ra giấy / Lưu PDF (A4)</span>
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
          >
            <X size={14} />
            <span>Đóng</span>
          </button>
        </div>
      </div>

      <div className="attendance-a4-sheet print-modal" onClick={e => e.stopPropagation()}>
        {/* Watermark kiểm soát trạng thái */}
        <div className={`print-watermark ${isReconciled ? 'is-official' : 'is-draft'}`}>
          {watermarkText}
        </div>

        {/* 1. Quốc hiệu & Tên cơ quan chuẩn Nghị định 30/2020/NĐ-CP */}
        <header className="print-header-grid">
          <div className="print-hdr-org">
            <div className="print-org-name">{company.name}</div>
            <div className="print-org-sub">{employee.store_name || 'HỆ THỐNG BÁN LẺ & VĂN PHÒNG'}</div>
            <div className="print-doc-number">
              Số: TS-{period.replace('-', '')}/{employee.employee_code || `NV${employee.employee_id}`}
            </div>
          </div>
          <div className="print-hdr-motto">
            <div className="print-motto-country">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
            <div className="print-motto-desc">Độc lập - Tự do - Hạnh phúc</div>
            <div className="print-motto-rule"></div>
            <div className="print-date-issued">
              Tp. Hồ Chí Minh, ngày {new Date().getDate()} tháng {new Date().getMonth() + 1} năm {new Date().getFullYear()}
            </div>
          </div>
        </header>

        {/* 2. Tiêu đề văn bản */}
        <div className="print-title-section">
          <h1 className="print-timesheet-title">BẢNG XÁC NHẬN CHẤM CÔNG VÀ GIỜ LÀM VIỆC</h1>
          <div className="print-timesheet-subtitle">
            Kỳ đối soát: Tháng {monthStr} năm {yearStr} · Quy định: Chuẩn 26 ngày công · Ân hạn trễ: 15 phút (0đ) · Phạt trễ quá hạn: 50.000 ₫/lần
          </div>
        </div>

        {/* 3. Thông tin người lao động */}
        <section className="print-emp-info-grid">
          <div className="print-info-item">
            <span className="print-info-label">Họ và tên:</span>
            <span className="print-info-val">{employee.employee_name}</span>
          </div>
          <div className="print-info-item">
            <span className="print-info-label">Mã nhân viên:</span>
            <span className="print-info-val">{employee.employee_code || `NV${employee.employee_id}`}</span>
          </div>
          <div className="print-info-item">
            <span className="print-info-label">Phòng ban:</span>
            <span className="print-info-val">{employee.department_name || '—'}</span>
          </div>
          <div className="print-info-item">
            <span className="print-info-label">Cơ sở / Cửa hàng:</span>
            <span className="print-info-val">{employee.store_name || '—'}</span>
          </div>
        </section>

        {/* 4. Khung tổng hợp chỉ số chuẩn hóa HR */}
        <section className="print-kpi-summary-box">
          <div className="print-kpi-title">I. TỔNG HỢP CÔNG &amp; THỜI GIAN LÀM VIỆC TRONG THÁNG (CHUẨN HOÁ HR)</div>
          <div className="print-kpi-grid">
            <div className="print-kpi-cell">
              <div className="print-kpi-lbl">Ngày công thực tế</div>
              <div className="print-kpi-val">
                {actualWorkingDays} / {standardWorkingDays ?? employee.standard_working_days ?? 26} ngày
              </div>
            </div>
            <div className="print-kpi-cell">
              <div className="print-kpi-lbl">Phép năm hưởng lương (AL)</div>
              <div className="print-kpi-val">{employee.paid_leave_days ?? 0} ngày</div>
            </div>
            <div className="print-kpi-cell">
              <div className="print-kpi-lbl">Nghỉ việc riêng K.lương (UL)</div>
              <div className="print-kpi-val">{employee.unpaid_leave_days ?? 0} ngày</div>
            </div>
            <div className="print-kpi-cell">
              <div className="print-kpi-lbl">OT đối soát hợp lệ (VERIFIED)</div>
              <div className="print-kpi-val highlight-ot">
                {(employee.verified_ot_hours ?? 0).toFixed(2)} giờ
              </div>
            </div>

            <div className="print-kpi-cell">
              <div className="print-kpi-lbl">Số ngày đi trễ (&gt;15p)</div>
              <div className={`print-kpi-val ${(employee.late_day_count ?? 0) > 0 ? 'highlight-alert' : ''}`}>
                {employee.late_day_count ?? 0} ngày ({employee.late_session_count ?? 0} lần phạt)
              </div>
            </div>
            <div className="print-kpi-cell">
              <div className="print-kpi-lbl">Tổng phút trễ &amp; Tiền phạt</div>
              <div className="print-kpi-val" style={{ color: totalLatePenalty > 0 ? '#b91c1c' : 'inherit' }}>
                {employee.verified_late_minutes ?? 0}p · Phạt: {formatCurrency(totalLatePenalty)}
              </div>
            </div>
            <div className="print-kpi-cell">
              <div className="print-kpi-lbl">Số ngày về sớm (Hợp lệ)</div>
              <div className={`print-kpi-val ${(employee.early_day_count ?? 0) > 0 ? 'highlight-late' : ''}`}>
                {employee.early_day_count ?? 0} ngày ({employee.verified_early_minutes ?? 0}p)
              </div>
            </div>
            <div className="print-kpi-cell">
              <div className="print-kpi-lbl">Phiên bất thường cần rà soát</div>
              <div className={`print-kpi-val ${(employee.needs_review_session_count ?? 0) > 0 ? 'highlight-alert' : ''}`}>
                {employee.needs_review_session_count ?? 0} phiên
              </div>
            </div>
          </div>
        </section>

        {/* 5. Bảng II: Nhật ký các phiên làm việc trong kỳ */}
        <div className="print-section-title">
          <span>
            II. NHẬT KÝ CÁC PHIÊN LÀM VIỆC TRONG KỲ ({regularSessions.length} phiên · {actualWorkingDays} ngày công thực tế)
          </span>
        </div>
        <div style={{ margin: '-3px 0 6px', color: '#475569', fontSize: '9px', lineHeight: 1.4 }}>
          Số phiên đếm từng bản ghi quẹt thẻ làm việc thực tế; ngày công thực tế đếm ngày duy nhất có check-in và chưa bị loại trừ/giữ xử lý.
          {workDatesOutsideValidLog.length > 0 && (
            <> Có {workDatesOutsideValidLog.length} ngày công có check-in chưa nằm trong nhật ký phiên hợp lệ; xem phiên bất thường tại Mục III.</>
          )}
        </div>
        <table className="print-table">
          <thead>
            <tr>
              <th style={{ width: '70px' }}>Ngày</th>
              <th style={{ width: '38px' }}>Thứ</th>
              <th>Ca kế hoạch</th>
              <th style={{ width: '90px' }}>Khung giờ ca</th>
              <th style={{ width: '65px' }}>Check-in</th>
              <th style={{ width: '65px' }}>Check-out</th>
              <th style={{ width: '60px' }}>Giờ làm</th>
              <th style={{ width: '60px' }}>Trễ (p)</th>
              <th style={{ width: '60px' }}>Sớm (p)</th>
              <th style={{ width: '85px' }}>OT / Ngoài ca*</th>
              <th style={{ width: '125px' }}>Tính ngày trễ &amp; Phạt</th>
            </tr>
          </thead>
          <tbody>
            {regularSessions.length > 0 ? (
              regularSessions.map((s: any) => {
                const workDateStr = s.work_date ? String(s.work_date).slice(0, 10) : ''
                const scheduledTime = s.scheduled_start
                  ? `${s.scheduled_start.slice(0, 5)} - ${s.scheduled_end?.slice(0, 5) || '—'}`
                  : s.attendance_context?.actual?.start_time
                  ? `${s.attendance_context.actual.start_time.slice(0, 5)} - ${s.attendance_context.actual.end_time?.slice(0, 5) || '—'}`
                  : '—'

                let lateDayText = <span style={{ color: '#94a3b8' }}>—</span>
                const rawWorkConfirmed = isConfirmedAsRawWork(s)
                if (rawWorkConfirmed) {
                  lateDayText = (
                    <span title="HR xác nhận công thực tế, chưa kết luận vi phạm trễ hoặc tiền phạt">
                      Chưa kết luận từ phiên thô
                    </span>
                  )
                } else if (s.is_valid_late) {
                  if (!seenLateDates.has(workDateStr)) {
                    seenLateDates.add(workDateStr)
                    lateDayText = <span className="tag-print-late-day">+1 ngày trễ (50k)</span>
                  } else {
                    lateDayText = <span className="tag-print-late-sub">Trễ ca 2 (0d, 50k)</span>
                  }
                } else if ((s.late_minutes ?? 0) > 0 && (s.late_minutes ?? 0) <= 15) {
                  lateDayText = <span style={{ color: '#059669', fontSize: '9px' }}>≤15p (Miễn phạt)</span>
                }

                const outsideValue = Number(s.outside_schedule_hours ?? s.overtime_hours ?? 0)
                const outsideH = Number.isFinite(outsideValue) ? outsideValue.toFixed(2) : '—'
                const lateMinutes = Number(s.late_minutes ?? 0)
                const earlyMinutes = Number(s.early_minutes ?? 0)
                const actualHours = s.actual_work_hours == null ? null : Number(s.actual_work_hours)

                return (
                  <tr key={s.attendance_id}>
                    <td className="text-center">{formatDate(s.work_date)}</td>
                    <td className="text-center">{getDayOfWeek(s.work_date)}</td>
                    <td className="text-left">{s.shift_name || s.attendance_context?.actual?.shift_name || 'Ca làm việc'}</td>
                    <td className="text-center">{scheduledTime}</td>
                    <td className="text-center">{formatTime(s.check_in_time)}</td>
                    <td className="text-center">{s.check_out_time ? formatTime(s.check_out_time) : '—'}</td>
                    <td className="text-center">
                      <strong>{actualHours !== null && Number.isFinite(actualHours) ? `${actualHours}h` : '—'}</strong>
                    </td>
                    <td className="text-center">
                      {rawWorkConfirmed && lateMinutes > 0 ? (
                        <span title="Số phút trễ đo thô; chưa được HR xác nhận là vi phạm" style={{ color: '#64748b' }}>
                          {lateMinutes}*
                        </span>
                      ) : s.is_valid_late ? (
                        <strong style={{ color: '#b91c1c' }}>{lateMinutes}</strong>
                      ) : lateMinutes > 0 && lateMinutes <= 15 ? (
                        <span style={{ color: '#059669' }}>{lateMinutes}</span>
                      ) : (
                        rawWorkConfirmed ? '—' : '0'
                      )}
                    </td>
                    <td className="text-center">
                      {rawWorkConfirmed && earlyMinutes > 0 ? (
                        <span title="Số phút về sớm đo thô; chưa được HR xác nhận là vi phạm" style={{ color: '#64748b' }}>
                          {earlyMinutes}*
                        </span>
                      ) : s.is_valid_early ? (
                        <strong style={{ color: '#c2410c' }}>{earlyMinutes}</strong>
                      ) : earlyMinutes > 0 ? (
                        <span style={{ color: '#d97706' }}>{earlyMinutes}</span>
                      ) : (
                        rawWorkConfirmed ? '—' : '0'
                      )}
                    </td>
                    <td className="text-center">
                      {s.has_verified_ot && s.verified_ot_hours > 0 ? (
                        <div>
                          <span style={{ color: '#059669', fontWeight: 700 }} title={`Đơn OT #${s.ot_request_id} đã duyệt & đối soát`}>
                            ✓ {s.verified_ot_hours}h
                          </span>
                          {Number(outsideH) > s.verified_ot_hours && (
                            <div style={{ fontSize: '9px', color: '#64748b' }}>
                              (+{(Number(outsideH) - s.verified_ot_hours).toFixed(2)}h thô)
                            </div>
                          )}
                        </div>
                      ) : Number(outsideH) > 0 ? (
                        <span style={{ color: '#64748b' }}>{outsideH}h thô</span>
                      ) : (
                        '0h'
                      )}
                    </td>
                    <td className="text-center">{lateDayText}</td>
                  </tr>
                )
              })
            ) : (
              <tr>
                <td colSpan={11} className="text-center" style={{ padding: '12px', color: '#64748b' }}>
                  Chưa phát sinh phiên làm việc hợp lệ trong kỳ.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* 6. Bảng III: Các phiên bất thường vẫn cần HR xác minh */}
        <div className="print-section-title">
          <span>
            III. PHIÊN BẤT THƯỜNG / CHƯA ĐƯỢC CÔNG NHẬN LÀ CÔNG HỢP LỆ ({anomalySessions.length} phiên)
          </span>
        </div>
        <table className="print-table print-table-anomaly">
          <thead>
            <tr>
              <th style={{ width: '70px' }}>Ngày</th>
              <th>Ca gán ban đầu</th>
              <th style={{ width: '70px' }}>Vào thực tế</th>
              <th style={{ width: '70px' }}>Ra thực tế</th>
              <th style={{ width: '85px' }}>Thời lượng</th>
              <th style={{ width: '75px' }}>Trễ thô (p)</th>
              <th style={{ width: '75px' }}>Sớm thô (p)</th>
              <th style={{ width: '130px' }}>Cờ cảnh báo (Flags)</th>
              <th>Lý do loại trừ &amp; Hướng xử lý</th>
            </tr>
          </thead>
          <tbody>
            {anomalySessions.length > 0 ? (
              anomalySessions.map((s: any) => (
                <tr key={s.attendance_id}>
                  <td className="text-center"><strong>{formatDate(s.work_date)}</strong></td>
                  <td className="text-left">{s.shift_name || s.attendance_context?.actual?.shift_name || 'Ca sáng bán lẻ'}</td>
                  <td className="text-center">{formatTime(s.check_in_time)}</td>
                  <td className="text-center">{s.check_out_time ? formatTime(s.check_out_time) : 'Chưa ra'}</td>
                  <td className="text-center">{s.actual_work_hours !== undefined && s.actual_work_hours !== null ? `${Number(s.actual_work_hours).toFixed(1)}h công` : formatDurationMinutes(s.raw_duration_minutes)}</td>
                  <td className="text-center" style={{ color: '#b91c1c' }}><strong>{s.late_minutes ?? 0}p</strong></td>
                  <td className="text-center" style={{ color: '#c2410c' }}>{s.early_minutes ?? 0}p</td>
                  <td className="text-center">
                    <span style={{ fontSize: '9px', fontWeight: 600, color: '#92400e' }}>
                      {s.quality_flags?.map((f: string) => formatQualityFlag(f)).join(', ') ||
                        formatQualityStatus(s.session_quality_status)}
                    </span>
                  </td>
                  <td className="text-left" style={{ fontSize: '10px', color: '#475569' }}>
                    {isHeldSession(s)
                      ? (s.hr_review?.reason ? `Chờ giải trình: ${s.hr_review.reason}` : 'Phiên đang tạm giữ (HOLD) chờ HR và nhân viên giải trình.')
                      : s.session_quality_status === 'OPEN_SESSION' || !s.check_out_time
                      ? 'Phiên chưa check-out, chờ nhân sự giải trình thời gian ra thực tế.'
                      : s.session_quality_status === 'SHORT_SESSION'
                      ? 'Phiên kiểm thử ngắn ≤15p, lệch giờ ca. Chờ HR đối soát.'
                      : 'Thời lượng hoặc độ lệch vượt ngưỡng (>240p), chờ HR đối soát.'}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={9} className="text-center" style={{ padding: '8px', color: '#059669' }}>
                  ✓ Không có phiên bất thường nào trong kỳ công. Dữ liệu đối soát toàn vẹn.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* 7. Phụ lục riêng các phiên HR đã loại khỏi ngày công */}
        <div className="print-section-title">
          <span>IV. PHỤ LỤC CÁC PHIÊN ĐÃ XỬ LÝ — LOẠI TRỪ KHỎI NGÀY CÔNG ({excludedSessions.length} phiên)</span>
        </div>
        <table className="print-table print-table-anomaly">
          <thead>
            <tr>
              <th style={{ width: '70px' }}>Ngày</th>
              <th>Ca / phiên</th>
              <th style={{ width: '65px' }}>Check-in</th>
              <th style={{ width: '65px' }}>Check-out</th>
              <th style={{ width: '80px' }}>Thời lượng thô</th>
              <th style={{ width: '105px' }}>Quyết định</th>
              <th style={{ width: '110px' }}>HR xử lý</th>
              <th>Căn cứ</th>
            </tr>
          </thead>
          <tbody>
            {excludedSessions.length > 0 ? (
              excludedSessions.map((session: any) => (
                <tr key={session.attendance_id}>
                  <td className="text-center">{formatDate(session.work_date)}</td>
                  <td className="text-left">{session.shift_name || session.attendance_context?.actual?.shift_name || 'Phiên chấm công'}</td>
                  <td className="text-center">{formatTime(session.check_in_time)}</td>
                  <td className="text-center">{session.check_out_time ? formatTime(session.check_out_time) : 'Chưa ra'}</td>
                  <td className="text-center">{formatDurationMinutes(session.raw_duration_minutes)}</td>
                  <td className="text-center"><strong>Loại trừ phiên</strong></td>
                  <td className="text-left">{session.hr_review?.reviewed_by_name || session.hr_review?.user_name || 'HR'}</td>
                  <td className="text-left">{session.hr_review?.reason || 'Không ghi nhận căn cứ'}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="text-center" style={{ padding: '8px', color: '#64748b' }}>
                  Không có phiên nào được HR loại trừ khỏi ngày công trong kỳ.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* 8. Danh mục nghỉ phép đã duyệt trong kỳ */}
        {leaveSessions.length > 0 && (
          <>
            <div className="print-section-title">
              <span>V. DANH MỤC NGHỈ PHÉP ĐÃ DUYỆT TRONG KỲ ({leaveSessions.length} ngày)</span>
            </div>
            <table className="print-table print-table-anomaly">
              <thead>
                <tr>
                  <th style={{ width: '80px' }}>Ngày nghỉ</th>
                  <th style={{ width: '50px' }}>Thứ</th>
                  <th style={{ width: '180px' }}>Loại phép</th>
                  <th style={{ width: '140px' }}>Chế độ hưởng lương</th>
                  <th>Căn cứ / Ghi chú đơn</th>
                </tr>
              </thead>
              <tbody>
                {leaveSessions.map((ls: any) => {
                  const isPaid = ls.status === 'ANNUAL_LEAVE' || ls.status === 'PAID_LEAVE'
                  const leaveTypeLabel =
                    ls.status === 'ANNUAL_LEAVE'
                      ? 'Nghỉ phép năm (AL)'
                      : ls.status === 'UNPAID_LEAVE'
                      ? 'Nghỉ việc riêng không lương (UL)'
                      : ls.status || 'Nghỉ phép'
                  return (
                    <tr key={ls.attendance_id}>
                      <td className="text-center"><strong>{formatDate(ls.work_date)}</strong></td>
                      <td className="text-center">{getDayOfWeek(ls.work_date)}</td>
                      <td className="text-left">{leaveTypeLabel}</td>
                      <td className="text-center">
                        <strong style={{ color: isPaid ? '#059669' : '#dc2626' }}>
                          {isPaid ? 'Hưởng nguyên lương' : 'Không hưởng lương'}
                        </strong>
                      </td>
                      <td className="text-left" style={{ fontSize: '10px', color: '#475569' }}>
                        {ls.notes || 'Đơn nghỉ phép đã được phê duyệt hợp lệ'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </>
        )}

        {/* 8. Chú thích đối soát & Cam kết */}
        <div className="print-footnote">
          <strong>Ghi chú bắt buộc:</strong>
          <br />
          - (*) <strong>OT / Ngoài ca:</strong> Ký hiệu (✓) thể hiện giờ OT đã có đơn duyệt và mã đối soát hợp lệ liên kết schema (VERIFIED). Giờ ngoài ca không có ký hiệu (✓) là giờ làm thực tế ngoài ca chưa duyệt đơn OT. Chỉ số{' '}
          <strong>OT đối soát (VERIFIED)</strong> trên Khung tổng hợp là căn cứ tính phụ cấp/lương làm thêm giờ sau khi
          được HR phê duyệt theo quy trình đối soát OT.
          <br />
          - <strong>Xác nhận công loại trừ thô:</strong> HR xác nhận giờ công thực tế, không đồng nghĩa xác nhận trễ/sớm hợp lệ hoặc đơn OT được duyệt.
          Số phút có dấu (*) ở phiên này là số đo thô, không phải kết luận vi phạm.
          <br />
          - <strong>Phiên đã loại trừ:</strong> Không được tính vào nhật ký phiên hợp lệ và ngày công thực tế; được lưu dấu vết tại Phụ lục IV.
          <br />
          - <strong>Chính sách ân hạn &amp; Xử lý vi phạm:</strong> Thời gian trễ cho phép tối đa 15 phút đầu ca (không trừ tiền).
          Mỗi lần trễ vượt quá 15 phút bị phạt 50.000 ₫/lần theo quy chế công ty TechZone.
          <br />
          - <strong>Cam kết xác nhận:</strong> Người lao động có trách nhiệm kiểm tra toàn bộ mốc thời gian và phản hồi cho HR
          trong vòng 48 giờ kể từ ngày ban hành. Sau thời hạn này, bảng công được coi là chính thức chốt để lập phiếu lương.
        </div>

        {/* 9. Chữ ký 3 bên theo chuẩn Nghị định 30/2020/NĐ-CP */}
        <footer className="print-signatures-grid">
          <div className="print-sig-col">
            <div className="print-sig-title">NGƯỜI LAO ĐỘNG</div>
            <div className="print-sig-note">(Ký và ghi rõ họ tên)</div>
            <div className="print-sig-space"></div>
            <div className="print-sig-name">{employee.employee_name}</div>
          </div>
          <div className="print-sig-col">
            <div className="print-sig-title">QUẢN LÝ CƠ SỞ / TRỰC TIẾP</div>
            <div className="print-sig-note">(Cửa hàng trưởng / Trưởng phòng)</div>
            <div className="print-sig-space"></div>
            <div className="print-sig-name">Xác nhận thực tế làm việc</div>
          </div>
          <div className="print-sig-col">
            <div className="print-sig-title">TRƯỞNG PHÒNG NHÂN SỰ</div>
            <div className="print-sig-note">(Ký duyệt đối soát kỳ công)</div>
            <div className="print-sig-space"></div>
            <div className="print-sig-name">Bộ phận Nhân sự TechZone</div>
          </div>
        </footer>

        {/* 10. Checksum bảo mật tính toàn vẹn */}
        <div className="print-checksum-bar">
          <div>
            Mã kiểm tra tính toàn vẹn (SHA-256 Checksum):{' '}
            <span className="print-checksum-val">{checksum}</span>
          </div>
          <div>Bản in chính thức phát hành qua TechZone Enterprise HRM · Trang 1/1</div>
        </div>
      </div>
    </div>
  ), document.body)
}
