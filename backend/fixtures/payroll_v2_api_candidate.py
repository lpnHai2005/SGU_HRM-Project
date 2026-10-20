"""Review-only Payroll v2 HTTP candidate. Synthetic loopback database only.

This module is deliberately not imported by the production router. It accepts
only the marked disposable database used by the local acceptance harness.
Authentication uses a test-only HMAC key supplied by that harness and reads
role/employee mapping from the database; JWT role claims are ignored.
"""
from __future__ import annotations

from datetime import date
from typing import Callable, Literal, Optional

import jwt
import psycopg
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from psycopg.types.json import Jsonb
from fastapi.responses import JSONResponse


ALLOWED_DB = "ot_ledger_synthetic_20261020"
DB_MARKER = "TECHZONE_SYNTHETIC_OT_LEDGER_20261020"
ALLOWED_ROLES = {"HR_MANAGER", "ADMIN", "DIRECTOR"}
SOURCE_TABLE_LOCKS = (
    "employees, overtime_requests, attendances, overtime_reconciliations, "
    "overtime_request_events, overtime_reconciliation_events, "
    "overtime_reconciliation_cases, overtime_reconciliation_case_events"
)


class CalculateCandidateRequest(BaseModel):
    salary_period: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    source_run_id: int = Field(gt=0)


class CandidatePeriodRequest(CalculateCandidateRequest):
    pass


class CandidatePeriodOnlyRequest(BaseModel):
    salary_period: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")


class ReopenCandidateRequest(CandidatePeriodOnlyRequest):
    reason: str = Field(min_length=5, max_length=500)


class UnconfirmCandidateRequest(BaseModel):
    reason: str = Field(min_length=5, max_length=500)


class RunRefreshRequest(BaseModel):
    pass


class RunInvalidateRequest(BaseModel):
    expected_version: int = Field(ge=1)
    reason: str = Field(min_length=5, max_length=500)
    replacement_run_id: Optional[int] = Field(default=None, gt=0)


def create_app(
    database: str,
    jwt_secret: str,
    *,
    after_source_locks: Optional[Callable[[str, str], None]] = None,
    lock_strategy: Literal["table_share", "serializable"] = "table_share",
    lifecycle_enabled: bool = False,
) -> FastAPI:
    if database != ALLOWED_DB:
        raise RuntimeError("Candidate API refuses databases outside the synthetic allowlist")
    if not jwt_secret or len(jwt_secret) < 32:
        raise RuntimeError("A fixture-only JWT secret of at least 32 characters is required")

    if lock_strategy == "serializable" and not lifecycle_enabled:
        raise RuntimeError("Serializable candidate requires lifecycle status/freshness guards")
    app = FastAPI(title="TechZone Payroll v2 API Candidate", version="0.44-local")
    app.state.database = database
    app.state.lock_strategy = lock_strategy
    app.state.lifecycle_enabled = lifecycle_enabled

    @app.exception_handler(psycopg.errors.SerializationFailure)
    async def serialization_failure_handler(_request, _exc):
        return JSONResponse(status_code=409, content={
            "detail": {"code": "PAYROLL_CONCURRENT_SOURCE_CHANGE",
                       "message": "Nguồn hoặc kỳ lương vừa được thay đổi đồng thời; tải lại và thử lại."}
        })

    def connect(*, autocommit: bool = False, serializable: bool = False):
        conn = psycopg.connect(
            host="127.0.0.1", port=5432, dbname=database, user="postgres",
            connect_timeout=3, autocommit=autocommit,
            options=("-c default_transaction_isolation=serializable" if serializable else None),
            application_name="techzone-payroll-v2-api-candidate",
        )
        identity = conn.execute(
            """SELECT current_database(), host(inet_server_addr()), inet_server_port(),
                      current_user, pg_get_userbyid(d.datdba),
                      shobj_description(d.oid, 'pg_database')
                 FROM pg_database d WHERE d.datname=current_database()"""
        ).fetchone()
        if identity != (database, "127.0.0.1", 5432, "postgres", "postgres", DB_MARKER):
            conn.close()
            raise RuntimeError("Candidate API rejected an unverified database identity")
        conn.execute("SET statement_timeout='20s'")
        conn.execute("SET lock_timeout='10s'")
        return conn

    def actor_from_header(authorization: Optional[str]) -> dict:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(401, detail={"code": "AUTH_REQUIRED", "message": "Cần Bearer token hợp lệ."})
        token = authorization[7:].strip()
        try:
            claims = jwt.decode(token, jwt_secret, algorithms=["HS256"])
        except jwt.PyJWTError:
            raise HTTPException(401, detail={"code": "TOKEN_INVALID", "message": "JWT không hợp lệ hoặc đã hết hạn."})
        username = claims.get("sub")
        if not isinstance(username, str) or not username:
            raise HTTPException(401, detail={"code": "TOKEN_SUBJECT_INVALID", "message": "JWT thiếu subject hợp lệ."})
        with connect(autocommit=True) as conn:
            row = conn.execute(
                """SELECT u.user_id, u.username, u.employee_id, u.is_active,
                          EXISTS(SELECT 1 FROM employees e WHERE e.employee_id=u.employee_id) AS employee_mapping_valid
                     FROM users u WHERE u.username=%s""",
                (username,),
            ).fetchone()
            if not row:
                raise HTTPException(401, detail={"code": "USER_NOT_FOUND", "message": "Không tìm thấy tài khoản."})
            user_id, db_username, employee_id, is_active, mapping_valid = row
            if not is_active:
                raise HTTPException(403, detail={"code": "USER_INACTIVE", "message": "Tài khoản đã bị vô hiệu hóa."})
            role_rows = conn.execute(
                """SELECT DISTINCT r.role_code
                     FROM user_roles ur JOIN roles r USING(role_id)
                    WHERE ur.user_id=%s ORDER BY r.role_code""",
                (user_id,),
            ).fetchall()
        return {
            "user_id": user_id,
            "username": db_username,
            "employee_id": employee_id if mapping_valid else None,
            "roles": {item[0] for item in role_rows},
        }

    def require_payroll_role(actor: dict) -> None:
        if not actor["roles"].intersection(ALLOWED_ROLES):
            raise HTTPException(403, detail={"code": "PAYROLL_ROLE_REQUIRED", "message": "Vai trò không được phép thao tác Payroll."})

    def require_employee_mapping(actor: dict) -> int:
        if actor["employee_id"] is None:
            raise HTTPException(
                403,
                detail={"code": "PAYROLL_ACTOR_EMPLOYEE_MAPPING_REQUIRED",
                        "message": "Tài khoản Payroll cần ánh xạ users.employee_id hợp lệ."},
            )
        return actor["employee_id"]

    def lock_actor_for_decision(conn, actor: dict) -> int:
        identity = conn.execute(
            """SELECT u.employee_id,u.is_active,
                      EXISTS(SELECT 1 FROM employees e WHERE e.employee_id=u.employee_id)
                 FROM users u WHERE u.user_id=%s FOR SHARE OF u""",
            (actor["user_id"],),
        ).fetchone()
        if not identity or not identity[1] or not identity[2] or identity[0] != actor["employee_id"]:
            raise HTTPException(403, detail={"code": "PAYROLL_ACTOR_MAPPING_CHANGED",
                                             "message": "Tài khoản bị khóa hoặc ánh xạ nhân viên đã thay đổi; tải lại phiên đăng nhập."})
        roles = {r[0] for r in conn.execute(
            """SELECT r.role_code FROM user_roles ur JOIN roles r USING(role_id)
                 WHERE ur.user_id=%s FOR SHARE OF ur,r""",
            (actor["user_id"],),
        ).fetchall()}
        if not roles.intersection(ALLOWED_ROLES):
            raise HTTPException(403, detail={"code": "PAYROLL_ROLE_REVOKED",
                                             "message": "Quyền Payroll đã thay đổi; không thể tiếp tục thao tác."})
        return identity[0]

    def period_lock(conn, period: str) -> None:
        # Match the candidate procedure's transaction-level period lock.
        conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"payroll:{period}",))

    def source_locks(conn) -> None:
        conn.execute(f"LOCK TABLE {SOURCE_TABLE_LOCKS} IN SHARE MODE")

    def begin_source_transaction(conn) -> None:
        if lock_strategy == "serializable":
            isolation = conn.execute("SHOW transaction_isolation").fetchone()[0]
            if isolation != "serializable":
                raise RuntimeError("Candidate source transaction is not SERIALIZABLE")
        else:
            source_locks(conn)

    def ensure_lifecycle(conn, run_id: int):
        if not lifecycle_enabled:
            return None
        conn.execute(
            """INSERT INTO ot9_candidate_run_lifecycle(run_id,state,version,source_fingerprint)
                 SELECT run_id,CASE WHEN status='PREPARED' THEN 'PREPARED' ELSE 'HOLD' END,
                        1,source_fingerprint
                   FROM ot9_candidate_source_runs WHERE run_id=%s
                 ON CONFLICT (run_id) DO NOTHING""",
            (run_id,),
        )
        row = conn.execute(
            """SELECT run_id,state,version,source_fingerprint,replacement_run_id
                 FROM ot9_candidate_run_lifecycle WHERE run_id=%s FOR UPDATE""",
            (run_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, detail={"code": "OT_SOURCE_RUN_NOT_FOUND", "message": "Không tìm thấy phiên nguồn OT."})
        return {"run_id": row[0], "state": row[1], "version": row[2],
                "source_fingerprint": row[3], "replacement_run_id": row[4]}

    def read_lifecycle(conn, run_id: int):
        row = conn.execute(
            """SELECT run_id,state,version,source_fingerprint,replacement_run_id
                 FROM ot9_candidate_run_lifecycle WHERE run_id=%s""", (run_id,)
        ).fetchone()
        if row:
            return {"run_id": row[0], "state": row[1], "version": row[2],
                    "source_fingerprint": row[3], "replacement_run_id": row[4]}
        source = conn.execute(
            "SELECT status,source_fingerprint FROM ot9_candidate_source_runs WHERE run_id=%s",
            (run_id,),
        ).fetchone()
        if not source:
            raise HTTPException(404, detail={"code": "OT_SOURCE_RUN_NOT_FOUND", "message": "Không tìm thấy phiên nguồn OT."})
        return {"run_id": run_id, "state": "PREPARED" if source[0] == "PREPARED" else "HOLD",
                "version": 1, "source_fingerprint": source[1], "replacement_run_id": None}

    def lifecycle_event(conn, run_id: int, version: int, actor_id: int, event_type: str,
                        from_state: str, to_state: str, expected_fingerprint: Optional[str],
                        observed_fingerprint: Optional[str], reason: Optional[str] = None,
                        replacement_run_id: Optional[int] = None) -> None:
        conn.execute(
            """INSERT INTO ot9_candidate_run_lifecycle_events(
                    run_id,version,actor_id,event_type,from_state,to_state,
                    expected_fingerprint,observed_fingerprint,reason,replacement_run_id)
                 VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (run_id, version, actor_id, event_type, from_state, to_state,
             expected_fingerprint, observed_fingerprint, reason, replacement_run_id),
        )

    def refresh_lifecycle(conn, run_id: int, actor_id: int):
        life = ensure_lifecycle(conn, run_id)
        if life["state"] not in {"PREPARED", "CONFIRMED"}:
            return life
        current = conn.execute("SELECT ot9_candidate_source_fingerprint(%s)", (run_id,)).fetchone()[0]
        if current == life["source_fingerprint"]:
            return life
        new_state = "STALE" if life["state"] == "PREPARED" else "CONFIRMED_STALE"
        updated = conn.execute(
            """UPDATE ot9_candidate_run_lifecycle
                  SET state=%s,version=version+1,checked_fingerprint=%s,updated_at=clock_timestamp()
                WHERE run_id=%s AND version=%s
                RETURNING version""",
            (new_state, current, run_id, life["version"]),
        ).fetchone()
        if updated:
            lifecycle_event(conn, run_id, updated[0], actor_id, "SOURCE_STALE",
                            life["state"], new_state, life["source_fingerprint"], current)
            return {**life, "state": new_state, "version": updated[0]}
        return ensure_lifecycle(conn, run_id)

    def verify_prepared_source(conn, period: str, run_id: int, *, for_update: bool = False) -> dict:
        lock_clause = " FOR UPDATE" if for_update else " FOR SHARE"
        row = conn.execute(
            """SELECT run_id, period_start, period_end, status, source_fingerprint, prepared_by
                 FROM ot9_candidate_source_runs WHERE run_id=%s""" + lock_clause,
            (run_id,),
        ).fetchone()
        period_start = date.fromisoformat(period + "-01")
        period_end = (date(period_start.year + (period_start.month == 12), period_start.month % 12 + 1, 1))
        if not row or row[1] != period_start or row[2] != period_end or row[3] != "PREPARED":
            raise HTTPException(409, detail={"code": "OT_SOURCE_NOT_PREPARED", "message": "Nguồn OT chưa được chuẩn bị cho đúng kỳ."})
        ready = conn.execute(
            "SELECT preliminarily_ready FROM ot9_candidate_source_gate WHERE run_id=%s", (run_id,)
        ).fetchone()
        current = conn.execute("SELECT ot9_candidate_source_fingerprint(%s)", (run_id,)).fetchone()[0]
        if not ready or not ready[0] or current != row[4]:
            raise HTTPException(409, detail={"code": "OT_SOURCE_HOLD_OR_STALE", "message": "Nguồn OT đang HOLD hoặc đã stale; kỳ lương chưa thể xử lý."})
        return {"run_id": row[0], "source_fingerprint": row[4], "prepared_by": row[5]}

    def write_audit(conn, actor: dict, action: str, entity: str, entity_id: str, old: dict, new: dict) -> None:
        conn.execute(
            """INSERT INTO audit_logs(user_id,action,entity_name,entity_id,old_values,new_values)
                 VALUES(%s,%s,%s,%s,%s,%s)""",
            (actor["user_id"], action, entity, entity_id, Jsonb(old), Jsonb(new)),
        )

    def candidate_calculate(body: CalculateCandidateRequest, authorization: Optional[str] = Header(None)):
        actor = actor_from_header(authorization)
        require_payroll_role(actor)
        actor_employee_id = require_employee_mapping(actor)
        with connect(serializable=(lock_strategy == "serializable")) as conn:
            period_lock(conn, body.salary_period)
            begin_source_transaction(conn)
            actor_employee_id = lock_actor_for_decision(conn, actor)
            source = verify_prepared_source(conn, body.salary_period, body.source_run_id, for_update=True)
            if lifecycle_enabled:
                life = ensure_lifecycle(conn, body.source_run_id)
                if life["state"] != "PREPARED":
                    raise HTTPException(409, detail={"code": "OT_SOURCE_RUN_LIFECYCLE_BLOCKED",
                                                     "message": "Phiên nguồn không còn ở trạng thái PREPARED."})
            scope = {r[0] for r in conn.execute(
                "SELECT employee_id FROM ot9_candidate_run_employees WHERE run_id=%s", (body.source_run_id,)
            ).fetchall()}
            rows = conn.execute(
                """SELECT payroll_id,employee_id,payment_status,created_by,payroll_ot_candidate_run_id
                     FROM payrolls WHERE salary_period=%s ORDER BY payroll_id FOR UPDATE""",
                (body.salary_period,),
            ).fetchall()
            if rows:
                if (all(r[2] == "DRAFT" and r[4] == body.source_run_id for r in rows)
                        and {r[1] for r in rows} == scope):
                    return {"status": "UNCHANGED", "salary_period": body.salary_period,
                            "source_run_id": body.source_run_id,
                            "payroll_ids": [r[0] for r in rows],
                            "actor": {"user_id": actor["user_id"], "employee_id": actor_employee_id}}
                raise HTTPException(409, detail={"code": "PAYROLL_PERIOD_HAS_NONCANDIDATE_ROWS",
                                                 "message": "Kỳ đã có phiếu khác nguồn hoặc đã chốt; không ghi đè."})
            try:
                conn.execute(
                    "CALL sp_generate_monthly_payroll_verified_locked_candidate(%s,%s,%s)",
                    (body.salary_period, actor_employee_id, body.source_run_id),
                )
            except psycopg.Error as exc:
                marker = str(exc).split("\n", 1)[0]
                if "OT_PAYROLL_SOURCE_HOLD" in marker or "OT_SOURCE_HOLD" in marker:
                    raise HTTPException(409, detail={"code": "OT_SOURCE_HOLD_OR_STALE", "message": "Nguồn OT đang HOLD hoặc đã stale."})
                raise HTTPException(409, detail={"code": "PAYROLL_CANDIDATE_REJECTED", "message": "Procedure candidate từ chối tính kỳ này."})
            rows = conn.execute(
                """SELECT payroll_id,employee_id,payment_status,created_by,payroll_ot_candidate_run_id
                     FROM payrolls WHERE salary_period=%s ORDER BY payroll_id FOR UPDATE""",
                (body.salary_period,),
            ).fetchall()
            if not rows or {r[1] for r in rows} != scope or any(
                r[2] != "DRAFT" or r[3] != actor_employee_id or r[4] != body.source_run_id for r in rows
            ):
                raise HTTPException(409, detail={"code": "PAYROLL_CANDIDATE_SCOPE_MISMATCH",
                                                 "message": "Tập phiếu không khớp run, actor mapping hoặc employee scope."})
            # Recheck inside the same serializable snapshot, or while table locks are held
            # in baseline mode. Writers are never silently accepted from a different view.
            current = conn.execute("SELECT ot9_candidate_source_fingerprint(%s)", (body.source_run_id,)).fetchone()[0]
            if current != source["source_fingerprint"]:
                raise HTTPException(409, detail={"code": "OT_SOURCE_HOLD_OR_STALE", "message": "Nguồn OT thay đổi trong lúc tính."})
            ids = [r[0] for r in rows]
            write_audit(conn, actor, "PAYROLL_V2_CANDIDATE_CALCULATE", "payroll_periods",
                        body.salary_period, {}, {"source_run_id": body.source_run_id, "payroll_ids": ids})
            return {"status": "CALCULATED", "salary_period": body.salary_period,
                    "source_run_id": body.source_run_id, "payroll_ids": ids,
                    "actor": {"user_id": actor["user_id"], "employee_id": actor_employee_id}}

    def candidate_confirm(body: CandidatePeriodRequest, authorization: Optional[str] = Header(None)):
        actor = actor_from_header(authorization)
        require_payroll_role(actor)
        actor_employee_id = require_employee_mapping(actor)
        response = None
        with connect(serializable=(lock_strategy == "serializable")) as conn:
            period_lock(conn, body.salary_period)
            begin_source_transaction(conn)
            actor_employee_id = lock_actor_for_decision(conn, actor)
            source = verify_prepared_source(conn, body.salary_period, body.source_run_id)
            if after_source_locks:
                after_source_locks("confirm", body.salary_period)
            life = ensure_lifecycle(conn, body.source_run_id) if lifecycle_enabled else None
            if life and life["state"] != "PREPARED":
                raise HTTPException(409, detail={"code": "OT_SOURCE_RUN_LIFECYCLE_BLOCKED",
                                                 "message": "Phiên nguồn đã stale hoặc đã được quyết định."})
            scope = {r[0] for r in conn.execute(
                "SELECT employee_id FROM ot9_candidate_run_employees WHERE run_id=%s", (body.source_run_id,)
            ).fetchall()}
            rows = conn.execute(
                """SELECT payroll_id,employee_id,payment_status,created_by,payroll_ot_candidate_run_id,
                          approved_by,payment_date
                     FROM payrolls WHERE salary_period=%s ORDER BY payroll_id FOR UPDATE""",
                (body.salary_period,),
            ).fetchall()
            if not rows or {r[1] for r in rows} != scope:
                raise HTTPException(409, detail={"code": "PAYROLL_PERIOD_INCOMPLETE", "message": "Tập phiếu chưa khớp employee scope đã chụp."})
            if any(r[2] != "DRAFT" or r[4] != body.source_run_id for r in rows):
                raise HTTPException(409, detail={"code": "PAYROLL_NOT_DRAFT", "message": "Chỉ có thể xác nhận đúng bộ phiếu DRAFT của run."})
            if any(r[1] == actor_employee_id or r[3] == actor_employee_id for r in rows):
                raise HTTPException(403, detail={"code": "PAYROLL_SELF_APPROVAL_FORBIDDEN", "message": "Người xác nhận không được là người tạo hoặc người hưởng phiếu trong kỳ."})
            if conn.execute(
                "SELECT 1 FROM ot9_candidate_employee_decisions WHERE run_id=%s AND decided_by=%s LIMIT 1",
                (body.source_run_id, actor["user_id"]),
            ).fetchone():
                raise HTTPException(403, detail={"code": "PAYROLL_SOURCE_SELF_APPROVAL_FORBIDDEN", "message": "Người xác nhận kỳ phải độc lập với người chứng nhận nguồn OT."})
            if not source["source_fingerprint"]:
                raise HTTPException(409, detail={"code": "OT_SOURCE_HOLD_OR_STALE", "message": "Thiếu chữ ký nguồn OT."})
            ids = [r[0] for r in rows]
            conn.execute(
                """UPDATE payrolls SET payment_status='CONFIRMED',approved_by=%s,updated_at=clock_timestamp()
                     WHERE salary_period=%s AND payment_status='DRAFT' AND payroll_ot_candidate_run_id=%s""",
                (actor_employee_id, body.salary_period, body.source_run_id),
            )
            snapshots = conn.execute(
                "SELECT count(*) FROM payroll_finalization_snapshots WHERE payroll_id=ANY(%s) AND finalized_status='CONFIRMED'",
                (ids,),
            ).fetchone()[0]
            if snapshots != len(ids):
                raise HTTPException(409, detail={"code": "PAYROLL_SNAPSHOT_MISSING", "message": "Không tạo đủ snapshot bất biến; giao dịch bị hủy."})
            if lifecycle_enabled:
                changed = conn.execute(
                    """UPDATE ot9_candidate_run_lifecycle
                          SET state='CONFIRMED',version=version+1,updated_at=clock_timestamp()
                        WHERE run_id=%s AND state='PREPARED' AND version=%s
                        RETURNING version""",
                    (body.source_run_id, life["version"]),
                ).fetchone()
                if not changed:
                    raise HTTPException(409, detail={"code": "OT_SOURCE_RUN_VERSION_CONFLICT",
                                                     "message": "Phiên nguồn vừa được thay đổi; tải lại trạng thái."})
                lifecycle_event(conn, body.source_run_id, changed[0], actor["user_id"], "CONFIRM",
                                "PREPARED", "CONFIRMED", source["source_fingerprint"],
                                source["source_fingerprint"])
            write_audit(conn, actor, "PAYROLL_V2_CANDIDATE_CONFIRM", "payroll_periods", body.salary_period,
                        {"payment_status": "DRAFT", "count": len(ids)},
                        {"payment_status": "CONFIRMED", "payroll_ids": ids,
                         "source_run_id": body.source_run_id,
                         "source_fingerprint": source["source_fingerprint"]})
            response = {"status": "CONFIRMED", "salary_period": body.salary_period,
                        "confirmed_count": len(ids), "payroll_ids": ids,
                        "actor": {"user_id": actor["user_id"], "employee_id": actor_employee_id}}
        if lifecycle_enabled:
            # A SERIALIZABLE transaction can validly commit before a concurrent source
            # writer in the serialization order. Recheck from a fresh transaction so
            # an already-stale finalized snapshot is flagged before this API responds.
            with connect() as conn:
                life = refresh_lifecycle(conn, body.source_run_id, actor["user_id"])
                response["source_state"] = life["state"]
                response["payment_hold"] = life["state"] == "CONFIRMED_STALE"
        return response

    def candidate_pay(body: CandidatePeriodOnlyRequest, authorization: Optional[str] = Header(None)):
        actor = actor_from_header(authorization)
        require_payroll_role(actor)
        require_employee_mapping(actor)
        stale_source = False
        with connect(autocommit=not lifecycle_enabled) as conn:
            rows = conn.execute(
                "SELECT DISTINCT payment_status,payroll_ot_candidate_run_id FROM payrolls WHERE salary_period=%s",
                (body.salary_period,),
            ).fetchall()
            statuses = {r[0] for r in rows}
            if lifecycle_enabled:
                for _, run_id in rows:
                    if run_id is not None:
                        life = refresh_lifecycle(conn, run_id, actor["user_id"])
                        stale_source |= life["state"] in {"STALE", "CONFIRMED_STALE", "INVALIDATED", "REPLACED"}
        if stale_source:
            raise HTTPException(409, detail={"code": "PAYROLL_CONFIRMED_SOURCE_STALE_HOLD",
                                             "message": "Nguồn OT đã thay đổi sau khi tính/chốt; snapshot được giữ nguyên và thanh toán bị HOLD."})
        code = "PAYROLL_PAID_IMMUTABLE" if "PAID" in statuses else "PAYROLL_NEW_PAID_DISABLED"
        message = "Phiếu PAID lịch sử được bảo toàn; candidate không tạo hoặc thay đổi trạng thái PAID." \
            if code == "PAYROLL_PAID_IMMUTABLE" else "Candidate Payroll chỉ cho phép DRAFT → CONFIRMED; không tạo PAID mới."
        raise HTTPException(409, detail={"code": code, "message": message})

    def candidate_reopen(body: ReopenCandidateRequest, authorization: Optional[str] = Header(None)):
        actor = actor_from_header(authorization)
        require_payroll_role(actor)
        require_employee_mapping(actor)
        with connect(autocommit=True) as conn:
            statuses = {r[0] for r in conn.execute(
                "SELECT DISTINCT payment_status FROM payrolls WHERE salary_period=%s", (body.salary_period,)
            ).fetchall()}
        if "PAID" in statuses:
            raise HTTPException(409, detail={"code": "PAYROLL_PAID_IMMUTABLE", "message": "Kỳ có phiếu PAID; không thể mở lại hoặc xóa payment_date."})
        raise HTTPException(409, detail={"code": "PAYROLL_REOPEN_LIFECYCLE_NOT_APPROVED",
                                         "message": "Candidate chưa có vòng đời invalidate/replacement run được owner phê duyệt."})

    def candidate_unconfirm(payroll_id: int, body: UnconfirmCandidateRequest, authorization: Optional[str] = Header(None)):
        actor = actor_from_header(authorization)
        require_payroll_role(actor)
        require_employee_mapping(actor)
        with connect(autocommit=True) as conn:
            row = conn.execute("SELECT payment_status FROM payrolls WHERE payroll_id=%s", (payroll_id,)).fetchone()
        if not row:
            raise HTTPException(404, detail={"code": "PAYROLL_NOT_FOUND", "message": "Không tìm thấy phiếu lương."})
        if row[0] == "PAID":
            raise HTTPException(409, detail={"code": "PAYROLL_PAID_IMMUTABLE", "message": "Phiếu PAID bất biến; chỉ adjustment có audit riêng mới được xem xét."})
        raise HTTPException(409, detail={"code": "PAYROLL_CONFIRMED_IMMUTABLE", "message": "Candidate không hạ CONFIRMED về DRAFT hoặc xóa snapshot."})

    def health():
        with connect(autocommit=True) as conn:
            identity = conn.execute("SELECT current_database(),host(inet_server_addr()),inet_server_port() ").fetchone()
        return {"status": "local_candidate", "database": identity[0], "host": identity[1], "port": identity[2]}

    def candidate_run_status(run_id: int, authorization: Optional[str] = Header(None)):
        actor = actor_from_header(authorization)
        require_payroll_role(actor)
        require_employee_mapping(actor)
        with connect(autocommit=True) as conn:
            life = read_lifecycle(conn, run_id)
            current = conn.execute("SELECT ot9_candidate_source_fingerprint(%s)", (run_id,)).fetchone()[0]
            effective = life["state"]
            if effective == "PREPARED" and current != life["source_fingerprint"]:
                effective = "STALE"
            elif effective == "CONFIRMED" and current != life["source_fingerprint"]:
                effective = "CONFIRMED_STALE"
            return {"run_id": run_id, "state": life["state"], "effective_state": effective,
                    "version": life["version"], "source_current": current == life["source_fingerprint"],
                    "replacement_run_id": life["replacement_run_id"]}

    def candidate_refresh_run(run_id: int, body: RunRefreshRequest,
                              authorization: Optional[str] = Header(None)):
        actor = actor_from_header(authorization)
        require_payroll_role(actor)
        require_employee_mapping(actor)
        with connect() as conn:
            life = refresh_lifecycle(conn, run_id, actor["user_id"])
            return {"run_id": run_id, "state": life["state"], "version": life["version"]}

    def candidate_invalidate_run(run_id: int, body: RunInvalidateRequest,
                                  authorization: Optional[str] = Header(None)):
        actor = actor_from_header(authorization)
        require_payroll_role(actor)
        require_employee_mapping(actor)
        with connect() as conn:
            life = ensure_lifecycle(conn, run_id)
            if life["version"] != body.expected_version:
                raise HTTPException(409, detail={"code": "OT_SOURCE_RUN_VERSION_CONFLICT",
                                                 "message": "Phiên nguồn đã đổi; tải lại trước khi thử lại."})
            if life["state"] == "PREPARED":
                current = conn.execute("SELECT ot9_candidate_source_fingerprint(%s)", (run_id,)).fetchone()[0]
                if current != life["source_fingerprint"]:
                    changed = conn.execute(
                        """UPDATE ot9_candidate_run_lifecycle
                              SET state='STALE',version=version+1,checked_fingerprint=%s,updated_at=clock_timestamp()
                            WHERE run_id=%s AND version=%s RETURNING version""",
                        (current, run_id, life["version"]),
                    ).fetchone()
                    if changed:
                        lifecycle_event(conn, run_id, changed[0], actor["user_id"], "SOURCE_STALE",
                                        "PREPARED", "STALE", life["source_fingerprint"], current)
                    return {"run_id": run_id, "state": "STALE", "version": changed[0] if changed else life["version"]}
            if life["state"] != "STALE":
                raise HTTPException(409, detail={"code": "OT_SOURCE_RUN_NOT_INVALIDATABLE",
                                                 "message": "Chỉ phiên STALE chưa tạo phiếu Payroll mới được vô hiệu hóa."})
            run = conn.execute(
                "SELECT period_start,period_end,status FROM ot9_candidate_source_runs WHERE run_id=%s FOR UPDATE",
                (run_id,),
            ).fetchone()
            if not run or run[2] != "PREPARED":
                raise HTTPException(409, detail={"code": "OT_SOURCE_RUN_NOT_PREPARED",
                                                 "message": "Phiên nguồn không còn PREPARED."})
            payroll_rows = conn.execute(
                "SELECT count(*) FROM payrolls WHERE payroll_ot_candidate_run_id=%s", (run_id,)
            ).fetchone()[0]
            if payroll_rows:
                raise HTTPException(409, detail={"code": "OT_SOURCE_RUN_HAS_PAYROLL_ROWS",
                                                 "message": "Đã có phiếu Payroll gắn với phiên này; không xóa hoặc thay thế tự động."})
            replacement_id = body.replacement_run_id
            if replacement_id is not None:
                replacement = conn.execute(
                    "SELECT period_start,period_end,status FROM ot9_candidate_source_runs WHERE run_id=%s FOR UPDATE",
                    (replacement_id,),
                ).fetchone()
                if not replacement or replacement[:2] != run[:2] or replacement[2] != "HOLD":
                    raise HTTPException(409, detail={"code": "OT_REPLACEMENT_RUN_INVALID",
                                                     "message": "Run thay thế phải là HOLD cùng kỳ; không thay đổi reservation."})
            next_state = "REPLACED" if replacement_id is not None else "INVALIDATED"
            changed = conn.execute(
                """UPDATE ot9_candidate_run_lifecycle
                      SET state=%s,version=version+1,replacement_run_id=%s,updated_at=clock_timestamp()
                    WHERE run_id=%s AND version=%s RETURNING version""",
                (next_state, replacement_id, run_id, life["version"]),
            ).fetchone()
            if not changed:
                raise HTTPException(409, detail={"code": "OT_SOURCE_RUN_VERSION_CONFLICT",
                                                 "message": "Phiên nguồn vừa được thay đổi."})
            conn.execute("SELECT set_config('ot9.allow_prepared_run_invalidation',%s,true)", (str(run_id),))
            conn.execute(
                """UPDATE ot9_candidate_source_runs
                      SET status='HOLD',source_fingerprint=NULL,source_watermark=NULL,
                          prepared_by=NULL,prepared_at=NULL
                    WHERE run_id=%s AND status='PREPARED'""",
                (run_id,),
            )
            conn.execute("DELETE FROM ot9_candidate_period_reservations WHERE run_id=%s", (run_id,))
            lifecycle_event(conn, run_id, changed[0], actor["user_id"],
                            "REPLACE" if next_state == "REPLACED" else "INVALIDATE",
                            life["state"], next_state, life["source_fingerprint"],
                            conn.execute("SELECT ot9_candidate_source_fingerprint(%s)", (run_id,)).fetchone()[0],
                            body.reason, replacement_id)
            return {"run_id": run_id, "state": next_state, "version": changed[0],
                    "replacement_run_id": replacement_id, "released_period_reservation": True}

    app.add_api_route("/api/v1/payroll-v2-candidate/health", health, methods=["GET"], include_in_schema=False)
    if lifecycle_enabled:
        app.add_api_route("/api/v1/payroll-v2-candidate/runs/{run_id}/status", candidate_run_status, methods=["GET"])
        app.add_api_route("/api/v1/payroll-v2-candidate/runs/{run_id}/refresh", candidate_refresh_run, methods=["POST"])
        app.add_api_route("/api/v1/payroll-v2-candidate/runs/{run_id}/invalidate", candidate_invalidate_run, methods=["POST"])
    for alias in ("payrolls", "payroll"):
        base = f"/api/v1/{alias}/candidate"
        app.add_api_route(base + "/calculate", candidate_calculate, methods=["POST"], name=f"{alias}_candidate_calculate")
        app.add_api_route(base + "/confirm-all", candidate_confirm, methods=["POST"], name=f"{alias}_candidate_confirm")
        app.add_api_route(base + "/pay-all", candidate_pay, methods=["POST"], name=f"{alias}_candidate_pay")
        app.add_api_route(base + "/reopen-period", candidate_reopen, methods=["POST"], name=f"{alias}_candidate_reopen")
        app.add_api_route(base + "/{payroll_id}/unconfirm", candidate_unconfirm, methods=["POST"], name=f"{alias}_candidate_unconfirm")
    return app
