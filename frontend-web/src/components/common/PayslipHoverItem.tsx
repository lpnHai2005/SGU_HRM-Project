import { Icons } from './Icons'
import React, { useState, useEffect, useRef } from 'react'
import { formatCurrency, formatDate, formatTime } from '../../utils/formatters'
import type { PayrollTimeBreakdown, PayrollTimeSession } from '../../types'

// Khớp LATE_TOLERANCE_MINUTES mặc định của sp_generate_monthly_payroll.
const LATE_GRACE_MINUTES = 15

export interface LateAttendanceRecord {
  work_date: string
  shift_name?: string | null
  check_in_time?: string | null
  check_out_time?: string | null
  late_minutes?: number
  early_minutes?: number
}

export interface PayslipHoverItemProps {
  label: string
  tooltipTitle: string
  tooltipLines: {
    label: string
    value?: string
    isHighlight?: boolean
    color?: string
    isSub?: boolean
  }[]
  children?: React.ReactNode
}

export function PayslipHoverItem({ label, tooltipTitle, tooltipLines, children }: PayslipHoverItemProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [isPinned, setIsPinned] = useState(false)

  useEffect(() => {
    if (!isPinned) return
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setIsPinned(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsPinned(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isPinned])

  return (
    <div
      ref={wrapRef}
      className={`payslip-item-hover-wrap ${isPinned ? 'is-pinned' : ''}`}
      onClick={() => setIsPinned(prev => !prev)}
    >
      <span className="payslip-item-hover-label" title="Nhấp để ghim mở bảng chi tiết">{label}</span>
      <div className="payslip-item-tooltip-bridge" />
      <div
        className={`payslip-item-tooltip-box ${isPinned ? 'is-pinned' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="payslip-item-tooltip-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{tooltipTitle}</span>
          {isPinned ? (
            <button
              type="button"
              className="payslip-tooltip-close-btn"
              onClick={(e) => { e.stopPropagation(); setIsPinned(false); }}
              title="Đóng bảng ghim (Esc)"
              aria-label="Đóng"
            >
              {Icons.x}
            </button>
          ) : (
            <span className="payslip-tooltip-pin-hint">Nhấp để ghim</span>
          )}
        </div>
        <div className="payslip-item-tooltip-body">
          {tooltipLines.map((line, idx) => (
            <div
              key={idx}
              className={`payslip-item-tooltip-row ${line.isSub ? 'payslip-tooltip-subrow' : ''} ${line.isHighlight ? 'payslip-tooltip-highlight' : ''}`}
            >
              <span className="payslip-tooltip-row-label">{line.label}</span>
              {line.value && (
                <span
                  className="payslip-tooltip-row-val"
                  style={{ color: line.color, fontWeight: line.isHighlight ? 700 : 500 }}
                >
                  {line.value}
                </span>
              )}
            </div>
          ))}
          {children}
        </div>
      </div>
    </div>
  )
}

/** 31.55 → "31h33′"; 0.45 → "27 phút". */
function formatHM(hours: number | null | undefined): string {
  const total = Math.round((Number(hours) || 0) * 60)
  if (total < 60) return `${total} phút`
  const m = total % 60
  return `${Math.floor(total / 60)}h${m ? String(m).padStart(2, '0') + '′' : ''}`
}

/** "Có mặt 8h33′ − nghỉ 60′ = 7h33′ → thiếu 27 phút so với ca 8h" */
function sessionFormula(s: PayrollTimeSession, hourlyPrice: number): string {
  if (s.is_excluded) return 'HR loại phiên này → không tính công'
  if (s.payroll_hold) return 'Đang tạm giữ chờ giải trình → chưa tính công'
  if (!s.check_out_time) return 'Chưa check-out → chưa tính công'
  if (s.is_holiday) {
    const base = `Làm ngày Lễ${s.holiday_name ? ` (${s.holiday_name})` : ''}: không tính công thường; giờ ngoài ca tính qua OT 300% khi đã được duyệt`
    return s.ot_paid_hours > 0 ? `${base} (OT đã duyệt: ${formatHM(s.ot_paid_hours)})` : base
  }
  let f = `Có mặt ${formatHM(s.present_hours)}`
  if (s.break_deducted_hours > 0) f += ` − nghỉ giữa ca ${formatHM(s.break_deducted_hours)}`
  if (s.grace_credit_hours > 0) f += ` + ân hạn ${formatHM(s.grace_credit_hours)}`
  if (s.ot_paid_hours > 0) f += ` − OT đã duyệt ${formatHM(s.ot_paid_hours)} (trả riêng)`
  f += ` = ${formatHM(s.payable_hours + s.over_cap_hours)}`
  if (s.over_cap_hours > 0) f += ` → tính tối đa ${formatHM(s.shift_hours)}`
  return s.short_hours > 0
    ? `${f} → thiếu ${formatHM(s.short_hours)} (${s.short_hours}h) so với ca ${formatHM(s.shift_hours)}`
      + ` → ${s.short_hours}h × ${formatCurrency(hourlyPrice)}/h = -${formatCurrency(Math.round(s.short_hours * hourlyPrice))}`
    : `${f} → đủ giờ ca`
}

export function ActualBaseSalaryHoverItem({
  payroll,
  lateRecords = [],
  timeBreakdown = null
}: {
  payroll: any
  lateRecords?: LateAttendanceRecord[]
  timeBreakdown?: PayrollTimeBreakdown | null
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [isPinned, setIsPinned] = useState(false)

  useEffect(() => {
    if (!isPinned) return
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setIsPinned(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsPinned(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isPinned])

  if (!payroll) return <span>Lương cơ bản theo ngày công thực tế</span>

  const contractSalary = Number(payroll.contract_salary) || 0
  const stdDays = Number(payroll.standard_working_days) || 26
  const actDays = Number(payroll.actual_working_days) || 0
  const paidDays = Number(payroll.paid_leave_days) || 0
  const holidayDays = Number(payroll.holiday_paid_days) || 0
  const dailyPrice = stdDays > 0 ? Math.round(contractSalary / stdDays) : 0
  // Cùng đơn giá giờ với SP: lương HĐ ÷ công chuẩn ÷ định mức giờ/ngày của nhân viên.
  const hourlyPrice = stdDays > 0 ? Math.round(contractSalary / (stdDays * (Number(payroll.daily_standard_hours) || 8))) : 0

  const earnedWork = Math.round(actDays * dailyPrice)
  const earnedPaid = Math.round(paidDays * dailyPrice)
  const earnedHoliday = Math.round(holidayDays * dailyPrice)
  const totalEarned = earnedWork + earnedPaid + earnedHoliday

  const timeDed = Number(payroll.time_deduction_amount) || 0
  const actualBase = Number(payroll.actual_base_salary) || 0

  const unpaidDays = Number(payroll.unpaid_leave_days) || 0
  const absentDays = Number(payroll.absent_days) || 0
  const totalMissingDays = unpaidDays + absentDays

  const dailyHours = Number(payroll.daily_standard_hours) || 8
  const bd = timeBreakdown && timeBreakdown.payroll_id === payroll.payroll_id ? timeBreakdown : null
  const grace = bd?.late_tolerance_minutes ?? LATE_GRACE_MINUTES
  const sessions = bd?.sessions ?? []
  const lates = bd ? sessions.filter(s => s.late_minutes > 0) : (lateRecords || []).filter(r => (r.late_minutes || 0) > 0)
  const earlies = bd ? sessions.filter(s => s.early_minutes > 0) : (lateRecords || []).filter(r => (r.early_minutes || 0) > 0)
  const lateMinutes = lates.reduce((sum, r) => sum + (r.late_minutes || 0), 0)
  const earlyMinutes = earlies.reduce((sum, r) => sum + (r.early_minutes || 0), 0)
  const graceLates = lates.filter(r => (r.late_minutes || 0) <= grace).length
  const unworked = Number(payroll.unworked_hours) || 0
  // Giờ thiếu trong các ca có đi làm; phần còn lại của giờ thiếu là giờ của ngày không đi làm.
  const inShiftShort = bd ? bd.in_shift_short_hours : Math.max(0, Math.round((unworked - totalMissingDays * dailyHours) * 100) / 100)
  const inShiftMoney = Math.min(timeDed, Math.round(inShiftShort * hourlyPrice))
  const missingHours = Math.max(0, Math.round((unworked - inShiftShort) * 100) / 100)
  const missingMoney = timeDed - inShiftMoney
  const notable = sessions.filter(s => s.late_minutes > 0 || s.early_minutes > 0 || s.short_hours > 0
    || s.ot_paid_hours > 0 || s.is_excluded || s.payroll_hold || s.is_holiday)

  return (
    <div
      ref={wrapRef}
      className={`payslip-item-hover-wrap ${isPinned ? 'is-pinned' : ''}`}
      onClick={() => setIsPinned(prev => !prev)}
    >
      <span className="payslip-item-hover-label" title="Nhấp để ghim mở bảng giải trình">
        Lương cơ bản theo ngày công thực tế
      </span>
      <div className="payslip-item-tooltip-bridge" />
      <div
        className={`payslip-item-tooltip-box payslip-item-tooltip-large ${isPinned ? 'is-pinned' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="payslip-item-tooltip-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Chi tiết tính lương cơ bản thực tế</span>
          {isPinned ? (
            <button
              type="button"
              className="payslip-tooltip-close-btn"
              onClick={(e) => { e.stopPropagation(); setIsPinned(false); }}
              title="Đóng bảng giải trình (Esc)"
              aria-label="Đóng"
            >
              {Icons.x}
            </button>
          ) : (
            <span className="payslip-tooltip-pin-hint">Nhấp để ghim</span>
          )}
        </div>
        <div className="payslip-item-tooltip-body">
          {/* Mức 1: Định mức HĐ */}
          <div className="payslip-item-tooltip-row">
            <span className="payslip-tooltip-section-title">1. Định mức HĐ:</span>
          </div>
          <div className="payslip-item-tooltip-row payslip-tooltip-subrow">
            <span>{formatCurrency(contractSalary)} ÷ {stdDays} ngày chuẩn = {formatCurrency(dailyPrice)} đ/ngày ({formatCurrency(hourlyPrice)} đ/h)</span>
          </div>

          <div className="payslip-calc-tooltip-divider" />

          {/* Mức 2: Tiền công kiếm được trước khi trừ */}
          <div className="payslip-item-tooltip-row">
            <span className="payslip-tooltip-section-title">2. Tiền công kiếm được trước khi trừ:</span>
            <span className="payslip-tooltip-row-val" style={{ color: 'var(--status-success)', fontWeight: 700 }}>
              +{formatCurrency(totalEarned)}
            </span>
          </div>
          <div className="payslip-item-tooltip-row payslip-tooltip-subrow">
            <span>
              • Đi làm {actDays} ngày: +{formatCurrency(earnedWork)}
              {paidDays > 0 ? ` | Phép ${paidDays} ngày: +${formatCurrency(earnedPaid)}` : ''}
              {holidayDays > 0 ? ` | Nghỉ Lễ/Tết ${holidayDays} ngày: +${formatCurrency(earnedHoliday)}` : ''}
            </span>
          </div>

          <div className="payslip-calc-tooltip-divider" />

          {/* Mức 3: Khấu trừ thời gian trong tháng */}
          <div className="payslip-item-tooltip-row">
            <span className="payslip-tooltip-section-title">3. Khấu trừ thời gian trong tháng:</span>
            <span className="payslip-tooltip-row-val" style={{ color: timeDed > 0 ? 'var(--status-error)' : 'inherit', fontWeight: 700 }}>
              {timeDed > 0 ? `-${formatCurrency(timeDed)}` : '0 đ'}
            </span>
          </div>
          {timeDed > 0 ? (
            <div className="payslip-item-tooltip-row payslip-tooltip-subrow" style={{ color: 'var(--text-secondary, #52525b)', flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
              {bd && (
                <div>• Giờ phải làm: ({stdDays} ngày chuẩn − {paidDays} ngày phép{holidayDays > 0 ? ` − ${holidayDays} ngày Lễ` : ''}) × {dailyHours}h = <strong>{formatHM(bd.required_hours)}</strong></div>
              )}
              {bd && (
                <div>• Giờ được tính lương: <strong>{formatHM(bd.payable_hours)}</strong> (có mặt {formatHM(bd.present_hours)}; đã trừ nghỉ giữa ca, cộng phút trễ trong ân hạn, mỗi ca tính tối đa bằng giờ ca)</div>
              )}
              <div>• Giờ thiếu: <strong>{formatHM(unworked)} ({unworked}h)</strong> × {formatCurrency(hourlyPrice)}/h = <strong>-{formatCurrency(timeDed)}</strong>, gồm:</div>
              <div style={{ paddingLeft: '12px' }}>– Ngày không đi làm ({totalMissingDays} ngày): {formatHM(missingHours)} ({missingHours}h) × {formatCurrency(hourlyPrice)}/h = <strong>-{formatCurrency(missingMoney)}</strong></div>
              <div style={{ paddingLeft: '12px' }}>– Thiếu giờ trong các ca có đi làm: {formatHM(inShiftShort)} ({inShiftShort}h) × {formatCurrency(hourlyPrice)}/h = <strong>-{formatCurrency(inShiftMoney)}</strong></div>
              <div>
                • Đi trễ: {lateMinutes} phút ({lates.length} lần)
                {graceLates > 0 && ` — ${graceLates} lần trong ân hạn ${grace}′ được bù, không trừ`}
                {lates.length - graceLates > 0 && ` — ${lates.length - graceLates} lần quá ân hạn: trừ giờ + phạt riêng`}
              </div>
              <div>• Về sớm: {earlyMinutes} phút ({earlies.length} lần)</div>
              <div style={{ fontSize: '11px', fontStyle: 'italic' }}>
                Tiền trừ tính theo giờ thiếu của từng ca, không theo tổng phút trễ/sớm: đến sớm hoặc ở lại muộn trong cùng ca được bù, phút trễ trong ân hạn được cộng lại.
              </div>

              {notable.length > 0 && (
                <div className="payslip-tooltip-late-box">
                  <div className="payslip-tooltip-late-header">
                    <span>Chi tiết các ca có trễ/sớm/thiếu giờ:</span>
                    <span className="payslip-tooltip-late-badge">{notable.length} ca</span>
                  </div>
                  <div className="payslip-tooltip-late-list" style={{ maxHeight: '220px' }}>
                    {notable.map(s => (
                      <div key={s.attendance_id} className="payslip-tooltip-late-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '2px' }}>
                        <span className="payslip-tooltip-late-date">
                          • <strong>{formatDate(s.work_date)}</strong> · {s.shift_name || 'Ca làm việc'}
                          {s.scheduled_start && s.scheduled_end ? ` ${s.scheduled_start}–${s.scheduled_end}` : ''}
                          {' '}· vào {formatTime(s.check_in_time)} – ra {formatTime(s.check_out_time)}
                        </span>
                        {s.late_minutes > 0 && (
                          <span>
                            Đi trễ {s.late_minutes} phút {s.late_minutes <= grace ? `(trong ân hạn ${grace}′ → được bù, không trừ)` : `(quá ân hạn ${grace}′ → trừ giờ + phạt)`}
                          </span>
                        )}
                        {s.early_minutes > 0 && <span>Về sớm {s.early_minutes} phút</span>}
                        <span className="payslip-tooltip-late-val">{sessionFormula(s, hourlyPrice)}</span>
                      </div>
                    ))}
                  </div>
                  {sessions.length > notable.length && (
                    <div style={{ fontSize: '11px', marginTop: '4px' }}>{sessions.length - notable.length} ca còn lại đủ giờ, không bị trừ.</div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="payslip-item-tooltip-row payslip-tooltip-subrow" style={{ color: 'var(--text-secondary, #52525b)' }}>
              <span>• Đi làm đầy đủ, không phát sinh vắng mặt hay trễ/sớm</span>
            </div>
          )}

          <div className="payslip-calc-tooltip-divider" />

          {/* Mức 4: Lương cơ bản thực nhận */}
          <div className="payslip-item-tooltip-row payslip-tooltip-highlight">
            <span className="payslip-tooltip-section-title" style={{ color: 'var(--text-primary)' }}>
              4. Lương cơ bản thực nhận (chặn dưới 0):
            </span>
            <span
              className="payslip-tooltip-row-val"
              style={{
                color: actualBase > 0 ? 'var(--status-success)' : 'var(--status-error)',
                fontSize: '12px',
                fontWeight: 700,
              }}
            >
              {actualBase > 0 ? `+${formatCurrency(actualBase)}` : formatCurrency(0)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
