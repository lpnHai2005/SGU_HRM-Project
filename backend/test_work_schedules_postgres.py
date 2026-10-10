"""Real SQL/API tests in temporary tables. Business data is never modified."""
import asyncio
from datetime import datetime
from unittest.mock import patch
from fastapi import FastAPI
from httpx import AsyncClient,ASGITransport
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import engine,get_db
from app.api.deps import get_current_user
from app.api.v1.endpoints import work_schedules,attendances,mobile_attendance,fixed_schedules
from app.core import fixed_schedule
from app.core.attendance import VIETNAM_TZ

async def main():
 async with engine.connect() as conn:
  tx=await conn.begin()
  try:
   for ddl in [
    "CREATE TEMP TABLE employees(employee_id int PRIMARY KEY,store_id int,department_id int,full_name text,employment_status text NOT NULL DEFAULT 'ACTIVE') ON COMMIT DROP",
    'CREATE TEMP TABLE stores(store_id int PRIMARY KEY,store_name text) ON COMMIT DROP',
    'CREATE TEMP TABLE work_shifts(shift_id int PRIMARY KEY,shift_name text,start_time time,end_time time,work_hours numeric,is_active bool) ON COMMIT DROP',
    'CREATE TEMP TABLE work_schedules(schedule_id bigserial PRIMARY KEY,employee_id int,store_id int,shift_id int,work_date date,notes text,starts_at timestamptz,ends_at timestamptz,cancelled_at timestamptz) ON COMMIT DROP',
    'CREATE TEMP TABLE work_schedule_audits(audit_id bigserial,schedule_id bigint,actor_id int,action text,reason text,old_values jsonb,new_values jsonb,created_at timestamptz DEFAULT now()) ON COMMIT DROP',
    'CREATE TEMP TABLE fixed_schedule_rules(rule_id bigserial PRIMARY KEY,employee_id int,store_id int,shift_id int,start_date date,notes text,created_by int,created_at timestamptz DEFAULT now(),stopped_at timestamptz,last_error text) ON COMMIT DROP',
    'CREATE TEMP TABLE fixed_schedule_audits(audit_id bigserial,rule_id bigint,actor_id int,action text,reason text,created_at timestamptz DEFAULT now()) ON COMMIT DROP',
    'ALTER TABLE work_schedules ADD COLUMN fixed_rule_id bigint',
    'CREATE TEMP TABLE attendances(LIKE public.attendances INCLUDING ALL) ON COMMIT DROP',
    'CREATE TEMP SEQUENCE schedule_test_attendance_ids',
    "ALTER TABLE pg_temp.attendances ALTER COLUMN attendance_id SET DEFAULT nextval('pg_temp.schedule_test_attendance_ids')",
    "INSERT INTO employees VALUES(1,1,10,'Staff A'),(2,2,20,'Staff B')",
    "INSERT INTO stores VALUES(1,'Store A'),(2,'Store B')",
    "INSERT INTO work_shifts VALUES(1,'Morning','08:00','12:00',4,true),(2,'Afternoon','13:00','17:00',4,true),(3,'Overlap','11:00','15:00',4,true),(4,'Night','22:00','06:00',8,true),(5,'Early','05:00','09:00',4,true),(6,'Adjacent','12:00','13:00',1,true),(7,'Inactive','18:00','20:00',2,false)"
   ]: await conn.execute(text(ddl))
   user={'user_id':1,'employee_id':1,'store_id':1,'roles':['HR_MANAGER']}
   app=FastAPI(); app.include_router(work_schedules.router,prefix='/work-schedules'); app.include_router(attendances.router,prefix='/attendances'); app.include_router(fixed_schedules.router,prefix='/fixed-schedules')
   async def db():
    async with AsyncSession(bind=conn,join_transaction_mode='create_savepoint') as session:
     try: yield session
     except Exception: await session.rollback(); raise
   app.dependency_overrides[get_db]=db
   app.dependency_overrides[get_current_user]=lambda:user
   def item(shift=1,day='2026-10-10',emp=1,store=1):
    return dict(employee_id=emp,store_id=store,shift_id=shift,work_date=day,reason='Integration test')
   async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test') as client:
    async def create(data,status=201):
     r=await client.post('/work-schedules',json=data); assert r.status_code==status,r.text
     return r.json()
    first=await create(item()); second=await create(item(2)); await create(item(6))
    await create(item(),409); await create(item(3),409); await create(item(7),422)
    await create(item(4,'2026-10-11')); await create(item(5,'2026-10-12'),409)
    before=(await conn.execute(text('SELECT count(*) FROM pg_temp.work_schedules'))).scalar_one()
    r=await client.post('/work-schedules/batch',json={'assignments':[item(1,'2026-10-15'),item(3,'2026-10-15')]})
    assert r.status_code==409,r.text
    assert (await conn.execute(text('SELECT count(*) FROM pg_temp.work_schedules'))).scalar_one()==before
    await create(item(emp=2,store=2))
    user['roles']=['EMPLOYEE']
    assert len((await client.get('/work-schedules?day=2026-10-10')).json())==3
    assert (await client.get('/work-schedules?day=2026-10-10&employee_id=2')).json()==[]
    await create(item(1,'2026-10-20'),403)
    user['roles']=['STORE_MANAGER']; await create(item(1,'2026-10-20',2,2),403); await create(item(1,'2026-10-20',1,2),403)
    user['roles']=['HR_MANAGER']
    assert len((await client.get('/work-schedules?day=2026-10-10&department_id=20')).json())==1
    assert len((await client.get('/work-schedules?day=2026-10-10&view=month&store_id=1')).json())==4
    assert len((await client.get('/work-schedules?day=2026-10-10&view=week&store_id=1')).json())==3
    for employment_status in ['ON_LEAVE','RESIGNED']:
     await conn.execute(text('UPDATE employees SET employment_status=:status WHERE employee_id=1'),{'status':employment_status})
     assert (await client.post('/work-schedules',json=item(1,'2026-10-30'))).status_code==409
     assert (await client.put(f"/work-schedules/{second['schedule_id']}",json=item(2,'2026-10-13'))).status_code==409
     await conn.execute(text("UPDATE employees SET employment_status='ACTIVE' WHERE employee_id=1"))
    assert (await client.get('/work-schedules?day=2026-10-10&date_from=2026-10-11')).status_code==422
    assert (await client.get('/work-schedules?day=2026-10-10&date_from=2026-10-11&date_to=2026-10-10')).status_code==422
    updated=await client.put(f"/work-schedules/{second['schedule_id']}",json=item(2,'2026-10-13'))
    assert updated.status_code==200,updated.text
    assert (await client.put(f"/work-schedules/{second['schedule_id']}",json=item(3))).status_code==409
    with patch.object(attendances,'local_now',return_value=datetime(2026,10,10,8,tzinfo=VIETNAM_TZ)):
     r=await client.post('/attendances/check-in',json={'shift_id':1}); assert r.status_code==201,r.text
     snapshot=r.json()['attendance_context']; assert snapshot['planned']['schedule_id']==first['schedule_id']
    assert (await client.put(f"/work-schedules/{first['schedule_id']}",json=item(2))).status_code==409
    r=await client.post(f"/work-schedules/{first['schedule_id']}/cancel",json={'reason':'Cancelled after record'})
    assert r.status_code==200,r.text
    assert (await client.post(f"/work-schedules/{first['schedule_id']}/cancel",json={'reason':'Repeat cancel'})).status_code==409
    stored=(await conn.execute(text('SELECT attendance_context FROM pg_temp.attendances'))).scalar_one(); assert stored==snapshot
    report=await client.get('/work-schedules/reconciliation?day=2026-10-10'); assert report.status_code==200,report.text
    linked=[s for s in report.json()['schedules'] if s['schedule_id']==first['schedule_id']][0]
    assert linked['reconciliation_state']=='CANCELLED' and len(linked['actual_sessions'])==1
    audits=(await client.get(f"/work-schedules/{first['schedule_id']}/audit")).json()
    assert [a['action'] for a in audits]==['CREATE','CANCEL']
    await conn.execute(text("INSERT INTO pg_temp.attendances(employee_id,store_id,shift_id,work_date,status) VALUES(1,1,1,'2026-10-10','NORMAL')"))
    report=(await client.get('/work-schedules/reconciliation?day=2026-10-10')).json()
    assert len(report['unlinked_attendances'])==1
    assert report['unlinked_attendances'][0]['schedule_status']=='LEGACY_UNKNOWN'
    user['roles']=['EMPLOYEE']
    assert (await client.get('/attendances/shift-schedules?work_date=2026-10-10&store_id=2')).json()==[]
    assert (await client.get('/work-schedules/reconciliation?day=2026-10-10&employee_id=2')).json()=={'schedules':[],'unlinked_attendances':[]}
    # Cancelled assignments do not authorize mobile check-in.
    with patch.object(attendances,'local_now',return_value=datetime(2026,10,10,8,tzinfo=VIETNAM_TZ)):
     async with AsyncSession(bind=conn,join_transaction_mode='create_savepoint') as session:
      try: await mobile_attendance.require_assigned_shift(session,user,1)
      except Exception as exc: assert getattr(exc,'status_code',None)==409
      else: raise AssertionError('Cancelled schedule accepted')
    user['roles']=['HR_MANAGER']
    afternoon=await create(item(2,emp=2,store=2))
    user.update(employee_id=2,store_id=2,roles=['EMPLOYEE'])
    with patch.object(attendances,'local_now',return_value=datetime(2026,10,10,14,tzinfo=VIETNAM_TZ)):
     ambiguous=await client.post('/attendances/check-in',json={'shift_id':3})
     assert ambiguous.status_code==409,ambiguous.text
     matched=await client.post('/attendances/check-in',json={'shift_id':2})
     assert matched.status_code==201,matched.text
     assert matched.json()['attendance_context']['planned']['schedule_id']==afternoon['schedule_id']
    # Fixed rule is a separate opt-in; the existing daily flow above is unchanged.
    await conn.execute(text("INSERT INTO employees VALUES(3,1,10,'Fixed staff')"))
    command=dict(employee_id=3,store_id=1,shift_id=1,work_date='2026-10-18')
    assert (await client.post('/fixed-schedules',json=command)).status_code==403
    user.update(employee_id=1,store_id=1,roles=['STORE_MANAGER'])
    assert (await client.post('/fixed-schedules',json=dict(command,store_id=2))).status_code==403
    with patch.object(fixed_schedule,'HORIZON_DAYS',8), patch.object(fixed_schedule,'local_now',return_value=datetime(2026,10,10,tzinfo=VIETNAM_TZ)), patch.object(fixed_schedules,'local_now',return_value=datetime(2026,10,10,tzinfo=VIETNAM_TZ)):
     await conn.execute(text("UPDATE employees SET employment_status='ON_LEAVE' WHERE employee_id=3"))
     assert (await client.post('/fixed-schedules',json=command)).status_code==409
     await conn.execute(text("UPDATE employees SET employment_status='ACTIVE' WHERE employee_id=3"))
     made=await client.post('/fixed-schedules',json=command); assert made.status_code==201,made.text
     rule_id=made.json()['rule_id']; assert made.json()['created_count']==6
     rows=(await conn.execute(text('SELECT * FROM pg_temp.work_schedules WHERE fixed_rule_id=:id ORDER BY work_date'),{'id':rule_id})).mappings().all()
     assert all(r['work_date'].weekday()!=6 for r in rows)
     assert all(r['notes']==made.json()['notes'] for r in rows)
     move=await client.put(f"/work-schedules/{rows[0]['schedule_id']}",json=item(1,'2026-10-26',3,1))
     assert move.status_code==422,move.text
     assert (await client.post('/fixed-schedules',json=command)).status_code==409
     # Cancel one occurrence and refresh: cancelled day is not recreated.
     assert (await client.post(f"/work-schedules/{rows[0]['schedule_id']}/cancel",json={'reason':'Day off'})).status_code==200
     async with AsyncSession(bind=conn,join_transaction_mode='create_savepoint') as session:
      rule=(await session.execute(text('SELECT * FROM fixed_schedule_rules WHERE rule_id=:id'),{'id':rule_id})).mappings().one()
      assert await fixed_schedule.materialize(session,rule,user)==0
      await session.commit()
     with patch.object(fixed_schedule,'local_now',return_value=datetime(2026,10,19,tzinfo=VIETNAM_TZ)):
      async with AsyncSession(bind=conn,join_transaction_mode='create_savepoint') as session:
       assert await fixed_schedule.materialize(session,rule,user)==1
       assert await fixed_schedule.materialize(session,rule,user)==0
       await session.commit()
     # Future attendance snapshot survives stopping the rule.
     await conn.execute(text("INSERT INTO pg_temp.attendances(employee_id,store_id,shift_id,work_date,status,attendance_context) VALUES(3,1,1,:day,'NORMAL',jsonb_build_object('planned',jsonb_build_object('schedule_id',CAST(:sid AS bigint))))"),{'day':rows[1]['work_date'],'sid':rows[1]['schedule_id']})
     stopped=await client.post(f'/fixed-schedules/{rule_id}/stop',json={'reason':'Manager stops recurring shift'})
     assert stopped.status_code==200,stopped.text
     remaining=(await conn.execute(text('SELECT schedule_id FROM pg_temp.work_schedules WHERE fixed_rule_id=:id AND cancelled_at IS NULL'),{'id':rule_id})).scalars().all()
     assert remaining==[rows[1]['schedule_id']],remaining
     assert (await client.get('/fixed-schedules?employee_id=3')).json()==[]
     # Conflicting initial materialization rolls back the rule and all its days.
     conflict=await client.post('/fixed-schedules',json=command)
     assert conflict.status_code==409,conflict.text
     assert (await conn.execute(text('SELECT count(*) FROM pg_temp.fixed_schedule_rules WHERE stopped_at IS NULL'))).scalar_one()==0
     assert (await conn.execute(text('SELECT count(*) FROM pg_temp.fixed_schedule_audits'))).scalar_one()==2
    print('PASS: fixed Monday-Saturday recurrence, Sunday exclusion, RBAC, duplicate rejection, idempotent refresh, stop preserving attendance, atomic conflict rollback.')
   print('PASS: multiple shifts, duplicate/overlap/overnight/adjacency, inactive shift, atomic batch, RBAC, filters, edit/cancel/audit, attendance snapshot and reconciliation.')
  finally: await tx.rollback()
 await engine.dispose()

if __name__=='__main__': asyncio.run(main())
