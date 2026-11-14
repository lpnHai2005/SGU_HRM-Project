"""PostgreSQL regression: branch transfer goes through promote (PUT no longer changes store).

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


def test_promote_transfer_moves_store_department_and_schedules():
    asyncio.run(_exercise_promote_transfer(_validated_test_url()))


async def _exercise_promote_transfer(url):
    engine = create_async_engine(url)
    try:
        async with engine.connect() as connection:
            outer = await connection.begin()
            try:
                for statement in (
                    """CREATE TEMP TABLE employees(
                        employee_id integer PRIMARY KEY,position_id integer,department_id integer,
                        store_id integer,updated_at timestamptz) ON COMMIT DROP""",
                    "CREATE TEMP TABLE stores(store_id integer PRIMARY KEY,is_active boolean) ON COMMIT DROP",
                    "CREATE TEMP TABLE positions(position_id integer PRIMARY KEY,position_code text) ON COMMIT DROP",
                    "CREATE TEMP TABLE departments(department_id integer PRIMARY KEY,department_code text) ON COMMIT DROP",
                    "CREATE TEMP TABLE users(user_id integer PRIMARY KEY,employee_id integer) ON COMMIT DROP",
                    """CREATE TEMP TABLE position_histories(
                        employee_id integer,old_position_id integer,new_position_id integer,
                        old_store_id integer,new_store_id integer,decision_number text,
                        effective_date date,reason text) ON COMMIT DROP""",
                    """CREATE TEMP TABLE work_schedules(
                        schedule_id integer PRIMARY KEY,employee_id integer,store_id integer,
                        shift_id integer,work_date date,cancelled_at timestamptz) ON COMMIT DROP""",
                    "INSERT INTO employees VALUES(5,3,1,1,NULL)",
                    "INSERT INTO stores VALUES(1,true),(2,true)",
                    "INSERT INTO positions VALUES(3,'SALES')",
                    "INSERT INTO departments VALUES(1,'SALES'),(2,'OPS')",
                    "INSERT INTO work_schedules VALUES(10,5,1,4,:day,NULL)",
                ):
                    await connection.execute(
                        text(statement),
                        {"day": local_now().date()} if ":day" in statement else {},
                    )

                async with AsyncSession(
                    bind=connection, join_transaction_mode="create_savepoint"
                ) as db:
                    await employees.promote_employee(
                        employee_id=5, new_position_id=3, new_store_id=2, new_department_id=2,
                        decision_number="QĐ-TEST", reason="test",
                        current_user={"user_id": 1, "employee_id": 99, "roles": ["HR_MANAGER"]},
                        db=db,
                    )
                    row = (await db.execute(text(
                        "SELECT store_id, department_id FROM employees WHERE employee_id=5"
                    ))).one()
                    schedule_store = (await db.execute(text(
                        "SELECT store_id FROM work_schedules WHERE schedule_id=10"
                    ))).scalar_one()
                    history = (await db.execute(text(
                        "SELECT count(*) FROM position_histories WHERE employee_id=5"
                    ))).scalar_one()
                    assert tuple(row) == (2, 2)
                    assert schedule_store == 2
                    assert history == 1
            finally:
                await outer.rollback()
    finally:
        await engine.dispose()


def test_demoting_store_manager_removes_role_and_falls_back_to_employee():
    asyncio.run(_exercise_demotion(_validated_test_url()))


async def _exercise_demotion(url):
    engine = create_async_engine(url)
    try:
        async with engine.connect() as connection:
            outer = await connection.begin()
            try:
                for statement in (
                    """CREATE TEMP TABLE employees(
                        employee_id integer PRIMARY KEY,position_id integer,department_id integer,
                        store_id integer,updated_at timestamptz) ON COMMIT DROP""",
                    "CREATE TEMP TABLE positions(position_id integer PRIMARY KEY,position_code text) ON COMMIT DROP",
                    "CREATE TEMP TABLE users(user_id integer PRIMARY KEY,employee_id integer) ON COMMIT DROP",
                    "CREATE TEMP TABLE roles(role_id integer PRIMARY KEY,role_code text) ON COMMIT DROP",
                    "CREATE TEMP TABLE user_roles(user_id integer,role_id integer) ON COMMIT DROP",
                    """CREATE TEMP TABLE position_histories(
                        employee_id integer,old_position_id integer,new_position_id integer,
                        old_store_id integer,new_store_id integer,decision_number text,
                        effective_date date,reason text) ON COMMIT DROP""",
                    "INSERT INTO employees VALUES(5,4,1,1,NULL)",
                    "INSERT INTO positions VALUES(3,'SALES'),(4,'STORE_MGR')",
                    "INSERT INTO users VALUES(50,5)",
                    "INSERT INTO roles VALUES(1,'EMPLOYEE'),(2,'STORE_MANAGER')",
                    "INSERT INTO user_roles VALUES(50,2)",
                ):
                    await connection.execute(text(statement))

                async with AsyncSession(
                    bind=connection, join_transaction_mode="create_savepoint"
                ) as db:
                    await employees.promote_employee(
                        employee_id=5, new_position_id=3, decision_number="QĐ-TEST", reason="test",
                        current_user={"user_id": 1, "employee_id": 99, "roles": ["HR_MANAGER"]},
                        db=db,
                    )
                    roles = (await db.execute(text(
                        "SELECT r.role_code FROM user_roles ur JOIN roles r USING(role_id) WHERE ur.user_id=50"
                    ))).scalars().all()
                    assert roles == ["EMPLOYEE"]
            finally:
                await outer.rollback()
    finally:
        await engine.dispose()
