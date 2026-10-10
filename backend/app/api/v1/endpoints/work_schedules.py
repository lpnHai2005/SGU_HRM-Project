"""Daily/weekly/monthly scheduling and read-only attendance reconciliation."""
from datetime import date, timedelta
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user
from app.core.database import get_db
from app.core import work_schedule as service

router=APIRouter()

class Assignment(BaseModel):
    employee_id: int = Field(gt=0)
    store_id: int = Field(gt=0)
    shift_id: int = Field(gt=0)
    work_date: date
    notes: str | None = Field(default=None, max_length=255)
    reason: str = Field(min_length=3, max_length=500)

class Batch(BaseModel):
    assignments: list[Assignment] = Field(min_length=1, max_length=366)

class Cancel(BaseModel):
    reason: str = Field(min_length=3, max_length=500)

def bounds(day, view):
    if view=='week':
        start=day-timedelta(days=day.weekday())
        return start,start+timedelta(days=5)
    if view=='month':
        start=day.replace(day=1)
        return start,(start.replace(day=28)+timedelta(days=4)).replace(day=1)-timedelta(days=1)
    return day,day

async def listing(db,user,start,end,employee_id=None,department_id=None,store_id=None,include_cancelled=False):
    if end<start or (end-start).days>366:
        raise HTTPException(422,'Date range must be ordered and at most 367 days')
    params=dict(start=start,end=end)
    where=service.scope(user,params)
    for name,value,column in [('employee',employee_id,'ws.employee_id'),('department',department_id,'e.department_id'),('store',store_id,'ws.store_id')]:
        if value is not None:
            params[name]=value; where+=f' AND {column}=:{name}'
    if not include_cancelled: where+=' AND ws.cancelled_at IS NULL'
    return [dict(r) for r in (await db.execute(text('''SELECT ws.*,e.full_name AS employee_name,e.department_id,e.employment_status,
        s.store_name,sh.shift_name,sh.start_time,sh.end_time FROM work_schedules ws
        JOIN employees e USING(employee_id) JOIN stores s ON s.store_id=ws.store_id JOIN work_shifts sh USING(shift_id)
        WHERE ws.work_date BETWEEN :start AND :end'''+where+' ORDER BY ws.work_date,ws.employee_id,ws.schedule_id'),params)).mappings().all()]

@router.get('')
async def list_schedules(day:date,view:Literal['day','week','month']='day',date_from:date|None=None,date_to:date|None=None,
    employee_id:int|None=None,department_id:int|None=None,store_id:int|None=None,include_cancelled:bool=False,
    user=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    if (date_from is None)!=(date_to is None): raise HTTPException(422,'Provide both date_from and date_to')
    start,end=(date_from,date_to) if date_from else bounds(day,view)
    return await listing(db,user,start,end,employee_id,department_id,store_id,include_cancelled)

@router.post('',status_code=201)
async def create_schedule(req:Assignment,user=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    row=await service.save(db,user,req)
    await db.commit()
    return row

@router.post('/batch',status_code=201)
async def create_batch(req:Batch,user=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    # Stable employee locking order prevents deadlocks between overlapping batches.
    rows=[]
    for item in sorted(req.assignments,key=lambda a:(a.employee_id,a.work_date,a.shift_id)):
        rows.append(await service.save(db,user,item))
    await db.commit()
    return rows

async def editable(db,user,schedule_id):
    old=(await db.execute(text('SELECT * FROM work_schedules WHERE schedule_id=:id'),{'id':schedule_id})).mappings().first()
    if not old: raise HTTPException(404,'Schedule not found')
    await service.lock_employee(db,user,old['employee_id'],old['store_id'])
    old=(await db.execute(text('SELECT * FROM work_schedules WHERE schedule_id=:id FOR UPDATE'),{'id':schedule_id})).mappings().one()
    await service.lock_employee(db,user,old['employee_id'],old['store_id'])
    if old['cancelled_at']: raise HTTPException(409,'Schedule already cancelled')
    return old

@router.put('/{schedule_id}')
async def update_schedule(schedule_id:int,req:Assignment,user=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    old=await editable(db,user,schedule_id)
    if req.employee_id!=old['employee_id']: raise HTTPException(422,'Cancel and recreate to change employee')
    if old.get('fixed_rule_id') and req.work_date!=old['work_date']:
        raise HTTPException(422,'Lịch thuộc ca cố định: hủy ngày cũ rồi phân ngày mới để giữ ngoại lệ, không đổi ngày trực tiếp.')
    referenced=(await db.execute(text("SELECT attendance_id FROM attendances WHERE attendance_context->'planned'->>'schedule_id'=:id LIMIT 1"),{'id':str(schedule_id)})).first()
    if referenced: raise HTTPException(409,'SCHEDULE_REFERENCED: use audited reconciliation; attendance snapshot is immutable')
    row=await service.save(db,user,req,old)
    await db.commit()
    return row

@router.post('/{schedule_id}/cancel')
async def cancel_schedule(schedule_id:int,req:Cancel,user=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    old=await editable(db,user,schedule_id)
    row=(await db.execute(text('UPDATE work_schedules SET cancelled_at=now() WHERE schedule_id=:id RETURNING *'),{'id':schedule_id})).mappings().one()
    await service.audit(db,user,'CANCEL',old,row,req.reason)
    await db.commit()
    return dict(row)

@router.get('/reconciliation')
async def reconciliation(day:date,view:Literal['day','week','month']='day',employee_id:int|None=None,
    department_id:int|None=None,store_id:int|None=None,user=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    start,end=bounds(day,view)
    schedules=await listing(db,user,start,end,employee_id,department_id,store_id,True)
    params=dict(start=start,end=end)
    where=service.scope(user,params,'a')
    for key,value,column in [('emp',employee_id,'a.employee_id'),('dept',department_id,'e.department_id'),('store',store_id,'a.store_id')]:
        if value is not None: params[key]=value; where+=f' AND {column}=:{key}'
    actual=[dict(r) for r in (await db.execute(text('''SELECT a.attendance_id,a.employee_id,a.store_id,a.work_date,
        a.check_in_time,a.check_out_time,a.actual_work_hours,a.late_minutes,a.early_minutes,a.overtime_hours,a.status,
        a.attendance_context,COALESCE(a.attendance_context->>'schedule_status','LEGACY_UNKNOWN') AS schedule_status
        FROM attendances a JOIN employees e USING(employee_id) WHERE a.work_date BETWEEN :start AND :end'''+where+
        ' ORDER BY a.work_date,a.employee_id,a.attendance_id'),params)).mappings().all()]
    by_schedule={}
    for attendance in actual:
        planned=(attendance.get('attendance_context') or {}).get('planned') or {}
        key=planned.get('schedule_id')
        if key is not None:
            by_schedule.setdefault(str(key),[]).append(attendance)
    for row in schedules:
        row['actual_sessions']=by_schedule.get(str(row['schedule_id']),[])
        row['reconciliation_state']='CANCELLED' if row['cancelled_at'] else ('RECORDED' if row['actual_sessions'] else 'NO_ATTENDANCE')
    linked={a['attendance_id'] for s in schedules for a in s['actual_sessions']}
    return dict(schedules=schedules,unlinked_attendances=[a for a in actual if a['attendance_id'] not in linked])

@router.get('/{schedule_id}/audit')
async def schedule_audit(schedule_id:int,user=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    params={'id':schedule_id}; where=service.scope(user,params)
    if not (await db.execute(text('SELECT schedule_id FROM work_schedules ws WHERE schedule_id=:id'+where),params)).first():
        raise HTTPException(404,'Schedule not found in your scope')
    return [dict(r) for r in (await db.execute(text('SELECT * FROM work_schedule_audits WHERE schedule_id=:id ORDER BY audit_id'),{'id':schedule_id})).mappings().all()]
