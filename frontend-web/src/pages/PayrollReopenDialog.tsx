import { useState } from 'react'
import { Icons } from '../components/common/Icons'
import './PayrollReopenDialog.css'

export function PayrollReopenDialog({period,busy,onClose,onSubmit}:{period:string;busy:boolean;onClose:()=>void;onSubmit:(reason:string)=>Promise<void>}) {
  const [reason,setReason]=useState('')
  return <div className="modal-overlay no-print" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose()}}>
    <form className="modal payroll-reopen-dialog" role="alertdialog" aria-modal="true" aria-labelledby="payroll-reopen-title" onSubmit={event=>{event.preventDefault();void onSubmit(reason.trim())}}>
      <header className="payroll-reopen-header"><span className="payroll-reopen-icon">{Icons.alertTriangle}</span><div><p>KỲ LƯƠNG {period}</p><h2 id="payroll-reopen-title">Mở lại kỳ lương?</h2></div></header>
      <div className="payroll-reopen-body">
        <p>Toàn bộ phiếu <strong>CONFIRMED</strong> và <strong>PAID</strong> trong kỳ sẽ chuyển sang <strong>NEEDS_RECALCULATION</strong>. Sau khi rà soát/sửa Attendance, chạy “Chốt & Tính Lương” để tạo lại phiếu nháp toàn kỳ.</p>
        <div className="payroll-reopen-warning"><strong>Lưu ý thanh toán:</strong> thao tác này chỉ mở lại trạng thái trong HRM. Nó không hủy hoặc thu hồi giao dịch ngân hàng đã thực hiện. Hãy đối soát với kế toán trước khi thao tác.</div>
        <label className="form-group"><span className="form-label">Lý do mở lại (bắt buộc)</span><textarea className="form-input" rows={3} minLength={5} maxLength={500} required value={reason} onChange={e=>setReason(e.target.value)} placeholder="Ví dụ: Cần điều chỉnh Attendance ngày 12/10" /></label>
      </div>
      <footer className="modal-footer"><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>Hủy</button><button className="btn btn-primary" disabled={busy||reason.trim().length<5}>{busy?'Đang mở lại…':'Mở lại toàn kỳ'}</button></footer>
    </form>
  </div>
}
