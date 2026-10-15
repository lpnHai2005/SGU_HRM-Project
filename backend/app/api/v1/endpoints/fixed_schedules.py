from datetime import date
from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel,Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.attendance import local_now
from app.core import work_schedule as schedules
from app.core.fixed_schedule import materialize
from app.api.v1.endpoints.work_schedules import Cancel

router=APIRouter()

class FixedAssignment(BaseModel):
    employee_id:int=Field(gt=0)
    store_id:int=Field(gt=0)
    shift_id:int=Field(gt=0)
    work_date:date
    notes:str=Field(default='Phân ca nhân viên chính thức',min_length=1,max_length=255)
    weekdays:str|None=None
    end_date:date|None=None

class FixedBatch(BaseModel):
    assignments:list[FixedAssignment]=Field(min_length=1,max_length=100)

@router.get('')
async def get_rules(employee_id:int,user=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    params={'emp':employee_id}
    where=schedules.scope(user,params,'r')
    return [dict(r) for r in (await db.execute(text('SELECT r.* FROM fixed_schedule_rules r WHERE employee_id=:emp AND stopped_at IS NULL'+where),params)).mappings().all()]

async def _save_fixed_rule(db, user, req: FixedAssignment):
    await schedules.lock_employee(db,user,req.employee_id,req.store_id)
    await schedules.ensure_assignable_employee(db,req.employee_id)
    if req.work_date < local_now().date(): raise HTTPException(422,'Ngày bắt đầu ca cố định không được ở quá khứ.')
    if (await db.execute(text('SELECT rule_id FROM fixed_schedule_rules WHERE employee_id=:emp AND stopped_at IS NULL'),{'emp':req.employee_id})).first():
        raise HTTPException(409,f'Nhân viên ID {req.employee_id} đã có ca cố định. Dừng ca cũ trước khi phân lại.')
    dump = dict(req.model_dump(), actor=user['user_id'])
    if not dump.get('weekdays'):
        dump['weekdays'] = '1,2,3,4,5,6'
    row=(await db.execute(text('''INSERT INTO fixed_schedule_rules(employee_id,store_id,shift_id,start_date,notes,created_by,weekdays,end_date)
        VALUES(:employee_id,:store_id,:shift_id,:work_date,:notes,:actor,:weekdays,:end_date) RETURNING *'''),dump)).mappings().one()
    try:
        count=await materialize(db,row,user)
    except HTTPException as exc:
        if exc.status_code==409 and isinstance(exc.detail,dict):
            raise HTTPException(409,f'Ca cố định trùng với lịch đã có của nhân viên {req.employee_id}. Hãy xử lý lịch xung đột trước; chưa lưu ca cố định.') from exc
        raise
    await db.execute(text("INSERT INTO fixed_schedule_audits(rule_id,actor_id,action,reason) VALUES(:id,:actor,'CREATE',:reason)"),{'id':row['rule_id'],'actor':user['user_id'],'reason':req.notes})
    return dict(row,created_count=count)

@router.post('',status_code=201)
async def create_rule(req:FixedAssignment,user=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    result = await _save_fixed_rule(db, user, req)
    await db.commit()
    return dict(result, message=f'Đã bật ca cố định và tạo {result["created_count"]} ngày làm việc.')

@router.post('/batch',status_code=201)
async def create_batch(req:FixedBatch,user=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    results = []
    for item in sorted(req.assignments, key=lambda a: a.employee_id):
        results.append(await _save_fixed_rule(db, user, item))
    await db.commit()
    total_days = sum(r['created_count'] for r in results)
    return {'rules': results, 'message': f'Đã bật ca cố định cho {len(results)} nhân viên ({total_days} ngày làm việc).'}

@router.post('/{rule_id}/stop')
async def stop_rule(rule_id:int,req:Cancel,user=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    rule=(await db.execute(text('SELECT * FROM fixed_schedule_rules WHERE rule_id=:id'),{'id':rule_id})).mappings().first()
    if not rule: raise HTTPException(404,'Không tìm thấy ca cố định.')
    await schedules.lock_employee(db,user,rule['employee_id'],rule['store_id'])
    rule=(await db.execute(text('SELECT * FROM fixed_schedule_rules WHERE rule_id=:id FOR UPDATE'),{'id':rule_id})).mappings().one()
    if rule['stopped_at']: raise HTTPException(409,'Ca cố định đã dừng.')
    rows=(await db.execute(text('''SELECT w.* FROM work_schedules w WHERE fixed_rule_id=:id AND cancelled_at IS NULL AND work_date>=:today
        AND NOT EXISTS(SELECT 1 FROM attendances a WHERE a.attendance_context->'planned'->>'schedule_id'=w.schedule_id::text)
        ORDER BY schedule_id FOR UPDATE'''),{'id':rule_id,'today':local_now().date()})).mappings().all()
    for old in rows:
        new=(await db.execute(text('UPDATE work_schedules SET cancelled_at=now() WHERE schedule_id=:id RETURNING *'),{'id':old['schedule_id']})).mappings().one()
        await schedules.audit(db,user,'CANCEL',old,new,req.reason)
    await db.execute(text('UPDATE fixed_schedule_rules SET stopped_at=now() WHERE rule_id=:id'),{'id':rule_id})
    await db.execute(text("INSERT INTO fixed_schedule_audits(rule_id,actor_id,action,reason) VALUES(:id,:actor,'STOP',:reason)"),{'id':rule_id,'actor':user['user_id'],'reason':req.reason})
    await db.commit()
    return {'message':'Đã dừng ca cố định. Lịch đã phát sinh chấm công được giữ nguyên.'}
