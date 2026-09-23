import asyncio
import sys
import os
import httpx

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

# Đảm bảo import được app
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from app.main import app

# 5 Tài khoản thử nghiệm chuẩn của dự án TechZone
TEST_ACCOUNTS = [
    {"username": "admin", "expected_role": "ADMIN", "desc": "Quản trị viên toàn hệ thống"},
    {"username": "hr_manager", "expected_role": "HR_MANAGER", "desc": "Trưởng phòng Nhân sự"},
    {"username": "store_mgr_q1", "expected_role": "STORE_MANAGER", "desc": "Cửa hàng trưởng Quận 1"},
    {"username": "staff_dung", "expected_role": "EMPLOYEE", "desc": "Nhân viên Bán hàng xuất sắc"},
    {"username": "tech_em", "expected_role": "EMPLOYEE", "desc": "Kỹ thuật viên Sửa chữa"}
]

async def run_tests():
    print("=" * 70)
    print(" BẮT ĐẦU KIỂM THỬ TỰ ĐỘNG: FASTAPI + SUPABASE DB + AUTH + RBAC")
    print(" Sinh viên thực hiện: Huỳnh Viễn Thông (Lead / Backend)")
    print("=" * 70)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # -------------------------------------------------------------
        # TEST 1: Kiểm tra kết nối CSDL Supabase qua /health
        # -------------------------------------------------------------
        print("\n[TEST 1] Kiểm tra sức khỏe hệ thống & CSDL Supabase Cloud (/api/v1/health)...")
        res = await client.get("/api/v1/health")
        assert res.status_code == 200, f"Expected 200, got {res.status_code}"
        data = res.json()
        print(f" -> Trạng thái: {data['status']}")
        print(f" -> Kết nối Database: {data['database']}")
        assert data["database"] == "connected", "CSDL Supabase chưa kết nối thành công!"
        print(" [PASS] TEST 1 thành công: CSDL Supabase PostgreSQL đã kết nối thông suốt!")

        # -------------------------------------------------------------
        # TEST 2: Kiểm tra danh sách 5 tài khoản test (/auth/test-accounts)
        # -------------------------------------------------------------
        print("\n[TEST 2] Lấy danh sách 5 tài khoản test demo (/api/v1/auth/test-accounts)...")
        res = await client.get("/api/v1/auth/test-accounts")
        assert res.status_code == 200
        accounts = res.json()
        print(f" -> Số tài khoản demo: {len(accounts)}")
        for acc in accounts:
            print(f"    * {acc['username']} ({acc['role']}): {acc['name']}")
        assert len(accounts) == 5
        print(" [PASS] TEST 2 thành công: Danh sách tài khoản test đầy đủ!")

        # -------------------------------------------------------------
        # TEST 3: Đăng nhập & Xác thực JWT Token cho từng vai trò
        # -------------------------------------------------------------
        print("\n[TEST 3] Đăng nhập 5 tài khoản với mật khẩu '123456' & xác thực JWT...")
        tokens = {}
        for acc in TEST_ACCOUNTS:
            username = acc["username"]
            payload = {"username": username, "password": "123456"}
            res = await client.post("/api/v1/auth/login", json=payload)
            assert res.status_code == 200, f"Đăng nhập thất bại cho {username}: {res.text}"
            token_data = res.json()
            token = token_data["access_token"]
            roles = token_data["roles"]
            full_name = token_data["full_name"]
            tokens[username] = token
            
            print(f" -> [OK] Đăng nhập '{username}' thành công!")
            print(f"    Họ tên: {full_name} | Roles: {roles} | Token: {token[:25]}...")
            assert acc["expected_role"] in roles, f"Vai trò {acc['expected_role']} không có trong {roles}"

        print(" [PASS] TEST 3 thành công: Toàn bộ 5 tài khoản xác thực thành công và nhận JWT Token!")

        # -------------------------------------------------------------
        # TEST 4: Truy vấn thông tin tài khoản hiện tại (/auth/me)
        # -------------------------------------------------------------
        print("\n[TEST 4] Kiểm tra endpoint /api/v1/auth/me với từng Token...")
        for username, token in tokens.items():
            headers = {"Authorization": f"Bearer {token}"}
            res = await client.get("/api/v1/auth/me", headers=headers)
            assert res.status_code == 200
            profile = res.json()
            print(f" -> Profile '{username}': {profile['full_name']} | Chức vụ: {profile.get('position_name')} | Chi nhánh: {profile.get('store_name')}")
            assert profile["username"] == username
            assert profile["is_active"] is True
            assert len(profile["permissions"]) > 0 or "ADMIN" in profile["roles"]

        print(" [PASS] TEST 4 thành công: Endpoint /auth/me trả về đúng thông tin chi tiết!")

        # -------------------------------------------------------------
        # TEST 5: Kiểm tra phân quyền RBAC (Role-Based Access Control)
        # -------------------------------------------------------------
        print("\n[TEST 5] Kiểm tra Ma trận phân quyền RBAC...")
        admin_headers = {"Authorization": f"Bearer {tokens['admin']}"}
        staff_headers = {"Authorization": f"Bearer {tokens['staff_dung']}"}
        hr_headers = {"Authorization": f"Bearer {tokens['hr_manager']}"}

        # 5.1: Admin xem Audit Logs -> 200 OK
        res = await client.get("/api/v1/audit-logs", headers=admin_headers)
        print(f" -> Admin truy cập /audit-logs: Status {res.status_code}")
        assert res.status_code == 200

        # 5.2: Nhân viên thường (staff_dung) xem Audit Logs -> Phải bị chặn 403 Forbidden!
        res = await client.get("/api/v1/audit-logs", headers=staff_headers)
        print(f" -> Staff truy cập /audit-logs (Phải bị chặn): Status {res.status_code} ({res.json().get('detail')})")
        assert res.status_code == 403, f"Expected 403, got {res.status_code}"

        # 5.3: HR Manager truy cập danh sách Users -> 200 OK
        res = await client.get("/api/v1/users", headers=hr_headers)
        print(f" -> HR Manager truy cập /users: Status {res.status_code} (Tìm thấy {len(res.json())} users)")
        assert res.status_code == 200

        # 5.4: Staff truy cập danh sách Users -> Phải bị chặn 403 Forbidden!
        res = await client.get("/api/v1/users", headers=staff_headers)
        print(f" -> Staff truy cập /users (Phải bị chặn): Status {res.status_code} ({res.json().get('detail')})")
        assert res.status_code == 403

        # 5.5: Không có Token truy cập /auth/me -> Phải bị chặn 401 Unauthorized!
        res = await client.get("/api/v1/auth/me")
        print(f" -> Không kèm Token truy cập /auth/me: Status {res.status_code} ({res.json().get('detail')})")
        assert res.status_code == 401

        print(" [PASS] TEST 5 thành công: Cơ chế RBAC kiểm soát quyền cực kỳ chuẩn xác!")

        # -------------------------------------------------------------
        # TEST 6: Kiểm tra Danh sách Roles & Ma trận RBAC Matrix
        # -------------------------------------------------------------
        print("\n[TEST 6] Lấy danh sách Roles & Ma trận phân quyền RBAC Matrix...")
        res = await client.get("/api/v1/roles/matrix", headers=admin_headers)
        assert res.status_code == 200
        matrix = res.json()
        print(f" -> Tổng số quyền trong ma trận RBAC: {len(matrix)} permissions")
        for item in matrix[:5]:
            roles_granted = [r for r, val in item["roles"].items() if val]
            print(f"    * [{item['module']}] {item['permission_code']}: {', '.join(roles_granted)}")

        print(" [PASS] TEST 6 thành công: Ma trận RBAC hiển thị đầy đủ chi tiết!")

        # -------------------------------------------------------------
        # TEST 7: Kiểm tra Ghi nhận Nhật ký Hệ thống (Audit Logs)
        # -------------------------------------------------------------
        print("\n[TEST 7] Xác minh nhật ký thanh tra (Audit Logs) đã tự động ghi lại...")
        res = await client.get("/api/v1/audit-logs?limit=5", headers=admin_headers)
        assert res.status_code == 200
        logs = res.json()
        print(f" -> Đã ghi nhận {len(logs)} log gần nhất:")
        for log in logs:
            print(f"    * Log #{log['log_id']} | User: {log['username']} | Action: {log['action']} | Time: {log['created_at']}")
        assert len(logs) > 0
        assert any(l["action"] == "LOGIN" for l in logs)

        print(" [PASS] TEST 7 thành công: Nhật ký Audit Log tự động lưu vết chính xác!")

    print("\n" + "=" * 70)
    print(" KẾT QUẢ KIỂM THỬ: 7/7 CA KIỂM THỬ ĐẠT 100% (PASS)")
    print(" PHÂN HỆ SETUP + DB, AUTH + RBAC ĐÃ HOÀN TẤT XUẤT SẮC!")
    print("=" * 70)

if __name__ == "__main__":
    asyncio.run(run_tests())
