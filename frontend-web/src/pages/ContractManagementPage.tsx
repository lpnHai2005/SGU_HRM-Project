/**
 * Contract Management Page
 * Trang quản lý hợp đồng lao động chuẩn UI/UX theo mẫu Hồ sơ Nhân sự (EmployeeListPage)
 * Vero Design System (Linear / Attio minimalist, dual light & obsidian dark theme)
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { Icons } from '../components/common/Icons'
import { StatCard } from '../components/common/StatCard'
import { EmptyState } from '../components/common/EmptyState'
import { ContractFormDialog } from '../components/ContractFormDialog'
import { ContractRenewDialog } from '../components/ContractRenewDialog'
import { ContractTerminateDialog } from '../components/ContractTerminateDialog'
import { contractApi } from '../services/contractService'
import { employeeApi, default as api } from '../services/api'
import { formatDate, formatCurrency, getInitials } from '../utils/formatters'
import {
  type Contract,
  type ContractStats,
  CONTRACT_STATUS_LABELS,
  getContractStatusClass,
  getContractTypeLabel,
} from '../types/contract'
import { toast } from 'sonner'

export interface ContractManagementPageProps {
  user: any
}

type ConfirmAction = 'activate' | 'cancel' | null

export function ContractManagementPage({ user }: ContractManagementPageProps) {
  const [searchParams] = useSearchParams()

  // State
  const [contracts, setContracts] = useState<Contract[]>([])
  const [stats, setStats] = useState<ContractStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [totalPages, setTotalPages] = useState(0)

  // Lookups & Employees for forms and filters
  const [lookups, setLookups] = useState<any>(null)
  const [employees, setEmployees] = useState<any[]>([])

  // Filters
  const [search, setSearch] = useState(searchParams.get('search') || '')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [departmentFilter, setDepartmentFilter] = useState<string>('')
  const [positionFilter, setPositionFilter] = useState<string>('')
  const [expiringDaysFilter, setExpiringDaysFilter] = useState<string>('')
  const [expiredFilter, setExpiredFilter] = useState(false)
  const employeeIdParam = searchParams.get('employee_id')
  const [employeeFilter, setEmployeeFilter] = useState<string>(employeeIdParam || '')

  // Modal states
  const [showFormModal, setShowFormModal] = useState(false)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [showRenewModal, setShowRenewModal] = useState(false)
  const [showTerminateModal, setShowTerminateModal] = useState(false)
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null)
  const [editingContract, setEditingContract] = useState<Contract | null>(null)
  const [detailUploading, setDetailUploading] = useState(false)

  // Dropdown menu state (matching EmployeeListPage)
  const [openMenuId, setOpenMenuId] = useState<number | null>(null)
  const [menuPos, setMenuPos] = useState<{
    top?: number
    bottom?: number
    right: number
  } | null>(null)

  // Confirmation modal
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null)
  const [confirmTarget, setConfirmTarget] = useState<Contract | null>(null)
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [syncingStatuses, setSyncingStatuses] = useState(false)
  const [generatingPdf, setGeneratingPdf] = useState(false)

  const handleGeneratePdf = async (contractId: number) => {
    setGeneratingPdf(true)
    try {
      const res = await contractApi.generatePdf(contractId)
      toast.success('Đã tự động tạo file PDF hợp đồng chuẩn thành công!')
      if (selectedContract && selectedContract.contract_id === contractId) {
        setSelectedContract({ ...selectedContract, contract_file_url: res.file_url })
      }
      fetchContracts()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Lỗi khi tạo file PDF hợp đồng')
    } finally {
      setGeneratingPdf(false)
    }
  }

  // RBAC
  const userRoles = useMemo(() => user?.roles || [], [user])
  const canManage = useMemo(() => {
    return userRoles.includes('ADMIN') || userRoles.includes('HR_MANAGER') || userRoles.includes('DIRECTOR')
  }, [userRoles])

  // Load lookups and employees
  useEffect(() => {
    employeeApi.getLookups().then(data => setLookups(data)).catch(console.error)
    api.get<any>('/employees', { page_size: 200, employment_status: 'ACTIVE' })
      .then(res => {
        const list = Array.isArray(res) ? res : res.data || []
        setEmployees(list)
      })
      .catch(console.error)
  }, [])

  // Fetch contracts
  const fetchContracts = useCallback(async () => {
    setLoading(true)
    try {
      const params: any = {
        page,
        page_size: pageSize,
      }
      if (search) params.search = search
      if (statusFilter) params.status = statusFilter
      if (typeFilter) params.contract_type = typeFilter
      if (departmentFilter) params.department_id = parseInt(departmentFilter)
      if (positionFilter) params.position_id = parseInt(positionFilter)
      if (employeeFilter) params.employee_id = parseInt(employeeFilter)
      if (expiringDaysFilter) params.expiring_days = parseInt(expiringDaysFilter)
      if (expiredFilter) params.expired = true

      const response = await contractApi.list(params)
      setContracts(response.data || [])
      setTotal(response.total)
      setTotalPages(response.total_pages)
    } catch (err: any) {
      console.error('Error fetching contracts:', err)
      toast.error('Lỗi khi tải danh sách hợp đồng')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, search, statusFilter, typeFilter, departmentFilter, positionFilter, employeeFilter, expiringDaysFilter, expiredFilter])

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const data = await contractApi.getStats()
      setStats(data)
    } catch (err) {
      console.error('Error fetching stats:', err)
    }
  }, [])

  useEffect(() => {
    fetchContracts()
  }, [fetchContracts])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  // Close menu when clicking outside, scrolling, resizing, or pressing Escape
  useEffect(() => {
    if (openMenuId === null) return

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (target.closest('.action-dropdown') || target.closest('.btn-icon')) {
        return
      }
      setOpenMenuId(null)
      setMenuPos(null)
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenuId(null)
        setMenuPos(null)
      }
    }

    const handleScroll = (e: Event) => {
      const target = e.target as HTMLElement | null
      if (target && target.closest?.('.action-dropdown')) return
      setOpenMenuId(null)
      setMenuPos(null)
    }

    const handleResize = () => {
      setOpenMenuId(null)
      setMenuPos(null)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleResize)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleResize)
    }
  }, [openMenuId])

  // Handlers
  const handleView = (contract: Contract) => {
    setSelectedContract(contract)
    setShowDetailModal(true)
    setOpenMenuId(null)
    setMenuPos(null)
  }

  const handleEdit = (contract: Contract) => {
    if (contract.status !== 'DRAFT') {
      toast.error('Chỉ có thể chỉnh sửa hợp đồng ở trạng thái Bản nháp')
      return
    }
    setEditingContract(contract)
    setShowFormModal(true)
    setOpenMenuId(null)
    setMenuPos(null)
  }

  const handleRenew = (contract: Contract) => {
    setSelectedContract(contract)
    setShowRenewModal(true)
    setOpenMenuId(null)
    setMenuPos(null)
  }

  const handleTerminate = (contract: Contract) => {
    setSelectedContract(contract)
    setShowTerminateModal(true)
    setOpenMenuId(null)
    setMenuPos(null)
  }

  const requestActivate = (contract: Contract) => {
    setConfirmAction('activate')
    setConfirmTarget(contract)
    setOpenMenuId(null)
    setMenuPos(null)
  }

  const requestCancel = (contract: Contract) => {
    setConfirmAction('cancel')
    setConfirmTarget(contract)
    setOpenMenuId(null)
    setMenuPos(null)
  }

  const handleConfirmAction = async () => {
    if (!confirmTarget || !confirmAction) return
    setConfirmLoading(true)
    try {
      if (confirmAction === 'activate') {
        await contractApi.activate(confirmTarget.contract_id)
        toast.success(`Đã kích hoạt hợp đồng ${confirmTarget.contract_number}!`)
      } else if (confirmAction === 'cancel') {
        await contractApi.cancel(confirmTarget.contract_id)
        toast.success(`Đã hủy hợp đồng ${confirmTarget.contract_number}!`)
      }
      setConfirmAction(null)
      setConfirmTarget(null)
      fetchContracts()
      fetchStats()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Thao tác không thành công')
    } finally {
      setConfirmLoading(false)
    }
  }

  const handleResetFilters = () => {
    setSearch('')
    setStatusFilter('')
    setTypeFilter('')
    setDepartmentFilter('')
    setPositionFilter('')
    setExpiringDaysFilter('')
    setExpiredFilter(false)
    setEmployeeFilter('')
    setPage(1)
  }

  const hasActiveFilters = Boolean(
    search || statusFilter || typeFilter || departmentFilter || positionFilter || expiringDaysFilter || expiredFilter || employeeFilter
  )

  const handleSyncStatuses = async () => {
    setSyncingStatuses(true)
    try {
      const res = await contractApi.syncEmployeeStatuses()
      toast.success(res.message || `Đã đồng bộ trạng thái nhân sự và tài khoản (${res.updated_count} cập nhật)`)
      fetchContracts()
      fetchStats()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || err?.message || 'Lỗi khi đồng bộ trạng thái')
    } finally {
      setSyncingStatuses(false)
    }
  }

  // Dropdown menu toggle
  const handleToggleMenu = (
    e: React.MouseEvent<HTMLButtonElement>,
    contractId: number,
    index: number,
    totalCount: number
  ) => {
    e.stopPropagation()
    if (openMenuId === contractId) {
      setOpenMenuId(null)
      setMenuPos(null)
      return
    }

    const rect = e.currentTarget.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const menuEstimatedHeight = 210

    const isNearBottom = index >= Math.max(1, totalCount - 2)
    const openUp = (spaceBelow < menuEstimatedHeight || isNearBottom) && rect.top > menuEstimatedHeight

    setMenuPos({
      top: openUp ? undefined : rect.bottom + 4,
      bottom: openUp ? window.innerHeight - rect.top + 4 : undefined,
      right: window.innerWidth - rect.right,
    })
    setOpenMenuId(contractId)
  }

  // Render floating action menu via Portal
  const renderActionMenu = () => {
    if (openMenuId === null || !menuPos) return null

    const contract = contracts.find((c) => c.contract_id === openMenuId)
    if (!contract) return null

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
          onClick={() => handleView(contract)}
        >
          <span className="action-icon icon-view">{Icons.eye}</span>
          <span>Xem chi tiết</span>
        </button>

        {canManage && contract.status === 'DRAFT' && (
          <>
            <button
              className="action-dropdown-item"
              onClick={() => handleEdit(contract)}
            >
              <span className="action-icon icon-edit">{Icons.edit}</span>
              <span>Chỉnh sửa</span>
            </button>
            <button
              className="action-dropdown-item"
              onClick={() => requestActivate(contract)}
            >
              <span className="action-icon icon-promote" style={{ color: 'var(--status-success)' }}>
                {Icons.check}
              </span>
              <span>Kích hoạt HĐ</span>
            </button>
            <div className="action-dropdown-divider"></div>
            <button
              className="action-dropdown-item danger"
              onClick={() => requestCancel(contract)}
            >
              <span className="action-icon icon-danger">{Icons.xCircle}</span>
              <span>Hủy hợp đồng</span>
            </button>
          </>
        )}

        {canManage && (contract.status === 'ACTIVE' || contract.status === 'EXPIRED') && (
          <button
            className="action-dropdown-item"
            onClick={() => handleRenew(contract)}
          >
            <span className="action-icon icon-contract">{Icons.refresh}</span>
            <span>Gia hạn hợp đồng</span>
          </button>
        )}

        {canManage && contract.status === 'ACTIVE' && (
          <>
            <div className="action-dropdown-divider"></div>
            <button
              className="action-dropdown-item danger"
              onClick={() => handleTerminate(contract)}
            >
              <span className="action-icon icon-danger">{Icons.xCircle}</span>
              <span>Chấm dứt HĐ</span>
            </button>
          </>
        )}

        <div className="action-dropdown-divider"></div>
        <button
          className="action-dropdown-item"
          onClick={async () => {
            setOpenMenuId(null)
            setMenuPos(null)
            if (contract.contract_file_url) {
              window.open(contract.contract_file_url, '_blank', 'noopener,noreferrer')
              return
            }
            // Open the tab synchronously so the popup blocker allows it; the endpoint needs the Bearer token, so fetch as blob.
            const tab = window.open('', '_blank')
            try {
              const blob = await api.getBlob(`/contracts/${contract.contract_id}/download-pdf`)
              const url = URL.createObjectURL(blob)
              if (tab) tab.location.href = url
              else window.open(url, '_blank')
              setTimeout(() => URL.revokeObjectURL(url), 60_000)
              fetchContracts()
            } catch (err) {
              tab?.close()
              toast.error(err instanceof Error ? err.message : 'Không thể tạo file PDF hợp đồng')
            }
          }}
        >
          <span className="action-icon">{Icons.fileText}</span>
          <span>{contract.contract_file_url ? 'Xem / Tải file PDF' : 'Tạo & Xem PDF chuẩn'}</span>
        </button>
      </div>,
      document.body
    )
  }

  return (
    <div className="page-container">
      {/* Page Header matching EmployeeListPage */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Quản lý Hợp đồng lao động</h1>
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
            className="btn btn-secondary btn-sm"
            onClick={() => {
              fetchContracts()
              fetchStats()
            }}
            title="Làm mới dữ liệu"
          >
            {Icons.refresh} Làm mới
          </button>
          {canManage && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                setEditingContract(null)
                setShowFormModal(true)
              }}
            >
              {Icons.plus} Tạo hợp đồng
            </button>
          )}
        </div>
      </div>

      {/* KPI Stats Grid */}
      {stats && (
        <div
          className="stats-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '12px',
            marginBottom: '16px',
          }}
        >
          <div
            onClick={() => {
              setStatusFilter(prev => prev === 'ACTIVE' ? '' : 'ACTIVE')
              setExpiredFilter(false)
              setExpiringDaysFilter('')
              setPage(1)
            }}
            style={{ cursor: 'pointer', opacity: statusFilter === 'ACTIVE' ? 1 : 0.9 }}
          >
            <StatCard
              label="Đang hiệu lực"
              value={stats.active}
              icon={Icons.checkCircle}
              iconColor="green"
            />
          </div>

          <div
            onClick={() => {
              setExpiringDaysFilter(prev => prev === '30' ? '' : '30')
              setExpiredFilter(false)
              setStatusFilter('ACTIVE')
              setPage(1)
            }}
            style={{ cursor: 'pointer', opacity: expiringDaysFilter === '30' ? 1 : 0.9 }}
          >
            <StatCard
              label="Sắp hết hạn (30 ngày)"
              value={stats.expiring_soon}
              icon={Icons.calendar}
              iconColor="amber"
            />
          </div>

          <div
            onClick={() => {
              setExpiredFilter(prev => !prev)
              setExpiringDaysFilter('')
              setPage(1)
            }}
            style={{ cursor: 'pointer', opacity: expiredFilter ? 1 : 0.9 }}
          >
            <StatCard
              label="Đã hết hạn"
              value={stats.expired}
              icon={Icons.alertTriangle}
              iconColor="red"
            />
          </div>

          <div
            onClick={() => {
              setStatusFilter(prev => prev === 'TERMINATED' ? '' : 'TERMINATED')
              setExpiredFilter(false)
              setExpiringDaysFilter('')
              setPage(1)
            }}
            style={{ cursor: 'pointer', opacity: statusFilter === 'TERMINATED' ? 1 : 0.9 }}
          >
            <StatCard
              label="Đã chấm dứt"
              value={stats.terminated}
              icon={Icons.xCircle}
              iconColor="red"
            />
          </div>

          <div
            onClick={() => {
              setStatusFilter(prev => prev === 'DRAFT' ? '' : 'DRAFT')
              setExpiredFilter(false)
              setExpiringDaysFilter('')
              setPage(1)
            }}
            style={{ cursor: 'pointer', opacity: statusFilter === 'DRAFT' ? 1 : 0.9 }}
          >
            <StatCard
              label="Bản nháp"
              value={stats.draft}
              icon={Icons.fileText}
              iconColor="blue"
            />
          </div>
        </div>
      )}

      {/* Main Single Card with Header Filters & Table */}
      <div className="card">
        {/* Card Header with unified search & dropdown filters */}
        <div className="card-header">
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flex: 1, flexWrap: 'wrap' }}>
            <div className="search-box" style={{ flex: 1, minWidth: '220px' }}>
              <span className="search-icon">{Icons.search}</span>
              <input
                type="text"
                className="form-input"
                placeholder="Tìm mã HĐ, mã NV, họ tên..."
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
              style={{ width: 'auto', minWidth: '150px' }}
            >
              <option value="">Tất cả trạng thái</option>
              {Object.entries(CONTRACT_STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>

            <select
              className="form-select"
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value)
                setPage(1)
              }}
              style={{ width: 'auto', minWidth: '150px' }}
            >
              <option value="">Tất cả loại HĐ</option>
              <option value="PROBATION">Thử việc</option>
              <option value="FIXED_TERM">Xác định thời hạn</option>
              <option value="INDEFINITE">Không xác định thời hạn</option>
            </select>

            {lookups?.departments && lookups.departments.length > 0 && (
              <select
                className="form-select"
                value={departmentFilter}
                onChange={(e) => {
                  setDepartmentFilter(e.target.value)
                  setPage(1)
                }}
                style={{ width: 'auto', minWidth: '150px' }}
              >
                <option value="">Tất cả phòng ban</option>
                {lookups.departments.map((d: any) => (
                  <option key={d.department_id} value={d.department_id}>
                    {d.department_name}
                  </option>
                ))}
              </select>
            )}

            {lookups?.positions && lookups.positions.length > 0 && (
              <select
                className="form-select"
                value={positionFilter}
                onChange={(e) => {
                  setPositionFilter(e.target.value)
                  setPage(1)
                }}
                style={{ width: 'auto', minWidth: '150px' }}
              >
                <option value="">Tất cả chức vụ</option>
                {lookups.positions.map((p: any) => (
                  <option key={p.position_id} value={p.position_id}>
                    {p.position_name}
                  </option>
                ))}
              </select>
            )}

            <select
              className="form-select"
              value={expiringDaysFilter}
              onChange={(e) => {
                setExpiringDaysFilter(e.target.value)
                if (e.target.value) setExpiredFilter(false)
                setPage(1)
              }}
              style={{ width: 'auto', minWidth: '140px' }}
            >
              <option value="">Thời hạn</option>
              <option value="30">Sắp hết hạn (30 ngày)</option>
              <option value="60">Sắp hết hạn (60 ngày)</option>
              <option value="90">Sắp hết hạn (90 ngày)</option>
            </select>

            {hasActiveFilters && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleResetFilters}
                title="Xóa toàn bộ bộ lọc"
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
            Đang tải danh sách hợp đồng...
          </div>
        ) : contracts.length === 0 ? (
          <div className="card-body" style={{ padding: '40px 16px', textAlign: 'center' }}>
            <EmptyState
              icon={Icons.fileText}
              title="Không tìm thấy hợp đồng nào"
              description={
                hasActiveFilters
                  ? 'Không có hợp đồng nào khớp với điều kiện tìm kiếm và bộ lọc đã chọn.'
                  : 'Chưa có hợp đồng nào trong hệ thống. Hãy tạo hợp đồng mới để bắt đầu quản lý.'
              }
            />
          </div>
        ) : (
          <>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: '150px' }}>HỢP ĐỒNG</th>
                    <th>NHÂN SỰ</th>
                    <th style={{ width: '160px' }}>LOẠI HĐ</th>
                    <th style={{ width: '170px' }}>THỜI HẠN</th>
                    <th>CHỨC VỤ / ĐƠN VỊ</th>
                    {canManage && <th style={{ width: '125px' }}>LƯƠNG CƠ BẢN</th>}
                    <th style={{ width: '125px', textAlign: 'center' }}>TRẠNG THÁI</th>
                    <th style={{ width: '90px', textAlign: 'center' }}>HÀNH ĐỘNG</th>
                  </tr>
                </thead>
                <tbody>
                  {contracts.map((contract, index) => {
                    const statusClass = getContractStatusClass(contract.status)
                    return (
                      <tr key={contract.contract_id}>
                        {/* HỢP ĐỒNG */}
                        <td>
                          <div>
                            <span className="table-cell-mono font-medium" style={{ color: 'var(--text-primary)' }}>
                              {contract.contract_number}
                            </span>
                            {contract.previous_contract_id && (
                              <div
                                style={{
                                  fontSize: '11px',
                                  color: 'var(--text-tertiary)',
                                  marginTop: '2px',
                                }}
                              >
                                Gia hạn từ {contract.previous_contract_number || `#${contract.previous_contract_id}`}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* NHÂN SỰ */}
                        <td>
                          <div className="table-user-cell">
                            <div className="table-user-avatar">
                              {getInitials(contract.employee_name)}
                            </div>
                            <div className="table-user-details">
                              <span className="table-user-name">
                                {contract.employee_name || '--'}
                              </span>
                              <span className="table-user-sub">
                                {contract.employee_code || '--'}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* LOẠI HĐ */}
                        <td>
                          <span style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                            {getContractTypeLabel(contract.contract_type)}
                          </span>
                        </td>

                        {/* THỜI HẠN */}
                        <td>
                          <div style={{ fontSize: '12px' }}>
                            <div>{formatDate(contract.start_date)}</div>
                            <div style={{ color: 'var(--text-tertiary)' }}>
                              {contract.end_date ? `đến ${formatDate(contract.end_date)}` : 'Không xác định'}
                            </div>
                          </div>
                        </td>

                        {/* CHỨC VỤ / ĐƠN VỊ */}
                        <td>
                          <div style={{ fontSize: '12.5px' }}>
                            <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                              {contract.position_name || '--'}
                            </div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '11.5px' }}>
                              {contract.store_name || contract.department_name || '--'}
                            </div>
                          </div>
                        </td>

                        {/* LƯƠNG CƠ BẢN */}
                        {canManage && (
                          <td>
                            <span className="table-score-val">
                              {contract.basic_salary !== null && contract.basic_salary !== undefined
                                ? formatCurrency(contract.basic_salary)
                                : '--'}
                            </span>
                          </td>
                        )}

                        {/* TRẠNG THÁI */}
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <span className={`badge-status ${statusClass}`}>
                            {CONTRACT_STATUS_LABELS[contract.status] || contract.status}
                          </span>
                        </td>

                        {/* HÀNH ĐỘNG */}
                        <td>
                          <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                            <button
                              className="btn btn-secondary btn-sm btn-icon"
                              title="Xem chi tiết"
                              onClick={() => handleView(contract)}
                            >
                              {Icons.eye}
                            </button>
                            {canManage && (
                              <button
                                className={`btn btn-secondary btn-sm btn-icon ${openMenuId === contract.contract_id ? 'active' : ''}`}
                                title="Tùy chọn thao tác"
                                onClick={(e) => handleToggleMenu(e, contract.contract_id, index, contracts.length)}
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

            {/* Table Pagination matching EmployeeListPage */}
            <div className="table-pagination">
              <span>
                Hiển thị {contracts.length} trên tổng số {total} hợp đồng
              </span>
              <div className="table-pagination-nav">
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={page === 1 || loading}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                >
                  ‹ Trước
                </button>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)', padding: '0 4px' }}>
                  Trang {page} / {Math.max(1, totalPages)}
                </span>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage(p => p + 1)}
                >
                  Sau ›
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Floating Action Menu rendered outside table container via Portal */}
      {renderActionMenu()}

      {/* Detail Modal */}
      {showDetailModal && selectedContract && (
        <div
          className="modal-overlay"
          onClick={(e) => e.target === e.currentTarget && setShowDetailModal(false)}
        >
          <div className="modal" style={{ maxWidth: '680px' }}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span className="modal-title-icon icon-contract">{Icons.fileText}</span>
                <span>Hợp đồng: {selectedContract.contract_number}</span>
              </h3>
              <button
                className="modal-close"
                onClick={() => setShowDetailModal(false)}
                title="Đóng"
              >
                {Icons.x}
              </button>
            </div>
            <div className="modal-body">
              {/* Header Profile Box */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '16px',
                  padding: '16px',
                  background: 'var(--surface-ground)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-default)',
                  marginBottom: '18px',
                }}
              >
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '4px' }}>
                    MÃ HỢP ĐỒNG
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {selectedContract.contract_number}
                  </div>
                  <div style={{ marginTop: '8px' }}>
                    <span className={`badge-status ${getContractStatusClass(selectedContract.status)}`}>
                      {CONTRACT_STATUS_LABELS[selectedContract.status] || selectedContract.status}
                    </span>
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '4px' }}>
                    NHÂN VIÊN ĐƯỢC KÝ
                  </div>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>
                    {selectedContract.employee_name || '--'}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Mã NV: {selectedContract.employee_code || '--'}
                  </div>
                </div>
              </div>

              {/* THỜI HẠN & HIỆU LỰC */}
              <h4 style={{ margin: '0 0 10px', fontSize: '13px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                THỜI HẠN & HIỆU LỰC
              </h4>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: '12px',
                  fontSize: '13px',
                  marginBottom: '18px',
                }}
              >
                <div>
                  <span style={{ color: 'var(--text-secondary)' }}>Loại hợp đồng: </span>
                  <strong style={{ color: 'var(--text-primary)' }}>{getContractTypeLabel(selectedContract.contract_type)}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)' }}>Ngày ký: </span>
                  <strong style={{ color: 'var(--text-primary)' }}>{formatDate(selectedContract.signed_date)}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)' }}>Ngày bắt đầu: </span>
                  <strong style={{ color: 'var(--text-primary)' }}>{formatDate(selectedContract.start_date)}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)' }}>Ngày kết thúc: </span>
                  <strong style={{ color: 'var(--text-primary)' }}>
                    {selectedContract.end_date ? formatDate(selectedContract.end_date) : 'Không xác định (Vô thời hạn)'}
                  </strong>
                </div>
                {selectedContract.previous_contract_id && (
                  <div style={{ gridColumn: 'span 2' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Gia hạn từ hợp đồng cũ: </span>
                    <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                      {selectedContract.previous_contract_number || `#${selectedContract.previous_contract_id}`}
                    </strong>
                  </div>
                )}
              </div>

              {/* VỊ TRÍ & ĐÃI NGỘ */}
              <h4 style={{ margin: '0 0 10px', fontSize: '13px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                VỊ TRÍ & CHẾ ĐỘ ĐÃI NGỘ
              </h4>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: '12px',
                  fontSize: '13px',
                  marginBottom: '18px',
                }}
              >
                <div>
                  <span style={{ color: 'var(--text-secondary)' }}>Chức vụ: </span>
                  <strong style={{ color: 'var(--text-primary)' }}>{selectedContract.position_name || '--'}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)' }}>Đơn vị / Phòng ban: </span>
                  <strong style={{ color: 'var(--text-primary)' }}>{selectedContract.department_name || selectedContract.store_name || '--'}</strong>
                </div>
                {canManage && (
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Lương cơ bản: </span>
                    <strong style={{ color: 'var(--text-primary)' }}>
                      {selectedContract.basic_salary !== null && selectedContract.basic_salary !== undefined
                        ? formatCurrency(selectedContract.basic_salary)
                        : '--'}
                    </strong>
                  </div>
                )}
                {canManage && (selectedContract.insurance_salary !== null && selectedContract.insurance_salary !== undefined || selectedContract.basic_salary !== null && selectedContract.basic_salary !== undefined) && (() => {
                  const insSalary = selectedContract.basic_salary ?? selectedContract.insurance_salary ?? 0
                  return (
                    <div style={{ gridColumn: 'span 2', marginTop: '6px', padding: '10px 14px', background: 'var(--surface-subtle)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Căn cứ đóng Bảo hiểm Bắt buộc (100% lương cơ bản):</span>
                        <strong style={{ color: 'var(--text-primary)', fontSize: '14px', fontFamily: 'var(--font-mono)' }}>
                          {formatCurrency(insSalary)}
                        </strong>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6, borderTop: '1px dashed var(--border-default)', paddingTop: '6px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                            Trích nộp Bảo hiểm Bắt buộc (10.5% lương đóng BH):
                          </span>
                          <strong style={{ color: 'var(--status-error)', fontFamily: 'var(--font-mono)' }}>
                            - {formatCurrency(insSalary * 0.105)}
                          </strong>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px' }}>
                          <span>• BHXH (8.0%): <strong>{formatCurrency(insSalary * 0.08)}</strong></span>
                          <span>|</span>
                          <span>• BHYT (1.5%): <strong>{formatCurrency(insSalary * 0.015)}</strong></span>
                          <span>|</span>
                          <span>• BHTN (1.0%): <strong>{formatCurrency(insSalary * 0.01)}</strong></span>
                        </div>
                      </div>
                    </div>
                  )
                })()}
              </div>

              {/* Thông tin chấm dứt (nếu có) */}
              {selectedContract.termination_date && (
                <div
                  style={{
                    padding: '12px',
                    background: 'var(--status-error-bg)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--status-error-border)',
                    color: 'var(--status-error)',
                    fontSize: '13px',
                    marginBottom: '18px',
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                    ĐÃ CHẤM DỨT HỢP ĐỒNG NGÀY {formatDate(selectedContract.termination_date)}
                  </div>
                  <div>Lý do: {selectedContract.termination_reason || 'Không có lý do cụ thể'}</div>
                </div>
              )}

              {/* TỆP ĐÍNH KÈM & GHI CHÚ */}
              <h4 style={{ margin: '0 0 10px', fontSize: '13px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                HỒ SƠ ĐÍNH KÈM & GHI CHÚ
              </h4>
              <div style={{ fontSize: '13px', marginBottom: '12px' }}>
                <div style={{ marginBottom: '8px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Ghi chú: </span>
                  <span style={{ color: 'var(--text-primary)' }}>{selectedContract.notes || 'Không có ghi chú'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>File hợp đồng: </span>
                  {selectedContract.contract_file_url ? (
                    <>
                      <a
                        href={selectedContract.contract_file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-secondary btn-sm"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', textDecoration: 'none' }}
                      >
                        {Icons.fileText} Tải / Xem bản PDF
                      </a>
                      {canManage && (
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          disabled={generatingPdf}
                          onClick={() => handleGeneratePdf(selectedContract.contract_id)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                        >
                          {Icons.refresh} {generatingPdf ? 'Đang tạo...' : 'Tạo lại PDF chuẩn'}
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <span style={{ color: 'var(--text-tertiary)' }}>Chưa có file</span>
                      {canManage && (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={generatingPdf}
                          onClick={() => handleGeneratePdf(selectedContract.contract_id)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                        >
                          {Icons.fileText} {generatingPdf ? 'Đang tạo...' : 'Tạo tự động PDF chuẩn'}
                        </button>
                      )}
                    </>
                  )}
                </div>

                {canManage && selectedContract.status === 'DRAFT' && (
                  <div
                    style={{
                      marginTop: '12px',
                      padding: '12px',
                      background: 'var(--surface-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px dashed var(--border-default)',
                    }}
                  >
                    <label style={{ fontSize: '12px', display: 'block', marginBottom: '6px', fontWeight: 500 }}>
                      {selectedContract.contract_file_url ? 'Thay đổi file PDF đính kèm:' : 'Tải lên file scan PDF hợp đồng:'}
                    </label>
                    <input
                      type="file"
                      accept="application/pdf"
                      disabled={detailUploading}
                      onChange={async (e) => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        if (file.type !== 'application/pdf') {
                          toast.error('Chỉ chấp nhận file định dạng PDF')
                          return
                        }
                        setDetailUploading(true)
                        try {
                          const res = await contractApi.uploadFile(selectedContract.contract_id, file)
                          toast.success('Upload file thành công!')
                          setSelectedContract({ ...selectedContract, contract_file_url: res.file_url })
                          fetchContracts()
                        } catch (err: any) {
                          toast.error(err?.response?.data?.detail || 'Lỗi khi tải file lên')
                        } finally {
                          setDetailUploading(false)
                        }
                      }}
                    />
                    {detailUploading && (
                      <span style={{ fontSize: '12px', color: 'var(--primary-color)', marginLeft: '8px' }}>
                        Đang tải lên...
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div
              className="modal-footer"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '16px 20px',
                borderTop: '1px solid var(--border-default)',
                margin: 0,
              }}
            >
              <div>
                {canManage && selectedContract.status === 'DRAFT' && (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        setShowDetailModal(false)
                        handleEdit(selectedContract)
                      }}
                    >
                      {Icons.edit} Sửa
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setShowDetailModal(false)
                        requestActivate(selectedContract)
                      }}
                      style={{ color: 'var(--status-success)' }}
                    >
                      {Icons.check} Kích hoạt
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => {
                        setShowDetailModal(false)
                        requestCancel(selectedContract)
                      }}
                    >
                      {Icons.xCircle} Hủy HĐ
                    </button>
                  </div>
                )}
                {canManage && selectedContract.status === 'ACTIVE' && (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setShowDetailModal(false)
                        handleRenew(selectedContract)
                      }}
                    >
                      {Icons.refresh} Gia hạn
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => {
                        setShowDetailModal(false)
                        handleTerminate(selectedContract)
                      }}
                    >
                      {Icons.xCircle} Chấm dứt
                    </button>
                  </div>
                )}
                {canManage && selectedContract.status === 'EXPIRED' && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setShowDetailModal(false)
                      handleRenew(selectedContract)
                    }}
                  >
                    {Icons.refresh} Gia hạn HĐ mới
                  </button>
                )}
              </div>
              <button className="btn btn-secondary" onClick={() => setShowDetailModal(false)}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal matching EmployeeListPage */}
      {confirmAction && confirmTarget && (
        <div className="modal-overlay" onClick={() => !confirmLoading && setConfirmAction(null)}>
          <div className="modal" style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <h3 className="modal-title">
                {confirmAction === 'activate' ? 'Kích hoạt hợp đồng' : 'Hủy hợp đồng'}
              </h3>
              <button
                className="modal-close"
                onClick={() => !confirmLoading && setConfirmAction(null)}
              >
                {Icons.x}
              </button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                <div
                  style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '50%',
                    background: confirmAction === 'cancel' ? 'var(--status-error-bg)' : 'var(--status-info-bg)',
                    color: confirmAction === 'cancel' ? 'var(--status-error)' : 'var(--status-info)',
                    border: `1px solid ${confirmAction === 'cancel' ? 'var(--status-error-border)' : 'var(--status-info-border)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {confirmAction === 'cancel' ? Icons.alertTriangle : Icons.alertCircle}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: '0', fontSize: '14px', lineHeight: '1.5' }}>
                    {confirmAction === 'activate'
                      ? `Xác nhận kích hoạt hợp đồng "${confirmTarget.contract_number}" cho nhân viên "${confirmTarget.employee_name}"? Sau khi kích hoạt, hợp đồng sẽ có hiệu lực chính thức.`
                      : `Xác nhận hủy hợp đồng "${confirmTarget.contract_number}"? Hành động này không thể hoàn tác.`}
                  </p>
                </div>
              </div>

              <div
                className="modal-footer"
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '16px 20px',
                  borderTop: '1px solid var(--border-default)',
                  margin: 0,
                }}
              >
                <button
                  className="btn btn-secondary"
                  onClick={() => setConfirmAction(null)}
                  disabled={confirmLoading}
                >
                  Đóng
                </button>
                <button
                  className={confirmAction === 'cancel' ? 'btn btn-danger' : 'btn btn-primary'}
                  onClick={handleConfirmAction}
                  disabled={confirmLoading}
                >
                  {confirmLoading ? 'Đang xử lý...' : 'Xác nhận'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Contract Form Dialog (Create / Edit) */}
      <ContractFormDialog
        open={showFormModal}
        contract={editingContract}
        employees={employees}
        positions={lookups?.positions || []}
        departments={lookups?.departments || []}
        onClose={() => {
          setShowFormModal(false)
          setEditingContract(null)
        }}
        onSuccess={() => {
          setShowFormModal(false)
          setEditingContract(null)
          fetchContracts()
          fetchStats()
        }}
      />

      {/* Contract Renew Dialog */}
      <ContractRenewDialog
        open={showRenewModal}
        contract={selectedContract}
        onClose={() => {
          setShowRenewModal(false)
          setSelectedContract(null)
        }}
        onSuccess={() => {
          setShowRenewModal(false)
          setSelectedContract(null)
          fetchContracts()
          fetchStats()
        }}
      />

      {/* Contract Terminate Dialog */}
      <ContractTerminateDialog
        open={showTerminateModal}
        contract={selectedContract}
        onClose={() => {
          setShowTerminateModal(false)
          setSelectedContract(null)
        }}
        onSuccess={() => {
          setShowTerminateModal(false)
          setSelectedContract(null)
          fetchContracts()
          fetchStats()
        }}
      />
    </div>
  )
}

export default ContractManagementPage
