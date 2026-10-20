"""Loopback-only Mission 9 E2E server using real auth and OT routers.

Only non-OT directory lookups and the future Attendance clock fixture are test adapters.
Never point DATABASE_URL at Supabase when importing this module.
"""

from __future__ import annotations

import json
import os
import re
from datetime import date, datetime, time, timedelta, timezone
from ipaddress import ip_address
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.v1.endpoints import (
    auth, attendances, mobile_attendance, operations,
    overtime_reconciliations, overtime_requests,
)
from app.core.database import get_db
from app.core.config import settings


EXPECTED_DB = os.getenv("OT_MISSION9_TEST_DATABASE", "ot_cutover02_m9_full_e2e")
if not re.fullmatch(r"ot_cutover02_m9_[a-z0-9_]+", EXPECTED_DB):
    raise RuntimeError("OT_MISSION9_TEST_DATABASE must use the isolated ot_cutover02_m9_* namespace")
parsed = urlsplit(settings.DATABASE_URL)
if (parsed.hostname is None or not ip_address(parsed.hostname).is_loopback
        or parsed.path.lstrip("/") != EXPECTED_DB
        or settings.OT_REGISTRATION_POLICY_MODE != "DISABLED"
        or os.getenv("OT_MISSION9_FIXTURE") != "1"):
    raise RuntimeError("Mission 9 fixture requires dedicated loopback DB and disabled OT policy")

app = FastAPI(title="Mission 9 local synthetic OT E2E")
app.add_middleware(CORSMiddleware, allow_origins=["http://127.0.0.1:3174"],
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.include_router(auth.router, prefix="/api/v1/auth")
app.include_router(attendances.router, prefix="/api/v1/attendances")
app.include_router(mobile_attendance.router, prefix="/api/v1/mobile-attendance")
app.include_router(overtime_requests.router, prefix="/api/v1/overtime-requests")
app.include_router(overtime_reconciliations.router, prefix="/api/v1/overtime-reconciliations")
app.include_router(operations.router, prefix="/api/v1/operations")

_REAL_LOCAL_NOW = attendances.local_now
_REAL_UTC_NOW = overtime_reconciliations._utc_now
_TEST_CLOCK: datetime | None = None


def _fixture_local_now() -> datetime:
    return _TEST_CLOCK or _REAL_LOCAL_NOW()


def _fixture_utc_now() -> datetime:
    return _TEST_CLOCK.astimezone(timezone.utc) if _TEST_CLOCK else _REAL_UTC_NOW()


attendances.local_now = _fixture_local_now
overtime_reconciliations._utc_now = _fixture_utc_now


@app.get("/fixture/health")
async def fixture_health(db: AsyncSession = Depends(get_db)):
    name, address = (await db.execute(text(
        "SELECT current_database(), inet_server_addr()::text"
    ))).one()
    if name != EXPECTED_DB or not ip_address(address.split("/")[0]).is_loopback:
        raise HTTPException(503, "Fixture database identity mismatch")
    return {"database": name, "policy": settings.OT_REGISTRATION_POLICY_MODE}


# These two endpoints replace directory UI dependencies, not any OT decision API.
@app.get("/api/v1/employees/metadata/lookups")
async def synthetic_lookups(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    stores = (await db.execute(text(
        "SELECT store_id,store_name FROM stores ORDER BY store_id"
    ))).mappings().all()
    return {"stores": [dict(row, store_code=f"S-{row['store_id']}") for row in stores],
            "departments": [], "positions": [], "education_levels": [], "work_shifts": []}


@app.get("/api/v1/employees")
async def synthetic_employees(store_id: int | None = None,
                              user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    roles = set(user["roles"])
    if "STORE_MANAGER" in roles:
        store_id = user["store_id"]
    if not roles.intersection({"ADMIN", "HR_MANAGER", "STORE_MANAGER"}):
        raise HTTPException(403, "Manager scope required")
    query = """SELECT employee_id,employee_code,full_name,
        store_id,employment_status FROM employees"""
    if store_id is not None:
        query += " WHERE store_id=:store"
    query += " ORDER BY employee_id"
    rows = (await db.execute(text(query), {"store": store_id} if store_id is not None else {})).mappings().all()
    return [dict(row) for row in rows]


class AttendanceFixture(BaseModel):
    request_id: int
    check_out_at: str | None = None


class AttendanceTestClock(BaseModel):
    value: datetime | None


@app.post("/fixture/test-clock")
async def set_attendance_test_clock(payload: AttendanceTestClock, request: Request):
    global _TEST_CLOCK
    host = request.client.host if request.client else None
    if not host or not ip_address(host).is_loopback:
        raise HTTPException(403, "Test clock is available only from loopback.")
    if payload.value is not None and payload.value.tzinfo is None:
        raise HTTPException(422, "Test clock must include a timezone offset.")
    _TEST_CLOCK = (payload.value.astimezone(timezone(timedelta(hours=7)))
                   if payload.value else None)
    return {"clock": _TEST_CLOCK.isoformat() if _TEST_CLOCK else None}


@app.post("/fixture/attendance-e2e/prepare")
async def prepare_attendance_browser_e2e(db: AsyncSession = Depends(get_db)):
    name, address = (await db.execute(text(
        "SELECT current_database(), inet_server_addr()::text"
    ))).one()
    if name != EXPECTED_DB or not ip_address(address.split("/")[0]).is_loopback:
        raise HTTPException(503, "Refusing test data outside the dedicated loopback DB.")
    work_date = (await db.execute(text("""SELECT GREATEST(
        CURRENT_DATE+3,
        COALESCE((SELECT max(work_date) FROM work_schedules WHERE employee_id=30),CURRENT_DATE)+2,
        COALESCE((SELECT max(work_date) FROM overtime_requests WHERE employee_id=30),CURRENT_DATE)+2,
        COALESCE((SELECT max(end_date) FROM leave_requests WHERE employee_id=30),CURRENT_DATE)+2,
        COALESCE((SELECT max(check_out_time)::date FROM attendances WHERE employee_id=30),CURRENT_DATE)+2
    )"""))).scalar_one()
    starts_at = datetime.combine(work_date, time(9), timezone(timedelta(hours=7)))
    ends_at = datetime.combine(work_date, time(17), timezone(timedelta(hours=7)))
    await db.execute(text("""INSERT INTO work_schedules
        (employee_id,store_id,shift_id,work_date,starts_at,ends_at)
        VALUES(30,2,8,:day,:starts_at,:ends_at)"""), {
        "day": work_date, "starts_at": starts_at, "ends_at": ends_at,
    })
    await db.commit()
    return {"employee_id": 30, "store_id": 2, "shift_id": 8,
            "work_date": work_date.isoformat()}


@app.post("/fixture/work-schedules")
async def allocate_work_schedules(db: AsyncSession = Depends(get_db)):
    name, address = (await db.execute(text(
        "SELECT current_database(), inet_server_addr()::text"
    ))).one()
    if name != EXPECTED_DB or not ip_address(address.split("/")[0]).is_loopback:
        raise HTTPException(503, "Fixture database identity mismatch")

    await db.execute(text("SELECT pg_advisory_xact_lock(917306191)"))
    first_day = datetime.now(timezone(timedelta(hours=7))).date() + timedelta(days=30)
    for offset in range(3650):
        employee_day = first_day + timedelta(days=offset)
        manager_day = employee_day + timedelta(days=1)
        params = {"employee_day": employee_day, "manager_day": manager_day}
        occupied = (await db.execute(text("""SELECT
            EXISTS (SELECT 1 FROM work_schedules WHERE employee_id=21
                AND cancelled_at IS NULL AND work_date IN (:employee_day,:manager_day))
            OR EXISTS (SELECT 1 FROM overtime_requests WHERE employee_id=21
                AND status IN ('DRAFT','PENDING_EMPLOYEE_CONFIRMATION','PENDING_HR','APPROVED')
                AND work_date IN (:employee_day,:manager_day))
            OR EXISTS (SELECT 1 FROM leave_requests WHERE employee_id=21
                AND status IN ('PENDING','STORE_APPROVED','HR_APPROVED')
                AND start_date<=:manager_day AND end_date>=:employee_day)"""),
            params)).scalar_one()
        if occupied:
            continue

        for work_date in (employee_day, manager_day):
            starts_at = datetime.combine(work_date, time(9), timezone(timedelta(hours=7)))
            ends_at = datetime.combine(work_date, time(17), timezone(timedelta(hours=7)))
            await db.execute(text("""INSERT INTO work_schedules
                (employee_id,store_id,shift_id,work_date,starts_at,ends_at)
                VALUES(21,1,8,:work_date,:starts_at,:ends_at)"""),
                {"work_date": work_date, "starts_at": starts_at, "ends_at": ends_at})
        await db.commit()
        return {"employee_work_date": employee_day, "manager_work_date": manager_day}

    raise HTTPException(503, "No unused synthetic work-schedule dates remain")


@app.post("/fixture/attendance")
async def seed_future_attendance(payload: AttendanceFixture,
                                 db: AsyncSession = Depends(get_db)):
    """Insert a synthetic time source after approval; normal check-in cannot occur in the future."""
    row = (await db.execute(text("""SELECT request_id,employee_id,store_id,work_date,
        starts_at,ends_at,status FROM overtime_requests WHERE request_id=:id"""),
        {"id": payload.request_id})).mappings().first()
    if not row or row["status"] != "APPROVED":
        raise HTTPException(409, "Only an approved synthetic request may receive Attendance")
    vn = timezone(timedelta(hours=7))
    regular_start = datetime.combine(row["work_date"], time(9), vn)
    regular_end = datetime.combine(row["work_date"], time(17), vn)
    check_out = datetime.fromisoformat(payload.check_out_at) if payload.check_out_at else row["ends_at"]
    context = {"schedule_status": "MATCHED",
               "planned": {"store_id": row["store_id"], "shift_id": 8,
                           "starts_at": regular_start.isoformat(), "ends_at": regular_end.isoformat()},
               "actual": {"shift_id": 8}}
    attendance_id = (await db.execute(text("""INSERT INTO attendances
        (employee_id,store_id,shift_id,work_date,check_in_time,check_out_time,attendance_context)
        VALUES(:employee,:store,8,:day,:start,:finish,CAST(:context AS jsonb))
        RETURNING attendance_id"""),
        {"employee": row["employee_id"], "store": row["store_id"],
         "day": row["work_date"], "start": regular_start, "finish": check_out,
         "context": json.dumps(context)})).scalar_one()
    await db.commit()
    return {"attendance_id": attendance_id, "request_id": row["request_id"]}


@app.get("/fixture/state/{request_id}")
async def fixture_state(request_id: int, db: AsyncSession = Depends(get_db)):
    request = (await db.execute(text("SELECT status FROM overtime_requests WHERE request_id=:id"),
                                {"id": request_id})).scalar_one_or_none()
    events = (await db.execute(text("""SELECT action,to_status FROM overtime_request_events
        WHERE request_id=:id ORDER BY event_id"""), {"id": request_id})).mappings().all()
    reconciliation = (await db.execute(text("""SELECT status,version,source_signature,
        verified_microseconds FROM overtime_reconciliations WHERE request_id=:id"""),
        {"id": request_id})).mappings().first()
    return {"status": request, "events": [dict(row) for row in events],
            "reconciliation": dict(reconciliation) if reconciliation else None}
