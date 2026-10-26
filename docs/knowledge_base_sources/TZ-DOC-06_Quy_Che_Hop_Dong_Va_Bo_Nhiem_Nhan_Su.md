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
- `PROBATION` (Thử việc): 30 - 60 ngày.
- `FIXED_1_YEAR`, `FIXED_2_YEAR`, `FIXED_3_YEAR` (HĐ xác định thời hạn).
- `INDEFINITE` (HĐ không xác định thời hạn).
- Tự động cảnh báo hết hạn trước **30 ngày** để tái ký.

## 2. Tiêu chuẩn bổ nhiệm và đồng bộ vai trò RBAC
Khi thăng chức nhân viên qua hệ thống (`/employees/promotions`):
1. Tự động ghi lịch sử vào `position_histories`.
2. Cập nhật chức vụ mới trong `employees`.
3. **Tự động đổi quyền người dùng (user_roles):** Thăng lên CHT -> tự động gán role `STORE_MANAGER`; thăng lên Giám đốc -> gán `DIRECTOR`.
4. Tự động cập nhật phụ cấp chức vụ và hệ số thưởng lễ trong kỳ lương tiếp theo.
