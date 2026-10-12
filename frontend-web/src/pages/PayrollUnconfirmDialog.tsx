import { useState } from 'react'
import { Icons } from '../components/common/Icons'
import './PayrollUnconfirmDialog.css'

type Props = {
  payroll: { employee_name?: string | null; employee_code?: string | null; salary_period?: string | null }
  busy: boolean
  onClose: () => void
  onSubmit: (reason: string) => Promise<void>
}

export function PayrollUnconfirmDialog({ payroll, busy, onClose, onSubmit }: Props) {
  const [reason, setReason] = useState('')
  return (
    <div className="modal-overlay no-print" onMouseDown={event => {
      if (event.target === event.currentTarget && !busy) onClose()
    }}>
      <form className="modal payroll-unconfirm-dialog" role="alertdialog" aria-modal="true"
        aria-labelledby="payroll-unconfirm-title" onSubmit={event => {
          event.preventDefault()
          void onSubmit(reason.trim())
        }}>
        <header className="payroll-unconfirm-header">
          <span className="payroll-unconfirm-icon">{Icons.undo}</span>
          <div>
            <p>PHIẾU LƯƠNG {payroll.salary_period || ''}</p>
            <h2 id="payroll-unconfirm-title">Hoàn tác duyệt phiếu?</h2>
          </div>
        </header>
        <div className="payroll-unconfirm-body">
          <p>Phiếu của <strong>{payroll.employee_name || 'nhân viên'}</strong>{payroll.employee_code ? ` (${payroll.employee_code})` : ''} sẽ trở về <strong>DRAFT</strong>. Số liệu lương hiện tại được giữ nguyên để HR rà soát.</p>
          <p className="payroll-unconfirm-note">Chỉ áp dụng cho phiếu chưa chi trả. Nếu cần sửa Attendance và tính lại toàn kỳ, dùng “Mở lại kỳ lương”.</p>
          <label className="form-group">
            <span className="form-label">Lý do hoàn tác (bắt buộc)</span>
            <textarea className="form-input" rows={3} minLength={5} maxLength={500} required
              value={reason} onChange={event => setReason(event.target.value)}
              placeholder="Ví dụ: Duyệt nhầm phiếu, cần rà soát lại thông tin nhân viên" />
          </label>
        </div>
        <footer className="modal-footer">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>Hủy</button>
          <button className="btn btn-primary" disabled={busy || reason.trim().length < 5}>
            {Icons.undo}{busy ? 'Đang hoàn tác…' : 'Hoàn tác về bản nháp'}
          </button>
        </footer>
      </form>
    </div>
  )
}
