import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { payrollApi } from '../services/api'
import { formatCurrency } from '../utils/formatters'
import type { Payroll } from '../types'
import { MonthPicker } from '../components/common/MonthPicker'
import { StatCard } from '../components/common/StatCard'

const statusLabels: Record<string, string> = { DRAFT: 'Nháp', CONFIRMED: 'Đã duyệt', PAID: 'Đã đánh dấu chi trả', NEEDS_RECALCULATION: 'Cần tính lại', REOPENED: 'Đã mở lại' }
export function PayrollSettlementsPage() {
  const [period, setPeriod] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7))
  const [rows, setRows] = useState<Payroll[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    payrollApi.getAll({ period }).then(result => { if (active) { setRows(result); setError('') } })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Không tải được trạng thái thanh toán') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [period])
  const groups = Object.keys(statusLabels).map(status => ({ status, rows: rows.filter(row => row.payment_status === status) }))
  return <div className="page-container">
    <div className="page-header">
      <div>
        <h1 className="page-title">Thanh toán & Đối soát</h1>
        <p className="page-subtitle">Đối chiếu trạng thái phiếu lương trong hệ thống. Trạng thái PAID là xác nhận nội bộ, không phải bằng chứng chuyển khoản ngân hàng.</p>
      </div>
    </div>
    <section className="card" style={{ padding: 16, marginBottom: 16 }}><MonthPicker value={period} onChange={value => { setLoading(true); setPeriod(value) }} label="Kỳ lương" /></section>
    {error && <p role="alert" style={{ marginBottom: 16, color: 'var(--status-error)' }}>{error}</p>}
    {loading ? <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Đang tải dữ liệu…</div>
      : <div className="stat-grid-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>{groups.map(group => <StatCard key={group.status} label={statusLabels[group.status]} value={`${group.rows.length} phiếu`} footerNote={formatCurrency(group.rows.reduce((sum, row) => sum + Number(row.net_salary || 0), 0))} />)}</div>}
    <section className="card" style={{ padding: 20, marginTop: 16 }}>
      <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 600, marginBottom: 6 }}>Quy trình hiện có</h2>
      <p className="page-subtitle" style={{ marginBottom: 12 }}>Kiểm tra công, tính lương, duyệt, đánh dấu chi trả và mở lại kỳ lương được thực hiện trong Quản lý bảng lương.</p>
      <Link className="btn btn-secondary" to="/payroll">Mở Quản lý bảng lương</Link>
      <p className="page-subtitle" style={{ marginTop: 12 }}>Chưa có dữ liệu giao dịch ngân hàng hoặc API đối soát chuyển khoản; không tự đánh dấu đối soát thành công.</p>
    </section>
  </div>
}
