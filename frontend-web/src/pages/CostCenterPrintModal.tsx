import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Printer, X, FileSpreadsheet, CheckSquare, Square } from 'lucide-react'
import { useCompanyProfile } from '../hooks/useCompanyProfile'
import { formatCurrency } from '../utils/formatters'
import type { FundData, CompanyTotals } from './PayrollFundPage'
import './CostCenterPrint.css'

interface CostCenterPrintModalProps {
  isOpen: boolean
  onClose: () => void
  period: string
  data: FundData | null
  totals?: CompanyTotals | null
}

export function CostCenterPrintModal({
  isOpen,
  onClose,
  period,
  data,
  totals,
}: CostCenterPrintModalProps) {
  const company = useCompanyProfile()
  const [includeEmployees, setIncludeEmployees] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  useEffect(() => {
    if (!isOpen) return
    const printPageRule = document.createElement('style')
    printPageRule.dataset.printPage = 'payroll-fund-a4-landscape'
    printPageRule.textContent = '@media print { @page { size: A4 landscape; margin: 8mm 10mm; } }'
    document.head.appendChild(printPageRule)
    return () => printPageRule.remove()
  }, [isOpen])

  if (!isOpen || !data || !totals) return null

  const now = new Date()
  const printDateStr = `TP. Hồ Chí Minh, ngày ${String(now.getDate()).padStart(2, '0')} tháng ${String(now.getMonth() + 1).padStart(2, '0')} năm ${now.getFullYear()}`
  const docNumber = `BC-TCOW/${period.replace('-', '')}/TZ`

  const handlePrint = () => {
    window.print()
  }

  const byUnit = data.by_unit || []

  return createPortal(
    <div
      className="cost-center-print-overlay print-active-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Xem trước và in Bảng Phân Bổ Chi Phí Lao Động"
      onClick={onClose}
    >
      {/* Thanh công cụ xem trước & in (Ẩn khi in ra máy in / PDF) */}
      <div
        className="cost-center-print-actions-bar no-print"
        onClick={e => e.stopPropagation()}
      >
        <div className="cost-center-print-actions-left">
          <div className="cost-center-print-actions-title">
            <FileSpreadsheet size={18} style={{ color: 'var(--primary-color, #2563eb)' }} />
            <span>Xem trước Bảng Phân Bổ Chi Phí Lao Động (A4 Landscape)</span>
          </div>
          <label className="cost-center-print-toggle" title="Hiển thị thêm bảng danh sách chi tiết nhân sự của từng đơn vị">
            <input
              type="checkbox"
              checked={includeEmployees}
              onChange={e => setIncludeEmployees(e.target.checked)}
            />
            <span>Kèm danh sách nhân sự chi tiết</span>
          </label>
        </div>

        <div className="cost-center-print-actions-right">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handlePrint}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}
          >
            <Printer size={16} />
            <span>In / Lưu PDF (A4 Landscape)</span>
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            title="Đóng (Phím ESC)"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
          >
            <X size={16} />
            <span>Đóng</span>
          </button>
        </div>
      </div>

      {/* Bản in khổ A4 Landscape */}
      <div
        className="cost-center-print-paper print-modal"
        onClick={e => e.stopPropagation()}
      >
        {/* Header Pháp nhân & Số hiệu văn bản */}
        <header className="cc-print-header">
          <div>
            <div className="cc-print-company-name">
              {company.name || 'CÔNG TY CỔ PHẦN CÔNG NGHỆ TECHZONE'}
            </div>
            <div className="cc-print-company-sub">
              HỆ THỐNG QUẢN TRỊ NGUỒN NHÂN LỰC & CHUỖI CỬA HÀNG
            </div>
            {company.address && (
              <div className="cc-print-company-sub" style={{ fontSize: '10px' }}>
                Địa chỉ: {company.address}
              </div>
            )}
            {company.tax_code && (
              <div className="cc-print-company-sub" style={{ fontSize: '10px' }}>
                Mã số thuế: {company.tax_code}
              </div>
            )}
          </div>
          <div className="cc-print-meta">
            <div className="cc-print-meta-code">Số: {docNumber}</div>
            <div>{printDateStr}</div>
            <div style={{ fontStyle: 'italic', color: '#64748b' }}>Lưu hành nội bộ doanh nghiệp</div>
          </div>
        </header>

        {/* Tiêu đề chính thức của biểu mẫu */}
        <div className="cc-print-title-block">
          <h1 className="cc-print-main-title">
            BẢNG PHÂN BỔ CHI PHÍ LAO ĐỘNG THEO ĐƠN VỊ
          </h1>
          <div className="cc-print-subtitle">
            (COST CENTER BREAKDOWN &amp; TOTAL COST OF WORKFORCE - TCOW)
          </div>
          <div style={{ fontSize: '11px', marginTop: '4px', fontWeight: 600, color: '#334155' }}>
            Kỳ quyết toán: Tháng {period} • Đơn vị tiền tệ: Việt Nam Đồng (VNĐ)
          </div>
        </div>

        {/* 4 Hộp tóm tắt ngân sách & Dòng tiền TCOW */}
        <section className="cc-print-kpi-grid">
          <div className="cc-print-kpi-box">
            <div className="cc-print-kpi-label">Dự toán ngân sách (Cap)</div>
            <div className="cc-print-kpi-val">{formatCurrency(totals.budget_cap)}</div>
          </div>
          <div className="cc-print-kpi-box">
            <div className="cc-print-kpi-label">Tổng chi phí thực tế (TCOW)</div>
            <div className="cc-print-kpi-val" style={{ color: '#1e3a8a' }}>{formatCurrency(totals.total_tcow)}</div>
          </div>
          <div className="cc-print-kpi-box">
            <div className="cc-print-kpi-label">Tỷ lệ giải ngân</div>
            <div className="cc-print-kpi-val" style={{ color: totals.budget_used_percent >= 95 ? '#dc2626' : '#059669' }}>
              {totals.budget_used_percent}%
            </div>
          </div>
          <div className="cc-print-kpi-box">
            <div className="cc-print-kpi-label">Quỹ thực nhận (Net)</div>
            <div className="cc-print-kpi-val" style={{ color: '#059669' }}>{formatCurrency(totals.total_net_fund)}</div>
          </div>
        </section>

        {/* Bảng I: Phân bổ chi phí theo Cost Center */}
        <div className="cc-print-section-title">
          <span>I. BẢNG TỔNG HỢP CHI PHÍ THEO ĐƠN VỊ (COST CENTER)</span>
          <span style={{ fontSize: '10px', fontWeight: 500, textTransform: 'none', color: '#64748b' }}>
            Tổng cộng: {byUnit.length} đơn vị • {totals.total_headcount} nhân sự
          </span>
        </div>

        <table className="cc-print-table">
          <thead>
            <tr>
              <th style={{ width: '4%' }}>STT</th>
              <th style={{ width: '16%' }}>Đơn vị (Cost Center)</th>
              <th style={{ width: '6%' }}>NS</th>
              <th style={{ width: '10%' }}>Lương &amp; PC</th>
              <th style={{ width: '10%' }}>Biến đổi</th>
              <th style={{ width: '10%' }}>Tổng Gross</th>
              <th style={{ width: '9%' }}>Khấu trừ</th>
              <th style={{ width: '10%' }}>Thực nhận</th>
              <th style={{ width: '9%' }}>DN đóng (23.5%)</th>
              <th style={{ width: '10%' }}>Tổng TCOW</th>
              <th style={{ width: '6%' }}>Tỷ trọng</th>
            </tr>
          </thead>
          <tbody>
            {byUnit.map((unit, idx) => {
              const unitRatio = totals.total_tcow > 0
                ? ((unit.tcow / totals.total_tcow) * 100).toFixed(1)
                : '0.0'
              return (
                <tr key={unit.unit_name || idx}>
                  <td className="text-center">{idx + 1}</td>
                  <td style={{ fontWeight: 600 }}>{unit.unit_name}</td>
                  <td className="text-center" style={{ fontWeight: 600 }}>{unit.employee_count}</td>
                  <td className="text-right">{formatCurrency(unit.fixed_income)}</td>
                  <td className="text-right">{formatCurrency(unit.variable_income)}</td>
                  <td className="text-right" style={{ fontWeight: 600 }}>{formatCurrency(unit.total_gross)}</td>
                  <td className="text-right" style={{ color: '#dc2626' }}>-{formatCurrency(unit.total_deductions)}</td>
                  <td className="text-right" style={{ fontWeight: 600, color: '#059669' }}>{formatCurrency(unit.total_net)}</td>
                  <td className="text-right" style={{ color: '#475569' }}>+{formatCurrency(unit.employer_burden)}</td>
                  <td className="text-right" style={{ fontWeight: 700, color: '#1e3a8a' }}>{formatCurrency(unit.tcow)}</td>
                  <td className="text-center" style={{ fontWeight: 600 }}>{unitRatio}%</td>
                </tr>
              )
            })}
            <tr className="total-row">
              <td colSpan={2} className="text-center">TỔNG TOÀN DOANH NGHIỆP</td>
              <td className="text-center">{totals.total_headcount}</td>
              <td className="text-right">{formatCurrency(totals.total_fixed_income)}</td>
              <td className="text-right">{formatCurrency(totals.total_variable_income)}</td>
              <td className="text-right">{formatCurrency(totals.total_gross_fund)}</td>
              <td className="text-right" style={{ color: '#dc2626' }}>-{formatCurrency(totals.total_deductions_fund)}</td>
              <td className="text-right" style={{ color: '#059669' }}>{formatCurrency(totals.total_net_fund)}</td>
              <td className="text-right">+{formatCurrency(totals.total_employer_burden)}</td>
              <td className="text-right" style={{ color: '#1e3a8a' }}>{formatCurrency(totals.total_tcow)}</td>
              <td className="text-center">100%</td>
            </tr>
          </tbody>
        </table>

        {/* Bảng II (Tùy chọn): Chi tiết nhân sự từng đơn vị */}
        {includeEmployees && (
          <section style={{ marginTop: '20px' }}>
            <div className="cc-print-section-title">
              <span>II. DANH SÁCH CHI TIẾT NHÂN SỰ THEO ĐƠN VỊ</span>
            </div>
            {byUnit.map((unit) => (
              <div key={`detail-${unit.unit_name}`} className="cc-print-sub-unit">
                <div className="cc-print-sub-unit-title">
                  • {unit.unit_name} ({unit.employees?.length || 0} nhân sự)
                </div>
                <table className="cc-print-emp-table">
                  <thead>
                    <tr>
                      <th style={{ width: '4%' }}>STT</th>
                      <th style={{ width: '8%' }}>Mã NV</th>
                      <th style={{ width: '15%' }}>Họ và Tên</th>
                      <th style={{ width: '12%' }}>Chức vụ</th>
                      <th style={{ width: '7%' }}>Ngày công</th>
                      <th style={{ width: '9%' }}>Lương CB &amp; PC</th>
                      <th style={{ width: '8%' }}>Biến đổi</th>
                      <th style={{ width: '9%' }}>Tổng Gross</th>
                      <th style={{ width: '8%' }}>Khấu trừ</th>
                      <th style={{ width: '9%' }}>Thực nhận</th>
                      <th style={{ width: '8%' }}>DN đóng</th>
                      <th style={{ width: '9%' }}>TCOW</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(unit.employees || []).map((emp, eIdx) => (
                      <tr key={emp.employee_id || eIdx}>
                        <td className="text-center">{eIdx + 1}</td>
                        <td className="text-center" style={{ fontWeight: 600 }}>{emp.employee_code}</td>
                        <td style={{ fontWeight: 600 }}>{emp.employee_name}</td>
                        <td style={{ color: '#475569' }}>{emp.position_name}</td>
                        <td className="text-center">{emp.actual_working_days} / {emp.standard_working_days}</td>
                        <td className="text-right">{formatCurrency(emp.fixed_income)}</td>
                        <td className="text-right">{formatCurrency(emp.variable_income)}</td>
                        <td className="text-right" style={{ fontWeight: 600 }}>{formatCurrency(emp.gross_income)}</td>
                        <td className="text-right" style={{ color: '#dc2626' }}>-{formatCurrency(emp.deductions)}</td>
                        <td className="text-right" style={{ fontWeight: 600, color: '#059669' }}>{formatCurrency(emp.net_salary)}</td>
                        <td className="text-right" style={{ color: '#475569' }}>+{formatCurrency(emp.employer_burden)}</td>
                        <td className="text-right" style={{ fontWeight: 700, color: '#1e3a8a' }}>{formatCurrency(emp.tcow)}</td>
                      </tr>
                    ))}
                    {(!unit.employees || unit.employees.length === 0) && (
                      <tr>
                        <td colSpan={12} className="text-center" style={{ color: '#64748b', fontStyle: 'italic', padding: '6px' }}>
                          Không có nhân sự nào được ghi nhận trong đơn vị này.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ))}
          </section>
        )}

        {/* Khối chữ ký phê duyệt 3 bên theo chuẩn Kế toán - Nhân sự */}
        <footer className="cc-print-signatures">
          <div>
            <div className="cc-print-sig-col-title">NGƯỜI LẬP BIỂU</div>
            <div className="cc-print-sig-col-hint">(Ký, ghi rõ họ tên)</div>
            <div className="cc-print-sig-space" />
            <div className="cc-print-sig-name">Chuyên viên C&amp;B / Nhân sự</div>
          </div>

          <div>
            <div className="cc-print-sig-col-title">KẾ TOÁN TRƯỞNG / HR LEAD</div>
            <div className="cc-print-sig-col-hint">(Ký, ghi rõ họ tên)</div>
            <div className="cc-print-sig-space" />
            <div className="cc-print-sig-name">Trưởng phòng Nhân sự &amp; Kế toán</div>
          </div>

          <div>
            <div className="cc-print-sig-col-title">GIÁM ĐỐC ĐIỀU HÀNH</div>
            <div className="cc-print-sig-col-hint">(Ký tên, đóng dấu)</div>
            <div className="cc-print-sig-space" />
            <div className="cc-print-sig-name">Ban Giám đốc TechZone</div>
          </div>
        </footer>

        {/* Ghi chú footer bảo mật */}
        <div className="cc-print-footer-note">
          <span>Hệ thống Quản trị Nhân sự &amp; Chi phí Lao động TechZone HRM</span>
          <span>Báo cáo trích xuất tự động • Bản in khổ chuẩn A4 Landscape</span>
        </div>
      </div>
    </div>,
    document.body
  )
}

