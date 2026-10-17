import { Icons } from '../components/common/Icons'

export function PayrollRegulationDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-overlay no-print" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '760px' }}>
        <div className="modal-header">
          <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: 'var(--status-info)' }}>{Icons.info}</span>
            Quy Chế Tính Lương, Thưởng & Khấu Trừ Chuỗi TechZone Retail
          </h2>
          <button
            className="modal-close"
            onClick={onClose}
            title="Đóng"
          >
            {Icons.close}
          </button>
        </div>

        <div className="modal-body" style={{ maxHeight: '74vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* 1. LƯƠNG CƠ BẢN & NGÀY CÔNG */}
          <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-default)', borderRadius: '8px', padding: '16px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px 0' }}>
              1. LƯƠNG CƠ BẢN & NGÀY CÔNG BÁN LẺ (RETAIL BASE SALARY)
            </h4>
            <div style={{ fontSize: '13px', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
              <div>• <strong>Ngày công chuẩn quy định:</strong> 26 ngày/tháng (Nghỉ 1 ngày/tuần theo lịch phân ca tại cửa hàng).</div>
              <div>• <strong>Lương cơ bản thực nhận:</strong> Tính theo số ngày công thực tế đi làm và các ngày nghỉ có hưởng lương.</div>
              <div style={{ fontFamily: 'var(--font-mono)', background: 'var(--surface-card)', padding: '8px 12px', borderRadius: '4px', margin: '6px 0', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>
                Lương CB thực nhận = (Lương Hợp đồng / 26) × Ngày công thực tế
              </div>
              <div>• <strong>Làm thêm giờ (OT - Overtime):</strong></div>
              <div style={{ paddingLeft: '12px' }}>
                - Ca đêm ngày thường: Hệ số <strong>150%</strong> = <code>(Lương HĐ / 26 / 8) × Giờ OT × 1.5</code><br />
                - Ca ngày nghỉ hàng tuần (Off-day): Hệ số <strong>200%</strong><br />
                - Ca ngày Lễ, Tết: Hệ số <strong>300%</strong> theo Bộ luật Lao động
              </div>
            </div>
          </div>

          {/* 2. CÁC KHOẢN PHỤ CẤP BÁN LẺ */}
          <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-default)', borderRadius: '8px', padding: '16px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px 0' }}>
              2. CÁC KHOẢN PHỤ CẤP BÁN LẺ (RETAIL ALLOWANCES)
            </h4>
            <div style={{ fontSize: '13px', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
              <div>• <strong>Phụ cấp Chức vụ (Position Allowance):</strong></div>
              <div style={{ paddingLeft: '12px' }}>
                - Cửa hàng trưởng (Store Manager): <strong>2.500.000đ - 3.500.000đ/tháng</strong> (trách nhiệm quản lý doanh số & nhân sự chi nhánh).<br />
                - Cửa hàng phó / Trưởng ca bán lẻ: <strong>1.000.000đ - 1.500.000đ/tháng</strong>.
              </div>
              <div style={{ marginTop: '4px' }}>• <strong>Phụ cấp Dự án & Chiến dịch chuỗi (Project Allowance):</strong> <strong>1.000.000đ - 2.500.000đ/tháng</strong> khi tham gia setup cửa hàng mới hoặc chiến dịch mở bán Flagship (Apple, Samsung...).</div>
              <div style={{ marginTop: '4px' }}>• <strong>Phụ cấp Thâm niên (Seniority Allowance):</strong> +<strong>200.000đ/tháng</strong> cho mỗi năm công tác gắn bó tại TechZone.</div>
              <div style={{ marginTop: '4px' }}>• <strong>Phụ cấp Cơm trưa & Đi lại:</strong> Hỗ trợ <strong>730.000đ - 1.000.000đ/tháng</strong> hỗ trợ nhân viên trực ca kíp.</div>
            </div>
          </div>

          {/* 3. HOA HỒNG DOANH SỐ */}
          <div style={{ background: 'var(--status-info-bg)', border: '1px solid var(--status-info-border)', borderRadius: '8px', padding: '16px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--status-info)', margin: '0 0 8px 0' }}>
              3. CƠ CHẾ HOA HỒNG DOANH SỐ BÁN LẺ (RETAIL COMMISSIONS)
            </h4>
            <div style={{ fontSize: '13px', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
              <div>• <strong>Ngành hàng Điện thoại Smartphone:</strong> Hưởng <strong>1.0%</strong> doanh số bán lẻ cá nhân (VD: 150 triệu &rarr; Hoa hồng 1.500.000đ).</div>
              <div>• <strong>Ngành hàng Laptop & Máy tính bảng:</strong> Hưởng <strong>1.0%</strong> doanh số bán lẻ cá nhân (VD: 70 triệu &rarr; Hoa hồng 700.000đ).</div>
              <div>• <strong>Ngành hàng Phụ kiện & Thiết bị âm thanh:</strong> Hưởng <strong>3.0% - 5.0%</strong> doanh số (Sạc nhanh, cáp, tai nghe, bao da, loa Bluetooth...).</div>
              <div>• <strong>Gói Dịch vụ & Bảo hành TechZone Care 1 Đổi 1:</strong> Hưởng <strong>10.0% - 15.0%</strong> giá trị gói dịch vụ (dán màn hình PPF, bảo hành rơi vỡ).</div>
            </div>
          </div>

          {/* 4. CÁC KHOẢN TIỀN THƯỞNG BÁN LẺ */}
          <div style={{ background: 'var(--status-success-bg)', border: '1px solid var(--status-success-border)', borderRadius: '8px', padding: '16px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--status-success)', margin: '0 0 8px 0' }}>
              4. CÁC KHOẢN TIỀN THƯỞNG BÁN LẺ (RETAIL BONUSES)
            </h4>
            <div style={{ fontSize: '13px', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
              <div>• <strong>Thưởng nóng KPI Doanh số bán lẻ:</strong></div>
              <div style={{ paddingLeft: '12px' }}>
                - Đạt 100% mục tiêu KPI: Thưởng nóng <strong>1.000.000đ</strong>.<br />
                - Đạt &gt;= 120% mục tiêu KPI: Thưởng nóng <strong>2.000.000đ</strong>.<br />
                - Đạt &gt;= 150% mục tiêu KPI: Thưởng nóng <strong>3.500.000đ</strong>.
              </div>
              <div style={{ marginTop: '4px' }}>• <strong>Thưởng Best Seller Chi nhánh:</strong> <strong>1.500.000đ/tháng</strong> cho nhân viên có tổng doanh thu thiết bị bán ra cao nhất tháng tại mỗi showroom.</div>
              <div style={{ marginTop: '4px' }}>• <strong>Thưởng Chuyên cần Bán lẻ (Attendance Bonus):</strong> <strong>500.000đ/tháng</strong> nếu đi làm đủ 26 công, không đi trễ, không nghỉ đột xuất, tuân thủ tác phong đồng phục.</div>
              <div style={{ marginTop: '4px' }}>• <strong>Thưởng Dịch vụ Khách hàng (CSAT 5 sao):</strong> <strong>500.000đ/tháng</strong> nếu điểm đánh giá phục vụ khách hàng tại quầy đạt &gt;= 95% hài lòng.</div>
              <div style={{ marginTop: '4px' }}>• <strong>Thưởng Chiến dịch & Mở bán Flagship (Productivity / Campaign):</strong> <strong>1.000.000đ - 2.500.000đ/tháng</strong> theo hiệu quả kinh doanh của toàn chuỗi trong các dịp lễ Tết, Back to School, sự kiện ra mắt Apple & Samsung.</div>
            </div>
          </div>

          {/* 5. CÁC KHOẢN TRỪ LƯƠNG & KHẤU TRỪ */}
          <div style={{ background: 'var(--status-error-bg)', border: '1px solid var(--status-error-border)', borderRadius: '8px', padding: '16px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--status-error)', margin: '0 0 8px 0' }}>
              5. CÁC KHOẢN TRỪ LƯƠNG & KHẤU TRỪ BÁN LẺ (RETAIL DEDUCTIONS)
            </h4>
            <div style={{ fontSize: '13px', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
              <div>• <strong>Khấu trừ Nghỉ phép không hưởng lương (Unpaid Leave):</strong></div>
              <div style={{ paddingLeft: '12px' }}>
                - Tự động liên kết từ phân hệ Đơn nghỉ phép (<code>leave_requests</code>) khi HR duyệt.<br />
                - Số tiền trừ: <code style={{ color: 'var(--status-error)', fontWeight: 600 }}>(Lương HĐ / 26) × Số ngày nghỉ không lương</code>.<br />
                - <em>Lưu ý:</em> Phép năm (tối đa 12 ngày) và Việc riêng có lương (3 ngày kết hôn, tang chế) hưởng 100% lương, hoàn toàn không bị trừ tiền.
              </div>
              <div style={{ marginTop: '6px' }}>• <strong>Khấu trừ Đi trễ / Về sớm & Thiếu giờ công:</strong></div>
              <div style={{ paddingLeft: '12px' }}>
                - Đi trễ 15 - 60 phút: Trừ giờ công thực tế + phạt nội quy <strong>50.000đ/lần</strong>.<br />
                - Đi trễ &gt; 60 phút không lý do: Tính trừ 0.5 ngày công thực tế.<br />
                - Thiếu giờ ca kíp: Trừ <code>(Lương HĐ / 26 / 8) × Số giờ thiếu</code>.
              </div>
              <div style={{ marginTop: '6px' }}>• <strong>Trích nộp Bảo hiểm Bắt buộc (10.5% lương đóng BH):</strong></div>
              <div style={{ paddingLeft: '12px' }}>
                - BHXH: <strong>8.0%</strong> | BHYT: <strong>1.5%</strong> | BHTN: <strong>1.0%</strong>.
              </div>
              <div style={{ marginTop: '6px' }}>• <strong>Khấu trừ Sai lệch Quỹ & Hao hụt Kho Cửa hàng:</strong> Trừ bồi hoàn sai sót lệch quỹ thu ngân cuối ca hoặc thất thoát phụ kiện/hàng trưng bày theo biên bản kiểm kê chuỗi bán lẻ.</div>
              <div style={{ marginTop: '6px' }}>• <strong>Thuế TNCN:</strong> Trích nộp theo biểu lũy tiến từng phần sau khi giảm trừ gia cảnh (bản thân 11 triệu/tháng, người phụ thuộc 4.4 triệu/tháng).</div>
            </div>
          </div>

          {/* 6. VÍ DỤ MINH HỌA */}
          <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-default)', borderRadius: '8px', padding: '16px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px 0' }}>
              6. VÍ DỤ MINH HOẠ THỰC TẾ (Nhân viên Phạm Quốc Dũng - Doanh số 220 triệu)
            </h4>
            <div style={{ fontSize: '13px', lineHeight: 1.7, color: 'var(--text-secondary)' }}>
              <div>• Lương cơ bản HĐ: <strong>8.000.000 đ</strong> (Làm 24/26 ngày, nghỉ không lương 2 ngày &rarr; Lương CB thực: <strong>5.309.615 đ</strong>)</div>
              <div>• Hoa hồng bán lẻ (ĐT 150M x 1% + Laptop 70M x 1%): <strong>2.200.000 đ</strong></div>
              <div>• Phụ cấp (Chức vụ 500K + Thâm niên 500K + Dự án 1.5M + Cơm trưa 1M): <strong>3.500.000 đ</strong></div>
              <div>• Tiền thưởng (KPI 100% 1M + Thưởng năng suất 1M): <strong>2.000.000 đ</strong></div>
              <div>• Làm thêm giờ (OT ca đêm): <strong>3.859.615 đ</strong></div>
              <div>• <strong>TỔNG GROSS:</strong> <strong>16.869.230 đ</strong></div>
              <div>• <strong>KHẤU TRỪ:</strong> Trừ ngày không lương (-2.690.385 đ) + BHXH 10.5% (-525.000 đ) + Phạt (-300.000 đ)</div>
              <div style={{ fontWeight: 800, color: 'var(--status-success)', fontSize: '15px', marginTop: '6px' }}>
                ↳ THỰC LĨNH CHUYỂN KHOẢN (NET): 16.044.230 VNĐ
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-primary" onClick={onClose}>
            Đã hiểu
          </button>
        </div>
      </div>
    </div>
  )
}
