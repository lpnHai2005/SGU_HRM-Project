/**
 * Resignation Detail Dialog
 * Modal hiển thị toàn bộ chi tiết đơn xin thôi việc, thông tin nhân viên, hợp đồng và lịch sử xử lý
 * Vero Design System (Linear / Attio minimalist, dual theme)
 */
import { type Resignation, RESIGNATION_STATUS_LABELS, RESIGNATION_STATUS_BADGE } from '../types/resignation'
import { getContractTypeLabel } from '../types/contract'
import { formatDate, formatDateTime, getInitials } from '../utils/formatters'
import { Icons } from './common/Icons'

export interface ResignationDetailDialogProps {
  open: boolean
  resignation: Resignation | null
  onClose: () => void
  onApprove?: (resignation: Resignation) => void
  onReject?: (resignation: Resignation) => void
  onCancel?: (resignation: Resignation) => void
  onTerminateContract?: (resignation: Resignation) => void
}

export function ResignationDetailDialog({
  open,
  resignation,
  onClose,
  onApprove,
  onReject,
  onCancel,
  onTerminateContract,
}: ResignationDetailDialogProps) {
  if (!open || !resignation) return null

  const isPending = resignation.status === 'PENDING'
  const isApproved = resignation.status === 'APPROVED'

  return (
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal" style={{ maxWidth: '640px' }}>
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
            <div>
              <h3 className="modal-title" style={{ margin: 0, fontSize: '16px' }}>
                Đơn thôi việc #{resignation.resignation_id}
              </h3>
              <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                Hệ thống Quản lý thôi việc TechZone HRM
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span className={RESIGNATION_STATUS_BADGE[resignation.status] || 'badge-status'}>
              {RESIGNATION_STATUS_LABELS[resignation.status] || resignation.status}
            </span>
            <button
              type="button"
              className="modal-close"
              onClick={onClose}
              title="Đóng"
            >
              {Icons.x}
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="modal-body" style={{ padding: '20px', flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {/* Employee & Contract Snapshot */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              padding: '14px',
              background: 'var(--surface-ground)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
              marginBottom: '18px',
            }}
          >
            <div
              style={{
                width: '44px',
                height: '44px',
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
              {getInitials(resignation.employee_name)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, fontSize: '14.5px', color: 'var(--text-primary)' }}>
                  {resignation.employee_name || '--'}
                </span>
                <span style={{ fontSize: '12.5px', color: 'var(--text-tertiary)' }}>
                  ({resignation.employee_code || '--'})
                </span>
              </div>
              <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '3px' }}>
                <span>{resignation.department_name || 'Phòng ban'}</span>
                {' · '}
                <span>{resignation.position_name || 'Vị trí'}</span>
                {resignation.store_name && (
                  <>
                    {' · '}
                    <span>{resignation.store_name}</span>
                  </>
                )}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                Hợp đồng áp dụng:{' '}
                <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                  {resignation.contract_number}
                </strong>{' '}
                ({getContractTypeLabel(resignation.contract_type)})
              </div>
            </div>
          </div>

          {/* Key Dates Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '12px',
              marginBottom: '18px',
            }}
          >
            <div
              style={{
                padding: '12px',
                background: 'var(--surface-card)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-default)',
              }}
            >
              <div style={{ fontSize: '11.5px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Ngày nộp đơn
              </div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '4px' }}>
                {formatDate(resignation.submitted_date)}
              </div>
            </div>

            <div
              style={{
                padding: '12px',
                background: 'var(--surface-card)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-default)',
              }}
            >
              <div style={{ fontSize: '11.5px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Ngày dự kiến nghỉ
              </div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '4px' }}>
                {formatDate(resignation.requested_last_working_date)}
              </div>
            </div>

            <div
              style={{
                padding: '12px',
                background: resignation.approved_last_working_date ? 'rgba(16, 185, 129, 0.08)' : 'var(--surface-card)',
                borderRadius: 'var(--radius-sm)',
                border: resignation.approved_last_working_date ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid var(--border-default)',
              }}
            >
              <div style={{ fontSize: '11.5px', color: resignation.approved_last_working_date ? 'var(--status-success)' : 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Ngày nghỉ được duyệt
              </div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: resignation.approved_last_working_date ? 'var(--status-success)' : 'var(--text-tertiary)', marginTop: '4px' }}>
                {resignation.approved_last_working_date ? formatDate(resignation.approved_last_working_date) : 'Chưa chốt'}
              </div>
            </div>
          </div>

          {/* Reason Section */}
          <div style={{ marginBottom: '18px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              LÝ DO THÔI VIỆC
            </div>
            <div
              style={{
                padding: '12px 14px',
                background: 'var(--surface-ground)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-default)',
                fontSize: '13px',
                lineHeight: '1.6',
                color: 'var(--text-primary)',
                whiteSpace: 'pre-wrap',
              }}
            >
              {resignation.reason}
            </div>
          </div>

          {/* Notes Section if available */}
          {resignation.notes && (
            <div style={{ marginBottom: '18px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                GHI CHÚ CỦA HR
              </div>
              <div
                style={{
                  padding: '10px 14px',
                  background: 'var(--surface-ground)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-default)',
                  fontSize: '12.5px',
                  color: 'var(--text-secondary)',
                }}
              >
                {resignation.notes}
              </div>
            </div>
          )}

          {/* Rejection Reason if REJECTED */}
          {resignation.status === 'REJECTED' && resignation.rejection_reason && (
            <div style={{ marginBottom: '18px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--status-error)', marginBottom: '6px' }}>
                LÝ DO TỪ CHỐI
              </div>
              <div
                style={{
                  padding: '10px 14px',
                  background: 'rgba(239, 68, 68, 0.08)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  fontSize: '13px',
                  color: 'var(--status-error)',
                }}
              >
                {resignation.rejection_reason}
              </div>
            </div>
          )}

          {/* Attachment Preview/Download */}
          <div style={{ marginBottom: '18px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              TỆP ĐÍNH KÈM (ĐƠN GIẤY SCAN / FILE PDF)
            </div>
            {resignation.attachment_url ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  background: 'var(--surface-ground)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-default)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                  <span style={{ color: 'var(--brand-primary)' }}>{Icons.paperclip}</span>
                  <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                    Tập tin đơn xin thôi việc đã lưu
                  </span>
                </div>
                <a
                  href={resignation.attachment_url}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-secondary btn-sm"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
                >
                  {Icons.eye}
                  <span>Mở xem tệp</span>
                </a>
              </div>
            ) : (
              <div style={{ fontSize: '12.5px', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                Chưa có tệp đính kèm nào được lưu cho đơn này.
              </div>
            )}
          </div>

          {/* Timeline & Audit Info */}
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
              NHẬT KÝ XỬ LÝ (AUDIT LOG)
            </div>
            <div
              style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                lineHeight: '1.8',
                padding: '10px 14px',
                background: 'var(--surface-ground)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-default)',
              }}
            >
              <div>
                • <strong>Tiếp nhận vào hệ thống:</strong> {formatDateTime(resignation.created_at)} bởi{' '}
                <strong>{resignation.created_by_name || 'HR'}</strong>
              </div>
              {resignation.approved_at && (
                <div>
                  • <strong>Xử lý phê duyệt/từ chối:</strong> {formatDateTime(resignation.approved_at)} bởi{' '}
                  <strong>{resignation.approved_by_name || 'Quản trị viên'}</strong>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer with action buttons and generous spacing */}
        <div
          className="modal-footer"
          style={{
            padding: '16px 20px',
            borderTop: '1px solid var(--border-default)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '10px',
            margin: 0,
          }}
        >
          <div>
            {isApproved && onTerminateContract && (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => {
                  onClose()
                  onTerminateContract(resignation)
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                {Icons.xCircle}
                <span>Chuyển sang Chấm dứt hợp đồng →</span>
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            {isPending && (
              <>
                {onCancel && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      onClose()
                      onCancel(resignation)
                    }}
                  >
                    Hủy đơn
                  </button>
                )}
                {onReject && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => {
                      onClose()
                      onReject(resignation)
                    }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    {Icons.x}
                    <span>Từ chối</span>
                  </button>
                )}
                {onApprove && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      onClose()
                      onApprove(resignation)
                    }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    {Icons.check}
                    <span>Duyệt đơn</span>
                  </button>
                )}
              </>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
            >
              Đóng
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ResignationDetailDialog
