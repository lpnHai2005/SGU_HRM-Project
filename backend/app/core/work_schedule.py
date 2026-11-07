"""Work Schedule transactions. All writers lock employees before schedules."""
import json
from datetime import datetime, timedelta
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from app.core.attendance import VIETNAM_TZ
from app.core.schedule_rules import check_weekly_schedule, week_bounds
from app.core.ot_cap import require_ot_within_cap

MANAGERS = {'HR_MANAGER', 'STORE_MANAGER', 'DIRECTOR'}  # ADMIN chỉ xem lịch, không phân ca

def interval(day, start, end):
    begin = datetime.combine(day, start, VIETNAM_TZ)
    finish = datetime.combine(day, end, VIETNAM_TZ)
    if finish <= begin:
        finish += timedelta(days=1)
    return begin, finish

def scope(user, params, alias='ws'):
    roles = set(user.get('roles', []))
    if roles & {'ADMIN', 'HR_MANAGER', 'DIRECTOR'}:
        return ''
    if 'STORE_MANAGER' in roles and user.get('store_id'):
        params['scope_store'] = user['store_id']
        return f' AND {alias}.store_id=:scope_store'
    if not user.get('employee_id'):
        raise HTTPException(403, 'No employee scope')
    params['scope_employee'] = user['employee_id']
    return f' AND {alias}.employee_id=:scope_employee'

async def lock_employee(db, user, employee_id, store_id):
    roles = set(user.get('roles', []))
    if not roles & MANAGERS:
        raise HTTPException(403, 'Schedule management requires manager role')
    if not user.get('_schedule_worker'):
        if employee_id == user.get('employee_id'):
            raise HTTPException(403, 'Không được tự phân, sửa hoặc hủy lịch của bản thân.')
        is_hr=(await db.execute(text('''SELECT 1 FROM users u JOIN user_roles ur USING(user_id)
            JOIN roles r USING(role_id) WHERE u.employee_id=:id AND r.role_code='HR_MANAGER' LIMIT 1'''),{'id':employee_id})).first()
        if is_hr and 'DIRECTOR' not in roles:
            raise HTTPException(403, 'Chỉ Giám đốc được quản lý lịch phân ca của HR.')
    employee = (await db.execute(text('SELECT employee_id,store_id FROM employees WHERE employee_id=:id FOR UPDATE'), {'id':employee_id})).mappings().first()
    if not employee:
        raise HTTPException(404, 'Employee not found')
    if not roles & {'ADMIN', 'HR_MANAGER', 'DIRECTOR'} and (not user.get('store_id') or employee['store_id'] != user['store_id'] or store_id != user['store_id']):
        raise HTTPException(403, 'Store is outside manager scope')
    store = (await db.execute(text('SELECT store_id,is_active FROM stores WHERE store_id=:id FOR SHARE'), {'id':store_id})).mappings().first()
    if not store:
        raise HTTPException(404, 'Store not found')
    if not store['is_active']:
        raise HTTPException(409, 'STORE_INACTIVE: không thể tạo hoặc cập nhật lịch mới tại cửa hàng đã ngừng hoạt động.')

async def ensure_assignable_employee(db, employee_id):
    status = (await db.execute(
        text('SELECT employment_status FROM employees WHERE employee_id=:id'),
        {'id':employee_id},
    )).scalar_one_or_none()
    if status is None:
        raise HTTPException(404, 'Employee not found')
    if status not in {'ACTIVE', 'PROBATION'}:
        raise HTTPException(409, 'EMPLOYEE_NOT_ELIGIBLE: chỉ nhân viên đang làm việc hoặc thử việc mới được phân ca.')

async def audit(db, user, action, old, new, reason):
    await db.execute(text('''INSERT INTO work_schedule_audits(schedule_id,actor_id,action,reason,old_values,new_values)
        VALUES(:id,:actor,:action,:reason,CAST(:old AS jsonb),CAST(:new AS jsonb))'''),
        dict(id=(new or old)['schedule_id'], actor=user['user_id'], action=action, reason=reason,
             old=json.dumps(dict(old),default=str) if old else None,
             new=json.dumps(dict(new),default=str) if new else None))

async def save(db, user, data, old=None):
    await lock_employee(db, user, data.employee_id, data.store_id)
    await ensure_assignable_employee(db, data.employee_id)
    shift = (await db.execute(text('SELECT * FROM work_shifts WHERE shift_id=:id AND is_active FOR SHARE'), {'id':data.shift_id})).mappings().first()
    if not shift:
        raise HTTPException(422, 'Shift does not exist or is inactive')
    start,end = interval(data.work_date, shift['start_time'], shift['end_time'])
    params=dict(emp=data.employee_id, store=data.store_id, shift=data.shift_id, day=data.work_date,
                start=start,end=end,notes=data.notes,id=old['schedule_id'] if old else 0)
    conflict=(await db.execute(text('''SELECT ws.schedule_id FROM work_schedules ws JOIN work_shifts sh USING(shift_id)
        WHERE ws.employee_id=:emp AND ws.cancelled_at IS NULL AND ws.schedule_id<>:id
        AND COALESCE(ws.starts_at,(ws.work_date+sh.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh') < :end
        AND COALESCE(ws.ends_at,(ws.work_date+sh.end_time+CASE WHEN sh.end_time<=sh.start_time THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE 'Asia/Ho_Chi_Minh') > :start
        ORDER BY ws.schedule_id'''),params)).scalars().all()
    if conflict:
        raise HTTPException(409, dict(code='SCHEDULE_CONFLICT', schedule_ids=list(conflict)))
    warnings = await enforce_weekly_rules(db, data, shift, params['id'])
    if old:
        statement='''UPDATE work_schedules SET store_id=:store,shift_id=:shift,work_date=:day,
          starts_at=:start,ends_at=:end,notes=:notes WHERE schedule_id=:id RETURNING *'''
    else:
        statement='''INSERT INTO work_schedules(employee_id,store_id,shift_id,work_date,starts_at,ends_at,notes)
          VALUES(:emp,:store,:shift,:day,:start,:end,:notes) RETURNING *'''
    try:
        async with db.begin_nested():
            row = (await db.execute(text(statement), params)).mappings().one()
    except IntegrityError as exc:
        orig = getattr(exc, 'orig', exc)
        orig_msg = str(orig)
        sqlstate = getattr(orig, 'sqlstate', None) or getattr(orig, 'pgcode', None)
        if 'work_schedules_pkey' in orig_msg or sqlstate == '23505':
            # Tự động phục hồi (Self-healing): đồng bộ lại sequence lên giá trị lớn nhất hiện có và thử lại
            await db.execute(text("""
                SELECT setval(
                    pg_get_serial_sequence('work_schedules', 'schedule_id'),
                    COALESCE(MAX(schedule_id), 1) + 1
                ) FROM work_schedules;
            """))
            try:
                async with db.begin_nested():
                    row = (await db.execute(text(statement), params)).mappings().one()
            except Exception:
                raise HTTPException(409, detail="Xung đột mã dữ liệu ca làm việc trên hệ thống. Vui lòng thử lại sau ít giây.")
        elif 'fk_ws_emp' in orig_msg:
            raise HTTPException(404, detail="Nhân viên không tồn tại trong hệ thống.")
        elif 'fk_ws_shift' in orig_msg:
            raise HTTPException(422, detail="Ca làm việc không hợp lệ hoặc đã bị khóa.")
        elif 'fk_ws_store' in orig_msg:
            raise HTTPException(422, detail="Cửa hàng không tồn tại hoặc đã ngừng hoạt động.")
        else:
            raise HTTPException(409, detail="Dữ liệu ca làm việc bị trùng lặp hoặc vi phạm quy định phân ca.")
    await audit(db, user, 'UPDATE' if old else 'CREATE', old, row, data.reason)
    result = dict(row)
    if warnings:
        result['warnings'] = warnings
    return result


async def enforce_weekly_rules(db, data, shift, exclude_id):
    """Tuần T2–CN: chặn khi không còn ngày OFF; cảnh báo khi vượt 48h; chặn OT ca Full vượt trần tháng."""
    monday, sunday = week_bounds(data.work_date)
    rows = (await db.execute(text('''SELECT ws.work_date, SUM(sh.work_hours) AS hours
        FROM work_schedules ws JOIN work_shifts sh USING(shift_id)
        WHERE ws.employee_id=:emp AND ws.cancelled_at IS NULL AND ws.schedule_id<>:id
          AND ws.work_date BETWEEN :mon AND :sun GROUP BY ws.work_date'''),
        dict(emp=data.employee_id, id=exclude_id, mon=monday, sun=sunday))).all()
    by_day = {r[0]: float(r[1] or 0) for r in rows}
    by_day[data.work_date] = by_day.get(data.work_date, 0.0) + float(shift['work_hours'] or 0)
    check = check_weekly_schedule(by_day)
    if check.errors:
        # Mã lỗi lấy theo tiền tố thông điệp: WEEKLY_DAY_OFF_REQUIRED hoặc WEEKLY_HOURS_OVER_48.
        code = check.errors[0].split(':', 1)[0]
        raise HTTPException(409, dict(code=code, message=check.errors[0], week_start=str(monday),
                                      week_end=str(sunday), work_days=check.work_days,
                                      regular_hours=check.regular_hours))
    planned_ot = float(shift.get('planned_overtime_hours') or 0)
    if planned_ot > 0:
        await require_ot_within_cap(db, data.employee_id, data.work_date.strftime('%Y-%m'), planned_ot,
                                    exclude_schedule_id=exclude_id)
    return list(check.warnings)
