import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Icons } from '../components/common/Icons'
import { StatCard } from '../components/common/StatCard'
import { EmptyState } from '../components/common/EmptyState'
import { formatCurrency, formatDate } from '../utils/formatters'
import type { Payroll } from '../types'
import { payrollApi } from '../services/api'
import './PayslipPrint.css'
import './MyPayslipPage.css'
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
  const [isClosingPayroll, setIsClosingPayroll] = useState(false)
  const subformPaneRef = useRef<HTMLDivElement | null>(null)
  const [adjustmentPayroll, setAdjustmentPayroll] = useState<Payroll | null>(null)
  const [reopenDialogOpen, setReopenDialogOpen] = useState(false)
  const [unconfirmPayroll, setUnconfirmPayroll] = useState<Payroll | null>(null)
  const [selectedAnnualEmployeeId, setSelectedAnnualEmployeeId] = useState<number>(() => user?.employee_id || 0)
  const [annualData, setAnnualData] = useState<any>(null)
  const [annualLoading, setAnnualLoading] = useState(false)

  // Subform close and select handlers with slide animation
  const handleClosePayrollDetail = () => {
    if (isClosingPayroll || !selectedPayroll) return
    setIsClosingPayroll(true)
    setTimeout(() => {
      setSelectedPayroll(null)
      setIsClosingPayroll(false)
    }, 220)
  }

  const handleSelectPayroll = (payroll: Payroll) => {
    setIsClosingPayroll(false)
    setSelectedPayroll(payroll)
    setTimeout(() => {
      if (subformPaneRef.current) {
        const rect = subformPaneRef.current.getBoundingClientRect()
        if (rect.top < 80) {
          subformPaneRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }
    }, 60)
  }

  const isDetailOpen = Boolean(selectedPayroll || isClosingPayroll)

  // Action dropdown menu state (rendered via Portal)
  const [openMenuId, setOpenMenuId] = useState<number | null>(null)
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null)

  useEffect(() => {
    const handleClickOutside = () => {
      setOpenMenuId(null)
      setMenuPos(null)
    }
    const handleScroll = () => {
      setOpenMenuId(null)
      setMenuPos(null)
    }
    document.addEventListener('click', handleClickOutside)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('click', handleClickOutside)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [])

  const handleToggleMenu = (e: React.MouseEvent<HTMLButtonElement>, payrollId: number, index: number, total: number) => {
    e.stopPropagation()
    if (openMenuId === payrollId) {
      setOpenMenuId(null)
      setMenuPos(null)
      return
    }

    const rect = e.currentTarget.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const menuEstimatedHeight = 190

    const isNearBottom = index >= Math.max(1, total - 2)
    const openUp = (spaceBelow < menuEstimatedHeight || isNearBottom) && rect.top > menuEstimatedHeight

    setMenuPos({
      top: openUp ? undefined : rect.bottom + 4,
      bottom: openUp ? window.innerHeight - rect.top + 4 : undefined,
      right: window.innerWidth - rect.right,
    })
    setOpenMenuId(payrollId)
  }

  const renderActionMenu = () => {
    if (openMenuId === null || !menuPos) return null

    const pr = filteredPayrolls.find((p) => p.payroll_id === openMenuId) || payrolls.find((p) => p.payroll_id === openMenuId)
    if (!pr) return null

    const isDropup = menuPos.bottom !== undefined
    const canPrint = ['CONFIRMED', 'PAID'].includes(pr.payment_status || '')

    return createPortal(
      <div
        className={`action-dropdown action-dropdown-fixed ${isDropup ? 'dropup' : 'dropdown'}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          top: menuPos.top !== undefined ? `${menuPos.top}px` : 'auto',
          bottom: menuPos.bottom !== undefined ? `${menuPos.bottom}px` : 'auto',
          right: `${menuPos.right}px`,
          zIndex: 99999,
          minWidth: '205px',
        }}
      >
        {/* In phiếu lương PDF */}
        <button
          type="button"
          className="action-dropdown-item"
          disabled={!canPrint}
          onClick={() => {
            setOpenMenuId(null)
            setMenuPos(null)
            handleOpenMonthlyPrint(pr)
          }}
          title={pr.payment_status === 'DRAFT' ? 'Chỉ in sau khi duyệt' : 'Xem & In phiếu lương (PDF / A4)'}
        >
          <span className="action-icon" style={{ color: 'var(--status-info, #0284c7)' }}>{Icons.printer}</span>
          <span>In phiếu lương (PDF)</span>
        </button>

        {/* Điều chỉnh lương nháp */}
        {canRunPayroll && pr.payment_status === 'DRAFT' && (
          <button
            type="button"
            className="action-dropdown-item"
            onClick={() => {
              setOpenMenuId(null)
              setMenuPos(null)
              setAdjustmentPayroll(pr)
            }}
          >
            <span className="action-icon" style={{ color: 'var(--text-secondary)' }}>{Icons.edit}</span>
            <span>Điều chỉnh lương nháp</span>
          </button>
        )}

        {/* Duyệt phiếu lương */}
        {canRunPayroll && pr.payment_status === 'DRAFT' && (
          <button
            type="button"
            className="action-dropdown-item"
            onClick={() => {
              setOpenMenuId(null)
              setMenuPos(null)
              handleUpdateSingleStatus(pr.payroll_id, 'CONFIRMED')
            }}
          >
            <span className="action-icon" style={{ color: 'var(--primary-color, #2563eb)' }}>{Icons.check}</span>
            <span>Duyệt phiếu lương</span>
          </button>
        )}

        {/* Xác nhận chi trả */}
        {canRunPayroll && pr.payment_status === 'CONFIRMED' && (
          <button
            type="button"
            className="action-dropdown-item"
            onClick={() => {
              setOpenMenuId(null)
              setMenuPos(null)
              handleUpdateSingleStatus(pr.payroll_id, 'PAID')
            }}
          >
            <span className="action-icon" style={{ color: 'var(--status-success, #16a34a)' }}>{Icons.dollar}</span>
            <span>Xác nhận chi trả</span>
          </button>
        )}

        {/* Hoàn tác duyệt */}
        {canRunPayroll && pr.payment_status === 'CONFIRMED' && (
          <>
            <div className="action-dropdown-divider" />
            <button
              type="button"
              className="action-dropdown-item danger"
              onClick={() => {
                setOpenMenuId(null)
                setMenuPos(null)
                setUnconfirmPayroll(pr)
              }}
            >
              <span className="action-icon" style={{ color: 'var(--status-error, #dc2626)' }}>{Icons.undo}</span>
              <span>Hoàn tác về bản nháp</span>
            </button>
          </>
        )}
      </div>,
      document.body
    )
  }

  // Modals state
  const [isPayrollRegulationOpen, setIsPayrollRegulationOpen] = useState(false)
  const [isAttendanceRulesOpen, setIsAttendanceRulesOpen] = useState(false)
  const [isMonthlyPrintModalOpen, setIsMonthlyPrintModalOpen] = useState(false)
  const [isAnnualPrintModalOpen, setIsAnnualPrintModalOpen] = useState(false)
  const [monthlyPrintData, setMonthlyPrintData] = useState<any>(null)

  // Roles determination
  const userRoles = useMemo(() => user?.roles || [], [user])
  const isAdmin = userRoles.includes('ADMIN')
  const isDirector = userRoles.includes('DIRECTOR')
  const isHrManager = userRoles.includes('HR_MANAGER')
  const isStoreManager = userRoles.includes('STORE_MANAGER')
  const canManage = isAdmin || isDirector || isHrManager || isStoreManager
  const canRunPayroll = isAdmin || isDirector || isHrManager

  // Load payrolls
  const fetchPayrolls = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await payrollApi.getAll({ period: selectedPeriod })
      setPayrolls(data || [])
      if (data && data.length > 0) {
        const userPayroll = data.find(p => p.employee_id === user?.employee_id)
        setSelectedPayroll(prev => {
          if (!prev) return null
          return data.find(p => p.payroll_id === prev.payroll_id) || null
        })
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
              <button type="button" className="btn btn-secondary" onClick={() => setIsPayrollRegulationOpen(true)} title="Xem và điều chỉnh quy chế lương, phạt trễ, phụ cấp cơm xe, thưởng lễ tết">
                {Icons.settings}
                Quy chế & Cài đặt lương
              </button>
              <span className="text-secondary" style={{ fontSize: '13px', fontWeight: 600 }}>Kỳ tính lương:</span>
              <select
                className="form-select"
                value={selectedPeriod}
                onChange={(e) => {
                  setSelectedPeriod(e.target.value)
                  setSelectedPayroll(null)
                }}
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

          {canRunPayroll&&<PayrollOvertimePanel period={selectedPeriod} mode="history"/>}

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
            <div className={`mypayslip-layout ${isDetailOpen ? 'has-subform' : 'is-full-width'}`}>
              {/* CỘT TRÁI (MAIN PANE): BẢNG QUẢN LÝ LƯƠNG NHÂN SỰ */}
              <div className="mypayslip-main-pane">
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

                  {/* Table with Dynamic Columns (Compact when Subform is Open, Full when Closed) */}
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
                      <table className="table mypayslip-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                        <thead>
                          <tr style={{ background: 'var(--surface-subtle)', borderBottom: '1px solid var(--border-default)' }}>
                            <th style={{ padding: '12px 14px', textAlign: 'left' }}>Nhân viên</th>
                            <th style={{ padding: '12px 10px', textAlign: 'center' }}>Ngày công</th>
                            {!isDetailOpen && (
                              <th style={{ padding: '12px 12px', textAlign: 'right' }}>Lương HĐ</th>
                            )}
                            {!isDetailOpen && (
                              <th style={{ padding: '12px 12px', textAlign: 'right', color: 'var(--status-error, #dc2626)' }}>Tổng giảm trừ</th>
                            )}
                            <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 800, color: 'var(--status-success)' }}>THỰC LĨNH (NET)</th>
                            <th style={{ padding: '12px 10px', textAlign: 'center' }}>Trạng thái</th>
                            <th style={{ padding: '12px 14px', textAlign: 'center', width: '90px' }}>Thao tác</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredPayrolls.map((pr, idx) => {
                            const isSelected = selectedPayroll?.payroll_id === pr.payroll_id
                            return (
                              <tr
                                key={pr.payroll_id}
                                style={{
                                  borderBottom: '1px solid var(--border-subtle)',
                                  transition: 'background-color 0.15s ease',
                                }}
                                className={`table-row-hover mypayslip-row ${isSelected ? 'is-selected' : ''}`}
                                onClick={() => handleSelectPayroll(pr)}
                              >
                                {/* Nhân viên - Chỉ hiển thị tên theo yêu cầu */}
                                <td style={{ padding: '12px 14px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{pr.employee_name}</span>
                                    {isSelected && (
                                      <span
                                        title="Đang xem chi tiết nhân sự này"
                                        style={{
                                          marginLeft: 'auto',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          color: 'var(--primary-color, #2563eb)',
                                        }}
                                      >
                                        {Icons.eye}
                                      </span>
                                    )}
                                  </div>
                                </td>

                                {/* Ngày công */}
                                <td style={{ padding: '12px 10px', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
                                  <strong>{pr.actual_working_days ?? '—'}</strong> / {pr.standard_working_days ?? '—'}
                                </td>

                                {/* Lương HĐ (ẩn khi mở subform) */}
                                {!isDetailOpen && (
                                  <td style={{ padding: '12px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                                    {formatCurrency(pr.contract_salary)}
                                  </td>
                                )}


                                {/* Tổng giảm trừ (ẩn khi mở subform) */}
                                {!isDetailOpen && (
                                  <td style={{ padding: '12px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--status-error, #dc2626)' }}>
                                    -{formatCurrency(pr.total_deduction)}
                                  </td>
                                )}

                                {/* Thực lĩnh NET */}
                                <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 800, color: 'var(--status-success)', fontSize: '13.5px', fontFamily: 'var(--font-mono)' }}>
                                  {formatCurrency(pr.net_salary)}
                                </td>

                                {/* Trạng thái */}
                                <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                                  <span className={`badge ${getStatusBadgeClass(pr.payment_status)}`}>
                                    {getStatusLabel(pr.payment_status)}
                                  </span>
                                </td>

                                {/* Thao tác: Nút xem chi tiết icon con mắt + Nút dấu 3 chấm dọc mở menu gộp */}
                                <td style={{ padding: '12px 14px', textAlign: 'center', width: '90px' }}>
                                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center' }}>
                                    {/* Nút xem chi tiết Subform */}
                                    <button
                                      type="button"
                                      className={`btn btn-icon btn-sm ${isSelected ? 'btn-primary' : 'btn-secondary'}`}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        if (isSelected) {
                                          handleClosePayrollDetail()
                                        } else {
                                          handleSelectPayroll(pr)
                                        }
                                      }}
                                      title={isSelected ? 'Đóng xem chi tiết' : 'Xem chi tiết phiếu lương'}
                                      aria-label="Xem chi tiết phiếu lương"
                                    >
                                      {Icons.eye}
                                    </button>

                                    {/* Nút dấu 3 chấm dọc gộp các thao tác (In, Điều chỉnh, Duyệt, Chi trả, Hoàn tác) */}
                                    <button
                                      type="button"
                                      className="btn btn-secondary btn-icon btn-sm"
                                      onClick={(e) => handleToggleMenu(e, pr.payroll_id, idx, filteredPayrolls.length)}
                                      title="Tùy chọn thao tác"
                                      aria-label="Tùy chọn thao tác"
                                    >
                                      {Icons.moreVertical}
                                    </button>
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
              </div>

              {/* CỘT PHẢI (SUBFORM PANE): CHI TIẾT BẢNG LƯƠNG NHÂN SỰ ĐANG CHỌN */}
              {isDetailOpen && selectedPayroll && (
                <div ref={subformPaneRef} className={`mypayslip-subform-pane ${isClosingPayroll ? 'is-closing' : ''}`}>
                  <div className="mypayslip-detail-card">
                    {/* Góc trên bên phải: Nút X đóng chi tiết với slide animation */}
                    <button
                      type="button"
                      className="mypayslip-corner-close-btn"
                      onClick={handleClosePayrollDetail}
                      title="Đóng xem chi tiết phiếu lương (quay về bảng đầy đủ)"
                      aria-label="Đóng chi tiết"
                    >
                      {Icons.x}
                    </button>

                    {/* Header Info */}
                    <div className="mypayslip-detail-header">
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
                            Chi Tiết Lương Kỳ {selectedPayroll.salary_period}
                          </h3>
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '3px' }}>
                          Nhân viên: <strong>{selectedPayroll.employee_name}</strong> ({selectedPayroll.employee_code}) · <strong>{selectedPayroll.position_name || 'Nhân viên'}</strong> · {selectedPayroll.store_name || 'Trụ sở'}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className={`badge ${getStatusBadgeClass(selectedPayroll.payment_status)}`}>
                          {getStatusLabel(selectedPayroll.payment_status)}
                        </span>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleOpenMonthlyPrint(selectedPayroll)}
                          disabled={!['CONFIRMED', 'PAID'].includes(selectedPayroll.payment_status || '')}
                          title={selectedPayroll.payment_status === 'DRAFT' ? 'Chỉ in sau khi duyệt' : 'Mở bản in A4 xem toàn trang'}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                        >
                          {Icons.printer}
                          <span>Bản in A4</span>
                        </button>
                      </div>
                    </div>

                    <div className="mypayslip-detail-body">
                      {/* Thống kê ngày công & Chấm công Callout */}
                      <div style={{ background: 'var(--surface-subtle)', padding: '12px 14px', borderRadius: '6px', border: '1px solid var(--border-default)', fontSize: '12.5px' }}>
                        <div style={{ fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '6px', letterSpacing: '0.5px' }}>
                          Thống kê ngày công & Chấm công
                        </div>
                        <div style={{ display: 'flex', gap: '10px 16px', flexWrap: 'wrap' }}>
                          <div>Công chuẩn: <strong>{selectedPayroll.standard_working_days ?? 26}</strong> ngày</div>
                          <div>Công thực tế: <strong style={{ color: 'var(--status-success)' }}>{selectedPayroll.actual_working_days ?? 0}</strong> ngày</div>
                          <div>Phép có lương: <strong>{selectedPayroll.paid_leave_days ?? 0}</strong> ngày</div>
                          <div>Nghỉ không lương: <strong style={{ color: (selectedPayroll.unpaid_leave_days || 0) > 0 ? 'var(--status-error)' : 'inherit' }}>{selectedPayroll.unpaid_leave_days ?? 0}</strong> ngày</div>
                          <div>Giờ công: <strong>{Number(selectedPayroll.attendance_hours || 0).toFixed(1)}h</strong></div>
                          <div>Trễ: <strong style={{ color: (selectedPayroll.attendance_late_minutes || 0) > 0 ? 'var(--status-error)' : 'inherit' }}>{selectedPayroll.attendance_late_minutes || 0}p</strong></div>
                          <div>OT duyệt: <strong style={{ color: 'var(--primary-color, #2563eb)' }}>{Number(selectedPayroll.attendance_approved_overtime_hours || 0).toFixed(1)}h</strong></div>
                          {(selectedPayroll.unworked_hours || 0) > 0 && (
                            <div>Giờ thiếu: <strong style={{ color: 'var(--status-error)' }}>{selectedPayroll.unworked_hours}h</strong></div>
                          )}
                        </div>
                      </div>

                      {/* Thu nhập & Khấu trừ Breakdown Grid */}
                      <div className="mypayslip-breakdown-grid">
                        {/* I. Thu nhập Gross */}
                        <div className="mypayslip-section-box">
                          <div className="mypayslip-section-title">
                            <span>I. CÁC KHOẢN THU NHẬP (GROSS)</span>
                            <span className="mypayslip-val-mono" style={{ color: 'var(--text-primary)' }}>{formatCurrency(selectedPayroll.gross_income)}</span>
                          </div>
                          <table className="table" style={{ width: '100%', fontSize: '12.5px', margin: 0 }}>
                            <tbody>
                              <tr>
                                <td style={{ padding: '8px 12px' }}>Lương hợp đồng (thỏa thuận)</td>
                                <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                                  {formatCurrency(selectedPayroll.contract_salary)}
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '8px 12px' }}>Lương cơ bản theo ngày công thực tế</td>
                                <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                                  {formatCurrency(selectedPayroll.actual_base_salary)}
                                </td>
                              </tr>
                              {(selectedPayroll.position_allowance || 0) > 0 && (
                                <tr>
                                  <td style={{ padding: '8px 12px' }}>Phụ cấp chức vụ</td>
                                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                                    {formatCurrency(selectedPayroll.position_allowance)}
                                  </td>
                                </tr>
                              )}
                              {(selectedPayroll.seniority_allowance || 0) > 0 && (
                                <tr>
                                  <td style={{ padding: '8px 12px' }}>Phụ cấp thâm niên</td>
                                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                                    {formatCurrency(selectedPayroll.seniority_allowance)}
                                  </td>
                                </tr>
                              )}
                              {(selectedPayroll.project_allowance || 0) > 0 && (
                                <tr>
                                  <td style={{ padding: '8px 12px' }}>Phụ cấp dự án</td>
                                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                                    {formatCurrency(selectedPayroll.project_allowance)}
                                  </td>
                                </tr>
                              )}
                              {(selectedPayroll.meal_transport_allowance || 0) > 0 && (
                                <tr>
                                  <td style={{ padding: '8px 12px' }}>Phụ cấp ăn trưa & đi lại</td>
                                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                                    {formatCurrency(selectedPayroll.meal_transport_allowance)}
                                  </td>
                                </tr>
                              )}
                              {(selectedPayroll.commission_amount || 0) > 0 && (
                                <tr>
                                  <td style={{ padding: '8px 12px' }}>Hoa hồng doanh số bán hàng</td>
                                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                                    {formatCurrency(selectedPayroll.commission_amount)}
                                  </td>
                                </tr>
                              )}
                              {(selectedPayroll.overtime_salary || 0) > 0 && (
                                <tr>
                                  <td style={{ padding: '8px 12px' }}>Tiền làm thêm giờ (OT)</td>
                                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                                    {formatCurrency(selectedPayroll.overtime_salary)}
                                  </td>
                                </tr>
                              )}
                              {(selectedPayroll.bonus_amount || 0) > 0 && (
                                <tr>
                                  <td style={{ padding: '8px 12px' }}>Thưởng hiệu quả / năng suất</td>
                                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                                    {formatCurrency(selectedPayroll.bonus_amount)}
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>

                        {/* II. Khấu trừ Deductions */}
                        <div className="mypayslip-section-box">
                          <div className="mypayslip-section-title" style={{ color: 'var(--status-error)' }}>
                            <span>II. CÁC KHOẢN GIẢM TRỪ (DEDUCTIONS)</span>
                            <span className="mypayslip-val-mono">-{formatCurrency(selectedPayroll.total_deduction)}</span>
                          </div>
                          <table className="table" style={{ width: '100%', fontSize: '12.5px', margin: 0 }}>
                            <tbody>
                              <tr>
                                <td style={{ padding: '8px 12px' }}>Bảo hiểm Xã hội (BHXH 8%)</td>
                                <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--status-error)' }}>
                                  -{formatCurrency(selectedPayroll.bhxh_amount)}
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '8px 12px' }}>Bảo hiểm Y tế (BHYT 1.5%)</td>
                                <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--status-error)' }}>
                                  -{formatCurrency(selectedPayroll.bhyt_amount)}
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '8px 12px' }}>Bảo hiểm Thất nghiệp (BHTN 1%)</td>
                                <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--status-error)' }}>
                                  -{formatCurrency(selectedPayroll.bhtn_amount)}
                                </td>
                              </tr>
                              {(selectedPayroll.personal_income_tax || 0) > 0 && (
                                <tr>
                                  <td style={{ padding: '8px 12px' }}>Thuế thu nhập cá nhân (TNCN)</td>
                                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--status-error)' }}>
                                    -{formatCurrency(selectedPayroll.personal_income_tax)}
                                  </td>
                                </tr>
                              )}
                              {(selectedPayroll.time_deduction_amount || 0) > 0 && (
                                <tr>
                                  <td style={{ padding: '8px 12px' }}>Giảm trừ đi trễ / về sớm</td>
                                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--status-error)' }}>
                                    -{formatCurrency(selectedPayroll.time_deduction_amount)}
                                  </td>
                                </tr>
                              )}
                              {(selectedPayroll.penalty_deduction || 0) > 0 && (
                                <tr>
                                  <td style={{ padding: '8px 12px' }}>Khấu trừ khác / Phạt vi phạm</td>
                                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--status-error)' }}>
                                    -{formatCurrency(selectedPayroll.penalty_deduction)}
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Net Highlight Box */}
                      <div className="mypayslip-net-banner">
                        <div>
                          <div style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--status-success)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            THỰC LĨNH CHUYỂN KHOẢN (NET)
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                            Số tiền thực chi sau bảo hiểm & thuế
                          </div>
                        </div>
                        <div style={{ fontSize: '22px', fontWeight: 900, color: 'var(--status-success)', fontFamily: 'var(--font-mono)' }}>
                          {formatCurrency(selectedPayroll.net_salary)}
                        </div>
                      </div>

                      {/* Subform Action Buttons */}
                      <div className="mypayslip-subform-actions">
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => handleOpenMonthlyPrint(selectedPayroll)}
                          disabled={!['CONFIRMED', 'PAID'].includes(selectedPayroll.payment_status || '')}
                          style={{ flex: 1, padding: '9px 16px', fontSize: '13px' }}
                          title={selectedPayroll.payment_status === 'DRAFT' ? 'Chỉ in sau khi duyệt' : 'Mở bản in A4'}
                        >
                          {Icons.printer}
                          In Phiếu Lương (PDF)
                        </button>

                        {canRunPayroll && selectedPayroll.payment_status === 'DRAFT' && (
                          <>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() => setAdjustmentPayroll(selectedPayroll)}
                              title="Điều chỉnh lương nháp"
                            >
                              {Icons.edit}
                              Điều chỉnh
                            </button>
                            <button
                              type="button"
                              className="btn"
                              style={{ backgroundColor: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe' }}
                              onClick={() => handleUpdateSingleStatus(selectedPayroll.payroll_id, 'CONFIRMED')}
                              title="Duyệt phiếu lương"
                            >
                              {Icons.check}
                              Duyệt
                            </button>
                          </>
                        )}

                        {canRunPayroll && selectedPayroll.payment_status === 'CONFIRMED' && (
                          <>
                            <button
                              type="button"
                              className="btn"
                              style={{ backgroundColor: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}
                              onClick={() => handleUpdateSingleStatus(selectedPayroll.payroll_id, 'PAID')}
                              title="Xác nhận chi trả"
                            >
                              {Icons.dollar}
                              Chi trả
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() => setUnconfirmPayroll(selectedPayroll)}
                              title="Hoàn tác duyệt phiếu về DRAFT"
                            >
                              {Icons.undo}
                              Hoàn tác
                            </button>
                          </>
                        )}

                        <button
                          type="button"
                          className="btn-info-icon"
                          onClick={() => setIsPayrollRegulationOpen(true)}
                          title="Xem quy chế & công thức tính lương TechZone Retail"
                          aria-label="Xem quy chế tính lương"
                          style={{ width: '38px', height: '38px', flexShrink: 0 }}
                        >
                          <span style={{ fontStyle: 'italic', fontWeight: 700, fontFamily: 'serif', fontSize: '15px' }}>i</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
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
                    <div style={{ background: 'var(--status-success-bg)', border: '1px solid var(--status-success-border)', padding: '8px 12px', borderRadius: 'var(--radius-sm)' }}>
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
      {/* RENDER ACTION DROPDOWN PORTAL */}
      {renderActionMenu()}

      {/* MODAL 2: PRINTABLE MONTHLY PAYSLIP POPUP OVERLAY (PDF / A4) */}
      {/* ========================================================================= */}
      {/* ========================================================================= */}
      {/* MODAL 2: PRINTABLE MONTHLY PAYSLIP POPUP OVERLAY (PDF / A4) */}
      {/* ========================================================================= */}
      {isMonthlyPrintModalOpen && monthlyPrintData && (() => {
        const printDate = parsePrintDate(monthlyPrintData.generated_date)
        const grossIncome = monthlyPrintData.summary?.gross_income ?? selectedPayroll?.gross_income
        const totalDeduction = monthlyPrintData.summary?.total_deduction ?? selectedPayroll?.total_deduction
        const netSalary = monthlyPrintData.summary?.net_salary ?? selectedPayroll?.net_salary
        const netInWords = monthlyPrintData.summary?.net_salary_in_words ?? (selectedPayroll as any)?.net_salary_in_words

        return createPortal(
          <div className="modal-overlay print-active-overlay" onClick={() => setIsMonthlyPrintModalOpen(false)}>
            <div className="modal print-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '880px', padding: 0, maxHeight: '92vh' }}>
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
                    <div>Công chuẩn: <strong>{monthlyPrintData.attendance?.standard_working_days ?? selectedPayroll?.standard_working_days ?? 26} ngày</strong></div>
                    <div>Công thực tế: <strong>{monthlyPrintData.attendance?.actual_working_days ?? selectedPayroll?.actual_working_days ?? 0} ngày</strong></div>
                    <div>Phép năm có lương: <strong>{monthlyPrintData.attendance?.paid_leave_days ?? selectedPayroll?.paid_leave_days ?? 0} ngày</strong></div>
                    <div>Nghỉ không lương: <strong>{monthlyPrintData.attendance?.unpaid_leave_days ?? selectedPayroll?.unpaid_leave_days ?? 0} ngày</strong></div>
                    <div>Giờ công thực: <strong>{monthlyPrintData.attendance?.actual_work_hours ?? 0} giờ</strong></div>
                    <div>OT làm thêm: <strong>{monthlyPrintData.attendance?.approved_overtime_hours ?? monthlyPrintData.attendance?.actual_overtime_hours ?? 0} giờ</strong></div>
                    {(monthlyPrintData.attendance?.unworked_hours ?? selectedPayroll?.unworked_hours ?? 0) > 0 && (
                      <div style={{ gridColumn: 'span 2' }}>
                        Giờ trễ / thiếu: <strong>{monthlyPrintData.attendance?.unworked_hours ?? selectedPayroll?.unworked_hours} giờ</strong>
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
          </div>,
          document.body
        )
      })()}

      {/* ========================================================================= */}
      {/* MODAL 3: PRINTABLE ANNUAL SALARY SHEET POPUP OVERLAY (PDF / A4) */}
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
    </div>
  )
}
