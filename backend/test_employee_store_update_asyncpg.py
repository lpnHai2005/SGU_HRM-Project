"""PostgreSQL regression for employee branch updates with legacy salary payloads.

Set EMPLOYEE_TEST_DATABASE_URL only to a disposable PostgreSQL loopback database.
The test uses temporary tables and rolls back its outer transaction.
"""
import asyncio
import ipaddress
import os
import re

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.api.v1.endpoints import employees
from app.core.attendance import local_now
from app.schemas.schemas import EmployeeUpdate


DATABASE_URL = os.getenv("EMPLOYEE_TEST_DATABASE_URL")


def _validated_test_url():
    if not DATABASE_URL:
        pytest.skip("Set EMPLOYEE_TEST_DATABASE_URL to run the loopback PostgreSQL regression")
    url = make_url(DATABASE_URL)
    if url.drivername != "postgresql+asyncpg":
        pytest.fail("EMPLOYEE_TEST_DATABASE_URL must use the postgresql+asyncpg driver")
    try:
        is_loopback = ipaddress.ip_address(url.host or "").is_loopback
    except ValueError:
        is_loopback = (url.host or "").lower() == "localhost"
    if not is_loopback:
        pytest.fail("Refusing PostgreSQL write test: database host must be loopback")
    if not re.search(r"(test|synthetic|fixture|e2e)", url.database or "", re.IGNORECASE):
        pytest.fail("Refusing PostgreSQL write test: database name must identify a test/synthetic database")
    return url


def test_employee_store_update_ignores_legacy_salary_field(monkeypatch):
    asyncio.run(_exercise_employee_update(_validated_test_url(), monkeypatch))


async def _exercise_employee_update(url, monkeypatch):
    engine = create_async_engine(url)
    try:
        async with engine.connect() as connection:
            outer = await connection.begin()
            try:
                for statement in (
                    """CREATE TEMP TABLE employees(
                        employee_id integer PRIMARY KEY,store_id integer,updated_at timestamptz) ON COMMIT DROP""",
                    """CREATE TEMP TABLE stores(store_id integer PRIMARY KEY,is_active boolean) ON COMMIT DROP""",
                    """CREATE TEMP TABLE work_schedules(
                        schedule_id integer PRIMARY KEY,employee_id integer,store_id integer,
                        shift_id integer,work_date date,cancelled_at timestamptz) ON COMMIT DROP""",
                    "INSERT INTO employees VALUES(5,1,NULL)",
                    "INSERT INTO stores VALUES(1,true),(2,true)",
                    "INSERT INTO work_schedules VALUES(10,5,1,4,:day,NULL)",
                ):
                    await connection.execute(
                        text(statement),
                        {"day": local_now().date()} if ":day" in statement else {},
                    )

                async def get_employee_stub(employee_id, current_user, db):
                    return {"employee_id": employee_id}

                monkeypatch.setattr(employees, "get_employee", get_employee_stub)
                async with AsyncSession(
                    bind=connection, join_transaction_mode="create_savepoint"
                ) as db:
                    await employees.update_employee(
                        employee_id=5,
                        emp=EmployeeUpdate(store_id=2, basic_salary=8_000_000),
                        current_user={"user_id": 1, "roles": ["ADMIN"]},
                        db=db,
                    )
                    employee_store = (await db.execute(text(
                        "SELECT store_id FROM employees WHERE employee_id=5"
                    ))).scalar_one()
                    schedule_store = (await db.execute(text(
                        "SELECT store_id FROM work_schedules WHERE schedule_id=10"
                    ))).scalar_one()
                    assert employee_store == 2
                    assert schedule_store == 2
            finally:
                await outer.rollback()
    finally:
        await engine.dispose()
