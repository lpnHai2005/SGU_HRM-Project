---
doc_id: "TZ-DOC-04"
title: "Quy trình Quản lý Nghỉ phép, Thai sản, Nghỉ việc và Phê duyệt Trực tuyến 2 Cấp TechZone"
category: "NGHI_PHEP"
target_roles: ["EMPLOYEE", "STORE_MANAGER", "HR_MANAGER", "ADMIN", "DIRECTOR"]
effective_date: "2026-01-01"
keywords: ["nghỉ phép", "đơn từ", "duyệt 2 cấp", "phép năm", "nghỉ ốm", "thai sản", "thôi việc", "minh chứng", "no self approval", "thu hồi đơn"]
---

# QUY TRÌNH QUẢN LÝ NGHỈ PHÉP, THAI SẢN, NGHỈ VIỆC VÀ PHÊ DUYỆT TRỰC TUYẾN 2 CẤP
*Số: TZ-DOC-04/QĐ-TZ2026 - Ban hành ngày 01/01/2026 bởi Ban Giám Đốc TechZone*

## 1. Danh mục 6 loại đơn nghỉ phép
1. **`PHEP_NAM` (Nghỉ phép năm):** 12 ngày/năm (+1 ngày cho mỗi 5 năm thâm niên), hưởng 100% lương, trừ vào số dư phép năm.
2. **`VIEC_RIENG` (Nghỉ việc riêng):** Hưởng 100% lương, tối đa 3 ngày (kết hôn, tang chế). Bắt buộc chặn nếu nộp > 3 ngày.
3. **`KHONG_LUONG` (Nghỉ không hưởng lương):** Tối đa 15 ngày, trừ lương theo ngày công `(Lương HĐ / 26)`.
4. **`NGHI_OM` (Nghỉ ốm đau BHXH):** Tối đa 30 ngày, BHXH trả 75%. **Bắt buộc có tệp minh chứng y tế.**
5. **`THAI_SAN` (Nghỉ thai sản):** Tối đa 180 ngày (6 tháng), chuyển `ON_LEAVE`. **Bắt buộc có giấy chứng sinh.**
6. **`THOI_VIEC` (Đơn thôi việc):** Báo trước theo luật (30-45 ngày). Khi duyệt: chuyển `RESIGNED` và khóa tài khoản `users`.

## 2. Quy trình phê duyệt 2 cấp (2-Level Approval)
- **Cấp 1 - Cửa hàng trưởng (STORE_MANAGER):** Duyệt sơ bộ trong vòng 24h để bố trí đổi ca showroom.
- **Cấp 2 - Trưởng phòng Nhân sự (HR_MANAGER):** Phê duyệt chính thức trên hệ thống.
- **Quyền HR duyệt thẳng:** HR có quyền duyệt thẳng Cấp 2 ngay từ trạng thái `PENDING`.

## 3. Nguyên tắc chống xung đột lợi ích (No Self-Approval)
- Cửa hàng trưởng tuyệt đối không tự duyệt đơn của mình.
- Đơn của CHT do Trưởng phòng HR hoặc Ban Giám Đốc duyệt.
- Đơn của HR/Admin do Giám đốc (`DIRECTOR`) duyệt.

## 4. Thu hồi phê duyệt & Hoàn phép năm (Revocation)
- HR/Admin có quyền thu hồi đơn đã duyệt (`HR_APPROVED` -> `REJECTED`).
- Hệ thống tự động hoàn lại 100% số ngày phép vào quỹ phép năm của nhân viên.
