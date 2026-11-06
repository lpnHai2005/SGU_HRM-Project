"""Quy tắc trạng thái nhân viên theo ngày: dùng chung cho job đầu ngày, nút đồng bộ và duyệt đơn thai sản."""
from sqlalchemy import text

LEFT_STATUSES = {"RESIGNED", "TERMINATED"}

# Chỉ nghỉ dài hạn (thai sản) mới đổi employment_status. Phép ngắn ngày không đổi vì ON_LEAVE
# sẽ chặn phân ca, loại khỏi import lương và làm mất người duyệt (chỉ tìm người ACTIVE).
STATUS_ROWS = text("""
    SELECT e.employee_id, e.full_name, e.employment_status, e.resignation_date,
           u.user_id, u.is_active AS user_active,
           c.active_contracts, c.official_contracts, c.draft_contracts,
           closed.status AS closed_status, closed.closed_on,
           due.resignation_id, due.approved_last_working_date AS due_resignation_date,
           leave.on_long_leave, leave.long_leave_decided
    FROM employees e
    LEFT JOIN users u ON u.employee_id = e.employee_id
    CROSS JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE status = 'ACTIVE') AS active_contracts,
               COUNT(*) FILTER (WHERE status = 'ACTIVE' AND contract_type <> 'PROBATION'
                                  AND start_date <= :today) AS official_contracts,
               COUNT(*) FILTER (WHERE status = 'DRAFT') AS draft_contracts
        FROM contracts WHERE employee_id = e.employee_id
    ) c
    LEFT JOIN LATERAL (
        SELECT status, COALESCE(termination_date, end_date) AS closed_on
        FROM contracts
        WHERE employee_id = e.employee_id AND status IN ('EXPIRED', 'TERMINATED')
        ORDER BY start_date DESC LIMIT 1
    ) closed ON TRUE
    LEFT JOIN LATERAL (
        -- Đơn đã APPROVED giữ nguyên trạng thái sau khi hoàn tất, nên chỉ xét khi hợp đồng
        -- trước ngày nghỉ còn ACTIVE; nếu không người được tuyển lại sẽ bị cho nghỉ lần nữa.
        SELECT r.resignation_id, r.approved_last_working_date
        FROM resignation_requests r
        WHERE r.employee_id = e.employee_id AND r.status = 'APPROVED'
          AND r.approved_last_working_date < :today
          AND EXISTS (SELECT 1 FROM contracts rc
                      WHERE rc.employee_id = e.employee_id AND rc.status = 'ACTIVE'
                        AND rc.start_date <= r.approved_last_working_date)
        ORDER BY r.approved_last_working_date DESC LIMIT 1
    ) due ON TRUE
    CROSS JOIN LATERAL (
        SELECT COALESCE(BOOL_OR(l.status = 'HR_APPROVED' AND :today BETWEEN l.start_date AND l.end_date), FALSE) AS on_long_leave,
               COUNT(*) > 0 AS long_leave_decided
        FROM leave_requests l JOIN leave_types t USING (leave_type_id)
        WHERE l.employee_id = e.employee_id AND t.type_code = 'THAI_SAN'
          AND l.status IN ('HR_APPROVED', 'REJECTED')
    ) leave
    WHERE CAST(:employee_id AS integer) IS NULL OR e.employee_id = CAST(:employee_id AS integer)
    ORDER BY e.employee_id
""")


def plan_status(row, revive_left=False):
    """Trả về (trạng thái, ngày thôi việc, tài khoản mở, ngày chấm dứt HĐ theo đơn thôi việc)."""
    status, resignation_date = row["employment_status"], row["resignation_date"]
    user_active = row["user_active"]
    locked = None if user_active is None else False
    terminate_on = None
    working_status = "PROBATION" if row["active_contracts"] and not row["official_contracts"] else "ACTIVE"

    if status in LEFT_STATUSES:
        if not row["active_contracts"]:
            user_active = locked
        elif revive_left:
            # Chỉ HR bấm đồng bộ mới khôi phục; job tự động không được mở lại người đã nghỉ.
            status, resignation_date = working_status, None
            user_active = None if user_active is None else True
    elif row["due_resignation_date"]:
        status, user_active = "RESIGNED", locked
        resignation_date = terminate_on = row["due_resignation_date"]
    elif not row["active_contracts"] and row["closed_status"] and not row["draft_contracts"]:
        status = "TERMINATED" if row["closed_status"] == "TERMINATED" else "RESIGNED"
        resignation_date = resignation_date or row["closed_on"]
        user_active = locked
    elif row["on_long_leave"]:
        status = "ON_LEAVE"
    elif status == "ON_LEAVE":
        if row["long_leave_decided"]:  # ON_LEAVE đặt tay, không có đơn thì giữ nguyên
            status = working_status
    elif status == "PROBATION" and row["official_contracts"]:
        status = "ACTIVE"
    return status, resignation_date, user_active, terminate_on


async def apply_status_rules(db, today, actor_id=None, employee_id=None, revive_left=False):
    """Áp quy tắc rồi commit. `today` phải là ngày Việt Nam vì CURRENT_DATE của DB là UTC."""
    from app.api.deps import record_audit_log

    rows = (await db.execute(STATUS_ROWS, {"today": today, "employee_id": employee_id})).mappings().all()
    changes = []
    for row in rows:
        status, resignation_date, user_active, terminate_on = plan_status(row, revive_left)
        if (status, resignation_date, user_active) == (
            row["employment_status"], row["resignation_date"], row["user_active"]
        ):
            continue
        params = {"id": row["employee_id"]}
        await db.execute(text("""
            UPDATE employees SET employment_status = :status, resignation_date = :resignation_date,
                updated_at = CURRENT_TIMESTAMP
            WHERE employee_id = :id
        """), {**params, "status": status, "resignation_date": resignation_date})
        if user_active != row["user_active"]:
            await db.execute(text("""
                UPDATE users SET is_active = :active, updated_at = CURRENT_TIMESTAMP WHERE employee_id = :id
            """), {**params, "active": user_active})
        if terminate_on:
            await db.execute(text("""
                UPDATE contracts SET status = 'TERMINATED', termination_date = :term_date,
                    termination_reason = :reason, terminated_by = :actor, updated_at = CURRENT_TIMESTAMP
                WHERE employee_id = :id AND status IN ('ACTIVE', 'DRAFT')
            """), {**params, "term_date": terminate_on, "actor": actor_id,
                   "reason": f"Hoàn tất thủ tục thôi việc #{row['resignation_id']}"})
        changes.append((row, status, resignation_date, user_active))

    # record_audit_log tự commit, nên chỉ ghi sau khi mọi UPDATE đã chạy xong.
    for row, status, resignation_date, user_active in changes:
        await record_audit_log(
            db=db, user_id=actor_id, action="EMPLOYEE_STATUS_SYNCED", entity_name="employee",
            entity_id=str(row["employee_id"]),
            old_values={"employment_status": row["employment_status"], "user_active": row["user_active"],
                        "resignation_date": row["resignation_date"] and str(row["resignation_date"])},
            new_values={"employment_status": status, "user_active": user_active,
                        "resignation_date": resignation_date and str(resignation_date)},
        )
    await db.commit()
    return [
        {"employee_id": row["employee_id"], "name": row["full_name"],
         "old_status": row["employment_status"], "new_status": status}
        for row, status, _, _ in changes
    ]
