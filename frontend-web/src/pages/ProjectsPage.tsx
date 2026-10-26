import { useState, useEffect, useMemo, useCallback } from 'react'
import { payrollApi, employeeApi } from '../services/api'
import { formatCurrency, formatDate } from '../utils/formatters'
import { Icons } from '../components/common/Icons'
import { StatCard } from '../components/common/StatCard'
import { EmployeeSearchSelect } from '../components/common/EmployeeSearchSelect'
import { EmptyState } from '../components/common/EmptyState'
import { toast } from 'sonner'
import { useAuth } from '../contexts/AuthContext'
import type { Project, ProjectRole, ProjectRoleAllowance, Employee } from '../types'

export function ProjectsPage({ personal = false }: { personal?: boolean }) {
  const { user } = useAuth()
  const userRoles = useMemo(() => user?.roles || [], [user])
  const canManage = userRoles.some(r => ['ADMIN', 'HR_MANAGER', 'DIRECTOR'].includes(r))
  const isStoreManager = userRoles.includes('STORE_MANAGER')
  const hasManagementView = canManage || isStoreManager
  const currentEmployeeId = user?.employee_id

  // View: nếu personal=true thì cố định là 'my' (Dự án của tôi); nếu personal=false thì là 'manage' (Quản lý dự án)
  const activeTab: 'my' | 'manage' = personal ? 'my' : 'manage'
  const [openMemberMenuId, setOpenMemberMenuId] = useState<number | null>(null)

  // Đóng action dropdown khi click ra ngoài
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.action-dropdown') && !target.closest('.btn-icon')) {
        setOpenMemberMenuId(null)
      }
    }
    document.addEventListener('click', handleGlobalClick)
    return () => document.removeEventListener('click', handleGlobalClick)
  }, [])

  // Main state
  const [projects, setProjects] = useState<Project[]>([])
  const [projectRoles, setProjectRoles] = useState<ProjectRole[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'IN_PROGRESS' | 'PLANNING' | 'COMPLETED'>('ALL')
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)

  // Modals state
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false)
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false)
  const [isAllowanceModalOpen, setIsAllowanceModalOpen] = useState(false)
  const [isRoleDirectoryOpen, setIsRoleDirectoryOpen] = useState(false)
  const [targetProject, setTargetProject] = useState<Project | null>(null)

  // Form: Tạo dự án mới
  const [newProjectCode, setNewProjectCode] = useState('')
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDesc, setNewProjectDesc] = useState('')
  const [newProjectStartDate, setNewProjectStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [newProjectEndDate, setNewProjectEndDate] = useState('')
  const [newProjectStatus, setNewProjectStatus] = useState('IN_PROGRESS')
  const [newProjectBudget, setNewProjectBudget] = useState<number>(0)
  const [savingProject, setSavingProject] = useState(false)

  // Form: Thêm thành viên
  const [newMemberEmpId, setNewMemberEmpId] = useState<number | ''>('')
  const [newMemberRole, setNewMemberRole] = useState<string>('CORE_MEMBER')
  const [newMemberAllowance, setNewMemberAllowance] = useState<number>(1500000)
  const [newMemberJoinedDate, setNewMemberJoinedDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [savingMember, setSavingMember] = useState(false)

  // Form: Chỉnh sửa định mức vai trò dự án
  const [allowanceFormMap, setAllowanceFormMap] = useState<Record<string, { amount: number; notes: string }>>({})
  const [savingAllowances, setSavingAllowances] = useState(false)

  // Form: Tạo vai trò nội bộ mới
  const [newRoleCode, setNewRoleCode] = useState('')
  const [newRoleName, setNewRoleName] = useState('')
  const [newRoleDesc, setNewRoleDesc] = useState('')
  const [savingNewRole, setSavingNewRole] = useState(false)

  // Tải dữ liệu toàn bộ
  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [projList, rolesList, empList] = await Promise.all([
        payrollApi.getProjects(),
        payrollApi.getProjectRoles(),
        hasManagementView ? employeeApi.getAll() : Promise.resolve([]),
      ])
      setProjects(projList || [])
      setProjectRoles(rolesList || [])
      setEmployees(empList || [])
      if (projList && projList.length > 0 && selectedProjectId === null) {
        setSelectedProjectId(projList[0].project_id)
      }
    } catch (err: any) {
      console.error('Error fetching project data:', err)
      toast.error('Không thể tải thông tin dự án')
    } finally {
      setLoading(false)
    }
  }, [hasManagementView, selectedProjectId])

  useEffect(() => {
    fetchData()
  }, [])

  // Dự án của cá nhân nhân sự đang đăng nhập
  const myProjects = useMemo(() => {
    if (!currentEmployeeId) return []
    return projects.filter(p => p.members?.some(m => m.employee_id === currentEmployeeId))
  }, [projects, currentEmployeeId])

  const myTotalAllowance = useMemo(() => {
    if (!currentEmployeeId) return 0
    return myProjects.reduce((sum, p) => {
      const myMembership = p.members?.find(m => m.employee_id === currentEmployeeId)
      return sum + (Number(myMembership?.project_allowance) || 0)
    }, 0)
  }, [myProjects, currentEmployeeId])

  // Quick Metrics Quản trị
  const metrics = useMemo(() => {
    const totalProjects = projects.length
    const activeProjects = projects.filter(p => p.status === 'IN_PROGRESS' || p.status === 'ACTIVE').length
    const totalMembers = projects.reduce((sum, p) => sum + (p.members?.length || 0), 0)
    const totalMonthlyAllowance = projects.reduce((sum, p) => {
      const pSum = (p.members || []).reduce((mSum, m) => mSum + (Number(m.project_allowance) || 0), 0)
      return sum + pSum
    }, 0)
    const totalBudget = projects.reduce((sum, p) => sum + (Number(p.budget) || 0), 0)

    return { totalProjects, activeProjects, totalMembers, totalMonthlyAllowance, totalBudget }
  }, [projects])

  // Lọc danh sách dự án quản lý
  const filteredProjects = useMemo(() => {
    return projects.filter(p => {
      const matchSearch = searchTerm
        ? (p.project_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
           p.project_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
           p.members?.some(m => m.employee_name.toLowerCase().includes(searchTerm.toLowerCase())))
        : true
      const matchStatus = statusFilter === 'ALL'
        ? true
        : statusFilter === 'IN_PROGRESS'
          ? (p.status === 'IN_PROGRESS' || p.status === 'ACTIVE')
          : p.status === statusFilter
      return matchSearch && matchStatus
    })
  }, [projects, searchTerm, statusFilter])

  // Dự án đang xem chi tiết ở Tab Quản lý
  const currentProject = useMemo(() => {
    if (!projects.length) return null
    if (selectedProjectId) {
      return projects.find(p => p.project_id === selectedProjectId) || projects[0]
    }
    return projects[0]
  }, [projects, selectedProjectId])

  // Khi chọn vai trò trong form thêm thành viên -> Tự động tra cứu định mức chuẩn của dự án đó
  useEffect(() => {
    if (!targetProject) return
    const matchedAllowance = targetProject.role_allowances?.find(a => a.role_code === newMemberRole)
    if (matchedAllowance) {
      setNewMemberAllowance(Number(matchedAllowance.allowance_amount))
    } else {
      const defaultMap: Record<string, number> = {
        PROJECT_LEAD: 3000000,
        TECH_LEAD: 2500000,
        KEY_MEMBER: 2000000,
        CORE_MEMBER: 1500000,
        MEMBER: 1000000,
      }
      setNewMemberAllowance(defaultMap[newMemberRole] || 1000000)
    }
  }, [newMemberRole, targetProject])

  // Mở modal tạo dự án
  const openCreateProjectModal = () => {
    setNewProjectCode(`PRJ-${new Date().getFullYear()}-${String(projects.length + 1).padStart(2, '0')}`)
    setNewProjectName('')
    setNewProjectDesc('')
    setNewProjectStartDate(new Date().toISOString().slice(0, 10))
    setNewProjectEndDate('')
    setNewProjectStatus('IN_PROGRESS')
    setNewProjectBudget(0)
    setIsCreateProjectOpen(true)
  }

  // Submit tạo dự án
  const handleCreateProjectSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newProjectCode.trim() || !newProjectName.trim()) {
      toast.error('Vui lòng nhập mã và tên dự án')
      return
    }
    setSavingProject(true)
    try {
      const res = await payrollApi.createProject({
        project_code: newProjectCode.trim().toUpperCase(),
        project_name: newProjectName.trim(),
        description: newProjectDesc.trim() || undefined,
        start_date: newProjectStartDate,
        end_date: newProjectEndDate || undefined,
        status: newProjectStatus,
        budget: Number(newProjectBudget) || 0,
      })
      toast.success(res.message || 'Tạo dự án thành công!')
      setIsCreateProjectOpen(false)
      await fetchData()
      if (res.project?.project_id) {
        setSelectedProjectId(res.project.project_id)
      }
    } catch (err: any) {
      console.error('Error creating project:', err)
      toast.error(err.message || 'Lỗi khi tạo dự án')
    } finally {
      setSavingProject(false)
    }
  }

  // Mở modal thêm thành viên cho 1 dự án
  const openAddMemberModal = (project: Project) => {
    setTargetProject(project)
    setNewMemberEmpId('')
    setNewMemberRole('CORE_MEMBER')
    setNewMemberJoinedDate(new Date().toISOString().slice(0, 10))
    setIsAddMemberOpen(true)
  }

  // Mở modal cấu hình định mức phụ cấp vai trò
  const openAllowanceModal = (project: Project) => {
    setTargetProject(project)
    const map: Record<string, { amount: number; notes: string }> = {}
    projectRoles.forEach(r => {
      const existing = project.role_allowances?.find(a => a.role_code === r.role_code)
      map[r.role_code] = {
        amount: existing ? Number(existing.allowance_amount) : 0,
        notes: existing?.notes || ''
      }
    })
    setAllowanceFormMap(map)
    setIsAllowanceModalOpen(true)
  }

  // Submit thêm thành viên
  const handleAddMemberSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!targetProject || !newMemberEmpId) {
      toast.error('Vui lòng chọn nhân viên cần thêm vào dự án')
      return
    }
    setSavingMember(true)
    try {
      await payrollApi.addProjectMember(targetProject.project_id, {
        employee_id: Number(newMemberEmpId),
        project_role: newMemberRole,
        project_allowance: newMemberAllowance,
        joined_date: newMemberJoinedDate,
      })
      toast.success('Đã thêm thành viên vào dự án thành công!')
      setIsAddMemberOpen(false)
      await fetchData()
    } catch (err: any) {
      console.error('Error adding project member:', err)
      toast.error(err.message || 'Lỗi khi thêm thành viên')
    } finally {
      setSavingMember(false)
    }
  }

  // Submit lưu định mức vai trò của dự án
  const handleSaveAllowances = async () => {
    if (!targetProject) return
    setSavingAllowances(true)
    try {
      const promises = Object.entries(allowanceFormMap).map(([role_code, data]) => {
        return payrollApi.setProjectRoleAllowance(targetProject.project_id, {
          role_code,
          allowance_amount: Number(data.amount) || 0,
          notes: data.notes || undefined,
        })
      })
      await Promise.all(promises)
      toast.success(`Đã cập nhật định mức phụ cấp cho dự án ${targetProject.project_name}!`)
      setIsAllowanceModalOpen(false)
      await fetchData()
    } catch (err: any) {
      console.error('Error saving role allowances:', err)
      toast.error(err.message || 'Lỗi khi lưu định mức phụ cấp')
    } finally {
      setSavingAllowances(false)
    }
  }

  // Xóa thành viên khỏi dự án
  const handleRemoveMember = async (memberId: number, memberName: string) => {
    if (!window.confirm(`Xác nhận xóa thành viên "${memberName}" khỏi dự án này?`)) {
      return
    }
    try {
      await payrollApi.removeProjectMember(memberId)
      toast.success(`Đã xóa ${memberName} khỏi dự án!`)
      await fetchData()
    } catch (err: any) {
      toast.error(err.message || 'Lỗi khi xóa thành viên')
    }
  }

  // Tạo vai trò nội bộ mới
  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newRoleCode.trim() || !newRoleName.trim()) {
      toast.error('Vui lòng nhập mã và tên vai trò')
      return
    }
    setSavingNewRole(true)
    try {
      await payrollApi.createProjectRole({
        role_code: newRoleCode.toUpperCase().trim(),
        role_name: newRoleName.trim(),
        description: newRoleDesc.trim() || undefined,
        display_order: projectRoles.length + 1,
      })
      toast.success(`Đã thêm vai trò ${newRoleCode} vào danh mục hệ thống!`)
      setNewRoleCode('')
      setNewRoleName('')
      setNewRoleDesc('')
      setIsRoleDirectoryOpen(false)
      await fetchData()
    } catch (err: any) {
      toast.error(err.message || 'Lỗi khi tạo vai trò')
    } finally {
      setSavingNewRole(false)
    }
  }

  // Helper render badge vai trò
  const renderRoleBadge = (roleCode: string) => {
    switch (roleCode) {
      case 'PROJECT_LEAD':
        return (
          <span className="badge" style={{ background: 'rgba(147, 51, 234, 0.1)', color: '#9333ea', border: '1px solid rgba(147, 51, 234, 0.25)', fontWeight: 600 }}>
            Trưởng dự án (Lead)
          </span>
        )
      case 'TECH_LEAD':
        return (
          <span className="badge" style={{ background: 'rgba(37, 99, 235, 0.1)', color: '#2563eb', border: '1px solid rgba(37, 99, 235, 0.25)', fontWeight: 600 }}>
            Tech Lead
          </span>
        )
      case 'CORE_MEMBER':
        return (
          <span className="badge" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#059669', border: '1px solid rgba(16, 185, 129, 0.25)', fontWeight: 600 }}>
            Thành viên nòng cốt
          </span>
        )
      case 'KEY_MEMBER':
        return (
          <span className="badge" style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#d97706', border: '1px solid rgba(245, 158, 11, 0.25)', fontWeight: 600 }}>
            Key Member
          </span>
        )
      default:
        return (
          <span className="badge" style={{ background: 'var(--surface-subtle)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}>
            Thành viên
          </span>
        )
    }
  }

  // Helper render badge trạng thái dự án
  const renderStatusBadge = (status: string) => {
    if (status === 'IN_PROGRESS' || status === 'ACTIVE') {
      return (
        <span className="badge" style={{ background: 'var(--status-success-bg)', color: 'var(--status-success)', border: '1px solid var(--status-success-border)' }}>
          Đang triển khai
        </span>
      )
    }
    if (status === 'PLANNING') {
      return (
        <span className="badge" style={{ background: 'var(--status-warning-bg)', color: 'var(--status-warning)', border: '1px solid var(--status-warning-border)' }}>
          Kế hoạch
        </span>
      )
    }
    return (
      <span className="badge" style={{ background: 'var(--status-neutral-bg)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}>
        Hoàn thành
      </span>
    )
  }

  return (
    <div className="page-container">
      {/* 1. Page Header (Tách biệt rõ ràng Dự án của tôi vs Quản lý dự án) */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', marginBottom: '20px' }}>
        <div>
          <h1 className="page-title">
            {personal ? 'Dự Án Của Tôi' : 'Quản Lý Dự Án'}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px' }}>
            {personal
              ? 'Theo dõi danh sách các dự án và định mức phụ cấp bạn đang tham gia'
              : 'Quản trị danh mục dự án, thành viên và cấu hình định mức phụ cấp vai trò nội bộ'}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Action buttons in Manage View */}
          {!personal && canManage && (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setIsRoleDirectoryOpen(true)}
              >
                Danh mục vai trò ({projectRoles.length})
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={openCreateProjectModal}
              >
                {Icons.plus}
                Tạo dự án mới
              </button>
            </>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: DỰ ÁN CỦA TÔI (PERSONAL VIEW) */}
      {/* ========================================================================= */}
      {activeTab === 'my' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Summary Stat Cards cá nhân */}
          <div className="stat-grid-4">
            <StatCard
              icon={Icons.briefcase}
              iconColor="blue"
              label="DỰ ÁN ĐANG THAM GIA"
              value={myProjects.length}
              footerNote="Nhiệm vụ chuyên môn được phân công"
            />
            <StatCard
              icon={Icons.wallet}
              iconColor="green"
              label="PHỤ CẤP DỰ ÁN / THÁNG"
              value={formatCurrency(myTotalAllowance)}
              footerNote="Cộng tự động vào bảng lương cá nhân"
            />
            <StatCard
              icon={Icons.users}
              iconColor="amber"
              label="VAI TRÒ TRONG DỰ ÁN"
              value={myProjects.length > 0 ? (myProjects[0].members?.find(m => m.employee_id === currentEmployeeId)?.project_role || 'Thành viên') : '—'}
              footerNote="Căn cứ theo quyết định điều động"
            />
            <StatCard
              icon={Icons.clock}
              iconColor="blue"
              label="TRẠNG THÁI GHI NHẬN"
              value={myTotalAllowance > 0 ? 'Đang hạch toán' : 'Chưa có phụ cấp'}
              footerNote="Đồng bộ với kỳ tính lương hiện tại"
            />
          </div>

          {/* Danh sách các thẻ dự án cá nhân */}
          {loading ? (
            <div className="card" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Đang tải thông tin dự án...
            </div>
          ) : myProjects.length === 0 ? (
            <div className="card" style={{ padding: '48px', textAlign: 'center' }}>
              <EmptyState
                icon={Icons.briefcase}
                title={!currentEmployeeId ? "Tài khoản chưa liên kết hồ sơ nhân viên" : "Bạn chưa tham gia dự án nào"}
                description={!currentEmployeeId
                  ? "Tài khoản của bạn hiện chưa được gắn mã nhân viên trong hệ thống nhân sự để ghi nhận dự án cá nhân. Với vai trò quản lý, bạn có thể truy cập trang 'Quản lý dự án' ở mục Vận hành."
                  : "Khi bạn được Quản trị viên hoặc Trưởng phòng điều động vào dự án, thông tin và phụ cấp sẽ tự động hiển thị tại đây."}
              />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {myProjects.map(proj => {
                const myMembership = proj.members?.find(m => m.employee_id === currentEmployeeId)
                const teamMembers = proj.members || []

                return (
                  <div key={proj.project_id} className="card" style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', background: 'var(--surface-subtle)', padding: '2px 8px', borderRadius: '4px', border: '1px solid var(--border-default)', fontWeight: 600 }}>
                            {proj.project_code}
                          </span>
                          {renderStatusBadge(proj.status)}
                        </div>
                        <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                          {proj.project_name}
                        </h2>
                      </div>

                      <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                        Thời gian: <strong>{formatDate(proj.start_date)}</strong> {proj.end_date ? `→ ${formatDate(proj.end_date)}` : '(Đang tiếp diễn)'}
                      </div>
                    </div>

                    {proj.description && (
                      <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5, marginBottom: '18px' }}>
                        {proj.description}
                      </p>
                    )}

                    {/* Hộp Thông tin đóng góp của bản thân */}
                    {myMembership && (
                      <div
                        style={{
                          padding: '16px',
                          background: 'var(--surface-subtle)',
                          borderRadius: '8px',
                          border: '1px solid var(--border-default)',
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                          gap: '16px',
                          alignItems: 'center',
                          marginBottom: '20px',
                        }}
                      >
                        <div>
                          <span style={{ fontSize: '11.5px', color: 'var(--text-tertiary)', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>
                            Vai trò nội bộ của bạn
                          </span>
                          <div>{renderRoleBadge(myMembership.project_role)}</div>
                        </div>

                        <div>
                          <span style={{ fontSize: '11.5px', color: 'var(--text-tertiary)', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>
                            Mức phụ cấp hàng tháng
                          </span>
                          <strong style={{ fontSize: '16px', fontFamily: 'var(--font-mono)', color: 'var(--status-success)' }}>
                            {formatCurrency(myMembership.project_allowance)}
                          </strong>
                        </div>

                        <div>
                          <span style={{ fontSize: '11.5px', color: 'var(--text-tertiary)', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>
                            Ngày bắt đầu tham gia
                          </span>
                          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                            {formatDate(myMembership.joined_date)}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Danh sách đồng đội cùng dự án */}
                    <div>
                      <h4 style={{ fontSize: '13px', fontWeight: 700, margin: '0 0 10px 0', color: 'var(--text-secondary)' }}>
                        ĐỒNG ĐỘI CÙNG DỰ ÁN ({teamMembers.length})
                      </h4>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '10px' }}>
                        {teamMembers.map(m => {
                          const isMe = m.employee_id === currentEmployeeId
                          return (
                            <div
                              key={m.project_member_id}
                              style={{
                                padding: '10px 12px',
                                background: isMe ? 'var(--surface-ground)' : 'var(--surface-card)',
                                border: `1px solid ${isMe ? 'var(--action-primary)' : 'var(--border-subtle)'}`,
                                borderRadius: '6px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                              }}
                            >
                              <div
                                style={{
                                  width: '30px',
                                  height: '30px',
                                  borderRadius: '50%',
                                  background: 'var(--surface-subtle)',
                                  border: '1px solid var(--border-default)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '11px',
                                  fontWeight: 700,
                                }}
                              >
                                {(m.employee_name || 'NV').split(' ').map(w => w[0]).slice(-2).join('').toUpperCase()}
                              </div>
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {m.employee_name} {isMe && <span style={{ fontSize: '11px', color: 'var(--status-info)' }}>(Bạn)</span>}
                                </div>
                                <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                  {m.project_role} · {m.position_name || 'Nhân sự'}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: QUẢN LÝ DỰ ÁN (MANAGEMENT VIEW) */}
      {/* ========================================================================= */}
      {activeTab === 'manage' && hasManagementView && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* 4 StatCards chuẩn hệ thống */}
          <div className="stat-grid-4">
            <StatCard
              icon={Icons.briefcase}
              iconColor="blue"
              label="DỰ ÁN HOẠT ĐỘNG"
              value={metrics.activeProjects}
              footerNote={metrics.totalProjects > 0 ? `Tổng số: ${metrics.totalProjects} dự án` : undefined}
            />
            <StatCard
              icon={Icons.users}
              iconColor="blue"
              label="NHÂN SỰ DỰ ÁN"
              value={metrics.totalMembers}
              footerNote="Tổng lượt nhân sự tham gia"
            />
            <StatCard
              icon={Icons.wallet}
              iconColor="green"
              label="QUỸ PHỤ CẤP THÁNG"
              value={formatCurrency(metrics.totalMonthlyAllowance)}
              footerNote="Tự động tính theo vai trò dự án"
            />
            <StatCard
              icon={Icons.chart}
              iconColor="amber"
              label="TỔNG NGÂN SÁCH"
              value={canManage && metrics.totalBudget > 0 ? formatCurrency(metrics.totalBudget) : (canManage ? '0 ₫' : 'Bảo mật')}
              footerNote={canManage ? 'Hạn mức ngân sách các dự án' : 'Quyền hạn bảo mật'}
            />
          </div>

          {/* Controls: Search & Status Filter */}
          <div className="card" style={{ padding: '12px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: '240px' }}>
              <div style={{ position: 'relative', width: '100%', maxWidth: '340px' }}>
                <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }}>
                  {Icons.search}
                </span>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Tìm theo mã dự án, tên dự án..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  style={{ paddingLeft: '34px', width: '100%' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '6px' }}>
                {(['ALL', 'IN_PROGRESS', 'PLANNING', 'COMPLETED'] as const).map(st => (
                  <button
                    key={st}
                    type="button"
                    className={`btn ${statusFilter === st ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                    onClick={() => setStatusFilter(st)}
                  >
                    {st === 'ALL' ? 'Tất cả' : st === 'IN_PROGRESS' ? 'Đang chạy' : st === 'PLANNING' ? 'Kế hoạch' : 'Hoàn thành'}
                  </button>
                ))}
              </div>
            </div>

            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Hiển thị <strong>{filteredProjects.length}</strong> dự án
            </span>
          </div>

          {/* Main Split-View: Danh sách dự án bên trái + Chi tiết dự án bên phải */}
          {loading ? (
            <div className="card" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Đang tải dữ liệu dự án...
            </div>
          ) : !filteredProjects.length ? (
            <div className="card" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Không tìm thấy dự án trong phạm vi tài khoản của bạn.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '20px', alignItems: 'start' }}>
              {/* Cột trái: Danh sách các dự án để chọn */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {filteredProjects.map(p => {
                  const isSelected = p.project_id === currentProject?.project_id
                  const memberCount = p.members?.length || 0
                  const projectMonthlyAllowance = (p.members || []).reduce((sum, m) => sum + (Number(m.project_allowance) || 0), 0)

                  return (
                    <div
                      key={p.project_id}
                      className={`card kpi-hover-card ${isSelected ? 'active-card' : ''}`}
                      onClick={() => setSelectedProjectId(p.project_id)}
                      style={{
                        padding: '14px',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        borderLeft: isSelected ? '3px solid var(--action-primary)' : '1px solid var(--border-default)',
                        background: isSelected ? 'var(--surface-subtle)' : 'var(--surface-card)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 600 }}>
                          {p.project_code}
                        </span>
                        {renderStatusBadge(p.status)}
                      </div>

                      <h3 style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 8px 0', color: 'var(--text-primary)' }}>
                        {p.project_name}
                      </h3>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: 'var(--text-secondary)' }}>
                        <span>{memberCount} thành viên</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--status-success)' }}>
                          {formatCurrency(projectMonthlyAllowance)}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Cột phải: Chi tiết dự án được chọn */}
              {currentProject && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {/* Card 1: Thông tin tổng quan dự án */}
                  <div className="card" style={{ padding: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', background: 'var(--surface-subtle)', padding: '2px 8px', borderRadius: '4px', border: '1px solid var(--border-default)', fontWeight: 600 }}>
                            {currentProject.project_code}
                          </span>
                          {renderStatusBadge(currentProject.status)}
                        </div>
                        <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                          {currentProject.project_name}
                        </h2>
                      </div>

                      {canManage && (
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => openAllowanceModal(currentProject)}
                            title="Thiết lập định mức phụ cấp vai trò nội bộ"
                          >
                            Thiết lập định mức
                          </button>
                        </div>
                      )}
                    </div>

                    {currentProject.description && (
                      <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px', lineHeight: 1.5 }}>
                        {currentProject.description}
                      </p>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', padding: '12px', background: 'var(--surface-subtle)', borderRadius: '6px', border: '1px solid var(--border-default)' }}>
                      <div>
                        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>Thời gian thực hiện</span>
                        <strong style={{ fontSize: '13px' }}>
                          {formatDate(currentProject.start_date)} {currentProject.end_date ? `→ ${formatDate(currentProject.end_date)}` : '(Đang tiếp diễn)'}
                        </strong>
                      </div>
                      <div>
                        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>Ngân sách dự án</span>
                        <strong style={{ fontSize: '13px', fontFamily: 'var(--font-mono)' }}>
                          {currentProject.budget != null ? formatCurrency(currentProject.budget) : '—'}
                        </strong>
                      </div>
                      <div>
                        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>Tổng phụ cấp tháng</span>
                        <strong style={{ fontSize: '13px', fontFamily: 'var(--font-mono)', color: 'var(--status-success)' }}>
                          {formatCurrency((currentProject.members || []).reduce((s, m) => s + (Number(m.project_allowance) || 0), 0))}
                        </strong>
                      </div>
                    </div>
                  </div>

                  {/* Card 2: Danh sách thành viên tham gia */}
                  <div className="card" style={{ padding: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                      <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>
                        Danh Sách Thành Viên & Phụ Cấp ({currentProject.members?.length || 0})
                      </h3>
                      {canManage && (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => openAddMemberModal(currentProject)}
                        >
                          {Icons.plus}
                          Thêm thành viên
                        </button>
                      )}
                    </div>

                    <div className="table-container">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th style={{ width: '32%' }}>Nhân Viên</th>
                            <th style={{ width: '24%' }}>Vai Trò Nội Bộ</th>
                            <th style={{ width: '22%', textAlign: 'right' }}>Phụ Cấp / Tháng</th>
                            <th style={{ width: '14%' }}>Ngày Tham Gia</th>
                            {canManage && <th style={{ width: '8%', textAlign: 'center' }}>Thao Tác</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {currentProject.members && currentProject.members.length > 0 ? (
                            currentProject.members.map(m => {
                              const initials = (m.employee_name || 'NV')
                                .split(' ')
                                .map(w => w[0])
                                .slice(-2)
                                .join('')
                                .toUpperCase()

                              return (
                                <tr key={m.project_member_id}>
                                  <td>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                      <div
                                        style={{
                                          width: '32px',
                                          height: '32px',
                                          borderRadius: '50%',
                                          background: 'var(--surface-subtle)',
                                          border: '1px solid var(--border-default)',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          fontSize: '11px',
                                          fontWeight: 700,
                                          color: 'var(--text-primary)',
                                        }}
                                      >
                                        {initials}
                                      </div>
                                      <div>
                                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{m.employee_name}</div>
                                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                          {m.employee_code} · {m.position_name || 'Nhân sự'}
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                  <td>{renderRoleBadge(m.project_role)}</td>
                                  <td style={{ textAlign: 'right' }}>
                                    <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--status-success)' }}>
                                      {formatCurrency(m.project_allowance)}
                                    </div>
                                  </td>
                                  <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                    {formatDate(m.joined_date)}
                                  </td>
                                  {canManage && (
                                    <td style={{ textAlign: 'center' }}>
                                      <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <button
                                          type="button"
                                          className={`btn btn-secondary btn-sm btn-icon ${openMemberMenuId === m.project_member_id ? 'active' : ''}`}
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            setOpenMemberMenuId(openMemberMenuId === m.project_member_id ? null : m.project_member_id)
                                          }}
                                          title="Tùy chọn thao tác"
                                        >
                                          {Icons.moreVertical}
                                        </button>

                                        {openMemberMenuId === m.project_member_id && (
                                          <div
                                            className="action-dropdown"
                                            onClick={(e) => e.stopPropagation()}
                                            style={{
                                              position: 'absolute',
                                              top: '100%',
                                              right: 0,
                                              marginTop: '4px',
                                              zIndex: 90,
                                              minWidth: '160px',
                                            }}
                                          >
                                            <button
                                              type="button"
                                              className="action-dropdown-item danger"
                                              onClick={() => {
                                                setOpenMemberMenuId(null)
                                                handleRemoveMember(m.project_member_id, m.employee_name)
                                              }}
                                            >
                                              <span className="action-icon">{Icons.close}</span>
                                              <span>Gỡ khỏi dự án</span>
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    </td>
                                  )}
                                </tr>
                              )
                            })
                          ) : (
                            <tr>
                              <td colSpan={canManage ? 5 : 4} style={{ textAlign: 'center', padding: '28px', color: 'var(--text-secondary)' }}>
                                Chưa có thành viên nào trong dự án này.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Card 3: Bảng định mức phụ cấp vai trò nội bộ của dự án này */}
                  <div className="card" style={{ padding: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                      <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>
                        Định Mức Phụ Cấp Theo Vai Trò Nội Bộ
                      </h3>
                      {canManage && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => openAllowanceModal(currentProject)}
                        >
                          Chỉnh sửa định mức
                        </button>
                      )}
                    </div>

                    <div className="table-container">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th style={{ width: '25%' }}>Vai Trò</th>
                            <th style={{ width: '30%' }}>Tên Hiển Thị</th>
                            <th style={{ width: '25%', textAlign: 'right' }}>Định Mức Phụ Cấp</th>
                            <th style={{ width: '20%' }}>Ghi Chú</th>
                          </tr>
                        </thead>
                        <tbody>
                          {currentProject.role_allowances && currentProject.role_allowances.length > 0 ? (
                            currentProject.role_allowances.map(ra => (
                              <tr key={ra.id}>
                                <td>{renderRoleBadge(ra.role_code)}</td>
                                <td style={{ fontWeight: 600 }}>{ra.role_name}</td>
                                <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--status-success)' }}>
                                  {formatCurrency(ra.allowance_amount)}
                                </td>
                                <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                  {ra.notes || '—'}
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={4} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>
                                Dự án này chưa cấu hình bảng định mức riêng.
                                {canManage && (
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => openAllowanceModal(currentProject)}
                                    style={{ marginLeft: '12px' }}
                                  >
                                    Cấu hình ngay
                                  </button>
                                )}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 0: TẠO DỰ ÁN MỚI (CHO HR, ADMIN, DIRECTOR) */}
      {/* ========================================================================= */}
      {isCreateProjectOpen && (
        <div className="modal-overlay">
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '540px' }}>
            <div className="modal-header">
              <h2 className="modal-title">Tạo Dự Án Mới</h2>
              <button className="modal-close" onClick={() => setIsCreateProjectOpen(false)}>
                {Icons.close}
              </button>
            </div>

            <form onSubmit={handleCreateProjectSubmit}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label className="form-label">Mã dự án (*)</label>
                    <input
                      type="text"
                      className="form-input"
                      value={newProjectCode}
                      onChange={e => setNewProjectCode(e.target.value.toUpperCase())}
                      placeholder="VD: PRJ-2026-04"
                      required
                      style={{ fontFamily: 'var(--font-mono)' }}
                    />
                  </div>

                  <div>
                    <label className="form-label">Trạng thái khởi tạo</label>
                    <select
                      className="form-select"
                      value={newProjectStatus}
                      onChange={e => setNewProjectStatus(e.target.value)}
                    >
                      <option value="IN_PROGRESS">Đang triển khai</option>
                      <option value="PLANNING">Kế hoạch</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="form-label">Tên dự án (*)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={newProjectName}
                    onChange={e => setNewProjectName(e.target.value)}
                    placeholder="VD: Chiến dịch Mở rộng Chi nhánh Tây Ninh"
                    required
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label className="form-label">Ngày bắt đầu (*)</label>
                    <input
                      type="date"
                      className="form-input"
                      value={newProjectStartDate}
                      onChange={e => setNewProjectStartDate(e.target.value)}
                      required
                    />
                  </div>

                  <div>
                    <label className="form-label">Ngày kết thúc dự kiến</label>
                    <input
                      type="date"
                      className="form-input"
                      value={newProjectEndDate}
                      onChange={e => setNewProjectEndDate(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label className="form-label">Ngân sách dự án (VNĐ)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={newProjectBudget}
                    onChange={e => setNewProjectBudget(Number(e.target.value) || 0)}
                    step={1000000}
                    min={0}
                    placeholder="VD: 50000000"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </div>

                <div>
                  <label className="form-label">Mô tả mục tiêu dự án</label>
                  <textarea
                    className="form-input"
                    rows={3}
                    value={newProjectDesc}
                    onChange={e => setNewProjectDesc(e.target.value)}
                    placeholder="Mô tả phạm vi công việc, chỉ tiêu cần đạt..."
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsCreateProjectOpen(false)}
                  disabled={savingProject}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingProject}
                >
                  {savingProject ? 'Đang tạo...' : 'Tạo dự án'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: THÊM THÀNH VIÊN VÀO DỰ ÁN (DÙNG EmployeeSearchSelect NHƯ LEAVE) */}
      {/* ========================================================================= */}
      {isAddMemberOpen && targetProject && (
        <div className="modal-overlay">
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <h2 className="modal-title">Thêm Nhân Sự Vào Dự Án</h2>
              <button className="modal-close" onClick={() => setIsAddMemberOpen(false)}>
                {Icons.close}
              </button>
            </div>

            <form onSubmit={handleAddMemberSubmit}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div>
                  <label className="form-label">Dự án tiếp nhận nhân sự (*)</label>
                  <select
                    className="form-select"
                    value={targetProject.project_id}
                    onChange={e => {
                      const selectedId = Number(e.target.value)
                      const found = projects.find(p => p.project_id === selectedId)
                      if (found) {
                        setTargetProject(found)
                        const allowance = found.role_allowances?.find(a => a.role_code === newMemberRole)?.allowance_amount
                        if (allowance !== undefined) {
                          setNewMemberAllowance(Number(allowance))
                        }
                      }
                    }}
                  >
                    {projects.map(p => (
                      <option key={p.project_id} value={p.project_id}>
                        [{p.project_code}] {p.project_name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Chọn nhân viên bằng EmployeeSearchSelect chuẩn như LeaveRequestsPage */}
                <div>
                  <EmployeeSearchSelect
                    employees={employees}
                    value={newMemberEmpId}
                    onChange={(empId) => setNewMemberEmpId(empId || '')}
                    placeholder="Tìm theo tên, mã NV, chức vụ, chi nhánh..."
                    label="Chọn nhân sự tham gia"
                    required
                  />
                </div>

                <div>
                  <label className="form-label">Vai trò nội bộ trong dự án (*)</label>
                  <select
                    className="form-select"
                    value={newMemberRole}
                    onChange={e => setNewMemberRole(e.target.value)}
                    required
                  >
                    {projectRoles.map(r => (
                      <option key={r.role_code} value={r.role_code}>
                        {r.role_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label className="form-label" style={{ margin: 0 }}>Mức phụ cấp hàng tháng (VNĐ)</label>
                    <span style={{ fontSize: '11px', color: 'var(--status-success)' }}>
                      Tự động điền theo vai trò
                    </span>
                  </div>
                  <input
                    type="number"
                    className="form-input"
                    value={newMemberAllowance}
                    onChange={e => setNewMemberAllowance(Number(e.target.value) || 0)}
                    step={100000}
                    min={0}
                    required
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </div>

                <div>
                  <label className="form-label">Ngày bắt đầu tham gia</label>
                  <input
                    type="date"
                    className="form-input"
                    value={newMemberJoinedDate}
                    onChange={e => setNewMemberJoinedDate(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsAddMemberOpen(false)}
                  disabled={savingMember}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingMember || !newMemberEmpId}
                >
                  {savingMember ? 'Đang thêm...' : 'Xác nhận thêm'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: THIẾT LẬP ĐỊNH MỨC PHỤ CẤP VAI TRÒ CHO DỰ ÁN */}
      {/* ========================================================================= */}
      {isAllowanceModalOpen && targetProject && (
        <div className="modal-overlay">
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h2 className="modal-title">Cấu Hình Định Mức Phụ Cấp Vai Trò</h2>
              <button className="modal-close" onClick={() => setIsAllowanceModalOpen(false)}>
                {Icons.close}
              </button>
            </div>

            <div className="modal-body">
              <div style={{ marginBottom: '14px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                Dự án: <strong style={{ color: 'var(--text-primary)' }}>[{targetProject.project_code}] {targetProject.project_name}</strong>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '420px', overflowY: 'auto' }}>
                {projectRoles.map(role => {
                  const currentVal = allowanceFormMap[role.role_code] || { amount: 0, notes: '' }
                  return (
                    <div
                      key={role.role_code}
                      style={{
                        padding: '10px 12px',
                        background: 'var(--surface-subtle)',
                        borderRadius: '6px',
                        border: '1px solid var(--border-default)',
                        display: 'grid',
                        gridTemplateColumns: '150px 1fr',
                        gap: '12px',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        {renderRoleBadge(role.role_code)}
                        <div style={{ fontSize: '12px', fontWeight: 600, marginTop: '4px' }}>{role.role_name}</div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', width: '60px' }}>Phụ cấp:</span>
                          <input
                            type="number"
                            className="form-input"
                            value={currentVal.amount}
                            onChange={e => {
                              const val = Number(e.target.value) || 0
                              setAllowanceFormMap(prev => ({
                                ...prev,
                                [role.role_code]: { ...currentVal, amount: val },
                              }))
                            }}
                            step={100000}
                            min={0}
                            style={{ fontFamily: 'var(--font-mono)' }}
                          />
                          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>VNĐ</span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', width: '60px' }}>Ghi chú:</span>
                          <input
                            type="text"
                            className="form-input"
                            placeholder="Ghi chú điều kiện..."
                            value={currentVal.notes}
                            onChange={e => {
                              const notes = e.target.value
                              setAllowanceFormMap(prev => ({
                                ...prev,
                                [role.role_code]: { ...currentVal, notes },
                              }))
                            }}
                            style={{ fontSize: '12px' }}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setIsAllowanceModalOpen(false)}
                disabled={savingAllowances}
              >
                Hủy
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSaveAllowances}
                disabled={savingAllowances}
              >
                {savingAllowances ? 'Đang lưu...' : 'Lưu định mức'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: QUẢN LÝ DANH MỤC VAI TRÒ NỘI BỘ HỆ THỐNG */}
      {/* ========================================================================= */}
      {isRoleDirectoryOpen && (
        <div className="modal-overlay">
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '640px' }}>
            <div className="modal-header">
              <h2 className="modal-title">Danh Mục Vai Trò Nội Bộ Dự Án</h2>
              <button className="modal-close" onClick={() => setIsRoleDirectoryOpen(false)}>
                {Icons.close}
              </button>
            </div>

            <div className="modal-body">
              <div className="table-container" style={{ marginBottom: '16px' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: '25%' }}>Mã Vai Trò</th>
                      <th style={{ width: '30%' }}>Tên Vai Trò</th>
                      <th style={{ width: '45%' }}>Mô Tả & Trách Nhiệm</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectRoles.map(r => (
                      <tr key={r.role_code}>
                        <td>{renderRoleBadge(r.role_code)}</td>
                        <td style={{ fontWeight: 600 }}>{r.role_name}</td>
                        <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                          {r.description || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {canManage && (
                <div style={{ padding: '12px', background: 'var(--surface-subtle)', borderRadius: '6px', border: '1px solid var(--border-default)' }}>
                  <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', fontWeight: 700 }}>Thêm Vai Trò Mới</h4>
                  <form onSubmit={handleCreateRole} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '8px' }}>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Mã vai trò (VD: QA_LEAD)"
                      value={newRoleCode}
                      onChange={e => setNewRoleCode(e.target.value)}
                      required
                    />
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Tên vai trò (VD: Trưởng nhóm QA)"
                      value={newRoleName}
                      onChange={e => setNewRoleName(e.target.value)}
                      required
                    />
                    <button type="submit" className="btn btn-primary" disabled={savingNewRole}>
                      {savingNewRole ? 'Đang thêm...' : '+ Thêm'}
                    </button>
                  </form>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setIsRoleDirectoryOpen(false)}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
