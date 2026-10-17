import asyncio
from datetime import date
from unittest.mock import MagicMock
import pytest
from fastapi import HTTPException
from app.api.v1.endpoints.stores import StoreWrite, save_store

class Result:
    def __init__(self, first=None, all_rows=None, scalar=None): self._first=first; self._all=all_rows or []; self._scalar=scalar
    def mappings(self): return self
    def first(self): return self._first
    def all(self): return self._all
    def scalar_one(self): return self._scalar

class FakeDB:
    def __init__(self, assigned): self.assigned=assigned; self.calls=[]; self.commits=0; self.rollbacks=0
    async def execute(self, statement, params=None):
        sql=str(statement); self.calls.append((sql,params or {}))
        if 'SELECT e.employee_id FROM employees' in sql: return Result(first={'employee_id':7})
        if 'SELECT store_id,store_code,store_name FROM stores' in sql: return Result(all_rows=self.assigned)
        if 'INSERT INTO stores(' in sql: return Result(scalar=22)
        return Result()
    async def commit(self): self.commits += 1
    async def rollback(self): self.rollbacks += 1

def store_payload(confirmed=False):
    return StoreWrite(store_code='TZ-Q7',store_name='TechZone Q7',address='Street',district='Ward',city='City',
        open_date=date(2026,10,16),manager_employee_id=7,manager_transfer_confirmed=confirmed,
        latitude=10.77,longitude=106.69,radius_meters=100)

def test_manager_transfer_requires_confirmation_before_writing():
    db=FakeDB([{'store_id':3,'store_code':'TZ-Q3','store_name':'Branch 3'}])
    with pytest.raises(HTTPException) as err:
        asyncio.run(save_store(store_payload(),None,{'user_id':1},db))
    assert err.value.status_code == 409
    assert err.value.detail['code'] == 'STORE_MANAGER_TRANSFER_REQUIRED'
    assert db.commits == 0
    assert not any('UPDATE stores' in sql or 'INSERT INTO stores(' in sql for sql,_ in db.calls)
    assert any('FOR UPDATE OF e' in sql for sql,_ in db.calls)

def test_confirmed_manager_transfer_is_atomic_and_audited():
    db=FakeDB([{'store_id':3,'store_code':'TZ-Q3','store_name':'Branch 3'}])
    result=asyncio.run(save_store(store_payload(True),None,{'user_id':1},db))
    assert result['store_id'] == 22
    assert db.commits == 1
    assert any('UPDATE stores SET manager_employee_id=NULL' in sql for sql,_ in db.calls)
    transfer_audits=[params for sql,params in db.calls if 'TRANSFER_STORE_MANAGER' in sql]
    assert len(transfer_audits) == 1
    assert transfer_audits[0]['old'].find('"manager_employee_id": 7') >= 0
    assert not any('UPDATE employees' in sql or 'work_schedules' in sql for sql,_ in db.calls)


def test_new_store_code_must_have_tz_prefix_and_suffix():
    db=FakeDB([])
    with pytest.raises(HTTPException) as err:
        asyncio.run(save_store(store_payload().model_copy(update={'store_code':'TZ-'}),None,{'user_id':1},db))
    assert err.value.status_code == 422
    assert db.commits == 0
