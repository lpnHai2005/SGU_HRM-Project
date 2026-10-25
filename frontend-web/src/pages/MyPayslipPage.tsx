import { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import { Icons } from '../components/common/Icons'
import { StatCard } from '../components/common/StatCard'
import { EmptyState } from '../components/common/EmptyState'
import { formatCurrency, formatDate } from '../utils/formatters'
import type { Payroll, Contract } from '../types'
import { payrollApi, employeeApi } from '../services/api'
import { toast } from 'sonner'
import { MonthPicker } from '../components/common/MonthPicker'
import './PayslipPrint.css'
import { PayrollRegulationDialog } from './PayrollRegulationDialog'

export interface MyPayslipPageProps {
  user?: any
  employeeId?: number
  initialTab?: 'monthly' | 'annual' | 'contracts'
}

function getStatusBadgeClass(status?: string): string {
  switch (status) {
    case 'NEEDS_RECALCULATION':
      return 'badge-needs-recalculation'
    case 'PAID':
      return 'badge-paid'
    case 'CONFIRMED':
      return 'badge-confirmed'
    case 'ACTIVE':
      return 'badge-paid'
    case 'EXPIRED':
      return 'badge-draft'
    case 'TERMINATED':
      return 'badge-needs-recalculation'
    case 'DRAFT':
    default:
      return 'badge-draft'
  }
}

function getStatusLabel(status?: string): string {
  switch (status) {
    case 'NEEDS_RECALCULATION':
      return 'Cần tính lại'
    case 'PAID':
      return 'Đã chi trả'
    case 'CONFIRMED':
      return 'Đã duyệt'
    case 'ACTIVE':
      return 'Đang hiệu lực'
    case 'EXPIRED':
      return 'Đã hết hạn'
    case 'TERMINATED':
      return 'Đã chấm dứt'
    case 'DRAFT':
    default:
      return 'Bản nháp'
  }
}

function parsePrintDate(dateStr?: string) {
  if (dateStr) {
    if (dateStr.includes('/')) {
      const parts = dateStr.split('/')
      if (parts.length === 3) {
        return { day: parts[0], month: parts[1], year: parts[2] }
      }
    } else if (dateStr.includes('-')) {
      const parts = dateStr.split('-')
      if (parts.length === 3) {
        return { day: parts[2], month: parts[1], year: parts[0] }
      }
    }
  }
  const now = new Date()
  return {
    day: String(now.getDate()).padStart(2, '0'),
    month: String(now.getMonth() + 1).padStart(2, '0'),
    year: String(now.getFullYear()),
  }
}

export function MyPayslipPage({ user, employeeId, initialTab = 'monthly' }: MyPayslipPageProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab') as 'monthly' | 'annual' | 'contracts' | null

  // Active Tab
  const [activeTab, setActiveTab] = useState<'monthly' | 'annual' | 'contracts'>(() => {
    if (tabParam && ['monthly', 'annual', 'contracts'].includes(tabParam)) return tabParam
    return initialTab
  })

  // Sync tab change with searchParams
  const handleTabChange = (tab: 'monthly' | 'annual' | 'contracts') => {
    setActiveTab(tab)
    setSearchParams({ tab })
  }

  const currentEmpId = employeeId || user?.employee_id

  // Period / Year Filters
  const [selectedPeriod, setSelectedPeriod] = useState<string>(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [selectedYear, setSelectedYear] = useState<string>(() => String(new Date().getFullYear()))

  // Monthly State
  const [monthlyRecords, setMonthlyRecords] = useState<Payroll[]>([])
  const [monthlyLoading, setMonthlyLoading] = useState(false)
  const [monthlyPrintData, setMonthlyPrintData] = useState<any>(null)
  const [isMonthlyPrintModalOpen, setIsMonthlyPrintModalOpen] = useState(false)
  const [printLoading, setPrintLoading] = useState(false)

  // Annual State
  const [annualData, setAnnualData] = useState<any>(null)
  const [annualLoading, setAnnualLoading] = useState(false)
  const [isAnnualPrintModalOpen, setIsAnnualPrintModalOpen] = useState(false)

  // Contracts State
  const [contracts, setContracts] = useState<Contract[]>([])
  const [contractsLoading, setContractsLoading] = useState(false)
  const [contractQuery, setContractQuery] = useState('')
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null)
  const [isContractPrintModalOpen, setIsContractPrintModalOpen] = useState(false)
  const [isPayrollRegulationOpen, setIsPayrollRegulationOpen] = useState(false)

  // 1. Fetch Monthly Payrolls
  const fetchMonthlyData = useCallback(async () => {
    if (!currentEmpId) return
    setMonthlyLoading(true)
    try {
      const summary = await payrollApi.getAnnualSummary(currentEmpId, selectedYear)
      const released = (summary.monthly_records || []).filter(
        (row: Payroll) => ['CONFIRMED', 'PAID'].includes(row.payment_status || '')
      )
      setMonthlyRecords(released)
    } catch (err: any) {
      console.error('Error fetching monthly records:', err)
      toast.error(err.message || 'Không thể tải phiếu lương cá nhân')
    } finally {
      setMonthlyLoading(false)
    }
  }, [currentEmpId, selectedYear])

  // 2. Fetch Annual Summary
  const fetchAnnualSummary = useCallback(async () => {
    if (!currentEmpId) return
    setAnnualLoading(true)
    try {
      const data = await payrollApi.getAnnualSummary(currentEmpId, selectedYear)
      setAnnualData(data)
    } catch (err: any) {
      console.error('Error fetching annual summary:', err)
      toast.error(err.message || 'Không thể tải bảng lương năm')
    } finally {
      setAnnualLoading(false)
    }
  }, [currentEmpId, selectedYear])

  // 3. Fetch Contracts
  const fetchContracts = useCallback(async () => {
    if (!currentEmpId) return
    setContractsLoading(true)
    try {
      const data = await employeeApi.getContracts(currentEmpId)
      setContracts(data || [])
    } catch (err: any) {
      console.error('Error fetching contracts:', err)
      toast.error(err.message || 'Không thể tải danh sách hợp đồng')
    } finally {
      setContractsLoading(false)
    }
  }, [currentEmpId])

  useEffect(() => {
    fetchMonthlyData()
    fetchAnnualSummary()
    fetchContracts()
  }, [fetchMonthlyData, fetchAnnualSummary, fetchContracts])

  // Current selected month's payroll record
  const currentPayroll = useMemo(() => {
    return monthlyRecords.find(p => p.salary_period === selectedPeriod) || null
  }, [monthlyRecords, selectedPeriod])

  // Active Contract
  const activeContract = useMemo(() => {
    return contracts.find(c => c.status === 'ACTIVE') || contracts[0] || null
  }, [contracts])

  // Filtered Contracts
  const filteredContracts = useMemo(() => {
    if (!contractQuery.trim()) return contracts
    const q = contractQuery.toLowerCase()
    return contracts.filter(c =>
      (c.contract_number || '').toLowerCase().includes(q) ||
      (c.contract_type || '').toLowerCase().includes(q) ||
      (c.status || '').toLowerCase().includes(q)
    )
  }, [contracts, contractQuery])

  // Open Monthly Print Modal
  const handleOpenMonthlyPrint = async (payroll: Payroll) => {
    setPrintLoading(true)
    try {
      const printData = await payrollApi.getPayslip(payroll.payroll_id)
      setMonthlyPrintData(printData)
      setIsMonthlyPrintModalOpen(true)
    } catch (err: any) {
      console.error('Error opening monthly print modal:', err)
      toast.error(err.message || 'Không thể tải bản in phiếu lương')
    } finally {
      setPrintLoading(false)
    }
  }

  // Open Annual Print Modal
  const handleOpenAnnualPrint = () => {
    if (!annualData) {
      toast.error('Chưa có dữ liệu bảng lương năm')
      return
    }
    setIsAnnualPrintModalOpen(true)
  }

  // Open Contract Print Modal
  const handleOpenContractPrint = (contract: Contract) => {
    setSelectedContract(contract)
    setIsContractPrintModalOpen(true)
  }

  if (!currentEmpId) {
    return (
      <div className="page-container">
        <div className="card" style={{ padding: '48px', textAlign: 'center' }}>
          <EmptyState
            icon={Icons.shield}
            title="Tài khoản chưa liên kết hồ sơ nhân sự"
            description="Tài khoản của bạn chưa được liên kết với mã nhân viên trong hệ thống TechZone để tra cứu lương và hợp đồng. Vui lòng liên hệ Quản trị viên (Admin) hoặc Trưởng phòng Nhân sự."
          />
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      {/* ========================================================================= */}
      {/* 1. PAGE HEADER & SEGMENTED TABS */}
      {/* ========================================================================= */}
      <div className="page-header no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>
            <span>TechZone</span>
            <span>›</span>
            <span>Cá Nhân</span>
            <span>›</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Thu Nhập & Hợp Đồng</span>
          </div>
          <h1 className="page-title" style={{ margin: 0 }}>Thu Nhập & Hợp Đồng Của Tôi</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px', margin: 0 }}>
            Tra cứu phiếu lương tháng, tổng hợp quyết toán thuế năm và hợp đồng lao động chính thức
          </p>
        </div>

        {/* 3 Centered Balanced Segmented Tabs */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div className="payroll-segmented-tabs" style={{ margin: 0 }}>
            <button
              type="button"
              className={`payroll-tab-button ${activeTab === 'monthly' ? 'active' : ''}`}
              onClick={() => handleTabChange('monthly')}
            >
              {Icons.calendar}
              <span>Bảng Lương Tháng</span>
            </button>
            <button
              type="button"
              className={`payroll-tab-button ${activeTab === 'annual' ? 'active' : ''}`}
              onClick={() => handleTabChange('annual')}
            >
              {Icons.chart}
              <span>Bảng Lương Năm</span>
            </button>
            <button
              type="button"
              className={`payroll-tab-button ${activeTab === 'contracts' ? 'active' : ''}`}
              onClick={() => handleTabChange('contracts')}
            >
              {Icons.fileText}
              <span>Hợp Đồng Lao Động</span>
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: BẢNG LƯƠNG THÁNG (MONTHLY) */}
      {/* ========================================================================= */}
      {activeTab === 'monthly' && (
        <div className="no-print" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Sub Toolbar: Month Selector & Sync Note */}
          <div className="card" style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <MonthPicker
                value={selectedPeriod}
                label="Kỳ tính lương"
                onChange={(value) => {
                  setSelectedPeriod(value)
                  setSelectedYear(value.slice(0, 4))
                }}
              />

              <span style={{ fontSize: '12.5px', color: 'var(--text-tertiary)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: 'var(--status-success)' }}></span>
                Dữ liệu đồng bộ trực tiếp từ chấm công & đơn nghỉ phép
              </span>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                type="button"
                className="btn-info-icon"
                onClick={() => setIsPayrollRegulationOpen(true)}
                title="Xem quy chế & công thức tính lương TechZone Retail"
                aria-label="Xem quy chế tính lương"
              >
                <span style={{ fontStyle: 'italic', fontWeight: 700, fontFamily: 'serif', fontSize: '15px' }}>i</span>
              </button>
              {currentPayroll && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleOpenMonthlyPrint(currentPayroll)}
                  disabled={printLoading}
                >
                  {Icons.printer}
                  <span>{printLoading ? 'Đang mở...' : 'In Phiếu Lương (PDF)'}</span>
                </button>
              )}
            </div>
          </div>

          {/* 4 Stat Cards for Selected Month */}
          <div className="stat-grid-4">
            <StatCard
              icon={Icons.wallet}
              iconColor="blue"
              label="LƯƠNG CƠ BẢN THỰC TẾ"
              value={formatCurrency(currentPayroll?.actual_base_salary ?? 0)}
              footerNote={`Công chuẩn: ${currentPayroll?.standard_working_days ?? 26} · Làm: ${currentPayroll?.actual_working_days ?? 0} ngày`}
            />
            <StatCard
              icon={Icons.trendingUp}
              iconColor="green"
              label="TỔNG THU NHẬP (GROSS)"
              value={formatCurrency(currentPayroll?.gross_income ?? 0)}
              footerNote="Bao gồm phụ cấp, hoa hồng, OT & thưởng"
            />
            <StatCard
              icon={Icons.shield}
              iconColor="amber"
              label="BẢO HIỂM & KHẤU TRỪ"
              value={currentPayroll ? `-${formatCurrency(currentPayroll.total_deduction)}` : '0 VNĐ'}
              footerNote="BHXH 8%, BHYT 1.5%, BHTN 1% & giảm trừ"
            />
            <StatCard
              icon={Icons.dollar}
              iconColor="green"
              label="THỰC LĨNH CHUYỂN KHOẢN (NET)"
              value={formatCurrency(currentPayroll?.net_salary ?? 0)}
              footerNote={
                currentPayroll
                  ? `Trạng thái: ${getStatusLabel(currentPayroll.payment_status)}`
                  : 'Chưa có phiếu lương kỳ này'
              }
            />
          </div>

          {/* Current Month Detail View */}
          {monthlyLoading ? (
            <div className="card" style={{ padding: '48px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Đang tải dữ liệu phiếu lương...
            </div>
          ) : currentPayroll ? (
            <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Header Info */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '16px' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700 }}>
                    Chi Tiết Phiếu Lương Kỳ {currentPayroll.salary_period}
                  </h3>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    Nhân viên: <strong>{currentPayroll.employee_name || user?.full_name}</strong> ({currentPayroll.employee_code || user?.username}) · Vị trí: <strong>{currentPayroll.position_name || 'Nhân viên'}</strong>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span className={`badge-status ${getStatusBadgeClass(currentPayroll.payment_status)}`}>
                    {getStatusLabel(currentPayroll.payment_status)}
                  </span>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleOpenMonthlyPrint(currentPayroll)}
                  >
                    {Icons.printer}
                    Xem bản in A4
                  </button>
                </div>
              </div>

              {/* Attendance Summary Callout */}
              <div style={{ background: 'var(--surface-subtle)', padding: '14px 18px', borderRadius: '8px', border: '1px solid var(--border-default)', fontSize: '13px' }}>
                <div style={{ fontWeight: 700, fontSize: '12px', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '8px', letterSpacing: '0.5px' }}>
                  Thống kê ngày công & thời gian làm việc (Đồng bộ hệ thống)
                </div>
                <div style={{ display: 'flex', gap: '14px 24px', flexWrap: 'wrap' }}>
                  <div>Công chuẩn: <strong>{currentPayroll.standard_working_days ?? 26}</strong> ngày</div>
                  <div>Công thực tế: <strong style={{ color: 'var(--status-success)' }}>{currentPayroll.actual_working_days ?? 0}</strong> ngày</div>
                  <div>Nghỉ phép có lương: <strong>{currentPayroll.paid_leave_days ?? 0}</strong> ngày</div>
                  <div>Nghỉ không lương: <strong style={{ color: (currentPayroll.unpaid_leave_days || 0) > 0 ? 'var(--status-error)' : 'inherit' }}>{currentPayroll.unpaid_leave_days ?? 0}</strong> ngày</div>
                  {(currentPayroll.unworked_hours || 0) > 0 && (
                    <div>Giờ trễ/thiếu: <strong style={{ color: 'var(--status-error)' }}>{currentPayroll.unworked_hours} giờ</strong></div>
                  )}
                  {(currentPayroll.overtime_salary || 0) > 0 && (
                    <div>Lương làm thêm giờ (OT): <strong style={{ color: 'var(--text-primary)' }}>{formatCurrency(currentPayroll.overtime_salary)}</strong></div>
                  )}
                </div>
              </div>

              {/* 2-Column Earnings & Deductions Breakdown */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
                {/* I. Thu nhập Gross */}
                <div style={{ border: '1px solid var(--border-default)', borderRadius: '8px', overflow: 'hidden' }}>
                  <div style={{ padding: '12px 16px', background: 'var(--surface-subtle)', fontWeight: 700, fontSize: '13.5px', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-default)' }}>
                    I. CÁC KHOẢN THU NHẬP (GROSS)
                  </div>
                  <table className="table" style={{ width: '100%', fontSize: '13px', margin: 0 }}>
                    <tbody>
                      <tr>
                        <td style={{ padding: '10px 14px' }}>Lương cơ bản theo ngày công thực tế</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                          {formatCurrency(currentPayroll.actual_base_salary)}
                        </td>
                      </tr>
                      {(currentPayroll.position_allowance || 0) > 0 && (
                        <tr>
                          <td style={{ padding: '10px 14px' }}>Phụ cấp chức vụ</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                            {formatCurrency(currentPayroll.position_allowance)}
                          </td>
                        </tr>
                      )}
                      {(currentPayroll.seniority_allowance || 0) > 0 && (
                        <tr>
                          <td style={{ padding: '10px 14px' }}>Phụ cấp thâm niên</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                            {formatCurrency(currentPayroll.seniority_allowance)}
                          </td>
                        </tr>
                      )}
                      {(currentPayroll.project_allowance || 0) > 0 && (
                        <tr>
                          <td style={{ padding: '10px 14px' }}>Phụ cấp dự án</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                            {formatCurrency(currentPayroll.project_allowance)}
                          </td>
                        </tr>
                      )}
                      {(currentPayroll.meal_transport_allowance || 0) > 0 && (
                        <tr>
                          <td style={{ padding: '10px 14px' }}>Phụ cấp ăn trưa & đi lại</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                            {formatCurrency(currentPayroll.meal_transport_allowance)}
                          </td>
                        </tr>
                      )}
                      {(currentPayroll.commission_amount || 0) > 0 && (
                        <tr>
                          <td style={{ padding: '10px 14px' }}>Hoa hồng doanh số bán hàng</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                            {formatCurrency(currentPayroll.commission_amount)}
                          </td>
                        </tr>
                      )}
                      {(currentPayroll.overtime_salary || 0) > 0 && (
                        <tr>
                          <td style={{ padding: '10px 14px' }}>Tiền làm thêm giờ (OT)</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                            {formatCurrency(currentPayroll.overtime_salary)}
                          </td>
                        </tr>
                      )}
                      {(currentPayroll.bonus_amount || 0) > 0 && (
                        <tr>
                          <td style={{ padding: '10px 14px' }}>Thưởng hiệu quả / năng suất</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                            {formatCurrency(currentPayroll.bonus_amount)}
                          </td>
                        </tr>
                      )}
                      <tr style={{ background: 'var(--surface-subtle)', fontWeight: 700 }}>
                        <td style={{ padding: '10px 14px' }}>TỔNG THU NHẬP (GROSS)</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '14px', color: 'var(--text-primary)' }}>
                          {formatCurrency(currentPayroll.gross_income)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* II. Khấu trừ Deductions */}
                <div style={{ border: '1px solid var(--border-default)', borderRadius: '8px', overflow: 'hidden' }}>
                  <div style={{ padding: '12px 16px', background: 'var(--surface-subtle)', fontWeight: 700, fontSize: '13.5px', color: 'var(--status-error)', borderBottom: '1px solid var(--border-default)' }}>
                    II. CÁC KHOẢN GIẢM TRỪ (DEDUCTIONS)
                  </div>
                  <table className="table" style={{ width: '100%', fontSize: '13px', margin: 0 }}>
                    <tbody>
                      <tr>
                        <td style={{ padding: '10px 14px' }}>Bảo hiểm Xã hội (BHXH 8%)</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--status-error)' }}>
                          -{formatCurrency(currentPayroll.bhxh_amount)}
                        </td>
                      </tr>
                      <tr>
                        <td style={{ padding: '10px 14px' }}>Bảo hiểm Y tế (BHYT 1.5%)</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--status-error)' }}>
                          -{formatCurrency(currentPayroll.bhyt_amount)}
                        </td>
                      </tr>
                      <tr>
                        <td style={{ padding: '10px 14px' }}>Bảo hiểm Thất nghiệp (BHTN 1%)</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--status-error)' }}>
                          -{formatCurrency(currentPayroll.bhtn_amount)}
                        </td>
                      </tr>
                      {(currentPayroll.personal_income_tax || 0) > 0 && (
                        <tr>
                          <td style={{ padding: '10px 14px' }}>Thuế thu nhập cá nhân (TNCN)</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--status-error)' }}>
                            -{formatCurrency(currentPayroll.personal_income_tax)}
                          </td>
                        </tr>
                      )}
                      {(currentPayroll.time_deduction_amount || 0) > 0 && (
                        <tr>
                          <td style={{ padding: '10px 14px' }}>Giảm trừ đi trễ / về sớm</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--status-error)' }}>
                            -{formatCurrency(currentPayroll.time_deduction_amount)}
                          </td>
                        </tr>
                      )}
                      {(currentPayroll.penalty_deduction || 0) > 0 && (
                        <tr>
                          <td style={{ padding: '10px 14px' }}>Khấu trừ khác / Phạt vi phạm</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--status-error)' }}>
                            -{formatCurrency(currentPayroll.penalty_deduction)}
                          </td>
                        </tr>
                      )}
                      <tr style={{ background: 'var(--surface-subtle)', fontWeight: 700 }}>
                        <td style={{ padding: '10px 14px' }}>TỔNG GIẢM TRỪ</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '14px', color: 'var(--status-error)' }}>
                          -{formatCurrency(currentPayroll.total_deduction)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Net Highlight Box */}
              <div style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '8px', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--status-success)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    THỰC LĨNH CHUYỂN KHOẢN (NET)
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    Số tiền thực tế nhận qua tài khoản ngân hàng sau khi trích nộp bảo hiểm và thuế
                  </div>
                </div>
                <div style={{ fontSize: '26px', fontWeight: 900, color: 'var(--status-success)', fontFamily: 'var(--font-mono)' }}>
                  {formatCurrency(currentPayroll.net_salary)}
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleOpenMonthlyPrint(currentPayroll)}
                  style={{ padding: '10px 24px', fontSize: '14px' }}
                >
                  {Icons.printer}
                  Xem Chi Tiết & In Phiếu Lương (PDF)
                </button>
                <button
                  type="button"
                  className="btn-info-icon"
                  onClick={() => setIsPayrollRegulationOpen(true)}
                  title="Xem quy chế & công thức tính lương TechZone Retail"
                  aria-label="Xem quy chế tính lương"
                  style={{ width: '40px', height: '40px' }}
                >
                  <span style={{ fontStyle: 'italic', fontWeight: 700, fontFamily: 'serif', fontSize: '16px' }}>i</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="card" style={{ padding: '48px', textAlign: 'center' }}>
              <EmptyState
                icon={Icons.calendar}
                title="Chưa có phiếu lương cho kỳ này"
                description={`Chưa có dữ liệu bảng lương đã duyệt cho kỳ ${selectedPeriod}. Phiếu lương sẽ tự động hiển thị sau khi Ban Giám Đốc và Phòng Nhân sự duyệt chính thức.`}
              />
            </div>
          )}

          {/* Historical Released Payrolls Table */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="card-title" style={{ margin: 0, fontSize: '15px' }}>
                Lịch Sử Các Kỳ Lương Đã Phát Hành Năm {selectedYear}
              </h3>
              <span style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                {monthlyRecords.length} kỳ lương được phát hành
              </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', whiteSpace: 'nowrap' }}>
                <thead>
                  <tr style={{ background: 'var(--surface-subtle)', borderBottom: '1px solid var(--border-default)' }}>
                    <th style={{ padding: '12px 14px' }}>Kỳ lương</th>
                    <th style={{ padding: '12px 10px', textAlign: 'center' }}>Công chuẩn / làm</th>
                    <th style={{ padding: '12px 12px', textAlign: 'right' }}>Lương CB thực tế</th>
                    <th style={{ padding: '12px 12px', textAlign: 'right', fontWeight: 700 }}>Tổng Gross</th>
                    <th style={{ padding: '12px 12px', textAlign: 'right' }}>Khấu trừ</th>
                    <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 800, color: 'var(--status-success)' }}>THỰC LĨNH NET</th>
                    <th style={{ padding: '12px 10px', textAlign: 'center' }}>Trạng thái</th>
                    <th style={{ padding: '12px 14px', textAlign: 'center' }}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyRecords.length > 0 ? (
                    monthlyRecords.map((p) => (
                      <tr key={p.payroll_id} style={{ borderBottom: '1px solid var(--border-subtle)', background: p.salary_period === selectedPeriod ? 'var(--surface-subtle)' : 'transparent' }}>
                        <td style={{ padding: '12px 14px', fontWeight: 600 }}>
                          {p.salary_period ? `Tháng ${parseInt(p.salary_period.split('-')[1], 10)}/${p.salary_period.split('-')[0]}` : p.salary_period}
                        </td>
                        <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                          {p.actual_working_days ?? 0} / {p.standard_working_days ?? 26}
                        </td>
                        <td style={{ padding: '12px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                          {formatCurrency(p.actual_base_salary)}
                        </td>
                        <td style={{ padding: '12px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                          {formatCurrency(p.gross_income)}
                        </td>
                        <td style={{ padding: '12px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--status-error)' }}>
                          -{formatCurrency(p.total_deduction)}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--status-success)', fontSize: '13.5px' }}>
                          {formatCurrency(p.net_salary)}
                        </td>
                        <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                          <span className={`badge-status ${getStatusBadgeClass(p.payment_status)}`}>
                            {getStatusLabel(p.payment_status)}
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                          <div style={{ display: 'inline-flex', gap: '6px' }}>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => setSelectedPeriod(p.salary_period)}
                              title="Xem chi tiết kỳ này"
                            >
                              {Icons.eye}
                              Xem
                            </button>
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => handleOpenMonthlyPrint(p)}
                              title="In phiếu lương A4 PDF"
                            >
                              {Icons.printer}
                              In PDF
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} style={{ padding: '36px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        Chưa có phiếu lương chính thức nào được duyệt trong năm {selectedYear}.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: BẢNG LƯƠNG NĂM (ANNUAL SUMMARY) */}
      {/* ========================================================================= */}
      {activeTab === 'annual' && (
        <div className="no-print" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Annual Controls Toolbar */}
          <div className="card" style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span className="text-secondary" style={{ fontSize: '13px', fontWeight: 600 }}>Năm quyết toán:</span>
              <select
                className="form-select"
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                style={{ width: 'auto', minWidth: '120px' }}
              >
                {['2026', '2025', '2024'].map(yr => (
                  <option key={yr} value={yr}>Năm {yr}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                type="button"
                className="btn-info-icon"
                onClick={() => setIsPayrollRegulationOpen(true)}
                title="Xem quy chế & công thức tính lương TechZone Retail"
                aria-label="Xem quy chế tính lương"
              >
                <span style={{ fontStyle: 'italic', fontWeight: 700, fontFamily: 'serif', fontSize: '15px' }}>i</span>
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleOpenAnnualPrint}
                disabled={annualLoading || !annualData}
              >
                {Icons.printer}
                In Bảng Lương Năm (PDF)
              </button>
            </div>
          </div>

          {annualLoading ? (
            <div className="card" style={{ padding: '48px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Đang tổng hợp thu nhập năm {selectedYear}...
            </div>
          ) : annualData ? (
            <>
              {/* 4 Annual Stat Cards */}
              <div className="stat-grid-4">
                <StatCard
                  icon={Icons.wallet}
                  iconColor="blue"
                  label="TỔNG GROSS CẢ NĂM"
                  value={formatCurrency(annualData.total_gross_income_year)}
                  footerNote={`Đã chốt ${annualData.total_paid_months || annualData.monthly_records?.length || 0} tháng`}
                />
                <StatCard
                  icon={Icons.dollar}
                  iconColor="green"
                  label="TỔNG THỰC LĨNH CẢ NĂM (NET)"
                  value={formatCurrency(annualData.total_net_salary_year)}
                  footerNote="Thu nhập thực tế chuyển khoản ngân hàng"
                />
                <StatCard
                  icon={Icons.trendingUp}
                  iconColor="blue"
                  label="THU NHẬP TRUNG BÌNH / THÁNG"
                  value={formatCurrency(
                    annualData.total_paid_months > 0
                      ? Math.round(annualData.total_net_salary_year / annualData.total_paid_months)
                      : 0
                  )}
                  footerNote="Bình quân theo các tháng đã thanh toán"
                />
                <StatCard
                  icon={Icons.shield}
                  iconColor="amber"
                  label="BẢO HIỂM TRÍCH NỘP CẢ NĂM"
                  value={formatCurrency(annualData.total_insurance_deducted_year)}
                  footerNote="10.5% (BHXH 8%, BHYT 1.5%, BHTN 1%)"
                />
              </div>

              {/* 12-Month Table Breakdown */}
              <div className="card" style={{ overflow: 'hidden' }}>
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 className="card-title" style={{ margin: 0, fontSize: '15px' }}>
                    Chi Tiết Thu Nhập 12 Tháng Năm {selectedYear}
                    {annualData.employee && (
                      <span style={{ fontWeight: 400, color: 'var(--text-secondary)', marginLeft: '8px' }}>
                        — {annualData.employee.full_name} ({annualData.employee.employee_code})
                      </span>
                    )}
                  </h3>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', whiteSpace: 'nowrap' }}>
                    <thead>
                      <tr style={{ background: 'var(--surface-subtle)', borderBottom: '1px solid var(--border-default)' }}>
                        <th style={{ padding: '12px 14px' }}>Kỳ tháng</th>
                        <th style={{ padding: '12px 10px', textAlign: 'center' }}>Công thực</th>
                        <th style={{ padding: '12px 12px', textAlign: 'right' }}>Lương CB thực</th>
                        <th style={{ padding: '12px 12px', textAlign: 'right' }}>Phụ cấp</th>
                        <th style={{ padding: '12px 12px', textAlign: 'right' }}>Hoa hồng</th>
                        <th style={{ padding: '12px 12px', textAlign: 'right' }}>Thưởng</th>
                        <th style={{ padding: '12px 12px', textAlign: 'right', fontWeight: 700 }}>Tổng Gross</th>
                        <th style={{ padding: '12px 12px', textAlign: 'right' }}>Bảo hiểm (10.5%)</th>
                        <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 800, color: 'var(--status-success)' }}>THỰC LĨNH NET</th>
                        <th style={{ padding: '12px 10px', textAlign: 'center' }}>Trạng thái</th>
                        <th style={{ padding: '12px 14px', textAlign: 'center' }}>In</th>
                      </tr>
                    </thead>
                    <tbody>
                      {annualData.monthly_records && annualData.monthly_records.length > 0 ? (
                        annualData.monthly_records.map((rec: any, idx: number) => {
                          const allowances = (rec.position_allowance || 0) + (rec.seniority_allowance || 0) + (rec.project_allowance || 0) + (rec.meal_transport_allowance || 0)
                          return (
                            <tr key={idx} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                              <td style={{ padding: '12px 14px', fontWeight: 600 }}>
                                {rec.salary_period ? `Tháng ${parseInt(rec.salary_period.split('-')[1], 10)}/${rec.salary_period.split('-')[0]}` : rec.month_name || `Kỳ ${idx + 1}`}
                              </td>
                              <td style={{ padding: '12px 10px', textAlign: 'center' }}>{rec.actual_working_days ?? '-'}</td>
                              <td style={{ padding: '12px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatCurrency(rec.actual_base_salary)}</td>
                              <td style={{ padding: '12px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatCurrency(allowances)}</td>
                              <td style={{ padding: '12px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatCurrency(rec.commission_amount)}</td>
                              <td style={{ padding: '12px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatCurrency(rec.bonus_amount)}</td>
                              <td style={{ padding: '12px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{formatCurrency(rec.gross_income)}</td>
                              <td style={{ padding: '12px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--status-error)' }}>-{formatCurrency(rec.total_insurance)}</td>
                              <td style={{ padding: '12px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--status-success)' }}>{formatCurrency(rec.net_salary)}</td>
                              <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                                <span className={`badge-status ${getStatusBadgeClass(rec.payment_status)}`}>
                                  {getStatusLabel(rec.payment_status)}
                                </span>
                              </td>
                              <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => handleOpenMonthlyPrint(rec)}
                                  title="In phiếu lương tháng này"
                                >
                                  {Icons.printer}
                                </button>
                              </td>
                            </tr>
                          )
                        })
                      ) : (
                        <tr>
                          <td colSpan={11} style={{ padding: '36px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                            Chưa có dữ liệu bảng lương năm {selectedYear}.
                          </td>
                        </tr>
                      )}
                      {/* Summary Row */}
                      <tr style={{ background: 'var(--surface-subtle)', fontWeight: 700, borderTop: '2px solid var(--border-default)' }}>
                        <td colSpan={2} style={{ padding: '12px 14px' }}>TỔNG CẢ NĂM</td>
                        <td colSpan={2} style={{ padding: '12px 12px', textAlign: 'center' }}>-</td>
                        <td style={{ padding: '12px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatCurrency(annualData.total_commission_year)}</td>
                        <td style={{ padding: '12px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatCurrency(annualData.total_bonus_year)}</td>
                        <td style={{ padding: '12px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{formatCurrency(annualData.total_gross_income_year)}</td>
                        <td style={{ padding: '12px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--status-error)' }}>-{formatCurrency(annualData.total_insurance_deducted_year)}</td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 900, color: 'var(--status-success)', fontSize: '14px' }}>{formatCurrency(annualData.total_net_salary_year)}</td>
                        <td colSpan={2} style={{ padding: '12px 10px', textAlign: 'center' }}>-</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="card" style={{ padding: '48px', textAlign: 'center' }}>
              <EmptyState
                icon={Icons.chart}
                title="Không tìm thấy dữ liệu năm"
                description={`Chưa có dữ liệu bảng lương tổng hợp cho năm ${selectedYear}.`}
              />
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: HỢP ĐỒNG LAO ĐỘNG (CONTRACTS) */}
      {/* ========================================================================= */}
      {activeTab === 'contracts' && (
        <div className="no-print" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* 4 Contract Stat Cards */}
          <div className="stat-grid-4">
            <StatCard
              icon={Icons.fileText}
              iconColor="blue"
              label="TỔNG SỐ HỢP ĐỒNG"
              value={contracts.length}
              footerNote="Lịch sử các hợp đồng lao động đã ký"
            />
            <StatCard
              icon={Icons.checkCircle}
              iconColor="green"
              label="HỢP ĐỒNG HIỆN HÀNH"
              value={activeContract ? (activeContract.status === 'ACTIVE' ? 'Đang hiệu lực' : 'Đã ký') : 'Chưa có'}
              footerNote={activeContract?.contract_type || 'Chưa cập nhật'}
            />
            <StatCard
              icon={Icons.wallet}
              iconColor="blue"
              label="LƯƠNG CƠ BẢN HỢP ĐỒNG"
              value={formatCurrency(activeContract?.basic_salary ?? 0)}
              footerNote={`Tỷ lệ hưởng lương: ${activeContract?.salary_percentage ?? 100}%`}
            />
            <StatCard
              icon={Icons.shield}
              iconColor="amber"
              label="LƯƠNG ĐÓNG BẢO HIỂM"
              value={formatCurrency(activeContract?.insurance_salary ?? activeContract?.basic_salary ?? 0)}
              footerNote="Trích nộp BH Bắt buộc: 10.5% (BHXH 8%, BHYT 1.5%, BHTN 1%)"
            />
          </div>

          {/* Search & Actions Toolbar */}
          <div className="card" style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ position: 'relative', width: '100%', maxWidth: '340px' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Tìm theo số HĐ, loại hợp đồng..."
                value={contractQuery}
                onChange={(e) => setContractQuery(e.target.value)}
                style={{ paddingLeft: '32px' }}
              />
              <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }}>
                {Icons.search}
              </span>
            </div>

            {activeContract && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleOpenContractPrint(activeContract)}
              >
                {Icons.printer}
                In Hợp Đồng Hiện Hành (PDF)
              </button>
            )}
          </div>

          {/* Contracts Table */}
          {contractsLoading ? (
            <div className="card" style={{ padding: '48px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Đang tải danh sách hợp đồng lao động...
            </div>
          ) : (
            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 className="card-title" style={{ margin: 0, fontSize: '15px' }}>
                  Hồ Sơ Hợp Đồng Lao Động Cá Nhân
                </h3>
                <span style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                  Hiển thị <strong>{filteredContracts.length}</strong> / {contracts.length} hợp đồng
                </span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', whiteSpace: 'nowrap' }}>
                  <thead>
                    <tr style={{ background: 'var(--surface-subtle)', borderBottom: '1px solid var(--border-default)' }}>
                      <th style={{ padding: '12px 14px' }}>Số hợp đồng</th>
                      <th style={{ padding: '12px 14px' }}>Loại hợp đồng</th>
                      <th style={{ padding: '12px 14px' }}>Thời hạn hiệu lực</th>
                      <th style={{ padding: '12px 12px', textAlign: 'right' }}>Lương cơ bản</th>
                      <th style={{ padding: '12px 12px', textAlign: 'right' }}>Lương đóng BH</th>
                      <th style={{ padding: '12px 10px', textAlign: 'center' }}>Tỷ lệ %</th>
                      <th style={{ padding: '12px 12px', textAlign: 'center' }}>Ngày ký</th>
                      <th style={{ padding: '12px 10px', textAlign: 'center' }}>Trạng thái</th>
                      <th style={{ padding: '12px 14px', textAlign: 'center' }}>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredContracts.length > 0 ? (
                      filteredContracts.map((c) => (
                        <tr key={c.contract_id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                          <td style={{ padding: '12px 14px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                            #{c.contract_number}
                          </td>
                          <td style={{ padding: '12px 14px', fontWeight: 600 }}>
                            {c.contract_type}
                          </td>
                          <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>
                            {formatDate(c.start_date)} — {c.end_date ? formatDate(c.end_date) : 'Không xác định thời hạn'}
                          </td>
                          <td style={{ padding: '12px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                            {formatCurrency(c.basic_salary)}
                          </td>
                          <td style={{ padding: '12px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                            {formatCurrency(c.insurance_salary || c.basic_salary)}
                          </td>
                          <td style={{ padding: '12px 10px', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
                            {c.salary_percentage ? `${c.salary_percentage}%` : '100%'}
                          </td>
                          <td style={{ padding: '12px 12px', textAlign: 'center' }}>
                            {c.signed_date ? formatDate(c.signed_date) : '—'}
                          </td>
                          <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                            <span className={`badge-status ${getStatusBadgeClass(c.status)}`}>
                              {getStatusLabel(c.status)}
                            </span>
                          </td>
                          <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => handleOpenContractPrint(c)}
                              title="Xem chi tiết & in hợp đồng PDF"
                            >
                              {Icons.printer}
                              Xem / In PDF
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={9} style={{ padding: '36px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                          Không tìm thấy hợp đồng lao động phù hợp.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: BẢN IN PHIẾU LƯƠNG THÁNG (KHỔ A4) */}
      {/* ========================================================================= */}
      {/* ========================================================================= */}
      {/* MODAL 1: BẢN IN PHIẾU LƯƠNG THÁNG (KHỔ A4) */}
      {/* ========================================================================= */}
      {isMonthlyPrintModalOpen && monthlyPrintData && (() => {
        const printDate = parsePrintDate(monthlyPrintData.generated_date)
        const grossIncome = monthlyPrintData.summary?.gross_income ?? currentPayroll?.gross_income
        const totalDeduction = monthlyPrintData.summary?.total_deduction ?? currentPayroll?.total_deduction
        const netSalary = monthlyPrintData.summary?.net_salary ?? currentPayroll?.net_salary
        const netInWords = monthlyPrintData.summary?.net_salary_in_words ?? (currentPayroll as any)?.net_salary_in_words

        return createPortal(
          <div className="modal-overlay print-active-overlay" onClick={() => setIsMonthlyPrintModalOpen(false)}>
            <div className="modal print-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '880px', padding: 0, maxHeight: '92vh' }}>
              {/* Header */}
              <div className="modal-header no-print">
                <h2 className="modal-title" style={{ fontSize: '16px' }}>
                  Bản In Phiếu Lương Tháng (Khổ A4)
                </h2>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button className="btn btn-primary btn-sm" onClick={() => window.print()}>
                    {Icons.printer}
                    In phiếu lương (PDF)
                  </button>
                  <button
                    className="modal-close"
                    onClick={() => setIsMonthlyPrintModalOpen(false)}
                    title="Đóng"
                  >
                    {Icons.close}
                  </button>
                </div>
              </div>

              {/* A4 Sheet Body */}
              <div className="payslip-modal-body" style={{ overflowY: 'auto', padding: '16px', background: 'var(--surface-ground)' }}>
                <div className="payslip-a4-modal">
                  {/* 1. Header 2 cột Quốc hiệu - Tên cơ quan */}
                  <div className="payslip-a4-national-header">
                    <div className="payslip-hdr-org">
                      <div className="payslip-org-name">{monthlyPrintData.company?.name || 'CÔNG TY CỔ PHẦN CÔNG NGHỆ TECHZONE VIỆT NAM'}</div>
                      <div className="payslip-org-sub">HỆ THỐNG PHÂN PHỐI & CHUỖI BÁN LẺ TOÀN QUỐC</div>
                      <div style={{ fontSize: '10.5px', color: '#1e3a8a', fontWeight: 600, marginTop: '1px' }}>
                        Đơn vị: {monthlyPrintData.employee?.store_name || 'Hệ thống TechZone'}
                      </div>
                      <div className="payslip-doc-number">
                        Số: <strong>#{monthlyPrintData.payroll_code || 'PLT'}</strong>/PL-TZ
                      </div>
                    </div>

                    <div className="payslip-hdr-motto">
                      <div className="payslip-motto-country">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
                      <div className="payslip-motto-subtitle">Độc lập – Tự do – Hạnh phúc</div>
                      <div className="payslip-motto-line"></div>
                      <div className="payslip-doc-date">
                        TP. Hồ Chí Minh, ngày {printDate.day} tháng {printDate.month} năm {printDate.year}
                      </div>
                    </div>
                  </div>

                  {/* 2. Tiêu đề văn bản */}
                  <div className="payslip-a4-title-section">
                    <div className="payslip-doc-main-title">
                      {monthlyPrintData.payslip_title || 'PHIẾU THANH TOÁN TIỀN LƯƠNG'}
                    </div>
                    <div style={{ fontWeight: 600, fontSize: '12px', color: '#1e3a8a', marginBottom: '2px' }}>
                      Kỳ chi trả: {monthlyPrintData.salary_period} • Đơn vị tính: Việt Nam Đồng (VNĐ)
                    </div>
                    <div className="payslip-doc-legal-basis">
                      (Căn cứ Bộ luật Lao động số 45/2019/QH14 và Quy chế trả lương, trả thưởng nội bộ TechZone)
                    </div>
                  </div>

                  {/* 3. Phần I: Thông tin nhân sự */}
                  <div className="payslip-sec-title">I. THÔNG TIN NHÂN SỰ THỤ HƯỞNG</div>
                  <div className="payslip-a4-info-grid">
                    <div>Họ và tên nhân viên: <strong style={{ textTransform: 'uppercase' }}>{monthlyPrintData.employee?.full_name}</strong></div>
                    <div>Mã số nhân viên: <strong>{monthlyPrintData.employee?.employee_code}</strong></div>
                    <div>Chức danh / Vị trí: <strong>{monthlyPrintData.employee?.position_name}</strong></div>
                    <div>Đơn vị / Chi nhánh: <strong>{monthlyPrintData.employee?.store_name}</strong></div>
                    <div>Tài khoản ngân hàng: <strong>{monthlyPrintData.employee?.bank_account_no || monthlyPrintData.employee?.bank_account || 'Chưa cập nhật'}</strong></div>
                    <div>Ngân hàng thụ hưởng: <strong>{monthlyPrintData.employee?.bank_name || 'Chưa cập nhật'}</strong></div>
                  </div>

                  {/* 4. Phần II: Thống kê ngày công & chế độ nghỉ phép */}
                  <div className="payslip-sec-title">II. THỐNG KÊ NGÀY CÔNG & CHẾ ĐỘ NGHỈ PHÉP</div>
                  <div className="payslip-a4-attendance-grid">
                    <div>Công chuẩn: <strong>{monthlyPrintData.attendance?.standard_working_days ?? currentPayroll?.standard_working_days ?? 26} ngày</strong></div>
                    <div>Công thực tế: <strong>{monthlyPrintData.attendance?.actual_working_days ?? currentPayroll?.actual_working_days ?? 0} ngày</strong></div>
                    <div>Phép năm có lương: <strong>{monthlyPrintData.attendance?.paid_leave_days ?? currentPayroll?.paid_leave_days ?? 0} ngày</strong></div>
                    <div>Nghỉ không lương: <strong>{monthlyPrintData.attendance?.unpaid_leave_days ?? currentPayroll?.unpaid_leave_days ?? 0} ngày</strong></div>
                    <div>Giờ công thực: <strong>{monthlyPrintData.attendance?.actual_work_hours ?? 0} giờ</strong></div>
                    <div>Đi trễ: <strong>{monthlyPrintData.attendance?.late_minutes ?? 0}</strong> phút</div>
                    <div>Về sớm: <strong>{monthlyPrintData.attendance?.early_minutes ?? 0}</strong> phút</div>
                    <div>OT thực tế: <strong>{monthlyPrintData.attendance?.actual_overtime_hours ?? 0} giờ</strong></div>
                    <div>OT được duyệt: <strong>{monthlyPrintData.attendance?.approved_overtime_hours ?? 0} giờ</strong></div>
                    {(monthlyPrintData.attendance?.unworked_hours ?? currentPayroll?.unworked_hours ?? 0) > 0 && (
                      <div style={{ gridColumn: 'span 2' }}>
                        Giờ trễ / thiếu: <strong>{monthlyPrintData.attendance?.unworked_hours ?? currentPayroll?.unworked_hours} giờ</strong>
                      </div>
                    )}
                  </div>

                  {/* 5. Phần III: Các khoản thu nhập & khấu trừ */}
                  <div className="payslip-sec-title">III. CHI TIẾT THU NHẬP & CÁC KHOẢN KHẤU TRỪ</div>
                  <div className="payslip-columns">
                    {/* Cột 1: Thu nhập GROSS */}
                    <div>
                      <table className="payslip-a4-table">
                        <thead>
                          <tr>
                            <th style={{ width: '60%' }}>1. CÁC KHOẢN THU NHẬP (GROSS)</th>
                            <th style={{ textAlign: 'right', width: '40%' }}>Số tiền (VNĐ)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {monthlyPrintData.earnings?.map((e: any, idx: number) => (
                            <tr key={idx}>
                              <td>
                                <div style={{ fontWeight: 600 }}>{e.item_name || e.name}</div>
                                {e.calculation_formula && (
                                  <div style={{ fontSize: '10px', color: '#64748b', fontStyle: 'italic' }}>
                                    {e.calculation_formula}
                                  </div>
                                )}
                              </td>
                              <td style={{ textAlign: 'right', fontWeight: 600 }}>
                                {formatCurrency(e.amount)}
                              </td>
                            </tr>
                          ))}
                          <tr className="payslip-a4-total-row">
                            <td style={{ fontWeight: 700, color: '#1e3a8a' }}>TỔNG THU NHẬP (GROSS)</td>
                            <td style={{ textAlign: 'right', color: '#1e3a8a', fontSize: '12px', fontWeight: 700 }}>
                              {formatCurrency(grossIncome)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    {/* Cột 2: Khấu trừ */}
                    <div>
                      <table className="payslip-a4-table">
                        <thead>
                          <tr>
                            <th style={{ width: '60%' }}>2. CÁC KHOẢN GIẢM TRỪ (DEDUCTIONS)</th>
                            <th style={{ textAlign: 'right', width: '40%' }}>Số tiền (VNĐ)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {monthlyPrintData.deductions?.map((d: any, idx: number) => (
                            <tr key={idx}>
                              <td>
                                <div style={{ fontWeight: 600, color: '#991b1b' }}>{d.item_name || d.name}</div>
                                {d.calculation_formula && (
                                  <div style={{ fontSize: '10px', color: '#64748b', fontStyle: 'italic' }}>
                                    {d.calculation_formula}
                                  </div>
                                )}
                              </td>
                              <td style={{ textAlign: 'right', color: '#dc2626', fontWeight: 600 }}>
                                -{formatCurrency(d.amount)}
                              </td>
                            </tr>
                          ))}
                          <tr className="payslip-a4-total-row">
                            <td style={{ fontWeight: 700, color: '#991b1b' }}>TỔNG GIẢM TRỪ</td>
                            <td style={{ textAlign: 'right', color: '#dc2626', fontSize: '12px', fontWeight: 700 }}>
                              -{formatCurrency(totalDeduction)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Thực lĩnh NET */}
                  <div className="payslip-a4-highlight-box">
                    <div className="payslip-a4-net-label">THỰC LĨNH CHUYỂN KHOẢN (NET):</div>
                    <div className="payslip-a4-net-amount">{formatCurrency(netSalary)}</div>
                  </div>

                  {netInWords && (
                    <div className="payslip-a4-words">
                      Số tiền bằng chữ: <strong>{netInWords}</strong>
                    </div>
                  )}

                  {/* 6. Phần IV: Xác nhận & Chữ ký các bên */}
                  <div className="payslip-sec-title">IV. XÁC NHẬN & CHỮ KÝ CÁC BÊN</div>
                  <div className="payslip-a4-signatures">
                    <div>
                      <div className="payslip-a4-sign-title">NGƯỜI NHẬN LƯƠNG</div>
                      <div className="payslip-a4-sign-note">(Ký, ghi rõ họ tên)</div>
                      <div className="payslip-a4-sign-space"></div>
                      <div className="payslip-a4-sign-name" style={{ textTransform: 'uppercase' }}>
                        {monthlyPrintData.employee?.full_name || ''}
                      </div>
                    </div>
                    <div>
                      <div className="payslip-a4-sign-title">KẾ TOÁN TIỀN LƯƠNG</div>
                      <div className="payslip-a4-sign-note">(Ký, ghi rõ họ tên)</div>
                      <div className="payslip-a4-sign-space"></div>
                      <div className="payslip-a4-sign-name">Người lập biểu</div>
                    </div>
                    <div>
                      <div className="payslip-a4-sign-title">KẾ TOÁN TRƯỞNG</div>
                      <div className="payslip-a4-sign-note">(Ký, ghi rõ họ tên)</div>
                      <div className="payslip-a4-sign-space"></div>
                      <div className="payslip-a4-sign-name">Ban Tài chính - Kế toán</div>
                    </div>
                    <div>
                      <div className="payslip-a4-sign-title">GIÁM ĐỐC ĐIỀU HÀNH</div>
                      <div className="payslip-a4-sign-note">(Ký, đóng dấu)</div>
                      <div className="payslip-a4-sign-space"></div>
                      <div className="payslip-a4-sign-name">Đại diện pháp luật</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="modal-footer no-print" style={{ padding: '14px 20px', background: 'var(--surface-card)' }}>
                <button className="btn btn-secondary" onClick={() => setIsMonthlyPrintModalOpen(false)}>
                  Đóng
                </button>
                <button className="btn btn-primary" onClick={() => window.print()}>
                  {Icons.printer}
                  In phiếu lương (PDF)
                </button>
              </div>
            </div>
            {false && (<>

            {/* A4 Sheet Body */}
            <div className="payslip-modal-body" style={{ overflowY: 'auto', padding: '16px', background: 'var(--surface-ground)' }}>
              <div className="payslip-a4-modal">
                {/* Header */}
                <div className="payslip-a4-header">
                  <div>
                    <div className="payslip-a4-company-name">{monthlyPrintData.company?.name || 'TECHZONE RETAIL'}</div>
                    {monthlyPrintData.company?.address && (
                      <div className="payslip-a4-company-sub">Địa chỉ: {monthlyPrintData.company.address}</div>
                    )}
                    {monthlyPrintData.company?.tax_id && (
                      <div className="payslip-a4-company-sub">Mã số thuế: {monthlyPrintData.company.tax_id}</div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#1e3a8a' }}>
                      MÃ PHIẾU: <span style={{ fontFamily: 'var(--font-mono)' }}>#{monthlyPrintData.payroll_code}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#475569', marginTop: '3px' }}>
                      NGÀY TẠO: <strong>{monthlyPrintData.generated_date}</strong>
                    </div>
                  </div>
                </div>

                {/* Title */}
                <div className="payslip-a4-title-box">
                  <div className="payslip-a4-main-title">{monthlyPrintData.payslip_title}</div>
                  <div className="payslip-a4-period-subtitle">
                    Kỳ tính lương: {monthlyPrintData.salary_period} • Đơn vị tiền tệ: Việt Nam Đồng (VNĐ)
                  </div>
                </div>

                {/* Employee Info Grid */}
                <div className="payslip-a4-info-grid">
                  <div>Họ và tên: <strong>{monthlyPrintData.employee?.full_name}</strong></div>
                  <div>Mã nhân viên: <strong>{monthlyPrintData.employee?.employee_code}</strong></div>
                  <div>Vị trí công việc: <strong>{monthlyPrintData.employee?.position_name}</strong></div>
                  <div>Chi nhánh làm việc: <strong>{monthlyPrintData.employee?.store_name}</strong></div>
                  <div>Số tài khoản: <strong>{monthlyPrintData.employee?.bank_account_no || monthlyPrintData.employee?.bank_account || 'Chưa cập nhật'}</strong></div>
                  <div>Ngân hàng: <strong>{monthlyPrintData.employee?.bank_name || 'Chưa cập nhật'}</strong></div>
                </div>

                {/* Attendance Summary Bar */}
                <div className="payslip-a4-attendance-summary" style={{ marginBottom: '10px', fontSize: '11px', background: '#f8fafc', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '6px', lineHeight: 1.4 }}>
                  <div style={{ fontWeight: 700, color: '#1e3a8a', marginBottom: '3px', textTransform: 'uppercase', fontSize: '11px', letterSpacing: '0.5px' }}>
                    THỐNG KÊ NGÀY CÔNG & NGHỈ PHÉP (LIÊN KẾT CHẤM CÔNG & ĐƠN NGHỈ PHÉP)
                  </div>
                  <div className="payslip-attendance-values">
                    <div>Công chuẩn: <strong>{monthlyPrintData.attendance?.standard_working_days ?? currentPayroll?.standard_working_days ?? '—'}</strong> ngày</div>
                    <div>Công thực tế: <strong>{monthlyPrintData.attendance?.actual_working_days ?? currentPayroll?.actual_working_days ?? '—'}</strong> ngày</div>
                    <div>Phép năm có lương: <strong style={{ color: '#2563eb' }}>{monthlyPrintData.attendance?.paid_leave_days ?? currentPayroll?.paid_leave_days ?? 0}</strong> ngày</div>
                    <div>
                      Nghỉ không lương: <strong style={{ color: (monthlyPrintData.attendance?.unpaid_leave_days ?? currentPayroll?.unpaid_leave_days ?? 0) > 0 ? '#dc2626' : 'inherit' }}>
                        {monthlyPrintData.attendance?.unpaid_leave_days ?? currentPayroll?.unpaid_leave_days ?? 0} ngày
                      </strong>
                    </div>
                    {(monthlyPrintData.attendance?.unworked_hours ?? currentPayroll?.unworked_hours ?? 0) > 0 && (
                      <div>Giờ trễ/thiếu: <strong style={{ color: '#dc2626' }}>{monthlyPrintData.attendance?.unworked_hours ?? currentPayroll?.unworked_hours} giờ</strong></div>
                    )}
                    {monthlyPrintData.attendance?.actual_work_hours !== undefined && <div>Giờ công thực tế: <strong>{monthlyPrintData.attendance.actual_work_hours}</strong></div>}
                    {monthlyPrintData.attendance?.late_minutes !== undefined && <div>Đi trễ: <strong>{monthlyPrintData.attendance.late_minutes}</strong> phút</div>}
                    {monthlyPrintData.attendance?.early_minutes !== undefined && <div>Về sớm: <strong>{monthlyPrintData.attendance.early_minutes}</strong> phút</div>}
                    {monthlyPrintData.attendance?.actual_overtime_hours !== undefined && <div>Giờ ngoài ca ghi nhận: <strong>{monthlyPrintData.attendance.actual_overtime_hours}</strong> giờ</div>}
                    {monthlyPrintData.attendance?.approved_overtime_hours !== undefined && <div>OT được duyệt: <strong>{monthlyPrintData.attendance.approved_overtime_hours}</strong> giờ</div>}
                  </div>
                </div>

                {/* Tables: Earnings & Deductions */}
                <div className="payslip-columns">
                  {/* Earnings */}
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '8px', color: '#1e3a8a' }}>
                      I. CÁC KHOẢN THU NHẬP (GROSS)
                    </div>
                    <table className="payslip-a4-table">
                      <thead>
                        <tr>
                          <th style={{ width: '55%' }}>Khoản mục thu nhập</th>
                          <th style={{ textAlign: 'right', width: '45%' }}>Số tiền (VNĐ)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthlyPrintData.earnings?.map((e: any, idx: number) => (
                          <tr key={idx}>
                            <td>
                              <div style={{ fontWeight: 600 }}>{e.item_name || e.name}</div>
                              {e.calculation_formula && (
                                <div style={{ fontSize: '10.5px', color: '#64748b', fontStyle: 'italic' }}>
                                  {e.calculation_formula}
                                </div>
                              )}
                            </td>
                            <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                              {formatCurrency(e.amount)}
                            </td>
                          </tr>
                        ))}
                        <tr className="payslip-a4-total-row">
                          <td>TỔNG THU NHẬP (GROSS)</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#1e3a8a', fontSize: '13.5px' }}>
                            {formatCurrency(monthlyPrintData.summary?.gross_income ?? currentPayroll?.gross_income)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Deductions */}
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '8px', color: '#b91c1c' }}>
                      II. CÁC KHOẢN GIẢM TRỪ (DEDUCTIONS)
                    </div>
                    <table className="payslip-a4-table">
                      <thead>
                        <tr>
                          <th style={{ width: '55%' }}>Khoản mục khấu trừ</th>
                          <th style={{ textAlign: 'right', width: '45%' }}>Số tiền (VNĐ)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthlyPrintData.deductions?.map((d: any, idx: number) => (
                          <tr key={idx}>
                            <td>
                              <div style={{ fontWeight: 600, color: '#991b1b' }}>{d.item_name || d.name}</div>
                              {d.calculation_formula && (
                                <div style={{ fontSize: '10.5px', color: '#64748b', fontStyle: 'italic' }}>
                                  {d.calculation_formula}
                                </div>
                              )}
                            </td>
                            <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#dc2626', fontWeight: 600 }}>
                              -{formatCurrency(d.amount)}
                            </td>
                          </tr>
                        ))}
                        <tr className="payslip-a4-total-row">
                          <td>TỔNG GIẢM TRỪ</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#dc2626', fontSize: '13.5px' }}>
                            -{formatCurrency(monthlyPrintData.summary?.total_deduction ?? currentPayroll?.total_deduction)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Net Highlight */}
                <div className="payslip-a4-highlight-box">
                  <div className="payslip-a4-net-label">THỰC LĨNH CHUYỂN KHOẢN (NET):</div>
                  <div className="payslip-a4-net-amount">{formatCurrency(monthlyPrintData.summary?.net_salary)}</div>
                </div>

                {monthlyPrintData.summary?.net_salary_in_words && (
                  <div className="payslip-a4-words">
                    Số tiền bằng chữ: <strong>{monthlyPrintData.summary.net_salary_in_words}</strong>
                  </div>
                )}

                {/* Signatures */}
                <div className="payslip-a4-signatures">
                  <div>
                    <div className="payslip-a4-sign-title">NGƯỜI LẬP PHIẾU</div>
                    <div className="payslip-a4-sign-note">(Ký, họ tên)</div>
                    <div className="payslip-a4-sign-space"></div>
                  </div>
                  <div>
                    <div className="payslip-a4-sign-title">KẾ TOÁN TRƯỞNG</div>
                    <div className="payslip-a4-sign-note">(Ký, họ tên)</div>
                    <div className="payslip-a4-sign-space"></div>
                  </div>
                  <div>
                    <div className="payslip-a4-sign-title">GIÁM ĐỐC</div>
                    <div className="payslip-a4-sign-note">(Ký, đóng dấu)</div>
                    <div className="payslip-a4-sign-space"></div>
                  </div>
                  <div>
                    <div className="payslip-a4-sign-title">NGƯỜI NHẬN LƯƠNG</div>
                    <div className="payslip-a4-sign-note">(Ký xác nhận)</div>
                    <div className="payslip-a4-sign-space"></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="modal-footer no-print" style={{ padding: '14px 20px', background: 'var(--surface-card)' }}>
              <button className="btn btn-secondary" onClick={() => setIsMonthlyPrintModalOpen(false)}>
                Đóng
              </button>
              <button className="btn btn-primary" onClick={() => window.print()}>
                {Icons.printer}
                In phiếu lương (PDF)
              </button>
            </div>
            </>)}
          </div>,
          document.body
        )
      })()}

      {/* ========================================================================= */}
      {/* MODAL 2: BẢN IN BẢNG LƯƠNG NĂM (KHỔ A4) */}
      {/* ========================================================================= */}
      {isAnnualPrintModalOpen && annualData && (() => {
        const printDate = parsePrintDate(annualData.generated_date)
        const salaryYear = annualData.salary_year || selectedYear

        return createPortal(
          <div className="modal-overlay print-active-overlay" onClick={() => setIsAnnualPrintModalOpen(false)}>
            <div className="modal print-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '900px', padding: 0, maxHeight: '92vh' }}>
              {/* Header */}
              <div className="modal-header no-print">
                <h2 className="modal-title" style={{ fontSize: '16px' }}>
                  Bản In Bảng Lương Năm {salaryYear} (Khổ A4)
                </h2>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button className="btn btn-primary btn-sm" onClick={() => window.print()}>
                    {Icons.printer}
                    In bảng lương năm (PDF)
                  </button>
                  <button
                    className="modal-close"
                    onClick={() => setIsAnnualPrintModalOpen(false)}
                    title="Đóng"
                  >
                    {Icons.close}
                  </button>
                </div>
              </div>

              {/* A4 Sheet Body */}
              <div className="payslip-modal-body" style={{ overflowY: 'auto', padding: '16px', background: 'var(--surface-ground)' }}>
                <div className="payslip-a4-modal">
                  {/* 1. Header 2 cột Quốc hiệu - Tên cơ quan */}
                  <div className="payslip-a4-national-header">
                    <div className="payslip-hdr-org">
                      <div className="payslip-org-name">{annualData.company?.name || 'CÔNG TY CỔ PHẦN CÔNG NGHỆ TECHZONE VIỆT NAM'}</div>
                      <div className="payslip-org-sub">HỆ THỐNG PHÂN PHỐI & CHUỖI BÁN LẺ TOÀN QUỐC</div>
                      <div style={{ fontSize: '10.5px', color: '#1e3a8a', fontWeight: 600, marginTop: '1px' }}>
                        Đơn vị: {annualData.employee?.store_name || 'Hệ thống TechZone'}
                      </div>
                      <div className="payslip-doc-number">
                        Số: <strong>#{salaryYear}</strong>/BTTN-TZ
                      </div>
                    </div>

                    <div className="payslip-hdr-motto">
                      <div className="payslip-motto-country">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
                      <div className="payslip-motto-subtitle">Độc lập – Tự do – Hạnh phúc</div>
                      <div className="payslip-motto-line"></div>
                      <div className="payslip-doc-date">
                        TP. Hồ Chí Minh, ngày {printDate.day} tháng {printDate.month} năm {printDate.year}
                      </div>
                    </div>
                  </div>

                  {/* 2. Tiêu đề văn bản */}
                  <div className="payslip-a4-title-section">
                    <div className="payslip-doc-main-title">
                      BẢNG TỔNG HỢP THU NHẬP NĂM {salaryYear}
                    </div>
                    <div className="payslip-doc-legal-basis">
                      (Phục vụ quyết toán thuế TNCN, đối soát bảo hiểm xã hội và lưu trữ hồ sơ nhân sự TechZone)
                    </div>
                  </div>

                  {/* 3. Phần I: Thông tin nhân sự */}
                  <div className="payslip-sec-title">I. THÔNG TIN NHÂN SỰ</div>
                  <div className="payslip-a4-info-grid">
                    <div>Họ và tên nhân viên: <strong style={{ textTransform: 'uppercase' }}>{annualData.employee?.full_name}</strong></div>
                    <div>Mã số nhân viên: <strong>{annualData.employee?.employee_code}</strong></div>
                    <div>Chức danh / Vị trí: <strong>{annualData.employee?.position || annualData.employee?.position_name || 'Nhân viên'}</strong></div>
                    <div>Đơn vị / Chi nhánh: <strong>{annualData.employee?.store_name || 'TechZone Retail'}</strong></div>
                    <div>Số CMND / CCCD: <strong>{annualData.employee?.id_card_number || '—'}</strong></div>
                    <div>Mã số thuế cá nhân: <strong>{annualData.employee?.tax_code || '—'}</strong></div>
                  </div>

                  {/* 4. Phần II: Bảng chi tiết 12 tháng */}
                  <div className="payslip-sec-title">II. BẢNG CHI TIẾT CÁC KỲ THU NHẬP TRONG NĂM</div>
                  <table className="payslip-a4-table" style={{ fontSize: '10.5px' }}>
                    <thead>
                      <tr>
                        <th style={{ width: '12%' }}>Kỳ tháng</th>
                        <th style={{ textAlign: 'center', width: '8%' }}>Công</th>
                        <th style={{ textAlign: 'right', width: '11%' }}>Lương CB</th>
                        <th style={{ textAlign: 'right', width: '11%' }}>Phụ cấp</th>
                        <th style={{ textAlign: 'right', width: '11%' }}>Hoa hồng</th>
                        <th style={{ textAlign: 'right', width: '11%' }}>Thưởng</th>
                        <th style={{ textAlign: 'right', width: '12%' }}>Tổng Gross</th>
                        <th style={{ textAlign: 'right', width: '11%' }}>Bảo hiểm</th>
                        <th style={{ textAlign: 'right', width: '14%' }}>Thực lĩnh NET</th>
                      </tr>
                    </thead>
                    <tbody>
                      {annualData.monthly_records?.map((rec: any, idx: number) => {
                        const allowances = (rec.position_allowance || 0) + (rec.seniority_allowance || 0) + (rec.project_allowance || 0) + (rec.meal_transport_allowance || 0)
                        return (
                          <tr key={idx}>
                            <td style={{ fontWeight: 600 }}>
                              {rec.salary_period ? `Tháng ${parseInt(rec.salary_period.split('-')[1], 10)}/${rec.salary_period.split('-')[0]}` : rec.month_name || `Kỳ ${idx + 1}`}
                            </td>
                            <td style={{ textAlign: 'center' }}>{rec.actual_working_days ?? '—'}</td>
                            <td style={{ textAlign: 'right' }}>{formatCurrency(rec.actual_base_salary)}</td>
                            <td style={{ textAlign: 'right' }}>{formatCurrency(allowances)}</td>
                            <td style={{ textAlign: 'right' }}>{formatCurrency(rec.commission_amount)}</td>
                            <td style={{ textAlign: 'right' }}>{formatCurrency(rec.bonus_amount)}</td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(rec.gross_income)}</td>
                            <td style={{ textAlign: 'right', color: '#dc2626' }}>-{formatCurrency(rec.total_insurance)}</td>
                            <td style={{ textAlign: 'right', fontWeight: 700, color: '#15803d' }}>{formatCurrency(rec.net_salary)}</td>
                          </tr>
                        )
                      })}
                      <tr className="payslip-a4-total-row" style={{ fontSize: '11px' }}>
                        <td colSpan={2} style={{ fontWeight: 700 }}>TỔNG CẢ NĂM</td>
                        <td colSpan={2} style={{ textAlign: 'center' }}>—</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(annualData.total_commission_year)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(annualData.total_bonus_year)}</td>
                        <td style={{ textAlign: 'right', color: '#1e3a8a', fontWeight: 700 }}>{formatCurrency(annualData.total_gross_income_year)}</td>
                        <td style={{ textAlign: 'right', color: '#dc2626', fontWeight: 700 }}>-{formatCurrency(annualData.total_insurance_deducted_year)}</td>
                        <td style={{ textAlign: 'right', color: '#15803d', fontSize: '12px', fontWeight: 700 }}>{formatCurrency(annualData.total_net_salary_year)}</td>
                      </tr>
                    </tbody>
                  </table>

                  {/* Hộp thực lĩnh cả năm */}
                  <div className="payslip-a4-highlight-box">
                    <div className="payslip-a4-net-label">TỔNG THU NHẬP THỰC NHẬN CẢ NĂM (NET):</div>
                    <div className="payslip-a4-net-amount">{formatCurrency(annualData.total_net_salary_year)}</div>
                  </div>

                  {annualData.net_salary_in_words && (
                    <div className="payslip-a4-words">
                      Số tiền bằng chữ: <strong>{annualData.net_salary_in_words}</strong>
                    </div>
                  )}

                  {/* 5. Phần III: Xác nhận & Chữ ký các bên */}
                  <div className="payslip-sec-title">III. XÁC NHẬN & CHỮ KÝ CÁC BÊN</div>
                  <div className="payslip-a4-signatures">
                    <div>
                      <div className="payslip-a4-sign-title">NGƯỜI LAO ĐỘNG</div>
                      <div className="payslip-a4-sign-note">(Ký, ghi rõ họ tên)</div>
                      <div className="payslip-a4-sign-space"></div>
                      <div className="payslip-a4-sign-name" style={{ textTransform: 'uppercase' }}>
                        {annualData.employee?.full_name || ''}
                      </div>
                    </div>
                    <div>
                      <div className="payslip-a4-sign-title">KẾ TOÁN LẬP BẢNG</div>
                      <div className="payslip-a4-sign-note">(Ký, ghi rõ họ tên)</div>
                      <div className="payslip-a4-sign-space"></div>
                      <div className="payslip-a4-sign-name">Người lập biểu</div>
                    </div>
                    <div>
                      <div className="payslip-a4-sign-title">KẾ TOÁN TRƯỞNG</div>
                      <div className="payslip-a4-sign-note">(Ký, ghi rõ họ tên)</div>
                      <div className="payslip-a4-sign-space"></div>
                      <div className="payslip-a4-sign-name">Ban Tài chính - Kế toán</div>
                    </div>
                    <div>
                      <div className="payslip-a4-sign-title">GIÁM ĐỐC ĐIỀU HÀNH</div>
                      <div className="payslip-a4-sign-note">(Ký, đóng dấu)</div>
                      <div className="payslip-a4-sign-space"></div>
                      <div className="payslip-a4-sign-name">Đại diện pháp luật</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="modal-footer no-print" style={{ padding: '14px 20px', background: 'var(--surface-card)' }}>
                <button className="btn btn-secondary" onClick={() => setIsAnnualPrintModalOpen(false)}>
                  Đóng
                </button>
                <button className="btn btn-primary" onClick={() => window.print()}>
                  {Icons.printer}
                  In bảng lương năm (PDF)
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      })()}

      {/* ========================================================================= */}
      {/* MODAL 3: BẢN IN HỢP ĐỒNG LAO ĐỘNG (KHỔ A4) */}
      {/* ========================================================================= */}
      {isContractPrintModalOpen && selectedContract && createPortal(
        <div className="modal-overlay print-active-overlay" onClick={() => setIsContractPrintModalOpen(false)}>
          <div className="modal print-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '880px', padding: 0, maxHeight: '92vh' }}>
            {/* Header */}
            <div className="modal-header no-print">
              <h2 className="modal-title" style={{ fontSize: '16px' }}>
                Bản In Hợp Đồng Lao Động (Khổ A4)
              </h2>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button className="btn btn-primary btn-sm" onClick={() => window.print()}>
                  {Icons.printer}
                  In hợp đồng (PDF)
                </button>
                <button
                  className="modal-close"
                  onClick={() => setIsContractPrintModalOpen(false)}
                  title="Đóng"
                >
                  {Icons.close}
                </button>
              </div>
            </div>

            {/* A4 Sheet Body */}
            <div className="payslip-modal-body" style={{ overflowY: 'auto', padding: '16px', background: 'var(--surface-ground)' }}>
              <div className="payslip-a4-modal">
                {/* Header */}
                <div className="payslip-a4-header">
                  <div>
                    <div className="payslip-a4-company-name">CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ TECH ZONE</div>
                    <div className="payslip-a4-company-sub">Hệ Thống Bán Lẻ Thiết Bị Công Nghệ Cao Cấp Toàn Quốc</div>
                    <div className="payslip-a4-company-sub">Địa chỉ: 273 An Dương Vương, Phường 3, Quận 5, TP. Hồ Chí Minh</div>
                    <div className="payslip-a4-company-sub">Mã số thuế: 0317894562 • Điện thoại: 1900 6868</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#1e3a8a' }}>
                      SỐ HĐ: <span style={{ fontFamily: 'var(--font-mono)' }}>#{selectedContract.contract_number}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#475569', marginTop: '3px' }}>
                      NGÀY KÝ: <strong>{selectedContract.signed_date ? formatDate(selectedContract.signed_date) : formatDate(selectedContract.start_date)}</strong>
                    </div>
                  </div>
                </div>

                {/* Main Title */}
                <div className="payslip-a4-title-box">
                  <div className="payslip-a4-main-title">HỢP ĐỒNG LAO ĐỘNG</div>
                  <div className="payslip-a4-period-subtitle">
                    (Ban hành theo Bộ luật Lao động Việt Nam & Quy chế Quản trị Nhân sự TechZone)
                  </div>
                </div>

                {/* Parties Info Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                  {/* Bên A */}
                  <div style={{ border: '1px solid #cbd5e1', borderRadius: '6px', padding: '12px 14px', background: '#f8fafc', fontSize: '12.5px', lineHeight: 1.6 }}>
                    <div style={{ fontWeight: 800, color: '#1e3a8a', marginBottom: '6px', textTransform: 'uppercase', fontSize: '12px' }}>
                      BÊN A (NGƯỜI SỬ DỤNG LAO ĐỘNG):
                    </div>
                    <div>Đơn vị: <strong>CÔNG TY TNHH TM DV TECH ZONE</strong></div>
                    <div>Đại diện: <strong>Ban Giám Đốc TechZone Retail</strong></div>
                    <div>Chức vụ: <strong>Đại diện theo pháp luật</strong></div>
                    <div>Địa chỉ: <strong>273 An Dương Vương, P.3, Q.5, TP.HCM</strong></div>
                  </div>

                  {/* Bên B */}
                  <div style={{ border: '1px solid #cbd5e1', borderRadius: '6px', padding: '12px 14px', background: '#f8fafc', fontSize: '12.5px', lineHeight: 1.6 }}>
                    <div style={{ fontWeight: 800, color: '#1e3a8a', marginBottom: '6px', textTransform: 'uppercase', fontSize: '12px' }}>
                      BÊN B (NGƯỜI LAO ĐỘNG):
                    </div>
                    <div>Họ và tên: <strong>{selectedContract.employee_name || user?.full_name}</strong></div>
                    <div>Mã nhân viên: <strong>{user?.username || 'NV-TECHZONE'}</strong></div>
                    <div>Chi nhánh làm việc: <strong>{user?.store_name || 'Hệ thống TechZone Retail'}</strong></div>
                    <div>Trạng thái: <strong>{getStatusLabel(selectedContract.status)}</strong></div>
                  </div>
                </div>

                {/* Contract Articles */}
                <div style={{ fontSize: '12.5px', lineHeight: 1.65, display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px' }}>
                  <div style={{ border: '1px solid #cbd5e1', borderRadius: '6px', padding: '12px 14px' }}>
                    <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                      ĐIỀU 1: LOẠI HỢP ĐỒNG & THỜI HẠN CÔNG TÁC
                    </div>
                    <div>• <strong>Loại hợp đồng:</strong> {selectedContract.contract_type}</div>
                    <div>
                      • <strong>Thời hạn hiệu lực:</strong> Từ ngày <strong>{formatDate(selectedContract.start_date)}</strong> đến ngày <strong>{selectedContract.end_date ? formatDate(selectedContract.end_date) : 'Không xác định thời hạn'}</strong>
                    </div>
                    <div>• <strong>Thời gian làm việc tiêu chuẩn:</strong> {selectedContract.working_hours_per_week || 48} giờ / tuần (Theo ca phân công tại chi nhánh)</div>
                  </div>

                  <div style={{ border: '1px solid #cbd5e1', borderRadius: '6px', padding: '12px 14px' }}>
                    <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                      ĐIỀU 2: TIỀN LƯƠNG, PHỤ CẤP & CÁC CHẾ ĐỘ ĐÃI NGỘ
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', marginTop: '6px' }}>
                      <div>• Mức lương cơ bản thỏa thuận: <strong style={{ fontFamily: 'var(--font-mono)' }}>{formatCurrency(selectedContract.basic_salary)}</strong></div>
                      <div>• Mức lương đóng bảo hiểm: <strong style={{ fontFamily: 'var(--font-mono)' }}>{formatCurrency(selectedContract.basic_salary || selectedContract.insurance_salary)}</strong></div>
                      <div>• Tỷ lệ hưởng lương: <strong style={{ fontFamily: 'var(--font-mono)' }}>{selectedContract.salary_percentage ? `${selectedContract.salary_percentage}%` : '100%'}</strong></div>
                      <div>• Kỳ hạn trả lương: <strong>Hàng tháng (Từ ngày 05 - 10)</strong></div>
                    </div>
                    <div style={{ marginTop: '6px', color: '#475569', fontSize: '12px' }}>
                      • <strong>Trích nộp Bảo hiểm Bắt buộc (10.5% lương đóng BH):</strong> - BHXH: 8.0% | BHYT: 1.5% | BHTN: 1.0%.
                    </div>
                    <div style={{ marginTop: '3px', color: '#475569', fontSize: '12px' }}>
                      • <em>Phụ cấp & Thưởng:</em> Hưởng đầy đủ các khoản phụ cấp chức vụ, phụ cấp ăn trưa/đi lại, thưởng năng suất và hoa hồng doanh số theo chính sách kinh doanh chuỗi TechZone Retail.
                    </div>
                  </div>

                  <div style={{ border: '1px solid #cbd5e1', borderRadius: '6px', padding: '12px 14px' }}>
                    <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                      ĐIỀU 3: NGHĨA VỤ VÀ QUYỀN HẠN CỦA CÁC BÊN
                    </div>
                    <div>
                      • Người lao động cam kết thực hiện đầy đủ nhiệm vụ chuyên môn, tuân thủ nội quy lao động, quy trình chấm công GPS và bảo mật bí mật kinh doanh, thông tin khách hàng của TechZone.
                    </div>
                    <div style={{ marginTop: '4px' }}>
                      • Người sử dụng lao động bảo đảm cung cấp trang thiết bị làm việc, môi trường an toàn, và chi trả thu nhập đầy đủ, đúng hạn theo kết quả chấm công và chốt bảng lương hàng tháng.
                    </div>
                  </div>
                </div>

                {/* Signatures */}
                <div className="payslip-a4-signatures" style={{ gridTemplateColumns: '1fr 1fr', marginTop: '30px' }}>
                  <div>
                    <div className="payslip-a4-sign-title">ĐẠI DIỆN NGƯỜI SỬ DỤNG LAO ĐỘNG</div>
                    <div className="payslip-a4-sign-note">(Ký tên, đóng dấu)</div>
                    <div className="payslip-a4-sign-space" style={{ height: '70px' }}></div>
                    <div style={{ fontWeight: 700, fontSize: '12.5px' }}>TECHZONE RETAIL</div>
                  </div>
                  <div>
                    <div className="payslip-a4-sign-title">NGƯỜI LAO ĐỘNG</div>
                    <div className="payslip-a4-sign-note">(Ký và ghi rõ họ tên)</div>
                    <div className="payslip-a4-sign-space" style={{ height: '70px' }}></div>
                    <div style={{ fontWeight: 700, fontSize: '12.5px' }}>{selectedContract.employee_name || user?.full_name}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="modal-footer no-print" style={{ padding: '14px 20px', background: 'var(--surface-card)' }}>
              <button className="btn btn-secondary" onClick={() => setIsContractPrintModalOpen(false)}>
                Đóng
              </button>
              <button className="btn btn-primary" onClick={() => window.print()}>
                {Icons.printer}
                In hợp đồng (PDF)
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {isPayrollRegulationOpen && (
        <PayrollRegulationDialog onClose={() => setIsPayrollRegulationOpen(false)} />
      )}
    </div>
  )
}
