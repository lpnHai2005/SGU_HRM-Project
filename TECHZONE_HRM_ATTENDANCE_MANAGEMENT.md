# TECHZONE HRM — BÁO CÁO XÂY DỰNG ATTENDANCE API

> **Dự án:** Hệ thống quản lý nhân sự đa nền tảng TechZone  
> **Người phụ trách:** Đoàn Trung Kiên — MSSV 3123411166  
> **Phiên bản:** 4.1 — Khôi phục thẻ chấm công cho Nhân viên và căn giữa nội dung thẻ chỉ số  
> **Ngày cập nhật:** 26/09/2026

## 1. Mục tiêu và kết quả thực hiện

Hoàn thiện chu trình **Check-in → Check-out → Lưu dữ liệu → Truy xuất lịch sử**. Một nhân viên được chấm công nhiều lần trong ngày. Mỗi lượt là một bản ghi độc lập; lượt tiếp theo chỉ được mở sau khi đã check-out và đủ 60 giây.

| Hạng mục | Kết quả |
|---|---|
| Check-in | Tạo ID mới, không ghi đè lượt cũ |
| Check-out | Đóng đúng lượt đang mở; không cho đóng lại |
| Khoảng chờ | Backend kiểm tra 60 giây; trả 429 và Retry-After khi chưa đủ |
| Database | Đã bỏ unique nhân viên/ngày; thêm unique cho một lượt mở/nhân viên |
| Chống request trùng | Khóa hàng nhân viên trong giao dịch trước khi kiểm tra và ghi |
| Lịch sử | Lưu và trả từng lượt riêng, lọc theo nhân viên/tháng |
| Phân quyền | Cá nhân; quản lý cùng cửa hàng; HR/Admin toàn hệ thống |
| Ca qua đêm | Tìm lượt mở từ ngày trước; thống nhất giờ Việt Nam |
| Tổng hợp | Đếm ngày có mặt duy nhất; cộng giờ của các lượt |
| Dashboard | Đếm ngược và cho check-in lại; check-out tự tìm lượt mở |
| Kiểm thử | 13 test offline đạt, luồng API PostgreSQL đạt, TypeScript đạt |

## 2. Quy tắc nghiệp vụ

### 2.1. Vòng đời một lượt

1. Người dùng đăng nhập và có hồ sơ nhân viên hợp lệ, đã được gắn cửa hàng.
2. Chỉ được có một lượt chưa check-out tại một thời điểm, kể cả lượt từ ngày trước.
3. Check-in tạo bản ghi mới với giờ máy chủ, nhân viên, cửa hàng, ca, ngày làm việc và ghi chú.
4. Khi chưa check-out, giờ làm thực tế bằng 0; không cấp trước giờ tiêu chuẩn của ca.
5. Check-out ghi giờ ra và tính kết quả lượt. Gọi lại trên lượt đã đóng trả 409.
6. Lượt tiếp theo chỉ được mở khi `now >= check_out_time gần nhất + 60 giây`.
7. Khoảng chờ áp dụng xuyên ngày và xuyên ca; thay shift_id không bỏ qua được quy tắc.
8. Lượt cũ được giữ nguyên để tra cứu, không sửa lại bằng một lần check-in khác.

**Ví dụ:** Lượt 1 vào 08:00:00, ra 10:00:00. Check-in lúc 10:00:59 bị từ chối; lúc 10:01:00 tạo lượt 2 với ID khác.

### 2.2. Thời gian và công thức

| Nội dung | Quy ước |
|---|---|
| Múi giờ nghiệp vụ | Việt Nam UTC+07:00; cột vào/ra dùng PostgreSQL timestamptz |
| Nguồn thời gian | Máy chủ; request không nhận giờ vào/ra tùy ý từ client |
| work_date | Ngày bắt đầu ca; ca đêm vào sau 00:00 và trước giờ kết thúc thuộc ngày trước |
| Giờ thực tế | `round((check_out - check_in).total_seconds() / 3600, 2)` |
| Giờ OT của lượt | `round(max(0, actual_work_hours - shift.work_hours), 2)` |
| Phút muộn | Phút nguyên sau giờ bắt đầu ca; trên 15 phút mới phân loại LATE |
| Phút về sớm | Phút nguyên trước giờ kết thúc; ca đêm cộng một ngày vào mốc kết thúc |
| Ngày có mặt | Số work_date khác nhau có check-in, không phải công lương quy đổi theo giờ |
| Tổng giờ tháng | Tổng actual_work_hours của các lượt trong tháng |

Trạng thái kết quả gồm `NORMAL`, `LATE`, `EARLY`, `LATE_AND_EARLY`, `OVERTIME`. Hai cột thời gian xác định lượt đang mở hay đã đóng; không dùng riêng status để quyết định.

Muộn/về sớm/OT được tính theo từng lượt và ca được chọn. Attendance API không thực hiện phạt tiền, duyệt OT hoặc nhân hệ số lương. Công thức cũ ép tối thiểu 0,1 giờ, tối đa 16 giờ và nhân giờ OT với 1,5 không còn là công thức của API này.

## 3. Kiến trúc và lưu trữ

### 3.1. Thành phần mã nguồn

| Tệp | Trách nhiệm |
|---|---|
| backend/app/api/v1/endpoints/attendances.py | Endpoint, kiểm tra quyền, khóa giao dịch, đọc/ghi dữ liệu |
| backend/app/core/attendance.py | Đồng hồ nghiệp vụ, quy tắc 60 giây, tính giờ và trạng thái |
| backend/app/schemas/schemas.py | Request/response, kiểm tra ID dương |
| backend/migrations/20260926_attendance_sessions.sql | Migration nhiều lượt/ngày và index lượt mở |
| backend/migrate_attendance.py | Chạy migration PostgreSQL |
| backend/inspect_attendance_schema.py | Kiểm tra schema/index/ràng buộc, chỉ đọc |
| backend/test_attendance_sessions.py | Test quy tắc và endpoint offline |
| backend/test_attendance_postgres.py | Test HTTP ASGI với PostgreSQL, bảng tạm và rollback |
| frontend-web/src/pages/DashboardPage.tsx | Trạng thái, đếm ngược và nút chấm công |
| frontend-web/src/App.tsx | Check-out tự tìm lượt đang mở, hỗ trợ qua đêm |

### 3.2. Bảng attendances

| Trường | Ý nghĩa |
|---|---|
| attendance_id | Khóa chính từng lượt |
| employee_id, store_id, shift_id | Nhân viên, cửa hàng tại lúc vào, ca làm việc |
| work_date | Ngày nghiệp vụ dùng lọc/tổng hợp |
| check_in_time, check_out_time | Giờ vào/ra có múi giờ; giờ ra để trống khi đang làm |
| actual_work_hours, overtime_hours | Giờ thực tế và giờ vượt chuẩn |
| late_minutes, early_minutes | Phút muộn/về sớm |
| status, notes | Phân loại và ghi chú |
| created_at, updated_at | Thời điểm tạo/cập nhật |

Vị trí và thiết bị là ghi chú do client cung cấp, chưa được xác minh GPS/thiết bị.

### 3.3. Migration và giao dịch

Schema cũ có `uq_attendance: UNIQUE(employee_id, work_date)` và giới hạn status ở trạng thái bình thường/nghỉ phép. Migration đã:

- Bỏ uq_attendance để lưu nhiều lượt cùng ngày.
- Mở rộng check constraint để lưu đúng trạng thái muộn, sớm và OT.
- Tạo `uq_attendance_open_session` trên employee_id, điều kiện `check_in_time IS NOT NULL AND check_out_time IS NULL`.
- Thêm index lịch sử theo nhân viên, giờ vào và ID.
- Giữ nguyên các bản ghi hiện có, không xóa hoặc gộp lịch sử.

Cả check-in và check-out khóa hàng nhân viên bằng `SELECT ... FOR UPDATE` trước khi kiểm tra và ghi. Request cùng nhân viên được xử lý tuần tự trong giao dịch; unique index bổ sung bảo vệ ở database. Thành công mới commit; lỗi được dependency database rollback.

**Migration đã áp dụng thành công trên database cấu hình trong môi trường thực hiện ngày 26/09/2026.** Khi triển khai database khác phải chạy migration trước. Nếu dữ liệu cũ có nhiều lượt mở, tạo index thất bại và migration rollback để quản trị viên đối soát, không tự xóa dữ liệu.

## 4. Danh mục API

**Base URL:** `http://localhost:8000/api/v1`  
**Swagger:** `http://localhost:8000/docs`  
**Xác thực:** `Authorization: Bearer <access_token>`  
**Body:** JSON, `Content-Type: application/json`.

| Method | Endpoint | Chức năng và quyền |
|---|---|---|
| GET | /attendances/shifts | Danh mục ca; hiện không yêu cầu token |
| POST | /attendances/check-in | Cá nhân; quản lý cùng cửa hàng hoặc HR/Admin có thể chỉ định nhân viên |
| POST | /attendances/check-out | Cá nhân; chỉ định lượt người khác phải có quyền quản lý tương ứng |
| GET | /attendances/today-status | Trạng thái cá nhân hoặc nhân viên được phép quản lý |
| GET | /attendances/my-history | Chỉ lịch sử nhân viên gắn với tài khoản hiện tại |
| GET | /attendances/my-summary | Tổng hợp cá nhân hoặc nhân viên được phép quản lý |
| GET | /attendances | Store Manager giới hạn cửa hàng; HR/Admin toàn hệ thống |

GET/POST `/attendances/shift-schedules` là chức năng phân ca liên quan đã có; không thuộc luồng tạo/đóng lượt được kiểm thử trong báo cáo này.

### 4.1. Check-in

`POST /attendances/check-in`

```json
{
  "shift_id": 1,
  "notes": "Bắt đầu lượt làm việc",
  "device_info": "Web browser",
  "location": "Cửa hàng Quận 1"
}
```

- shift_id: số nguyên dương, mặc định 1; lấy ID hợp lệ từ /shifts.
- employee_id: tùy chọn; mặc định chính mình. Chỉ định người khác phải đúng phạm vi quản lý.
- notes, device_info, location: tùy chọn.

Phản hồi **201 Created**, ví dụ minh họa:

```json
{
  "message": "Check-in thành công.",
  "attendance_id": 101,
  "employee_name": "Nguyễn Văn A",
  "time": "08:00:00",
  "check_in_time": "2026-09-26T08:00:00+07:00",
  "work_date": "2026-09-26",
  "status": "NORMAL",
  "late_minutes": 0,
  "shift_name": "Ca sáng"
}
```

### 4.2. Check-out

`POST /attendances/check-out`

```json
{"attendance_id":101,"notes":"Kết thúc lượt làm việc","location":"Cửa hàng Quận 1"}
```

Có thể gửi `{}` để tự tìm lượt đang mở của chính mình, kể cả từ ngày trước. attendance_id nếu truyền phải là số nguyên dương. Phản hồi **200 OK**, ví dụ ca chuẩn 08:00–16:00:

```json
{
  "message": "Check-out thành công.",
  "attendance_id": 101,
  "check_out_time": "2026-09-26T10:00:00+07:00",
  "next_check_in_at": "2026-09-26T10:01:00+07:00",
  "actual_work_hours": 2.0,
  "overtime_hours": 0.0,
  "early_minutes": 360,
  "status": "EARLY"
}
```

### 4.3. Trạng thái và khoảng chờ

`GET /attendances/today-status` hoặc thêm `?employee_id=3` theo quyền.

Trả lượt hôm nay, ưu tiên lượt đang mở kể cả từ ngày trước, kèm:

| Trường | Ý nghĩa |
|---|---|
| has_checked_in, has_checked_out | Trạng thái bản ghi trả về; không dùng riêng để quyết định mở lượt mới |
| can_check_in | Có thể mở lượt tại thời điểm phản hồi |
| can_check_out | Có lượt đang mở |
| cooldown_seconds_remaining | Giây còn chờ, làm tròn lên |
| next_check_in_at | Mốc check-out trước + 60 giây; có thể đã qua |

Dashboard tải trạng thái lúc mở, làm mới mỗi 15 giây và đếm ngược mỗi giây. Backend vẫn kiểm tra lại từng request để xử lý nhiều tab/thiết bị.

### 4.4. Lịch sử cá nhân

`GET /attendances/my-history?period=2026-09`

Không truyền period: toàn bộ lịch sử cá nhân. Có period: định dạng YYYY-MM với tháng 01–12, sai trả 422. Kết quả là mảng từng lượt, gồm ID, nhân viên, cửa hàng, ca, ngày, giờ vào/ra, giờ công, trạng thái, ghi chú. Sắp xếp `work_date DESC, attendance_id DESC`; hai lượt cùng ngày vẫn là hai phần tử. Hiện chưa phân trang.

### 4.5. Tra cứu quản lý

`GET /attendances?period=2026-09&store_id=1&employee_id=3&status=LATE`

Bộ lọc tùy chọn: work_date (YYYY-MM-DD), period, store_id, employee_id, status. Nếu có cả ngày và tháng thì ưu tiên work_date. Store Manager luôn giới hạn cửa hàng tài khoản; đổi store_id không mở rộng quyền. Nhân viên thông thường gọi endpoint này nhận 403.

### 4.6. Tổng hợp tháng

`GET /attendances/my-summary?period=2026-09`

Mặc định tháng hiện tại theo giờ Việt Nam; có thể thêm employee_id theo quyền. Trả working_days, leave_quota, late_arrivals, early_departures, extra_work, business_trips, overtime, compensatory_leave và thông tin tháng/nhân viên.

Ngày có mặt và tổng giờ đã điều chỉnh cho nhiều lượt/ngày. Các thẻ công tác/nghỉ bù, duyệt/phạt/lương là nghiệp vụ khác; kết quả test Attendance không xác nhận hoàn thiện các phân hệ đó.

### 4.7. Mã lỗi

| HTTP | Tình huống |
|---|---|
| 400 | Chưa liên kết hồ sơ hoặc nhân viên chưa có cửa hàng |
| 401 | Thiếu/sai/hết hạn token |
| 403 | Không có quyền với nhân viên/lượt hoặc danh sách quản lý |
| 404 | Nhân viên/ca/lượt không tồn tại hoặc không có lượt mở |
| 409 | Còn lượt mở; lượt đã đóng/chưa vào; giờ ra trước giờ vào |
| 422 | ID không dương, ngày/tháng hoặc JSON không hợp lệ |
| 429 | Chưa đủ 60 giây; Retry-After chứa số giây còn lại |

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 1
Content-Type: application/json

{"detail":"Vui lòng chờ 1 giây trước khi check-in lại."}
```

## 5. Hướng dẫn triển khai và gọi API

### 5.1. Khởi chạy

Cấu hình database trong backend/.env theo backend/.env.example. Với môi trường đã có backend/venv và dependency, chạy tại thư mục gốc:

```powershell
.\backend\venv\Scripts\python.exe backend\migrate_attendance.py
.\backend\venv\Scripts\python.exe backend\run.py
```

Migration đã chạy trên môi trường hiện tại. Không tái tạo unique nhân viên/ngày sau khi có nhiều lượt.

### 5.2. Ví dụ PowerShell

```powershell
$baseUrl = 'http://localhost:8000/api/v1'
$loginBody = @{ username = '<username>'; password = '<password>' } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$baseUrl/auth/login" `
  -ContentType 'application/json' -Body $loginBody
$headers = @{ Authorization = "Bearer $($login.access_token)" }

# Lấy ca hợp lệ và mở lượt
Invoke-RestMethod -Uri "$baseUrl/attendances/shifts"
$entry = Invoke-RestMethod -Method Post -Uri "$baseUrl/attendances/check-in" `
  -Headers $headers -ContentType 'application/json' -Body '{"shift_id":1}'

# Đóng lượt vừa tạo
$body = @{ attendance_id = $entry.attendance_id } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$baseUrl/attendances/check-out" `
  -Headers $headers -ContentType 'application/json' -Body $body

# Kiểm tra khoảng chờ, đợi đủ 60 giây rồi mở lượt mới
Invoke-RestMethod -Uri "$baseUrl/attendances/today-status" -Headers $headers
Start-Sleep -Seconds 60
Invoke-RestMethod -Method Post -Uri "$baseUrl/attendances/check-in" `
  -Headers $headers -ContentType 'application/json' -Body '{"shift_id":1}'

# Lịch sử và tổng hợp (đổi tháng theo ngày thực hiện)
Invoke-RestMethod -Uri "$baseUrl/attendances/my-history?period=2026-09" -Headers $headers
Invoke-RestMethod -Uri "$baseUrl/attendances/my-summary?period=2026-09" -Headers $headers
```

Các lệnh trên tạo dữ liệu thật của tài khoản đăng nhập. Nếu chỉ kiểm thử kỹ thuật, dùng bộ test bảng tạm ở mục 6.

## 6. Kiểm thử và bằng chứng

### 6.1. Offline

```powershell
cd backend
.\venv\Scripts\python.exe -m unittest test_attendance_sessions -v
```

**Thực chạy: 13/13 test đạt.** Bao phủ mốc 0/59/59,9/60/61 giây và Retry-After; lượt đầu; lượt mở từ ngày trước; ca đêm/múi giờ; lượt rất ngắn; INSERT lượt mới và khóa hàng; phân quyền nhân viên/quản lý khác cửa hàng; ID/tháng sai; đóng lại lượt; trạng thái lưu khớp phản hồi; lịch sử lọc đúng nhân viên.

### 6.2. PostgreSQL và HTTP ASGI

```powershell
# Tại thư mục gốc, cần database đã migration
.\backend\venv\Scripts\python.exe backend\test_attendance_postgres.py
```

**Thực chạy: PASS.** Test sao chép cấu trúc/index bảng thật sang bảng tạm, gọi API và xác nhận:

1. Check-in thành công; check-in khi còn lượt mở trả 409.
2. Check-out lưu 2 giờ; đóng lại trả 409.
3. Giây 59 trả 429 và Retry-After: 1; trạng thái còn chờ 1 giây.
4. Giây 60 trả 201 và ID mới.
5. Lịch sử có hai lượt; lượt đầu giữ 2 giờ công.
6. Tổng hợp một ngày có mặt, tổng 2 giờ; lượt đang mở không cộng giờ trước.
7. Trạng thái cho phép check-out và chặn check-in khi lượt thứ hai mở.

Bảng tạm/dữ liệu thử được rollback; không chèn/sửa/xóa các hàng chấm công thật. Đây là kiểm thử vòng đời và SQL/schema, chưa phải kiểm thử tải request đồng thời.

### 6.3. Frontend

```powershell
cd frontend-web
npx tsc --noEmit
```

**Thực chạy: PASS, không lỗi TypeScript.** Chưa kiểm thử tương tác trình duyệt tự động trong lần cập nhật này.

## 7. Giao diện và chức năng liên quan được giữ lại

- Điều hướng **Bảng Công** dành cho tra cứu/thống kê; nút chấm công nằm ở Dashboard.
- Bảng Công giữ tám thẻ chỉ số và bảng nhật ký cá nhân/quản lý.
- Các thay đổi nhân viên có trước bản 4.0 được giữ: bộ lọc chức vụ, menu theo vai trò, modal sửa ca cho Store Manager cùng cửa hàng, preset ca sáng/chiều/tối và tính giờ.
- Việc lưu phân ca từ modal, khóa bảng công, khiếu nại công, heatmap và cảnh báo nội bộ không được gộp vào kết quả hoàn thành Attendance API của báo cáo này.

## 8. Tiêu chí nghiệm thu

| Tiêu chí | Bằng chứng |
|---|---|
| Nhiều lượt/ngày | Test PostgreSQL trả hai ID và hai bản ghi cùng ngày |
| Đóng lượt trước khi mở mới | HTTP 409 khi còn lượt mở |
| Chờ đủ 60 giây | 429 tại giây 59, 201 tại giây 60 |
| Giữ lịch sử | Lượt trước giữ giờ vào/ra và giờ công |
| Lưu/truy xuất đầy đủ | Test API, lịch sử, tổng hợp trên PostgreSQL đạt |
| Không vượt quyền | Test cá nhân và quản lý khác cửa hàng trả 403 |
| Giao diện hỗ trợ chấm lại | Đã cập nhật trạng thái/đếm ngược; TypeScript đạt |

**Trạng thái bàn giao:** Đã hoàn thiện mã nguồn Attendance API theo quy tắc nhiều lượt/ngày và chờ 60 giây, áp dụng migration, kiểm thử backend/database, tích hợp Dashboard và cập nhật hướng dẫn. Giới hạn kiểm thử và phạm vi chức năng liên quan được ghi tại mục 6–7.

## 9. Cập nhật giao diện và kế hoạch cải tiến — phiên bản 4.1

### 9.1. Những việc đã thực hiện

| Hạng mục | Thay đổi và kết quả mong đợi |
|---|---|
| Quyền xem thẻ “Điểm danh & Ca làm việc hôm nay” | Nhân viên xem các lượt của chính mình từ `/attendances/my-history`; không gọi API danh sách quản lý vốn trả 403 cho vai trò này |
| Phạm vi quản lý | Store Manager, HR và Admin tiếp tục lấy dữ liệu qua `/attendances`, theo phạm vi backend cho phép |
| Ngày hiển thị | Lọc ngày/tháng của dữ liệu Dashboard theo múi giờ Asia/Ho_Chi_Minh, tránh lệch ngày khi dùng UTC |
| Nhãn bảng chấm công | Hiển thị số **lượt chấm công** và phạm vi cá nhân/quản lý, tránh nhầm số lượt với số người |
| Trạng thái lượt đã đóng | Hiển thị “Đã check-out”, không tiếp tục ghi “Đang làm việc” |
| Căn giữa `.timesheet-metric-card` | Chia thẻ thành ba hàng: nhãn, vùng biểu diễn, chân thẻ; vùng biểu diễn tối thiểu 120px và căn giữa cả hai chiều |
| Icon trong nhóm hai cột | Hai cột có cùng độ rộng; icon lịch/đồng hồ nằm giữa từng cột, không lệch theo độ dài chữ hoặc giá trị |
| Nhãn và vòng chỉ số | Nhãn căn giữa nội dung; vòng tròn và chỉ số lớn cùng nằm giữa vùng biểu diễn, tạo bố cục đồng đều giữa tám thẻ |

**Phạm vi quyền xem:** mở lại trải nghiệm xem dữ liệu cá nhân của Nhân viên trong thẻ, không cấp quyền đọc lịch sử nhân viên khác. Không thay đổi quyền API backend.

**Kiểm tra thực hiện:** `npm run build` tại `frontend-web` thành công (TypeScript và Vite). Build có cảnh báo module API vừa được import tĩnh vừa import động; không gây lỗi build. Chưa kiểm tra trực quan bằng trình duyệt trong lần cập nhật 4.1.

### 9.2. Danh sách việc cần làm tiếp theo

Các mục dưới đây là **đề xuất chưa triển khai trong bản 4.1**, sắp theo mức ưu tiên.

| Ưu tiên | Việc cần cải tiến | Tiêu chí hoàn thành |
|---|---|---|
| P1 | Tách lỗi tải dữ liệu khỏi trạng thái không có bản ghi | Lỗi mạng/401/403 hiện thông báo đúng và nút thử lại; không bị biến thành bảng trống bởi `catch(() => [])` |
| P1 | Rà toàn bộ chỉ số Dashboard theo nhiều lượt/ngày | Số nhân viên có mặt dùng employee_id duy nhất; số lượt và tổng giờ được ghi nhãn riêng |
| P1 | Kiểm thử giao diện theo vai trò | Nhân viên thấy đúng lượt cá nhân, quản lý thấy đúng phạm vi; kiểm tra cả không có lượt, nhiều lượt và lượt đã đóng |
| P1 | Kiểm tra trực quan các thẻ chỉ số | Ở màn hình 375px, 768px và 1440px: icon cân giữa, nhãn dài không tràn, các chân thẻ thẳng hàng; kiểm tra sáng/tối |
| P2 | Hoàn thiện hiển thị ca qua đêm trên bảng hôm nay | Có cách nhận biết lượt đang mở từ ngày trước và ngày nghiệp vụ của lượt đó, thống nhất với thẻ thao tác |
| P2 | Làm mới bảng sau thao tác chấm công | Cập nhật bảng, tổng hợp và trạng thái ngay khi check-in/check-out thành công, không cần tải lại toàn trang |
| P2 | Bổ sung phân trang lịch sử | API và giao diện có limit/offset hoặc cursor; lịch sử dài vẫn tải nhanh và không bỏ sót lượt |
| P2 | Chuẩn hóa thông báo nghiệp vụ trên thẻ | Nhãn phạt, duyệt OT và nghỉ bù chỉ khẳng định những quy tắc đã có xử lý backend |
| P3 | Thống nhất cách import API | Loại bỏ cảnh báo import tĩnh/động trùng module; build vẫn thành công |

### 9.3. Cách nghiệm thu giao diện

1. Đăng nhập bằng tài khoản **Nhân viên** có lượt chấm công hôm nay; mở Dashboard và kiểm tra thẻ hiển thị tất cả lượt cá nhân trong ngày.
2. Đăng nhập quản lý; kiểm tra thẻ vẫn hiển thị dữ liệu trong phạm vi cửa hàng/quyền quản lý.
3. Với lượt đã check-out, kiểm tra nhãn “Đã check-out” và giờ ra được hiển thị.
4. Mở **Bảng Công**; kiểm tra vòng tròn chỉ số và các nhóm icon nằm giữa vùng nội dung của tám thẻ.
5. Thay đổi kích thước màn hình và dùng dữ liệu có nhiều chữ số để kiểm tra độ cân đối, không tràn nhãn.

Danh sách này là hướng dẫn nghiệm thu thủ công; không thay thế bằng chứng kiểm thử trình duyệt đã chạy.

## 10. Khung tóm tắt các file trước khi commit

> **PHẠM VI THAY ĐỔI — 21 FILE: 8 TẠO MỚI, 13 CHỈNH SỬA**
>
> Tổng hợp theo `git status`, bao gồm cả các thay đổi đã có trước phiên làm việc này. Đường dẫn tính từ thư mục gốc dự án.
>
> **8 file tạo mới**
>
> | File | Mục đích |
> |---|---|
> | `TECHZONE_HRM_ATTENDANCE_MANAGEMENT.md` | Báo cáo nghiệp vụ, hướng dẫn API, kết quả kiểm thử và kế hoạch cải tiến. |
> | `backend/app/core/attendance.py` | Quy tắc chờ 60 giây, múi giờ và tính kết quả từng lượt. |
> | `backend/migrations/20260926_attendance_sessions.sql` | Cho phép nhiều lượt/ngày, giới hạn một lượt mở và bổ sung trạng thái. |
> | `backend/migrate_attendance.py` | Chạy migration chấm công trên PostgreSQL. |
> | `backend/inspect_attendance_schema.py` | Đọc cấu trúc bảng, index và ràng buộc để kiểm tra schema. |
> | `backend/test_attendance_sessions.py` | Kiểm thử offline quy tắc thời gian, endpoint và phân quyền. |
> | `backend/test_attendance_postgres.py` | Kiểm thử luồng API với bảng PostgreSQL tạm, rollback sau khi chạy. |
> | `frontend-web/src/pages/AttendancePage.css` | Định dạng Bảng Công, bố cục responsive và căn giữa icon/chỉ số. |
>
> **13 file chỉnh sửa**
>
> | File | Nội dung thay đổi |
> |---|---|
> | `HRM-Project-Workflow.md` | Cập nhật checklist tiến độ các chức năng chấm công và giao diện. |
> | `backend/app/api/v1/endpoints/attendances.py` | Hoàn thiện check-in/out nhiều lượt, lịch sử, tổng hợp, trạng thái và quyền truy cập. |
> | `backend/app/schemas/schemas.py` | Bổ sung schema ca, tổng hợp, trạng thái/khoảng chờ; kiểm tra ID dương. |
> | `backend/app/schemas/__init__.py` | Xuất các schema bổ sung để sử dụng trong backend. |
> | `frontend-web/src/App.tsx` | Check-out để backend tự tìm lượt đang mở, kể cả qua đêm. |
> | `frontend-web/src/components/layout/BottomNav.tsx` | Đổi nhãn điều hướng thành “Bảng Công”. |
> | `frontend-web/src/components/layout/Topbar.tsx` | Đồng bộ tiêu đề trang “Bảng Công”. |
> | `frontend-web/src/constants/navigation.ts` | Đồng bộ tên mục Bảng Công cho các vai trò. |
> | `frontend-web/src/pages/AttendancePage.tsx` | Giao diện tám thẻ chỉ số, bộ lọc, bảng cá nhân/quản lý và xuất CSV. |
> | `frontend-web/src/pages/DashboardPage.tsx` | Đếm ngược chấm lại, khôi phục dữ liệu cá nhân cho Nhân viên, sửa nhãn lượt và trạng thái. |
> | `frontend-web/src/pages/EmployeeListPage.tsx` | Bổ sung bộ lọc chức vụ, modal sửa ca và điều kiện hiển thị theo vai trò/cửa hàng. |
> | `frontend-web/src/services/api.ts` | Bổ sung hàm gọi API ca, trạng thái, tổng hợp và bộ lọc chấm công. |
> | `frontend-web/src/types/index.ts` | Đồng bộ kiểu dữ liệu frontend cho ca, tổng hợp, check-out và khoảng chờ. |
>
> **Kiểm tra đã chạy:** 13 test offline đạt; luồng API PostgreSQL đạt; build frontend thành công. Chưa kiểm thử trực quan trình duyệt.
>
> **Lưu ý rà soát:** Checklist trong `HRM-Project-Workflow.md` có thay đổi từ trước; các mục mobile/phê duyệt cần đối chiếu riêng, không được xem là đã nghiệm thu bởi bộ test Attendance. Modal sửa ca mới được mô tả ở phạm vi giao diện, không khẳng định đã hoàn thiện lưu phân ca.
