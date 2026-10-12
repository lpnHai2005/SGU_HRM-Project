"""Isolated PostgreSQL workflow checks; temporary tables shadow production tables."""
import asyncio
from datetime import date
from fastapi import HTTPException
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import engine
from app.core.database import get_db
from app.api.deps import get_current_user
from app.api.v1.endpoints import stores
from app.api.v1.endpoints.attendances import require_store_web_network
from app.api.v1.endpoints.stores import StoreWrite, create_store, update_store, list_stores
from app.api.v1.endpoints.payrolls import calculate_payroll, confirm_all_payrolls, pay_all_payrolls, update_payroll_status, decide_overtime, OvertimeDecision, update_payroll_adjustments, PayrollAdjustmentRequest, reapply_payroll_adjustments, reopen_payroll_period
from app.schemas.schemas import CalculatePayrollRequest, BatchPayrollStatusRequest, PayrollStatusUpdate, PayrollPeriodReopenRequest

async def main():
    async with engine.connect() as conn:
        tx=await conn.begin()
        try:
            for sql in [
                'CREATE TEMP TABLE stores(store_id int GENERATED ALWAYS AS IDENTITY,store_code text UNIQUE,store_name text,address text,district text,city text,open_date date,manager_employee_id int,is_active bool) ON COMMIT DROP',
                'CREATE TEMP TABLE mobile_store_geofences(store_id int PRIMARY KEY,latitude float,longitude float,radius_meters int,is_active bool) ON COMMIT DROP',
                'CREATE TEMP TABLE store_web_attendance_networks(store_id int,network cidr,PRIMARY KEY(store_id,network)) ON COMMIT DROP',
                'CREATE TEMP TABLE employees(employee_id int,full_name text) ON COMMIT DROP',
                'CREATE TEMP TABLE audit_logs(user_id int,action text,entity_name text,entity_id text,old_values jsonb,new_values jsonb) ON COMMIT DROP',
                'CREATE TEMP TABLE payrolls(payroll_id int PRIMARY KEY,employee_id int,salary_period text,payment_status text,payment_date date,updated_at timestamptz,gross_income numeric,total_deduction numeric,net_salary numeric)',
                'CREATE TEMP TABLE payroll_manual_adjustments(payroll_id int PRIMARY KEY,addition_amount numeric,deduction_amount numeric,reason text,edited_by int,updated_at timestamptz DEFAULT now()) ON COMMIT DROP',
                'CREATE TEMP TABLE attendances(attendance_id bigint PRIMARY KEY,work_date date,overtime_hours numeric,check_out_time timestamptz) ON COMMIT DROP',
                'CREATE TEMP TABLE attendance_overtime_approvals(attendance_id bigint PRIMARY KEY,approved_hours numeric,decision text,reviewer_user_id int,reason text,updated_at timestamptz DEFAULT now()) ON COMMIT DROP',
                'CREATE TEMP TABLE payroll_calculation_runs(salary_period text PRIMARY KEY,calculated_at timestamptz) ON COMMIT DROP',
                "INSERT INTO payrolls VALUES(1,1,'2026-10','DRAFT',NULL,NULL,1000,100,900),(2,2,'2026-10','DRAFT',NULL,NULL,2000,200,1800)",
                "INSERT INTO attendances VALUES(11,'2026-10-12',1.5,'2026-10-12 18:00+07')",
            ]: await conn.execute(text(sql))
            async with AsyncSession(bind=conn,join_transaction_mode='create_savepoint') as db:
                admin={'user_id':1,'employee_id':99,'roles':['ADMIN']}
                payload=dict(store_code='T1',store_name='TECHZONE Store',address='Test',district='Quận 1',open_date=date(2026,10,12),latitude=10.776,longitude=106.703,radius_meters=100)
                for bad in [dict(payload,latitude=99),dict(payload,longitude=199),dict(payload,radius_meters=0),dict(payload,wifi_networks=['bad-ip']),dict(payload,wifi_networks=['192.168.1.1','192.168.1.1/32'])]:
                    try: StoreWrite(**bad)
                    except ValidationError: pass
                    else: raise AssertionError('Invalid geofence was accepted')
                created=await create_store(StoreWrite(**payload),user=admin,db=db)
                store_id=created['store_id']
                assert (await list_stores(user=admin,db=db))[0]['latitude']==10.776
                await update_store(store_id,StoreWrite(**dict(payload,latitude=10.779,radius_meters=120,wifi_networks=['192.168.1.0/24'])),user=admin,db=db)
                assert (await list_stores(user=admin,db=db))[0]['radius_meters']==120
                assert (await list_stores(user=admin,db=db))[0]['wifi_networks']==['192.168.1.0/24']
                await require_store_web_network(db,store_id,'192.168.1.224')
                try: await require_store_web_network(db,store_id,'192.168.2.4')
                except HTTPException as exc: assert exc.status_code==403
                else: raise AssertionError('Wrong web network was accepted')
                await update_store(store_id,StoreWrite(**payload),user=admin,db=db)
                await require_store_web_network(db,store_id,'192.168.2.4')
                await update_store(store_id,StoreWrite(**dict(payload,is_active=False)),user=admin,db=db)
                try: await require_store_web_network(db,store_id,'192.168.1.224',check_active=True)
                except HTTPException as exc: assert exc.status_code==403
                else: raise AssertionError('Inactive store accepted web check-in')
                assert (await db.execute(text('SELECT count(*) FROM audit_logs'))).scalar_one()==4
                app=FastAPI();app.include_router(stores.router,prefix='/stores')
                async def test_db(): yield db
                app.dependency_overrides[get_db]=test_db
                async def hr(): return {'user_id':2,'roles':['HR_MANAGER'],'employee_id':2}
                app.dependency_overrides[get_current_user]=hr
                async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test') as client:
                    assert (await client.get('/stores')).status_code==403
                    assert (await client.post('/stores',json={**payload,'open_date':'2026-10-12'})).status_code==403
                    async def admin_user(): return admin
                    app.dependency_overrides[get_current_user]=admin_user
                    assert (await client.get('/stores')).status_code==200
                    invalid={**payload,'latitude':99,'open_date':'2026-10-12'}
                    assert (await client.post('/stores',json=invalid)).status_code==422

                result=await decide_overtime(11,OvertimeDecision(approved_hours=0.5,decision='APPROVED',reason='Approved portion'),current_user=admin,db=db)
                assert result['approved_hours']==0.5
                assert (await db.execute(text('SELECT approved_hours FROM attendance_overtime_approvals'))).scalar_one()==0.5
                adjustment=PayrollAdjustmentRequest(addition_amount=50,deduction_amount=20,reason='Attendance review')
                saved=await update_payroll_adjustments(1,adjustment,current_user=admin,db=db)
                totals=(await db.execute(text('SELECT gross_income,total_deduction,net_salary FROM payrolls WHERE payroll_id=1'))).one()
                assert saved['addition_amount']==50 and tuple(map(float,totals))==(1050.0,120.0,930.0)
                await update_payroll_adjustments(1,PayrollAdjustmentRequest(addition_amount=10,deduction_amount=5,reason='Revised attendance review'),current_user=admin,db=db)
                totals=(await db.execute(text('SELECT gross_income,total_deduction,net_salary FROM payrolls WHERE payroll_id=1'))).one()
                assert tuple(map(float,totals))==(1010.0,105.0,905.0)
                assert (await db.execute(text("SELECT count(*) FROM audit_logs WHERE action='ADJUST_DRAFT_PAYROLL'"))).scalar_one()==2
                saved=[dict(r) for r in (await db.execute(text('SELECT p.employee_id,a.addition_amount,a.deduction_amount,a.reason,a.edited_by FROM payrolls p JOIN payroll_manual_adjustments a USING(payroll_id) WHERE p.payroll_id=1'))).mappings().all()]
                await db.execute(text('DELETE FROM payroll_manual_adjustments WHERE payroll_id=1'))
                await db.execute(text('UPDATE payrolls SET gross_income=1000,total_deduction=100,net_salary=900 WHERE payroll_id=1'))
                await reapply_payroll_adjustments(db,'2026-10',saved)
                totals=(await db.execute(text('SELECT gross_income,total_deduction,net_salary FROM payrolls WHERE payroll_id=1'))).one()
                assert tuple(map(float,totals))==(1010.0,105.0,905.0)
                assert (await db.execute(text('SELECT reason FROM payroll_manual_adjustments WHERE payroll_id=1'))).scalar_one()=='Revised attendance review'
                batch=BatchPayrollStatusRequest(salary_period='2026-10')
                try: await confirm_all_payrolls(batch,current_user=admin,db=db)
                except HTTPException as exc: assert exc.status_code==409
                else: raise AssertionError('Draft without approved-OT calculation was confirmed')
                await db.execute(text("INSERT INTO payroll_calculation_runs VALUES('2026-10',clock_timestamp())"))
                await confirm_all_payrolls(batch,current_user=admin,db=db)
                try: await decide_overtime(11,OvertimeDecision(approved_hours=1,decision='APPROVED',reason='Too late'),current_user=admin,db=db)
                except HTTPException as exc: assert exc.status_code==409
                else: raise AssertionError('Finalized OT was edited')
                try: await calculate_payroll(CalculatePayrollRequest(salary_period='2026-10'),current_user=admin,db=db)
                except HTTPException as exc: assert exc.status_code==409
                else: raise AssertionError('Approved period was recalculated')
                try: await update_payroll_status(1,PayrollStatusUpdate(payment_status='DRAFT'),current_user=admin,db=db)
                except HTTPException as exc: assert exc.status_code==409
                else: raise AssertionError('Approved payslip was reopened')
                await pay_all_payrolls(batch,current_user=admin,db=db)
                try: await update_payroll_adjustments(1,adjustment,current_user=admin,db=db)
                except HTTPException as exc: assert exc.status_code==409
                else: raise AssertionError('Paid payslip was edited')
                assert (await db.execute(text("SELECT count(*) FROM payrolls WHERE payment_status='PAID'"))).scalar_one()==2
                reopened=await reopen_payroll_period(PayrollPeriodReopenRequest(salary_period='2026-10',reason='Attendance correction'),current_user=admin,db=db)
                assert reopened['reopened_count']==2 and reopened['payment_status']=='NEEDS_RECALCULATION'
                assert (await db.execute(text("SELECT count(*) FROM payrolls WHERE payment_status='NEEDS_RECALCULATION' AND payment_date IS NULL"))).scalar_one()==2
                assert (await db.execute(text("SELECT count(*) FROM audit_logs WHERE action='REOPEN_PAYROLL_PERIOD'"))).scalar_one()==1
                try: await reopen_payroll_period(PayrollPeriodReopenRequest(salary_period='2026-10',reason='Again'),current_user=admin,db=db)
                except HTTPException as exc: assert exc.status_code==409
                else: raise AssertionError('Payroll period without finalized slips was reopened')
                installed=(await db.execute(text("SELECT pg_get_functiondef(p.oid) FROM pg_proc p WHERE p.proname='sp_generate_monthly_payroll'"))).scalar_one()
                assert 'attendance_overtime_approvals' in installed
                print('PASS: store GPS/IP validation, web network enforcement, draft payroll adjustments/audit, forward-only status, audited period reopen for recalculation.')
        finally: await tx.rollback()
    await engine.dispose()

if __name__=='__main__': asyncio.run(main())
