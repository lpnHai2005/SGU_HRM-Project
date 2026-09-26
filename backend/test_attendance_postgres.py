"""Opt-in PostgreSQL API integration test using a temporary table and rollback.

Run: venv/Scripts/python.exe test_attendance_postgres.py
No production attendance rows are inserted, updated or deleted.
"""
import asyncio
from datetime import datetime, timedelta
from unittest.mock import patch
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.v1.endpoints import attendances as api
from app.api.deps import get_current_user
from app.core.database import engine, get_db
from app.core.attendance import VIETNAM_TZ

async def main():
    async with engine.connect() as connection:
        transaction = await connection.begin()
        try:
            # Clone deployed constraints/indexes. All API writes resolve to pg_temp.
            await connection.execute(text('CREATE TEMP TABLE attendances (LIKE public.attendances INCLUDING ALL) ON COMMIT DROP'))
            await connection.execute(text('CREATE TEMP SEQUENCE attendance_test_ids'))
            await connection.execute(text("ALTER TABLE pg_temp.attendances ALTER COLUMN attendance_id SET DEFAULT nextval('pg_temp.attendance_test_ids')"))
            employee = (await connection.execute(text('SELECT employee_id, store_id FROM employees WHERE store_id IS NOT NULL ORDER BY employee_id LIMIT 1'))).mappings().one()
            shift = (await connection.execute(text('SELECT shift_id FROM work_shifts ORDER BY shift_id LIMIT 1'))).scalar_one()
            user = dict(employee, roles=['EMPLOYEE'])
            app = FastAPI()
            app.include_router(api.router, prefix='/attendances')
            async def test_db():
                async with AsyncSession(bind=connection, join_transaction_mode='create_savepoint') as session:
                    yield session
            app.dependency_overrides[get_db] = test_db
            app.dependency_overrides[get_current_user] = lambda: user
            now = datetime(2026, 9, 26, 8, tzinfo=VIETNAM_TZ)
            async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
                with patch.object(api, 'local_now', return_value=now) as clock:
                    response = await client.post('/attendances/check-in', json={'shift_id':shift})
                    assert response.status_code == 201, response.text
                    first_id = response.json()['attendance_id']
                    assert (await client.post('/attendances/check-in', json={'shift_id':shift})).status_code == 409
                    clock.return_value = now + timedelta(hours=2)
                    response = await client.post('/attendances/check-out', json={})
                    assert response.status_code == 200, response.text
                    assert response.json()['actual_work_hours'] == 2
                    assert (await client.post('/attendances/check-out', json={'attendance_id':first_id})).status_code == 409
                    clock.return_value = now + timedelta(hours=2, seconds=59)
                    response = await client.post('/attendances/check-in', json={'shift_id':shift})
                    assert response.status_code == 429, response.text
                    assert response.headers['retry-after'] == '1'
                    status = await client.get('/attendances/today-status')
                    assert status.status_code == 200, status.text
                    assert status.json()['cooldown_seconds_remaining'] == 1
                    clock.return_value = now + timedelta(hours=2, seconds=60)
                    response = await client.post('/attendances/check-in', json={'shift_id':shift})
                    assert response.status_code == 201, response.text
                    assert response.json()['attendance_id'] != first_id
                    response = await client.get('/attendances/my-history?period=2026-09')
                    assert response.status_code == 200, response.text
                    history = response.json()
                    assert len(history) == 2
                    assert history[1]['actual_work_hours'] == 2
                    assert history[0]['check_out_time'] is None
                    response = await client.get('/attendances/my-summary?period=2026-09')
                    assert response.status_code == 200, response.text
                    assert response.json()['working_days']['actual_days'] == 1
                    assert response.json()['working_days']['total_hours'] == 2
                    status = (await client.get('/attendances/today-status')).json()
                    assert status['can_check_out'] and not status['can_check_in']
            print('PASS: PostgreSQL API lifecycle, 59/60s boundary, preserved history, distinct-day summary, status, duplicate requests.')
        finally:
            await transaction.rollback()
    await engine.dispose()
    print('Temporary attendance data rolled back; production attendance rows untouched.')

if __name__ == '__main__':
    asyncio.run(main())
