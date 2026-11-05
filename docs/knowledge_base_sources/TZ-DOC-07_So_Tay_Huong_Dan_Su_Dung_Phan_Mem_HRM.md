---
doc_id: "TZ-DOC-07"
title: "Sổ tay Hướng dẫn Sử dụng Hệ thống Quản trị Nhân sự Đa nền tảng TechZone HRM"
category: "HUONG_DAN"
target_roles: ["EMPLOYEE", "STORE_MANAGER", "HR_MANAGER", "ADMIN", "DIRECTOR"]
effective_date: "2026-01-01"
keywords: ["hướng dẫn", "sổ tay", "chấm công mobile", "nộp đơn", "in phiếu lương", "phân ca", "chốt lương", "duyệt cấp 1", "duyệt cấp 2"]
---

# SỔ TAY HƯỚNG DẪN SỬ DỤNG HỆ THỐNG QUẢN TRỊ NHÂN SỰ ĐA NỀN TẢNG TECHZONE HRM
*Số: TZ-DOC-07/HD-TZ2026 - Ban hành ngày 01/01/2026 bởi Khối Kỹ thuật & HR TechZone*

## 1. Dành cho Nhân viên (Employee Self-Service - ESS)
- **Chấm công Mobile:** Bật GPS trong bán kính Geofence 100m, chụp ảnh selfie và bấm Check-in/Check-out (cooldown 60s).
- **Nộp đơn nghỉ phép:** Vào Đơn từ của tôi -> Đơn nghỉ phép -> Tạo đơn -> Chọn loại nghỉ -> Nhập lý do -> Đính kèm tệp minh chứng y tế (nếu là nghỉ ốm/thai sản) -> Gửi đơn.
- **Đăng ký OT:** Vào Đơn từ của tôi -> Đơn OT -> Tạo đơn trước giờ OT; xác nhận hoặc từ chối đề xuất OT do CHT lập.
- **Xem dự án & Phiếu lương:** Xem dự án tại trang Dự án của tôi; xem các khoản giải trình lương và in phiếu lương A4 tại mục Lương & Hợp đồng (chỉ hiển thị phiếu đã duyệt hoặc đã chi trả).

## 2. Dành cho Cửa hàng trưởng (Store Manager - MSS)
- **Phân ca kíp:** Phân ca tại Quản lý lịch làm việc, hệ thống tự động chống trùng lấn thời gian.
- **Giám sát chấm công:** Theo dõi công, đi muộn, về sớm của nhân viên cửa hàng tại Quản lý công & OT và Nhật ký đội ngũ.
- **Duyệt đơn Cấp 1:** Tại Quản lý đơn từ -> Đơn nghỉ phép, duyệt sơ bộ trong 24h để sắp xếp ca trực chi nhánh (STORE_APPROVED / REJECTED).
- **Đề xuất OT:** Lập đề xuất tại Quản lý đơn từ -> Đơn OT, nhân viên xác nhận rồi chuyển HR duyệt.

## 3. Dành cho Phòng Nhân sự & Ban Giám đốc
- **Quản lý dự án:** Tạo dự án mới, gán thành viên và thiết lập mức phụ cấp dự án hàng tháng.
- **Chốt lương chuỗi:** Vào Quản lý bảng lương -> Chọn kỳ lương -> Bấm Chốt & Tính Lương (`sp_generate_monthly_payroll`) -> Nhập Excel nếu cần -> Duyệt -> Chi trả -> Xuất file Excel/CSV. Cần sửa sau khi duyệt thì mở lại kỳ lương.
- **Hợp đồng và thôi việc:** Quản lý tại Hợp đồng & Biến động nhân sự và Quản lý thôi việc.
