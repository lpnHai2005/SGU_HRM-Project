import { Icons } from '../components/common/Icons'
import './PayrollRegulationDialog.css'

const rules = [
  ['Công chuẩn', '26 ngày/kỳ; đơn giá giờ tham chiếu = lương hợp đồng / 26 / 8', 'Hợp đồng, kỳ lương'],
  ['Đi trễ', 'Ân hạn 15 phút theo giờ bắt đầu từng ca; quá 15 phút: 50.000đ/lượt theo thủ tục lương hiện tại', 'Attendance từng phiên'],
  ['Thiếu giờ / nghỉ không lương', 'Khấu trừ thời gian = ngày nghỉ không lương × lương ngày + phút muộn/về sớm × lương giờ / 60', 'Attendance, đơn nghỉ đã duyệt'],
  ['Làm thêm giờ', 'Thủ tục lương hiện tại: giờ OT × đơn giá giờ × 150%; cần đối chiếu giờ OT đã duyệt trước khi chốt', 'Attendance, phê duyệt OT'],
  ['Thưởng và hoa hồng', 'Thưởng lễ theo hệ số vị trí; thưởng KPI và hoa hồng từ dữ liệu kinh doanh, không phát sinh từ nhãn Attendance', 'Vị trí, KPI, Commission'],
  ['Bảo hiểm người lao động', 'BHXH 8% + BHYT 1,5% + BHTN 1% trên lương đóng bảo hiểm', 'Hợp đồng'],
]

export function PayrollRegulationDialog({ onClose }: { onClose: () => void }) {
  return <div className="modal-overlay no-print" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="modal payroll-regulation" role="dialog" aria-modal="true" aria-label="Quy chế tính lương">
      <header className="modal-header"><div><h2>Quy chế tính lương</h2><p>Bảng quy định đang được thể hiện trong quy trình tính lương TechZone</p></div><button type="button" className="modal-close" onClick={onClose} aria-label="Đóng">{Icons.close}</button></header>
      <div className="payroll-regulation-body"><div className="payroll-regulation-scroll"><table><thead><tr><th>Khoản mục</th><th>Quy tắc áp dụng</th><th>Dữ liệu đối chiếu</th></tr></thead><tbody>{rules.map(([name, rule, source]) => <tr key={name}><th scope="row">{name}</th><td>{rule}</td><td>{source}</td></tr>)}</tbody></table></div>
        <p className="payroll-regulation-note">Số tiền thực tế luôn lấy từ phiếu lương của kỳ đã tính. Quy tắc OT/phạt trong thủ tục cũ cần được HR đối chiếu với phê duyệt và Attendance trước khi xác nhận chi trả.</p>
        <div className="payroll-regulation-approval"><span>XÁC NHẬN CỦA GIÁM ĐỐC CÔNG TY</span><strong>Chưa ghi nhận xác nhận điện tử</strong><small>Giám đốc ký, ghi rõ họ tên và ngày xác nhận trên bản quy chế chính thức.</small></div>
      </div>
      <footer className="modal-footer"><button type="button" className="btn btn-primary" onClick={onClose}>Đóng</button></footer>
    </section>
  </div>
}
