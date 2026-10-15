import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { payrollApi } from '../services/api'
import { formatCurrency } from '../utils/formatters'
import type { Payroll } from '../types'

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
  return <div className="page-container"><h1>Thanh toán & Đối soát</h1>
    <p>Đối chiếu trạng thái phiếu lương trong hệ thống. Trạng thái PAID là xác nhận nội bộ, không phải bằng chứng chuyển khoản ngân hàng.</p>
    <section className="card" style={{ padding: 20, marginBottom: 20 }}><label>Kỳ lương <input className="form-input" type="month" value={period} onChange={event => { setLoading(true); setPeriod(event.target.value) }} /></label></section>
    {error && <p role="alert">{error}</p>}{loading ? <p>Đang tải dữ liệu…</p> : <div className="stat-grid-4">{groups.map(group => <div className="card" key={group.status} style={{ padding: 20 }}><span>{statusLabels[group.status]}</span><h2>{group.rows.length} phiếu</h2><p>{formatCurrency(group.rows.reduce((sum, row) => sum + Number(row.net_salary || 0), 0))}</p></div>)}</div>}
    <section className="card" style={{ padding: 20, marginTop: 20 }}><h2>Quy trình hiện có</h2><p>Kiểm tra công, tính lương, duyệt, đánh dấu chi trả và mở lại kỳ lương được thực hiện trong Quản lý bảng lương.</p><Link className="btn btn-secondary" to="/payroll">Mở Quản lý bảng lương</Link><p style={{ marginTop: 16 }}>Chưa có dữ liệu giao dịch ngân hàng hoặc API đối soát chuyển khoản; không tự đánh dấu đối soát thành công.</p></section>
  </div>
}
