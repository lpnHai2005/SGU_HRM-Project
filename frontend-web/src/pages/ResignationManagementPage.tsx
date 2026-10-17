/**
 * Resignation Management Page
 * Module quản lý đơn xin thôi việc của nhân viên dành cho HR/Admin
 * Chuẩn UI/UX theo Vero Design System (Linear / Attio minimalist, dual theme)
 * Đồng bộ cấu trúc bảng và menu thao tác Portal với ContractManagementPage & EmployeeListPage
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Icons } from '../components/common/Icons'
import { StatCard } from '../components/common/StatCard'
import { EmptyState } from '../components/common/EmptyState'
import { ResignationCreateDialog } from '../components/ResignationCreateDialog'
import { ResignationDetailDialog } from '../components/ResignationDetailDialog'
import {
  ResignationApproveDialog,
  ResignationRejectDialog,
  ResignationCancelDialog,
} from '../components/ResignationActionDialogs'
import { resignationApi } from '../services/resignationService'
import { contractApi } from '../services/contractService'
import { default as api } from '../services/api'
import { formatDate, getInitials } from '../utils/formatters'
import {
  type Resignation,
  type ResignationStats,
  RESIGNATION_STATUS_LABELS,
  RESIGNATION_STATUS_BADGE,
} from '../types/resignation'
import { getContractTypeLabel } from '../types/contract'
import { toast } from 'sonner'

export interface ResignationManagementPageProps {
  user: any
}

interface MenuPosition {
  top?: number
  bottom?: number
  right: number
}

export function ResignationManagementPage({ user }: ResignationManagementPageProps) {
  const navigate = useNavigate()

  // State
  const [resignations, setResignations] = useState<Resignation[]>([])
  const [stats, setStats] = useState<ResignationStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [totalPages, setTotalPages] = useState(0)

  // Floating Action Menu state (Portal-based)
  const [openMenuId, setOpenMenuId] = useState<number | null>(null)
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null)

  // Sync state
  const [syncingStatuses, setSyncingStatuses] = useState(false)

  // Employees list for create dialog
  const [employees, setEmployees] = useState<any[]>([])

  // Filters
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [showApproveModal, setShowApproveModal] = useState(false)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [selectedResignation, setSelectedResignation] = useState<Resignation | null>(null)

  // RBAC
  const userRoles = useMemo(() => user?.roles || [], [user])
  const canManage = useMemo(() => {
    return userRoles.includes('ADMIN') || userRoles.includes('HR_MANAGER') || userRoles.includes('DIRECTOR')
  }, [userRoles])

  // Helper kiểm tra đơn thôi việc của HR/Admin (cần Giám đốc duyệt)
  const isApplicantHrOrAdmin = useCallback((item: Resignation) => {
    return Boolean(
      item.is_hr_or_admin_request ?? (
        item.department_name === 'Phòng Nhân sự' ||
        item.position_name === 'Trưởng phòng Nhân sự' ||
        item.position_name === 'Quản trị viên' ||
        item.position_name === 'Giám đốc'
      )
    )
  }, [])

  // Phê duyệt đơn thôi việc (Tuân thủ nguyên tắc No Self-Approval)
  const canApproveResignation = useCallback((item: Resignation | null) => {
    if (!item || item.status !== 'PENDING') return false
    const isOwner = Boolean(user?.employee_id && item.employee_id === user.employee_id)
    if (isOwner) return false // No self-approval: tuyệt đối không tự duyệt đơn của chính mình

    const isHrOrAdmin = isApplicantHrOrAdmin(item)
    const isDirector = userRoles.includes('DIRECTOR')
    const isHrManager = userRoles.includes('HR_MANAGER')
    const isAdmin = userRoles.includes('ADMIN')

    if (isHrOrAdmin) {
      // Đơn của HR/Admin BẮT BUỘC do Giám đốc duyệt
      return isDirector
    }
    // Đơn của nhân viên/CHT do HR hoặc Admin duyệt
    return isHrManager || isAdmin
  }, [user?.employee_id, userRoles, isApplicantHrOrAdmin])

  // Từ chối đơn thôi việc (Tuân thủ nguyên tắc No Self-Approval)
  const canRejectResignation = useCallback((item: Resignation | null) => {
    if (!item || item.status !== 'PENDING') return false
    const isOwner = Boolean(user?.employee_id && item.employee_id === user.employee_id)
    if (isOwner) return false // No self-rejection (nhân viên dùng tính năng hủy đơn)

    const isHrOrAdmin = isApplicantHrOrAdmin(item)
    const isDirector = userRoles.includes('DIRECTOR')
    const isHrManager = userRoles.includes('HR_MANAGER')
    const isAdmin = userRoles.includes('ADMIN')

    if (isHrOrAdmin) {
      return isDirector
    }
    return isHrManager || isAdmin
  }, [user?.employee_id, userRoles, isApplicantHrOrAdmin])

  // Hủy đơn (người nộp hoặc người tạo trước khi được duyệt)
  const canCancelResignation = useCallback((item: Resignation | null) => {
    if (!item || item.status !== 'PENDING') return false
    const isOwner = Boolean(user?.employee_id && item.employee_id === user.employee_id)
    const isCreator = Boolean(user?.user_id && item.created_by === user.user_id)
    const isAdmin = userRoles.includes('ADMIN')
    return isOwner || isCreator || isAdmin
  }, [user?.employee_id, user?.user_id, userRoles])

  // Close floating action menu on outside click or scroll
  useEffect(() => {
    const handleCloseMenu = () => {
      setOpenMenuId(null)
      setMenuPos(null)
    }
    window.addEventListener('click', handleCloseMenu)
    window.addEventListener('scroll', handleCloseMenu, true)
    return () => {
      window.removeEventListener('click', handleCloseMenu)
      window.removeEventListener('scroll', handleCloseMenu, true)
    }
  }, [])

  // Load employees for create modal
  useEffect(() => {
    api
      .get<any>('/employees', { page_size: 200, employment_status: 'ACTIVE' })
      .then((res) => {
        const list = Array.isArray(res) ? res : res.data || []
        setEmployees(list)
      })
      .catch(console.error)
  }, [])

  // Fetch resignations list
  const fetchResignations = useCallback(async () => {
    setLoading(true)
    try {
      const res = await resignationApi.list({
        status: statusFilter || undefined,
        search: search.trim() || undefined,
        page,
        page_size: pageSize,
      })

      setResignations(res.items || [])
      setTotal(res.total || 0)
      setTotalPages(res.total_pages || 0)
    } catch (err: any) {
      console.error('Error fetching resignations:', err)
      toast.error('Lỗi khi tải danh sách đơn thôi việc')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, search, page, pageSize])

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const s = await resignationApi.getStats()
      setStats(s)
    } catch (err) {
      console.error('Error fetching stats:', err)
    }
  }, [])

  useEffect(() => {
    fetchResignations()
    fetchStats()
  }, [fetchResignations, fetchStats])

  // Toggle 3-dots action menu
  const handleToggleMenu = (e: React.MouseEvent, resignationId: number, rowIndex: number, totalRows: number) => {
    e.stopPropagation()
    if (openMenuId === resignationId) {
      setOpenMenuId(null)
      setMenuPos(null)
      return
    }

    const rect = e.currentTarget.getBoundingClientRect()
    const openUp = rowIndex > totalRows - 4 && rowIndex > 2
    setMenuPos({
      top: openUp ? undefined : rect.bottom + 4,
      bottom: openUp ? window.innerHeight - rect.top + 4 : undefined,
      right: window.innerWidth - rect.right,
    })
    setOpenMenuId(resignationId)
  }

  // Action handlers
  const handleOpenDetail = (item: Resignation) => {
    setSelectedResignation(item)
    setShowDetailModal(true)
    setOpenMenuId(null)
  }

  const handleOpenApprove = (item: Resignation) => {
    setSelectedResignation(item)
    setShowApproveModal(true)
    setOpenMenuId(null)
  }

  const handleOpenReject = (item: Resignation) => {
    setSelectedResignation(item)
    setShowRejectModal(true)
    setOpenMenuId(null)
  }

  const handleOpenCancel = (item: Resignation) => {
    setSelectedResignation(item)
    setShowCancelModal(true)
    setOpenMenuId(null)
  }

  const handleNavigateToTerminate = (item: Resignation) => {
    setOpenMenuId(null)
    navigate(`/contracts?search=${encodeURIComponent(item.employee_code || item.contract_number || '')}`)
  }

  const handleActionSuccess = () => {
    fetchResignations()
    fetchStats()
  }

  // Sync statuses on demand
  const handleSyncStatuses = async () => {
    setSyncingStatuses(true)
    try {
      const res = await contractApi.syncEmployeeStatuses()
      toast.success(res.message || `Đã đồng bộ trạng thái nhân sự và tài khoản (${res.updated_count} cập nhật)`)
      fetchResignations()
      fetchStats()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || err?.message || 'Lỗi khi đồng bộ trạng thái nhân sự')
    } finally {
      setSyncingStatuses(false)
    }
  }

  // Render Portal Action Menu
  const renderActionMenu = () => {
    if (openMenuId === null || !menuPos) return null

    const item = resignations.find((r) => r.resignation_id === openMenuId)
    if (!item) return null

    const isDropup = menuPos.bottom !== undefined

    return createPortal(
      <div
        className={`action-dropdown action-dropdown-fixed ${isDropup ? 'dropup' : 'dropdown'}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          top: menuPos.top !== undefined ? `${menuPos.top}px` : 'auto',
          bottom: menuPos.bottom !== undefined ? `${menuPos.bottom}px` : 'auto',
          right: `${menuPos.right}px`,
          zIndex: 99999,
        }}
      >
        <button
          className="action-dropdown-item"
          onClick={() => handleOpenDetail(item)}
        >
          <span className="action-icon icon-view">{Icons.eye}</span>
          <span>Xem chi tiết đơn</span>
        </button>

        {canApproveResignation(item) && (
          <button
            className="action-dropdown-item"
            onClick={() => handleOpenApprove(item)}
          >
            <span className="action-icon icon-promote" style={{ color: 'var(--status-success)' }}>
              {Icons.check}
            </span>
            <span>{isApplicantHrOrAdmin(item) ? 'Phê duyệt (Giám đốc)' : 'Phê duyệt đơn'}</span>
          </button>
        )}

        {canRejectResignation(item) && (
          <button
            className="action-dropdown-item danger"
            onClick={() => handleOpenReject(item)}
          >
            <span className="action-icon icon-danger">{Icons.xCircle}</span>
            <span>Từ chối đơn</span>
          </button>
        )}

        {canManage && item.status === 'APPROVED' && (
          <>
            <div className="action-dropdown-divider"></div>
            <button
              className="action-dropdown-item danger"
              onClick={() => handleNavigateToTerminate(item)}
            >
              <span className="action-icon icon-danger">{Icons.xCircle}</span>
              <span>Chấm dứt hợp đồng</span>
            </button>
          </>
        )}

        {canCancelResignation(item) && (
          <>
            <div className="action-dropdown-divider"></div>
            <button
              className="action-dropdown-item"
              onClick={() => handleOpenCancel(item)}
              style={{ color: 'var(--text-tertiary)' }}
            >
              <span className="action-icon">{Icons.x}</span>
              <span>Hủy đơn</span>
            </button>
          </>
        )}

        {item.attachment_url && (
          <>
            <div className="action-dropdown-divider"></div>
            <a
              href={item.attachment_url}
              target="_blank"
              rel="noopener noreferrer"
              className="action-dropdown-item"
              style={{ textDecoration: 'none' }}
              onClick={() => {
                setOpenMenuId(null)
                setMenuPos(null)
              }}
            >
              <span className="action-icon">{Icons.fileText}</span>
              <span>Xem tệp đính kèm</span>
            </a>
          </>
        )}
      </div>,
      document.body
    )
  }

  const hasActiveFilters = Boolean(search || statusFilter)

  return (
    <div className="page-container">
      {/* Page Header matching ContractManagementPage & EmployeeListPage */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Quản lý thôi việc</h1>
          <p className="page-subtitle">
            Tiếp nhận đơn thôi việc từ nhân viên, xử lý phê duyệt và theo dõi lộ trình chấm dứt hợp đồng
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {canManage && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleSyncStatuses}
              disabled={syncingStatuses}
              title="Quét và đồng bộ trạng thái nhân viên, tài khoản theo hiệu lực hợp đồng"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              {syncingStatuses ? Icons.loader : Icons.refresh}
              <span>{syncingStatuses ? 'Đang đồng bộ...' : 'Đồng bộ trạng thái'}</span>
            </button>
          )}

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              fetchResignations()
              fetchStats()
            }}
            title="Làm mới dữ liệu"
          >
            {Icons.refresh} Làm mới
          </button>

          {canManage && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setShowCreateModal(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              {Icons.plus}
              <span>Tiếp nhận đơn thôi việc</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Stats Grid matching ContractManagementPage */}
      {stats && (
        <div
          className="stats-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '12px',
            marginBottom: '20px',
          }}
        >
          <div
            onClick={() => {
              setStatusFilter('')
              setPage(1)
            }}
            style={{ cursor: 'pointer', opacity: !statusFilter ? 1 : 0.85 }}
          >
            <StatCard
              label="Tổng số đơn"
              value={stats.total}
              icon={Icons.clipboardList}
              iconColor="blue"
            />
          </div>

          <div
            onClick={() => {
              setStatusFilter((prev) => (prev === 'PENDING' ? '' : 'PENDING'))
              setPage(1)
            }}
            style={{ cursor: 'pointer', opacity: statusFilter === 'PENDING' ? 1 : 0.85 }}
          >
            <StatCard
              label="Chờ phê duyệt"
              value={stats.pending}
              icon={Icons.clock}
              iconColor="amber"
            />
          </div>

          <div
            onClick={() => {
              setStatusFilter((prev) => (prev === 'APPROVED' ? '' : 'APPROVED'))
              setPage(1)
            }}
            style={{ cursor: 'pointer', opacity: statusFilter === 'APPROVED' ? 1 : 0.85 }}
          >
            <StatCard
              label="Đã phê duyệt"
              value={stats.approved}
              icon={Icons.checkCircle}
              iconColor="green"
            />
          </div>

          <div
            onClick={() => {
              setStatusFilter((prev) => (prev === 'REJECTED' ? '' : 'REJECTED'))
              setPage(1)
            }}
            style={{ cursor: 'pointer', opacity: statusFilter === 'REJECTED' ? 1 : 0.85 }}
          >
            <StatCard
              label="Đã từ chối"
              value={stats.rejected}
              icon={Icons.xCircle}
              iconColor="red"
            />
          </div>
        </div>
      )}

      {/* Main Single Card with Header Filters & Table */}
      <div className="card">
        {/* Card Header with unified search & dropdown filters */}
        <div className="card-header">
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flex: 1, flexWrap: 'wrap' }}>
            <div className="search-box" style={{ flex: 1, minWidth: '240px' }}>
              <span className="search-icon">{Icons.search}</span>
              <input
                type="text"
                className="form-input"
                placeholder="Tìm mã đơn, tên NV, mã NV, số HĐ, lý do..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
              />
            </div>

            <select
              className="form-select"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value)
                setPage(1)
              }}
              style={{ width: 'auto', minWidth: '170px' }}
            >
              <option value="">Tất cả trạng thái</option>
              <option value="PENDING">Chờ duyệt (Pending)</option>
              <option value="APPROVED">Đã duyệt (Approved)</option>
              <option value="REJECTED">Đã từ chối (Rejected)</option>
              <option value="CANCELLED">Đã hủy (Cancelled)</option>
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setSearch('')
                  setStatusFilter('')
                  setPage(1)
                }}
                title="Xóa bộ lọc"
              >
                {Icons.x} Xóa bộ lọc
              </button>
            )}
          </div>
        </div>

        {/* Loading / Empty / Data Table */}
        {loading ? (
          <div className="card-body" style={{ textAlign: 'center', padding: '40px' }}>
            <div style={{ marginBottom: '12px' }}>{Icons.loader}</div>
            Đang tải danh sách đơn thôi việc...
          </div>
        ) : resignations.length === 0 ? (
          <div className="card-body" style={{ padding: '40px 16px', textAlign: 'center' }}>
            <EmptyState
              icon={Icons.clipboardList}
              title="Không tìm thấy đơn thôi việc nào"
              description={
                hasActiveFilters
                  ? 'Không có đơn nào khớp với điều kiện tìm kiếm và bộ lọc đã chọn.'
                  : 'Hệ thống chưa ghi nhận đơn thôi việc nào. Hãy tiếp nhận đơn mới để bắt đầu theo dõi.'
              }
            />
          </div>
        ) : (
          <>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: '100px' }}>MÃ ĐƠN</th>
                    <th>NHÂN SỰ</th>
                    <th>PHÒNG BAN / VỊ TRÍ</th>
                    <th style={{ width: '170px' }}>HỢP ĐỒNG</th>
                    <th style={{ width: '115px' }}>NGÀY NỘP</th>
                    <th style={{ width: '130px' }}>DỰ KIẾN NGHỈ</th>
                    <th style={{ width: '130px' }}>NGHỈ ĐƯỢC DUYỆT</th>
                    <th style={{ width: '130px', textAlign: 'center' }}>TRẠNG THÁI</th>
                    <th style={{ width: '80px', textAlign: 'center' }}>ĐÍNH KÈM</th>
                    <th style={{ width: '90px', textAlign: 'center' }}>HÀNH ĐỘNG</th>
                  </tr>
                </thead>
                <tbody>
                  {resignations.map((item, index) => {
                    return (
                      <tr key={item.resignation_id}>
                        {/* MÃ ĐƠN */}
                        <td>
                          <span
                            className="table-cell-mono font-medium"
                            style={{ color: 'var(--brand-primary)', fontWeight: 600 }}
                          >
                            #{item.resignation_id}
                          </span>
                        </td>

                        {/* NHÂN SỰ */}
                        <td>
                          <div className="table-user-cell">
                            <div className="table-user-avatar">
                              {getInitials(item.employee_name)}
                            </div>
                            <div className="table-user-details">
                              <span className="table-user-name">
                                {item.employee_name || '--'}
                              </span>
                              <span className="table-user-sub">
                                {item.employee_code || '--'}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* PHÒNG BAN / VỊ TRÍ */}
                        <td>
                          <div style={{ fontSize: '12.5px' }}>
                            <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                              {item.department_name || '--'}
                            </div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '11.5px' }}>
                              {item.position_name || '--'}
                            </div>
                          </div>
                        </td>

                        {/* HỢP ĐỒNG */}
                        <td>
                          <div>
                            <span className="table-cell-mono font-medium" style={{ color: 'var(--text-primary)' }}>
                              {item.contract_number}
                            </span>
                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                              {getContractTypeLabel(item.contract_type)}
                            </div>
                          </div>
                        </td>

                        {/* NGÀY NỘP */}
                        <td>
                          <span style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                            {formatDate(item.submitted_date)}
                          </span>
                        </td>

                        {/* DỰ KIẾN NGHỈ */}
                        <td>
                          <span style={{ fontSize: '12.5px', color: 'var(--text-primary)', fontWeight: 500 }}>
                            {formatDate(item.requested_last_working_date)}
                          </span>
                        </td>

                        {/* NGHỈ ĐƯỢC DUYỆT */}
                        <td>
                          {item.approved_last_working_date ? (
                            <span style={{ color: 'var(--status-success)', fontWeight: 600, fontSize: '12.5px' }}>
                              {formatDate(item.approved_last_working_date)}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>--</span>
                          )}
                        </td>

                        {/* TRẠNG THÁI */}
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <span className={RESIGNATION_STATUS_BADGE[item.status] || 'badge-status'}>
                            {RESIGNATION_STATUS_LABELS[item.status] || item.status}
                          </span>
                          {item.status === 'PENDING' && isApplicantHrOrAdmin(item) && (
                            <div style={{ fontSize: '11px', color: 'var(--role-director-text)', fontWeight: 600, marginTop: '3px' }}>
                              Chờ Giám đốc duyệt
                            </div>
                          )}
                        </td>

                        {/* ĐÍNH KÈM */}
                        <td style={{ textAlign: 'center' }}>
                          {item.attachment_url ? (
                            <a
                              href={item.attachment_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn btn-secondary btn-sm btn-icon"
                              title="Xem tệp đính kèm"
                              style={{ display: 'inline-flex', padding: '4px' }}
                            >
                              {Icons.paperclip}
                            </a>
                          ) : (
                            <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>-</span>
                          )}
                        </td>

                        {/* HÀNH ĐỘNG */}
                        <td>
                          <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm btn-icon"
                              title="Xem chi tiết"
                              onClick={() => handleOpenDetail(item)}
                            >
                              {Icons.eye}
                            </button>
                            {canManage && (
                              <button
                                type="button"
                                className={`btn btn-secondary btn-sm btn-icon ${openMenuId === item.resignation_id ? 'active' : ''}`}
                                title="Tùy chọn thao tác"
                                onClick={(e) => handleToggleMenu(e, item.resignation_id, index, resignations.length)}
                              >
                                {Icons.moreVertical}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Table Pagination matching ContractManagementPage */}
            <div className="table-pagination">
              <span>
                Hiển thị {resignations.length} trên tổng số {total} đơn thôi việc
              </span>
              <div className="table-pagination-nav">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={page === 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  ‹ Trước
                </button>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)', padding: '0 4px', display: 'flex', alignItems: 'center' }}>
                  Trang {page} / {Math.max(1, totalPages)}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Sau ›
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Floating Action Menu rendered in Portal */}
      {renderActionMenu()}

      {/* Dialogs */}
      <ResignationCreateDialog
        open={showCreateModal}
        employees={employees}
        onClose={() => setShowCreateModal(false)}
        onSuccess={handleActionSuccess}
      />

      <ResignationDetailDialog
        open={showDetailModal}
        resignation={selectedResignation}
        onClose={() => setShowDetailModal(false)}
        onApprove={selectedResignation && canApproveResignation(selectedResignation) ? (item) => {
          setSelectedResignation(item)
          setShowApproveModal(true)
        } : undefined}
        onReject={selectedResignation && canRejectResignation(selectedResignation) ? (item) => {
          setSelectedResignation(item)
          setShowRejectModal(true)
        } : undefined}
        onCancel={selectedResignation && canCancelResignation(selectedResignation) ? (item) => {
          setSelectedResignation(item)
          setShowCancelModal(true)
        } : undefined}
        onTerminateContract={handleNavigateToTerminate}
      />

      <ResignationApproveDialog
        open={showApproveModal}
        resignation={selectedResignation}
        onClose={() => setShowApproveModal(false)}
        onSuccess={handleActionSuccess}
      />

      <ResignationRejectDialog
        open={showRejectModal}
        resignation={selectedResignation}
        onClose={() => setShowRejectModal(false)}
        onSuccess={handleActionSuccess}
      />

      <ResignationCancelDialog
        open={showCancelModal}
        resignation={selectedResignation}
        onClose={() => setShowCancelModal(false)}
        onSuccess={handleActionSuccess}
      />
    </div>
  )
}

export default ResignationManagementPage
