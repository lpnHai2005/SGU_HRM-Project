"""PostgreSQL regression for updating store GPS and manager assignment atomically.

Set STORE_TEST_DATABASE_URL only to a disposable PostgreSQL database on loopback.
The test uses temporary tables and rolls back its outer transaction.
"""
import asyncio
import os
import re
from datetime import date
from ipaddress import ip_address

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from fastapi import FastAPI

from app.api.deps import get_current_user
from app.api.v1.endpoints import stores
from app.core.database import get_db


DATABASE_URL = os.getenv('STORE_TEST_DATABASE_URL')


def _validated_test_url():
    if not DATABASE_URL:
        pytest.skip('Set STORE_TEST_DATABASE_URL to run the loopback PostgreSQL regression')
    url = make_url(DATABASE_URL)
    if url.drivername != 'postgresql+asyncpg':
        pytest.fail('STORE_TEST_DATABASE_URL must use the postgresql+asyncpg driver')
    try:
        is_loopback = ip_address(url.host or '').is_loopback
    except ValueError:
        is_loopback = (url.host or '').lower() == 'localhost'
    if not is_loopback:
        pytest.fail('Refusing PostgreSQL write test: database host must be loopback')
    if not re.search(r'(test|synthetic|fixture|e2e)', url.database or '', re.IGNORECASE):
        pytest.fail('Refusing PostgreSQL write test: database name must identify a test/synthetic database')
    return url


def test_store_update_gps_and_rollback_with_asyncpg():
    asyncio.run(_exercise_store_update(_validated_test_url()))


async def _exercise_store_update(url):
    engine = create_async_engine(url)
    try:
        async with engine.connect() as connection:
            outer = await connection.begin()
            try:
                store_id_type = (await connection.execute(text("""
                    SELECT format_type(attribute.atttypid, attribute.atttypmod)
                    FROM pg_attribute AS attribute
                    WHERE attribute.attrelid='public.stores'::regclass
                      AND attribute.attname='store_id'
                      AND NOT attribute.attisdropped
                """))).scalar_one()
                assert store_id_type in {'integer', 'bigint'}

                for statement in (
                    """CREATE TEMP TABLE stores(
                        store_id integer PRIMARY KEY,store_code text UNIQUE,store_name text,
                        address text,district text,city text,open_date date,
                        manager_employee_id integer,is_active boolean) ON COMMIT DROP""",
                    """CREATE TEMP TABLE employees(
                        employee_id integer PRIMARY KEY,employee_code text,full_name text,
                        employment_status text) ON COMMIT DROP""",
                    """CREATE TEMP TABLE users(user_id integer PRIMARY KEY,employee_id integer) ON COMMIT DROP""",
                    """CREATE TEMP TABLE user_roles(user_id integer,role_id integer) ON COMMIT DROP""",
                    """CREATE TEMP TABLE roles(role_id integer PRIMARY KEY,role_code text) ON COMMIT DROP""",
                    """CREATE TEMP TABLE mobile_store_geofences(
                        store_id integer PRIMARY KEY,latitude double precision,
                        longitude double precision,radius_meters integer,is_active boolean) ON COMMIT DROP""",
                    """CREATE TEMP TABLE store_web_attendance_networks(
                        store_id integer,network cidr,PRIMARY KEY(store_id,network)) ON COMMIT DROP""",
                    """CREATE TEMP TABLE audit_logs(
                        user_id integer,action text,entity_name text,entity_id text,
                        old_values jsonb,new_values jsonb) ON COMMIT DROP""",
                    """INSERT INTO stores VALUES
                        (2,'TZ-Q3','TechZone Q3','280 Vo Van Tan','Phuong 5','TP HCM',
                         '2026-10-19',3,true)""",
                    """INSERT INTO employees VALUES(3,'TZ-006','Synthetic Manager','ACTIVE')""",
                    """INSERT INTO users VALUES(30,3)""",
                    """INSERT INTO roles VALUES(4,'STORE_MANAGER')""",
                    """INSERT INTO user_roles VALUES(30,4)""",
                    """INSERT INTO mobile_store_geofences VALUES
                        (2,10.77,106.67,100,true)""",
                ):
                    await connection.execute(text(statement))

                async with AsyncSession(
                    bind=connection, join_transaction_mode='create_savepoint'
                ) as db:
                    admin = {'user_id': 1, 'employee_id': 99, 'roles': ['ADMIN']}
                    app = FastAPI()
                    app.include_router(stores.router, prefix='/api/v1/stores')

                    async def test_db():
                        yield db

                    async def test_admin():
                        return admin

                    app.dependency_overrides[get_db] = test_db
                    app.dependency_overrides[get_current_user] = test_admin
                    async with AsyncClient(
                        transport=ASGITransport(app=app, raise_app_exceptions=False),
                        base_url='http://test',
                    ) as client:
                        response = await client.put('/api/v1/stores/2', json={
                            'store_code': 'TZ-Q3',
                            'store_name': 'TechZone Q3',
                            'address': '280 Vo Van Tan',
                            'district': 'Phuong 5',
                            'city': 'TP HCM',
                            'open_date': date(2026, 10, 19).isoformat(),
                            'manager_employee_id': 3,
                            'manager_transfer_confirmed': False,
                            'is_active': True,
                            'latitude': 10.772615760011291,
                            'longitude': 106.67635649874245,
                            'radius_meters': 125,
                            'wifi_networks': [],
                        })
                        assert response.status_code == 200, response.text
                        result = await client.get('/api/v1/stores')
                        assert result.status_code == 200, result.text
                        updated = next(store for store in result.json() if store['store_id'] == 2)
                        assert updated['latitude'] == pytest.approx(10.772615760011291)
                        assert updated['longitude'] == pytest.approx(106.67635649874245)
                        assert updated['radius_meters'] == 125
                        assert updated['manager_employee_id'] == 3

                        await db.execute(text("""
                            INSERT INTO stores VALUES
                            (3,'TZ-Q4','Other branch','Other address','Ward','TP HCM',
                             '2026-10-19',3,true)
                        """))
                        await db.execute(text("""
                            CREATE FUNCTION pg_temp.fail_manager_transfer() RETURNS trigger
                            LANGUAGE plpgsql AS $$
                            BEGIN
                                IF OLD.store_id=3
                                   AND NEW.manager_employee_id IS DISTINCT FROM OLD.manager_employee_id THEN
                                    RAISE EXCEPTION 'synthetic rollback check';
                                END IF;
                                RETURN NEW;
                            END
                            $$
                        """))
                        await db.execute(text("""
                            CREATE TRIGGER fail_manager_transfer
                            AFTER UPDATE ON stores
                            FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_manager_transfer()
                        """))
                        await db.commit()
                        failed = await client.put('/api/v1/stores/2', json={
                            'store_code': 'TZ-Q3',
                            'store_name': 'TechZone Q3',
                            'address': '280 Vo Van Tan',
                            'district': 'Phuong 5',
                            'city': 'TP HCM',
                            'open_date': date(2026, 10, 19).isoformat(),
                            'manager_employee_id': 3,
                            'manager_transfer_confirmed': True,
                            'is_active': True,
                            'latitude': 10.8,
                            'longitude': 106.7,
                            'radius_meters': 150,
                            'wifi_networks': [],
                        })
                        assert failed.status_code == 500
                        state = (await db.execute(text("""
                            SELECT s.manager_employee_id,g.latitude,g.longitude,g.radius_meters
                            FROM stores s JOIN mobile_store_geofences g USING(store_id)
                            WHERE s.store_id=2
                        """))).one()
                        assert tuple(state) == (3, 10.772615760011291, 106.67635649874245, 125)
                        transferred = (await db.execute(text(
                            'SELECT manager_employee_id FROM stores WHERE store_id=3'
                        ))).scalar_one()
                        assert transferred == 3
            finally:
                await outer.rollback()
    finally:
        await engine.dispose()
