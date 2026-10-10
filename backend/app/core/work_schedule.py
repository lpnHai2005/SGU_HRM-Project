"""Work Schedule transactions. All writers lock employees before schedules."""
import json
from datetime import datetime, timedelta
from fastapi import HTTPException
from sqlalchemy import text
from app.core.attendance import VIETNAM_TZ

MANAGERS = {'ADMIN', 'HR_MANAGER', 'STORE_MANAGER'}

def interval(day, start, end):
    begin = datetime.combine(day, start, VIETNAM_TZ)
    finish = datetime.combine(day, end, VIETNAM_TZ)
    if finish <= begin:
        finish += timedelta(days=1)
    return begin, finish

def scope(user, params, alias='ws'):
    roles = set(user.get('roles', []))
    if roles & {'ADMIN', 'HR_MANAGER'}:
        return ''
    if 'STORE_MANAGER' in roles and user.get('store_id'):
        params['scope_store'] = user['store_id']
        return f' AND {alias}.store_id=:scope_store'
    if not user.get('employee_id'):
        raise HTTPException(403, 'No employee scope')
    params['scope_employee'] = user['employee_id']
    return f' AND {alias}.employee_id=:scope_employee'

async def lock_employee(db, user, employee_id, store_id):
    roles = set(user.get('roles', []))
    if not roles & MANAGERS:
        raise HTTPException(403, 'Schedule management requires manager role')
    employee = (await db.execute(text('SELECT employee_id,store_id FROM employees WHERE employee_id=:id FOR UPDATE'), {'id':employee_id})).mappings().first()
    if not employee:
        raise HTTPException(404, 'Employee not found')
    if not roles & {'ADMIN', 'HR_MANAGER'} and (not user.get('store_id') or employee['store_id'] != user['store_id'] or store_id != user['store_id']):
        raise HTTPException(403, 'Store is outside manager scope')
    if not (await db.execute(text('SELECT store_id FROM stores WHERE store_id=:id'), {'id':store_id})).first():
        raise HTTPException(404, 'Store not found')

async def ensure_assignable_employee(db, employee_id):
    status = (await db.execute(
        text('SELECT employment_status FROM employees WHERE employee_id=:id'),
        {'id':employee_id},
    )).scalar_one_or_none()
    if status is None:
        raise HTTPException(404, 'Employee not found')
    if status not in {'ACTIVE', 'PROBATION'}:
        raise HTTPException(409, 'EMPLOYEE_NOT_ELIGIBLE: chỉ nhân viên đang làm việc hoặc thử việc mới được phân ca.')

async def audit(db, user, action, old, new, reason):
    await db.execute(text('''INSERT INTO work_schedule_audits(schedule_id,actor_id,action,reason,old_values,new_values)
        VALUES(:id,:actor,:action,:reason,CAST(:old AS jsonb),CAST(:new AS jsonb))'''),
        dict(id=(new or old)['schedule_id'], actor=user['user_id'], action=action, reason=reason,
             old=json.dumps(dict(old),default=str) if old else None,
             new=json.dumps(dict(new),default=str) if new else None))

async def save(db, user, data, old=None):
    await lock_employee(db, user, data.employee_id, data.store_id)
    await ensure_assignable_employee(db, data.employee_id)
    shift = (await db.execute(text('SELECT * FROM work_shifts WHERE shift_id=:id AND is_active FOR SHARE'), {'id':data.shift_id})).mappings().first()
    if not shift:
        raise HTTPException(422, 'Shift does not exist or is inactive')
    start,end = interval(data.work_date, shift['start_time'], shift['end_time'])
    params=dict(emp=data.employee_id, store=data.store_id, shift=data.shift_id, day=data.work_date,
                start=start,end=end,notes=data.notes,id=old['schedule_id'] if old else 0)
    conflict=(await db.execute(text('''SELECT ws.schedule_id FROM work_schedules ws JOIN work_shifts sh USING(shift_id)
        WHERE ws.employee_id=:emp AND ws.cancelled_at IS NULL AND ws.schedule_id<>:id
        AND COALESCE(ws.starts_at,(ws.work_date+sh.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh') < :end
        AND COALESCE(ws.ends_at,(ws.work_date+sh.end_time+CASE WHEN sh.end_time<=sh.start_time THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE 'Asia/Ho_Chi_Minh') > :start
        ORDER BY ws.schedule_id'''),params)).scalars().all()
    if conflict:
        raise HTTPException(409, dict(code='SCHEDULE_CONFLICT', schedule_ids=list(conflict)))
    if old:
        statement='''UPDATE work_schedules SET store_id=:store,shift_id=:shift,work_date=:day,
          starts_at=:start,ends_at=:end,notes=:notes WHERE schedule_id=:id RETURNING *'''
    else:
        statement='''INSERT INTO work_schedules(employee_id,store_id,shift_id,work_date,starts_at,ends_at,notes)
          VALUES(:emp,:store,:shift,:day,:start,:end,:notes) RETURNING *'''
    row=(await db.execute(text(statement),params)).mappings().one()
    await audit(db,user,'UPDATE' if old else 'CREATE',old,row,data.reason)
    return dict(row)
