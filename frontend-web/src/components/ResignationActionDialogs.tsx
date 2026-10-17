/**
 * Resignation Action Dialogs
 * Chứa các modal: Duyệt đơn (Approve), Từ chối đơn (Reject), Hủy đơn (Cancel)
 * Vero Design System (Linear / Attio minimalist)
 */
import { useState, useEffect } from 'react'
import { resignationApi } from '../services/resignationService'
import { type Resignation } from '../types/resignation'
import { formatDate } from '../utils/formatters'
import { Icons } from './common/Icons'
import { toast } from 'sonner'

// ===============================================================================
// 1. DUYỆT ĐƠN THÔI VIỆC
// ===============================================================================

export interface ResignationApproveDialogProps {
  open: boolean
  resignation: Resignation | null
  onClose: () => void
  onSuccess?: () => void
}

export function ResignationApproveDialog({
  open,
  resignation,
  onClose,
  onSuccess,
}: ResignationApproveDialogProps) {
  const [approvedDate, setApprovedDate] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open && resignation) {
      setApprovedDate(resignation.requested_last_working_date || resignation.submitted_date)
      setNotes('')
    }
  }, [open, resignation])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!resignation) return

    if (!approvedDate) {
      toast.error('Vui lòng chọn ngày làm việc cuối cùng được phê duyệt')
      return
    }

    if (new Date(approvedDate) < new Date(resignation.submitted_date)) {
      toast.error('Ngày làm việc cuối cùng không được trước ngày nộp đơn')
      return
    }

    setLoading(true)
    try {
      const res = await resignationApi.approve(resignation.resignation_id, {
        approved_last_working_date: approvedDate,
        notes: notes.trim() || undefined,
      })
      toast.success(res.message || 'Duyệt đơn thôi việc thành công!')
      onSuccess?.()
      onClose()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || err?.message || 'Lỗi khi duyệt đơn')
    } finally {
      setLoading(false)
    }
  }

  if (!open || !resignation) return null

  return (
    <div
      className="modal-overlay"
      onClick={(e) => !loading && e.target === e.currentTarget && onClose()}
    >
      <div className="modal" style={{ maxWidth: '520px' }}>
        <form onSubmit={handleSubmit}>
          {/* Header */}
          <div className="modal-header">
            <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span
                className="modal-title-icon"
                style={{
                  background: 'rgba(16, 185, 129, 0.1)',
                  color: 'var(--status-success, #10b981)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                }}
              >
                {Icons.checkCircle}
              </span>
              <span>Phê duyệt đơn thôi việc</span>
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
            <div
              style={{
                padding: '12px 14px',
                background: 'var(--surface-ground)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-default)',
                marginBottom: '16px',
                fontSize: '13px',
              }}
            >
              <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                {resignation.employee_name} ({resignation.employee_code})
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                Hợp đồng: <strong>{resignation.contract_number}</strong> · Ngày nộp đơn:{' '}
                <strong>{formatDate(resignation.submitted_date)}</strong>
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '12px', marginTop: '2px' }}>
                Ngày nhân viên đề xuất nghỉ:{' '}
                <strong>{formatDate(resignation.requested_last_working_date)}</strong>
              </div>
            </div>

            {/* Approved Date */}
            <div className="form-group" style={{ marginBottom: '14px' }}>
              <label className="form-label" style={{ fontWeight: 500, marginBottom: '6px', display: 'block', fontSize: '13px' }}>
                Ngày làm việc cuối cùng được duyệt <span style={{ color: 'var(--status-error)' }}>*</span>
              </label>
              <input
                type="date"
                className="form-input"
                value={approvedDate}
                onChange={(e) => setApprovedDate(e.target.value)}
                min={resignation.submitted_date}
                required
              />
              <div style={{ fontSize: '11.5px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                HR có thể điều chỉnh ngày làm việc cuối cùng sau khi thỏa thuận với nhân viên
              </div>
            </div>

            {/* Notes */}
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label className="form-label" style={{ fontWeight: 500, marginBottom: '6px', display: 'block', fontSize: '13px' }}>
                Ghi chú phê duyệt / Kế hoạch bàn giao
              </label>
              <textarea
                className="form-input"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ví dụ: Đã thỏa thuận hoàn tất bàn giao công việc trước ngày nghỉ..."
                rows={3}
                style={{ resize: 'vertical' }}
              />
            </div>

            {/* Crucial Business Rule Alert */}
            <div
              className="alert alert-info"
              style={{
                padding: '10px 14px',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                fontSize: '12px',
                lineHeight: '1.5',
                marginBottom: 0,
              }}
            >
              <span style={{ flexShrink: 0, marginTop: '2px' }}>{Icons.info}</span>
              <div>
                <strong>Lưu ý:</strong> Phê duyệt đơn thôi việc <strong>không tự động chấm dứt hợp đồng ngay</strong>. Hợp đồng vẫn giữ hiệu lực bình thường cho đến khi HR thực hiện thao tác Chấm dứt hợp đồng.
              </div>
            </div>
          </div>

          {/* Footer */}
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
              disabled={loading || !approvedDate}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              {Icons.check}
              <span>{loading ? 'Đang xử lý...' : 'Xác nhận phê duyệt'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ===============================================================================
// 2. TỪ CHỐI ĐƠN THÔI VIỆC
// ===============================================================================

export interface ResignationRejectDialogProps {
  open: boolean
  resignation: Resignation | null
  onClose: () => void
  onSuccess?: () => void
}

export function ResignationRejectDialog({
  open,
  resignation,
  onClose,
  onSuccess,
}: ResignationRejectDialogProps) {
  const [rejectionReason, setRejectionReason] = useState<string>('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setRejectionReason('')
    }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!resignation) return

    if (rejectionReason.trim().length < 5) {
      toast.error('Lý do từ chối phải có ít nhất 5 ký tự')
      return
    }

    setLoading(true)
    try {
      const res = await resignationApi.reject(resignation.resignation_id, {
        rejection_reason: rejectionReason.trim(),
      })
      toast.success(res.message || 'Đã từ chối đơn thôi việc!')
      onSuccess?.()
      onClose()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || err?.message || 'Lỗi khi từ chối đơn')
    } finally {
      setLoading(false)
    }
  }

  if (!open || !resignation) return null

  return (
    <div
      className="modal-overlay"
      onClick={(e) => !loading && e.target === e.currentTarget && onClose()}
    >
      <div className="modal" style={{ maxWidth: '480px' }}>
        <form onSubmit={handleSubmit}>
          {/* Header */}
          <div className="modal-header">
            <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span
                className="modal-title-icon"
                style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  color: 'var(--status-error)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                }}
              >
                {Icons.xCircle}
              </span>
              <span>Từ chối đơn thôi việc</span>
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
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '14px' }}>
              Bạn đang từ chối đơn thôi việc của <strong>{resignation.employee_name}</strong> (Mã đơn: #{resignation.resignation_id}).
            </p>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ fontWeight: 500, marginBottom: '6px', display: 'block', fontSize: '13px' }}>
                Lý do từ chối <span style={{ color: 'var(--status-error)' }}>*</span>
              </label>
              <textarea
                className="form-input"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Nhập lý do từ chối (ví dụ: Chưa đủ thời hạn báo trước theo thỏa thuận hợp đồng, dự án trọng điểm cần hoàn thành...)"
                rows={3}
                required
                minLength={5}
                style={{ resize: 'vertical' }}
              />
            </div>
          </div>

          {/* Footer */}
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
              className="btn btn-danger"
              disabled={loading || rejectionReason.trim().length < 5}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              {Icons.xCircle}
              <span>{loading ? 'Đang xử lý...' : 'Xác nhận từ chối'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ===============================================================================
// 3. HỦY ĐƠN THÔI VIỆC
// ===============================================================================

export interface ResignationCancelDialogProps {
  open: boolean
  resignation: Resignation | null
  onClose: () => void
  onSuccess?: () => void
}

export function ResignationCancelDialog({
  open,
  resignation,
  onClose,
  onSuccess,
}: ResignationCancelDialogProps) {
  const [loading, setLoading] = useState(false)

  const handleConfirm = async () => {
    if (!resignation) return

    setLoading(true)
    try {
      const res = await resignationApi.cancel(resignation.resignation_id)
      toast.success(res.message || 'Đã hủy đơn thôi việc thành công!')
      onSuccess?.()
      onClose()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || err?.message || 'Lỗi khi hủy đơn')
    } finally {
      setLoading(false)
    }
  }

  if (!open || !resignation) return null

  return (
    <div
      className="modal-overlay"
      onClick={(e) => !loading && e.target === e.currentTarget && onClose()}
    >
      <div className="modal" style={{ maxWidth: '440px' }}>
        <div className="modal-header">
          <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              className="modal-title-icon"
              style={{
                background: 'var(--surface-ground)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-default)',
              }}
            >
              {Icons.x}
            </span>
            <span>Hủy đơn thôi việc</span>
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

        <div className="modal-body" style={{ padding: '20px' }}>
          <p style={{ fontSize: '13.5px', color: 'var(--text-primary)', margin: 0, lineHeight: '1.5' }}>
            Bạn có chắc chắn muốn hủy đơn thôi việc của <strong>{resignation.employee_name}</strong> (Mã đơn: #{resignation.resignation_id}) không?
          </p>
          <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '8px' }}>
            Trạng thái đơn sẽ chuyển sang <strong>ĐÃ HỦY</strong> và không thể hoàn tác.
          </div>
        </div>

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
            Đóng
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading ? 'Đang hủy...' : 'Đồng ý hủy đơn'}
          </button>
        </div>
      </div>
    </div>
  )
}
