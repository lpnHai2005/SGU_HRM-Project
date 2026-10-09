import asyncio
from sqlalchemy import text
from app.core.database import AsyncSessionLocal, engine
from app.core.attendance import local_now

async def main():
    try:
        async with AsyncSessionLocal() as db:
            employees = (await db.execute(text("SELECT e.employee_id,e.employee_code,e.full_name,e.store_id,s.store_name FROM employees e LEFT JOIN stores s USING(store_id) WHERE e.full_name ILIKE :name"), {'name': '%Phạm Quốc Dũng%'})).mappings().all()
            for employee in employees:
                print('employee',dict(employee))
                schedules = (await db.execute(text('SELECT schedule_id,work_date,shift_id,store_id FROM work_schedules WHERE employee_id=:emp AND work_date>=:day ORDER BY work_date'), {'emp':employee['employee_id'],'day':local_now().date()})).mappings().all()
                print('current/future schedules', [dict(s) for s in schedules])
                active = (await db.execute(text('SELECT attendance_id,work_date,store_id,shift_id FROM attendances WHERE employee_id=:emp AND check_in_time IS NOT NULL AND check_out_time IS NULL'), {'emp':employee['employee_id']})).mappings().all()
                print('open attendance', [dict(a) for a in active])
    finally:
        await engine.dispose()

if __name__ == '__main__': asyncio.run(main())
