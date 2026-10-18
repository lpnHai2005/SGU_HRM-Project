import { useEffect, useState } from 'react'
import { reportApi } from '../services/api'
import { formatCurrency } from '../utils/formatters'
import { MonthPicker } from '../components/common/MonthPicker'

type Unit = { unit_name: string; employee_count: number; total_base_salary: number; total_overtime: number; total_allowances: number; total_commissions: number; total_bonuses: number; total_gross: number; total_insurance: number; total_penalties: number; total_net: number }
type Fund = { salary_period: string; company_totals: { total_headcount: number; total_gross_fund: number; total_net_fund: number; total_insurance_fund: number; total_commission_fund: number }; by_unit: Unit[] }

export function PayrollFundPage({ branch }: { branch: boolean }) {
  const [period, setPeriod] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7))
  const [data, setData] = useState<Fund | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    reportApi.getPayrollFund(period).then(result => { if (active) { setData(result); setError('') } })
      .catch(err => { if (active) { setData(null); setError(err instanceof Error ? err.message : 'Không tải được quỹ lương') } })
    return () => { active = false }
  }, [period])
  const totals = data?.company_totals
  return <div className="page-container"><h1>{branch ? 'Quỹ lương chi nhánh' : 'Quỹ lương'}</h1>
    <p>{branch ? 'Chỉ hiển thị nhân sự thuộc cửa hàng được giao.' : 'Tổng hợp quỹ lương theo đơn vị.'} Số liệu gồm phiếu nháp và phiếu đã duyệt trong kỳ, chưa đồng nghĩa đã chi trả.</p>
    <section className="card" style={{ padding: 20, marginBottom: 20 }}><MonthPicker value={period} onChange={value => { setData(null); setPeriod(value) }} label="Kỳ lương" /></section>
    {error && <p role="alert">{error}</p>}
    {data ? <><div className="stat-grid-4">
      {[['Nhân sự', totals?.total_headcount], ['Quỹ lương gộp', formatCurrency(totals?.total_gross_fund)], ['Quỹ thực nhận dự kiến', formatCurrency(totals?.total_net_fund)], ['Bảo hiểm', formatCurrency(totals?.total_insurance_fund)]].map(([label, value]) => <div className="card" key={String(label)} style={{ padding: 20 }}><span>{label}</span><h2>{value}</h2></div>)}
    </div><section className="card" style={{ padding: 20, marginTop: 20 }}><h2>Theo đơn vị</h2><div className="table-container"><table className="data-table"><thead><tr><th>Đơn vị</th><th>Nhân sự</th><th>Lương cơ bản</th><th>OT</th><th>Hoa hồng</th><th>Thưởng</th><th>Lương gộp</th><th>Thực nhận dự kiến</th></tr></thead><tbody>{data.by_unit.map(row => <tr key={row.unit_name}><td>{row.unit_name}</td><td>{row.employee_count}</td><td>{formatCurrency(row.total_base_salary)}</td><td>{formatCurrency(row.total_overtime)}</td><td>{formatCurrency(row.total_commissions)}</td><td>{formatCurrency(row.total_bonuses)}</td><td>{formatCurrency(row.total_gross)}</td><td>{formatCurrency(row.total_net)}</td></tr>)}{!data.by_unit.length && <tr><td colSpan={8}>Chưa có bảng lương trong kỳ.</td></tr>}</tbody></table></div></section></> : !error && <p>Đang tải quỹ lương…</p>}
  </div>
}
