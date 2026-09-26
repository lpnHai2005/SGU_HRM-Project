import { useState, useEffect, useCallback, useMemo } from 'react'
import { Icons } from '../components/common/Icons'
import { StatCard } from '../components/common/StatCard'
import { EmptyState } from '../components/common/EmptyState'
import { LEAVE_STATUS_LABELS } from '../constants/navigation'
import { formatDate } from '../utils/formatters'
import type { LeaveRequest, LeaveBalance, LeaveType, LeaveRequestCreate } from '../types'
import { leaveApi } from '../services/api'

export interface LeaveRequestsPageProps {
  user: any
}

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case 'HR_APPROVED':
      return 'active' // green
    case 'STORE_APPROVED':
      return 'badge-blue'
    case 'PENDING':
      return 'pending' // amber
    case 'REJECTED':
      return 'rejected' // red
    case 'CANCELLED':
      return 'badge-gray'
    default:
      return 'pending'
  }
}

function getStatusDisplayLabel(status: string, req?: LeaveRequest | null): string {
  const isChtReq = req?.is_store_manager_request || req?.position_name === 'Cửa hàng trưởng' || (req && !req.store_id)
  switch (status) {
    case 'PENDING':
      return isChtReq ? 'Chờ HR duyệt' : 'Chờ CHT duyệt'
    case 'STORE_APPROVED':
      return 'Chờ HR duyệt'
    case 'HR_APPROVED':
      return 'Đã duyệt'
    case 'REJECTED':
      return req?.hr_approved_at ? 'Đã hủy duyệt' : 'Đã từ chối'
    case 'CANCELLED':
      return 'Đã hủy'
    default:
      return LEAVE_STATUS_LABELS[status] || status
  }
}

export function LeaveRequestsPage({ user }: LeaveRequestsPageProps) {
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([])
  const [leaveBalance, setLeaveBalance] = useState<LeaveBalance | null>(null)
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([])
  const [leaveStats, setLeaveStats] = useState<any>(null)
  const [calendarLeaves, setCalendarLeaves] = useState<LeaveRequest[]>([])
  
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'calendar'>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('all')
  const [calendarMonth, setCalendarMonth] = useState<string>(new Date().toISOString().slice(0, 7))
  const [isLoading, setIsLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [openMenuId, setOpenMenuId] = useState<number | null>(null)

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [detailModalRequest, setDetailModalRequest] = useState<LeaveRequest | null>(null)
  const [storeApproveModalRequest, setStoreApproveModalRequest] = useState<LeaveRequest | null>(null)
  const [hrApproveModalRequest, setHrApproveModalRequest] = useState<LeaveRequest | null>(null)
  const [rejectModalRequest, setRejectModalRequest] = useState<LeaveRequest | null>(null)

  // Form states
  const [newRequest, setNewRequest] = useState<LeaveRequestCreate>({
    leave_type_id: 1,
    start_date: new Date().toISOString().slice(0, 10),
    end_date: new Date().toISOString().slice(0, 10),
    total_days: 1.0,
    reason: '',
    attachment_url: '',
  })
  const [storeManagerNote, setStoreManagerNote] = useState('Cửa hàng trưởng đã kiểm tra ca kíp và duyệt sơ bộ.')
  const [rejectionReason, setRejectionReason] = useState('')

  // Roles determination
  const userRoles = useMemo(() => user?.roles || [], [user])
  const isAdmin = userRoles.includes('ADMIN')
  const isHrManager = userRoles.includes('HR_MANAGER')
  const isStoreManager = userRoles.includes('STORE_MANAGER')

  // Leave balances and limits
  const annualTotal = leaveBalance?.annual_leave_total ?? 12
  const annualRemaining = leaveBalance?.annual_leave_remaining ?? 12
  const annualUsed = leaveBalance?.annual_leave_used ?? 0
  const pendingCount = leaveStats?.pending_store_approval ?? leaveRequests.filter(r => r.status === 'PENDING').length

  const selectedTypeInfo = useMemo(() => {
    return leaveTypes.find(t => t.leave_type_id === newRequest.leave_type_id)
  }, [leaveTypes, newRequest.leave_type_id])

  const maxAllowedDays = useMemo(() => {
    if (!selectedTypeInfo) return 180
    if (selectedTypeInfo.type_code === 'PHEP_NAM') {
      return annualRemaining
    }
    if (selectedTypeInfo.max_days_allowed && selectedTypeInfo.max_days_allowed > 0) {
      return Number(selectedTypeInfo.max_days_allowed)
    }
    return 180
  }, [selectedTypeInfo, annualRemaining])

  // Auto calculate total days when dates change in create modal
  const handleStartDateChange = (val: string) => {
    setNewRequest(prev => {
      let days = prev.total_days
      if (val && prev.end_date) {
        const d1 = new Date(val)
        const d2 = new Date(prev.end_date)
        if (d2 >= d1) {
          days = Math.max(1, Math.round((d2.getTime() - d1.getTime()) / (1000 * 3600 * 24)) + 1)
        }
      }
      return { ...prev, start_date: val, total_days: days }
    })
  }

  const handleEndDateChange = (val: string) => {
    setNewRequest(prev => {
      let days = prev.total_days
      if (prev.start_date && val) {
        const d1 = new Date(prev.start_date)
        const d2 = new Date(val)
        if (d2 >= d1) {
          days = Math.max(1, Math.round((d2.getTime() - d1.getTime()) / (1000 * 3600 * 24)) + 1)
        }
      }
      return { ...prev, end_date: val, total_days: days }
    })
  }

  // Fetch all leave data
  const fetchLeaveData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [requests, balance, types, stats] = await Promise.all([
        leaveApi.getAll(),
        leaveApi.getMyBalance(),
        leaveApi.getTypes(),
        leaveApi.getStats().catch(() => null),
      ])
      setLeaveRequests(requests || [])
      setLeaveBalance(balance)
      setLeaveTypes(types || [])
      setLeaveStats(stats)
      if (types && types.length > 0 && !newRequest.leave_type_id) {
        setNewRequest(prev => ({ ...prev, leave_type_id: types[0].leave_type_id }))
      }
    } catch (err) {
      console.error('Error fetching leave data:', err)
    } finally {
      setIsLoading(false)
    }
  }, [newRequest.leave_type_id])

  // Fetch calendar leaves when calendar tab is active or month changes
  const fetchCalendarData = useCallback(async (month: string) => {
    try {
      const data = await leaveApi.getCalendar({ month })
      setCalendarLeaves(data || [])
    } catch (err) {
      console.error('Error fetching calendar leaves:', err)
      setCalendarLeaves([])
    }
  }, [])

  useEffect(() => {
    fetchLeaveData()
  }, [fetchLeaveData])

  useEffect(() => {
    const handleClickOutside = () => setOpenMenuId(null)
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  useEffect(() => {
    if (activeTab === 'calendar') {
      fetchCalendarData(calendarMonth)
    }
  }, [activeTab, calendarMonth, fetchCalendarData])

  const handlePrevMonth = () => {
    const [y, m] = calendarMonth.split('-').map(Number)
    const prevDate = new Date(y, m - 2, 1)
    const newY = prevDate.getFullYear()
    const newM = String(prevDate.getMonth() + 1).padStart(2, '0')
    setCalendarMonth(`${newY}-${newM}`)
  }

  const handleNextMonth = () => {
    const [y, m] = calendarMonth.split('-').map(Number)
    const nextDate = new Date(y, m, 1)
    const newY = nextDate.getFullYear()
    const newM = String(nextDate.getMonth() + 1).padStart(2, '0')
    setCalendarMonth(`${newY}-${newM}`)
  }

  const handleCurrentMonth = () => {
    setCalendarMonth(new Date().toISOString().slice(0, 7))
  }

  const calendarDaysMatrix = useMemo(() => {
    const [yearStr, monthStr] = calendarMonth.split('-')
    const year = parseInt(yearStr, 10) || new Date().getFullYear()
    const month = parseInt(monthStr, 10) || (new Date().getMonth() + 1)
    
    // First day of month (0 = Sun, 1 = Mon, ..., 6 = Sat)
    // Convert to Monday = 0, ..., Sunday = 6
    const firstDay = new Date(year, month - 1, 1).getDay()
    const startingBlankDays = (firstDay + 6) % 7
    
    // Total days in current month
    const totalDaysInMonth = new Date(year, month, 0).getDate()
    
    // Total days in previous month
    const prevMonthDays = new Date(year, month - 1, 0).getDate()

    const days: Array<{
      dateStr: string
      dayNumber: number
      isCurrentMonth: boolean
      isToday: boolean
      leaves: LeaveRequest[]
    }> = []

    const todayStr = new Date().toISOString().slice(0, 10)

    // Pad previous month days
    for (let i = startingBlankDays - 1; i >= 0; i--) {
      const d = prevMonthDays - i
      const prevMonth = month === 1 ? 12 : month - 1
      const prevYear = month === 1 ? year - 1 : year
      const dateStr = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      days.push({
        dateStr,
        dayNumber: d,
        isCurrentMonth: false,
        isToday: dateStr === todayStr,
        leaves: calendarLeaves.filter(l => l.start_date <= dateStr && l.end_date >= dateStr),
      })
    }

    // Current month days
    for (let d = 1; d <= totalDaysInMonth; d++) {
      const dateStr = `${yearStr}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      days.push({
        dateStr,
        dayNumber: d,
        isCurrentMonth: true,
        isToday: dateStr === todayStr,
        leaves: calendarLeaves.filter(l => l.start_date <= dateStr && l.end_date >= dateStr),
      })
    }

    // Pad next month days to fill complete rows of 7
    const remainingDays = (7 - (days.length % 7)) % 7
    for (let d = 1; d <= remainingDays; d++) {
      const nextMonth = month === 12 ? 1 : month + 1
      const nextYear = month === 12 ? year + 1 : year
      const dateStr = `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      days.push({
        dateStr,
        dayNumber: d,
        isCurrentMonth: false,
        isToday: dateStr === todayStr,
        leaves: calendarLeaves.filter(l => l.start_date <= dateStr && l.end_date >= dateStr),
      })
    }

    return days
  }, [calendarMonth, calendarLeaves])

  // Filter requests
  const filteredRequests = useMemo(() => {
    return leaveRequests.filter(req => {
      // Tab filter
      if (activeTab === 'pending') {
        if (req.status !== 'PENDING' && req.status !== 'STORE_APPROVED') return false
      } else if (activeTab === 'approved') {
        if (req.status !== 'HR_APPROVED') return false
      } else if (activeTab === 'rejected') {
        if (req.status !== 'REJECTED') return false
      }

      // Leave type dropdown filter
      if (selectedTypeFilter !== 'all') {
        if (String(req.leave_type_id) !== selectedTypeFilter) return false
      }

      // Search term
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase()
        const empName = req.employee_name?.toLowerCase() || ''
        const empCode = req.employee_code?.toLowerCase() || ''
        const typeName = req.leave_type_name?.toLowerCase() || ''
        const reason = req.reason?.toLowerCase() || ''
        const store = req.store_name?.toLowerCase() || ''
        if (!empName.includes(term) && !empCode.includes(term) && !typeName.includes(term) && !reason.includes(term) && !store.includes(term)) {
          return false
        }
      }

      return true
    })
  }, [leaveRequests, activeTab, selectedTypeFilter, searchTerm])

  const showNotification = (type: 'success' | 'error', text: string) => {
    setFeedbackMessage({ type, text })
    setTimeout(() => {
      setFeedbackMessage(null)
    }, 5000)
  }

  // Action: Submit Leave Request
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newRequest.total_days <= 0) {
      showNotification('error', 'Số ngày xin nghỉ phải lớn hơn 0.')
      return
    }
    if (maxAllowedDays > 0 && newRequest.total_days > maxAllowedDays) {
      showNotification(
        'error',
        `Loại nghỉ '${selectedTypeInfo?.type_name || ''}' chỉ được nghỉ tối đa ${maxAllowedDays} ngày theo quy định. Bạn đang chọn ${newRequest.total_days} ngày!`
      )
      return
    }
    setActionLoading(true)
    try {
      const res = await leaveApi.create(newRequest)
      showNotification('success', res.message || 'Nộp đơn nghỉ phép thành công!')
      setIsCreateModalOpen(false)
      // Reset form
      setNewRequest({
        leave_type_id: leaveTypes[0]?.leave_type_id || 1,
        start_date: new Date().toISOString().slice(0, 10),
        end_date: new Date().toISOString().slice(0, 10),
        total_days: 1.0,
        reason: '',
        attachment_url: '',
      })
      await fetchLeaveData()
    } catch (err: any) {
      showNotification('error', err.response?.data?.detail || err.message || 'Lỗi khi nộp đơn nghỉ phép')
    } finally {
      setActionLoading(false)
    }
  }

  // Action: Store Manager Level 1 Approve
  const handleStoreApproveSubmit = async () => {
    if (!storeApproveModalRequest) return
    setActionLoading(true)
    try {
      const res = await leaveApi.approveStore(storeApproveModalRequest.request_id, {
        note: storeManagerNote,
      })
      showNotification('success', res.message || 'Duyệt thành công!')
      setStoreApproveModalRequest(null)
      await fetchLeaveData()
    } catch (err: any) {
      showNotification('error', err.response?.data?.detail || err.message || 'Lỗi duyệt đơn')
    } finally {
      setActionLoading(false)
    }
  }

  // Action: HR Manager Level 2 Approve
  const handleHrApproveSubmit = async () => {
    if (!hrApproveModalRequest) return
    setActionLoading(true)
    try {
      const res = await leaveApi.approveHr(hrApproveModalRequest.request_id)
      showNotification('success', res.message || 'Phê duyệt chính thức thành công!')
      setHrApproveModalRequest(null)
      await fetchLeaveData()
    } catch (err: any) {
      showNotification('error', err.response?.data?.detail || err.message || 'Lỗi duyệt đơn')
    } finally {
      setActionLoading(false)
    }
  }

  // Action: Reject Leave Request
  const handleRejectSubmit = async () => {
    if (!rejectModalRequest) return
    if (!rejectionReason.trim()) {
      showNotification('error', 'Vui lòng nhập lý do từ chối đơn!')
      return
    }
    setActionLoading(true)
    try {
      const res = await leaveApi.reject(rejectModalRequest.request_id, {
        rejection_reason: rejectionReason,
      })
      showNotification('success', res.message || 'Đã từ chối đơn nghỉ phép.')
      setRejectModalRequest(null)
      setRejectionReason('')
      await fetchLeaveData()
    } catch (err: any) {
      showNotification('error', err.response?.data?.detail || err.message || 'Lỗi khi từ chối đơn')
    } finally {
      setActionLoading(false)
    }
  }

  // Action: Cancel Leave Request
  const handleCancelRequest = async (requestId: number) => {
    if (!window.confirm('Bạn có chắc chắn muốn hủy đơn xin nghỉ phép này?')) return
    setActionLoading(true)
    try {
      const res = await leaveApi.cancel(requestId)
      showNotification('success', res.message || 'Đã hủy đơn thành công!')
      await fetchLeaveData()
    } catch (err: any) {
      showNotification('error', err.response?.data?.detail || err.message || 'Lỗi khi hủy đơn')
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div className="page-container">
      {/* Toast Notification */}
      {feedbackMessage && (
        <div
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: 9999,
            padding: '12px 20px',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            color: '#fff',
            backgroundColor: feedbackMessage.type === 'success' ? '#10b981' : '#ef4444',
            fontWeight: 500,
            animation: 'fadeIn 0.3s ease',
          }}
        >
          {feedbackMessage.type === 'success' ? Icons.checkCircle : Icons.alertCircle}
          <span>{feedbackMessage.text}</span>
        </div>
      )}

      {/* Page Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 className="page-title">Quản lý Nghỉ Phép</h1>
          <p style={{ color: 'var(--text-secondary, #6b7280)', fontSize: '0.9rem', marginTop: '4px' }}>
            Theo dõi và phê duyệt đơn xin nghỉ phép nhân sự TechZone
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={() => setIsCreateModalOpen(true)}>
            {Icons.plus}
            Tạo đơn nghỉ phép mới
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="stat-grid-4">
        <StatCard
          icon={Icons.calendar}
          iconColor="blue"
          label="Phép năm còn lại"
          value={`${annualRemaining} / ${annualTotal} ngày`}
        />
        <StatCard
          icon={Icons.shield}
          iconColor="green"
          label="Nghỉ ốm đau BHXH"
          value={`${leaveBalance?.sick_leave_used || 0} ngày`}
        />
        <StatCard
          icon={Icons.clock}
          iconColor="amber"
          label="Chờ CHT duyệt"
          value={`${pendingCount} đơn`}
        />
        <StatCard
          icon={Icons.checkCircle}
          iconColor="green"
          label="Phép năm đã duyệt"
          value={`${annualUsed} ngày`}
        />
      </div>

      {/* Main Content Card */}
      <div className="card">
        {/* Card Header & Tabs */}
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div className="tabs" style={{ marginBottom: 0, borderBottom: 'none', padding: 0 }}>
            <div
              className={`tab ${activeTab === 'all' ? 'active' : ''}`}
              onClick={() => setActiveTab('all')}
            >
              Tất cả đơn ({leaveRequests.length})
            </div>
            <div
              className={`tab ${activeTab === 'pending' ? 'active' : ''}`}
              onClick={() => setActiveTab('pending')}
            >
              Chờ duyệt ({leaveRequests.filter(r => r.status === 'PENDING' || r.status === 'STORE_APPROVED').length})
            </div>
            <div
              className={`tab ${activeTab === 'approved' ? 'active' : ''}`}
              onClick={() => setActiveTab('approved')}
            >
              Đã duyệt ({leaveRequests.filter(r => r.status === 'HR_APPROVED').length})
            </div>
            <div
              className={`tab ${activeTab === 'rejected' ? 'active' : ''}`}
              onClick={() => setActiveTab('rejected')}
            >
              Từ chối ({leaveRequests.filter(r => r.status === 'REJECTED').length})
            </div>
            <div
              className={`tab ${activeTab === 'calendar' ? 'active' : ''}`}
              onClick={() => setActiveTab('calendar')}
            >
              Lịch nghỉ phép (Calendar)
            </div>
          </div>

          {activeTab !== 'calendar' && (
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="search-box" style={{ minWidth: '220px' }}>
                <span className="search-icon">{Icons.search}</span>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Tìm nhân viên, mã, lý do..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={{ height: '36px' }}
                />
              </div>

              <select
                className="form-select"
                value={selectedTypeFilter}
                onChange={(e) => setSelectedTypeFilter(e.target.value)}
                style={{ height: '36px', width: 'auto', minWidth: '150px' }}
              >
                <option value="all">Tất cả loại nghỉ</option>
                {leaveTypes.map((t) => (
                  <option key={t.leave_type_id} value={String(t.leave_type_id)}>
                    {t.type_name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Tab 1: List Table */}
        {activeTab !== 'calendar' ? (
          isLoading ? (
            <div className="card-body" style={{ textAlign: 'center', padding: '40px' }}>
              Đang tải danh sách đơn nghỉ phép...
            </div>
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>MÃ ĐƠN</th>
                    <th>NHÂN VIÊN</th>
                    <th>LOẠI NGHỈ</th>
                    <th>THỜI GIAN</th>
                    <th>SỐ NGÀY</th>
                    <th>LÝ DO</th>
                    <th>TRẠNG THÁI</th>
                    <th>CHT DUYỆT</th>
                    <th>HR DUYỆT</th>
                    <th style={{ width: '95px', textAlign: 'center' }}>THAO TÁC</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRequests.map((req) => {
                    const isOwner = req.employee_id === user?.employee_id
                    const isRejected = req.status === 'REJECTED'
                    const wasHrApprovedBeforeReject = isRejected && !!req.hr_approved_at
                    const isApplicantStoreManager = Boolean(req.is_store_manager_request || req.position_name === 'Cửa hàng trưởng')

                    // Cửa hàng trưởng không thể tự duyệt đơn của mình và không duyệt đơn của CHT khác
                    const canStoreApprove = (isStoreManager || isAdmin) && req.status === 'PENDING' && !isOwner && !isApplicantStoreManager
                    
                    // HR có thể duyệt thẳng (Cấp 2) kể cả trước khi Cửa hàng trưởng duyệt Cấp 1
                    const canHrApprove = (isHrManager || isAdmin) && (
                      req.status === 'STORE_APPROVED' || req.status === 'PENDING'
                    ) && (!isOwner || isAdmin)

                    const canRejectPending = (
                      (isStoreManager && !isApplicantStoreManager && !isOwner && req.status === 'PENDING') ||
                      ((isHrManager || isAdmin) && (req.status === 'PENDING' || req.status === 'STORE_APPROVED'))
                    )
                    const canRevokeHrApproved = (isHrManager || isAdmin) && req.status === 'HR_APPROVED'
                    const canCancel = isOwner && req.status === 'PENDING'
                    const hasAnyAction = Boolean(canStoreApprove || canHrApprove || canRejectPending || canRevokeHrApproved || canCancel)

                    // Kiểm tra bước CHT có áp dụng hay không
                    const isChtStepNotApplicable = isApplicantStoreManager ||
                      Boolean(req.hr_approved_at && !req.store_approved_at) ||
                      Boolean(isRejected && !req.store_approved_at && (req.rejected_by_role === 'Phòng Nhân sự' || req.rejected_by_role === 'Ban Giám đốc / Admin'))

                    return (
                      <tr key={req.request_id}>
                        <td>
                          <span className="table-cell-mono font-bold" style={{ cursor: 'pointer', color: 'var(--primary-color, #2563eb)' }} onClick={() => setDetailModalRequest(req)}>
                            #{req.request_id}
                          </span>
                        </td>
                        <td>
                          <div>
                            <div style={{ fontWeight: 600 }}>{req.employee_name || `Nhân viên #${req.employee_id}`}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)' }}>
                              {req.employee_code || ''} {req.store_name ? `• ${req.store_name}` : ''}
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="badge badge-blue">
                            {req.leave_type_name || 'N/A'}
                          </span>
                        </td>
                        <td>
                          <div className="table-cell-mono" style={{ fontSize: '0.85rem' }}>
                            {formatDate(req.start_date)} &rarr; {formatDate(req.end_date)}
                          </div>
                        </td>
                        <td>
                          <span style={{ fontWeight: 600 }}>{req.total_days} ngày</span>
                        </td>
                        <td style={{ maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={req.reason || ''}>
                          {req.reason || '-'}
                        </td>
                        <td>
                          <span
                            className={`status-pill ${getStatusBadgeClass(req.status)}`}
                            style={
                              isRejected
                                ? {
                                    backgroundColor: '#fef2f2',
                                    color: '#dc2626',
                                    borderColor: '#fca5a5',
                                    fontWeight: 700,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '5px',
                                    padding: '3px 8px',
                                  }
                                : undefined
                            }
                            title={getStatusDisplayLabel(req.status, req)}
                          >
                            {isRejected && <span style={{ color: '#dc2626', fontWeight: 900, fontSize: '0.85rem' }}>✕</span>}
                            {getStatusDisplayLabel(req.status, req)}
                          </span>
                        </td>
                        <td>
                          {/* Cột CHT Duyệt */}
                          {isChtStepNotApplicable ? (
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #9ca3af)' }}>Không áp dụng</span>
                          ) : isRejected && (req.rejected_by_role === 'Cửa hàng trưởng' || (!req.store_approved_at && req.rejected_by_name && !wasHrApprovedBeforeReject && req.rejected_by_role !== 'Phòng Nhân sự')) ? (
                            <div style={{ fontSize: '0.8rem', color: '#dc2626', fontWeight: 600 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontWeight: 900, color: '#dc2626' }}>✕</span>
                                <span>{req.rejected_by_name || 'Cửa hàng trưởng'}</span>
                              </div>
                              <div style={{ fontSize: '0.75rem', color: '#ef4444' }}>
                                CHT từ chối {req.rejected_at ? `(${formatDate(req.rejected_at)})` : ''}
                              </div>
                            </div>
                          ) : req.store_approved_at ? (
                            <div style={{ fontSize: '0.8rem', color: '#10b981' }}>
                              <div>{Icons.check} {req.store_manager_name || 'CHT'}</div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary, #6b7280)' }}>{formatDate(req.store_approved_at)}</div>
                            </div>
                          ) : isRejected ? (
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #9ca3af)' }}>Không áp dụng</span>
                          ) : (
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #9ca3af)' }}>Chưa duyệt</span>
                          )}
                        </td>
                        <td>
                          {/* Cột HR Duyệt */}
                          {wasHrApprovedBeforeReject ? (
                            <div style={{ fontSize: '0.8rem', color: '#dc2626', fontWeight: 600 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontWeight: 900, color: '#dc2626' }}>✕</span>
                                <span>{req.rejected_by_name || 'Phòng Nhân sự'}</span>
                              </div>
                              <div style={{ fontSize: '0.75rem', color: '#dc2626', fontWeight: 700 }}>
                                Đã hủy duyệt
                              </div>
                              {req.rejected_at && (
                                <div style={{ fontSize: '0.7rem', color: '#ef4444' }}>
                                  {formatDate(req.rejected_at)}
                                </div>
                              )}
                            </div>
                          ) : isRejected && (req.rejected_by_role === 'Phòng Nhân sự' || req.rejected_by_role === 'Ban Giám đốc / Admin' || req.store_approved_at || isApplicantStoreManager) ? (
                            <div style={{ fontSize: '0.8rem', color: '#dc2626', fontWeight: 600 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontWeight: 900, color: '#dc2626' }}>✕</span>
                                <span>{req.rejected_by_name || 'Phòng Nhân sự'}</span>
                              </div>
                              <div style={{ fontSize: '0.75rem', color: '#ef4444' }}>
                                HR từ chối {req.rejected_at ? `(${formatDate(req.rejected_at)})` : ''}
                              </div>
                            </div>
                          ) : isRejected ? (
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #9ca3af)' }}>Không áp dụng</span>
                          ) : req.hr_approved_at ? (
                            <div style={{ fontSize: '0.8rem', color: '#10b981' }}>
                              <div>{Icons.check} {req.hr_approver_name || 'HR Manager'}</div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary, #6b7280)' }}>{formatDate(req.hr_approved_at)}</div>
                            </div>
                          ) : req.status === 'STORE_APPROVED' || (req.status === 'PENDING' && isApplicantStoreManager) ? (
                            <span style={{ fontSize: '0.8rem', color: '#2563eb', fontWeight: 500 }}>Chờ HR duyệt</span>
                          ) : (
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #9ca3af)' }}>Chờ duyệt</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center', position: 'relative' }}>
                            {/* Nút 1: Xem chi tiết (Mắt) */}
                            <button
                              className="btn btn-secondary btn-sm btn-icon"
                              title="Xem chi tiết đơn"
                              onClick={() => setDetailModalRequest(req)}
                            >
                              {Icons.eye}
                            </button>

                            {/* Nút 2: Tùy chọn thao tác (Dấu 3 chấm) */}
                            <button
                              className="btn btn-secondary btn-sm btn-icon"
                              title={hasAnyAction ? "Tùy chọn thao tác" : "Không có thao tác khác"}
                              disabled={!hasAnyAction}
                              style={{
                                opacity: hasAnyAction ? 1 : 0.4,
                                cursor: hasAnyAction ? 'pointer' : 'not-allowed',
                              }}
                              onClick={(e) => {
                                if (!hasAnyAction) return
                                e.stopPropagation()
                                setOpenMenuId(openMenuId === req.request_id ? null : req.request_id)
                              }}
                            >
                              {Icons.moreVertical}
                            </button>

                            {/* Dropdown Menu thao tác */}
                            {openMenuId === req.request_id && hasAnyAction && (
                              <div
                                className="action-dropdown"
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                  position: 'absolute',
                                  top: '100%',
                                  right: 0,
                                  marginTop: '4px',
                                  zIndex: 80,
                                  minWidth: '195px',
                                }}
                              >
                                {canStoreApprove && (
                                  <button
                                    className="action-dropdown-item"
                                    onClick={() => {
                                      setOpenMenuId(null)
                                      setStoreApproveModalRequest(req)
                                    }}
                                  >
                                    <span className="action-icon icon-promote">{Icons.check}</span>
                                    <span>Duyệt cấp 1 (CHT)</span>
                                  </button>
                                )}

                                {canHrApprove && (
                                  <button
                                    className="action-dropdown-item"
                                    onClick={() => {
                                      setOpenMenuId(null)
                                      setHrApproveModalRequest(req)
                                    }}
                                  >
                                    <span className="action-icon icon-edit">{Icons.check}</span>
                                    <span>Duyệt cấp 2 (HR)</span>
                                  </button>
                                )}

                                {canRejectPending && (
                                  <button
                                    className="action-dropdown-item danger"
                                    onClick={() => {
                                      setOpenMenuId(null)
                                      setRejectModalRequest(req)
                                    }}
                                  >
                                    <span className="action-icon icon-danger">✕</span>
                                    <span>Từ chối đơn</span>
                                  </button>
                                )}

                                {canRevokeHrApproved && (
                                  <button
                                    className="action-dropdown-item danger"
                                    onClick={() => {
                                      setOpenMenuId(null)
                                      setRejectModalRequest(req)
                                    }}
                                  >
                                    <span className="action-icon icon-danger">✕</span>
                                    <span>Hủy duyệt & Từ chối</span>
                                  </button>
                                )}

                                {canCancel && (
                                  <button
                                    className="action-dropdown-item danger"
                                    onClick={() => {
                                      setOpenMenuId(null)
                                      handleCancelRequest(req.request_id)
                                    }}
                                  >
                                    <span className="action-icon icon-danger">✕</span>
                                    <span>Hủy đơn xin nghỉ</span>
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {filteredRequests.length === 0 && (
                    <tr>
                      <td colSpan={10}>
                        <EmptyState
                          icon={Icons.calendar}
                          title="Không tìm thấy đơn nghỉ phép nào"
                          description="Không có yêu cầu nghỉ phép nào phù hợp với bộ lọc tìm kiếm hiện tại."
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )
        ) : (
          /* Tab 2: Calendar View */
          <div className="card-body" style={{ padding: '24px' }}>
            {/* Top Navigation & Controls */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Lịch Nhân Sự Nghỉ Phép Tháng {calendarMonth}
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Theo dõi trực quan lịch vắng mặt theo ngày & chi tiết từng nhân sự đã được duyệt
                </p>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <div className="btn-group" style={{ display: 'flex', gap: '4px' }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    title="Tháng trước"
                    onClick={handlePrevMonth}
                    style={{ padding: '6px 10px' }}
                  >
                    {Icons.chevronLeft}
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    title="Trở về tháng hiện tại"
                    onClick={handleCurrentMonth}
                    style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 600 }}
                  >
                    Hôm nay
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    title="Tháng sau"
                    onClick={handleNextMonth}
                    style={{ padding: '6px 10px' }}
                  >
                    {Icons.chevronRight}
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    type="month"
                    className="form-input"
                    value={calendarMonth}
                    onChange={(e) => setCalendarMonth(e.target.value)}
                    style={{ width: 'auto', padding: '5px 10px', fontSize: '13px' }}
                  />
                </div>
              </div>
            </div>

            {/* Calendar Matrix (7-day grid) */}
            <div
              style={{
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
                backgroundColor: 'var(--surface-card)',
                marginBottom: '28px',
                boxShadow: 'var(--shadow-card)',
              }}
            >
              {/* Day of Week Headers */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                  borderBottom: '1px solid var(--border-default)',
                  backgroundColor: 'var(--surface-subtle)',
                }}
              >
                {['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ Nhật'].map((dayName, idx) => (
                  <div
                    key={dayName}
                    style={{
                      padding: '10px 8px',
                      textAlign: 'center',
                      fontSize: '12px',
                      fontWeight: 700,
                      color: idx >= 5 ? 'var(--text-muted)' : 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderRight: idx < 6 ? '1px solid var(--border-default)' : 'none',
                    }}
                  >
                    {dayName}
                  </div>
                ))}
              </div>

              {/* Day Cells Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                }}
              >
                {calendarDaysMatrix.map((cell, idx) => {
                  const isWeekend = (idx % 7) === 5 || (idx % 7) === 6
                  const hasLeaves = cell.leaves.length > 0

                  return (
                    <div
                      key={cell.dateStr + '-' + idx}
                      style={{
                        minHeight: '105px',
                        padding: '8px',
                        borderRight: (idx % 7) < 6 ? '1px solid var(--border-default)' : 'none',
                        borderBottom: idx < calendarDaysMatrix.length - 7 ? '1px solid var(--border-default)' : 'none',
                        backgroundColor: !cell.isCurrentMonth
                          ? 'var(--surface-subtle)'
                          : isWeekend
                          ? 'var(--surface-subtle)'
                          : 'var(--surface-card)',
                        opacity: cell.isCurrentMonth ? 1 : 0.45,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        position: 'relative',
                        transition: 'background-color 0.15s ease',
                      }}
                    >
                      {/* Day Header with Date Number */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '12px',
                            fontWeight: cell.isToday ? 800 : 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: cell.isToday ? '24px' : 'auto',
                            height: cell.isToday ? '24px' : 'auto',
                            borderRadius: cell.isToday ? '50%' : '0',
                            backgroundColor: cell.isToday ? 'var(--action-primary)' : 'transparent',
                            color: cell.isToday
                              ? 'var(--action-primary-text)'
                              : cell.isCurrentMonth
                              ? 'var(--text-primary)'
                              : 'var(--text-muted)',
                          }}
                        >
                          {cell.dayNumber}
                        </span>

                        {hasLeaves && cell.isCurrentMonth && (
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 700,
                              fontFamily: 'var(--font-mono)',
                              color: 'var(--status-info)',
                              padding: '1px 5px',
                              borderRadius: '4px',
                              backgroundColor: 'var(--status-info-bg)',
                            }}
                          >
                            {cell.leaves.length} nghỉ
                          </span>
                        )}
                      </div>

                      {/* Leaves Badges in Cell */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1, overflow: 'hidden' }}>
                        {cell.leaves.slice(0, 2).map((lv) => {
                          const isUnpaid = lv.leave_type_code === 'NGHI_KHONG_LUONG' || lv.leave_type_id === 2
                          const isPaid = lv.leave_type_code === 'PHEP_NAM' || lv.leave_type_id === 1

                          const badgeBg = isUnpaid
                            ? 'var(--status-error-bg)'
                            : isPaid
                            ? 'var(--status-success-bg)'
                            : 'var(--status-info-bg)'

                          const badgeBorder = isUnpaid
                            ? 'var(--status-error-border)'
                            : isPaid
                            ? 'var(--status-success-border)'
                            : 'var(--status-info-border)'

                          const badgeText = isUnpaid
                            ? 'var(--status-error)'
                            : isPaid
                            ? 'var(--status-success)'
                            : 'var(--status-info)'

                          return (
                            <div
                              key={lv.request_id}
                              title={`${lv.employee_name} (${lv.employee_code || ''}) - ${lv.leave_type_name}: ${formatDate(lv.start_date)} đến ${formatDate(lv.end_date)}`}
                              onClick={() => setDetailModalRequest(lv)}
                              style={{
                                padding: '3px 6px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                fontWeight: 500,
                                backgroundColor: badgeBg,
                                border: `1px solid ${badgeBorder}`,
                                color: badgeText,
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                transition: 'transform 0.1s ease',
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.02)')}
                              onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                            >
                              <span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {lv.employee_name?.split(' ').slice(-2).join(' ') || lv.employee_name}
                              </span>
                              <span style={{ opacity: 0.75, fontSize: '10px' }}>
                                • {lv.leave_type_name?.replace('Nghỉ ', '') || 'Phép'}
                              </span>
                            </div>
                          )
                        })}

                        {cell.leaves.length > 2 && (
                          <div
                            style={{
                              fontSize: '10.5px',
                              fontWeight: 600,
                              color: 'var(--text-secondary)',
                              padding: '2px 4px',
                              textAlign: 'center',
                              borderRadius: '4px',
                              backgroundColor: 'var(--surface-subtle)',
                              cursor: 'pointer',
                            }}
                            onClick={() => {
                              const firstLeave = cell.leaves[2]
                              if (firstLeave) setDetailModalRequest(firstLeave)
                            }}
                          >
                            +{cell.leaves.length - 2} nhân sự khác
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Detailed Cards List */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Danh Sách Đơn Nghỉ Phép Trong Tháng ({calendarLeaves.length})
                </h4>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Hiển thị tất cả nhân viên có lịch nghỉ trong tháng {calendarMonth}
                </span>
              </div>

              {calendarLeaves.length === 0 ? (
                <EmptyState
                  icon={Icons.calendar}
                  title={`Không có nhân sự nào nghỉ phép trong tháng ${calendarMonth}`}
                  description="Toàn bộ nhân viên tại chi nhánh đều đi làm đầy đủ trong tháng này."
                />
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '16px' }}>
                  {calendarLeaves.map((item) => (
                    <div
                      key={item.request_id}
                      style={{
                        border: '1px solid var(--border-default)',
                        borderRadius: 'var(--radius-md)',
                        padding: '16px',
                        backgroundColor: 'var(--surface-card)',
                        boxShadow: 'var(--shadow-card)',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: '12px',
                        transition: 'border-color 0.15s ease',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                          <span className="badge badge-blue">{item.leave_type_name}</span>
                          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--status-info)', fontFamily: 'var(--font-mono)' }}>
                            {item.total_days} ngày
                          </span>
                        </div>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)', marginBottom: '2px' }}>
                          {item.employee_name} <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>({item.employee_code})</span>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                          {item.store_name || item.department_name || 'TechZone'}
                        </div>
                        <div style={{ fontSize: '0.8rem', backgroundColor: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', padding: '8px 10px', borderRadius: 'var(--radius-sm)', marginBottom: '8px', color: 'var(--text-primary)' }}>
                          <strong style={{ color: 'var(--text-secondary)' }}>Thời gian:</strong> <span style={{ fontFamily: 'var(--font-mono)' }}>{formatDate(item.start_date)} &rarr; {formatDate(item.end_date)}</span>
                        </div>
                        {item.reason && (
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                            &ldquo;{item.reason}&rdquo;
                          </div>
                        )}
                      </div>

                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ width: '100%', justifyContent: 'center', gap: '6px' }}
                        onClick={() => setDetailModalRequest(item)}
                      >
                        {Icons.eye} Xem chi tiết đơn
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL 1: TẠO ĐƠN NGHỈ PHÉP MỚI */}
      {/* ========================================================================= */}
      {isCreateModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
          onClick={() => !actionLoading && setIsCreateModalOpen(false)}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '560px',
              maxHeight: '90vh',
              overflowY: 'auto',
              margin: 0,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600 }}>Tạo Đơn Xin Nghỉ Phép Mới</h3>
              <button
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: '#9ca3af' }}
                onClick={() => setIsCreateModalOpen(false)}
              >
                {Icons.x}
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} style={{ padding: '20px' }}>
              {/* Loại đơn nghỉ phép */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '6px' }}>
                  Loại đơn nghỉ phép <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <select
                  className="form-select"
                  value={newRequest.leave_type_id}
                  onChange={(e) => {
                    const newTypeId = Number(e.target.value)
                    const targetType = leaveTypes.find(t => t.leave_type_id === newTypeId)
                    let limit = 180
                    if (targetType?.type_code === 'PHEP_NAM') limit = annualRemaining
                    else if (targetType?.max_days_allowed && targetType.max_days_allowed > 0) limit = Number(targetType.max_days_allowed)
                    setNewRequest(prev => ({
                      ...prev,
                      leave_type_id: newTypeId,
                      total_days: prev.total_days > limit ? limit : prev.total_days,
                    }))
                  }}
                  required
                >
                  {leaveTypes.map((t) => (
                    <option key={t.leave_type_id} value={t.leave_type_id}>
                      {t.type_name} ({t.is_paid ? 'Có lương' : 'Không lương'}) - Tối đa: {t.max_days_allowed > 0 ? `${t.max_days_allowed} ngày` : 'Theo đơn'}
                    </option>
                  ))}
                </select>
                {selectedTypeInfo && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #6b7280)', marginTop: '4px' }}>
                    {selectedTypeInfo.type_code === 'PHEP_NAM' && (
                      <span style={{ color: '#2563eb' }}>
                        Số dư phép năm hiện tại: <strong>{annualRemaining} ngày</strong> (Tổng hạn mức: {annualTotal} ngày)
                      </span>
                    )}
                    {selectedTypeInfo.type_code !== 'PHEP_NAM' && selectedTypeInfo.max_days_allowed > 0 && (
                      <span style={{ color: '#4b5563', fontWeight: 500 }}>
                        Quy định: Tối đa <strong>{selectedTypeInfo.max_days_allowed} ngày</strong> cho mỗi đợt nghỉ.
                      </span>
                    )}
                    {selectedTypeInfo.type_code === 'THOI_VIEC' && (
                      <span style={{ color: '#dc2626', fontWeight: 500, display: 'block', marginTop: '2px' }}>
                        Lưu ý: Sau khi HR duyệt đơn thôi việc, tài khoản của bạn sẽ tự động chấm dứt hợp đồng.
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Ngày bắt đầu & Ngày kết thúc */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '6px' }}>
                    Từ ngày <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="date"
                    className="form-input"
                    value={newRequest.start_date}
                    onChange={(e) => handleStartDateChange(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '6px' }}>
                    Đến ngày <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="date"
                    className="form-input"
                    value={newRequest.end_date}
                    onChange={(e) => handleEndDateChange(e.target.value)}
                    required
                  />
                </div>
              </div>

              {/* Số ngày nghỉ */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{ fontWeight: 600, fontSize: '0.9rem', margin: 0 }}>
                    Tổng số ngày nghỉ <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  {maxAllowedDays > 0 && maxAllowedDays < 180 && (
                    <span style={{
                      fontSize: '0.75rem',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      backgroundColor: newRequest.total_days > maxAllowedDays ? '#fee2e2' : '#eff6ff',
                      color: newRequest.total_days > maxAllowedDays ? '#dc2626' : '#2563eb',
                      fontWeight: 600,
                    }}>
                      Tối đa: {maxAllowedDays} ngày {selectedTypeInfo?.type_code === 'PHEP_NAM' ? '(theo phép còn lại)' : `(${selectedTypeInfo?.type_name})`}
                    </span>
                  )}
                </div>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  max={maxAllowedDays}
                  className="form-input"
                  style={newRequest.total_days > maxAllowedDays ? { borderColor: '#ef4444', backgroundColor: '#fff5f5' } : {}}
                  value={newRequest.total_days}
                  onChange={(e) => setNewRequest({ ...newRequest, total_days: parseFloat(e.target.value) || 0.5 })}
                  required
                />
                {newRequest.total_days > maxAllowedDays ? (
                  <div style={{ color: '#dc2626', fontSize: '0.8rem', marginTop: '4px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span>⚠️</span> Vượt quá giới hạn cho phép! {selectedTypeInfo?.type_name} chỉ được tối đa {maxAllowedDays} ngày.
                  </div>
                ) : (
                  <small style={{ color: 'var(--text-secondary, #6b7280)' }}>Hỗ trợ nghỉ nửa ngày (0.5 ngày) hoặc cả ngày (1, 2, 3... ngày).</small>
                )}
              </div>

              {/* Lý do nghỉ */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '6px' }}>
                  Lý do xin nghỉ <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <textarea
                  className="form-input"
                  rows={3}
                  placeholder="Ghi rõ lý do xin nghỉ để Cửa hàng trưởng và HR thuận tiện xem xét duyệt..."
                  value={newRequest.reason}
                  onChange={(e) => setNewRequest({ ...newRequest, reason: e.target.value })}
                  required
                />
              </div>

              {/* Đính kèm tài liệu */}
              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '6px' }}>
                  Link đính kèm tài liệu / Giấy khám bệnh (nếu có)
                </label>
                <input
                  type="url"
                  className="form-input"
                  placeholder="https://drive.google.com/... hoặc link ảnh chứng từ y tế"
                  value={newRequest.attachment_url || ''}
                  onChange={(e) => setNewRequest({ ...newRequest, attachment_url: e.target.value })}
                />
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={actionLoading}
                  onClick={() => setIsCreateModalOpen(false)}
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Đang gửi...' : 'Gửi đơn phê duyệt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: DUYỆT CẤP 1 (CỬA HÀNG TRƯỞNG) */}
      {/* ========================================================================= */}
      {storeApproveModalRequest && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
          onClick={() => !actionLoading && setStoreApproveModalRequest(null)}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '500px',
              margin: 0,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-header">
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600 }}>Phê Duyệt Đơn Nghỉ Phép</h3>
            </div>
            <div style={{ padding: '20px' }}>
              <div style={{ backgroundColor: 'var(--surface-subtle)', border: '1px solid var(--border-default)', padding: '14px', borderRadius: 'var(--radius-sm)', marginBottom: '16px', color: 'var(--text-primary)' }}>
                <p style={{ margin: '0 0 6px 0' }}><strong>Nhân viên:</strong> {storeApproveModalRequest.employee_name}</p>
                <p style={{ margin: '0 0 6px 0' }}><strong>Loại nghỉ:</strong> {storeApproveModalRequest.leave_type_name}</p>
                <p style={{ margin: '0 0 6px 0' }}><strong>Thời gian:</strong> {formatDate(storeApproveModalRequest.start_date)} &rarr; {formatDate(storeApproveModalRequest.end_date)} ({storeApproveModalRequest.total_days} ngày)</p>
                <p style={{ margin: 0 }}><strong>Lý do:</strong> {storeApproveModalRequest.reason}</p>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '6px' }}>
                  Ghi chú của Cửa hàng trưởng (sắp xếp nhân sự trực thay)
                </label>
                <textarea
                  className="form-input"
                  rows={2}
                  value={storeManagerNote}
                  onChange={(e) => setStoreManagerNote(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={actionLoading}
                  onClick={() => setStoreApproveModalRequest(null)}
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  className="btn btn-success"
                  disabled={actionLoading}
                  onClick={handleStoreApproveSubmit}
                >
                  {actionLoading ? 'Đang duyệt...' : 'Xác nhận duyệt'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: DUYỆT CẤP 2 (PHÒNG NHÂN SỰ) */}
      {/* ========================================================================= */}
      {hrApproveModalRequest && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
          onClick={() => !actionLoading && setHrApproveModalRequest(null)}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '520px',
              margin: 0,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-header">
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600 }}>Phê Duyệt Đơn Nghỉ Phép (HR)</h3>
            </div>
            <div style={{ padding: '20px' }}>
              <div style={{ backgroundColor: 'var(--surface-subtle)', border: '1px solid var(--border-default)', padding: '14px', borderRadius: 'var(--radius-sm)', marginBottom: '16px', color: 'var(--text-primary)' }}>
                <p style={{ margin: '0 0 6px 0' }}><strong>Nhân viên:</strong> {hrApproveModalRequest.employee_name} ({hrApproveModalRequest.employee_code})</p>
                <p style={{ margin: '0 0 6px 0' }}><strong>Chi nhánh:</strong> {hrApproveModalRequest.store_name || 'Trụ sở chính'}</p>
                <p style={{ margin: '0 0 6px 0' }}><strong>Loại nghỉ:</strong> {hrApproveModalRequest.leave_type_name}</p>
                <p style={{ margin: '0 0 6px 0' }}><strong>Thời gian:</strong> {formatDate(hrApproveModalRequest.start_date)} &rarr; {formatDate(hrApproveModalRequest.end_date)} ({hrApproveModalRequest.total_days} ngày)</p>
                {hrApproveModalRequest.store_manager_note ? (
                  <p style={{ margin: '0 0 6px 0', color: '#059669' }}>
                    <strong>Ý kiến CHT:</strong> {hrApproveModalRequest.store_manager_note}
                  </p>
                ) : hrApproveModalRequest.status === 'PENDING' ? (
                  <p style={{ margin: '0 0 6px 0', color: '#2563eb', fontSize: '0.85rem' }}>
                    ℹ️ <strong>Duyệt thẳng Cấp 2:</strong> Đơn đang ở trạng thái Chờ duyệt. Phòng Nhân sự có thẩm quyền phê duyệt chính thức trực tiếp mà không cần chờ Cửa hàng trưởng duyệt Cấp 1.
                  </p>
                ) : null}
                <p style={{ margin: 0 }}><strong>Lý do nghỉ:</strong> {hrApproveModalRequest.reason}</p>
              </div>

              {hrApproveModalRequest.leave_type_id === 6 && (
                <div style={{ backgroundColor: '#fef2f2', border: '1px solid #f87171', padding: '10px 14px', borderRadius: '6px', marginBottom: '16px', color: '#b91c1c', fontSize: '0.85rem' }}>
                  <strong>Cảnh báo nghiệp vụ:</strong> Đây là Đơn xin thôi việc. Khi bấm &ldquo;Phê duyệt chính thức&rdquo;, hệ thống sẽ tự động cập nhật trạng thái nhân sự thành <strong>RESIGNED</strong> và vô hiệu hóa tài khoản đăng nhập để bảo mật.
                </div>
              )}

              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary, #4b5563)', marginBottom: '20px' }}>
                Sau khi phê duyệt, số ngày phép của nhân viên sẽ tự động được khấu trừ trong số dư phép năm 2026.
              </p>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={actionLoading}
                  onClick={() => setHrApproveModalRequest(null)}
                >
                  Đóng
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={actionLoading}
                  onClick={handleHrApproveSubmit}
                >
                  {actionLoading ? 'Đang duyệt...' : 'Xác nhận duyệt'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: TỪ CHỐI ĐƠN NGHỈ PHÉP */}
      {/* ========================================================================= */}
      {rejectModalRequest && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
          onClick={() => !actionLoading && setRejectModalRequest(null)}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '480px',
              margin: 0,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-header">
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: '#dc2626', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontWeight: 900 }}>✕</span>
                {rejectModalRequest.status === 'HR_APPROVED'
                  ? 'Thu Hồi Phê Duyệt & Từ Chối Đơn Nghỉ Phép'
                  : 'Từ Chối Đơn Nghỉ Phép'}
              </h3>
            </div>
            <div style={{ padding: '20px' }}>
              {rejectModalRequest.status === 'HR_APPROVED' && (
                <div style={{
                  backgroundColor: '#fef2f2',
                  border: '1px solid #f87171',
                  borderRadius: '6px',
                  padding: '12px',
                  marginBottom: '16px',
                  fontSize: '0.85rem',
                  color: '#991b1b',
                }}>
                  <div style={{ fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>⚠️</span> CẢNH BÁO: ĐƠN ĐÃ ĐƯỢC DUYỆT CHÍNH THỨC
                  </div>
                  <div style={{ lineHeight: 1.5 }}>
                    Khi xác nhận từ chối, hệ thống sẽ:
                    <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                      <li>Chuyển trạng thái đơn thành <strong>Đã từ chối</strong> (ghi nhận rõ người từ chối và lý do).</li>
                      <li>Tự động <strong>hoàn trả {rejectModalRequest.total_days} ngày</strong> vào số dư phép năm của nhân viên.</li>
                      {rejectModalRequest.leave_type_id === 6 && (
                        <li>Khôi phục hồ sơ nhân viên và tài khoản về trạng thái <strong>ACTIVE (Hoạt động)</strong>.</li>
                      )}
                      {rejectModalRequest.leave_type_id === 3 && (
                        <li>Khôi phục trạng thái nhân sự của nhân viên về <strong>ACTIVE</strong>.</li>
                      )}
                    </ul>
                  </div>
                </div>
              )}

              <div style={{ backgroundColor: 'var(--surface-subtle)', border: '1px solid var(--border-default)', padding: '14px', borderRadius: 'var(--radius-sm)', marginBottom: '16px', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                <p style={{ margin: '0 0 6px 0' }}><strong>Nhân viên:</strong> {rejectModalRequest.employee_name} ({rejectModalRequest.employee_code})</p>
                <p style={{ margin: '0 0 6px 0' }}><strong>Loại nghỉ:</strong> {rejectModalRequest.leave_type_name} ({rejectModalRequest.total_days} ngày)</p>
                <p style={{ margin: '0 0 6px 0' }}><strong>Thời gian:</strong> {formatDate(rejectModalRequest.start_date)} &rarr; {formatDate(rejectModalRequest.end_date)}</p>
                {rejectModalRequest.hr_approved_at && (
                  <p style={{ margin: 0, color: '#059669', fontSize: '0.8rem' }}>
                    Đã từng được duyệt chính thức bởi: {rejectModalRequest.hr_approver_name || 'Phòng Nhân sự'} ({formatDate(rejectModalRequest.hr_approved_at)})
                  </p>
                )}
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '6px' }}>
                  Lý do từ chối đơn <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <textarea
                  className="form-input"
                  rows={3}
                  placeholder={rejectModalRequest.status === 'HR_APPROVED'
                    ? "Ghi rõ lý do thu hồi phê duyệt (ví dụ: Nhân viên xin rút đơn, phát hiện sai lệch số ngày phép...)"
                    : "Ghi rõ lý do không thể duyệt (ví dụ: Thiếu nhân sự trực ca, thời gian trùng đợt cao điểm khuyến mãi...)"}
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={actionLoading}
                  onClick={() => setRejectModalRequest(null)}
                >
                  Đóng
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={actionLoading}
                  onClick={handleRejectSubmit}
                  style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                >
                  <span style={{ fontWeight: 900 }}>✕</span>
                  {actionLoading
                    ? 'Đang xử lý...'
                    : rejectModalRequest.status === 'HR_APPROVED'
                    ? 'Xác nhận Thu hồi & Từ chối'
                    : 'Xác nhận từ chối đơn'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 5: XEM CHI TIẾT ĐƠN NGHỈ PHÉP */}
      {/* ========================================================================= */}
      {detailModalRequest && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
          onClick={() => setDetailModalRequest(null)}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '600px',
              maxHeight: '90vh',
              overflowY: 'auto',
              margin: 0,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600 }}>Chi Tiết Đơn Nghỉ Phép #{detailModalRequest.request_id}</h3>
              <button
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: '#9ca3af' }}
                onClick={() => setDetailModalRequest(null)}
              >
                {Icons.x}
              </button>
            </div>
            <div style={{ padding: '20px' }}>
              {/* KHỐI CẢNH BÁO TỪ CHỐI RÕ RÀNG VỚI DẤU X VÀ CHỮ MÀU ĐỎ NỔI BẬT */}
              {detailModalRequest.status === 'REJECTED' && (
                <div style={{
                  backgroundColor: '#fef2f2',
                  border: '2px solid #f87171',
                  borderRadius: '8px',
                  padding: '16px',
                  marginBottom: '20px',
                  boxShadow: '0 2px 4px rgba(220, 38, 38, 0.08)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      backgroundColor: '#dc2626',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 900,
                      fontSize: '1.1rem',
                      flexShrink: 0
                    }}>
                      ✕
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: '#dc2626', fontWeight: 700, fontSize: '1rem', textTransform: 'uppercase', marginBottom: '4px' }}>
                        {detailModalRequest.hr_approved_at
                          ? 'Đơn đã bị Hủy phê duyệt & Từ chối'
                          : 'Đơn xin nghỉ phép đã bị Từ chối'}
                      </div>
                      <div style={{ fontSize: '0.85rem', color: '#991b1b', marginBottom: '8px' }}>
                        Người từ chối:{' '}
                        <strong style={{ color: '#7f1d1d' }}>{detailModalRequest.rejected_by_name || 'Người có thẩm quyền'}</strong>
                        {detailModalRequest.rejected_by_role && (
                          <span style={{ marginLeft: '4px', backgroundColor: '#fee2e2', padding: '1px 6px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>
                            {detailModalRequest.rejected_by_role}
                          </span>
                        )}
                        {detailModalRequest.rejected_at && (
                          <span style={{ marginLeft: '8px', color: '#b91c1c' }}>
                            • lúc {formatDate(detailModalRequest.rejected_at)}
                          </span>
                        )}
                      </div>

                      <div style={{
                        backgroundColor: '#fff',
                        padding: '10px 14px',
                        borderRadius: '6px',
                        border: '1px solid #fca5a5',
                        fontSize: '0.875rem',
                        color: '#7f1d1d',
                        lineHeight: 1.5
                      }}>
                        <strong>Lý do từ chối:</strong> {detailModalRequest.rejection_reason || 'Không có lý do giải trình'}
                      </div>

                      {detailModalRequest.hr_approved_at && (
                        <div style={{
                          fontSize: '0.8rem',
                          color: '#991b1b',
                          marginTop: '8px',
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '6px',
                          lineHeight: 1.4
                        }}>
                          <span>ℹ️</span>
                          <span>
                            <strong>Lịch sử:</strong> Đơn này đã từng được duyệt chính thức bởi <strong>{detailModalRequest.hr_approver_name || 'Phòng Nhân sự'}</strong> vào lúc {formatDate(detailModalRequest.hr_approved_at)}, nhưng sau đó đã bị thu hồi/từ chối. Hệ thống đã tự động hoàn trả ngày phép và khôi phục trạng thái nhân sự.
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Thông tin hồ sơ */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)', textTransform: 'uppercase', fontWeight: 600 }}>Nhân viên</label>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{detailModalRequest.employee_name}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #6b7280)' }}>Mã NV: {detailModalRequest.employee_code || `NV-${detailModalRequest.employee_id}`}</div>
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)', textTransform: 'uppercase', fontWeight: 600 }}>Chi nhánh / Phòng ban</label>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{detailModalRequest.store_name || detailModalRequest.department_name || 'TechZone'}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #6b7280)' }}>{detailModalRequest.position_name || 'Nhân viên'}</div>
                </div>
              </div>

              {/* Thông tin nghỉ phép */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)', textTransform: 'uppercase', fontWeight: 600 }}>Loại đơn</label>
                  <div><span className="badge badge-blue">{detailModalRequest.leave_type_name}</span></div>
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)', textTransform: 'uppercase', fontWeight: 600 }}>Trạng thái</label>
                  <div>
                    <span
                      className={`status-pill ${getStatusBadgeClass(detailModalRequest.status)}`}
                      style={detailModalRequest.status === 'REJECTED' ? {
                        backgroundColor: '#fef2f2',
                        color: '#dc2626',
                        borderColor: '#fca5a5',
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px'
                      } : undefined}
                    >
                      {detailModalRequest.status === 'REJECTED' && <span style={{ fontWeight: 900 }}>✕</span>}
                      {getStatusDisplayLabel(detailModalRequest.status, detailModalRequest)}
                    </span>
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)', textTransform: 'uppercase', fontWeight: 600 }}>Thời gian nghỉ</label>
                  <div className="table-cell-mono font-bold">{formatDate(detailModalRequest.start_date)} &rarr; {formatDate(detailModalRequest.end_date)}</div>
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)', textTransform: 'uppercase', fontWeight: 600 }}>Tổng số ngày</label>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--primary-color, #2563eb)' }}>{detailModalRequest.total_days} ngày</div>
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)', textTransform: 'uppercase', fontWeight: 600 }}>Lý do xin nghỉ</label>
                <div style={{ backgroundColor: 'var(--surface-subtle)', border: '1px solid var(--border-default)', padding: '10px 12px', borderRadius: 'var(--radius-sm)', marginTop: '4px', color: 'var(--text-primary)' }}>
                  {detailModalRequest.reason || 'Không có ghi chú'}
                </div>
              </div>

              {detailModalRequest.attachment_url && (
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)', textTransform: 'uppercase', fontWeight: 600 }}>Tài liệu minh chứng</label>
                  <div>
                    <a href={detailModalRequest.attachment_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary-color, #2563eb)', textDecoration: 'underline', fontSize: '0.85rem' }}>
                      Xem tài liệu đính kèm &rarr;
                    </a>
                  </div>
                </div>
              )}

              {/* Approval Timeline */}
              <div style={{ borderTop: '1px solid var(--border-color, #e5e7eb)', paddingTop: '16px', marginTop: '16px' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #6b7280)', textTransform: 'uppercase', fontWeight: 700, display: 'block', marginBottom: '12px' }}>
                  Dòng thời gian phê duyệt & Lịch sử xử lý
                </label>

                {/* Bước 1: Gửi đơn */}
                <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                  <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: '#10b981', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700 }}>
                    1
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Nhân viên gửi đơn</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)' }}>{formatDate(detailModalRequest.created_at)}</div>
                  </div>
                </div>

                {/* Bước 2: Cửa hàng trưởng duyệt */}
                {(() => {
                  const isDetailApplicantCht = Boolean(
                    detailModalRequest.is_store_manager_request ||
                    detailModalRequest.position_name === 'Cửa hàng trưởng' ||
                    !detailModalRequest.store_id
                  )
                  // Bước 2 không áp dụng khi:
                  // 1. Nhân viên nộp là CHT hoặc Khối Trụ sở văn phòng
                  // 2. HR đã duyệt thẳng Cấp 2 khi CHT chưa duyệt
                  // 3. HR / Admin đã trực tiếp từ chối đơn khi CHT chưa xử lý
                  const isStoreStepNotApplicable = Boolean(
                    isDetailApplicantCht ||
                    (detailModalRequest.hr_approved_at && !detailModalRequest.store_approved_at) ||
                    (detailModalRequest.status === 'REJECTED' && !detailModalRequest.store_approved_at && (detailModalRequest.rejected_by_role === 'Phòng Nhân sự' || detailModalRequest.rejected_by_role === 'Ban Giám đốc / Admin'))
                  )

                  const isStoreRejected = Boolean(
                    !isStoreStepNotApplicable &&
                    detailModalRequest.status === 'REJECTED' &&
                    (detailModalRequest.rejected_by_role === 'Cửa hàng trưởng' ||
                      (!detailModalRequest.store_approved_at && !detailModalRequest.hr_approved_at && detailModalRequest.rejected_by_role !== 'Phòng Nhân sự'))
                  )

                  return (
                    <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                      <div style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        backgroundColor: isStoreStepNotApplicable
                          ? '#e5e7eb'
                          : isStoreRejected
                          ? '#dc2626'
                          : detailModalRequest.store_approved_at
                          ? '#10b981'
                          : '#f59e0b',
                        color: isStoreStepNotApplicable ? '#6b7280' : '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.75rem',
                        fontWeight: 700
                      }}>
                        {isStoreStepNotApplicable ? '—' : isStoreRejected ? '✕' : detailModalRequest.store_approved_at ? '✓' : '2'}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: isStoreStepNotApplicable ? '#6b7280' : undefined }}>
                          {isStoreRejected ? (
                            <span style={{ color: '#dc2626' }}>Cửa hàng trưởng: Đã từ chối (Cấp 1)</span>
                          ) : (
                            'Cửa hàng trưởng duyệt sơ bộ (Cấp 1)'
                          )}
                        </div>
                        {isStoreStepNotApplicable ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                            <span style={{
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              backgroundColor: '#f3f4f6',
                              color: '#6b7280',
                              padding: '1px 8px',
                              borderRadius: '4px',
                              border: '1px solid #d1d5db'
                            }}>
                              Không áp dụng
                            </span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)' }}>
                              {isDetailApplicantCht
                                ? '(Đơn CHT / Khối văn phòng, chuyển thẳng HR duyệt)'
                                : detailModalRequest.hr_approved_at
                                ? '(Phòng Nhân sự đã trực tiếp duyệt thẳng Cấp 2)'
                                : '(Phòng Nhân sự đã trực tiếp xử lý từ chối)'}
                            </span>
                          </div>
                        ) : isStoreRejected ? (
                          <div style={{ fontSize: '0.8rem', color: '#dc2626' }}>
                            Người từ chối: {detailModalRequest.rejected_by_name || 'Cửa hàng trưởng'} ({formatDate(detailModalRequest.rejected_at)})
                          </div>
                        ) : detailModalRequest.store_approved_at ? (
                          <>
                            <div style={{ fontSize: '0.8rem', color: '#059669' }}>
                              Người duyệt: {detailModalRequest.store_manager_name || 'Cửa hàng trưởng'} ({formatDate(detailModalRequest.store_approved_at)})
                            </div>
                            {detailModalRequest.store_manager_note && (
                              <div style={{ fontSize: '0.75rem', fontStyle: 'italic', color: '#4b5563' }}>&ldquo;{detailModalRequest.store_manager_note}&rdquo;</div>
                            )}
                          </>
                        ) : (
                          <div style={{ fontSize: '0.75rem', color: '#d97706' }}>
                            Đang chờ Cửa hàng trưởng xem xét duyệt (hoặc HR có thể duyệt thẳng)...
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })()}

                {/* Bước 3: HR duyệt */}
                {(() => {
                  const isStoreRejected = Boolean(
                    detailModalRequest.status === 'REJECTED' &&
                    (detailModalRequest.rejected_by_role === 'Cửa hàng trưởng' ||
                      (!detailModalRequest.store_approved_at && !detailModalRequest.hr_approved_at && detailModalRequest.rejected_by_role !== 'Phòng Nhân sự'))
                  )
                  // Bước HR duyệt Cấp 2 không áp dụng khi đơn đã bị CHT từ chối ngay tại Cấp 1
                  const isHrStepNotApplicable = isStoreRejected

                  const wasHrApprovedBeforeReject = detailModalRequest.status === 'REJECTED' && Boolean(detailModalRequest.hr_approved_at)
                  const isHrRejected = !isHrStepNotApplicable && detailModalRequest.status === 'REJECTED' && (detailModalRequest.rejected_by_role === 'Phòng Nhân sự' || detailModalRequest.rejected_by_role === 'Ban Giám đốc / Admin')

                  return (
                    <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                      <div style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        backgroundColor: isHrStepNotApplicable
                          ? '#e5e7eb'
                          : wasHrApprovedBeforeReject || isHrRejected
                          ? '#dc2626'
                          : detailModalRequest.hr_approved_at
                          ? '#10b981'
                          : '#3b82f6',
                        color: isHrStepNotApplicable ? '#6b7280' : '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.75rem',
                        fontWeight: 700
                      }}>
                        {isHrStepNotApplicable ? '—' : (wasHrApprovedBeforeReject || isHrRejected) ? '✕' : detailModalRequest.hr_approved_at ? '✓' : '3'}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: isHrStepNotApplicable ? '#6b7280' : undefined }}>
                          {wasHrApprovedBeforeReject ? (
                            <span style={{ color: '#dc2626' }}>Phòng Nhân sự: Đã Hủy Phê Duyệt & Từ Chối</span>
                          ) : isHrRejected ? (
                            <span style={{ color: '#dc2626' }}>Phòng Nhân sự: Đã từ chối (Cấp 2)</span>
                          ) : (
                            'Phòng Nhân sự phê duyệt chính thức (Cấp 2)'
                          )}
                        </div>
                        {isHrStepNotApplicable ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                            <span style={{
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              backgroundColor: '#f3f4f6',
                              color: '#6b7280',
                              padding: '1px 8px',
                              borderRadius: '4px',
                              border: '1px solid #d1d5db'
                            }}>
                              Không áp dụng
                            </span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)' }}>
                              (Đơn đã dừng do Cửa hàng trưởng từ chối ở Cấp 1)
                            </span>
                          </div>
                        ) : wasHrApprovedBeforeReject ? (
                          <div style={{ fontSize: '0.8rem', color: '#dc2626' }}>
                            <div>Người hủy & từ chối: {detailModalRequest.rejected_by_name || 'Phòng Nhân sự'} ({formatDate(detailModalRequest.rejected_at)})</div>
                            <div style={{ color: 'var(--text-secondary, #6b7280)', fontSize: '0.75rem', textDecoration: 'line-through' }}>
                              Từng được duyệt bởi: {detailModalRequest.hr_approver_name || 'Phòng Nhân sự'} ({formatDate(detailModalRequest.hr_approved_at)})
                            </div>
                          </div>
                        ) : isHrRejected ? (
                          <div style={{ fontSize: '0.8rem', color: '#dc2626' }}>
                            Người từ chối: {detailModalRequest.rejected_by_name || 'Phòng Nhân sự'} ({formatDate(detailModalRequest.rejected_at)})
                          </div>
                        ) : detailModalRequest.hr_approved_at ? (
                          <div style={{ fontSize: '0.8rem', color: '#059669' }}>
                            Người duyệt: {detailModalRequest.hr_approver_name || 'Trưởng phòng Nhân sự'} ({formatDate(detailModalRequest.hr_approved_at)})
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.75rem', color: '#2563eb' }}>
                            {detailModalRequest.status === 'STORE_APPROVED'
                              ? 'Đang chờ Phòng Nhân sự phê duyệt chính thức...'
                              : 'Chờ CHT duyệt Cấp 1 (hoặc HR có thể duyệt thẳng bất cứ lúc nào)...'}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })()}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setDetailModalRequest(null)}
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
