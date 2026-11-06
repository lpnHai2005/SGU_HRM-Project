"""
Test suite covering all mandatory acceptance criteria for:
- Overdue Open Sessions identification and non-blocking rules (Option 3)
- HR Review & Resolution workflow (Option 2) with audit trail preservation
- Overnight shifts and active shift protections
- Targeted checkout by attendance_id
- RBAC permissions (employees rejected with 403)
- Payroll isolation (overdue unverified sessions excluded from hours)
"""
import pytest
from datetime import datetime, date, time, timedelta, timezone
from starlette.requests import Request
from sqlalchemy import text
from fastapi import HTTPException

from app.core.database import async_session_maker, engine
from app.core.attendance import VIETNAM_TZ, availability, require_available, is_session_overdue
from app.api.v1.endpoints.operations import (
    resolve_attendance_session,
    ResolveSessionRequest,
    enrich_session_record
)
from app.api.v1.endpoints.attendances import check_out, CheckOutRequest

@pytest.mark.asyncio
async def test_01_overdue_22_days_session_recognized_no_synthetic_checkout():
    """1. Phiên mở 22 ngày được nhận diện quá hạn, không tự sinh checkout."""
    await engine.dispose()
    async with async_session_maker() as session:
        # Kiểm tra phiên 41 thực tế trong DB
        res = await session.execute(text("SELECT * FROM attendances WHERE attendance_id = 41"))
        row = dict(res.mappings().first())

        # 1.1 Phải là phiên mở và check_out_time vẫn giữ NULL tuyệt đối
        assert row["check_in_time"] is not None
        assert row["check_out_time"] is None
        assert float(row["actual_work_hours"] or 0) == 0.0

        # 1.2 is_session_overdue phải trả về True
        now = datetime.now(VIETNAM_TZ)
        assert is_session_overdue(row, now) is True

        # 1.3 enrich_session_record phải gắn cờ OVERDUE_OPEN_SESSION và payroll_hold
        enriched = enrich_session_record(row)
        assert "OVERDUE_OPEN_SESSION" in enriched["quality_flags"]
        assert enriched["payroll_hold"] is True
        assert enriched["is_overdue_open_session"] is True


@pytest.mark.asyncio
async def test_02_overdue_session_does_not_block_new_checkin():
    """2. Phiên quá hạn và có lịch mới: Cho phép check-in mới sau khi phân loại phiên cũ."""
    now = datetime(2026, 11, 5, 8, 30, tzinfo=VIETNAM_TZ)
    # Giả lập phiên cũ từ 22 ngày trước
    overdue_session = {
        "attendance_id": 41,
        "employee_id": 4,
        "work_date": date(2026, 10, 14),
        "check_in_time": datetime(2026, 10, 14, 10, 44, tzinfo=VIETNAM_TZ),
        "check_out_time": None,
        "start_time": time(8, 0),
        "end_time": time(21, 0)
    }
    avail = availability(overdue_session, now)
    assert avail["can_check_in"] is True
    assert avail["is_overdue_open"] is True
    assert avail["is_active_session"] is False

    # require_available không được ném HTTPException 409
    try:
        require_available(overdue_session, now)
    except HTTPException:
        pytest.fail("require_available must not block check-in when session is overdue!")


@pytest.mark.asyncio
async def test_03_active_same_day_session_blocks_concurrent_checkin():
    """3. Phiên đang làm trong ngày: Vẫn chặn check-in trùng."""
    now = datetime(2026, 11, 5, 10, 0, tzinfo=VIETNAM_TZ)
    # Ca sáng 08:00 - 16:00, check in lúc 08:00, hiện tại 10:00 (vẫn trong ca)
    active_session = {
        "attendance_id": 501,
        "employee_id": 4,
        "work_date": date(2026, 11, 5),
        "check_in_time": datetime(2026, 11, 5, 8, 0, tzinfo=VIETNAM_TZ),
        "check_out_time": None,
        "start_time": time(8, 0),
        "end_time": time(16, 0)
    }
    avail = availability(active_session, now)
    assert avail["can_check_in"] is False
    assert avail["is_active_session"] is True
    assert avail["is_overdue_open"] is False

    with pytest.raises(HTTPException) as exc_info:
        require_available(active_session, now)
    assert exc_info.value.status_code == 409
    assert "chưa check-out" in exc_info.value.detail or "Bạn phải check-out" in exc_info.value.detail


def test_04_overnight_shift_not_falsely_marked_overdue():
    """4. Ca qua đêm: Không bị nhận nhầm là quá hạn khi đang trong ca hoặc trong grace window."""
    # Ca đêm 22:00 ngày 05/11 đến 06:00 ngày 06/11
    overnight_session = {
        "attendance_id": 502,
        "employee_id": 4,
        "work_date": date(2026, 11, 5),
        "check_in_time": datetime(2026, 11, 5, 22, 0, tzinfo=VIETNAM_TZ),
        "check_out_time": None,
        "start_time": time(22, 0),
        "end_time": time(6, 0) # end_time <= start_time
    }

    # 4.1 Lúc 02:00 sáng ngày 06/11 (giữa ca đêm): Phải đang active, KHÔNG quá hạn
    mid_shift = datetime(2026, 11, 6, 2, 0, tzinfo=VIETNAM_TZ)
    assert is_session_overdue(overnight_session, mid_shift) is False
    avail_mid = availability(overnight_session, mid_shift)
    assert avail_mid["is_active_session"] is True
    assert avail_mid["can_check_in"] is False

    # 4.2 Lúc 07:30 sáng ngày 06/11 (vừa hết ca 1.5h, trong grace window 6h): KHÔNG quá hạn
    grace_window = datetime(2026, 11, 6, 7, 30, tzinfo=VIETNAM_TZ)
    assert is_session_overdue(overnight_session, grace_window) is False

    # 4.3 Lúc 14:00 chiều ngày 06/11 (sau giờ hết ca 8h > grace 6h): ĐÃ quá hạn
    after_grace = datetime(2026, 11, 6, 14, 0, tzinfo=VIETNAM_TZ)
    assert is_session_overdue(overnight_session, after_grace) is True


@pytest.mark.asyncio
async def test_05_checkout_targets_specific_attendance_id():
    """5. Checkout phiên mới: Chỉ đóng đúng attendance_id được chọn."""
    await engine.dispose()
    async with async_session_maker() as session:
        # Tạo test session tạm thời
        test_date = date(2026, 11, 4)
        await session.execute(text("DELETE FROM attendances WHERE employee_id = 4 AND work_date = :d"), {"d": test_date})

        insert_res = await session.execute(text("""
            INSERT INTO attendances (employee_id, store_id, shift_id, work_date, check_in_time, status)
            VALUES (4, 2, 1, :d, '2026-11-04 08:00:00+07', 'NORMAL')
            RETURNING attendance_id
        """), {"d": test_date})
        new_att_id = insert_res.scalar_one()
        await session.commit()

        try:
            # Gọi check_out với attendance_id chỉ định
            user = {"employee_id": 4, "roles": ["EMPLOYEE"]}
            res = await check_out(CheckOutRequest(attendance_id=new_att_id), current_user=user, db=session)
            assert res["attendance_id"] == new_att_id

            # Kiểm tra trong DB: chỉ đúng new_att_id được cập nhật check_out_time
            check_res = await session.execute(text("SELECT check_out_time FROM attendances WHERE attendance_id = :id"), {"id": new_att_id})
            assert check_res.scalar_one() is not None

            # Bản ghi 41 vẫn phải giữ check_out_time IS NULL
            att41_res = await session.execute(text("SELECT check_out_time FROM attendances WHERE attendance_id = 41"))
            assert att41_res.scalar_one() is None
        finally:
            # Cleanup test session
            await session.execute(text("DELETE FROM attendances WHERE attendance_id = :id"), {"id": new_att_id})
            await session.commit()


@pytest.mark.asyncio
async def test_06_hr_resolve_confirmed_with_verified_checkout_and_audit():
    """6. HR xác nhận: Có audit trail và tính giờ công từ thời điểm checkout được xác minh."""
    await engine.dispose()
    async with async_session_maker() as session:
        # Tạo session mẫu cần resolve
        test_date = date(2026, 11, 3)
        await session.execute(text("DELETE FROM attendances WHERE employee_id = 4 AND work_date = :d"), {"d": test_date})

        insert_res = await session.execute(text("""
            INSERT INTO attendances (employee_id, store_id, shift_id, work_date, check_in_time, status)
            VALUES (4, 2, 1, :d, '2026-11-03 08:00:00+07', 'LATE')
            RETURNING attendance_id
        """), {"d": test_date})
        temp_id = insert_res.scalar_one()
        await session.commit()

        try:
            hr_user = {"user_id": 1, "username": "hr_manager", "roles": ["HR_MANAGER"], "full_name": "Phạm Quản Trị HR"}
            verified_checkout = datetime(2026, 11, 3, 16, 0, tzinfo=VIETNAM_TZ) # 8 tiếng

            resolve_body = ResolveSessionRequest(
                decision="CONFIRMED_LATE",
                reason="Cửa hàng trưởng cung cấp biên bản xác nhận nhân viên ra về lúc 16:00",
                verified_check_out_time=verified_checkout,
                version=0
            )

            res = await resolve_attendance_session(
                session_id=temp_id,
                body=resolve_body,
                user=hr_user,
                db=session
            )
            assert res["success"] is True
            assert res["updated_session"]["review_decision"] == "CONFIRMED_LATE"

            # Kiểm tra giờ công được tính từ checkout xác minh (8.00h)
            att_check = (await session.execute(text("SELECT actual_work_hours, check_out_time FROM attendances WHERE attendance_id = :id"), {"id": temp_id})).mappings().first()
            assert float(att_check["actual_work_hours"]) == 8.0
            assert att_check["check_out_time"] is not None

            # Kiểm tra audit_logs có bản ghi
            audit_log = (await session.execute(text("SELECT * FROM audit_logs WHERE entity_name = 'attendances' AND entity_id = :id"), {"id": str(temp_id)})).mappings().first()
            assert audit_log is not None
            assert audit_log["action"] == "ATTENDANCE_SESSION_RESOLVE"
        finally:
            await session.execute(text("DELETE FROM audit_logs WHERE entity_name = 'attendances' AND entity_id = :id"), {"id": str(temp_id)})
            await session.execute(text("DELETE FROM attendances WHERE attendance_id = :id"), {"id": temp_id})
            await session.commit()


@pytest.mark.asyncio
async def test_07_hr_resolve_excluded_invalid_zeros_hours():
    """7. HR loại trừ (EXCLUDED_INVALID): Không tính giờ công từ phiên bị loại."""
    await engine.dispose()
    async with async_session_maker() as session:
        test_date = date(2026, 11, 2)
        await session.execute(text("DELETE FROM attendances WHERE employee_id = 4 AND work_date = :d"), {"d": test_date})

        insert_res = await session.execute(text("""
            INSERT INTO attendances (employee_id, store_id, shift_id, work_date, check_in_time, actual_work_hours, status)
            VALUES (4, 2, 1, :d, '2026-11-02 08:00:00+07', 4.0, 'LATE')
            RETURNING attendance_id
        """), {"d": test_date})
        temp_id = insert_res.scalar_one()
        await session.commit()

        try:
            hr_user = {"user_id": 1, "username": "hr_manager", "roles": ["HR_MANAGER"], "full_name": "Phạm Quản Trị HR"}
            resolve_body = ResolveSessionRequest(
                decision="EXCLUDED_INVALID",
                reason="Nhân viên check-in nhầm ca, thực tế không làm việc tại chi nhánh",
                version=0
            )
            res = await resolve_attendance_session(
                session_id=temp_id,
                body=resolve_body,
                user=hr_user,
                db=session
            )
            assert res["success"] is True
            assert res["updated_session"]["is_excluded"] is True
            assert res["updated_session"]["actual_work_hours"] == 0.0

            # DB actual_work_hours phải được set về 0.0
            att_check = (await session.execute(text("SELECT actual_work_hours FROM attendances WHERE attendance_id = :id"), {"id": temp_id})).scalar_one()
            assert float(att_check) == 0.0
        finally:
            await session.execute(text("DELETE FROM audit_logs WHERE entity_name = 'attendances' AND entity_id = :id"), {"id": str(temp_id)})
            await session.execute(text("DELETE FROM attendances WHERE attendance_id = :id"), {"id": temp_id})
            await session.commit()


@pytest.mark.asyncio
async def test_08_employee_calling_resolve_fails_forbidden():
    """8. Employee gọi API resolve: Bị từ chối với 403 Forbidden."""
    await engine.dispose()
    async with async_session_maker() as session:
        emp_user = {"user_id": 4, "employee_id": 4, "roles": ["EMPLOYEE"]}
        body = ResolveSessionRequest(decision="CONFIRMED_LATE", reason="Tự giải trình", version=0)
        with pytest.raises(HTTPException) as exc_info:
            await resolve_attendance_session(session_id=41, body=body, user=emp_user, db=session)
        assert exc_info.value.status_code == 403
        assert "không có quyền" in exc_info.value.detail


@pytest.mark.asyncio
async def test_09_payroll_hold_on_unverified_overdue_session():
    """9. Payroll đọc dữ liệu: Phiên quá hạn chưa xác minh bị payroll_hold = True và actual_work_hours = 0."""
    await engine.dispose()
    async with async_session_maker() as session:
        res = await session.execute(text("SELECT * FROM attendances WHERE attendance_id = 41"))
        row = dict(res.mappings().first())
        enriched = enrich_session_record(row)

        # Phiên quá hạn chưa xác minh
        assert enriched["payroll_hold"] is True
        assert enriched["actual_work_hours"] == 0.0
