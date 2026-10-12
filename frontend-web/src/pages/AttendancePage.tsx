import { MonthPicker } from '../components/common/MonthPicker'
import { useState, useEffect, useMemo } from 'react'
import { Icons } from '../components/common/Icons'
import { StatCard } from '../components/common/StatCard'
import { EmptyState } from '../components/common/EmptyState'
import { formatDate, formatTime } from '../utils/formatters'
import type { Attendance, AttendanceSummary } from '../types'
import { attendanceApi } from '../services/api'
import './AttendancePage.css'
const sessionLabels: Record<string,string> = { NORMAL:'Đúng giờ', LATE:'Đi muộn', EARLY:'Về sớm', LATE_AND_EARLY:'Đi muộn & về sớm', OVERTIME:'Tăng ca', ANNUAL_LEAVE:'Nghỉ phép' }

export interface AttendancePageProps {
  user: any
  personal?: boolean
}

export function AttendancePage({ user, personal = false }: AttendancePageProps) {
  // Period filter (YYYY-MM), default current month
  const [selectedPeriod, setSelectedPeriod] = useState<string>(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  // Tab: 'my_timesheet' (Bảng công cá nhân) | 'team_timesheet' (Bảng công toàn chi nhánh)
  const activeTab = !personal && user?.roles?.some((r: string) => ['ADMIN','HR_MANAGER','STORE_MANAGER'].includes(r)) ? 'team_timesheet' : 'my_timesheet'

  // States
  const [summaryData, setSummaryData] = useState<AttendanceSummary | null>(null)
  const [attendanceHistory, setAttendanceHistory] = useState<Attendance[]>([])
  const [teamAttendances, setTeamAttendances] = useState<Attendance[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [searchEmployee, setSearchEmployee] = useState<string>('')

  // Roles
  const roles: string[] = user?.roles || []
  const periodDisplay = selectedPeriod.split('-').reverse().join('/')
  const isManager = !personal && (roles.includes('STORE_MANAGER') || roles.includes('HR_MANAGER') || roles.includes('ADMIN'))

  // Fetch Bảng công data
  const fetchTimesheetData = async () => {
    setIsLoading(true)
    setLoadError('')
    try {
      if (isManager) {
        setTeamAttendances(await attendanceApi.getAll({ period: selectedPeriod }) || [])
        return
      }
      // 1. Lấy dữ liệu 8 chỉ số tổng hợp tháng (Khớp chức năng nghiệp vụ)
      const summaryRes = await attendanceApi.getMySummary(selectedPeriod)
      setSummaryData(summaryRes)

      // 2. Lấy nhật ký chấm công chi tiết trong tháng
      const historyRes = await attendanceApi.getMyHistory(selectedPeriod)
      setAttendanceHistory(historyRes || [])

    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Không tải được bảng công.')
      console.error('Error fetching timesheet data:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchTimesheetData()
  }, [selectedPeriod, personal])

  // Điều hướng tháng
  const handlePrevMonth = () => {
    const [y, m] = selectedPeriod.split('-').map(Number)
    const prevDate = new Date(y, m - 2, 1)
    setSelectedPeriod(`${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`)
  }

  const handleNextMonth = () => {
    const [y, m] = selectedPeriod.split('-').map(Number)
    const nextDate = new Date(y, m, 1)
    setSelectedPeriod(`${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`)
  }

  // Lọc nhật ký cá nhân
  const filteredPersonalRecords = useMemo(() => {
    return attendanceHistory.filter(att => {
      if (statusFilter === 'ALL') return true
      if (statusFilter === 'LATE') return (att.late_minutes || 0) > 15
      if (statusFilter === 'EARLY') return (att.early_minutes || 0) > 0
      if (statusFilter === 'OVERTIME') return (att.overtime_hours || 0) > 0
      if (statusFilter === 'NORMAL' || statusFilter === 'LATE_AND_EARLY') return att.status === statusFilter
      return true
    })
  }, [attendanceHistory, statusFilter])

  const personalPeriodTotals = useMemo(() => attendanceHistory.reduce((totals, att) => ({
    workHours: totals.workHours + Number(att.actual_work_hours || 0),
    lateMinutes: totals.lateMinutes + Number(att.late_minutes || 0),
    earlyMinutes: totals.earlyMinutes + Number(att.early_minutes || 0),
    overtimeHours: totals.overtimeHours + Number(att.overtime_hours || 0),
  }), { workHours: 0, lateMinutes: 0, earlyMinutes: 0, overtimeHours: 0 }), [attendanceHistory])

  // Lọc bảng công chi nhánh
  const filteredTeamRecords = useMemo(() => {
    return teamAttendances.filter(att => {
      const matchName = !searchEmployee || (att.employee_name && att.employee_name.toLowerCase().includes(searchEmployee.toLowerCase()))
      if (!matchName) return false
      if (statusFilter === 'ALL') return true
      if (statusFilter === 'LATE') return (att.late_minutes || 0) > 15
      if (statusFilter === 'EARLY') return (att.early_minutes || 0) > 0
      if (statusFilter === 'OVERTIME') return (att.overtime_hours || 0) > 0
      if (statusFilter === 'NORMAL' || statusFilter === 'LATE_AND_EARLY') return att.status === statusFilter
      return true
    })
  }, [teamAttendances, searchEmployee, statusFilter])

  // 8 Chỉ số công
  const actualDays = summaryData?.working_days?.actual_days || 0
  const standardDays = summaryData?.working_days?.standard_days || 26
  const totalHours = summaryData?.working_days?.total_hours || 0

  // Quỹ phép
  const annualLeave = summaryData?.leave_quota?.annual_leave || 0
  const usedLeave = summaryData?.leave_quota?.used_leave || 0
  const remainingLeave = summaryData?.leave_quota?.remaining_leave || 0

  // Đi muộn & Về sớm
  const lateCount = summaryData?.late_arrivals?.count || 0
  const lateMinutes = summaryData?.late_arrivals?.minutes || 0
  const earlyCount = summaryData?.early_departures?.count || 0
  const earlyMinutes = summaryData?.early_departures?.minutes || 0

  // Làm thêm & Công tác & Tăng ca
  const extraHours = summaryData?.extra_work?.hours || 0
  const businessTripDays = summaryData?.business_trips?.days || 0
  const otShifts = summaryData?.overtime?.shifts_count || 0
  const otHours = summaryData?.overtime?.hours || 0
  const compensatoryDays = summaryData?.compensatory_leave?.total || 0

  // Xuất file CSV báo cáo công
  const handleExportCSV = () => {
    const records = activeTab === 'my_timesheet' ? filteredPersonalRecords : filteredTeamRecords
    const headers = ['Ngày làm việc', 'Nhân viên', 'Ca làm việc', 'Check-in', 'Check-out', 'Đi muộn (phút)', 'Về sớm (phút)', 'Giờ công thực tế (h)', 'Tăng ca (h)', 'Trạng thái', 'Ghi chú']
    
    const rows = records.map(att => [
      att.work_date,
      att.employee_name || user?.full_name || 'Nhân viên',
      att.shift_name || 'Ca làm việc',
      att.check_in_time ? formatTime(att.check_in_time) : '--:--',
      att.check_out_time ? formatTime(att.check_out_time) : '--:--',
      att.late_minutes || 0,
      att.early_minutes || 0,
      att.actual_work_hours || 0,
      att.overtime_hours || 0,
      sessionLabels[att.status] || att.status,
      `"${(att.notes || '').replace(/"/g, '""')}"`
    ])

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `Bang_Cong_${selectedPeriod}.csv`
    link.click()
  }

  return (
    <div className="page-container">
      {/* 1. Header Bar: Tiêu đề trang & Bộ điều khiển kỳ công đồng bộ chuẩn hệ thống */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 className="page-title">{isManager ? 'Quản lý công' : 'Bảng công cá nhân'}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px' }}>
            Bảng tổng hợp ngày công, thời gian làm việc & dữ liệu chấm công chi tiết TechZone
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--surface-subtle)', padding: '3px 6px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)' }}>
            <button className="btn btn-secondary btn-sm" onClick={handlePrevMonth} title="Tháng trước" style={{ border: 'none', background: 'transparent', padding: '4px 8px' }}>‹</button>
            <MonthPicker value={selectedPeriod} onChange={setSelectedPeriod}/>
            <button className="btn btn-secondary btn-sm" onClick={handleNextMonth} title="Tháng sau" style={{ border: 'none', background: 'transparent', padding: '4px 8px' }}>›</button>
          </div>

          <button className="btn btn-secondary" onClick={handleExportCSV} style={{ height: '38px' }}>
            {Icons.download}
            <span>Xuất báo cáo</span>
          </button>
        </div>
      </div>

      {loadError && <p role="alert">{loadError}</p>}
      {/* 2. 8 THẺ CHỈ SỐ ĐỒNG BỘ LAYOUT STAT-GRID VÀ STYLE CHUẨN VERO DESIGN SYSTEM */}
      {activeTab === 'my_timesheet' && <div className="stat-grid-4">
        {/* Card 1: Ngày công */}
        <StatCard
          icon={Icons.checkCircle}
          iconColor="green"
          label="NGÀY CÔNG THỰC TẾ"
          value={`${actualDays} công`}
          footerNote={`Công chuẩn: ${standardDays} | Làm: ${totalHours}h | Trễ/sớm tính lương: ${summaryData?.working_days?.payroll_time_adjustment_hours ?? 0}h`}
        />

        {/* Card 2: Quỹ phép */}
        <StatCard
          icon={Icons.calendar}
          iconColor="blue"
          label="QUỸ PHÉP NĂM CÒN LẠI"
          value={`${remainingLeave} ngày`}
          footerNote={`Phép năm: ${annualLeave} ngày | Đã nghỉ: ${usedLeave} ngày`}
        />

        {/* Card 3: Đi muộn */}
        <StatCard
          icon={Icons.clock}
          iconColor={lateCount > 0 ? 'red' : 'green'}
          label="ĐI MUỘN (LATE)"
          value={`${lateCount} lần (${lateMinutes}p)`}
          trend={lateCount > 0 ? 'Có vi phạm' : 'Tốt'}
          trendDirection={lateCount > 0 ? 'warning' : 'up'}
          footerNote={lateCount > 0 ? 'Có vi phạm quy chế trễ (>15p)' : 'Đúng giờ theo phân ca'}
        />

        {/* Card 4: Về sớm */}
        <StatCard
          icon={Icons.logOut}
          iconColor={earlyCount > 0 ? 'amber' : 'green'}
          label="VỀ SỚM (EARLY)"
          value={`${earlyCount} lần (${earlyMinutes}p)`}
          trend={earlyCount > 0 ? 'Có về sớm' : 'Đúng giờ'}
          trendDirection={earlyCount > 0 ? 'warning' : 'up'}
          footerNote={earlyCount > 0 ? 'Có về sớm trước giờ tan ca' : 'Tuân thủ giờ ca làm việc'}
        />

        {/* Card 5: Làm thêm */}
        <StatCard
          icon={Icons.zap}
          iconColor="blue"
          label="LÀM THÊM (EXTRA WORK)"
          value={`${extraHours} giờ`}
          footerNote="Ngoài ca chuẩn, duyệt bởi CHT"
        />

        {/* Card 6: Công tác */}
        <StatCard
          icon={Icons.briefcase}
          iconColor="blue"
          label="CÔNG TÁC (TRIP)"
          value={`${businessTripDays} ngày`}
          footerNote="Hưởng 100% lương & phụ cấp chuyến"
        />

        {/* Card 7: Tăng ca */}
        <StatCard
          icon={Icons.trendingUp}
          iconColor="green"
          label="TĂNG CA (OVERTIME)"
          value={`${otHours} giờ`}
          footerNote={`${otShifts} công OT | Hệ số lương 1.5x`}
        />

        {/* Card 8: Quỹ nghỉ bù */}
        <StatCard
          icon={Icons.shield}
          iconColor="amber"
          label="QUỸ NGHỈ BÙ"
          value={`${compensatoryDays} ngày`}
          footerNote="Tổng số ngày nghỉ bù khả dụng"
        />
      </div>}

      {/* 4. BẢNG DỮ LIỆU NHẬT KÝ CHI TIẾT */}
      <div className="card">
        {/* Thanh công cụ lọc */}
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Lọc trạng thái:</span>
            <select
              className="form-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ width: 'auto', minWidth: '170px' }}
            >
              <option value="ALL">Tất cả ca làm việc</option>
              <option value="NORMAL">Đúng giờ</option>
              <option value="LATE">Có đi muộn</option>
              <option value="EARLY">Có về sớm</option>
              <option value="LATE_AND_EARLY">Đi muộn & về sớm</option>
              <option value="OVERTIME">Có tăng ca (OT)</option>
            </select>

            {activeTab === 'team_timesheet' && (
              <div className="search-box" style={{ minWidth: '220px' }}>
                <span className="search-icon">{Icons.search}</span>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Tìm theo tên nhân sự..."
                  value={searchEmployee}
                  onChange={(e) => setSearchEmployee(e.target.value)}
                  style={{ height: '36px' }}
                />
              </div>
            )}
          </div>

          <div>
            <span style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
              Hiển thị{' '}
              <strong>
                {activeTab === 'my_timesheet' ? filteredPersonalRecords.length : filteredTeamRecords.length}
              </strong>{' '}
              bản ghi
            </span>
          </div>
        </div>

        {/* Data Table */}
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                {activeTab === 'team_timesheet' && <th>Nhân viên</th>}
                <th>Ngày làm việc</th>
                <th>Ca làm việc</th>
                <th>Check-in</th>
                <th>Check-out</th>
                <th>Đi muộn</th>
                <th>Về sớm</th>
                <th>Giờ thực tế</th>
                <th>Tăng ca (OT)</th>
                <th>Trạng thái</th>
                <th>Ghi chú / Vị trí</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={activeTab === 'team_timesheet' ? 11 : 10} style={{ textAlign: 'center', padding: '40px' }}>
                    Đang tải dữ liệu chấm công...
                  </td>
                </tr>
              ) : (activeTab === 'my_timesheet' ? filteredPersonalRecords : filteredTeamRecords).map((att) => {
                const isLate = (att.late_minutes || 0) > 15
                const isEarly = (att.early_minutes || 0) > 0
                const isOT = (att.overtime_hours || 0) > 0

                return (
                  <tr key={att.attendance_id}>
                    {activeTab === 'team_timesheet' && (
                      <td>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {att.employee_name || `Mã #${att.employee_id}`}
                        </span>
                      </td>
                    )}
                    <td>
                      <span className="table-cell-mono" style={{ fontWeight: 600 }}>
                        {formatDate(att.work_date)}
                      </span>
                    </td>
                    <td>
                      <span>{att.shift_name || 'Chưa có tên ca'}</span>
                    </td>
                    <td>
                      <span className={`table-cell-mono ${isLate ? 'text-red' : ''}`} style={{ fontWeight: 600 }}>
                        {att.check_in_time ? formatTime(att.check_in_time) : '--:--'}
                      </span>
                    </td>
                    <td>
                      <span className={`table-cell-mono ${isEarly ? 'text-amber' : ''}`} style={{ fontWeight: 600 }}>
                        {att.check_out_time ? formatTime(att.check_out_time) : '--:--'}
                      </span>
                    </td>
                    <td>
                      {isLate ? (
                        <span className="status-pill rejected">{att.late_minutes} phút</span>
                      ) : (
                        <span style={{ color: 'var(--status-success)', fontSize: '12px' }}>{att.late_minutes || 0}p</span>
                      )}
                    </td>
                    <td>
                      {isEarly ? (
                        <span className="status-pill pending">{att.early_minutes} phút</span>
                      ) : (
                        <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>0p</span>
                      )}
                    </td>
                    <td>
                      <span className="table-cell-mono" style={{ fontWeight: 700 }}>
                        {att.actual_work_hours || 0}h
                      </span>
                    </td>
                    <td>
                      {isOT ? (
                        <span className="status-pill active">+{att.overtime_hours}h</span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>--</span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`status-pill ${
                          att.status === 'ANNUAL_LEAVE' ? 'active' : isLate ? 'rejected' : isEarly ? 'pending' : isOT ? 'active' : 'active'
                        }`}
                      >
                        {sessionLabels[att.status] || att.status}
                      </span>
                    </td>
                    <td style={{ maxWidth: '240px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                      {att.notes || '--'}
                    </td>
                  </tr>
                )
              })}

              {!isLoading && (activeTab === 'my_timesheet' ? filteredPersonalRecords : filteredTeamRecords).length === 0 && (
                <tr>
                  <td colSpan={activeTab === 'team_timesheet' ? 11 : 10}>
                    <EmptyState
                      icon={Icons.calendar}
                      title="Chưa có dữ liệu bảng công"
                      description={`Không tìm thấy bản ghi ngày công nào trong ${periodDisplay} phù hợp bộ lọc.`}
                    />
                  </td>
                </tr>
              )}
            </tbody>
            {activeTab === 'my_timesheet' && !isLoading && attendanceHistory.length > 0 && (
              <tfoot>
                <tr className="attendance-personal-total-row">
                  <th colSpan={4}>TỔNG KỲ {periodDisplay} · {attendanceHistory.length} phiên</th>
                  <th>{personalPeriodTotals.lateMinutes} phút · {(personalPeriodTotals.lateMinutes / 60).toFixed(2)} giờ</th>
                  <th>{personalPeriodTotals.earlyMinutes} phút</th>
                  <th>{personalPeriodTotals.workHours.toFixed(2)} giờ</th>
                  <th>{personalPeriodTotals.overtimeHours.toFixed(2)} giờ</th>
                  <th colSpan={2}>Tổng trễ/sớm quy đổi {( (personalPeriodTotals.lateMinutes + personalPeriodTotals.earlyMinutes) / 60).toFixed(2)} giờ</th>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}

export default AttendancePage
