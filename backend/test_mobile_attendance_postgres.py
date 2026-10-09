"""Opt-in integration: temporary tables, no real photo upload or business-row writes."""
import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from uuid import uuid4
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import engine, get_db
from app.api.deps import get_current_user
from app.api.v1.endpoints import mobile_attendance, attendances
from app.core.attendance import VIETNAM_TZ
from test_mobile_attendance import photo

async def main():
    async with engine.connect() as connection:
        transaction = await connection.begin()
        try:
            for table in ['attendances','mobile_store_geofences','mobile_attendance_proofs','work_schedules']:
                await connection.execute(text(f'CREATE TEMP TABLE {table} (LIKE public.{table} INCLUDING ALL) ON COMMIT DROP'))
            for table, column in [('attendances','attendance_id'),('mobile_attendance_proofs','proof_id')]:
                await connection.execute(text(f'CREATE TEMP SEQUENCE {table}_test_ids'))
                await connection.execute(text(f"ALTER TABLE pg_temp.{table} ALTER COLUMN {column} SET DEFAULT nextval('pg_temp.{table}_test_ids')"))
            user = dict((await connection.execute(text('SELECT employee_id, store_id FROM employees WHERE store_id IS NOT NULL ORDER BY employee_id LIMIT 1'))).mappings().one(), roles=['EMPLOYEE'])
            shift = (await connection.execute(text('SELECT shift_id FROM work_shifts ORDER BY shift_id LIMIT 1'))).scalar_one()
            await connection.execute(text('INSERT INTO pg_temp.mobile_store_geofences(store_id,latitude,longitude,radius_meters) VALUES(:id,10,106,150)'),{'id':user['store_id']})
            app = FastAPI()
            app.include_router(mobile_attendance.router,prefix='/mobile-attendance')
            app.include_router(attendances.router,prefix='/attendances')
            async def db():
                async with AsyncSession(bind=connection,join_transaction_mode='create_savepoint') as session:
                    try: yield session
                    except Exception:
                        await session.rollback()
                        raise
            app.dependency_overrides[get_db]=db
            app.dependency_overrides[get_current_user]=lambda:user
            def payload(lat=10):
                return dict(request_id=str(uuid4()),photo_token=photo(user['employee_id']),latitude=lat,longitude=106,accuracy_meters=5,captured_at=datetime.now(timezone.utc).isoformat(),shift_id=shift)
            now=datetime(2026,10,1,8,tzinfo=VIETNAM_TZ)
            async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test') as client:
                with patch.object(attendances,'local_now',return_value=now) as clock:
                    assert (await client.get('/mobile-attendance/geofence')).status_code==200
                    outside=await client.post('/mobile-attendance/check-in',json=payload(11))
                    assert outside.status_code==422, outside.text
                    assert (await connection.execute(text('SELECT count(*) FROM pg_temp.attendances'))).scalar_one()==0
                    missing = await client.post('/mobile-attendance/check-in',json=payload())
                    assert missing.status_code == 409, missing.text
                    await connection.execute(text('''INSERT INTO pg_temp.work_schedules(schedule_id,employee_id,store_id,shift_id,work_date)
                        VALUES(1,:emp,:store,:shift,:day)'''), {'emp':user['employee_id'],'store':user['store_id'],'shift':shift,'day':now.date()})
                    mismatch = payload(); mismatch['shift_id'] = shift + 10000
                    assert (await client.post('/mobile-attendance/check-in',json=mismatch)).status_code == 409
                    command=payload()
                    response=await client.post('/mobile-attendance/check-in',json=command)
                    assert response.status_code==201,response.text
                    first=response.json()['attendance_id']
                    assert response.json()['schedule_status']=='MATCHED'
                    retry=await client.post('/mobile-attendance/check-in',json=command)
                    assert retry.status_code==201,retry.text
                    assert retry.json()['attendance_id']==first
                    assert (await connection.execute(text('SELECT count(*) FROM pg_temp.attendances'))).scalar_one()==1
                    early_checkout = await client.post('/mobile-attendance/check-out',json=payload())
                    assert early_checkout.status_code == 429,early_checkout.text
                    assert early_checkout.headers['Retry-After']=='60'
                    assert (await connection.execute(text('SELECT check_out_time FROM pg_temp.attendances WHERE attendance_id=:id'),{'id':first})).scalar_one() is None
                    clock.return_value=now+timedelta(seconds=59)
                    assert (await client.post('/mobile-attendance/check-out',json=payload())).status_code==429
                    # A core conflict must not leave a successful/orphan proof.
                    assert (await client.post('/mobile-attendance/check-in',json=payload())).status_code==409
                    clock.return_value=now+timedelta(hours=1)
                    assert (await client.post('/mobile-attendance/check-out',json=payload())).status_code==200
                    assert (await client.post('/mobile-attendance/check-in',json=payload())).status_code==429
                    clock.return_value=now+timedelta(hours=1,seconds=60)
                    assert (await client.post('/mobile-attendance/check-in',json=payload())).status_code==201
                    history=await client.get('/attendances/my-history?period=2026-10')
                    assert history.status_code==200,history.text
                    assert len(history.json())==2
                    counts=(await connection.execute(text("SELECT verification_status,count(*) FROM pg_temp.mobile_attendance_proofs GROUP BY verification_status"))).all()
                    assert dict(counts)=={'SUCCESS':3,'REJECTED_GPS_OUT_OF_RANGE':1},counts
            print('PASS: mobile geofence, rejection log, atomic proof, check-in/out, idempotent retry, cooldown and history.')
        finally:
            await transaction.rollback()
    await engine.dispose()
    print('Temporary test data rolled back. Cloudinary upload was not called.')

if __name__=='__main__': asyncio.run(main())
