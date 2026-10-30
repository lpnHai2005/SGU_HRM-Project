"""Overtime requests are proposals, independent from attendance and payroll facts."""
import json
from datetime import date, datetime, time, timedelta
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_roles
from app.core.database import get_db
from app.core.overtime_requests import VIETNAM_TZ, local_interval, require_transition

router = APIRouter()
MANAGER_ROLES = {"ADMIN", "HR_MANAGER", "STORE_MANAGER"}
REVIEW_ROLES = {"ADMIN", "HR_MANAGER"}


class OvertimeRequestCreate(BaseModel):
    employee_id: int | None = Field(default=None, gt=0)
    store_id: int | None = Field(default=None, gt=0)
    work_date: date
    start_time: time
    end_time: time
    reason: str = Field(min_length=3, max_length=1000)
    notes: str | None = Field(default=None, max_length=500)

    @field_validator("reason")
    @classmethod
    def non_blank_reason(cls, value):
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Reason must contain at least 3 non-space characters")
        return value


class OvertimeRequestPatch(BaseModel):
    work_date: date | None = None
    start_time: time | None = None
    end_time: time | None = None
    reason: str | None = Field(default=None, min_length=3, max_length=1000)
    notes: str | None = Field(default=None, max_length=500)

    @field_validator("reason")
    @classmethod
    def non_blank_reason(cls, value):
        if value is None:
            return value
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Reason must contain at least 3 non-space characters")
        return value


class OvertimeDecision(BaseModel):
    reason: str | None = Field(default=None, max_length=1000)

    @field_validator("reason")
    @classmethod
    def normalized_reason(cls, value):
        if value is None:
            return None
        value = value.strip()
        return value or None


class OvertimeRejection(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)

    @field_validator("reason")
    @classmethod
    def non_blank_reason(cls, value):
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Rejection reason must contain at least 3 non-space characters")
        return value


class OvertimeLifecycleReason(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)

    @field_validator("reason")
    @classmethod
    def non_blank_reason(cls, value):
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Reason must contain at least 3 non-space characters")
        return value


class OvertimeAmendment(BaseModel):
    work_date: date
    start_time: time
    end_time: time
    reason: str = Field(min_length=3, max_length=1000)
    notes: str | None = Field(default=None, max_length=500)

    @field_validator("reason")
    @classmethod
    def non_blank_reason(cls, value):
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Reason must contain at least 3 non-space characters")
        return value


async def _employee_store(db: AsyncSession, employee_id: int, *, lock: bool = False):
    suffix = " FOR UPDATE OF e" if lock else ""
    row = (await db.execute(text(f"""SELECT e.employee_id,e.employee_code,e.full_name,e.store_id,
        e.employment_status,s.is_active AS store_active,s.store_name
        FROM employees e JOIN stores s USING(store_id) WHERE e.employee_id=:id{suffix}"""),
        {"id": employee_id})).mappings().first()
    if not row:
        raise HTTPException(404, "Employee or assigned store not found")
    if row["employment_status"] not in {"ACTIVE", "PROBATION"}:
        raise HTTPException(409, {"code": "EMPLOYEE_NOT_ELIGIBLE", "message": "Only active or probation employees may request overtime"})
    if not row["store_active"]:
        raise HTTPException(409, {"code": "STORE_INACTIVE", "message": "Overtime cannot be requested for an inactive store"})
    return row


async def _lock_request_employee(db: AsyncSession, employee_id: int):
    employee = await _employee_store(db, employee_id, lock=True)
    return employee


def _ensure_request_store(row, employee):
    if row["store_id"] != employee["store_id"]:
        raise HTTPException(409, {"code": "EMPLOYEE_STORE_CHANGED",
                                  "message": "Employee's assigned store changed after this overtime request was created"})


async def _validate_interval(db: AsyncSession, employee, work_date, starts_at, ends_at,
                             exclude_id=None, exclude_parent_id=None):
    params = {"employee": employee["employee_id"], "store": employee["store_id"],
              "starts_at": starts_at, "ends_at": ends_at, "exclude_id": exclude_id or 0,
              "exclude_parent_id": exclude_parent_id or 0,
              "start_day": starts_at.date(), "schedule_from": starts_at.date() - timedelta(days=1),
              "end_day": ends_at.date()}
    duplicate = (await db.execute(text("""SELECT request_id FROM overtime_requests
        WHERE employee_id=:employee AND request_id<>:exclude_id AND request_id<>:exclude_parent_id
          AND status = ANY(ARRAY['DRAFT','PENDING_EMPLOYEE_CONFIRMATION','PENDING_HR','APPROVED']::varchar[])
          AND starts_at < :ends_at AND ends_at > :starts_at
        ORDER BY request_id LIMIT 1"""), params)).scalar_one_or_none()
    if duplicate:
        raise HTTPException(409, {"code": "OVERTIME_REQUEST_CONFLICT", "request_id": duplicate,
                                  "message": "This employee already has an active overtime request in that time range"})

    schedule = (await db.execute(text("""SELECT ws.schedule_id FROM work_schedules ws
        JOIN work_shifts sh USING(shift_id)
        WHERE ws.employee_id=:employee AND ws.store_id=:store AND ws.cancelled_at IS NULL
          AND ws.work_date BETWEEN :schedule_from AND :end_day
          AND COALESCE(ws.starts_at,(ws.work_date+sh.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh') < :ends_at
          AND COALESCE(ws.ends_at,(ws.work_date+sh.end_time+CASE WHEN sh.end_time<=sh.start_time THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE 'Asia/Ho_Chi_Minh') > :starts_at
        ORDER BY ws.schedule_id LIMIT 1"""), params)).scalar_one_or_none()
    if schedule:
        raise HTTPException(409, {"code": "WORK_SCHEDULE_CONFLICT", "schedule_id": schedule,
                                  "message": "Overtime interval overlaps an assigned work shift"})

    leave = (await db.execute(text("""SELECT request_id FROM leave_requests
        WHERE employee_id=:employee AND status IN ('PENDING','STORE_APPROVED','HR_APPROVED')
          AND start_date<=:end_day AND end_date>=:start_day ORDER BY request_id LIMIT 1"""), params)).scalar_one_or_none()
    if leave:
        raise HTTPException(409, {"code": "LEAVE_CONFLICT", "leave_request_id": leave,
                                  "message": "Overtime cannot be requested on a date covered by a pending or approved leave request"})


async def _require_overtime_schema(db: AsyncSession):
    """Fail with an actionable service error when the OT migrations are not installed."""
    relations = (await db.execute(text("""SELECT
        to_regclass('overtime_requests') AS requests,
        to_regclass('overtime_request_events') AS events"""))).mappings().one()
    missing = [name for name, key in (
        ("overtime_requests", "requests"),
        ("overtime_request_events", "events"),
    ) if relations[key] is None]
    if missing:
        raise HTTPException(503, {
            "code": "OT_SCHEMA_NOT_INSTALLED",
            "message": "Đăng ký OT chưa sẵn sàng vì cơ sở dữ liệu chưa có schema OT. Quản trị viên cần áp dụng bộ migration OT đã được phê duyệt.",
            "missing_relations": missing,
        })


async def _append_event(db, request_id, actor_id, action, from_status, to_status,
                        reason=None, old_values=None, new_values=None):
    await db.execute(text("""INSERT INTO overtime_request_events
        (request_id,actor_id,action,from_status,to_status,reason,old_values,new_values)
        VALUES(:id,:actor,:action,:from_status,:to_status,:reason,CAST(:old AS jsonb),CAST(:new AS jsonb))"""), {
        "id": request_id, "actor": actor_id, "action": action, "from_status": from_status,
        "to_status": to_status, "reason": reason,
        "old": json.dumps(old_values, default=str, ensure_ascii=False) if old_values is not None else None,
        "new": json.dumps(new_values, default=str, ensure_ascii=False) if new_values is not None else None,
    })


async def _get_request(db, request_id: int, *, lock: bool = False):
    await _require_overtime_schema(db)
    suffix = " FOR UPDATE OF o" if lock else ""
    row = (await db.execute(text("""SELECT o.*,e.full_name AS employee_name,e.employee_code,
        s.store_name,cu.username AS creator_username,ru.username AS reviewer_username
        FROM overtime_requests o JOIN employees e ON e.employee_id=o.employee_id
        JOIN stores s ON s.store_id=o.store_id
        JOIN users cu ON cu.user_id=o.created_by LEFT JOIN users ru ON ru.user_id=o.reviewed_by
        WHERE o.request_id=:id""" + suffix), {"id": request_id})).mappings().first()
    if not row:
        raise HTTPException(404, "Overtime request not found")
    result = dict(row)
    for key in ("starts_at", "ends_at", "employee_confirmed_at", "employee_responded_at",
                "reviewed_at", "cancelled_at", "created_at", "updated_at",
                "revoke_requested_at", "revoke_decided_at", "revoked_at"):
        if result.get(key) is not None:
            result[key] = result[key].astimezone(VIETNAM_TZ)
    result.update(_overdue_summary(result))
    return result


def _overdue_summary(row, now=None):
    now = now or datetime.now(VIETNAM_TZ)
    state = None
    if row.get("status") in {"PENDING_EMPLOYEE_CONFIRMATION", "PENDING_HR"} and row["starts_at"] <= now:
        state = "PENDING_EMPLOYEE_CONFIRMATION_OVERDUE" if row["status"] == "PENDING_EMPLOYEE_CONFIRMATION" else "PENDING_HR_OVERDUE"
    return {"is_overdue": state is not None, "overdue_state": state}


def _require_future_start(starts_at):
    if starts_at <= datetime.now(VIETNAM_TZ):
        raise HTTPException(409, {"code": "OVERTIME_EXCEPTION_REVIEW_REQUIRED",
                                  "message": "Thời điểm bắt đầu OT đã qua. Đơn cần được rà soát ngoại lệ; hệ thống không tự duyệt hồi tố."})


async def _related_attendance(db, row):
    return (await db.execute(text("""SELECT attendance_id,check_in_time,check_out_time
        FROM attendances
        WHERE employee_id=:employee AND check_in_time IS NOT NULL
          AND check_in_time < :ends_at
          AND COALESCE(check_out_time,'infinity'::timestamptz) > :starts_at
        ORDER BY attendance_id LIMIT 1"""), {
        "employee": row["employee_id"], "starts_at": row["starts_at"], "ends_at": row["ends_at"],
    })).mappings().first()


async def _assert_lifecycle_eligible(db, row, *, allow_active_amendment=False):
    if row.get("status") != "APPROVED" or row.get("replaced_by_request_id") is not None:
        raise HTTPException(409, {"code": "OVERTIME_NOT_ACTIVE_APPROVED",
                                  "message": "Chỉ đơn OT đã duyệt và còn hiệu lực mới được điều chỉnh hoặc yêu cầu thu hồi."})
    if row.get("revoke_requested_at") and not row.get("revoke_decided_at"):
        raise HTTPException(409, {"code": "OVERTIME_REVOCATION_PENDING",
                                  "message": "Đơn đang chờ quyết định thu hồi."})
    if not allow_active_amendment:
        active_amendment = (await db.execute(text("""SELECT request_id FROM overtime_requests
            WHERE parent_request_id=:id AND request_type='AMENDMENT'
              AND status IN ('DRAFT','PENDING_EMPLOYEE_CONFIRMATION','PENDING_HR','APPROVED')
            ORDER BY request_id DESC LIMIT 1"""), {"id": row["request_id"]})).scalar_one_or_none()
        if active_amendment:
            raise HTTPException(409, {"code": "OVERTIME_AMENDMENT_PENDING",
                                      "message": "Đơn đang có đề xuất điều chỉnh còn hiệu lực; hãy hoàn tất hoặc từ chối đề xuất trước khi yêu cầu thu hồi.",
                                      "amendment_request_id": active_amendment})
    _require_future_start(row["starts_at"])
    attendance = await _related_attendance(db, row)
    if attendance:
        raise HTTPException(409, {"code": "OVERTIME_ATTENDANCE_REVIEW_REQUIRED",
                                  "message": "Đã có phiên chấm công liên quan. Không thể tự động điều chỉnh/thu hồi; cần rà soát ngoại lệ.",
                                  "attendance_id": attendance["attendance_id"]})


def _assert_lifecycle_proposer(row, user):
    roles = set(user.get("roles", []))
    if "ADMIN" in roles:
        return
    if "STORE_MANAGER" in roles:
        if row["store_id"] != user.get("store_id"):
            raise HTTPException(403, "Store manager may propose lifecycle changes only within their assigned store")
        if row["employee_id"] == user.get("employee_id"):
            raise HTTPException(403, "Store managers cannot propose changes for their own overtime request")
        return
    if "EMPLOYEE" in roles and row["employee_id"] == user.get("employee_id"):
        return
    raise HTTPException(403, "Only the assigned employee, scoped store manager, or ADMIN may propose this change")


async def _lock_request(db: AsyncSession, request_id: int):
    """Lock employee then request, matching all creation/schedule writers' lock order."""
    peek = await _get_request(db, request_id)
    await db.execute(text("SELECT employee_id FROM employees WHERE employee_id=:id FOR UPDATE"),
                     {"id": peek["employee_id"]})
    return await _get_request(db, request_id, lock=True)


def _assert_read_scope(row, user):
    roles = set(user.get("roles", []))
    if roles & REVIEW_ROLES:
        return
    if "STORE_MANAGER" in roles:
        if row["store_id"] == user.get("store_id") or row["employee_id"] == user.get("employee_id"):
            return
        raise HTTPException(404, "Overtime request not found in your store scope")
    if row["employee_id"] == user.get("employee_id"):
        return
    raise HTTPException(404, "Overtime request not found")


def _is_manager(user):
    return bool(set(user.get("roles", [])) & MANAGER_ROLES)


async def _can_edit_draft(row, user):
    roles = set(user.get("roles", []))
    if row["created_by"] == user.get("user_id"):
        if "STORE_MANAGER" in roles and not roles & REVIEW_ROLES:
            if row["employee_id"] == user.get("employee_id"):
                raise HTTPException(403, "Store managers cannot create or manage overtime for themselves")
            if row["store_id"] != user.get("store_id"):
                raise HTTPException(403, "Request is outside your store scope")
        return
    raise HTTPException(403, "Only the request creator may edit this draft")


async def _persist_status(db, row, user, action, new_status, *, reason=None, extra=None):
    old_status = row["status"]
    fields = {"status": new_status, "updated_at": text("clock_timestamp()")}
    if new_status == "PENDING_HR" and action == "EMPLOYEE_CONFIRM":
        fields["employee_confirmed_at"] = text("clock_timestamp()")
        fields["employee_responded_at"] = text("clock_timestamp()")
    elif new_status == "EMPLOYEE_DECLINED":
        fields["employee_responded_at"] = text("clock_timestamp()")
    elif new_status in {"APPROVED", "REJECTED"}:
        fields["reviewed_by"] = user["user_id"]
        fields["reviewed_at"] = text("clock_timestamp()")
        if new_status == "REJECTED":
            fields["rejection_reason"] = reason
    elif new_status == "CANCELLED":
        fields["cancelled_by"] = user["user_id"]
        fields["cancelled_at"] = text("clock_timestamp()")
    assignments = []
    params = {"id": row["request_id"], "old_status": old_status}
    for key, value in fields.items():
        if hasattr(value, "compile"):
            assignments.append(f"{key}={value.text}")
        else:
            assignments.append(f"{key}=:{key}")
            params[key] = value
    updated = (await db.execute(text(f"UPDATE overtime_requests SET {','.join(assignments)} WHERE request_id=:id AND status=:old_status RETURNING *"), params)).mappings().first()
    if not updated:
        raise HTTPException(409, {"code": "OVERTIME_REQUEST_CHANGED", "message": "Request changed concurrently; reload and retry"})
    await _append_event(db, row["request_id"], user["user_id"], action, old_status, new_status,
                        reason, {"status": old_status}, {"status": new_status, **(extra or {})})
    return dict(updated)


@router.post("", status_code=201)
async def create_request(req: OvertimeRequestCreate, idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", max_length=100),
                         user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    roles = set(user.get("roles", []))
    user_employee_id = user.get("employee_id")
    target_id = req.employee_id or user_employee_id
    if not target_id:
        raise HTTPException(422, "Link an employee profile or provide employee_id")
    is_self = target_id == user_employee_id
    if is_self and "STORE_MANAGER" in roles:
        raise HTTPException(403, "Store managers cannot register overtime for themselves")
    if is_self and not roles & {"EMPLOYEE", "ADMIN"}:
        raise HTTPException(403, "Only EMPLOYEE or authorized ADMIN may create an overtime request for themselves")
    if not is_self and not roles & {"ADMIN", "STORE_MANAGER"}:
        raise HTTPException(403, "Only ADMIN or STORE_MANAGER may create an overtime request for another employee")
    await _require_overtime_schema(db)
    employee = await _lock_request_employee(db, target_id)
    store_id = req.store_id or employee["store_id"]
    if store_id != employee["store_id"]:
        raise HTTPException(422, "Request store must match the employee's current assigned store")
    if "STORE_MANAGER" in roles and not roles & REVIEW_ROLES and store_id != user.get("store_id"):
        raise HTTPException(403, "Store manager may create overtime requests only for employees in their store")
    starts_at, ends_at = local_interval(req.work_date, req.start_time, req.end_time)
    _require_future_start(starts_at)
    idempotency_payload = {"employee_id": target_id, "store_id": store_id,
        "work_date": req.work_date.isoformat(), "start_time": req.start_time.isoformat(),
        "end_time": req.end_time.isoformat(), "reason": req.reason}
    if req.notes is not None:
        idempotency_payload["notes"] = req.notes
    if idempotency_key:
        if not idempotency_key.strip() or len(idempotency_key.strip()) < 8:
            raise HTTPException(422, "Idempotency-Key must contain at least 8 non-space characters")
        idempotency_key = idempotency_key.strip()
        await db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
                         {"key": f"overtime-request:{user['user_id']}:{idempotency_key}"})
        previous = (await db.execute(text("""SELECT request_id,idempotency_payload
            FROM overtime_requests WHERE created_by=:creator AND idempotency_key=:key FOR UPDATE"""),
            {"creator": user["user_id"], "key": idempotency_key})).mappings().first()
        if previous:
            if previous["idempotency_payload"] != idempotency_payload:
                raise HTTPException(409, {"code": "IDEMPOTENCY_KEY_REUSED", "message": "Idempotency-Key was already used for a different request"})
            await db.commit()
            return await _get_request(db, previous["request_id"])
    await _validate_interval(db, employee, req.work_date, starts_at, ends_at)
    row = (await db.execute(text("""INSERT INTO overtime_requests
        (employee_id,store_id,work_date,starts_at,ends_at,reason,notes,created_by,idempotency_key,idempotency_payload,status)
        VALUES(:employee,:store,:day,:start,:end,:reason,:notes,:creator,:idempotency_key,CAST(:idempotency_payload AS jsonb),'DRAFT') RETURNING *"""), {
        "employee": target_id, "store": store_id, "day": req.work_date, "start": starts_at,
        "end": ends_at, "reason": req.reason, "notes": req.notes, "creator": user["user_id"], "idempotency_key": idempotency_key,
        "idempotency_payload": json.dumps(idempotency_payload, ensure_ascii=False) if idempotency_key else None,
    })).mappings().one()
    await _append_event(db, row["request_id"], user["user_id"], "CREATE", None, "DRAFT", req.reason,
                        None, {"employee_id": target_id, "store_id": store_id,
                               "work_date": req.work_date, "starts_at": starts_at, "ends_at": ends_at,
                               "reason": req.reason, "notes": req.notes})
    await db.commit()
    return await _get_request(db, row["request_id"])


@router.get("")
async def list_requests(status: str | None = Query(default=None), employee_id: int | None = Query(default=None, gt=0),
                        store_id: int | None = Query(default=None, gt=0), date_from: date | None = None,
                        date_to: date | None = None, q: str | None = Query(default=None, max_length=120),
                        limit: int = Query(default=100, ge=1, le=200),
                        offset: int = Query(default=0, ge=0), user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    roles = set(user.get("roles", []))
    params = {"limit": limit, "offset": offset}
    where = ["1=1"]
    if roles & REVIEW_ROLES:
        pass
    elif "STORE_MANAGER" in roles:
        if not user.get("store_id"):
            raise HTTPException(403, "Store manager has no assigned store")
        where.append("(o.store_id=:scope_store OR o.employee_id=:scope_employee)")
        params.update(scope_store=user["store_id"], scope_employee=user.get("employee_id"))
    else:
        if not user.get("employee_id"):
            raise HTTPException(403, "No employee scope")
        where.append("o.employee_id=:scope_employee")
        params["scope_employee"] = user["employee_id"]
    if employee_id is not None:
        if not roles & REVIEW_ROLES and employee_id != user.get("employee_id") and "STORE_MANAGER" not in roles:
            raise HTTPException(403, "Employee filter is outside your permission")
        where.append("o.employee_id=:employee_id"); params["employee_id"] = employee_id
    if store_id is not None:
        if "STORE_MANAGER" in roles and not roles & REVIEW_ROLES and store_id != user.get("store_id"):
            raise HTTPException(403, "Store filter is outside your scope")
        if not roles & (REVIEW_ROLES | {"STORE_MANAGER"}) and store_id != user.get("store_id"):
            raise HTTPException(403, "Store filter is outside your scope")
        where.append("o.store_id=:store_id"); params["store_id"] = store_id
    if status:
        if status not in {"DRAFT", "PENDING_EMPLOYEE_CONFIRMATION", "PENDING_HR", "APPROVED", "REJECTED", "EMPLOYEE_DECLINED", "CANCELLED", "REVOKED", "REPLACED"}:
            raise HTTPException(422, "Unknown overtime request status")
        where.append("o.status=:status"); params["status"] = status
    search_term = (q or "").strip()
    if search_term:
        params["search_term"] = f"%{search_term}%"
        where.append("""(CAST(o.request_id AS text) ILIKE :search_term
            OR e.full_name ILIKE :search_term
            OR COALESCE(e.employee_code,'') ILIKE :search_term
            OR s.store_name ILIKE :search_term
            OR creator.username ILIKE :search_term)""")
    if date_from and not date_to or date_to and not date_from:
        raise HTTPException(422, "Provide both date_from and date_to")
    if date_from and date_to:
        if date_to < date_from or (date_to - date_from).days > 366:
            raise HTTPException(422, "Date range must be ordered and at most 367 days")
        where.append("o.work_date BETWEEN :date_from AND :date_to")
        params.update(date_from=date_from, date_to=date_to)
    await _require_overtime_schema(db)
    results = [dict(r) for r in (await db.execute(text("""SELECT o.*,e.full_name AS employee_name,e.employee_code,s.store_name,
        creator.username AS creator_username,reviewer.username AS reviewer_username,
        rec.status AS reconciliation_status,
        rec.verified_microseconds,
        rec.decision_reason AS reconciliation_reason,
        rec.reviewed_at AS reconciliation_reviewed_at
        FROM overtime_requests o JOIN employees e ON e.employee_id=o.employee_id
        JOIN stores s ON s.store_id=o.store_id
        JOIN users creator ON creator.user_id=o.created_by
        LEFT JOIN users reviewer ON reviewer.user_id=o.reviewed_by
        LEFT JOIN public.overtime_reconciliations rec ON rec.request_id=o.request_id
        WHERE """ + " AND ".join(where) + " ORDER BY o.work_date DESC,o.request_id DESC LIMIT :limit OFFSET :offset"), params)).mappings().all()]
    for result in results:
        for key in ("starts_at", "ends_at", "employee_confirmed_at", "employee_responded_at",
                    "reviewed_at", "cancelled_at", "created_at", "updated_at",
                    "revoke_requested_at", "revoke_decided_at", "revoked_at",
                    "reconciliation_reviewed_at"):
            if result.get(key) is not None:
                result[key] = result[key].astimezone(VIETNAM_TZ)
        if result.get("verified_microseconds") is not None:
            result["verified_hours"] = round(float(result["verified_microseconds"]) / 3_600_000_000, 2)
        else:
            result["verified_hours"] = None
        result.update(_overdue_summary(result))
    return results


@router.get("/count")
async def count_requests(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Return the total number of OT requests visible to the authenticated user."""
    roles = set(user.get("roles", []))
    where = ["TRUE"]
    params: dict = {}
    if not roles & REVIEW_ROLES:
        if "STORE_MANAGER" in roles:
            store_id = user.get("store_id")
            if not store_id:
                raise HTTPException(403, "Store manager has no assigned store")
            where.append("(o.store_id=:scope_store OR o.employee_id=:scope_employee)")
            params.update(scope_store=store_id, scope_employee=user.get("employee_id"))
        else:
            employee_id = user.get("employee_id")
            if not employee_id:
                raise HTTPException(403, "No employee scope")
            where.append("o.employee_id=:scope_employee")
            params["scope_employee"] = employee_id
    await _require_overtime_schema(db)
    count = (await db.execute(text(
        "SELECT count(*) FROM public.overtime_requests o WHERE " + " AND ".join(where)
    ), params)).scalar_one()
    return {"count": int(count)}


@router.get("/{request_id}")
async def get_request(request_id: int, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = await _get_request(db, request_id)
    _assert_read_scope(row, user)
    events = (await db.execute(text("""SELECT ev.*,actor.username AS actor_username
        FROM overtime_request_events ev JOIN users actor ON actor.user_id=ev.actor_id
        WHERE ev.request_id=:id ORDER BY ev.event_id"""), {"id": request_id})).mappings().all()
    row["events"] = [dict(event) for event in events]
    row["approval_context"] = await _approval_context(db, row)
    related = (await db.execute(text("""SELECT request_id,request_type,parent_request_id,replaced_by_request_id,
        status,work_date,starts_at,ends_at,reason,created_by,created_at
        FROM overtime_requests
        WHERE parent_request_id=:id OR request_id=:parent_id OR replaced_by_request_id=:id
        ORDER BY request_id"""), {"id": request_id, "parent_id": row.get("parent_request_id") or 0})).mappings().all()
    row["related_requests"] = []
    for item in related:
        entry = dict(item)
        for key in ("starts_at", "ends_at", "created_at"):
            if entry.get(key) is not None:
                entry[key] = entry[key].astimezone(VIETNAM_TZ)
        row["related_requests"].append(entry)
    pending_revoke = bool(row.get("revoke_requested_at") and not row.get("revoke_decided_at"))
    attendance = await _related_attendance(db, row)
    row["lifecycle"] = {
        "eligible": row["status"] == "APPROVED" and row.get("replaced_by_request_id") is None
                    and not pending_revoke and row["starts_at"] > datetime.now(VIETNAM_TZ) and attendance is None,
        "attendance_linked": attendance is not None,
        "blocking_attendance_id": attendance["attendance_id"] if attendance else None,
        "revocation_pending": pending_revoke,
    }

    rec = (await db.execute(text("""
        SELECT status AS reconciliation_status, verified_microseconds,
               decision_reason AS reconciliation_reason, reviewed_at AS reconciliation_reviewed_at
        FROM public.overtime_reconciliations WHERE request_id=:id
    """), {"id": request_id})).mappings().first()
    if rec:
        rec_dict = dict(rec)
        if rec_dict.get("reconciliation_reviewed_at") is not None:
            rec_dict["reconciliation_reviewed_at"] = rec_dict["reconciliation_reviewed_at"].astimezone(VIETNAM_TZ)
        if rec_dict.get("verified_microseconds") is not None:
            rec_dict["verified_hours"] = round(float(rec_dict["verified_microseconds"]) / 3_600_000_000, 2)
        else:
            rec_dict["verified_hours"] = None
        row.update(rec_dict)
    else:
        row["reconciliation_status"] = None
        row["verified_microseconds"] = None
        row["verified_hours"] = None
        row["reconciliation_reason"] = None
        row["reconciliation_reviewed_at"] = None

    return row


async def _approval_context(db: AsyncSession, row):
    """Read-only preflight shown to reviewers; approve still reruns the authoritative checks."""
    params = {"employee": row["employee_id"], "store": row["store_id"],
              "work_date": row["work_date"], "schedule_from": row["work_date"] - timedelta(days=1), "starts_at": row["starts_at"],
              "ends_at": row["ends_at"], "request_id": row["request_id"],
              "parent_id": row.get("parent_request_id") or 0}
    schedules = (await db.execute(text("""SELECT ws.schedule_id,ws.work_date,sh.shift_name,
        COALESCE(ws.starts_at,(ws.work_date+sh.start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh') AS starts_at,
        COALESCE(ws.ends_at,(ws.work_date+sh.end_time+CASE WHEN sh.end_time<=sh.start_time THEN interval '1 day' ELSE interval '0 day' END) AT TIME ZONE 'Asia/Ho_Chi_Minh') AS ends_at
        FROM work_schedules ws JOIN work_shifts sh USING(shift_id)
        WHERE ws.employee_id=:employee AND ws.store_id=:store AND ws.cancelled_at IS NULL
          AND ws.work_date BETWEEN :schedule_from AND :work_date
        ORDER BY ws.work_date,ws.schedule_id"""), params)).mappings().all()
    related_schedules = []
    conflicts = []
    for schedule in schedules:
        item = dict(schedule)
        overlaps = item["starts_at"] < row["ends_at"] and item["ends_at"] > row["starts_at"]
        item["overlaps_overtime"] = overlaps
        related_schedules.append(item)
        if overlaps:
            conflicts.append({"code": "WORK_SCHEDULE_CONFLICT", "message": "Khung giờ OT trùng ca được phân công",
                              "schedule_id": item["schedule_id"]})

    duplicate = (await db.execute(text("""SELECT request_id FROM overtime_requests
        WHERE employee_id=:employee AND request_id<>:request_id AND request_id<>:parent_id
          AND status = ANY(ARRAY['DRAFT','PENDING_EMPLOYEE_CONFIRMATION','PENDING_HR','APPROVED']::varchar[])
          AND starts_at < :ends_at AND ends_at > :starts_at
        ORDER BY request_id LIMIT 1"""), params)).scalar_one_or_none()
    if duplicate:
        conflicts.append({"code": "OVERTIME_REQUEST_CONFLICT", "message": "Trùng một đăng ký OT đang còn hiệu lực",
                          "request_id": duplicate})
    leave = (await db.execute(text("""SELECT request_id FROM leave_requests
        WHERE employee_id=:employee AND status IN ('PENDING','STORE_APPROVED','HR_APPROVED')
          AND start_date<=:work_date AND end_date>=:work_date ORDER BY request_id LIMIT 1"""), params)).scalar_one_or_none()
    if leave:
        conflicts.append({"code": "LEAVE_CONFLICT", "message": "Nhân viên có đơn nghỉ phép đang chờ hoặc đã duyệt trong ngày OT",
                          "leave_request_id": leave})
    return {"related_schedules": related_schedules, "conflicts": conflicts}


@router.patch("/{request_id}")
async def patch_request(request_id: int, req: OvertimeRequestPatch, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = await _lock_request(db, request_id)
    await _can_edit_draft(row, user)
    require_transition(row["status"], {"DRAFT"}, "edit")
    employee = await _lock_request_employee(db, row["employee_id"])
    _ensure_request_store(row, employee)
    local_start = row["starts_at"].astimezone(VIETNAM_TZ)
    local_end = row["ends_at"].astimezone(VIETNAM_TZ)
    day = req.work_date or row["work_date"]
    start_time = req.start_time or local_start.timetz().replace(tzinfo=None)
    end_time = req.end_time or local_end.timetz().replace(tzinfo=None)
    starts_at, ends_at = local_interval(day, start_time, end_time)
    await _validate_interval(db, employee, day, starts_at, ends_at, request_id)
    reason = req.reason if req.reason is not None else row["reason"]
    notes = req.notes if "notes" in req.model_fields_set else row.get("notes")
    updated = (await db.execute(text("""UPDATE overtime_requests SET work_date=:day,starts_at=:start,ends_at=:end,
        reason=:reason,notes=:notes,updated_at=clock_timestamp() WHERE request_id=:id AND status='DRAFT' RETURNING *"""), {
        "day": day, "start": starts_at, "end": ends_at, "reason": reason, "notes": notes, "id": request_id,
    })).mappings().first()
    if not updated:
        raise HTTPException(409, "Request changed concurrently; reload and retry")
    await _append_event(db, request_id, user["user_id"], "EDIT", "DRAFT", "DRAFT", reason,
                        {"work_date": row["work_date"], "starts_at": row["starts_at"], "ends_at": row["ends_at"], "reason": row["reason"], "notes": row.get("notes")},
                        {"work_date": day, "starts_at": starts_at, "ends_at": ends_at, "reason": reason, "notes": notes})
    await db.commit()
    return await _get_request(db, request_id)


@router.post("/{request_id}/submit")
async def submit_request(request_id: int, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = await _lock_request(db, request_id)
    await _can_edit_draft(row, user)
    if row["status"] in {"PENDING_EMPLOYEE_CONFIRMATION", "PENDING_HR"}:
        return row
    require_transition(row["status"], {"DRAFT"}, "submit")
    employee = await _lock_request_employee(db, row["employee_id"])
    _ensure_request_store(row, employee)
    _require_future_start(row["starts_at"])
    await _validate_interval(db, employee, row["work_date"], row["starts_at"], row["ends_at"], request_id)
    on_behalf = row["employee_id"] != user.get("employee_id")
    next_status = "PENDING_EMPLOYEE_CONFIRMATION" if on_behalf else "PENDING_HR"
    await _persist_status(db, row, user, "SUBMIT", next_status, reason=row["reason"])
    await db.commit()
    return await _get_request(db, request_id)


@router.post("/{request_id}/employee-confirm")
async def employee_confirm(request_id: int, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = await _lock_request(db, request_id)
    if row["employee_id"] != user.get("employee_id"):
        raise HTTPException(403, "Only the assigned employee may confirm this proposal")
    if row["status"] == "PENDING_HR" and row["employee_confirmed_at"]:
        return row
    require_transition(row["status"], {"PENDING_EMPLOYEE_CONFIRMATION"}, "confirm")
    employee = await _lock_request_employee(db, row["employee_id"])
    _ensure_request_store(row, employee)
    _require_future_start(row["starts_at"])
    await _validate_interval(db, employee, row["work_date"], row["starts_at"], row["ends_at"],
                             request_id, row.get("parent_request_id"))
    await _persist_status(db, row, user, "EMPLOYEE_CONFIRM", "PENDING_HR", reason="Employee confirmed proposed overtime")
    await db.commit()
    return await _get_request(db, request_id)


@router.post("/{request_id}/employee-decline")
async def employee_decline(request_id: int, body: OvertimeDecision | None = None,
                           user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = await _lock_request(db, request_id)
    if row["employee_id"] != user.get("employee_id"):
        raise HTTPException(403, "Only the assigned employee may decline this proposal")
    if row["status"] == "EMPLOYEE_DECLINED":
        return row
    require_transition(row["status"], {"PENDING_EMPLOYEE_CONFIRMATION"}, "decline")
    await _persist_status(db, row, user, "EMPLOYEE_DECLINE", "EMPLOYEE_DECLINED",
                          reason=body.reason if body else None)
    await db.commit()
    return await _get_request(db, request_id)


@router.post("/{request_id}/approve")
async def approve_request(request_id: int, user=Depends(require_roles(["HR_MANAGER", "ADMIN"])), db: AsyncSession = Depends(get_db)):
    row = await _lock_request(db, request_id)
    if row.get("request_type") == "AMENDMENT":
        raise HTTPException(409, {"code": "USE_AMENDMENT_APPROVAL", "message": "Đơn điều chỉnh phải được duyệt bằng luồng phê duyệt thay thế."})
    if row["status"] == "APPROVED":
        return row
    require_transition(row["status"], {"PENDING_HR"}, "approve")
    if row["created_by"] == user.get("user_id") or row["employee_id"] == user.get("employee_id"):
        raise HTTPException(403, "You cannot approve an overtime request you created or one assigned to yourself")
    employee = await _lock_request_employee(db, row["employee_id"])
    _ensure_request_store(row, employee)
    _require_future_start(row["starts_at"])
    await _validate_interval(db, employee, row["work_date"], row["starts_at"], row["ends_at"], request_id)
    await _persist_status(db, row, user, "APPROVE", "APPROVED", reason="Approved by HR")
    await db.commit()
    return await _get_request(db, request_id)


@router.post("/{request_id}/reject")
async def reject_request(request_id: int, body: OvertimeRejection,
                         user=Depends(require_roles(["HR_MANAGER", "ADMIN"])), db: AsyncSession = Depends(get_db)):
    row = await _lock_request(db, request_id)
    if row["status"] == "REJECTED":
        return row
    require_transition(row["status"], {"PENDING_HR"}, "reject")
    if row["created_by"] == user.get("user_id") or row["employee_id"] == user.get("employee_id"):
        raise HTTPException(403, "You cannot reject an overtime request you created or one assigned to yourself")
    await _persist_status(db, row, user, "REJECT", "REJECTED", reason=body.reason)
    await db.commit()
    return await _get_request(db, request_id)


@router.post("/{request_id}/cancel")
async def cancel_request(request_id: int, body: OvertimeDecision | None = None,
                         user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = await _lock_request(db, request_id)
    roles = set(user.get("roles", []))
    if row["status"] == "CANCELLED":
        return row
    require_transition(row["status"], {"DRAFT", "PENDING_EMPLOYEE_CONFIRMATION", "PENDING_HR"}, "cancel")
    is_employee = row["employee_id"] == user.get("employee_id")
    is_creator = row["created_by"] == user.get("user_id")
    if is_employee and not is_creator and row["status"] == "DRAFT":
        raise HTTPException(409, "The proposal must be submitted before the assigned employee can cancel it")
    if roles & REVIEW_ROLES:
        if not (is_employee or is_creator):
            raise HTTPException(403, "Only the request creator or employee may cancel it")
    elif "STORE_MANAGER" in roles:
        if row["store_id"] != user.get("store_id") or row["employee_id"] == user.get("employee_id") or not is_creator:
            raise HTTPException(403, "Store manager may cancel only proposals they created for their store")
    elif not is_employee:
        raise HTTPException(403, "Only the assigned employee may cancel this request")
    await _persist_status(db, row, user, "CANCEL", "CANCELLED", reason=body.reason if body else None)
    await db.commit()
    return await _get_request(db, request_id)


@router.post("/{request_id}/revoke-request")
async def request_revocation(request_id: int, body: OvertimeLifecycleReason,
                             user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = await _lock_request(db, request_id)
    _assert_read_scope(row, user)
    _assert_lifecycle_proposer(row, user)
    if row["status"] == "REVOKED":
        return row
    if row.get("revoke_requested_at") and not row.get("revoke_decided_at"):
        if row.get("revoke_requested_by") == user["user_id"] and row.get("revoke_reason") == body.reason:
            return row
        raise HTTPException(409, {"code": "OVERTIME_REVOCATION_PENDING", "message": "Đơn đã có yêu cầu thu hồi đang chờ xử lý."})
    await _assert_lifecycle_eligible(db, row)
    employee = await _lock_request_employee(db, row["employee_id"])
    _ensure_request_store(row, employee)
    old = {"status": row["status"], "starts_at": row["starts_at"], "ends_at": row["ends_at"],
           "replaced_by_request_id": row.get("replaced_by_request_id")}
    result = await db.execute(text("""UPDATE overtime_requests
        SET revoke_requested_by=:actor,revoke_requested_at=clock_timestamp(),revoke_reason=:reason,
            revoke_decided_by=NULL,revoke_decided_at=NULL,revoke_decision=NULL,revoke_decision_reason=NULL,
            updated_at=clock_timestamp()
        WHERE request_id=:id AND status='APPROVED'
          AND (revoke_requested_at IS NULL OR revoke_decided_at IS NOT NULL)
        RETURNING request_id"""), {"actor": user["user_id"], "reason": body.reason, "id": request_id})
    if not result.scalar_one_or_none():
        raise HTTPException(409, {"code": "OVERTIME_REQUEST_CHANGED", "message": "Yêu cầu đã thay đổi; tải lại trước khi thử lại."})
    await _append_event(db, request_id, user["user_id"], "REVOKE_REQUEST", "APPROVED", "REVOKE_PENDING",
                        body.reason, old, {"status": "APPROVED", "revoke_requested_by": user["user_id"],
                                          "revoke_reason": body.reason})
    await db.commit()
    return await _get_request(db, request_id)


@router.post("/{request_id}/revoke-approve")
async def approve_revocation(request_id: int, user=Depends(require_roles(["HR_MANAGER", "ADMIN"])),
                             db: AsyncSession = Depends(get_db)):
    row = await _lock_request(db, request_id)
    if row["status"] == "REVOKED":
        return row
    if row["status"] != "APPROVED" or not row.get("revoke_requested_at") or row.get("revoke_decided_at"):
        raise HTTPException(409, {"code": "OVERTIME_REVOCATION_NOT_PENDING", "message": "Không có yêu cầu thu hồi đang chờ quyết định."})
    if (row.get("revoke_requested_by") == user.get("user_id")
            or row["created_by"] == user.get("user_id")
            or row["employee_id"] == user.get("employee_id")):
        raise HTTPException(403, "Bạn không thể tự duyệt yêu cầu thu hồi do mình tạo hoặc liên quan đến chính mình.")
    _require_future_start(row["starts_at"])
    attendance = await _related_attendance(db, row)
    if attendance:
        raise HTTPException(409, {"code": "OVERTIME_ATTENDANCE_REVIEW_REQUIRED",
                                  "message": "Đã có Attendance liên quan; yêu cầu thu hồi phải chuyển sang rà soát ngoại lệ.",
                                  "attendance_id": attendance["attendance_id"]})
    result = (await db.execute(text("""UPDATE overtime_requests
        SET status='REVOKED',revoke_decision='APPROVED',revoke_decided_by=:actor,
            revoke_decided_at=clock_timestamp(),revoke_decision_reason='Approved by HR',
            revoked_by=:actor,revoked_at=clock_timestamp(),revocation_reason=revoke_reason,
            updated_at=clock_timestamp()
        WHERE request_id=:id AND status='APPROVED' AND revoke_requested_at IS NOT NULL
          AND revoke_decided_at IS NULL RETURNING request_id"""), {
        "actor": user["user_id"], "id": request_id,
    })).scalar_one_or_none()
    if not result:
        raise HTTPException(409, {"code": "OVERTIME_REQUEST_CHANGED", "message": "Yêu cầu đã được xử lý đồng thời; tải lại trạng thái."})
    await _append_event(db, request_id, user["user_id"], "REVOKE_APPROVE", "APPROVED", "REVOKED",
                        row.get("revoke_reason"),
                        {"status": "APPROVED", "revoke_requested_at": row.get("revoke_requested_at")},
                        {"status": "REVOKED", "revoked_by": user["user_id"], "revocation_reason": row.get("revoke_reason")})
    await db.commit()
    return await _get_request(db, request_id)


@router.post("/{request_id}/revoke-reject")
async def reject_revocation(request_id: int, body: OvertimeLifecycleReason,
                            user=Depends(require_roles(["HR_MANAGER", "ADMIN"])), db: AsyncSession = Depends(get_db)):
    row = await _lock_request(db, request_id)
    if row["revoke_decision"] == "REJECTED":
        return row
    if row["status"] != "APPROVED" or not row.get("revoke_requested_at") or row.get("revoke_decided_at"):
        raise HTTPException(409, {"code": "OVERTIME_REVOCATION_NOT_PENDING", "message": "Không có yêu cầu thu hồi đang chờ quyết định."})
    if (row.get("revoke_requested_by") == user.get("user_id")
            or row["created_by"] == user.get("user_id")
            or row["employee_id"] == user.get("employee_id")):
        raise HTTPException(403, "Bạn không thể tự quyết định yêu cầu thu hồi của chính mình.")
    await db.execute(text("""UPDATE overtime_requests SET revoke_decision='REJECTED',
        revoke_decided_by=:actor,revoke_decided_at=clock_timestamp(),revoke_decision_reason=:reason,
        updated_at=clock_timestamp() WHERE request_id=:id AND status='APPROVED'
          AND revoke_requested_at IS NOT NULL AND revoke_decided_at IS NULL"""), {
        "actor": user["user_id"], "reason": body.reason, "id": request_id,
    })
    await _append_event(db, request_id, user["user_id"], "REVOKE_REJECT", "APPROVED", "REVOKE_REJECTED",
                        body.reason, {"status": "APPROVED", "revoke_reason": row.get("revoke_reason")},
                        {"status": "APPROVED", "revoke_decision": "REJECTED", "revoke_decision_reason": body.reason})
    await db.commit()
    return await _get_request(db, request_id)


@router.post("/{request_id}/amend", status_code=201)
async def propose_amendment(request_id: int, body: OvertimeAmendment,
                            user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    parent = await _lock_request(db, request_id)
    _assert_read_scope(parent, user)
    _assert_lifecycle_proposer(parent, user)
    await _assert_lifecycle_eligible(db, parent, allow_active_amendment=True)
    employee = await _lock_request_employee(db, parent["employee_id"])
    _ensure_request_store(parent, employee)
    starts_at, ends_at = local_interval(body.work_date, body.start_time, body.end_time)
    _require_future_start(starts_at)
    if starts_at == parent["starts_at"] and ends_at == parent["ends_at"]:
        raise HTTPException(422, {"code": "OVERTIME_AMENDMENT_NO_CHANGE", "message": "Khung ngày giờ mới phải khác đơn OT đã duyệt."})
    proposed_attendance = await _related_attendance(db, {
        "employee_id": parent["employee_id"], "starts_at": starts_at, "ends_at": ends_at,
    })
    if proposed_attendance:
        raise HTTPException(409, {"code": "OVERTIME_ATTENDANCE_REVIEW_REQUIRED",
                                  "message": "Khung giờ thay thế có Attendance liên quan; cần rà soát ngoại lệ trước khi gửi đề xuất.",
                                  "attendance_id": proposed_attendance["attendance_id"]})

    existing = (await db.execute(text("""SELECT * FROM overtime_requests WHERE parent_request_id=:parent
        AND request_type='AMENDMENT' AND status IN ('DRAFT','PENDING_EMPLOYEE_CONFIRMATION','PENDING_HR','APPROVED')
        ORDER BY request_id DESC LIMIT 1 FOR UPDATE"""), {"parent": request_id})).mappings().first()
    on_behalf = parent["employee_id"] != user.get("employee_id")
    initial_status = "PENDING_EMPLOYEE_CONFIRMATION" if on_behalf else "PENDING_HR"
    if existing:
        same_payload = (existing["created_by"] == user["user_id"] and existing["work_date"] == body.work_date
                        and existing["starts_at"] == starts_at and existing["ends_at"] == ends_at
                        and existing["reason"] == body.reason and existing.get("notes") == body.notes
                        and existing["status"] == initial_status)
        if same_payload:
            await db.commit()
            return await _get_request(db, existing["request_id"])
        raise HTTPException(409, {"code": "OVERTIME_AMENDMENT_PENDING", "message": "Đơn đã có đề xuất điều chỉnh còn hiệu lực."})

    await _validate_interval(db, employee, body.work_date, starts_at, ends_at,
                             exclude_id=request_id, exclude_parent_id=parent.get("parent_request_id"))
    child = (await db.execute(text("""INSERT INTO overtime_requests
        (employee_id,store_id,work_date,starts_at,ends_at,reason,notes,created_by,status,request_type,parent_request_id)
        VALUES(:employee,:store,:day,:start,:end,:reason,:notes,:creator,:status,'AMENDMENT',:parent)
        RETURNING request_id"""), {
        "employee": parent["employee_id"], "store": parent["store_id"], "day": body.work_date,
        "start": starts_at, "end": ends_at, "reason": body.reason, "notes": body.notes,
        "creator": user["user_id"], "status": initial_status, "parent": request_id,
    })).mappings().one()
    child_id = child["request_id"]
    await _append_event(db, child_id, user["user_id"], "AMEND_REQUEST", None, initial_status, body.reason,
                        {"parent_request_id": request_id, "work_date": parent["work_date"],
                         "starts_at": parent["starts_at"], "ends_at": parent["ends_at"], "reason": parent["reason"]},
                        {"parent_request_id": request_id, "work_date": body.work_date,
                         "starts_at": starts_at, "ends_at": ends_at, "reason": body.reason,
                         "notes": body.notes, "status": initial_status})
    await db.commit()
    return await _get_request(db, child_id)


@router.post("/{request_id}/amend-approve")
async def approve_amendment(request_id: int, user=Depends(require_roles(["HR_MANAGER", "ADMIN"])),
                            db: AsyncSession = Depends(get_db)):
    child = await _lock_request(db, request_id)
    if child.get("request_type") != "AMENDMENT" or not child.get("parent_request_id"):
        raise HTTPException(409, {"code": "NOT_OVERTIME_AMENDMENT", "message": "Đơn này không phải đề xuất điều chỉnh OT."})
    parent = await _get_request(db, child["parent_request_id"], lock=True)
    if child["status"] == "APPROVED" and parent.get("replaced_by_request_id") == child["request_id"]:
        return child
    require_transition(child["status"], {"PENDING_HR"}, "approve amendment")
    if (child["created_by"] == user.get("user_id") or parent["created_by"] == user.get("user_id")
            or child["employee_id"] == user.get("employee_id")):
        raise HTTPException(403, "Bạn không thể tự duyệt đề xuất OT do mình tạo hoặc liên quan đến chính mình.")
    if parent["status"] != "APPROVED" or parent.get("replaced_by_request_id") is not None:
        raise HTTPException(409, {"code": "OVERTIME_ORIGINAL_NOT_ACTIVE", "message": "Đơn gốc không còn hiệu lực để thay thế."})
    if parent.get("revoke_requested_at") and not parent.get("revoke_decided_at"):
        raise HTTPException(409, {"code": "OVERTIME_REVOCATION_PENDING", "message": "Đơn gốc đang chờ quyết định thu hồi."})
    _require_future_start(child["starts_at"])
    parent_attendance = await _related_attendance(db, parent)
    if parent_attendance:
        raise HTTPException(409, {"code": "OVERTIME_ATTENDANCE_REVIEW_REQUIRED", "message": "Đơn gốc đã có Attendance liên quan; cần rà soát ngoại lệ.", "attendance_id": parent_attendance["attendance_id"]})
    child_attendance = await _related_attendance(db, child)
    if child_attendance:
        raise HTTPException(409, {"code": "OVERTIME_ATTENDANCE_REVIEW_REQUIRED", "message": "Khung giờ thay thế đã có Attendance liên quan; cần rà soát ngoại lệ.", "attendance_id": child_attendance["attendance_id"]})
    employee = await _lock_request_employee(db, child["employee_id"])
    _ensure_request_store(child, employee)
    await _validate_interval(db, employee, child["work_date"], child["starts_at"], child["ends_at"],
                             exclude_id=child["request_id"], exclude_parent_id=parent["request_id"])
    await _persist_status(db, child, user, "AMEND_APPROVE", "APPROVED", reason="Approved as replacement OT")
    replaced = (await db.execute(text("""UPDATE overtime_requests
        SET status='REPLACED',replaced_by_request_id=:replacement,updated_at=clock_timestamp()
        WHERE request_id=:parent AND status='APPROVED' AND replaced_by_request_id IS NULL
          AND (revoke_requested_at IS NULL OR revoke_decided_at IS NOT NULL)
        RETURNING request_id"""), {"replacement": child["request_id"], "parent": parent["request_id"]})).scalar_one_or_none()
    if not replaced:
        raise HTTPException(409, {"code": "OVERTIME_REQUEST_CHANGED", "message": "Đơn gốc đã thay đổi đồng thời; không thể áp dụng bản thay thế."})
    await _append_event(db, parent["request_id"], user["user_id"], "AMEND_REPLACE", "APPROVED", "REPLACED",
                        child["reason"],
                        {"status": "APPROVED", "starts_at": parent["starts_at"], "ends_at": parent["ends_at"]},
                        {"status": "REPLACED", "replaced_by_request_id": child["request_id"],
                         "starts_at": child["starts_at"], "ends_at": child["ends_at"]})
    await db.commit()
    return await _get_request(db, child["request_id"])
