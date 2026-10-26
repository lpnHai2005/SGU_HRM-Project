---
doc_id: "TZ-DOC-03"
title: "Quy chế Quản trị Dự án, Chiến dịch Chuỗi và Chính sách Phụ cấp Dự án vào Lương TechZone"
category: "DU_AN"
target_roles: ["EMPLOYEE", "STORE_MANAGER", "HR_MANAGER", "ADMIN", "DIRECTOR"]
effective_date: "2026-01-01"
keywords: ["dự án", "phụ cấp dự án", "project allowance", "project_roles", "PROJECT_LEAD", "KEY_MEMBER", "CORE_MEMBER", "TECH_LEAD", "cộng dồn dự án"]
---

# QUY CHẾ QUẢN TRỊ DỰ ÁN, CHIẾN DỊCH CHUỖI VÀ CHÍNH SÁCH PHỤ CẤP DỰ ÁN VÀO LƯƠNG
*Số: TZ-DOC-03/QĐ-TZ2026 - Ban hành ngày 01/01/2026 bởi Ban Giám Đốc TechZone*

## 1. Phân loại dự án trọng điểm tại chuỗi TechZone
- **Dự án mở rộng điểm bán:** `PRJ-EXPAND-Q7` (Flagship Quận 7 - Ngân sách 500.000.000 VNĐ).
- **Chiến dịch mở bán độc quyền:** `PRJ-IPHONE16-LAUNCH` (Mở bán iPhone 16 Series - Ngân sách 350.000.000 VNĐ).
- **Dự án chuyển đổi số:** `PRJ-ERP-HRM` (Chuyển đổi số Quản trị Nhân sự - Ngân sách 200.000.000 VNĐ).
- **Trạng thái:** `IN_PROGRESS` (đang chạy), `ACTIVE` (hoạt động), `COMPLETED` (hoàn tất), `CANCELLED` (hủy bỏ).

## 2. Khung 5 vai trò thành viên và định mức phụ cấp hàng tháng
| Mã vai trò | Tên vai trò | Định mức phụ cấp / tháng | Trách nhiệm chính |
|---|---|---|---|
| `PROJECT_LEAD` | Trưởng dự án | **1.500.000 – 2.000.000 VNĐ** | Quản lý toàn diện tiến độ, ngân sách, nhân sự |
| `KEY_MEMBER` | Thành viên Chủ chốt | **1.500.000 VNĐ** | Phụ trách các nhiệm vụ quan trọng trong chiến dịch |
| `CORE_MEMBER` | Thành viên Nòng cốt | **1.200.000 VNĐ** | Trực tiếp thực thi các gói công việc trọng yếu |
| `TECH_LEAD` | Trưởng nhóm Kỹ thuật | **1.000.000 VNĐ** | Giải pháp kỹ thuật, hạ tầng quầy demo và POS |
| `MEMBER` | Thành viên thông thường | **500.000 VNĐ** | Hỗ trợ vận hành và tác nghiệp theo phân công |

## 3. Điều kiện tính phụ cấp dự án vào kỳ lương
Khi chạy chốt lương (`sp_generate_monthly_payroll`), nhân viên được hưởng phụ cấp khi:
1. `project_members.is_active = TRUE`.
2. Dự án có trạng thái `IN_PROGRESS` hoặc `ACTIVE`.
3. Ngày tham gia `joined_date` <= kỳ lương hạch toán.
4. Ngày rời dự án `left_date` chưa đến hoặc >= kỳ lương hạch toán.

## 4. Cơ chế Ưu tiên Override và Quy tắc Cộng dồn
- **Ưu tiên Override:** Mức `project_members.project_allowance` (> 0) nếu cấu hình riêng sẽ ưu tiên thay thế định mức vai trò.
- **Quy tắc Cộng dồn (Multi-project Accumulation):** Nhân viên tham gia nhiều dự án đồng thời được cộng dồn toàn bộ phụ cấp của tất cả các dự án hợp lệ vào bảng lương tháng.
- Dòng giải trình sinh tự động: `PROJECT_ALLOWANCE` trong `payroll_details`.
