import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.v1.endpoints import auth, employees


class Result:
    def __init__(self, row=None):
        self.row = row

    def first(self):
        return self.row

    def mappings(self):
        return self


class FakeDb:
    def __init__(self, duplicate=False):
        self.duplicate = duplicate
        self.statements = []
        self.committed = False

    async def execute(self, statement, params=None):
        sql = str(statement)
        self.statements.append((sql, params))
        if "SELECT 1 FROM employees" in sql:
            return Result((1,) if self.duplicate else None)
        if "SELECT phone, current_address" in sql:
            return Result({"phone": "0900000000", "current_address": "Địa chỉ cũ"})
        return Result()

    async def commit(self):
        self.committed = True


def run_update(db, monkeypatch):
    async def fake_audit(**kwargs):
        db.audit = kwargs

    monkeypatch.setattr(auth, "record_audit_log", fake_audit)
    body = auth.ContactUpdate(phone="0912345678", current_address="12 Nguyễn Trãi, TP.HCM")
    request = SimpleNamespace(client=SimpleNamespace(host="127.0.0.1"))
    user = {"user_id": 4, "employee_id": 4}
    return asyncio.run(auth.update_my_contact(body, request, user, db))


def test_self_contact_updates_employee_user_and_audit(monkeypatch):
    db = FakeDb()
    run_update(db, monkeypatch)
    sql = "\n".join(s for s, _ in db.statements)
    assert "UPDATE employees" in sql and "UPDATE users SET phone" in sql
    assert db.committed and db.audit["action"] == "UPDATE_OWN_CONTACT"


def test_self_contact_rejects_duplicate_phone(monkeypatch):
    db = FakeDb(duplicate=True)
    with pytest.raises(HTTPException) as error:
        run_update(db, monkeypatch)
    assert error.value.status_code == 409 and not db.committed


@pytest.mark.parametrize("phone", ["12345", "0912 345 678", "091234567a"])
def test_self_contact_rejects_invalid_phone(phone):
    with pytest.raises(ValidationError):
        auth.ContactUpdate(phone=phone, current_address="12 Nguyễn Trãi")


def test_quick_resign_locks_account():
    db = FakeDb()
    asyncio.run(employees.delete_employee(4, {"user_id": 2}, db))
    assert any("UPDATE users" in s and "is_active = FALSE" in s for s, _ in db.statements)
    assert db.committed
