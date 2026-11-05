---
doc_id: "TZ-DOC-02"
title: "Quy chế Quản lý Tiền lương, Phụ cấp, Tiền thưởng và Khấu trừ TechZone"
category: "TIEN_LUONG"
target_roles: ["EMPLOYEE", "STORE_MANAGER", "HR_MANAGER", "ADMIN", "DIRECTOR"]
effective_date: "2026-01-01"
keywords: ["tiền lương", "gross", "net", "công chuẩn theo kỳ", "giờ chuẩn ngày", "hoa hồng", "thưởng kpi", "phụ cấp chức vụ", "thâm niên", "bảo hiểm 10.5", "thuế tncn", "project allowance"]
---

# QUY CHẾ QUẢN LÝ TIỀN LƯƠNG, PHỤ CẤP, TIỀN THƯỞNG VÀ CÁC KHOẢN KHẤU TRỪ
*Số: TZ-DOC-02/QĐ-TZ2026 - Ban hành ngày 01/01/2026 bởi Ban Giám Đốc TechZone*

## 1. Định mức ngày công chuẩn và chu kỳ lương
- **Công chuẩn của kỳ:** Tổng ngày trong tháng trừ Chủ nhật và ngày Lễ, Tết rơi vào Thứ 2 đến Thứ 7 (năm 2026: tháng 10 là 27 ngày, tháng 11 là 25 ngày, tháng 02 là 19 ngày). HR hoặc Giám đốc có thể ghi đè theo từng kỳ; chỉ dùng 26.0 khi không xác định được.
- **Kỳ hạch toán:** Từ ngày 01 đến ngày cuối tháng; chuyển khoản từ ngày 05 đến 10 tháng sau.

## 2. Công thức tính lương tổng quát
- **GROSS** = Lương theo thời gian (Lương HĐ - Khấu trừ thời gian + Tăng ca OT) + Các khoản phụ cấp + Các khoản thưởng và hoa hồng.
- **NET** = GROSS - Bảo hiểm bắt buộc (10.5%) - Phạt vi phạm chấm công - Các khoản khấu trừ bổ sung.

> *Lưu ý:* TechZone áp dụng hoa hồng bán lẻ và thưởng KPI theo doanh số, song song với **Phụ cấp tham gia Dự án & Chiến dịch chuỗi** (Project Allowance). Hệ thống hiện chưa tự tính thuế TNCN trong bảng lương.

## 3. Các cấu phần thu nhập chi tiết
- **Đơn giá ngày:** `Lương HĐ / Công chuẩn của kỳ`.
- **Đơn giá giờ:** `Đơn giá ngày / Giờ chuẩn ngày`, với `Giờ chuẩn ngày = Giờ/tuần trên hợp đồng / 6` (48 giờ/tuần là 8.0; 44 là 7.33; 40 là 6.67).
- **Khấu trừ thời gian thiếu:** `(Ngày không lương + Ngày vắng) * Đơn giá ngày + (Phút trễ quá 15 phút + Phút về sớm) / 60 * Đơn giá giờ`.
- **Lương theo thời gian:** `GREATEST(0, Lương HĐ - Khấu trừ thời gian thiếu + Tiền OT)`.
- **Tăng ca OT:** `Đơn giá giờ * (Giờ OT thường * 1.5 + Giờ OT Chủ nhật * 2.0 + Giờ OT Lễ Tết * 3.0)`.
- **Giám đốc:** Không chấm công, được tính đủ công chuẩn, không bị khấu trừ đi muộn, về sớm.
- **Phụ cấp chức vụ:** Giám đốc 10tr, Trưởng phòng Nhân sự 3tr, CHT 2.5tr, Quản trị viên 2tr, Trưởng nhóm Bán hàng 1.5tr, Chuyên viên HR 1tr, Kỹ thuật viên 1tr, NV tư vấn và Thu ngân 500k.
- **Phụ cấp thâm niên:** <1 năm: 0; 1-3 năm: 500k; 3-5 năm: 1M; >=5 năm: 1.5M.
- **Phụ cấp cơm xe:** Cố định 1.000.000 VNĐ / tháng toàn chuỗi.
- **Thưởng Lễ, Tết:** Thiết lập theo từng kỳ, phổ biến là `Mức cơ sở * position_coefficient` (Giám đốc 3.0, Trưởng phòng Nhân sự 2.0, Quản trị viên 1.8, CHT 1.5, Trưởng nhóm 1.3, Chuyên viên HR 1.2, Kỹ thuật viên 1.1, NV 1.0).
- **Hoa hồng bán lẻ:** 1% doanh số điện thoại và laptop, 3% doanh số phụ kiện.
- **Thưởng KPI:** Từ 100% KPI 1.000.000 VNĐ; từ 120% KPI 2.000.000 VNĐ.
- **Bảo hiểm 10.5%:** BHXH 8%, BHYT 1.5%, BHTN 1% tính trên `insurance_salary`.
- **Phạt đi muộn:** 50.000 VNĐ / lần trễ > 15 phút.
- **Thuế TNCN:** Hệ thống hiện chưa tự tính và chưa khấu trừ trong bảng lương.
