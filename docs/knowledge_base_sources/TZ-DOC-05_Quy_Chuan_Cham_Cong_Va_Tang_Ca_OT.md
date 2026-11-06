---
doc_id: "TZ-DOC-05"
title: "Quy chuẩn Chấm công Đa phương thức, Phân ca kíp và Quản trị Làm thêm giờ OT TechZone"
category: "CHAM_CONG"
target_roles: ["EMPLOYEE", "STORE_MANAGER", "HR_MANAGER", "ADMIN", "DIRECTOR"]
effective_date: "2026-01-01"
keywords: ["chấm công", "geofence", "gps", "selfie", "cooldown 60s", "làm thêm giờ", "ot", "hệ số 150", "hệ số 200", "hệ số 300", "ot đêm", "40 giờ", "ca full"]
---

# QUY CHUẨN CHẤM CÔNG ĐA PHƯƠNG THỨC, PHÂN CA KÍP VÀ QUẢN TRỊ LÀM THÊM GIỜ OT
*Số: TZ-DOC-05/QĐ-TZ2026 - Ban hành ngày 01/01/2026 bởi Ban Giám Đốc TechZone*

## 1. Phương thức chấm công và Geofence
- **Mobile App:** Định vị GPS trong bán kính Geofence **100 mét** của chi nhánh + Chụp ảnh selfie tại showroom.
- **Web App:** Nhận diện theo IP mạng nội bộ cửa hàng.
- **Giờ chuẩn:** Dùng giờ máy chủ Backend UTC+07:00.
- **Khoảng chờ Cooldown 60 giây:** Sau Check-in phải chờ 60s mới được Check-out; sau Check-out phải chờ 60s mới được mở phiên mới.

## 2. Quy định làm thêm giờ (OT)
- **OT thực tế vs OT phê duyệt:** Chỉ số giờ OT được phê duyệt chính thức (`approved_overtime_hours`) mới được tính vào bảng lương.
- **Hệ số lương OT:**
  - Ngày thường: **150% (1.5x)**.
  - Ngày nghỉ hàng tuần: **200% (2.0x)**.
  - Ngày Lễ, Tết: **300% (3.0x)**.
  - Ban đêm 22:00–08:00: **200% (2.0x)**.
- **Ca Full 08:00–21:00:** 13 giờ − 1 giờ nghỉ = 12 giờ = 8 giờ công + 4 giờ OT tự động.
- **Trần OT:** tối đa 40 giờ/tháng/nhân viên, hệ thống chặn cứng khi vượt.
- **Lịch tuần Thứ Hai – Chủ Nhật:** ít nhất 1 ngày OFF/tuần; cảnh báo khi vượt 48 giờ/tuần.
