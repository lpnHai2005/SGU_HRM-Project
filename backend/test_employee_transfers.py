"""PostgreSQL regression with temporary tables only; transaction always rolled back."""
import asyncio
from datetime import timedelta
from sqlalchemy import text
from app.core.database import engine
from app.core.attendance import local_now
from app.core.employee_transfers import sync_transfer_schedules

async def main():
    async with engine.connect() as db:
        transaction = await db.begin()
        try:
            await db.execute(text('CREATE TEMP TABLE work_schedules (schedule_id int, employee_id int, store_id int, shift_id int, work_date date) ON COMMIT DROP'))
            today = local_now().date()
            rows = [(1,4,2,2,today-timedelta(days=1)), (2,4,2,2,today),
                    (3,4,2,3,today+timedelta(days=1)), (4,4,3,1,today), (5,99,2,2,today)]
            for sid,emp,store,shift,day in rows:
                await db.execute(text('INSERT INTO work_schedules VALUES(:sid,:emp,:store,:shift,:day)'),
                                 dict(sid=sid,emp=emp,store=store,shift=shift,day=day))
            changed = await sync_transfer_schedules(db,4,2,5)
            assert {r['schedule_id'] for r in changed} == {2,3}
            actual = (await db.execute(text('SELECT schedule_id,store_id,shift_id FROM work_schedules ORDER BY schedule_id'))).all()
            assert [tuple(r) for r in actual] == [(1,2,2),(2,5,2),(3,5,3),(4,3,1),(5,2,2)]
            assert await sync_transfer_schedules(db,4,5,5) == []
            assert await sync_transfer_schedules(db,4,5,None) == []
            print('PASS: transfer updates current/future old-branch schedules only; preserves past, shifts, other branches/employees; no-op same/null target.')
        finally:
            await transaction.rollback()
    await engine.dispose()

if __name__ == '__main__': asyncio.run(main())
