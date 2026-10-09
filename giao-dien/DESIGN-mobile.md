# 🎨 Retail HRM Modernist — Design System & Guidelines

> **Bộ Quy Chuẩn Thiết Kế Giao Diện Nhân Sự Bán Lẻ TechZone**  
> **Phong cách:** Modernist Retail HRM (Tối giản, Hiệu năng cao, Chuẩn công thái học di động)  
> **Nguồn gốc:** Google Stitch Design System

---

## 1. Triết Lý Thiết Kế (Design Philosophy)

Môi trường làm việc tại chuỗi bán lẻ công nghệ TechZone đòi hỏi sự nhanh chóng, độ chính xác cao và trải nghiệm không gây gián đoạn:
- **Tập trung vào hành động cốt lõi (Action-Centric):** Nhân viên bán hàng và kỹ thuật viên chỉ có 5 - 15 giây để chấm công hoặc kiểm tra ca trực. Mọi thông tin cốt lõi phải được nhận diện ngay ở cái nhìn đầu tiên.
- **Thực dụng & Rõ ràng (Clarity over Decoration):** Loại bỏ bóng đổ quá đậm, viền nổi 3D lỗi thời; ưu tiên bề mặt phẳng sạch sẽ (*clean flat surfaces*), thẻ thông tin chia ranh giới rõ ràng (*well-bounded cards*), và typographic hierarchy chặt chẽ.
- **Phản hồi xúc giác & thị giác an toàn (Fail-Safe Interactions):** Chấm công sử dụng nút trượt (*Slide gesture*) thay vì chạm đơn để tránh thao tác nhầm lẫn khi điện thoại để trong túi hoặc khi ngón tay ướt.

---

## 2. Hệ Màu Thiết Kế (Color System)

### 2.1. Màu Thương Hiệu (Brand Colors)
- **Primary Blue (TechZone Blue):** `#2563EB` (Tailwind `blue-600`)  
  *Ý nghĩa:* Tượng trưng cho sự chuyên nghiệp, công nghệ cao và ổn định.  
  *Sử dụng:* Nút CTA chính, tab active, trạng thái đang chọn.
- **Primary Blue Dark:** `#1D4ED8` (Tailwind `blue-700`)  
  *Sử dụng:* Trạng thái pressed, header gradient, accent nền.
- **Cyan Accent (Tech Electric):** `#06B6D4` (Tailwind `cyan-500`)  
  *Sử dụng:* Điểm sáng gradient, icon định vị GPS, radar quét.

### 2.2. Màu Ngữ Nghĩa (Semantic Colors)
- **Success / Emerald:** `#10B981` (Tailwind `emerald-500`)  
  *Ý nghĩa:* Vị trí GPS hợp lệ, chấm công đúng giờ, đơn đã được phê duyệt, ca trực hoàn tất.
- **Warning / Amber:** `#F59E0B` (Tailwind `amber-500`)  
  *Ý nghĩa:* Đi trễ < 15 phút, đơn đang chờ duyệt, ca làm việc sắp bắt đầu, nhắc bàn giao.
- **Destructive / Rose:** `#EF4444` (Tailwind `rose-500`)  
  *Ý nghĩa:* Ngoài bán kính GPS, đi trễ quá giờ, đơn bị từ chối, cảnh báo bảo mật.
- **Info / Indigo:** `#6366F1` (Tailwind `indigo-500`)  
  *Ý nghĩa:* Ca trực ban đêm, thông báo nội bộ hệ thống, hướng dẫn thao tác.

### 2.3. Màu Nền & Bề Mặt (Surfaces & Neutrals)
- **Background Root:** `#F8FAFC` (Slate 50) — Dịu mắt khi sử dụng dưới đèn showroom.
- **Surface Card:** `#FFFFFF` (Pure White) với viền `#E2E8F0` (Slate 200).
- **Text Heading:** `#0F172A` (Slate 900) — Tương phản chuẩn WCAG AAA.
- **Text Body:** `#334155` (Slate 700).
- **Text Subtitle / Caption:** `#64748B` (Slate 500).

---

## 3. Hệ Thống Kiểu Chữ (Typography)

Sử dụng hệ font sans-serif hình học hiện đại (**Inter** hoặc **Plus Jakarta Sans**):

| Tên Style | Kích Thước | Cân Nặng (Weight) | Tracking | Chiều Cao Dòng (Leading) |
|---|---|---|---|---|
| **Display Clock** | 36px / 2.25rem | 700 (Bold) | -0.025em | 1.1 |
| **Heading 1** | 22px / 1.375rem | 700 (Bold) | -0.015em | 1.25 |
| **Heading 2** | 18px / 1.125rem | 600 (SemiBold) | -0.01em | 1.3 |
| **Heading 3** | 16px / 1rem | 600 (SemiBold) | 0 | 1.4 |
| **Body Regular** | 14px / 0.875rem | 400 (Regular) | 0 | 1.5 |
| **Body Medium** | 14px / 0.875rem | 500 (Medium) | 0 | 1.5 |
| **Caption / Badge** | 12px / 0.75rem | 600 (SemiBold) | +0.01em | 1.3 |
| **Micro Text** | 10px / 0.625rem | 500 (Medium) | +0.02em | 1.2 |

---

## 4. Thành Phần Giao Diện Chuẩn (UI Components)

### 4.1. Nút Trượt Hành Động (Slide-to-Action)
- Thiết kế hình viên thuốc (`rounded-full`) với rãnh trượt mờ (`bg-blue-100/60`).
- Con trượt hình tròn nổi bật (`bg-blue-600 shadow-md text-white`) mang icon mũi tên đôi.
- Khi người dùng kéo qua 85% chiều rộng: Kích hoạt tác vụ, phát hiệu ứng haptic và tự động hoàn tất.

### 4.2. Thẻ Ca Làm Việc (Shift Card)
- Cấu trúc:
  - Header: Tên ca (Ca Sáng / Chiều / Tối) + Badge trạng thái (Đã nhận / Đang diễn ra).
  - Body: Khung giờ to rõ (08:30 - 15:30) + Vị trí quầy phân công.
  - Footer: Nút xem chi tiết hoặc nút đổi ca nhanh.

### 4.3. Radar Geofence GPS
- Thiết kế hình tròn đa lớp mô phỏng sóng radar vệ tinh.
- Hiển thị tâm định vị (Store Location) và chấm người dùng (User Location) với đường nối hiển thị khoảng cách thực (mét).

### 4.4. Thanh Điều Hướng Dưới (Bottom Navigation Bar)
- Cố định ở đáy màn hình, có khoảng đệm an toàn iOS Home Indicator.
- Cấu trúc 5 vị trí:
  1. Trang chủ (Home)
  2. Lịch ca (Calendar)
  3. **Chấm công (Nút tròn nổi bật ở giữa với gradient xanh)**
  4. Đơn từ (Leaves & Requests)
  5. Tài khoản (Profile)

---

## 5. Danh Sách 13 Màn Hình Tương Thích Stitch

1. `ng_nh_p`: Đăng nhập bảo mật (Staff ID & Password & Face ID).
2. `i_m_t_kh_u`: Đổi mật khẩu định kỳ / cấp mới.
3. `trang_ch_dashboard`: Bảng điều khiển trung tâm cá nhân hóa.
4. `ch_m_c_ng_check_in_out`: Màn hình ghi nhận thời gian chấm công.
5. `x_c_minh_v_tr_gps`: Bản đồ radar định vị Geofence tại cửa hàng.
6. `l_ch_c_ph_n_c_ng`: Lịch làm việc tuần và phân ca.
7. `b_ng_c_ng_c_nh_n`: Thống kê ngày công và giờ làm chi tiết.
8. `nh_t_k_l_m_vi_c`: Sổ ghi chép công việc và bàn giao ca.
9. `qu_n_l_ngh_ph_p`: Cổng theo dõi quỹ phép năm và đơn nghỉ.
10. `t_o_n_xin_ngh_ph_p`: Mẫu đơn xin nghỉ phép trực tuyến.
11. `chi_ti_t_n_xin_ngh_ph_p`: Thông tin chi tiết đơn và quy trình duyệt.
12. `th_ng_b_o`: Trung tâm thông báo đẩy.
13. `th_ng_tin_c_nh_n`: Hồ sơ nhân sự và thiết lập tài khoản.
