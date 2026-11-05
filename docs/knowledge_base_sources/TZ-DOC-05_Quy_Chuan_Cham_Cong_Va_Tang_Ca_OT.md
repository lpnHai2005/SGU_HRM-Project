---
doc_id: "TZ-DOC-05"
title: "Quy chuẩn Chấm công Đa phương thức, Phân ca kíp và Quản trị Làm thêm giờ OT TechZone"
category: "CHAM_CONG"
target_roles: ["EMPLOYEE", "STORE_MANAGER", "HR_MANAGER", "ADMIN", "DIRECTOR"]
effective_date: "2026-01-01"
keywords: ["chấm công", "geofence", "gps", "selfie", "cooldown 60s", "làm thêm giờ", "ot", "đăng ký ot", "đối soát ot", "hệ số 150", "hệ số 200", "hệ số 300"]
---

# QUY CHUẨN CHẤM CÔNG ĐA PHƯƠNG THỨC, PHÂN CA KÍP VÀ QUẢN TRỊ LÀM THÊM GIỜ OT
*Số: TZ-DOC-05/QĐ-TZ2026 - Ban hành ngày 01/01/2026 bởi Ban Giám Đốc TechZone*

## 1. Phương thức chấm công và Geofence
- **Mobile App:** Định vị GPS trong bán kính Geofence của chi nhánh (hiện tất cả cửa hàng là **100 mét**) + Chụp ảnh selfie tại showroom.
- **Web App:** Kiểm tra IP theo danh sách dải mạng được phép của cửa hàng; cửa hàng chưa khai báo thì chưa giới hạn IP.
- **Giờ chuẩn:** Dùng giờ máy chủ Backend UTC+07:00.
- **Khoảng chờ Cooldown 60 giây:** Sau Check-in phải chờ 60s mới được Check-out; sau Check-out phải chờ 60s mới được mở phiên mới.

## 2. Quy định làm thêm giờ (OT)
- **Đăng ký trước:** Nhân viên tự tạo đơn tại Đơn từ của tôi > Đơn OT, hoặc CHT lập đề xuất và nhân viên xác nhận. CHT không tự đăng ký cho mình. Khung giờ phải ở tương lai, không trùng ca, đơn nghỉ hoặc đơn OT khác.
- **Phê duyệt:** Trưởng phòng Nhân sự hoặc Giám đốc duyệt; không duyệt đơn do mình tạo hoặc của chính mình.
- **Đối soát sau ca:** HR hoặc Giám đốc đối chiếu giờ đã duyệt với chấm công thực tế rồi xác nhận số giờ.
- **Giờ ngoài ca vs OT phê duyệt:** Giờ ngoài ca chưa phải OT trả lương. Chỉ số giờ đã phê duyệt (`attendance_overtime_approvals.approved_hours`) mới được tính vào bảng lương.
- **Hệ số lương OT:**
  - Ngày thường (Thứ 2 đến Thứ 7): **150% (1.5x)**.
  - Chủ nhật: **200% (2.0x)**.
  - Ngày Lễ, Tết: **300% (3.0x)**.
