-- Chuẩn hoá địa chỉ nhân viên theo frontend-web/public/data/province.json (sau sáp nhập 07/2025)
-- Định dạng: "số nhà đường, phường/xã, tỉnh/thành phố". Quận cũ bị chia nhiều phường nên chọn 1 phường đại diện.
-- Chỉ cập nhật khi giá trị vẫn là chuỗi cũ, không ghi đè nếu đã có người sửa.
with mapping(old_value, new_value) as (
  values
    ('Quận 1, TP.HCM', 'Phường Sài Gòn, Thành phố Hồ Chí Minh'),
    ('123 Đường Số 1, Q1, TP.HCM', '123 Đường Số 1, Phường Sài Gòn, Thành phố Hồ Chí Minh'),
    ('Quận 3, TP.HCM', 'Phường Xuân Hòa, Thành phố Hồ Chí Minh'),
    ('Quận 10, TP.HCM', 'Phường Diên Hồng, Thành phố Hồ Chí Minh'),
    ('Bình Thạnh, TP.HCM', 'Phường Bình Thạnh, Thành phố Hồ Chí Minh'),
    ('Tân Bình, TP.HCM', 'Phường Tân Bình, Thành phố Hồ Chí Minh'),
    ('Gò Vấp, TP.HCM', 'Phường Gò Vấp, Thành phố Hồ Chí Minh'),
    ('Hà Nội', 'Phường Hoàn Kiếm, Thành phố Hà Nội')
)
update employees e
set permanent_address = coalesce(p.new_value, e.permanent_address),
    current_address = coalesce(c.new_value, e.current_address)
from employees src
left join mapping p on p.old_value = src.permanent_address
left join mapping c on c.old_value = src.current_address
where e.employee_id = src.employee_id
  and (p.new_value is not null or c.new_value is not null);
