import asyncio
import sys
from app.core.database import AsyncSessionLocal
from sqlalchemy import text
from app.core.security import get_password_hash
from app.api.v1.endpoints.users import (
    get_all_users,
    get_user_by_id,
    create_user,
    update_user,
    reset_user_password,
    delete_user,
    update_user_status
)
from app.schemas.schemas import UserCreate, UserUpdate, AdminResetPassword

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

class DummyRequest:
    client = type('Client', (), {'host': '127.0.0.1'})()

async def run_tests():
    print("=== BẮT ĐẦU KIỂM THỬ USER MANAGEMENT API ===")
    admin_user = {"user_id": 1, "username": "admin", "roles": ["ADMIN"]}

    async with AsyncSessionLocal() as db:
        # 1. Test get_all_users
        print("\n[TEST 1] get_all_users()...")
        users = await get_all_users(db=db, current_user=admin_user)
        print(f"-> Thành công! Số tài khoản hiện có: {len(users)}")
        if users:
            u0 = users[0]
            print(f"   Ví dụ: {u0['username']} (Roles: {u0['roles']}, NV: {u0['full_name']}, Store: {u0['store_name']})")

        # Clean up any leftover test user
        await db.execute(text("DELETE FROM user_roles WHERE user_id IN (SELECT user_id FROM users WHERE username = 'test_hrm_user');"))
        await db.execute(text("DELETE FROM users WHERE username = 'test_hrm_user';"))
        await db.commit()

        # 2. Test create_user
        print("\n[TEST 2] create_user()...")
        # Find an employee to link
        emp_res = await db.execute(text("SELECT employee_id, full_name, employee_code FROM employees LIMIT 1;"))
        first_emp = emp_res.mappings().first()
        target_emp_id = first_emp["employee_id"] if first_emp else None

        # Check if already linked
        if target_emp_id:
            already = await db.execute(text("SELECT user_id FROM users WHERE employee_id = :eid;"), {"eid": target_emp_id})
            if already.mappings().first():
                target_emp_id = None # don't link if already taken

        new_user_in = UserCreate(
            username="test_hrm_user",
            password="InitialPassword123!",
            email="test_hrm_user@techzone.vn",
            phone="0911223344",
            employee_id=target_emp_id,
            role_ids=[4] # EMPLOYEE
        )
        created = await create_user(
            request=DummyRequest(),
            user_in=new_user_in,
            db=db,
            current_user=admin_user
        )
        created_id = created["user_id"]
        print(f"-> Tạo thành công user_id={created_id}, username={created['username']}, roles={created['roles']}")

        # 3. Test get_user_by_id
        print("\n[TEST 3] get_user_by_id()...")
        fetched = await get_user_by_id(user_id=created_id, db=db, current_user=admin_user)
        assert fetched["username"] == "test_hrm_user"
        print(f"-> Lấy chi tiết thành công: {fetched['username']} - {fetched['email']}")

        # 4. Test update_user (email, phone)
        print("\n[TEST 4] update_user()...")
        update_in = UserUpdate(
            email="updated_test_hrm@techzone.vn",
            phone="0999888777",
            employee_id=None
        )
        updated = await update_user(
            user_id=created_id,
            user_in=update_in,
            request=DummyRequest(),
            db=db,
            current_user=admin_user
        )
        assert updated["email"] == "updated_test_hrm@techzone.vn"
        assert updated["phone"] == "0999888777"
        print(f"-> Cập nhật thành công! Email mới: {updated['email']}, SĐT mới: {updated['phone']}")

        # 5. Test reset_user_password
        print("\n[TEST 5] reset_user_password()...")
        reset_res = await reset_user_password(
            user_id=created_id,
            body=AdminResetPassword(new_password="NewSecurePass2026!"),
            request=DummyRequest(),
            db=db,
            current_user=admin_user
        )
        print(f"-> Đặt lại mật khẩu thành công: {reset_res['message']}")

        # 6. Test update_user_status (Lock / Unlock)
        print("\n[TEST 6] update_user_status (Khóa/Mở khóa)...")
        lock_res = await update_user_status(
            user_id=created_id,
            is_active=False,
            request=DummyRequest(),
            db=db,
            current_user=admin_user
        )
        print(f"-> Khóa thành công: is_active={lock_res['is_active']}")

        unlock_res = await update_user_status(
            user_id=created_id,
            is_active=True,
            request=DummyRequest(),
            db=db,
            current_user=admin_user
        )
        print(f"-> Mở khóa thành công: is_active={unlock_res['is_active']}")

        # 7. Test delete_user
        print("\n[TEST 7] delete_user()...")
        del_res = await delete_user(
            user_id=created_id,
            request=DummyRequest(),
            db=db,
            current_user=admin_user
        )
        print(f"-> Xóa thành công: action={del_res['action']} - {del_res['message']}")

        # Verify deleted
        verify_del = await db.execute(text("SELECT user_id FROM users WHERE user_id = :id;"), {"id": created_id})
        assert verify_del.mappings().first() is None
        print("-> Đã kiểm tra lại: tài khoản không còn trong database.")

    print("\n=== TẤT CẢ TEST ĐÃ VƯỢT QUA 100% HOÀN HẢO! ===")

if __name__ == "__main__":
    asyncio.run(run_tests())
