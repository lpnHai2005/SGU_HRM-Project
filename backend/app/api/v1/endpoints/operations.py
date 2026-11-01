"""Scoped workforce read models shared by web and mobile."""
from datetime import date, datetime, timezone, timedelta
from fastapi import APIRouter, Depends, Query, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from urllib.parse import urlsplit
import base64
import hashlib
import httpx
import json
import logging
import os
import re
from app.api.deps import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.core.work_schedule import scope

router=APIRouter()
logger=logging.getLogger(__name__)


DEFAULT_LATE_TOLERANCE_MINUTES = 15
PROJECT_GRACE_PERIOD_MINUTES = DEFAULT_LATE_TOLERANCE_MINUTES
DEFAULT_LATE_PENALTY_AMOUNT = 50000

# ATT-UI-04 Standardized Anomaly & Quality Thresholds
EXCESSIVE_LATE_THRESHOLD_MINUTES = 240
EXCESSIVE_EARLY_THRESHOLD_MINUTES = 240
SHORT_SESSION_THRESHOLD_MINUTES = 15
OVERDUE_OPEN_SESSION_DAYS = 7


async def get_late_policy_settings(db: AsyncSession) -> tuple[int, int]:
    """
    Read late policy settings from system settings / company policy table if present,
    otherwise fallback safely to standard company regulations:
    LATE_TOLERANCE_MINUTES = 15
    LATE_PENALTY_AMOUNT = 50000
    """
    tolerance = DEFAULT_LATE_TOLERANCE_MINUTES
    penalty = DEFAULT_LATE_PENALTY_AMOUNT
    try:
        check_table = await db.execute(text("SELECT to_regclass('public.system_settings') IS NOT NULL"))
        if check_table.scalar_one():
            rows = (await db.execute(text("SELECT setting_key, setting_value FROM public.system_settings WHERE setting_key IN ('LATE_TOLERANCE_MINUTES', 'LATE_PENALTY_AMOUNT')"))).all()
            for k, v in rows:
                if k == 'LATE_TOLERANCE_MINUTES' and v:
                    tolerance = int(float(v))
                elif k == 'LATE_PENALTY_AMOUNT' and v:
                    penalty = int(float(v))
    except Exception as e:
        logger.debug("Policy settings query failed, falling back to defaults: %s", e)
    return tolerance, penalty


def is_valid_late_session(row: dict, tolerance_minutes: int = 15) -> bool:
    """
    Conditions for valid late attendance session (ATT-UI-04 §II.2 & §IV.A):
    1. If HR reviewed and decided CONFIRMED_LATE -> valid late session.
    2. If HR decided EXCLUDED_INVALID or NEEDS_MORE_INFO -> not valid late.
    3. Normal technical checks:
       - late_minutes > tolerance_minutes
       - Has check_in_time and check_out_time
       - Not UNSCHEDULED, SHIFT_MISMATCH, OUTSIDE_SHIFT, INVALID_TIME
       - raw_duration_minutes > SHORT_SESSION_THRESHOLD_MINUTES (15)
       - late_minutes <= EXCESSIVE_LATE_THRESHOLD_MINUTES (240)
       - quality_status not in ("SHORT_SESSION", "OUTSIDE_SHIFT", "NEEDS_REVIEW", "OPEN_SESSION", "INVALID_TIME")
       - No anomaly flags in ("SHORT_SESSION", "SHIFT_MISMATCH", "UNSCHEDULED", "EXCESSIVE_LATE", "OPEN_SESSION", "INVALID_TIME")
    """
    ctx = row.get("attendance_context") or {}
    if isinstance(ctx, str):
        try:
            ctx = json.loads(ctx)
        except Exception:
            ctx = {}
    hr_rev = ctx.get("hr_review") or row.get("hr_review")
    if hr_rev:
        decision = hr_rev.get("review_decision")
        if decision == "CONFIRMED_LATE":
            return True
        if decision in ("EXCLUDED_INVALID", "NEEDS_MORE_INFO"):
            return False

    late_m = int(row.get("late_minutes") or 0)
    if late_m <= tolerance_minutes:
        return False
    if not row.get("check_in_time") or not row.get("check_out_time"):
        return False
    sched_status = row.get("schedule_status")
    if sched_status in ("SHIFT_MISMATCH", "UNSCHEDULED", "OUTSIDE_SHIFT", "INVALID_TIME"):
        return False
    raw_dur = row.get("raw_duration_minutes")
    if raw_dur is not None and raw_dur <= SHORT_SESSION_THRESHOLD_MINUTES:
        return False
    if late_m > EXCESSIVE_LATE_THRESHOLD_MINUTES:
        return False
    quality_status = row.get("session_quality_status", "NORMAL")
    if quality_status in ("SHORT_SESSION", "OUTSIDE_SHIFT", "NEEDS_REVIEW", "OPEN_SESSION", "INVALID_TIME"):
        return False
    flags = row.get("quality_flags") or []
    if any(f in flags for f in ("SHORT_SESSION", "SHIFT_MISMATCH", "UNSCHEDULED", "EXCESSIVE_LATE", "OPEN_SESSION", "INVALID_TIME")):
        return False
    return True


def is_grace_late_session(row: dict, tolerance_minutes: int = 15) -> bool:
    """
    Grace late session: valid session with 1 <= late_minutes <= tolerance_minutes.
    Exempt from penalty (0 VND), not counted in late_day_count.
    """
    ctx = row.get("attendance_context") or {}
    if isinstance(ctx, str):
        try:
            ctx = json.loads(ctx)
        except Exception:
            ctx = {}
    hr_rev = ctx.get("hr_review") or row.get("hr_review")
    if hr_rev:
        decision = hr_rev.get("review_decision")
        if decision in ("CONFIRMED_LATE", "EXCLUDED_INVALID", "NEEDS_MORE_INFO"):
            return False

    late_m = int(row.get("late_minutes") or 0)
    if not (1 <= late_m <= tolerance_minutes):
        return False
    if not row.get("check_in_time") or not row.get("check_out_time"):
        return False
    sched_status = row.get("schedule_status")
    if sched_status in ("SHIFT_MISMATCH", "UNSCHEDULED", "OUTSIDE_SHIFT", "INVALID_TIME"):
        return False
    raw_dur = row.get("raw_duration_minutes")
    if raw_dur is not None and raw_dur <= SHORT_SESSION_THRESHOLD_MINUTES:
        return False
    quality_status = row.get("session_quality_status", "NORMAL")
    if quality_status in ("SHORT_SESSION", "OUTSIDE_SHIFT", "NEEDS_REVIEW", "OPEN_SESSION", "INVALID_TIME"):
        return False
    flags = row.get("quality_flags") or []
    if any(f in flags for f in ("SHORT_SESSION", "SHIFT_MISMATCH", "UNSCHEDULED", "EXCESSIVE_LATE", "OPEN_SESSION", "INVALID_TIME")):
        return False
    return True


def is_valid_early_session(row: dict) -> bool:
    """
    Conditions for valid early leave session (ATT-UI-04 §II.2):
    1. Has valid check_in and check_out.
    2. Has matched shift/schedule.
    3. early_minutes > 0.
    4. Not a short session (raw_duration_minutes > SHORT_SESSION_THRESHOLD_MINUTES).
    5. Not excessive anomaly (early_minutes <= EXCESSIVE_EARLY_THRESHOLD_MINUTES) without HR verification.
    6. Quality status is NORMAL with no anomaly flags.
    """
    ctx = row.get("attendance_context") or {}
    if isinstance(ctx, str):
        try:
            ctx = json.loads(ctx)
        except Exception:
            ctx = {}
    hr_rev = ctx.get("hr_review") or row.get("hr_review")
    if hr_rev:
        decision = hr_rev.get("review_decision")
        if decision in ("EXCLUDED_INVALID", "NEEDS_MORE_INFO"):
            return False

    early_m = int(row.get("early_minutes") or 0)
    if early_m <= 0:
        return False
    if not row.get("check_in_time") or not row.get("check_out_time"):
        return False
    sched_status = row.get("schedule_status")
    if sched_status in ("SHIFT_MISMATCH", "UNSCHEDULED", "OUTSIDE_SHIFT", "INVALID_TIME"):
        return False
    raw_dur = row.get("raw_duration_minutes")
    if raw_dur is not None and raw_dur <= SHORT_SESSION_THRESHOLD_MINUTES:
        return False
    if early_m > EXCESSIVE_EARLY_THRESHOLD_MINUTES:
        return False
    quality_status = row.get("session_quality_status", "NORMAL")
    if quality_status in ("SHORT_SESSION", "OUTSIDE_SHIFT", "NEEDS_REVIEW", "OPEN_SESSION", "INVALID_TIME"):
        return False
    flags = row.get("quality_flags") or []
    if any(f in flags for f in ("SHORT_SESSION", "SHIFT_MISMATCH", "UNSCHEDULED", "EXCESSIVE_EARLY", "OPEN_SESSION", "INVALID_TIME")):
        return False
    return True


def enrich_session_record(row: dict, tolerance_minutes: int = 15) -> dict:
    """
    ATT-UI-04: Normalize and enrich attendance session with explicit duration,
    quality flags, and HR review state machine without overwriting technical status.
    """
    check_in = row.get("check_in_time")
    check_out = row.get("check_out_time")
    actual_hours = float(row.get("actual_work_hours") or 0.0)
    late_m = int(row.get("late_minutes") or 0)
    early_m = int(row.get("early_minutes") or 0)
    overtime_h = float(row.get("overtime_hours") or 0.0)

    raw_duration_minutes = None
    if check_in and check_out:
        try:
            diff_seconds = (check_out - check_in).total_seconds()
            raw_duration_minutes = max(0, round(diff_seconds / 60.0))
        except Exception:
            raw_duration_minutes = round(actual_hours * 60)
    elif check_in:
        raw_duration_minutes = None

    break_m = int(row.get("break_minutes") if row.get("break_minutes") is not None else 60)
    net_duration_minutes = None
    if raw_duration_minutes is not None:
        if raw_duration_minutes > break_m:
            net_duration_minutes = max(0, raw_duration_minutes - break_m)
        else:
            net_duration_minutes = raw_duration_minutes

    # Check if check-in occurred after shift scheduled end (for regular daytime shift)
    is_after_shift_end = False
    if check_in and row.get("scheduled_start") and row.get("scheduled_end"):
        try:
            s_start = row["scheduled_start"]
            s_end = row["scheduled_end"]
            if isinstance(s_start, str):
                s_start = datetime.strptime(s_start[:8], "%H:%M:%S").time()
            if isinstance(s_end, str):
                s_end = datetime.strptime(s_end[:8], "%H:%M:%S").time()
            c_time = check_in.time() if hasattr(check_in, 'time') else None
            if c_time and s_start and s_end and s_end > s_start:
                if c_time > s_end:
                    is_after_shift_end = True
        except Exception:
            pass

    quality_flags = []
    is_overdue_open = False
    payroll_hold = False

    # Check OPEN_SESSION and > 7 days overdue
    if check_in and not check_out:
        quality_status = "OPEN_SESSION"
        quality_flags.append("OPEN_SESSION")
        w_date = row.get("work_date")
        if w_date:
            try:
                if isinstance(w_date, str):
                    w_date_obj = datetime.strptime(w_date[:10], "%Y-%m-%d").date()
                elif hasattr(w_date, "year"):
                    w_date_obj = w_date
                else:
                    w_date_obj = date.today()
                if (date.today() - w_date_obj).days > OVERDUE_OPEN_SESSION_DAYS:
                    quality_flags.append("OVERDUE_OPEN_SESSION")
                    is_overdue_open = True
                    payroll_hold = True
            except Exception:
                pass
    elif raw_duration_minutes is not None and raw_duration_minutes <= SHORT_SESSION_THRESHOLD_MINUTES:
        quality_status = "SHORT_SESSION"
        quality_flags.append("SHORT_SESSION")
    elif late_m > EXCESSIVE_LATE_THRESHOLD_MINUTES or early_m > EXCESSIVE_EARLY_THRESHOLD_MINUTES:
        quality_status = "NEEDS_REVIEW"
        if late_m > EXCESSIVE_LATE_THRESHOLD_MINUTES:
            quality_flags.append("EXCESSIVE_LATE")
        if early_m > EXCESSIVE_EARLY_THRESHOLD_MINUTES:
            quality_flags.append("EXCESSIVE_EARLY")
    elif row.get("schedule_status") == "SHIFT_MISMATCH":
        quality_status = "OUTSIDE_SHIFT"
        quality_flags.append("SHIFT_MISMATCH")
    elif row.get("schedule_status") == "UNSCHEDULED":
        quality_status = "OUTSIDE_SHIFT"
        quality_flags.append("UNSCHEDULED")
    else:
        quality_status = "NORMAL"

    # Context & HR review parsing
    ctx = row.get("attendance_context") or {}
    if isinstance(ctx, str):
        try:
            ctx = json.loads(ctx)
        except Exception:
            ctx = {}
    hr_rev = ctx.get("hr_review")
    audit_history = ctx.get("audit_history") or []

    if hr_rev:
        review_status = hr_rev.get("review_status") or "RESOLVED"
        review_decision = hr_rev.get("review_decision") or "PENDING"
    else:
        review_status = "PENDING" if (quality_status != "NORMAL" or bool(quality_flags)) else "RESOLVED"
        review_decision = "PENDING"

    row["raw_duration_minutes"] = raw_duration_minutes
    row["break_minutes"] = break_m
    row["net_duration_minutes"] = net_duration_minutes
    row["session_quality_status"] = quality_status
    row["quality_flags"] = quality_flags
    row["review_status"] = review_status
    row["review_decision"] = review_decision
    row["hr_review"] = hr_rev
    row["audit_history"] = audit_history
    row["is_overdue_open_session"] = is_overdue_open
    row["payroll_hold"] = payroll_hold
    row["outside_schedule_hours"] = overtime_h
    row["excessive_late_threshold_minutes"] = EXCESSIVE_LATE_THRESHOLD_MINUTES

    # Evaluate decision logic (Mục 3 & 4)
    if review_decision == "CONFIRMED_LATE":
        is_valid_late = True
        is_grace_late = False
        is_valid_early = False
        is_excluded = False
        needs_hr_review = False
    elif review_decision == "EXCLUDED_INVALID":
        is_valid_late = False
        is_grace_late = False
        is_valid_early = False
        is_excluded = True
        needs_hr_review = False
        actual_hours = 0.0
    elif review_decision == "SHIFT_REASSIGNED":
        is_excluded = False
        needs_hr_review = False
        is_valid_late = is_valid_late_session(row, tolerance_minutes)
        is_grace_late = is_grace_late_session(row, tolerance_minutes)
        is_valid_early = is_valid_early_session(row)
    elif review_decision == "NEEDS_MORE_INFO":
        is_excluded = False
        needs_hr_review = True
        payroll_hold = True
        is_valid_late = False
        is_grace_late = False
        is_valid_early = False
    else:  # PENDING
        is_excluded = False
        needs_hr_review = (quality_status != "NORMAL") or bool(quality_flags)
        is_valid_late = is_valid_late_session(row, tolerance_minutes)
        is_grace_late = is_grace_late_session(row, tolerance_minutes)
        is_valid_early = is_valid_early_session(row)

    row["is_excluded"] = is_excluded
    row["payroll_hold"] = payroll_hold
    row["actual_work_hours"] = actual_hours
    row["is_valid_late"] = is_valid_late
    row["is_grace_late"] = is_grace_late
    row["is_valid_early"] = is_valid_early
    row["needs_hr_review"] = needs_hr_review
    return row


@router.get('/monthly-attendance')
async def monthly_attendance(period:str=Query(...,pattern=r'^\d{4}-(0[1-9]|1[0-2])$'),
    employee_id:int|None=None,department_id:int|None=None,store_id:int|None=None,status:str|None=None,
    user=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    """Month-level workforce view; keep each attendance session for drill-down."""
    tolerance_minutes, penalty_amount = await get_late_policy_settings(db)
    
    # Lấy ngày công chuẩn động theo lịch & ghi đè từ view v_payroll_period_working_days
    # (Migration 20261031_flexible_standard_days_and_multi_tier_ot.sql - Commit b80a8c4)
    standard_working_days = 26.0
    standard_working_days_info = None
    try:
        std_row = (await db.execute(text("""
            SELECT salary_period, calendar_days, sundays_count, holidays_count,
                   auto_standard_days, manual_standard_days, locked_standard_days,
                   applied_standard_days, is_manual_override, is_locked, reason
            FROM public.v_payroll_period_working_days
            WHERE salary_period = :period
        """), {"period": period})).mappings().first()
        if std_row and std_row.get("applied_standard_days") is not None:
            standard_working_days = float(std_row["applied_standard_days"])
            standard_working_days_info = {
                "applied_standard_days": standard_working_days,
                "auto_standard_days": float(std_row["auto_standard_days"]) if std_row.get("auto_standard_days") is not None else None,
                "manual_standard_days": float(std_row["manual_standard_days"]) if std_row.get("manual_standard_days") is not None else None,
                "locked_standard_days": float(std_row["locked_standard_days"]) if std_row.get("locked_standard_days") is not None else None,
                "is_manual_override": bool(std_row["is_manual_override"]) if std_row.get("is_manual_override") is not None else False,
                "is_locked": bool(std_row["is_locked"]) if std_row.get("is_locked") is not None else False,
                "calendar_days": int(std_row["calendar_days"]) if std_row.get("calendar_days") is not None else None,
                "sundays_count": int(std_row["sundays_count"]) if std_row.get("sundays_count") is not None else None,
                "holidays_count": int(std_row["holidays_count"]) if std_row.get("holidays_count") is not None else None,
                "reason": std_row.get("reason"),
            }
    except Exception as e:
        logger.warning("Không thể lấy ngày công chuẩn từ v_payroll_period_working_days: %s", e)
        standard_working_days = 26.0

    from calendar import monthrange
    year,month=map(int,period.split('-'))
    start,end=date(year,month,1),date(year,month,monthrange(year,month)[1])
    params={'start':start,'end':end}
    where=scope(user,params,'e')
    for name,value in [('employee_id',employee_id),('department_id',department_id),('store_id',store_id)]:
        if value is not None:
            params[name]=value
            where+=f' AND e.{name}=:{name}'
    people=[dict(r) for r in (await db.execute(text('''SELECT e.employee_id,e.employee_code,e.full_name AS employee_name,
        d.department_name,s.store_name FROM employees e LEFT JOIN departments d USING(department_id)
        LEFT JOIN stores s USING(store_id) WHERE (e.employment_status IN ('ACTIVE','PROBATION') OR EXISTS
        (SELECT 1 FROM attendances a WHERE a.employee_id=e.employee_id AND a.work_date BETWEEN :start AND :end))'''+where+
        ' ORDER BY s.store_name,d.department_name,e.full_name,e.employee_id'),params)).mappings().all()]
    ids=[p['employee_id'] for p in people]
    if not ids: return {'period':period,'employees':[],'summary':{
        'total_employees':0,'with_attendance':0,'without_attendance':0,'flagged_sessions':0,
        'total_late_days':0,'total_late_sessions':0,'total_late_minutes':0,'total_late_penalty_amount':0,
        'total_grace_late_sessions':0,'total_grace_late_minutes':0,'employees_with_late':0,
        'total_early_days':0,'total_early_sessions':0,'total_early_minutes':0,'employees_with_early':0,
        'total_unreviewed_late_minutes':0,'total_unreviewed_early_minutes':0,
        'total_paid_leave_days':0.0,'total_unpaid_leave_days':0.0,'total_verified_ot_hours':0.0,
        'standard_working_days': standard_working_days,
    },'late_tolerance_minutes':tolerance_minutes,'late_penalty_amount':penalty_amount,'excessive_late_threshold_minutes':EXCESSIVE_LATE_THRESHOLD_MINUTES,
    'standard_working_days': standard_working_days, 'standard_working_days_info': standard_working_days_info}
    params['ids']=ids
    sessions=[dict(r) for r in (await db.execute(text('''SELECT a.attendance_id,a.employee_id,a.store_id,a.work_date,a.check_in_time,a.check_out_time,
        a.actual_work_hours,a.late_minutes,a.early_minutes,a.overtime_hours,a.status,a.attendance_context,
        COALESCE(a.attendance_context->>'schedule_status','LEGACY_UNKNOWN') AS schedule_status,
        sh.shift_name,sh.start_time AS scheduled_start,sh.end_time AS scheduled_end,sh.work_hours AS scheduled_hours,
        COALESCE(sh.break_minutes, 60) AS break_minutes,
        s.store_name AS attendance_store_name
        FROM attendances a LEFT JOIN work_shifts sh USING(shift_id) LEFT JOIN stores s ON a.store_id=s.store_id
        WHERE a.employee_id=ANY(:ids) AND a.work_date BETWEEN :start AND :end ORDER BY a.work_date,a.check_in_time,a.attendance_id'''),params)).mappings().all()]
    planned={r['employee_id']:{'hours':float(r['hours']),'days':int(r['days'])} for r in (await db.execute(text('''SELECT ws.employee_id,
        COUNT(DISTINCT ws.work_date) AS days,
        SUM(COALESCE(sh.work_hours, (EXTRACT(EPOCH FROM (sh.end_time-sh.start_time+CASE WHEN sh.end_time<=sh.start_time THEN interval '1 day' ELSE interval '0 day' END))/3600 - COALESCE(sh.break_minutes, 60)/60.0))) AS hours
        FROM work_schedules ws JOIN work_shifts sh USING(shift_id) WHERE ws.employee_id=ANY(:ids)
          AND ws.work_date BETWEEN :start AND :end
          AND (ws.cancelled_at IS NULL OR EXISTS (
              SELECT 1 FROM attendances prior WHERE prior.employee_id=ws.employee_id
              AND prior.attendance_context->'planned'->>'schedule_id'=ws.schedule_id::text))
          GROUP BY ws.employee_id'''),params)).mappings().all()}
    leaves=[dict(r) for r in (await db.execute(text('''SELECT lr.request_id,lr.employee_id,lr.start_date,lr.end_date,lr.total_days,
        COALESCE(lt.is_paid, TRUE) AS is_paid, lt.type_name
        FROM leave_requests lr
        LEFT JOIN leave_types lt USING(leave_type_id)
        WHERE lr.employee_id=ANY(:ids) AND lr.status='HR_APPROVED'
          AND lr.start_date<=:end AND lr.end_date>=:start ORDER BY lr.start_date,lr.request_id'''),params)).mappings().all()]
    ot_verified={r['employee_id']:float(r['hours']) for r in (await db.execute(text('''SELECT o.employee_id,
        COALESCE(SUM(rec.verified_microseconds)/3600000000.0, 0) AS hours
        FROM overtime_reconciliations rec
        JOIN overtime_requests o USING(request_id)
        WHERE o.employee_id=ANY(:ids) AND o.status='APPROVED'
          AND rec.status='VERIFIED' AND rec.verified_microseconds IS NOT NULL
          AND o.work_date BETWEEN :start AND :end
        GROUP BY o.employee_id'''),params)).mappings().all()}
    ot_daily_rows = (await db.execute(text('''SELECT o.employee_id, o.work_date, o.request_id,
        COALESCE(SUM(rec.verified_microseconds)/3600000000.0, 0) AS hours,
        o.starts_at, o.ends_at
        FROM overtime_reconciliations rec
        JOIN overtime_requests o USING(request_id)
        WHERE o.employee_id=ANY(:ids) AND o.status='APPROVED'
          AND rec.status='VERIFIED' AND rec.verified_microseconds IS NOT NULL
          AND o.work_date BETWEEN :start AND :end
        GROUP BY o.employee_id, o.work_date, o.request_id, o.starts_at, o.ends_at'''), params)).mappings().all()
    ot_by_date = {}
    for r in ot_daily_rows:
        key = (r['employee_id'], str(r['work_date']))
        ot_by_date[key] = {
            'verified_ot_hours': round(float(r['hours']), 2),
            'ot_request_id': r['request_id'],
            'ot_starts_at': r['starts_at'].isoformat() if r.get('starts_at') else None,
            'ot_ends_at': r['ends_at'].isoformat() if r.get('ends_at') else None,
        }
    for s in sessions:
        enrich_session_record(s, tolerance_minutes)
        s_date_key = (s['employee_id'], str(s['work_date']))
        if s_date_key in ot_by_date:
            ot_info = ot_by_date[s_date_key]
            s['has_verified_ot'] = True
            s['verified_ot_hours'] = ot_info['verified_ot_hours']
            s['ot_request_id'] = ot_info['ot_request_id']
            s['ot_starts_at'] = ot_info['ot_starts_at']
            s['ot_ends_at'] = ot_info['ot_ends_at']
        else:
            s['has_verified_ot'] = False
            s['verified_ot_hours'] = 0.0
    result=[]
    for person in people:
        rows=[r for r in sessions if r['employee_id']==person['employee_id']]
        if status and status!='ALL' and not any(r['status']==status for r in rows): continue
        lr=[r for r in leaves if r['employee_id']==person['employee_id']]
        sched_info=planned.get(person['employee_id'],{'hours':0.0,'days':0})
        paid_leave=sum(float(r['total_days']) for r in lr if r.get('is_paid') is True)
        unpaid_leave=sum(float(r['total_days']) for r in lr if r.get('is_paid') is False)

        valid_late_rows = [r for r in rows if r.get('is_valid_late')]
        grace_late_rows = [r for r in rows if r.get('is_grace_late')]
        valid_early_rows = [r for r in rows if r.get('is_valid_early')]
        needs_review_rows = [r for r in rows if r.get('needs_hr_review') or r.get('session_quality_status') != 'NORMAL' or r.get('quality_flags')]

        late_dates = sorted(list({str(r['work_date']) for r in valid_late_rows if r.get('work_date')}))
        late_day_count = len(late_dates)
        late_session_count = len(valid_late_rows)
        late_violation_count = late_session_count
        verified_late_minutes = sum(int(r.get('late_minutes') or 0) for r in valid_late_rows)
        late_penalty_amount = late_session_count * penalty_amount

        grace_late_session_count = len(grace_late_rows)
        grace_late_minutes = sum(int(r.get('late_minutes') or 0) for r in grace_late_rows)

        raw_late_minutes = sum(int(r.get('late_minutes') or 0) for r in rows)

        early_day_count = len({r['work_date'] for r in valid_early_rows})
        early_session_count = len(valid_early_rows)
        verified_early_minutes = sum(int(r.get('early_minutes') or 0) for r in valid_early_rows)
        raw_early_minutes = sum(int(r.get('early_minutes') or 0) for r in rows)

        needs_review_session_count = len(needs_review_rows)
        reconciled_status = 'NEEDS_HR_REVIEW' if needs_review_session_count > 0 else 'RECONCILED' if rows else 'PENDING'

        unreviewed_late_minutes = sum(int(s.get("late_minutes") or 0) for s in rows if s.get("needs_hr_review"))
        unreviewed_early_minutes = sum(int(s.get("early_minutes") or 0) for s in rows if s.get("needs_hr_review"))

        valid_work_rows = [r for r in rows if not r.get('is_excluded') and not r.get('payroll_hold')]
        person.update(
            sessions=rows,
            scheduled_days=sched_info['days'],
            scheduled_hours=sched_info['hours'],
            actual_work_hours=sum(float(r['actual_work_hours'] or 0) for r in valid_work_rows),
            outside_schedule_hours=sum(float(r['overtime_hours'] or 0) for r in rows),
            overtime_hours=sum(float(r['overtime_hours'] or 0) for r in rows),
            verified_ot_hours=round(ot_verified.get(person['employee_id'], 0.0), 2),
            late_day_count=late_day_count,
            late_session_count=late_session_count,
            late_violation_count=late_violation_count,
            verified_late_minutes=verified_late_minutes,
            raw_late_minutes=raw_late_minutes,
            late_minutes=verified_late_minutes,
            late_penalty_amount=late_penalty_amount,
            grace_late_session_count=grace_late_session_count,
            grace_late_minutes=grace_late_minutes,
            late_dates=late_dates,
            early_day_count=early_day_count,
            early_session_count=early_session_count,
            verified_early_minutes=verified_early_minutes,
            raw_early_minutes=raw_early_minutes,
            early_minutes=verified_early_minutes,
            unreviewed_late_minutes=unreviewed_late_minutes,
            unreviewed_early_minutes=unreviewed_early_minutes,
            needs_review_session_count=needs_review_session_count,
            flagged_sessions_count=needs_review_session_count,
            working_days=len({r['work_date'] for r in valid_work_rows if r.get('check_in_time')}),
            standard_working_days=standard_working_days,
            leave_requests=lr,
            paid_leave_days=paid_leave,
            unpaid_leave_days=unpaid_leave,
            leave_days=None if any(r['start_date']<start or r['end_date']>end for r in lr) else (paid_leave + unpaid_leave),
            attendance_quality_status=reconciled_status,
            statuses=sorted({r['status'] for r in rows})
        )
        result.append(person)
    summary_totals={
        'total_employees': len(people),
        'with_attendance': sum(1 for p in result if p['working_days'] > 0),
        'without_attendance': sum(1 for p in result if p['working_days'] == 0),
        'flagged_sessions': sum(p['needs_review_session_count'] for p in result),
        'needs_review_session_count': sum(p['needs_review_session_count'] for p in result),
        'total_needs_review_sessions': sum(p['needs_review_session_count'] for p in result),
        'total_late_days': sum(p['late_day_count'] for p in result),
        'total_late_sessions': sum(p['late_session_count'] for p in result),
        'total_late_minutes': sum(p['verified_late_minutes'] for p in result),
        'total_late_penalty_amount': sum(p['late_penalty_amount'] for p in result),
        'total_grace_late_sessions': sum(p['grace_late_session_count'] for p in result),
        'total_grace_late_minutes': sum(p['grace_late_minutes'] for p in result),
        'total_unreviewed_late_minutes': sum(p['unreviewed_late_minutes'] for p in result),
        'total_unreviewed_early_minutes': sum(p['unreviewed_early_minutes'] for p in result),
        'employees_with_late': sum(1 for p in result if p['late_session_count'] > 0),
        'total_early_days': sum(p['early_day_count'] for p in result),
        'total_early_sessions': sum(p['early_session_count'] for p in result),
        'total_early_minutes': sum(p['verified_early_minutes'] for p in result),
        'employees_with_early': sum(1 for p in result if p['early_session_count'] > 0),
        'total_paid_leave_days': sum(p['paid_leave_days'] for p in result),
        'total_unpaid_leave_days': sum(p['unpaid_leave_days'] for p in result),
        'total_verified_ot_hours': round(sum(p['verified_ot_hours'] for p in result), 2),
        'standard_working_days': standard_working_days,
    }
    return {
        'period': period,
        'employees': result,
        'summary': summary_totals,
        'standard_working_days': standard_working_days,
        'standard_working_days_info': standard_working_days_info,
        'late_tolerance_minutes': tolerance_minutes,
        'late_penalty_amount': penalty_amount,
        'excessive_late_threshold_minutes': EXCESSIVE_LATE_THRESHOLD_MINUTES,
    }

@router.get('/notifications')
async def notifications(user=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    params={}
    where=scope(user,params,'e')
    manager=bool(set(user.get('roles',[])) & {'ADMIN','HR_MANAGER','STORE_MANAGER','DIRECTOR'})
    condition="lr.status IN ('PENDING','STORE_APPROVED')" if manager else "lr.status IN ('HR_APPROVED','REJECTED','STORE_APPROVED')"
    rows=(await db.execute(text('''SELECT lr.request_id,lr.status,lr.updated_at,e.full_name
        FROM leave_requests lr JOIN employees e USING(employee_id)
        WHERE '''+condition+where+' ORDER BY lr.request_id DESC LIMIT 50'),params)).mappings().all()
    labels={'PENDING':'Chờ duyệt','STORE_APPROVED':'Chờ HR duyệt','HR_APPROVED':'Đã duyệt','REJECTED':'Đã từ chối'}
    result=[{'id':f"leave-{r['request_id']}-{r['status']}",'title':f"{r['full_name']} · Đơn #{r['request_id']}: {labels[r['status']]}",'href':'/leave',
             'category':'Đơn từ & nghỉ phép','tone':'success' if r['status']=='HR_APPROVED' else 'error' if r['status']=='REJECTED' else 'warning',
             'created_at':r['updated_at'].isoformat() if r['updated_at'] else None} for r in rows]
    # OT notices are projected from the append-only event row committed in the same
    # transaction as each state change. Stable event IDs make retries/read marking safe.
    roles=set(user.get('roles',[]))
    overtime_params={'ot_viewer':user['user_id']}
    recipient_clauses=['o.created_by=:ot_viewer']
    if user.get('employee_id'):
        overtime_params['ot_employee']=user['employee_id']
        recipient_clauses.append('o.employee_id=:ot_employee')
    if 'ADMIN' in roles:
        recipient_clauses.append('TRUE')
    if 'HR_MANAGER' in roles:
        recipient_clauses.append("(ev.to_status='PENDING_HR' OR ev.action IN ('EMPLOYEE_DECLINE','APPROVE','REJECT','REVOKE_REQUEST','REVOKE_APPROVE','REVOKE_REJECT','AMEND_APPROVE'))")
    if 'STORE_MANAGER' in roles and user.get('store_id'):
        overtime_params['ot_store']=user['store_id']
        recipient_clauses.append("(o.store_id=:ot_store AND ev.action IN ('SUBMIT','EMPLOYEE_CONFIRM','EMPLOYEE_DECLINE','APPROVE','REJECT','CANCEL','REVOKE_REQUEST','REVOKE_APPROVE','REVOKE_REJECT','AMEND_REQUEST','AMEND_APPROVE'))")
    overtime_rows=[]
    if (await db.execute(text("SELECT to_regclass('overtime_request_events') IS NOT NULL"))).scalar_one():
        overtime_rows=(await db.execute(text('''SELECT ev.event_id,ev.action,ev.to_status,ev.created_at,
                o.request_id,o.created_by,o.employee_id,e.full_name
            FROM overtime_request_events ev
            JOIN overtime_requests o ON o.request_id=ev.request_id
            JOIN employees e ON e.employee_id=o.employee_id
            WHERE ev.action IN ('SUBMIT','EMPLOYEE_CONFIRM','EMPLOYEE_DECLINE','APPROVE','REJECT','CANCEL','REVOKE_REQUEST','REVOKE_APPROVE','REVOKE_REJECT','AMEND_REQUEST','AMEND_APPROVE')
              AND ev.actor_id<>:ot_viewer AND ('''+ ' OR '.join(recipient_clauses) + ''')
            ORDER BY ev.created_at DESC,ev.event_id DESC LIMIT 50'''),overtime_params)).mappings().all()
    overtime_event_labels={
        'PENDING_EMPLOYEE_CONFIRMATION':'chờ nhân viên xác nhận',
        'PENDING_HR':'chờ HR duyệt',
        'APPROVED':'đã được HR duyệt',
        'REJECTED':'bị HR từ chối',
        'EMPLOYEE_DECLINED':'bị nhân viên từ chối',
        'CANCELLED':'đã được hủy',
    }
    overtime_event_labels.update({
        'REVOKE_PENDING': 'yêu cầu thu hồi đang chờ HR quyết định',
        'REVOKED': 'đã thu hồi; giữ nguyên lịch sử',
        'REVOKE_REJECTED': 'yêu cầu thu hồi bị từ chối; đơn gốc vẫn hiệu lực',
        'REPLACED': 'đơn gốc đã được thay thế',
    })
    for row in overtime_rows:
        label=overtime_event_labels.get(row['to_status'],'đã cập nhật')
        result.append({'id':f"overtime-event-{row['event_id']}",
            'title':f"{row['full_name']} · OT #{row['request_id']}: {label}",
            'href':f"/leave?tab=overtime&request_id={row['request_id']}",'category':'Đăng ký OT',
            'overtime_status':row['to_status'],
            'tone':'success' if row['to_status'] in {'APPROVED','REVOKED','REPLACED'} else 'error' if row['to_status'] in {'REJECTED','EMPLOYEE_DECLINED','REVOKE_REJECTED'} else 'warning' if row['to_status'] in {'PENDING_EMPLOYEE_CONFIRMATION','PENDING_HR','REVOKE_PENDING'} else 'info',
            'created_at':row['created_at'].isoformat() if row['created_at'] else None})
    if (await db.execute(text("""SELECT
            to_regclass('public.overtime_reconciliation_cases') IS NOT NULL AND
            to_regclass('public.overtime_reconciliation_case_events') IS NOT NULL"""))).scalar_one():
        case_params={'case_viewer':user['user_id']}
        case_recipients=['o.created_by=:case_viewer']
        if user.get('employee_id'):
            case_params['case_employee']=user['employee_id']
            case_recipients.append('o.employee_id=:case_employee')
        if roles & {'HR_MANAGER','ADMIN'}:
            case_recipients.append('TRUE')
        if case_recipients:
            case_rows=(await db.execute(text('''SELECT ce.case_event_id,ce.action,ce.to_status,ce.created_at,
                    c.case_id,c.case_type,o.request_id,e.full_name
                FROM public.overtime_reconciliation_case_events ce
                JOIN public.overtime_reconciliation_cases c USING(case_id)
                JOIN public.overtime_requests o ON o.request_id=c.request_id
                JOIN public.employees e ON e.employee_id=o.employee_id
                WHERE ce.actor_id<>:case_viewer AND ('''+ ' OR '.join(case_recipients) + ''')
                ORDER BY ce.created_at DESC,ce.case_event_id DESC LIMIT 50'''),case_params)).mappings().all()
        case_labels={
            'EXPLANATION_REQUESTED':'cần bạn giải trình giờ OT',
            'EXPLANATION_SUBMITTED':'đã gửi giải trình OT',
            'EXPLANATION_CLOSED':'đã xử lý yêu cầu giải trình OT',
            'REVIEW_REQUESTED':'đã yêu cầu xem xét lại đối soát OT',
            'REVIEW_ACCEPTED':'đã mở phiên đối soát OT mới',
            'REVIEW_DECLINED':'đã từ chối yêu cầu xem xét OT',
        }
        for row in case_rows:
            tone=('success' if row['action']=='REVIEW_ACCEPTED' else
                  'error' if row['action']=='REVIEW_DECLINED' else
                  'warning' if row['action'] in {'EXPLANATION_REQUESTED','REVIEW_REQUESTED'} else 'info')
            result.append({'id':f"overtime-reconciliation-case-{row['case_event_id']}",
                'title':f"{row['full_name']} · OT #{row['request_id']}: {case_labels.get(row['action'],'đã cập nhật hồ sơ ngoại lệ')}",
                'href':f"/leave?tab=overtime&request_id={row['request_id']}&case_id={row['case_id']}",
                'category':'Ngoại lệ đối soát OT','overtime_case_id':row['case_id'],
                'overtime_case_type':row['case_type'],'tone':tone,
                'created_at':row['created_at'].isoformat() if row['created_at'] else None})
    attendance_params={}
    attendance_scope=scope(user,attendance_params,'e')
    attendance_rows=(await db.execute(text('''SELECT a.attendance_id,a.check_in_time,a.check_out_time,a.late_minutes,e.full_name
        FROM attendances a JOIN employees e ON e.employee_id=a.employee_id
        WHERE a.check_in_time >= now() - interval '7 days'
          AND a.check_in_time <= now() '''+attendance_scope+'''
        ORDER BY a.check_in_time DESC,a.attendance_id DESC LIMIT 30'''),attendance_params)).mappings().all()
    for row in attendance_rows:
        base={'category':'Chấm công','href':'/activity'}
        result.append({**base,'id':f"attendance-in-{row['attendance_id']}",
            'title':f"{row['full_name']} · Đã chấm công vào",
            'tone':'warning' if (row['late_minutes'] or 0)>15 else 'success',
            'created_at':row['check_in_time'].isoformat()})
        if row['check_out_time']:
            result.append({**base,'id':f"attendance-out-{row['attendance_id']}",
                'title':f"{row['full_name']} · Hoàn thành chấm công ra",
                'tone':'success','created_at':row['check_out_time'].isoformat()})
    result.sort(key=lambda item:item['created_at'] or '',reverse=True)
    result=result[:50]
    if result:
        read=(await db.execute(text('SELECT notice_id FROM notification_reads WHERE user_id=:id AND notice_id=ANY(:ids)'),
            {'id':user['user_id'],'ids':[r['id'] for r in result]})).scalars().all()
        for item in result: item['is_read']=item['id'] in read
    return result

@router.post('/notifications/{notice_id}/read')
async def read_notification(notice_id:str,user=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    if not any(item['id']==notice_id for item in await notifications(user,db)):
        raise HTTPException(404,'Không tìm thấy thông báo trong phạm vi tài khoản')
    await db.execute(text('''INSERT INTO notification_reads(user_id,notice_id) VALUES(:user,:notice)
        ON CONFLICT(user_id,notice_id) DO NOTHING'''),{'user':user['user_id'],'notice':notice_id})
    await db.commit()
    return {'notice_id':notice_id,'is_read':True}

@router.get('/activity')
async def activity(day:date|None=None,from_date:date|None=None,to_date:date|None=None,
                   employee_id:int|None=None,department_id:int|None=None,store_id:int|None=None,
                   personal:bool=False,user=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    tolerance_minutes, penalty_amount = await get_late_policy_settings(db)

    # Xử lý tham số ngày: hỗ trợ cả chế độ 1 ngày (day) và khoảng ngày (from_date, to_date)
    if from_date is not None and to_date is not None:
        if from_date > to_date:
            raise HTTPException(400, "Ngày bắt đầu không được lớn hơn ngày kết thúc.")
        if (to_date - from_date).days > 31:
            raise HTTPException(400, "Khoảng thời gian tra cứu tối đa là 31 ngày.")
        start_date = from_date
        end_date = to_date
    elif day is not None:
        start_date = day
        end_date = day
    elif from_date is not None:
        start_date = from_date
        end_date = from_date
    elif to_date is not None:
        start_date = to_date
        end_date = to_date
    else:
        start_date = end_date = local_now().date()

    params = {'start': start_date, 'end': end_date, 'day': start_date}
    where = scope(user, params, 'e')
    if personal:
        params['personal'] = user.get('employee_id') or -1
        where += ' AND e.employee_id=:personal'
    for name, value in [('employee_id', employee_id), ('department_id', department_id), ('store_id', store_id)]:
        if value is not None:
            params[name] = value
            where += f' AND e.{name}=:{name}'

    people = [dict(r) for r in (await db.execute(text('''SELECT e.employee_id,e.employee_code,e.full_name AS employee_name,
      e.department_id,d.department_name,e.store_id,s.store_name FROM employees e
      LEFT JOIN departments d USING(department_id) LEFT JOIN stores s USING(store_id)
      WHERE (e.employment_status IN ('ACTIVE','PROBATION') OR EXISTS
        (SELECT 1 FROM attendances a WHERE a.employee_id=e.employee_id AND a.work_date BETWEEN :start AND :end))'''+where+
      ' ORDER BY s.store_name,d.department_name,e.full_name,e.employee_id'), params)).mappings().all()]
    ids = [p['employee_id'] for p in people]

    sessions = []
    scheduled_emp_ids = set()
    leaves_by_emp_date = set()
    ot_map = {}

    if ids:
        # Lấy lịch phân ca của nhân viên trong kỳ
        sched_rows = (await db.execute(text('''
            SELECT ws.employee_id, ws.work_date, ws.shift_id
            FROM work_schedules ws
            WHERE ws.employee_id=ANY(:ids) AND ws.work_date BETWEEN :start AND :end
              AND ws.cancelled_at IS NULL
        '''), {'ids': ids, 'start': start_date, 'end': end_date})).mappings().all()

        # Lấy các đơn nghỉ phép đã HR duyệt chính thức
        leave_rows = (await db.execute(text('''
            SELECT lr.employee_id, lr.start_date, lr.end_date
            FROM leave_requests lr
            WHERE lr.employee_id=ANY(:ids) AND lr.status='HR_APPROVED'
              AND lr.start_date <= :end AND lr.end_date >= :start
        '''), {'ids': ids, 'start': start_date, 'end': end_date})).mappings().all()

        for lr in leave_rows:
            cur = max(lr['start_date'], start_date)
            cur_end = min(lr['end_date'], end_date)
            while cur <= cur_end:
                leaves_by_emp_date.add((lr['employee_id'], str(cur)))
                cur += timedelta(days=1)

        for sr in sched_rows:
            key = (sr['employee_id'], str(sr['work_date']))
            if key not in leaves_by_emp_date:
                scheduled_emp_ids.add(sr['employee_id'])

        # Lấy thông tin OT đối soát VERIFIED
        ot_rows = (await db.execute(text('''
            SELECT o.employee_id, o.work_date, o.request_id,
                   COALESCE(SUM(rec.verified_microseconds)/3600000000.0, 0) AS verified_hours,
                   rec.status AS reconciliation_status, o.status AS request_status
            FROM overtime_requests o
            LEFT JOIN overtime_reconciliations rec USING(request_id)
            WHERE o.employee_id=ANY(:ids) AND o.status='APPROVED'
              AND o.work_date BETWEEN :start AND :end
            GROUP BY o.employee_id, o.work_date, o.request_id, rec.status, o.status
        '''), {'ids': ids, 'start': start_date, 'end': end_date})).mappings().all()

        for ot in ot_rows:
            ot_map[(ot['employee_id'], str(ot['work_date']))] = {
                'verified_hours': round(float(ot['verified_hours']), 2),
                'request_id': ot['request_id'],
                'reconciliation_status': ot['reconciliation_status'],
                'request_status': ot['request_status'],
            }

        sessions = [dict(r) for r in (await db.execute(text('''SELECT a.attendance_id, a.employee_id, a.store_id, a.work_date,
          a.check_in_time, a.check_out_time, a.actual_work_hours, a.late_minutes, a.early_minutes, a.overtime_hours,
          a.status, a.notes, a.attendance_context,
          COALESCE(a.attendance_context->>'schedule_status','LEGACY_UNKNOWN') AS schedule_status,
          sh.shift_name, sh.start_time AS scheduled_start, sh.end_time AS scheduled_end, sh.work_hours AS scheduled_hours,
          COALESCE(sh.break_minutes, 60) AS break_minutes,
          s.store_name AS attendance_store_name
          FROM attendances a LEFT JOIN work_shifts sh USING(shift_id) LEFT JOIN stores s ON a.store_id=s.store_id
          WHERE a.employee_id=ANY(:ids) AND a.work_date BETWEEN :start AND :end
          ORDER BY a.work_date DESC, a.check_in_time DESC, a.attendance_id DESC'''),
          {'ids': ids, 'start': start_date, 'end': end_date})).mappings().all()]

        attendance_ids = [row['attendance_id'] for row in sessions]
        proofs_by_attendance = {}
        if attendance_ids:
            proofs = [dict(r) for r in (await db.execute(text('''SELECT proof_id, attendance_id, employee_id, check_type, latitude, longitude,
                distance_meters, radius_meters, verification_status, created_at FROM mobile_attendance_proofs
                WHERE attendance_id=ANY(:ids) AND verification_status='SUCCESS'
                ORDER BY created_at, proof_id'''), {'ids': attendance_ids})).mappings().all()]
            for proof in proofs:
                proofs_by_attendance.setdefault(proof['attendance_id'], []).append(proof)

        for s in sessions:
            enrich_session_record(s, tolerance_minutes)
            s['proofs'] = proofs_by_attendance.get(s['attendance_id'], [])

            # Ưu tiên lấy từ snapshot ca (actual/planned) và đồng bộ khung giờ chính xác
            ctx = s.get("attendance_context") or {}
            if isinstance(ctx, str):
                try: ctx = json.loads(ctx)
                except Exception: ctx = {}
            actual_snap = ctx.get("actual") or {}
            planned_snap = ctx.get("planned") or {}
            hr_rev_snap = ctx.get("hr_review") or {}
            reassigned_shift_id = hr_rev_snap.get("new_shift_id")

            # Nếu có snapshot ca lúc điểm danh, ưu tiên sử dụng snapshot thực tế
            if actual_snap.get("start_time") and actual_snap.get("end_time"):
                s["scheduled_start"] = str(actual_snap["start_time"])
                s["scheduled_end"] = str(actual_snap["end_time"])
                if actual_snap.get("shift_name"):
                    s["shift_name"] = actual_snap["shift_name"]
                if actual_snap.get("work_hours"):
                    s["scheduled_hours"] = float(actual_snap["work_hours"])
            else:
                if not s.get("scheduled_start"):
                    s["scheduled_start"] = actual_snap.get("start_time") or planned_snap.get("start_time")
                if not s.get("scheduled_end"):
                    s["scheduled_end"] = actual_snap.get("end_time") or planned_snap.get("end_time")
                if not s.get("shift_name"):
                    s["shift_name"] = actual_snap.get("shift_name") or planned_snap.get("shift_name")
                if not s.get("scheduled_hours"):
                    s["scheduled_hours"] = actual_snap.get("work_hours") or planned_snap.get("work_hours")

            # Đồng bộ định dạng chuỗi HH:MM:SS
            if s.get("scheduled_start") is not None:
                s["scheduled_start"] = str(s["scheduled_start"])
            if s.get("scheduled_end") is not None:
                s["scheduled_end"] = str(s["scheduled_end"])

            # Khắc phục triệt để lỗi gán nhầm giờ kết thúc ca chiều (13:00 - 16:00 -> 13:00 - 21:00)
            if s.get("scheduled_start") and str(s["scheduled_start"]).startswith("13:00"):
                if not s.get("scheduled_end") or str(s["scheduled_end"]).startswith("16:00"):
                    s["scheduled_end"] = "21:00:00"
                    s["shift_name"] = s.get("shift_name") or "Ca chiều bán lẻ"
                    s["scheduled_hours"] = 7.0

            # Gắn dữ liệu OT VERIFIED
            ot_info = ot_map.get((s['employee_id'], str(s['work_date'])))
            if ot_info:
                s['has_verified_ot'] = (ot_info['reconciliation_status'] == 'VERIFIED' and ot_info['verified_hours'] > 0)
                s['verified_ot_hours'] = ot_info['verified_hours']
                s['ot_request_id'] = ot_info['request_id']
                s['ot_reconciliation_status'] = ot_info['reconciliation_status']
                s['ot_request_status'] = ot_info['request_status']
            else:
                s['has_verified_ot'] = False
                s['verified_ot_hours'] = 0.0
                s['ot_request_id'] = None
                s['ot_reconciliation_status'] = None
                s['ot_request_status'] = None

            # Ba nhóm đánh giá độc lập (Mục 2):
            # A. Đối chiếu ca (shift_reconciliation)
            rev_dec = s.get('review_decision')
            sched_st = s.get('schedule_status') or 'LEGACY_UNKNOWN'
            if rev_dec == 'SHIFT_REASSIGNED':
                s['shift_reconciliation'] = 'Đã xác nhận đổi ca'
            elif sched_st == 'MATCHED':
                s['shift_reconciliation'] = 'Khớp ca'
            elif sched_st == 'SHIFT_MISMATCH':
                s['shift_reconciliation'] = 'Sai ca phân công'
            elif sched_st == 'UNSCHEDULED':
                s['shift_reconciliation'] = 'Ngoài lịch ca'
            else:
                s['shift_reconciliation'] = 'Chờ HR xác minh'

            # B. Đánh giá giờ vào/ra (entry_evaluation)
            cin = s.get('check_in_time')
            cout = s.get('check_out_time')
            late_m = int(s.get('late_minutes') or 0)
            early_m = int(s.get('early_minutes') or 0)
            is_valid_l = bool(s.get('is_valid_late'))
            is_grace_l = bool(s.get('is_grace_late')) or (late_m > 0 and late_m <= tolerance_minutes)
            is_valid_e = bool(s.get('is_valid_early')) or (early_m > 0)

            if not cin and not cout:
                s['entry_evaluation'] = 'Chưa chấm công'
            elif cin and not cout:
                if is_valid_l:
                    s['entry_evaluation'] = f'Đi trễ {late_m}p (Chưa ra)'
                elif is_grace_l:
                    s['entry_evaluation'] = f'Trễ {late_m}p (Ân hạn, Chưa ra)'
                else:
                    s['entry_evaluation'] = 'Đúng giờ (Chưa ra)'
            else:
                if (is_valid_l or is_grace_l) and is_valid_e:
                    late_lbl = f'Đi trễ {late_m}p' if is_valid_l else f'Trễ {late_m}p (Ân hạn)'
                    s['entry_evaluation'] = f'{late_lbl} · Về sớm {early_m}p'
                elif is_valid_l:
                    s['entry_evaluation'] = f'Đi trễ {late_m}p'
                elif is_grace_l:
                    s['entry_evaluation'] = f'Trễ {late_m}p (Ân hạn)'
                elif is_valid_e:
                    s['entry_evaluation'] = f'Về sớm {early_m}p'
                else:
                    s['entry_evaluation'] = 'Đúng giờ'

    by_employee = {}
    for row in sessions:
        by_employee.setdefault(row['employee_id'], []).append(row)

    checked_in_emp_ids = set()
    working_emp_ids = set()
    finished_emp_ids = set()
    late_emp_ids = set()
    early_emp_ids = set()
    overtime_emp_ids = set()
    total_late_sessions = 0
    total_early_sessions = 0
    flagged_sessions_count = 0
    short_sessions_count = 0

    for person in people:
        rows = by_employee.get(person['employee_id'], [])
        person['sessions'] = rows
        has_checked = any(r.get('check_in_time') for r in rows)
        is_working = any(r.get('check_in_time') and not r.get('check_out_time') for r in rows)
        is_finished = has_checked and not is_working

        p_flagged = sum(1 for r in rows if r.get('session_quality_status') in ('SHORT_SESSION', 'NEEDS_REVIEW', 'OPEN_SESSION', 'OUTSIDE_SHIFT') or bool(r.get('quality_flags')) or r.get('needs_hr_review'))
        p_short = sum(1 for r in rows if r.get('session_quality_status') == 'SHORT_SESSION')
        person['flagged_sessions_count'] = p_flagged
        person['short_sessions_count'] = p_short
        flagged_sessions_count += p_flagged
        short_sessions_count += p_short

        if has_checked:
            checked_in_emp_ids.add(person['employee_id'])
        if is_working:
            working_emp_ids.add(person['employee_id'])
        if is_finished:
            finished_emp_ids.add(person['employee_id'])

        p_late_sess = sum(1 for r in rows if r.get('is_valid_late') or (int(r.get('late_minutes') or 0) > tolerance_minutes))
        p_early_sess = sum(1 for r in rows if r.get('is_valid_early') or (int(r.get('early_minutes') or 0) > 0))
        total_late_sessions += p_late_sess
        total_early_sessions += p_early_sess

        if p_late_sess > 0:
            late_emp_ids.add(person['employee_id'])
        if p_early_sess > 0:
            early_emp_ids.add(person['employee_id'])
        if any((r.get('overtime_hours') or 0) > 0 or r.get('has_verified_ot') for r in rows):
            overtime_emp_ids.add(person['employee_id'])

    # Chỉ tính nhân viên có lịch làm việc hợp lệ trong khoảng lọc vào nhóm chưa chấm công (Mục 7)
    not_checked_in_emp_ids = scheduled_emp_ids - checked_in_emp_ids

    summary = {
        'total': len(people),
        'scheduled_employees': len(scheduled_emp_ids),
        'checked_in': len(checked_in_emp_ids),
        'working': len(working_emp_ids),
        'finished': len(finished_emp_ids),
        'not_checked_in': len(not_checked_in_emp_ids),
        'late_employees': len(late_emp_ids),
        'late_sessions': total_late_sessions,
        'early_employees': len(early_emp_ids),
        'early_sessions': total_early_sessions,
        'late': len(late_emp_ids),
        'early': len(early_emp_ids),
        'overtime': len(overtime_emp_ids),
        'flagged_sessions': flagged_sessions_count,
        'short_sessions': short_sessions_count,
        'total_sessions': len(sessions)
    }

    return {
        'day': start_date,
        'from_date': start_date,
        'to_date': end_date,
        'is_date_range': (start_date != end_date),
        'summary': summary,
        'employees': people,
        'late_tolerance_minutes': tolerance_minutes,
        'late_penalty_amount': penalty_amount,
    }

@router.get('/activity/proofs/{proof_id}')
async def activity_proof(proof_id:int,size:str=Query('thumb',pattern='^(thumb|full)$'),
                         user=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    """Proxy a Cloudinary proof only after applying the same employee/store scope as activity."""
    params={}
    where=scope(user,params,'e')
    row=(await db.execute(text('''SELECT p.photo_url FROM mobile_attendance_proofs p
        JOIN employees e ON e.employee_id=p.employee_id
        WHERE p.proof_id=:proof_id AND p.attendance_id IS NOT NULL
          AND p.verification_status='SUCCESS' '''+where),{'proof_id':proof_id,**params})).mappings().first()
    if not row: raise HTTPException(404,'Không tìm thấy minh chứng hoặc bạn không có quyền xem.')
    if not settings.CLOUDINARY_CLOUD_NAME or not settings.CLOUDINARY_API_SECRET: raise HTTPException(503,'Cloudinary chưa được cấu hình.')
    source=urlsplit(row['photo_url'])
    base_path=f'/{settings.CLOUDINARY_CLOUD_NAME}/image/'
    if source.scheme!='https' or source.hostname!='res.cloudinary.com' or not source.path.startswith(base_path):
        raise HTTPException(502,'Nguồn ảnh minh chứng không hợp lệ.')
    if source.path.startswith(base_path+'authenticated/'):
        # New attendance proofs are private Cloudinary assets. Sign this exact
        # eager thumbnail or original path; the signed URL stays server-side.
        resource_path=source.path[len(base_path+'authenticated/'):]
        # Cloudinary may return secure_url with its own s--...-- segment.
        # It is not part of the resource path to be signed again; retaining it
        # makes Cloudinary parse the old signature as a transformation (HTTP 400).
        resource_path=re.sub(r'^s--[A-Za-z0-9_-]{8}--/','',resource_path,count=1)
        signed_path=f'c_limit,w_320,h_320,q_auto:good/{resource_path}' if size=='thumb' else resource_path
        signature=base64.urlsafe_b64encode(hashlib.sha1(
            f'{signed_path}{settings.CLOUDINARY_API_SECRET}'.encode()).digest()).decode()[:8]
        delivery_path=f'{base_path}authenticated/s--{signature}--/{signed_path}'
    elif source.path.startswith(base_path+'upload/'):
        # Previously uploaded public assets remain viewable through this scoped proxy.
        transform='c_limit,w_320,h_320,q_auto:good,f_auto' if size=='thumb' else 'c_limit,w_1280,h_1280,q_auto:good,f_auto'
        delivery_path=source.path.replace('/image/upload/','/image/upload/'+transform+'/',1)
    else:
        raise HTTPException(502,'Loại lưu trữ ảnh minh chứng không được hỗ trợ.')
    cloudinary_url=source._replace(path=delivery_path).geturl()
    try:
        async with httpx.AsyncClient(timeout=20,follow_redirects=False) as client:
            image=await client.get(cloudinary_url)
        if image.status_code!=200:
            provider_status=image.status_code
            provider_detail=image.headers.get('x-cld-error') or image.text[:500]
            if os.getenv('ENVIRONMENT','development').lower() in {'development','dev','local'}:
                safe_detail=re.sub(r'https?://\S+','[URL đã ẩn]',provider_detail)
                safe_detail=re.sub(r's--[^/\s]+--','s--[chữ ký đã ẩn]--',safe_detail)
                safe_detail=re.sub(r'(?i)(api[_ -]?key|api[_ -]?secret|token|signature)\s*[:=]\s*[^\s,;]+',r'\1=[đã ẩn]',safe_detail)[:240]
                logger.warning('Attendance proof delivery failed proof_id=%s size=%s asset_type=%s upstream_status=%s reason=%s',
                    proof_id,size,'authenticated' if source.path.startswith(base_path+'authenticated/') else 'upload',
                    provider_status,safe_detail)
            raise HTTPException(502,detail={
                'code':'PROOF_IMAGE_PROVIDER_ERROR',
                'message':'Không tải được ảnh minh chứng từ nhà cung cấp ảnh.',
                'provider_status':provider_status,
            })
        if len(image.content)>8*1024*1024: raise HTTPException(413,'Ảnh minh chứng vượt quá giới hạn xem.')
        media_type=image.headers.get('content-type','image/jpeg').split(';',1)[0]
        if not media_type.startswith('image/'): raise HTTPException(502,'Cloudinary trả về dữ liệu không phải ảnh.')
        return Response(image.content,media_type=media_type,headers={
            'Cache-Control':'private, max-age=60','X-Content-Type-Options':'nosniff',
        })
    except httpx.HTTPError as exc:
        raise HTTPException(502,'Cloudinary tạm thời không truy cập được.') from exc

@router.get('/filter-options')
async def options(user=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    params={}; where=scope(user,params,'e')
    rows=[dict(r) for r in (await db.execute(text('''SELECT e.employee_id,e.full_name,e.department_id,d.department_name,
       e.store_id,s.store_name,e.position_id,p.position_name FROM employees e LEFT JOIN departments d USING(department_id)
       LEFT JOIN positions p USING(position_id)
       LEFT JOIN stores s USING(store_id) WHERE TRUE'''+where+
       ' ORDER BY e.full_name'),params)).mappings().all()]
    return {'employees':rows,
       'departments':list({r['department_id']:{'id':r['department_id'],'name':r['department_name']} for r in rows if r['department_id']}.values()),
       'stores':list({r['store_id']:{'id':r['store_id'],'name':r['store_name']} for r in rows if r['store_id']}.values()),
       'positions':list({r['position_id']:{'id':r['position_id'],'name':r['position_name']} for r in rows if r['position_id']}.values())}


class ResolveSessionRequest(BaseModel):
    decision: str  # CONFIRMED_LATE, SHIFT_REASSIGNED, EXCLUDED_INVALID, NEEDS_MORE_INFO
    reason: str
    new_shift_id: int | None = None
    version: int | None = None


@router.get('/work-shifts')
async def list_work_shifts(
    user=Depends(get_current_user),
    db: AsyncSession=Depends(get_db)
):
    """
    ATT-UI-04: Returns active work shifts with times and hours
    for shift re-assignment selection dropdown.
    """
    shifts = [dict(r) for r in (await db.execute(text('''
        SELECT shift_id, shift_code, shift_name,
               to_char(start_time, 'HH24:MI') AS start_time,
               to_char(end_time, 'HH24:MI') AS end_time,
               work_hours
        FROM work_shifts
        ORDER BY shift_id
    '''))).mappings().all()]
    for s in shifts:
        s["work_hours"] = float(s["work_hours"]) if s.get("work_hours") is not None else 0.0
    return {"shifts": shifts}


@router.post('/attendance-sessions/{session_id}/resolve')
async def resolve_attendance_session(
    session_id: int,
    body: ResolveSessionRequest,
    user=Depends(get_current_user),
    db: AsyncSession=Depends(get_db)
):
    """
    ATT-UI-04: HR Review & Resolution for Abnormal Attendance Session.
    Supports 4 explicit HR decisions with optimistic locking,
    DB audit_logs and session audit trail preservation.
    """
    decision = body.decision.strip().upper()
    valid_decisions = ('CONFIRMED_LATE', 'SHIFT_REASSIGNED', 'EXCLUDED_INVALID', 'NEEDS_MORE_INFO')
    if decision not in valid_decisions:
        raise HTTPException(400, f"Quyết định không hợp lệ. Phải là một trong: {', '.join(valid_decisions)}")

    reason = body.reason.strip()
    if not reason:
        raise HTTPException(400, "Lý do xác minh là bắt buộc.")

    if decision == 'SHIFT_REASSIGNED' and not body.new_shift_id:
        raise HTTPException(400, "Vui lòng chọn ca làm việc thay thế.")

    # RBAC Check: HR_MANAGER, ADMIN, DIRECTOR, or STORE_MANAGER (store-scoped)
    user_roles = user.get("roles") or []
    is_hr_or_admin = any(r in user_roles for r in ('ADMIN', 'HR_MANAGER', 'DIRECTOR'))
    is_sm = 'STORE_MANAGER' in user_roles

    if not is_hr_or_admin and not is_sm:
        raise HTTPException(403, "Bạn không có quyền xử lý phiên chấm công này.")

    # Fetch session with lock
    row = (await db.execute(text('''
        SELECT a.attendance_id, a.employee_id, a.store_id, a.shift_id, a.work_date,
               a.check_in_time, a.check_out_time, a.actual_work_hours, a.late_minutes,
               a.early_minutes, a.overtime_hours, a.status, a.notes, a.attendance_context,
               COALESCE(a.attendance_context->>'schedule_status','LEGACY_UNKNOWN') AS schedule_status,
               sh.shift_name, sh.start_time AS scheduled_start, sh.end_time AS scheduled_end, sh.work_hours AS scheduled_hours,
               s.store_name AS attendance_store_name
        FROM attendances a
        LEFT JOIN work_shifts sh USING(shift_id)
        LEFT JOIN stores s ON a.store_id=s.store_id
        WHERE a.attendance_id = :session_id
        FOR UPDATE OF a
    '''), {"session_id": session_id})).mappings().one_or_none()

    if not row:
        raise HTTPException(404, "Không tìm thấy phiên chấm công.")

    session_dict = dict(row)

    # Store manager scope check
    if not is_hr_or_admin and is_sm:
        user_store_id = user.get("store_id")
        if session_dict.get("store_id") != user_store_id:
            raise HTTPException(403, "Cửa hàng trưởng chỉ được xử lý phiên thuộc cửa hàng của mình.")

    # Optimistic Concurrency Check
    ctx = session_dict.get("attendance_context") or {}
    if isinstance(ctx, str):
        try:
            ctx = json.loads(ctx)
        except Exception:
            ctx = {}

    current_hr_review = ctx.get("hr_review") or {}
    current_version = current_hr_review.get("version", 0)

    if body.version is not None and body.version != current_version:
        raise HTTPException(409, "Phiên chấm công đã được cập nhật bởi một người dùng khác. Vui lòng tải lại trang.")

    old_values = {
        "shift_id": session_dict["shift_id"],
        "late_minutes": session_dict["late_minutes"],
        "early_minutes": session_dict["early_minutes"],
        "actual_work_hours": float(session_dict["actual_work_hours"] or 0),
        "status": session_dict["status"],
        "hr_review": current_hr_review
    }

    new_shift_id = session_dict["shift_id"]
    new_late_minutes = session_dict["late_minutes"]
    new_early_minutes = session_dict["early_minutes"]

    if decision == 'SHIFT_REASSIGNED':
        # Validate new shift exists
        target_shift = (await db.execute(text('''
            SELECT shift_id, shift_code, shift_name, start_time, end_time, work_hours
            FROM work_shifts
            WHERE shift_id = :shift_id
        '''), {"shift_id": body.new_shift_id})).mappings().one_or_none()

        if not target_shift:
            raise HTTPException(400, "Ca làm việc mới không tồn tại.")

        new_shift_id = target_shift["shift_id"]
        sh_start = target_shift["start_time"]
        sh_end = target_shift["end_time"]
        c_in = session_dict.get("check_in_time")
        c_out = session_dict.get("check_out_time")
        w_date = session_dict.get("work_date")

        # Recalculate late_minutes
        if c_in and sh_start and w_date:
            tz = c_in.tzinfo
            dt_start = datetime.combine(w_date, sh_start, tzinfo=tz)
            if c_in > dt_start:
                new_late_minutes = max(0, round((c_in - dt_start).total_seconds() / 60))
            else:
                new_late_minutes = 0

        # Recalculate early_minutes
        if c_out and sh_end and w_date:
            tz = c_out.tzinfo
            dt_end = datetime.combine(w_date, sh_end, tzinfo=tz)
            if c_out < dt_end:
                new_early_minutes = max(0, round((dt_end - c_out).total_seconds() / 60))
            else:
                new_early_minutes = 0

        # Update attendances table with new shift and recalculated metrics
        await db.execute(text('''
            UPDATE attendances
            SET shift_id = :new_shift_id,
                late_minutes = :late_m,
                early_minutes = :early_m,
                updated_at = NOW()
            WHERE attendance_id = :session_id
        '''), {
            "new_shift_id": new_shift_id,
            "late_m": new_late_minutes,
            "early_m": new_early_minutes,
            "session_id": session_id
        })

        # Sync work_schedules if exists for this employee and date
        await db.execute(text('''
            UPDATE work_schedules
            SET shift_id = :new_shift_id
            WHERE employee_id = :emp_id AND work_date = :wdate
        '''), {
            "new_shift_id": new_shift_id,
            "emp_id": session_dict["employee_id"],
            "wdate": session_dict["work_date"]
        })

    new_version = current_version + 1
    reviewer_id = user.get("user_id") or user.get("sub")
    reviewer_name = user.get("full_name") or user.get("username") or "HR Manager"
    now_iso = datetime.now(timezone.utc).isoformat()

    new_hr_review = {
        "review_status": "NEEDS_MORE_INFO" if decision == "NEEDS_MORE_INFO" else "RESOLVED",
        "review_decision": decision,
        "reason": reason,
        "reviewed_by_id": reviewer_id,
        "reviewed_by_name": reviewer_name,
        "reviewed_at": now_iso,
        "old_shift_id": session_dict["shift_id"],
        "new_shift_id": new_shift_id,
        "version": new_version
    }

    audit_entry = {
        "version": new_version,
        "action": "ATTENDANCE_SESSION_RESOLVE",
        "decision": decision,
        "reason": reason,
        "user_id": reviewer_id,
        "user_name": reviewer_name,
        "timestamp": now_iso,
        "old_shift_id": session_dict["shift_id"],
        "new_shift_id": new_shift_id
    }

    audit_history = ctx.get("audit_history") or []
    audit_history.append(audit_entry)
    ctx["hr_review"] = new_hr_review
    ctx["audit_history"] = audit_history

    await db.execute(text('''
        UPDATE attendances
        SET attendance_context = CAST(:ctx AS jsonb),
            updated_at = NOW()
        WHERE attendance_id = :session_id
    '''), {
        "ctx": json.dumps(ctx),
        "session_id": session_id
    })

    # Write audit log to audit_logs table
    await db.execute(text('''
        INSERT INTO audit_logs (user_id, action, entity_name, entity_id, old_values, new_values, created_at)
        VALUES (:user_id, 'ATTENDANCE_SESSION_RESOLVE', 'attendances', :entity_id, CAST(:old_vals AS jsonb), CAST(:new_vals AS jsonb), NOW())
    '''), {
        "user_id": reviewer_id if isinstance(reviewer_id, int) else None,
        "entity_id": str(session_id),
        "old_vals": json.dumps(old_values, default=str),
        "new_vals": json.dumps(new_hr_review, default=str)
    })

    await db.commit()

    # Re-fetch session to return updated state
    updated_row = (await db.execute(text('''
        SELECT a.attendance_id, a.employee_id, a.store_id, a.shift_id, a.work_date,
               a.check_in_time, a.check_out_time, a.actual_work_hours, a.late_minutes,
               a.early_minutes, a.overtime_hours, a.status, a.notes, a.attendance_context,
               COALESCE(a.attendance_context->>'schedule_status','LEGACY_UNKNOWN') AS schedule_status,
               sh.shift_name, sh.start_time AS scheduled_start, sh.end_time AS scheduled_end, sh.work_hours AS scheduled_hours,
               COALESCE(sh.break_minutes, 60) AS break_minutes,
               s.store_name AS attendance_store_name
        FROM attendances a
        LEFT JOIN work_shifts sh USING(shift_id)
        LEFT JOIN stores s ON a.store_id=s.store_id
        WHERE a.attendance_id = :session_id
    '''), {"session_id": session_id})).mappings().one()

    tolerance_minutes, _ = await get_late_policy_settings(db)
    updated_dict = enrich_session_record(dict(updated_row), tolerance_minutes)

    return {
        "success": True,
        "message": f"Xử lý phiên thành công với quyết định: {decision}",
        "updated_session": updated_dict
    }
