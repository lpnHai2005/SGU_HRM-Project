import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Icons } from '../components/common/Icons'
import { StatCard } from '../components/common/StatCard'
import { EmptyState } from '../components/common/EmptyState'
import { EmployeeSearchSelect } from '../components/common/EmployeeSearchSelect'
import { formatDate } from '../utils/formatters'
import type { Employee, Lookups, OvertimeReconciliation, OvertimeRequest, OvertimeRequestStatus } from '../types'
import { employeeApi, overtimeReconciliationApi, overtimeRequestApi } from '../services/api'
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

function shiftDate(day: string, amount: number) {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
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

function hasCompleteApprovalContext(
  context: OvertimeRequest['approval_context'] | null | undefined,
): context is NonNullable<OvertimeRequest['approval_context']> {
  return Boolean(
    context
    && Array.isArray(context.related_schedules)
    && Array.isArray(context.conflicts),
  )
}

function matchesRequestQuery(request: OvertimeRequest, value: string) {
  const query = value.trim().toLowerCase()
  if (!query) return true
  return [`OT #${request.request_id}`, String(request.request_id), request.employee_name,
    request.employee_code, request.store_name, request.reason].some(item =>
    String(item || '').toLowerCase().includes(query))
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
  const notificationCaseId = Number(searchParams.get('case_id')) || undefined
  const userRoles: string[] = user?.roles || []
  const isReviewer = userRoles.includes('ADMIN') || userRoles.includes('HR_MANAGER') || userRoles.includes('DIRECTOR')
  const canReviewLifecycle = userRoles.includes('ADMIN') || userRoles.includes('HR_MANAGER')
  const isStoreManager = userRoles.includes('STORE_MANAGER')
  const canManageOvertime = !personal && (isReviewer || isStoreManager)
  const isPersonalView = personal || !canManageOvertime

  const today = todayInVietnam()
  const initialRange = monthRange(today)

  const [dateFrom, setDateFrom] = useState(initialRange.from)
  const [dateTo, setDateTo] = useState(initialRange.to)
  const [draftDateFrom, setDraftDateFrom] = useState(initialRange.from)
  const [draftDateTo, setDraftDateTo] = useState(initialRange.to)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [storeId, setStoreId] = useState<string>('')
  const [draftStoreId, setDraftStoreId] = useState<string>('')
  const [searchTerm, setSearchTerm] = useState('')
  const [activeTab, setActiveTab] = useState<'all' | 'pending_confirm' | 'pending_hr' | 'approved' | 'rejected_cancelled'>('all')
  const [filterVerifiedOnly, setFilterVerifiedOnly] = useState(false)
  const [reconFilterVerified, setReconFilterVerified] = useState(false)

  const [requests, setRequests] = useState<OvertimeRequest[]>([])
  const [reconciliations, setReconciliations] = useState<OvertimeReconciliation[]>([])
  const [reconciliationError, setReconciliationError] = useState('')
  const [workspaceTab, setWorkspaceTab] = useState<'requests' | 'reconciliation' | 'history'>(() =>
    searchParams.get('tab') === 'reconciliation' && canManageOvertime && isReviewer
      ? 'reconciliation'
      : 'requests'
  )
  const [stores, setStores] = useState<Array<{ store_id: number; store_name: string }>>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [selectedRequest, setSelectedRequest] = useState<OvertimeRequest | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<number | null>(null)
  const filterDisclosureRef = useRef<HTMLDetailsElement>(null)

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
  const [rejectType, setRejectType] = useState<'reject' | 'decline' | 'revoke' | 'revoke-reject'>('reject')

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
        // Include the prior local date so an overnight OT interval crossing into the selected period is available for verified-hour allocation.
        date_from: isPersonalView ? shiftDate(dateFrom, -1) : dateFrom,
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

      const [list, reconciliationList] = await Promise.all([
        overtimeRequestApi.list(params),
        overtimeReconciliationApi.list({
          date_from: isPersonalView ? shiftDate(dateFrom, -1) : dateFrom,
          date_to: dateTo,
          ...(storeId && isReviewer ? { store_id: Number(storeId) } : {}),
          limit: 100,
        }).catch(err => {
          setReconciliationError(err?.message || 'Không tải được dữ liệu đối soát OT')
          return null
        }),
      ])
      setRequests(list)
      if (reconciliationList) {
        setReconciliations(reconciliationList)
        setReconciliationError('')
      } else {
        setReconciliations([])
      }
    } catch (err: any) {
      toast.error(err.message || 'Không thể tải danh sách đăng ký OT')
      setRequests([])
      setReconciliations([])
      setReconciliationError(err.message || 'Không tải được dữ liệu đối soát OT')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, isPersonalView, isReviewer, isStoreManager, storeId, user?.employee_id, user?.store_id])

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

  useEffect(() => {
    const closeFilterOnOutsideClick = (event: MouseEvent) => {
      const disclosure = filterDisclosureRef.current
      if (disclosure?.open && event.target instanceof Node && !disclosure.contains(event.target)) {
        disclosure.open = false
      }
    }
    document.addEventListener('click', closeFilterOnOutsideClick)
    return () => document.removeEventListener('click', closeFilterOnOutsideClick)
  }, [])



  const reconciliationByRequest = useMemo(
    () => new Map(reconciliations.map(item => [item.request_id, item])), [reconciliations],
  )

  // Filter requests by activeTab and search
  const filteredRequests = useMemo(() => {
    return requests.filter(req => {
      if (req.work_date < dateFrom || req.work_date > dateTo) return false
      // Tab filter
      if (activeTab === 'pending_confirm' && req.status !== 'PENDING_EMPLOYEE_CONFIRMATION') return false
      if (activeTab === 'pending_hr' && req.status !== 'PENDING_HR') return false
      if (activeTab === 'approved' && req.status !== 'APPROVED') return false
      if (activeTab === 'rejected_cancelled' && !['REJECTED', 'EMPLOYEE_DECLINED', 'CANCELLED', 'REVOKED', 'REPLACED'].includes(req.status)) return false

      // Filter verified only (khi click vào Card "Giờ OT đã xác nhận")
      if (filterVerifiedOnly) {
        const rec = reconciliationByRequest.get(req.request_id)
        if (!rec || rec.effective_status !== 'VERIFIED') return false
      }

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
  }, [requests, activeTab, filterVerifiedOnly, reconciliationByRequest, dateFrom, dateTo, statusFilter, searchTerm])

  // Calculate Stat counts
  const statCounts = useMemo(() => {
    const periodRequests = requests.filter(request => request.work_date >= dateFrom && request.work_date <= dateTo)
    const total = periodRequests.length
    const pendingConfirm = periodRequests.filter(r => r.status === 'PENDING_EMPLOYEE_CONFIRMATION').length
    const pendingHr = periodRequests.filter(r => r.status === 'PENDING_HR').length
    const approved = periodRequests.filter(r => r.status === 'APPROVED').length
    const rejected = periodRequests.filter(r => ['REJECTED', 'EMPLOYEE_DECLINED', 'CANCELLED'].includes(r.status)).length

    const verified = periodRequests.filter(request => {
      const rec = reconciliationByRequest.get(request.request_id)
      return request.status === 'APPROVED' && rec?.effective_status === 'VERIFIED'
        && rec.source_current && rec.payable_microseconds > 0
    }).length
    const pendingReconciliation = periodRequests.filter(request => {
      if (request.status !== 'APPROVED' || (request.revoke_requested_at && !request.revoke_decided_at)) return false
      const rec = reconciliationByRequest.get(request.request_id)
      return !rec || ['PENDING_RECONCILIATION', 'NEEDS_REVIEW'].includes(rec.effective_status)
    }).length

    return { total, pendingConfirm, pendingHr, approved, rejected, verified, pendingReconciliation }
  }, [dateFrom, dateTo, reconciliations, requests])

  const personalVerifiedHours = useMemo(() => {
    if (reconciliationError) return null
    const requestMap = new Map(requests.map(request => [request.request_id, request]))
    const start = new Date(`${dateFrom}T00:00:00+07:00`).getTime()
    const end = new Date(`${dateTo}T23:59:59.999+07:00`).getTime()
    let microseconds = 0
    for (const reconciliation of reconciliations) {
      const request = requestMap.get(reconciliation.request_id)
      if (!request || request.status !== 'APPROVED' || !reconciliation.source_current
          || reconciliation.effective_status !== 'VERIFIED' || !reconciliation.payable_microseconds) continue
      if (request.revoke_requested_at && !request.revoke_decided_at) continue
      if (reconciliation.eligible_intervals && reconciliation.eligible_intervals.length > 0) {
        for (const interval of reconciliation.eligible_intervals) {
          const left = Math.max(start, new Date(interval.starts_at).getTime())
          const right = Math.min(end, new Date(interval.ends_at).getTime())
          if (right > left) microseconds += (right - left) * 1000
        }
      } else {
        microseconds += reconciliation.payable_microseconds
      }
    }
    return microseconds / 3_600_000_000
  }, [dateFrom, dateTo, reconciliationError, reconciliations, requests])


  const reconciliationRows = useMemo(() => {
    let rows = requests.filter(request => request.status === 'APPROVED'
      && request.work_date >= dateFrom && request.work_date <= dateTo
      && matchesRequestQuery(request, searchTerm))
      .map(request => ({ request, reconciliation: reconciliationByRequest.get(request.request_id) }))
    if (reconFilterVerified) {
      rows = rows.filter(({ reconciliation }) => reconciliation?.effective_status === 'VERIFIED')
    } else if (workspaceTab === 'history') {
      rows = rows.filter(({ reconciliation }) => reconciliation
        && ['VERIFIED', 'REJECTED', 'NEEDS_REVIEW'].includes(reconciliation.effective_status))
    }
    return rows
  }, [dateFrom, dateTo, reconciliationByRequest, reconFilterVerified, requests, searchTerm, workspaceTab])

  const historicalRequests = useMemo(() => requests.filter(request =>
    ['APPROVED', 'REJECTED', 'EMPLOYEE_DECLINED', 'CANCELLED', 'REVOKED', 'REPLACED'].includes(request.status)
      && request.work_date >= dateFrom && request.work_date <= dateTo
      && matchesRequestQuery(request, searchTerm)), [dateFrom, dateTo, requests, searchTerm])

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

  const handleApproveAmendment = async (requestId: number) => {
    if (!window.confirm('Duyệt bản OT thay thế và giữ nguyên lịch sử đơn gốc?')) return
    setActionLoading(true)
    try {
      await overtimeRequestApi.approveAmendment(requestId)
      toast.success('Đã duyệt bản OT thay thế; đơn gốc được lưu trong lịch sử.')
      await loadRequests()
      if (selectedRequest?.request_id === requestId) void openDetail(requestId)
    } catch (err: any) {
      toast.error(err.message || 'Duyệt bản OT thay thế thất bại')
    } finally {
      setActionLoading(false)
    }
  }

  const handleApproveRevocation = async (requestId: number) => {
    if (!window.confirm('Xác nhận thu hồi đơn OT? Lịch sử yêu cầu và quyết định sẽ được giữ lại.')) return
    setActionLoading(true)
    try {
      await overtimeRequestApi.approveRevocation(requestId)
      toast.success('Đã duyệt thu hồi đơn OT.')
      await loadRequests()
      if (selectedRequest?.request_id === requestId) void openDetail(requestId)
    } catch (err: any) {
      toast.error(err.message || 'Duyệt thu hồi đơn OT thất bại')
    } finally {
      setActionLoading(false)
    }
  }

  const handleOpenReject = (requestId: number, type: 'reject' | 'decline' | 'revoke' | 'revoke-reject') => {
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
      } else if (rejectType === 'revoke-reject') {
        await overtimeRequestApi.rejectRevocation(rejectTargetId, rejectReason.trim())
        toast.success('Đã từ chối yêu cầu thu hồi; đơn OT gốc vẫn có hiệu lực.')
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

  const hasCustomDateRange = dateFrom !== initialRange.from || dateTo !== initialRange.to
  const activeAdvancedFilterCount = Number(hasCustomDateRange) + Number(Boolean(storeId))
  const hasActiveFilters = hasCustomDateRange || Boolean(storeId) || Boolean(searchTerm.trim())
    || (workspaceTab === 'requests' && (activeTab !== 'all' || filterVerifiedOnly))
    || (workspaceTab === 'reconciliation' && reconFilterVerified)
  const clearAdvancedFilters = () => {
    setDateFrom(initialRange.from)
    setDateTo(initialRange.to)
    setStoreId('')
    setDraftDateFrom(initialRange.from)
    setDraftDateTo(initialRange.to)
    setDraftStoreId('')
    if (filterDisclosureRef.current) filterDisclosureRef.current.open = false
  }
  const applyAdvancedFilters = () => {
    if (draftDateFrom && draftDateTo && draftDateFrom > draftDateTo) return
    setDateFrom(draftDateFrom)
    setDateTo(draftDateTo)
    setStoreId(draftStoreId)
    if (filterDisclosureRef.current) filterDisclosureRef.current.open = false
  }
  const resetAllFilters = () => {
    clearAdvancedFilters()
    setSearchTerm('')
    setActiveTab('all')
    setStatusFilter('all')
    setFilterVerifiedOnly(false)
    setReconFilterVerified(false)
  }
  const statusTabLabels: Record<typeof activeTab, string> = {
    all: 'Tất cả',
    pending_confirm: isPersonalView ? 'Chờ bạn xác nhận' : 'Chờ NV C1',
    pending_hr: 'Chờ HR C2',
    approved: 'Đã duyệt',
    rejected_cancelled: 'Từ chối/Hủy',
  }
  const selectedStoreName = stores.find(store => String(store.store_id) === storeId)?.store_name || 'Cửa hàng đã chọn'

  return (
    <div className="page-container overtime-page">
      {/* Page Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 className="page-title">{isPersonalView ? 'Đơn OT của tôi' : isReviewer ? 'Quản lý Đăng ký & Đối soát OT' : 'Quản lý Đăng ký OT'}</h1>
          <p style={{ color: 'var(--text-secondary, #6b7280)', fontSize: '0.9rem', marginTop: '4px' }}>
            {isPersonalView
              ? 'Theo dõi danh sách đăng ký tăng ca, xác nhận lịch OT và đối soát bảng lương cá nhân'
              : isReviewer
                ? 'Quản lý đăng ký tăng ca, phê duyệt kế hoạch và xác nhận giờ làm thêm thực tế.'
                : 'Theo dõi và đề xuất đăng ký tăng ca cho nhân viên thuộc chi nhánh.'}
          </p>
        </div>
        <div className="overtime-page-header-actions">
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
      <div className="stat-grid-4 kpi-hover-grid">
        {isPersonalView ? (
          <>
            <StatCard
              icon={Icons.clock}
              iconColor="blue"
              label="Giờ OT đã xác nhận (kỳ này)"
              value={personalVerifiedHours === null ? 'Chưa xác minh' : `${personalVerifiedHours.toFixed(2)} giờ`}
              footerNote={personalVerifiedHours !== null && personalVerifiedHours > 0 ? `Quy đổi: ${Math.round(personalVerifiedHours * 60)} phút` : undefined}
              active={workspaceTab === 'requests' && filterVerifiedOnly}
              onClick={() => {
                setWorkspaceTab('requests')
                setActiveTab('approved')
                setFilterVerifiedOnly(prev => !prev)
              }}
            />
            <StatCard
              icon={Icons.alertCircle}
              iconColor="amber"
              label="Chờ bạn xác nhận (Cấp 1)"
              value={`${statCounts.pendingConfirm} đơn`}
              active={workspaceTab === 'requests' && activeTab === 'pending_confirm' && !filterVerifiedOnly}
              onClick={() => {
                setWorkspaceTab('requests')
                setFilterVerifiedOnly(false)
                setActiveTab(prev => (prev === 'pending_confirm' ? 'all' : 'pending_confirm'))
              }}
            />
            <StatCard
              icon={Icons.shield}
              iconColor="blue"
              label="Chờ HR duyệt (Cấp 2)"
              value={`${statCounts.pendingHr} đơn`}
              active={workspaceTab === 'requests' && activeTab === 'pending_hr' && !filterVerifiedOnly}
              onClick={() => {
                setWorkspaceTab('requests')
                setFilterVerifiedOnly(false)
                setActiveTab(prev => (prev === 'pending_hr' ? 'all' : 'pending_hr'))
              }}
            />
            <StatCard
              icon={Icons.checkCircle}
              iconColor="green"
              label="Đơn OT đã duyệt"
              value={`${statCounts.approved} đơn`}
              active={workspaceTab === 'requests' && activeTab === 'approved' && !filterVerifiedOnly}
              onClick={() => {
                setWorkspaceTab('requests')
                setFilterVerifiedOnly(false)
                setActiveTab(prev => (prev === 'approved' ? 'all' : 'approved'))
              }}
            />
          </>
        ) : (
          <>
            <StatCard
              icon={Icons.clipboardList}
              iconColor="blue"
              label="Tổng đơn đăng ký OT"
              value={`${statCounts.total} đơn`}
              active={workspaceTab === 'requests' && activeTab === 'all' && !filterVerifiedOnly}
              onClick={() => {
                setWorkspaceTab('requests')
                setActiveTab('all')
                setFilterVerifiedOnly(false)
                setReconFilterVerified(false)
              }}
            />
            <StatCard
              icon={Icons.users}
              iconColor="amber"
              label="Chờ NV xác nhận (Cấp 1)"
              value={`${statCounts.pendingConfirm} đơn`}
              active={workspaceTab === 'requests' && activeTab === 'pending_confirm'}
              onClick={() => {
                setWorkspaceTab('requests')
                setFilterVerifiedOnly(false)
                setReconFilterVerified(false)
                setActiveTab(prev => (prev === 'pending_confirm' ? 'all' : 'pending_confirm'))
              }}
            />
            <StatCard
              icon={Icons.shield}
              iconColor="blue"
              label="Chờ HR duyệt (Cấp 2)"
              value={`${statCounts.pendingHr} đơn`}
              active={workspaceTab === 'requests' && activeTab === 'pending_hr'}
              onClick={() => {
                setWorkspaceTab('requests')
                setFilterVerifiedOnly(false)
                setReconFilterVerified(false)
                setActiveTab(prev => (prev === 'pending_hr' ? 'all' : 'pending_hr'))
              }}
            />
            <StatCard
              icon={Icons.checkCircle}
              iconColor="green"
              label="Đã VERIFIED"
              value={reconciliationError ? 'Chưa xác minh' : `${statCounts.verified} đơn`}
              active={(workspaceTab === 'reconciliation' && reconFilterVerified) || (workspaceTab === 'requests' && filterVerifiedOnly)}
              onClick={() => {
                if (isReviewer) {
                  setWorkspaceTab('reconciliation')
                  setReconFilterVerified(prev => !prev)
                } else {
                  setWorkspaceTab('requests')
                  setActiveTab('approved')
                  setFilterVerifiedOnly(prev => !prev)
                }
              }}
            />
          </>
        )}
      </div>

      <div className="card overtime-management-card">
        <div className="card-header overtime-management-card-header">
        {canManageOvertime && <nav className="overtime-workspace-tabs" aria-label="Khu vực quản lý OT">
          <button type="button" className={workspaceTab === 'requests' ? 'active' : ''}
            onClick={() => setWorkspaceTab('requests')}>Đăng ký &amp; Phê duyệt OT</button>
          {isReviewer && <button type="button" className={workspaceTab === 'reconciliation' ? 'active' : ''}
            onClick={() => setWorkspaceTab('reconciliation')}>Đối soát OT <span>{statCounts.pendingReconciliation}</span></button>}
          <button type="button" className={workspaceTab === 'history' ? 'active' : ''}
            onClick={() => setWorkspaceTab('history')}>Lịch sử OT</button>
        </nav>}

        <section className="overtime-filter-toolbar" aria-label="Tìm kiếm và bộ lọc OT">
          <label className="overtime-query-control">
            <span className="overtime-query-field">
              {Icons.search}
              <input
                type="text"
                className="form-input"
                value={searchTerm}
                onChange={event => setSearchTerm(event.target.value)}
                placeholder="Nhân viên, mã OT, cửa hàng hoặc lý do"
                aria-label="Tìm nhân viên, mã OT, cửa hàng hoặc lý do"
              />
              {searchTerm && <button type="button" onClick={() => setSearchTerm('')} aria-label="Xóa từ khóa tìm kiếm" title="Xóa từ khóa tìm kiếm">{Icons.close}</button>}
            </span>
          </label>
          <div className="overtime-toolbar-actions">
            <details ref={filterDisclosureRef} className="overtime-filter-disclosure" onKeyDown={event => {
              if (event.key === 'Escape') {
                event.currentTarget.open = false
                event.currentTarget.querySelector('summary')?.focus()
              }
            }}>
              <summary aria-controls="overtime-advanced-filter-panel" onClick={() => {
                setDraftDateFrom(dateFrom)
                setDraftDateTo(dateTo)
                setDraftStoreId(storeId)
              }}>
                {Icons.filter}<span>Bộ lọc</span>
                <span className="overtime-filter-count" aria-label={`${activeAdvancedFilterCount} bộ lọc nâng cao đang áp dụng`}>{activeAdvancedFilterCount}</span>
              </summary>
              <div className="overtime-filter-popover" id="overtime-advanced-filter-panel" role="dialog" aria-label="Bộ lọc nâng cao">
                <div className="overtime-filter-popover-heading">
                  <div><strong>Bộ lọc nâng cao</strong><small>Mặc định theo tháng hiện tại; phạm vi cửa hàng tuân theo quyền tài khoản.</small></div>
                </div>
                <div className={`overtime-filter-fields ${!isPersonalView && isReviewer && stores.length > 0 ? 'has-store-filter' : ''}`}>
                  <label><span>Từ ngày</span><input type="date" className="form-input" value={draftDateFrom} max={draftDateTo || undefined} onChange={event => setDraftDateFrom(event.target.value)} /></label>
                  <label><span>Đến ngày</span><input type="date" className="form-input" value={draftDateTo} min={draftDateFrom || undefined} onChange={event => setDraftDateTo(event.target.value)} /></label>
                  {!isPersonalView && isReviewer && stores.length > 0 && <label className="overtime-store-filter"><span>Cửa hàng</span><select className="form-select" value={draftStoreId} onChange={event => setDraftStoreId(event.target.value)}><option value="">Tất cả cửa hàng</option>{stores.map(store => <option key={store.store_id} value={String(store.store_id)}>{store.store_name}</option>)}</select></label>}
                </div>
                <div className="overtime-filter-popover-footer">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={clearAdvancedFilters} disabled={!hasCustomDateRange && !storeId && draftDateFrom === initialRange.from && draftDateTo === initialRange.to && !draftStoreId}>Xóa bộ lọc</button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={applyAdvancedFilters} disabled={Boolean(draftDateFrom && draftDateTo && draftDateFrom > draftDateTo)}>Áp dụng</button>
                </div>
              </div>
            </details>
            <button type="button" className="btn btn-secondary overtime-toolbar-refresh" onClick={() => void loadRequests()} disabled={loading} title="Tải lại danh sách">{Icons.refresh}<span>Làm mới</span></button>
          </div>
        </section>

        {hasActiveFilters && <div className="overtime-active-filters" aria-label="Bộ lọc đang áp dụng">
          {searchTerm.trim() && <span className="overtime-filter-chip"><span>Từ khóa: {searchTerm.trim()}</span><button type="button" aria-label="Xóa từ khóa tìm kiếm" onClick={() => setSearchTerm('')}>{Icons.close}</button></span>}
          {hasCustomDateRange && <span className="overtime-filter-chip"><span>Thời gian: {dateFrom ? displayDate(dateFrom) : '—'} – {dateTo ? displayDate(dateTo) : '—'}</span><button type="button" aria-label="Đặt lại khoảng ngày" onClick={() => { setDateFrom(initialRange.from); setDateTo(initialRange.to) }}>{Icons.close}</button></span>}
          {storeId && <span className="overtime-filter-chip"><span>Cửa hàng: {selectedStoreName}</span><button type="button" aria-label="Xóa bộ lọc cửa hàng" onClick={() => setStoreId('')}>{Icons.close}</button></span>}
          {workspaceTab === 'requests' && activeTab !== 'all' && <span className="overtime-filter-chip"><span>Trạng thái: {statusTabLabels[activeTab]}</span><button type="button" aria-label="Xóa bộ lọc trạng thái" onClick={() => { setActiveTab('all'); setFilterVerifiedOnly(false) }}>{Icons.close}</button></span>}
          {filterVerifiedOnly && <span className="overtime-filter-chip"><span>Lọc: Đã VERIFIED</span><button type="button" aria-label="Xóa bộ lọc đã xác minh" onClick={() => setFilterVerifiedOnly(false)}>{Icons.close}</button></span>}
          {reconFilterVerified && <span className="overtime-filter-chip"><span>Lọc: Đã VERIFIED</span><button type="button" aria-label="Xóa bộ lọc đã VERIFIED" onClick={() => setReconFilterVerified(false)}>{Icons.close}</button></span>}
          <button type="button" className="overtime-reset-all" onClick={resetAllFilters}>Đặt lại tất cả</button>
        </div>}
        </div>

      {/* Main Card */}
      {workspaceTab === 'requests' && <div className="overtime-request-card">
        <div className="overtime-request-filter-section">
          <nav className="overtime-status-tabs" aria-label="Lọc đơn theo trạng thái">
            <button
              type="button"
              className={`leave-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
              onClick={() => { setActiveTab('all'); setFilterVerifiedOnly(false) }}
              aria-pressed={activeTab === 'all'}
            >
              <span>Tất cả</span>
              <span className="leave-tab-badge">{statCounts.total}</span>
            </button>
            <button
              type="button"
              className={`leave-tab-btn ${activeTab === 'pending_confirm' ? 'active' : ''}`}
              onClick={() => { setActiveTab('pending_confirm'); setFilterVerifiedOnly(false) }}
              aria-pressed={activeTab === 'pending_confirm'}
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
              onClick={() => { setActiveTab('pending_hr'); setFilterVerifiedOnly(false) }}
              aria-pressed={activeTab === 'pending_hr'}
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
              onClick={() => { setActiveTab('approved'); setFilterVerifiedOnly(false) }}
              aria-pressed={activeTab === 'approved'}
            >
              <span>Đã duyệt</span>
              <span className="leave-tab-badge">{statCounts.approved}</span>
            </button>
            <button
              type="button"
              className={`leave-tab-btn ${activeTab === 'rejected_cancelled' ? 'active' : ''}`}
              onClick={() => { setActiveTab('rejected_cancelled'); setFilterVerifiedOnly(false) }}
              aria-pressed={activeTab === 'rejected_cancelled'}
            >
              <span>Từ chối / Hủy</span>
              <span className="leave-tab-badge">{statCounts.rejected}</span>
            </button>
          </nav>
          <label className="overtime-status-mobile"><span>Trạng thái đơn</span><select className="form-select" value={activeTab} onChange={event => setActiveTab(event.target.value as typeof activeTab)} aria-label="Lọc đơn theo trạng thái">
            {Object.entries(statusTabLabels).map(([value, label]) => <option key={value} value={value}>{label} ({value === 'all' ? statCounts.total : value === 'pending_confirm' ? statCounts.pendingConfirm : value === 'pending_hr' ? statCounts.pendingHr : value === 'approved' ? statCounts.approved : statCounts.rejected})</option>)}
          </select></label>
        </div>

        {/* Table Section */}
        {loading ? (
          <div className="card-body" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
            Đang tải danh sách đơn đăng ký tăng ca...
          </div>
        ) : (
          <div className="table-container overtime-request-table-wrap" style={{ minHeight: '320px' }}>
            <table className="data-table overtime-request-table">
              <thead>
                <tr>
                  <th>MÃ ĐƠN</th>
                  <th>NHÂN VIÊN</th>
                  <th>NGƯỜI ĐĂNG KÝ</th>
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
                      <td data-label="Mã đơn">
                        <span className="table-cell-mono font-bold" style={{ cursor: 'pointer', color: 'var(--primary-color, #2563eb)' }}>
                          #{req.request_id}
                        </span>
                        {req.created_at && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {formatDate(req.created_at)}
                          </div>
                        )}
                      </td>
                      <td data-label="Nhân viên">
                        <div>
                          <div style={{ fontWeight: 600 }}>{req.employee_name || `Nhân viên #${req.employee_id}`}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)' }}>
                            {req.employee_code || ''} {req.store_name ? `• ${req.store_name}` : ''}
                          </div>
                        </div>
                      </td>
                      <td data-label="Người đăng ký">{req.creator_username || `User #${req.created_by}`}</td>
                      <td data-label="Ngày tăng ca">
                        <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                          {displayDate(req.work_date)}
                        </span>
                      </td>
                      <td data-label="Khung giờ">
                        <span className="table-cell-mono" style={{ fontSize: '0.85rem' }}>
                          {timeOnly(req.starts_at)} → {timeOnly(req.ends_at)}
                        </span>
                      </td>
                      <td data-label="Tổng giờ">
                        <strong style={{ color: 'var(--text-primary)' }}>{hours} giờ</strong>
                      </td>
                      <td data-label="Lý do"
                        style={{ maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                        title={req.reason}
                      >
                        <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                          {req.reason}
                        </span>
                      </td>
                      <td data-label="Trạng thái">
                        <span className={`status-pill ${getStatusBadgeClass(req.status)}`}>
                          {overtimeStatusLabel(req.status)}
                        </span>
                        {req.is_overdue && (
                          <span className="overtime-overdue-badge" style={{ marginLeft: '4px' }}>Quá hạn</span>
                        )}
                      </td>
                      <td data-label="Cấp 1 (CHT / NV)">
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
                      <td data-label="Cấp 2 (HR duyệt)">
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
                      <td data-label="Thao tác" style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center', position: 'relative' }}>
                          {/* Nút 1: Xem chi tiết (Mắt) */}
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm btn-icon"
                            title="Xem chi tiết đơn"
                            aria-label={`Xem chi tiết đơn OT ${req.request_id}`}
                            onClick={() => void openDetail(req.request_id)}
                          >
                            {Icons.eye}
                          </button>

                          {/* Nút 2: Tùy chọn thao tác (Dấu 3 chấm) */}
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm btn-icon"
                            title={hasAnyAction ? "Tùy chọn thao tác" : "Không có thao tác khác"}
                            aria-label={`Tùy chọn thao tác đơn OT ${req.request_id}`}
                            aria-expanded={openMenuId === req.request_id}
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
                              role="menu"
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
                    <td colSpan={11} style={{ padding: '40px 20px' }}>
                      <EmptyState
                        icon={Icons.clock}
                        title="Không tìm thấy đơn đăng ký OT nào"
                        description="Không có đơn tăng ca nào phù hợp với bộ lọc tìm kiếm hiện tại."
                      />
                      <div className="overtime-empty-actions"><button type="button" className="btn btn-secondary btn-sm" onClick={resetAllFilters}>Đặt lại bộ lọc</button></div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>}

      {workspaceTab === 'reconciliation' && isReviewer && <section className="overtime-workspace-card" aria-label="Danh sách đối soát OT">
        <header className="overtime-workspace-card-header">
          <div><h2>Đối soát OT</h2><p>Chỉ các đơn đã APPROVED được đưa vào đối soát. VERIFIED là giờ đã HR xác nhận, chưa đồng nghĩa đã thanh toán.</p></div>
          <span className="overtime-workspace-count">{reconciliationRows.length} đơn</span>
        </header>
        {reconciliationError ? <div className="overtime-workspace-error" role="alert">{reconciliationError} <button className="btn btn-secondary btn-sm" onClick={() => void loadRequests()}>Thử lại</button></div>
          : loading ? <div className="overtime-workspace-empty" role="status">Đang tải dữ liệu đối soát…</div>
            : reconciliationRows.length === 0 ? <div className="overtime-workspace-empty">Không có đơn OT đã duyệt trong kỳ lọc.<button type="button" className="btn btn-secondary btn-sm" onClick={resetAllFilters}>Đặt lại bộ lọc</button></div>
              : <div className="table-container overtime-workspace-table-wrap"><table className="data-table overtime-workspace-table">
                <thead><tr><th>Mã đơn</th><th>Nhân viên / Cửa hàng</th><th>Ngày OT</th><th>Khung OT duyệt</th><th>Giờ duyệt</th><th>Attendance</th><th>Giờ OT đề xuất</th><th>Chênh lệch</th><th>Trạng thái</th><th>Chi tiết</th></tr></thead>
                <tbody>{reconciliationRows.map(({ request, reconciliation }) => {
                  const proposed = reconciliation?.proposed_microseconds || 0
                  const approved = durationHours(request)
                  const proposedHours = proposed / 3_600_000_000
                  const difference = proposedHours - approved
                  const statusValue = reconciliation?.display_status || reconciliation?.effective_status || 'PENDING_RECONCILIATION'
                  const executionValue = reconciliation?.execution_status
                  const executionLabel = executionValue === 'NOT_STARTED' ? 'Chưa đến giờ OT'
                    : executionValue === 'IN_PROGRESS' ? 'Đang thực hiện OT'
                      : executionValue === 'ATTENDANCE_INCOMPLETE' ? 'Attendance chưa hoàn tất'
                        : executionValue === 'ENDED' ? 'Đã kết thúc' : ''
                  const attendanceLabel = reconciliationError ? 'Chưa xác minh'
                    : reconciliation?.attendance_ids?.length ? `${reconciliation.attendance_ids.length} phiên liên quan`
                      : reconciliation ? 'Chưa có phiên phù hợp' : 'Chưa chạy preview'
                  return <tr key={request.request_id}>
                    <td data-label="Mã đơn"><button type="button" className="overtime-request-link" onClick={() => void openDetail(request.request_id)}>OT #{request.request_id}</button></td>
                    <td data-label="Nhân viên / Cửa hàng"><strong>{request.employee_name || `Nhân viên #${request.employee_id}`}</strong><small>{request.employee_code || ''}{request.store_name ? ` · ${request.store_name}` : ''}</small></td>
                    <td data-label="Ngày OT">{displayDate(request.work_date)}</td><td data-label="Khung OT duyệt">{timeOnly(request.starts_at)}–{timeOnly(request.ends_at)}</td>
                    <td data-label="Giờ duyệt">{approved.toFixed(1)} giờ</td><td data-label="Attendance">{attendanceLabel}</td><td data-label="Giờ OT đề xuất">{reconciliation ? `${proposedHours.toFixed(1)} giờ` : 'Chưa có'}</td>
                    <td data-label="Chênh lệch">{reconciliation ? `${difference > 0 ? '+' : ''}${difference.toFixed(1)} giờ` : '—'}</td>
                    <td data-label="Trạng thái"><span className={`overtime-reconciliation-chip is-${statusValue.toLowerCase()}`}>{statusValue === 'PENDING_RECONCILIATION' ? 'Chờ đối soát' : statusValue === 'NEEDS_REVIEW' ? (reconciliation?.source_current ? 'Cần rà soát' : 'Nguồn đã đổi · stale') : statusValue === 'VERIFIED' ? 'VERIFIED' : 'Đã từ chối'}</span>{executionLabel && executionValue !== 'ENDED' && <small className="overtime-reconciliation-execution-label">{executionLabel}</small>}</td>
                    <td data-label="Chi tiết"><button type="button" className="btn btn-secondary btn-sm" onClick={() => void openDetail(request.request_id)}>Xem chi tiết</button></td>
                  </tr>
                })}</tbody>
              </table></div>}
        <footer className="overtime-reconciliation-list-note">Attendance chi tiết, lịch sử phiên bản, Preview, Verify và Reject được mở trong Drawer của từng đơn theo quyền backend.</footer>
      </section>}

      {workspaceTab === 'history' && canManageOvertime && <section className="overtime-workspace-card" aria-label="Lịch sử OT">
        <header className="overtime-workspace-card-header"><div><h2>Lịch sử OT</h2><p>Tra cứu quyết định đơn, thu hồi, điều chỉnh và kết quả đối soát trong phạm vi được cấp.</p></div><span className="overtime-workspace-count">{historicalRequests.length} đơn</span></header>
        {loading ? <div className="overtime-workspace-empty" role="status">Đang tải lịch sử…</div>
          : <div className="table-container overtime-workspace-table-wrap"><table className="data-table overtime-workspace-table"><thead><tr><th>Mã đơn</th><th>Nhân viên</th><th>Ngày OT</th><th>Người đăng ký</th><th>HR duyệt</th><th>Đối soát</th><th>Cập nhật</th><th>Chi tiết</th></tr></thead><tbody>
            {historicalRequests.map(request => {
              const reconciliation = reconciliationByRequest.get(request.request_id)
              return <tr key={request.request_id}><td data-label="Mã đơn">OT #{request.request_id}</td><td data-label="Nhân viên"><strong>{request.employee_name || `Nhân viên #${request.employee_id}`}</strong><small>{request.employee_code || ''}</small></td><td data-label="Ngày OT">{displayDate(request.work_date)}</td><td data-label="Người đăng ký">{request.creator_username || `User #${request.created_by}`}</td><td data-label="HR duyệt">{request.reviewer_username || '—'}</td><td data-label="Đối soát">{reconciliation?.effective_status || (request.status === 'APPROVED' ? 'Chưa đối soát' : 'Không áp dụng')}</td><td data-label="Cập nhật">{request.updated_at ? formatDate(request.updated_at) : '—'}</td><td data-label="Chi tiết"><button type="button" className="btn btn-secondary btn-sm" onClick={() => void openDetail(request.request_id)}>Timeline</button></td></tr>
            })}
            {historicalRequests.length === 0 && <tr><td colSpan={8}><EmptyState icon={Icons.clock} title="Chưa có lịch sử OT" description="Không có đơn nào phù hợp với các bộ lọc hiện tại." /><div className="overtime-empty-actions"><button type="button" className="btn btn-secondary btn-sm" onClick={resetAllFilters}>Đặt lại bộ lọc</button></div></td></tr>}
          </tbody></table></div>}
      </section>}
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
          <aside
            className="overtime-detail-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`overtime-detail-title-${selectedRequest.request_id}`}
          >
            <header className="overtime-drawer-header">
              <div>
                <span className="overtime-drawer-eyebrow">HỒ SƠ ĐĂNG KÝ TĂNG CA</span>
                <h2
                  id={`overtime-detail-title-${selectedRequest.request_id}`}
                  style={{ margin: '4px 0 0 0', fontSize: '1.25rem' }}
                >
                  Đơn OT #{selectedRequest.request_id}
                </h2>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-icon"
                aria-label="Đóng chi tiết"
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

              {hasCompleteApprovalContext(selectedRequest.approval_context) ? (
                selectedRequest.approval_context.conflicts.length > 0 ? (
                  <section className="overtime-conflict-warning" role="alert" aria-live="polite">
                    <strong>Có xung đột cần rà soát</strong>
                    <ul className="overtime-request-conflict-list">
                      {selectedRequest.approval_context.conflicts.map((conflict, index) => {
                        const schedule = conflict.schedule_id
                          ? selectedRequest.approval_context?.related_schedules.find(
                            item => item.schedule_id === conflict.schedule_id,
                          )
                          : undefined
                        const reference = schedule
                          ? `Ca ${schedule.shift_name} · ${displayDate(schedule.work_date)} · ${timeOnly(schedule.starts_at)}–${timeOnly(schedule.ends_at)}`
                          : conflict.request_id
                            ? `Đơn OT #${conflict.request_id}`
                            : conflict.leave_request_id
                              ? `Đơn nghỉ #${conflict.leave_request_id}`
                              : null

                        return (
                          <li key={`${conflict.code}-${conflict.schedule_id || conflict.request_id || conflict.leave_request_id || index}`}>
                            <span>{conflict.message}</span>
                            {reference && <small>{reference}</small>}
                          </li>
                        )
                      })}
                    </ul>
                    <p>Đây là kết quả kiểm tra tại thời điểm mở hồ sơ. Máy chủ sẽ kiểm tra lại xung đột ngay trước khi phê duyệt.</p>
                  </section>
                ) : (
                  <div className="overtime-no-conflict" role="status">
                    Chưa phát hiện xung đột lịch, đơn OT hoặc nghỉ phép liên quan. Máy chủ vẫn kiểm tra lại trước khi phê duyệt.
                  </div>
                )
              ) : (
                <div className="overtime-conflict-warning" role="alert">
                  <strong>Chưa tải được kết quả kiểm tra xung đột</strong>
                  <p>Hãy tải lại hồ sơ trước khi quyết định. Máy chủ vẫn thực hiện kiểm tra độc lập khi phê duyệt.</p>
                </div>
              )}

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
                    <OvertimeReconciliationSection key={selectedRequest.request_id} request={selectedRequest} user={user} highlightCaseId={notificationCaseId} />
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
                    onClick={() => void (selectedRequest.request_type === 'AMENDMENT'
                      ? handleApproveAmendment(selectedRequest.request_id)
                      : handleApproveOT(selectedRequest.request_id))}
                    disabled={actionLoading}
                  >
                    {selectedRequest.request_type === 'AMENDMENT' ? 'Duyệt bản OT thay thế' : 'Phê duyệt OT (HR)'}
                  </button>
                </>
              )}

              {/* Hủy đơn nếu còn đang chờ */}
              {canReviewLifecycle && selectedRequest.status === 'APPROVED'
                && selectedRequest.revoke_requested_at && !selectedRequest.revoke_decided_at
                && selectedRequest.revoke_requested_by !== user?.user_id
                && selectedRequest.created_by !== user?.user_id
                && Number(selectedRequest.employee_id) !== Number(user?.employee_id) && (
                <div style={{ flexBasis: '100%', padding: '12px 14px', border: '1px solid var(--border-default)', borderRadius: '10px', background: 'var(--surface-subtle)' }}>
                  <p style={{ margin: '0 0 10px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                    Đang chờ xử lý yêu cầu thu hồi của {selectedRequest.creator_username || 'người tạo'}:
                    {' '}{selectedRequest.revoke_reason || 'Không có nội dung'}
                  </p>
                  {selectedRequest.lifecycle?.attendance_linked && (
                    <p role="status" style={{ margin: '0 0 10px', color: 'var(--status-warning)', fontSize: '12px' }}>
                      Đã phát sinh Attendance. Backend yêu cầu xử lý ngoại lệ trước khi duyệt thu hồi trực tiếp.
                    </p>
                  )}
                  {!selectedRequest.lifecycle?.attendance_linked && (
                    <button type="button" className="btn btn-danger" onClick={() => void handleApproveRevocation(selectedRequest.request_id)} disabled={actionLoading}>
                      Duyệt thu hồi OT
                    </button>
                  )}
                  <button type="button" className="btn btn-secondary" onClick={() => handleOpenReject(selectedRequest.request_id, 'revoke-reject')} disabled={actionLoading}>
                    Từ chối yêu cầu thu hồi
                  </button>
                </div>
              )}

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
            zIndex: 1300,
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
                  : rejectType === 'revoke-reject'
                    ? 'T\u1eeb ch\u1ed1i y\u00eau c\u1ea7u thu h\u1ed3i OT'
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
            zIndex: 1300,
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
