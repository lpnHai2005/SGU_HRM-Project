import { useState, useEffect, useMemo } from 'react'
import { Icons } from '../components/common/Icons'
import { EmptyState } from '../components/common/EmptyState'
import { formatDate, formatTime } from '../utils/formatters'
import type { Attendance, AttendanceSummary } from '../types'
import { attendanceApi } from '../services/api'
import './AttendancePage.css'

export interface AttendancePageProps {
  user: any
}

export function AttendancePage({ user }: AttendancePageProps) {
  // Period filter (YYYY-MM), default current month
  const [selectedPeriod, setSelectedPeriod] = useState<string>(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  // Tab: 'my_timesheet' (Bảng công cá nhân) | 'team_timesheet' (Bảng công toàn chi nhánh)
  const [activeTab, setActiveTab] = useState<'my_timesheet' | 'team_timesheet'>('my_timesheet')

  // States
  const [summaryData, setSummaryData] = useState<AttendanceSummary | null>(null)
  const [attendanceHistory, setAttendanceHistory] = useState<Attendance[]>([])
  const [teamAttendances, setTeamAttendances] = useState<Attendance[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [searchEmployee, setSearchEmployee] = useState<string>('')

  // Roles
  const roles: string[] = user?.roles || []
  const isManager = roles.includes('STORE_MANAGER') || roles.includes('HR_MANAGER') || roles.includes('ADMIN')

  // Fetch Bảng công data
  const fetchTimesheetData = async () => {
    setIsLoading(true)
    try {
      // 1. Lấy dữ liệu 8 chỉ số tổng hợp tháng (Khớp chức năng nghiệp vụ chucnang1.jpg)
      const summaryRes = await attendanceApi.getMySummary(selectedPeriod)
      setSummaryData(summaryRes)

      // 2. Lấy nhật ký chấm công chi tiết trong tháng
      const historyRes = await attendanceApi.getMyHistory(selectedPeriod)
      setAttendanceHistory(historyRes || [])

      // 3. Nếu là Quản lý, lấy dữ liệu toàn chi nhánh
      if (isManager) {
        const teamRes = await attendanceApi.getAll({ period: selectedPeriod })
        setTeamAttendances(teamRes || [])
      }
    } catch (err) {
      console.error('Error fetching timesheet data:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchTimesheetData()
  }, [selectedPeriod])

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

  const periodDisplay = useMemo(() => {
    const [y, m] = selectedPeriod.split('-')
    return `Tháng ${m}/${y}`
  }, [selectedPeriod])

  // Lọc nhật ký cá nhân
  const filteredPersonalRecords = useMemo(() => {
    return attendanceHistory.filter(att => {
      if (statusFilter === 'ALL') return true
      if (statusFilter === 'LATE') return (att.late_minutes || 0) > 0
      if (statusFilter === 'EARLY') return (att.early_minutes || 0) > 0
      if (statusFilter === 'OVERTIME') return (att.overtime_hours || 0) > 0
      if (statusFilter === 'NORMAL') return (!att.late_minutes || att.late_minutes === 0) && (!att.early_minutes || att.early_minutes === 0)
      return true
    })
  }, [attendanceHistory, statusFilter])

  // Lọc bảng công chi nhánh
  const filteredTeamRecords = useMemo(() => {
    return teamAttendances.filter(att => {
      const matchName = !searchEmployee || (att.employee_name && att.employee_name.toLowerCase().includes(searchEmployee.toLowerCase()))
      if (!matchName) return false
      if (statusFilter === 'ALL') return true
      if (statusFilter === 'LATE') return (att.late_minutes || 0) > 0
      if (statusFilter === 'EARLY') return (att.early_minutes || 0) > 0
      if (statusFilter === 'OVERTIME') return (att.overtime_hours || 0) > 0
      return true
    })
  }, [teamAttendances, searchEmployee, statusFilter])

  // Tính toán vạch đo SVG Vòng tròn ngày công
  const actualDays = summaryData?.working_days?.actual_days || 0
  const standardDays = summaryData?.working_days?.standard_days || 26
  const totalHours = summaryData?.working_days?.total_hours || 0

  const radius = 38
  const circumference = 2 * Math.PI * radius
  const daysRatio = Math.min(1, actualDays / standardDays)
  const strokeDashoffset = circumference - daysRatio * circumference

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
      att.late_minutes && att.late_minutes > 0 ? 'Đi muộn' : att.early_minutes && att.early_minutes > 0 ? 'Về sớm' : 'Đúng giờ',
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
    <div className="timesheet-page-wrapper">
      {/* 1. Header Bar: Tiêu đề trang & Bộ điều khiển kỳ công */}
      <div className="timesheet-header-bar">
        <div className="timesheet-title-section">
          <div className="timesheet-icon-badge">{Icons.clock}</div>
          <div className="timesheet-title-text">
            <h1>Bảng Công</h1>
            <p>Bảng tổng hợp ngày công, thời gian làm việc & dữ liệu chấm công chi tiết TechZone</p>
          </div>
        </div>

        <div className="timesheet-controls-section">
          <div className="period-picker-group">
            <button className="period-arrow-btn" onClick={handlePrevMonth} title="Tháng trước">‹</button>
            <input
              type="month"
              className="period-input-field"
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              title="Chọn tháng"
            />
            <button className="period-arrow-btn" onClick={handleNextMonth} title="Tháng sau">›</button>
          </div>

          <button className="btn btn-secondary timesheet-export-btn" onClick={handleExportCSV}>
            {Icons.download} Xuất báo cáo
          </button>
        </div>
      </div>

      {/* 2. DASHBOARD 8 THẺ CHỈ SỐ THEO CHUẨN NGHIỆP VỤ chucnang1.jpg (GIAO DIỆN WEB HIỆN ĐẠI LOGIC) */}
      <div className="timesheet-metrics-grid">
        {/* Card 1: Ngày công */}
        <div className="timesheet-metric-card">
          <div className="metric-header-pill">Ngày công</div>
          <div className="metric-gauge-wrapper">
            <svg className="metric-gauge-svg" viewBox="0 0 90 90">
              <circle className="metric-gauge-track" cx="45" cy="45" r={radius} />
              {actualDays > 0 && (
                <circle
                  className="metric-gauge-fill"
                  cx="45"
                  cy="45"
                  r={radius}
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                />
              )}
            </svg>
            <div className="metric-gauge-dot" />
            <div className="metric-gauge-center">
              <span className="metric-gauge-val">{actualDays} công</span>
            </div>
          </div>
          <div className="metric-footer-stats">
            <div className="footer-stat-box left">
              <span className="footer-stat-label">Công tháng</span>
              <span className="footer-stat-value">{standardDays} công</span>
            </div>
            <div className="footer-stat-box right">
              <span className="footer-stat-label">Số giờ</span>
              <span className="footer-stat-value">{totalHours} giờ</span>
            </div>
          </div>
        </div>

        {/* Card 2: Quỹ phép */}
        <div className="timesheet-metric-card">
          <div className="metric-header-pill">Quỹ phép</div>
          <div className="metric-gauge-wrapper">
            <svg className="metric-gauge-svg" viewBox="0 0 90 90">
              <circle className="metric-gauge-track" cx="45" cy="45" r={radius} />
            </svg>
            <div className="metric-gauge-dot" />
            <div className="metric-gauge-center">
              <span className="metric-gauge-val">{remainingLeave} ngày</span>
            </div>
          </div>
          <div className="metric-footer-stats">
            <div className="footer-stat-box left">
              <span className="footer-stat-label">Phép năm</span>
              <span className="footer-stat-value">{annualLeave} ngày</span>
            </div>
            <div className="footer-stat-box right">
              <span className="footer-stat-label">Nghỉ thực tế</span>
              <span className="footer-stat-value">{usedLeave} ngày</span>
            </div>
          </div>
        </div>

        {/* Card 3: Đi muộn */}
        <div className="timesheet-metric-card">
          <div className="metric-header-pill">Đi muộn</div>
          <div className="metric-dual-columns">
            <div className="dual-column-box">
              <span className="dual-column-label">Số lần</span>
              <div className="dual-icon-cal">
                <div className="dual-icon-cal-top" />
                <div className="dual-icon-cal-mid">
                  <div className="dual-icon-cal-grid" />
                </div>
              </div>
              <span className="dual-column-value">{lateCount} lần</span>
            </div>

            <div className="dual-column-box">
              <span className="dual-column-label">Số phút</span>
              <div className="dual-icon-clock">
                <div className="dual-clock-dial">
                  <div className="dual-clock-hand-v" />
                  <div className="dual-clock-hand-h" />
                </div>
              </div>
              <span className="dual-column-value">{lateMinutes} phút</span>
            </div>
          </div>
          <div className="metric-footer-stats">
            <div className="footer-stat-box left">
              <span className="footer-stat-label">Quy chế trễ</span>
              <span className="footer-stat-value">&gt; 15 phút phạt</span>
            </div>
            <div className="footer-stat-box right">
              <span className="footer-stat-label">Tình trạng</span>
              <span className={`footer-stat-value ${lateCount > 0 ? 'status-danger' : 'status-success'}`}>
                {lateCount > 0 ? 'Có vi phạm' : 'Tốt'}
              </span>
            </div>
          </div>
        </div>

        {/* Card 4: Về sớm */}
        <div className="timesheet-metric-card">
          <div className="metric-header-pill">Về sớm</div>
          <div className="metric-dual-columns">
            <div className="dual-column-box">
              <span className="dual-column-label">Số lần</span>
              <div className="dual-icon-cal">
                <div className="dual-icon-cal-top" />
                <div className="dual-icon-cal-mid">
                  <div className="dual-icon-cal-grid" />
                </div>
              </div>
              <span className="dual-column-value">{earlyCount} lần</span>
            </div>

            <div className="dual-column-box">
              <span className="dual-column-label">Số phút</span>
              <div className="dual-icon-clock">
                <div className="dual-clock-dial">
                  <div className="dual-clock-hand-v" />
                  <div className="dual-clock-hand-h" />
                </div>
              </div>
              <span className="dual-column-value">{earlyMinutes} phút</span>
            </div>
          </div>
          <div className="metric-footer-stats">
            <div className="footer-stat-box left">
              <span className="footer-stat-label">Giờ tan ca</span>
              <span className="footer-stat-value">Theo phân ca</span>
            </div>
            <div className="footer-stat-box right">
              <span className="footer-stat-label">Tình trạng</span>
              <span className={`footer-stat-value ${earlyCount > 0 ? 'status-warning' : 'status-success'}`}>
                {earlyCount > 0 ? 'Có về sớm' : 'Đúng giờ'}
              </span>
            </div>
          </div>
        </div>

        {/* Card 5: Làm thêm */}
        <div className="timesheet-metric-card">
          <div className="metric-header-pill">Làm thêm</div>
          <div className="metric-hero-display">
            <span className="metric-hero-number">{extraHours}</span>
            <span className="metric-hero-unit">giờ</span>
          </div>
          <div className="metric-footer-stats">
            <div className="footer-stat-box left">
              <span className="footer-stat-label">Loại làm thêm</span>
              <span className="footer-stat-value">Ngoài ca chuẩn</span>
            </div>
            <div className="footer-stat-box right">
              <span className="footer-stat-label">Phê duyệt</span>
              <span className="footer-stat-value">Cửa hàng trưởng</span>
            </div>
          </div>
        </div>

        {/* Card 6: Công tác */}
        <div className="timesheet-metric-card">
          <div className="metric-header-pill">Công tác</div>
          <div className="metric-hero-display">
            <span className="metric-hero-number">{businessTripDays}</span>
            <span className="metric-hero-unit">ngày</span>
          </div>
          <div className="metric-footer-stats">
            <div className="footer-stat-box left">
              <span className="footer-stat-label">Chế độ</span>
              <span className="footer-stat-value">Hưởng 100% lương</span>
            </div>
            <div className="footer-stat-box right">
              <span className="footer-stat-label">Phụ cấp</span>
              <span className="footer-stat-value">Theo chuyến</span>
            </div>
          </div>
        </div>

        {/* Card 7: Tăng ca */}
        <div className="timesheet-metric-card">
          <div className="metric-header-pill">Tăng ca</div>
          <div className="metric-dual-columns">
            <div className="dual-column-box">
              <span className="dual-column-label">Số công</span>
              <div className="dual-icon-cal">
                <div className="dual-icon-cal-top" />
                <div className="dual-icon-cal-mid">
                  <div className="dual-icon-cal-grid" />
                </div>
              </div>
              <span className="dual-column-value">{otShifts} công</span>
            </div>

            <div className="dual-column-box">
              <span className="dual-column-label">Số giờ</span>
              <div className="dual-icon-clock">
                <div className="dual-clock-dial">
                  <div className="dual-clock-hand-v" />
                  <div className="dual-clock-hand-h" />
                </div>
              </div>
              <span className="dual-column-value">{otHours} giờ</span>
            </div>
          </div>
          <div className="metric-footer-stats">
            <div className="footer-stat-box left">
              <span className="footer-stat-label">Hệ số lương OT</span>
              <span className="footer-stat-value">1.5x đơn giá</span>
            </div>
            <div className="footer-stat-box right">
              <span className="footer-stat-label">Ghi nhận</span>
              <span className="footer-stat-value">Vào bảng lương</span>
            </div>
          </div>
        </div>

        {/* Card 8: Quỹ nghỉ bù */}
        <div className="timesheet-metric-card">
          <div className="metric-header-pill">Quỹ nghỉ bù</div>
          <div className="metric-gauge-wrapper">
            <svg className="metric-gauge-svg" viewBox="0 0 90 90">
              <circle className="metric-gauge-track" cx="45" cy="45" r={radius} />
            </svg>
            <div className="metric-gauge-dot" />
            <div className="metric-gauge-center">
              <span className="metric-gauge-val">{compensatoryDays} ngày</span>
            </div>
          </div>
          <div className="compensatory-row">
            <span>Tổng số ngày nghỉ bù khả dụng</span>
            <span>{compensatoryDays} ngày</span>
          </div>
        </div>
      </div>

      {/* 3. TABS CHỌN CHẾ ĐỘ XEM: Cá nhân vs Chi nhánh */}
      <div className="timesheet-tab-nav">
        <button
          className={`timesheet-tab-item ${activeTab === 'my_timesheet' ? 'active' : ''}`}
          onClick={() => setActiveTab('my_timesheet')}
        >
          <span>{Icons.calendar}</span>
          <span>Bảng công cá nhân ({attendanceHistory.length} ca trong {periodDisplay})</span>
        </button>

        {isManager && (
          <button
            className={`timesheet-tab-item ${activeTab === 'team_timesheet' ? 'active' : ''}`}
            onClick={() => setActiveTab('team_timesheet')}
          >
            <span>{Icons.users}</span>
            <span>Quản lý bảng công toàn chi nhánh ({teamAttendances.length} bản ghi)</span>
          </button>
        )}
      </div>

      {/* 4. BẢNG DỮ LIỆU NHẬT KÝ CHI TIẾT */}
      <div className="timesheet-table-card">
        {/* Thanh công cụ lọc */}
        <div className="timesheet-filter-toolbar">
          <div className="filter-left-group">
            <span className="filter-label-text">Lọc trạng thái:</span>
            <select
              className="form-input timesheet-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">Tất cả ca làm việc</option>
              <option value="NORMAL">Đúng giờ</option>
              <option value="LATE">Có đi muộn</option>
              <option value="EARLY">Có về sớm</option>
              <option value="OVERTIME">Có tăng ca (OT)</option>
            </select>

            {activeTab === 'team_timesheet' && (
              <input
                type="text"
                className="form-input timesheet-employee-search"
                placeholder="Tìm theo tên nhân sự..."
                value={searchEmployee}
                onChange={(e) => setSearchEmployee(e.target.value)}
              />
            )}
          </div>

          <div className="filter-right-actions">
            <span className="timesheet-result-count">
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
              {(activeTab === 'my_timesheet' ? filteredPersonalRecords : filteredTeamRecords).map((att) => {
                const isLate = (att.late_minutes || 0) > 0
                const isEarly = (att.early_minutes || 0) > 0
                const isOT = (att.overtime_hours || 0) > 0

                return (
                  <tr key={att.attendance_id}>
                    {activeTab === 'team_timesheet' && (
                      <td>
                        <span className="table-employee-name">
                          {att.employee_name || `Mã #${att.employee_id}`}
                        </span>
                      </td>
                    )}
                    <td>
                      <span className="table-cell-mono table-cell-emphasis">
                        {formatDate(att.work_date)}
                      </span>
                    </td>
                    <td>
                      <span className="table-shift-name">{att.shift_name || 'Ca chuẩn (8h)'}</span>
                    </td>
                    <td>
                      <span className={`table-cell-mono table-cell-emphasis ${isLate ? 'text-red' : ''}`}>
                        {att.check_in_time ? formatTime(att.check_in_time) : '--:--'}
                      </span>
                    </td>
                    <td>
                      <span className={`table-cell-mono table-cell-emphasis ${isEarly ? 'text-amber' : ''}`}>
                        {att.check_out_time ? formatTime(att.check_out_time) : '--:--'}
                      </span>
                    </td>
                    <td>
                      {isLate ? (
                        <span className="badge-state late">{att.late_minutes} phút</span>
                      ) : (
                        <span className="zero-value zero-value-success">0p</span>
                      )}
                    </td>
                    <td>
                      {isEarly ? (
                        <span className="badge-state early">{att.early_minutes} phút</span>
                      ) : (
                        <span className="zero-value">0p</span>
                      )}
                    </td>
                    <td>
                      <span className="table-cell-mono table-cell-strong">
                        {att.actual_work_hours || 0}h
                      </span>
                    </td>
                    <td>
                      {isOT ? (
                        <span className="badge-state overtime">+{att.overtime_hours}h</span>
                      ) : (
                        <span className="empty-value">--</span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`badge-state ${
                          isLate ? 'late' : isEarly ? 'early' : isOT ? 'overtime' : 'normal'
                        }`}
                      >
                        {isLate ? 'Đi muộn' : isEarly ? 'Về sớm' : isOT ? 'Tăng ca' : 'Đúng giờ'}
                      </span>
                    </td>
                    <td className="table-notes-cell">
                      {att.notes || '--'}
                    </td>
                  </tr>
                )
              })}

              {(activeTab === 'my_timesheet' ? filteredPersonalRecords : filteredTeamRecords).length === 0 && (
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
          </table>
        </div>
      </div>
    </div>
  )
}

export default AttendancePage
