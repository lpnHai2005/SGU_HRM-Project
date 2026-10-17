import asyncio
import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.stores import StoreDeleteRequest, StoreStatusChange, change_store_status, delete_store


class Result:
    def __init__(self, first=None, all_rows=None, scalar=0):
        self._first = first
        self._all = all_rows or []
        self._scalar = scalar

    def mappings(self): return self
    def first(self): return self._first
    def all(self): return self._all
    def scalar_one(self): return self._scalar


class FakeDB:
    def __init__(self, store=None, refs=None, counts=None, manager=None, open_sessions=0):
        self.store = store
        self.refs = refs or []
        self.counts = counts or {}
        self.manager = manager
        self.open_sessions = open_sessions
        self.calls = []
        self.commits = 0
        self.rollbacks = 0

    async def execute(self, statement, params=None):
        sql = str(statement)
        values = params or {}
        self.calls.append((sql, values))
        if 'SELECT * FROM stores WHERE store_id' in sql:
            return Result(first=self.store)
        if 'FROM pg_constraint c' in sql:
            return Result(all_rows=self.refs)
        if 'SELECT COUNT(*)' in sql:
            if 'FROM attendances' in sql:
                return Result(scalar=self.open_sessions)
            table = next((name for name in self.counts if f'."{name}"' in sql), None)
            return Result(scalar=self.counts.get(table, 0))
        if 'SELECT latitude,longitude,radius_meters FROM mobile_store_geofences' in sql:
            return Result(first={'latitude': 10.77, 'longitude': 106.69, 'radius_meters': 100})
        if 'FROM employees e JOIN users u USING(employee_id)' in sql:
            return Result(first=self.manager)
        if 'SELECT store_id,store_name FROM stores' in sql:
            return Result(first=None)
        return Result()

    async def commit(self): self.commits += 1
    async def rollback(self): self.rollbacks += 1


def run(awaitable): return asyncio.run(awaitable)
USER = {'user_id': 9}


def test_deactivate_disables_geofence_and_writes_reason_audit():
    db = FakeDB(store={'store_id': 4, 'store_code': 'TZ-04', 'is_active': True, 'manager_employee_id': 7})
    result = run(change_store_status(4, StoreStatusChange(is_active=False, reason='Chi nhánh tạm ngừng kinh doanh', handoff_confirmed=True, handoff_summary='Nhân sự và lịch đã được bàn giao'), USER, db))
    assert result['is_active'] is False
    assert any('UPDATE mobile_store_geofences SET is_active=:active' in sql for sql, _ in db.calls)
    assert any('manager_employee_id=CASE WHEN :active THEN manager_employee_id ELSE NULL END' in sql for sql, _ in db.calls)
    audit = next(params for _, params in db.calls if params.get('action') == 'DEACTIVATE_STORE')
    assert 'Chi nhánh tạm ngừng kinh doanh' in audit['new']
    assert db.commits == 1


def test_reactivation_requires_a_manager():
    db = FakeDB(store={'store_id': 4, 'store_code': 'TZ-04', 'is_active': False, 'manager_employee_id': None})
    with pytest.raises(HTTPException) as error:
        run(change_store_status(4, StoreStatusChange(is_active=True, reason='Đã hoàn tất chuẩn bị'), USER, db))
    assert error.value.status_code == 409
    assert error.value.detail['code'] == 'STORE_MANAGER_REQUIRED'
    assert db.commits == 0


def test_reactivation_enables_geofence_and_audits_reason():
    db = FakeDB(store={'store_id': 4, 'store_code': 'TZ-04', 'is_active': False, 'manager_employee_id': 7}, manager={'employee_id': 7})
    result = run(change_store_status(4, StoreStatusChange(is_active=True, reason='Đã sẵn sàng mở cửa'), USER, db))
    assert result['is_active'] is True
    assert any("UPDATE stores SET is_active=:active, manager_employee_id=CASE WHEN :active THEN manager_employee_id ELSE NULL END" in sql and params['active'] is True for sql, params in db.calls)
    assert any('UPDATE mobile_store_geofences SET is_active=:active' in sql and params['active'] is True for sql, params in db.calls)
    assert any(params.get('action') == 'ACTIVATE_STORE' for _, params in db.calls)
    assert db.commits == 1


def test_deactivate_requires_explicit_handoff_note():
    db = FakeDB(store={'store_id': 4, 'store_code': 'TZ-04', 'is_active': True, 'manager_employee_id': 7})
    with pytest.raises(HTTPException) as error:
        run(change_store_status(4, StoreStatusChange(is_active=False, reason='Tạm dừng hoạt động cửa hàng'), USER, db))
    assert error.value.status_code == 422
    assert error.value.detail['code'] == 'STORE_HANDOFF_CONFIRMATION_REQUIRED'
    assert db.commits == 0


def test_deactivate_blocks_open_attendance_session():
    db = FakeDB(store={'store_id': 4, 'store_code': 'TZ-04', 'is_active': True, 'manager_employee_id': 7}, open_sessions=1)
    with pytest.raises(HTTPException) as error:
        run(change_store_status(4, StoreStatusChange(is_active=False, reason='Tạm dừng hoạt động cửa hàng', handoff_confirmed=True, handoff_summary='Đã lên kế hoạch điều chuyển nhân viên'), USER, db))
    assert error.value.status_code == 409
    assert error.value.detail['code'] == 'STORE_HAS_OPEN_ATTENDANCE'
    assert db.commits == 0


def test_delete_requires_inactive_store_and_matching_code():
    active_db = FakeDB(store={'store_id': 4, 'store_code': 'TZ-04', 'is_active': True})
    with pytest.raises(HTTPException) as error:
        run(delete_store(4, StoreDeleteRequest(reason='Đóng cửa chi nhánh cũ', confirm_store_code='TZ-04'), USER, active_db))
    assert error.value.status_code == 409
    assert error.value.detail['code'] == 'STORE_MUST_BE_INACTIVE'
    inactive_db = FakeDB(store={'store_id': 4, 'store_code': 'TZ-04', 'is_active': False})
    with pytest.raises(HTTPException) as error:
        run(delete_store(4, StoreDeleteRequest(reason='Đóng cửa chi nhánh cũ', confirm_store_code='TZ-05'), USER, inactive_db))
    assert error.value.status_code == 422
    assert inactive_db.commits == 0


def test_delete_blocks_linked_business_records():
    db = FakeDB(store={'store_id': 4, 'store_code': 'TZ-04', 'is_active': False},
                refs=[{'schema_name': 'public', 'table_name': 'work_schedules', 'column_name': 'store_id'}],
                counts={'work_schedules': 2})
    with pytest.raises(HTTPException) as error:
        run(delete_store(4, StoreDeleteRequest(reason='Đóng cửa chi nhánh cũ', confirm_store_code='TZ-04'), USER, db))
    assert error.value.status_code == 409
    assert error.value.detail['code'] == 'STORE_HAS_LINKED_RECORDS'
    assert error.value.detail['references'] == [{'table': 'work_schedules', 'records': 2}]
    assert not any('DELETE FROM stores' in sql for sql, _ in db.calls)
    assert db.commits == 0


def test_delete_audits_then_removes_only_unreferenced_store_configuration():
    db = FakeDB(store={'store_id': 4, 'store_code': 'TZ-04', 'is_active': False}, refs=[])
    result = run(delete_store(4, StoreDeleteRequest(reason='Đóng cửa chi nhánh cũ', confirm_store_code='TZ-04'), USER, db))
    assert result['store_id'] == 4
    sqls = [sql for sql, _ in db.calls]
    assert any('DELETE_STORE' in sql for sql in sqls)
    assert any('DELETE FROM mobile_store_geofences' in sql for sql in sqls)
    assert any('DELETE FROM store_web_attendance_networks' in sql for sql in sqls)
    assert any('DELETE FROM stores' in sql for sql in sqls)
    assert db.commits == 1
