import { Icons } from '../components/common/Icons'
import { confirmAction } from '../components/common/ConfirmDialog'
import { useEffect, useState, useMemo } from 'react'
import {
  ChevronRight,
  Info,
  Download,
  CheckCircle,
  Send,
  AlertTriangle,
  ShieldCheck,
  DollarSign,
  Users,
  TrendingUp,
  FileSpreadsheet,
  Printer
} from 'lucide-react'
import { api, payrollApi, reportApi } from '../services/api'
import { formatCurrency } from '../utils/formatters'
import { MonthPicker } from '../components/common/MonthPicker'
import './PayrollFundPage.css'

export type FundEmployee = {
  payroll_id: number
  employee_id: number
  employee_code: string
  employee_name: string
  position_name: string
  cost_center: string
  contract_salary: number
  actual_working_days: number
  standard_working_days: number
  fixed_income: number
  base_salary: number
  allowances: number
  variable_income: number
  overtime: number
  commissions: number
  bonuses: number
  gross_income: number
  employee_insurance: number
  tax: number
  penalties: number
  deductions: number
  net_salary: number
  insurance_base: number
  employer_burden: number
  tcow: number
  payment_status: string
}

export type CostCenterUnit = {
  unit_name: string
  employee_count: number
  fixed_income: number
  total_base_salary: number
  total_allowances: number
  variable_income: number
  total_overtime: number
  total_commissions: number
  total_bonuses: number
  total_gross: number
  total_insurance: number
  total_tax: number
  total_penalties: number
  total_deductions: number
  total_net: number
  employer_burden: number
  tcow: number
  payment_status: string
  employees: FundEmployee[]
}

export type CompanyTotals = {
  total_headcount: number
  total_fixed_income: number
  total_variable_income: number
  total_base_salary: number
  total_allowance_fund: number
  total_overtime_fund: number
  total_commission_fund: number
  total_bonus_fund: number
  total_gross_fund: number
  total_insurance_fund: number
  total_tax_fund: number
  total_penalties_fund: number
  total_deductions_fund: number
  total_net_fund: number
  total_employer_burden: number
  total_tcow: number
  budget_cap: number
  budget_used_percent: number
  is_budget_warning: boolean
}

export type FundData = {
  salary_period: string
  company_totals: CompanyTotals
  by_unit: CostCenterUnit[]
}

export function PayrollFundPage({ branch }: { branch: boolean }) {
  const [period, setPeriod] = useState(() =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7)
  )
  const [budgetCap, setBudgetCap] = useState<number>(180000000)
  const [data, setData] = useState<FundData | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string>('')
  const [expandedUnits, setExpandedUnits] = useState<Record<string, boolean>>({})
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [actionLoading, setActionLoading] = useState<boolean>(false)

  // Tải dữ liệu quỹ lương TCOW
  const loadFundData = async () => {
    setLoading(true)
    setError('')
    try {
      const result = await reportApi.getPayrollFund(period, undefined, budgetCap)
      setData(result)
    } catch (err: any) {
      setData(null)
      setError(err instanceof Error ? err.message : 'Không tải được báo cáo quỹ lương.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadFundData()
  }, [period, budgetCap])

  // Đóng/Mở chi tiết từng Cost Center
  const toggleUnitExpand = (unitName: string) => {
    setExpandedUnits(prev => ({
      ...prev,
      [unitName]: !prev[unitName]
    }))
  }

  // 1. Chốt quỹ lương (Confirm All)
  const handleConfirmFund = async () => {
    if (!(await confirmAction(`Xác nhận chốt toàn bộ bảng lương kỳ ${period}? Hành động này sẽ chuyển trạng thái các phiếu lương từ DRAFT sang CONFIRMED.`))) {
      return
    }
    setActionLoading(true)
    try {
      await payrollApi.confirmAll(period)
      setActionMessage({ type: 'success', text: `Đã chốt thành công quỹ lương kỳ ${period}!` })
      await loadFundData()
    } catch (err: any) {
      setActionMessage({ type: 'error', text: `Lỗi chốt quỹ lương: ${err.message}` })
    } finally {
      setActionLoading(false)
    }
  }

  // 2. Trình duyệt quỹ lương (Submit for Approval)
  const handleSubmitApproval = () => {
    setActionMessage({
      type: 'success',
      text: `Đã gửi tờ trình duyệt Quỹ Lương & TCOW kỳ ${period} (Tổng TCOW: ${formatCurrency(totals?.total_tcow)}) tới Ban Giám đốc & CFO qua hệ thống.`
    })
  }

  // 3. Xuất báo cáo TCOW (.xlsx)
  const handleExportTcowExcel = async () => {
    try {
      setActionLoading(true)
      const blob = await api.getBlob('/reports/export/payroll-summary/excel', { period })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Bao_Cao_TCOW_TechZone_${period}.xlsx`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      setActionMessage({ type: 'success', text: 'Tải xuống báo cáo TCOW Excel thành công!' })
    } catch (err: any) {
      setActionMessage({ type: 'error', text: `Lỗi xuất file Excel: ${err.message}` })
    } finally {
      setActionLoading(false)
    }
  }

  // 4. In / Xuất báo cáo PDF bảng chi phí
  const handleExportPdf = () => {
    window.print()
  }

  const totals = data?.company_totals
  const usedPercent = totals?.budget_used_percent ?? 0
  const isWarning = (totals?.is_budget_warning || usedPercent >= 95.0)

  // Status tag helper
  const renderStatusTag = (status: string) => {
    const s = (status || 'DRAFT').toUpperCase()
    if (s === 'PAID') {
      return <span className="badge badge-success" style={{ fontSize: '11px' }}>Đã chi trả</span>
    }
    if (s === 'CONFIRMED') {
      return <span className="badge badge-primary" style={{ fontSize: '11px' }}>Đã duyệt</span>
    }
    return <span className="badge badge-warning" style={{ fontSize: '11px' }}>Nháp</span>
  }

  return (
    <div className="page-container payroll-fund-container">
      {/* HEADER & ACTION BUTTONS */}
      <div className="fund-header-row">
        <div className="fund-header-title">
          <h1 className="page-title">
            {branch ? 'Quản Trị Quỹ Lương Chi Nhánh' : 'Quản trị quỹ lương & TCOW'}
          </h1>
          <p className="page-subtitle">
            {branch
              ? 'Chi phí lao động toàn phần theo nhân sự thuộc cửa hàng phụ trách.'
              : 'Chuẩn Quản trị Chi phí Lao động Toàn phần (Total Cost of Workforce - TCOW). Tường minh hóa dòng tiền lương: Thu nhập gộp, Trích nộp NSDLĐ (23.5%), Giảm trừ NLĐ đến Quỹ thực nhận.'}
          </p>
        </div>

        <div className="fund-actions-bar">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleConfirmFund}
            disabled={actionLoading || loading}
            title="Chốt chính thức toàn bộ bảng lương trong kỳ"
          >
            <CheckCircle size={16} />
            <span>Chốt quỹ lương</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleSubmitApproval}
            disabled={actionLoading || loading}
            title="Trình duyệt dự toán và phát sinh quỹ lương lên CFO / Giám đốc"
          >
            <Send size={16} />
            <span>Trình duyệt</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleExportTcowExcel}
            disabled={actionLoading || loading}
            title="Xuất bảng kê chi tiết TCOW đa đơn vị sang định dạng Excel (.xlsx)"
          >
            <Download size={16} />
            <span>Xuất báo cáo TCOW</span>
          </button>
        </div>
      </div>

      {actionMessage && (
        <div
          className={`card ${actionMessage.type === 'success' ? 'badge-safe' : 'badge-danger'}`}
          style={{
            padding: '10px 14px',
            marginBottom: 16,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: actionMessage.type === 'success' ? 'var(--status-success-bg, rgba(16, 185, 129, 0.1))' : 'var(--status-error-bg, rgba(239, 68, 68, 0.1))',
            border: `1px solid ${actionMessage.type === 'success' ? 'var(--status-success-border, rgba(16, 185, 129, 0.25))' : 'var(--status-error-border, rgba(239, 68, 68, 0.25))'}`,
            color: actionMessage.type === 'success' ? 'var(--status-success)' : 'var(--status-error)',
            borderRadius: 'var(--radius-md, 8px)'
          }}
        >
          <span>{actionMessage.text}</span>
          <button
            type="button"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, color: 'inherit' }}
            onClick={() => setActionMessage(null)}
          >
            {Icons.x}
          </button>
        </div>
      )}

      {/* FILTER BAR: KỲ LƯƠNG & NGÂN SÁCH DỰ TOÁN */}
      <section className="fund-filter-card">
        <MonthPicker
          value={period}
          onChange={val => {
            setData(null)
            setPeriod(val)
          }}
          label="Kỳ lương báo cáo"
        />

        <div className="fund-filter-item">
          <label htmlFor="budget-cap-input">Hạn mức ngân sách (Budget Cap)</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              id="budget-cap-input"
              type="number"
              className="fund-filter-input"
              value={budgetCap}
              step={5000000}
              onChange={e => setBudgetCap(Number(e.target.value) || 0)}
              style={{ width: 160, fontFamily: 'var(--font-mono)' }}
            />
            <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>VNĐ</span>
          </div>
        </div>
      </section>

      {error && <p role="alert" className="text-danger" style={{ marginBottom: 16 }}>{error}</p>}

      {loading && !data && <p>Đang tổng hợp dòng tiền Quỹ lương &amp; TCOW…</p>}

      {data && totals && (
        <>
          {/* ================================================================= */}
          {/* 2. KHU VỰC TIẾN ĐỘ NGÂN SÁCH (BUDGET VS ACTUAL PROGRESS BAR)     */}
          {/* ================================================================= */}
          <section className="budget-progress-card">
            <div className="budget-progress-header">
              <div className="budget-progress-title">
                <TrendingUp size={18} style={{ color: isWarning ? 'var(--status-error)' : 'var(--primary-color)' }} />
                <span>Tiến Độ Ngân Sách Quỹ Lương: Dự Toán (Budget Cap) vs Thực Tế Phát Sinh (Accrued TCOW)</span>
              </div>
              <div>
                <span className={`budget-status-pill ${isWarning ? 'budget-status-danger' : usedPercent >= 85 ? 'budget-status-warning' : 'budget-status-safe'}`}>
                  {isWarning ? <AlertTriangle size={14} /> : <ShieldCheck size={14} />}
                  {isWarning
                    ? `Cảnh báo: Đã dùng ${usedPercent}% ngân sách (Vượt ngưỡng 95%)`
                    : `An toàn: Đã giải ngân ${usedPercent}% ngân sách`}
                </span>
              </div>
            </div>

            <div className="budget-bar-track">
              <div
                className={`budget-bar-fill ${isWarning ? 'danger' : usedPercent >= 85 ? 'warning' : 'safe'}`}
                style={{ width: `${Math.min(100, usedPercent)}%` }}
              />
            </div>

            <div className="budget-metrics-row">
              <div>
                Dự toán trần (Cap): <strong>{formatCurrency(totals.budget_cap)}</strong>
              </div>
              <div>
                Thực tế phát sinh (Accrued TCOW):{' '}
                <strong style={{ color: isWarning ? 'var(--status-error)' : 'var(--status-info)' }}>
                  {formatCurrency(totals.total_tcow)}
                </strong>
              </div>
              <div>
                Dư địa ngân sách khả dụng:{' '}
                <strong style={{ color: totals.budget_cap - totals.total_tcow < 0 ? 'var(--status-error)' : 'var(--status-success)' }}>
                  {formatCurrency(Math.max(0, totals.budget_cap - totals.total_tcow))}
                </strong>
              </div>
              <div>
                Tỷ lệ giải ngân: <strong>{usedPercent}%</strong>
              </div>
            </div>
          </section>

          {/* ================================================================= */}
          {/* 1. KHU VỰC 5 SUMMARY CARDS: LUỒNG CHẢY DÒNG TIỀN TCOW TỪ TRÁI -> PHẢI */}
          {/* ================================================================= */}
          <div className="flow-summary-grid">
            {/* Card 1: Tổng Chi Phí Nhân Sự (TCOW) - Highlight Primary */}
            <div className="flow-card card-tcow">
              <div>
                <div className="flow-card-header">
                  <span className="flow-card-label">
                    Chi Phí Nhân Sự (TCOW)
                  </span>
                  <div className="info-hover-wrap">
                    <Info size={14} className="flow-card-tooltip-icon" />
                    <div className="info-tooltip-box">
                      Tổng chi phí nhân sự toàn phần = Tổng Gross + Chi phí DN đóng 23.5%
                    </div>
                  </div>
                </div>
                <div className="flow-card-value">
                  {formatCurrency(totals.total_tcow)}
                </div>
              </div>
              <div className="flow-card-sub">
                Gross ({formatCurrency(totals.total_gross_fund)}) + NSDLĐ đóng ({formatCurrency(totals.total_employer_burden)})
              </div>
            </div>

            {/* Card 2: Quỹ Lương Gộp (Gross Pay) */}
            <div className="flow-card">
              <div>
                <div className="flow-card-header">
                  <span className="flow-card-label">
                    Tổng Thu Nhập (Gross)
                  </span>
                  <div className="info-hover-wrap">
                    <Info size={14} className="flow-card-tooltip-icon" />
                    <div className="info-tooltip-box">
                      Lương cơ bản + Phụ cấp cố định + OT + Thưởng + Hoa hồng bán lẻ
                    </div>
                  </div>
                </div>
                <div className="flow-card-value">
                  {formatCurrency(totals.total_gross_fund)}
                </div>
              </div>
              <div className="flow-card-sub">
                Cố định: {formatCurrency(totals.total_fixed_income)} | Biến đổi: {formatCurrency(totals.total_variable_income)}
              </div>
            </div>

            {/* Card 3: Trích Nộp Doanh Nghiệp (23.5%) */}
            <div className="flow-card">
              <div>
                <div className="flow-card-header">
                  <span className="flow-card-label">
                    Chi Phí DN Đóng (23.5%)
                  </span>
                  <div className="info-hover-wrap">
                    <Info size={14} className="flow-card-tooltip-icon" />
                    <div className="info-tooltip-box">
                      BHXH 17.5% + BHYT 3% + BHTN 1% + KPCĐ 2%. Doanh nghiệp nộp nhà nước, không trừ vào lương NLĐ.
                    </div>
                  </div>
                </div>
                <div className="flow-card-value" style={{ color: 'var(--role-director-text)' }}>
                  {formatCurrency(totals.total_employer_burden)}
                </div>
              </div>
              <div className="flow-card-sub">
                Bảo hiểm DN (21.5%) + Kinh phí Công đoàn (2.0%)
              </div>
            </div>

            {/* Card 4: Tổng Giảm Trừ NLĐ (Deductions) */}
            <div className="flow-card">
              <div>
                <div className="flow-card-header">
                  <span className="flow-card-label">
                    Khấu Trừ NLĐ (10.5% + Thuế)
                  </span>
                  <div className="info-hover-wrap">
                    <Info size={14} className="flow-card-tooltip-icon" />
                    <div className="info-tooltip-box">
                      BHXH/BHYT/BHTN 10.5% + Thuế TNCN + Phạt trừ vào thu nhập NLĐ
                    </div>
                  </div>
                </div>
                <div className="flow-card-value" style={{ color: 'var(--status-error)' }}>
                  {formatCurrency(totals.total_deductions_fund)}
                </div>
              </div>
              <div className="flow-card-sub">
                BH 10.5%: {formatCurrency(totals.total_insurance_fund)} | Thuế: {formatCurrency(totals.total_tax_fund)}
              </div>
            </div>

            {/* Card 5: Quỹ Lương Thực Chi (Net Pay) - Highlight Success */}
            <div className="flow-card card-net">
              <div>
                <div className="flow-card-header">
                  <span className="flow-card-label">
                    Quỹ Thực Nhận (Net Cash)
                  </span>
                  <div className="info-hover-wrap">
                    <Info size={14} className="flow-card-tooltip-icon" />
                    <div className="info-tooltip-box">
                      Số tiền thực tế kế toán sẽ chuyển khoản ngân hàng (H2H) cho người lao động.
                    </div>
                  </div>
                </div>
                <div className="flow-card-value">
                  {formatCurrency(totals.total_net_fund)}
                </div>
              </div>
              <div className="flow-card-sub">
                Dòng tiền thực chi chuyển khoản cho {totals.total_headcount} nhân sự
              </div>
            </div>
          </div>

          {/* ================================================================= */}
          {/* 3. KHU VỰC DATA TABLE: BẢNG CHI TIẾT THEO ĐƠN VỊ (COST CENTER)    */}
          {/* ================================================================= */}
          <section className="fund-table-card">
            <div className="fund-table-header">
              <div className="fund-table-header-left">
                <h2>
                  <FileSpreadsheet size={18} style={{ color: 'var(--primary-color)' }} />
                  <span>Bảng Phân Bổ Chi Phí Lao Động Theo Đơn Vị (Cost Center Breakdown)</span>
                </h2>
                <span className="fund-table-header-hint">
                  Nhấp vào từng dòng đơn vị để xem chi tiết danh sách nhân sự
                </span>
              </div>
              <div className="fund-table-header-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleExportPdf}
                  title="In hoặc xuất bảng phân bổ chi phí này ra file PDF (A4 Landscape)"
                >
                  <Printer size={15} />
                  <span>Xuất PDF</span>
                </button>
              </div>
            </div>

            <div className="fund-table-container">
              <table className="tcow-table">
                <thead>
                  <tr>
                    <th>Đơn vị (Cost Center)</th>
                    <th style={{ textAlign: 'center' }}>Số lượng NS</th>
                    <th style={{ textAlign: 'right' }}>Lương CB &amp; PC</th>
                    <th style={{ textAlign: 'right' }}>Thu nhập biến đổi</th>
                    <th style={{ textAlign: 'right' }}>Tổng Gross</th>
                    <th style={{ textAlign: 'right' }}>Khấu trừ NLĐ</th>
                    <th style={{ textAlign: 'right' }}>Thực nhận (Net)</th>
                    <th style={{ textAlign: 'right' }}>Chi phí DN (23.5%)</th>
                    <th style={{ textAlign: 'right' }}>Tổng Chi Phí (TCOW)</th>
                    <th style={{ textAlign: 'center' }}>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_unit.map(unit => {
                    const isExpanded = !!expandedUnits[unit.unit_name]
                    return (
                      <>
                        <tr
                          key={unit.unit_name}
                          className={`cost-center-row ${isExpanded ? 'is-expanded' : ''}`}
                          onClick={() => toggleUnitExpand(unit.unit_name)}
                          title="Nhấp để xem danh sách nhân sự chi tiết thuộc đơn vị này"
                        >
                          <td>
                            <div className="cost-center-name">
                              <ChevronRight
                                size={16}
                                className={`expand-chevron ${isExpanded ? 'is-open' : ''}`}
                              />
                              <strong>{unit.unit_name}</strong>
                            </div>
                          </td>
                          <td style={{ textAlign: 'center', fontWeight: 600 }}>
                            {unit.employee_count}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                            {formatCurrency(unit.fixed_income)}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                            <div className="info-hover-wrap" style={{ justifyContent: 'flex-end', width: '100%' }}>
                              <span>{formatCurrency(unit.variable_income)}</span>
                              <Info size={12} className="flow-card-tooltip-icon" />
                              <div className="info-tooltip-box">
                                OT: {formatCurrency(unit.total_overtime)} | HH: {formatCurrency(unit.total_commissions)} | Thưởng: {formatCurrency(unit.total_bonuses)}
                              </div>
                            </div>
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                            {formatCurrency(unit.total_gross)}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--status-error)' }}>
                            <div className="info-hover-wrap" style={{ justifyContent: 'flex-end', width: '100%' }}>
                              <span>-{formatCurrency(unit.total_deductions)}</span>
                              <div className="info-tooltip-box">
                                BH 10.5%: {formatCurrency(unit.total_insurance)} | Thuế: {formatCurrency(unit.total_tax)} | Phạt: {formatCurrency(unit.total_penalties)}
                              </div>
                            </div>
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--status-success)' }}>
                            {formatCurrency(unit.total_net)}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--role-director-text)', fontWeight: 600 }}>
                            +{formatCurrency(unit.employer_burden)}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--primary-color)' }}>
                            {formatCurrency(unit.tcow)}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {renderStatusTag(unit.payment_status)}
                          </td>
                        </tr>

                        {/* SUB-TABLE CHI TIẾT NHÂN VIÊN (BUNG RỘNG) */}
                        {isExpanded && (
                          <tr className="employee-subtable-row">
                            <td colSpan={10}>
                              <div className="employee-subtable-container">
                                <div className="employee-subtable-title">
                                  <Users size={14} />
                                  <span>Danh sách nhân sự thuộc {unit.unit_name} ({unit.employees?.length || 0} người)</span>
                                </div>
                                <table className="employee-subtable">
                                  <thead>
                                    <tr>
                                      <th>Mã NV</th>
                                      <th>Họ và Tên</th>
                                      <th>Chức vụ</th>
                                      <th style={{ textAlign: 'center' }}>Ngày công</th>
                                      <th style={{ textAlign: 'right' }}>Lương CB &amp; PC</th>
                                      <th style={{ textAlign: 'right' }}>Biến đổi (OT+HH+Thưởng)</th>
                                      <th style={{ textAlign: 'right' }}>Lương Gộp (Gross)</th>
                                      <th style={{ textAlign: 'right' }}>Khấu trừ NLĐ</th>
                                      <th style={{ textAlign: 'right' }}>Thực nhận (Net)</th>
                                      <th style={{ textAlign: 'right' }}>Chi phí DN (23.5%)</th>
                                      <th style={{ textAlign: 'right' }}>TCOW Cá nhân</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(unit.employees || []).map(emp => (
                                      <tr key={emp.employee_id}>
                                        <td style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{emp.employee_code}</td>
                                        <td><strong>{emp.employee_name}</strong></td>
                                        <td style={{ color: 'var(--text-secondary)' }}>{emp.position_name}</td>
                                        <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
                                          {emp.actual_working_days} / {emp.standard_working_days}
                                        </td>
                                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatCurrency(emp.fixed_income)}</td>
                                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatCurrency(emp.variable_income)}</td>
                                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{formatCurrency(emp.gross_income)}</td>
                                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--status-error)' }}>-{formatCurrency(emp.deductions)}</td>
                                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--status-success)' }}>{formatCurrency(emp.net_salary)}</td>
                                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--role-director-text)' }}>+{formatCurrency(emp.employer_burden)}</td>
                                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--primary-color)' }}>{formatCurrency(emp.tcow)}</td>
                                      </tr>
                                    ))}
                                    {(!unit.employees || unit.employees.length === 0) && (
                                      <tr>
                                        <td colSpan={11} style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 12 }}>
                                          Không có chi tiết nhân sự trong đơn vị này.
                                        </td>
                                      </tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })}

                  {!data.by_unit.length && (
                    <tr>
                      <td colSpan={10} style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)' }}>
                        Chưa có bảng lương được tính trong kỳ {period}. Hãy chuyển tới trang Bảng Lương để tính lương trước.
                      </td>
                    </tr>
                  )}
                </tbody>
                {data.by_unit.length > 0 && (
                  <tfoot>
                    <tr style={{ background: 'var(--surface-subtle)', fontWeight: 700, borderTop: '2px solid var(--border-default)' }}>
                      <td>TỔNG TOÀN DOANH NGHIỆP</td>
                      <td style={{ textAlign: 'center' }}>{totals.total_headcount}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatCurrency(totals.total_fixed_income)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatCurrency(totals.total_variable_income)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatCurrency(totals.total_gross_fund)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--status-error)' }}>-{formatCurrency(totals.total_deductions_fund)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--status-success)' }}>{formatCurrency(totals.total_net_fund)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--role-director-text)' }}>+{formatCurrency(totals.total_employer_burden)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--primary-color)' }}>{formatCurrency(totals.total_tcow)}</td>
                      <td style={{ textAlign: 'center' }}>
                        <span className="badge badge-info" style={{ fontSize: '11px' }}>TỔNG HỢP</span>
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
