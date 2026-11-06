---
doc_id: "TZ-DOC-02"
title: "Quy chế Quản lý Tiền lương, Phụ cấp, Tiền thưởng và Khấu trừ TechZone"
category: "TIEN_LUONG"
target_roles: ["EMPLOYEE", "STORE_MANAGER", "HR_MANAGER", "ADMIN", "DIRECTOR"]
effective_date: "2026-01-01"
keywords: ["tiền lương", "gross", "net", "công chuẩn 26", "phụ cấp chức vụ", "thâm niên", "bảo hiểm 10.5", "thuế tncn", "project allowance"]
---

# QUY CHẾ QUẢN LÝ TIỀN LƯƠNG, PHỤ CẤP, TIỀN THƯỞNG VÀ CÁC KHOẢN KHẤU TRỪ
*Số: TZ-DOC-02/QĐ-TZ2026 - Ban hành ngày 01/01/2026 bởi Ban Giám Đốc TechZone*

## 1. Định mức ngày công chuẩn và chu kỳ lương
- **Công chuẩn tháng:** 26.0 ngày (nghỉ 1 ngày/tuần theo lịch phân ca chi nhánh).
- **Kỳ hạch toán:** Từ ngày 01 đến ngày cuối tháng; chuyển khoản từ ngày 05 đến 10 tháng sau.

## 2. Công thức tính lương tổng quát
- **GROSS** = Lương CB thực nhận + Tăng ca OT + Phụ cấp CV + Phụ cấp thâm niên + **Phụ cấp dự án** + Phụ cấp cơm xe + Phụ cấp chuyên cần + Thưởng lễ.
- **NET** = GROSS - Bảo hiểm bắt buộc (10.5%) - Thuế TNCN. **Đã bãi bỏ khoản phạt đi muộn 50.000 VNĐ/lần.**

> *Lưu ý:* TechZone hoàn toàn không áp dụng hoa hồng bán hàng theo doanh số sản phẩm. Thay vào đó, thu nhập tăng thêm được chi trả theo **Phụ cấp tham gia Dự án & Chiến dịch chuỗi** (Project Allowance).

## 3. Các cấu phần thu nhập chi tiết
- **Lương CB thực nhận:** `Lương HĐ / 26 * (Công thực tế + Phép có lương)`, không chặn trần (27 công → 27/26 lương HĐ, dòng `EXTRA_WORKDAY_SALARY`). Thiếu công ghi tại `BASE_SALARY_DEDUCTION`. Không trừ lương theo phút đi trễ.
- **Tăng ca OT:** `Giờ OT duyệt * (Lương HĐ / 26 / 8) * 1.5`; OT ban đêm 22:00–08:00 hệ số 2.0; Ca Full tự cộng 4 giờ OT. Tối đa 40 giờ OT/tháng.
- **Phụ cấp chức vụ:** Giám đốc 10tr, CHT 2.5tr-3.5tr, CHP 1tr-1.5tr, NV 0-500k.
- **Phụ cấp thâm niên:** <1 năm: 0; 1-3 năm: 500k; 3-5 năm: 1M; >=5 năm: 1.5M.
- **Phụ cấp cơm xe:** `1.000.000 / 26 * Công thực tế`, tối đa 1.000.000 VNĐ/tháng (24 công → 923.077 VNĐ).
- **Phụ cấp chuyên cần:** 500.000 VNĐ; trễ > 15 phút 3–4 lần = 50%; trễ từ 5 lần hoặc dưới 20 công = 0.
- **Thưởng lễ:** `1.000.000 VNĐ * position_coefficient` (Giám đốc 3.0, CHT 1.5, NV 1.0).
- **Bảo hiểm 10.5%:** BHXH 8%, BHYT 1.5%, BHTN 1% tính trên `insurance_salary`.
