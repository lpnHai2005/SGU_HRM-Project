import { useState, useEffect } from 'react'
import { StatCard } from '../components/common/StatCard'
import type { Employee } from '../types'

export interface ReportsPageProps {
  user: any
}

export function ReportsPage({ user: _user }: ReportsPageProps) {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [_isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true)
      try {
        const { employeeApi } = await import('../services/api')
        const data = await employeeApi.getAll()
        setEmployees(data || [])
      } catch (err) {
        console.error('Error fetching data from database:', err)
        setEmployees([])
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [])

  const activeCount = employees.filter(e => e.employment_status === 'ACTIVE').length
  const onLeaveCount = employees.filter(e => e.employment_status === 'ON_LEAVE').length

  const storeBreakdown = employees.reduce((acc, emp) => {
    const storeName = emp.store_name || emp.department_name || 'Văn phòng chính'
    acc[storeName] = (acc[storeName] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Báo cáo & Thống kê</h1>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => alert('Xuất báo cáo PDF')}>
            Xuất PDF
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => alert('Xuất báo cáo Excel')}>
            Xuất Excel
          </button>
        </div>
      </div>

      <div className="stat-grid-4">
        <StatCard
          label="Tổng nhân sự hệ thống"
          value={employees.length}
        />
        <StatCard
          label="Đang làm việc ca này"
          value={activeCount}
        />
        <StatCard
          label="Đang nghỉ phép"
          value={onLeaveCount}
        />
        <StatCard
          label="Đã thôi việc"
          value={employees.length - activeCount - onLeaveCount}
        />
      </div>

      <div className="grid-two-col">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Nhân viên theo cửa hàng / phòng ban</h3>
          </div>
          <div className="card-body">
            {Object.keys(storeBreakdown).length === 0 ? (
              <div style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--text-tertiary)', fontSize: '13px' }}>
                Chưa ghi nhận dữ liệu nhân sự theo chi nhánh
              </div>
            ) : (
              Object.entries(storeBreakdown).map(([store, count]) => (
                <div key={store} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                  <span style={{ width: '180px', fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>{store}</span>
                  <div style={{ flex: 1 }}>
                    <div className="progress">
                      <div className="progress-bar blue" style={{ width: `${(count / (employees.length || 1)) * 100}%` }} />
                    </div>
                  </div>
                  <span className="mono" style={{ width: '36px', textAlign: 'right', fontSize: '12px', fontWeight: 600 }}>{count}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Tình trạng nhân sự</h3>
          </div>
          <div className="card-body">
            {[
              { label: 'Đang làm việc', count: activeCount, color: 'green', percent: employees.length ? (activeCount / employees.length) * 100 : 0 },
              { label: 'Đang nghỉ phép', count: onLeaveCount, color: 'amber', percent: employees.length ? (onLeaveCount / employees.length) * 100 : 0 },
              { label: 'Đã nghỉ việc', count: employees.length - activeCount - onLeaveCount, color: 'red', percent: employees.length ? ((employees.length - activeCount - onLeaveCount) / employees.length) * 100 : 0 },
            ].map((item) => (
              <div key={item.label} style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span className="text-sm">{item.label}</span>
                  <span className="text-sm font-medium">{item.count} nhân viên</span>
                </div>
                <div className="progress">
                  <div className={`progress-bar ${item.color}`} style={{ width: `${item.percent}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
