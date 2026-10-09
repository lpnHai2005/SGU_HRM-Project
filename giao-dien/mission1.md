# TECHZONE HRM — BÁO CÁO NGHIỆM THU NHIỆM VỤ 1

> **Người thực hiện:** Đoàn Trung Kiên — MSSV 3123411166  
> **Phân hệ:** MOD-04 — Attendance / liên kết Work Schedule  
> **Ngày cập nhật:** 02/10/2026  
> **Tiến độ Nhiệm vụ 1:** **100% phạm vi Attendance API**, không bao gồm nghiệm thu GPS/selfie trên thiết bị của Nhiệm vụ 2.  
> **Kết quả:** Hoàn thành phạm vi Nhiệm vụ 1 và năm trường hợp biên liên kết lịch phân ca. Không đồng nghĩa toàn bộ Nhiệm vụ 5 hoặc Payroll đã được nghiệm thu.

## 1. Kết quả bàn giao

| Hạng mục | Kết quả |
|---|---|
| Attendance API | Check-in/out, trạng thái, lịch sử cá nhân, tra cứu quản lý và tổng hợp tháng |
| Nhiều lượt/ngày | Mỗi lượt có ID riêng, giữ nguyên lịch sử; chỉ một lượt mở |
| Giao dịch | Khóa hàng nhân viên, partial unique index, chờ 60 giây sau check-out |
| Ca và thời gian | Giờ máy chủ UTC+07, hỗ trợ qua đêm; ân hạn theo giờ bắt đầu từng ca |
| Đối chiếu phân ca | Lưu MATCHED / UNSCHEDULED / SHIFT_MISMATCH độc lập với kết quả giờ công |
| Bảo toàn dữ liệu | Lưu bản chụp lịch/ca lúc check-in; sửa lịch sau đó không tính lại lượt cũ |
| Kiểm thử lần này | 19/19 test Attendance offline đạt; tổng 31 test khi gồm addon mobile; PostgreSQL integration đạt |

## 2. Quy tắc nghiệp vụ đã chốt

**Bổ sung ngày 02/10/2026:** check-out phải cách check-in ít nhất 60 giây, ngoài quy tắc chờ 60 giây sau check-out trước lượt mới. Backend trả 429 kèm `Retry-After` khi quá sớm và không ghi giờ ra. `can_check_out` biểu thị có lượt mở; mobile phải xét thêm `checkout_seconds_remaining`. Giờ máy chủ quyết định, không dựa đồng hồ đếm ngược của app.

### 2.1. Không có lịch hoặc check-in sai ca

**Cho phép ghi nhận thực tế, đồng thời đánh dấu bất thường.** Không âm thầm coi nhân viên là đã được phân ca.

| Đối chiếu work_schedules theo employee_id và work_date | schedule_status |
|---|---|
| Không có lịch | UNSCHEDULED |
| Ca và cửa hàng trùng lịch | MATCHED |
| Ca hoặc cửa hàng khác lịch | SHIFT_MISMATCH |
| Bản ghi cũ chưa có bản chụp | LEGACY_UNKNOWN |

Ca thực tế lấy từ `shift_id` trong request; giữ mặc định ID 1 để tương thích client cũ. Client nên gửi ca được chọn rõ ràng. Mặc định này không thay thế lịch phân công: không tìm thấy lịch thì vẫn UNSCHEDULED. Ca không tồn tại trả 404; không có cửa hàng trả 400.

Đối chiếu dùng ngày nghiệp vụ của ca thực tế, bao gồm quy tắc ca qua đêm hiện có. `schedule_status` không đưa vào cột `status`, tránh mất thông tin vừa không có lịch vừa đi muộn/OT.

### 2.2. Ân hạn theo từng ca

- Ca sáng 08:00: đúng 08:15 chưa muộn; sau 08:15 là LATE.
- Ca chiều 13:00: đúng 13:15 chưa muộn; sau 13:15 là LATE.
- Ca hành chính 08:00: áp dụng cùng mốc 08:15.
- Công thức chung: thời điểm vào **lớn hơn giờ bắt đầu ca + 15 phút**, không có mốc 08:15 chung cho mọi ca.
- `late_minutes = max(0, ceil(số giây trễ / 60))`. Vì vậy 13:15:01 lưu 16 phút, không bị lọt qua ân hạn do làm tròn xuống.

Giờ bắt đầu/kết thúc và giờ chuẩn dùng bản chụp ca tại check-in. Không gắn cứng các giờ chuẩn 7/8/11 giờ trong thuật toán; lấy từ danh mục ca hiện hành.

### 2.3. Trạng thái kết hợp và hợp đồng dữ liệu với Payroll

Các trường số `late_minutes`, `early_minutes`, `actual_work_hours`, `overtime_hours` là dữ liệu nghiệp vụ chính. `status` chỉ là nhãn tóm tắt, ưu tiên:

`LATE_AND_EARLY → LATE → EARLY → OVERTIME → NORMAL`.

Ví dụ: vào 09:00 thay vì 08:00, làm tới 18:00, chuẩn 8 giờ: lưu 60 phút muộn, 9 giờ thực tế và 1 giờ OT; status là LATE. OT không bị xóa hoặc ghi đè bởi nhãn LATE.

**Quy tắc tích hợp:** Payroll phải tính từ các trường số, không chỉ lọc `status = 'NORMAL'` hoặc `status = 'OVERTIME'`. Việc duyệt OT, khấu trừ, hệ số lương và xử lý lượt bất thường thuộc nghiệp vụ Payroll/đối soát. Lần cập nhật này chưa nghiệm thu lại các stored procedure tính lương; không khẳng định toàn bộ Payroll đã tuân thủ chỉ từ test Attendance.

### 2.4. Thiết bị và vị trí

API **ghi nhận thông tin thiết bị/vị trí do client gửi** trong ghi chú. Chưa xác minh GPS, chưa chứng minh có mặt tại cửa hàng và chưa chống giả mạo thiết bị. Báo cáo/bảo vệ sử dụng đúng cụm “ghi nhận thông tin”, không gọi đây là “xác thực GPS”.

### 2.5. Lịch bị sửa sau khi chấm công

Cột JSONB `attendance_context` lưu:

- `version`: phiên bản cấu trúc bản chụp.
- `schedule_status`: kết quả đối chiếu lúc check-in.
- `planned`: schedule_id, shift_id, store_id được phân; null nếu không có lịch.
- `actual`: shift_id, start_time, end_time, work_hours thực tế dùng tính lượt.

Check-out sử dụng giờ trong bản chụp thay vì định nghĩa ca mới. Lịch sử/trạng thái trả bản chụp cùng nhãn đối chiếu; sửa work_schedules hoặc work_shifts không sửa bản chụp cũ. API phân ca khóa cùng hàng nhân viên để việc sửa lịch và check-in có thứ tự giao dịch rõ ràng.

Bản ghi trước migration giữ null và nhãn LEGACY_UNKNOWN; không suy diễn lịch quá khứ từ lịch hiện tại. Với các lượt cũ chưa có bản chụp, check-out vẫn dùng định nghĩa ca hiện tại để tương thích; cần đối soát thủ công nếu định nghĩa ca đã thay đổi.

## 3. Kiểm thử thực chạy ngày 01/10/2026

### Offline: 19/19 PASS (cập nhật 02/10/2026)

Bao gồm 18 test trước đó và test checkout tại 0, 59, 59.9, 60, 61 giây. Trước mốc 60 trả 429, không commit cập nhật giờ ra. Tổng khi chạy kèm addon mobile là 31/31 PASS.

```powershell
cd backend
.\venv\Scripts\python.exe -m unittest test_attendance_sessions -v
```

Giữ 13 test cũ và bổ sung đúng 5 test:

| Test | Kết quả xác nhận |
|---|---|
| Không có schedule | Check-in 201, lưu UNSCHEDULED, planned null |
| Sai ca được phân | Check-in 201, SHIFT_MISMATCH, giữ cả ID ca phân và ca thực tế |
| Ca chiều, grace 15 phút | 13:14:59 và 13:15:00 bình thường; 13:15:01 và 13:16:00 muộn |
| Vừa muộn vừa OT | Status LATE, vẫn lưu OT 1 giờ; không sửa mất late_minutes |
| Lịch/ca thay đổi sau check-in | Check-out dùng bản chụp cũ, không tính theo giờ chuẩn mới |

### PostgreSQL integration: PASS

```powershell
.\backend\venv\Scripts\python.exe backend\test_attendance_postgres.py
```

Dùng bảng tạm cho attendances, work_schedules và work_shifts. Kiểm tra vòng đời, mốc 59/60 giây, lịch sử nhiều lượt, tổng hợp một ngày và nhãn UNSCHEDULED/SHIFT_MISMATCH. Sau khi thay lịch phân công và giờ kết thúc/giờ chuẩn trong bảng tạm, check-out và lịch sử vẫn giữ kết quả bản chụp. Tất cả dữ liệu thử rollback; không sửa hàng chấm công/lịch/ca thật.

**Giới hạn bằng chứng:** Test kiểm tra cơ chế khóa được gọi và unique index trong schema; chưa phải bài stress test nhiều request đồng thời. Không mô tả 13 test cũ là đã chứng minh toàn bộ race condition dưới tải.

## 4. Migration và hướng dẫn triển khai

Migration mới đã áp dụng thành công trong môi trường hiện tại, bổ sung một cột JSONB, không cập nhật hồi tố các bản ghi cũ.

```powershell
.\backend\venv\Scripts\python.exe backend\migrate_attendance.py --migration 20261001_attendance_schedule_snapshot.sql
```

Môi trường mới cần migration nền `20260926_attendance_sessions.sql` trước. Áp dụng migration snapshot trước khi chạy phiên bản API mới. Hướng dẫn API đầy đủ nằm trong `TECHZONE_HRM_ATTENDANCE_MANAGEMENT.md`, mục 11 bổ sung hợp đồng đối chiếu lịch.

> **TÓM TẮT FILE CỦA LẦN CHỐT QUY TẮC**
>
> | File | Thay đổi |
> |---|---|
> | backend/app/core/attendance.py | Tính muộn chính xác ở biên 15 phút và sử dụng bản chụp ca |
> | backend/app/api/v1/endpoints/attendances.py | Đối chiếu lịch, lưu/trả bản chụp và khóa khi sửa phân ca |
> | backend/app/schemas/schemas.py | Thêm schedule_status, attendance_context vào response |
> | backend/migrations/20261001_attendance_schedule_snapshot.sql | Tạo mới migration cột JSONB |
> | backend/migrate_attendance.py | Cho phép chọn migration theo tên |
> | backend/test_attendance_sessions.py | 5 test liên kết lịch và test checkout tối thiểu 60 giây, tổng 19 test |
> | backend/test_attendance_postgres.py | Kiểm chứng thay đổi lịch/ca bằng bảng tạm |
> | mission.md và TECHZONE_HRM_ATTENDANCE_MANAGEMENT.md | Chốt quy tắc, bằng chứng và giới hạn nghiệm thu |

## 5. Phạm vi đóng module

Nhiệm vụ 1 (Attendance API, check-in, check-out, lưu/truy xuất lịch sử) đã đạt các tiêu chí được kiểm thử nêu trên, bao gồm năm trường hợp bổ sung. Dữ liệu đã sẵn sàng làm đầu vào đối chiếu cho Nhiệm vụ 5.

Các bước còn thuộc giai đoạn tích hợp: giao diện lọc/duyệt bất thường, quy trình điều chỉnh lịch sử có audit, kiểm thử tải đồng thời và xác minh tính lương thực tế từ trường số. Không dùng kết quả Attendance để tự đánh dấu các bước này hoàn thành.
