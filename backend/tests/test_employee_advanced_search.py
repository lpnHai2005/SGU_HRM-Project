"""Tìm kiếm nâng cao nhân sự: AND/OR/NOT, so sánh >,<,=, whitelist trường, bind param, phân quyền."""
import asyncio
import json

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import employees


class _FakeResult:
    def mappings(self):
        return self

    def all(self):
        return []


class _CaptureDb:
    async def execute(self, statement, params):
        self.sql, self.params = str(statement), params
        return _FakeResult()


def _run(conditions, roles=("HR_MANAGER",), **filters):
    db = _CaptureDb()
    args = dict(store_id=None, department_id=None, status=None, search=None)
    args.update(filters)
    user = {"roles": list(roles), "store_id": 7}
    raw = conditions if isinstance(conditions, str) else json.dumps(conditions)
    asyncio.run(employees.list_employees(**args, conditions=raw, current_user=user, db=db))
    return db


def _where(db):
    return db.sql.split("WHERE 1=1", 1)[1]


def test_province_or_and_salary_range():
    db = _run([
        {"field": "current_province", "op": "eq", "value": "Thành phố Hồ Chí Minh"},
        {"join": "OR", "field": "current_province", "op": "eq", "value": "Thành phố Hà Nội"},
        {"join": "AND", "field": "base_salary", "op": "between", "value": 10000000, "value2": 20000000},
    ])
    where = _where(db)
    assert "cardinality(string_to_array(e.current_address, ','))" in where
    assert " OR COALESCE(" in where and " AND COALESCE(" in where
    assert "BETWEEN :c2 AND :c2b" in where
    assert db.params["c1"] == "Thành phố Hà Nội"
    assert (db.params["c2"], db.params["c2b"]) == (10000000, 20000000)


def test_province_in_list_is_one_condition():
    db = _run([{"field": "current_province", "op": "in", "value": ["Thành phố Hồ Chí Minh", "Thành phố Hà Nội"]}])
    where = _where(db)
    assert "ILIKE extensions.unaccent(:c0_0) OR " in where and ":c0_1" in where
    assert (db.params["c0_0"], db.params["c0_1"]) == ("Thành phố Hồ Chí Minh", "Thành phố Hà Nội")


def test_not_neq_and_comparisons():
    db = _run([
        {"not": True, "field": "name", "op": "contains", "value": "nguyen"},
        {"field": "age", "op": "gte", "value": "25"},
        {"field": "join_date", "op": "lt", "value": "2024-01-01"},
        {"field": "department", "op": "neq", "value": "Kinh doanh"},
    ])
    where = _where(db)
    assert "NOT COALESCE((extensions.unaccent(e.full_name) ILIKE extensions.unaccent(:c0))" in where
    assert ">= :c1" in where and "e.join_date < :c2" in where
    assert "NOT COALESCE((extensions.unaccent(d.department_name)" in where
    assert db.params["c0"] == "%nguyen%" and db.params["c1"] == 25.0
    assert str(db.params["c2"]) == "2024-01-01"


def test_or_cannot_escape_store_scope():
    db = _run([
        {"field": "name", "op": "contains", "value": "a"},
        {"join": "OR", "field": "name", "op": "contains", "value": "b"},
    ], roles=("STORE_MANAGER",))
    where = _where(db)
    assert where.index("e.store_id = :store_id") < where.index("AND (COALESCE(")
    assert db.params["store_id"] == 7


def test_user_input_stays_in_params_and_like_wildcards_escaped():
    db = _run([{"field": "identity_card", "op": "contains", "value": "079' OR 1=1 -- 50%_"}])
    assert "OR 1=1" not in db.sql
    assert db.params["c0"] == "%079' OR 1=1 -- 50\\%\\_%"


@pytest.mark.parametrize("conditions, status_code", [
    ([{"field": "password_hash", "op": "eq", "value": "x"}], 422),
    ([{"field": "age", "op": "contains", "value": "3"}], 422),
    ([{"field": "current_province", "op": "gt", "value": "x"}], 422),
    ([{"field": "age", "op": "gt", "value": "abc"}], 422),
    ([{"field": "base_salary", "op": "between", "value": 9, "value2": 1}], 422),
    ([{"field": "name", "op": "eq", "value": "   "}], 422),
    ([{"field": "name", "op": "eq", "value": "a"}] * 11, 422),
    ("not json", 422),
    ([{"field": "current_province", "op": "in", "value": []}], 422),
    ([{"field": "current_province", "op": "in", "value": "Thành phố Hà Nội"}], 422),
    ([{"field": "current_province", "op": "eq", "value": ["Thành phố Hà Nội"]}], 422),
    ([{"field": "name", "op": "in", "value": ["a"]}], 422),
])
def test_invalid_conditions_rejected(conditions, status_code):
    with pytest.raises(HTTPException) as exc:
        _run(conditions)
    assert exc.value.status_code == status_code


def test_sensitive_fields_only_for_hr_admin_director():
    cond = [{"field": "tax_code", "op": "starts", "value": "83"}]
    assert _run(cond, roles=("DIRECTOR",)).params["c0"] == "83%"
    with pytest.raises(HTTPException) as exc:
        _run(cond, roles=("STORE_MANAGER",))
    assert exc.value.status_code == 403
