"""Regression: today's fixed shift remains visible after its end without reviving cancelled shifts."""
import asyncio
from datetime import datetime
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import engine
from app.core.attendance import VIETNAM_TZ
from app.api.v1.endpoints import attendances
from app.api.v1.endpoints.mobile_attendance import assigned_shift


async def main():
    original_now = attendances.local_now
    async with engine.connect() as conn:
        transaction = await conn.begin()
        try:
            for sql in [
                'CREATE TEMP TABLE employees(employee_id int,store_id int,full_name text) ON COMMIT DROP',
                'CREATE TEMP TABLE stores(store_id int,store_name text) ON COMMIT DROP',
                'CREATE TEMP TABLE work_shifts(shift_id int,shift_name text,start_time time,end_time time) ON COMMIT DROP',
                'CREATE TEMP TABLE work_schedules(schedule_id int,employee_id int,store_id int,shift_id int,work_date date,cancelled_at timestamptz) ON COMMIT DROP',
                "INSERT INTO employees VALUES(4,5,'Dung')",
                "INSERT INTO stores VALUES(5,'Tan Binh')",
                "INSERT INTO work_shifts VALUES(1,'Morning','08:00','16:00'),(2,'Afternoon','17:00','21:00')",
                "INSERT INTO work_schedules VALUES(1,4,5,1,'2026-10-12',NULL),(2,4,5,2,'2026-10-12',NULL)",
            ]:
                await conn.execute(text(sql))
            async with AsyncSession(bind=conn,join_transaction_mode='create_savepoint') as db:
                user={'employee_id':4,'roles':['EMPLOYEE'],'store_id':5}
                attendances.local_now=lambda:datetime(2026,10,12,10,0,tzinfo=VIETNAM_TZ)
                assert (await assigned_shift(user=user,db=db))['shift_id']==1
                attendances.local_now=lambda:datetime(2026,10,12,22,0,tzinfo=VIETNAM_TZ)
                assert (await assigned_shift(user=user,db=db))['shift_id']==2
                await db.execute(text('UPDATE work_schedules SET cancelled_at=now() WHERE schedule_id=2'))
                assert (await assigned_shift(user=user,db=db))['shift_id']==1
                print('PASS: ongoing, completed and cancelled assigned shift selection.')
        finally:
            attendances.local_now=original_now
            await transaction.rollback()
    await engine.dispose()


if __name__=='__main__': asyncio.run(main())
