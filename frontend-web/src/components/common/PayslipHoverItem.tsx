import React, { useState, useEffect, useRef } from 'react'
import { formatCurrency, formatDate } from '../../utils/formatters'

export interface LateAttendanceRecord {
  work_date: string
  shift_name?: string | null
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
              ✕
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

export function ActualBaseSalaryHoverItem({
  payroll,
  lateRecords = []
}: {
  payroll: any
  lateRecords?: LateAttendanceRecord[]
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
  const dailyPrice = stdDays > 0 ? Math.round(contractSalary / stdDays) : 0
  const hourlyPrice = stdDays > 0 ? Math.round(contractSalary / (stdDays * 8)) : 0

  const earnedWork = Math.round(actDays * dailyPrice)
  const earnedPaid = Math.round(paidDays * dailyPrice)
  const totalEarned = earnedWork + earnedPaid

  const timeDed = Number(payroll.time_deduction_amount) || 0
  const actualBase = Number(payroll.actual_base_salary) || 0

  const unpaidDays = Number(payroll.unpaid_leave_days) || 0
  const absentDays = Number(payroll.absent_days) || 0
  const totalMissingDays = unpaidDays + absentDays
  const missingSalary = Math.round(totalMissingDays * dailyPrice)
  const lateEarlySalary = Math.max(0, timeDed - missingSalary)

  const lates = (lateRecords || []).filter(r => (r.late_minutes || 0) > 0)
  const lateMinutes = Number(payroll.attendance_late_minutes) || Number(payroll.late_minutes) || lates.reduce((sum, r) => sum + (r.late_minutes || 0), 0)

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
              ✕
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
            <span className="payslip-tooltip-row-val" style={{ color: '#10b981', fontWeight: 700 }}>
              +{formatCurrency(totalEarned)}
            </span>
          </div>
          <div className="payslip-item-tooltip-row payslip-tooltip-subrow">
            <span>• Đi làm {actDays} ngày: +{formatCurrency(earnedWork)} {paidDays > 0 ? `| Phép ${paidDays} ngày: +${formatCurrency(earnedPaid)}` : ''}</span>
          </div>

          <div className="payslip-calc-tooltip-divider" />

          {/* Mức 3: Khấu trừ thời gian trong tháng */}
          <div className="payslip-item-tooltip-row">
            <span className="payslip-tooltip-section-title">3. Khấu trừ thời gian trong tháng:</span>
            <span className="payslip-tooltip-row-val" style={{ color: timeDed > 0 ? '#ef4444' : 'inherit', fontWeight: 700 }}>
              {timeDed > 0 ? `-${formatCurrency(timeDed)}` : '0 đ'}
            </span>
          </div>
          {timeDed > 0 ? (
            <div className="payslip-item-tooltip-row payslip-tooltip-subrow" style={{ color: 'var(--text-secondary, #52525b)', flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
              <div>• Nghỉ/vắng {totalMissingDays} ngày: -{formatCurrency(missingSalary)}</div>
              <div>• Trễ/sớm {lateMinutes > 0 ? `${lateMinutes} phút` : ''}: -{formatCurrency(lateEarlySalary)} {lates.length > 0 ? `(${lates.length} lần đi trễ)` : ''}</div>
              
              {lates.length > 0 && (
                <div className="payslip-tooltip-late-box">
                  <div className="payslip-tooltip-late-header">
                    <span>Chi tiết các ca đi trễ:</span>
                    <span className="payslip-tooltip-late-badge">{lates.length} lần</span>
                  </div>
                  <div className="payslip-tooltip-late-list">
                    {lates.map((item, idx) => (
                      <div key={idx} className="payslip-tooltip-late-row">
                        <span className="payslip-tooltip-late-date">
                          • Ngày <strong>{formatDate(item.work_date)}</strong> ({item.shift_name || 'Ca làm việc'}):
                        </span>
                        <span className="payslip-tooltip-late-val">
                          Trễ {item.late_minutes} phút
                        </span>
                      </div>
                    ))}
                  </div>
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
                color: actualBase > 0 ? '#10b981' : '#ef4444',
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
