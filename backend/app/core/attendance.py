"""Attendance clock and session rules (Vietnam business timezone)."""
from datetime import datetime, timedelta, timezone
from math import ceil
import json
from fastapi import HTTPException

VIETNAM_TZ = timezone(timedelta(hours=7))
COOLDOWN_SECONDS = 60

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
                            end_time=shift['end_time'].isoformat(), work_hours=float(shift['work_hours'])))

def local_now():
    return datetime.now(VIETNAM_TZ)

def local_time(value):
    # Legacy timestamps without a zone represent Vietnam wall time.
    return value.replace(tzinfo=VIETNAM_TZ) if value.tzinfo is None else value.astimezone(VIETNAM_TZ)

def availability(last, now):
    active = bool(last and last['check_in_time'] and not last['check_out_time'])
    next_at = local_time(last['check_out_time']) + timedelta(seconds=COOLDOWN_SECONDS) if last and last['check_out_time'] else None
    remaining = max(0, ceil((next_at - now).total_seconds())) if next_at else 0
    checkout_remaining = max(0, ceil((local_time(last['check_in_time']) + timedelta(seconds=60) - now).total_seconds())) if active else 0
    return dict(can_check_in=not active and remaining == 0, can_check_out=active,
                checkout_seconds_remaining=checkout_remaining,
                cooldown_seconds_remaining=remaining, next_check_in_at=next_at)


def require_checkout_ready(check_in_time, now):
    remaining = max(0, ceil((local_time(check_in_time) + timedelta(seconds=60) - now).total_seconds()))
    if remaining:
        raise HTTPException(429, f'Vui lòng đợi ít nhất 60 giây sau check-in. Còn {remaining} giây.',
                            headers={'Retry-After': str(remaining)})

def require_available(last, now):
    state = availability(last, now)
    if state['can_check_out']:
        raise HTTPException(409, 'Bạn phải check-out lượt đang mở trước khi check-in tiếp.')
    if state['cooldown_seconds_remaining']:
        seconds = state['cooldown_seconds_remaining']
        raise HTTPException(429, f'Vui lòng chờ {seconds} giây trước khi check-in lại.',
                            headers={'Retry-After': str(seconds)})

def session_metrics(att, now):
    from datetime import time
    context = att.get('attendance_context')
    if isinstance(context, str):
        context = json.loads(context)
    if context:
        snapshot = context['actual']
        att = dict(att, start_time=time.fromisoformat(snapshot['start_time']),
                   end_time=time.fromisoformat(snapshot['end_time']), work_hours=snapshot['work_hours'])
    start = local_time(att['check_in_time'])
    if now < start:
        raise HTTPException(409, 'Thời gian check-out không được trước check-in.')
    hours = round((now - start).total_seconds() / 3600, 2)
    end = datetime.combine(att['work_date'], att['end_time'], VIETNAM_TZ)
    if att['end_time'] <= att['start_time']:
        end += timedelta(days=1)
    early = max(0, int((end - now).total_seconds() / 60))
    overtime = round(max(0, hours - float(att['work_hours'])), 2)
    late = (att['late_minutes'] or 0) > 15
    status = ('LATE_AND_EARLY' if late and early else 'LATE' if late else
              'EARLY' if early else 'OVERTIME' if overtime else 'NORMAL')
    return dict(actual_work_hours=hours, overtime_hours=overtime, early_minutes=early, status=status)
