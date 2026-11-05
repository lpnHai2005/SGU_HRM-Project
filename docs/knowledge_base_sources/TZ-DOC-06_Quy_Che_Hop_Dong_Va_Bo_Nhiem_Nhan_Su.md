---
doc_id: "TZ-DOC-06"
title: "Quy chế Hợp đồng Lao động, Tiêu chuẩn Bổ nhiệm, Thăng chức và Phân quyền RBAC TechZone"
category: "NHAN_SU"
target_roles: ["EMPLOYEE", "STORE_MANAGER", "HR_MANAGER", "ADMIN", "DIRECTOR"]
effective_date: "2026-01-01"
keywords: ["hợp đồng lao động", "thăng chức", "bổ nhiệm", "rbac", "STORE_MANAGER", "DIRECTOR", "HR_MANAGER", "phụ cấp chức vụ", "cảnh báo hết hạn"]
---

# QUY CHẾ HỢP ĐỒNG LAO ĐỘNG, TIÊU CHUẨN BỔ NHIỆM, THĂNG CHỨC VÀ PHÂN QUYỀN RBAC
*Số: TZ-DOC-06/QĐ-TZ2026 - Ban hành ngày 01/01/2026 bởi Ban Giám Đốc TechZone*

## 1. Các loại hợp đồng lao động
- `PROBATION` (Thử việc): 30 - 180 ngày. Tối đa 180 ngày (6 tháng), thường là 3 tháng hoặc 6 tháng.
- `FIXED_1_YEAR`, `FIXED_2_YEAR`, `FIXED_3_YEAR` (HĐ xác định thời hạn).
- `INDEFINITE` (HĐ không xác định thời hạn).
- Mã hợp đồng: `HD-YYYY-NNNN`. Hợp đồng ghi thời giờ làm việc 40, 44 hoặc 48 giờ/tuần (mặc định 48).
- Vòng đời: `DRAFT`, `ACTIVE`, `EXPIRED`, `TERMINATED`, `CANCELLED`. Hợp đồng quá ngày kết thúc tự chuyển `EXPIRED`.
- Trang Hợp đồng & Biến động nhân sự thống kê hợp đồng sắp hết hạn trong **30 ngày** để tái ký.
- Không gia hạn hợp đồng không xác định thời hạn, không gia hạn thành hợp đồng thử việc.

## 2. Tiêu chuẩn bổ nhiệm và đồng bộ vai trò RBAC
Khi thăng chức hoặc điều chuyển qua hệ thống (`/employees/promotions`, do HR hoặc Giám đốc thực hiện):
1. Tự động ghi lịch sử vào `position_histories`.
2. Cập nhật chức vụ, cửa hàng mới trong `employees`.
3. **Tự động đổi quyền người dùng (user_roles):** Chỉ khi thăng lên CHT mới tự động gán role `STORE_MANAGER`; các chức vụ khác, kể cả Giám đốc, do Quản trị viên cập nhật tại Tài khoản & Phân quyền.
4. Tự động cập nhật phụ cấp chức vụ và hệ số thưởng lễ trong kỳ lương tiếp theo.

## 3. Phân quyền theo vai trò
- `DIRECTOR`: Duyệt đơn của HR và Admin, xem báo cáo toàn công ty.
- `HR_MANAGER`: Quản lý nhân sự, hợp đồng, duyệt đơn Cấp 2, tính lương.
- `ADMIN`: Quản lý tài khoản, phân quyền, nhật ký, cửa hàng; chỉ xem ở nghiệp vụ.
- `STORE_MANAGER`: Phân ca, duyệt đơn Cấp 1; chỉ xem dữ liệu chi nhánh mình.
- `EMPLOYEE`: Chấm công, nộp đơn, xem lương cá nhân.
