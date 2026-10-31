-- Dữ liệu mẫu: bổ sung số nhà, tên đường (tuyến đường có thật trong phường mới, số nhà tự đặt)
-- Chỉ cập nhật khi địa chỉ vẫn là giá trị sau migration 20261101_normalize_employee_addresses.sql
with data(code, old_value, new_value) as (
  values
    ('TZ-001', 'Phường Sài Gòn, Thành phố Hồ Chí Minh', '18 Lê Thánh Tôn, Phường Sài Gòn, Thành phố Hồ Chí Minh'),
    ('TZ-001', '123 Đường Số 1, Phường Sài Gòn, Thành phố Hồ Chí Minh', '123 Lý Tự Trọng, Phường Sài Gòn, Thành phố Hồ Chí Minh'),
    ('TZ-002', 'Phường Xuân Hòa, Thành phố Hồ Chí Minh', '45 Tú Xương, Phường Xuân Hòa, Thành phố Hồ Chí Minh'),
    ('TZ-003', 'Phường Sài Gòn, Thành phố Hồ Chí Minh', '56 Tôn Đức Thắng, Phường Sài Gòn, Thành phố Hồ Chí Minh'),
    ('TZ-004', 'Phường Bình Thạnh, Thành phố Hồ Chí Minh', '88 Phan Đăng Lưu, Phường Bình Thạnh, Thành phố Hồ Chí Minh'),
    ('TZ-005', 'Phường Tân Bình, Thành phố Hồ Chí Minh', '412 Trường Chinh, Phường Tân Bình, Thành phố Hồ Chí Minh'),
    ('TZ-006', 'Phường Xuân Hòa, Thành phố Hồ Chí Minh', '21 Trần Quốc Thảo, Phường Xuân Hòa, Thành phố Hồ Chí Minh'),
    ('TZ-007', 'Phường Diên Hồng, Thành phố Hồ Chí Minh', '150 Thành Thái, Phường Diên Hồng, Thành phố Hồ Chí Minh'),
    ('TZ-008', 'Phường Gò Vấp, Thành phố Hồ Chí Minh', '275 Quang Trung, Phường Gò Vấp, Thành phố Hồ Chí Minh'),
    ('TZ-DIR', 'Phường Hoàn Kiếm, Thành phố Hà Nội', '25 Đinh Tiên Hoàng, Phường Hoàn Kiếm, Thành phố Hà Nội')
)
update employees e
set permanent_address = coalesce(p.new_value, e.permanent_address),
    current_address = coalesce(c.new_value, e.current_address)
from employees src
left join data p on p.code = src.employee_code and p.old_value = src.permanent_address
left join data c on c.code = src.employee_code and c.old_value = src.current_address
where e.employee_id = src.employee_id
  and (p.new_value is not null or c.new_value is not null);
