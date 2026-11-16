import React from 'react';
import { createPortal } from 'react-dom';
import { formatFullCurrency } from '../components/charts/chartTheme';
import { useCompanyProfile } from '../hooks/useCompanyProfile';
import './ReportsPrint.css';

export interface ReportsPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  period: string;
  stats: any;
  demographics: any;
  payrollFund: any;
  attendance: any;
  sales: any;
  monthlyStatus: any;
  currentUser: any;
  leaveSummary?: any;
}

export const ReportsPrintModal: React.FC<ReportsPrintModalProps> = ({
  isOpen,
  onClose,
  period,
  stats,
  demographics,
  payrollFund,
  attendance,
  sales,
  monthlyStatus,
  currentUser,
  leaveSummary,
}) => {
  const company = useCompanyProfile();

  if (!isOpen) return null;

  const currentDateStr = new Date().toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const storeList: any[] = Array.isArray(monthlyStatus)
    ? monthlyStatus
    : Array.isArray(monthlyStatus?.by_store)
    ? monthlyStatus.by_store
    : [];

  const totalStaff = storeList.reduce((acc, s) => acc + (s.total_staff || 0), 0) || stats?.total_employees || 0;
  const activeStaff = storeList.reduce((acc, s) => acc + (s.active_staff || 0), 0);
  const probationStaff = storeList.reduce((acc, s) => acc + (s.probation_staff || 0), 0);
  const onLeaveStaff = storeList.reduce((acc, s) => acc + (s.on_leave_staff || 0), 0);
  const resignedStaff = storeList.reduce((acc, s) => acc + (s.resigned_staff || 0), 0);
  const netSalaryTotal = payrollFund?.total_net_salary || 0;
  const grossSalaryTotal = payrollFund?.total_gross_income || 0;
  const onTimeRate = attendance?.on_time_rate ? `${attendance.on_time_rate.toFixed(1)}%` : '100%';
  const grandSalesRevenue = sales?.summary?.grand_total_revenue || 0;

  const handlePrint = () => {
    window.print();
  };

  return createPortal(
    <div className="report-a4-preview-backdrop print-active-overlay" onClick={onClose}>
      <div className="report-preview-actions no-print" onClick={(e) => e.stopPropagation()}>
        <button
          className="btn btn-primary"
          style={{
            backgroundColor: '#1e3a8a',
            color: '#ffffff',
            padding: '8px 16px',
            borderRadius: '6px',
            fontWeight: 600,
            cursor: 'pointer',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
          onClick={handlePrint}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 6 2 18 2 18 9" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <rect x="6" y="14" width="12" height="8" />
          </svg>
          In / Lưu PDF (A4)
        </button>
        <button
          className="btn btn-secondary"
          style={{
            backgroundColor: '#ffffff',
            color: '#334155',
            padding: '8px 16px',
            borderRadius: '6px',
            fontWeight: 500,
            cursor: 'pointer',
            border: '1px solid #cbd5e1',
          }}
          onClick={onClose}
        >
          Đóng
        </button>
      </div>

      <div className="report-a4-paper print-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header Pháp nhân */}
        <div className="report-a4-header">
          <div>
            <div className="report-a4-company-name">{company.name}</div>
            <div className="report-a4-company-sub">HỆ THỐNG QUẢN TRỊ NGUỒN NHÂN LỰC & CHUỖI CỬA HÀNG</div>
            {company.address && (
              <div className="report-a4-company-sub" style={{ fontSize: '10.5px' }}>
                Địa chỉ: {company.address}
              </div>
            )}
          </div>
          <div className="report-a4-meta">
            <div className="report-a4-meta-code">Số: BC-HRM-{period.replace('-', '')}</div>
            <div>Ngày lập: {currentDateStr}</div>
            <div>Bản in chính thức</div>
          </div>
        </div>

        {/* Tiêu đề chính */}
        <div className="report-a4-title-block">
          <div className="report-a4-main-title">BÁO CÁO TỔNG HỢP NHÂN SỰ & QUỸ LƯƠNG DOANH NGHIỆP</div>
          <div className="report-a4-subtitle">Kỳ đánh giá & quyết toán: Tháng {period} (Bảo mật nội bộ)</div>
        </div>

        {/* 4 Thẻ KPI */}
        <div className="report-a4-kpi-grid">
          <div className="report-a4-kpi-box">
            <div className="report-a4-kpi-label">Tổng nhân sự</div>
            <div className="report-a4-kpi-value">{totalStaff} người</div>
          </div>
          <div className="report-a4-kpi-box">
            <div className="report-a4-kpi-label">Thực trả (Net)</div>
            <div className="report-a4-kpi-value">{formatFullCurrency(netSalaryTotal)}</div>
          </div>
          <div className="report-a4-kpi-box">
            <div className="report-a4-kpi-label">Tỷ lệ đúng giờ</div>
            <div className="report-a4-kpi-value">{onTimeRate}</div>
          </div>
          <div className="report-a4-kpi-box">
            <div className="report-a4-kpi-label">Tổng giờ làm việc</div>
            <div className="report-a4-kpi-value">{attendance?.total_working_hours ? `${attendance.total_working_hours} giờ` : 'Chưa ghi nhận'}</div>
          </div>
        </div>

        {/* Bảng 1: Phân bổ tình hình nhân sự theo chi nhánh */}
        <div className="report-a4-section-title">I. THỐNG KÊ TÌNH HÌNH NHÂN SỰ THEO THÁNG (ĐANG LÀM, NGHỈ PHÉP, NGHỈ VIỆC)</div>
        <table className="report-a4-table">
          <thead>
            <tr>
              <th style={{ width: '36px' }}>STT</th>
              <th>Chi nhánh / Phòng ban</th>
              <th style={{ width: '75px' }}>Tổng biên chế</th>
              <th style={{ width: '75px' }}>Chính thức</th>
              <th style={{ width: '65px' }}>Thử việc</th>
              <th style={{ width: '70px' }}>Nghỉ phép</th>
              <th style={{ width: '70px' }}>Nghỉ việc</th>
              <th style={{ width: '130px' }}>Quỹ lương cơ bản HĐ</th>
            </tr>
          </thead>
          <tbody>
            {storeList && storeList.length > 0 ? (
              storeList.map((item, idx) => (
                <tr key={item.store_id || idx}>
                  <td className="text-center">{idx + 1}</td>
                  <td>{item.store_name}</td>
                  <td className="text-center" style={{ fontWeight: 600 }}>{item.total_staff}</td>
                  <td className="text-center">{item.active_staff}</td>
                  <td className="text-center">{item.probation_staff || 0}</td>
                  <td className="text-center">{item.on_leave_staff || 0}</td>
                  <td className="text-center">{item.resigned_staff || 0}</td>
                  <td className="text-right">{formatFullCurrency(item.total_contract_salary || 0)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="text-center">Chưa có dữ liệu chi nhánh</td>
              </tr>
            )}
            <tr className="total-row">
              <td colSpan={2} className="text-center">TỔNG CỘNG HỆ THỐNG</td>
              <td className="text-center">{totalStaff}</td>
              <td className="text-center">{activeStaff}</td>
              <td className="text-center">{probationStaff}</td>
              <td className="text-center">{onLeaveStaff}</td>
              <td className="text-center">{resignedStaff}</td>
              <td className="text-right">
                {formatFullCurrency(storeList.reduce((acc, s) => acc + (s.total_contract_salary || 0), 0))}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Bảng 1B: Cơ cấu thông tin nhân sự: Trình độ, Mức lương, Thâm niên */}
        <div className="report-a4-section-title">II. THỐNG KÊ THÔNG TIN NHÂN SỰ: TRÌNH ĐỘ, MỨC LƯƠNG & THÂM NIÊN</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '14px' }}>
          <table className="report-a4-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th colSpan={2} style={{ backgroundColor: '#e2e8f0', color: '#1e3a8a' }}>1. TRÌNH ĐỘ HỌC VẤN</th>
              </tr>
            </thead>
            <tbody>
              {(demographics?.education || []).map((e: any, idx: number) => (
                <tr key={idx}>
                  <td>{e.education_level}</td>
                  <td className="text-right" style={{ fontWeight: 600 }}>{e.total} NS ({e.percent ?? Math.round((e.total / Math.max(demographics?.total_employees || 1, 1)) * 100)}%)</td>
                </tr>
              ))}
            </tbody>
          </table>

          <table className="report-a4-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th colSpan={2} style={{ backgroundColor: '#e2e8f0', color: '#1e3a8a' }}>2. KHUNG MỨC LƯƠNG HĐ</th>
              </tr>
            </thead>
            <tbody>
              {(demographics?.salary_range || []).map((s: any, idx: number) => (
                <tr key={idx}>
                  <td>{s.salary_range}</td>
                  <td className="text-right" style={{ fontWeight: 600 }}>{s.total} NS ({s.percent ?? Math.round((s.total / Math.max(demographics?.total_employees || 1, 1)) * 100)}%)</td>
                </tr>
              ))}
            </tbody>
          </table>

          <table className="report-a4-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th colSpan={2} style={{ backgroundColor: '#e2e8f0', color: '#1e3a8a' }}>3. THÂM NIÊN CÔNG TÁC</th>
              </tr>
            </thead>
            <tbody>
              {(demographics?.seniority || []).map((sen: any, idx: number) => (
                <tr key={idx}>
                  <td>{sen.seniority_group}</td>
                  <td className="text-right" style={{ fontWeight: 600 }}>{sen.total} NS ({sen.percent ?? Math.round((sen.total / Math.max(demographics?.total_employees || 1, 1)) * 100)}%)</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Bảng 2: Tổng hợp chi phí tiền lương */}
        <div className="report-a4-section-title">III. TỔNG HỢP CHI PHÍ TIỀN LƯƠNG & CHẾ ĐỘ PHÚC LỢI</div>
        <table className="report-a4-table">
          <thead>
            <tr>
              <th style={{ width: '40px' }}>STT</th>
              <th>Khoản mục chi trả</th>
              <th style={{ width: '140px' }}>Số tiền (VNĐ)</th>
              <th style={{ width: '90px' }}>Tỷ trọng</th>
              <th>Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="text-center">1</td>
              <td>Tổng thu nhập trước thuế (Gross Income)</td>
              <td className="text-right">{formatFullCurrency(grossSalaryTotal)}</td>
              <td className="text-center">100.0%</td>
              <td>Bao gồm lương cơ bản, phụ cấp và thưởng</td>
            </tr>
            <tr>
              <td className="text-center">2</td>
              <td>Tổng bảo hiểm bắt buộc trích nộp (BHXH, BHYT, BHTN)</td>
              <td className="text-right">
                {formatFullCurrency(payrollFund?.total_insurance_deducted || 0)}
              </td>
              <td className="text-center">
                {grossSalaryTotal > 0
                  ? `${(((payrollFund?.total_insurance_deducted || 0) / grossSalaryTotal) * 100).toFixed(1)}%`
                  : '0%'}
              </td>
              <td>10.5% phần nhân viên đóng</td>
            </tr>
            <tr>
              <td className="text-center">3</td>
              <td>Thuế thu nhập cá nhân (TNCN) khấu trừ</td>
              <td className="text-right">
                {formatFullCurrency(payrollFund?.total_tax_deducted || 0)}
              </td>
              <td className="text-center">
                {grossSalaryTotal > 0
                  ? `${(((payrollFund?.total_tax_deducted || 0) / grossSalaryTotal) * 100).toFixed(1)}%`
                  : '0%'}
              </td>
              <td>Khấu trừ theo biểu lũy tiến từng phần</td>
            </tr>
            <tr className="total-row">
              <td className="text-center">4</td>
              <td>THỰC CHI CHI TRẢ NHÂN VIÊN (NET SALARY)</td>
              <td className="text-right">{formatFullCurrency(netSalaryTotal)}</td>
              <td className="text-center">
                {grossSalaryTotal > 0
                  ? `${((netSalaryTotal / grossSalaryTotal) * 100).toFixed(1)}%`
                  : '0%'}
              </td>
              <td>Chuyển khoản qua ngân hàng liên kết</td>
            </tr>
          </tbody>
        </table>

        {/* Bảng 3: Kỷ luật Chấm công & Tình hình Nghỉ phép */}
        <div className="report-a4-section-title">IV. KỶ LUẬT LAO ĐỘNG, CHẤM CÔNG & NGHỈ PHÉP</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
          {/* Bảng trái: Chuyên cần */}
          <table className="report-a4-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th colSpan={2} style={{ backgroundColor: '#e2e8f0', color: '#1e3a8a' }}>CHUYÊN CẦN & GIỜ LÀM VIỆC</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Tổng số ca làm việc ghi nhận</td>
                <td className="text-right" style={{ fontWeight: 600 }}>{attendance?.total_records || 0} ca</td>
              </tr>
              <tr>
                <td>Lượt đi làm đúng giờ (On-time)</td>
                <td className="text-right" style={{ color: '#16a34a', fontWeight: 600 }}>
                  {attendance?.on_time_count ?? 0} ca ({onTimeRate})
                </td>
              </tr>
              <tr>
                <td>Lượt đi muộn / Về sớm</td>
                <td className="text-right" style={{ color: '#d97706', fontWeight: 600 }}>
                  {attendance?.late_count ?? 0} lượt ({attendance?.total_late_minutes || 0}p)
                </td>
              </tr>
              <tr>
                <td>Tổng giờ làm thực / Tăng ca (OT)</td>
                <td className="text-right" style={{ fontWeight: 600 }}>
                  {attendance?.total_working_hours || 0}h / <span style={{ color: '#d97706' }}>{attendance?.total_ot_hours || 0}h OT</span>
                </td>
              </tr>
            </tbody>
          </table>

          {/* Bảng phải: Nghỉ phép */}
          <table className="report-a4-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th colSpan={2} style={{ backgroundColor: '#e2e8f0', color: '#1e3a8a' }}>TÌNH HÌNH GIẢI QUYẾT NGHỈ PHÉP</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Tổng số đơn nghỉ phép phát sinh</td>
                <td className="text-right" style={{ fontWeight: 600 }}>{leaveSummary?.total_requests || 0} đơn</td>
              </tr>
              <tr>
                <td>Nghỉ phép năm hưởng nguyên lương</td>
                <td className="text-right">
                  {leaveSummary?.by_type?.find((t: any) => t.type_name?.toLowerCase().includes('phép năm'))?.days || 0} ngày
                </td>
              </tr>
              <tr>
                <td>Nghỉ chế độ thai sản theo luật</td>
                <td className="text-right">
                  {leaveSummary?.by_type?.find((t: any) => t.type_name?.toLowerCase().includes('thai sản'))?.days || 0} ngày
                </td>
              </tr>
              <tr>
                <td>Nghỉ việc riêng / Ốm đau</td>
                <td className="text-right" style={{ color: '#7c3aed', fontWeight: 600 }}>
                  {(leaveSummary?.by_type || [])
                    .filter((t: any) => !t.type_name?.toLowerCase().includes('phép năm') && !t.type_name?.toLowerCase().includes('thai sản'))
                    .reduce((sum: number, t: any) => sum + (t.days || 0), 0)} ngày
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Khung 3 Chữ ký chuẩn doanh nghiệp */}
        <div className="report-a4-signatures">
          <div className="report-a4-sign-box">
            <div className="report-a4-sign-title">Người lập biểu</div>
            <div className="report-a4-sign-note">(Ký, ghi rõ họ tên)</div>
            <div className="report-a4-sign-space" />
            <div className="report-a4-sign-name">
              {currentUser?.full_name || currentUser?.username || 'Chuyên viên Nhân sự'}
            </div>
          </div>

          <div className="report-a4-sign-box">
            <div className="report-a4-sign-title">Trưởng phòng Nhân sự</div>
            <div className="report-a4-sign-note">(Ký, ghi rõ họ tên)</div>
            <div className="report-a4-sign-space" />
            <div className="report-a4-sign-name">Phòng Nhân sự TechZone</div>
          </div>

          <div className="report-a4-sign-box">
            <div className="report-a4-sign-title">Giám đốc điều hành</div>
            <div className="report-a4-sign-note">(Ký, đóng dấu, ghi rõ họ tên)</div>
            <div className="report-a4-sign-space" />
            <div className="report-a4-sign-name">Ban Giám Đốc TechZone</div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
