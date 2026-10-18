import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Icons } from '../components/common/Icons'
import { StatCard } from '../components/common/StatCard'
import { EmptyState } from '../components/common/EmptyState'
import { EmployeeSearchSelect } from '../components/common/EmployeeSearchSelect'
import { formatDate } from '../utils/formatters'
import type { Employee, Lookups, OvertimeRequest, OvertimeRequestStatus } from '../types'
import { employeeApi, overtimeRequestApi } from '../services/api'
import { OVERTIME_REQUEST_STATUS_OPTIONS, overtimeStatusClass, overtimeStatusLabel } from '../components/schedule/overtimeDisplay'
import { OvertimeReconciliationSection } from '../components/schedule/OvertimeReconciliationSection'
import { toast } from 'sonner'
import './OvertimeApprovalsPanel.css'

export interface OvertimeRequestsPageProps {
  user: any
  personal?: boolean
}

function todayInVietnam(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())
}

function monthRange(day: string) {
  const [year, month] = day.split('-').map(Number)
  const lastDay = new Date(year, month, 0).getDate()
  return {
    from: `${year}-${String(month).padStart(2, '0')}-01`,
    to: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  }
}

function displayDate(day?: string | null): string {
  if (!day) return '—'
  const [year, month, date] = day.slice(0, 10).split('-')
  return `${date}/${month}/${year}`
}

function timeOnly(value?: string | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(value))
}

function durationHours(request: OvertimeRequest): number {
  if (!request.starts_at || !request.ends_at) return 0
  const hours = Math.max(0, (new Date(request.ends_at).getTime() - new Date(request.starts_at).getTime()) / 3_600_000)
  return Number(hours.toFixed(1))
}

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case 'APPROVED':
      return 'active'
    case 'PENDING_HR':
      return 'badge-blue'
    case 'PENDING_EMPLOYEE_CONFIRMATION':
    case 'DRAFT':
      return 'pending'
    case 'REJECTED':
    case 'EMPLOYEE_DECLINED':
      return 'rejected'
    case 'CANCELLED':
    case 'REVOKED':
    case 'REPLACED':
      return 'badge-gray'
    default:
      return 'pending'
  }
}

function makeIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() || `ot-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

export function OvertimeRequestsPage({ user, personal = false }: OvertimeRequestsPageProps) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const userRoles: string[] = user?.roles || []
  const isReviewer = userRoles.includes('ADMIN') || userRoles.includes('HR_MANAGER') || userRoles.includes('DIRECTOR')
  const isStoreManager = userRoles.includes('STORE_MANAGER')
  const canManageOvertime = !personal && (isReviewer || isStoreManager)
  const isPersonalView = personal || !canManageOvertime

  const today = todayInVietnam()
  const initialRange = monthRange(today)

  const [dateFrom, setDateFrom] = useState(initialRange.from)
  const [dateTo, setDateTo] = useState(initialRange.to)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [storeId, setStoreId] = useState<string>('')
  const [searchTerm, setSearchTerm] = useState('')
  const [activeTab, setActiveTab] = useState<'all' | 'pending_confirm' | 'pending_hr' | 'approved' | 'rejected_cancelled'>('all')

  const [requests, setRequests] = useState<OvertimeRequest[]>([])
  const [stores, setStores] = useState<Array<{ store_id: number; store_name: string }>>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [selectedRequest, setSelectedRequest] = useState<OvertimeRequest | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<number | null>(null)

  // Create Modal State
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createForm, setCreateForm] = useState({
    employee_id: (isPersonalView ? user?.employee_id : null) as number | null,
    store_id: Number(user?.store_id || 0),
    work_date: today,
    start_time: '18:00',
    end_time: '20:00',
    reason: '',
    notes: '',
  })

  // Quick Action Modal State (Reject / Decline / Revoke / Amend)
  const [rejectModalOpen, setRejectModalOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectTargetId, setRejectTargetId] = useState<number | null>(null)
  const [rejectType, setRejectType] = useState<'reject' | 'decline' | 'revoke'>('reject')

  // Amend Modal State
  const [amendModalOpen, setAmendModalOpen] = useState(false)
  const [amendDate, setAmendDate] = useState(today)
  const [amendStart, setAmendStart] = useState('18:00')
  const [amendEnd, setAmendEnd] = useState('20:00')
  const [amendReason, setAmendReason] = useState('')

  // Load stores and employees
  useEffect(() => {
    let active = true
    employeeApi.getLookups().then(result => {
      if (!active) return
      setStores(result.stores.map(s => ({ store_id: s.store_id, store_name: s.store_name })))
    }).catch(() => {
      if (active) setStores([])
    })

    if (!isPersonalView) {
      employeeApi.getAll({
        store_id: isStoreManager && user?.store_id ? Number(user.store_id) : undefined,
      }).then(res => {
        if (active) setEmployees(res)
      }).catch(() => {
        if (active) setEmployees([])
      })
    }
    return () => { active = false }
  }, [isPersonalView, isStoreManager, user?.store_id])

  // Load Overtime list
  const loadRequests = useCallback(async () => {
    setLoading(true)
    try {
      const params: any = {
        date_from: dateFrom,
        date_to: dateTo,
        limit: 200,
      }
      if (isPersonalView && user?.employee_id) {
        params.employee_id = Number(user.employee_id)
      } else if (isStoreManager && user?.store_id) {
        params.store_id = Number(user.store_id)
      } else if (storeId) {
        params.store_id = Number(storeId)
      }

      const list = await overtimeRequestApi.list(params)
      setRequests(list)
    } catch (err: any) {
      toast.error(err.message || 'Không thể tải danh sách đăng ký OT')
      setRequests([])
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, isPersonalView, isStoreManager, storeId, user?.employee_id, user?.store_id])

  useEffect(() => {
    void loadRequests()
  }, [loadRequests])

  // Open detail modal directly if requestId in URL
  const openDetail = useCallback(async (id: number) => {
    setDetailLoading(true)
    try {
      const detail = await overtimeRequestApi.detail(id)
      setSelectedRequest(detail)
      setAmendDate(detail.work_date)
      setAmendStart(detail.starts_at.slice(11, 16))
      setAmendEnd(detail.ends_at.slice(11, 16))
    } catch (err: any) {
      toast.error(err.message || 'Không thể tải chi tiết đơn OT')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    const reqId = Number(searchParams.get('request_id'))
    if (reqId && reqId > 0) void openDetail(reqId)
  }, [openDetail, searchParams])

  useEffect(() => {
    const handleClickOutside = () => setOpenMenuId(null)
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  // Filter requests by activeTab and search
  const filteredRequests = useMemo(() => {
    return requests.filter(req => {
      // Tab filter
      if (activeTab === 'pending_confirm' && req.status !== 'PENDING_EMPLOYEE_CONFIRMATION') return false
      if (activeTab === 'pending_hr' && req.status !== 'PENDING_HR') return false
      if (activeTab === 'approved' && req.status !== 'APPROVED') return false
      if (activeTab === 'rejected_cancelled' && !['REJECTED', 'EMPLOYEE_DECLINED', 'CANCELLED', 'REVOKED', 'REPLACED'].includes(req.status)) return false

      // Status dropdown filter
      if (statusFilter !== 'all' && req.status !== statusFilter) return false

      // Search term
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase().trim()
        const matchesId = `ot #${req.request_id}`.toLowerCase().includes(term) || String(req.request_id).includes(term)
        const matchesName = (req.employee_name || '').toLowerCase().includes(term)
        const matchesCode = (req.employee_code || '').toLowerCase().includes(term)
        const matchesStore = (req.store_name || '').toLowerCase().includes(term)
        const matchesReason = (req.reason || '').toLowerCase().includes(term)
        if (!matchesId && !matchesName && !matchesCode && !matchesStore && !matchesReason) return false
      }

      return true
    })
  }, [requests, activeTab, statusFilter, searchTerm])

  // Calculate Stat counts
  const statCounts = useMemo(() => {
    const total = requests.length
    const pendingConfirm = requests.filter(r => r.status === 'PENDING_EMPLOYEE_CONFIRMATION').length
    const pendingHr = requests.filter(r => r.status === 'PENDING_HR').length
    const approved = requests.filter(r => r.status === 'APPROVED').length
    const rejected = requests.filter(r => ['REJECTED', 'EMPLOYEE_DECLINED', 'CANCELLED'].includes(r.status)).length

    const approvedHoursSum = requests
      .filter(r => r.status === 'APPROVED')
      .reduce((acc, cur) => acc + durationHours(cur), 0)

    return { total, pendingConfirm, pendingHr, approved, rejected, approvedHoursSum }
  }, [requests])

  // Estimated hours for create modal
  const estimatedCreateHours = useMemo(() => {
    const [startH, startM] = createForm.start_time.split(':').map(Number)
    const [endH, endM] = createForm.end_time.split(':').map(Number)
    let minutes = endH * 60 + endM - (startH * 60 + startM)
    if (minutes <= 0) minutes += 24 * 60
    return Number((minutes / 60).toFixed(1))
  }, [createForm.start_time, createForm.end_time])

  // Actions
  const handleConfirmOT = async (requestId: number) => {
    if (!window.confirm('Bạn có chắc chắn muốn xác nhận đề xuất tăng ca này?')) return
    setActionLoading(true)
    try {
      await overtimeRequestApi.employeeConfirm(requestId)
      toast.success('Đã xác nhận đề xuất tăng ca thành công!')
      await loadRequests()
      if (selectedRequest?.request_id === requestId) void openDetail(requestId)
    } catch (err: any) {
      toast.error(err.message || 'Xác nhận thất bại')
    } finally {
      setActionLoading(false)
    }
  }

  const handleApproveOT = async (requestId: number) => {
    if (!window.confirm('Phê duyệt đơn đăng ký tăng ca này?')) return
    setActionLoading(true)
    try {
      await overtimeRequestApi.approve(requestId)
      toast.success('Đã phê duyệt đơn tăng ca (Cấp 2) thành công!')
      await loadRequests()
      if (selectedRequest?.request_id === requestId) void openDetail(requestId)
    } catch (err: any) {
      toast.error(err.message || 'Phê duyệt thất bại')
    } finally {
      setActionLoading(false)
    }
  }

  const handleOpenReject = (requestId: number, type: 'reject' | 'decline' | 'revoke') => {
    setRejectTargetId(requestId)
    setRejectType(type)
    setRejectReason('')
    setRejectModalOpen(true)
  }

  const handleConfirmReject = async () => {
    if (!rejectTargetId) return
    if (!rejectReason.trim() || rejectReason.trim().length < 3) {
      toast.warning('Vui lòng nhập lý do từ chối ít nhất 3 ký tự.')
      return
    }
    setActionLoading(true)
    try {
      if (rejectType === 'decline') {
        await overtimeRequestApi.employeeDecline(rejectTargetId, rejectReason.trim())
        toast.success('Đã từ chối đề xuất tăng ca.')
      } else if (rejectType === 'revoke') {
        await overtimeRequestApi.requestRevocation(rejectTargetId, rejectReason.trim())
        toast.success('Đã gửi yêu cầu thu hồi đơn OT.')
      } else {
        await overtimeRequestApi.reject(rejectTargetId, rejectReason.trim())
        toast.success('Đã từ chối đơn tăng ca.')
      }
      setRejectModalOpen(false)
      await loadRequests()
      if (selectedRequest?.request_id === rejectTargetId) void openDetail(rejectTargetId)
    } catch (err: any) {
      toast.error(err.message || 'Thao tác thất bại')
    } finally {
      setActionLoading(false)
    }
  }

  const handleCancelOT = async (requestId: number) => {
    if (!window.confirm('Bạn có chắc chắn muốn hủy đơn đăng ký OT này?')) return
    setActionLoading(true)
    try {
      await overtimeRequestApi.cancel(requestId)
      toast.success('Đã hủy đơn OT thành công.')
      await loadRequests()
      if (selectedRequest?.request_id === requestId) void openDetail(requestId)
    } catch (err: any) {
      toast.error(err.message || 'Lỗi khi hủy đơn')
    } finally {
      setActionLoading(false)
    }
  }

  const handleSaveCreate = async (submit: boolean) => {
    const empId = isPersonalView ? user?.employee_id : createForm.employee_id
    if (!empId) {
      toast.warning('Vui lòng chọn nhân viên.')
      return
    }
    if (!createForm.work_date) {
      toast.warning('Vui lòng chọn ngày tăng ca.')
      return
    }
    if (!createForm.start_time || !createForm.end_time || createForm.start_time === createForm.end_time) {
      toast.warning('Vui lòng chọn khung giờ hợp lệ.')
      return
    }
    if (!createForm.reason.trim() || createForm.reason.trim().length < 3) {
      toast.warning('Vui lòng nhập lý do tăng ca (tối thiểu 3 ký tự).')
      return
    }

    setActionLoading(true)
    try {
      const created = await overtimeRequestApi.create({
        employee_id: Number(empId),
        store_id: createForm.store_id || undefined,
        work_date: createForm.work_date,
        start_time: createForm.start_time,
        end_time: createForm.end_time,
        reason: createForm.reason.trim(),
        notes: createForm.notes.trim() || undefined,
      }, makeIdempotencyKey())

      if (submit) {
        await overtimeRequestApi.submit(created.request_id)
        toast.success('Đã nộp đơn đăng ký tăng ca thành công!')
      } else {
        toast.success('Đã lưu bản nháp đăng ký OT thành công!')
      }
      setCreateModalOpen(false)
      await loadRequests()
    } catch (err: any) {
      toast.error(err.message || 'Lỗi khi tạo đăng ký OT')
    } finally {
      setActionLoading(false)
    }
  }

  const handleConfirmAmend = async () => {
    if (!selectedRequest) return
    if (!amendReason.trim() || amendReason.trim().length < 3) {
      toast.warning('Vui lòng nhập lý do điều chỉnh ít nhất 3 ký tự.')
      return
    }
    setActionLoading(true)
    try {
      await overtimeRequestApi.proposeAmendment(selectedRequest.request_id, {
        work_date: amendDate,
        start_time: amendStart,
        end_time: amendEnd,
        reason: amendReason.trim(),
      })
      toast.success('Đã gửi đề xuất điều chỉnh đơn OT!')
      setAmendModalOpen(false)
      await loadRequests()
      void openDetail(selectedRequest.request_id)
    } catch (err: any) {
      toast.error(err.message || 'Không thể điều chỉnh đơn')
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div className="page-container">
      {/* Page Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 className="page-title">{isPersonalView ? 'Đơn OT Của Tôi' : 'Quản lý Đăng Ký OT'}</h1>
          <p style={{ color: 'var(--text-secondary, #6b7280)', fontSize: '0.9rem', marginTop: '4px' }}>
            {isPersonalView
              ? 'Theo dõi danh sách đăng ký tăng ca, xác nhận lịch OT và đối soát bảng lương cá nhân'
              : 'Theo dõi, phê duyệt đơn đăng ký tăng ca 2 cấp và liên kết đối soát bảng lương TechZone'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            className="btn btn-secondary"
            onClick={() => void loadRequests()}
            disabled={loading}
            title="Tải lại danh sách"
          >
            {Icons.refresh}
            <span>Làm mới</span>
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              setCreateForm({
                employee_id: (isPersonalView ? user?.employee_id : null) as number | null,
                store_id: Number(user?.store_id || stores[0]?.store_id || 0),
                work_date: today,
                start_time: '18:00',
                end_time: '20:00',
                reason: '',
                notes: '',
              })
              setCreateModalOpen(true)
            }}
          >
            {Icons.plus}
            <span>{isPersonalView ? 'Đăng ký tăng ca' : 'Tạo đơn cho nhân viên'}</span>
          </button>
        </div>
      </div>

      {/* KPI Stat Cards */}
      <div className="stat-grid-4">
        {isPersonalView ? (
          <>
            <StatCard
              icon={Icons.clock}
              iconColor="blue"
              label="Giờ OT đã duyệt (kỳ này)"
              value={`${statCounts.approvedHoursSum.toFixed(1)} giờ`}
            />
            <StatCard
              icon={Icons.alertCircle}
              iconColor="amber"
              label="Chờ bạn xác nhận (Cấp 1)"
              value={`${statCounts.pendingConfirm} đơn`}
            />
            <StatCard
              icon={Icons.shield}
              iconColor="blue"
              label="Chờ HR duyệt (Cấp 2)"
              value={`${statCounts.pendingHr} đơn`}
            />
            <StatCard
              icon={Icons.checkCircle}
              iconColor="green"
              label="Đơn OT đã duyệt"
              value={`${statCounts.approved} đơn`}
            />
          </>
        ) : (
          <>
            <StatCard
              icon={Icons.clipboardList}
              iconColor="blue"
              label="Tổng đơn đăng ký OT"
              value={`${statCounts.total} đơn`}
            />
            <StatCard
              icon={Icons.users}
              iconColor="amber"
              label="Chờ NV xác nhận (Cấp 1)"
              value={`${statCounts.pendingConfirm} đơn`}
            />
            <StatCard
              icon={Icons.shield}
              iconColor="blue"
              label="Chờ HR duyệt (Cấp 2)"
              value={`${statCounts.pendingHr} đơn`}
            />
            <StatCard
              icon={Icons.checkCircle}
              iconColor="green"
              label="Đã phê duyệt"
              value={`${statCounts.approved} đơn`}
            />
          </>
        )}
      </div>

      {/* Main Card */}
      <div className="card">
        {/* Card Header & Tabs (Optimized layout exactly matching LeaveRequestsPage) */}
        <div className="card-header leave-requests-header" style={{ flexWrap: 'wrap', gap: '12px', overflowX: 'visible' }}>
          {/* Tabs */}
          <div
            className="tabs"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              marginBottom: 0,
              borderBottom: 'none',
              padding: 0,
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            <button
              type="button"
              className={`leave-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
              onClick={() => setActiveTab('all')}
            >
              <span>Tất cả</span>
              <span className="leave-tab-badge">{statCounts.total}</span>
            </button>
            <button
              type="button"
              className={`leave-tab-btn ${activeTab === 'pending_confirm' ? 'active' : ''}`}
              onClick={() => setActiveTab('pending_confirm')}
            >
              <span>{isPersonalView ? 'Chờ bạn xác nhận' : 'Chờ NV xác nhận (C1)'}</span>
              <span
                className="leave-tab-badge"
                style={
                  statCounts.pendingConfirm > 0
                    ? { backgroundColor: 'var(--status-warning-bg, #fef3c7)', color: 'var(--status-warning, #d97706)' }
                    : undefined
                }
              >
                {statCounts.pendingConfirm}
              </span>
            </button>
            <button
              type="button"
              className={`leave-tab-btn ${activeTab === 'pending_hr' ? 'active' : ''}`}
              onClick={() => setActiveTab('pending_hr')}
            >
              <span>Chờ HR duyệt (C2)</span>
              <span
                className="leave-tab-badge"
                style={
                  statCounts.pendingHr > 0
                    ? { backgroundColor: 'var(--role-director-bg, #eff6ff)', color: 'var(--role-director-text, #2563eb)' }
                    : undefined
                }
              >
                {statCounts.pendingHr}
              </span>
            </button>
            <button
              type="button"
              className={`leave-tab-btn ${activeTab === 'approved' ? 'active' : ''}`}
              onClick={() => setActiveTab('approved')}
            >
              <span>Đã duyệt</span>
              <span className="leave-tab-badge">{statCounts.approved}</span>
            </button>
            <button
              type="button"
              className={`leave-tab-btn ${activeTab === 'rejected_cancelled' ? 'active' : ''}`}
              onClick={() => setActiveTab('rejected_cancelled')}
            >
              <span>Từ chối / Hủy</span>
              <span className="leave-tab-badge">{statCounts.rejected}</span>
            </button>
          </div>

          {/* Search & Filter Controls on the same row */}
          <div
            style={{
              display: 'flex',
              gap: '10px',
              alignItems: 'center',
              flexShrink: 0,
              marginLeft: 'auto',
              whiteSpace: 'nowrap',
            }}
          >
            <div className="search-box" style={{ width: '210px', minWidth: '150px', position: 'relative' }}>
              <span
                className="search-icon"
                style={{
                  position: 'absolute',
                  left: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  display: 'flex',
                  alignItems: 'center',
                  color: 'var(--text-muted)',
                  pointerEvents: 'none',
                }}
              >
                {Icons.search}
              </span>
              <input
                type="text"
                className="form-input"
                placeholder="Tìm nhân viên, mã OT..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                style={{
                  height: '34px',
                  paddingLeft: '32px',
                  paddingRight: searchTerm ? '28px' : '10px',
                  fontSize: '13px',
                  width: '100%',
                }}
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  style={{
                    position: 'absolute',
                    right: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-muted)',
                    fontSize: '12px',
                    padding: '2px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  title="Xóa tìm kiếm"
                >
                  {Icons.close}
                </button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input
                type="date"
                className="form-input"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                style={{ height: '34px', fontSize: '12.5px', width: '125px', padding: '0 6px' }}
                title="Từ ngày"
              />
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>-</span>
              <input
                type="date"
                className="form-input"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                style={{ height: '34px', fontSize: '12.5px', width: '125px', padding: '0 6px' }}
                title="Đến ngày"
              />
            </div>

            {!isPersonalView && isReviewer && stores.length > 0 && (
              <select
                className="form-select"
                value={storeId}
                onChange={e => setStoreId(e.target.value)}
                style={{
                  height: '34px',
                  width: 'auto',
                  minWidth: '135px',
                  fontSize: '13px',
                }}
              >
                <option value="">Tất cả cửa hàng</option>
                {stores.map(s => (
                  <option key={s.store_id} value={String(s.store_id)}>
                    {s.store_name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Table Section */}
        {loading ? (
          <div className="card-body" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
            Đang tải danh sách đơn đăng ký tăng ca...
          </div>
        ) : (
          <div className="table-container" style={{ minHeight: '320px' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>MÃ ĐƠN</th>
                  <th>NHÂN VIÊN</th>
                  <th>NGÀY TĂNG CA</th>
                  <th>KHUNG GIỜ</th>
                  <th>TỔNG GIỜ</th>
                  <th>LÝ DO</th>
                  <th>TRẠNG THÁI</th>
                  <th>CẤP 1 (CHT / NV)</th>
                  <th>CẤP 2 (HR DUYỆT)</th>
                  <th style={{ width: '95px', textAlign: 'center' }}>THAO TÁC</th>
                </tr>
              </thead>
              <tbody>
                {filteredRequests.map((req, index) => {
                  const hours = durationHours(req)
                  const isAssignedToMe = Number(req.employee_id) === Number(user?.employee_id)
                  const isCreator = req.created_by === user?.user_id
                  const canSelfConfirm = isAssignedToMe && req.status === 'PENDING_EMPLOYEE_CONFIRMATION'
                  const canHrApprove = isReviewer && req.status === 'PENDING_HR' && req.created_by !== user?.user_id && !isAssignedToMe
                  const canCancel = ['DRAFT', 'PENDING_EMPLOYEE_CONFIRMATION', 'PENDING_HR'].includes(req.status) &&
                    (isCreator || isAssignedToMe)
                  const canRevoke = req.status === 'APPROVED' && !req.revoke_requested_at && (isReviewer || isStoreManager || isAssignedToMe || isCreator)
                  const hasAnyAction = true
                  const isNearBottom = index >= filteredRequests.length - 2 && filteredRequests.length > 2

                  return (
                    <tr
                      key={req.request_id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => void openDetail(req.request_id)}
                    >
                      <td>
                        <span className="table-cell-mono font-bold" style={{ cursor: 'pointer', color: 'var(--primary-color, #2563eb)' }}>
                          #{req.request_id}
                        </span>
                        {req.created_at && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {formatDate(req.created_at)}
                          </div>
                        )}
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
                        <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                          {displayDate(req.work_date)}
                        </span>
                      </td>
                      <td>
                        <span className="table-cell-mono" style={{ fontSize: '0.85rem' }}>
                          {timeOnly(req.starts_at)} → {timeOnly(req.ends_at)}
                        </span>
                      </td>
                      <td>
                        <strong style={{ color: 'var(--text-primary)' }}>{hours} giờ</strong>
                      </td>
                      <td
                        style={{ maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                        title={req.reason}
                      >
                        <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                          {req.reason}
                        </span>
                      </td>
                      <td>
                        <span className={`status-pill ${getStatusBadgeClass(req.status)}`}>
                          {overtimeStatusLabel(req.status)}
                        </span>
                        {req.is_overdue && (
                          <span className="overtime-overdue-badge" style={{ marginLeft: '4px' }}>Quá hạn</span>
                        )}
                      </td>
                      <td>
                        {/* Cấp 1 CHT / NV xác nhận */}
                        {req.employee_confirmed_at ? (
                          <div style={{ fontSize: '0.8rem', color: 'var(--status-success)' }}>
                            <div>{Icons.check} NV xác nhận</div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{formatDate(req.employee_confirmed_at)}</div>
                          </div>
                        ) : req.status === 'PENDING_EMPLOYEE_CONFIRMATION' ? (
                          <span style={{ fontSize: '0.8rem', color: 'var(--status-warning, #d97706)' }}>Chờ NV xác nhận</span>
                        ) : req.status === 'EMPLOYEE_DECLINED' ? (
                          <span style={{ fontSize: '0.8rem', color: 'var(--status-error)' }}>✕ NV từ chối</span>
                        ) : (
                          <div style={{ fontSize: '0.8rem', color: 'var(--status-success)' }}>
                            <div>{Icons.check} Đã xác nhận</div>
                          </div>
                        )}
                      </td>
                      <td>
                        {/* Cấp 2 HR / Admin phê duyệt */}
                        {req.status === 'APPROVED' ? (
                          <div style={{ fontSize: '0.8rem', color: 'var(--status-success)' }}>
                            <div>{Icons.check} {req.reviewer_username || 'HR'}</div>
                            {req.reviewed_at && <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{formatDate(req.reviewed_at)}</div>}
                          </div>
                        ) : req.status === 'REJECTED' ? (
                          <div style={{ fontSize: '0.8rem', color: 'var(--status-error)' }}>
                            <div>✕ {req.reviewer_username || 'Từ chối'}</div>
                            {req.reviewed_at && <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{formatDate(req.reviewed_at)}</div>}
                          </div>
                        ) : req.status === 'PENDING_HR' ? (
                          <span style={{ fontSize: '0.8rem', color: 'var(--action-primary, #2563eb)' }}>Chờ HR duyệt</span>
                        ) : req.status === 'PENDING_EMPLOYEE_CONFIRMATION' ? (
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Chờ Cấp 1</span>
                        ) : (
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center', position: 'relative' }}>
                          {/* Nút 1: Xem chi tiết (Mắt) */}
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm btn-icon"
                            title="Xem chi tiết đơn"
                            onClick={() => void openDetail(req.request_id)}
                          >
                            {Icons.eye}
                          </button>

                          {/* Nút 2: Tùy chọn thao tác (Dấu 3 chấm) */}
                          <button
                            type="button"
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
                                ...(isNearBottom ? { bottom: '100%', marginBottom: '4px' } : { top: '100%', marginTop: '4px' }),
                                right: 0,
                                zIndex: 120,
                                minWidth: '205px',
                              }}
                            >
                              <button
                                type="button"
                                className="action-dropdown-item"
                                onClick={() => {
                                  setOpenMenuId(null)
                                  void openDetail(req.request_id)
                                }}
                              >
                                <span className="action-icon" style={{ color: 'var(--status-info)' }}>{Icons.eye}</span>
                                <span>Xem chi tiết & Đối soát</span>
                              </button>

                              {!isPersonalView && (
                                <button
                                  type="button"
                                  className="action-dropdown-item"
                                  onClick={() => {
                                    setOpenMenuId(null)
                                    setCreateForm(prev => ({
                                      ...prev,
                                      employee_id: req.employee_id,
                                      store_id: req.store_id || prev.store_id,
                                    }))
                                    setCreateModalOpen(true)
                                  }}
                                >
                                  <span className="action-icon" style={{ color: 'var(--status-success)' }}>{Icons.plus}</span>
                                  <span>Tạo đơn hộ nhân viên này</span>
                                </button>
                              )}

                              {canSelfConfirm && (
                                <>
                                  <button
                                    type="button"
                                    className="action-dropdown-item"
                                    onClick={() => {
                                      setOpenMenuId(null)
                                      void handleConfirmOT(req.request_id)
                                    }}
                                  >
                                    <span className="action-icon icon-promote">{Icons.check}</span>
                                    <span>Xác nhận tăng ca (Cấp 1)</span>
                                  </button>
                                  <button
                                    type="button"
                                    className="action-dropdown-item danger"
                                    onClick={() => {
                                      setOpenMenuId(null)
                                      handleOpenReject(req.request_id, 'decline')
                                    }}
                                  >
                                    <span className="action-icon icon-danger">✕</span>
                                    <span>Từ chối đề xuất tăng ca</span>
                                  </button>
                                </>
                              )}

                              {canHrApprove && (
                                <>
                                  <button
                                    type="button"
                                    className="action-dropdown-item"
                                    onClick={() => {
                                      setOpenMenuId(null)
                                      void handleApproveOT(req.request_id)
                                    }}
                                  >
                                    <span className="action-icon icon-promote">{Icons.check}</span>
                                    <span>Phê duyệt tăng ca (HR)</span>
                                  </button>
                                  <button
                                    type="button"
                                    className="action-dropdown-item danger"
                                    onClick={() => {
                                      setOpenMenuId(null)
                                      handleOpenReject(req.request_id, 'reject')
                                    }}
                                  >
                                    <span className="action-icon icon-danger">✕</span>
                                    <span>Từ chối duyệt đơn OT</span>
                                  </button>
                                </>
                              )}

                              {canRevoke && (
                                <button
                                  type="button"
                                  className="action-dropdown-item danger"
                                  onClick={() => {
                                    setOpenMenuId(null)
                                    handleOpenReject(req.request_id, 'revoke')
                                  }}
                                >
                                  <span className="action-icon icon-danger">✕</span>
                                  <span>Yêu cầu thu hồi / Hủy duyệt</span>
                                </button>
                              )}

                              {canCancel && (
                                <button
                                  type="button"
                                  className="action-dropdown-item danger"
                                  onClick={() => {
                                    setOpenMenuId(null)
                                    void handleCancelOT(req.request_id)
                                  }}
                                >
                                  <span className="action-icon icon-danger">✕</span>
                                  <span>Hủy đơn đăng ký OT</span>
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
                    <td colSpan={10} style={{ padding: '40px 20px' }}>
                      <EmptyState
                        icon={Icons.clock}
                        title="Không tìm thấy đơn đăng ký OT nào"
                        description="Không có đơn tăng ca nào phù hợp với bộ lọc tìm kiếm hiện tại."
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL 1: TẠO ĐƠN ĐĂNG KÝ OT MỚI */}
      {createModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
          onClick={() => !actionLoading && setCreateModalOpen(false)}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '560px',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div
              style={{
                padding: '18px 24px',
                borderBottom: '1px solid var(--border-default)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600 }}>
                {isPersonalView ? 'Đăng Ký Làm Thêm Giờ (OT)' : 'Tạo Đăng Ký OT Cho Nhân Viên'}
              </h3>
              <button
                type="button"
                className="btn btn-icon btn-secondary"
                onClick={() => setCreateModalOpen(false)}
                disabled={actionLoading}
              >
                {Icons.close}
              </button>
            </div>

            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Chọn nhân viên nếu là quản lý */}
              {!isPersonalView && (
                <div>
                  <label className="form-label" style={{ fontWeight: 600, marginBottom: '6px' }}>
                    Chọn nhân viên <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <EmployeeSearchSelect
                    employees={employees}
                    value={createForm.employee_id}
                    onChange={(id, emp) => {
                      setCreateForm(prev => ({
                        ...prev,
                        employee_id: id,
                        store_id: emp?.store_id || prev.store_id,
                      }))
                    }}
                    placeholder="Tìm kiếm nhân viên trong cửa hàng..."
                  />
                </div>
              )}

              {/* Cửa hàng */}
              <div>
                <label className="form-label" style={{ fontWeight: 600, marginBottom: '6px' }}>
                  Cửa hàng áp dụng <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <select
                  className="form-select"
                  value={createForm.store_id}
                  onChange={e => setCreateForm(prev => ({ ...prev, store_id: Number(e.target.value) }))}
                  disabled={!isReviewer && Boolean(user?.store_id)}
                >
                  {stores.map(s => (
                    <option key={s.store_id} value={s.store_id}>
                      {s.store_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Ngày tăng ca */}
              <div>
                <label className="form-label" style={{ fontWeight: 600, marginBottom: '6px' }}>
                  Ngày làm việc tăng ca <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="date"
                  className="form-input"
                  value={createForm.work_date}
                  onChange={e => setCreateForm(prev => ({ ...prev, work_date: e.target.value }))}
                />
              </div>

              {/* Khung giờ: Bắt đầu & Kết thúc */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label className="form-label" style={{ fontWeight: 600, marginBottom: '6px' }}>
                    Giờ bắt đầu <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="time"
                    className="form-input"
                    value={createForm.start_time}
                    onChange={e => setCreateForm(prev => ({ ...prev, start_time: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontWeight: 600, marginBottom: '6px' }}>
                    Giờ kết thúc <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="time"
                    className="form-input"
                    value={createForm.end_time}
                    onChange={e => setCreateForm(prev => ({ ...prev, end_time: e.target.value }))}
                  />
                </div>
              </div>

              {/* Ước tính giờ */}
              <div
                style={{
                  padding: '10px 14px',
                  backgroundColor: 'var(--surface-subtle)',
                  borderRadius: '8px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Tổng thời gian dự kiến:
                </span>
                <span style={{ fontWeight: 700, color: 'var(--action-primary)', fontSize: '1rem' }}>
                  {estimatedCreateHours} giờ OT
                </span>
              </div>

              {/* Lý do tăng ca */}
              <div>
                <label className="form-label" style={{ fontWeight: 600, marginBottom: '6px' }}>
                  Lý do làm thêm giờ <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <textarea
                  className="form-input"
                  rows={3}
                  placeholder="Ví dụ: Tăng cường phục vụ đợt ra mắt sản phẩm mới, kiểm kho định kỳ..."
                  value={createForm.reason}
                  onChange={e => setCreateForm(prev => ({ ...prev, reason: e.target.value }))}
                />
              </div>

              {/* Ghi chú */}
              <div>
                <label className="form-label" style={{ fontWeight: 600, marginBottom: '6px' }}>
                  Ghi chú bổ sung (tùy chọn)
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Ghi chú thêm về phân công, vị trí..."
                  value={createForm.notes}
                  onChange={e => setCreateForm(prev => ({ ...prev, notes: e.target.value }))}
                />
              </div>
            </div>

            <div
              style={{
                padding: '16px 24px',
                borderTop: '1px solid var(--border-default)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '10px',
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setCreateModalOpen(false)}
                disabled={actionLoading}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void handleSaveCreate(false)}
                disabled={actionLoading}
              >
                Lưu bản nháp
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleSaveCreate(true)}
                disabled={actionLoading}
              >
                {actionLoading ? 'Đang gửi...' : isPersonalView ? 'Gửi đăng ký OT' : 'Tạo & Gửi phê duyệt'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: XEM CHI TIẾT ĐƠN OT & DUYỆT 2 CẤP */}
      {detailLoading && (
        <div className="overtime-detail-loading" role="status">
          Đang tải chi tiết đơn OT…
        </div>
      )}

      {selectedRequest && (
        <div
          className="overtime-drawer-backdrop"
          role="presentation"
          onMouseDown={e => {
            if (e.target === e.currentTarget && !actionLoading) setSelectedRequest(null)
          }}
        >
          <aside className="overtime-detail-drawer" role="dialog" aria-modal="true">
            <header className="overtime-drawer-header">
              <div>
                <span className="overtime-drawer-eyebrow">HỒ SƠ ĐĂNG KÝ TĂNG CA</span>
                <h2 style={{ margin: '4px 0 0 0', fontSize: '1.25rem' }}>
                  Đơn OT #{selectedRequest.request_id}
                </h2>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-icon"
                onClick={() => setSelectedRequest(null)}
                disabled={actionLoading}
              >
                {Icons.close}
              </button>
            </header>

            <div className="overtime-drawer-content">
              {/* Status Header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  backgroundColor: 'var(--surface-subtle)',
                  borderRadius: '10px',
                  marginBottom: '18px',
                }}
              >
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Trạng thái hiện tại:</span>
                <span className={`calendar-overtime-chip ${overtimeStatusClass(selectedRequest.status)}`}>
                  {overtimeStatusLabel(selectedRequest.status)}
                </span>
              </div>

              {/* Thông tin chính */}
              <div className="overtime-detail-grid">
                <div>
                  <small>Nhân viên</small>
                  <strong>{selectedRequest.employee_name}</strong>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Mã NV: {selectedRequest.employee_code || `#${selectedRequest.employee_id}`}
                  </span>
                </div>
                <div>
                  <small>Cửa hàng</small>
                  <strong>{selectedRequest.store_name}</strong>
                </div>
                <div>
                  <small>Ngày làm việc OT</small>
                  <strong>{displayDate(selectedRequest.work_date)}</strong>
                </div>
                <div>
                  <small>Khung giờ & Thời lượng</small>
                  <strong>
                    {timeOnly(selectedRequest.starts_at)} → {timeOnly(selectedRequest.ends_at)} ({durationHours(selectedRequest)} giờ)
                  </strong>
                </div>
                <div className="overtime-detail-wide">
                  <small>Lý do tăng ca</small>
                  <p style={{ margin: 0, fontWeight: 500, color: 'var(--text-primary)' }}>{selectedRequest.reason}</p>
                </div>
                {selectedRequest.notes && (
                  <div className="overtime-detail-wide">
                    <small>Ghi chú công việc</small>
                    <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{selectedRequest.notes}</p>
                  </div>
                )}
              </div>

              {/* QUY TRÌNH PHÊ DUYỆT 2 CẤP */}
              <div style={{ marginTop: '24px' }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Quy Trình Phê Duyệt 2 Cấp
                </h4>

                <div
                  style={{
                    border: '1px solid var(--border-default)',
                    borderRadius: '10px',
                    padding: '16px',
                    backgroundColor: 'var(--surface-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {/* Cấp 1 */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                      <div
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          backgroundColor: selectedRequest.employee_confirmed_at || selectedRequest.status === 'PENDING_HR' || selectedRequest.status === 'APPROVED'
                            ? 'var(--status-success-bg)'
                            : 'var(--status-warning-bg)',
                          color: selectedRequest.employee_confirmed_at || selectedRequest.status === 'PENDING_HR' || selectedRequest.status === 'APPROVED'
                            ? 'var(--status-success)'
                            : 'var(--status-warning)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: '0.85rem',
                          flexShrink: 0,
                        }}
                      >
                        1
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                          Cấp 1: Đề xuất & Xác nhận nhân viên
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                          {selectedRequest.employee_confirmed_at
                            ? `Nhân viên đã xác nhận vào ${new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(selectedRequest.employee_confirmed_at))}`
                            : selectedRequest.status === 'PENDING_EMPLOYEE_CONFIRMATION'
                              ? 'Đang chờ nhân viên xác nhận đề xuất tăng ca'
                              : 'Nhân viên đã tự khởi tạo và xác nhận đơn'}
                        </div>
                      </div>
                    </div>

                    {/* Cấp 2 */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                      <div
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          backgroundColor: selectedRequest.status === 'APPROVED'
                            ? 'var(--status-success-bg)'
                            : selectedRequest.status === 'REJECTED'
                              ? 'var(--status-error-bg)'
                              : 'var(--surface-card)',
                          color: selectedRequest.status === 'APPROVED'
                            ? 'var(--status-success)'
                            : selectedRequest.status === 'REJECTED'
                              ? 'var(--status-error)'
                              : 'var(--text-muted)',
                          border: '1px solid var(--border-default)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: '0.85rem',
                          flexShrink: 0,
                        }}
                      >
                        2
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                          Cấp 2: Phòng Nhân sự / Ban Giám đốc phê duyệt
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                          {selectedRequest.status === 'APPROVED'
                            ? `Đã được ${selectedRequest.reviewer_username || 'HR'} phê duyệt chính thức`
                            : selectedRequest.status === 'REJECTED'
                              ? `Đã bị từ chối: ${selectedRequest.rejection_reason || 'Không chấp thuận'}`
                              : selectedRequest.status === 'PENDING_HR'
                                ? 'Đang chờ Trưởng phòng Nhân sự duyệt'
                                : 'Chờ hoàn tất Cấp 1 để chuyển duyệt'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* LIÊN KẾT BẢNG LƯƠNG & CHẤM CÔNG (PAYROLL INTEGRATION) */}
              <div style={{ marginTop: '24px' }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Liên Kết Chấm Công & Bảng Lương (Payroll)
                </h4>

                <div
                  style={{
                    padding: '16px',
                    borderRadius: '10px',
                    backgroundColor: 'var(--surface-subtle)',
                    border: '1px solid var(--border-default)',
                  }}
                >
                  <p style={{ margin: '0 0 10px 0', fontSize: '0.85rem', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
                    💡 <strong>Cơ chế tính lương:</strong> Đơn OT sau khi duyệt là căn cứ ghi nhận làm thêm giờ.
                    Sau khi nhân viên kết thúc ca làm việc, hệ thống tiến hành đối soát phiên chấm công (check-in/check-out).
                    Khi HR đối soát hoặc chốt kỳ bảng lương, số giờ OT được duyệt sẽ tự động kết chuyển thành Tiền làm thêm giờ (Overtime Salary) trong Phiếu lương tháng.
                  </p>

                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => navigate(isPersonalView ? '/my-attendance' : '/attendance')}
                    >
                      {Icons.clock}
                      <span>{isPersonalView ? 'Xem Bảng công cá nhân' : 'Xem Quản lý công & OT'}</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => navigate(isPersonalView ? '/my-payroll' : '/payroll')}
                    >
                      {Icons.wallet}
                      <span>{isPersonalView ? 'Xem Phiếu lương của tôi' : 'Xem Quản lý Bảng lương'}</span>
                    </button>
                  </div>
                </div>

                {/* Phần Đối Soát Chấm Công Thực Tế */}
                {selectedRequest.status === 'APPROVED' && (
                  <div style={{ marginTop: '16px' }}>
                    <OvertimeReconciliationSection request={selectedRequest} user={user} />
                  </div>
                )}
              </div>
            </div>

            {/* Action Bar */}
            <footer className="overtime-drawer-actions">
              {/* Nhân viên xác nhận Cấp 1 */}
              {Number(selectedRequest.employee_id) === Number(user?.employee_id) && selectedRequest.status === 'PENDING_EMPLOYEE_CONFIRMATION' && (
                <>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => handleOpenReject(selectedRequest.request_id, 'decline')}
                    disabled={actionLoading}
                  >
                    Từ chối đề xuất
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void handleConfirmOT(selectedRequest.request_id)}
                    disabled={actionLoading}
                  >
                    Xác nhận đề xuất OT
                  </button>
                </>
              )}

              {/* HR Phê duyệt Cấp 2 */}
              {isReviewer && selectedRequest.status === 'PENDING_HR' && selectedRequest.created_by !== user?.user_id && Number(selectedRequest.employee_id) !== Number(user?.employee_id) && (
                <>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => handleOpenReject(selectedRequest.request_id, 'reject')}
                    disabled={actionLoading}
                  >
                    Từ chối đơn
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void handleApproveOT(selectedRequest.request_id)}
                    disabled={actionLoading}
                  >
                    Phê duyệt OT (HR)
                  </button>
                </>
              )}

              {/* Hủy đơn nếu còn đang chờ */}
              {['DRAFT', 'PENDING_EMPLOYEE_CONFIRMATION', 'PENDING_HR'].includes(selectedRequest.status) &&
                (selectedRequest.created_by === user?.user_id || Number(selectedRequest.employee_id) === Number(user?.employee_id)) && (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void handleCancelOT(selectedRequest.request_id)}
                  disabled={actionLoading}
                >
                  Hủy đơn này
                </button>
              )}

              {/* Thu hồi hoặc Điều chỉnh khi đã duyệt */}
              {selectedRequest.status === 'APPROVED' && selectedRequest.lifecycle?.eligible && (
                <>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setAmendModalOpen(true)}
                    disabled={actionLoading}
                  >
                    Đề xuất điều chỉnh
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ color: 'var(--status-error)' }}
                    onClick={() => handleOpenReject(selectedRequest.request_id, 'revoke')}
                    disabled={actionLoading}
                  >
                    Yêu cầu thu hồi
                  </button>
                </>
              )}
            </footer>
          </aside>
        </div>
      )}

      {/* MODAL 3: TỪ CHỐI / THU HỒI / DECLINE */}
      {rejectModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            zIndex: 1100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
          onClick={() => !actionLoading && setRejectModalOpen(false)}
        >
          <div
            className="card"
            style={{ width: '100%', maxWidth: '440px', padding: '24px' }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 12px 0', fontSize: '1.15rem', fontWeight: 600 }}>
              {rejectType === 'decline'
                ? 'Từ Chối Đề Xuất Tăng Ca'
                : rejectType === 'revoke'
                  ? 'Yêu Cầu Thu Hồi Đơn OT'
                  : 'Từ Chối Đơn Đăng Ký OT'}
            </h3>
            <p style={{ margin: '0 0 14px 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Vui lòng nhập lý do cụ thể (tối thiểu 3 ký tự) để nhân viên và quản lý nắm được thông tin.
            </p>
            <textarea
              className="form-input"
              rows={3}
              placeholder="Nhập lý do..."
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              style={{ width: '100%', marginBottom: '16px' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setRejectModalOpen(false)}
                disabled={actionLoading}
              >
                Quay lại
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void handleConfirmReject()}
                disabled={actionLoading || rejectReason.trim().length < 3}
              >
                {actionLoading ? 'Đang xử lý...' : 'Xác nhận'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: ĐIỀU CHỈNH ĐƠN OT (AMEND) */}
      {amendModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            zIndex: 1100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
          onClick={() => !actionLoading && setAmendModalOpen(false)}
        >
          <div
            className="card"
            style={{ width: '100%', maxWidth: '480px', padding: '24px' }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 12px 0', fontSize: '1.15rem', fontWeight: 600 }}>
              Đề Xuất Điều Chỉnh Đơn OT
            </h3>
            <p style={{ margin: '0 0 16px 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Đề xuất này sẽ gửi lên HR duyệt thay thế đơn OT gốc.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label className="form-label">Ngày OT mới:</label>
                <input
                  type="date"
                  className="form-input"
                  value={amendDate}
                  onChange={e => setAmendDate(e.target.value)}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label className="form-label">Bắt đầu:</label>
                  <input
                    type="time"
                    className="form-input"
                    value={amendStart}
                    onChange={e => setAmendStart(e.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label">Kết thúc:</label>
                  <input
                    type="time"
                    className="form-input"
                    value={amendEnd}
                    onChange={e => setAmendEnd(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="form-label">Lý do điều chỉnh (bắt buộc):</label>
                <textarea
                  className="form-input"
                  rows={3}
                  value={amendReason}
                  onChange={e => setAmendReason(e.target.value)}
                  placeholder="Lý do thay đổi ca / thời gian..."
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setAmendModalOpen(false)}
                disabled={actionLoading}
              >
                Hủy
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleConfirmAmend()}
                disabled={actionLoading || amendReason.trim().length < 3}
              >
                {actionLoading ? 'Đang gửi...' : 'Gửi đề xuất'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
