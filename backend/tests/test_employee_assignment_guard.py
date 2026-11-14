import asyncio

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import employees
from app.schemas.schemas import EmployeeUpdate


class _Result:
    def __init__(self, value):
        self._value = value

    def scalar(self):
        return self._value


class _FakeDb:
    """Trả mã chức vụ/phòng ban theo câu SQL; đủ cho _ensure_can_assign."""

    async def execute(self, stmt, params=None):
        sql = str(stmt)
        if "FROM positions" in sql:
            return _Result({1: "DIRECTOR", 2: "SALES"}.get(params["id"]))
        if "FROM departments" in sql:
            return _Result({10: "BGD", 11: "SALES"}.get(params["id"]))
        raise AssertionError(sql)


HR = {"user_id": 1, "employee_id": 7, "roles": ["HR_MANAGER"]}
DIRECTOR = {"user_id": 2, "employee_id": 8, "roles": ["DIRECTOR"]}


def _assign(user, position_id=None, department_id=None):
    return asyncio.run(employees._ensure_can_assign(_FakeDb(), user, position_id, department_id))


def test_hr_cannot_assign_director_position_or_bgd_department():
    with pytest.raises(HTTPException) as e:
        _assign(HR, position_id=1)
    assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:
        _assign(HR, department_id=10)
    assert e.value.status_code == 403


def test_hr_can_assign_normal_position_and_director_can_assign_director():
    _assign(HR, position_id=2, department_id=11)
    _assign(DIRECTOR, position_id=1, department_id=10)


def test_promote_self_is_rejected_before_touching_db():
    with pytest.raises(HTTPException) as e:
        asyncio.run(employees.promote_employee(employee_id=7, new_position_id=1, current_user=HR, db=None))
    assert e.value.status_code == 403


def test_update_schema_drops_org_fields():
    data = EmployeeUpdate(store_id=2, department_id=3, position_id=1, phone="0900").model_dump(exclude_unset=True)
    assert data == {"phone": "0900"}
