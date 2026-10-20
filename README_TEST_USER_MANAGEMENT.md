# HƯỚNG DẪN TEST: QUẢN LÝ TÀI KHOẢN & PHÂN QUYỀN (USER MANAGEMENT)
> Dự án: TechZone HRM — Phiên bản: 2026

---

## I. CHUẨN BỊ MÔI TRƯỜNG TEST

1. Khởi động hệ thống bằng file `start_all.bat`:
   - Frontend: `http://localhost:3000`
   - Backend Swagger Docs: `http://localhost:8000/docs`
2. Tài khoản kiểm thử:
   - **Tài khoản ADMIN:** `admin` / `admin123` (hoặc `123456`)
   - **Tài khoản Nhân viên / HR:** `hr_manager`, `store_manager`, `nv_banhang`

---

## II. DANH SÁCH 8 KỊCH BẢN KIỂM THỬ (TEST CASES)

### Test Case 1: Xem danh sách, Thống kê & Bộ lọc tìm kiếm
- **Mục tiêu:** Kiểm tra hiển thị bảng danh sách tài khoản kèm hồ sơ nhân sự liên kết.
- **Các bước:**
  1. Đăng nhập quyền `admin` $\rightarrow$ truy cập menu **"Tài khoản & Phân quyền"** (`/users`).
  2. Quan sát 4 thẻ thống kê: *Tổng tài khoản, Đang hoạt động, Đã bị khóa, Đã liên kết nhân sự*.
  3. Nhập từ khóa vào ô tìm kiếm: thử tìm theo tên đăng nhập (`admin`), họ tên nhân viên, email hoặc mã nhân viên (`NV...`).
  4. Chọn lọc theo *Trạng thái* (Đang hoạt động / Đã khóa) và lọc theo *Vai trò*.
- **Kết quả mong đợi:** Danh sách lọc chính xác, hiển thị đầy đủ avatar chữ cái đầu, mã nhân viên, phòng ban/chi nhánh và lần đăng nhập cuối.

---

### Test Case 2: Tạo tài khoản mới & Liên kết Hồ sơ Nhân sự
- **Mục tiêu:** Thêm tài khoản và liên kết 1-1 với nhân viên, gán vai trò duy nhất.
- **Các bước:**
  1. Nhấn nút **"+ Thêm tài khoản mới"**.
  2. Điền thông tin:
     - Tên đăng nhập: `test_staff_2026`
     - Mật khẩu: `MatKhau123!`
     - Email: `staff2026@techzone.vn`
     - Số điện thoại: `0901234567`
     - Combobox Hồ sơ nhân sự: Tìm kiếm theo họ tên, mã NV hoặc chi nhánh và chọn 1 nhân viên chưa có tài khoản.
     - Vai trò tài khoản: Chọn 1 vai trò duy nhất từ dropdown (ví dụ: `Nhân viên` hoặc `Quản lý cửa hàng`).
  3. Nhấn **"Tạo tài khoản"**.
- **Kết quả mong đợi:** 
  - Thông báo tạo thành công.
  - Tài khoản mới xuất hiện trên bảng với thông tin nhân sự và vai trò tương ứng.
  - Combobox nhân sự không cho phép chọn lại nhân viên đã được liên kết với người khác (hiển thị badge `Đã có: [username]`).

---

### Test Case 3: Chỉnh sửa thông tin tài khoản & Đổi liên kết nhân sự
- **Mục tiêu:** Cập nhật thông tin email, SĐT hoặc hủy/đổi liên kết nhân viên.
- **Các bước:**
  1. Tìm tài khoản vừa tạo $\rightarrow$ Nhấn biểu tượng **Sửa (cây bút)**.
  2. Đổi Email thành `staff_new@techzone.vn`, đổi Số điện thoại, đổi vai trò nếu cần.
  3. Thử chuyển Hồ sơ nhân viên sang *"-- Không liên kết hồ sơ nhân sự --"*.
  4. Nhấn **"Lưu cập nhật"**.
- **Kết quả mong đợi:** Cập nhật thành công, thông tin trên bảng đổi sang trạng thái mới (hiện badge *"Chưa liên kết"* nếu đã hủy liên kết).

---

### Test Case 4: Quản trị viên (ADMIN) Đặt lại mật khẩu (Reset Password)
- **Mục tiêu:** Admin cấp lại mật khẩu cho tài khoản người dùng khi quên mật khẩu.
- **Các bước:**
  1. Nhấn biểu tượng **Chìa khóa (KeyRound)** tại dòng tài khoản cần đổi.
  2. Nhập Mật khẩu mới: `ResetPass2026@` (ít nhất 6 ký tự).
  3. Nhập lại xác nhận mật khẩu $\rightarrow$ Nhấn **"Xác nhận đổi mật khẩu"**.
  4. Đăng xuất tài khoản hiện tại $\rightarrow$ Đăng nhập bằng username đó với mật khẩu mới vừa đổi.
  5. Đăng nhập thành công với mật khẩu mới, không báo lỗi.
- **Kết quả mong đợi:** Đăng nhập thành công với mật khẩu mới.

---

### Test Case 5: Phân quyền vai trò trực quan (1 tài khoản 1 vai trò) & Tự bảo vệ Admin
- **Mục tiêu:** Thay đổi vai trò duy nhất của tài khoản trực tiếp qua dropdown hoặc trong modal sửa.
- **Các bước:**
  1. Tại cột "Vai trò" ở dòng tài khoản nhân viên, chọn đổi sang vai trò khác từ menu dropdown (ví dụ: `Cửa hàng trưởng` hoặc `Trưởng phòng Nhân sự`).
  2. Hệ thống tự động cập nhật ngay lập tức và hiển thị thông báo thành công.
  3. *Test trường hợp đặc biệt:* Tại dòng tài khoản của chính bạn (`admin`), thử chọn đổi vai trò sang `Nhân viên`.
- **Kết quả mong đợi:** 
  - Cập nhật vai trò thành công cho nhân viên.
  - Với tài khoản của chính mình: Hệ thống cảnh báo và chặn: *"Không thể tự gỡ quyền Quản trị viên của chính mình"*.

---

### Test Case 6: Khóa / Mở khóa tài khoản (Active/Deactive)
- **Mục tiêu:** Tạm khóa quyền truy cập của tài khoản mà không làm mất dữ liệu.
- **Các bước:**
  1. Tại dòng tài khoản nhân viên, nhấn biểu tượng **Khóa (Lock)** màu vàng.
  2. Quan sát badge trạng thái chuyển sang **"Đã khóa"** màu đỏ.
  3. Mở tab ẩn danh (Incognito) $\rightarrow$ Thử đăng nhập bằng tài khoản bị khóa này.
  4. Quay lại màn hình Admin, nhấn biểu tượng **Mở khóa (Unlock)** màu xanh để kích hoạt lại.
- **Kết quả mong đợi:** 
  - Khi bị khóa: Không thể đăng nhập, hệ thống báo *"Tài khoản đã bị vô hiệu hóa"*.
  - Sau khi mở khóa: Đăng nhập lại bình thường.
  - Admin không thể tự khóa tài khoản của chính mình.

---

### Test Case 7: Cơ chế Xóa tài khoản an toàn & Bảo toàn kiểm toán
- **Mục tiêu:** Kiểm tra khả năng tự động phân biệt giữa xóa cứng và chuyển sang khóa mềm để bảo vệ dữ liệu nghiệp vụ.
- **Các bước:**
  1. **Trường hợp A (Tài khoản mới, chưa có dữ liệu):** Tạo tài khoản phụ `dummy_temp` $\rightarrow$ Nhấn biểu tượng **Thùng rác** $\rightarrow$ Xác nhận xóa $\rightarrow$ Kết quả: *Đã xóa vĩnh viễn khỏi hệ thống*.
  2. **Trường hợp B (Tài khoản đã có lịch sử ký HĐ/duyệt đơn):** Chọn tài khoản đã phát sinh giao dịch $\rightarrow$ Nhấn biểu tượng **Thùng rác** $\rightarrow$ Xác nhận xóa.
- **Kết quả mong đợi (Trường hợp B):** Hệ thống không xóa cứng mà thông báo: *"Tài khoản đã từng tham gia ký hợp đồng, phê duyệt đơn từ... Hệ thống đã vô hiệu hóa (khóa) tài khoản thay vì xóa vĩnh viễn để bảo toàn dữ liệu kiểm toán."* Trạng thái tài khoản chuyển thành *Đã khóa*.

---

### Test Case 8: Tự động khóa tài khoản khi nhân viên Nghỉ việc
- **Mục tiêu:** Kiểm tra quy trình thôi việc tự động vô hiệu hóa tài khoản.
- **Các bước:**
  1. Vào trang **"Quản lý thôi việc"** hoặc gọi API `POST /api/v1/resignations/{id}/finalize`.
  2. Hoàn tất duyệt đơn thôi việc cho 1 nhân viên đang có tài khoản đăng nhập.
  3. Quay lại trang **"Tài khoản & Phân quyền"**.
- **Kết quả mong đợi:** Tài khoản của nhân viên đó tự động chuyển sang trạng thái **"Đã khóa"**, hợp đồng lao động chuyển sang `TERMINATED` và nhân viên chuyển sang `RESIGNED`.

---

## III. CHẠY KIỂM THỬ TỰ ĐỘNG BẰNG SCRIPT (AUTOMATED TEST)

Trong thư mục `backend`, bạn có thể chạy file script kiểm thử tự động đã viết sẵn:

```bash
cd backend
python test_user_management.py
```

Script sẽ tự động chạy qua 7 bước:
1. Truy vấn danh sách tài khoản kèm phòng ban và chi nhánh.
2. Tạo tài khoản thử nghiệm băm Bcrypt.
3. Lấy chi tiết tài khoản theo ID.
4. Cập nhật thông tin email, SĐT.
5. Admin reset password.
6. Test khóa và mở khóa tài khoản.
7. Test xóa tài khoản an toàn và kiểm tra sạch dữ liệu.

Output kỳ vọng: `=== TẤT CẢ TEST ĐÃ VƯỢT QUA 100% HOÀN HẢO! ===`
