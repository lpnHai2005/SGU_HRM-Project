"""Read-model integration tests in rollback-only temporary PostgreSQL tables."""
import asyncio
from datetime import date, datetime
from zoneinfo import ZoneInfo
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import engine
from app.api.v1.endpoints.operations import activity, options, notifications, read_notification, monthly_attendance
from app.api.v1.endpoints.reports import get_dashboard_stats, get_dashboard_kpis

async def main():
    async with engine.connect() as conn:
        tx=await conn.begin()
        try:
            for ddl in [
                'CREATE TEMP TABLE employees(employee_id int,full_name text,department_id int,store_id int,employment_status text,position_id int) ON COMMIT DROP',
                'CREATE TEMP TABLE positions(position_id int,position_name text) ON COMMIT DROP',
                'CREATE TEMP TABLE departments(department_id int,department_name text) ON COMMIT DROP',
                'CREATE TEMP TABLE stores(store_id int,store_name text,is_active bool) ON COMMIT DROP',
                'CREATE TEMP TABLE payrolls(payroll_id int,employee_id int,salary_period text,net_salary numeric,gross_income numeric) ON COMMIT DROP',
                'CREATE TEMP TABLE employee_sales(store_id int,salary_period text,total_revenue numeric) ON COMMIT DROP',
                'CREATE TEMP TABLE work_shifts(shift_id int,shift_name text,start_time time,end_time time) ON COMMIT DROP',
                'CREATE TEMP TABLE work_schedules(schedule_id int,employee_id int,shift_id int,work_date date,cancelled_at timestamptz) ON COMMIT DROP',
                'CREATE TEMP TABLE attendances(attendance_id int,employee_id int,store_id int,shift_id int,work_date date,check_in_time timestamptz,check_out_time timestamptz,actual_work_hours numeric,late_minutes int,early_minutes int,overtime_hours numeric,status text,attendance_context jsonb) ON COMMIT DROP',
                'CREATE TEMP TABLE leave_requests(request_id int,employee_id int,status text,start_date date,end_date date,total_days numeric) ON COMMIT DROP',
                'CREATE TEMP TABLE notification_reads(user_id int,notice_id text,read_at timestamptz DEFAULT now(),PRIMARY KEY(user_id,notice_id)) ON COMMIT DROP',
                "INSERT INTO employees VALUES(1,'A',10,1,'ACTIVE',1),(2,'B',20,1,'PROBATION',2),(3,'C',10,2,'ACTIVE',1)",
                "INSERT INTO positions VALUES(1,'Sales'),(2,'Warehouse')",
                "INSERT INTO departments VALUES(10,'Sales'),(20,'Warehouse')",
                "INSERT INTO stores VALUES(1,'Store A',true),(2,'Store B',true)",
                "INSERT INTO work_shifts VALUES(1,'Morning','08:00','12:00')",
                "INSERT INTO work_schedules VALUES(101,1,1,'2026-10-12',NULL),(103,3,1,'2026-10-12',NULL)",
                """INSERT INTO attendances VALUES
                (1,1,1,1,'2026-10-12','2026-10-12 08:15+07','2026-10-12 12:00+07',3.75,15,0,0,'NORMAL','{"schedule_status":"MATCHED"}'),
                (2,1,1,1,'2026-10-12','2026-10-12 13:20+07',NULL,0,20,0,1,'LATE','{"schedule_status":"MATCHED"}'),
                (3,3,2,1,'2026-10-12','2026-10-12 08:15+07','2026-10-12 12:00+07',3.75,15,5,0,'EARLY','{"schedule_status":"SHIFT_MISMATCH"}')""",
                "INSERT INTO leave_requests VALUES(1,1,'PENDING','2026-10-12','2026-10-12',1),(2,3,'PENDING','2026-10-12','2026-10-12',1),(3,1,'HR_APPROVED','2026-10-12','2026-10-12',1)",
                'ALTER TABLE leave_requests ADD COLUMN updated_at timestamptz DEFAULT now()',
            ]: await conn.execute(text(ddl))
            async with AsyncSession(bind=conn,join_transaction_mode='create_savepoint') as db:
                admin={'roles':['ADMIN'],'employee_id':1,'user_id':1}
                manager={'roles':['STORE_MANAGER'],'store_id':1,'employee_id':2,'user_id':2}
                employee={'roles':['EMPLOYEE'],'employee_id':1,'user_id':3}
                async def get(user,**filters):
                    return await activity(date(2026,10,12),user=user,db=db,**filters)
                all_rows=await get(admin)
                assert all_rows['summary']==dict(total=3,checked_in=2,working=1,finished=1,not_checked_in=1,late=1,early=1,overtime=1),all_rows
                assert len(all_rows['employees'][0]['sessions'])==2
                assert all_rows['employees'][0]['sessions'][0]['late_minutes']==15
                assert all_rows['employees'][0]['sessions'][1]['overtime_hours']==1
                assert (await get(manager))['summary']['total']==2
                assert (await get(manager,store_id=2))['employees']==[]
                assert (await get(employee,employee_id=3))['employees']==[]
                assert (await get(admin,personal=True))['summary']['total']==1
                assert (await get(admin,department_id=20))['summary']['not_checked_in']==1
                assert len((await options(user=manager,db=db))['stores'])==1
                notices=await notifications(user=manager,db=db)
                assert [n['id'] for n in notices if n['id'].startswith('leave-')]==['leave-1-PENDING']
                assert {n['id'] for n in notices if n['id'].startswith('attendance-')}=={'attendance-in-1','attendance-out-1','attendance-in-2'}
                assert next(n for n in notices if n['id']=='attendance-in-2')['tone']=='warning'
                assert next(n for n in notices if n['id']=='attendance-out-1')['tone']=='success'
                employee_notices=await notifications(user=employee,db=db)
                assert [n['id'] for n in employee_notices if n['id'].startswith('leave-')]==['leave-3-HR_APPROVED']
                assert len([n for n in await notifications(user=admin,db=db) if n['id'].startswith('leave-')])==2
                await read_notification('leave-3-HR_APPROVED',user=employee,db=db)
                assert next(n for n in await notifications(user=employee,db=db) if n['id']=='leave-3-HR_APPROVED')['is_read'] is True
                monthly=await monthly_attendance(period='2026-10',user=admin,db=db)
                first=monthly['employees'][0]
                assert first['working_days']==1 and len(first['sessions'])==2
                assert first['late_minutes']==35 and first['overtime_hours']==1
                assert first['scheduled_hours']==4 and first['leave_days']==1
                assert len((await monthly_attendance(period='2026-10',user=manager,db=db))['employees'])==2
                assert len((await monthly_attendance(period='2026-10',user=employee,db=db))['employees'])==1
                today=datetime.now(ZoneInfo('Asia/Ho_Chi_Minh')).date()
                await db.execute(text("""INSERT INTO attendances VALUES
                    (4,1,1,1,:today,now(),now(),2,0,0,0,'NORMAL','{}'),
                    (5,1,1,1,:today,now(),NULL,0,20,0,0,'LATE','{}'),
                    (6,3,2,1,:today,now(),now(),2,15,0,0,'NORMAL','{}')"""),{'today':today})
                await db.execute(text("INSERT INTO leave_requests(request_id,employee_id,status,start_date,end_date,total_days) VALUES(4,1,'STORE_APPROVED',:today,:today,1)"),{'today':today})
                await db.execute(text("INSERT INTO leave_requests(request_id,employee_id,status,start_date,end_date,total_days) VALUES(5,2,'PENDING',:today,:today,1)"),{'today':today})
                admin_stats=await get_dashboard_stats(period='2026-10',current_user=admin,db=db)
                manager_stats=await get_dashboard_stats(period='2026-10',current_user=manager,db=db)
                assert admin_stats['active_employees']==3 and admin_stats['pending_leaves']==4
                assert admin_stats['attendance_today']=={'checked_in':2,'late':1,'working':1},admin_stats
                assert manager_stats['active_employees']==2 and manager_stats['pending_leaves']==1
                assert manager_stats['attendance_today']=={'checked_in':1,'late':1,'working':1},manager_stats
                assert (await get_dashboard_kpis(current_user=manager,db=db))['attendance_today']==manager_stats['attendance_today']
                await db.execute(text('DROP TABLE employee_sales'))
                assert (await get_dashboard_kpis(current_user=manager,db=db))['active_employees']==2
                print('PASS: unique employee metrics, multiple sessions, grace boundary, scoped dashboard KPI, filters, personal/store RBAC, notifications.')
        finally:
            await tx.rollback()
    await engine.dispose()

if __name__=='__main__': asyncio.run(main())
