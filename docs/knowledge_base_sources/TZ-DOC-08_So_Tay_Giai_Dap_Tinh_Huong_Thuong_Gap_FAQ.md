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
4. **Vào giữa tháng có được phụ cấp không?** Có, nếu `joined_date` <= tháng hạch toán và dự án đang chạy (`IN_PROGRESS`).
5. **Dừng nhận phụ cấp khi nào?** Khi dự án hoàn thành (`COMPLETED`), hủy bỏ (`CANCELLED`), hoặc rời dự án.

## Chủ đề B: Tiền lương và Khấu trừ
6. **Công thức Net:** `NET = GROSS - BHXH/BHYT/BHTN (10.5%) - Phạt đi muộn - Các khoản khấu trừ bổ sung`. Hệ thống hiện chưa tự tính thuế TNCN.
7. **Công chuẩn:** Theo từng kỳ, bằng tổng ngày trong tháng trừ Chủ nhật và ngày Lễ, Tết (tháng 11/2026 là 25 ngày).
8. **Nghỉ không lương:** Trừ `(Lương HĐ / Công chuẩn của kỳ) * số ngày nghỉ`.
9. **Thâm niên:** <1 năm: 0; 1-3 năm: 500k; 3-5 năm: 1M; >=5 năm: 1.5M.
10. **Bảo hiểm:** Trích 10.5% lương đóng bảo hiểm.

## Chủ đề C: Chấm công và OT
11. **Đi muộn <= 15 phút:** Trong giới hạn ân hạn, không phạt tiền, tính Đúng giờ (NORMAL).
12. **Đi muộn > 15 phút:** Phạt 50.000 VNĐ / lần + trừ lương theo toàn bộ số phút trễ.
13. **Quên check-out:** Phiên vẫn đang mở, phải check-out trước khi mở phiên mới. Báo Cửa hàng trưởng; HR hoặc Giám đốc xác minh phiên bất thường, CHT không có quyền sửa.
14. **Lỗi Geofence:** Bật GPS chính xác cao và đứng trong bán kính Geofence của chi nhánh (hiện là 100m).
15. **Hệ số OT:** Ngày thường 150%, Chủ nhật 200%, ngày lễ tết 300%.

## Chủ đề D: Nghỉ phép và Thôi việc
16. **Nghỉ kết hôn:** 3 ngày hưởng nguyên lương.
17. **Nghỉ ốm:** Bắt buộc đính kèm giấy khám bệnh / giấy viện.
18. **Cửa hàng trưởng xin nghỉ:** Do Trưởng phòng Nhân sự duyệt (No Self-Approval).
19. **Hủy đơn:** Đơn `PENDING` tự hủy được; đơn đã duyệt báo HR hoặc Giám đốc thu hồi để được hoàn trả ngày phép năm vào quỹ.
20. **Thời hạn báo thôi việc:** HĐ không thời hạn 45 ngày; HĐ 1-3 năm 30 ngày; thử việc 3 ngày.

## Chủ đề E: Tài khoản và Phân quyền
21. **Thăng chức CHT:** Hệ thống tự động gán vai trò `STORE_MANAGER` và cập nhật phụ cấp chức vụ mới; chức vụ khác do Quản trị viên cập nhật vai trò.
22. **Quên mật khẩu:** Báo Admin đặt lại mật khẩu mới (tối thiểu 6 ký tự), sau đó đổi lại tại trang Tài khoản.

## Chủ đề F: Hoa hồng, Thuế và Đăng ký OT
23. **Hoa hồng bán hàng:** Có. 1% doanh số điện thoại và laptop, 3% doanh số phụ kiện; từ 100% KPI thưởng 1.000.000 VNĐ, từ 120% KPI thưởng 2.000.000 VNĐ.
24. **Thuế TNCN:** Hệ thống hiện chưa tự tính, thực lĩnh trên phiếu lương chưa trừ khoản này.
25. **Đăng ký OT:** Gửi đơn tại Đơn từ của tôi -> Đơn OT trước giờ OT; HR hoặc Giám đốc duyệt và đối soát sau ca.
26. **Ở lại quá giờ ca:** Không tự động tính OT, chỉ trả lương khi có phê duyệt.
