import { useEffect, useState } from 'react'
import { api } from '../services/api'
import { formatCurrency } from '../utils/formatters'
import { EmptyState } from '../components/common/EmptyState'
import { Icons } from '../components/common/Icons'
import { MonthPicker } from '../components/common/MonthPicker'

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
  return <div className="page-container">
    <div className="page-header">
      <div>
        <h1 className="page-title">Doanh số & Hoa hồng</h1>
        <p className="page-subtitle">Dữ liệu kỳ lương và phạm vi cửa hàng được backend giới hạn theo tài khoản.</p>
      </div>
    </div>
    <section className="card" style={{ padding: 16, marginBottom: 16 }}><MonthPicker value={period} onChange={setPeriod} label="Kỳ thống kê" /></section>
    {error && <p role="alert" style={{ marginBottom: 16, color: 'var(--status-error)' }}>{error}</p>}
    {loading ? <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Đang tải dữ liệu…</div>
      : !sales.length ? <div className="card" style={{ padding: 24 }}><EmptyState icon={Icons.trendingUp} title="Chưa có doanh số" description="Kỳ này chưa ghi nhận doanh số nào." /></div>
      : <section className="card" style={{ padding: 0, overflow: 'hidden' }}><div className="table-responsive"><table className="data-table"><thead><tr><th>Nhân viên</th><th>Cửa hàng</th><th style={{ textAlign: 'right' }}>Doanh số</th><th style={{ textAlign: 'right' }}>Chỉ tiêu</th><th style={{ textAlign: 'right' }}>Hoàn thành</th><th style={{ textAlign: 'right' }}>Hoa hồng</th></tr></thead><tbody>
        {sales.map(row => <tr key={row.sale_record_id}>
          <td><strong>{row.employee_name}</strong><div className="table-user-sub">{row.employee_code}</div></td>
          <td>{row.store_name}</td>
          <td className="table-cell-mono" style={{ textAlign: 'right' }}>{formatCurrency(row.total_revenue)}</td>
          <td className="table-cell-mono" style={{ textAlign: 'right' }}>{formatCurrency(row.target_kpi)}</td>
          <td className="table-cell-mono" style={{ textAlign: 'right' }}>{Number(row.kpi_achievement_rate || 0).toFixed(1)}%</td>
          <td className="table-cell-mono" style={{ textAlign: 'right' }}>{formatCurrency(commissionByEmployee.get(row.employee_id))}</td>
        </tr>)}
      </tbody></table></div></section>}
  </div>
}
