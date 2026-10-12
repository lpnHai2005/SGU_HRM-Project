import { useState } from 'react'
import { Icons } from '../components/common/Icons'
import type { Payroll } from '../types'
import { formatCurrency } from '../utils/formatters'
import './PayrollAdjustmentDialog.css'

export function PayrollAdjustmentDialog({payroll,onClose,onSave,busy}:{payroll:Payroll;onClose:()=>void;onSave:(addition:number,deduction:number,reason:string)=>Promise<void>;busy:boolean}) {
  const [addition,setAddition]=useState(String(payroll.manual_addition||0))
  const [deduction,setDeduction]=useState(String(payroll.manual_deduction||0))
  const [reason,setReason]=useState(payroll.adjustment_reason||'')
  const add=Number(addition)||0, deduct=Number(deduction)||0
  return <div className="modal-overlay no-print" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose()}}>
    <form className="modal payroll-adjustment-dialog" role="dialog" aria-modal="true" aria-label="Điều chỉnh bảng lương" onSubmit={event=>{event.preventDefault();void onSave(add,deduct,reason)}}>
      <header className="payroll-adjustment-header"><div><span>PHIẾU LƯƠNG NHÁP · {payroll.salary_period}</span><h2>Điều chỉnh lương</h2><p>{payroll.employee_name} · {payroll.employee_code}</p></div><button type="button" className="modal-close" aria-label="Đóng" onClick={onClose}>{Icons.close}</button></header>
      <div className="payroll-adjustment-body">
        <section className="payroll-attendance-reconcile"><h3>Đối chiếu Attendance tháng</h3><div><span>Ngày có chấm công</span><strong>{payroll.attendance_actual_days??0} ngày</strong></div><div><span>Giờ làm thực tế</span><strong>{Number(payroll.attendance_hours||0).toFixed(2)} giờ</strong></div><div><span>Đi trễ / về sớm</span><strong>{payroll.attendance_late_minutes||0} / {payroll.attendance_early_minutes||0} phút</strong></div><div><span>OT thực tế / được duyệt</span><strong>{Number(payroll.attendance_actual_overtime_hours||0).toFixed(2)} / {Number(payroll.attendance_approved_overtime_hours||0).toFixed(2)} giờ</strong></div><div className="payroll-reconcile-money is-positive"><span>Tiền OT trên phiếu lương</span><strong>+{formatCurrency(payroll.overtime_salary||0)}</strong></div><div className="payroll-reconcile-money is-negative"><span>Trừ lương theo thời gian thiếu / nghỉ không lương</span><strong>−{formatCurrency(payroll.time_deduction_amount||0)}</strong></div><div className="payroll-reconcile-money is-negative"><span>Phạt lượt đi trễ &gt; 15 phút</span><strong>−{formatCurrency(payroll.penalty_deduction||0)}</strong></div><p className="payroll-reconcile-hint">Tiền OT và các khoản trừ lấy từ phiếu lương của kỳ đang chọn; số phút/giờ lấy từ Attendance. Thưởng KPI/lễ trong phiếu lương không được coi là thưởng do chấm công. Cần đối chiếu OT được duyệt trước khi xác nhận chi trả.</p></section>
        <p className="payroll-adjustment-note">Sửa sai giờ công tại Bảng công cá nhân/Quản lý công rồi tính lại kỳ lương. Các khoản dưới đây là điều chỉnh bổ sung có lý do, không thay dữ liệu Attendance.</p>
        <div className="payroll-adjustment-fields"><label className="form-group"><span className="form-label">Khoản cộng thêm (VNĐ)</span><input className="form-input" type="number" min="0" max="100000000" step="1" value={addition} onChange={e=>setAddition(e.target.value)}/></label><label className="form-group"><span className="form-label">Khoản khấu trừ thêm (VNĐ)</span><input className="form-input" type="number" min="0" max="100000000" step="1" value={deduction} onChange={e=>setDeduction(e.target.value)}/></label></div>
        <label className="form-group"><span className="form-label">Lý do / chứng từ tham chiếu</span><textarea className="form-input" required minLength={5} maxLength={500} rows={3} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Nêu rõ căn cứ điều chỉnh"/></label>
        <div className="payroll-adjustment-total"><span>Thực lĩnh dự kiến sau điều chỉnh</span><strong>{formatCurrency(Number(payroll.net_salary||0)+add-deduct)}</strong></div>
      </div>
      <footer className="modal-footer"><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>Hủy</button><button className="btn btn-primary" disabled={busy||reason.trim().length<5}>{busy?'Đang lưu…':'Lưu điều chỉnh'}</button></footer>
    </form>
  </div>
}
