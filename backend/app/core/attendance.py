"""Attendance clock and session rules (Vietnam business timezone)."""
from datetime import datetime, time, timedelta, timezone
from math import ceil
import json
from fastapi import HTTPException

VIETNAM_TZ = timezone(timedelta(hours=7))
COOLDOWN_SECONDS = 60

def net_work_hours(elapsed_hours, break_minutes=0):
    """Trừ nghỉ giữa ca khi phiên dài hơn nửa ca + thời gian nghỉ."""
    elapsed = max(0.0, float(elapsed_hours or 0))
    brk = max(0, int(break_minutes or 0)) / 60
    if brk and elapsed > 4.0 + brk:
        elapsed -= brk
    return round(elapsed, 2)

def late_minutes(now, shift_start):
    # Count started minutes so 15m01s is outside the 15-minute grace period.
    return max(0, ceil((now - shift_start).total_seconds() / 60))

def attendance_context(shift, schedule, store_id):
    comparison = ('UNSCHEDULED' if not schedule else
                  'MATCHED' if schedule['shift_id'] == shift['shift_id'] and schedule['store_id'] == store_id
                  else 'SHIFT_MISMATCH')
    return dict(version=1, schedule_status=comparison,
                planned=dict(schedule) if schedule else None,
                actual=dict(shift_id=shift['shift_id'], start_time=shift['start_time'].isoformat(),
                            end_time=shift['end_time'].isoformat(), work_hours=float(shift['work_hours']),
                            break_minutes=int(shift.get('break_minutes') or 0),
                            planned_overtime_hours=float(shift.get('planned_overtime_hours') or 0)))

def local_now():
    return datetime.now(VIETNAM_TZ)

def local_time(value):
    # Legacy timestamps without a zone represent Vietnam wall time.
    return value.replace(tzinfo=VIETNAM_TZ) if value.tzinfo is None else value.astimezone(VIETNAM_TZ)

def is_session_overdue(att, now, grace_hours: int = 6) -> bool:
    """Xác định phiên chấm công mở (chưa checkout) đã quá hạn hay chưa.
    
    Quy tắc:
    - Tính theo giờ kết thúc ca thực tế, múi giờ Vietnam (Asia/Ho_Chi_Minh).
    - Hỗ trợ ca qua đêm (end_time <= start_time -> kết thúc vào ngày hôm sau).
    - Hết hạn khi vượt quá giờ kết thúc ca + grace_hours (tối thiểu 12 tiếng sau check-in).
    """
    if not att or not att.get('check_in_time') or att.get('check_out_time'):
        return False
    
    c_in = local_time(att['check_in_time'])
    work_date = att.get('work_date')
    if isinstance(work_date, str):
        try:
            from datetime import date
            work_date = date.fromisoformat(work_date)
        except Exception:
            work_date = c_in.date()
    elif not work_date:
        work_date = c_in.date()
        
    context = att.get('attendance_context')
    if isinstance(context, str):
        try:
            context = json.loads(context)
        except Exception:
            context = {}
    actual = (context or {}).get('actual') or {}
    
    start_t = att.get('start_time')
    if not start_t and actual.get('start_time'):
        try:
            start_t = time.fromisoformat(actual['start_time'])
        except Exception:
            pass
            
    end_t = att.get('end_time')
    if not end_t and actual.get('end_time'):
        try:
            end_t = time.fromisoformat(actual['end_time'])
        except Exception:
            pass
            
    if not end_t:
        return now > (c_in + timedelta(hours=14))
        
    if start_t and end_t <= start_t:
        # Ca qua đêm: kết thúc vào ngày hôm sau
        end_dt = datetime.combine(work_date + timedelta(days=1), end_t, VIETNAM_TZ)
    else:
        end_dt = datetime.combine(work_date, end_t, VIETNAM_TZ)
        
    cutoff = max(end_dt + timedelta(hours=grace_hours), c_in + timedelta(hours=12))
    return now > cutoff

def availability(last, now):
    has_open = bool(last and last.get('check_in_time') and not last.get('check_out_time'))
    is_overdue = is_session_overdue(last, now) if has_open else False
    active = has_open and not is_overdue
    next_at = local_time(last['check_out_time']) + timedelta(seconds=COOLDOWN_SECONDS) if last and last.get('check_out_time') else None
    remaining = max(0, ceil((next_at - now).total_seconds())) if next_at else 0
    checkout_remaining = max(0, ceil((local_time(last['check_in_time']) + timedelta(seconds=60) - now).total_seconds())) if active else 0
    return dict(can_check_in=not active and remaining == 0, can_check_out=active,
                is_active_session=active, is_overdue_open=is_overdue,
                checkout_seconds_remaining=checkout_remaining,
                cooldown_seconds_remaining=remaining, next_check_in_at=next_at)


def require_checkout_ready(check_in_time, now):
    remaining = max(0, ceil((local_time(check_in_time) + timedelta(seconds=60) - now).total_seconds()))
    if remaining:
        raise HTTPException(429, f'Vui lòng đợi ít nhất 60 giây sau check-in. Còn {remaining} giây.',
                            headers={'Retry-After': str(remaining)})

def require_available(last, now):
    state = availability(last, now)
    if state['is_active_session']:
        raise HTTPException(409, 'Bạn phải check-out lượt đang mở trước khi check-in tiếp.')
    if state['cooldown_seconds_remaining']:
        seconds = state['cooldown_seconds_remaining']
        raise HTTPException(429, f'Vui lòng chờ {seconds} giây trước khi check-in lại.',
                            headers={'Retry-After': str(seconds)})

def session_metrics(att, now):
    context = att.get('attendance_context')
    if isinstance(context, str):
        context = json.loads(context)
    if context:
        snapshot = context['actual']
        att = dict(att, start_time=time.fromisoformat(snapshot['start_time']),
                   end_time=time.fromisoformat(snapshot['end_time']), work_hours=snapshot['work_hours'],
                   break_minutes=snapshot.get('break_minutes', att.get('break_minutes') or 0))
    start = local_time(att['check_in_time'])
    if now < start:
        raise HTTPException(409, 'Thời gian check-out không được trước check-in.')
    # Attendance records the elapsed check-in/check-out duration. Shift changes
    # do not rewrite that actual-time measurement; overtime is compared with the
    # snapshotted scheduled work_hours below.
    # Giờ làm thực tế = thời gian có mặt − nghỉ giữa ca không lương (VD ca Full 13h − 1h = 12h).
    elapsed = max(0, (now - start).total_seconds()) / 3600
    hours = net_work_hours(elapsed, int(att.get('break_minutes') or 0))
    end = datetime.combine(att['work_date'], att['end_time'], VIETNAM_TZ)
    if att['end_time'] <= att['start_time']:
        end += timedelta(days=1)
    early = max(0, int((end - now).total_seconds() / 60))
    overtime = round(max(0, hours - float(att['work_hours'])), 2)
    late = (att['late_minutes'] or 0) > 15
    status = ('LATE_AND_EARLY' if late and early else 'LATE' if late else
              'EARLY' if early else 'OVERTIME' if overtime else 'NORMAL')
    return dict(actual_work_hours=hours, overtime_hours=overtime, early_minutes=early, status=status)
