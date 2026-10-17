from datetime import date, timedelta
from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel,Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.attendance import local_now
from app.core import work_schedule as schedules
from app.core.fixed_schedule import HORIZON_DAYS, materialize, parse_weekdays

router=APIRouter()

class FixedAssignment(BaseModel):
    employee_id:int=Field(gt=0)
    store_id:int=Field(gt=0)
    shift_id:int=Field(gt=0)
    work_date:date
    notes:str=Field(default='Phân ca nhân viên chính thức',min_length=1,max_length=255)
    reason:str=Field(default='Phân ca cho nhân viên chính thức',min_length=3,max_length=500)
    weekdays:str|None=None
    end_date:date|None=None

class FixedBatch(BaseModel):
    assignments:list[FixedAssignment]=Field(min_length=1,max_length=100)

class FixedChange(BaseModel):
    effective_date: date
    shift_id: int = Field(gt=0)
    weekdays: str
    notes: str = Field(min_length=1,max_length=255)
    end_date: date | None = None
    reason: str = Field(min_length=3,max_length=500)

class FixedStop(BaseModel):
    reason: str = Field(min_length=3,max_length=500)
    effective_date: date | None = None

def validate_weekdays(value: str):
    parts = value.split(',')
    if not parts or any(not p.strip().isdigit() or not 1 <= int(p.strip()) <= 7 for p in parts):
        raise HTTPException(422, 'Thứ lặp phải là các số 1–7 (Thứ Hai đến Chủ nhật).')
    return parse_weekdays(value)

def validate_effective(day: date):
    today = local_now().date()
    if day < today:
        raise HTTPException(422, 'Ngày hiệu lực không được ở quá khứ.')
    if day >= today + timedelta(days=HORIZON_DAYS):
        raise HTTPException(422, 'Ngày hiệu lực phải nằm trong cửa sổ lịch 90 ngày hiện tại.')

async def locked_rule(db, user, rule_id):
    rule=(await db.execute(text('SELECT * FROM fixed_schedule_rules WHERE rule_id=:id'),{'id':rule_id})).mappings().first()
    if not rule: raise HTTPException(404,'Không tìm thấy ca cố định.')
    await schedules.lock_employee(db,user,rule['employee_id'],rule['store_id'])
    rule=(await db.execute(text('SELECT * FROM fixed_schedule_rules WHERE rule_id=:id FOR UPDATE'),{'id':rule_id})).mappings().one()
    if rule['stopped_at']: raise HTTPException(409,'Ca cố định đã dừng.')
    return rule

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
    validate_weekdays(dump['weekdays'])
    if req.end_date and req.end_date < req.work_date:
        raise HTTPException(422, 'Ngày kết thúc phải từ ngày bắt đầu trở đi.')
    row=(await db.execute(text('''INSERT INTO fixed_schedule_rules(employee_id,store_id,shift_id,start_date,notes,created_by,weekdays,end_date)
        VALUES(:employee_id,:store_id,:shift_id,:work_date,:notes,:actor,:weekdays,:end_date) RETURNING *'''),dump)).mappings().one()
    try:
        count=await materialize(db,row,user)
    except HTTPException as exc:
        if exc.status_code==409 and isinstance(exc.detail,dict):
            raise HTTPException(409,f'Ca cố định trùng với lịch đã có của nhân viên {req.employee_id}. Hãy xử lý lịch xung đột trước; chưa lưu ca cố định.') from exc
        raise
    await db.execute(text("INSERT INTO fixed_schedule_audits(rule_id,actor_id,action,reason) VALUES(:id,:actor,'CREATE',:reason)"),{'id':row['rule_id'],'actor':user['user_id'],'reason':req.reason})
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

@router.put('/{rule_id}')
async def update_rule(rule_id:int,req:FixedChange,user=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    validate_effective(req.effective_date)
    allowed=validate_weekdays(req.weekdays)
    if req.end_date and req.end_date < req.effective_date:
        raise HTTPException(422, 'Ngày kết thúc phải từ ngày hiệu lực trở đi.')
    rule=await locked_rule(db,user,rule_id)
    if req.effective_date < rule['start_date']:
        raise HTTPException(422, 'Không thể sửa trước ngày bắt đầu của ca cố định.')
    await schedules.ensure_assignable_employee(db,rule['employee_id'])
    # Fill the old rule through the effective boundary before changing its template.
    await materialize(db,rule,user)
    rows=(await db.execute(text('''SELECT w.* FROM work_schedules w WHERE fixed_rule_id=:id AND work_date>=:day
        ORDER BY work_date,schedule_id FOR UPDATE'''),{'id':rule_id,'day':req.effective_date})).mappings().all()
    for old in rows:
        if old['cancelled_at']:
            continue  # A one-day cancellation remains an exception after the edit.
        referenced=(await db.execute(text("SELECT 1 FROM attendances a WHERE a.attendance_context->'planned'->>'schedule_id'=:id LIMIT 1"),{'id':str(old['schedule_id'])})).first()
        if referenced:
            raise HTTPException(409, 'Có lịch từ ngày hiệu lực đã phát sinh chấm công; không thể sửa hàng loạt. Hãy chọn ngày hiệu lực khác.')
        if old['work_date'].weekday() not in allowed or (req.end_date and old['work_date'] > req.end_date):
            new=(await db.execute(text('UPDATE work_schedules SET cancelled_at=now() WHERE schedule_id=:id RETURNING *'),{'id':old['schedule_id']})).mappings().one()
            await schedules.audit(db,user,'CANCEL',old,new,req.reason)
        else:
            from types import SimpleNamespace
            data=SimpleNamespace(employee_id=rule['employee_id'],store_id=rule['store_id'],shift_id=req.shift_id,
                work_date=old['work_date'],notes=req.notes,reason=req.reason)
            await schedules.save(db,user,data,old)
    await db.execute(text('''UPDATE fixed_schedule_rules SET start_date=:day,shift_id=:shift,weekdays=:weekdays,
        notes=:notes,end_date=:end_date,last_error=NULL WHERE rule_id=:id'''),
        {'id':rule_id,'day':req.effective_date,'shift':req.shift_id,'weekdays':req.weekdays,'notes':req.notes,'end_date':req.end_date})
    rule=(await db.execute(text('SELECT * FROM fixed_schedule_rules WHERE rule_id=:id'),{'id':rule_id})).mappings().one()
    created=await materialize(db,rule,user)
    await db.execute(text("INSERT INTO fixed_schedule_audits(rule_id,actor_id,action,reason) VALUES(:id,:actor,'UPDATE_FUTURE',:reason)"),
        {'id':rule_id,'actor':user['user_id'],'reason':req.reason})
    await db.commit()
    return {'message':'Đã sửa ca cố định từ ngày hiệu lực; các ngày trước đó và ngoại lệ đã hủy được giữ nguyên.','created_count':created}

@router.post('/{rule_id}/stop')
async def stop_rule(rule_id:int,req:FixedStop,user=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    rule=await locked_rule(db,user,rule_id)
    effective=req.effective_date or local_now().date()
    validate_effective(effective)
    if rule['end_date'] and effective > rule['end_date']:
        raise HTTPException(422, 'Ca cố định đã có ngày kết thúc trước ngày dừng được chọn.')
    await materialize(db,rule,user)
    rows=(await db.execute(text('''SELECT w.* FROM work_schedules w WHERE fixed_rule_id=:id AND cancelled_at IS NULL AND work_date>=:today
        AND NOT EXISTS(SELECT 1 FROM attendances a WHERE a.attendance_context->'planned'->>'schedule_id'=w.schedule_id::text)
        ORDER BY schedule_id FOR UPDATE'''),{'id':rule_id,'today':effective})).mappings().all()
    for old in rows:
        new=(await db.execute(text('UPDATE work_schedules SET cancelled_at=now() WHERE schedule_id=:id RETURNING *'),{'id':old['schedule_id']})).mappings().one()
        await schedules.audit(db,user,'CANCEL',old,new,req.reason)
    # The lead-in days have already been materialized. Retire the template now
    # so a replacement rule may be assigned at/after the stop boundary.
    await db.execute(text('UPDATE fixed_schedule_rules SET stopped_at=now(),end_date=:end WHERE rule_id=:id'),
        {'id':rule_id,'end':effective-timedelta(days=1)})
    await db.execute(text("INSERT INTO fixed_schedule_audits(rule_id,actor_id,action,reason) VALUES(:id,:actor,'STOP',:reason)"),{'id':rule_id,'actor':user['user_id'],'reason':req.reason})
    await db.commit()
    return {'message':'Đã đặt ngày dừng ca cố định. Lịch đã phát sinh chấm công được giữ nguyên.'}
