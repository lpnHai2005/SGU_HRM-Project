import { useState, useEffect } from 'react'
import { Icons } from '../components/common/Icons'
import { StatCard } from '../components/common/StatCard'
import { EmptyState } from '../components/common/EmptyState'
import { formatCurrency, formatDate, formatTime } from '../utils/formatters'
import type { Attendance } from '../types'

export interface AttendancePageProps {
  user: any
}

export function AttendancePage({ user: _user }: AttendancePageProps) {
  const [attendanceHistory, setAttendanceHistory] = useState<Attendance[]>([])
  const [selectedPeriod, setSelectedPeriod] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchAttendance = async () => {
      setIsLoading(true)
      try {
        const { attendanceApi } = await import('../services/api')
        const data = await attendanceApi.getMyHistory(selectedPeriod)
        setAttendanceHistory(data || [])
      } catch (err) {
        console.error('Error fetching attendance:', err)
        setAttendanceHistory([])
      } finally {
        setIsLoading(false)
      }
    }

    fetchAttendance()
  }, [selectedPeriod])

  const totalDays = attendanceHistory.length
  const lateDays = attendanceHistory.filter(a => a.late_minutes && a.late_minutes > 0).length
  const totalOT = attendanceHistory.reduce((sum, a) => sum + (a.overtime_hours || 0), 0)

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Chấm công</h1>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <input
            type="month"
            className="form-input"
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
            style={{ width: 'auto' }}
          />
        </div>
      </div>

      <div className="stat-grid-4">
        <StatCard icon={Icons.checkCircle} iconColor="green" label="Ngày công" value={`${totalDays} ngày`} />
        <StatCard icon={Icons.clockOutline} iconColor="blue" label="Số lần đi muộn" value={`${lateDays} lần`} />
        <StatCard icon={Icons.zap} iconColor="amber" label="Tổng giờ OT" value={`${totalOT} giờ`} />
        <StatCard icon={Icons.dollar} iconColor="green" label="Tiền OT" value={formatCurrency(0)} />
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Lịch sử chấm công</h3>
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
                  <th>Ngày</th>
                  <th>Ca làm việc</th>
                  <th>Check-in</th>
                  <th>Check-out</th>
                  <th>Số giờ</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {attendanceHistory.map((att, index) => (
                  <tr key={index}>
                    <td><span className="table-cell-mono">{formatDate(att.work_date)}</span></td>
                    <td>{att.shift_name || 'N/A'}</td>
                    <td>
                      <span className={`table-cell-mono ${att.late_minutes && att.late_minutes > 0 ? 'text-red' : ''}`}>
                        {att.check_in_time ? formatTime(att.check_in_time) : '--:--'}
                        {att.late_minutes && att.late_minutes > 0 && ` (Trễ ${att.late_minutes}p)`}
                      </span>
                    </td>
                    <td><span className="table-cell-mono">{att.check_out_time ? formatTime(att.check_out_time) : '--:--'}</span></td>
                    <td><span className="table-cell-mono">{att.actual_work_hours || 0}h</span></td>
                    <td>
                      <span className={`status-pill ${att.late_minutes && att.late_minutes > 0 ? 'pending' : 'active'}`}>
                        {att.late_minutes && att.late_minutes > 0 ? 'Đi muộn' : 'Đúng giờ'}
                      </span>
                    </td>
                  </tr>
                ))}
                {attendanceHistory.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <EmptyState
                        icon={Icons.clock}
                        title="Chưa có dữ liệu"
                        description="Không có bản ghi chấm công nào cho kỳ đã chọn."
                      />
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
