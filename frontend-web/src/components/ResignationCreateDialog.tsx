/**
 * Resignation Create Dialog
 * Form tiếp nhận và nhập đơn xin thôi việc từ nhân viên (do HR thực hiện)
 * Vero Design System (Linear / Attio minimalist, dual theme)
 * Tích hợp EmployeeSearchSelect tìm kiếm nhân viên thời gian thực
 */
import { useState, useEffect } from 'react'
import { resignationApi } from '../services/resignationService'
import { RESIGNATION_REASON_PRESETS } from '../types/resignation'
import { getContractTypeLabel } from '../types/contract'
import { formatDate } from '../utils/formatters'
import { Icons } from './common/Icons'
import { EmployeeSearchSelect } from './common/EmployeeSearchSelect'
import { toast } from 'sonner'

export interface ResignationCreateDialogProps {
  open: boolean
  employees: any[]
  onClose: () => void
  onSuccess?: () => void
}

export function ResignationCreateDialog({
  open,
  employees,
  onClose,
  onSuccess,
}: ResignationCreateDialogProps) {
  const [employeeId, setEmployeeId] = useState<string>('')
  const [activeContracts, setActiveContracts] = useState<any[]>([])
  const [contractId, setContractId] = useState<string>('')
  const [loadingContracts, setLoadingContracts] = useState(false)

  // Dates
  const todayStr = new Date().toISOString().split('T')[0]
  const defaultLastDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0]

  const [submittedDate, setSubmittedDate] = useState<string>(todayStr)
  const [requestedLastWorkingDate, setRequestedLastWorkingDate] = useState<string>(defaultLastDate)
  const [reason, setReason] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [file, setFile] = useState<File | null>(null)
  const [uploadedUrl, setUploadedUrl] = useState<string>('')
  const [uploadingFile, setUploadingFile] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Reset when dialog opens
  useEffect(() => {
    if (open) {
      setEmployeeId('')
      setActiveContracts([])
      setContractId('')
      setSubmittedDate(new Date().toISOString().split('T')[0])
      setRequestedLastWorkingDate(
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      )
      setReason('')
      setNotes('')
      setFile(null)
      setUploadedUrl('')
    }
  }, [open])

  // Fetch active contracts when employee selected
  useEffect(() => {
    if (!employeeId) {
      setActiveContracts([])
      setContractId('')
      return
    }

    setLoadingContracts(true)
    resignationApi
      .getEmployeeActiveContracts(parseInt(employeeId))
      .then((contracts) => {
        setActiveContracts(contracts || [])
        if (contracts && contracts.length > 0) {
          setContractId(String(contracts[0].contract_id))
        } else {
          setContractId('')
        }
      })
      .catch((err) => {
        console.error('Error fetching contracts:', err)
        toast.error('Lỗi khi tải danh sách hợp đồng của nhân viên')
      })
      .finally(() => setLoadingContracts(false))
  }, [employeeId])

  // Handle file select (lưu tạm vào state, chỉ upload khi nhấn Lưu hồ sơ)
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (!selected) return

    if (selected.size > 10 * 1024 * 1024) {
      toast.error('Dung lượng file không được vượt quá 10MB')
      return
    }

    setFile(selected)
    toast.info(`Đã chọn: ${selected.name}`)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!employeeId) {
      toast.error('Vui lòng chọn nhân viên')
      return
    }

    if (!contractId) {
      toast.error('Nhân viên phải có hợp đồng đang ACTIVE để tạo đơn thôi việc')
      return
    }

    if (new Date(requestedLastWorkingDate) < new Date(submittedDate)) {
      toast.error('Ngày dự kiến nghỉ không được trước ngày nộp đơn')
      return
    }

    if (reason.trim().length < 5) {
      toast.error('Lý do thôi việc phải có ít nhất 5 ký tự')
      return
    }

    setSubmitting(true)
    try {
      let finalAttachmentUrl = uploadedUrl || undefined

      // Chỉ upload lên Cloudinary khi HR nhấn Lưu hồ sơ thôi việc!
      if (file) {
        setUploadingFile(true)
        try {
          const res = await resignationApi.uploadAttachment(file)
          finalAttachmentUrl = res.file_url
        } catch (uploadErr: any) {
          toast.error(uploadErr?.message || 'Lỗi khi upload file đính kèm')
          setSubmitting(false)
          setUploadingFile(false)
          return
        } finally {
          setUploadingFile(false)
        }
      }

      const payload = {
        employee_id: parseInt(employeeId),
        contract_id: parseInt(contractId),
        submitted_date: submittedDate,
        requested_last_working_date: requestedLastWorkingDate,
        reason: reason.trim(),
        attachment_url: finalAttachmentUrl,
        notes: notes.trim() || undefined,
      }

      const res = await resignationApi.create(payload)
      toast.success(res.message || 'Tạo đơn thôi việc thành công!')
      onSuccess?.()
      onClose()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || err?.message || 'Lỗi khi tạo đơn thôi việc')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="modal-overlay"
      onClick={(e) => !submitting && e.target === e.currentTarget && onClose()}
    >
      <div className="modal" style={{ maxWidth: '620px', maxHeight: '90vh' }}>
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
                  background: 'var(--brand-primary-light, rgba(59, 130, 246, 0.1))',
                  color: 'var(--brand-primary)',
                  border: '1px solid var(--brand-primary)',
                }}
              >
                {Icons.clipboardList}
              </span>
              <span>Tiếp nhận đơn thôi việc</span>
            </h3>
            <button
              type="button"
              className="modal-close"
              onClick={onClose}
              disabled={submitting}
              title="Đóng"
            >
              {Icons.x}
            </button>
          </div>

          {/* Body */}
          <div className="modal-body" style={{ padding: '20px', flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {/* Banner: Nhân viên không tự tạo đơn trên hệ thống */}
            <div
              className="alert alert-info"
              style={{
                marginBottom: '16px',
                padding: '10px 14px',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                fontSize: '12.5px',
                lineHeight: '1.5',
              }}
            >
              <span style={{ flexShrink: 0, marginTop: '2px' }}>{Icons.info}</span>
              <div>
                HR nhập đơn vào hệ thống dựa trên <strong>đơn giấy hoặc văn bản PDF</strong> mà nhân viên đã gửi. Đơn sau khi tạo sẽ ở trạng thái <strong>CHỜ DUYỆT (PENDING)</strong>.
              </div>
            </div>

            {/* 1. Chọn Nhân viên bằng EmployeeSearchSelect */}
            <div className="form-group" style={{ marginBottom: '14px' }}>
              <EmployeeSearchSelect
                employees={employees}
                value={employeeId}
                onChange={(id) => setEmployeeId(id ? String(id) : '')}
                placeholder="Tìm kiếm theo mã, họ tên, phòng ban..."
                required
                label="Chọn nhân viên nộp đơn"
              />
            </div>

            {/* 2. Chọn Hợp đồng đang ACTIVE */}
            <div className="form-group" style={{ marginBottom: '14px' }}>
              <label className="form-label" style={{ fontWeight: 500, marginBottom: '6px', display: 'block', fontSize: '13px' }}>
                Hợp đồng lao động đang áp dụng <span style={{ color: 'var(--status-error)' }}>*</span>
              </label>
              {loadingContracts ? (
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', padding: '6px 0' }}>
                  Đang tải hợp đồng...
                </div>
              ) : activeContracts.length > 0 ? (
                <select
                  className="form-input"
                  value={contractId}
                  onChange={(e) => setContractId(e.target.value)}
                  required
                  style={{ width: '100%', height: '38px' }}
                >
                  {activeContracts.map((c) => (
                    <option key={c.contract_id} value={c.contract_id}>
                      {c.contract_number} ({getContractTypeLabel(c.contract_type)}) - Hiệu lực:{' '}
                      {formatDate(c.start_date)} → {c.end_date ? formatDate(c.end_date) : 'Vô thời hạn'}
                    </option>
                  ))}
                </select>
              ) : employeeId ? (
                <div
                  style={{
                    color: 'var(--status-error)',
                    background: 'rgba(239, 68, 68, 0.08)',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '12px',
                  }}
                >
                  Nhân viên này không có hợp đồng nào đang ở trạng thái ACTIVE! Không thể tạo đơn thôi việc.
                </div>
              ) : (
                <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                  Vui lòng chọn nhân viên trước để hiển thị hợp đồng.
                </div>
              )}
            </div>

            {/* 3. Ngày nộp đơn & Ngày dự kiến nghỉ việc */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 500, marginBottom: '6px', display: 'block', fontSize: '13px' }}>
                  Ngày nộp đơn <span style={{ color: 'var(--status-error)' }}>*</span>
                </label>
                <input
                  type="date"
                  className="form-input"
                  value={submittedDate}
                  onChange={(e) => setSubmittedDate(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 500, marginBottom: '6px', display: 'block', fontSize: '13px' }}>
                  Ngày dự kiến nghỉ việc <span style={{ color: 'var(--status-error)' }}>*</span>
                </label>
                <input
                  type="date"
                  className="form-input"
                  value={requestedLastWorkingDate}
                  onChange={(e) => setRequestedLastWorkingDate(e.target.value)}
                  min={submittedDate}
                  required
                />
              </div>
            </div>

            {/* 4. Lý do thôi việc & Quick Presets */}
            <div className="form-group" style={{ marginBottom: '14px' }}>
              <label className="form-label" style={{ fontWeight: 500, marginBottom: '6px', display: 'block', fontSize: '13px' }}>
                Lý do thôi việc <span style={{ color: 'var(--status-error)' }}>*</span>
              </label>

              {/* Quick Preset Buttons */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                {RESIGNATION_REASON_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setReason(preset)}
                    style={{
                      fontSize: '11.5px',
                      padding: '3px 8px',
                      borderRadius: '12px',
                      border: '1px solid var(--border-default)',
                      background: reason === preset ? 'var(--brand-primary-light, rgba(59, 130, 246, 0.15))' : 'var(--surface-ground)',
                      color: reason === preset ? 'var(--brand-primary)' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    + {preset}
                  </button>
                ))}
              </div>

              <textarea
                className="form-input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Nhập lý do thôi việc chi tiết ghi trong đơn..."
                rows={3}
                required
                minLength={5}
                style={{ resize: 'vertical', minHeight: '70px' }}
              />
            </div>

            {/* 5. Đính kèm đơn thôi việc scan/PDF */}
            <div className="form-group" style={{ marginBottom: '14px' }}>
              <label className="form-label" style={{ fontWeight: 500, marginBottom: '6px', display: 'block', fontSize: '13px' }}>
                Đính kèm đơn xin thôi việc (File PDF hoặc hình ảnh chụp đơn giấy)
              </label>
              <div
                style={{
                  border: '1px dashed var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '12px',
                  background: 'var(--surface-ground)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <input
                  type="file"
                  id="resignation-file-input"
                  style={{ display: 'none' }}
                  accept=".pdf,image/png,image/jpeg,image/webp"
                  onChange={handleFileChange}
                  disabled={uploadingFile}
                />
                <label
                  htmlFor="resignation-file-input"
                  className="btn btn-secondary btn-sm"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', margin: 0 }}
                >
                  {uploadingFile ? Icons.loader : Icons.upload}
                  <span>{uploadingFile ? 'Đang tải lên...' : 'Chọn tệp...'}</span>
                </label>
                <div style={{ flex: 1, minWidth: 0, fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {file ? (
                    <span style={{ fontWeight: 600, color: 'var(--brand-primary)' }}>
                      📄 {file.name} ({(file.size / 1024).toFixed(0)} KB)
                    </span>
                  ) : (
                    <span>Chấp nhận PDF, PNG, JPG (tối đa 10MB)</span>
                  )}
                </div>
                {file && (
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null)
                      setUploadedUrl('')
                    }}
                    style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer' }}
                    title="Xóa tệp"
                  >
                    {Icons.x}
                  </button>
                )}
              </div>
            </div>

            {/* 6. Ghi chú HR */}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ fontWeight: 500, marginBottom: '6px', display: 'block', fontSize: '13px' }}>
                Ghi chú nội bộ của HR
              </label>
              <input
                type="text"
                className="form-input"
                placeholder="Ghi chú thêm về hoàn cảnh, người nhận đơn, hẹn phỏng vấn thôi việc..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          {/* Footer with generous margins and flex-shrink 0 */}
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
              disabled={submitting}
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || !employeeId || !contractId || reason.trim().length < 5}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              {Icons.check}
              <span>{submitting ? 'Đang xử lý...' : 'Lưu hồ sơ thôi việc'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default ResignationCreateDialog
