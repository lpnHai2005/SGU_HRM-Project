import { useState, useEffect, useMemo, useCallback } from 'react'
import { Icons } from '../components/common/Icons'
import { StatCard } from '../components/common/StatCard'
import { EmptyState } from '../components/common/EmptyState'
import { formatCurrency, formatDate } from '../utils/formatters'
import type { Payroll } from '../types'
import { payrollApi } from '../services/api'
import './PayslipPrint.css'
import { PayrollOvertimePanel } from './PayrollOvertimePanel'
import { PayrollAdjustmentDialog } from './PayrollAdjustmentDialog'
import { PayrollRegulationDialog } from './PayrollRegulationDialog'
import { AttendanceRegulationDialog } from './AttendanceRegulationDialog'
import { PayrollReopenDialog } from './PayrollReopenDialog'
import { PayrollUnconfirmDialog } from './PayrollUnconfirmDialog'
import { toast } from 'sonner'

export interface PayrollPageProps {
  user: any
}

function getStatusBadgeClass(status?: string): string {
  switch (status) {
    case 'NEEDS_RECALCULATION':
      return 'badge-needs-recalculation'
    case 'PAID':
      return 'badge-paid'
    case 'CONFIRMED':
      return 'badge-confirmed'
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
    case 'DRAFT':
    default:
      return 'Bản nháp'
  }
}

export function PayrollPage({ user }: PayrollPageProps) {
  const [payrolls, setPayrolls] = useState<Payroll[]>([])
  const [selectedPeriod, setSelectedPeriod] = useState<string>(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [selectedYear, setSelectedYear] = useState<string>(() => String(new Date().getFullYear()))
  const [isLoading, setIsLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [confirmation,setConfirmation]=useState<{message:string;action:()=>Promise<void>}|null>(null)

  // 2 Balanced Tabs: 'monthly' (Theo Tháng) vs 'annual' (Theo Năm)
  const [activeTab, setActiveTab] = useState<'monthly' | 'annual'>('monthly')
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'DRAFT' | 'NEEDS_RECALCULATION' | 'CONFIRMED' | 'PAID'>('all')

  // Selected item for details & print
  const [selectedPayroll, setSelectedPayroll] = useState<Payroll | null>(null)
  const [adjustmentPayroll, setAdjustmentPayroll] = useState<Payroll | null>(null)
  const [reopenDialogOpen, setReopenDialogOpen] = useState(false)
  const [unconfirmPayroll, setUnconfirmPayroll] = useState<Payroll | null>(null)
  const [selectedAnnualEmployeeId, setSelectedAnnualEmployeeId] = useState<number>(() => user?.employee_id || 0)
  const [annualData, setAnnualData] = useState<any>(null)
  const [annualLoading, setAnnualLoading] = useState(false)

  // Modals state
  const [isPayrollRegulationOpen, setIsPayrollRegulationOpen] = useState(false)
  const [isAttendanceRulesOpen, setIsAttendanceRulesOpen] = useState(false)
  const [isMonthlyPrintModalOpen, setIsMonthlyPrintModalOpen] = useState(false)
  const [isAnnualPrintModalOpen, setIsAnnualPrintModalOpen] = useState(false)
  const [monthlyPrintData, setMonthlyPrintData] = useState<any>(null)

  // Roles determination
  const userRoles = useMemo(() => user?.roles || [], [user])
  const isAdmin = userRoles.includes('ADMIN')
  const isHrManager = userRoles.includes('HR_MANAGER')
  const isStoreManager = userRoles.includes('STORE_MANAGER')
  const canManage = isAdmin || isHrManager || isStoreManager
  const canRunPayroll = isAdmin || isHrManager

  // Load payrolls
  const fetchPayrolls = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await payrollApi.getAll({ period: selectedPeriod })
      setPayrolls(data || [])
      if (data && data.length > 0) {
        const userPayroll = data.find(p => p.employee_id === user?.employee_id)
        setSelectedPayroll(userPayroll || data[0])
      } else {
        setSelectedPayroll(null)
      }
    } catch (err: any) {
      console.error('Error fetching payrolls:', err)
      setFeedbackMessage({ type: 'error', text: err.message || 'Lỗi khi tải danh sách bảng lương' })
      setPayrolls([])
    } finally {
      setIsLoading(false)
    }
  }, [selectedPeriod, user?.employee_id])

  useEffect(() => {
    fetchPayrolls()
  }, [fetchPayrolls])

  // Fetch annual data when annual tab is active or selected employee changes
  const fetchAnnualSummary = useCallback(async (empId: number, year: string) => {
    setAnnualLoading(true)
    try {
      const data = await payrollApi.getAnnualSummary(empId, year)
      setAnnualData(data)
    } catch (err: any) {
      console.error('Error fetching annual salary:', err)
      setFeedbackMessage({ type: 'error', text: err.message || 'Lỗi khi tải bảng lương năm' })
    } finally {
      setAnnualLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'annual') {
      const targetEmpId = selectedAnnualEmployeeId || selectedPayroll?.employee_id || user?.employee_id
      if (targetEmpId) fetchAnnualSummary(targetEmpId, selectedYear)
    }
  }, [activeTab, selectedAnnualEmployeeId, selectedPayroll?.employee_id, user?.employee_id, selectedYear, fetchAnnualSummary])

  // Handle auto-clear feedback message
  useEffect(() => {
    if (feedbackMessage) {
      toast[feedbackMessage.type](feedbackMessage.text)
      const timer = setTimeout(() => setFeedbackMessage(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [feedbackMessage])

  // 1. RUN PAYROLL (Chốt công và tự động tính bảng lương)
  const handleRunPayroll = async () => {
    setActionLoading(true)
    try {
      const res = await payrollApi.calculate(selectedPeriod)
      setFeedbackMessage({
        type: 'success',
        text: `✓ ${res.message} (Đã tính ${res.total_employees_calculated} nhân sự | Quỹ lương: ${formatCurrency(res.total_gross_income)} | Thực chi: ${formatCurrency(res.total_net_salary)})`,
      })
      await fetchPayrolls()
    } catch (err: any) {
      setFeedbackMessage({ type: 'error', text: `Lỗi tính bảng lương: ${err.message}` })
    } finally {
      setActionLoading(false)
    }
  }

  // 2. CONFIRM ALL (Duyệt chốt toàn bộ bảng lương trong kỳ)
  const handleConfirmAll = async () => {
    setActionLoading(true)
    try {
      const res = await payrollApi.confirmAll(selectedPeriod)
      setFeedbackMessage({
        type: 'success',
        text: `✓ ${res.message}`,
      })
      await fetchPayrolls()
    } catch (err: any) {
      setFeedbackMessage({ type: 'error', text: `Lỗi duyệt bảng lương: ${err.message}` })
    } finally {
      setActionLoading(false)
    }
  }

  // 3. PAY ALL (Xác nhận chi trả toàn bộ bảng lương)
  const handlePayAll = async () => {
    setActionLoading(true)
    try {
      const res = await payrollApi.payAll(selectedPeriod)
      setFeedbackMessage({
        type: 'success',
        text: `✓ ${res.message}`,
      })
      await fetchPayrolls()
    } catch (err: any) {
      setFeedbackMessage({ type: 'error', text: `Lỗi chi trả bảng lương: ${err.message}` })
    } finally {
      setActionLoading(false)
    }
  }

  // 4. Update individual payroll status
  const handleUpdateSingleStatus = async (payrollId: number, newStatus: string) => {
    setActionLoading(true)
    try {
      await payrollApi.updateStatus(payrollId, newStatus)
      setFeedbackMessage({
        type: 'success',
        text: `✓ Đã cập nhật trạng thái phiếu lương #${payrollId} sang ${getStatusLabel(newStatus)}!`,
      })
      await fetchPayrolls()
    } catch (err: any) {
      setFeedbackMessage({ type: 'error', text: `Lỗi cập nhật trạng thái: ${err.message}` })
    } finally {
      setActionLoading(false)
    }
  }

  const handleSaveAdjustment = async (addition:number,deduction:number,reason:string) => {
    if(!adjustmentPayroll)return
    setActionLoading(true)
    try {
      await payrollApi.adjustDraft(adjustmentPayroll.payroll_id,addition,deduction,reason)
      setAdjustmentPayroll(null)
      setFeedbackMessage({type:'success',text:'Đã lưu điều chỉnh lương nháp, lý do đã được ghi audit.'})
      await fetchPayrolls()
    } catch(err:any) {
      setFeedbackMessage({type:'error',text:`Không thể lưu điều chỉnh: ${err.message}`})
    } finally { setActionLoading(false) }
  }

  const handleReopenPeriod = async (reason:string) => {
    setActionLoading(true)
    try {
      const result=await payrollApi.reopenPeriod(selectedPeriod,reason)
      setReopenDialogOpen(false)
      setFeedbackMessage({type:'success',text:result.message})
      await fetchPayrolls()
    } catch(err:any) {
      setFeedbackMessage({type:'error',text:`Không thể mở lại kỳ lương: ${err.message}`})
    } finally { setActionLoading(false) }
  }

  const handleUnconfirmPayroll = async (reason:string) => {
    if (!unconfirmPayroll) return
    setActionLoading(true)
    try {
      const result = await payrollApi.unconfirm(unconfirmPayroll.payroll_id, reason)
      setUnconfirmPayroll(null)
      setFeedbackMessage({ type: 'success', text: result.message })
      await fetchPayrolls()
    } catch (err: any) {
      setFeedbackMessage({ type: 'error', text: `Không thể hoàn tác duyệt phiếu: ${err.message}` })
    } finally {
      setActionLoading(false)
    }
  }

  // 5. Open Printable Monthly Payslip (Popup Overlay)
  const handleOpenMonthlyPrint = async (payroll: Payroll) => {
    if (!['CONFIRMED', 'PAID'].includes(payroll.payment_status || '')) {
      setFeedbackMessage({ type: 'error', text: 'Chỉ in phiếu lương sau khi đã duyệt.' })
      return
    }
    setSelectedPayroll(payroll)
    setActionLoading(true)
    try {
      const printData = await payrollApi.getPayslip(payroll.payroll_id)

      setMonthlyPrintData(printData)
      setIsMonthlyPrintModalOpen(true)
    } catch (err: any) {
      setFeedbackMessage({ type: 'error', text: `Lỗi tải dữ liệu in phiếu lương: ${err.message}` })
    } finally {
      setActionLoading(false)
    }
  }

  // 6. Open Printable Annual Payslip (Popup Overlay)
  const handleOpenAnnualPrint = async (empId: number) => {
    setActionLoading(true)
    try {
      const data = await payrollApi.getAnnualSummary(empId, selectedYear)
      setAnnualData(data)
      setIsAnnualPrintModalOpen(true)
    } catch (err: any) {
      setFeedbackMessage({ type: 'error', text: `Lỗi tải dữ liệu in bảng lương năm: ${err.message}` })
    } finally {
      setActionLoading(false)
    }
  }

  // Helper: Client-side CSV export fallback
  const exportPayrollsToCsv = (data: Payroll[], period: string) => {
    const headers = [
      'Mã NV', 'Họ và Tên', 'Cửa hàng', 'Chức vụ', 'Kỳ lương',
      'Công chuẩn', 'Công thực tế', 'Lương HĐ', 'Trừ thời gian', 'Lương CB thực',
      'PC Chức vụ', 'PC Thâm niên', 'PC Dự án', 'PC Cơm xe',
      'Hoa hồng', 'Tổng thưởng', 'Tổng Gross', 'Bảo hiểm (10.5%)', 'Phạt trễ', 'Tổng giảm trừ', 'Thực lĩnh (NET)', 'Trạng thái'
    ]
    const rows = data.map(p => [
      p.employee_code || '',
      `"${(p.employee_name || '').replace(/"/g, '""')}"`,
      `"${(p.store_name || '').replace(/"/g, '""')}"`,
      `"${(p.position_name || '').replace(/"/g, '""')}"`,
      p.salary_period || period,
      p.standard_working_days ?? 0,
      p.actual_working_days ?? 0,
      p.contract_salary ?? 0,
      p.time_deduction_amount ?? 0,
      p.actual_base_salary ?? 0,
      p.position_allowance ?? 0,
      p.seniority_allowance ?? 0,
      p.project_allowance ?? 0,
      p.meal_transport_allowance ?? 0,
      p.commission_amount ?? 0,
      p.bonus_amount ?? 0,
      p.gross_income ?? 0,
      p.total_insurance ?? 0,
      p.penalty_deduction ?? 0,
      p.total_deduction ?? 0,
      p.net_salary ?? 0,
      `"${getStatusLabel(p.payment_status)}"`
    ])
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Bang_Luong_TechZone_${period}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  // 7. Export Excel
  const handleExportExcel = async () => {
    try {
      const blob = await payrollApi.exportExcel(selectedPeriod)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Bang_Luong_TechZone_${selectedPeriod}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
      setFeedbackMessage({ type: 'success', text: `✓ Đã xuất file Excel bảng lương kỳ ${selectedPeriod} thành công!` })
    } catch (err: any) {
      try {
        exportPayrollsToCsv(filteredPayrolls.length > 0 ? filteredPayrolls : payrolls, selectedPeriod)
        setFeedbackMessage({ type: 'success', text: `✓ Đã xuất dữ liệu bảng lương kỳ ${selectedPeriod} (định dạng CSV) thành công!` })
      } catch (fallbackErr: any) {
        setFeedbackMessage({ type: 'error', text: `Lỗi xuất file: ${err.message}` })
      }
    }
  }

  // 8. Export CSV
  const handleExportCsv = async () => {
    try {
      const blob = await payrollApi.exportCsv(selectedPeriod)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Bang_Luong_TechZone_${selectedPeriod}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
      setFeedbackMessage({ type: 'success', text: `✓ Đã xuất file CSV bảng lương kỳ ${selectedPeriod} thành công!` })
    } catch (err: any) {
      try {
        exportPayrollsToCsv(filteredPayrolls.length > 0 ? filteredPayrolls : payrolls, selectedPeriod)
        setFeedbackMessage({ type: 'success', text: `✓ Đã xuất file CSV bảng lương kỳ ${selectedPeriod} thành công!` })
      } catch (fallbackErr: any) {
        setFeedbackMessage({ type: 'error', text: `Lỗi xuất file CSV: ${err.message}` })
      }
    }
  }

  // Filtered payrolls
  const filteredPayrolls = useMemo(() => {
    return payrolls.filter(p => {
      const matchSearch = searchTerm
        ? (p.employee_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
           p.employee_code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
           p.store_name?.toLowerCase().includes(searchTerm.toLowerCase()))
        : true

      const matchStatus = statusFilter === 'all' ? true : p.payment_status === statusFilter
      return matchSearch && matchStatus
    })
  }, [payrolls, searchTerm, statusFilter])

  // Quick Metrics
  const metrics = useMemo(() => {
    const totalGross = payrolls.reduce((sum, p) => sum + (p.gross_income || 0), 0)
    const totalNet = payrolls.reduce((sum, p) => sum + (p.net_salary || 0), 0)
    const totalInsurance = payrolls.reduce((sum, p) => sum + (p.total_insurance || 0), 0)
    const paidCount = payrolls.filter(p => p.payment_status === 'PAID').length
    const confirmedCount = payrolls.filter(p => p.payment_status === 'CONFIRMED').length
    const draftCount = payrolls.filter(p => p.payment_status === 'DRAFT').length
    const needsRecalculationCount = payrolls.filter(p => p.payment_status === 'NEEDS_RECALCULATION').length
    const totalEmployees = payrolls.length

    return {
      totalGross,
      totalNet,
      totalInsurance,
      paidCount,
      confirmedCount,
      draftCount,
      needsRecalculationCount,
      totalEmployees,
      completionRate: totalEmployees > 0 ? Math.round((paidCount / totalEmployees) * 100) : 0,
    }
  }, [payrolls])

  // Current active employee's personal payroll for non-manager view
  const myPayroll = useMemo(() => {
    return payrolls.find(p => p.employee_id === user?.employee_id) || payrolls[0] || null
  }, [payrolls, user?.employee_id])

  return (
    <div className="page-container">
      {/* Toast Feedback */}
      {feedbackMessage && (
        <div
          className={`alert ${feedbackMessage.type === 'success' ? 'alert-success' : 'alert-danger'}`}
          style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {feedbackMessage.type === 'success' ? Icons.checkCircle : Icons.alertCircle}
            <span>{feedbackMessage.text}</span>
          </div>
          <button
            className="modal-close"
            onClick={() => setFeedbackMessage(null)}
            title="Đóng thông báo"
            style={{ padding: '4px' }}
          >
            {Icons.close}
          </button>
        </div>
      )}

      {/* Page Header Synchronized with System Standards */}
      <div className="page-header no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 className="page-title">Quản Lý Bảng Lương</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px' }}>
            Tính lương tự động, trích nộp bảo hiểm 10.5% và khấu trừ nghỉ phép toàn chuỗi cửa hàng
          </p>
        </div>

        {/* 2 Centered Balanced Tabs: Tháng & Năm */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div className="payroll-segmented-tabs" style={{ margin: 0 }}>
            <button
              type="button"
              className={`payroll-tab-button ${activeTab === 'monthly' ? 'active' : ''}`}
              onClick={() => setActiveTab('monthly')}
            >
              {Icons.calendar}
              <span>Bảng Lương Tháng</span>
            </button>
            <button
              type="button"
              className={`payroll-tab-button ${activeTab === 'annual' ? 'active' : ''}`}
              onClick={() => setActiveTab('annual')}
            >
              {Icons.chart}
              <span>Bảng Lương Năm</span>
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: BẢNG LƯƠNG THÁNG */}
      {/* ========================================================================= */}
      {activeTab === 'monthly' && (
        <div className="no-print" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Sub Toolbar: Month Selector & Batch Actions */}
          <div className="card" style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setIsAttendanceRulesOpen(true)} title="Xem quy định chấm công và đối chiếu giờ công">
                {Icons.clock}
                Quy định chấm công
              </button>
              <span className="text-secondary" style={{ fontSize: '13px', fontWeight: 600 }}>Kỳ tính lương:</span>
              <select
                className="form-select"
                value={selectedPeriod}
                onChange={(e) => setSelectedPeriod(e.target.value)}
                style={{ width: 'auto', minWidth: '150px' }}
              >
                {Array.from({ length: 12 }, (_, i) => {
                  const d = new Date()
                  d.setMonth(d.getMonth() - i)
                  const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
                  return (
                    <option key={val} value={val}>
                      Tháng {d.getMonth() + 1}/{d.getFullYear()}
                    </option>
                  )
                })}
              </select>
            </div>

            {/* Actions for Manager / HR */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              {canRunPayroll && (
                <>
                  <button
                    className="btn btn-primary"
                    onClick={()=>setConfirmation({message:`Tính bảng lương kỳ ${selectedPeriod} theo OT đã duyệt?`,action:handleRunPayroll})}
                    disabled={actionLoading}
                    style={{ backgroundColor: '#2563eb' }}
                  >
                    {Icons.clock}
                    {actionLoading ? 'Đang tính...' : 'Chốt & Tính Lương'}
                  </button>

                  <button
                    className="btn btn-secondary"
                    onClick={()=>setConfirmation({message:`Duyệt chính thức các phiếu nháp kỳ ${selectedPeriod}?`,action:handleConfirmAll})}
                    disabled={actionLoading || metrics.draftCount === 0}
                    title="Duyệt chính thức các bản ghi DRAFT"
                  >
                    {Icons.check}
                    Duyệt tất cả
                  </button>

                  <button
                    className="btn btn-secondary"
                    onClick={()=>setConfirmation({message:`Xác nhận đã chi trả các phiếu được duyệt kỳ ${selectedPeriod}?`,action:handlePayAll})}
                    disabled={actionLoading || (metrics.draftCount === 0 && metrics.confirmedCount === 0)}
                    title="Xác nhận đã chi trả chuyển khoản"
                  >
                    {Icons.dollar}
                    Chi trả tất cả
                  </button>
                  <button className="btn btn-secondary" onClick={()=>setReopenDialogOpen(true)}
                    disabled={actionLoading || (metrics.paidCount===0 && metrics.confirmedCount===0)}
                    title={`Mở lại toàn kỳ ${selectedPeriod} để rà soát Attendance và tính lại`}>
                    {Icons.undo} Mở lại kỳ lương
                  </button>
                </>
              )}

              {/* Actions & Export Buttons */}
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => setIsPayrollRegulationOpen(true)}
                  title="Xem quy chế & công thức tính lương TechZone Retail"
                >
                  <span style={{ fontStyle: 'italic', fontWeight: 700, fontFamily: 'serif' }}>i</span>
                  Quy chế tính lương
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={handleExportExcel}
                  title="Xuất bảng lương tháng ra file Excel"
                >
                  {Icons.fileText}
                  Excel
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={handleExportCsv}
                  title="Xuất file CSV"
                >
                  CSV
                </button>
              </div>
            </div>
          </div>

          {canRunPayroll&&<PayrollOvertimePanel period={selectedPeriod}/>}

          {/* 4 Balanced Stat Cards for the Month */}
          <div className="stat-grid-4">
            <StatCard
              icon={Icons.wallet}
              iconColor="blue"
              label="TỔNG QUỸ LƯƠNG GROSS"
              value={formatCurrency(metrics.totalGross)}
              footerNote={`Kỳ ${selectedPeriod} (${metrics.totalEmployees} nhân sự)`}
            />
            <StatCard
              icon={Icons.dollar}
              iconColor="green"
              label="TỔNG THỰC CHI NET"
              value={formatCurrency(metrics.totalNet)}
              footerNote={`Tỷ lệ chi trả: ${metrics.completionRate}% hoàn tất`}
            />
            <StatCard
              icon={Icons.shield}
              iconColor="amber"
              label="TRÍCH NỘP BẢO HIỂM (10.5%)"
              value={formatCurrency(metrics.totalInsurance)}
              footerNote="BHXH 8%, BHYT 1.5%, BHTN 1%"
            />
            <StatCard
              icon={Icons.users}
              iconColor="blue"
              label="TIẾN ĐỘ DUYỆT & CHI TRẢ"
              value={`${metrics.paidCount + metrics.confirmedCount} / ${metrics.totalEmployees}`}
              footerNote={`Nháp: ${metrics.draftCount} | Cần tính lại: ${metrics.needsRecalculationCount} | Duyệt: ${metrics.confirmedCount} | Trả: ${metrics.paidCount}`}
            />
          </div>

          {/* MAIN VIEW: MANAGER/HR TABLE OR REGULAR EMPLOYEE SUMMARY CARD */}
          {canManage ? (
            <div className="card" style={{ overflow: 'hidden' }}>
              {/* Search & Filter Toolbar */}
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flex: 1, minWidth: '260px' }}>
                  <div style={{ position: 'relative', width: '100%', maxWidth: '320px' }}>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Tìm theo tên nhân viên, mã NV..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      style={{ paddingLeft: '32px' }}
                    />
                    <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }}>
                      {Icons.search}
                    </span>
                  </div>

                  <select
                    className="form-select"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as any)}
                    style={{ width: 'auto' }}
                  >
                    <option value="all">Tất cả trạng thái</option>
                    <option value="DRAFT">Bản nháp (DRAFT)</option>
                    <option value="NEEDS_RECALCULATION">Cần tính lại</option>
                    <option value="CONFIRMED">Đã duyệt (CONFIRMED)</option>
                    <option value="PAID">Đã chi trả (PAID)</option>
                  </select>
                </div>

                <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  Hiển thị <strong>{filteredPayrolls.length}</strong> / {payrolls.length} nhân sự
                </div>
              </div>

              {/* Table */}
              <div style={{ overflowX: 'auto' }}>
                {isLoading ? (
                  <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-secondary)' }}>
                    Đang tải dữ liệu bảng lương kỳ {selectedPeriod}...
                  </div>
                ) : filteredPayrolls.length === 0 ? (
                  <div style={{ padding: '48px 24px' }}>
                    <EmptyState
                      icon={Icons.fileText}
                      title="Chưa có dữ liệu bảng lương"
                      description={`Kỳ ${selectedPeriod} chưa được chốt lương hoặc không có bản ghi phù hợp. Nhấn nút 'Chốt & Tính Lương' phía trên để chạy hệ thống.`}
                    />
                  </div>
                ) : (
                  <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ background: 'var(--surface-subtle)', borderBottom: '1px solid var(--border-default)' }}>
                        <th style={{ padding: '12px 14px', textAlign: 'left' }}>Nhân viên</th>
                        <th style={{ padding: '12px 10px', textAlign: 'center' }}>Công chuẩn/thực</th>
                        <th style={{ padding: '12px 10px', textAlign: 'center' }}>Nghỉ phép</th>
                        <th style={{ padding: '12px 12px', textAlign: 'right' }}>Lương HĐ</th>
                        <th style={{ padding: '12px 12px', textAlign: 'right' }}>Lương CB thực</th>
                        <th style={{ padding: '12px 12px', textAlign: 'right' }}>Phụ cấp & Thưởng</th>
                        <th style={{ padding: '12px 12px', textAlign: 'right', fontWeight: 700 }}>Tổng Gross</th>
                        <th style={{ padding: '12px 12px', textAlign: 'right' }}>BHXH (10.5%)</th>
                        <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 800, color: 'var(--status-success)' }}>THỰC LĨNH (NET)</th>
                        <th style={{ padding: '12px 10px', textAlign: 'center' }}>Trạng thái</th>
                        <th style={{ padding: '12px 14px', textAlign: 'center' }}>Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPayrolls.map((pr) => {
                        const totalAllowances = (pr.position_allowance || 0) + (pr.seniority_allowance || 0) + (pr.project_allowance || 0) + (pr.meal_transport_allowance || 0)
                        const totalAdditions = totalAllowances + (pr.commission_amount || 0) + (pr.bonus_amount || 0)
                        return (
                          <tr
                            key={pr.payroll_id}
                            style={{
                              borderBottom: '1px solid var(--border-subtle)',
                              transition: 'background-color 0.15s ease',
                            }}
                            className="table-row-hover"
                          >
                            {/* Employee */}
                            <td style={{ padding: '12px 14px' }}>
                              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{pr.employee_name}</div>
                              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                <span style={{ fontFamily: 'var(--font-mono)' }}>{pr.employee_code}</span> • {pr.position_name} • {pr.store_name || 'Trụ sở'}
                              </div>
                            </td>

                            {/* Working days */}
                            <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                              <div style={{ fontWeight: 600 }}>{pr.actual_working_days ?? '—'} / {pr.standard_working_days ?? '—'}</div>
                              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>ngày công theo lương</div>
                              <div title="Tổng hợp trực tiếp từ Attendance" style={{ marginTop:4,fontSize:'10px',lineHeight:1.5,color:'var(--text-secondary)' }}>
                                {Number(pr.attendance_hours||0).toFixed(1)}h · trễ {pr.attendance_late_minutes||0}p · OT duyệt {Number(pr.attendance_approved_overtime_hours||0).toFixed(1)}h
                              </div>
                            </td>

                            {/* Leaves */}
                            <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'center' }}>
                                <span style={{ fontSize: '11px', color: 'var(--blue-600)' }} title="Phép năm hưởng lương">
                                  Có lương: {pr.paid_leave_days || 0}
                                </span>
                                {(pr.unpaid_leave_days || 0) > 0 ? (
                                  <span style={{ fontSize: '11px', color: 'var(--status-error)', fontWeight: 600 }} title="Nghỉ không lương (trừ lương)">
                                    Không lương: {pr.unpaid_leave_days}
                                  </span>
                                ) : (
                                  <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Không lương: 0</span>
                                )}
                              </div>
                            </td>

                            {/* Contract salary */}
                            <td style={{ padding: '12px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                              {formatCurrency(pr.contract_salary)}
                            </td>

                            {/* Actual base salary */}
                            <td style={{ padding: '12px 12px', textAlign: 'right', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                              {formatCurrency(pr.actual_base_salary)}
                            </td>

                            {/* Additions */}
                            <td style={{ padding: '12px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                              {formatCurrency(totalAdditions)}
                            </td>

                            {/* Gross */}
                            <td style={{ padding: '12px 12px', textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                              {formatCurrency(pr.gross_income)}
                            </td>

                            {/* Insurance */}
                            <td style={{ padding: '12px 12px', textAlign: 'right', color: 'var(--status-error)', fontFamily: 'var(--font-mono)' }}>
                              -{formatCurrency(pr.total_insurance)}
                            </td>

                            {/* Net */}
                            <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 800, color: 'var(--status-success)', fontSize: '14px', fontFamily: 'var(--font-mono)' }}>
                              {formatCurrency(pr.net_salary)}
                            </td>

                            {/* Status */}
                            <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                              <span className={`badge ${getStatusBadgeClass(pr.payment_status)}`}>
                                {getStatusLabel(pr.payment_status)}
                              </span>
                            </td>

                            {/* Actions */}
                            <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                              <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                                {canRunPayroll && pr.payment_status === 'DRAFT' && <button className="btn btn-secondary btn-sm btn-icon" title="Điều chỉnh lương nháp" aria-label={`Điều chỉnh lương ${pr.employee_name}`} onClick={()=>setAdjustmentPayroll(pr)}>{Icons.edit}</button>}
                                {/* Open A4 PDF Payslip Popup Overlay */}
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => handleOpenMonthlyPrint(pr)}
                                  disabled={!['CONFIRMED','PAID'].includes(pr.payment_status || '')}
                                  title={pr.payment_status==='DRAFT'?'Chỉ in sau khi duyệt':'Xem trước & In phiếu lương (PDF)'}
                                >
                                  {Icons.printer}
                                  <span style={{ fontSize: '11px', marginLeft: '4px' }}>In PDF</span>
                                </button>

                                {/* Quick Confirm / Pay */}
                                {canRunPayroll && pr.payment_status === 'DRAFT' && (
                                  <button
                                    className="btn btn-sm"
                                    style={{ backgroundColor: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe' }}
                                    onClick={() => handleUpdateSingleStatus(pr.payroll_id, 'CONFIRMED')}
                                    title="Duyệt phiếu lương (DRAFT -> CONFIRMED)"
                                  >
                                    {Icons.check}
                                  </button>
                                )}

                                {canRunPayroll && pr.payment_status === 'CONFIRMED' && (
                                  <>
                                    <button
                                      className="btn btn-sm"
                                      style={{ backgroundColor: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}
                                      onClick={() => handleUpdateSingleStatus(pr.payroll_id, 'PAID')}
                                      title="Xác nhận chi trả (CONFIRMED -> PAID)"
                                      aria-label={`Xác nhận chi trả phiếu ${pr.employee_name}`}
                                    >
                                      {Icons.dollar}
                                    </button>
                                    <button
                                      className="btn btn-secondary btn-sm btn-icon"
                                      onClick={() => setUnconfirmPayroll(pr)}
                                      title="Hoàn tác duyệt phiếu về DRAFT"
                                      aria-label={`Hoàn tác duyệt phiếu ${pr.employee_name}`}
                                    >
                                      {Icons.undo}
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          ) : (
            /* Regular Employee Personal Monthly View */
            <div className="card" style={{ maxWidth: '780px', margin: '0 auto', width: '100%', overflow: 'hidden' }}>
              {myPayroll ? (
                <div>
                  <div style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)', color: '#ffffff', padding: '24px 28px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px', opacity: 0.9, fontWeight: 700 }}>
                            TECHZONE RETAIL
                          </span>
                          <button
                            type="button"
                            onClick={() => setIsPayrollRegulationOpen(true)}
                            title="Xem chi tiết cách tính lương"
                            style={{
                              width: '20px',
                              height: '20px',
                              borderRadius: '50%',
                              background: 'rgba(255, 255, 255, 0.22)',
                              border: '1px solid rgba(255, 255, 255, 0.5)',
                              color: '#ffffff',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                              padding: 0,
                              fontSize: '11px',
                              fontWeight: 700,
                              fontStyle: 'italic',
                              fontFamily: 'serif',
                              lineHeight: 1,
                              boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                              transition: 'all 0.2s ease',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.45)'
                              e.currentTarget.style.transform = 'scale(1.1)'
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.22)'
                              e.currentTarget.style.transform = 'scale(1)'
                            }}
                          >
                            i
                          </button>
                        </div>
                        <div style={{ fontSize: '20px', fontWeight: 800, marginTop: '4px' }}>Phiếu Lương Kỳ {selectedPeriod}</div>
                        <div style={{ fontSize: '13px', opacity: 0.9, marginTop: '4px' }}>
                          Nhân viên: <strong>{myPayroll.employee_name}</strong> ({myPayroll.employee_code})
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span className={`badge ${getStatusBadgeClass(myPayroll.payment_status)}`} style={{ padding: '6px 14px' }}>
                          {getStatusLabel(myPayroll.payment_status)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', padding: '20px', gap: '16px', background: 'var(--surface-subtle)', borderBottom: '1px solid var(--border-default)' }}>
                    <div>
                      <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>TỔNG GROSS</div>
                      <div style={{ fontSize: '20px', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>{formatCurrency(myPayroll.gross_income)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>GIẢM TRỪ & BẢO HIỂM</div>
                      <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--status-error)', fontFamily: 'var(--font-mono)' }}>-{formatCurrency(myPayroll.total_deduction)}</div>
                    </div>
                    <div style={{ background: 'rgba(34, 197, 94, 0.1)', padding: '8px 12px', borderRadius: '6px' }}>
                      <div style={{ fontSize: '12px', color: 'var(--status-success)', fontWeight: 700, textTransform: 'uppercase' }}>THỰC LĨNH (NET)</div>
                      <div style={{ fontSize: '22px', fontWeight: 900, color: 'var(--status-success)', fontFamily: 'var(--font-mono)' }}>{formatCurrency(myPayroll.net_salary)}</div>
                    </div>
                  </div>

                  <div style={{ padding: '20px', display: 'flex', justifyContent: 'center' }}>
                    <button
                      className="btn btn-primary"
                      onClick={() => handleOpenMonthlyPrint(myPayroll)}
                      style={{ padding: '10px 24px', fontSize: '14px' }}
                    >
                      {Icons.printer}
                      Xem Chi Tiết & In Phiếu Lương (PDF)
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ padding: '48px', textAlign: 'center' }}>
                  <EmptyState
                    icon={Icons.fileText}
                    title="Chưa có phiếu lương"
                    description={`Chưa có dữ liệu bảng lương cho kỳ ${selectedPeriod}. Vui lòng liên hệ Phòng Nhân sự.`}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: BẢNG LƯƠNG NĂM (ANNUAL SUMMARY) */}
      {/* ========================================================================= */}
      {activeTab === 'annual' && (
        <div className="no-print" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Annual Controls Toolbar */}
          <div className="card" style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="text-secondary" style={{ fontSize: '13px', fontWeight: 600 }}>Năm báo cáo:</span>
                <select
                  className="form-select"
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  style={{ width: 'auto', minWidth: '110px' }}
                >
                  {['2026', '2025', '2024'].map(yr => (
                    <option key={yr} value={yr}>Năm {yr}</option>
                  ))}
                </select>
              </div>

              {/* If Manager, allow choosing employee */}
              {canManage && payrolls.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="text-secondary" style={{ fontSize: '13px', fontWeight: 600 }}>Nhân sự:</span>
                  <select
                    className="form-select"
                    value={selectedAnnualEmployeeId}
                    onChange={(e) => setSelectedAnnualEmployeeId(Number(e.target.value))}
                    style={{ width: 'auto', minWidth: '220px' }}
                  >
                    {payrolls.map(p => (
                      <option key={p.employee_id} value={p.employee_id}>
                        {p.employee_name} ({p.employee_code}) - {p.position_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Print Annual Sheet Button */}
            <button
              className="btn btn-primary"
              onClick={() => handleOpenAnnualPrint(selectedAnnualEmployeeId || selectedPayroll?.employee_id || user?.employee_id)}
              disabled={annualLoading || !annualData || !(selectedAnnualEmployeeId || selectedPayroll?.employee_id || user?.employee_id)}
            >
              {Icons.printer}
              In Bảng Lương Năm (PDF)
            </button>
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
                  footerNote="Thu nhập thực tế chuyển khoản"
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
                  footerNote="Tính theo các tháng đã thanh toán"
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
                  <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
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
                      </tr>
                    </thead>
                    <tbody>
                      {annualData.monthly_records && annualData.monthly_records.length > 0 ? (
                        annualData.monthly_records.map((rec: any, idx: number) => {
                          const gross = rec.gross_income ?? 0
                          const net = rec.net_salary ?? 0
                          const ins = rec.total_insurance ?? 0
                          const base = rec.actual_base_salary ?? 0
                          const allowances = (rec.position_allowance || 0) + (rec.seniority_allowance || 0) + (rec.project_allowance || 0) + (rec.meal_transport_allowance || 0)

                          return (
                            <tr key={idx} style={{ borderBottom: '1px solid var(--border-subtle)' }} className="table-row-hover">
                              <td style={{ padding: '12px 14px', fontWeight: 600 }}>
                                {rec.salary_period ? `Tháng ${parseInt(rec.salary_period.split('-')[1], 10)}/${rec.salary_period.split('-')[0]}` : rec.month_name || `Kỳ ${idx + 1}`}
                              </td>
                              <td style={{ padding: '12px 10px', textAlign: 'center' }}>{rec.actual_working_days ?? '-'}</td>
                              <td style={{ padding: '12px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatCurrency(base)}</td>
                              <td style={{ padding: '12px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatCurrency(allowances)}</td>
                              <td style={{ padding: '12px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatCurrency(rec.commission_amount)}</td>
                              <td style={{ padding: '12px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatCurrency(rec.bonus_amount)}</td>
                              <td style={{ padding: '12px 12px', textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{formatCurrency(gross)}</td>
                              <td style={{ padding: '12px 12px', textAlign: 'right', color: 'var(--status-error)', fontFamily: 'var(--font-mono)' }}>-{formatCurrency(ins)}</td>
                              <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 800, color: 'var(--status-success)', fontFamily: 'var(--font-mono)' }}>{formatCurrency(net)}</td>
                              <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                                <span className={`badge ${getStatusBadgeClass(rec.payment_status)}`}>
                                  {getStatusLabel(rec.payment_status)}
                                </span>
                              </td>
                            </tr>
                          )
                        })
                      ) : (
                        <tr>
                          <td colSpan={10} style={{ padding: '36px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                            Chưa có dữ liệu bảng lương trong năm {selectedYear}
                          </td>
                        </tr>
                      )}
                    </tbody>
                    {/* Annual Summary Row */}
                    {annualData.monthly_records && annualData.monthly_records.length > 0 && (
                      <tfoot>
                        <tr style={{ background: 'var(--surface-subtle)', fontWeight: 800, borderTop: '2px solid var(--border-default)' }}>
                          <td style={{ padding: '14px' }}>TỔNG CỘNG ({selectedYear})</td>
                          <td style={{ padding: '14px', textAlign: 'center' }}>-</td>
                          <td style={{ padding: '14px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>-</td>
                          <td style={{ padding: '14px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>-</td>
                          <td style={{ padding: '14px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatCurrency(annualData.total_commission_year)}</td>
                          <td style={{ padding: '14px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatCurrency(annualData.total_bonus_year)}</td>
                          <td style={{ padding: '14px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatCurrency(annualData.total_gross_income_year)}</td>
                          <td style={{ padding: '14px', textAlign: 'right', color: 'var(--status-error)', fontFamily: 'var(--font-mono)' }}>-{formatCurrency(annualData.total_insurance_deducted_year)}</td>
                          <td style={{ padding: '14px', textAlign: 'right', color: 'var(--status-success)', fontSize: '15px', fontFamily: 'var(--font-mono)' }}>{formatCurrency(annualData.total_net_salary_year)}</td>
                          <td style={{ padding: '14px', textAlign: 'center' }}>✓</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="card" style={{ padding: '48px', textAlign: 'center' }}>
              <EmptyState
                icon={Icons.chart}
                title="Chưa có dữ liệu năm"
                description={`Không tìm thấy bản ghi thu nhập năm ${selectedYear}. Vui lòng chọn năm khác.`}
              />
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* Modal quy định chấm công và quy chế tính lương */}
      {/* ========================================================================= */}
      {confirmation&&<div className="modal-overlay no-print"><div className="modal" role="alertdialog" aria-modal="true" aria-label="Xác nhận thao tác bảng lương" style={{maxWidth:440,padding:24}}><h2>Xác nhận bảng lương</h2><p>{confirmation.message}</p><div className="modal-footer"><button className="btn btn-secondary" onClick={()=>setConfirmation(null)}>Hủy</button><button className="btn btn-primary" onClick={()=>{const action=confirmation.action;setConfirmation(null);void action()}}>Xác nhận</button></div></div></div>}
      {reopenDialogOpen&&<PayrollReopenDialog period={selectedPeriod} busy={actionLoading} onClose={()=>setReopenDialogOpen(false)} onSubmit={handleReopenPeriod}/>}
      {unconfirmPayroll&&<PayrollUnconfirmDialog payroll={unconfirmPayroll} busy={actionLoading} onClose={()=>setUnconfirmPayroll(null)} onSubmit={handleUnconfirmPayroll}/>}
      {adjustmentPayroll&&<PayrollAdjustmentDialog payroll={adjustmentPayroll} busy={actionLoading} onClose={()=>setAdjustmentPayroll(null)} onSave={handleSaveAdjustment}/>}
      {isAttendanceRulesOpen && <AttendanceRegulationDialog onClose={() => setIsAttendanceRulesOpen(false)} />}
      {isPayrollRegulationOpen && <PayrollRegulationDialog onClose={() => setIsPayrollRegulationOpen(false)} />}

      {/* ========================================================================= */}
      {/* MODAL 2: PRINTABLE MONTHLY PAYSLIP POPUP OVERLAY (PDF / A4) */}
      {/* ========================================================================= */}
      {isMonthlyPrintModalOpen && monthlyPrintData && (
        <div className="modal-overlay print-active-overlay" onClick={() => setIsMonthlyPrintModalOpen(false)}>
          <div className="modal print-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '880px', padding: '0', maxHeight: '92vh' }}>
            {/* Modal Header */}
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
                {/* Header */}
                <div className="payslip-a4-header">
                  <div>
                    <div className="payslip-a4-company-name">{monthlyPrintData.company?.name || 'TECHZONE RETAIL'}</div>
                    {monthlyPrintData.company?.address&&<div className="payslip-a4-company-sub">Địa chỉ: {monthlyPrintData.company.address}</div>}
                    {monthlyPrintData.company?.tax_id&&<div className="payslip-a4-company-sub">Mã số thuế: {monthlyPrintData.company.tax_id}</div>}
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
                  <div className="payslip-a4-period-subtitle">Kỳ tính lương: {monthlyPrintData.salary_period} • Đơn vị tiền tệ: Việt Nam Đồng (VNĐ)</div>
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

                {/* Attendance Summary Bar (Synced with Attendance & Leaves) */}
                <div className="payslip-a4-attendance-summary" style={{ marginBottom: '10px', fontSize: '11px', background: '#f8fafc', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '6px', lineHeight: 1.4 }}>
                  <div style={{ fontWeight: 700, color: '#1e3a8a', marginBottom: '3px', textTransform: 'uppercase', fontSize: '11px', letterSpacing: '0.5px' }}>
                    THỐNG KÊ NGÀY CÔNG & NGHỈ PHÉP (LIÊN KẾT CHẤM CÔNG & ĐƠN NGHỈ PHÉP)
                  </div>
            <div className="payslip-attendance-values">
                    <div>{Icons.calendar} Công chuẩn: <strong>{monthlyPrintData.attendance?.standard_working_days ?? selectedPayroll?.standard_working_days ?? '—'}</strong> ngày</div>
                    <div>{Icons.checkCircle} Công thực tế: <strong>{monthlyPrintData.attendance?.actual_working_days ?? selectedPayroll?.actual_working_days ?? '—'}</strong> ngày</div>
                    <div>{Icons.leave} Phép năm có lương: <strong style={{ color: '#2563eb' }}>{monthlyPrintData.attendance?.paid_leave_days ?? selectedPayroll?.paid_leave_days ?? 0}</strong> ngày</div>
                    <div>
                      {Icons.minusCircle} Nghỉ không lương: <strong style={{ color: (monthlyPrintData.attendance?.unpaid_leave_days ?? selectedPayroll?.unpaid_leave_days ?? 0) > 0 ? '#dc2626' : 'inherit' }}>
                        {monthlyPrintData.attendance?.unpaid_leave_days ?? selectedPayroll?.unpaid_leave_days ?? 0} ngày
                      </strong>
                    </div>
                    {(monthlyPrintData.attendance?.unworked_hours ?? selectedPayroll?.unworked_hours ?? 0) > 0 && (
                      <div>{Icons.clock} Giờ trễ/thiếu: <strong style={{ color: '#dc2626' }}>{monthlyPrintData.attendance?.unworked_hours ?? selectedPayroll?.unworked_hours} giờ</strong></div>
                    )}
                    {monthlyPrintData.attendance?.actual_work_hours!==undefined&&<div>{Icons.clock} Giờ công thực tế: <strong>{monthlyPrintData.attendance.actual_work_hours}</strong></div>}
                    {monthlyPrintData.attendance?.late_minutes!==undefined&&<div>Đi trễ: <strong>{monthlyPrintData.attendance.late_minutes}</strong> phút</div>}
                    {monthlyPrintData.attendance?.early_minutes!==undefined&&<div>Về sớm: <strong>{monthlyPrintData.attendance.early_minutes}</strong> phút</div>}
                    {monthlyPrintData.attendance?.actual_overtime_hours!==undefined&&<div>OT thực tế: <strong>{monthlyPrintData.attendance.actual_overtime_hours}</strong> giờ</div>}
                    {monthlyPrintData.attendance?.ot_source==='APPROVED'&&<div>OT được duyệt: <strong>{monthlyPrintData.attendance.approved_overtime_hours}</strong> giờ</div>}
                    {monthlyPrintData.attendance?.ot_source==='LEGACY_UNVERIFIED'&&<div>OT kỳ cũ: <strong>Chưa có dữ liệu duyệt</strong></div>}
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
                            {formatCurrency(monthlyPrintData.summary?.gross_income ?? selectedPayroll?.gross_income)}
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
                            -{formatCurrency(monthlyPrintData.summary?.total_deduction ?? selectedPayroll?.total_deduction)}
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
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: PRINTABLE ANNUAL SALARY SHEET POPUP OVERLAY (PDF / A4) */}
      {/* ========================================================================= */}
      {isAnnualPrintModalOpen && annualData && (
        <div className="modal-overlay print-active-overlay" onClick={() => setIsAnnualPrintModalOpen(false)}>
          <div className="modal print-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '900px', padding: '0', maxHeight: '92vh' }}>
            {/* Header */}
            <div className="modal-header no-print">
              <h2 className="modal-title" style={{ fontSize: '16px' }}>
                Bản In Bảng Lương Năm {annualData.salary_year || selectedYear} (Khổ A4)
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
                <div className="payslip-a4-header">
                  <div>
                    <div className="payslip-a4-company-name">{annualData.company?.name || 'CÔNG TY TNHH TM DV TECH ZONE'}</div>
                    <div className="payslip-a4-company-sub">Địa chỉ: {annualData.company?.address}</div>
                    <div className="payslip-a4-company-sub">Mã số thuế: {annualData.company?.tax_id} • Hotline: {annualData.company?.hotline}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>BÁO CÁO NĂM: {annualData.salary_year || selectedYear}</div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>NGÀY XUẤT: {annualData.generated_date}</div>
                  </div>
                </div>

                <div className="payslip-a4-title-box">
                  <div className="payslip-a4-main-title">BẢNG TỔNG HỢP THU NHẬP NĂM {annualData.salary_year || selectedYear}</div>
                  <div className="payslip-a4-period-subtitle">Phục vụ quyết toán thuế TNCN và lưu trữ hồ sơ nhân sự TechZone</div>
                </div>

                <div className="payslip-a4-info-grid">
                  <div>Họ và tên: <strong>{annualData.employee?.full_name}</strong></div>
                  <div>Mã nhân viên: <strong>{annualData.employee?.employee_code}</strong></div>
                  <div>Vị trí: <strong>{annualData.employee?.position}</strong></div>
                  <div>Chi nhánh: <strong>{annualData.employee?.store_name}</strong></div>
                  <div>Số CMND/CCCD: <strong>{annualData.employee?.id_card_number || '-'}</strong></div>
                  <div>Mã số thuế cá nhân: <strong>{annualData.employee?.tax_code || '-'}</strong></div>
                </div>

                <table className="payslip-a4-table" style={{ fontSize: '11.5px' }}>
                  <thead>
                    <tr>
                      <th>Kỳ tháng</th>
                      <th style={{ textAlign: 'center' }}>Công</th>
                      <th style={{ textAlign: 'right' }}>Lương CB</th>
                      <th style={{ textAlign: 'right' }}>Phụ cấp</th>
                      <th style={{ textAlign: 'right' }}>Hoa hồng</th>
                      <th style={{ textAlign: 'right' }}>Thưởng</th>
                      <th style={{ textAlign: 'right' }}>Tổng Gross</th>
                      <th style={{ textAlign: 'right' }}>Bảo hiểm</th>
                      <th style={{ textAlign: 'right' }}>Thực lĩnh NET</th>
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
                          <td style={{ textAlign: 'center' }}>{rec.actual_working_days ?? '-'}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatCurrency(rec.actual_base_salary)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatCurrency(allowances)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatCurrency(rec.commission_amount)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatCurrency(rec.bonus_amount)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{formatCurrency(rec.gross_income)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#dc2626' }}>-{formatCurrency(rec.total_insurance)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#15803d' }}>{formatCurrency(rec.net_salary)}</td>
                        </tr>
                      )
                    })}
                    <tr className="payslip-a4-total-row" style={{ fontSize: '12px' }}>
                      <td colSpan={2}>TỔNG CẢ NĂM</td>
                      <td colSpan={2}>-</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatCurrency(annualData.total_commission_year)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatCurrency(annualData.total_bonus_year)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatCurrency(annualData.total_gross_income_year)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#dc2626' }}>-{formatCurrency(annualData.total_insurance_deducted_year)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#15803d', fontSize: '13px' }}>{formatCurrency(annualData.total_net_salary_year)}</td>
                    </tr>
                  </tbody>
                </table>

                <div className="payslip-a4-highlight-box">
                  <div className="payslip-a4-net-label">TỔNG THU NHẬP THỰC NHẬN CẢ NĂM (NET):</div>
                  <div className="payslip-a4-net-amount">{formatCurrency(annualData.total_net_salary_year)}</div>
                </div>

                {annualData.net_salary_in_words && (
                  <div className="payslip-a4-words">
                    Số tiền bằng chữ: <strong>{annualData.net_salary_in_words}</strong>
                  </div>
                )}

                <div className="payslip-a4-signatures">
                  <div>
                    <div className="payslip-a4-sign-title">NGƯỜI LẬP BẢNG</div>
                    <div className="payslip-a4-sign-note">(Ký, họ tên)</div>
                    <div className="payslip-a4-sign-space"></div>
                  </div>
                  <div>
                    <div className="payslip-a4-sign-title">KẾ TOÁN TRƯỞNG</div>
                    <div className="payslip-a4-sign-note">(Ký, họ tên)</div>
                    <div className="payslip-a4-sign-space"></div>
                  </div>
                  <div>
                    <div className="payslip-a4-sign-title">GIÁM ĐỐC ĐIỀU HÀNH</div>
                    <div className="payslip-a4-sign-note">(Ký, đóng dấu)</div>
                    <div className="payslip-a4-sign-space"></div>
                  </div>
                  <div>
                    <div className="payslip-a4-sign-title">NGƯỜI LAO ĐỘNG</div>
                    <div className="payslip-a4-sign-note">(Ký xác nhận)</div>
                    <div className="payslip-a4-sign-space"></div>
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
        </div>
      )}
    </div>
  )
}
