import { useEffect, useState } from 'react'
import { payrollApi } from '../services/api'
import { formatCurrency, formatDate } from '../utils/formatters'

type Project = { project_id: number; project_code: string; project_name: string; description?: string; start_date: string; end_date?: string; status: string; budget?: number | null; members: { project_member_id: number; employee_name: string; project_role: string; project_allowance: number }[] }
export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => { let active = true; payrollApi.getProjects().then(rows => { if (active) { setProjects(rows); setError('') } }).catch(err => { if (active) setError(err instanceof Error ? err.message : 'Không tải được dự án') }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [])
  return <div className="page-container"><h1>Dự án</h1><p>Dự án và thành viên hiển thị theo phạm vi tài khoản đã đăng nhập.</p>
    {error && <p role="alert">{error}</p>}{loading && <p>Đang tải dự án…</p>}
    {!loading && !projects.length && <section className="card" style={{ padding: 20 }}>Chưa có dự án trong phạm vi của bạn.</section>}
    {projects.map(project => <section className="card kpi-hover-card" key={project.project_id} style={{ padding: 20, marginBottom: 16 }}><h2>{project.project_name}</h2><p>{project.project_code} · {project.status} · {formatDate(project.start_date)} – {formatDate(project.end_date)}</p>{project.description && <p>{project.description}</p>}{project.budget != null && <p>Ngân sách: {formatCurrency(project.budget)}</p>}
      <div className="table-container"><table className="data-table"><thead><tr><th>Thành viên</th><th>Vai trò</th><th>Phụ cấp</th></tr></thead><tbody>{project.members.map(member => <tr key={member.project_member_id}><td>{member.employee_name}</td><td>{member.project_role}</td><td>{formatCurrency(member.project_allowance)}</td></tr>)}</tbody></table></div>
    </section>)}
  </div>
}
