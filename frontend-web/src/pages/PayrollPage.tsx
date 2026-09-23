import { useState, useEffect } from 'react'
import { Icons } from '../components/common/Icons'
import { EmptyState } from '../components/common/EmptyState'
import { formatCurrency } from '../utils/formatters'
import type { Payroll } from '../types'

export interface PayrollPageProps {
  user: any
}

export function PayrollPage({ user: _user }: PayrollPageProps) {
  const [payrolls, setPayrolls] = useState<Payroll[]>([])
  const [selectedPeriod, setSelectedPeriod] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchPayrolls = async () => {
      setIsLoading(true)
      try {
        const { payrollApi } = await import('../services/api')
        const data = await payrollApi.getAll({ period: selectedPeriod })
        setPayrolls(data || [])
      } catch (err) {
        console.error('Error fetching payrolls:', err)
        setPayrolls([])
      } finally {
        setIsLoading(false)
      }
    }

    fetchPayrolls()
  }, [selectedPeriod])

  const currentPayroll = payrolls.find(p => p.salary_period === selectedPeriod)

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Lương & Thưởng</h1>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <select
            className="form-select"
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
            style={{ width: 'auto' }}
          >
            {Array.from({ length: 12 }, (_, i) => {
              const date = new Date()
              date.setMonth(date.getMonth() - i)
              const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
              return (
                <option key={value} value={value}>
                  Tháng {date.getMonth() + 1}/{date.getFullYear()}
                </option>
              )
            })}
          </select>
          <button className="btn btn-primary" onClick={() => window.print()}>
            {Icons.printer}
            In phiếu lương
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center', padding: '40px' }}>
            Đang tải dữ liệu...
          </div>
        </div>
      ) : currentPayroll ? (
        <>
          <div className="card" style={{ overflow: 'hidden', marginBottom: '24px' }}>
            <div className="payslip-header">
              <div className="payslip-company">TECHZONE - CÔNG TY TNHH TM DV TECH ZONE</div>
              <div className="payslip-period">PHIẾU LƯƠNG THÁNG {selectedPeriod.split('-')[1]}/{selectedPeriod.split('-')[0]}</div>
            </div>
            <div className="payslip-summary">
              <div className="payslip-summary-item">
                <div className="payslip-summary-label">Lương Gross</div>
                <div className="payslip-summary-value gross">{formatCurrency(currentPayroll.gross_income)}</div>
              </div>
              <div className="payslip-summary-item">
                <div className="payslip-summary-label">Khấu trừ</div>
                <div className="payslip-summary-value deduction">-{formatCurrency(currentPayroll.total_deduction)}</div>
              </div>
              <div className="payslip-summary-item">
                <div className="payslip-summary-label">Lương Net</div>
                <div className="payslip-summary-value net">{formatCurrency(currentPayroll.net_salary)}</div>
              </div>
            </div>
            <div className="payslip-details">
              <div className="payslip-section">
                <div className="payslip-section-title">Thu nhập</div>
                <div className="payslip-row">
                  <span className="payslip-row-label">Lương cơ bản</span>
                  <span className="payslip-row-value">{formatCurrency(currentPayroll.actual_base_salary)}</span>
                </div>
                <div className="payslip-row">
                  <span className="payslip-row-label">Phụ cấp chức vụ</span>
                  <span className="payslip-row-value">{formatCurrency(currentPayroll.position_allowance)}</span>
                </div>
                <div className="payslip-row">
                  <span className="payslip-row-label">Tăng ca (OT)</span>
                  <span className="payslip-row-value">{formatCurrency(currentPayroll.overtime_salary)}</span>
                </div>
                <div className="payslip-row">
                  <span className="payslip-row-label">Hoa hồng</span>
                  <span className="payslip-row-value">{formatCurrency(currentPayroll.commission_amount)}</span>
                </div>
                <div className="payslip-row">
                  <span className="payslip-row-label">Thưởng KPI</span>
                  <span className="payslip-row-value">{formatCurrency(currentPayroll.bonus_amount)}</span>
                </div>
                <div className="payslip-row total">
                  <span className="payslip-row-label">Tổng thu nhập</span>
                  <span className="payslip-row-value">{formatCurrency(currentPayroll.gross_income)}</span>
                </div>
              </div>

              <div className="payslip-section">
                <div className="payslip-section-title">Khấu trừ</div>
                <div className="payslip-row">
                  <span className="payslip-row-label">BHXH (8%)</span>
                  <span className="payslip-row-value">-{formatCurrency(currentPayroll.bhxh_amount)}</span>
                </div>
                <div className="payslip-row">
                  <span className="payslip-row-label">BHYT (1.5%)</span>
                  <span className="payslip-row-value">-{formatCurrency(currentPayroll.bhyt_amount)}</span>
                </div>
                <div className="payslip-row">
                  <span className="payslip-row-label">BHTN (1%)</span>
                  <span className="payslip-row-value">-{formatCurrency(currentPayroll.bhtn_amount)}</span>
                </div>
                <div className="payslip-row">
                  <span className="payslip-row-label">Thuế TNCN</span>
                  <span className="payslip-row-value">-{formatCurrency(currentPayroll.personal_income_tax)}</span>
                </div>
                <div className="payslip-row total">
                  <span className="payslip-row-label">Tổng khấu trừ</span>
                  <span className="payslip-row-value">-{formatCurrency(currentPayroll.total_deduction)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid-two-col">
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Chi tiết hoa hồng</h3>
              </div>
              <div className="card-body">
                <div className="payslip-row">
                  <span className="payslip-row-label">Điện thoại & Laptop</span>
                  <span className="payslip-row-value">{formatCurrency(0)}</span>
                </div>
                <div className="payslip-row">
                  <span className="payslip-row-label">Phụ kiện (3%)</span>
                  <span className="payslip-row-value">{formatCurrency(0)}</span>
                </div>
                <div className="payslip-row" style={{ borderTop: '1px solid var(--color-slate-200)', paddingTop: '12px', marginTop: '12px' }}>
                  <span className="payslip-row-label font-semibold">Tổng hoa hồng</span>
                  <span className="payslip-row-value font-semibold">{formatCurrency(currentPayroll.commission_amount)}</span>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Thưởng KPI</h3>
              </div>
              <div className="card-body">
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
                  <div style={{ flex: 1 }}>
                    <div className="text-sm text-slate-500" style={{ marginBottom: '4px' }}>Hoàn thành</div>
                    <div className="progress">
                      <div className="progress-bar green" style={{ width: '100%' }} />
                    </div>
                  </div>
                  <div className="text-xl font-bold text-green-600">100%</div>
                </div>
                <div className="alert alert-success">
                  {Icons.checkCircle}
                  <span>Thưởng: {formatCurrency(currentPayroll.bonus_amount)}</span>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="card">
          <EmptyState 
            icon={Icons.fileText} 
            title="Chưa có phiếu lương" 
            description={`Phiếu lương cho kỳ ${selectedPeriod} chưa được chốt. Vui lòng liên hệ Phòng Nhân sự.`}
          />
        </div>
      )}
    </div>
  )
}
