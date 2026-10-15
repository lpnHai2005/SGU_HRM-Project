import { useEffect, useState } from 'react'
import { api } from '../services/api'
import { formatCurrency } from '../utils/formatters'

type SalesRow = { sale_record_id: number; employee_id: number; employee_name: string; employee_code: string; store_name: string; total_revenue: number; target_kpi: number; kpi_achievement_rate: number }
type CommissionRow = { commission_id: number; employee_id: number; employee_name: string; commission_amount: number }
export function SalesCommissionPage() {
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7))
  const [sales, setSales] = useState<SalesRow[]>([])
  const [commissions, setCommissions] = useState<CommissionRow[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([api.get<SalesRow[]>('/payrolls/sales-records', { period }), api.get<CommissionRow[]>('/payrolls/commissions', { period })])
      .then(([saleRows, commissionRows]) => { if (active) { setSales(saleRows); setCommissions(commissionRows); setError('') } })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Không tải được doanh số') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [period])
  const commissionByEmployee = new Map(commissions.map(row => [row.employee_id, row.commission_amount]))
  return <div className="page-container"><h1>Doanh số & Hoa hồng</h1>
    <p>Dữ liệu kỳ lương và phạm vi cửa hàng được backend giới hạn theo tài khoản.</p>
    <section className="card" style={{ padding: 20, marginBottom: 20 }}><label>Kỳ thống kê <input className="form-input" type="month" value={period} onChange={event => setPeriod(event.target.value)} /></label></section>
    {error && <p role="alert">{error}</p>}
    {loading ? <p>Đang tải dữ liệu…</p> : <section className="card" style={{ padding: 20 }}><div className="table-container"><table className="data-table"><thead><tr><th>Nhân viên</th><th>Cửa hàng</th><th>Doanh số</th><th>Chỉ tiêu</th><th>Hoàn thành</th><th>Hoa hồng</th></tr></thead><tbody>
      {sales.map(row => <tr key={row.sale_record_id}><td>{row.employee_name} · {row.employee_code}</td><td>{row.store_name}</td><td>{formatCurrency(row.total_revenue)}</td><td>{formatCurrency(row.target_kpi)}</td><td>{Number(row.kpi_achievement_rate || 0).toFixed(1)}%</td><td>{formatCurrency(commissionByEmployee.get(row.employee_id))}</td></tr>)}
      {!sales.length && <tr><td colSpan={6}>Chưa có doanh số trong kỳ này.</td></tr>}
    </tbody></table></div></section>}
  </div>
}
