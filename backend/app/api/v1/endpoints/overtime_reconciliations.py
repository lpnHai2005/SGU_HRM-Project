"""OT reconciliation is a separate decision from request approval and payroll."""

import json
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_roles
from app.api.v1.endpoints.overtime_requests import (
    _assert_read_scope, _get_request, _lock_request,
)
from app.core.database import get_db
from app.core.ot_reconciliation import (
    derive_execution_status, reconcile_intervals, union_intervals,
)


router = APIRouter()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ReconciliationDecision(BaseModel):
    expected_version: int = Field(gt=0)
    reason: str | None = Field(default=None, max_length=1000)


class ReconciliationRejection(BaseModel):
    expected_version: int = Field(gt=0)
    reason: str = Field(min_length=3, max_length=1000)


class ReconciliationReopen(BaseModel):
    expected_version: int = Field(gt=0)
    reason: str = Field(min_length=3, max_length=1000)


class ExplanationRequest(BaseModel):
    expected_version: int = Field(gt=0)
    reason: str = Field(min_length=3, max_length=1000)


class ExplanationResponse(BaseModel):
    expected_case_version: int = Field(gt=0)
    response: str = Field(min_length=3, max_length=4000)


class ExceptionCaseClose(BaseModel):
    expected_case_version: int = Field(gt=0)
    reason: str = Field(min_length=3, max_length=1000)


class ReviewRequestCreate(BaseModel):
    expected_reconciliation_version: int = Field(gt=0)
    reason: str = Field(min_length=3, max_length=1000)


class ReviewRequestDecision(BaseModel):
    expected_case_version: int = Field(gt=0)
    expected_reconciliation_version: int = Field(gt=0)
    decision: str = Field(pattern="^(ACCEPT|REJECT)$")
    reason: str = Field(min_length=3, max_length=1000)


async def _require_schema(db: AsyncSession) -> None:
    available = (await db.execute(text("""SELECT
        to_regclass('public.overtime_reconciliations') IS NOT NULL AND
        to_regclass('public.overtime_reconciliation_events') IS NOT NULL AND
        to_regclass('public.v_overtime_verified_current') IS NOT NULL AND
        to_regprocedure('public.ot_reconciliation_request_eligible(bigint)') IS NOT NULL"""))).scalar_one()
    if not available:
        raise HTTPException(503, {"code": "OT_RECONCILIATION_SCHEMA_NOT_INSTALLED",
                                  "message": "Chức năng đối soát OT chưa được triển khai trên cơ sở dữ liệu."})


async def _exception_schema_available(db: AsyncSession) -> bool:
    return bool((await db.execute(text("""SELECT
        to_regclass('public.overtime_reconciliation_cases') IS NOT NULL AND
        to_regclass('public.overtime_reconciliation_case_events') IS NOT NULL"""))).scalar_one())


async def _require_exception_schema(db: AsyncSession) -> None:
    await _require_schema(db)
    if not await _exception_schema_available(db):
        raise HTTPException(503, {
            "code": "OT_RECONCILIATION_EXCEPTION_SCHEMA_NOT_INSTALLED",
            "message": "Luồng giải trình và xem xét lại OT chưa được triển khai trên cơ sở dữ liệu.",
        })


async def _case_record(db: AsyncSession, request_id: int, case_id: int, *, lock: bool = False):
    suffix = " FOR UPDATE" if lock else ""
    row = (await db.execute(text("""SELECT * FROM public.overtime_reconciliation_cases
        WHERE request_id=:request AND case_id=:case""" + suffix),
        {"request": request_id, "case": case_id})).mappings().first()
    return dict(row) if row else None


async def _active_explanation_case(db: AsyncSession, request_id: int, reconciliation_version: int,
                                   *, lock: bool = False):
    suffix = " FOR UPDATE" if lock else ""
    row = (await db.execute(text("""SELECT * FROM public.overtime_reconciliation_cases
        WHERE request_id=:request AND reconciliation_version=:version
          AND case_type='EXPLANATION' AND status IN ('OPEN','RESPONDED')""" + suffix), {
            "request": request_id, "version": reconciliation_version,
        })).mappings().first()
    return dict(row) if row else None


async def _case_event(db: AsyncSession, case: dict, actor_id: int, action: str,
                      from_status: str | None, to_status: str, reason: str | None,
                      details: dict | None = None) -> None:
    await db.execute(text("""INSERT INTO public.overtime_reconciliation_case_events
        (case_id,actor_id,action,from_status,to_status,version,reason,details)
        VALUES(:case,:actor,:action,:previous,:current,:version,:reason,CAST(:details AS jsonb))"""), {
            "case": case["case_id"], "actor": actor_id, "action": action,
            "previous": from_status, "current": to_status, "version": case["version"],
            "reason": reason, "details": json.dumps(details or {}, ensure_ascii=False),
        })


async def _case_payload(db: AsyncSession, case: dict) -> dict:
    events = (await db.execute(text("""SELECT case_event_id,actor_id,action,from_status,
        to_status,version,reason,details,created_at
        FROM public.overtime_reconciliation_case_events WHERE case_id=:id
        ORDER BY case_event_id"""), {"id": case["case_id"]})).mappings().all()
    return {**case, "events": [dict(event) for event in events]}


async def _exception_cases_for_response(db: AsyncSession, request: dict, user: dict) -> list[dict]:
    if not await _exception_schema_available(db):
        return []
    roles = set(user.get("roles", []))
    can_read = bool(roles & {"ADMIN", "HR_MANAGER"}) or (
        request["employee_id"] == user.get("employee_id") or
        request["created_by"] == user.get("user_id")
    )
    if not can_read:
        return []
    rows = (await db.execute(text("""SELECT c.*,
        COALESCE(jsonb_agg(jsonb_build_object(
            'case_event_id',e.case_event_id,'actor_id',e.actor_id,'action',e.action,
            'from_status',e.from_status,'to_status',e.to_status,'version',e.version,
            'reason',e.reason,'details',e.details,'created_at',e.created_at)
            ORDER BY e.case_event_id) FILTER (WHERE e.case_event_id IS NOT NULL), '[]'::jsonb) AS events
        FROM public.overtime_reconciliation_cases c
        LEFT JOIN public.overtime_reconciliation_case_events e USING(case_id)
        WHERE c.request_id=:request
        GROUP BY c.case_id ORDER BY c.reconciliation_version DESC,c.case_id DESC"""),
        {"request": request["request_id"]})).mappings().all()
    return [dict(row) for row in rows]


async def _source(db: AsyncSession, request: dict, *, lock: bool):
    suffix = " FOR SHARE OF a" if lock else ""
    rows = (await db.execute(text("""SELECT a.attendance_id,a.employee_id,a.store_id,
        a.check_in_time,a.check_out_time,a.attendance_context
        FROM attendances a WHERE a.employee_id=:employee
          AND a.check_in_time IS NOT NULL AND a.check_in_time < :ends_at
          AND (a.check_out_time IS NULL OR a.check_out_time > :starts_at)
        ORDER BY a.attendance_id""" + suffix), {
            "employee": request["employee_id"], "starts_at": request["starts_at"],
            "ends_at": request["ends_at"],
        })).mappings().all()
    signature = (await db.execute(text(
        "SELECT public.ot_reconciliation_source_signature(:id)"
    ), {"id": request["request_id"]})).scalar_one()
    preview = reconcile_intervals(
        request["starts_at"], request["ends_at"], request["store_id"],
        [dict(row) for row in rows],
    )
    return signature, preview, [dict(row) for row in rows]


async def _record(db: AsyncSession, request_id: int, *, lock: bool = False):
    suffix = " FOR UPDATE" if lock else ""
    row = (await db.execute(text(
        "SELECT * FROM public.overtime_reconciliations WHERE request_id=:id" + suffix
    ), {"id": request_id})).mappings().first()
    return dict(row) if row else None


async def _event(db: AsyncSession, request_id: int, user_id: int, action: str,
                 previous: dict | None, current: dict, reason: str | None):
    old = None if previous is None else {
        "status": previous["status"], "version": previous["version"],
        "source_signature": previous["source_signature"],
        "proposed_microseconds": previous["proposed_microseconds"],
        "verified_microseconds": previous["verified_microseconds"],
    }
    new = {"status": current["status"], "version": current["version"],
           "source_signature": current["source_signature"],
           "proposed_microseconds": current["proposed_microseconds"],
           "verified_microseconds": current["verified_microseconds"],
           "attendance_ids": current["attendance_ids"],
           "review_issues": current["review_issues"]}
    await db.execute(text("""INSERT INTO public.overtime_reconciliation_events
        (request_id,actor_id,action,from_status,to_status,version,reason,old_values,new_values)
        VALUES(:request,:actor,:action,:previous,:current,:version,:reason,
               CAST(:old AS jsonb),CAST(:new AS jsonb))"""), {
        "request": request_id, "actor": user_id, "action": action,
        "previous": previous["status"] if previous else None,
        "current": current["status"], "version": current["version"],
        "reason": reason, "old": json.dumps(old) if old else None,
        "new": json.dumps(new),
    })


async def _request_eligible(db: AsyncSession, request_id: int) -> bool:
    return bool((await db.execute(text(
        "SELECT public.ot_reconciliation_request_eligible(:id)"
    ), {"id": request_id})).scalar_one())


def _effective(row: dict, current_signature: str, request_eligible: bool) -> dict:
    result = dict(row)
    current = row["source_signature"] == current_signature
    effective = row["status"]
    if not current or not request_eligible:
        effective = "NEEDS_REVIEW"
    result["source_current"] = current
    result["effective_status"] = effective
    result["payable_microseconds"] = (
        row["verified_microseconds"] if effective == "VERIFIED" else 0
    )
    return result


def _attendance_evidence(request: dict, rows: list[dict],
                         visible_store_id: int | None = None) -> tuple[list[dict], int]:
    """Shape read-only attendance evidence; actual time is not a payroll decision."""
    evidence: list[dict] = []
    actual_intervals = []
    for row in rows:
        if visible_store_id is not None and row["store_id"] != visible_store_id:
            continue
        context = row["attendance_context"] or {}
        if not isinstance(context, dict):
            context = {}
        planned = context.get("planned") or {}
        if not isinstance(planned, dict):
            planned = {}
        check_out = row["check_out_time"]
        overlap_start = max(row["check_in_time"], request["starts_at"])
        overlap_end = min(check_out, request["ends_at"]) if check_out else None
        if overlap_end and overlap_end > overlap_start:
            actual_intervals.append((overlap_start, overlap_end))
        evidence.append({
            "attendance_id": row["attendance_id"], "store_id": row["store_id"],
            "check_in_time": row["check_in_time"], "check_out_time": check_out,
            "overlap_starts_at": overlap_start if overlap_end and overlap_end > overlap_start else None,
            "overlap_ends_at": overlap_end if overlap_end and overlap_end > overlap_start else None,
            "schedule_status": context.get("schedule_status"),
            "planned_starts_at": planned.get("starts_at"),
            "planned_ends_at": planned.get("ends_at"),
        })
    total = sum((end - start).days * 86_400_000_000
                + (end - start).seconds * 1_000_000
                + (end - start).microseconds
                for start, end in union_intervals(actual_intervals))
    return evidence, total


async def _response(db: AsyncSession, request: dict, row: dict | None,
                    user: dict) -> dict:
    roles = set(user.get("roles", []))
    manager_scope = (request["store_id"] if "STORE_MANAGER" in roles
                     and not roles & {"ADMIN", "HR_MANAGER"}
                     and request["employee_id"] != user.get("employee_id") else None)
    current_time = _utc_now()
    current_signature, candidate, source_rows = await _source(db, request, lock=False)
    eligible = await _request_eligible(db, request["request_id"])
    execution_status = derive_execution_status(
        request["starts_at"], request["ends_at"], source_rows, now=current_time,
    )
    current_issues = list(candidate.issues)
    if current_time < request["ends_at"]:
        # No attendance or an open checkout is expected before the approved
        # interval finishes. Preserve real snapshot/overlap issues.
        current_issues = [issue for issue in current_issues if issue not in {
            "NO_ATTENDANCE", "ATTENDANCE_CHECKOUT_MISSING",
        }]
    evidence, actual_microseconds = _attendance_evidence(request, source_rows, manager_scope)
    reconciliation_window_open = current_time >= request["ends_at"]
    if row is None:
        return {"request_id": request["request_id"], "request_status": request["status"],
                "status": "PENDING_RECONCILIATION", "effective_status": "PENDING_RECONCILIATION",
                "display_status": "PENDING_RECONCILIATION",
                "execution_status": execution_status,
                "reconciliation_window_open": reconciliation_window_open,
                "version": 0, "proposed_microseconds": 0,
                "verified_microseconds": None, "payable_microseconds": 0,
                "eligible_intervals": [], "attendance_ids": [], "review_issues": [],
                "request_eligible": eligible,
                "source_current": False, "events": [], "exception_workflow_available":
                    await _exception_schema_available(db), "exception_cases": [],
                "actual_microseconds": actual_microseconds, "attendance_sources": evidence}
    result = _effective(row, current_signature, eligible)
    result["request_status"] = request["status"]
    result["request_eligible"] = eligible
    result["execution_status"] = execution_status
    result["reconciliation_window_open"] = reconciliation_window_open
    result["review_issues"] = current_issues
    result["display_status"] = result["effective_status"]
    if (not reconciliation_window_open and result["source_current"] and eligible
            and result["effective_status"] in {"PENDING_RECONCILIATION", "NEEDS_REVIEW"}
            and not current_issues):
        result["display_status"] = "PENDING_RECONCILIATION"
    result["actual_microseconds"] = actual_microseconds
    result["attendance_sources"] = evidence
    result["events"] = [dict(event) for event in (await db.execute(text("""
        SELECT e.event_id,e.actor_id,e.action,e.from_status,e.to_status,e.version,
               e.reason,e.old_values,e.new_values,e.created_at
        FROM public.overtime_reconciliation_events e WHERE e.request_id=:id
        ORDER BY e.event_id"""), {"id": request["request_id"]})).mappings().all()]
    result["exception_workflow_available"] = await _exception_schema_available(db)
    result["exception_cases"] = await _exception_cases_for_response(db, request, user)
    if manager_scope is not None:
        result["attendance_ids"] = [item["attendance_id"] for item in evidence]
        for event in result["events"]:
            event["old_values"] = None
            event["new_values"] = {}
    return result


def _may_preview(request: dict, user: dict):
    roles = set(user.get("roles", []))
    if roles & {"ADMIN", "HR_MANAGER"}:
        return
    raise HTTPException(403, "Chỉ HR/Admin được tạo hoặc làm mới kết quả đối soát OT.")


def _may_decide(request: dict, user: dict):
    if request["employee_id"] == user.get("employee_id") or request["created_by"] == user.get("user_id"):
        raise HTTPException(403, "Không thể tự xác nhận/từ chối giờ OT của mình hoặc đơn do mình tạo.")


@router.get("")
async def list_reconciliations(status: str | None = Query(default=None),
                               date_from: date | None = Query(default=None),
                               date_to: date | None = Query(default=None),
                               store_id: int | None = Query(default=None, gt=0),
                               limit: int = Query(default=50, ge=1, le=100),
                               user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await _require_schema(db)
    roles = set(user.get("roles", []))
    params: dict = {"limit": limit}
    where = []
    if date_from and date_to and date_to < date_from:
        raise HTTPException(422, "Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.")
    if date_from:
        where.append("o.work_date>=:date_from")
        params["date_from"] = date_from
    if date_to:
        where.append("o.work_date<=:date_to")
        params["date_to"] = date_to
    if store_id is not None and roles & {"ADMIN", "HR_MANAGER"}:
        where.append("r.store_id=:selected_store")
        params["selected_store"] = store_id
    if not roles & {"ADMIN", "HR_MANAGER"}:
        if "STORE_MANAGER" in roles:
            params.update(store=user.get("store_id") or -1, employee=user.get("employee_id") or -1)
            where.append("(r.store_id=:store OR r.employee_id=:employee)")
        else:
            params["employee"] = user.get("employee_id") or -1
            where.append("r.employee_id=:employee")
    effective_sql = ("CASE WHEN statement_timestamp()<o.ends_at "
                     "AND r.source_signature=public.ot_reconciliation_source_signature(r.request_id) "
                     "AND public.ot_reconciliation_request_eligible(r.request_id) "
                     "AND r.review_issues <@ '[\"NO_ATTENDANCE\",\"ATTENDANCE_CHECKOUT_MISSING\"]'::jsonb "
                     "THEN 'PENDING_RECONCILIATION' WHEN r.source_signature="
                     "public.ot_reconciliation_source_signature(r.request_id) "
                     "AND public.ot_reconciliation_request_eligible(r.request_id) "
                     "THEN r.status ELSE 'NEEDS_REVIEW' END")
    if status:
        if status not in {"PENDING_RECONCILIATION", "NEEDS_REVIEW", "VERIFIED", "REJECTED"}:
            raise HTTPException(422, "Trạng thái đối soát không hợp lệ.")
        where.append(effective_sql + "=:status")
        params["status"] = status
    clause = " AND ".join(where) if where else "TRUE"
    rows = (await db.execute(text("""SELECT r.*,o.status AS request_status,
        o.starts_at,o.ends_at,
        CASE WHEN statement_timestamp()<o.starts_at THEN 'NOT_STARTED'
             WHEN statement_timestamp()<o.ends_at THEN 'IN_PROGRESS'
             WHEN NOT EXISTS (SELECT 1 FROM public.attendances a
                 WHERE a.employee_id=o.employee_id AND a.check_in_time IS NOT NULL
                   AND a.check_in_time<o.ends_at
                   AND (a.check_out_time IS NULL OR a.check_out_time>o.starts_at))
               OR EXISTS (SELECT 1 FROM public.attendances a
                 WHERE a.employee_id=o.employee_id AND a.check_in_time IS NOT NULL
                   AND a.check_in_time<o.ends_at
                   AND (a.check_out_time IS NULL OR a.check_out_time>o.starts_at)
                   AND a.check_out_time IS NULL)
             THEN 'ATTENDANCE_INCOMPLETE' ELSE 'ENDED' END AS execution_status,
        (statement_timestamp()>=o.ends_at) AS reconciliation_window_open,
        public.ot_reconciliation_source_signature(r.request_id) AS current_signature,
        public.ot_reconciliation_request_eligible(r.request_id) AS request_eligible,
        o.revoke_requested_at,o.revoke_decided_at,o.revoke_decision
        FROM public.overtime_reconciliations r JOIN public.overtime_requests o USING(request_id)
        WHERE """ + clause + " ORDER BY r.updated_at DESC,r.request_id DESC LIMIT :limit"),
        params)).mappings().all()
    results = []
    for row in rows:
        item = _effective(dict(row), row["current_signature"], row["request_eligible"])
        item["execution_status"] = row["execution_status"]
        item["reconciliation_window_open"] = row["reconciliation_window_open"]
        item["display_status"] = item["effective_status"]
        if (not item["reconciliation_window_open"] and item["source_current"]
                and row["request_eligible"]
                and set(item.get("review_issues") or []).issubset({
                    "NO_ATTENDANCE", "ATTENDANCE_CHECKOUT_MISSING",
                })):
            item["display_status"] = "PENDING_RECONCILIATION"
        if ("STORE_MANAGER" in roles and not roles & {"ADMIN", "HR_MANAGER"}
                and row["employee_id"] != user.get("employee_id")):
            item["attendance_ids"] = []
        results.append(item)
    return results


@router.get("/{request_id}")
async def get_reconciliation(request_id: int, user=Depends(get_current_user),
                             db: AsyncSession = Depends(get_db)):
    await _require_schema(db)
    request = await _get_request(db, request_id)
    _assert_read_scope(request, user)
    return await _response(db, request, await _record(db, request_id), user)


@router.post("/{request_id}/preview")
async def preview_reconciliation(request_id: int, user=Depends(get_current_user),
                                 db: AsyncSession = Depends(get_db)):
    await _require_schema(db)
    request = await _lock_request(db, request_id)
    _may_preview(request, user)
    if not await _request_eligible(db, request_id):
        raise HTTPException(409, "Chỉ đối soát đơn OT đã duyệt và không chờ thu hồi.")
    previous = await _record(db, request_id, lock=True)
    if (previous and await _exception_schema_available(db)
            and await _active_explanation_case(db, request_id, previous["version"], lock=True)):
        raise HTTPException(409, {
            "code": "OT_EXPLANATION_PENDING",
            "message": "Đang chờ xử lý yêu cầu giải trình. HR cần nhận phản hồi hoặc đóng hồ sơ thủ công trước khi làm mới nguồn.",
        })
    signature, candidate, source_rows = await _source(db, request, lock=True)
    current_time = _utc_now()
    execution_status = derive_execution_status(
        request["starts_at"], request["ends_at"], source_rows, now=current_time,
    )
    if current_time < request["ends_at"]:
        raise HTTPException(409, {
            "code": "OT_RECONCILIATION_NOT_READY",
            "message": "Chỉ có thể xem trước đối soát sau khi khung giờ OT kết thúc.",
            "execution_status": execution_status,
        })
    if previous and previous["source_signature"] == signature:
        return await _response(db, request, previous, user)
    status = ("NEEDS_REVIEW" if previous and previous["status"] in {"VERIFIED", "REJECTED"}
              else candidate.status)
    params = {
        "request": request_id, "employee": request["employee_id"], "store": request["store_id"],
        "status": status, "signature": signature,
        "proposed": candidate.proposed_microseconds,
        "intervals": json.dumps(candidate.eligible_intervals),
        "attendances": json.dumps(candidate.attendance_ids),
        "issues": json.dumps(candidate.issues),
    }
    if previous:
        updated = (await db.execute(text("""UPDATE public.overtime_reconciliations SET
            status=:status,version=version+1,source_signature=:signature,
            proposed_microseconds=:proposed,verified_microseconds=NULL,
            eligible_intervals=CAST(:intervals AS jsonb),attendance_ids=CAST(:attendances AS jsonb),
            review_issues=CAST(:issues AS jsonb),reviewed_by=NULL,reviewed_at=NULL,
            decision_reason=NULL,calculated_at=clock_timestamp(),updated_at=clock_timestamp()
            WHERE request_id=:request RETURNING *"""), params)).mappings().one()
    else:
        updated = (await db.execute(text("""INSERT INTO public.overtime_reconciliations
            (request_id,employee_id,store_id,status,source_signature,proposed_microseconds,
             eligible_intervals,attendance_ids,review_issues)
            VALUES(:request,:employee,:store,:status,:signature,:proposed,
                   CAST(:intervals AS jsonb),CAST(:attendances AS jsonb),CAST(:issues AS jsonb))
            RETURNING *"""), params)).mappings().one()
    current = dict(updated)
    await _event(db, request_id, user["user_id"], "REFRESH" if previous else "PREVIEW",
                 previous, current, None)
    await db.commit()
    return await _response(db, request, current, user)


async def _decide(db: AsyncSession, request_id: int, user: dict, expected_version: int,
                  decision: str, reason: str | None):
    await _require_schema(db)
    request = await _lock_request(db, request_id)
    _may_decide(request, user)
    signature, candidate, source_rows = await _source(db, request, lock=True)
    if not await _request_eligible(db, request_id):
        raise HTTPException(409, "Đơn OT không còn ở trạng thái được phép đối soát.")
    current_time = _utc_now()
    execution_status = derive_execution_status(
        request["starts_at"], request["ends_at"], source_rows, now=current_time,
    )
    if current_time < request["ends_at"]:
        raise HTTPException(409, {
            "code": "OT_RECONCILIATION_NOT_READY",
            "message": "Chưa thể xác nhận hoặc từ chối đối soát khi khung giờ OT chưa kết thúc.",
            "execution_status": execution_status,
        })
    row = await _record(db, request_id, lock=True)
    if not row:
        raise HTTPException(409, "Cần chạy xem trước đối soát trước khi xác nhận.")
    if signature != row["source_signature"]:
        raise HTTPException(409, {"code": "OT_RECONCILIATION_STALE",
                                  "message": "Dữ liệu đơn OT hoặc chấm công đã đổi. Hãy làm mới đối soát."})
    if await _exception_schema_available(db):
        explanation = await _active_explanation_case(db, request_id, row["version"], lock=True)
        if explanation and explanation["status"] == "OPEN":
            raise HTTPException(409, {
                "code": "OT_EXPLANATION_PENDING",
                "message": "Đang chờ nhân viên giải trình. HR cần nhận phản hồi hoặc đóng hồ sơ thủ công trước khi quyết định.",
            })
    if row["version"] != expected_version:
        if (row["status"] == decision and row["version"] == expected_version + 1
                and row["reviewed_by"] == user["user_id"]):
            return await _response(db, request, row, user)
        raise HTTPException(409, "Kết quả đối soát đã được xử lý bởi người khác; tải lại dữ liệu.")
    if row["status"] in {"VERIFIED", "REJECTED"}:
        raise HTTPException(409, "Quyết định đã chốt; không được ghi đè âm thầm.")
    if decision == "VERIFIED":
        if candidate.issues or candidate.proposed_microseconds <= 0:
            raise HTTPException(409, {"code": "OT_RECONCILIATION_NEEDS_REVIEW",
                                      "issues": candidate.issues,
                                      "message": "Dữ liệu chấm công chưa đủ điều kiện xác nhận giờ OT."})
        competing = (await db.execute(text("""SELECT request_id FROM public.v_overtime_verified_current
            WHERE employee_id=:employee AND request_id<>:request
              AND starts_at<:ends_at AND ends_at>:starts_at LIMIT 1"""), {
            "employee": request["employee_id"], "request": request_id,
            "starts_at": request["starts_at"], "ends_at": request["ends_at"],
        })).scalar_one_or_none()
        if competing:
            raise HTTPException(409, {"code": "OT_VERIFIED_INTERVAL_CONFLICT",
                                      "message": "Nhân viên đã có giờ OT được xác nhận trong khung giờ giao nhau."})
    clean_reason = reason.strip() if reason else None
    if decision == "REJECTED" and (not clean_reason or len(clean_reason) < 3):
        raise HTTPException(422, "Từ chối đối soát phải nêu lý do ít nhất 3 ký tự.")
    updated = (await db.execute(text("""UPDATE public.overtime_reconciliations SET
        status=:status,version=version+1,verified_microseconds=:verified,
        reviewed_by=:actor,reviewed_at=clock_timestamp(),decision_reason=:reason,
        updated_at=clock_timestamp() WHERE request_id=:request AND version=:version
        RETURNING *"""), {
            "status": decision, "verified": row["proposed_microseconds"] if decision == "VERIFIED" else None,
            "actor": user["user_id"], "reason": clean_reason, "request": request_id,
            "version": expected_version,
        })).mappings().first()
    if not updated:
        raise HTTPException(409, "Đối soát thay đổi đồng thời; tải lại trước khi xử lý.")
    current = dict(updated)
    await _event(db, request_id, user["user_id"], "VERIFY" if decision == "VERIFIED" else "REJECT",
                 row, current, clean_reason)
    if await _exception_schema_available(db):
        explanation = await _active_explanation_case(db, request_id, expected_version, lock=True)
        if explanation and explanation["status"] == "RESPONDED":
            closed = (await db.execute(text("""UPDATE public.overtime_reconciliation_cases
                SET status='CLOSED',version=version+1,resolved_by=:actor,
                    resolved_at=clock_timestamp(),resolution_reason=:reason,updated_at=clock_timestamp()
                WHERE case_id=:id AND version=:version AND status='RESPONDED' RETURNING *"""), {
                    "actor": user["user_id"], "id": explanation["case_id"],
                    "version": explanation["version"],
                    "reason": clean_reason or "Đã xử lý giải trình cùng quyết định đối soát.",
                })).mappings().one_or_none()
            if closed:
                await _case_event(db, dict(closed), user["user_id"], "EXPLANATION_CLOSED",
                                  "RESPONDED", "CLOSED", clean_reason,
                                  {"reconciliation_decision": decision})
    await db.commit()
    return await _response(db, request, current, user)


@router.post("/{request_id}/verify")
async def verify_reconciliation(request_id: int, body: ReconciliationDecision,
                                user=Depends(require_roles(["HR_MANAGER", "ADMIN"])),
                                db: AsyncSession = Depends(get_db)):
    return await _decide(db, request_id, user, body.expected_version, "VERIFIED", body.reason)


@router.post("/{request_id}/reject")
async def reject_reconciliation(request_id: int, body: ReconciliationRejection,
                                user=Depends(require_roles(["HR_MANAGER", "ADMIN"])),
                                db: AsyncSession = Depends(get_db)):
    return await _decide(db, request_id, user, body.expected_version, "REJECTED", body.reason)


@router.post("/{request_id}/reopen")
async def reopen_reconciliation(request_id: int, body: ReconciliationReopen,
                                user=Depends(require_roles(["HR_MANAGER", "ADMIN"])),
                                db: AsyncSession = Depends(get_db)):
    await _require_schema(db)
    request = await _lock_request(db, request_id)
    _may_decide(request, user)
    if not await _request_eligible(db, request_id):
        raise HTTPException(409, "Đơn OT không còn ở trạng thái được phép đối soát.")
    row = await _record(db, request_id, lock=True)
    if not row:
        raise HTTPException(404, "Không tìm thấy hồ sơ đối soát.")
    if row["status"] not in {"VERIFIED", "REJECTED"}:
        raise HTTPException(409, "Chỉ có thể hoàn tác kết quả đối soát khi đang ở trạng thái đã xác nhận (VERIFIED) hoặc đã từ chối (REJECTED).")
    if row["version"] != body.expected_version:
        raise HTTPException(409, "Phiên bản đối soát đã thay đổi; vui lòng tải lại dữ liệu trước khi hoàn tác.")

    clean_reason = body.reason.strip()
    if len(clean_reason) < 3:
        raise HTTPException(422, "Lý do hoàn tác đối soát phải có ít nhất 3 ký tự.")

    # Kiểm tra trạng thái Kỳ công / Bảng lương riêng cho nhân viên này (Payroll Lock Check)
    period = str(request["work_date"])[:7] if request.get("work_date") else (str(request["starts_at"])[:7] if request.get("starts_at") else None)
    has_payrolls = bool((await db.execute(text("SELECT to_regclass('public.payrolls') IS NOT NULL"))).scalar_one())
    if period and has_payrolls:
        payroll_locked_status = (await db.execute(text("""
            SELECT payment_status FROM public.payrolls
            WHERE salary_period = :period AND employee_id = :employee_id
              AND payment_status IN ('CONFIRMED', 'PAID', 'LOCKED', 'APPROVED')
            LIMIT 1
        """), {"period": period, "employee_id": request["employee_id"]})).scalar_one_or_none()

        if payroll_locked_status:
            raise HTTPException(409, {
                "code": "PAYROLL_PERIOD_LOCKED",
                "message": f"Kỳ công/Bảng lương tháng {period} của nhân viên này đã chốt ({payroll_locked_status}). Toàn bộ dữ liệu giờ công và OT của tháng đó bị khóa để bảo đảm tính toàn vẹn của phiếu lương và báo cáo kế toán. Mọi điều chỉnh sẽ phải chuyển sang kỳ sau dưới dạng Truy lĩnh / Truy thu.",
                "salary_period": period,
                "payment_status": payroll_locked_status,
            })

    # Hoàn tác trạng thái đối soát: Chuyển về PENDING_RECONCILIATION hoặc NEEDS_REVIEW
    signature, candidate, _ = await _source(db, request, lock=True)
    new_status = candidate.status if candidate.status in {"PENDING_RECONCILIATION", "NEEDS_REVIEW"} else "NEEDS_REVIEW"

    updated = (await db.execute(text("""UPDATE public.overtime_reconciliations SET
        status=:status,version=version+1,verified_microseconds=NULL,
        reviewed_by=NULL,reviewed_at=NULL,decision_reason=NULL,
        updated_at=clock_timestamp()
        WHERE request_id=:request AND version=:version
        RETURNING *"""), {
            "status": new_status,
            "request": request_id,
            "version": body.expected_version,
        })).mappings().one_or_none()
    if not updated:
        raise HTTPException(409, "Hồ sơ đối soát vừa thay đổi; tải lại trước khi hoàn tác.")
    current = dict(updated)

    # Ghi vết kiểm toán append-only vào overtime_reconciliation_events
    await _event(db, request_id, user["user_id"], "REOPEN", row, current, clean_reason)

    await db.commit()
    return await _response(db, request, current, user)


@router.post("/{request_id}/explanation-requests", status_code=201)
async def request_employee_explanation(request_id: int, body: ExplanationRequest,
                                       user=Depends(require_roles(["HR_MANAGER", "ADMIN"])),
                                       db: AsyncSession = Depends(get_db)):
    await _require_exception_schema(db)
    request = await _lock_request(db, request_id)
    _may_decide(request, user)
    if not await _request_eligible(db, request_id):
        raise HTTPException(409, "Đơn OT không còn đủ điều kiện xử lý đối soát.")
    row = await _record(db, request_id, lock=True)
    if not row or row["status"] not in {"PENDING_RECONCILIATION", "NEEDS_REVIEW"}:
        raise HTTPException(409, "Chỉ có thể yêu cầu giải trình trước khi đối soát được xác minh hoặc từ chối.")
    if row["version"] != body.expected_version:
        raise HTTPException(409, "Phiên bản đối soát đã thay đổi; hãy tải lại dữ liệu.")
    if _utc_now() < request["ends_at"]:
        raise HTTPException(409, "Chỉ có thể yêu cầu giải trình sau khi khung giờ OT kết thúc.")
    signature, _, _ = await _source(db, request, lock=True)
    if signature != row["source_signature"]:
        raise HTTPException(409, {"code": "OT_RECONCILIATION_STALE",
                                  "message": "Nguồn OT hoặc Attendance đã đổi; hãy làm mới đối soát trước."})
    reason = body.reason.strip()
    if len(reason) < 3:
        raise HTTPException(422, "Lý do yêu cầu giải trình phải có ít nhất 3 ký tự.")
    existing = (await db.execute(text("""SELECT * FROM public.overtime_reconciliation_cases
        WHERE request_id=:request AND reconciliation_version=:version AND case_type='EXPLANATION'"""), {
            "request": request_id, "version": row["version"],
        })).mappings().first()
    if existing:
        if existing["status"] == "OPEN" and existing["opened_by"] == user["user_id"] and existing["reason"] == reason:
            await db.commit()
            return await _case_payload(db, dict(existing))
        raise HTTPException(409, "Đã có hồ sơ giải trình cho phiên bản đối soát này.")
    case = dict((await db.execute(text("""INSERT INTO public.overtime_reconciliation_cases
        (request_id,reconciliation_version,case_type,status,opened_by,reason)
        VALUES(:request,:version,'EXPLANATION','OPEN',:actor,:reason) RETURNING *"""), {
            "request": request_id, "version": row["version"],
            "actor": user["user_id"], "reason": reason,
        })).mappings().one())
    await _case_event(db, case, user["user_id"], "EXPLANATION_REQUESTED", None, "OPEN", reason,
                      {"reconciliation_version": row["version"]})
    await db.commit()
    return await _case_payload(db, case)


@router.post("/{request_id}/explanation-cases/{case_id}/respond")
async def respond_to_explanation(request_id: int, case_id: int, body: ExplanationResponse,
                                 user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await _require_exception_schema(db)
    request = await _lock_request(db, request_id)
    _assert_read_scope(request, user)
    if request["employee_id"] != user.get("employee_id"):
        raise HTTPException(403, "Chỉ nhân viên được phân công mới có thể gửi giải trình.")
    case = await _case_record(db, request_id, case_id, lock=True)
    if not case or case["case_type"] != "EXPLANATION":
        raise HTTPException(404, "Không tìm thấy yêu cầu giải trình trong hồ sơ này.")
    response = body.response.strip()
    if len(response) < 3:
        raise HTTPException(422, "Nội dung giải trình phải có ít nhất 3 ký tự.")
    if case["status"] in {"RESPONDED", "CLOSED"} and case["responded_by"] == user["user_id"] and case["employee_response"] == response:
        await db.commit()
        return await _case_payload(db, case)
    if case["status"] != "OPEN":
        raise HTTPException(409, "Yêu cầu giải trình đã được đóng hoặc xử lý.")
    rec = await _record(db, request_id, lock=True)
    if not rec or rec["version"] != case["reconciliation_version"]:
        raise HTTPException(409, "Phiên bản đối soát đã đổi; tải lại trước khi gửi giải trình.")
    updated = (await db.execute(text("""UPDATE public.overtime_reconciliation_cases
        SET status='RESPONDED',version=version+1,employee_response=:response,
            responded_by=:actor,responded_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE case_id=:id AND version=:version AND status='OPEN' RETURNING *"""), {
            "response": response, "actor": user["user_id"],
            "id": case_id, "version": body.expected_case_version,
        })).mappings().first()
    if not updated:
        raise HTTPException(409, "Yêu cầu giải trình vừa được cập nhật; tải lại dữ liệu.")
    current = dict(updated)
    await _case_event(db, current, user["user_id"], "EXPLANATION_SUBMITTED", "OPEN", "RESPONDED",
                      response, {"employee_response": response})
    await db.commit()
    return await _case_payload(db, current)


@router.post("/{request_id}/explanation-cases/{case_id}/close")
async def close_explanation_case(request_id: int, case_id: int, body: ExceptionCaseClose,
                                 user=Depends(require_roles(["HR_MANAGER", "ADMIN"])),
                                 db: AsyncSession = Depends(get_db)):
    await _require_exception_schema(db)
    request = await _lock_request(db, request_id)
    _may_decide(request, user)
    case = await _case_record(db, request_id, case_id, lock=True)
    if not case or case["case_type"] != "EXPLANATION":
        raise HTTPException(404, "Không tìm thấy yêu cầu giải trình trong hồ sơ này.")
    if case["status"] == "CLOSED" and case["resolved_by"] == user["user_id"] and case["resolution_reason"] == body.reason.strip():
        await db.commit()
        return await _case_payload(db, case)
    if case["status"] not in {"OPEN", "RESPONDED"}:
        raise HTTPException(409, "Yêu cầu giải trình đã được xử lý.")
    reason = body.reason.strip()
    if len(reason) < 3:
        raise HTTPException(422, "Lý do đóng yêu cầu giải trình phải có ít nhất 3 ký tự.")
    updated = (await db.execute(text("""UPDATE public.overtime_reconciliation_cases
        SET status='CLOSED',version=version+1,resolved_by=:actor,resolved_at=clock_timestamp(),
            resolution_reason=:reason,updated_at=clock_timestamp()
        WHERE case_id=:id AND version=:version AND status=:status RETURNING *"""), {
            "actor": user["user_id"], "reason": reason,
            "id": case_id, "version": body.expected_case_version, "status": case["status"],
        })).mappings().first()
    if not updated:
        raise HTTPException(409, "Yêu cầu giải trình vừa được cập nhật; tải lại dữ liệu.")
    current = dict(updated)
    await _case_event(db, current, user["user_id"], "EXPLANATION_CLOSED", case["status"], "CLOSED",
                      reason)
    await db.commit()
    return await _case_payload(db, current)


@router.post("/{request_id}/review-requests", status_code=201)
async def create_review_request(request_id: int, body: ReviewRequestCreate,
                                user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await _require_exception_schema(db)
    request = await _lock_request(db, request_id)
    _assert_read_scope(request, user)
    if request["employee_id"] != user.get("employee_id"):
        raise HTTPException(403, "Chỉ nhân viên được phân công mới có thể yêu cầu xem xét lại.")
    if not await _request_eligible(db, request_id):
        raise HTTPException(409, "Đơn OT đang bị thu hồi, đã thay thế hoặc không còn hiệu lực.")
    row = await _record(db, request_id, lock=True)
    if not row or row["status"] != "REJECTED":
        raise HTTPException(409, "Chỉ có thể yêu cầu xem xét lại kết quả đối soát đã bị từ chối.")
    if row["version"] != body.expected_reconciliation_version:
        raise HTTPException(409, "Phiên bản bị từ chối đã thay đổi; tải lại dữ liệu.")
    reason = body.reason.strip()
    if len(reason) < 3:
        raise HTTPException(422, "Lý do yêu cầu xem xét phải có ít nhất 3 ký tự.")
    existing = (await db.execute(text("""SELECT * FROM public.overtime_reconciliation_cases
        WHERE request_id=:request AND reconciliation_version=:version AND case_type='REVIEW_REQUEST'"""), {
            "request": request_id, "version": row["version"],
        })).mappings().first()
    if existing:
        if existing["status"] == "OPEN" and existing["opened_by"] == user["user_id"] and existing["reason"] == reason:
            await db.commit()
            return await _case_payload(db, dict(existing))
        raise HTTPException(409, "Chỉ được gửi một yêu cầu xem xét cho mỗi phiên bản bị từ chối.")
    case = dict((await db.execute(text("""INSERT INTO public.overtime_reconciliation_cases
        (request_id,reconciliation_version,case_type,status,opened_by,reason)
        VALUES(:request,:version,'REVIEW_REQUEST','OPEN',:actor,:reason) RETURNING *"""), {
            "request": request_id, "version": row["version"],
            "actor": user["user_id"], "reason": reason,
        })).mappings().one())
    await _case_event(db, case, user["user_id"], "REVIEW_REQUESTED", None, "OPEN", reason,
                      {"reconciliation_version": row["version"]})
    await db.commit()
    return await _case_payload(db, case)


@router.post("/{request_id}/review-requests/{case_id}/decision")
async def decide_review_request(request_id: int, case_id: int, body: ReviewRequestDecision,
                                user=Depends(require_roles(["HR_MANAGER", "ADMIN"])),
                                db: AsyncSession = Depends(get_db)):
    await _require_exception_schema(db)
    request = await _lock_request(db, request_id)
    _may_decide(request, user)
    case = await _case_record(db, request_id, case_id, lock=True)
    if not case or case["case_type"] != "REVIEW_REQUEST":
        raise HTTPException(404, "Không tìm thấy yêu cầu xem xét trong hồ sơ này.")
    reason = body.reason.strip()
    if len(reason) < 3:
        raise HTTPException(422, "Lý do xử lý yêu cầu xem xét phải có ít nhất 3 ký tự.")
    row = await _record(db, request_id, lock=True)
    if case["status"] in {"ACCEPTED", "DECLINED"}:
        expected_status = "ACCEPTED" if body.decision == "ACCEPT" else "DECLINED"
        if (case["status"] == expected_status and case["resolved_by"] == user["user_id"]
                and case["resolution_reason"] == reason and row):
            await db.commit()
            return {"case": await _case_payload(db, case),
                    "reconciliation": await _response(db, request, row, user)}
        raise HTTPException(409, "Yêu cầu xem xét đã được xử lý; quyết định không thể ghi đè.")
    if case["status"] != "OPEN" or case["version"] != body.expected_case_version:
        raise HTTPException(409, "Yêu cầu xem xét đã thay đổi; tải lại dữ liệu.")
    if (not row or row["status"] != "REJECTED"
            or row["version"] != body.expected_reconciliation_version
            or case["reconciliation_version"] != body.expected_reconciliation_version):
        raise HTTPException(409, "Kết quả đối soát bị từ chối đã thay đổi; không thể mở lại phiên bản cũ.")
    if not await _request_eligible(db, request_id):
        raise HTTPException(409, "Đơn OT đang bị thu hồi, đã thay thế hoặc không còn hiệu lực.")

    if body.decision == "REJECT":
        new_case_status = "DECLINED"
        action = "REVIEW_DECLINED"
        updated_case = (await db.execute(text("""UPDATE public.overtime_reconciliation_cases
            SET status=:status,version=version+1,resolved_by=:actor,resolved_at=clock_timestamp(),
                resolution_reason=:reason,updated_at=clock_timestamp()
            WHERE case_id=:id AND version=:version AND status='OPEN' RETURNING *"""), {
                "status": new_case_status, "actor": user["user_id"], "reason": reason,
                "id": case_id, "version": case["version"],
            })).mappings().one_or_none()
        if not updated_case:
            raise HTTPException(409, "Yêu cầu xem xét vừa được xử lý; tải lại dữ liệu.")
        current_case = dict(updated_case)
        await _case_event(db, current_case, user["user_id"], action, "OPEN", new_case_status,
                          reason, {"reconciliation_version": row["version"]})
        await db.commit()
        return {"case": await _case_payload(db, current_case),
                "reconciliation": await _response(db, request, row, user)}

    signature, _, _ = await _source(db, request, lock=True)
    updated_rec = (await db.execute(text("""UPDATE public.overtime_reconciliations SET
        status='NEEDS_REVIEW',version=version+1,verified_microseconds=NULL,
        reviewed_by=NULL,reviewed_at=NULL,decision_reason=NULL,updated_at=clock_timestamp()
        WHERE request_id=:request AND version=:version AND status='REJECTED' RETURNING *"""), {
            "request": request_id, "version": body.expected_reconciliation_version,
        })).mappings().one_or_none()
    if not updated_rec:
        raise HTTPException(409, "Đối soát vừa thay đổi; tải lại trước khi mở phiên mới.")
    current_rec = dict(updated_rec)
    await _event(db, request_id, user["user_id"], "REOPEN", row, current_rec, reason)
    updated_case = (await db.execute(text("""UPDATE public.overtime_reconciliation_cases
        SET status='ACCEPTED',version=version+1,resolved_by=:actor,resolved_at=clock_timestamp(),
            resolution_reason=:reason,updated_at=clock_timestamp()
        WHERE case_id=:id AND version=:version AND status='OPEN' RETURNING *"""), {
            "actor": user["user_id"], "reason": reason,
            "id": case_id, "version": case["version"],
        })).mappings().one_or_none()
    if not updated_case:
        raise HTTPException(409, "Yêu cầu xem xét vừa được xử lý; giao dịch sẽ được hủy.")
    current_case = dict(updated_case)
    await _case_event(db, current_case, user["user_id"], "REVIEW_ACCEPTED", "OPEN", "ACCEPTED",
                      reason, {"previous_reconciliation_version": row["version"],
                               "new_reconciliation_version": current_rec["version"],
                               "source_current_at_reopen": signature == row["source_signature"]})
    await db.commit()
    return {"case": await _case_payload(db, current_case),
            "reconciliation": await _response(db, request, current_rec, user)}
