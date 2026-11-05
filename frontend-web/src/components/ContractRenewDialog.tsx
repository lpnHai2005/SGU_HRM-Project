/**
 * Contract Renew Dialog
 * Form gia hạn hợp đồng lao động chuẩn Vero Design System
 * Hỗ trợ tự động tính ngày kết thúc theo thời hạn gia hạn (1, 2, 3 năm)
 */
import { useState, useEffect } from 'react'
import { contractApi, type ContractRenewData, type WorkingHoursPerWeek } from '../services/contractService'
import { employeeApi } from '../services/api'
import { type Contract, type ContractType, addDaysToDate, addYearsToContractStart, getContractTypeLabel, toLocalDateString } from '../types/contract'
import { formatDate, formatCurrency, getInitials } from '../utils/formatters'
import { Icons } from './common/Icons'
import { toast } from 'sonner'

export interface ContractRenewDialogProps {
  open: boolean
  contract: Contract | null
  onClose: () => void
  onSuccess?: () => void
}

type RenewDuration = '1_YEAR' | '2_YEAR' | '3_YEAR' | 'INDEFINITE'

const DURATION_YEARS: Partial<Record<RenewDuration, number>> = { '1_YEAR': 1, '2_YEAR': 2, '3_YEAR': 3 }

// Loại HĐ mới đi theo thời hạn được chọn, không giữ loại của HĐ cũ
const DURATION_CONTRACT_TYPE: Record<RenewDuration, ContractType> = {
  '1_YEAR': 'FIXED_1_YEAR',
  '2_YEAR': 'FIXED_2_YEAR',
  '3_YEAR': 'FIXED_3_YEAR',
  INDEFINITE: 'INDEFINITE',
}

export function ContractRenewDialog({
  open,
  contract,
  onClose,
  onSuccess,
}: ContractRenewDialogProps) {
  const [renewDuration, setRenewDuration] = useState<RenewDuration>('1_YEAR')
  const [newStartDate, setNewStartDate] = useState<string>('')
  const [newEndDate, setNewEndDate] = useState<string>('')
  const [newBasicSalary, setNewBasicSalary] = useState<string>('')
  const [newInsuranceSalary, setNewInsuranceSalary] = useState<string>('')
  const [newWorkingHours, setNewWorkingHours] = useState<WorkingHoursPerWeek>(48)
  const [newPositionId, setNewPositionId] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [positions, setPositions] = useState<any[]>([])

  // Helper tính ngày kết thúc
  const computeEndDate = (start: string, duration: RenewDuration): string => {
    const years = DURATION_YEARS[duration]
    return start && years ? addYearsToContractStart(start, years) : ''
  }

  // Ngày sớm nhất HĐ mới được bắt đầu: liền sau ngày kết thúc HĐ cũ
  const earliestStart = contract?.end_date ? addDaysToDate(contract.end_date, 1) : undefined

  useEffect(() => {
    if (open && contract) {
      // Mặc định nối tiếp HĐ cũ; HĐ đã hết hạn từ trước thì bắt đầu từ hôm nay
      const today = toLocalDateString()
      const nextDay = contract.end_date ? addDaysToDate(contract.end_date, 1) : today
      const defaultStart = nextDay > today ? nextDay : today
      setNewStartDate(defaultStart)
      setRenewDuration('1_YEAR')
      setNewEndDate(computeEndDate(defaultStart, '1_YEAR'))
      setNewBasicSalary(contract.basic_salary?.toString() || '')
      setNewInsuranceSalary(contract.insurance_salary?.toString() || '')
      setNewWorkingHours((contract.working_hours_per_week as WorkingHoursPerWeek) || 48)
      setNewPositionId(contract.position_id?.toString() || '')
      setNotes(`Gia hạn từ hợp đồng ${contract.contract_number}`)
    }
  }, [open, contract])

  // Tải danh sách chức vụ
  useEffect(() => {
    if (open) {
      employeeApi.getLookups().then(data => {
        if (data && data.positions) {
          setPositions(data.positions)
        }
      }).catch(console.error)
    }
  }, [open])

  // Đổi thời hạn gia hạn
  const handleDurationChange = (duration: RenewDuration) => {
    setRenewDuration(duration)
    setNewEndDate(computeEndDate(newStartDate, duration))
  }

  // Đổi ngày bắt đầu
  const handleStartDateChange = (newStart: string) => {
    setNewStartDate(newStart)
    setNewEndDate(computeEndDate(newStart, renewDuration))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!contract) return

    if (!newStartDate) {
      toast.error('Vui lòng chọn ngày bắt đầu mới')
      return
    }

    if (earliestStart && newStartDate < earliestStart) {
      toast.error('Ngày bắt đầu mới phải sau ngày kết thúc hợp đồng cũ')
      return
    }

    if (renewDuration !== 'INDEFINITE' && !newEndDate) {
      toast.error('Vui lòng nhập ngày kết thúc cho hợp đồng có thời hạn')
      return
    }

    if (newEndDate && new Date(newEndDate) <= new Date(newStartDate)) {
      toast.error('Ngày kết thúc mới phải lớn hơn ngày bắt đầu mới')
      return
    }

    if (parseFloat(newBasicSalary) < 0 || parseFloat(newInsuranceSalary) < 0) {
      toast.error('Lương mới không được âm')
      return
    }

    setLoading(true)
    try {
      const data: ContractRenewData = {
        new_start_date: newStartDate,
        new_end_date: renewDuration === 'INDEFINITE' ? null : newEndDate || null,
        new_contract_type: DURATION_CONTRACT_TYPE[renewDuration],
        new_basic_salary: newBasicSalary ? parseFloat(newBasicSalary) : undefined,
        new_insurance_salary: newInsuranceSalary ? parseFloat(newInsuranceSalary) : undefined,
        new_working_hours_per_week: newWorkingHours,
        new_position_id: newPositionId ? parseInt(newPositionId) : undefined,
        notes: notes || undefined,
      }
      const result = await contractApi.renew(contract.contract_id, data)
      toast.success(
        `Gia hạn thành công! Hợp đồng mới: ${result.new_contract_number}`
      )
      onSuccess?.()
      onClose()
    } catch (err: any) {
      toast.error(err?.message || 'Lỗi khi gia hạn hợp đồng')
    } finally {
      setLoading(false)
    }
  }

  if (!open || !contract) return null

  const effectiveInsurance = parseFloat(newInsuranceSalary) || contract.insurance_salary || 0

  return (
    <div
      className="modal-overlay"
      onClick={(e) => !loading && e.target === e.currentTarget && onClose()}
    >
      <div className="modal" style={{ maxWidth: '640px', maxHeight: '90vh' }}>
        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}
        >
          {/* Header */}
          <div className="modal-header">
            <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span className="modal-title-icon icon-contract">
                {Icons.refresh}
              </span>
              <span>Gia hạn hợp đồng lao động</span>
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
            {/* Contract Summary Box */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                padding: '12px 14px',
                background: 'var(--surface-ground)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-default)',
                marginBottom: '16px',
              }}
            >
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  background: 'var(--surface-card)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-default)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                {getInitials(contract.employee_name)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--text-primary)' }}>
                  {contract.employee_name} ({contract.employee_code})
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  HĐ hiện tại: <strong style={{ fontFamily: 'var(--font-mono)' }}>{contract.contract_number}</strong>
                  {' · '}
                  <span>{getContractTypeLabel(contract.contract_type)}</span>
                  {' · '}
                  <span>{formatDate(contract.start_date)} đến {contract.end_date ? formatDate(contract.end_date) : 'Vô thời hạn'}</span>
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
              {/* Duration Preset Selector */}
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label className="form-label" style={{ fontWeight: 500, fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                  Thời hạn hợp đồng gia hạn <span style={{ color: 'var(--status-error)' }}>*</span>
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                  {[
                    { key: '1_YEAR', label: '1 năm' },
                    { key: '2_YEAR', label: '2 năm' },
                    { key: '3_YEAR', label: '3 năm' },
                    { key: 'INDEFINITE', label: 'Vô thời hạn' },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={`btn btn-sm ${renewDuration === item.key ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => handleDurationChange(item.key as any)}
                      style={{ fontSize: '12px', padding: '6px 4px', textAlign: 'center' }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Start Date */}
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 500, fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                  Ngày bắt đầu mới <span style={{ color: 'var(--status-error)' }}>*</span>
                </label>
                <input
                  type="date"
                  className="form-input"
                  value={newStartDate}
                  onChange={(e) => handleStartDateChange(e.target.value)}
                  min={earliestStart}
                  required
                />
              </div>

              {/* End Date */}
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 500, fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                  Ngày kết thúc mới {renewDuration !== 'INDEFINITE' && <span style={{ color: 'var(--status-error)' }}>*</span>}
                </label>
                {renewDuration === 'INDEFINITE' ? (
                  <input
                    type="text"
                    className="form-input"
                    value="Không xác định (Vô thời hạn)"
                    disabled
                    readOnly
                    style={{ background: 'var(--surface-subtle)', color: 'var(--text-tertiary)', cursor: 'not-allowed' }}
                  />
                ) : (
                  <div>
                    <input
                      type="date"
                      className="form-input"
                      value={newEndDate}
                      disabled
                      readOnly
                      style={{ background: 'var(--surface-subtle)', cursor: 'not-allowed', color: 'var(--text-primary)' }}
                      required
                    />
                    <div style={{ fontSize: '11.5px', color: 'var(--status-info)', marginTop: '4px' }}>
                      ✓ Tự động tính theo ngày bắt đầu ({DURATION_YEARS[renewDuration]} năm)
                    </div>
                  </div>
                )}
              </div>

              {/* Basic Salary */}
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 500, fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                  Lương cơ bản mới (VNĐ)
                </label>
                <input
                  type="number"
                  className="form-input"
                  value={newBasicSalary}
                  onChange={(e) => setNewBasicSalary(e.target.value)}
                  min="0"
                  step="100000"
                  placeholder={contract.basic_salary?.toString() || 'Nhập mức lương mới'}
                />
              </div>

              {/* Working hours per week */}
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 500, fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                  Thời giờ làm việc <span style={{ color: 'var(--status-error)' }}>*</span>
                </label>
                <select
                  className="form-select"
                  value={newWorkingHours}
                  onChange={(e) => setNewWorkingHours(Number(e.target.value) as WorkingHoursPerWeek)}
                  required
                >
                  <option value={48}>48 giờ/tuần</option>
                  <option value={44}>44 giờ/tuần</option>
                  <option value={40}>40 giờ/tuần</option>
                </select>
              </div>

              {/* Insurance Salary */}
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 500, fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                  Lương đóng bảo hiểm mới (VNĐ)
                </label>
                <input
                  type="number"
                  className="form-input"
                  value={newInsuranceSalary}
                  onChange={(e) => setNewInsuranceSalary(e.target.value)}
                  min="0"
                  step="100000"
                  placeholder={contract.insurance_salary?.toString() || 'Giữ mức hiện tại'}
                />
              </div>

              {/* Insurance Deduction - Auto-calculated */}
              {(() => {
                const totalInsuranceDeduction = effectiveInsurance * 0.105

                return (
                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <label className="form-label" style={{ fontWeight: 500, fontSize: '13px', margin: 0 }}>
                        Trích nộp Bảo hiểm Bắt buộc (10.5%)
                      </label>
                      <span style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: '4px',
                        backgroundColor: 'var(--surface-subtle)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border-default)'
                      }}>
                        Tự động tính 10.5%
                      </span>
                    </div>
                    <input
                      type="text"
                      className="form-input"
                      value={effectiveInsurance ? `- ${formatCurrency(totalInsuranceDeduction)}` : '0 VNĐ'}
                      readOnly
                      disabled
                      style={{
                        backgroundColor: 'var(--surface-subtle)',
                        cursor: 'not-allowed',
                        fontWeight: 600,
                        color: effectiveInsurance ? 'var(--status-error)' : 'var(--text-secondary)',
                        fontFamily: 'var(--font-mono)'
                      }}
                    />
                  </div>
                )
              })()}

              {/* Insurance Breakdown Box */}
              {(() => {
                const bhxhAmount = effectiveInsurance * 0.08
                const bhytAmount = effectiveInsurance * 0.015
                const bhtnAmount = effectiveInsurance * 0.01

                return (
                  <div style={{
                    gridColumn: 'span 2',
                    padding: '10px 14px',
                    fontSize: '12px',
                    lineHeight: '1.6',
                    color: 'var(--text-secondary)',
                    backgroundColor: 'var(--surface-subtle)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)'
                  }}>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '6px',
                      borderBottom: '1px dashed var(--border-default)',
                      paddingBottom: '6px'
                    }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        Mức lương làm căn cứ đóng BH sau gia hạn:
                      </span>
                      <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                        {formatCurrency(effectiveInsurance)}
                      </strong>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px' }}>
                      <span>• BHXH (8.0%): <strong>{formatCurrency(bhxhAmount)}</strong></span>
                      <span>|</span>
                      <span>• BHYT (1.5%): <strong>{formatCurrency(bhytAmount)}</strong></span>
                      <span>|</span>
                      <span>• BHTN (1.0%): <strong>{formatCurrency(bhtnAmount)}</strong></span>
                    </div>
                  </div>
                )
              })()}

              {/* Position */}
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label className="form-label" style={{ fontWeight: 500, fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                  Chức vụ sau gia hạn
                </label>
                <select
                  className="form-select"
                  value={newPositionId}
                  onChange={(e) => setNewPositionId(e.target.value)}
                >
                  <option value="">-- Giữ nguyên chức vụ hiện tại --</option>
                  {positions.map((pos) => (
                    <option key={pos.position_id} value={pos.position_id}>
                      {pos.position_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Notes */}
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label className="form-label" style={{ fontWeight: 500, fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                  Ghi chú gia hạn
                </label>
                <textarea
                  className="form-input"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Nhập ghi chú điều chỉnh lương, chức vụ hoặc điều khoản hợp đồng mới..."
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
              {loading ? Icons.loader : Icons.refresh}
              <span>{loading ? 'Đang xử lý...' : 'Tạo hợp đồng gia hạn'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default ContractRenewDialog
