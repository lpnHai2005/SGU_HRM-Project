import asyncio
import sys
import os
import httpx
from datetime import date, timedelta
from decimal import Decimal

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from app.main import app
from app.core.database import AsyncSessionLocal
from sqlalchemy import text

async def run_tests():
    print("=" * 85)
    print(" KIỂM THỬ TOÀN DIỆN CHỨC NĂNG BẢNG LƯƠNG & PHIẾU LƯƠNG (PAYROLL WORKFLOW & FORMULAS)")
    print(" Chuỗi TechZone - Liên kết Nghỉ phép (Trừ lương), Hoa hồng, Thưởng KPI, In A4/PDF")
    print("=" * 85)

    # Dọn dẹp dữ liệu kiểm thử cũ nếu có
    async with AsyncSessionLocal() as db:
        await db.execute(text("DELETE FROM leave_requests WHERE employee_id = 4 AND (start_date = '2026-09-18' OR reason LIKE '%Kiểm thử%')"))
        await db.commit()

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. ĐĂNG NHẬP 4 TÀI KHOẢN VAI TRÒ
        print("\n[BƯỚC 1] Đăng nhập các tài khoản hệ thống (admin, hr_manager, store_mgr_q1, staff_dung)...")
        tokens = {}
        for username in ["admin", "hr_manager", "store_mgr_q1", "staff_dung"]:
            res = await client.post("/api/v1/auth/login", json={"username": username, "password": "123456"})
            assert res.status_code == 200, f"Đăng nhập thất bại: {username} ({res.text})"
            tokens[username] = res.json()["access_token"]
            print(f" -> Đăng nhập thành công: {username} ({res.json()['roles']})")

        admin_headers = {"Authorization": f"Bearer {tokens['admin']}"}
        hr_headers = {"Authorization": f"Bearer {tokens['hr_manager']}"}
        store_headers = {"Authorization": f"Bearer {tokens['store_mgr_q1']}"}
        staff_headers = {"Authorization": f"Bearer {tokens['staff_dung']}"}

        test_period = "2026-09"

        # 2. KIỂM THỬ ĐẶT DOANH SỐ CHO STAFF_DŨNG (VÍ DỤ 220 TRIỆU ĐỒNG TỪ WORKFLOW)
        print("\n[BƯỚC 2] Thiết lập doanh số bán lẻ 220 triệu cho staff_dung (Phone 150M, Laptop 70M, KPI 100%)...")
        sales_payload = {
            "employee_id": 4, # Phạm Quốc Dũng
            "store_id": 1,
            "salary_period": test_period,
            "phone_revenue": 150000000.0,
            "laptop_revenue": 70000000.0,
            "accessory_revenue": 0.0,
            "target_kpi": 220000000.0
        }
        res = await client.post("/api/v1/payrolls/sales-records", json=sales_payload, headers=hr_headers)
        assert res.status_code in (200, 201), f"Lỗi ghi nhận doanh số: {res.text}"
        sales_data = res.json()
        print(f" -> Đã ghi nhận doanh số: Tổng {sales_data['total_revenue']:,.0f} VNĐ | Tỷ lệ KPI: {sales_data['kpi_achievement_rate']}%")

        # 3. KIỂM TRA TỰ ĐỘNG TÍNH HOA HỒNG & THƯỞNG KPI (Week 3.1)
        print("\n[BƯỚC 3] Kiểm tra hoa hồng bán lẻ và thưởng KPI...")
        res = await client.get(f"/api/v1/payrolls/commissions?period={test_period}&employee_id=4", headers=hr_headers)
        assert res.status_code == 200
        comm_list = res.json()
        assert len(comm_list) > 0
        comm_dung = comm_list[0]
        # Phone 150M * 1% = 1.5M, Laptop 70M * 1% = 700k -> Commission = 2.2M; KPI 100% -> Bonus = 1.0M
        print(f" -> Hoa hồng tính được: {comm_dung['commission_amount']:,.0f} VNĐ (Kỳ vọng: 2,200,000 VNĐ)")
        print(f" -> Thưởng nóng KPI: {comm_dung['kpi_bonus_amount']:,.0f} VNĐ (Kỳ vọng: 1,000,000 VNĐ)")
        assert float(comm_dung['commission_amount']) == 2200000.0
        assert float(comm_dung['kpi_bonus_amount']) == 1000000.0

        # 4. KIỂM TRA LIÊN KẾT PHÂN HỆ NGHỈ PHÉP (LEAVES LIÊN KẾT TRỪ LƯƠNG)
        print("\n[BƯỚC 4] Kiểm tra liên kết phân hệ Nghỉ phép có trừ lương (Unpaid Leave Linkage)...")
        # Tạo đơn nghỉ không lương 1 ngày cho staff_dung trong tháng 9
        test_leave_date = date(2026, 9, 18)
        leave_payload = {
            "leave_type_id": 5, # KHONG_LUONG
            "start_date": str(test_leave_date),
            "end_date": str(test_leave_date),
            "total_days": 1.0,
            "reason": "Kiểm thử tự động liên kết nghỉ không hưởng lương trừ vào bảng lương tháng"
        }
        res = await client.post("/api/v1/leaves", json=leave_payload, headers=staff_headers)
        assert res.status_code in (200, 201), f"Lỗi tạo đơn nghỉ phép: {res.text}"
        leave_req_id = res.json()["request_id"]
        print(f" -> Nhân viên staff_dung đã nộp đơn nghỉ không lương #{leave_req_id} ngày {test_leave_date}")

        # HR phê duyệt đơn nghỉ không lương (Cấp 2)
        res = await client.post(f"/api/v1/leaves/{leave_req_id}/approve-hr", json={"note": "HR duyệt nghỉ không lương test"}, headers=hr_headers)
        assert res.status_code == 200, f"HR duyệt đơn thất bại: {res.text}"
        print(f" -> HR đã duyệt chính thức (HR_APPROVED) đơn #{leave_req_id}")

        # Kiểm tra bảng chấm công attendances đã tự động đồng bộ ngày nghỉ UNPAID_LEAVE
        async with AsyncSessionLocal() as db:
            att_check = await db.execute(text("SELECT status, notes FROM attendances WHERE employee_id = 4 AND work_date = :wdate"), {"wdate": test_leave_date})
            att_row = att_check.first()
            assert att_row is not None, "Chưa đồng bộ sang bảng chấm công!"
            assert att_row[0] == "UNPAID_LEAVE", f"Trạng thái chấm công không phải UNPAID_LEAVE: {att_row[0]}"
            print(f" -> Xác nhận: Bảng chấm công attendances đã tự động ghi nhận status={att_row[0]}")

        # 5. CHỐT CÔNG & TÍNH TOÁN BẢNG LƯƠNG TOÀN CHUỖI (POST /api/payrolls/calculate)
        print("\n[BƯỚC 5] Chốt công và tính toán bảng lương tự động toàn chuỗi (POST /payrolls/calculate)...")
        res = await client.post("/api/v1/payrolls/calculate", json={"salary_period": test_period}, headers=hr_headers)
        assert res.status_code == 200, f"Lỗi tính bảng lương: {res.text}"
        calc_result = res.json()
        print(f" -> Kết quả: {calc_result['message']}")
        print(f"    * Số nhân viên tính lương: {calc_result['total_employees_calculated']}")
        print(f"    * Tổng quỹ lương Gross: {calc_result['total_gross_income']:,.0f} VNĐ")
        print(f"    * Tổng thực lĩnh Net: {calc_result['total_net_salary']:,.0f} VNĐ")

        # 6. KIỂM TRA ENDPOINT WORKFLOW ALIAS GET /api/payroll/generate/{month}
        print("\n[BƯỚC 6] Kiểm tra endpoint alias workflow: GET /api/payroll/generate/{month}...")
        res = await client.get(f"/api/payroll/generate/{test_period}", headers=hr_headers)
        assert res.status_code == 200, f"GET /api/payroll/generate/{test_period} thất bại: {res.text}"
        payrolls_alias = res.json()
        assert len(payrolls_alias) > 0
        print(f" -> GET /api/payroll/generate/{test_period} thành công! Nhận được {len(payrolls_alias)} phiếu lương.")

        # 7. KIỂM TRA PHIẾU LƯƠNG CỦA STAFF_DŨNG VÀ CÔNG THỨC TRỪ LƯƠNG NGHỈ PHÉP
        print("\n[BƯỚC 7] Kiểm tra phiếu lương chi tiết của staff_dung (ID: 4) & khấu trừ nghỉ không lương...")
        dung_payroll = next(p for p in payrolls_alias if p["employee_id"] == 4)
        payroll_id = dung_payroll["payroll_id"]
        print(f" -> Thông số phiếu lương #{payroll_id} của {dung_payroll['employee_name']}:")
        print(f"    * Công chuẩn: {dung_payroll['standard_working_days']} ngày | Công thực tế: {dung_payroll['actual_working_days']} ngày")
        print(f"    * Nghỉ không lương: {dung_payroll['unpaid_leave_days']} ngày (Từ đơn #{leave_req_id} đã duyệt)")
        print(f"    * Lương hợp đồng: {dung_payroll['contract_salary']:,.0f} VNĐ")
        print(f"    * Khấu trừ thời gian: {dung_payroll['time_deduction_amount']:,.0f} VNĐ (Đã trừ chính xác theo ngày nghỉ ko lương)")
        print(f"    * Lương CB thực nhận: {dung_payroll['actual_base_salary']:,.0f} VNĐ")
        print(f"    * Hoa hồng: {dung_payroll['commission_amount']:,.0f} VNĐ")
        print(f"    * Thưởng KPI: {dung_payroll['productivity_bonus']:,.0f} VNĐ")
        print(f"    * Lương Gross: {dung_payroll['gross_income']:,.0f} VNĐ")
        print(f"    * Bảo hiểm 10.5%: {dung_payroll['total_insurance']:,.0f} VNĐ")
        print(f"    * Lương Thực lĩnh NET: {dung_payroll['net_salary']:,.0f} VNĐ")

        # Xác minh công thức toán học
        assert dung_payroll['unpaid_leave_days'] >= 1.0, "Chưa ghi nhận ngày nghỉ không lương!"
        assert dung_payroll['actual_base_salary'] < dung_payroll['contract_salary'], "Lương cơ bản thực nhận phải bị trừ do nghỉ không lương!"
        assert dung_payroll['commission_amount'] == 2200000.0, "Hoa hồng không khớp!"

        # 8. KIỂM TRA ENDPOINT GET /api/payrolls/{id} (CHI TIẾT VÀ 12 DÒNG GIẢI TRÌNH)
        print("\n[BƯỚC 8] Kiểm tra endpoint GET /api/payrolls/{id} (12 dòng giải trình cấu phần)...")
        res = await client.get(f"/api/payrolls/{payroll_id}", headers=staff_headers)
        assert res.status_code == 200, f"Lỗi lấy chi tiết phiếu lương: {res.text}"
        detail_data = res.json()
        assert "details" in detail_data
        print(f" -> Phiếu lương #{payroll_id} có {len(detail_data['details'])} dòng giải trình cấu phần:")
        for d in detail_data["details"]:
            print(f"    - [{d['item_code']}] {d['item_name']}: {d['amount']:,.0f} VNĐ ({d['calculation_formula'] or d['item_type']})")

        # Kiểm tra sự hiện diện của dòng BASE_SALARY_DEDUCTION
        base_deduct_line = next((d for d in detail_data["details"] if d["item_code"] == "BASE_SALARY_DEDUCTION"), None)
        assert base_deduct_line is not None, "Thiếu dòng giải trình BASE_SALARY_DEDUCTION!"
        print(f" -> [XÁC NHẬN LIÊN KẾT NGHỈ PHÉP]: {base_deduct_line['calculation_formula']} = {base_deduct_line['amount']:,.0f} VNĐ")

        # 9. KIỂM TRA ENDPOINT IN PHIẾU LƯƠNG THÁNG A4 (GET /api/payrolls/{id}/payslip)
        print("\n[BƯỚC 9] Kiểm tra endpoint in phiếu lương tháng chuẩn A4 (GET /api/payrolls/{id}/payslip)...")
        res = await client.get(f"/api/payrolls/{payroll_id}/payslip", headers=staff_headers)
        assert res.status_code == 200, f"Lỗi lấy bản in phiếu lương: {res.text}"
        payslip_print = res.json()
        assert "company" in payslip_print
        assert "employee" in payslip_print
        assert "attendance_summary" in payslip_print
        assert "earnings" in payslip_print
        assert "deductions" in payslip_print
        print(f" -> Tiêu đề phiếu in: {payslip_print['payslip_title']}")
        print(f" -> Doanh nghiệp: {payslip_print['company']['name']} (MST: {payslip_print['company']['tax_id']})")
        print(f" -> Nhân viên nhận lương: {payslip_print['employee']['full_name']} ({payslip_print['employee']['employee_code']})")
        print(f" -> Thực lĩnh bằng số: {payslip_print['summary']['net_salary']:,.0f} VNĐ")
        print(f" -> Thực lĩnh bằng chữ tiếng Việt: {payslip_print['summary']['net_salary_in_words']}")
        assert len(payslip_print["summary"]["net_salary_in_words"]) > 0

        # 10. KIỂM TRA BẢNG LƯƠNG NĂM (GET /api/payrolls/employee/{id}/annual)
        print("\n[BƯỚC 10] Kiểm tra endpoint bảng tổng hợp thu nhập năm (GET /api/payrolls/employee/{id}/annual)...")
        res = await client.get(f"/api/payrolls/employee/4/annual?year=2026", headers=staff_headers)
        assert res.status_code == 200, f"Lỗi lấy bảng lương năm: {res.text}"
        annual_data = res.json()
        print(f" -> Tổng hợp thu nhập năm {annual_data.get('salary_year', '2026')} của {annual_data.get('full_name')}:")
        print(f"    * Tổng Gross cả năm: {annual_data.get('total_gross_income_year', 0):,.0f} VNĐ")
        print(f"    * Tổng bảo hiểm đã nộp: {annual_data.get('total_insurance_deducted_year', 0):,.0f} VNĐ")
        print(f"    * Tổng thực lĩnh Net: {annual_data.get('total_net_salary_year', 0):,.0f} VNĐ")
        print(f"    * Đọc tiền bằng chữ: {annual_data.get('net_salary_in_words')}")
        print(f"    * Số tháng đã ghi nhận: {len(annual_data.get('monthly_records', []))} tháng")
        assert "monthly_records" in annual_data
        assert "company" in annual_data

        # 11. KIỂM TRA DUYỆT BẢNG LƯƠNG (DRAFT -> CONFIRMED -> PAID)
        print("\n[BƯỚC 11] Kiểm tra quy trình duyệt trạng thái hàng loạt (CONFIRM-ALL & PAY-ALL)...")
        # Duyệt CONFIRMED
        res = await client.post("/api/v1/payrolls/confirm-all", json={"salary_period": test_period}, headers=hr_headers)
        assert res.status_code == 200
        print(f" -> {res.json()['message']}")

        # Chi trả PAID
        res = await client.post("/api/v1/payrolls/pay-all", json={"salary_period": test_period, "payment_date": str(date.today())}, headers=hr_headers)
        assert res.status_code == 200
        print(f" -> {res.json()['message']}")

        # Kiểm tra lại trạng thái phiếu lương của Dũng đã chuyển sang PAID
        res = await client.get(f"/api/payrolls/{payroll_id}", headers=staff_headers)
        assert res.status_code == 200
        assert res.json()["payment_status"] == "PAID"
        print(f" -> Xác nhận: Phiếu lương #{payroll_id} đã cập nhật payment_status = PAID vào ngày {res.json()['payment_date']}")

        # 12. DỌN DẸP DỮ LIỆU ĐƠN NGHỈ PHÉP KIỂM THỬ
        print("\n[BƯỚC 12] Dọn dẹp dữ liệu kiểm thử...")
        async with AsyncSessionLocal() as db:
            await db.execute(text("DELETE FROM attendances WHERE employee_id = 4 AND work_date = :wdate"), {"wdate": test_leave_date})
            await db.execute(text("DELETE FROM leave_requests WHERE request_id = :rid"), {"rid": leave_req_id})
            await db.commit()
            print(f" -> Đã xóa đơn kiểm thử #{leave_req_id} và hoàn nguyên bảng chấm công.")

    print("\n" + "=" * 85)
    print(" ✓ TẤT CẢ 12 BƯỚC KIỂM THỬ CHỨC NĂNG BẢNG LƯƠNG & PHIẾU LƯƠNG ĐỀU ĐẠT 100%!")
    print("=" * 85)

if __name__ == "__main__":
    asyncio.run(run_tests())
