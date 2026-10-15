import { Icons } from '../components/common/Icons'
import './PayrollRegulationDialog.css'

const rules = [
  ['Ca được phân công', 'Check-in đối chiếu ca và cửa hàng đã phân. Khi phát sinh phiên, thông tin ca được lưu làm bản chụp để tính công về sau.'],
  ['Đi muộn', 'Phút trễ tính từ giờ bắt đầu của chính ca đó. Chỉ gắn nhãn LATE khi trễ quá 15 phút; ví dụ ca 13:00 thì sau 13:15 mới bị đánh dấu muộn.'],
  ['Về sớm và làm thêm', 'Checkout trước giờ kết thúc ca ghi nhận early_minutes; làm vượt số giờ của ca ghi nhận overtime_hours. Giờ OT đưa vào lương cần được phê duyệt riêng.'],
  ['Nhãn phiên chấm công', 'Ưu tiên LATE_AND_EARLY → LATE → EARLY → OVERTIME → NORMAL. Các số giờ làm, phút trễ, phút về sớm và giờ OT vẫn được lưu riêng.'],
  ['Khoảng chờ', 'Checkout chỉ thực hiện sau ít nhất 60 giây kể từ check-in. Sau checkout, cần chờ 60 giây trước lượt check-in tiếp theo.'],
]

export function AttendanceRegulationDialog({ onClose }: { onClose: () => void }) {
  return <div className="modal-overlay no-print" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="modal payroll-regulation" role="dialog" aria-modal="true" aria-label="Quy định chấm công">
      <header className="modal-header"><div><h2>Quy định chấm công</h2><p>Cách ghi nhận phiên và đối chiếu Attendance với bảng lương</p></div><button type="button" className="modal-close" onClick={onClose} aria-label="Đóng">{Icons.close}</button></header>
      <div className="payroll-regulation-body"><div className="payroll-regulation-scroll"><table><thead><tr><th>Nội dung</th><th>Quy định áp dụng</th></tr></thead><tbody>{rules.map(([name, rule]) => <tr key={name}><th scope="row">{name}</th><td>{rule}</td></tr>)}</tbody></table></div>
        <p className="payroll-regulation-note">Trạng thái phiên là nhãn tóm tắt. Payroll phải đối chiếu các trường số và quyết định OT đã duyệt, không suy ra tiền phạt hoặc thưởng chỉ từ nhãn.</p>
      </div>
      <footer className="modal-footer"><button type="button" className="btn btn-primary" onClick={onClose}>Đóng</button></footer>
    </section>
  </div>
}
