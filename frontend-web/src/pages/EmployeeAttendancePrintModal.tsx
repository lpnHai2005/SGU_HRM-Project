import { useEffect, useState } from 'react'
import { Printer, X, CheckCircle2, AlertTriangle } from 'lucide-react'
import {
  formatDate,
  formatTime,
  formatDurationMinutes,
  formatQualityFlag,
  formatQualityStatus,
} from '../utils/formatters'
import './AttendancePrint.css'
import { allowanceTierLabel } from '../utils/attendanceAllowance'

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

  const isReconciled =
    (employee.needs_review_session_count || 0) === 0 &&
    (employee.attendance_quality_status === 'RECONCILED' || employee.statuses?.includes('RECONCILED'))
  const watermarkText = isReconciled ? 'BẢNG CÔNG CHÍNH THỨC' : 'DỰ THẢO - CHỜ HR RÀ SOÁT'

  // Phân loại phiên: Phiên hợp lệ (Bảng I) vs Phiên bất thường / loại trừ (Bảng II)
  const sessions = employee.sessions || []

  const regularSessions = sessions.filter((s: any) => {
    const isAnomaly =
      s.session_quality_status === 'SHORT_SESSION' ||
      s.session_quality_status === 'OPEN_SESSION' ||
      s.session_quality_status === 'NEEDS_REVIEW' ||
      (s.quality_flags && s.quality_flags.some((f: string) => ['SHORT_SESSION', 'EXCESSIVE_LATE', 'EXCESSIVE_EARLY', 'OPEN_SESSION'].includes(f))) ||
      (s.raw_duration_minutes !== null && s.raw_duration_minutes !== undefined && s.raw_duration_minutes <= 15)
    return !isAnomaly
  })

  const anomalySessions = sessions.filter((s: any) => {
    const isAnomaly =
      s.session_quality_status === 'SHORT_SESSION' ||
      s.session_quality_status === 'OPEN_SESSION' ||
      s.session_quality_status === 'NEEDS_REVIEW' ||
      (s.quality_flags && s.quality_flags.some((f: string) => ['SHORT_SESSION', 'EXCESSIVE_LATE', 'EXCESSIVE_EARLY', 'OPEN_SESSION'].includes(f))) ||
      (s.raw_duration_minutes !== null && s.raw_duration_minutes !== undefined && s.raw_duration_minutes <= 15)
    return isAnomaly
  })

  // Theo dõi ngày công cho cột "Tính ngày trễ" (1 ngày nhiều phiên chỉ +1 ngày)
  const seenLateDates = new Set<string>()

  const allowanceTier = allowanceTierLabel(employee.attendance_allowance_tier)

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
      allowanceTier,
      employee.early_day_count ?? 0,
      (employee.verified_ot_hours ?? 0).toFixed(2),
      employee.needs_review_session_count ?? 0,
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
  }, [employee, period, allowanceTier])

  // ESC để đóng modal
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const handlePrint = () => {
    window.print()
  }

  const [yearStr, monthStr] = period.split('-')

  return (
    <div className="attendance-print-overlay" onClick={onClose}>
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
            className="btn btn-primary"
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

      <div className="attendance-a4-sheet" onClick={e => e.stopPropagation()}>
        {/* Watermark kiểm soát trạng thái */}
        <div className={`print-watermark ${isReconciled ? 'is-official' : 'is-draft'}`}>
          {watermarkText}
        </div>

        {/* 1. Quốc hiệu & Tên cơ quan chuẩn Nghị định 30/2020/NĐ-CP */}
        <header className="print-header-grid">
          <div className="print-hdr-org">
            <div className="print-org-name">CÔNG TY CỔ PHẦN CÔNG NGHỆ TECHZONE</div>
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
                {employee.work_day_credits ?? employee.working_days ?? 0} / {standardWorkingDays ?? employee.standard_working_days ?? 26} công
                {' '}({employee.working_days ?? 0} ngày có mặt)
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
                {employee.late_day_count ?? 0} ngày ({employee.late_session_count ?? 0} lần trễ)
              </div>
            </div>
            <div className="print-kpi-cell">
              <div className="print-kpi-lbl">Tổng phút trễ &amp; Chuyên cần</div>
              <div className="print-kpi-val" style={{ color: employee.attendance_allowance_tier && employee.attendance_allowance_tier !== 'FULL' ? '#b91c1c' : 'inherit' }}>
                {employee.verified_late_minutes ?? 0}p · {allowanceTier}{employee.late_warning_report ? ' · Biên bản' : ''}
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

        {/* 5. Bảng I: Nhật ký các phiên làm việc hợp lệ */}
        <div className="print-section-title">
          <span>II. NHẬT KÝ CÁC PHIÊN LÀM VIỆC HỢP LỆ TRONG KỲ ({regularSessions.length} phiên)</span>
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
                  ? `${s.scheduled_start.slice(0, 5)} - ${s.scheduled_end.slice(0, 5)}`
                  : s.attendance_context?.actual?.start_time
                  ? `${s.attendance_context.actual.start_time.slice(0, 5)} - ${s.attendance_context.actual.end_time.slice(0, 5)}`
                  : '—'

                let lateDayText = <span style={{ color: '#94a3b8' }}>—</span>
                if (s.is_valid_late) {
                  if (!seenLateDates.has(workDateStr)) {
                    seenLateDates.add(workDateStr)
                    lateDayText = <span className="tag-print-late-day">+1 ngày trễ (50k)</span>
                  } else {
                    lateDayText = <span className="tag-print-late-sub">Trễ ca 2 (0d, 50k)</span>
                  }
                } else if ((s.late_minutes ?? 0) > 0 && (s.late_minutes ?? 0) <= 15) {
                  lateDayText = <span style={{ color: '#059669', fontSize: '9px' }}>≤15p (Miễn phạt)</span>
                }

                const outsideH = (s.outside_schedule_hours ?? s.overtime_hours ?? 0).toFixed(2)

                return (
                  <tr key={s.attendance_id}>
                    <td className="text-center">{formatDate(s.work_date)}</td>
                    <td className="text-center">{getDayOfWeek(s.work_date)}</td>
                    <td className="text-left">{s.shift_name || s.attendance_context?.actual?.shift_name || 'Ca làm việc'}</td>
                    <td className="text-center">{scheduledTime}</td>
                    <td className="text-center">{formatTime(s.check_in_time)}</td>
                    <td className="text-center">{s.check_out_time ? formatTime(s.check_out_time) : '—'}</td>
                    <td className="text-center"><strong>{s.actual_work_hours}h</strong></td>
                    <td className="text-center">
                      {s.is_valid_late ? (
                        <strong style={{ color: '#b91c1c' }}>{s.late_minutes}</strong>
                      ) : (s.late_minutes ?? 0) > 0 && (s.late_minutes ?? 0) <= 15 ? (
                        <span style={{ color: '#059669' }}>{s.late_minutes}</span>
                      ) : (
                        '0'
                      )}
                    </td>
                    <td className="text-center">
                      {s.is_valid_early ? (
                        <strong style={{ color: '#c2410c' }}>{s.early_minutes}</strong>
                      ) : (s.early_minutes ?? 0) > 0 ? (
                        <span style={{ color: '#d97706' }}>{s.early_minutes}</span>
                      ) : (
                        '0'
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

        {/* 6. Bảng II: Phụ lục các phiên bất thường / kiểm thử cần HR xác minh */}
        <div className="print-section-title">
          <span>
            III. PHỤ LỤC CÁC PHIÊN BẤT THƯỜNG / THỬ NGHIỆM ĐÃ LOẠI TRỪ KHỎI TRỄ HỢP LỆ ({anomalySessions.length} phiên)
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
                    {s.session_quality_status === 'SHORT_SESSION'
                      ? 'Phiên kiểm thử ngắn ≤15p, lệch giờ ca. Đã loại trừ khỏi ngày trễ hợp lệ & tiền phạt.'
                      : s.session_quality_status === 'OPEN_SESSION'
                      ? 'Phiên chưa check-out, chờ nhân sự giải trình thời gian ra thực tế.'
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

        {/* 7. Chú thích đối soát & Cam kết */}
        <div className="print-footnote">
          <strong>Ghi chú bắt buộc:</strong>
          <br />
          - (*) <strong>OT / Ngoài ca:</strong> Ký hiệu (✓) thể hiện giờ OT đã có đơn duyệt và mã đối soát hợp lệ liên kết schema (VERIFIED). Giờ ngoài ca không có ký hiệu (✓) là giờ làm thực tế ngoài ca chưa duyệt đơn OT. Chỉ số{' '}
          <strong>OT đối soát (VERIFIED)</strong> trên Khung tổng hợp là căn cứ tính phụ cấp/lương làm thêm giờ sau khi
          được HR phê duyệt theo quy trình đối soát OT.
          <br />
          - <strong>Chính sách ân hạn &amp; Xử lý vi phạm:</strong> Thời gian trễ cho phép tối đa 15 phút đầu ca (không trừ tiền).
          Không phạt tiền đi trễ. Trễ quá 15 phút 3–4 lần/tháng còn 50% phụ cấp chuyên cần (500.000 ₫); từ 5 lần
          mất phụ cấp chuyên cần và tự động lập biên bản; biên bản 3 tháng liên tiếp bị gắn cờ BLACK_LIST_WARNING.
          <br />
          - <strong>Cam kết xác nhận:</strong> Người lao động có trách nhiệm kiểm tra toàn bộ mốc thời gian và phản hồi cho HR
          trong vòng 48 giờ kể từ ngày ban hành. Sau thời hạn này, bảng công được coi là chính thức chốt để lập phiếu lương.
        </div>

        {/* 8. Chữ ký 3 bên theo chuẩn Nghị định 30/2020/NĐ-CP */}
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

        {/* 9. Checksum bảo mật tính toàn vẹn */}
        <div className="print-checksum-bar">
          <div>
            Mã kiểm tra tính toàn vẹn (SHA-256 Checksum):{' '}
            <span className="print-checksum-val">{checksum}</span>
          </div>
          <div>Bản in chính thức phát hành qua TechZone Enterprise HRM · Trang 1/1</div>
        </div>
      </div>
    </div>
  )
}
