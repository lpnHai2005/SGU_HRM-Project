"""Unit and integration tests for work schedule sequence self-healing and error sanitization."""
import pytest
from datetime import date
from starlette.requests import Request
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from app.core.database import async_session_maker, engine
from app.core import work_schedule as service
from app.main import sqlalchemy_exception_handler, global_unhandled_exception_handler

class DummyAssignment:
    def __init__(self, employee_id=5, store_id=5, shift_id=1, work_date=None, notes="Self healing test", reason="Self healing test reason"):
        self.employee_id = employee_id
        self.store_id = store_id
        self.shift_id = shift_id
        self.work_date = work_date or date(2027, 1, 15)
        self.notes = notes
        self.reason = reason

@pytest.mark.asyncio
async def test_work_schedule_sequence_self_healing():
    """Kiểm tra cơ chế tự động phục hồi khi sequence bị lệch (lùi phía sau MAX(id))."""
    # Đảm bảo pool không bị dính connection từ loop cũ đã đóng trong test suite
    await engine.dispose()
    async with async_session_maker() as session:
        # Lấy MAX schedule_id hiện có
        max_id = (await session.execute(text("SELECT COALESCE(MAX(schedule_id), 0) FROM work_schedules"))).scalar()

        # 1. Hạ sequence nhân tạo về 1 để gây lỗi duplicate key
        await session.execute(text("SELECT setval('work_schedules_schedule_id_seq', 1, true)"))

        # 2. Chuẩn bị user giả lập HR_MANAGER
        mock_user = {
            'user_id': 1,
            'employee_id': 1,
            'roles': ['HR_MANAGER', 'ADMIN'],
            '_schedule_worker': True,
        }

        test_date = date(2027, 2, 20)
        # Xóa ca trùng lặp nếu có từ trước
        await session.execute(text("DELETE FROM work_schedules WHERE employee_id = 5 AND work_date = :d"), {'d': test_date})

        data = DummyAssignment(employee_id=5, store_id=5, shift_id=1, work_date=test_date)

        # 3. Gọi service.save: Hàm này phải tự phát hiện duplicate key, tự động tăng sequence và thử lại thành công!
        row = await service.save(session, mock_user, data)

        assert row is not None
        assert row['schedule_id'] > max_id
        assert row['employee_id'] == 5
        assert row['work_date'] == test_date

        # 4. Kiểm tra sequence hiện tại đã được nâng lên đúng mức
        curr_seq = (await session.execute(text("SELECT last_value FROM work_schedules_schedule_id_seq"))).scalar()
        assert curr_seq >= row['schedule_id']

        # Dọn dẹp bản ghi test và rollback
        await session.rollback()

@pytest.mark.asyncio
async def test_sqlalchemy_exception_handler_sanitizes_duplicate_key():
    """Kiểm tra tầng bảo mật: Lỗi duplicate key được chuẩn hóa thành message tiếng Việt, không lộ SQL."""
    # Giả lập lỗi UniqueViolationError chứa SQL query nhạy cảm
    raw_error_message = (
        '(sqlalchemy.dialects.postgresql.asyncpg.UniqueViolationError) '
        'duplicate key value violates unique constraint "work_schedules_pkey" '
        '[SQL: INSERT INTO work_schedules(employee_id,store_id,shift_id,work_date,starts_at,ends_at,notes) '
        'VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *] [parameters: (5, 5, 1, ...)]'
    )
    exc = IntegrityError("statement", {}, Exception(raw_error_message))

    # Tạo fake request
    scope = {"type": "http", "method": "POST", "path": "/api/v1/work-schedules", "headers": []}
    req = Request(scope)

    response = await sqlalchemy_exception_handler(req, exc)
    assert response.status_code == 409

    import json
    body = json.loads(response.body.decode("utf-8"))
    detail = body["detail"]

    # Message phải thân thiện cho HR
    assert "Xung đột mã dữ liệu ca làm việc trên máy chủ" in detail or "duplicate" in detail.lower()

    # Tuyệt đối không chứa câu lệnh SQL hay dialect
    assert "INSERT INTO" not in detail
    assert "parameters:" not in detail
    assert "asyncpg" not in detail
    assert "SELECT " not in detail

@pytest.mark.asyncio
async def test_global_unhandled_exception_handler_hides_raw_sql():
    """Kiểm tra ngoại lệ bất kỳ nếu có dính SQL thì không bị rò rỉ ra response."""
    exc = Exception("Internal crash: SELECT * FROM secret_table WHERE id=99")
    scope = {"type": "http", "method": "GET", "path": "/api/v1/test", "headers": []}
    req = Request(scope)

    response = await global_unhandled_exception_handler(req, exc)
    assert response.status_code == 500

    import json
    body = json.loads(response.body.decode("utf-8"))
    detail = body["detail"]

    assert "SELECT * FROM secret_table" not in detail
    assert "Lỗi hệ thống máy chủ khi xử lý dữ liệu" in detail
