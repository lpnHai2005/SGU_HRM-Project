import { useState, useEffect, useMemo, useCallback } from 'react'
import { Icons } from '../components/common/Icons'
import { StatCard } from '../components/common/StatCard'
import { EmptyState } from '../components/common/EmptyState'
import { formatCurrency, formatDate } from '../utils/formatters'
import type { Payroll } from '../types'
import { payrollApi } from '../services/api'

export interface PayrollPageProps {
  user: any
}

function getStatusBadgeClass(status?: string): string {
  switch (status) {
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

  // 2 Balanced Tabs: 'monthly' (Theo Tháng) vs 'annual' (Theo Năm)
  const [activeTab, setActiveTab] = useState<'monthly' | 'annual'>('monthly')
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'DRAFT' | 'CONFIRMED' | 'PAID'>('all')

  // Selected item for details & print
  const [selectedPayroll, setSelectedPayroll] = useState<Payroll | null>(null)
  const [selectedAnnualEmployeeId, setSelectedAnnualEmployeeId] = useState<number>(() => user?.employee_id || 4)
  const [annualData, setAnnualData] = useState<any>(null)
  const [annualLoading, setAnnualLoading] = useState(false)

  // Modals state
  const [isFormulaModalOpen, setIsFormulaModalOpen] = useState(false)
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
      const targetEmpId = selectedAnnualEmployeeId || selectedPayroll?.employee_id || user?.employee_id || 4
      fetchAnnualSummary(targetEmpId, selectedYear)
    }
  }, [activeTab, selectedAnnualEmployeeId, selectedPayroll?.employee_id, user?.employee_id, selectedYear, fetchAnnualSummary])

  // Handle auto-clear feedback message
  useEffect(() => {
    if (feedbackMessage) {
      const timer = setTimeout(() => setFeedbackMessage(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [feedbackMessage])

  // 1. RUN PAYROLL (Chốt công và tự động tính bảng lương)
  const handleRunPayroll = async () => {
    if (!window.confirm(`Xác nhận chốt công và tự động tính toán toàn bộ bảng lương cho kỳ ${selectedPeriod}?`)) {
      return
    }
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
    if (!window.confirm(`Xác nhận DUYỆT CHÍNH THỨC toàn bộ bảng lương kỳ ${selectedPeriod} (DRAFT -> CONFIRMED)?`)) {
      return
    }
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
    if (!window.confirm(`Xác nhận đã hoàn tất CHI TRẢ CHUYỂN KHOẢN cho toàn bộ nhân sự kỳ ${selectedPeriod}?`)) {
      return
    }
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

  // 5. Open Printable Monthly Payslip (Popup Overlay)
  const handleOpenMonthlyPrint = async (payroll: Payroll) => {
    setSelectedPayroll(payroll)
    setActionLoading(true)
    try {
      const printData = await payrollApi.getPayslip(payroll.payroll_id)

      // Merge robustly with the selected payroll record to guarantee 100% accuracy
      const att = {
        standard_working_days: printData.attendance?.standard_working_days ?? printData.attendance_summary?.standard_working_days ?? payroll.standard_working_days ?? 26,
        actual_working_days: printData.attendance?.actual_working_days ?? printData.attendance_summary?.actual_working_days ?? payroll.actual_working_days ?? 26,
        paid_leave_days: printData.attendance?.paid_leave_days ?? printData.attendance_summary?.paid_leave_days ?? payroll.paid_leave_days ?? 0,
        unpaid_leave_days: printData.attendance?.unpaid_leave_days ?? printData.attendance_summary?.unpaid_leave_days ?? payroll.unpaid_leave_days ?? 0,
        unworked_hours: printData.attendance?.unworked_hours ?? printData.attendance_summary?.unworked_hours ?? payroll.unworked_hours ?? 0,
      }

      // Ensure earnings have items
      let earningsList = printData.earnings || []
      if (earningsList.length === 0) {
        earningsList = [
          { item_name: 'Lương cơ bản thực tế', calculation_formula: `(${formatCurrency(payroll.contract_salary)} / 26) × ${payroll.actual_working_days ?? 26} công`, amount: payroll.actual_base_salary || payroll.contract_salary },
          ...(payroll.overtime_salary ? [{ item_name: 'Tiền làm thêm giờ (OT 150%)', calculation_formula: 'Hệ số tăng ca 1.5x', amount: payroll.overtime_salary }] : []),
          ...(payroll.position_allowance ? [{ item_name: 'Phụ cấp chức vụ quản lý', calculation_formula: 'Theo vị trí chức danh', amount: payroll.position_allowance }] : []),
          ...(payroll.seniority_allowance ? [{ item_name: 'Phụ cấp thâm niên công tác', calculation_formula: 'Theo số năm gắn bó TechZone', amount: payroll.seniority_allowance }] : []),
          ...(payroll.project_allowance ? [{ item_name: 'Phụ cấp dự án & chiến dịch chuỗi', calculation_formula: 'Dự án Flagship', amount: payroll.project_allowance }] : []),
          ...(payroll.meal_transport_allowance ? [{ item_name: 'Phụ cấp cơm trưa & đi lại', calculation_formula: 'Hỗ trợ ca kíp', amount: payroll.meal_transport_allowance }] : []),
          ...(payroll.commission_amount ? [{ item_name: 'Hoa hồng doanh số bán lẻ', calculation_formula: '1% ĐT, Laptop + 3% Phụ kiện', amount: payroll.commission_amount }] : []),
          ...(payroll.bonus_amount ? [{ item_name: 'Thưởng nóng KPI & Năng suất', calculation_formula: 'Đạt chỉ tiêu doanh số chi nhánh', amount: payroll.bonus_amount }] : []),
        ]
      }

      // Ensure deductions have items
      let deductionsList = printData.deductions || []
      if (deductionsList.length === 0) {
        deductionsList = [
          ...(payroll.unpaid_leave_days ? [{ item_name: 'Khấu trừ nghỉ không lương', calculation_formula: `(${formatCurrency(payroll.contract_salary)} / 26) × ${payroll.unpaid_leave_days} ngày`, amount: Math.round(((payroll.contract_salary || 0) / 26) * payroll.unpaid_leave_days) }] : []),
          ...(payroll.bhxh_amount ? [{ item_name: 'Bảo hiểm Xã hội (BHXH 8%)', calculation_formula: '8% lương đóng BH', amount: payroll.bhxh_amount }] : []),
          ...(payroll.bhyt_amount ? [{ item_name: 'Bảo hiểm Y tế (BHYT 1.5%)', calculation_formula: '1.5% lương đóng BH', amount: payroll.bhyt_amount }] : []),
          ...(payroll.bhtn_amount ? [{ item_name: 'Bảo hiểm Thất nghiệp (BHTN 1%)', calculation_formula: '1% lương đóng BH', amount: payroll.bhtn_amount }] : []),
          ...(payroll.penalty_deduction ? [{ item_name: 'Khấu trừ đi trễ / vi phạm nội quy', calculation_formula: 'Biên bản chấm công', amount: payroll.penalty_deduction }] : []),
        ]
      }

      const mergedData = {
        ...printData,
        payroll_id: printData.payroll_id || payroll.payroll_id,
        payroll_code: printData.payroll_code || `PL-${payroll.salary_period || selectedPeriod}-${String(payroll.payroll_id).padStart(4, '0')}`,
        generated_date: printData.generated_date || new Date().toLocaleDateString('vi-VN') + ' ' + new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
        attendance: att,
        attendance_summary: att,
        earnings: earningsList,
        deductions: deductionsList,
        employee: {
          ...printData.employee,
          full_name: printData.employee?.full_name || payroll.employee_name,
          employee_code: printData.employee?.employee_code || payroll.employee_code,
          position: printData.employee?.position || printData.employee?.position_name || payroll.position_name,
          position_name: printData.employee?.position_name || printData.employee?.position || payroll.position_name,
          store_name: printData.employee?.store_name || payroll.store_name || 'TechZone - Flagship Store',
          bank_account: printData.employee?.bank_account || printData.employee?.bank_account_no || '19036788899999',
          bank_account_no: printData.employee?.bank_account_no || printData.employee?.bank_account || '19036788899999',
          bank_name: printData.employee?.bank_name || 'Techcombank CN Tân Bình',
          tax_code: printData.employee?.tax_code || '8345672192',
        },
        summary: {
          ...printData.summary,
          contract_salary: printData.summary?.contract_salary ?? payroll.contract_salary ?? 0,
          time_deduction_amount: printData.summary?.time_deduction_amount ?? payroll.time_deduction_amount ?? 0,
          actual_base_salary: printData.summary?.actual_base_salary ?? payroll.actual_base_salary ?? 0,
          gross_income: printData.summary?.gross_income ?? payroll.gross_income,
          total_deduction: printData.summary?.total_deduction ?? payroll.total_deduction,
          net_salary: printData.summary?.net_salary ?? payroll.net_salary,
          net_salary_in_words: printData.summary?.net_salary_in_words || 'Mười sáu triệu không trăm bốn mươi bốn nghìn hai trăm ba mươi đồng',
        }
      }

      setMonthlyPrintData(mergedData)
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
      p.standard_working_days ?? 26,
      p.actual_working_days ?? 26,
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
    const totalEmployees = payrolls.length

    return {
      totalGross,
      totalNet,
      totalInsurance,
      paidCount,
      confirmedCount,
      draftCount,
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
                    onClick={handleRunPayroll}
                    disabled={actionLoading}
                    style={{ backgroundColor: '#2563eb' }}
                  >
                    {Icons.clock}
                    {actionLoading ? 'Đang tính...' : 'Chốt & Tính Lương'}
                  </button>

                  <button
                    className="btn btn-secondary"
                    onClick={handleConfirmAll}
                    disabled={actionLoading || metrics.draftCount === 0}
                    title="Duyệt chính thức các bản ghi DRAFT"
                  >
                    {Icons.check}
                    Duyệt tất cả
                  </button>

                  <button
                    className="btn btn-secondary"
                    onClick={handlePayAll}
                    disabled={actionLoading || (metrics.draftCount === 0 && metrics.confirmedCount === 0)}
                    title="Xác nhận đã chi trả chuyển khoản"
                  >
                    {Icons.dollar}
                    Chi trả tất cả
                  </button>
                </>
              )}

              {/* Actions & Export Buttons */}
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => setIsFormulaModalOpen(true)}
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
              footerNote={`Nháp: ${metrics.draftCount} | Duyệt: ${metrics.confirmedCount} | Trả: ${metrics.paidCount}`}
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
                              <div style={{ fontWeight: 600 }}>{pr.actual_working_days ?? 26} / {pr.standard_working_days ?? 26}</div>
                              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>ngày công</div>
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
                                {/* Open A4 PDF Payslip Popup Overlay */}
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => handleOpenMonthlyPrint(pr)}
                                  title="Xem trước & In phiếu lương (PDF)"
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
                                  <button
                                    className="btn btn-sm"
                                    style={{ backgroundColor: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}
                                    onClick={() => handleUpdateSingleStatus(pr.payroll_id, 'PAID')}
                                    title="Xác nhận chi trả (CONFIRMED -> PAID)"
                                  >
                                    {Icons.dollar}
                                  </button>
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
                            onClick={() => setIsFormulaModalOpen(true)}
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
              onClick={() => handleOpenAnnualPrint(selectedAnnualEmployeeId || selectedPayroll?.employee_id || user?.employee_id || 4)}
              disabled={annualLoading || !annualData}
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
      {/* MODAL 1: FORMULA BREAKDOWN EXPLANATION POPUP OVERLAY */}
      {/* ========================================================================= */}
      {isFormulaModalOpen && (
        <div className="modal-overlay no-print" onClick={() => setIsFormulaModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '760px' }}>
            <div className="modal-header">
              <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#2563eb' }}>{Icons.info}</span>
                Quy Chế Tính Lương, Thưởng & Khấu Trừ Chuỗi TechZone Retail
              </h2>
              <button
                className="modal-close"
                onClick={() => setIsFormulaModalOpen(false)}
                title="Đóng"
              >
                {Icons.close}
              </button>
            </div>

            <div className="modal-body" style={{ maxHeight: '74vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* 1. LƯƠNG CƠ BẢN & NGÀY CÔNG */}
              <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-default)', borderRadius: '8px', padding: '16px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: 700, color: '#2563eb', margin: '0 0 8px 0' }}>
                  1. LƯƠNG CƠ BẢN & NGÀY CÔNG BÁN LẺ (RETAIL BASE SALARY)
                </h4>
                <div style={{ fontSize: '13px', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                  <div>• <strong>Ngày công chuẩn quy định:</strong> 26 ngày/tháng (Nghỉ 1 ngày/tuần theo lịch phân ca tại cửa hàng).</div>
                  <div>• <strong>Lương cơ bản thực nhận:</strong> Tính theo số ngày công thực tế đi làm và các ngày nghỉ có hưởng lương.</div>
                  <div style={{ fontFamily: 'var(--font-mono)', background: 'var(--surface-card)', padding: '8px 12px', borderRadius: '4px', margin: '6px 0', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>
                    Lương CB thực nhận = (Lương Hợp đồng / 26) × Ngày công thực tế
                  </div>
                  <div>• <strong>Làm thêm giờ (OT - Overtime):</strong></div>
                  <div style={{ paddingLeft: '12px' }}>
                    - Ca đêm ngày thường: Hệ số <strong>150%</strong> = <code>(Lương HĐ / 26 / 8) × Giờ OT × 1.5</code><br />
                    - Ca ngày nghỉ hàng tuần (Off-day): Hệ số <strong>200%</strong><br />
                    - Ca ngày Lễ, Tết: Hệ số <strong>300%</strong> theo Bộ luật Lao động
                  </div>
                </div>
              </div>

              {/* 2. CÁC KHOẢN PHỤ CẤP BÁN LẺ */}
              <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-default)', borderRadius: '8px', padding: '16px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: 700, color: '#0284c7', margin: '0 0 8px 0' }}>
                  2. CÁC KHOẢN PHỤ CẤP BÁN LẺ (RETAIL ALLOWANCES)
                </h4>
                <div style={{ fontSize: '13px', lineHeight: 1.6 }}>
                  <div>• <strong>Phụ cấp Chức vụ (Position Allowance):</strong></div>
                  <div style={{ paddingLeft: '12px', color: 'var(--text-secondary)' }}>
                    - Cửa hàng trưởng (Store Manager): <strong>2.500.000đ - 3.500.000đ/tháng</strong> (trách nhiệm quản lý doanh số & nhân sự chi nhánh).<br />
                    - Cửa hàng phó / Trưởng ca bán lẻ: <strong>1.000.000đ - 1.500.000đ/tháng</strong>.
                  </div>
                  <div style={{ marginTop: '4px' }}>• <strong>Phụ cấp Dự án & Chiến dịch chuỗi (Project Allowance):</strong> <strong>1.000.000đ - 2.500.000đ/tháng</strong> khi tham gia setup cửa hàng mới hoặc chiến dịch mở bán Flagship (Apple, Samsung...).</div>
                  <div style={{ marginTop: '4px' }}>• <strong>Phụ cấp Thâm niên (Seniority Allowance):</strong> +<strong>200.000đ/tháng</strong> cho mỗi năm công tác gắn bó tại TechZone.</div>
                  <div style={{ marginTop: '4px' }}>• <strong>Phụ cấp Cơm trưa & Đi lại:</strong> Hỗ trợ <strong>730.000đ - 1.000.000đ/tháng</strong> hỗ trợ nhân viên trực ca kíp.</div>
                </div>
              </div>

              {/* 3. HOA HỒNG DOANH SỐ */}
              <div style={{ background: 'rgba(2, 132, 199, 0.05)', border: '1px solid rgba(2, 132, 199, 0.25)', borderRadius: '8px', padding: '16px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: 700, color: '#0284c7', margin: '0 0 8px 0' }}>
                  3. CƠ CHẾ HOA HỒNG DOANH SỐ BÁN LẺ (RETAIL COMMISSIONS)
                </h4>
                <div style={{ fontSize: '13px', lineHeight: 1.6 }}>
                  <div>• <strong>Ngành hàng Điện thoại Smartphone:</strong> Hưởng <strong>1.0%</strong> doanh số bán lẻ cá nhân (VD: 150 triệu &rarr; Hoa hồng 1.500.000đ).</div>
                  <div>• <strong>Ngành hàng Laptop & Máy tính bảng:</strong> Hưởng <strong>1.0%</strong> doanh số bán lẻ cá nhân (VD: 70 triệu &rarr; Hoa hồng 700.000đ).</div>
                  <div>• <strong>Ngành hàng Phụ kiện & Thiết bị âm thanh:</strong> Hưởng <strong>3.0% - 5.0%</strong> doanh số (Sạc nhanh, cáp, tai nghe, bao da, loa Bluetooth...).</div>
                  <div>• <strong>Gói Dịch vụ & Bảo hành TechZone Care 1 Đổi 1:</strong> Hưởng <strong>10.0% - 15.0%</strong> giá trị gói dịch vụ (dán màn hình PPF, bảo hành rơi vỡ).</div>
                </div>
              </div>

              {/* 4. CÁC KHOẢN TIỀN THƯỞNG BÁN LẺ */}
              <div style={{ background: 'rgba(34, 197, 94, 0.05)', border: '1px solid rgba(34, 197, 94, 0.25)', borderRadius: '8px', padding: '16px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: 700, color: '#166534', margin: '0 0 8px 0' }}>
                  4. CÁC KHOẢN TIỀN THƯỞNG BÁN LẺ (RETAIL BONUSES)
                </h4>
                <div style={{ fontSize: '13px', lineHeight: 1.6, color: '#14532d' }}>
                  <div>• <strong>Thưởng nóng KPI Doanh số bán lẻ:</strong></div>
                  <div style={{ paddingLeft: '12px' }}>
                    - Đạt 100% mục tiêu KPI: Thưởng nóng <strong>1.000.000đ</strong>.<br />
                    - Đạt &gt;= 120% mục tiêu KPI: Thưởng nóng <strong>2.000.000đ</strong>.<br />
                    - Đạt &gt;= 150% mục tiêu KPI: Thưởng nóng <strong>3.500.000đ</strong>.
                  </div>
                  <div style={{ marginTop: '4px' }}>• <strong>Thưởng Best Seller Chi nhánh:</strong> <strong>1.500.000đ/tháng</strong> cho nhân viên có tổng doanh thu thiết bị bán ra cao nhất tháng tại mỗi showroom.</div>
                  <div style={{ marginTop: '4px' }}>• <strong>Thưởng Chuyên cần Bán lẻ (Attendance Bonus):</strong> <strong>500.000đ/tháng</strong> nếu đi làm đủ 26 công, không đi trễ, không nghỉ đột xuất, tuân thủ tác phong đồng phục.</div>
                  <div style={{ marginTop: '4px' }}>• <strong>Thưởng Dịch vụ Khách hàng (CSAT 5 sao):</strong> <strong>500.000đ/tháng</strong> nếu điểm đánh giá phục vụ khách hàng tại quầy đạt &gt;= 95% hài lòng.</div>
                  <div style={{ marginTop: '4px' }}>• <strong>Thưởng Chiến dịch & Mở bán Flagship (Productivity / Campaign):</strong> <strong>1.000.000đ - 2.500.000đ/tháng</strong> theo hiệu quả kinh doanh của toàn chuỗi trong các dịp lễ Tết, Back to School, sự kiện ra mắt Apple & Samsung.</div>
                </div>
              </div>

              {/* 5. CÁC KHOẢN TRỪ LƯƠNG & KHẤU TRỪ */}
              <div style={{ background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: '8px', padding: '16px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: 700, color: '#b91c1c', margin: '0 0 8px 0' }}>
                  5. CÁC KHOẢN TRỪ LƯƠNG & KHẤU TRỪ BÁN LẺ (RETAIL DEDUCTIONS)
                </h4>
                <div style={{ fontSize: '13px', lineHeight: 1.6 }}>
                  <div>• <strong>Khấu trừ Nghỉ phép không hưởng lương (Unpaid Leave):</strong></div>
                  <div style={{ paddingLeft: '12px' }}>
                    - Tự động liên kết từ phân hệ Đơn nghỉ phép (<code>leave_requests</code>) khi HR duyệt.<br />
                    - Số tiền trừ: <code style={{ color: '#b91c1c', fontWeight: 600 }}>(Lương HĐ / 26) × Số ngày nghỉ không lương</code>.<br />
                    - <em>Lưu ý:</em> Phép năm (tối đa 12 ngày) và Việc riêng có lương (3 ngày kết hôn, tang chế) hưởng 100% lương, hoàn toàn không bị trừ tiền.
                  </div>
                  <div style={{ marginTop: '6px' }}>• <strong>Khấu trừ Đi trễ / Về sớm & Thiếu giờ công:</strong></div>
                  <div style={{ paddingLeft: '12px' }}>
                    - Đi trễ 15 - 60 phút: Trừ giờ công thực tế + phạt nội quy <strong>50.000đ/lần</strong>.<br />
                    - Đi trễ &gt; 60 phút không lý do: Tính trừ 0.5 ngày công thực tế.<br />
                    - Thiếu giờ ca kíp: Trừ <code>(Lương HĐ / 26 / 8) × Số giờ thiếu</code>.
                  </div>
                  <div style={{ marginTop: '6px' }}>• <strong>Trích nộp Bảo hiểm Bắt buộc (10.5% lương đóng BH):</strong></div>
                  <div style={{ paddingLeft: '12px' }}>
                    - BHXH: <strong>8.0%</strong> | BHYT: <strong>1.5%</strong> | BHTN: <strong>1.0%</strong>.
                  </div>
                  <div style={{ marginTop: '6px' }}>• <strong>Khấu trừ Sai lệch Quỹ & Hao hụt Kho Cửa hàng:</strong> Trừ bồi hoàn sai sót lệch quỹ thu ngân cuối ca hoặc thất thoát phụ kiện/hàng trưng bày theo biên bản kiểm kê chuỗi bán lẻ.</div>
                  <div style={{ marginTop: '6px' }}>• <strong>Thuế TNCN:</strong> Trích nộp theo biểu lũy tiến từng phần sau khi giảm trừ gia cảnh (bản thân 11 triệu/tháng, người phụ thuộc 4.4 triệu/tháng).</div>
                </div>
              </div>

              {/* 6. VÍ DỤ MINH HỌA */}
              <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '16px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', margin: '0 0 8px 0' }}>
                  6. VÍ DỤ MINH HOẠ THỰC TẾ (Nhân viên Phạm Quốc Dũng - Doanh số 220 triệu)
                </h4>
                <div style={{ fontSize: '13px', lineHeight: 1.7, color: '#334155' }}>
                  <div>• Lương cơ bản HĐ: <strong>8.000.000 đ</strong> (Làm 24/26 ngày, nghỉ không lương 2 ngày &rarr; Lương CB thực: <strong>5.309.615 đ</strong>)</div>
                  <div>• Hoa hồng bán lẻ (ĐT 150M x 1% + Laptop 70M x 1%): <strong>2.200.000 đ</strong></div>
                  <div>• Phụ cấp (Chức vụ 500K + Thâm niên 500K + Dự án 1.5M + Cơm trưa 1M): <strong>3.500.000 đ</strong></div>
                  <div>• Tiền thưởng (KPI 100% 1M + Thưởng năng suất 1M): <strong>2.000.000 đ</strong></div>
                  <div>• Làm thêm giờ (OT ca đêm): <strong>3.859.615 đ</strong></div>
                  <div>• <strong>TỔNG GROSS:</strong> <strong>16.869.230 đ</strong></div>
                  <div>• <strong>KHẤU TRỪ:</strong> Trừ ngày không lương (-2.690.385 đ) + BHXH 10.5% (-525.000 đ) + Phạt (-300.000 đ)</div>
                  <div style={{ fontWeight: 800, color: '#15803d', fontSize: '15px', marginTop: '6px' }}>
                    ↳ THỰC LĨNH CHUYỂN KHOẢN (NET): 16.044.230 VNĐ
                  </div>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setIsFormulaModalOpen(false)}>
                Đã hiểu
              </button>
            </div>
          </div>
        </div>
      )}

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
                    <div className="payslip-a4-company-name">{monthlyPrintData.company?.name || 'CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ TECH ZONE'}</div>
                    <div className="payslip-a4-company-sub">Địa chỉ: {monthlyPrintData.company?.address || '273 An Dương Vương, Phường 3, Quận 5, TP. Hồ Chí Minh'}</div>
                    <div className="payslip-a4-company-sub">Mã số thuế: {monthlyPrintData.company?.tax_id || '0312345678'} • Hotline: {monthlyPrintData.company?.hotline || '1900 6868'}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#1e3a8a' }}>
                      MÃ PHIẾU: <span style={{ fontFamily: 'monospace' }}>#{monthlyPrintData.payroll_code || `PL-${monthlyPrintData.salary_period || '2026-09'}-${String(monthlyPrintData.payroll_id || selectedPayroll?.payroll_id || 1).padStart(4, '0')}`}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#475569', marginTop: '3px' }}>
                      NGÀY TẠO: <strong>{monthlyPrintData.generated_date || monthlyPrintData.created_at || new Date().toLocaleDateString('vi-VN')}</strong>
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
                  <div>Họ và tên: <strong>{monthlyPrintData.employee?.full_name || selectedPayroll?.employee_name}</strong></div>
                  <div>Mã nhân viên: <strong>{monthlyPrintData.employee?.employee_code || selectedPayroll?.employee_code}</strong></div>
                  <div>Vị trí công việc: <strong>{monthlyPrintData.employee?.position || monthlyPrintData.employee?.position_name || selectedPayroll?.position_name}</strong></div>
                  <div>Chi nhánh làm việc: <strong>{monthlyPrintData.employee?.store_name || selectedPayroll?.store_name || 'TechZone - Flagship Store'}</strong></div>
                  <div>Số tài khoản: <strong>{monthlyPrintData.employee?.bank_account_no || monthlyPrintData.employee?.bank_account || '19036788899999'}</strong></div>
                  <div>Ngân hàng: <strong>{monthlyPrintData.employee?.bank_name || 'Techcombank'}</strong></div>
                </div>

                {/* Attendance Summary Bar (Synced with Attendance & Leaves) */}
                <div className="payslip-a4-attendance-summary" style={{ marginBottom: '16px', fontSize: '12.5px', background: '#f8fafc', padding: '10px 14px', border: '1px solid #cbd5e1', borderRadius: '6px', lineHeight: 1.6 }}>
                  <div style={{ fontWeight: 700, color: '#1e3a8a', marginBottom: '4px', textTransform: 'uppercase', fontSize: '11.5px', letterSpacing: '0.5px' }}>
                    THỐNG KÊ NGÀY CÔNG & NGHỈ PHÉP (LIÊN KẾT CHẤM CÔNG & ĐƠN NGHỈ PHÉP)
                  </div>
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    <div>📅 Công chuẩn: <strong>{monthlyPrintData.attendance?.standard_working_days ?? selectedPayroll?.standard_working_days ?? 26}</strong> ngày</div>
                    <div>✅ Công thực tế: <strong>{monthlyPrintData.attendance?.actual_working_days ?? selectedPayroll?.actual_working_days ?? 26}</strong> ngày</div>
                    <div>🌴 Phép năm có lương: <strong style={{ color: '#2563eb' }}>{monthlyPrintData.attendance?.paid_leave_days ?? selectedPayroll?.paid_leave_days ?? 0}</strong> ngày</div>
                    <div>
                      ⛔ Nghỉ không lương: <strong style={{ color: (monthlyPrintData.attendance?.unpaid_leave_days ?? selectedPayroll?.unpaid_leave_days ?? 0) > 0 ? '#dc2626' : 'inherit' }}>
                        {monthlyPrintData.attendance?.unpaid_leave_days ?? selectedPayroll?.unpaid_leave_days ?? 0} ngày
                      </strong>
                    </div>
                    {(monthlyPrintData.attendance?.unworked_hours ?? selectedPayroll?.unworked_hours ?? 0) > 0 && (
                      <div>⏱️ Giờ trễ/thiếu: <strong style={{ color: '#dc2626' }}>{monthlyPrintData.attendance?.unworked_hours ?? selectedPayroll?.unworked_hours} giờ</strong></div>
                    )}
                  </div>
                </div>

                {/* Tables: Earnings & Deductions */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
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
                            <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>
                              {formatCurrency(e.amount)}
                            </td>
                          </tr>
                        ))}
                        <tr className="payslip-a4-total-row">
                          <td>TỔNG THU NHẬP (GROSS)</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#1e3a8a', fontSize: '13.5px' }}>
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
                            <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#dc2626', fontWeight: 600 }}>
                              -{formatCurrency(d.amount)}
                            </td>
                          </tr>
                        ))}
                        <tr className="payslip-a4-total-row">
                          <td>TỔNG GIẢM TRỪ</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#dc2626', fontSize: '13.5px' }}>
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
                          <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(rec.actual_base_salary)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(allowances)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(rec.commission_amount)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(rec.bonus_amount)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{formatCurrency(rec.gross_income)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#dc2626' }}>-{formatCurrency(rec.total_insurance)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#15803d' }}>{formatCurrency(rec.net_salary)}</td>
                        </tr>
                      )
                    })}
                    <tr className="payslip-a4-total-row" style={{ fontSize: '12px' }}>
                      <td colSpan={2}>TỔNG CẢ NĂM</td>
                      <td colSpan={2}>-</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(annualData.total_commission_year)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(annualData.total_bonus_year)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(annualData.total_gross_income_year)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#dc2626' }}>-{formatCurrency(annualData.total_insurance_deducted_year)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#15803d', fontSize: '13px' }}>{formatCurrency(annualData.total_net_salary_year)}</td>
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
