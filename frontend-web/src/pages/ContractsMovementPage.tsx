import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { employeeApi } from '../services/api'
import { formatCurrency, formatDate } from '../utils/formatters'
import type { Contract } from '../types'

export function ContractsMovementPage() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    employeeApi.getContracts().then(rows => { if (active) { setContracts(rows); setError('') } })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Không tải được hợp đồng') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  const filtered = contracts.filter(row => `${row.contract_number} ${row.employee_name || ''}`.toLowerCase().includes(query.toLowerCase()))
  return <div className="page-container">
    <h1>Hợp đồng & Biến động nhân sự</h1>
    <p>Danh sách hợp đồng từ hệ thống. Tạo, sửa hợp đồng và cập nhật nhân sự hiện thực hiện trong hồ sơ nhân viên.</p>
    <Link className="btn btn-secondary" to="/employees">Mở quản lý nhân viên</Link>
    <section className="card" style={{ padding: 20, marginTop: 20 }}>
      <label>Tìm hợp đồng <input className="form-input" value={query} onChange={event => setQuery(event.target.value)} placeholder="Số hợp đồng hoặc tên nhân viên" /></label>
      {error && <p role="alert">{error}</p>}
      {loading ? <p>Đang tải hợp đồng…</p> : <div className="table-container"><table className="data-table"><thead><tr><th>Số hợp đồng</th><th>Nhân viên</th><th>Loại</th><th>Hiệu lực</th><th>Lương cơ bản</th><th>Trạng thái</th></tr></thead><tbody>
        {filtered.map(row => <tr key={row.contract_id}><td>{row.contract_number}</td><td>{row.employee_name || row.employee_id}</td><td>{row.contract_type}</td><td>{formatDate(row.start_date)} – {formatDate(row.end_date)}</td><td>{formatCurrency(row.basic_salary)}</td><td>{row.status}</td></tr>)}
        {!filtered.length && <tr><td colSpan={6}>Không có hợp đồng phù hợp.</td></tr>}
      </tbody></table></div>}
    </section>
    <section className="card" style={{ padding: 20, marginTop: 20 }}><h2>Biến động nhân sự</h2><p>Chưa có API lịch sử điều chuyển, bổ nhiệm và nghỉ việc tập trung. Các thao tác hiện có trong Quản lý nhân viên; lịch sử biến động cần bổ sung audit trước khi hiển thị tại đây.</p></section>
  </div>
}
