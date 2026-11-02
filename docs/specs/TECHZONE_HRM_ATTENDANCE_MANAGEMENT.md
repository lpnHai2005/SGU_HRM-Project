# TECHZONE HRM — BUSINESS RULES & INTEGRATION CONTRACT

> **Dự án:** Hệ thống quản lý nhân sự đa nền tảng TechZone  
> **Người phụ trách:** Đoàn Trung Kiên — MSSV 3123411166  
> **Phiên bản:** 5.0 — Quy tắc nguồn cho Work Schedule → Attendance → Sales → Payroll → Mobile
> **Ngày cập nhật:** 01/10/2026

## SOURCE OF TRUTH

Tài liệu này là hợp đồng nghiệp vụ chuẩn cho các thay đổi thuộc chuỗi Work Schedule, Attendance/Reconciliation, Sales/Commission, Payroll/Payslip và client Web/Mobile. Quy tắc trong phần 1–15 là **normative**; Appendix B chỉ lưu bối cảnh lịch sử, không được dùng để ghi đè quy tắc mới.

**Chỉ dẫn cho AI và người triển khai:**

- Đọc contract này trước khi thiết kế schema, API, stored procedure hoặc giao diện liên quan.
- Không suy diễn rằng một quy tắc đã được triển khai chỉ vì quy tắc có trong tài liệu. Chỉ đánh dấu VERIFIED khi mã nguồn và test tương ứng chứng minh được.
- Nếu code/schema hiện tại trái contract, nêu rõ GAP và đề xuất migration/test; không âm thầm đổi nghiệp vụ, không tuyên bố đã hoàn thành.
- Nếu hai tài liệu có quy tắc tiền lương/phê duyệt mâu thuẫn hoặc thiếu quyết định, dừng tại ranh giới đó và yêu cầu chủ nghiệp vụ chốt; không tự chọn công thức.
- Không để client tự quyết định dữ liệu chuẩn, quyền hạn, thời điểm nghiệp vụ hay số tiền lương/hoa hồng.

### Baseline triển khai và GAP đã xác nhận

Đối chiếu code trong workspace ngày 01/10/2026 cho thấy các mục dưới đây **chưa đáp ứng contract**, dù rule chuẩn ở trên đã được chốt:

| Phạm vi | Baseline hiện có | GAP cần xử lý trước nghiệm thu |
|---|---|---|
| Attendance | 18/18 rule/unit tests và PostgreSQL integration được báo cáo PASS tại `mission.md` | Chưa chứng minh stress test đồng thời hoặc hoàn thành mọi luồng reconciliation/approval |
| Work Schedule — cập nhật 10/10/2026 | Đã migrate nhiều assignment/ngày, service chống overlap có khóa nhân viên; API CRUD/batch/filter/audit/reconciliation và tích hợp snapshot | API/PostgreSQL/concurrency regression đã đạt; nghiệm thu thao tác quản lý và mobile còn chờ, xem [mission3.md](mission3.md) |
| Check-in client | Request còn tương thích mặc định `shift_id=1` | Loại bỏ fallback trước khi phát hành Mobile theo contract mới |
| Sales | API hiện ghi `employee_sales` tổng theo nhân viên/kỳ và upsert theo employee + period | Chưa phải transaction-level `sales_records`; chưa đủ lifecycle refund/void để đối soát từng giao dịch |
| Commission | Có stored procedure tính kỳ | Cần xác minh idempotency, source key, status eligibility và period lock bằng test chuyên biệt |
| Payroll | Luồng calculate hiện xóa payroll/details của kỳ rồi sinh lại; state hiện dùng DRAFT/CONFIRMED/PAID | Trái yêu cầu snapshot bất biến; cần state/version/adjustment flow trước khi coi Payroll contract hoàn tất |
| Mobile Payslip | Có giao diện/route liên quan được mô tả trong tài liệu dự án | Chưa có bằng chứng Mobile end-to-end chứng minh không tính tiền phía client và chỉ hiển thị snapshot |

Không dùng bảng này để kết luận các GAP đã được sửa. Cập nhật trạng thái chỉ sau khi code, migration và test của chính slice đó đạt.

### 1. Phạm vi và nguồn dữ liệu chuẩn

| Dữ liệu | Vai trò chuẩn | Quyền sở hữu nghiệp vụ |
|---|---|---|
| `work_schedules` | Kế hoạch nhân viên được phân làm | Work Schedule; thay đổi có kiểm soát và audit |
| `attendances` | Các lượt làm việc thực tế đã ghi nhận | Attendance; check-in/out dùng giờ server |
| `sales_records` | Giao dịch doanh số thực tế theo dòng giao dịch | Sales; có mã tham chiếu và vòng đời trạng thái |
| `commissions` | Kết quả tính toán từ sales đủ điều kiện | Commission stored procedure; không tính lại trong Payroll/client |
| `payrolls` và `payroll_details` | Kết quả lương và giải trình đã tính theo kỳ | Payroll; bản chụp được khóa khi xác nhận |
| Web/Mobile | Gửi yêu cầu, hiển thị dữ liệu API đã phân quyền | Không phải nguồn tính nghiệp vụ hoặc nguồn sự thật |

Không đồng nhất `work_schedules` với `attendances`: lịch là kế hoạch, chấm công là sự kiện thực tế. Không đồng nhất doanh số nhập tổng theo nhân viên/kỳ với từng giao dịch nếu cần hoàn/hủy, đối soát hoặc truy nguyên hoa hồng.

### 2. Luồng nghiệp vụ tổng thể

`Work Schedule → Attendance → Attendance Reconciliation → Sales Records → Commission Calculation → Payroll → Payslip → Mobile display / print`

Mỗi bước chỉ tiêu thụ dữ liệu đã được bước trước xác nhận. Attendance ghi nhận thời gian thực tế và bất thường, không tự phê duyệt OT hay tính tiền. Commission là nơi duy nhất tính hoa hồng. Payroll đọc kết quả commission và tổng hợp Attendance/Leave/Contract đã chốt; Payslip và Mobile chỉ trình bày kết quả Payroll.

### 3. Vai trò và phân quyền

- **EMPLOYEE:** xem lịch, chấm công, xem lịch sử và payslip của chính mình; không xem/sửa dữ liệu người khác.
- **STORE_MANAGER:** thao tác lịch và đối soát trong phạm vi cửa hàng được cấp; không thể mở rộng phạm vi bằng cách truyền `store_id` khác.
- **HR_MANAGER:** quản lý dữ liệu nhân sự, đối soát và xử lý Payroll theo quyền hệ thống.
- **ADMIN:** quản trị toàn hệ thống; thao tác nhạy cảm vẫn phải có audit.
- Backend là nơi bắt buộc kiểm tra quyền. Ẩn nút ở client không thay thế authorization.

## 4. Work Schedule Rules

### 4.1. Ca chuẩn

`work_shifts` là danh mục định nghĩa `start_time`, `end_time`, `work_hours`, trạng thái hoạt động. Thời gian nghiệp vụ dùng Asia/Ho_Chi_Minh. Ca có `end_time <= start_time` được xem là qua đêm và kết thúc vào ngày kế tiếp. Thay đổi định nghĩa ca không được viết lại các Attendance đã snapshot.

### 4.2. Phân công và khóa trùng

**Quy tắc chuẩn:** một nhân viên được có nhiều schedule trong cùng `work_date`, miễn các khoảng làm việc không giao nhau.

- `08:00–12:00` và `13:00–17:00`: hợp lệ.
- `08:00–16:00` và `13:00–21:00`: xung đột.
- Cùng nhân viên, ngày và cùng khoảng ca được phân hai lần: duplicate, từ chối.
- Các khoảng được hiểu dạng `[start, end)`: ca kết thúc đúng lúc ca kế tiếp bắt đầu không bị xem là overlap.
- Kiểm tra theo khoảng datetime đầy đủ; ca qua đêm phải được mở rộng sang ngày kế tiếp trước khi so sánh.

Không dùng `UNIQUE(employee_id, work_date)` vì nó cấm lịch hợp lệ nhiều ca/ngày. Có thể dùng unique key chống duplicate cơ bản (`employee_id, work_date, shift_id`), nhưng bắt buộc service kiểm tra overlap cả khi shift_id khác nhau mà giờ giao nhau/trùng nhau. Kiểm tra và ghi phải nằm trong cùng transaction; khóa theo nhân viên để hai request đồng thời không cùng vượt qua kiểm tra. Không dùng `ON CONFLICT` để âm thầm ghi đè một schedule khác.

### 4.3. Sửa, hủy và truy vấn

- Tạo/sửa schedule phải kiểm tra nhân viên, cửa hàng, ca hoạt động, ngày hợp lệ, duplicate và overlap.
- Trả `409 SCHEDULE_CONFLICT` hoặc lỗi domain tương đương khi xung đột; không tự chọn schedule thắng.
- Hủy schedule là soft-cancel hoặc lưu lịch sử thay đổi; không xóa vật lý nếu đã được tham chiếu. Ghi người thao tác, thời điểm, lý do, old/new values.
- Sửa lịch có Attendance liên quan không làm đổi snapshot Attendance. Thay đổi hồi tố cần quy trình reconciliation có quyền và audit.
- API truy vấn hỗ trợ lọc ngày/khoảng ngày, nhân viên, cửa hàng; kết quả ổn định theo ngày, nhân viên, schedule ID. Tuần/tháng là phép gom từ ngày, không làm thay đổi ràng buộc dữ liệu.

## 5. Attendance Rules

### 5.1. Check-in, check-out và nhiều lượt

- Check-in dùng giờ server UTC+07:00; client không được gửi giờ vào/ra có thẩm quyền.
- Mỗi lượt có attendance ID riêng. Giữ nguyên các lượt đã đóng; không upsert theo nhân viên/ngày.
- Mỗi nhân viên chỉ có một lượt đang mở tại mọi thời điểm, kể cả qua ngày; khóa hàng nhân viên trong transaction và dùng unique index có điều kiện làm lớp bảo vệ bổ sung.
- Không mở lượt mới khi lượt cũ chưa check-out. Sau check-out phải đợi đủ 60 giây (`now >= check_out_time + 60s`); trước hạn trả 429 và `Retry-After`.
- Check-out chỉ đóng lượt mở được xác định và được phép truy cập; đóng lại trả 409. `{}` có thể tự tìm lượt mở của chính mình, bao gồm lượt từ hôm trước.
- Nhiều session trong một ngày **không đồng nghĩa nhiều ngày công**. Ví dụ hai lượt 08:00–12:00 và 13:00–17:00 là một `work_date` có mặt, tổng giờ là 8. Payroll phải gom theo nhân viên/ngày/kỳ; không đếm số row thành số ngày công.

### 5.2. Ca, thời gian và trạng thái

- `work_date` là ngày bắt đầu nghiệp vụ của ca; check-in ca đêm sau nửa đêm nhưng trước giờ kết thúc thuộc ngày bắt đầu ca.
- `actual_work_hours = round((check_out_time - check_in_time) / 1 hour, 2)`. Lượt đang mở có giờ thực tế bằng 0 cho mục đích tổng hợp.
- `overtime_hours` là OT thực tế theo `max(0, actual_work_hours - snapshotted_shift_work_hours)`. Attendance không duyệt OT, không nhân hệ số lương và không tự tính tiền phạt.
- Ân hạn đi muộn là 15 phút tính từ giờ bắt đầu của **từng ca**. Đúng mốc +15:00 chưa muộn; lớn hơn mốc mới muộn. `late_minutes` làm tròn lên số phút trễ.
- `early_minutes` tính theo giờ kết thúc trong snapshot; ca qua đêm dùng ngày kết thúc kế tiếp.
- `attendance_status` chỉ nhận `NORMAL`, `LATE`, `EARLY`, `LATE_AND_EARLY`, `OVERTIME`. Ưu tiên nhãn hiển thị: `LATE_AND_EARLY → LATE → EARLY → OVERTIME → NORMAL`; các trường số vẫn giữ đủ thông tin, ví dụ vừa muộn vừa OT vẫn lưu OT.
- `has_checked_in`/`has_checked_out` xác định vòng đời từ thời gian vào/ra, không suy ra chỉ từ status. `NOT_CHECKED_IN` chỉ là trạng thái hiển thị, không phải trạng thái Attendance đã lưu.

### 5.3. Schedule reconciliation và snapshot

Khi check-in, backend xác định `work_date`, lấy schedule áp dụng cho nhân viên/ngày/ca thực tế, snapshot planned schedule và actual shift, xác định `schedule_status`, rồi mới tạo Attendance. Schedule và Attendance status là hai chiều độc lập:

| `schedule_status` | Ý nghĩa |
|---|---|
| `MATCHED` | Ca và cửa hàng thực tế khớp schedule đã phân |
| `UNSCHEDULED` | Không có schedule áp dụng; vẫn được ghi nhận Attendance |
| `SHIFT_MISMATCH` | Có schedule nhưng ca hoặc cửa hàng thực tế khác |
| `LEGACY_UNKNOWN` | Bản ghi cũ không có snapshot; không suy diễn từ lịch hiện tại |

Schedule hợp lệ: backend nên suy ra planned shift, client không phải đoán ID. Nếu nhân viên/ch client chọn ca khác schedule, vẫn ghi nhận giờ thực tế theo quyền nhưng gắn `SHIFT_MISMATCH`; không giả thành `MATCHED`. Nếu có nhiều schedule trong ngày, chọn schedule rõ ràng theo ca/assignment; không dùng `LIMIT 1` tùy ý. Không có schedule thì yêu cầu client chọn actual shift rõ ràng, status là `UNSCHEDULED`.

`attendance_context` JSONB versioned snapshot tối thiểu gồm `schedule_status`, `planned` (schedule ID, shift/store và thông tin cần đối soát; null nếu không có lịch) và `actual` (shift ID, giờ bắt đầu/kết thúc, work_hours). Check-out bắt buộc tính theo snapshot; không query Work Schedule/Shift master để tính lại lượt mới. Sửa lịch hoặc ca sau check-in không đổi kết quả cũ. Bản ghi legacy giữ context null/`LEGACY_UNKNOWN`, không backfill bằng lịch mới.

### 5.4. Reconciliation và hợp đồng dữ liệu Payroll

Điều chỉnh Attendance, duyệt bất thường hoặc OT được trả lương là các thao tác có danh tính người duyệt, lý do, old/new values và audit. Không sửa trực tiếp bản ghi lịch sử mà không để lại dấu vết.

- `Attendance.overtime_hours` = OT thực tế phát sinh.
- `Payroll.approved_overtime_hours` = OT đã được phê duyệt và đủ điều kiện trả lương.
- Hai số có thể khác. Payroll chỉ trả tiền theo số đã duyệt; không suy ra duyệt từ `status='OVERTIME'`.
- Payroll dùng số liệu `late_minutes`, `early_minutes`, `actual_work_hours`, `overtime_hours` và các bản ghi approval; không suy diễn tiền/ngày công chỉ từ status.

## 6. Attendance Mobile Contract

- Client gọi API để lấy lịch, trạng thái, lịch sử và gửi check-in/out. Backend quyết định employee, thời gian, schedule match, snapshot, cooldown và quyền.
- Khi có schedule, Mobile không gửi mặc định `shift_id=1`; có thể bỏ shift ID để backend suy ra planned shift. Nếu người dùng override ca, gửi lựa chọn rõ ràng để backend đánh dấu mismatch.
- Khi không có schedule, Mobile yêu cầu người dùng chọn ca thực tế; không tự chọn ca đầu tiên hoặc ID hằng số.
- Vị trí/thiết bị nếu gửi chỉ là dữ liệu client khai báo, không được gọi là xác thực GPS hay chứng minh có mặt.
- UI có thể đếm ngược/làm mới, nhưng backend luôn kiểm tra lại giới hạn 60 giây và trạng thái lượt mở.

## 7. Sales Rules

### 7.1. Dòng sales và trạng thái

Sales chuẩn là từng transaction/line có ít nhất: `employee_id`, `store_id`, transaction/reference code duy nhất, `sale_date`, `category`, `amount`, `status`, `created_at`. Cần lưu người ghi nhận/cập nhật và liên kết giao dịch hoàn/hủy với giao dịch gốc. Không dùng một dòng tổng doanh số nhân viên/tháng làm nguồn duy nhất nếu yêu cầu đối soát từng đơn.

Sales lifecycle phải được kiểm soát ở backend. Tối thiểu phân biệt giao dịch chờ duyệt, hợp lệ hoàn tất, hủy, hoàn tiền và vô hiệu hóa; mọi chuyển trạng thái/sửa số tiền đều audit. `CANCELLED`, `REFUNDED`, `VOID` không đủ điều kiện hoa hồng. Hoàn tiền phải tham chiếu sales gốc và tạo điều chỉnh/reversal; không xóa lịch sử giao dịch hoặc commission đã chốt.

### 7.2. Commission eligibility

Chỉ sales được duyệt/hoàn tất theo trạng thái đã chốt (`APPROVED` hoặc `COMPLETED`) mới đủ điều kiện. Không tính sales pending, cancelled, refunded hoặc void. Category phải thuộc danh mục hợp lệ; amount và employee/store/reference phải được kiểm tra server-side. Thay đổi sales của kỳ đã khóa cần adjustment có audit hoặc quy trình mở lại chính thức.

## 8. Commission Rules

### 8.1. Nguồn tính

Chỉ `sp_calculate_monthly_commission(period)` hoặc một service nghiệp vụ backend duy nhất được tính commission. Payroll chỉ đọc `commissions`; không quét sales để tự triển khai công thức hoa hồng thứ hai. Rate phải có version/effective period và có thể truy nguyên trong kết quả tính.

Rate baseline đã ghi trong tài liệu dự án: điện thoại 1%, laptop 1%, phụ kiện 3%. KPI bonus là khoản riêng, không trộn vào tỷ lệ commission: đạt từ 100% đến dưới 120% là 1.000.000 VND; từ 120% là 2.000.000 VND. Thay rate/tier phải được chủ nghiệp vụ duyệt, ghi ngày hiệu lực và cập nhật test; không hard-code thêm trong client.

### 8.2. Idempotency, khóa kỳ

Chạy cùng kỳ nhiều lần không được nhân đôi commission. Tính lại phải thực hiện nguyên tử trong transaction, upsert/thay thế kết quả theo khóa nguồn ổn định (ví dụ employee + period + source record/category + rule version), lưu kỳ và nguồn tính, đồng thời giữ audit lần chạy. Không xóa dấu vết kết quả đã phát hành.

Kỳ đã lock/Payroll đã CONFIRMED hoặc PAID không được tính lại âm thầm. Từ chối thao tác hoặc dùng quy trình adjustment/reopen được phân quyền, có lý do và audit. Commission calculation và payroll generation phải có thứ tự rõ ràng: sales đã chốt → commission hoàn tất → payroll mới được tính.

## 9. Payroll Rules

### 9.1. Input và tổng hợp

Mỗi payroll kỳ phải đóng băng đủ input để giải trình: contract salary/bảo hiểm snapshot; attendance aggregation; OT đã duyệt; paid/unpaid leave đã duyệt; commissions; allowances; bonuses; deductions; calculation/rule version; nguồn dữ liệu và thời điểm tính.

- Gom Attendance theo employee + `work_date` + kỳ; nhiều sessions cùng ngày được cộng giờ nhưng ngày có mặt chỉ đếm một lần.
- `actual_work_hours` và `late_minutes` lấy từ số liệu Attendance đã đối soát; không đếm mỗi session thành một ngày công.
- Chỉ `approved_overtime_hours` đưa vào tiền OT. OT phát sinh chưa duyệt không tự được trả.
- Nghỉ phép hưởng lương/không lương lấy từ leave đã duyệt và không đếm trùng với Attendance/adjustment.
- Commission đọc từ bảng `commissions` đã tính; không tính lại tại Payroll.
- Số tiền phải dùng decimal/numeric, làm tròn theo policy đã phiên bản hóa; không dùng floating point ở phép tính tiền.

### 9.2. Output snapshot và trạng thái

Payroll output và `payroll_details` là snapshot của employee/kỳ, gồm các input đã dùng, từng khoản thu/khấu trừ, công thức/version, tổng gross/net, người/thời điểm tính và nguồn. Chỉnh sửa Attendance/Sales/Contract quá khứ không tự sửa snapshot.

Trạng thái chuẩn: `DRAFT → CALCULATED → CONFIRMED → PAID`. Tính lại chỉ được phép khi DRAFT/CALCULATED và phải tạo phiên bản/audit nguyên tử. CONFIRMED/PAID là bất biến đối với recalculate thông thường; sửa sai bằng quy trình điều chỉnh có phê duyệt, liên kết payroll gốc và audit, không delete-and-recreate.

### 9.3. Công thức và policy

Các baseline dự án đang ghi nhận gồm công chuẩn 26 ngày, đơn giá giờ tham chiếu `contract_salary / (26 * 8)`, bảo hiểm người lao động 10.5% trên insurance salary, allowances/bonus theo cấu hình doanh nghiệp. Khấu trừ muộn và nghỉ không lương phải lấy số liệu đã xác nhận, hiển thị thành dòng riêng. OT pay chỉ dựa trên approved OT và hệ số policy có hiệu lực.

Không suy ra rằng mọi baseline cũ đã được tái nghiệm thu sau Attendance v5.0. Trước khi triển khai/tái tính, phải chốt cách quy đổi ngày công, grace period có/không ảnh hưởng khấu trừ tiền, hệ số OT, thuế, mức phạt và quy tắc làm tròn với chủ nghiệp vụ; lưu `calculation_version`. Không áp dụng tiền phạt hay thay công thức chỉ từ attendance status.

## 10. Payslip Mobile Contract

Mobile chỉ gọi API được phân quyền để lấy My Payslip, Salary Breakdown và dữ liệu tổng hợp năm; sau đó hiển thị hoặc render/in dữ liệu backend đã chốt. Không viết công thức Gross/Net, thuế, bảo hiểm, OT, commission hoặc penalty trong React Native. Dữ liệu in phải gắn payroll ID/kỳ/trạng thái/version; phiếu chưa CONFIRMED cần được phân biệt rõ với phiếu chính thức. Không cho client sửa số liệu payroll.

## 11. Audit và toàn vẹn dữ liệu

Audit bắt buộc với: tạo/sửa/hủy schedule; sửa Attendance, duyệt bất thường/OT; sửa/duyệt/hoàn sales; chạy hoặc điều chỉnh commission; generate/recalculate/confirm/pay/adjust payroll; thay đổi công thức/rate. Log gồm actor, thời điểm UTC, action, entity/id, old/new values, lý do và correlation/request ID nếu có. Không ghi mật khẩu/token hoặc dữ liệu bí mật vào log.

Dùng transaction cho kiểm tra xung đột và ghi, check-in/out, commission calculation và payroll generation. Unique/check/foreign-key/index là lớp bảo vệ bổ sung, không thay business validation. Mutations có tác động tài chính phải idempotent hoặc có idempotency key và không được để retry nhân đôi kết quả.

## 12. Error Contract

| HTTP | Mã domain gợi ý | Tình huống |
|---|---|---|
| 400 | `INVALID_BUSINESS_CONTEXT` | Thiếu liên kết hồ sơ/cửa hàng hoặc input nghiệp vụ không đủ |
| 401 | `UNAUTHENTICATED` | Token thiếu/sai/hết hạn |
| 403 | `FORBIDDEN` | Vượt phạm vi nhân viên/cửa hàng/kỳ |
| 404 | `NOT_FOUND` | Nhân viên, ca, schedule, attendance hoặc payroll không tồn tại |
| 409 | `SCHEDULE_CONFLICT` / `ATTENDANCE_CONFLICT` / `PERIOD_LOCKED` | Overlap/duplicate, lượt đang mở/đã đóng, hoặc kỳ đã khóa |
| 422 | `VALIDATION_ERROR` | ID, ngày, kỳ, trạng thái hoặc payload sai định dạng |
| 429 | `ATTENDANCE_COOLDOWN` | Chưa đủ 60 giây; trả `Retry-After` |

Response lỗi không được làm lộ dữ liệu ngoài phạm vi quyền. Client hiển thị lỗi server, không biến lỗi mạng/401/403 thành danh sách rỗng.

## 13. Test Matrix và bằng chứng

**Current verified Attendance result (01/10/2026): 18/18 Attendance unit/rule tests PASS; PostgreSQL integration PASS.** Trong đó 13 test là baseline lịch sử và 5 test bổ sung cho schedule integration/snapshot. Đây không phải bằng chứng nghiệm thu Schedule multi-assignment, Sales, Commission, Payroll v5.0 hoặc Mobile end-to-end.

| Slice | Bắt buộc kiểm thử trước khi đánh dấu VERIFIED |
|---|---|
| Work Schedule | Nhiều ca không overlap hợp lệ; overlap và duplicate bị chặn; ca qua đêm; sửa đồng thời cùng nhân viên; cancel/audit |
| Attendance | Một/many sessions; 0/59/60 giây; một lượt mở; ca qua đêm; quyền; số liệu ngày duy nhất; status độc lập |
| Reconciliation | MATCHED/UNSCHEDULED/SHIFT_MISMATCH/LEGACY_UNKNOWN; sửa lịch sau check-in không đổi snapshot; điều chỉnh/approval audit |
| Sales/Commission | trạng thái đủ/không đủ điều kiện; duplicate transaction; refund reversal; rate/KPI boundary; chạy procedure hai lần không nhân đôi; kỳ lock |
| Payroll | gom nhiều sessions thành một ngày; chỉ approved OT; leave không đếm trùng; commission là nguồn duy nhất; recalc draft; confirmed/paid bất biến; snapshot/audit |
| Mobile/Payslip | role scope; không có shift ID mặc định; API error state; hiển thị đúng payroll snapshot; không có tính toán tiền phía client; print/export đúng dữ liệu |

Test unit, integration database/API và UI theo vai trò phải được báo cáo riêng. Không gọi kiểm tra TypeScript/build là nghiệm thu nghiệp vụ. Không gọi test bảng tạm là stress test đồng thời.

## 14. Migration Order

1. Rà dữ liệu schedule trùng/xung đột và Attendance đang mở; sao lưu trước migration.
2. Bỏ unique employee/day sau khi xác nhận dữ liệu; thêm khóa chống duplicate phù hợp và service conflict check transaction cho schedule nhiều ca/ngày.
3. Giữ migration Attendance nhiều sessions (`20260926_attendance_sessions.sql`) rồi snapshot (`20261001_attendance_schedule_snapshot.sql`); kiểm tra index/ràng buộc trước API mới.
4. Migrate Sales transaction/reference/status và dữ liệu lịch sử có mapping rõ; không tự biến tổng theo tháng thành giao dịch giả.
5. Migration Commission idempotency/source/version và trạng thái khóa kỳ.
6. Migrate Payroll snapshot/version và state transition; không xóa payroll CONFIRMED/PAID.
7. Deploy backend contract trước Web/Mobile; client không được phát hành với `shift_id=1` fallback.

Mỗi bước cần migration có thể kiểm tra, rollback/forward plan và test trên bản sao dữ liệu. Không chạy migration phá hủy dữ liệu thật như một phần của thay đổi tài liệu.

## 15. Definition of Done

Một nhiệm vụ chỉ hoàn tất khi: rule liên quan được hiện thực ở backend/database; quyền và audit đúng; migration an toàn; test unit + integration cho positive/boundary/negative cases đạt; client chỉ render/gửi theo contract; API/docs/types đồng bộ; và báo cáo tách rõ PASS, GAP, chưa kiểm thử. Một tài liệu hoặc giao diện đơn lẻ không chứng minh nghiệp vụ đã hoàn tất.

### Appendix A. API surface

Các API hiện được ghi nhận: `/attendances/shifts`, `/attendances/shift-schedules`, `/attendances/check-in`, `/attendances/check-out`, `/attendances/today-status`, `/attendances/my-history`, `/attendances/my-summary`, `/attendances`; Sales/Commission/Payroll hiện có các route dưới `/payrolls/sales-records`, `/payrolls/commissions`, `/payrolls/calculate`, `/payrolls/generate/{month}`, `/payrolls/{id}`, `/payrolls/{id}/payslip`, `/payrolls/confirm-all`, `/payrolls/pay-all`. Đây là inventory tài liệu, không khẳng định mọi route đáp ứng contract v5.0.

### Appendix B. Lịch sử Attendance (non-normative)

Phần dưới đây là báo cáo lịch sử phiên bản 4.x, giữ lại để truy nguyên triển khai và bằng chứng Attendance. Nếu có bất kỳ nội dung nào khác SOURCE OF TRUTH hoặc phần 1–15, quy tắc mới ở phần 1–15 được ưu tiên. Các con số 13 test trong phần lịch sử là baseline, không phải kết quả hiện tại.

---

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

> **Bổ sung ngày 01/10/2026:** Quy tắc đối chiếu lịch, bản chụp ca, trạng thái kết hợp và bộ 18 test được chốt tại mục 11. Các mục kiểm thử 13 test ở phần lịch sử bên dưới là baseline cũ, không phải kết quả hiện tại.

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
| Phút muộn | Làm tròn lên số phút sau giờ bắt đầu ca; đúng 15 phút không muộn, 15 phút 01 giây được phân loại LATE |
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

**Kết quả lịch sử của baseline 4.x: 13/13 test đạt.** Năm test schedule integration được bổ sung sau đó; kết quả hiện tại được ghi duy nhất ở mục 13 của contract này.

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

## 11. Chốt quy tắc liên kết Work Schedule — 01/10/2026

### 11.1. Không có lịch và sai ca

Check-in đối chiếu `work_schedules` theo nhân viên và `work_date` của ca thực tế. Cho phép ghi nhận kể cả không có lịch/sai ca, trả nhãn độc lập `schedule_status`:

| Nhãn | Ý nghĩa |
|---|---|
| MATCHED | Ca và cửa hàng thực tế khớp lịch |
| UNSCHEDULED | Chưa có lịch phân ca cho ngày nghiệp vụ |
| SHIFT_MISMATCH | Ca hoặc cửa hàng thực tế khác lịch |
| LEGACY_UNKNOWN | Bản ghi cũ chưa có bản chụp, không suy diễn từ lịch mới |

`shift_id` trong request là ca thực tế. **Mặc định ID 1 là compatibility legacy, không phải quy tắc chuẩn; xem GAP triển khai ở đầu tài liệu.** Không có lịch vẫn là UNSCHEDULED. Các nhãn này không thay thế `attendance_status`.

### 11.2. Hợp đồng API bổ sung

Check-in trả `schedule_status` và `attendance_context`; lịch sử, danh sách quản lý và today-status cũng trả các trường này cho bản ghi được tìm thấy. Không có bản ghi hôm nay thì context là null; không suy diễn kết quả đối chiếu cho một lượt chưa phát sinh.

Ví dụ phần dữ liệu bổ sung khi chưa có lịch:

```json
{
  "status": "LATE",
  "schedule_status": "UNSCHEDULED",
  "attendance_context": {
    "version": 1,
    "schedule_status": "UNSCHEDULED",
    "planned": null,
    "actual": {
      "shift_id": 1,
      "start_time": "08:00:00",
      "end_time": "16:00:00",
      "work_hours": 8.0
    }
  }
}
```

Khi có lịch, `planned` chứa schedule_id, shift_id, store_id lúc check-in. Các giờ trên là ví dụ; API lấy cấu hình ca thực tế từ database.

### 11.3. Bản chụp và sửa lịch sau check-in

Cột JSONB `attendance_context` lưu ca thực tế, ca phân công và kết quả đối chiếu tại thời điểm vào. Check-out dùng giờ bắt đầu/kết thúc và work_hours đã chụp. Sửa work_schedules/work_shifts không làm thay đổi kết quả cũ hoặc mất dấu sai ca. API phân ca dùng cùng khóa hàng nhân viên với check-in.

Bản ghi cũ không được gán lịch hồi tố. Nếu context null, check-out tương thích bằng định nghĩa ca hiện tại; cần đối soát riêng các lượt cũ nếu ca đã bị thay đổi.

Migration mới đã áp dụng thành công trong môi trường thực hiện:

```powershell
.\backend\venv\Scripts\python.exe backend\migrate_attendance.py --migration 20261001_attendance_schedule_snapshot.sql
```

Triển khai môi trường khác: chạy migration nền ngày 26/09 trước, rồi migration này trước khi chạy API mới.

### 11.4. Ân hạn, nhãn kết hợp và dữ liệu cho Payroll

- Ân hạn tính từ giờ bắt đầu **từng ca**: ca 08:00 muộn sau 08:15, ca 13:00 muộn sau 13:15. Không có quy tắc 08:15 cố định cho mọi ca.
- Phút muộn làm tròn lên: đúng 15 phút vẫn NORMAL; 15 phút 01 giây thành 16 phút và LATE.
- Status ưu tiên LATE_AND_EARLY, LATE, EARLY, OVERTIME, NORMAL. Người vừa muộn vừa OT giữ nhãn LATE và vẫn giữ giờ OT.
- Các trường số là nguồn tính nghiệp vụ. Payroll phải đọc late_minutes, early_minutes, actual_work_hours, overtime_hours, không suy ra mọi quyền lợi/khấu trừ chỉ từ status. Chưa nghiệm thu lại stored procedure Payroll trong lần này.
- Location/device chỉ là **ghi nhận thông tin client gửi**, chưa phải xác thực GPS/thiết bị hoặc chứng minh vị trí có mặt.

### 11.5. Bằng chứng kiểm thử và phạm vi hoàn thành

**18/18 test offline PASS**, gồm 13 test cũ và 5 test bổ sung: không có schedule; sai ca; ca chiều tại biên 15 phút; vừa LATE vừa OT; sửa lịch/ca sau check-in.

**PostgreSQL integration PASS:** bảng tạm cho attendance, lịch và danh mục ca; kiểm tra UNSCHEDULED/SHIFT_MISMATCH, lưu/trả snapshot, sửa lịch và giờ chuẩn sau check-in rồi check-out vẫn dùng bản chụp. Giữ kiểm thử mốc 59/60 giây, lịch sử nhiều lượt và tổng hợp ngày. Dữ liệu test rollback, không sửa các hàng nghiệp vụ thật.

Bộ test chứng minh các tình huống nêu trên; chưa phải stress test request đồng thời. Nhiệm vụ 1 đã có đủ quy tắc và test để bàn giao dữ liệu sang Nhiệm vụ 5. Giao diện đối soát/duyệt bất thường và nghiệm thu Payroll là phạm vi tích hợp tiếp theo. Báo cáo tổng hợp cập nhật tại `mission.md`.

## 12. Liên kết Nhiệm vụ 2 — Attendance Mobile (01/10/2026)

Ứng dụng mobile đã có check-in, check-out, lịch sử theo tháng và kết nối API, dùng lại toàn bộ luật Nhiệm vụ 1. API addon `/mobile-attendance` bổ sung GPS theo vùng cửa hàng, selfie Cloudinary, photo token và request_id chống gửi trùng; dữ liệu proof lưu ở bảng riêng, không sửa cấu trúc bảng Attendance.

**Tiến độ nghiệm thu Nhiệm vụ 2: 80%** theo trọng số công việc trong [mission2.md](mission2.md). Đã đạt 30 test backend, 8 test client, integration PostgreSQL, lint/typecheck và bundle Android. Chưa nghiệm thu Track Asia/Cloudinary với cấu hình thật hoặc tương tác camera/GPS trên thiết bị; không đồng nhất build thành công với hoàn thành 100%.

Các API Web cũ giữ hợp đồng Nhiệm vụ 1. GPS bắt buộc trên tuyến mobile mới, chưa là chính sách bắt buộc cho tất cả kênh. Quy trình, cấu hình Expo Go/Android Studio, file thay đổi và checklist còn lại nằm trong mission2.md.
