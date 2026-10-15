import { useEffect, useState } from 'react'
import { payrollApi } from '../services/api'
import { formatCurrency } from '../utils/formatters'
import type { Payroll } from '../types'

export function MyPayslipPage({ employeeId }: { employeeId: number }) {
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [rows, setRows] = useState<Payroll[]>([])
  const [annualNet, setAnnualNet] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    let active = true
    setLoading(true)
    payrollApi.getAnnualSummary(employeeId, year)
      .then(summary => { if (active) { const released = (summary.monthly_records || []).filter((row: Payroll) => row.employee_id === employeeId && ['CONFIRMED', 'PAID'].includes(row.payment_status || '')); setRows(released); setAnnualNet(released.reduce((total: number, row: Payroll) => total + Number(row.net_salary || 0), 0)); setError('') } })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Không tải được phiếu lương') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [employeeId, year])
  return <div className="page-container"><h1>Phiếu lương của tôi</h1><p>Chỉ hiển thị phiếu đã xác nhận hoặc đã chi trả của hồ sơ nhân viên đang đăng nhập.</p>
    <section className="card" style={{ padding: 20, marginBottom: 20 }}><label>Năm <input className="form-input" type="number" min="2020" max="2100" value={year} onChange={event => setYear(event.target.value)} /></label></section>
    {error && <p role="alert">{error}</p>}
    {loading ? <p>Đang tải phiếu lương…</p> : <section className="card" style={{ padding: 20 }}><p><strong>Tổng thực nhận năm:</strong> {formatCurrency(annualNet)}</p><div className="table-container"><table className="data-table"><thead><tr><th>Kỳ</th><th>Lương gộp</th><th>Khấu trừ</th><th>Thực nhận</th><th>Trạng thái</th><th>Chi tiết</th></tr></thead><tbody>
      {rows.map(row => <tr key={row.payroll_id}><td>{row.salary_period}</td><td>{formatCurrency(row.gross_income)}</td><td>{formatCurrency(row.total_deduction)}</td><td><strong>{formatCurrency(row.net_salary)}</strong></td><td>{row.payment_status === 'PAID' ? 'Đã chi trả' : 'Đã xác nhận'}</td><td><details><summary style={{ cursor: 'pointer' }}>Xem</summary><p>Ngày công: {row.actual_working_days ?? '—'} · Lương cơ bản: {formatCurrency(row.actual_base_salary)} · OT: {formatCurrency(row.overtime_salary)}</p><p>Hoa hồng: {formatCurrency(row.commission_amount)} · Thưởng: {formatCurrency(row.bonus_amount)} · Phạt: {formatCurrency(row.penalty_deduction)}</p></details></td></tr>)}
      {!rows.length && <tr><td colSpan={6}>Chưa có phiếu lương đã xác nhận trong năm này.</td></tr>}
    </tbody></table></div></section>}
  </div>
}
