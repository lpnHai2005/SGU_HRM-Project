---
doc_id: "TZ-DOC-08"
title: "Sổ tay Giải đáp Tình huống Nghiệp vụ Thường gặp (FAQ) Chuỗi TechZone Retail"
category: "FAQ"
target_roles: ["EMPLOYEE", "STORE_MANAGER", "HR_MANAGER", "ADMIN", "DIRECTOR"]
effective_date: "2026-01-01"
keywords: ["faq", "hỏi đáp", "tình huống", "quên checkout", "lỗi gps", "phụ cấp dự án", "thâm niên", "nghỉ ốm minh chứng", "hủy đơn", "thôi việc"]
---

# SỔ TAY GIẢI ĐÁP TÌNH HUỐNG NGHIỆP VỤ THƯỜNG GẶP (FAQ) TECHZONE RETAIL
*Số: TZ-DOC-08/FAQ-TZ2026 - Ban hành ngày 01/01/2026 bởi Ban Giám Đốc TechZone*

## Chủ đề A: Dự án và Phụ cấp Dự án
1. **Phụ cấp dự án là gì?** Khoản tiền đãi ngộ trả hàng tháng cho nhân sự tham gia chiến dịch mở rộng chi nhánh Flagship, mở bán siêu phẩm hoặc chuyển đổi số.
2. **Định mức theo vai trò:** Trưởng dự án (1.5M-2M), Key Member (1.5M), Core Member (1.2M), Tech Lead (1M), Member (500k).
3. **Cộng dồn đa dự án:** Tham gia nhiều dự án đồng thời được cộng dồn toàn bộ phụ cấp của tất cả các dự án hợp lệ vào bảng lương tháng.
4. **Vào giữa tháng có được phụ cấp không?** Có, nếu `joined_date` <= tháng hạch toán và dự án đang chạy.
5. **Dừng nhận phụ cấp khi nào?** Khi dự án hoàn thành (`COMPLETED`), hủy bỏ (`CANCELLED`), hoặc rời dự án.

## Chủ đề B: Tiền lương và Khấu trừ
6. **Công thức Net:** `NET = GROSS - BHXH/BHYT/BHTN (10.5%) - Phạt đi muộn - Thuế TNCN`.
7. **Công chuẩn:** 26.0 ngày/tháng.
8. **Nghỉ không lương:** Trừ `(Lương HĐ / 26) * số ngày nghỉ`.
9. **Thâm niên:** <1 năm: 0; 1-3 năm: 500k; 3-5 năm: 1M; >=5 năm: 1.5M.
10. **Bảo hiểm:** Trích 10.5% lương đóng bảo hiểm.

## Chủ đề C: Chấm công và OT
11. **Đi muộn <= 15 phút:** Trong giới hạn ân hạn, không phạt tiền, tính Đúng giờ (NORMAL).
12. **Đi muộn > 15 phút:** Phạt 50.000 VNĐ / lần + trừ lương theo phút trễ.
13. **Quên check-out:** Báo Cửa hàng trưởng lập biên bản giải trình, đối soát camera để cập nhật giờ thực tế.
14. **Lỗi Geofence:** Bật GPS chính xác cao, kết nối Wi-Fi showroom và đứng trong bán kính 100m.
15. **Hệ số OT:** Ngày thường 150%, ngày nghỉ tuần 200%, ngày lễ tết 300%.

## Chủ đề D: Nghỉ phép và Thôi việc
16. **Nghỉ kết hôn:** 3 ngày hưởng nguyên lương.
17. **Nghỉ ốm:** Bắt buộc đính kèm giấy khám bệnh / giấy viện.
18. **Cửa hàng trưởng xin nghỉ:** Do Trưởng phòng HR hoặc Ban Giám Đốc duyệt (No Self-Approval).
19. **Hủy đơn đã duyệt:** Báo HR thu hồi đơn để được hoàn trả ngày phép năm vào quỹ.
20. **Thời hạn báo thôi việc:** HĐ không thời hạn 45 ngày; HĐ 1-3 năm 30 ngày; thử việc 3 ngày.

## Chủ đề E: Tài khoản và Phân quyền
21. **Thăng chức CHT:** Hệ thống tự động gán vai trò `STORE_MANAGER` và cập nhật phụ cấp chức vụ mới.
22. **Quên mật khẩu:** Báo Admin hoặc Trưởng phòng HR để reset về mật khẩu mặc định (123456).
