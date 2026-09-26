import { useState, useEffect, useCallback, useRef } from 'react'
import { Icons } from '../components/common/Icons'
import { EmptyState } from '../components/common/EmptyState'
import { getInitials, getRoleFromUser, formatDate, formatCurrency } from '../utils/formatters'
import type { Employee, EmployeeCreate, Lookups, Contract, PromotionCreate } from '../types'

export interface EmployeeListPageProps {
  user: any
}

type ModalMode = 'view' | 'add' | 'edit' | 'promote' | 'contract' | 'resign'
type ConfirmAction = 'add' | 'edit' | 'promote' | 'contract' | 'resign' | null

export function EmployeeListPage({ user }: EmployeeListPageProps) {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterStore, setFilterStore] = useState<number | null>(null)
  const [filterPosition, setFilterPosition] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Modal state
  const [showModal, setShowModal] = useState(false);
  // Shift edit modal state
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [shiftStart, setShiftStart] = useState('');
  const [shiftEnd, setShiftEnd] = useState('');
  const [shiftPreset, setShiftPreset] = useState('');


  const [modalMode, setModalMode] = useState<ModalMode>('view')
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null)

  // Dropdown menu state
  const [openMenuId, setOpenMenuId] = useState<number | null>(null)

  // Confirmation modal
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null)
  const [confirmMessage, setConfirmMessage] = useState('')

  // Lookups for dropdowns
  const [lookups, setLookups] = useState<Lookups | null>(null)

  // Contracts for selected employee
  const [employeeContracts, setEmployeeContracts] = useState<Contract[]>([])
  const [contractsLoading, setContractsLoading] = useState(false)

  // Form state
  const [formData, setFormData] = useState<EmployeeCreate>({
    first_name: '',
    last_name: '',
    gender: 'MALE',
    dob: '',
    identity_card: '',
    phone: '',
    personal_email: '',
    company_email: '',
    permanent_address: '',
    current_address: '',
    store_id: undefined,
    department_id: undefined,
    position_id: undefined,
    education_level_id: undefined,
    join_date: new Date().toISOString().split('T')[0],
    employment_status: 'PROBATION',
    bank_account_number: '',
    bank_name: '',
    basic_salary: 8000000,
  })

  // Promotion form
  const [promotionData, setPromotionData] = useState<{
    new_position_id?: number
    new_store_id?: number
    decision_number: string
    reason: string
  }>({
    decision_number: 'QĐ-BN-2026',
    reason: 'Thăng cấp chức vụ theo năng lực',
  })

  // Contract form
  const [editingContractId, setEditingContractId] = useState<number | null>(null)
  const [contractForm, setContractForm] = useState({
    contract_type: 'FIXED_1_YEAR',
    start_date: new Date().toISOString().split('T')[0],
    end_date: '',
    basic_salary: 8000000,
    insurance_salary: 5000000,
    signed_date: new Date().toISOString().split('T')[0],
    status: 'ACTIVE',
  })

  // Error and loading states for forms
  const [formError, setFormError] = useState('')
  const [formLoading, setFormLoading] = useState(false)

  // Toast notification
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const toastTimeoutRef = useRef<number | null>(null)

  const showToast = (type: 'success' | 'error', message: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current)
    setToast({ type, message })
    toastTimeoutRef.current = window.setTimeout(() => setToast(null), 3000)
  }

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setOpenMenuId(null)
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  const fetchEmployees = useCallback(async () => {
    setIsLoading(true)
    try {
      const { employeeApi } = await import('../services/api')
      const params: any = {}
      if (filterStore) params.store_id = filterStore
      if (filterStatus !== 'all') params.status = filterStatus
      if (searchTerm) params.search = searchTerm

      const data = await employeeApi.getAll(params)
      setEmployees(data || [])
    } catch (err) {
      console.error('Error fetching employees:', err)
      setEmployees([])
    } finally {
      setIsLoading(false)
    }
  }, [filterStore, filterStatus, searchTerm])

  const fetchLookups = useCallback(async () => {
    try {
      const { employeeApi } = await import('../services/api')
      const data = await employeeApi.getLookups()
      setLookups(data)
    } catch (err) {
      console.error('Error fetching lookups:', err)
    }
  }, [])

  useEffect(() => {
    fetchEmployees()
    fetchLookups()
  }, [fetchEmployees, fetchLookups])


  const filteredEmployees = employees.filter(emp => {
    const matchesSearch =
      !searchTerm ||
      emp.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.employee_code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.phone?.includes(searchTerm)
    const matchesPosition = !filterPosition || emp.position_id === filterPosition
    return matchesSearch && matchesPosition
  })



  const role = getRoleFromUser(user)
  const canManage = role === 'ADMIN' || role === 'HR_MANAGER'

  // Modal handlers
  const openModal = (mode: ModalMode, employee?: Employee) => {
    setModalMode(mode)
    setSelectedEmployee(employee || null)
    setFormError('')
    setOpenMenuId(null)

    if (mode === 'view') {
      // Load contracts for view mode
      if (employee) loadEmployeeContracts(employee.employee_id)
    }

    if (mode === 'add') {
      setFormData({
        first_name: '',
        last_name: '',
        gender: 'MALE',
        dob: '',
        identity_card: '',
        phone: '',
        personal_email: '',
        company_email: '',
        permanent_address: '',
        current_address: '',
        store_id: user?.store_id || undefined,
        department_id: undefined,
        position_id: undefined,
        education_level_id: undefined,
        join_date: new Date().toISOString().split('T')[0],
        employment_status: 'PROBATION',
        bank_account_number: '',
        bank_name: '',
        basic_salary: 8000000,
      })
    } else if (mode === 'edit' && employee) {
      setFormData({
        first_name: employee.first_name,
        last_name: employee.last_name,
        gender: employee.gender || 'MALE',
        dob: employee.dob || '',
        identity_card: employee.identity_card || '',
        phone: employee.phone || '',
        personal_email: employee.personal_email || '',
        company_email: employee.company_email || '',
        permanent_address: employee.permanent_address || '',
        current_address: employee.current_address || '',
        store_id: employee.store_id || undefined,
        department_id: employee.department_id || undefined,
        position_id: employee.position_id || undefined,
        education_level_id: employee.education_level_id || undefined,
        join_date: employee.join_date || '',
        employment_status: employee.employment_status || 'ACTIVE',
        bank_account_number: employee.bank_account_number || '',
        bank_name: employee.bank_name || '',
        basic_salary: employee.basic_salary || 8000000,
      })
    } else if (mode === 'promote' && employee) {
      setPromotionData({
        new_position_id: undefined,
        new_store_id: employee.store_id || undefined,
        decision_number: 'QĐ-BN-2026',
        reason: 'Thăng cấp chức vụ theo năng lực',
      })
    } else if (mode === 'contract' && employee) {
      setEditingContractId(null)
      loadEmployeeContracts(employee.employee_id)
      setContractForm({
        contract_type: 'FIXED_1_YEAR',
        start_date: new Date().toISOString().split('T')[0],
        end_date: '',
        basic_salary: employee.basic_salary || 8000000,
        insurance_salary: 5000000,
        signed_date: new Date().toISOString().split('T')[0],
        status: 'ACTIVE',
      })
    }

    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setSelectedEmployee(null)
    setEditingContractId(null)
    setFormError('')
  }

  // --- Shift edit modal handlers ---
  const openShiftEditModal = (employee: Employee) => {
    setSelectedEmployee(employee)
    setOpenMenuId(null)
    // Preset giờ vào/ra mặc định theo ngày hôm nay
    const today = new Date().toISOString().slice(0, 10)
    setShiftStart(today + 'T08:00')
    setShiftEnd(today + 'T17:00')
    setShiftPreset('')
    setShowShiftModal(true)
  }

  const closeShiftModal = () => {
    setShowShiftModal(false)
    setSelectedEmployee(null)
    setShiftStart('')
    setShiftEnd('')
    setShiftPreset('')
  }

  const applyShiftPreset = (preset: string) => {
    const today = new Date().toISOString().slice(0, 10)
    setShiftPreset(preset)
    if (preset === 'Ca sáng') {
      setShiftStart(today + 'T06:00')
      setShiftEnd(today + 'T14:00')
    } else if (preset === 'Ca chiều') {
      setShiftStart(today + 'T14:00')
      setShiftEnd(today + 'T22:00')
    } else if (preset === 'Ca tối') {
      setShiftStart(today + 'T22:00')
      setShiftEnd(today + 'T06:00')
    }
  }

  const handleShiftSave = async () => {
    if (!selectedEmployee || !shiftStart || !shiftEnd) {
      showToast('error', 'Vui lòng điền đủ giờ vào và giờ ra')
      return
    }
    const startDt = new Date(shiftStart)
    const endDt = new Date(shiftEnd)
    let hours = (endDt.getTime() - startDt.getTime()) / 3600000
    if (hours < 0) hours += 24 // qua đêm
    // TODO: gọi API lưu ca làm – hiện tại log + toast
    console.log('[ShiftEdit] employee_id:', selectedEmployee.employee_id, '|', shiftStart, '->', shiftEnd, '| hours:', hours.toFixed(1), '| preset:', shiftPreset)
    showToast('success', `Đã cập nhật ca làm cho ${selectedEmployee.full_name} (${hours.toFixed(1)}h)`)
    closeShiftModal()
  }

  const loadEmployeeContracts = async (employeeId: number) => {
    setContractsLoading(true)
    try {
      const { employeeApi } = await import('../services/api')
      console.log('[DEBUG] Loading contracts for employee_id:', employeeId)
      const contracts = await employeeApi.getContracts(employeeId)
      console.log('[DEBUG] Contracts response:', contracts)
      console.log('[DEBUG] Contracts count:', (contracts || []).length)
      setEmployeeContracts(contracts || [])
    } catch (err) {
      console.error('[DEBUG] Error loading contracts:', err)
      setEmployeeContracts([])
      showToast('error', 'Lỗi khi tải hợp đồng')
    } finally {
      setContractsLoading(false)
    }
  }

  // Confirmation handlers
  const requestConfirm = (action: ConfirmAction, message: string) => {
    setConfirmAction(action)
    setConfirmMessage(message)
  }

  const cancelConfirm = () => {
    setConfirmAction(null)
    setConfirmMessage('')
  }

  // Form handlers
  const handleInputChange = (field: keyof EmployeeCreate, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handlePromotionChange = (field: string, value: any) => {
    setPromotionData(prev => ({ ...prev, [field]: value }))
  }

  const handleContractChange = (field: string, value: any) => {
    setContractForm(prev => ({ ...prev, [field]: value }))
  }

  // Direct submit (called after confirmation)
  const executeAdd = async () => {
    setFormLoading(true)
    setFormError('')

    try {
      const { employeeApi } = await import('../services/api')
      await employeeApi.create(formData)
      closeModal()
      cancelConfirm()
      fetchEmployees()
      showToast('success', 'Thêm nhân viên thành công!')
    } catch (err: any) {
      setFormError(err.message || 'Lỗi khi thêm nhân viên')
    } finally {
      setFormLoading(false)
    }
  }

  const executeEdit = async () => {
    if (!selectedEmployee) return

    setFormLoading(true)
    setFormError('')

    try {
      const { employeeApi } = await import('../services/api')
      const cleanedData: any = { ...formData }
      if (!cleanedData.dob) delete cleanedData.dob
      if (!cleanedData.join_date) delete cleanedData.join_date
      if (!cleanedData.store_id) delete cleanedData.store_id
      if (!cleanedData.department_id) delete cleanedData.department_id
      if (!cleanedData.position_id) delete cleanedData.position_id
      if (!cleanedData.education_level_id) delete cleanedData.education_level_id

      console.log('[DEBUG] PUT /employees/', selectedEmployee.employee_id)
      console.log('[DEBUG] Update payload:', cleanedData)
      await employeeApi.update(selectedEmployee.employee_id, cleanedData)
      console.log('[DEBUG] Update success')
      closeModal()
      cancelConfirm()
      fetchEmployees()
      showToast('success', 'Cập nhật nhân viên thành công!')
    } catch (err: any) {
      console.error('[DEBUG] Update error:', err)
      setFormError(err.message || 'Lỗi khi cập nhật nhân viên')
    } finally {
      setFormLoading(false)
    }
  }

  const executePromote = async () => {
    if (!selectedEmployee || !promotionData.new_position_id) {
      setFormError('Vui lòng chọn chức vụ mới')
      return
    }

    setFormLoading(true)
    setFormError('')

    try {
      const { employeeApi } = await import('../services/api')
      const promoData: PromotionCreate = {
        employee_id: selectedEmployee.employee_id,
        new_position_id: promotionData.new_position_id,
        new_store_id: promotionData.new_store_id,
        decision_number: promotionData.decision_number,
        reason: promotionData.reason,
      }
      await employeeApi.promote(promoData)
      closeModal()
      cancelConfirm()
      fetchEmployees()
      showToast('success', 'Thăng chức thành công!')
    } catch (err: any) {
      setFormError(err.message || 'Lỗi khi thăng chức')
    } finally {
      setFormLoading(false)
    }
  }

  const handleEditContract = (contract: Contract) => {
    setEditingContractId(contract.contract_id)
    setContractForm({
      contract_type: contract.contract_type || 'FIXED_1_YEAR',
      start_date: contract.start_date ? contract.start_date.split('T')[0] : '',
      end_date: contract.end_date ? contract.end_date.split('T')[0] : '',
      basic_salary: contract.basic_salary || 8000000,
      insurance_salary: contract.insurance_salary || 5000000,
      signed_date: contract.signed_date ? contract.signed_date.split('T')[0] : '',
      status: contract.status || 'ACTIVE',
    })
  }

  const handleCancelEditContract = () => {
    setEditingContractId(null)
    setContractForm({
      contract_type: 'FIXED_1_YEAR',
      start_date: new Date().toISOString().split('T')[0],
      end_date: '',
      basic_salary: selectedEmployee?.basic_salary || 8000000,
      insurance_salary: 5000000,
      signed_date: new Date().toISOString().split('T')[0],
      status: 'ACTIVE',
    })
  }

  const executeContract = async () => {
    if (!selectedEmployee) return

    setFormLoading(true)
    setFormError('')

    try {
      const { employeeApi } = await import('../services/api')
      if (editingContractId) {
        await employeeApi.updateContract(editingContractId, {
          contract_type: contractForm.contract_type,
          start_date: contractForm.start_date || undefined,
          end_date: contractForm.end_date || undefined,
          basic_salary: contractForm.basic_salary,
          insurance_salary: contractForm.insurance_salary,
          signed_date: contractForm.signed_date || undefined,
          status: contractForm.status,
        })
        showToast('success', 'Cập nhật hợp đồng thành công!')
      } else {
        await employeeApi.createContract({
          employee_id: selectedEmployee.employee_id,
          contract_type: contractForm.contract_type,
          start_date: contractForm.start_date,
          end_date: contractForm.end_date || undefined,
          basic_salary: contractForm.basic_salary,
          insurance_salary: contractForm.insurance_salary,
          signed_date: contractForm.signed_date,
        })
        showToast('success', 'Tạo hợp đồng thành công!')
      }
      cancelConfirm()
      setEditingContractId(null)
      await loadEmployeeContracts(selectedEmployee.employee_id)
      setContractForm({
        contract_type: 'FIXED_1_YEAR',
        start_date: new Date().toISOString().split('T')[0],
        end_date: '',
        basic_salary: 8000000,
        insurance_salary: 5000000,
        signed_date: new Date().toISOString().split('T')[0],
        status: 'ACTIVE',
      })
    } catch (err: any) {
      setFormError(err.message || (editingContractId ? 'Lỗi khi cập nhật hợp đồng' : 'Lỗi khi tạo hợp đồng'))
    } finally {
      setFormLoading(false)
    }
  }

  const executeResign = async () => {
    if (!selectedEmployee) return

    setFormLoading(true)
    setFormError('')

    try {
      const { employeeApi } = await import('../services/api')
      await employeeApi.delete(selectedEmployee.employee_id)
      closeModal()
      cancelConfirm()
      fetchEmployees()
      showToast('success', 'Đã cập nhật trạng thái thôi việc!')
    } catch (err: any) {
      setFormError(err.message || 'Lỗi khi cập nhật trạng thái thôi việc')
    } finally {
      setFormLoading(false)
    }
  }

  // Triggers that show confirm dialog first
  const handleSubmitAdd = () => {
    if (!formData.first_name || !formData.last_name) {
      setFormError('Vui lòng nhập họ và tên')
      return
    }
    requestConfirm('add', `Xác nhận thêm nhân viên mới "${formData.first_name} ${formData.last_name}"?`)
  }

  const handleSubmitEdit = () => {
    if (!selectedEmployee) return
    if (!formData.first_name || !formData.last_name) {
      setFormError('Vui lòng nhập họ và tên')
      return
    }
    requestConfirm('edit', `Xác nhận cập nhật thông tin nhân viên "${selectedEmployee.full_name}"?`)
  }

  const handleSubmitPromote = () => {
    if (!selectedEmployee || !promotionData.new_position_id) {
      setFormError('Vui lòng chọn chức vụ mới')
      return
    }
    const newPos = lookups?.positions?.find(p => p.position_id === promotionData.new_position_id)
    requestConfirm(
      'promote',
      `Xác nhận thăng chức "${selectedEmployee.full_name}" lên vị trí "${newPos?.position_name}"?`
    )
  }

  const handleSubmitContract = () => {
    if (!selectedEmployee) return
    const msg = editingContractId
      ? `Xác nhận cập nhật hợp đồng cho "${selectedEmployee.full_name}"?`
      : `Xác nhận tạo hợp đồng mới cho "${selectedEmployee.full_name}"?`
    requestConfirm('contract', msg)
  }

  const handleResign = () => {
    if (!selectedEmployee) return
    requestConfirm('resign', `Xác nhận thôi việc cho nhân viên "${selectedEmployee.full_name}"? Hành động này sẽ chấm dứt hợp đồng hiện tại.`)
  }

  const handleConfirm = () => {
    switch (confirmAction) {
      case 'add': executeAdd(); break
      case 'edit': executeEdit(); break
      case 'promote': executePromote(); break
      case 'contract': executeContract(); break
      case 'resign': executeResign(); break
    }
  }

  const getStatusClass = (status: string | null | undefined) => {
    switch (status) {
      case 'ACTIVE': return 'running'
      case 'PROBATION': return 'paused'
      case 'ON_LEAVE': return 'paused'
      case 'RESIGNED': return 'rejected'
      default: return ''
    }
  }

  const getStatusText = (status: string | null | undefined) => {
    switch (status) {
      case 'ACTIVE': return 'Đang làm việc'
      case 'PROBATION': return 'Thử việc'
      case 'ON_LEAVE': return 'Nghỉ phép'
      case 'RESIGNED': return 'Đã nghỉ việc'
      default: return status || 'N/A'
    }
  }

  const getContractStatusClass = (status: string) => {
    switch (status) {
      case 'ACTIVE': return 'running'
      case 'EXPIRED': return 'rejected'
      case 'TERMINATED': return 'rejected'
      default: return 'paused'
    }
  }

  // Render modal content based on mode
  const renderModalContent = () => {
    switch (modalMode) {
      case 'view': return renderViewModal()
      case 'add': return renderAddEditModal('add')
      case 'edit': return renderAddEditModal('edit')
      case 'promote': return renderPromoteModal()
      case 'contract': return renderContractModal()
      default: return null
    }
  }

  const renderViewModal = () => {
    if (!selectedEmployee) return null
    const emp = selectedEmployee

    return (
      <div className="modal-body">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div style={{ textAlign: 'center', padding: '20px', background: 'var(--surface-ground)', borderRadius: '8px' }}>
            <div style={{
              width: '80px', height: '80px', borderRadius: '50%',
              background: 'var(--primary-color)', color: 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '24px', fontWeight: 'bold', margin: '0 auto 12px'
            }}>
              {getInitials(emp.full_name)}
            </div>
            <h3 style={{ margin: '0 0 4px' }}>{emp.full_name}</h3>
            <p style={{ margin: '0', color: 'var(--text-secondary)', fontSize: '13px' }}>
              {emp.employee_code}
            </p>
            <span className={`badge-status ${getStatusClass(emp.employment_status)}`} style={{ marginTop: '8px' }}>
              {getStatusText(emp.employment_status)}
            </span>
          </div>

          <div>
            <h4 style={{ margin: '0 0 12px', fontSize: '14px', color: 'var(--text-secondary)' }}>THÔNG TIN LIÊN HỆ</h4>
            <div style={{ fontSize: '13px' }}>
              <p style={{ margin: '0 0 8px' }}><strong>Điện thoại:</strong> {emp.phone || '--'}</p>
              <p style={{ margin: '0 0 8px' }}><strong>Email cá nhân:</strong> {emp.personal_email || '--'}</p>
              <p style={{ margin: '0 0 8px' }}><strong>Email công ty:</strong> {emp.company_email || '--'}</p>
              <p style={{ margin: '0' }}><strong>Địa chỉ:</strong> {emp.current_address || emp.permanent_address || '--'}</p>
            </div>
          </div>
        </div>

        <div style={{ marginTop: '20px' }}>
          <h4 style={{ margin: '0 0 12px', fontSize: '14px', color: 'var(--text-secondary)' }}>THÔNG TIN CÔNG VIỆC</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', fontSize: '13px' }}>
            <div><strong>Cửa hàng:</strong> {emp.store_name || '--'}</div>
            <div><strong>Phòng ban:</strong> {emp.department_name || '--'}</div>
            <div><strong>Chức vụ:</strong> {emp.position_name || '--'}</div>
            <div><strong>Trình độ:</strong> {emp.education_level_name || '--'}</div>
            <div><strong>Ngày vào làm:</strong> {formatDate(emp.join_date)}</div>
            <div><strong>Ngày sinh:</strong> {formatDate(emp.dob)}</div>
            <div><strong>Giới tính:</strong> {emp.gender === 'MALE' ? 'Nam' : emp.gender === 'FEMALE' ? 'Nữ' : '--'}</div>
            <div><strong>CMND/CCCD:</strong> {emp.identity_card || '--'}</div>
          </div>
        </div>

        <div style={{ marginTop: '20px' }}>
          <h4 style={{ margin: '0 0 12px', fontSize: '14px', color: 'var(--text-secondary)' }}>THÔNG TIN THANH TOÁN</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', fontSize: '13px' }}>
            <div><strong>Ngân hàng:</strong> {emp.bank_name || '--'}</div>
            <div><strong>Số TK:</strong> {emp.bank_account_number || '--'}</div>
          </div>
        </div>

        {/* Recent contracts in view mode */}
        <div style={{ marginTop: '20px' }}>
          <h4 style={{ margin: '0 0 12px', fontSize: '14px', color: 'var(--text-secondary)' }}>
            HỢP ĐỒNG ({employeeContracts.length})
          </h4>
          {contractsLoading ? (
            <div style={{ padding: '12px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Đang tải...
            </div>
          ) : employeeContracts.length === 0 ? (
            <div style={{ padding: '12px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
              Chưa có hợp đồng
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '8px' }}>
              {employeeContracts.slice(0, 3).map(contract => (
                <div key={contract.contract_id} style={{
                  padding: '8px 12px', background: 'var(--surface-ground)',
                  borderRadius: '6px', fontSize: '12px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}>
                  <span><strong>{contract.contract_number}</strong> • {formatDate(contract.start_date)}</span>
                  <span className={`badge-status ${getContractStatusClass(contract.status)}`} style={{ fontSize: '11px' }}>
                    {contract.status === 'ACTIVE' ? 'Hiệu lực' : contract.status === 'EXPIRED' ? 'Hết hạn' : contract.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ marginTop: '24px', padding: '12px 0 0', borderTop: '1px solid var(--border-default)', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={closeModal}>
            Đóng
          </button>
        </div>
      </div>
    )
  }

  const renderAddEditModal = (mode: 'add' | 'edit') => {
    const isEdit = mode === 'edit'

    return (
      <div className="modal-body">
        {formError && (
          <div className="alert alert-error">
            {formError}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div className="form-group">
            <label className="form-label">Họ <span style={{ color: 'red' }}>*</span></label>
            <input
              type="text"
              className="form-input"
              value={formData.first_name}
              onChange={(e) => handleInputChange('first_name', e.target.value)}
              placeholder="Nhập họ"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Tên <span style={{ color: 'red' }}>*</span></label>
            <input
              type="text"
              className="form-input"
              value={formData.last_name}
              onChange={(e) => handleInputChange('last_name', e.target.value)}
              placeholder="Nhập tên"
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
          <div className="form-group">
            <label className="form-label">Giới tính</label>
            <select
              className="form-select"
              value={formData.gender || 'MALE'}
              onChange={(e) => handleInputChange('gender', e.target.value)}
            >
              <option value="MALE">Nam</option>
              <option value="FEMALE">Nữ</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Ngày sinh</label>
            <input
              type="date"
              className="form-input"
              value={formData.dob || ''}
              onChange={(e) => handleInputChange('dob', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Số CCCD</label>
            <input
              type="text"
              className="form-input"
              value={formData.identity_card || ''}
              onChange={(e) => handleInputChange('identity_card', e.target.value)}
              placeholder="012345678901"
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div className="form-group">
            <label className="form-label">Điện thoại</label>
            <input
              type="tel"
              className="form-input"
              value={formData.phone || ''}
              onChange={(e) => handleInputChange('phone', e.target.value)}
              placeholder="0901234567"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Email cá nhân</label>
            <input
              type="email"
              className="form-input"
              value={formData.personal_email || ''}
              onChange={(e) => handleInputChange('personal_email', e.target.value)}
              placeholder="email@gmail.com"
            />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Email công ty</label>
          <input
            type="email"
            className="form-input"
            value={formData.company_email || ''}
            onChange={(e) => handleInputChange('company_email', e.target.value)}
            placeholder="nv.so@techzone.vn"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Địa chỉ thường trú</label>
          <input
            type="text"
            className="form-input"
            value={formData.permanent_address || ''}
            onChange={(e) => handleInputChange('permanent_address', e.target.value)}
            placeholder="123 Đường ABC, Phường X, Quận Y, TP.HCM"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Địa chỉ hiện tại</label>
          <input
            type="text"
            className="form-input"
            value={formData.current_address || ''}
            onChange={(e) => handleInputChange('current_address', e.target.value)}
            placeholder="123 Đường ABC, Phường X, Quận Y, TP.HCM"
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
          <div className="form-group">
            <label className="form-label">Cửa hàng</label>
            <select
              className="form-select"
              value={formData.store_id || ''}
              onChange={(e) => handleInputChange('store_id', e.target.value ? Number(e.target.value) : undefined)}
            >
              <option value="">-- Chọn cửa hàng --</option>
              {lookups?.stores?.map(store => (
                <option key={store.store_id} value={store.store_id}>
                  {store.store_name} ({store.district})
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Phòng ban</label>
            <select
              className="form-select"
              value={formData.department_id || ''}
              onChange={(e) => handleInputChange('department_id', e.target.value ? Number(e.target.value) : undefined)}
            >
              <option value="">-- Chọn phòng ban --</option>
              {lookups?.departments?.map(dept => (
                <option key={dept.department_id} value={dept.department_id}>
                  {dept.department_name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Chức vụ</label>
            <select
              className="form-select"
              value={formData.position_id || ''}
              onChange={(e) => handleInputChange('position_id', e.target.value ? Number(e.target.value) : undefined)}
            >
              <option value="">-- Chọn chức vụ --</option>
              {lookups?.positions?.map(pos => (
                <option key={pos.position_id} value={pos.position_id}>
                  {pos.position_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
          <div className="form-group">
            <label className="form-label">Trình độ</label>
            <select
              className="form-select"
              value={formData.education_level_id || ''}
              onChange={(e) => handleInputChange('education_level_id', e.target.value ? Number(e.target.value) : undefined)}
            >
              <option value="">-- Chọn trình độ --</option>
              {lookups?.education_levels?.map(edu => (
                <option key={edu.education_level_id} value={edu.education_level_id}>
                  {edu.level_name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Ngày vào làm</label>
            <input
              type="date"
              className="form-input"
              value={formData.join_date || ''}
              onChange={(e) => handleInputChange('join_date', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Trạng thái</label>
            <select
              className="form-select"
              value={formData.employment_status || 'PROBATION'}
              onChange={(e) => handleInputChange('employment_status', e.target.value)}
            >
              <option value="PROBATION">Thử việc</option>
              <option value="ACTIVE">Đang làm việc</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div className="form-group">
            <label className="form-label">Ngân hàng</label>
            <input
              type="text"
              className="form-input"
              value={formData.bank_name || ''}
              onChange={(e) => handleInputChange('bank_name', e.target.value)}
              placeholder="Vietcombank"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Số tài khoản</label>
            <input
              type="text"
              className="form-input"
              value={formData.bank_account_number || ''}
              onChange={(e) => handleInputChange('bank_account_number', e.target.value)}
              placeholder="1234567890"
            />
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={closeModal}>
            Hủy bỏ
          </button>
          <button
            className="btn btn-primary"
            onClick={isEdit ? handleSubmitEdit : handleSubmitAdd}
            disabled={formLoading}
          >
            {isEdit ? 'Tiếp tục' : 'Tiếp tục'}
          </button>
        </div>
      </div>
    )
  }

  const renderPromoteModal = () => {
    if (!selectedEmployee) return null

    return (
      <div className="modal-body">
        <div className="alert alert-info">
          <strong>Nhân viên:</strong> {selectedEmployee.full_name} ({selectedEmployee.employee_code})<br/>
          <strong>Chức vụ hiện tại:</strong> {selectedEmployee.position_name}<br/>
          <strong>Cửa hàng:</strong> {selectedEmployee.store_name}
        </div>

        {formError && (
          <div className="alert alert-error">
            {formError}
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Chức vụ mới <span style={{ color: 'red' }}>*</span></label>
          <select
            className="form-select"
            value={promotionData.new_position_id || ''}
            onChange={(e) => handlePromotionChange('new_position_id', e.target.value ? Number(e.target.value) : undefined)}
          >
            <option value="">-- Chọn chức vụ mới --</option>
            {lookups?.positions?.filter(p => p.position_id !== selectedEmployee.position_id).map(pos => (
              <option key={pos.position_id} value={pos.position_id}>
                {pos.position_name}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Cửa hàng mới (nếu điều chuyển)</label>
          <select
            className="form-select"
            value={promotionData.new_store_id || ''}
            onChange={(e) => handlePromotionChange('new_store_id', e.target.value ? Number(e.target.value) : undefined)}
          >
            <option value="">-- Giữ nguyên cửa hàng --</option>
            {lookups?.stores?.filter(s => s.store_id !== selectedEmployee.store_id).map(store => (
              <option key={store.store_id} value={store.store_id}>
                {store.store_name} ({store.district})
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Số quyết định</label>
          <input
            type="text"
            className="form-input"
            value={promotionData.decision_number}
            onChange={(e) => handlePromotionChange('decision_number', e.target.value)}
            placeholder="QĐ-BN-2026"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Lý do</label>
          <textarea
            className="form-input"
            style={{ minHeight: '80px', resize: 'vertical' }}
            value={promotionData.reason}
            onChange={(e) => handlePromotionChange('reason', e.target.value)}
            placeholder="Thăng cấp chức vụ theo năng lực"
          />
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={closeModal}>
            Hủy bỏ
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSubmitPromote}
            disabled={formLoading}
          >
            Tiếp tục
          </button>
        </div>
      </div>
    )
  }

  const renderContractModal = () => {
    if (!selectedEmployee) return null

    return (
      <div className="modal-body">
        <div className="alert alert-info">
          <strong>Nhân viên:</strong> {selectedEmployee.full_name} ({selectedEmployee.employee_code})
        </div>

        {formError && (
          <div className="alert alert-error">
            {formError}
          </div>
        )}

        <h4 style={{ margin: '0 0 8px', fontSize: '14px' }}>
          Danh sách hợp đồng ({employeeContracts.length})
        </h4>

        {contractsLoading ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            {Icons.loader} Đang tải hợp đồng...
          </div>
        ) : (
          <div
            style={{
              maxHeight: '250px', overflowY: 'auto', marginBottom: '16px',
              border: '1px solid var(--border-base)', borderRadius: '8px'
            }}
          >
            <table className="data-table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th>Số HĐ</th>
                  <th>Loại</th>
                  <th>Ngày ký</th>
                  <th>Lương CB</th>
                  <th>Trạng thái</th>
                  <th style={{ width: '80px', textAlign: 'center' }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {employeeContracts.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-secondary)' }}>
                      Chưa có hợp đồng nào
                    </td>
                  </tr>
                ) : (
                  employeeContracts.map(contract => (
                    <tr key={contract.contract_id} style={editingContractId === contract.contract_id ? { background: 'var(--surface-subtle)' } : undefined}>
                      <td style={{ fontSize: '12px' }}><strong>{contract.contract_number}</strong></td>
                      <td style={{ fontSize: '12px' }}>
                        {contract.contract_type === 'FIXED_1_YEAR' ? '1 năm' :
                          contract.contract_type === 'FIXED_2_YEAR' ? '2 năm' :
                          contract.contract_type === 'INDEFINITE' ? 'Không thời hạn' :
                            contract.contract_type}
                      </td>
                      <td style={{ fontSize: '12px' }}>{formatDate(contract.signed_date)}</td>
                      <td style={{ fontSize: '12px' }}>{formatCurrency(contract.basic_salary)}</td>
                      <td>
                        <span className={`badge-status ${getContractStatusClass(contract.status)}`} style={{ fontSize: '11px' }}>
                          {contract.status === 'ACTIVE' ? 'Hiệu lực' : contract.status === 'EXPIRED' ? 'Hết hạn' : 'Đã chấm dứt'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '3px 8px', fontSize: '11px' }}
                          onClick={() => handleEditContract(contract)}
                          title="Sửa hợp đồng này"
                        >
                          {Icons.edit} Sửa
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '16px 0 12px' }}>
          <h4 style={{ margin: 0, fontSize: '14px' }}>
            {editingContractId ? 'Chỉnh sửa hợp đồng' : 'Tạo hợp đồng mới'}
          </h4>
          {editingContractId && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ fontSize: '12px', padding: '3px 10px' }}
              onClick={handleCancelEditContract}
            >
              Hủy sửa (Tạo mới)
            </button>
          )}
        </div>

        {editingContractId && (
          <div style={{ marginBottom: '12px', padding: '8px 12px', background: 'var(--surface-ground)', borderRadius: '6px', fontSize: '12px' }}>
            Đang chỉnh sửa hợp đồng số: <strong>{employeeContracts.find(c => c.contract_id === editingContractId)?.contract_number}</strong>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div className="form-group">
            <label className="form-label">Loại hợp đồng</label>
            <select
              className="form-select"
              value={contractForm.contract_type}
              onChange={(e) => handleContractChange('contract_type', e.target.value)}
            >
              <option value="FIXED_1_YEAR">Hợp đồng 1 năm</option>
              <option value="FIXED_2_YEAR">Hợp đồng 2 năm</option>
              <option value="INDEFINITE">Không thời hạn</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Ngày ký</label>
            <input
              type="date"
              className="form-input"
              value={contractForm.signed_date}
              onChange={(e) => handleContractChange('signed_date', e.target.value)}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div className="form-group">
            <label className="form-label">Ngày bắt đầu</label>
            <input
              type="date"
              className="form-input"
              value={contractForm.start_date}
              onChange={(e) => handleContractChange('start_date', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Ngày kết thúc</label>
            <input
              type="date"
              className="form-input"
              value={contractForm.end_date}
              onChange={(e) => handleContractChange('end_date', e.target.value)}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: editingContractId ? '1fr 1fr 1fr' : '1fr 1fr', gap: '12px' }}>
          <div className="form-group">
            <label className="form-label">Lương cơ bản</label>
            <input
              type="number"
              className="form-input"
              value={contractForm.basic_salary}
              onChange={(e) => handleContractChange('basic_salary', Number(e.target.value))}
              min="0"
              step="100000"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Lương đóng BH</label>
            <input
              type="number"
              className="form-input"
              value={contractForm.insurance_salary}
              onChange={(e) => handleContractChange('insurance_salary', Number(e.target.value))}
              min="0"
              step="100000"
            />
          </div>
          {editingContractId && (
            <div className="form-group">
              <label className="form-label">Trạng thái</label>
              <select
                className="form-select"
                value={contractForm.status}
                onChange={(e) => handleContractChange('status', e.target.value)}
              >
                <option value="ACTIVE">Hiệu lực</option>
                <option value="EXPIRED">Hết hạn</option>
                <option value="TERMINATED">Chấm dứt</option>
              </select>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={closeModal}>
            Đóng
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSubmitContract}
            disabled={formLoading}
          >
            {formLoading ? 'Đang xử lý...' : editingContractId ? 'Lưu thay đổi' : 'Tạo hợp đồng'}
          </button>
        </div>
      </div>
    )
  }

  const getModalHeader = () => {
    switch (modalMode) {
      case 'view':
        return {
          icon: <span className="modal-title-icon icon-view">{Icons.eye}</span>,
          title: `Hồ sơ: ${selectedEmployee?.full_name || ''}`
        }
      case 'add':
        return {
          icon: <span className="modal-title-icon icon-add">{Icons.plus}</span>,
          title: 'Thêm nhân viên mới'
        }
      case 'edit':
        return {
          icon: <span className="modal-title-icon icon-edit">{Icons.edit}</span>,
          title: `Sửa thông tin: ${selectedEmployee?.full_name || ''}`
        }
      case 'promote':
        return {
          icon: <span className="modal-title-icon icon-promote">{Icons.trendingUp}</span>,
          title: `Thăng chức / Điều chuyển: ${selectedEmployee?.full_name || ''}`
        }
      case 'contract':
        return {
          icon: <span className="modal-title-icon icon-contract">{Icons.fileText}</span>,
          title: `Quản lý hợp đồng: ${selectedEmployee?.full_name || ''}`
        }
      default:
        return { icon: null, title: '' }
    }
  }

  // Dropdown menu for actions
  const renderActionMenu = (emp: Employee) => {
    // Hiện menu nếu là Admin/HR hoặc Cửa hàng trưởng cùng chi nhánh
    const isManagerOfBranch = role === 'STORE_MANAGER' && user?.store_id === emp.store_id
    if (!canManage && !isManagerOfBranch) return null
    if (openMenuId !== emp.employee_id) return null

    return (
      <div
        className="action-dropdown"
        onClick={(e) => e.stopPropagation()}
      >
        {canManage && (
          <>
            <button
              className="action-dropdown-item"
              onClick={() => openModal('edit', emp)}
            >
              <span className="action-icon icon-edit">{Icons.edit}</span>
              <span>Sửa thông tin</span>
            </button>
            <button
              className="action-dropdown-item"
              onClick={() => openModal('contract', emp)}
            >
              <span className="action-icon icon-contract">{Icons.fileText}</span>
              <span>Quản lý hợp đồng</span>
            </button>
            <button
              className="action-dropdown-item"
              onClick={() => openModal('promote', emp)}
            >
              <span className="action-icon icon-promote">{Icons.trendingUp}</span>
              <span>Thăng chức / Điều chuyển</span>
            </button>
            <div className="action-dropdown-divider"></div>
          </>
        )}
        {isManagerOfBranch && (
          <button
            className="action-dropdown-item"
            onClick={() => openShiftEditModal(emp)}
          >
            <span className="action-icon icon-edit">{Icons.edit}</span>
            <span>Sửa ca làm</span>
          </button>
        )}
        {canManage && (
          <button
            className="action-dropdown-item danger"
            onClick={() => {
              setSelectedEmployee(emp)
              handleResign()
            }}
          >
            <span className="action-icon icon-danger">{Icons.xCircle}</span>
            <span>Thôi việc</span>
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Hồ sơ Nhân sự</h1>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => fetchEmployees()}>
            {Icons.refresh} Làm mới
          </button>
          {canManage && (
            <button className="btn btn-primary btn-sm" onClick={() => openModal('add')}>
              {Icons.plus} Thêm nhân viên
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flex: 1, flexWrap: 'wrap' }}>
            <div className="search-box" style={{ flex: 1, minWidth: '220px' }}>
              <span className="search-icon">{Icons.search}</span>
              <input
                type="text"
                className="form-input"
                placeholder="Tìm kiếm họ tên, mã NV, SĐT..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            {lookups?.stores && lookups.stores.length > 0 && (
              <select
                className="form-select"
                value={filterStore || ''}
                onChange={(e) => setFilterStore(e.target.value ? Number(e.target.value) : null)}
                style={{ width: 'auto', minWidth: '160px' }}
              >
                <option value="">Tất cả cửa hàng</option>
                {lookups.stores.map(store => (
                  <option key={store.store_id} value={store.store_id}>
                    {store.store_name}
                  </option>
                ))}
              </select>
            )}
            <select
              className="form-select"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              style={{ width: 'auto', minWidth: '160px' }}
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="ACTIVE">Đang làm việc</option>
              <option value="PROBATION">Thử việc</option>
              <option value="ON_LEAVE">Nghỉ phép</option>
              <option value="RESIGNED">Đã nghỉ việc</option>
            </select>
            {/* Bộ lọc chức vụ */}
            {lookups?.positions && lookups.positions.length > 0 && (
              <select
                className="form-select"
                value={filterPosition || ''}
                onChange={(e) => setFilterPosition(e.target.value ? Number(e.target.value) : null)}
                style={{ width: 'auto', minWidth: '160px' }}
              >
                <option value="">Tất cả chức vụ</option>
                {lookups.positions.map(pos => (
                  <option key={pos.position_id} value={pos.position_id}>
                    {pos.position_name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="card-body" style={{ textAlign: 'center', padding: '40px' }}>
            <div style={{ marginBottom: '12px' }}>{Icons.loader}</div>
            Đang tải dữ liệu nhân sự...
          </div>
        ) : (
          <>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>NHÂN SỰ</th>
                    <th style={{ width: '85px' }}>MÃ NV</th>
                    <th>CHỨC VỤ</th>
                    <th>CỬA HÀNG / PHÒNG BAN</th>
                    <th style={{ width: '160px' }}>LIÊN HỆ</th>
                    <th style={{ width: '130px', textAlign: 'center' }}>TRẠNG THÁI</th>
                    <th style={{ width: '105px' }}>NGÀY VÀO</th>
                    <th style={{ width: '100px', textAlign: 'center' }}>HÀNH ĐỘNG</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ padding: '36px 16px', textAlign: 'center' }}>
                        <EmptyState
                          icon={Icons.users}
                          title="Không tìm thấy nhân sự nào"
                          description="Không có bản ghi nhân sự nào khớp với điều kiện tìm kiếm hoặc trong cơ sở dữ liệu."
                        />
                      </td>
                    </tr>
                  ) : (
                    filteredEmployees.map((emp) => (
                      <tr key={emp.employee_id}>
                        <td>
                          <div className="table-user-cell">
                            <div className="table-user-avatar">
                              {getInitials(emp.full_name)}
                            </div>
                            <div className="table-user-details">
                              <span className="table-user-name">
                                {emp.full_name || `${emp.first_name} ${emp.last_name}`}
                              </span>
                              <span className="table-user-sub">
                                {emp.gender === 'MALE' ? 'Nam' : emp.gender === 'FEMALE' ? 'Nữ' : '--'}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="table-cell-mono">
                            {emp.employee_code || `NV-${emp.employee_id}`}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                            {emp.position_name || 'Nhân viên'}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontSize: '12px' }}>
                            <div>{emp.store_name || 'Chưa phân công'}</div>
                            <div style={{ color: 'var(--text-secondary)' }}>{emp.department_name || ''}</div>
                          </div>
                        </td>
                        <td>
                          <div style={{ fontSize: '12px' }}>
                            <div>{emp.phone || '--'}</div>
                            <div style={{ color: 'var(--text-secondary)' }}>
                              {emp.company_email || emp.personal_email || '--'}
                            </div>
                          </div>
                        </td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <span className={`badge-status ${getStatusClass(emp.employment_status)}`}>
                            {getStatusText(emp.employment_status)}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                            {formatDate(emp.join_date ?? undefined)}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '4px', position: 'relative' }}>
                            <button
                              className="btn btn-secondary btn-sm btn-icon"
                              title="Xem chi tiết"
                              onClick={() => openModal('view', emp)}
                            >
                              {Icons.eye}
                            </button>
                            {/* Nút sửa ca: chỉ hiện với STORE_MANAGER cùng chi nhánh */}
                            {role === 'STORE_MANAGER' && user?.store_id === emp.store_id && (
                              <button
                                className="btn btn-secondary btn-sm btn-icon"
                                title="Sửa ca làm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openShiftEditModal(emp)
                                }}
                              >
                                {Icons.edit}
                              </button>
                            )}
                            {(canManage || (role === 'STORE_MANAGER' && user?.store_id === emp.store_id)) && (
                              <button
                                className="btn btn-secondary btn-sm btn-icon"
                                title="Tùy chọn"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setOpenMenuId(openMenuId === emp.employee_id ? null : emp.employee_id)
                                }}
                              >
                                {Icons.moreVertical}
                              </button>
                            )}
                            {renderActionMenu(emp)}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="table-pagination">
              <span>Hiển thị {filteredEmployees.length} trên {employees.length} nhân sự</span>
            </div>
          </>
        )}
      </div>

      {/* Main Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && closeModal()}>
          <div className="modal" style={{ maxWidth: modalMode === 'view' ? '700px' : '600px' }}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {getModalHeader().icon}
                <span>{getModalHeader().title}</span>
              </h3>
              <button className="modal-close" onClick={closeModal} title="Đóng">
                {Icons.x}
              </button>
            </div>
            {renderModalContent()}
          </div>
        </div>
      )}
      {/* Shift Edit Modal */}
      {showShiftModal && selectedEmployee && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && closeShiftModal()}>
          <div className="modal" style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span className="modal-title-icon icon-clock">{Icons.clock}</span>
                <span>Sửa ca làm cho {selectedEmployee.full_name}</span>
              </h3>
              <button className="modal-close" onClick={closeShiftModal} title="Đóng">
                {Icons.x}
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label className="form-label">Giờ vào</label>
                <input type="datetime-local" className="form-input" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)} />
              </div>
              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label className="form-label">Giờ ra</label>
                <input type="datetime-local" className="form-input" value={shiftEnd} onChange={(e) => setShiftEnd(e.target.value)} />
              </div>
              <div style={{ marginBottom: '16px' }}>
                <label className="form-label" style={{ display: 'block', marginBottom: '8px' }}>Ca mẫu (tự động điền giờ):</label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {[
                    { label: 'Ca sáng (6:00–14:00)', key: 'Ca sáng' },
                    { label: 'Ca chiều (14:00–22:00)', key: 'Ca chiều' },
                    { label: 'Ca tối (22:00–6:00)', key: 'Ca tối' },
                  ].map(ca => (
                    <button
                      key={ca.key}
                      className={`btn btn-sm ${shiftPreset === ca.key ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => applyShiftPreset(ca.key)}
                      style={{ minWidth: '150px' }}
                    >
                      {ca.label}
                    </button>
                  ))}
                </div>
                {shiftStart && shiftEnd && (
                  <div style={{ marginTop: '10px', padding: '8px 12px', background: 'var(--surface-ground)', borderRadius: '6px', fontSize: '13px' }}>
                    ⏱ Số giờ làm tính được: <strong>
                      {(() => {
                        const s = new Date(shiftStart), e = new Date(shiftEnd)
                        let h = (e.getTime() - s.getTime()) / 3600000
                        if (h < 0) h += 24
                        return h.toFixed(1) + ' giờ'
                      })()}
                    </strong>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={closeShiftModal}>Hủy</button>
              <button className="btn btn-primary" onClick={handleShiftSave}>Lưu</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmAction && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && cancelConfirm()}>
          <div className="modal" style={{ maxWidth: '450px' }}>
            <div className="modal-header">
              <h3 className="modal-title">Xác nhận hành động</h3>
              <button className="modal-close" onClick={cancelConfirm}>
                {Icons.x}
              </button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                <div style={{
                  width: '48px', height: '48px', borderRadius: '50%',
                  background: confirmAction === 'resign' ? '#fee2e2' : '#dbeafe',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0
                }}>
                  {confirmAction === 'resign' ? Icons.alertTriangle : Icons.alertCircle}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: '0', fontSize: '14px', lineHeight: '1.5' }}>
                    {confirmMessage}
                  </p>
                </div>
              </div>

              {formError && (
                <div className="alert alert-error" style={{ marginTop: '16px' }}>
                  {formError}
                </div>
              )}

              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={cancelConfirm} disabled={formLoading}>
                  Hủy bỏ
                </button>
                <button
                  className={confirmAction === 'resign' ? 'btn btn-danger' : 'btn btn-primary'}
                  onClick={handleConfirm}
                  disabled={formLoading}
                  style={confirmAction === 'resign' ? { background: '#dc2626', color: 'white' } : {}}
                >
                  {formLoading ? 'Đang xử lý...' : 'Xác nhận'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.type === 'success' ? Icons.checkCircle : Icons.alertCircle}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  )
}
