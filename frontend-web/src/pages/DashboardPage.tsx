import { useState, useEffect, useMemo } from 'react'
import { Icons } from '../components/common/Icons'
import { StatCard } from '../components/common/StatCard'
import { EmptyState } from '../components/common/EmptyState'
import { formatCurrency, formatDate, formatTime, getInitials } from '../utils/formatters'
import type { Attendance, LeaveBalance, Payroll, LeaveRequest, Employee } from '../types'

export interface AttendanceHeroProps {
  attendance: Attendance | null
  todayAttendance: Attendance | null
  onCheckIn: () => void
  onCheckOut: () => void
  isLoading: boolean
}

export function AttendanceHero({
  todayAttendance,
  onCheckIn,
  onCheckOut,
  isLoading,
}: AttendanceHeroProps) {
  const status = todayAttendance?.check_in_time
    ? todayAttendance.check_out_time
      ? { text: 'Đã hoàn thành', class: 'checked-out' }
      : { text: 'Đang làm việc', class: 'checked-in' }
    : { text: 'Chưa check-in', class: 'not-checked' }

  return (
    <div className="attendance-hero">
      <div className="attendance-hero-header">
        <span className="attendance-hero-title">Hôm nay - {formatDate(new Date().toISOString())}</span>
        <span className={`attendance-status-badge ${status.class}`}>{status.text}</span>
      </div>

      <div className="attendance-times">
        <div className="attendance-time-item">
          <div className="attendance-time-label">Check-in</div>
          <div className={`attendance-time-value ${todayAttendance?.late_minutes && todayAttendance.late_minutes > 0 ? 'late' : ''}`}>
            {todayAttendance?.check_in_time ? formatTime(todayAttendance.check_in_time) : '--:--'}
          </div>
          <div className="attendance-time-sublabel">
            {todayAttendance?.late_minutes && todayAttendance.late_minutes > 0
              ? `Trễ ${todayAttendance.late_minutes} phút`
              : todayAttendance?.check_in_time ? 'Đúng giờ' : 'Chưa check-in'}
          </div>
        </div>
        <div className="attendance-time-item">
          <div className="attendance-time-label">Check-out</div>
          <div className="attendance-time-value">
            {todayAttendance?.check_out_time ? formatTime(todayAttendance.check_out_time) : '--:--'}
          </div>
          <div className="attendance-time-sublabel">
            {todayAttendance?.check_out_time ? 'Đã ra về' : 'Chưa check-out'}
          </div>
        </div>
        <div className="attendance-time-item">
          <div className="attendance-time-label">Ca làm việc</div>
          <div className="attendance-time-value" style={{ fontSize: '18px' }}>
            {todayAttendance?.shift_name || 'Chưa phân ca'}
          </div>
          <div className="attendance-time-sublabel">
            {todayAttendance?.actual_work_hours
              ? `${todayAttendance.actual_work_hours}h làm việc`
              : todayAttendance?.shift_id ? '8 tiếng' : 'Chưa có lịch'}
          </div>
        </div>
      </div>

      <div className="attendance-action">
        <button
          className="check-btn check-in"
          onClick={onCheckIn}
          disabled={!!todayAttendance?.check_in_time || isLoading}
        >
          {Icons.zap}
          Check-in
        </button>
        <button
          className="check-btn check-out"
          onClick={onCheckOut}
          disabled={!todayAttendance?.check_in_time || !!todayAttendance?.check_out_time || isLoading}
        >
          {Icons.logOut}
          Check-out
        </button>
      </div>
    </div>
  )
}

export function LeaveBalanceCard({ balance, isLoading }: { balance: LeaveBalance | null; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="card">
        <div className="card-header"><h3 className="card-title">Số ngày nghỉ phép</h3></div>
        <div className="card-body">
          <div style={{ textAlign: 'center', padding: '20px' }}>Đang tải...</div>
        </div>
      </div>
    )
  }

  const annualRemaining = balance?.annual_leave_remaining ?? 12
  const annualTotal = balance?.annual_leave_total ?? 12
  const sickUsed = balance?.sick_leave_used ?? 0
  const sickTotal = 5

  return (
    <div className="card">
      <div className="card-header">
        <h3 className="card-title">Số ngày nghỉ phép</h3>
      </div>
      <div className="card-body">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span className="text-sm text-slate-600">Phép năm</span>
              <span className="text-sm font-medium">
                {annualRemaining} / {annualTotal} ngày
              </span>
            </div>
            <div className="progress">
              <div className="progress-bar green" style={{ width: `${(annualRemaining / annualTotal) * 100}%` }} />
            </div>
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span className="text-sm text-slate-600">Ốm đau</span>
              <span className="text-sm font-medium">
                {sickTotal - sickUsed} / {sickTotal} ngày
              </span>
            </div>
            <div className="progress">
              <div className="progress-bar amber" style={{ width: `${((sickTotal - sickUsed) / sickTotal) * 100}%` }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function PayslipSummaryCard({ payroll, isLoading }: { payroll: Payroll | null; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="card">
        <div className="card-header"><h3 className="card-title">Phiếu lương</h3></div>
        <div className="card-body">
          <div style={{ textAlign: 'center', padding: '20px' }}>Đang tải...</div>
        </div>
      </div>
    )
  }

  if (!payroll) {
    return (
      <div className="card">
        <div className="card-header"><h3 className="card-title">Phiếu lương</h3></div>
        <EmptyState icon={Icons.fileText} title="Chưa có phiếu lương" description="Phiếu lương sẽ được hiển thị sau kỳ chốt lương." />
      </div>
    )
  }

  return (
    <div className="card">
      <div className="card-header">
        <h3 className="card-title">Phiếu lương {payroll.salary_period}</h3>
      </div>
      <div className="card-body">
        <div className="grid-two-col">
          <div>
            <div className="text-sm text-slate-500" style={{ marginBottom: '4px' }}>Lương gross</div>
            <div className="mono font-semibold text-lg text-green">{formatCurrency(payroll.gross_income)}</div>
          </div>
          <div>
            <div className="text-sm text-slate-500" style={{ marginBottom: '4px' }}>Lương net</div>
            <div className="mono font-semibold text-lg text-blue">{formatCurrency(payroll.net_salary)}</div>
          </div>
          <div>
            <div className="text-sm text-slate-500" style={{ marginBottom: '4px' }}>Khấu trừ</div>
            <div className="mono font-semibold text-lg text-red">-{formatCurrency(payroll.total_deduction)}</div>
          </div>
          <div>
            <div className="text-sm text-slate-500" style={{ marginBottom: '4px' }}>Ngày công</div>
            <div className="mono font-semibold text-lg">{payroll.actual_working_days} / {payroll.standard_working_days} ngày</div>
          </div>
        </div>
      </div>
      <div className="card-footer" style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-secondary btn-sm">{Icons.fileText} Chi tiết</button>
      </div>
    </div>
  )
}

export interface DashboardPageProps {
  user: any
  onCheckIn: () => void
  onCheckOut: () => void
  attendanceLoading: boolean
}

export function DashboardPage({
  user,
  onCheckIn,
  onCheckOut,
  attendanceLoading,
}: DashboardPageProps) {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [attendancesToday, setAttendancesToday] = useState<Attendance[]>([])
  const [recentAttendance, setRecentAttendance] = useState<Attendance[]>([])
  const [leaveBalance, setLeaveBalance] = useState<LeaveBalance | null>(null)
  const [recentPayroll, setRecentPayroll] = useState<Payroll | null>(null)
  const [payrolls, setPayrolls] = useState<Payroll[]>([])
  const [leaves, setLeaves] = useState<LeaveRequest[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true)
      try {
        const { attendanceApi, leaveApi, payrollApi, employeeApi } = await import('../services/api')

        const now = new Date()
        const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
        const todayStr = now.toISOString().split('T')[0]

        const [
          empList,
          todayAttList,
          myAttHistory,
          balance,
          allPayrollsList,
          allLeavesList,
        ] = await Promise.all([
          employeeApi.getAll().catch(() => []),
          attendanceApi.getAll({ work_date: todayStr }).catch(() => []),
          user?.employee_id ? attendanceApi.getMyHistory(currentPeriod).catch(() => []) : Promise.resolve([]),
          leaveApi.getMyBalance().catch(() => null),
          payrollApi.getAll({ period: currentPeriod }).catch(() => []),
          leaveApi.getAll().catch(() => []),
        ])

        setEmployees(empList || [])
        setAttendancesToday(todayAttList || [])
        setRecentAttendance((myAttHistory || []).slice(0, 5))
        setLeaveBalance(balance)
        setPayrolls(allPayrollsList || [])
        setLeaves(allLeavesList || [])

        const userPayroll = (allPayrollsList || []).find(p => p.employee_id === user?.employee_id) || (allPayrollsList || [])[0] || null
        setRecentPayroll(userPayroll)
      } catch (err) {
        console.error('Error fetching dashboard data:', err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [user?.employee_id])

  const todayAttendance = recentAttendance.find(a => a.work_date === new Date().toISOString().split('T')[0])
  const activeEmployees = employees.filter(e => e.employment_status === 'ACTIVE')
  const onLeaveEmployees = employees.filter(e => e.employment_status === 'ON_LEAVE')
  const resignedEmployees = employees.filter(e => e.employment_status === 'RESIGNED')
  const pendingLeaves = leaves.filter(l => l.status === 'PENDING')
  const totalPayrollGross = payrolls.reduce((sum, p) => sum + (Number(p.gross_income) || Number(p.net_salary) || 0), 0)

  const deptDistribution = useMemo(() => {
    const map: Record<string, { count: number; payroll: number }> = {}
    employees.forEach(emp => {
      const dept = emp.department_name || emp.store_name || 'Khối Vận Hành'
      if (!map[dept]) map[dept] = { count: 0, payroll: 0 }
      map[dept].count += 1
      const p = payrolls.find(item => item.employee_id === emp.employee_id)
      if (p) map[dept].payroll += Number(p.gross_income) || 0
    })
    return Object.entries(map)
  }, [employees, payrolls])

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Tổng quan Vận hành</h1>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => alert('Đang lọc toàn bộ hệ thống TechZone')}>
            {Icons.filter} Bộ lọc
          </button>
          <button className="btn btn-primary btn-sm" onClick={onCheckIn}>
            {Icons.plus} Điểm danh nhanh
          </button>
        </div>
      </div>

      <div className="stat-grid-4">
        <StatCard
          label="Tổng nhân sự"
          value={employees.length}
        />
        <StatCard
          label="Chấm công hôm nay"
          value={attendancesToday.length > 0 ? `${attendancesToday.length} / ${employees.length}` : `${activeEmployees.length} nhân sự`}
        />
        <StatCard
          label="Quỹ lương tháng này"
          value={formatCurrency(totalPayrollGross)}
        />
        <StatCard
          label="Nghỉ phép & Vắng mặt"
          value={onLeaveEmployees.length + pendingLeaves.length}
        />
      </div>

      <div className="dashboard-grid">
        <div className="dashboard-main">
          <AttendanceHero
            attendance={null}
            todayAttendance={todayAttendance || null}
            onCheckIn={onCheckIn}
            onCheckOut={onCheckOut}
            isLoading={attendanceLoading}
          />

          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="card-title">Điểm danh &amp; Ca làm việc hôm nay</h3>
              <span className={`badge-status ${attendancesToday.length > 0 ? 'running' : 'paused'}`}>
                {attendancesToday.length > 0 ? `${attendancesToday.length} đã điểm danh` : 'Chưa có bản ghi hôm nay'}
              </span>
            </div>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>NHÂN VIÊN</th>
                    <th>VỊ TRÍ</th>
                    <th>TRẠNG THÁI</th>
                    <th>GIỜ VÀO</th>
                    <th>GIỜ RA</th>
                    <th>SỐ GIỜ LÀM</th>
                  </tr>
                </thead>
                <tbody>
                  {attendancesToday.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: '36px 16px', textAlign: 'center' }}>
                        <EmptyState
                          icon={Icons.clock}
                          title="Chưa có dữ liệu chấm công hôm nay"
                          description="Hệ thống chưa ghi nhận lượt check-in nào trong ngày hôm nay. Bấm 'Điểm danh nhanh' để bắt đầu ca làm việc."
                        />
                      </td>
                    </tr>
                  ) : (
                    attendancesToday.map((att) => {
                      const emp = employees.find(e => e.employee_id === att.employee_id)
                      const empName = att.employee_name || emp?.full_name || 'Nhân viên'
                      const isLate = att.late_minutes && att.late_minutes > 0
                      return (
                        <tr key={att.attendance_id}>
                          <td>
                            <div className="table-user-cell">
                              <div className="table-user-avatar">{getInitials(empName)}</div>
                              <div className="table-user-details">
                                <span className="table-user-name">{empName}</span>
                                <span className="table-user-sub">{emp?.store_name || emp?.department_name || 'TechZone'}</span>
                              </div>
                            </div>
                          </td>
                          <td><span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{emp?.position_name || att.shift_name || 'Nhân viên'}</span></td>
                          <td>
                            <span className={`badge-status ${isLate ? 'paused' : 'running'}`}>
                              {isLate ? `Đi muộn ${att.late_minutes}p` : 'Đang làm việc'}
                            </span>
                          </td>
                          <td><span className="table-cell-mono">{att.check_in_time ? formatTime(att.check_in_time) : '--:--'}</span></td>
                          <td><span className="table-cell-mono">{att.check_out_time ? formatTime(att.check_out_time) : '--:--'}</span></td>
                          <td><span className="table-cell-mono">{att.actual_work_hours ? `${att.actual_work_hours}h` : '--'}</span></td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div className="table-pagination">
              <span>Hiển thị {attendancesToday.length} trên {employees.length} nhân sự</span>
            </div>
          </div>
        </div>

        <div className="dashboard-sidebar">
          <LeaveBalanceCard balance={leaveBalance} isLoading={isLoading} />
          <PayslipSummaryCard payroll={recentPayroll} isLoading={isLoading} />
        </div>
      </div>

      <div className="grid-two-col" style={{ marginTop: '20px' }}>
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 className="card-title">Phân bổ chi phí &amp; Quỹ lương</h3>
            <span className="badge-status running">Dữ liệu thực tế</span>
          </div>
          <div className="card-body">
            <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '14px' }}>
              Dữ liệu đối soát tự động từ lương cơ bản, giờ công và phụ cấp theo phòng ban trong cơ sở dữ liệu.
            </p>
            {deptDistribution.map(([deptName, info]: [string, { count: number; payroll: number }]) => (
              <div key={deptName} className="breakdown-item">
                <div className="breakdown-left">
                  <span className="breakdown-name">{deptName}</span>
                  <span className="breakdown-desc">{info.count} nhân sự trong hệ thống</span>
                </div>
                <span className="breakdown-val">{formatCurrency(info.payroll)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Tình trạng nhân sự hệ thống</h3>
          </div>
          <div className="card-body">
            <div className="efficiency-row">
              <div className="efficiency-header">
                <span className="efficiency-label">Đang làm việc (ACTIVE)</span>
                <span className="efficiency-val">{activeEmployees.length} nhân sự ({employees.length ? Math.round((activeEmployees.length / employees.length) * 100) : 0}%)</span>
              </div>
              <div className="efficiency-bar">
                <div className="efficiency-bar-fill" style={{ width: `${employees.length ? (activeEmployees.length / employees.length) * 100 : 0}%`, background: 'var(--color-emerald-500)' }}></div>
              </div>
            </div>
            <div className="efficiency-row">
              <div className="efficiency-header">
                <span className="efficiency-label">Đang nghỉ phép (ON_LEAVE)</span>
                <span className="efficiency-val">{onLeaveEmployees.length} nhân sự ({employees.length ? Math.round((onLeaveEmployees.length / employees.length) * 100) : 0}%)</span>
              </div>
              <div className="efficiency-bar">
                <div className="efficiency-bar-fill" style={{ width: `${employees.length ? (onLeaveEmployees.length / employees.length) * 100 : 0}%`, background: 'var(--color-amber-500)' }}></div>
              </div>
            </div>
            <div className="efficiency-row">
              <div className="efficiency-header">
                <span className="efficiency-label">Đã thôi việc (RESIGNED)</span>
                <span className="efficiency-val">{resignedEmployees.length} nhân sự ({employees.length ? Math.round((resignedEmployees.length / employees.length) * 100) : 0}%)</span>
              </div>
              <div className="efficiency-bar">
                <div className="efficiency-bar-fill" style={{ width: `${employees.length ? (resignedEmployees.length / employees.length) * 100 : 0}%`, background: 'var(--color-rose-500)' }}></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
