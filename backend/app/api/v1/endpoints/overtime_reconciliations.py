"""OT reconciliation is a separate decision from request approval and payroll."""

import json

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_roles
from app.api.v1.endpoints.overtime_requests import (
    _assert_read_scope, _get_request, _lock_request,
)
from app.core.database import get_db
from app.core.ot_reconciliation import reconcile_intervals, union_intervals


router = APIRouter()


class ReconciliationDecision(BaseModel):
    expected_version: int = Field(gt=0)
    reason: str | None = Field(default=None, max_length=1000)


class ReconciliationRejection(BaseModel):
    expected_version: int = Field(gt=0)
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
    return signature, preview


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


async def _attendance_evidence(db: AsyncSession, request: dict,
                               visible_store_id: int | None = None) -> tuple[list[dict], int]:
    """Read-only attendance evidence; actual time is not a payroll decision."""
    rows = (await db.execute(text("""SELECT a.attendance_id,a.store_id,
        a.check_in_time,a.check_out_time,a.attendance_context
        FROM public.attendances a WHERE a.employee_id=:employee
          AND a.check_in_time IS NOT NULL AND a.check_in_time<:ends_at
          AND (a.check_out_time IS NULL OR a.check_out_time>:starts_at)
        ORDER BY a.check_in_time,a.attendance_id"""), {
            "employee": request["employee_id"], "starts_at": request["starts_at"],
            "ends_at": request["ends_at"],
        })).mappings().all()
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
    evidence, actual_microseconds = await _attendance_evidence(db, request, manager_scope)
    if row is None:
        return {"request_id": request["request_id"], "request_status": request["status"],
                "status": "PENDING_RECONCILIATION", "effective_status": "PENDING_RECONCILIATION",
                "version": 0, "proposed_microseconds": 0,
                "verified_microseconds": None, "payable_microseconds": 0,
                "eligible_intervals": [], "attendance_ids": [], "review_issues": [],
                "source_current": False, "events": [],
                "actual_microseconds": actual_microseconds, "attendance_sources": evidence}
    source = (await db.execute(text("""SELECT
        public.ot_reconciliation_source_signature(:id) AS signature,
        public.ot_reconciliation_request_eligible(:id) AS eligible"""),
        {"id": request["request_id"]})).mappings().one()
    result = _effective(row, source["signature"], source["eligible"])
    result["request_status"] = request["status"]
    result["actual_microseconds"] = actual_microseconds
    result["attendance_sources"] = evidence
    result["events"] = [dict(event) for event in (await db.execute(text("""
        SELECT e.event_id,e.actor_id,e.action,e.from_status,e.to_status,e.version,
               e.reason,e.old_values,e.new_values,e.created_at
        FROM public.overtime_reconciliation_events e WHERE e.request_id=:id
        ORDER BY e.event_id"""), {"id": request["request_id"]})).mappings().all()]
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
    if ("STORE_MANAGER" in roles and request["store_id"] == user.get("store_id")
            and request["employee_id"] != user.get("employee_id")):
        return
    raise HTTPException(403, "Chỉ HR/Admin hoặc cửa hàng trưởng trong phạm vi được làm mới đối soát OT.")


def _may_decide(request: dict, user: dict):
    if request["employee_id"] == user.get("employee_id") or request["created_by"] == user.get("user_id"):
        raise HTTPException(403, "Không thể tự xác nhận/từ chối giờ OT của mình hoặc đơn do mình tạo.")


@router.get("")
async def list_reconciliations(status: str | None = Query(default=None),
                               limit: int = Query(default=50, ge=1, le=100),
                               user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await _require_schema(db)
    roles = set(user.get("roles", []))
    params: dict = {"limit": limit}
    where = []
    if not roles & {"ADMIN", "HR_MANAGER"}:
        if "STORE_MANAGER" in roles:
            params.update(store=user.get("store_id") or -1, employee=user.get("employee_id") or -1)
            where.append("(r.store_id=:store OR r.employee_id=:employee)")
        else:
            params["employee"] = user.get("employee_id") or -1
            where.append("r.employee_id=:employee")
    effective_sql = ("CASE WHEN r.source_signature="
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
        public.ot_reconciliation_source_signature(r.request_id) AS current_signature,
        public.ot_reconciliation_request_eligible(r.request_id) AS request_eligible,
        o.revoke_requested_at,o.revoke_decided_at,o.revoke_decision
        FROM public.overtime_reconciliations r JOIN public.overtime_requests o USING(request_id)
        WHERE """ + clause + " ORDER BY r.updated_at DESC,r.request_id DESC LIMIT :limit"),
        params)).mappings().all()
    results = []
    for row in rows:
        item = _effective(dict(row), row["current_signature"], row["request_eligible"])
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
    signature, candidate = await _source(db, request, lock=True)
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
    row = await _record(db, request_id, lock=True)
    if not row:
        raise HTTPException(409, "Cần chạy xem trước đối soát trước khi xác nhận.")
    signature, candidate = await _source(db, request, lock=True)
    if not await _request_eligible(db, request_id):
        raise HTTPException(409, "Đơn OT không còn ở trạng thái được phép đối soát.")
    if signature != row["source_signature"]:
        raise HTTPException(409, {"code": "OT_RECONCILIATION_STALE",
                                  "message": "Dữ liệu đơn OT hoặc chấm công đã đổi. Hãy làm mới đối soát."})
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
