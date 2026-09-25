import asyncio
import sys
import os
import httpx
from datetime import date, timedelta

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
    print("=" * 80)
    print(" KIỂM THỬ TỰ ĐỘNG CHỨC NĂNG XIN NGHỈ PHÉP (LEAVES WORKFLOW - 2 LEVEL APPROVAL)")
    print(" TechZone HRM - Quy trình Duyệt đơn Nghỉ phép 2 Cấp (Store Manager -> HR Manager)")
    print("=" * 80)

    # Dọn dẹp dữ liệu kiểm thử cũ để đảm bảo test chạy độc lập và lặp lại nhiều lần
    async with AsyncSessionLocal() as db:
        await db.execute(text("DELETE FROM leave_requests WHERE employee_id IN (3, 4, 5)"))
        await db.commit()

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Đăng nhập các tài khoản
        print("\n[BƯỚC 1] Đăng nhập 4 tài khoản thử nghiệm các vai trò...")
        tokens = {}
        for role_user in ["admin", "hr_manager", "store_mgr_q1", "staff_dung", "tech_em"]:
            res = await client.post("/api/v1/auth/login", json={"username": role_user, "password": "123456"})
            assert res.status_code == 200, f"Đăng nhập thất bại: {role_user} ({res.text})"
            tokens[role_user] = res.json()["access_token"]
            print(f" -> Đăng nhập thành công: {role_user} ({res.json()['roles']})")

        staff_headers = {"Authorization": f"Bearer {tokens['staff_dung']}"}
        store_headers = {"Authorization": f"Bearer {tokens['store_mgr_q1']}"}
        hr_headers = {"Authorization": f"Bearer {tokens['hr_manager']}"}
        admin_headers = {"Authorization": f"Bearer {tokens['admin']}"}

        # 2. Kiểm tra danh mục loại nghỉ phép
        print("\n[BƯỚC 2] Kiểm tra danh mục loại đơn nghỉ phép (/leaves/types)...")
        res = await client.get("/api/v1/leaves/types")
        assert res.status_code == 200
        types = res.json()
        print(f" -> Tìm thấy {len(types)} loại đơn nghỉ phép:")
        for t in types:
            print(f"    * [{t['type_code']}] {t['type_name']} - Max: {t['max_days_allowed']} ngày | Hưởng lương: {t['is_paid']}")
        assert len(types) >= 6

        # 3. Tra cứu số dư phép năm ban đầu của staff_dung
        print("\n[BƯỚC 3] Tra cứu số dư phép năm cá nhân của nhân viên staff_dung (/leaves/balances/me)...")
        res = await client.get("/api/v1/leaves/balances/me", headers=staff_headers)
        assert res.status_code == 200
        init_balance = res.json()
        print(f" -> Nhân viên: {init_balance['employee_name']}")
        print(f" -> Tiêu chuẩn phép năm: {init_balance['annual_leave_total']} ngày (Thưởng thâm niên: {init_balance['seniority_bonus_days']} ngày)")
        print(f" -> Đã sử dụng: {init_balance['annual_leave_used']} ngày | Còn lại: {init_balance['annual_leave_remaining']} ngày")

        # 4. Kiểm tra các ràng buộc kiểm tra lỗi (Validations)
        print("\n[BƯỚC 4] Kiểm tra các ràng buộc & bẫy lỗi hợp lệ hóa (Validation Tests)...")
        
        # 4.1: Ngày bắt đầu > ngày kết thúc
        res = await client.post("/api/v1/leaves", headers=staff_headers, json={
            "leave_type_id": 1,
            "start_date": "2026-11-20",
            "end_date": "2026-11-10",
            "total_days": 2.0,
            "reason": "Test ngày không hợp lệ"
        })
        print(f" -> 4.1 Ngày bắt đầu > kết thúc: Status {res.status_code} ({res.json().get('detail')})")
        assert res.status_code == 400

        # 4.2: Số ngày nghỉ <= 0
        res = await client.post("/api/v1/leaves", headers=staff_headers, json={
            "leave_type_id": 1,
            "start_date": "2026-11-10",
            "end_date": "2026-11-11",
            "total_days": 0.0,
            "reason": "Test số ngày <= 0"
        })
        print(f" -> 4.2 Số ngày nghỉ = 0: Status {res.status_code} ({res.json().get('detail')})")
        assert res.status_code == 400

        # 4.3: Loại đơn không tồn tại
        res = await client.post("/api/v1/leaves", headers=staff_headers, json={
            "leave_type_id": 9999,
            "start_date": "2026-11-10",
            "end_date": "2026-11-11",
            "total_days": 2.0,
            "reason": "Test loại đơn không tồn tại"
        })
        print(f" -> 4.3 Loại đơn không tồn tại: Status {res.status_code} ({res.json().get('detail')})")
        assert res.status_code == 404

        # 4.4: Số ngày xin phép vượt quá số dư còn lại
        res = await client.post("/api/v1/leaves", headers=staff_headers, json={
            "leave_type_id": 1,
            "start_date": "2026-11-01",
            "end_date": "2026-11-30",
            "total_days": 100.0,
            "reason": "Xin quá số dư phép năm"
        })
        print(f" -> 4.4 Xin quá số dư phép năm: Status {res.status_code} ({res.json().get('detail')})")
        assert res.status_code == 400

        print(" [PASS] Hoàn tất kiểm tra 4 trường hợp validation đầu vào!")

        # 5. Nộp đơn xin nghỉ phép năm hợp lệ
        print("\n[BƯỚC 5] Nhân viên staff_dung nộp đơn nghỉ phép năm hợp lệ...")
        submit_payload = {
            "leave_type_id": 1,
            "start_date": "2026-10-15",
            "end_date": "2026-10-16",
            "total_days": 2.0,
            "reason": "Về quê có việc gia đình đột xuất",
            "attachment_url": None
        }
        res = await client.post("/api/v1/leaves", headers=staff_headers, json=submit_payload)
        assert res.status_code == 200, f"Lỗi nộp đơn: {res.text}"
        req_id = res.json()["request_id"]
        print(f" -> Nộp đơn thành công! Mã đơn: #{req_id} | Trạng thái: {res.json()['status']}")
        print(f" -> Thông báo: {res.json()['message']}")

        # 5.1: Kiểm tra chống nộp trùng lặp khoảng thời gian
        res_dup = await client.post("/api/v1/leaves", headers=staff_headers, json=submit_payload)
        print(f" -> Nộp trùng khoảng thời gian (Phải bị chặn): Status {res_dup.status_code} ({res_dup.json().get('detail')})")
        assert res_dup.status_code == 400

        # 6. Xem chi tiết đơn vừa nộp
        print(f"\n[BƯỚC 6] Xem chi tiết đơn #{req_id} (/leaves/{req_id})...")
        res = await client.get(f"/api/v1/leaves/{req_id}", headers=staff_headers)
        assert res.status_code == 200
        detail = res.json()
        print(f" -> Mã đơn: #{detail['request_id']} | Nhân viên: {detail['employee_name']} ({detail['employee_code']})")
        print(f" -> Chi nhánh: {detail['store_name']} | Phòng ban: {detail['department_name']}")
        print(f" -> Loại nghỉ: {detail['leave_type_name']} | Từ {detail['start_date']} đến {detail['end_date']} ({detail['total_days']} ngày)")
        print(f" -> Trạng thái: {detail['status']}")
        assert detail["status"] == "PENDING"

        # 7. Quy trình Duyệt Cấp 1 (Cửa hàng trưởng - Level 1 Approval)
        print("\n[BƯỚC 7] Cửa hàng trưởng store_mgr_q1 thực hiện duyệt Cấp 1...")
        approve1_res = await client.post(f"/api/v1/leaves/{req_id}/approve-store", headers=store_headers, json={
            "note": "Cửa hàng trưởng Nam đã sắp xếp ca kíp và duyệt sơ bộ Cấp 1."
        })
        assert approve1_res.status_code == 200
        print(f" -> Kết quả duyệt Cấp 1: {approve1_res.json()['message']}")
        assert approve1_res.json()["status"] == "STORE_APPROVED"

        # 7.1: Cố tình duyệt Cấp 1 lần nữa -> Phải báo lỗi
        re_app1 = await client.post(f"/api/v1/leaves/{req_id}/approve-store", headers=store_headers)
        print(f" -> Cố tình duyệt Cấp 1 lần nữa (Phải bị chặn): Status {re_app1.status_code} ({re_app1.json().get('detail')})")
        assert re_app1.status_code == 400

        # 8. Quy trình Duyệt Cấp 2 (Phòng Nhân sự - Level 2 Approval)
        print("\n[BƯỚC 8] Trưởng phòng HR (hr_manager) thực hiện duyệt chính thức Cấp 2...")
        approve2_res = await client.post(f"/api/v1/leaves/{req_id}/approve-hr", headers=hr_headers)
        assert approve2_res.status_code == 200
        print(f" -> Kết quả duyệt Cấp 2: {approve2_res.json()['message']}")
        assert approve2_res.json()["status"] == "HR_APPROVED"

        # 8.1: Kiểm tra lại số dư phép năm sau khi duyệt
        res = await client.get("/api/v1/leaves/balances/me", headers=staff_headers)
        new_balance = res.json()
        print(f" -> Số dư phép năm sau khi duyệt chính thức:")
        print(f"    * Đã sử dụng: {new_balance['annual_leave_used']} ngày (Tăng {new_balance['annual_leave_used'] - init_balance['annual_leave_used']} ngày)")
        print(f"    * Còn lại: {new_balance['annual_leave_remaining']} ngày")
        assert new_balance["annual_leave_used"] == init_balance["annual_leave_used"] + 2.0

        # 9. Kiểm tra quy trình Từ chối đơn (Reject Workflow)
        print("\n[BƯỚC 9] Kiểm tra quy trình Từ chối đơn (Reject Workflow)...")
        # Nhân viên nộp một đơn khác
        res = await client.post("/api/v1/leaves", headers=staff_headers, json={
            "leave_type_id": 4, # Việc riêng
            "start_date": "2026-11-25",
            "end_date": "2026-11-26",
            "total_days": 2.0,
            "reason": "Xin nghỉ việc riêng thử nghiệm"
        })
        assert res.status_code == 200
        reject_req_id = res.json()["request_id"]
        
        # Cửa hàng trưởng từ chối với lý do
        reject_res = await client.post(f"/api/v1/leaves/{reject_req_id}/reject", headers=store_headers, json={
            "rejection_reason": "Chi nhánh đang thiếu nhân sự trong đợt cao điểm Black Friday."
        })
        assert reject_res.status_code == 200
        print(f" -> Kết quả từ chối đơn: {reject_res.json()['message']}")
        assert reject_res.json()["status"] == "REJECTED"

        # Đơn đã từ chối không thể duyệt Cấp 2
        hr_try_approve = await client.post(f"/api/v1/leaves/{reject_req_id}/approve-hr", headers=hr_headers)
        print(f" -> Cố duyệt đơn đã bị từ chối: Status {hr_try_approve.status_code} ({hr_try_approve.json().get('detail')})")
        assert hr_try_approve.status_code == 400

        # 10. Kiểm tra quy trình Hủy đơn (Cancel Workflow)
        print("\n[BƯỚC 10] Kiểm tra quy trình Nhân viên tự hủy đơn (Cancel Workflow)...")
        res = await client.post("/api/v1/leaves", headers=staff_headers, json={
            "leave_type_id": 5, # Không lương
            "start_date": "2026-12-05",
            "end_date": "2026-12-06",
            "total_days": 2.0,
            "reason": "Kế hoạch cá nhân thay đổi"
        })
        cancel_req_id = res.json()["request_id"]
        cancel_res = await client.post(f"/api/v1/leaves/{cancel_req_id}/cancel", headers=staff_headers)
        assert cancel_res.status_code == 200
        print(f" -> Kết quả hủy đơn: {cancel_res.json()['message']}")
        assert cancel_res.json()["status"] == "CANCELLED"

        # 11. Kiểm tra Ma trận phân quyền xem danh sách đơn (RBAC Matrix)
        print("\n[BƯỚC 11] Kiểm tra Ma trận phân quyền xem danh sách đơn (RBAC)...")
        
        # 11.1 Nhân viên thường staff_dung chỉ thấy đơn của mình
        res = await client.get("/api/v1/leaves", headers=staff_headers)
        staff_leaves = res.json()
        print(f" -> Nhân viên staff_dung thấy {len(staff_leaves)} đơn (Toàn bộ employee_id={staff_leaves[0]['employee_id']})")
        assert all(l["employee_id"] == 4 for l in staff_leaves)

        # 11.2 Cửa hàng trưởng store_mgr_q1 thấy đơn của chi nhánh Q1
        res = await client.get("/api/v1/leaves", headers=store_headers)
        store_leaves = res.json()
        print(f" -> Cửa hàng trưởng Q1 thấy {len(store_leaves)} đơn thuộc chi nhánh mình")
        assert all(l["store_id"] == 1 or l["employee_id"] == 3 for l in store_leaves)

        # 11.3 HR Manager và Admin thấy toàn bộ chuỗi
        res = await client.get("/api/v1/leaves", headers=hr_headers)
        hr_leaves = res.json()
        print(f" -> HR Manager thấy toàn bộ {len(hr_leaves)} đơn trong toàn hệ thống TechZone")
        assert len(hr_leaves) >= len(store_leaves)

        # 12. Kiểm tra Thống kê & Calendar View
        print("\n[BƯỚC 12] Kiểm tra Dashboard KPI stats và Lịch nghỉ phép (Calendar View)...")
        stats_res = await client.get("/api/v1/leaves/summary/stats", headers=hr_headers)
        assert stats_res.status_code == 200
        stats = stats_res.json()
        print(f" -> Dashboard Stats toàn chuỗi:")
        print(f"    * Tổng số đơn: {stats['total_requests']}")
        print(f"    * Chờ Cửa hàng trưởng duyệt (Level 1): {stats['pending_store_approval']}")
        print(f"    * Chờ HR duyệt (Level 2): {stats['pending_hr_approval']}")
        print(f"    * Đã duyệt: {stats['approved']} | Từ chối: {stats['rejected']}")

        cal_res = await client.get("/api/v1/leaves/calendar?month=2026-10", headers=hr_headers)
        assert cal_res.status_code == 200
        cal = cal_res.json()
        print(f" -> Lịch nghỉ phép tháng 2026-10: {len(cal)} đơn được duyệt")

        # 13. Kiểm tra bí danh tuyến đường Workflow (/leave-requests và /approve-level1, /approve-level2)
        print("\n[BƯỚC 13] Kiểm tra tính tương thích của Router alias (/leave-requests)...")
        res_alias = await client.get("/api/v1/leave-requests", headers=hr_headers)
        assert res_alias.status_code == 200
        print(f" -> GET /api/v1/leave-requests: OK (Tìm thấy {len(res_alias.json())} đơn)")

        # 14. Kiểm tra Nhật ký Audit Logs tự động ghi nhận
        print("\n[BƯỚC 14] Kiểm tra Nhật ký thanh tra (Audit Logs) đã lưu vết đầy đủ...")
        audit_res = await client.get("/api/v1/audit-logs?limit=10", headers=admin_headers)
        assert audit_res.status_code == 200
        logs = audit_res.json()
        leave_actions = [l["action"] for l in logs if "LEAVE" in l["action"]]
        print(f" -> Các hành động nghỉ phép được ghi vết gần nhất: {set(leave_actions)}")
        assert "CREATE_LEAVE_REQUEST" in leave_actions
        assert "APPROVE_LEAVE_LEVEL1" in leave_actions
        assert "APPROVE_LEAVE_LEVEL2" in leave_actions

        # 15. Kiểm tra trường hợp đặc biệt: HR HỦY DUYỆT & TỪ CHỐI ĐƠN ĐÃ ĐƯỢC DUYỆT CHÍNH THỨC
        print("\n[BƯỚC 15] Kiểm tra nghiệp vụ: HR Thu hồi / Từ chối đơn đã từng được HR duyệt chính thức...")
        # Đơn req_id đã được duyệt ở Bước 8 (HR_APPROVED)
        # 15.1 Cửa hàng trưởng CỐ TỪ CHỐI đơn đã HR_APPROVED -> Bị chặn 403
        cht_try_reject = await client.post(f"/api/v1/leaves/{req_id}/reject", headers=store_headers, json={
            "rejection_reason": "Cửa hàng trưởng muốn hủy đơn này"
        })
        print(f" -> Cửa hàng trưởng cố từ chối đơn đã HR duyệt (Phải bị chặn 403): Status {cht_try_reject.status_code} ({cht_try_reject.json().get('detail')})")
        assert cht_try_reject.status_code == 403

        # 15.2 HR Manager thực hiện Hủy duyệt & Từ chối đơn
        hr_revoke_res = await client.post(f"/api/v1/leaves/{req_id}/reject", headers=hr_headers, json={
            "rejection_reason": "Nhân viên Phạm Quốc Dũng thông báo hủy chuyến đi và xin đi làm lại bình thường."
        })
        assert hr_revoke_res.status_code == 200
        print(f" -> HR Manager hủy duyệt & từ chối: {hr_revoke_res.json()['message']}")

        # 15.3 Kiểm tra lại chi tiết đơn: Phải hiển thị status REJECTED, rõ người từ chối và vết đã duyệt
        revoked_detail_res = await client.get(f"/api/v1/leaves/{req_id}", headers=staff_headers)
        assert revoked_detail_res.status_code == 200
        revoked_detail = revoked_detail_res.json()
        print(f" -> Chi tiết đơn sau khi bị HR hủy duyệt & từ chối:")
        print(f"    * Trạng thái đơn: {revoked_detail['status']}")
        print(f"    * Người từ chối: {revoked_detail['rejected_by_name']} (Vai trò: {revoked_detail['rejected_by_role']})")
        print(f"    * Thời gian từ chối: {revoked_detail['rejected_at']}")
        print(f"    * Lý do từ chối: {revoked_detail['rejection_reason']}")
        print(f"    * Dấu vết đã từng được HR duyệt: {revoked_detail['hr_approved_at']} (bởi {revoked_detail['hr_approver_name']})")
        assert revoked_detail["status"] == "REJECTED"
        assert revoked_detail["rejected_by_name"] == "Trần Thị Bình"
        assert revoked_detail["rejected_by_role"] == "Phòng Nhân sự"
        assert revoked_detail["hr_approved_at"] is not None

        # 15.4 Kiểm tra số dư phép năm: Phải được hoàn lại (không còn bị trừ 2 ngày)
        restored_balance_res = await client.get("/api/v1/leaves/balances/me", headers=staff_headers)
        assert restored_balance_res.status_code == 200
        restored_balance = restored_balance_res.json()
        print(f" -> Số dư phép năm sau khi hoàn trả:")
        print(f"    * Đã sử dụng: {restored_balance['annual_leave_used']} ngày")
        print(f"    * Còn lại: {restored_balance['annual_leave_remaining']} ngày")
        assert restored_balance["annual_leave_used"] == init_balance["annual_leave_used"]

        # 16. KIỂM TRA RÀNG BUỘC SỐ NGÀY NGHỈ TỐI ĐA THEO TỪNG LOẠI (MAX_DAYS_ALLOWED)
        print("\n[BƯỚC 16] Kiểm tra ràng buộc số ngày nghỉ tối đa theo từng loại nghỉ (max_days_allowed)...")
        # Loại nghỉ 4 (VIEC_RIENG) có max_days_allowed = 3 ngày. Thử nộp 4 ngày -> Phải bị chặn 400
        res_exceed_viec_rieng = await client.post("/api/v1/leaves", headers=staff_headers, json={
            "leave_type_id": 4, # Việc riêng (Tối đa 3 ngày)
            "start_date": "2026-12-10",
            "end_date": "2026-12-13",
            "total_days": 4.0, # Vượt quá 3 ngày
            "reason": "Thử xin việc riêng quá 3 ngày"
        })
        print(f" -> 16.1 Thử nộp đơn Việc riêng 4 ngày (> 3 ngày): Status {res_exceed_viec_rieng.status_code}")
        print(f"    Chi tiết lỗi: {res_exceed_viec_rieng.json().get('detail')}")
        assert res_exceed_viec_rieng.status_code == 400
        assert "chỉ được nghỉ tối đa 3 ngày" in res_exceed_viec_rieng.json().get("detail", "")

        # Thử nộp đúng 3 ngày -> Phải thành công 200
        res_valid_viec_rieng = await client.post("/api/v1/leaves", headers=staff_headers, json={
            "leave_type_id": 4,
            "start_date": "2026-12-10",
            "end_date": "2026-12-12",
            "total_days": 3.0,
            "reason": "Xin việc riêng đúng 3 ngày quy định"
        })
        print(f" -> 16.2 Nộp đơn Việc riêng đúng 3 ngày: Status {res_valid_viec_rieng.status_code} (Mã #{res_valid_viec_rieng.json().get('request_id')})")
        assert res_valid_viec_rieng.status_code == 200

        # 17. KIỂM TRA PHÂN CẤP DUYỆT ĐƠN CỦA CỬA HÀNG TRƯỞNG (STORE MANAGER LEAVE WORKFLOW)
        print("\n[BƯỚC 17] Kiểm tra quy trình nộp & phân cấp duyệt đơn của Cửa hàng trưởng...")
        
        # 17.1 Cửa hàng trưởng (store_mgr_q1 - employee_id 3) nộp đơn xin nghỉ
        cht_submit_res = await client.post("/api/v1/leaves", headers=store_headers, json={
            "leave_type_id": 1, # Phép năm
            "start_date": "2026-12-20",
            "end_date": "2026-12-21",
            "total_days": 2.0,
            "reason": "Cửa hàng trưởng xin nghỉ phép năm đi công việc cá nhân"
        })
        assert cht_submit_res.status_code == 200
        cht_req_id = cht_submit_res.json()["request_id"]
        print(f" -> 17.1 CHT nộp đơn thành công: Mã đơn #{cht_req_id} | Trạng thái: {cht_submit_res.json()['status']}")
        print(f"    Thông báo hệ thống: {cht_submit_res.json().get('message')}")

        # 17.2 Cửa hàng trưởng CỐ TỰ DUYỆT ĐƠN CỦA CHÍNH MÌNH -> Phải bị chặn 400/403
        cht_self_approve = await client.post(f"/api/v1/leaves/{cht_req_id}/approve-store", headers=store_headers, json={
            "note": "Tôi tự duyệt đơn cho mình"
        })
        print(f" -> 17.2 CHT tự duyệt đơn của mình (Phải bị chặn): Status {cht_self_approve.status_code}")
        print(f"    Chi tiết lỗi: {cht_self_approve.json().get('detail')}")
        assert cht_self_approve.status_code in (400, 403)

        # 17.3 HR kiểm tra danh sách đơn: Đơn của CHT phải được đánh dấu is_store_manager_request = True
        cht_req_detail = await client.get(f"/api/v1/leaves/{cht_req_id}", headers=hr_headers)
        assert cht_req_detail.status_code == 200
        cht_info = cht_req_detail.json()
        print(f" -> 17.3 Thuộc tính đơn CHT: is_store_manager_request = {cht_info.get('is_store_manager_request')} | Chức vụ: {cht_info.get('position_name')}")
        assert cht_info.get("is_store_manager_request") is True

        # 17.4 HR duyệt thẳng đơn của Cửa hàng trưởng từ trạng thái PENDING -> Phải thành công 200
        hr_approve_cht = await client.post(f"/api/v1/leaves/{cht_req_id}/approve-hr", headers=hr_headers)
        print(f" -> 17.4 HR duyệt trực tiếp đơn của CHT: Status {hr_approve_cht.status_code} ({hr_approve_cht.json().get('message')})")
        assert hr_approve_cht.status_code == 200

        # Kiểm tra trạng thái cuối cùng của đơn CHT
        cht_after_approved = await client.get(f"/api/v1/leaves/{cht_req_id}", headers=hr_headers)
        assert cht_after_approved.json()["status"] == "HR_APPROVED"
        assert cht_after_approved.json()["hr_approver_name"] == "Trần Thị Bình"
        print(f" -> 17.5 Đơn của CHT đã hoàn tất duyệt chính thức bởi HR: Trạng thái {cht_after_approved.json()['status']}")

        # 17.6 Thử nghiệm: HR có thể duyệt thẳng (Cấp 2) đơn PENDING của nhân viên chi nhánh trước khi CHT duyệt Cấp 1
        staff_pending_res = await client.post("/api/v1/leaves", headers=staff_headers, json={
            "leave_type_id": 1,
            "start_date": "2026-12-28",
            "end_date": "2026-12-29",
            "total_days": 2.0,
            "reason": "Đơn test HR duyệt thẳng Cấp 2 trước khi CHT duyệt Cấp 1"
        })
        staff_pending_id = staff_pending_res.json()["request_id"]
        hr_approve_direct = await client.post(f"/api/v1/leaves/{staff_pending_id}/approve-hr", headers=hr_headers)
        print(f" -> 17.6 HR duyệt thẳng đơn PENDING của nhân viên thường: Status {hr_approve_direct.status_code}")
        print(f"    Thông báo: {hr_approve_direct.json().get('message')}")
        assert hr_approve_direct.status_code == 200
        assert hr_approve_direct.json()["status"] == "HR_APPROVED"

        # Kiểm tra chi tiết đơn sau khi HR duyệt thẳng: store_approved_at là None, hr_approved_at có dữ liệu
        staff_after_approved = await client.get(f"/api/v1/leaves/{staff_pending_id}", headers=hr_headers)
        staff_data = staff_after_approved.json()
        assert staff_data["status"] == "HR_APPROVED"
        assert staff_data["store_approved_at"] is None
        assert staff_data["hr_approved_at"] is not None
        assert staff_data["hr_approver_name"] == "Trần Thị Bình"
        print(f" -> 17.7 Xác nhận: Đơn nhân viên thường đã được HR duyệt thẳng hoàn tất, CHT stage không áp dụng (store_approved_at is None).")

    print("\n" + "=" * 80)
    print(" KẾT QUẢ KIỂM THỬ: TOÀN BỘ 17 BƯỚC TEST PASS 100% THÀNH CÔNG RỰC RỠ!")
    print(" CHỨC NĂNG NGHỈ PHÉP (LEAVES WORKFLOW 2 CẤP, RÀNG BUỘC NGÀY NGHỈ & PHÂN CẤP CHT) HOÀN HẢO!")
    print("=" * 80)

if __name__ == "__main__":
    asyncio.run(run_tests())
