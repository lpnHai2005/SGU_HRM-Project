"""One-time transactional migration: payroll pays approved OT hours only.

Saves the original installed procedure in migrations for review/rollback.
Fails closed if the installed procedure no longer matches the reviewed structure.
"""
import asyncio
from pathlib import Path
from sqlalchemy import text
from app.core.database import engine

DDL = '''CREATE TABLE IF NOT EXISTS attendance_overtime_approvals (
    attendance_id BIGINT PRIMARY KEY REFERENCES attendances(attendance_id) ON DELETE CASCADE,
    approved_hours NUMERIC(8,2) NOT NULL CHECK (approved_hours >= 0),
    decision VARCHAR(12) NOT NULL CHECK (decision IN ('APPROVED','REJECTED')),
    reviewer_user_id INTEGER NOT NULL REFERENCES users(user_id),
    reason TEXT NOT NULL CHECK (length(trim(reason)) >= 3),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
)'''
RUNS = '''CREATE TABLE IF NOT EXISTS payroll_calculation_runs (
    salary_period VARCHAR(7) PRIMARY KEY,
    calculated_at TIMESTAMPTZ NOT NULL
)'''
OLD = '''SUM(overtime_hours) AS total_ot_hours,
            SUM(late_minutes + early_minutes) AS total_late_early_minutes,
            SUM(CASE WHEN late_minutes > 15 THEN 50000 ELSE 0 END) AS total_late_penalty
        FROM attendances'''
NEW = '''SUM(CASE WHEN ota.decision='APPROVED' THEN ota.approved_hours ELSE 0 END) AS total_ot_hours,
            SUM(a.late_minutes + a.early_minutes) AS total_late_early_minutes,
            SUM(CASE WHEN a.late_minutes > 15 THEN 50000 ELSE 0 END) AS total_late_penalty
        FROM attendances a LEFT JOIN attendance_overtime_approvals ota ON ota.attendance_id=a.attendance_id'''

async def main():
    backup=Path(__file__).parent/'migrations'/'20261012_original_payroll_procedure.sql'
    async with engine.begin() as conn:
        await conn.execute(text(DDL))
        await conn.execute(text('ALTER TABLE attendance_overtime_approvals ALTER COLUMN updated_at SET DEFAULT clock_timestamp()'))
        await conn.execute(text(RUNS))
        body=(await conn.execute(text("SELECT pg_get_functiondef(p.oid) FROM pg_proc p WHERE p.proname='sp_generate_monthly_payroll'"))).scalar_one()
        if 'attendance_overtime_approvals' in body:
            print('Payroll procedure already reads approved OT; run tracking ensured')
            return
        # Match normalized whitespace without changing other business rules.
        import re
        pattern=r'SUM\(overtime_hours\) AS total_ot_hours,\s*SUM\(late_minutes \+ early_minutes\) AS total_late_early_minutes,\s*SUM\(CASE WHEN late_minutes > 15 THEN 50000 ELSE 0 END\) AS total_late_penalty\s*FROM attendances'
        changed,count=re.subn(pattern,NEW,body)
        if count!=1:
            raise RuntimeError('Installed payroll procedure differs from reviewed version; migration stopped')
        # Both the attendance status and grouping columns must refer to the source table.
        changed=changed.replace("COUNT(CASE WHEN status = 'NORMAL' THEN 1 END)","COUNT(CASE WHEN a.status = 'NORMAL' THEN 1 END)")
        changed=changed.replace("COUNT(CASE WHEN status = 'ANNUAL_LEAVE' THEN 1 END)","COUNT(CASE WHEN a.status = 'ANNUAL_LEAVE' THEN 1 END)")
        changed=changed.replace("COUNT(CASE WHEN status = 'UNPAID_LEAVE' THEN 1 END)","COUNT(CASE WHEN a.status = 'UNPAID_LEAVE' THEN 1 END)")
        if not backup.exists(): backup.write_text(body,encoding='utf-8')
        await conn.execute(text(changed))
    await engine.dispose()
    print('Payroll procedure migrated to approved OT')

if __name__=='__main__': asyncio.run(main())
