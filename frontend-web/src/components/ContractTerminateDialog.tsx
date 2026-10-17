/**
 * Contract Terminate Dialog
 * Form chấm dứt hợp đồng chuẩn Vero Design System (Linear / Attio minimalist, dual theme)
 * Tích hợp kiểm tra đơn thôi việc đã được phê duyệt, ràng buộc giấy tờ/chứng từ (Quyết định / Biên bản / File đính kèm),
 * và thông báo khóa tài khoản.
 */
import { useState, useEffect } from 'react'
import { contractApi, type ContractTerminateData } from '../services/contractService'
import { resignationApi } from '../services/resignationService'
import { type Contract, getContractTypeLabel, getContractStatusClass, CONTRACT_STATUS_LABELS } from '../types/contract'
import {
  type TerminationReasonType,
  type Resignation,
  TERMINATION_REASON_TYPE_LABELS,
} from '../types/resignation'
import { formatDate, getInitials } from '../utils/formatters'
import { Icons } from './common/Icons'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'

export interface ContractTerminateDialogProps {
  open: boolean
  contract: Contract | null
  onClose: () => void
  onSuccess?: () => void
}

export function ContractTerminateDialog({
  open,
  contract,
  onClose,
  onSuccess,
}: ContractTerminateDialogProps) {
  const navigate = useNavigate()
  const [terminationType, setTerminationType] = useState<TerminationReasonType>('EMPLOYEE_RESIGNATION')
  const [terminationDate, setTerminationDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  )
  const [terminationReason, setTerminationReason] = useState<string>('')
  const [decisionNumber, setDecisionNumber] = useState<string>('')
  const [docFile, setDocFile] = useState<File | null>(null)
  const [docUrl, setDocUrl] = useState<string>('')
  const [uploadingDoc, setUploadingDoc] = useState(false)
  const [notes, setNotes] = useState<string>('')
  const [loading, setLoading] = useState(false)

  // Resignation check state
  const [checkingResignation, setCheckingResignation] = useState(false)
  const [approvedResignations, setApprovedResignations] = useState<Resignation[]>([])
  const [selectedResignationId, setSelectedResignationId] = useState<number | null>(null)

  // Reset and check approved resignation when dialog opens or contract changes
  useEffect(() => {
    if (open && contract?.employee_id) {
      setTerminationType('EMPLOYEE_RESIGNATION')
      setDecisionNumber('')
      setDocFile(null)
      setDocUrl('')
      setNotes('')
      setCheckingResignation(true)
      resignationApi
        .list({ employee_id: contract.employee_id, status: 'APPROVED' })
        .then((res) => {
          const list = res.items || []
          setApprovedResignations(list)
          if (list.length > 0) {
            setSelectedResignationId(list[0].resignation_id)
            if (list[0].approved_last_working_date) {
              setTerminationDate(list[0].approved_last_working_date)
            }
            if (list[0].attachment_url) {
              setDocUrl(list[0].attachment_url)
            }
            setTerminationReason(`Thôi việc theo đơn ngày ${list[0].submitted_date}: ${list[0].reason}`)
          } else {
            setSelectedResignationId(null)
            setTerminationDate(new Date().toISOString().split('T')[0])
            setTerminationReason('')
          }
        })
        .catch(console.error)
        .finally(() => setCheckingResignation(false))
    }
  }, [open, contract])

  const handleTypeChange = (type: TerminationReasonType) => {
    setTerminationType(type)
    if (type === 'EMPLOYEE_RESIGNATION') {
      if (approvedResignations.length > 0) {
        const item = approvedResignations[0]
        setSelectedResignationId(item.resignation_id)
        if (item.approved_last_working_date) {
          setTerminationDate(item.approved_last_working_date)
        }
        if (item.attachment_url) {
          setDocUrl(item.attachment_url)
        }
        setTerminationReason(`Thôi việc theo đơn ngày ${item.submitted_date}: ${item.reason}`)
      } else {
        setTerminationReason('')
      }
    } else if (type === 'MUTUAL_AGREEMENT') {
      setTerminationReason('Thỏa thuận chấm dứt hợp đồng lao động giữa hai bên theo thỏa thuận')
    } else if (type === 'EMPLOYER_TERMINATION') {
      setTerminationReason('Công ty đơn phương chấm dứt hợp đồng lao động theo quy định')
    } else {
      setTerminationReason('')
    }
  }

  // Handle document file selection (không upload ngay mà lưu tạm vào state)
  const handleDocFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (!selected) return

    if (selected.size > 10 * 1024 * 1024) {
      toast.error('Dung lượng file không được vượt quá 10MB')
      return
    }

    setDocFile(selected)
    toast.info(`Đã chọn: ${selected.name}`)
  }

  const handleClearDocFile = () => {
    setDocFile(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!contract) return

    if (!terminationDate) {
      toast.error('Vui lòng chọn ngày chấm dứt')
      return
    }

    if (terminationReason.trim().length < 5) {
      toast.error('Lý do chấm dứt phải có ít nhất 5 ký tự')
      return
    }

    // Validate date is within contract period
    if (contract.start_date && new Date(terminationDate) < new Date(contract.start_date)) {
      toast.error('Ngày chấm dứt không được trước ngày bắt đầu hợp đồng')
      return
    }

    if (contract.end_date && new Date(terminationDate) > new Date(contract.end_date)) {
      toast.error('Ngày chấm dứt không được sau ngày kết thúc hợp đồng')
      return
    }

    // If EMPLOYEE_RESIGNATION, enforce approved resignation
    if (terminationType === 'EMPLOYEE_RESIGNATION' && approvedResignations.length === 0) {
      toast.error('Nhân viên chưa có đơn thôi việc đã duyệt. Vui lòng tạo và duyệt đơn thôi việc trước!')
      return
    }

    // Enforce documentation/proof constraint: must have chosen docFile OR existing docUrl OR decision number
    const hasProof = Boolean(docFile || docUrl || decisionNumber.trim())
    if (!hasProof) {
      toast.error('Bắt buộc phải có tài liệu chứng từ kèm theo (Chọn file Quyết định/Biên bản hoặc nhập Số hiệu văn bản)!')
      return
    }

    setLoading(true)
    try {
      let finalDocUrl = docUrl || undefined

      // Chỉ thực hiện lưu file vào Cloudinary khi người dùng bấm xác nhận!
      if (docFile) {
        setUploadingDoc(true)
        try {
          const uploadRes = await contractApi.uploadTerminationDoc(docFile)
          finalDocUrl = uploadRes.file_url
        } catch (uploadErr: any) {
          toast.error(uploadErr?.message || 'Lỗi khi tải file chứng từ lên hệ thống')
          setLoading(false)
          setUploadingDoc(false)
          return
        } finally {
          setUploadingDoc(false)
        }
      }

      const data: ContractTerminateData = {
        termination_date: terminationDate,
        termination_reason: terminationReason.trim(),
        termination_type: terminationType,
        resignation_id: selectedResignationId,
        document_url: finalDocUrl,
        decision_number: decisionNumber.trim() || undefined,
        notes: notes.trim() || undefined,
      }
      const res = await contractApi.terminate(contract.contract_id, data)
      toast.success(res.message || 'Chấm dứt hợp đồng thành công!')
      onSuccess?.()
      onClose()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || err?.message || 'Lỗi khi chấm dứt hợp đồng')
    } finally {
      setLoading(false)
    }
  }

  if (!open || !contract) return null

  const isResignationMissing = terminationType === 'EMPLOYEE_RESIGNATION' && approvedResignations.length === 0 && !checkingResignation
  const hasProof = Boolean(docFile || docUrl || decisionNumber.trim())

  return (
    <div
      className="modal-overlay"
      onClick={(e) => !loading && e.target === e.currentTarget && onClose()}
    >
      <div className="modal" style={{ maxWidth: '600px', maxHeight: '90vh' }}>
        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}
        >
          {/* Header */}
          <div className="modal-header">
            <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span
                className="modal-title-icon"
                style={{
                  background: 'var(--status-error-bg)',
                  color: 'var(--status-error)',
                  border: '1px solid var(--status-error-border)',
                }}
              >
                {Icons.xCircle}
              </span>
              <span>Chấm dứt hợp đồng lao động</span>
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
                padding: '14px',
                background: 'var(--surface-ground)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-default)',
                marginBottom: '16px',
              }}
            >
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '50%',
                  background: 'var(--surface-card)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-default)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '15px',
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                {getInitials(contract.employee_name)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>
                    {contract.employee_name || '--'}
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                    ({contract.employee_code || '--'})
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {contract.contract_number}
                  </span>
                  {' · '}
                  <span>{getContractTypeLabel(contract.contract_type)}</span>
                  {' · '}
                  <span>
                    {formatDate(contract.start_date)} → {contract.end_date ? formatDate(contract.end_date) : 'Vô thời hạn'}
                  </span>
                </div>
              </div>
              <span className={`badge-status ${getContractStatusClass(contract.status)}`}>
                {CONTRACT_STATUS_LABELS[contract.status] || contract.status}
              </span>
            </div>

            {/* Structured Termination Type */}
            <div className="form-group" style={{ marginBottom: '14px' }}>
              <label className="form-label" style={{ fontWeight: 500, marginBottom: '6px', display: 'block', fontSize: '13px' }}>
                Diện chấm dứt <span style={{ color: 'var(--status-error)' }}>*</span>
              </label>
              <select
                className="form-input"
                value={terminationType}
                onChange={(e) => handleTypeChange(e.target.value as TerminationReasonType)}
                style={{ width: '100%', height: '38px' }}
              >
                {(Object.keys(TERMINATION_REASON_TYPE_LABELS) as TerminationReasonType[]).map((key) => (
                  <option key={key} value={key}>
                    {TERMINATION_REASON_TYPE_LABELS[key]}
                  </option>
                ))}
              </select>
            </div>

            {/* Resignation Status Warning/Success Banner if EMPLOYEE_RESIGNATION */}
            {terminationType === 'EMPLOYEE_RESIGNATION' && (
              <div style={{ marginBottom: '16px' }}>
                {checkingResignation ? (
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', padding: '8px' }}>
                    Đang kiểm tra đơn thôi việc của nhân viên...
                  </div>
                ) : approvedResignations.length > 0 ? (
                  <div
                    style={{
                      background: 'rgba(16, 185, 129, 0.1)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      color: 'var(--status-success, #10b981)',
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '12.5px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <span>{Icons.checkCircle}</span>
                    <span>
                      Đã xác nhận đơn thôi việc được duyệt (#{approvedResignations[0].resignation_id} - Ngày nghỉ:{' '}
                      {formatDate(approvedResignations[0].approved_last_working_date)})
                    </span>
                  </div>
                ) : (
                  <div
                    style={{
                      background: 'rgba(239, 68, 68, 0.08)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      color: 'var(--status-error)',
                      padding: '12px 14px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '12.5px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
                      <span>{Icons.alertCircle}</span>
                      <span>Chưa có đơn thôi việc được phê duyệt</span>
                    </div>
                    <p style={{ margin: '6px 0 10px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                      Quy trình yêu cầu HR nhập và duyệt đơn thôi việc từ nhân viên trước khi chấm dứt hợp đồng.
                    </p>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        onClose()
                        navigate('/resignations')
                      }}
                      style={{ fontSize: '12px' }}
                    >
                      Đi tới Quản lý thôi việc →
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Termination Date */}
            <div className="form-group" style={{ marginBottom: '14px' }}>
              <label className="form-label" style={{ fontWeight: 500, marginBottom: '6px', display: 'block', fontSize: '13px' }}>
                Ngày làm việc cuối cùng / Ngày chấm dứt <span style={{ color: 'var(--status-error)' }}>*</span>
              </label>
              <input
                type="date"
                className="form-input"
                value={terminationDate}
                onChange={(e) => setTerminationDate(e.target.value)}
                min={contract.start_date}
                max={contract.end_date || undefined}
                required
              />
              <div style={{ fontSize: '11.5px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                Nằm trong thời hạn hợp đồng ({formatDate(contract.start_date)}
                {contract.end_date ? ` đến ${formatDate(contract.end_date)}` : ''})
              </div>
            </div>

            {/* Termination Reason */}
            <div className="form-group" style={{ marginBottom: '14px' }}>
              <label className="form-label" style={{ fontWeight: 500, marginBottom: '6px', display: 'block', fontSize: '13px' }}>
                Lý do chấm dứt chi tiết <span style={{ color: 'var(--status-error)' }}>*</span>
              </label>
              <textarea
                className="form-input"
                value={terminationReason}
                onChange={(e) => setTerminationReason(e.target.value)}
                rows={2}
                placeholder="Nhập lý do cụ thể..."
                required
                minLength={5}
                style={{ resize: 'vertical', minHeight: '60px' }}
              />
            </div>

            {/* MANDATORY PROOF SECTION (Giấy tờ, chứng từ kèm theo) */}
            <div
              style={{
                background: 'var(--surface-subtle)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px 14px',
                marginBottom: '14px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <label className="form-label" style={{ fontWeight: 600, fontSize: '13px', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>Hồ sơ & Chứng từ chấm dứt</span>
                  <span style={{ color: 'var(--status-error)' }}>* (Bắt buộc)</span>
                </label>
                {hasProof && (
                  <span style={{ fontSize: '11.5px', color: 'var(--status-success)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    {Icons.check} Đủ chứng từ
                  </span>
                )}
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 10px 0' }}>
                Quy định công ty yêu cầu phải có <strong>Số hiệu quyết định</strong> hoặc <strong>Văn bản scan (Quyết định thôi việc / Biên bản thanh lý)</strong>.
              </p>

              {/* Decision Number Input */}
              <div className="form-group" style={{ marginBottom: '10px' }}>
                <label className="form-label" style={{ fontSize: '12px', marginBottom: '4px', display: 'block' }}>
                  Số hiệu Quyết định thôi việc / Văn bản chấm dứt:
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Ví dụ: QĐ-2026/08/NS hoặc BB-TL-042"
                  value={decisionNumber}
                  onChange={(e) => setDecisionNumber(e.target.value)}
                  style={{ height: '34px', fontSize: '12.5px' }}
                />
              </div>

              {/* Upload Document / File */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: '12px', marginBottom: '4px', display: 'block' }}>
                  File đính kèm (PDF, Ảnh chụp biên bản, quyết định):
                </label>
                <div
                  style={{
                    border: '1px dashed var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '8px 12px',
                    background: 'var(--surface-card)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                  }}
                >
                  <input
                    type="file"
                    id="termination-doc-file"
                    style={{ display: 'none' }}
                    accept=".pdf,image/png,image/jpeg,image/webp"
                    onChange={handleDocFileChange}
                    disabled={uploadingDoc}
                  />
                  <label
                    htmlFor="termination-doc-file"
                    className="btn btn-secondary btn-sm"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', margin: 0, padding: '4px 10px', fontSize: '12px' }}
                  >
                    {uploadingDoc ? Icons.loader : Icons.upload}
                    <span>{uploadingDoc ? 'Đang tải...' : 'Chọn file...'}</span>
                  </label>
                  <div style={{ flex: 1, minWidth: 0, fontSize: '12px', color: 'var(--text-secondary)' }}>
                    {docFile ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <span style={{ fontWeight: 600, color: 'var(--brand-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          📄 {docFile.name} ({(docFile.size / 1024).toFixed(0)} KB)
                        </span>
                        <button
                          type="button"
                          onClick={handleClearDocFile}
                          style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: '2px', display: 'flex' }}
                          title="Hủy chọn file"
                        >
                          {Icons.x}
                        </button>
                      </div>
                    ) : docUrl ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: 'var(--status-success)', fontWeight: 500 }}>
                          Đã có tệp từ đơn thôi việc ✓
                        </span>
                        <a
                          href={docUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontSize: '11.5px', color: 'var(--brand-primary)', textDecoration: 'underline' }}
                        >
                          Xem file
                        </a>
                      </div>
                    ) : (
                      <span>Chưa có tệp (chấp nhận PDF, JPG, PNG)</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="form-group" style={{ marginBottom: '14px' }}>
              <label className="form-label" style={{ fontWeight: 500, marginBottom: '6px', display: 'block', fontSize: '13px' }}>
                Ghi chú thêm (Bàn giao tài sản, thanh toán...)
              </label>
              <input
                type="text"
                className="form-input"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ví dụ: Đã bàn giao đầy đủ máy tính và thẻ nhân viên"
              />
            </div>

            {/* Consequence Alert */}
            <div
              className="alert alert-warning"
              style={{
                padding: '10px 14px',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                marginBottom: 0,
              }}
            >
              <span style={{ flexShrink: 0, marginTop: '2px' }}>{Icons.alertTriangle}</span>
              <div style={{ fontSize: '12px', lineHeight: '1.5' }}>
                <strong>Lưu ý quan trọng:</strong> Nếu nhân viên không còn hợp đồng hiệu lực nào khác, tài khoản đăng nhập sẽ tự động bị <strong>KHÓA</strong> và trạng thái hồ sơ chuyển sang <strong>ĐÃ THÔI VIỆC</strong>.
              </div>
            </div>
          </div>

          {/* Footer with generous spacing from modal edges and flex-shrink 0 */}
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
              className="btn btn-danger"
              disabled={loading || isResignationMissing || terminationReason.trim().length < 5 || !hasProof}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              {Icons.xCircle}
              <span>{loading ? 'Đang xử lý...' : 'Xác nhận chấm dứt'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default ContractTerminateDialog
