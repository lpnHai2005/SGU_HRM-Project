import { MonthPicker } from '../components/common/MonthPicker'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/api'
import { AttendanceHero, type DashboardPageProps } from './DashboardPage'
import { AttendancePage } from './AttendancePage'
import { operationToday } from './ActivityPage'
import './OverviewPage.css'
export function OverviewPage(props:DashboardPageProps) {
  const isChainManager = props.user?.roles?.some((r: string) => ['ADMIN', 'HR_MANAGER', 'DIRECTOR'].includes(r))
  const branch = props.user?.roles?.includes('STORE_MANAGER') && !isChainManager
  const manager = isChainManager || branch
  const [tab, setTab] = useState(manager ? 'manager' : 'personal')
  const [period, setPeriod] = useState(operationToday().slice(0, 7))
  const [stats, setStats] = useState<any>(null), [leaves, setLeaves] = useState<any>(null), [error, setError] = useState('')
  const navigate = useNavigate()
  useEffect(() => {
    if (!manager || tab !== 'manager') return
    let live = true
    setStats(null)
    Promise.all([
      api.get('/reports/dashboard-stats', { period }),
      api.get('/leaves/summary/stats')
    ]).then(([a, b]) => {
      if (live) { setStats(a); setLeaves(b); setError('') }
    }).catch(e => {
      if (live) setError(e.message)
    })
    return () => { live = false }
  }, [manager, tab, period])
  const ratio = stats?.active_employees ? Math.round(stats.attendance_today.checked_in / stats.active_employees * 100) : 0
  const money = (v: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(v || 0)
  return (
    <div className="page-container overview-page">
      <h1>{manager ? 'Tổng quan' : 'Trang chủ'}</h1>
      {manager && (
        <div className="overview-tabs">
          <button className={`btn ${tab === 'manager' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('manager')}>
            {branch ? 'Quản lý Chi nhánh' : 'Quản lý Chuỗi'}
          </button>
          {branch && (
            <button className={`btn ${tab === 'personal' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('personal')}>
              Cá nhân
            </button>
          )}
        </div>
      )}
      {tab === 'personal' ? (
        <>
          <AttendanceHero attendance={null} todayAttendance={null} onCheckIn={props.onCheckIn} onCheckOut={props.onCheckOut} isLoading={props.attendanceLoading} />
          <AttendancePage user={props.user} personal />
        </>
      ) : (
        <>
          <section className="card overview-panel">
            <header>
              <h2>Quản lý báo cáo tổng hợp</h2>
              <MonthPicker value={period} onChange={setPeriod} label="Chọn kỳ thống kê" />
            </header>
            {error && <p role="alert">{error}</p>}
            <div className="stat-grid-4">
              {[
                ['Tổng nhân sự', stats?.active_employees, '/activity?kind=all'],
                ['Đang làm hôm nay', stats?.attendance_today?.working, '/activity?kind=working'],
                ['Đi muộn hôm nay', stats?.attendance_today?.late, '/activity?kind=late'],
                ['Đơn chờ duyệt', stats?.pending_leaves, '/leave'],
              ].map(([label, value, href]) => (
                <button className="overview-metric" key={label as string} onClick={() => navigate(href as string)}>
                  <span>{label}</span>
                  <strong>{value ?? '—'}</strong>
                  <small>Xem danh sách →</small>
                </button>
              ))}
            </div>
          </section>
          <div className="overview-columns">
            <section className="card overview-panel">
              <h2>Tỷ lệ hiện diện hôm nay</h2>
              <strong className="overview-rate">{ratio}%</strong>
              <progress max={100} value={Math.min(100, ratio)} />
              <p>{stats?.attendance_today?.checked_in ?? '—'} / {stats?.active_employees ?? '—'} nhân viên đã chấm công</p>
            </section>
            <section className="card overview-panel">
              <h2>Cơ cấu xử lý đơn từ & nghỉ phép</h2>
              {Object.entries({
                pending_store_approval: 'Chờ cửa hàng duyệt',
                pending_hr_approval: 'Chờ HR duyệt',
                approved: 'Đã duyệt',
                rejected: 'Từ chối',
                on_leave_today: 'Nghỉ phép hôm nay',
              }).map(([key, label]) => (
                <div className="overview-row" key={key}>
                  <span>{label}</span>
                  <strong>{leaves?.[key] ?? '—'}</strong>
                </div>
              ))}
            </section>
          </div>
          <section className="card overview-panel">
            <h2>Quỹ lương & Doanh số</h2>
            <p>Kỳ {period.split('-').reverse().join('/')}</p>
            <div className="stat-grid-4">
              {[
                ['Lương thực nhận', stats?.monthly_net_payroll_fund],
                ['Tổng thu nhập', stats?.monthly_gross_payroll_fund],
                ['Doanh số bán lẻ', stats?.total_retail_revenue],
              ].map(([label, value]) => (
                <div className="overview-metric" key={label as string}>
                  <span>{label}</span>
                  <strong style={{ fontSize: 22 }}>{stats ? money(value) : '—'}</strong>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
