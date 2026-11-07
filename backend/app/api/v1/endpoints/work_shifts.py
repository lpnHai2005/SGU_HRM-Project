"""Danh mục ca làm việc: HR / Giám đốc xem và chỉnh khung giờ ca.

Chỉ dùng các cột đã có sẵn của bảng work_shifts (không cần migration).
Lượt chấm công cũ không đổi: giờ ca được chụp vào attendance_context lúc check-in.
"""
from datetime import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import log_audit, require_roles
from app.core.database import get_db

router = APIRouter()

VIEWERS = ['HR_MANAGER', 'DIRECTOR', 'ADMIN', 'STORE_MANAGER']
EDITORS = ['HR_MANAGER', 'DIRECTOR']  # ADMIN chỉ xem nghiệp vụ
COLUMNS = 'shift_id, shift_code, shift_name, start_time, end_time, work_hours, break_minutes, is_active'


class ShiftUpdate(BaseModel):
    shift_name: str = Field(min_length=2, max_length=100)
    start_time: time
    end_time: time
    work_hours: float = Field(gt=0, le=24)
    break_minutes: int = Field(default=0, ge=0, le=240)
    is_active: bool = True

    @model_validator(mode='after')
    def hours_match(self):
        """Khung giờ − nghỉ giữa ca phải bằng giờ công định mức (ca qua đêm tính sang hôm sau)."""
        start = self.start_time.hour * 60 + self.start_time.minute
        end = self.end_time.hour * 60 + self.end_time.minute
        if start == end:
            raise ValueError('Giờ kết thúc phải khác giờ bắt đầu.')
        elapsed = (end - start) % (24 * 60)
        if self.break_minutes >= elapsed:
            raise ValueError('Thời gian nghỉ phải ngắn hơn khung giờ ca.')
        net = (elapsed - self.break_minutes) / 60
        if abs(net - self.work_hours) > 0.01:
            raise ValueError(f'Khung giờ {elapsed / 60:g}h − nghỉ {self.break_minutes} phút = {net:g}h, '
                             f'phải bằng giờ công định mức {self.work_hours:g}h.')
        return self


def _serialize(row) -> dict:
    data = dict(row)
    for key in ('start_time', 'end_time'):
        if data.get(key) is not None:
            data[key] = data[key].isoformat()
    if data.get('work_hours') is not None:
        data['work_hours'] = float(data['work_hours'])
    return data


@router.get('')
async def list_work_shifts(user=Depends(require_roles(VIEWERS)), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(text(f'SELECT {COLUMNS} FROM work_shifts ORDER BY shift_id'))).mappings().all()
    return [_serialize(r) for r in rows]


@router.put('/{shift_id}')
async def update_work_shift(shift_id: int, body: ShiftUpdate, user=Depends(require_roles(EDITORS)),
                            db: AsyncSession = Depends(get_db)):
    """HR / Giám đốc chỉnh ca. Không đổi mã ca; lượt chấm công cũ giữ nguyên giờ ca lúc check-in."""
    old = (await db.execute(text(f'SELECT {COLUMNS} FROM work_shifts WHERE shift_id=:id FOR UPDATE'),
                            {'id': shift_id})).mappings().first()
    if not old:
        raise HTTPException(404, 'Không tìm thấy ca làm việc')
    row = (await db.execute(text(f"""UPDATE work_shifts SET shift_name=:shift_name, start_time=:start_time,
            end_time=:end_time, work_hours=:work_hours, break_minutes=:break_minutes, is_active=:is_active
        WHERE shift_id=:id RETURNING {COLUMNS}"""), {**body.model_dump(), 'id': shift_id})).mappings().one()
    # log_audit tự commit: thay đổi ca và nhật ký được lưu cùng lúc.
    await log_audit(db, user.get('user_id'), 'UPDATE', 'work_shifts', shift_id, _serialize(old), _serialize(row))
    return _serialize(row)
