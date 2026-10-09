# TECHZONE HRM Mobile — giao diện Stitch

Cập nhật 09/10/2026. Ứng dụng thực tế nằm trong `mobile/`, dùng Expo SDK 57, React Native và Expo Router. Bản này độc lập với React/Vite + Capacitor trong `frontend-web/`.

## Tài liệu

- [Design system](DESIGN-mobile.md).
- [Báo cáo và nghiệm thu](mission2.md), mục 14.
- [Stitch gốc](stitch_techzone_hrm_mobile_app.zip). Một số screen.png trong ZIP chứa thông báo lỗi xuất ảnh; tham chiếu code.html tương ứng.

## Phạm vi thực tế

| Nhóm | Chức năng |
|---|---|
| Điều hướng | Trang chủ, Lịch ca, Chấm công, Đơn từ, Tài khoản; avatar/menu mở chức năng bổ sung |
| Trang chủ | Nhân viên, ca hôm nay, giờ vào/ra, lịch tuần, lối tắt tùy chọn; không gắn map thường trực |
| Chấm công | Nút người vào/ra theo ca được phân, GPS trước camera, ảnh minh chứng, gửi API, quay về Home |
| GPS ngoài vùng | Map hiển thị vị trí và vùng cửa hàng; không mở camera hoặc ghi chấm công |
| Lịch ca, bảng công, lịch sử | API hiện có, bộ lọc kỳ, trạng thái tải/lỗi |
| Đơn từ | Danh sách, tạo, chi tiết, hủy/duyệt/từ chối theo quyền hiện có |
| Thông báo | Biến động trạng thái đơn trong app, chưa phải push nền |
| Tài khoản | Hồ sơ, đổi mật khẩu, theme, lối tắt, đăng xuất |

Giữ font Be Vietnam Pro đóng gói sẵn để hỗ trợ tiếng Việt. Màu xanh thương hiệu, nền slate và card dùng chung qua attendance-ui.tsx. Flagship Store được đổi thành TECHZONE Store ở lớp hiển thị, không thay ID cửa hàng.

Face ID, OTP, xin đổi/nhận ca trống, bàn giao tiền mặt, bảng tin bán lẻ và push notification trong mockup chưa có API tương ứng: không giả lập thành chức năng đã hoàn thành. Bán kính GPS lấy từ cửa hàng trên server, không cố định 50 m theo hình mẫu.

## Chạy từ thư mục gốc

```powershell
cd mobile
npm install
npx expo start --clear
# Nhấn a để mở Android Emulator đang chạy
```

Có thể dùng npm run android. Emulator cần Expo Go tương thích SDK dự án hoặc development build phù hợp. [Hướng dẫn Android](../ANDROID_EMULATOR_GUIDE.md) có phần thiết lập AVD; phần Capacitor thuộc frontend-web, không phải Expo này.

EXPO_PUBLIC_API_URL trong mobile/.env.local phải trỏ backend. Android Emulator chuẩn truy cập host Windows qua 10.0.2.2; xem mobile/README.md để đối chiếu base URL của dự án. Sau khi sửa env, khởi động lại Metro với --clear. Không đưa Cloudinary API secret vào EXPO_PUBLIC_*; ảnh upload qua backend.

npm run web chỉ xem nhanh giao diện; camera/GPS native cần nghiệm thu Android.

## Kiểm tra trong mobile/

```powershell
npx tsc --noEmit
npx expo lint
npm test
npx expo export --platform android --output-dir ../tmp/stitch-android-export
```

Export kiểm tra bundle JS/assets, không tạo APK. Script scripts/check-stitch-ui.cjs kiểm tra UI bằng API/GPS fixture trên localhost:8081; hướng dẫn môi trường ở mục 13 của báo cáo. Kết quả fixture không chứng minh upload Cloudinary và DB thật.
