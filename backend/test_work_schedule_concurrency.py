"""Two real PostgreSQL connections; isolated disposable schema, never business rows."""
import asyncio
import re
from uuid import uuid4
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException
from app.core.database import engine
from app.core.work_schedule import save
from app.api.v1.endpoints.work_schedules import Assignment

async def main():
 schema='schedule_test_'+uuid4().hex
 assert re.fullmatch(r'schedule_test_[0-9a-f]{32}',schema)
 try:
  async with engine.begin() as c:
   await c.execute(text(f'CREATE SCHEMA {schema}'))
   await c.execute(text(f'SET LOCAL search_path TO {schema}'))
   for ddl in [
    'CREATE TABLE employees(employee_id int PRIMARY KEY,store_id int)',
    'CREATE TABLE stores(store_id int PRIMARY KEY)',
    'CREATE TABLE work_shifts(shift_id int PRIMARY KEY,start_time time,end_time time,is_active bool)',
    'CREATE TABLE work_schedules(schedule_id bigserial PRIMARY KEY,employee_id int,store_id int,shift_id int,work_date date,notes text,starts_at timestamptz,ends_at timestamptz,cancelled_at timestamptz)',
    'CREATE TABLE work_schedule_audits(audit_id bigserial,schedule_id bigint,actor_id int,action text,reason text,old_values jsonb,new_values jsonb)',
    'INSERT INTO employees VALUES(1,1)', 'INSERT INTO stores VALUES(1)',
    "INSERT INTO work_shifts VALUES(1,'08:00','16:00',true),(2,'13:00','21:00',true)"
   ]: await c.execute(text(ddl))
  ready=asyncio.Event()
  user=dict(user_id=1,employee_id=1,store_id=1,roles=['HR_MANAGER'])
  async def writer(shift):
   async with AsyncSession(engine) as db:
    await db.execute(text(f'SET LOCAL search_path TO {schema}'))
    if shift==1:
     await db.execute(text('SELECT employee_id FROM employees WHERE employee_id=1 FOR UPDATE'))
     ready.set()
     await asyncio.sleep(.2)
    else: await ready.wait()
    try:
     await save(db,user,Assignment(employee_id=1,store_id=1,shift_id=shift,work_date='2026-10-10',reason='Concurrency regression'))
     await db.commit(); return 201
    except HTTPException as exc:
     await db.rollback(); return exc.status_code
  results=await asyncio.wait_for(asyncio.gather(writer(1),writer(2)),timeout=30)
  assert results==[201,409],results
  async with engine.connect() as c:
   assert (await c.execute(text(f'SELECT count(*) FROM {schema}.work_schedules'))).scalar_one()==1
   assert (await c.execute(text(f'SELECT count(*) FROM {schema}.work_schedule_audits'))).scalar_one()==1
  print('PASS: concurrent overlapping writes serialize; one assignment + audit committed, second returns 409.')
 finally:
  async with engine.begin() as c:
   await c.execute(text(f'DROP SCHEMA IF EXISTS {schema} CASCADE'))
  await engine.dispose()

if __name__=='__main__': asyncio.run(main())
