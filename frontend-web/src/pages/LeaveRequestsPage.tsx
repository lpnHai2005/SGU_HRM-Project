import { useState, useEffect, useCallback } from 'react'
import { Icons } from '../components/common/Icons'
import { StatCard } from '../components/common/StatCard'
import { EmptyState } from '../components/common/EmptyState'
import { LEAVE_STATUS_LABELS } from '../constants/navigation'
import { formatDate } from '../utils/formatters'
import type { LeaveRequest, LeaveBalance } from '../types'

export interface LeaveRequestsPageProps {
  user: any
}

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case 'HR_APPROVED':
    case 'STORE_APPROVED':
      return 'active'
    case 'PENDING':
      return 'pending'
    case 'REJECTED':
      return 'rejected'
    default:
      return 'pending'
  }
}

export function LeaveRequestsPage({ user: _user }: LeaveRequestsPageProps) {
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([])
  const [leaveBalance, setLeaveBalance] = useState<LeaveBalance | null>(null)
  const [activeTab, setActiveTab] = useState('all')
  const [isLoading, setIsLoading] = useState(true)

  const fetchLeaveData = useCallback(async () => {
    setIsLoading(true)
    try {
      const { leaveApi } = await import('../services/api')
      const [requests, balance] = await Promise.all([
        leaveApi.getAll(),
        leaveApi.getMyBalance(),
      ])
      setLeaveRequests(requests || [])
      setLeaveBalance(balance)
    } catch (err) {
      console.error('Error fetching leave data:', err)
      setLeaveRequests([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLeaveData()
  }, [fetchLeaveData])

  const filteredRequests = leaveRequests.filter(req => {
    if (activeTab === 'all') return true
    if (activeTab === 'pending') return req.status === 'PENDING'
    if (activeTab === 'approved') return req.status === 'HR_APPROVED' || req.status === 'STORE_APPROVED'
    if (activeTab === 'rejected') return req.status === 'REJECTED'
    return true
  })

  const getStatusBadge = (status: string) => {
    return (
      <span className={`status-pill ${getStatusBadgeClass(status)}`}>
        {LEAVE_STATUS_LABELS[status] || status}
      </span>
    )
  }

  const pendingCount = leaveRequests.filter(r => r.status === 'PENDING').length
  const annualRemaining = leaveBalance?.annual_leave_remaining ?? 12

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Nghỉ phép</h1>
        </div>
        <button className="btn btn-primary" onClick={() => alert('Mở biểu mẫu tạo đơn nghỉ phép')}>
          {Icons.plus}
          Tạo đơn nghỉ phép
        </button>
      </div>

      <div className="stat-grid-4">
        <StatCard icon={Icons.calendar} iconColor="blue" label="Phép năm còn lại" value={`${annualRemaining} ngày`} />
        <StatCard icon={Icons.shield} iconColor="green" label="Ốm đau còn lại" value={`${5 - (leaveBalance?.sick_leave_used || 0)} ngày`} />
        <StatCard icon={Icons.clock} iconColor="amber" label="Đang chờ duyệt" value={`${pendingCount} đơn`} />
        <StatCard icon={Icons.checkCircle} iconColor="green" label="Đã dùng tháng này" value={`${leaveBalance?.annual_leave_used || 0} ngày`} />
      </div>

      <div className="card">
        <div className="card-header">
          <div className="tabs" style={{ marginBottom: 0, borderBottom: 'none', padding: 0 }}>
            {['all', 'pending', 'approved', 'rejected'].map((tab) => (
              <div
                key={tab}
                className={`tab ${activeTab === tab ? 'active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab === 'all' ? 'Tất cả' :
                 tab === 'pending' ? 'Chờ duyệt' :
                 tab === 'approved' ? 'Đã duyệt' : 'Từ chối'}
              </div>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="card-body" style={{ textAlign: 'center', padding: '40px' }}>
            Đang tải dữ liệu...
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Loại nghỉ</th>
                  <th>Từ ngày</th>
                  <th>Đến ngày</th>
                  <th>Lý do</th>
                  <th>Ngày gửi</th>
                  <th>Trạng thái</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredRequests.map((req) => (
                  <tr key={req.request_id}>
                    <td>
                      <span className="badge badge-blue">{req.leave_type_name || 'N/A'}</span>
                    </td>
                    <td><span className="table-cell-mono">{formatDate(req.start_date)}</span></td>
                    <td><span className="table-cell-mono">{formatDate(req.end_date)}</span></td>
                    <td>{req.reason || '-'}</td>
                    <td><span className="table-cell-mono">{formatDate(req.created_at)}</span></td>
                    <td>{getStatusBadge(req.status)}</td>
                    <td>
                      {req.status === 'PENDING' && (
                        <div className="btn-group">
                          <button className="btn btn-success btn-sm" title="Duyệt đơn">{Icons.check}</button>
                          <button className="btn btn-danger btn-sm" title="Từ chối">{Icons.x}</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {filteredRequests.length === 0 && (
                  <tr>
                    <td colSpan={7}>
                      <EmptyState icon={Icons.calendar} title="Chưa có đơn nghỉ phép" description="Không có yêu cầu nghỉ phép nào trong mục này." />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
