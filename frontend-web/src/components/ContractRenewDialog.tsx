/**
 * Contract Renew Dialog
 * Form gia hạn hợp đồng lao động chuẩn Vero Design System
 * Hỗ trợ tự động tính ngày kết thúc theo thời hạn gia hạn (1, 2, 3 năm)
 */
import { useState, useEffect } from 'react'
import { contractApi, type ContractRenewData } from '../services/contractService'
import { employeeApi } from '../services/api'
import { type Contract, getContractTypeLabel } from '../types/contract'
import { formatDate, getInitials } from '../utils/formatters'
import { Icons } from './common/Icons'
import { toast } from 'sonner'

export interface ContractRenewDialogProps {
  open: boolean
  contract: Contract | null
  onClose: () => void
  onSuccess?: () => void
}

export function ContractRenewDialog({
  open,
  contract,
  onClose,
  onSuccess,
}: ContractRenewDialogProps) {
  const [renewDuration, setRenewDuration] = useState<'1_YEAR' | '2_YEAR' | '3_YEAR' | 'CUSTOM' | 'INDEFINITE'>('1_YEAR')
  const [newStartDate, setNewStartDate] = useState<string>('')
  const [newEndDate, setNewEndDate] = useState<string>('')
  const [newBasicSalary, setNewBasicSalary] = useState<string>('')
  const [newPositionId, setNewPositionId] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [positions, setPositions] = useState<any[]>([])

  // Helper tính ngày kết thúc
  const computeEndDate = (start: string, duration: string): string => {
    if (!start) return ''
    const d = new Date(start)
    if (isNaN(d.getTime())) return ''

    let years = 0
    if (duration === '1_YEAR') years = 1
    else if (duration === '2_YEAR') years = 2
    else if (duration === '3_YEAR') years = 3

    if (years > 0) {
      d.setFullYear(d.getFullYear() + years)
      d.setDate(d.getDate() - 1)
      return d.toISOString().split('T')[0]
    }
    return ''
  }

  useEffect(() => {
    if (open && contract) {
      // Ngày bắt đầu mặc định: ngày liền sau ngày kết thúc HĐ cũ (hoặc ngày hôm nay)
      let defaultStart = new Date().toISOString().split('T')[0]
      if (contract.end_date) {
        const nextDay = new Date(contract.end_date)
        nextDay.setDate(nextDay.getDate() + 1)
        defaultStart = nextDay.toISOString().split('T')[0]
      }
      setNewStartDate(defaultStart)
      setRenewDuration('1_YEAR')
      setNewEndDate(computeEndDate(defaultStart, '1_YEAR'))
      setNewBasicSalary(contract.basic_salary?.toString() || '')
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
  const handleDurationChange = (duration: '1_YEAR' | '2_YEAR' | '3_YEAR' | 'CUSTOM' | 'INDEFINITE') => {
    setRenewDuration(duration)
    if (duration === 'INDEFINITE') {
      setNewEndDate('')
    } else if (duration !== 'CUSTOM') {
      setNewEndDate(computeEndDate(newStartDate, duration))
    }
  }

  // Đổi ngày bắt đầu
  const handleStartDateChange = (newStart: string) => {
    setNewStartDate(newStart)
    if (renewDuration === '1_YEAR' || renewDuration === '2_YEAR' || renewDuration === '3_YEAR') {
      setNewEndDate(computeEndDate(newStart, renewDuration))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!contract) return

    if (!newStartDate) {
      toast.error('Vui lòng chọn ngày bắt đầu mới')
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

    if (newBasicSalary && parseFloat(newBasicSalary) < 0) {
      toast.error('Lương mới không được âm')
      return
    }

    setLoading(true)
    try {
      const data: ContractRenewData = {
        new_start_date: newStartDate,
        new_end_date: renewDuration === 'INDEFINITE' ? null : newEndDate || null,
        new_basic_salary: newBasicSalary ? parseFloat(newBasicSalary) : undefined,
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
      toast.error(err?.response?.data?.detail || 'Lỗi khi gia hạn hợp đồng')
    } finally {
      setLoading(false)
    }
  }

  if (!open || !contract) return null

  const isAuto = renewDuration === '1_YEAR' || renewDuration === '2_YEAR' || renewDuration === '3_YEAR'

  return (
    <div
      className="modal-overlay"
      onClick={(e) => !loading && e.target === e.currentTarget && onClose()}
    >
      <div className="modal" style={{ maxWidth: '640px' }}>
        <form onSubmit={handleSubmit}>
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
          <div className="modal-body" style={{ padding: '20px' }}>
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>
                  {[
                    { key: '1_YEAR', label: '1 năm' },
                    { key: '2_YEAR', label: '2 năm' },
                    { key: '3_YEAR', label: '3 năm' },
                    { key: 'INDEFINITE', label: 'Vô thời hạn' },
                    { key: 'CUSTOM', label: 'Tùy chỉnh' },
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
                ) : isAuto ? (
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
                      ✓ Tự động tính theo ngày bắt đầu ({renewDuration.replace('_', ' ').toLowerCase()})
                    </div>
                  </div>
                ) : (
                  <input
                    type="date"
                    className="form-input"
                    value={newEndDate}
                    onChange={(e) => setNewEndDate(e.target.value)}
                    min={newStartDate}
                    required
                  />
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

              {/* Position */}
              <div className="form-group">
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
