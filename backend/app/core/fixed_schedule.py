"""Materialize recurring Monday-Saturday assignments into the existing schedule flow."""
import asyncio
import logging
from datetime import timedelta
from types import SimpleNamespace
from fastapi import HTTPException
from sqlalchemy import text
from app.core.attendance import local_now
from app.core import work_schedule as schedules
from app.core.database import AsyncSessionLocal

HORIZON_DAYS = 90

def parse_weekdays(val):
    if not val:
        return {0, 1, 2, 3, 4, 5}
    res = set()
    for part in str(val).split(','):
        part = part.strip()
        if not part: continue
        try:
            n = int(part)
            if 1 <= n <= 7:
                res.add(n - 1)
            elif 0 <= n <= 6:
                res.add(n)
        except ValueError:
            pass
    return res or {0, 1, 2, 3, 4, 5}

def working_days(start, end, allowed_weekdays=None):
    if allowed_weekdays is None:
        allowed_weekdays = {0, 1, 2, 3, 4, 5}
    while start <= end:
        if start.weekday() in allowed_weekdays:
            yield start
        start += timedelta(days=1)

async def materialize(db, rule, user):
    await schedules.lock_employee(db,user,rule['employee_id'],rule['store_id'])
    employee_store=(await db.execute(text('SELECT store_id FROM employees WHERE employee_id=:id'),{'id':rule['employee_id']})).scalar_one()
    if employee_store != rule['store_id']:
        raise HTTPException(409,'Nhân viên đã chuyển cửa hàng. Dừng ca cố định cũ và phân lại tại cửa hàng mới.')
    today=local_now().date()
    start=max(today,rule['start_date'])
    end=start+timedelta(days=HORIZON_DAYS-1)
    if rule.get('end_date'):
        end=min(end, rule['end_date'])
    if start > end:
        return 0
    allowed=parse_weekdays(rule.get('weekdays'))
    existing=set((await db.execute(text('SELECT work_date FROM work_schedules WHERE fixed_rule_id=:id'),{'id':rule['rule_id']})).scalars().all())
    count=0
    for day in working_days(start,end,allowed):
        if day in existing: continue  # Includes cancelled occurrences: never resurrect them.
        data=SimpleNamespace(employee_id=rule['employee_id'],store_id=rule['store_id'],shift_id=rule['shift_id'],
            work_date=day,notes=rule['notes'],reason=f"Ca cố định #{rule['rule_id']}")
        row=await schedules.save(db,user,data)
        await db.execute(text('UPDATE work_schedules SET fixed_rule_id=:rule WHERE schedule_id=:id'),{'rule':rule['rule_id'],'id':row['schedule_id']})
        count+=1
    return count

async def refresh_rules():
    async with AsyncSessionLocal() as db:
        ids=(await db.execute(text('SELECT rule_id FROM fixed_schedule_rules WHERE stopped_at IS NULL ORDER BY employee_id'))).scalars().all()
    for rule_id in ids:
        async with AsyncSessionLocal() as db:
            try:
                rule=(await db.execute(text('SELECT * FROM fixed_schedule_rules WHERE rule_id=:id'),{'id':rule_id})).mappings().one()
                # Internal execution of a manager-authorized rule; actor remains its creator.
                user={'user_id':rule['created_by'],'roles':['HR_MANAGER'],'_schedule_worker':True}
                await schedules.lock_employee(db,user,rule['employee_id'],rule['store_id'])
                rule=(await db.execute(text('SELECT * FROM fixed_schedule_rules WHERE rule_id=:id FOR UPDATE'),{'id':rule_id})).mappings().one()
                if rule['stopped_at']: continue
                await materialize(db,rule,user)
                await db.execute(text('UPDATE fixed_schedule_rules SET last_error=NULL WHERE rule_id=:id'),{'id':rule_id})
                await db.commit()
            except HTTPException as exc:
                await db.rollback()
                await db.execute(text('UPDATE fixed_schedule_rules SET last_error=:error WHERE rule_id=:id'),{'id':rule_id,'error':str(exc.detail)})
                await db.commit()

async def worker():
    while True:
        try:
            await refresh_rules()
        except Exception:
            logging.getLogger('techzone_hrm').exception('Fixed schedule refresh failed; will retry')
        await asyncio.sleep(3600)
