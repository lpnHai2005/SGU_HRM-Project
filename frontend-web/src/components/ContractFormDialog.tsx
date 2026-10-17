/**
 * Contract Form Dialog
 * Form tạo và cập nhật hợp đồng lao động chuẩn Vero Design System
 * Tự động tính ngày kết thúc cho các loại hợp đồng 1, 2, 3 năm
 * Tích hợp EmployeeSearchSelect tìm kiếm nhân viên thời gian thực
 */
import { useState, useEffect } from 'react'
import { contractApi, type ContractCreateData, type ContractUpdateData } from '../services/contractService'
import { type Contract, type ContractType } from '../types/contract'
import { Icons } from './common/Icons'
import { EmployeeSearchSelect } from './common/EmployeeSearchSelect'
import { toast } from 'sonner'

export interface ContractFormDialogProps {
  open: boolean
  contract?: Contract | null
  employees: any[]
  positions: any[]
  departments: any[]
  onClose: () => void
  onSuccess?: () => void
}

const CONTRACT_TYPE_OPTIONS = [
  { value: 'FIXED_1_YEAR', label: 'Xác định thời hạn (1 năm)', years: 1 },
  { value: 'FIXED_2_YEAR', label: 'Xác định thời hạn (2 năm)', years: 2 },
  { value: 'FIXED_3_YEAR', label: 'Xác định thời hạn (3 năm)', years: 3 },
  { value: 'PROBATION', label: 'Thử việc', years: 0 },
  { value: 'FIXED_TERM', label: 'Xác định thời hạn khác (Tùy chỉnh ngày)', years: 0 },
  { value: 'INDEFINITE', label: 'Không xác định thời hạn (Vô thời hạn)', years: 0 },
]

export function ContractFormDialog({
  open,
  contract,
  employees,
  positions,
  departments,
  onClose,
  onSuccess,
}: ContractFormDialogProps) {
  const isEdit = Boolean(contract)

  // Form State
  const [employeeId, setEmployeeId] = useState<string>('')
  const [contractType, setContractType] = useState<ContractType>('FIXED_1_YEAR')
  const [startDate, setStartDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [endDate, setEndDate] = useState<string>('')
  const [basicSalary, setBasicSalary] = useState<string>('')
  const [insuranceSalary, setInsuranceSalary] = useState<string>('')
  const [signedDate, setSignedDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [positionId, setPositionId] = useState<string>('')
  const [departmentId, setDepartmentId] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)

  // Helper: Tính ngày kết thúc tự động dựa trên ngày bắt đầu và loại HĐ 1, 2, 3 năm
  const computeEndDate = (start: string, type: string): string => {
    if (!start) return ''
    const d = new Date(start)
    if (isNaN(d.getTime())) return ''

    let years = 0
    if (type === 'FIXED_1_YEAR') years = 1
    else if (type === 'FIXED_2_YEAR') years = 2
    else if (type === 'FIXED_3_YEAR') years = 3

    if (years > 0) {
      d.setFullYear(d.getFullYear() + years)
      d.setDate(d.getDate() - 1)
      return d.toISOString().split('T')[0]
    }
    return ''
  }

  const isAutoEndDate = contractType === 'FIXED_1_YEAR' || contractType === 'FIXED_2_YEAR' || contractType === 'FIXED_3_YEAR'
  const isIndefinite = contractType === 'INDEFINITE'

  useEffect(() => {
    if (open) {
      if (contract) {
        // Mode: Edit
        setEmployeeId(contract.employee_id.toString())
        setContractType(contract.contract_type)
        setStartDate(contract.start_date)
        setEndDate(contract.end_date || '')
        setBasicSalary(contract.basic_salary?.toString() || '')
        setInsuranceSalary(contract.insurance_salary?.toString() || '')
        setSignedDate(contract.signed_date)
        setPositionId(contract.position_id?.toString() || '')
        setDepartmentId(contract.department_id?.toString() || '')
        setNotes(contract.notes || '')
      } else {
        // Mode: Create
        const today = new Date().toISOString().split('T')[0]
        setEmployeeId('')
        setContractType('FIXED_1_YEAR')
        setStartDate(today)
        setEndDate(computeEndDate(today, 'FIXED_1_YEAR'))
        setBasicSalary('')
        setInsuranceSalary('')
        setSignedDate(today)
        setPositionId('')
        setDepartmentId('')
        setNotes('')
      }
      setFile(null)
    }
  }, [open, contract])

  // Khi thay đổi loại hợp đồng
  const handleContractTypeChange = (newType: ContractType) => {
    setContractType(newType)
    if (newType === 'FIXED_1_YEAR' || newType === 'FIXED_2_YEAR' || newType === 'FIXED_3_YEAR') {
      const calculated = computeEndDate(startDate, newType)
      setEndDate(calculated)
    } else if (newType === 'INDEFINITE') {
      setEndDate('')
    }
  }

  // Khi thay đổi ngày bắt đầu
  const handleStartDateChange = (newStart: string) => {
    setStartDate(newStart)
    if (isAutoEndDate) {
      const calculated = computeEndDate(newStart, contractType)
      setEndDate(calculated)
    }
  }

  // Khi chọn nhân viên (tự động gợi ý chức vụ, phòng ban và lương cơ bản hiện tại)
  const handleEmployeeChange = (empId: string, empObj?: any) => {
    setEmployeeId(empId)
    if (!isEdit && empId) {
      const selectedEmp = empObj || employees.find(e => String(e.employee_id) === String(empId))
      if (selectedEmp) {
        if (selectedEmp.position_id) setPositionId(selectedEmp.position_id.toString())
        if (selectedEmp.department_id) setDepartmentId(selectedEmp.department_id.toString())
        if (selectedEmp.basic_salary) {
          setBasicSalary(selectedEmp.basic_salary.toString())
          setInsuranceSalary(selectedEmp.basic_salary.toString())
        }
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validation
    if (!employeeId) {
      toast.error('Vui lòng chọn nhân viên')
      return
    }
    if (!startDate || !signedDate) {
      toast.error('Vui lòng nhập ngày bắt đầu và ngày ký')
      return
    }

    if (!isIndefinite && !endDate) {
      toast.error('Hợp đồng cần có ngày kết thúc')
      return
    }

    if (!isIndefinite && endDate && new Date(endDate) <= new Date(startDate)) {
      toast.error('Ngày kết thúc phải lớn hơn ngày bắt đầu')
      return
    }

    if (!basicSalary || parseFloat(basicSalary) < 0) {
      toast.error('Lương cơ bản không được âm')
      return
    }

    setLoading(true)
    try {
      let createdOrUpdatedId: number

      if (isEdit && contract) {
        const updateData: ContractUpdateData = {
          contract_type: contractType,
          start_date: startDate,
          end_date: isIndefinite ? null : endDate,
          basic_salary: parseFloat(basicSalary),
          insurance_salary: insuranceSalary ? parseFloat(insuranceSalary) : undefined,
          signed_date: signedDate,
          position_id: positionId ? parseInt(positionId) : undefined,
          department_id: departmentId ? parseInt(departmentId) : undefined,
          notes: notes || undefined,
        }
        await contractApi.update(contract.contract_id, updateData)
        createdOrUpdatedId = contract.contract_id
        toast.success('Cập nhật hợp đồng thành công!')
      } else {
        const createData: ContractCreateData = {
          employee_id: parseInt(employeeId),
          contract_type: contractType,
          start_date: startDate,
          end_date: isIndefinite ? null : endDate,
          basic_salary: parseFloat(basicSalary),
          insurance_salary: insuranceSalary ? parseFloat(insuranceSalary) : undefined,
          signed_date: signedDate,
          position_id: positionId ? parseInt(positionId) : undefined,
          department_id: departmentId ? parseInt(departmentId) : undefined,
          notes: notes || undefined,
        }
        const result = await contractApi.create(createData)
        createdOrUpdatedId = result.contract_id
        if (!file) {
          toast.success('Tạo hợp đồng và tự động sinh file PDF chuẩn thành công!')
        } else {
          toast.success('Tạo hợp đồng thành công!')
        }
      }

      // Upload file nếu có
      if (file) {
        try {
          await contractApi.uploadFile(createdOrUpdatedId, file)
          toast.success('Upload file PDF thành công!')
        } catch (err) {
          toast.error('Upload file thất bại')
        }
      }

      onSuccess?.()
      onClose()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Có lỗi xảy ra khi lưu hợp đồng')
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="modal-overlay"
      onClick={(e) => !loading && e.target === e.currentTarget && onClose()}
    >
      <div className="modal" style={{ maxWidth: '720px', maxHeight: '90vh' }}>
        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}
        >
          {/* Header */}
          <div className="modal-header">
            <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span className={`modal-title-icon ${isEdit ? 'icon-edit' : 'icon-add'}`}>
                {isEdit ? Icons.edit : Icons.plus}
              </span>
              <span>{isEdit ? 'Chỉnh sửa hợp đồng lao động' : 'Tạo hợp đồng lao động mới'}</span>
            </h3>
            <button
              type="button"
              className="modal-close"
              onClick={onClose}
              disabled={loading}
              title="Đóng"
            >
              {Icons.x}
            </button>
          </div>

          {/* Body */}
          <div className="modal-body" style={{ padding: '20px', flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
              {/* Employee Combobox */}
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <EmployeeSearchSelect
                  employees={employees}
                  value={employeeId}
                  onChange={(id, emp) => handleEmployeeChange(id ? String(id) : '', emp)}
                  disabled={isEdit}
                  required
                  label="Nhân viên ký hợp đồng"
                  placeholder="Tìm theo tên, mã NV, chức vụ..."
                />
              </div>

              {/* Contract Type */}
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 500, fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                  Loại hợp đồng <span style={{ color: 'var(--status-error)' }}>*</span>
                </label>
                <select
                  className="form-select"
                  value={contractType}
                  onChange={(e) => handleContractTypeChange(e.target.value as ContractType)}
                  required
                >
                  {CONTRACT_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Signed Date */}
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 500, fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                  Ngày ký hợp đồng <span style={{ color: 'var(--status-error)' }}>*</span>
                </label>
                <input
                  type="date"
                  className="form-input"
                  value={signedDate}
                  onChange={(e) => setSignedDate(e.target.value)}
                  required
                />
              </div>

              {/* Start Date */}
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 500, fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                  Ngày bắt đầu <span style={{ color: 'var(--status-error)' }}>*</span>
                </label>
                <input
                  type="date"
                  className="form-input"
                  value={startDate}
                  onChange={(e) => handleStartDateChange(e.target.value)}
                  required
                />
              </div>

              {/* End Date */}
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 500, fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                  Ngày kết thúc {!isIndefinite && <span style={{ color: 'var(--status-error)' }}>*</span>}
                </label>
                {isIndefinite ? (
                  <input
                    type="text"
                    className="form-input"
                    value="Không xác định (Vô thời hạn)"
                    disabled
                    readOnly
                    style={{ background: 'var(--surface-subtle)', color: 'var(--text-tertiary)', cursor: 'not-allowed' }}
                  />
                ) : isAutoEndDate ? (
                  <div>
                    <input
                      type="date"
                      className="form-input"
                      value={endDate}
                      disabled
                      readOnly
                      style={{ background: 'var(--surface-subtle)', cursor: 'not-allowed', color: 'var(--text-primary)' }}
                      required
                    />
                    <div style={{ fontSize: '11.5px', color: 'var(--status-info)', marginTop: '4px' }}>
                      ✓ Tự động tính theo ngày bắt đầu (
                      {contractType === 'FIXED_1_YEAR' ? '1 năm' : contractType === 'FIXED_2_YEAR' ? '2 năm' : '3 năm'})
                    </div>
                  </div>
                ) : (
                  <div>
                    <input
                      type="date"
                      className="form-input"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      min={startDate}
                      required
                    />
                    <div style={{ fontSize: '11.5px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                      Tùy chỉnh ngày kết thúc hợp đồng
                    </div>
                  </div>
                )}
              </div>

              {/* Basic Salary */}
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 500, fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                  Lương cơ bản (VNĐ) <span style={{ color: 'var(--status-error)' }}>*</span>
                </label>
                <input
                  type="number"
                  className="form-input"
                  value={basicSalary}
                  onChange={(e) => setBasicSalary(e.target.value)}
                  placeholder="Ví dụ: 8000000"
                  min="0"
                  step="100000"
                  required
                />
              </div>

              {/* Insurance Salary */}
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 500, fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                  Lương đóng BHXH (VNĐ)
                </label>
                <input
                  type="number"
                  className="form-input"
                  value={insuranceSalary}
                  onChange={(e) => setInsuranceSalary(e.target.value)}
                  placeholder="Ví dụ: 5000000 (để trống nếu theo lương cơ bản)"
                  min="0"
                  step="100000"
                />
              </div>

              {/* Position */}
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 500, fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                  Chức vụ ghi trên HĐ
                </label>
                <select
                  className="form-select"
                  value={positionId}
                  onChange={(e) => setPositionId(e.target.value)}
                >
                  <option value="">-- Mặc định theo hồ sơ nhân sự --</option>
                  {positions.map((pos) => (
                    <option key={pos.position_id} value={pos.position_id}>
                      {pos.position_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Department */}
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 500, fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                  Phòng ban ghi trên HĐ
                </label>
                <select
                  className="form-select"
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                >
                  <option value="">-- Mặc định theo hồ sơ nhân sự --</option>
                  {departments.map((d) => (
                    <option key={d.department_id} value={d.department_id}>
                      {d.department_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* File upload */}
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label className="form-label" style={{ fontWeight: 500, fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                  Tệp đính kèm bản scan hợp đồng (PDF)
                </label>
                <input
                  type="file"
                  className="form-input"
                  accept="application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
                {!file && !contract?.contract_file_url ? (
                  <div style={{ fontSize: '12px', marginTop: '6px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ color: 'var(--primary-color)' }}>{Icons.fileText}</span>
                    <span>Để trống để hệ thống <strong>tự động tạo file PDF Hợp đồng lao động chuẩn Bộ luật Lao động</strong>.</span>
                  </div>
                ) : null}
                {contract?.contract_file_url && (
                  <div style={{ fontSize: '12px', marginTop: '6px', color: 'var(--text-secondary)' }}>
                    Bản hiện tại:{' '}
                    <a
                      href={contract.contract_file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'var(--primary-color)', textDecoration: 'underline' }}
                    >
                      Xem file PDF đã đính kèm
                    </a>
                  </div>
                )}
              </div>

              {/* Notes */}
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label className="form-label" style={{ fontWeight: 500, fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                  Ghi chú điều khoản / phụ lục
                </label>
                <textarea
                  className="form-input"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Nhập ghi chú thêm về hợp đồng nếu có..."
                  style={{ resize: 'vertical' }}
                />
              </div>
            </div>
          </div>

          {/* Footer with generous spacing from modal edges */}
          <div
            className="modal-footer"
            style={{
              flexShrink: 0,
              padding: '16px 20px',
              borderTop: '1px solid var(--border-default)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '10px',
              margin: 0,
            }}
          >
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={loading}
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              {loading ? Icons.loader : (isEdit ? Icons.edit : Icons.plus)}
              <span>{loading ? 'Đang xử lý...' : (isEdit ? 'Cập nhật hợp đồng' : 'Tạo hợp đồng')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default ContractFormDialog
