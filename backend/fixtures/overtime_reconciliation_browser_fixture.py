"""Isolated browser acceptance server for OT reconciliation only.

Run with DATABASE_URL and OT_CUTOVER_TEST_DATABASE_URL pointing to the dedicated
loopback ot_cutover02_* database. This module refuses any other target.
"""

import json
import os
from datetime import date, datetime, time, timedelta, timezone

from fastapi import FastAPI, Request
from sqlalchemy import text
from sqlalchemy.engine import make_url

target = make_url(os.environ.get("OT_CUTOVER_TEST_DATABASE_URL", ""))
if (target.host not in {"127.0.0.1", "localhost"}
        or not (target.database or "").startswith("ot_cutover02_")
        or os.environ.get("DATABASE_URL") != os.environ.get("OT_CUTOVER_TEST_DATABASE_URL")):
    raise RuntimeError("Browser fixture requires the explicit isolated loopback OT database")

from app.api.deps import get_current_user  # noqa: E402
from app.api.v1.endpoints import overtime_reconciliations  # noqa: E402
from app.core.database import engine  # noqa: E402


USERS = {
    "ADMIN": {"user_id": 1, "employee_id": 99, "store_id": 1, "roles": ["ADMIN"]},
    "HR_MANAGER": {"user_id": 4, "employee_id": 22, "store_id": 1, "roles": ["HR_MANAGER"]},
    "SECOND_HR": {"user_id": 6, "employee_id": 23, "store_id": 1, "roles": ["HR_MANAGER"]},
    "STORE_MANAGER": {"user_id": 2, "employee_id": 20, "store_id": 1, "roles": ["STORE_MANAGER"]},
    "EMPLOYEE": {"user_id": 3, "employee_id": 21, "store_id": 1, "roles": ["EMPLOYEE"]},
    "OUTSIDER": {"user_id": 5, "employee_id": 30, "store_id": 2, "roles": ["EMPLOYEE"]},
}

app = FastAPI()
app.include_router(overtime_reconciliations.router, prefix="/api/v1/overtime-reconciliations")
_REAL_UTC_NOW = overtime_reconciliations._utc_now
_FIXTURE_CLOCK: datetime | None = None


def _fixture_utc_now() -> datetime:
    return _FIXTURE_CLOCK.astimezone(timezone.utc) if _FIXTURE_CLOCK else _REAL_UTC_NOW()


overtime_reconciliations._utc_now = _fixture_utc_now


async def fixture_user(request: Request):
    return USERS.get(request.headers.get("x-fixture-role", ""), USERS["OUTSIDER"])


app.dependency_overrides[get_current_user] = fixture_user


@app.post("/fixture/seed")
async def seed(missing_attendance: bool = False):
    global _FIXTURE_CLOCK
    async with engine.begin() as conn:
        last_day = (await conn.execute(text("""SELECT MAX(work_date) FROM overtime_requests
            WHERE employee_id=21"""))).scalar_one()
        day = max((last_day or date(2026, 11, 1)) + timedelta(days=1), date(2026, 11, 2))
        _FIXTURE_CLOCK = datetime.combine(day, time(19, 1), timezone(timedelta(hours=7)))
        stamp = day.isoformat()
        start = f"{stamp}T17:00:00+07:00"
        end = f"{stamp}T19:00:00+07:00"
        request_id = (await conn.execute(text("""INSERT INTO overtime_requests
            (employee_id,store_id,work_date,starts_at,ends_at,reason,created_by,status,
             reviewed_by,reviewed_at) VALUES(21,1,:day,:start,:end,:reason,2,'APPROVED',4,
             clock_timestamp()) RETURNING request_id"""), {
            "day": day, "start": datetime.fromisoformat(start),
            "end": datetime.fromisoformat(end),
            "reason": "Synthetic browser OT-CUTOVER-03",
        })).scalar_one()
        context = {"schedule_status": "MATCHED", "planned": {
            "store_id": 1, "shift_id": 8,
            "starts_at": f"{stamp}T09:00:00+07:00",
            "ends_at": start,
        }, "actual": {"shift_id": 8}}
        if not missing_attendance:
            await conn.execute(text("""INSERT INTO attendances
                (employee_id,store_id,shift_id,work_date,check_in_time,check_out_time,attendance_context)
                VALUES(21,1,8,:day,:check_in,:check_out,CAST(:context AS jsonb))"""), {
                "day": day, "check_in": datetime.fromisoformat(f"{stamp}T09:00:00+07:00"),
                "check_out": datetime.fromisoformat(end), "context": json.dumps(context),
            })
    return {"request_id": request_id, "work_date": stamp,
            "starts_at": start, "ends_at": end}


@app.post("/fixture/shorten/{request_id}")
async def shorten_attendance(request_id: int):
    async with engine.begin() as conn:
        result = await conn.execute(text("""UPDATE attendances a SET
            check_out_time=o.starts_at+interval '1 hour',updated_at=clock_timestamp()
            FROM overtime_requests o WHERE o.request_id=:id
              AND a.employee_id=o.employee_id AND a.work_date=o.work_date
            RETURNING a.attendance_id"""), {"id": request_id})
        return {"updated_attendance_ids": result.scalars().all()}
