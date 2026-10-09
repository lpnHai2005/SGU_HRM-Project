"""Repair the verified TZ-004 transfer from store 2 to store 5; no attendance edits."""
import asyncio
from sqlalchemy import text
from app.core.database import AsyncSessionLocal, engine
from app.core.employee_transfers import sync_transfer_schedules

async def main():
    try:
        async with AsyncSessionLocal() as db:
            async with db.begin():
                employee = (await db.execute(text('SELECT employee_id,employee_code,full_name,store_id FROM employees WHERE employee_id=4 FOR UPDATE'))).mappings().one()
                if employee['employee_code'] != 'TZ-004' or employee['full_name'] != 'Phạm Quốc Dũng' or employee['store_id'] != 5:
                    raise RuntimeError('Employee identity or target branch changed; no repair applied.')
                print('Updated schedules:', await sync_transfer_schedules(db, 4, 2, 5))
            print('Committed schedule repair; shift IDs and attendance history unchanged.')
    finally:
        await engine.dispose()

if __name__ == '__main__': asyncio.run(main())
