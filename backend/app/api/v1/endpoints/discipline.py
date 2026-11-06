"""Kỷ luật đi trễ tự động & cảnh báo Black-list; quản lý danh mục ca chuẩn 8h."""
from datetime import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import log_audit, require_roles
from app.core.attendance import local_now
from app.core.database import get_db
from app.core.payroll_rules import STANDARD_DAILY_HOURS

router = APIRouter()

PERIOD = r'^\d{4}-(0[1-9]|1[0-2])$'
VIEWERS = ['HR_MANAGER', 'DIRECTOR', 'ADMIN']
DECIDERS = ['HR_MANAGER', 'DIRECTOR']  # ADMIN chỉ xem nghiệp vụ


async def _require_schema(db):
    ok = (await db.execute(text("SELECT to_regclass('public.disciplinary_records') IS NOT NULL"))).scalar_one()
    if not ok:
        raise HTTPException(503, 'Chưa chạy migration 20261106_prorated_allowances_shift_ot_discipline.sql')


@router.get('/records')
async def list_records(period: str = Query(default_factory=lambda: local_now().strftime('%Y-%m'), pattern=PERIOD),
                       user=Depends(require_roles(VIEWERS)), db: AsyncSession = Depends(get_db)):
    """Biên bản trễ của kỳ + danh sách nhân viên đang bị gắn cờ BLACK_LIST_WARNING."""
    await _require_schema(db)
    records = (await db.execute(text("""SELECT d.record_id, d.employee_id, e.employee_code, e.full_name,
            s.store_name, d.salary_period, d.record_type, d.late_days, d.details, d.status, d.is_auto,
            d.created_at, d.updated_at, e.is_blacklisted_warning
        FROM disciplinary_records d JOIN employees e USING(employee_id)
        LEFT JOIN stores s ON s.store_id = e.store_id
        WHERE d.salary_period = :period AND d.status <> 'VOIDED'
        ORDER BY d.late_days DESC, e.full_name"""), {'period': period})).mappings().all()
    flagged = (await db.execute(text("""SELECT e.employee_id, e.employee_code, e.full_name, s.store_name,
            e.blacklisted_warning_at,
            (SELECT array_agg(d.salary_period ORDER BY d.salary_period DESC) FROM disciplinary_records d
             WHERE d.employee_id = e.employee_id AND d.status <> 'VOIDED') AS report_periods
        FROM employees e LEFT JOIN stores s ON s.store_id = e.store_id
        WHERE e.is_blacklisted_warning ORDER BY e.blacklisted_warning_at DESC NULLS LAST"""))).mappings().all()
    return {'period': period, 'records': [dict(r) for r in records],
            'blacklist_warnings': [dict(r) for r in flagged]}


@router.post('/evaluate')
async def evaluate(period: str = Query(pattern=PERIOD), user=Depends(require_roles(DECIDERS)),
                   db: AsyncSession = Depends(get_db)):
    """Chạy lại quy tắc: >= 5 ngày trễ >15' -> biên bản; 3 tháng liên tiếp -> BLACK_LIST_WARNING."""
    await _require_schema(db)
    count = (await db.execute(text('SELECT public.fn_evaluate_late_discipline(:period)'), {'period': period})).scalar_one()
    await db.commit()
    await log_audit(db, user.get('user_id'), 'EVALUATE', 'disciplinary_records', period, None, {'active_records': count})
    return {'period': period, 'active_records': count}


class RecordStatus(BaseModel):
    status: str = Field(pattern=r'^(ACKNOWLEDGED|VOIDED)$')
    reason: str = Field(min_length=3, max_length=500)


@router.post('/records/{record_id}/status')
async def update_record(record_id: int, body: RecordStatus, user=Depends(require_roles(DECIDERS)),
                        db: AsyncSession = Depends(get_db)):
    await _require_schema(db)
    old = (await db.execute(text('SELECT * FROM disciplinary_records WHERE record_id=:id FOR UPDATE'),
                            {'id': record_id})).mappings().first()
    if not old:
        raise HTTPException(404, 'Không tìm thấy biên bản')
    row = (await db.execute(text("""UPDATE disciplinary_records SET status=:status, is_auto=FALSE,
            details = details || jsonb_build_object('decision_reason', CAST(:reason AS text), 'decided_by', CAST(:actor AS int)),
            updated_at=clock_timestamp() WHERE record_id=:id RETURNING *"""),
        {'status': body.status, 'reason': body.reason, 'actor': user['user_id'], 'id': record_id})).mappings().one()
    await db.commit()
    await log_audit(db, user.get('user_id'), 'UPDATE', 'disciplinary_records', record_id,
                    {'status': old['status']}, {'status': body.status, 'reason': body.reason})
    return dict(row)


class ClearFlag(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


@router.post('/blacklist/{employee_id}/clear')
async def clear_blacklist(employee_id: int, body: ClearFlag, user=Depends(require_roles(DECIDERS)),
                          db: AsyncSession = Depends(get_db)):
    await _require_schema(db)
    row = (await db.execute(text("""UPDATE employees SET is_blacklisted_warning=FALSE, blacklisted_warning_at=NULL
        WHERE employee_id=:id AND is_blacklisted_warning RETURNING employee_id"""), {'id': employee_id})).first()
    if not row:
        raise HTTPException(404, 'Nhân viên không có cờ BLACK_LIST_WARNING')
    await db.commit()
    await log_audit(db, user.get('user_id'), 'CLEAR_BLACKLIST_WARNING', 'employees', employee_id,
                    {'is_blacklisted_warning': True}, {'is_blacklisted_warning': False, 'reason': body.reason})
    return {'employee_id': employee_id, 'is_blacklisted_warning': False}


# ------------------------------------------------------------------ Danh mục ca
class ShiftUpdate(BaseModel):
    shift_name: str = Field(min_length=2, max_length=100)
    start_time: time
    end_time: time
    work_hours: float = Field(gt=0, le=STANDARD_DAILY_HOURS)
    break_minutes: int = Field(default=0, ge=0, le=240)
    planned_overtime_hours: float = Field(default=0, ge=0, le=12)
    is_active: bool = True

    @model_validator(mode='after')
    def hours_match(self):
        start = self.start_time.hour * 60 + self.start_time.minute
        end = self.end_time.hour * 60 + self.end_time.minute
        elapsed = (end - start) % (24 * 60) or 24 * 60
        net = (elapsed - self.break_minutes) / 60
        expected = self.work_hours + self.planned_overtime_hours
        if abs(net - expected) > 0.01:
            raise ValueError(f'Khung giờ {elapsed / 60:g}h − nghỉ {self.break_minutes} phút = {net:g}h, '
                             f'phải bằng giờ công chuẩn {self.work_hours:g}h + OT {self.planned_overtime_hours:g}h.')
        return self


@router.put('/shifts/{shift_id}')
async def update_shift(shift_id: int, body: ShiftUpdate, user=Depends(require_roles(DECIDERS)),
                       db: AsyncSession = Depends(get_db)):
    """HR/Giám đốc chỉnh khung giờ ca. Lượt chấm công cũ giữ nguyên snapshot ca lúc check-in."""
    await _require_schema(db)
    old = (await db.execute(text('SELECT * FROM work_shifts WHERE shift_id=:id FOR UPDATE'), {'id': shift_id})).mappings().first()
    if not old:
        raise HTTPException(404, 'Không tìm thấy ca làm việc')
    row = (await db.execute(text("""UPDATE work_shifts SET shift_name=:shift_name, start_time=:start_time,
            end_time=:end_time, work_hours=:work_hours, break_minutes=:break_minutes,
            planned_overtime_hours=:planned_overtime_hours, is_active=:is_active
        WHERE shift_id=:id RETURNING *"""), {**body.model_dump(), 'id': shift_id})).mappings().one()
    await db.commit()
    await log_audit(db, user.get('user_id'), 'UPDATE', 'work_shifts', shift_id,
                    {k: str(v) for k, v in dict(old).items()}, {k: str(v) for k, v in dict(row).items()})
    return dict(row)


@router.get('/shifts')
async def list_shifts(db: AsyncSession = Depends(get_db),
                      user=Depends(require_roles(['HR_MANAGER', 'DIRECTOR', 'ADMIN', 'STORE_MANAGER']))):
    rows = (await db.execute(text('SELECT * FROM work_shifts ORDER BY shift_id'))).mappings().all()
    return [dict(r) for r in rows]


@router.get('/employees/{employee_id}/flag')
async def employee_flag(employee_id: int, user=Depends(require_roles(VIEWERS + ['STORE_MANAGER'])),
                        db: AsyncSession = Depends(get_db)) -> Optional[dict]:
    await _require_schema(db)
    row = (await db.execute(text("""SELECT employee_id, is_blacklisted_warning, blacklisted_warning_at
        FROM employees WHERE employee_id=:id"""), {'id': employee_id})).mappings().first()
    if not row:
        raise HTTPException(404, 'Không tìm thấy nhân viên')
    return dict(row)
