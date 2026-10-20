import { useEffect, useState, useMemo } from 'react'
import { toast } from 'sonner'
import { roleApi, userApi, employeeApi } from '../services/api'
import type { Role, User, Employee, UserCreate } from '../types'
import { useAuth } from '../contexts/AuthContext'
import { formatDateTime, getInitials } from '../utils/formatters'
import { Icons } from '../components/common/Icons'
import { EmployeeSearchSelect } from '../components/common/EmployeeSearchSelect'
import { Pencil, KeyRound, Lock, Unlock, Trash2 } from 'lucide-react'
import './UserAccessPage.css'

interface UserAccessPageProps {
  currentUserId: number
}

type ModalType = 'create' | 'edit' | 'reset-password' | 'delete' | null

export function UserAccessPage({ currentUserId }: UserAccessPageProps) {
  const { user: currentUser } = useAuth()
  const isAdmin = Boolean(currentUser?.roles?.includes('ADMIN'))

  const [users, setUsers] = useState<User[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [selectedRoles, setSelectedRoles] = useState<Record<number, number>>({})
  const [busyId, setBusyId] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'locked'>('all')
  const [linkedFilter, setLinkedFilter] = useState<'all' | 'linked' | 'unlinked'>('all')
  const [roleFilter, setRoleFilter] = useState<string>('all')

  // Modals state
  const [activeModal, setActiveModal] = useState<ModalType>(null)
  const [targetUser, setTargetUser] = useState<User | null>(null)

  // Form state for Create User (1 tài khoản 1 vai trò)
  const [createForm, setCreateForm] = useState<UserCreate>({
    username: '',
    password: '',
    email: '',
    phone: '',
    employee_id: null,
    role_id: 4,
    role_ids: [4], // Default EMPLOYEE
  })

  // Form state for Edit User
  const [editForm, setEditForm] = useState<{
    email: string
    phone: string
    employee_id: number | null
    role_id: number
  }>({
    email: '',
    phone: '',
    employee_id: null,
    role_id: 4,
  })

  // Form state for Reset Password
  const [resetPasswordForm, setResetPasswordForm] = useState({
    newPassword: '',
    confirmPassword: '',
  })

  // Load all initial data
  const loadData = async () => {
    setIsLoading(true)
    try {
      const [accounts, availableRoles, employeeList] = await Promise.all([
        userApi.getAll(),
        roleApi.getAll(),
        employeeApi.getAll(),
      ])
      setUsers(accounts)
      setRoles(availableRoles)
      setEmployees(employeeList)

      // Map single primary role to ID for each user (1 tài khoản 1 vai trò)
      const initialRoleMap: Record<number, number> = {}
      for (const account of accounts) {
        const primaryRoleCode = account.roles?.[0]
        const found = availableRoles.find(role => role.role_code === primaryRoleCode)
        initialRoleMap[account.user_id] = found ? found.role_id : 4
      }
      setSelectedRoles(initialRoleMap)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không tải được danh sách tài khoản')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  // Filtered users
  const filteredUsers = useMemo(() => {
    return users.filter(account => {
      const searchLower = search.toLowerCase()
      const matchSearch =
        account.username.toLowerCase().includes(searchLower) ||
        (account.full_name || '').toLowerCase().includes(searchLower) ||
        (account.employee_code || '').toLowerCase().includes(searchLower) ||
        account.email.toLowerCase().includes(searchLower) ||
        (account.phone || '').includes(searchLower)

      const matchStatus =
        statusFilter === 'all'
          ? true
          : statusFilter === 'active'
          ? account.is_active
          : !account.is_active

      const matchRole =
        roleFilter === 'all' ? true : account.roles.includes(roleFilter)

      const matchLinked =
        linkedFilter === 'all'
          ? true
          : linkedFilter === 'linked'
          ? Boolean(account.employee_id)
          : !account.employee_id

      return matchSearch && matchStatus && matchRole && matchLinked
    })
  }, [users, search, statusFilter, roleFilter, linkedFilter])

  // Statistics
  const stats = useMemo(() => {
    const total = users.length
    const active = users.filter(u => u.is_active).length
    const locked = total - active
    const linked = users.filter(u => u.employee_id).length
    return { total, active, locked, linked }
  }, [users])

  // KPI cards matching StoreManagementPage
  const kpis = [
    {
      label: 'Tổng tài khoản',
      value: stats.total,
      icon: Icons.users,
      action: () => {
        setStatusFilter('all')
        setLinkedFilter('all')
      },
      active: statusFilter === 'all' && linkedFilter === 'all',
    },
    {
      label: 'Đang hoạt động',
      value: stats.active,
      icon: Icons.checkCircle,
      action: () => {
        setLinkedFilter('all')
        setStatusFilter(prev => prev === 'active' ? 'all' : 'active')
      },
      active: statusFilter === 'active',
    },
    {
      label: 'Đã bị khóa',
      value: stats.locked,
      icon: Icons.lock,
      action: () => {
        setLinkedFilter('all')
        setStatusFilter(prev => prev === 'locked' ? 'all' : 'locked')
      },
      active: statusFilter === 'locked',
    },
    {
      label: 'Đã liên kết nhân sự',
      value: `${stats.linked} / ${stats.total}`,
      icon: Icons.user,
      action: () => {
        setStatusFilter('all')
        setLinkedFilter(prev => prev === 'linked' ? 'all' : 'linked')
      },
      active: linkedFilter === 'linked',
    },
  ]

  // Employees already linked to a user
  const linkedEmployeeIds = useMemo(() => {
    const map = new Map<number, string>()
    for (const u of users) {
      if (u.employee_id) {
        map.set(u.employee_id, u.username)
      }
    }
    return map
  }, [users])

  // Selected employee objects for modal display
  const selectedCreateEmp = useMemo(() => {
    if (!createForm.employee_id) return null
    return employees.find(e => e.employee_id === createForm.employee_id) || null
  }, [employees, createForm.employee_id])

  const selectedEditEmp = useMemo(() => {
    if (!editForm.employee_id) return null
    return employees.find(e => e.employee_id === editForm.employee_id) || null
  }, [employees, editForm.employee_id])

  // Handle direct role change from table (1 tài khoản 1 vai trò)
  const handleRoleSelectChange = async (account: User, newRoleId: number) => {
    if (!isAdmin) {
      toast.error('Chỉ Quản trị viên (ADMIN) mới có quyền cập nhật vai trò')
      return
    }
    const targetRole = roles.find(r => r.role_id === newRoleId)
    if (!targetRole) return

    if (account.user_id === currentUserId && targetRole.role_code !== 'ADMIN') {
      toast.warning('Không thể tự gỡ quyền Quản trị viên của chính mình')
      return
    }

    setSelectedRoles(prev => ({ ...prev, [account.user_id]: newRoleId }))
    setBusyId(account.user_id)
    try {
      await userApi.updateRoles(account.user_id, [newRoleId])
      toast.success(`Đã cập nhật vai trò của ${account.username} thành "${targetRole.role_name}"`)
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không cập nhật được vai trò')
      await loadData()
    } finally {
      setBusyId(null)
    }
  }

  // Toggle active status (Lock / Unlock)
  const handleToggleStatus = async (account: User) => {
    if (!isAdmin) {
      toast.error('Chỉ Quản trị viên (ADMIN) mới có quyền khóa/mở khóa tài khoản')
      return
    }
    if (account.user_id === currentUserId && account.is_active) {
      toast.warning('Bạn không thể tự khóa tài khoản của chính mình')
      return
    }

    const nextState = !account.is_active
    const actionText = nextState ? 'mở khóa' : 'khóa'

    setBusyId(account.user_id)
    try {
      await userApi.updateStatus(account.user_id, nextState)
      toast.success(`Đã ${actionText} tài khoản ${account.username}`)
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Không thể ${actionText} tài khoản`)
    } finally {
      setBusyId(null)
    }
  }

  // Open Create Modal
  const openCreateModal = () => {
    setCreateForm({
      username: '',
      password: '',
      email: '',
      phone: '',
      employee_id: null,
      role_id: 4,
      role_ids: [4],
    })
    setActiveModal('create')
  }

  // Submit Create User
  const handleSubmitCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!createForm.username.trim() || !createForm.password.trim() || !createForm.email.trim()) {
      toast.warning('Vui lòng điền đầy đủ tên đăng nhập, mật khẩu và email')
      return
    }
    if (createForm.password.length < 6) {
      toast.warning('Mật khẩu cần tối thiểu 6 ký tự')
      return
    }

    const selectedRoleId = createForm.role_id || createForm.role_ids?.[0] || 4

    setBusyId(-1)
    try {
      await userApi.create({
        username: createForm.username.trim(),
        password: createForm.password,
        email: createForm.email.trim(),
        phone: createForm.phone?.trim() || undefined,
        employee_id: createForm.employee_id ? Number(createForm.employee_id) : undefined,
        role_id: selectedRoleId,
        role_ids: [selectedRoleId],
      })
      toast.success(`Tạo tài khoản '${createForm.username}' thành công`)
      setActiveModal(null)
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Tạo tài khoản thất bại')
    } finally {
      setBusyId(null)
    }
  }

  // Open Edit Modal
  const openEditModal = (account: User) => {
    setTargetUser(account)
    const primaryRole = roles.find(r => account.roles.includes(r.role_code))
    setEditForm({
      email: account.email || '',
      phone: account.phone || '',
      employee_id: account.employee_id || null,
      role_id: primaryRole ? primaryRole.role_id : (selectedRoles[account.user_id] || 4),
    })
    setActiveModal('edit')
  }

  // Submit Edit User
  const handleSubmitEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!targetUser) return
    if (!editForm.email.trim()) {
      toast.warning('Email không được để trống')
      return
    }

    setBusyId(targetUser.user_id)
    try {
      await userApi.update(targetUser.user_id, {
        email: editForm.email.trim(),
        phone: editForm.phone.trim() || null,
        employee_id: editForm.employee_id ? Number(editForm.employee_id) : 0,
        role_id: editForm.role_id,
        role_ids: [editForm.role_id],
      })
      toast.success(`Cập nhật thông tin tài khoản '${targetUser.username}' thành công`)
      setActiveModal(null)
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Cập nhật tài khoản thất bại')
    } finally {
      setBusyId(null)
    }
  }

  // Open Reset Password Modal
  const openResetPasswordModal = (account: User) => {
    setTargetUser(account)
    setResetPasswordForm({
      newPassword: '',
      confirmPassword: '',
    })
    setActiveModal('reset-password')
  }

  // Submit Reset Password
  const handleSubmitResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!targetUser) return
    if (resetPasswordForm.newPassword.length < 6) {
      toast.warning('Mật khẩu mới phải có ít nhất 6 ký tự')
      return
    }
    if (resetPasswordForm.newPassword !== resetPasswordForm.confirmPassword) {
      toast.warning('Xác nhận mật khẩu không trùng khớp')
      return
    }

    setBusyId(targetUser.user_id)
    try {
      const res = await userApi.resetPassword(targetUser.user_id, resetPasswordForm.newPassword)
      toast.success(res.message || `Đã đặt lại mật khẩu cho tài khoản '${targetUser.username}'`)
      setActiveModal(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Đặt lại mật khẩu thất bại')
    } finally {
      setBusyId(null)
    }
  }

  // Open Delete Modal
  const openDeleteModal = (account: User) => {
    if (account.user_id === currentUserId) {
      toast.warning('Bạn không thể tự xóa tài khoản của chính mình')
      return
    }
    setTargetUser(account)
    setActiveModal('delete')
  }

  // Submit Delete User
  const handleSubmitDelete = async () => {
    if (!targetUser) return
    setBusyId(targetUser.user_id)
    try {
      const res = await userApi.delete(targetUser.user_id)
      if (res.action === 'DEACTIVATED') {
        toast.info(res.message)
      } else {
        toast.success(res.message)
      }
      setActiveModal(null)
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Xóa tài khoản thất bại')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="page-container">
      {/* Page Header matching standard pages */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 className="page-title">Quản lý Tài khoản & Phân quyền</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
            Quản trị danh sách người dùng, vai trò truy cập và liên kết hồ sơ nhân sự.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={loadData}
            disabled={isLoading}
            title="Làm mới dữ liệu"
          >
            {Icons.refresh} Làm mới
          </button>

          {isAdmin && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={openCreateModal}
            >
              {Icons.plus} Thêm tài khoản
            </button>
          )}
        </div>
      </div>

      {/* Notice for non-admin */}
      {!isAdmin && (
        <div style={{
          padding: '10px 14px',
          background: 'var(--surface-hover)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-sm)',
          marginBottom: 16,
          color: 'var(--text-secondary)',
          fontSize: 13
        }}>
          ℹ️ <strong>Chế độ chỉ xem:</strong> Chỉ Quản trị viên (ADMIN) mới có thẩm quyền phân quyền và chỉnh sửa trạng thái tài khoản.
        </div>
      )}

      {/* Store-style KPI Stats Grid */}
      <section className="store-kpi-grid" aria-label="Thống kê tài khoản">
        {kpis.map(kpi => (
          <button
            key={kpi.label}
            type="button"
            className={`store-kpi-card ${kpi.active ? 'selected' : ''}`}
            onClick={kpi.action}
            aria-pressed={kpi.active}
          >
            <span className="store-kpi-icon">{kpi.icon}</span>
            <span className="store-kpi-label">{kpi.label}</span>
            <strong>{kpi.value}</strong>
            <span className="store-kpi-hint">Nhấn để lọc danh sách</span>
          </button>
        ))}
      </section>

      {/* Filter and Search Bar */}
      <div className="card" style={{ padding: '14px 16px', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: '1 1 240px' }}>
            <input
              type="text"
              className="form-input"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Tìm theo username, họ tên, mã nhân viên, email..."
            />
          </div>

          <div style={{ width: 160 }}>
            <select
              className="form-select"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as any)}
            >
              <option value="all">Trạng thái: Tất cả</option>
              <option value="active">Đang hoạt động</option>
              <option value="locked">Đã khóa</option>
            </select>
          </div>

          <div style={{ width: 170 }}>
            <select
              className="form-select"
              value={linkedFilter}
              onChange={e => setLinkedFilter(e.target.value as any)}
            >
              <option value="all">Nhân sự: Tất cả</option>
              <option value="linked">Đã liên kết nhân sự</option>
              <option value="unlinked">Chưa liên kết</option>
            </select>
          </div>

          <div style={{ width: 170 }}>
            <select
              className="form-select"
              value={roleFilter}
              onChange={e => setRoleFilter(e.target.value)}
            >
              <option value="all">Vai trò: Tất cả</option>
              {roles.map(r => (
                <option key={r.role_id} value={r.role_code}>{r.role_name}</option>
              ))}
            </select>
          </div>

          {(search || statusFilter !== 'all' || roleFilter !== 'all' || linkedFilter !== 'all') && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setSearch('')
                setStatusFilter('all')
                setRoleFilter('all')
                setLinkedFilter('all')
              }}
            >
              Đặt lại
            </button>
          )}
        </div>
      </div>

      {/* Users Data Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-container" style={{ margin: 0 }}>
          <table className="data-table" style={{ width: '100%', tableLayout: 'fixed', minWidth: 920 }}>
            <thead>
              <tr>
                <th style={{ width: isAdmin ? '24%' : '30%' }}>Tài khoản</th>
                <th style={{ width: isAdmin ? '28%' : '34%' }}>Nhân sự liên kết</th>
                <th style={{ width: isAdmin ? '18%' : '20%' }}>Vai trò</th>
                <th style={{ width: isAdmin ? '15%' : '16%' }}>Trạng thái</th>
                {isAdmin && <th style={{ width: '15%', textAlign: 'center' }}>Thao tác</th>}
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 5 : 4} style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--text-secondary)' }}>
                    Không tìm thấy tài khoản người dùng nào phù hợp.
                  </td>
                </tr>
              ) : (
                filteredUsers.map(account => {
                  const isCurrent = account.user_id === currentUserId

                  return (
                    <tr key={account.user_id}>
                      {/* Column 1: Account */}
                      <td>
                        <div className="table-user-cell" style={{ minWidth: 0 }}>
                          <div className="table-user-avatar" style={{ flexShrink: 0 }}>
                            {getInitials(account.full_name || account.username)}
                          </div>
                          <div className="table-user-details" style={{ minWidth: 0, overflow: 'hidden' }}>
                            <span className="table-user-name" style={{ display: 'flex', alignItems: 'center' }}>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {account.username}
                              </span>
                              {isCurrent && (
                                <span style={{
                                  marginLeft: 6,
                                  fontSize: 11,
                                  background: 'var(--surface-hover)',
                                  color: 'var(--text-secondary)',
                                  padding: '1px 5px',
                                  borderRadius: 4,
                                  flexShrink: 0,
                                }}>
                                  Bạn
                                </span>
                              )}
                            </span>
                            <span className="table-user-sub" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {account.email}
                            </span>
                            {account.phone && (
                              <span className="table-user-sub" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                SĐT: {account.phone}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Column 2: Linked Employee */}
                      <td>
                        {account.employee_id ? (
                          <div style={{ minWidth: 0 }}>
                            <div style={{
                              fontWeight: 500,
                              color: 'var(--text-primary)',
                              fontSize: 13,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}>
                              {account.full_name}
                            </div>
                            <span className="table-cell-mono">
                              {account.employee_code || `NV-${account.employee_id}`}
                            </span>
                            {(account.department_name || account.store_name) && (
                              <div style={{
                                fontSize: 11.5,
                                color: 'var(--text-secondary)',
                                marginTop: 2,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}>
                                {[account.department_name, account.store_name].filter(Boolean).join(' • ')}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                            Chưa liên kết
                          </span>
                        )}
                      </td>

                      {/* Column 3: Vai trò (1 tài khoản 1 vai trò duy nhất) */}
                      <td>
                        {isAdmin ? (
                          <select
                            className="form-select form-select-sm"
                            value={selectedRoles[account.user_id] || ''}
                            disabled={busyId === account.user_id}
                            onChange={e => handleRoleSelectChange(account, Number(e.target.value))}
                            style={{
                              fontSize: '12.5px',
                              padding: '5px 8px',
                              borderRadius: '6px',
                              width: '100%',
                              background: 'var(--surface-input, var(--surface-card))',
                              borderColor: 'var(--border-subtle)',
                              cursor: 'pointer',
                              fontWeight: 500,
                            }}
                            title="Chọn vai trò cho tài khoản"
                          >
                            {roles.map(r => (
                              <option key={r.role_id} value={r.role_id}>
                                {r.role_name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              padding: '3px 8px',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: 500,
                              background: 'var(--surface-subtle)',
                              color: 'var(--text-primary)',
                              border: '1px solid var(--border-subtle)',
                              maxWidth: '100%',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {roles.find(r => r.role_code === account.roles[0])?.role_name || account.roles[0] || 'Chưa phân quyền'}
                          </span>
                        )}
                      </td>

                      {/* Column 4: Status & Last login (Trái cột Thao tác) */}
                      <td>
                        <span className={`badge-status ${account.is_active ? 'running' : 'rejected'}`}>
                          {account.is_active ? 'Hoạt động' : 'Đã khóa'}
                        </span>
                        <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 4, whiteSpace: 'nowrap' }}>
                          {account.last_login ? formatDateTime(account.last_login) : 'Chưa đăng nhập'}
                        </div>
                      </td>

                      {/* Column 5: Actions */}
                      {isAdmin && (
                        <td style={{ textAlign: 'center' }}>
                          <div className="user-row-actions">
                            <button
                              type="button"
                              className="user-icon-action"
                              onClick={() => openEditModal(account)}
                              disabled={busyId === account.user_id}
                              title="Sửa thông tin tài khoản"
                              aria-label="Sửa thông tin tài khoản"
                            >
                              <Pencil size={15} />
                            </button>

                            <button
                              type="button"
                              className="user-icon-action"
                              onClick={() => openResetPasswordModal(account)}
                              disabled={busyId === account.user_id}
                              title="Đặt lại mật khẩu"
                              aria-label="Đặt lại mật khẩu"
                            >
                              <KeyRound size={15} />
                            </button>

                            <button
                              type="button"
                              className="user-icon-action"
                              onClick={() => handleToggleStatus(account)}
                              disabled={busyId === account.user_id || (isCurrent && account.is_active)}
                              title={account.is_active ? 'Khóa tài khoản' : 'Mở khóa tài khoản'}
                              aria-label={account.is_active ? 'Khóa tài khoản' : 'Mở khóa tài khoản'}
                            >
                              {account.is_active ? <Lock size={15} /> : <Unlock size={15} />}
                            </button>

                            <button
                              type="button"
                              className="user-icon-action danger"
                              onClick={() => openDeleteModal(account)}
                              disabled={busyId === account.user_id || isCurrent}
                              title="Xóa tài khoản"
                              aria-label="Xóa tài khoản"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Roles & Permissions Reference Panel */}
      <div className="card" style={{ padding: 16, marginTop: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 10px', color: 'var(--text-primary)' }}>
          Vai trò trong hệ thống
        </h2>
        <div className="table-container" style={{ margin: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 220 }}>Vai trò</th>
                <th>Quyền được khai báo</th>
              </tr>
            </thead>
            <tbody>
              {roles.map(role => (
                <tr key={role.role_id}>
                  <td>
                    <strong>{role.role_name}</strong>
                    <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                      {role.role_code}
                    </div>
                  </td>
                  <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {role.permissions && role.permissions.length > 0
                      ? role.permissions.join(', ')
                      : 'Khai báo theo chính sách bảo mật RBAC.'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ========================================================== */}
      {/* MODAL 1: CREATE USER                                       */}
      {/* ========================================================== */}
      {activeModal === 'create' && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <form onSubmit={handleSubmitCreate}>
              <div className="modal-header">
                <h3 className="modal-title">Tạo tài khoản người dùng mới</h3>
                <button type="button" className="modal-close" onClick={() => setActiveModal(null)}>
                  ✕
                </button>
              </div>

              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-group">
                  <label className="form-label">
                    Tên đăng nhập <span style={{ color: 'var(--status-danger-text)' }}>*</span>
                  </label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    placeholder="ví dụ: nva_sale"
                    value={createForm.username}
                    onChange={e => setCreateForm({ ...createForm, username: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">
                    Mật khẩu ban đầu <span style={{ color: 'var(--status-danger-text)' }}>*</span>
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    className="form-input"
                    placeholder="Tối thiểu 6 ký tự"
                    value={createForm.password}
                    onChange={e => setCreateForm({ ...createForm, password: e.target.value })}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">
                      Email <span style={{ color: 'var(--status-danger-text)' }}>*</span>
                    </label>
                    <input
                      type="email"
                      required
                      className="form-input"
                      placeholder="user@techzone.vn"
                      value={createForm.email}
                      onChange={e => setCreateForm({ ...createForm, email: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Số điện thoại</label>
                    <input
                      type="tel"
                      className="form-input"
                      placeholder="0987654321"
                      value={createForm.phone || ''}
                      onChange={e => setCreateForm({ ...createForm, phone: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <EmployeeSearchSelect
                    employees={employees}
                    value={createForm.employee_id}
                    onChange={(id, emp) => {
                      setCreateForm(prev => ({
                        ...prev,
                        employee_id: id,
                        email: prev.email || (emp?.email || ''),
                        phone: prev.phone || (emp?.phone || ''),
                      }))
                    }}
                    label="Hồ sơ nhân viên liên kết"
                    placeholder="Tìm theo họ tên, mã NV, phòng ban, chức vụ..."
                    clearOptionLabel="-- Không liên kết hồ sơ nhân sự --"
                    getItemDisabled={emp => Boolean(linkedEmployeeIds.get(emp.employee_id))}
                    getItemBadge={emp => {
                      const linked = linkedEmployeeIds.get(emp.employee_id)
                      if (linked) {
                        return {
                          text: `Đã có: ${linked}`,
                          color: '#b45309',
                          backgroundColor: 'rgba(245, 158, 11, 0.1)',
                          border: '1px solid rgba(245, 158, 11, 0.25)',
                        }
                      }
                      return null
                    }}
                  />
                  {selectedCreateEmp && (
                    <div
                      style={{
                        fontSize: '0.8rem',
                        color: 'var(--text-secondary)',
                        marginTop: '6px',
                        display: 'flex',
                        gap: '10px',
                        flexWrap: 'wrap',
                        backgroundColor: 'var(--surface-ground)',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <span>Mã NV: <strong>{selectedCreateEmp.employee_code || `#${selectedCreateEmp.employee_id}`}</strong></span>
                      {selectedCreateEmp.department_name && <span>Phòng ban: <strong>{selectedCreateEmp.department_name}</strong></span>}
                      {selectedCreateEmp.store_name && <span>Chi nhánh: <strong>{selectedCreateEmp.store_name}</strong></span>}
                      {selectedCreateEmp.position_name && <span>Chức vụ: <strong>{selectedCreateEmp.position_name}</strong></span>}
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label">
                    Vai trò <span style={{ color: 'var(--status-danger-text)' }}>*</span>
                  </label>
                  <select
                    className="form-select"
                    value={createForm.role_id || createForm.role_ids?.[0] || 4}
                    onChange={e => {
                      const rid = Number(e.target.value)
                      setCreateForm({ ...createForm, role_id: rid, role_ids: [rid] })
                    }}
                    required
                  >
                    {roles.map(r => (
                      <option key={r.role_id} value={r.role_id}>
                        {r.role_name} ({r.role_code})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setActiveModal(null)}>
                  Hủy
                </button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={busyId === -1}>
                  {busyId === -1 ? 'Đang tạo...' : 'Tạo tài khoản'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================== */}
      {/* MODAL 2: EDIT USER                                         */}
      {/* ========================================================== */}
      {activeModal === 'edit' && targetUser && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <form onSubmit={handleSubmitEdit}>
              <div className="modal-header">
                <h3 className="modal-title">Sửa tài khoản: {targetUser.username}</h3>
                <button type="button" className="modal-close" onClick={() => setActiveModal(null)}>
                  ✕
                </button>
              </div>

              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-group">
                  <label className="form-label">Tên đăng nhập</label>
                  <input
                    type="text"
                    disabled
                    className="form-input"
                    value={targetUser.username}
                    style={{ background: 'var(--surface-hover)', cursor: 'not-allowed' }}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">
                    Email <span style={{ color: 'var(--status-danger-text)' }}>*</span>
                  </label>
                  <input
                    type="email"
                    required
                    className="form-input"
                    value={editForm.email}
                    onChange={e => setEditForm({ ...editForm, email: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Số điện thoại</label>
                  <input
                    type="tel"
                    className="form-input"
                    placeholder="0987654321"
                    value={editForm.phone}
                    onChange={e => setEditForm({ ...editForm, phone: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <EmployeeSearchSelect
                    employees={employees}
                    value={editForm.employee_id}
                    onChange={(id, emp) => {
                      setEditForm(prev => ({
                        ...prev,
                        employee_id: id,
                        email: prev.email || (emp?.email || ''),
                        phone: prev.phone || (emp?.phone || ''),
                      }))
                    }}
                    label="Hồ sơ nhân viên liên kết"
                    placeholder="Tìm theo họ tên, mã NV, phòng ban, chức vụ..."
                    clearOptionLabel="-- Không liên kết hồ sơ nhân sự --"
                    getItemDisabled={emp => {
                      const linked = linkedEmployeeIds.get(emp.employee_id)
                      return Boolean(linked && linked !== targetUser.username)
                    }}
                    getItemBadge={emp => {
                      const linked = linkedEmployeeIds.get(emp.employee_id)
                      if (linked === targetUser.username) {
                        return {
                          text: '✓ Đang liên kết',
                          color: '#059669',
                          backgroundColor: 'rgba(16, 185, 129, 0.1)',
                          border: '1px solid rgba(16, 185, 129, 0.25)',
                        }
                      }
                      if (linked) {
                        return {
                          text: `Đã có: ${linked}`,
                          color: '#b45309',
                          backgroundColor: 'rgba(245, 158, 11, 0.1)',
                          border: '1px solid rgba(245, 158, 11, 0.25)',
                        }
                      }
                      return null
                    }}
                  />
                  {selectedEditEmp && (
                    <div
                      style={{
                        fontSize: '0.8rem',
                        color: 'var(--text-secondary)',
                        marginTop: '6px',
                        display: 'flex',
                        gap: '10px',
                        flexWrap: 'wrap',
                        backgroundColor: 'var(--surface-ground)',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <span>Mã NV: <strong>{selectedEditEmp.employee_code || `#${selectedEditEmp.employee_id}`}</strong></span>
                      {selectedEditEmp.department_name && <span>Phòng ban: <strong>{selectedEditEmp.department_name}</strong></span>}
                      {selectedEditEmp.store_name && <span>Chi nhánh: <strong>{selectedEditEmp.store_name}</strong></span>}
                      {selectedEditEmp.position_name && <span>Chức vụ: <strong>{selectedEditEmp.position_name}</strong></span>}
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label">
                    Vai trò tài khoản <span style={{ color: 'var(--status-danger-text)' }}>*</span>
                  </label>
                  <select
                    className="form-select"
                    value={editForm.role_id}
                    onChange={e => setEditForm({ ...editForm, role_id: Number(e.target.value) })}
                    disabled={targetUser.user_id === currentUserId}
                  >
                    {roles.map(r => (
                      <option key={r.role_id} value={r.role_id}>
                        {r.role_name} ({r.role_code})
                      </option>
                    ))}
                  </select>
                  {targetUser.user_id === currentUserId && (
                    <small style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 3, display: 'block' }}>
                      (Không thể tự thay đổi vai trò của tài khoản đang đăng nhập)
                    </small>
                  )}
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setActiveModal(null)}>
                  Hủy
                </button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={busyId === targetUser.user_id}>
                  {busyId === targetUser.user_id ? 'Đang lưu...' : 'Lưu cập nhật'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================== */}
      {/* MODAL 3: RESET PASSWORD                                    */}
      {/* ========================================================== */}
      {activeModal === 'reset-password' && targetUser && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <form onSubmit={handleSubmitResetPassword}>
              <div className="modal-header">
                <h3 className="modal-title">Đặt lại mật khẩu</h3>
                <button type="button" className="modal-close" onClick={() => setActiveModal(null)}>
                  ✕
                </button>
              </div>

              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                  Đặt lại mật khẩu cho tài khoản: <strong>{targetUser.username}</strong>
                </p>

                <div className="form-group">
                  <label className="form-label">
                    Mật khẩu mới <span style={{ color: 'var(--status-danger-text)' }}>*</span>
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    className="form-input"
                    placeholder="Tối thiểu 6 ký tự"
                    value={resetPasswordForm.newPassword}
                    onChange={e => setResetPasswordForm({ ...resetPasswordForm, newPassword: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">
                    Xác nhận mật khẩu mới <span style={{ color: 'var(--status-danger-text)' }}>*</span>
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    className="form-input"
                    placeholder="Nhập lại mật khẩu mới"
                    value={resetPasswordForm.confirmPassword}
                    onChange={e => setResetPasswordForm({ ...resetPasswordForm, confirmPassword: e.target.value })}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setActiveModal(null)}>
                  Hủy
                </button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={busyId === targetUser.user_id}>
                  {busyId === targetUser.user_id ? 'Đang đặt lại...' : 'Xác nhận đổi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================== */}
      {/* MODAL 4: CONFIRM DELETE USER                               */}
      {/* ========================================================== */}
      {activeModal === 'delete' && targetUser && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal" style={{ maxWidth: 450 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Xác nhận xóa tài khoản</h3>
              <button type="button" className="modal-close" onClick={() => setActiveModal(null)}>
                ✕
              </button>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-primary)' }}>
                Bạn có chắc chắn muốn xóa tài khoản <strong>'{targetUser.username}'</strong>?
              </p>

              <div style={{
                padding: '10px 12px',
                background: 'var(--surface-hover)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 12.5,
                color: 'var(--text-secondary)'
              }}>
                Nếu tài khoản đã từng tạo hợp đồng hoặc duyệt đơn, hệ thống sẽ tự động chuyển sang trạng thái <strong>Khóa tài khoản</strong> để bảo toàn dữ liệu kiểm toán.
              </div>
            </div>

            <div className="modal-footer">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setActiveModal(null)}>
                Hủy
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={busyId === targetUser.user_id}
                onClick={handleSubmitDelete}
              >
                {busyId === targetUser.user_id ? 'Đang xử lý...' : 'Xác nhận'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
