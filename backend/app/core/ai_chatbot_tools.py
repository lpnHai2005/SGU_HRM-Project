"""
TechZone HRM - AI Chatbot Tools Engine
Cung cấp 26 tools chuyên sâu với cơ chế RBAC Scope Checking và HITL Action Proposal.
Tuyệt đối bảo vệ dữ liệu: Nhân viên chỉ xem dữ liệu cá nhân; CHT chỉ xem chi nhánh phụ trách.
"""

from datetime import date, datetime
from typing import Dict, Any, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text


# ===================================================================================
# RBAC SCOPE HELPERS
# ===================================================================================

def check_permission(current_user: dict, allowed_roles: List[str]) -> bool:
    user_roles = current_user.get("roles", [])
    if "ADMIN" in user_roles:
        return True
    return any(r in user_roles for r in allowed_roles)


def is_hr_or_admin(current_user: dict) -> bool:
    return check_permission(current_user, ["ADMIN", "HR_MANAGER", "DIRECTOR"])


def is_store_manager(current_user: dict) -> bool:
    return "STORE_MANAGER" in current_user.get("roles", [])


def is_accountant(current_user: dict) -> bool:
    return check_permission(current_user, ["ADMIN", "ACCOUNTANT", "HR_MANAGER"])


# ===================================================================================
# 1. PROFILE & EMPLOYEE TOOLS (4 tools)
# ===================================================================================

async def get_my_profile(args: Dict[str, Any], current_user: dict, db: AsyncSession) -> Dict[str, Any]:
    emp_id = current_user.get("employee_id")
    if not emp_id:
        return {"error": "Tài khoản chưa được liên kết với hồ sơ nhân viên."}

    query = text("""
        SELECT e.employee_id, e.employee_code, e.full_name, e.gender, e.dob,
               e.phone, e.company_email, e.personal_email, e.permanent_address, e.current_address,
               s.store_name, d.department_name, pos.position_name, e.join_date, e.employment_status,
               e.bank_account_number, e.bank_name, e.tax_code, e.insurance_code
        FROM employees e
        LEFT JOIN stores s ON e.store_id = s.store_id
        LEFT JOIN departments d ON e.department_id = d.department_id
        LEFT JOIN positions pos ON e.position_id = pos.position_id
        WHERE e.employee_id = :emp_id
    """)
    res = await db.execute(query, {"emp_id": emp_id})
    row = res.mappings().first()
    return dict(row) if row else {"error": "Không tìm thấy hồ sơ nhân viên."}


async def get_employee_profile(args: Dict[str, Any], current_user: dict, db: AsyncSession) -> Dict[str, Any]:
    emp_ident = args.get("employee_id") or args.get("employee_code")
    if not emp_ident:
        return {"error": "Vui lòng cung cấp mã nhân viên (employee_code) hoặc ID nhân viên."}

    # Fetch employee
    query = text("""
        SELECT e.employee_id, e.employee_code, e.full_name, e.gender, e.dob,
               e.phone, e.company_email, s.store_id, s.store_name, d.department_name, pos.position_name,
               e.join_date, e.employment_status
        FROM employees e
        LEFT JOIN stores s ON e.store_id = s.store_id
        LEFT JOIN departments d ON e.department_id = d.department_id
        LEFT JOIN positions pos ON e.position_id = pos.position_id
        WHERE e.employee_id::text = :ident OR LOWER(e.employee_code) = LOWER(:ident)
    """)
    res = await db.execute(query, {"ident": str(emp_ident).strip()})
    row = res.mappings().first()
    if not row:
        return {"error": f"Không tìm thấy nhân viên với mã/ID '{emp_ident}'."}

    # RBAC check
    if not is_hr_or_admin(current_user):
        if is_store_manager(current_user):
            if row["store_id"] != current_user.get("store_id"):
                return {"error": "Truy cập bị từ chối: Cửa hàng trưởng chỉ được xem thông tin nhân sự thuộc cửa hàng phụ trách."}
        elif row["employee_id"] != current_user.get("employee_id"):
            return {"error": "Truy cập bị từ chối: Bạn chỉ có quyền xem thông tin hồ sơ của chính mình."}

    return dict(row)


async def search_employees(args: Dict[str, Any], current_user: dict, db: AsyncSession) -> Dict[str, Any]:
    keyword = args.get("keyword", "").strip()
    store_id = args.get("store_id")

    if not is_hr_or_admin(current_user):
        if is_store_manager(current_user):
            store_id = current_user.get("store_id")  # Scope lock
        else:
            return {"error": "Truy cập bị từ chối: Nhân viên thông thường không có quyền tìm kiếm danh sách nhân sự."}

    where = ["1=1"]
    params: Dict[str, Any] = {}

    if keyword:
        where.append("(LOWER(e.full_name) LIKE :kw OR LOWER(e.employee_code) LIKE :kw OR e.phone LIKE :kw)")
        params["kw"] = f"%{keyword.lower()}%"
    if store_id:
        where.append("e.store_id = :store_id")
        params["store_id"] = int(store_id)

    query = text(f"""
        SELECT e.employee_id, e.employee_code, e.full_name, s.store_name, pos.position_name, e.employment_status
        FROM employees e
        LEFT JOIN stores s ON e.store_id = s.store_id
        LEFT JOIN positions pos ON e.position_id = pos.position_id
        WHERE {' AND '.join(where)}
        ORDER BY e.employee_id ASC
        LIMIT 20
    """)
    res = await db.execute(query, params)
    rows = [dict(r) for r in res.mappings().all()]
    return {"total": len(rows), "employees": rows}


async def get_employee_contract(args: Dict[str, Any], current_user: dict, db: AsyncSession) -> Dict[str, Any]:
    emp_ident = args.get("employee_id") or args.get("employee_code") or current_user.get("employee_id")
    query = text("""
        SELECT c.contract_id, c.contract_number, c.contract_type, c.start_date, c.end_date,
               c.basic_salary, c.insurance_salary, c.working_hours_per_week, c.status,
               e.employee_id, e.employee_code, e.full_name, e.store_id
        FROM contracts c
        JOIN employees e ON c.employee_id = e.employee_id
        WHERE (e.employee_id::text = :ident OR LOWER(e.employee_code) = LOWER(:ident))
        ORDER BY c.created_at DESC
        LIMIT 1
    """)
    res = await db.execute(query, {"ident": str(emp_ident).strip()})
    row = res.mappings().first()
    if not row:
        return {"error": "Không tìm thấy hợp đồng lao động."}

    # RBAC check
    if not is_hr_or_admin(current_user):
        if is_store_manager(current_user):
            if row["store_id"] != current_user.get("store_id"):
                return {"error": "Truy cập bị từ chối: Cửa hàng trưởng chỉ được xem hợp đồng nhân sự chi nhánh mình."}
        elif row["employee_id"] != current_user.get("employee_id"):
            return {"error": "Truy cập bị từ chối: Bạn chỉ có thể xem hợp đồng của chính mình."}

    return dict(row)


# ===================================================================================
# 2. ATTENDANCE & SCHEDULE TOOLS (4 tools)
# ===================================================================================

async def get_my_attendance(args: Dict[str, Any], current_user: dict, db: AsyncSession) -> Dict[str, Any]:
    emp_id = current_user.get("employee_id")
    if not emp_id:
        return {"error": "Tài khoản chưa được liên kết với hồ sơ nhân viên."}

    today = date.today()
    month = int(args.get("month", today.month))
    year = int(args.get("year", today.year))

    query = text("""
        SELECT a.work_date, ws.shift_name, a.check_in_time, a.check_out_time,
               a.late_minutes, a.early_minutes, a.overtime_hours, a.actual_work_hours, a.status
        FROM attendances a
        LEFT JOIN work_shifts ws ON a.shift_id = ws.shift_id
        WHERE a.employee_id = :emp_id
          AND EXTRACT(MONTH FROM a.work_date) = :m
          AND EXTRACT(YEAR FROM a.work_date) = :y
        ORDER BY a.work_date DESC
    """)
    res = await db.execute(query, {"emp_id": emp_id, "m": month, "y": year})
    records = [dict(r) for r in res.mappings().all()]

    total_late = sum(r.get("late_minutes") or 0 for r in records)
    total_ot = sum(float(r.get("overtime_hours") or 0) for r in records)
    total_work_hours = sum(float(r.get("actual_work_hours") or 0) for r in records)

    return {
        "employee_name": current_user.get("full_name"),
        "month": month,
        "year": year,
        "total_days_worked": len(records),
        "total_late_minutes": total_late,
        "total_overtime_hours": round(total_ot, 2),
        "total_actual_work_hours": round(total_work_hours, 2),
        "recent_records": records[:10]
    }


async def get_employee_attendance(args: Dict[str, Any], current_user: dict, db: AsyncSession) -> Dict[str, Any]:
    emp_ident = args.get("employee_id") or args.get("employee_code")
    if not emp_ident:
        return {"error": "Vui lòng cung cấp mã hoặc ID nhân viên."}

    # Verify target & RBAC
    emp_res = await db.execute(text("SELECT employee_id, full_name, store_id FROM employees WHERE employee_id::text = :ident OR LOWER(employee_code) = LOWER(:ident)"), {"ident": str(emp_ident).strip()})
    emp = emp_res.mappings().first()
    if not emp:
        return {"error": "Không tìm thấy nhân viên."}

    if not is_hr_or_admin(current_user):
        if is_store_manager(current_user):
            if emp["store_id"] != current_user.get("store_id"):
                return {"error": "Truy cập bị từ chối: Không được xem chấm công nhân sự chi nhánh khác."}
        elif emp["employee_id"] != current_user.get("employee_id"):
            return {"error": "Truy cập bị từ chối."}

    today = date.today()
    month = int(args.get("month", today.month))
    year = int(args.get("year", today.year))

    query = text("""
        SELECT a.work_date, ws.shift_name, a.check_in_time, a.check_out_time,
               a.late_minutes, a.early_minutes, a.overtime_hours, a.actual_work_hours, a.status
        FROM attendances a
        LEFT JOIN work_shifts ws ON a.shift_id = ws.shift_id
        WHERE a.employee_id = :emp_id
          AND EXTRACT(MONTH FROM a.work_date) = :m
          AND EXTRACT(YEAR FROM a.work_date) = :y
        ORDER BY a.work_date DESC
    """)
    res = await db.execute(query, {"emp_id": emp["employee_id"], "m": month, "y": year})
    records = [dict(r) for r in res.mappings().all()]
    return {
        "employee_name": emp["full_name"],
        "month": month,
        "year": year,
        "total_days_worked": len(records),
        "records": records[:15]
    }


async def get_my_work_schedule(args: Dict[str, Any], current_user: dict, db: AsyncSession) -> Dict[str, Any]:
    emp_id = current_user.get("employee_id")
    if not emp_id:
        return {"error": "Tài khoản chưa được liên kết với hồ sơ nhân viên."}

    query = text("""
        SELECT ws.work_date, sh.shift_name, sh.start_time, sh.end_time, s.store_name, ws.notes
        FROM work_schedules ws
        JOIN work_shifts sh ON ws.shift_id = sh.shift_id
        LEFT JOIN stores s ON ws.store_id = s.store_id
        WHERE ws.employee_id = :emp_id AND ws.cancelled_at IS NULL
          AND ws.work_date >= CURRENT_DATE - INTERVAL '1 day'
        ORDER BY ws.work_date ASC
        LIMIT 14
    """)
    res = await db.execute(query, {"emp_id": emp_id})
    return {"schedules": [dict(r) for r in res.mappings().all()]}


async def get_employee_work_schedule(args: Dict[str, Any], current_user: dict, db: AsyncSession) -> Dict[str, Any]:
    emp_ident = args.get("employee_id") or args.get("employee_code")
    emp_res = await db.execute(text("SELECT employee_id, full_name, store_id FROM employees WHERE employee_id::text = :ident OR LOWER(employee_code) = LOWER(:ident)"), {"ident": str(emp_ident).strip()})
    emp = emp_res.mappings().first()
    if not emp:
        return {"error": "Không tìm thấy nhân viên."}

    if not is_hr_or_admin(current_user):
        if is_store_manager(current_user):
            if emp["store_id"] != current_user.get("store_id"):
                return {"error": "Truy cập bị từ chối."}
        elif emp["employee_id"] != current_user.get("employee_id"):
            return {"error": "Truy cập bị từ chối."}

    query = text("""
        SELECT ws.work_date, sh.shift_name, sh.start_time, sh.end_time, s.store_name, ws.notes
        FROM work_schedules ws
        JOIN work_shifts sh ON ws.shift_id = sh.shift_id
        LEFT JOIN stores s ON ws.store_id = s.store_id
        WHERE ws.employee_id = :emp_id AND ws.cancelled_at IS NULL
          AND ws.work_date >= CURRENT_DATE - INTERVAL '1 day'
        ORDER BY ws.work_date ASC
        LIMIT 14
    """)
    res = await db.execute(query, {"emp_id": emp["employee_id"]})
    return {"employee_name": emp["full_name"], "schedules": [dict(r) for r in res.mappings().all()]}


# ===================================================================================
# 3. LEAVE & HITL TOOLS (6 tools)
# ===================================================================================

async def get_my_leave_balance(args: Dict[str, Any], current_user: dict, db: AsyncSession) -> Dict[str, Any]:
    emp_id = current_user.get("employee_id")
    if not emp_id:
        return {"error": "Tài khoản chưa được liên kết với hồ sơ nhân viên."}

    emp_res = await db.execute(text("SELECT join_date FROM employees WHERE employee_id = :id"), {"id": emp_id})
    emp = emp_res.mappings().first()
    join_date = emp["join_date"] if emp else None

    seniority_bonus = 0
    if join_date:
        years = (date.today() - join_date).days / 365.25
        seniority_bonus = int(years // 5)

    base_annual_leave = 12 + seniority_bonus

    # Count used annual leaves in current year
    current_year = date.today().year
    used_res = await db.execute(text("""
        SELECT COALESCE(SUM(total_days), 0) as used
        FROM leave_requests
        WHERE employee_id = :id AND leave_type_id = 1 AND status = 'HR_APPROVED'
          AND EXTRACT(YEAR FROM start_date) = :year
    """), {"id": emp_id, "year": current_year})
    used_days = float(used_res.scalar() or 0)

    pending_res = await db.execute(text("""
        SELECT COALESCE(SUM(total_days), 0) as pending
        FROM leave_requests
        WHERE employee_id = :id AND leave_type_id = 1 AND status IN ('PENDING', 'STORE_APPROVED')
          AND EXTRACT(YEAR FROM start_date) = :year
    """), {"id": emp_id, "year": current_year})
    pending_days = float(pending_res.scalar() or 0)

    return {
        "annual_leave_total": base_annual_leave,
        "seniority_bonus_days": seniority_bonus,
        "annual_leave_used": used_days,
        "annual_leave_pending": pending_days,
        "annual_leave_remaining": max(0.0, base_annual_leave - used_days)
    }


async def get_my_leave_requests(args: Dict[str, Any], current_user: dict, db: AsyncSession) -> Dict[str, Any]:
    emp_id = current_user.get("employee_id")
    status_filter = args.get("status")

    where = ["lr.employee_id = :emp_id"]
    params: Dict[str, Any] = {"emp_id": emp_id}
    if status_filter:
        where.append("lr.status = :st")
        params["st"] = status_filter

    query = text(f"""
        SELECT lr.request_id, lt.type_name, lt.type_code, lr.start_date, lr.end_date, lr.total_days,
               lr.reason, lr.attachment_url, lr.status, lr.created_at, lr.rejection_reason
        FROM leave_requests lr
        JOIN leave_types lt ON lr.leave_type_id = lt.leave_type_id
        WHERE {' AND '.join(where)}
        ORDER BY lr.created_at DESC
        LIMIT 10
    """)
    res = await db.execute(query, params)
    return {"requests": [dict(r) for r in res.mappings().all()]}


async def get_leave_request_detail(args: Dict[str, Any], current_user: dict, db: AsyncSession) -> Dict[str, Any]:
    req_id = args.get("request_id")
    if not req_id:
        return {"error": "Vui lòng cung cấp mã đơn (request_id)."}

    query = text("""
        SELECT lr.request_id, lr.employee_id, e.full_name, e.store_id, lt.type_name, lt.type_code,
               lr.start_date, lr.end_date, lr.total_days, lr.reason, lr.attachment_url, lr.status,
               lr.rejection_reason, lr.created_at, lr.store_approved_at, lr.hr_approved_at
        FROM leave_requests lr
        JOIN employees e ON lr.employee_id = e.employee_id
        JOIN leave_types lt ON lr.leave_type_id = lt.leave_type_id
        WHERE lr.request_id = :req_id
    """)
    res = await db.execute(query, {"req_id": int(req_id)})
    row = res.mappings().first()
    if not row:
        return {"error": f"Không tìm thấy đơn nghỉ phép #{req_id}."}

    # RBAC check
    if not is_hr_or_admin(current_user):
        if is_store_manager(current_user):
            if row["store_id"] != current_user.get("store_id") and row["employee_id"] != current_user.get("employee_id"):
                return {"error": "Truy cập bị từ chối."}
        elif row["employee_id"] != current_user.get("employee_id"):
            return {"error": "Truy cập bị từ chối."}

    return dict(row)


async def create_leave_request(args: Dict[str, Any], current_user: dict, db: AsyncSession) -> Dict[str, Any]:
    """
    HITL Tool: KHÔNG ghi trực tiếp vào CSDL!
    Xác thực toàn diện các ràng buộc (trạng thái nhân viên, số dư, trùng lịch, hạn mức, minh chứng)
    và trả về Action Proposal để user xác nhận trên UI.
    """
    emp_id = current_user.get("employee_id")
    if not emp_id:
        return {"error": "Tài khoản chưa được liên kết với hồ sơ nhân viên để tạo đơn."}

    # 1. Kiểm tra trạng thái làm việc của nhân viên
    emp_res = await db.execute(text("SELECT employee_id, full_name, store_id, employment_status FROM employees WHERE employee_id = :id"), {"id": emp_id})
    emp_row = emp_res.mappings().first()
    if not emp_row:
        return {"error": "Không tìm thấy hồ sơ nhân viên trong hệ thống."}
    if emp_row.get("employment_status") in ["RESIGNED", "TERMINATED"]:
        return {"error": f"Nhân viên {emp_row['full_name']} đã thôi việc/nghỉ việc, không thể tạo đơn nghỉ phép."}

    leave_type_code = str(args.get("leave_type_code", "PHEP_NAM")).upper().strip()
    start_date_str = args.get("start_date")
    end_date_str = args.get("end_date")
    reason = args.get("reason", "").strip()

    if not start_date_str or not end_date_str:
        return {"error": "Vui lòng cung cấp ngày bắt đầu (start_date) và kết thúc (end_date) định dạng YYYY-MM-DD."}

    try:
        start_d = datetime.strptime(start_date_str, "%Y-%m-%d").date()
        end_d = datetime.strptime(end_date_str, "%Y-%m-%d").date()
    except Exception:
        return {"error": "Định dạng ngày không hợp lệ. Vui lòng nhập định dạng YYYY-MM-DD."}

    if start_d > end_d:
        return {"error": "Ngày bắt đầu nghỉ không được lớn hơn ngày kết thúc."}

    # Không cho tạo đơn ngày trong quá khứ
    today = date.today()
    if start_d < today:
        return {
            "error": f"Không thể tạo đơn nghỉ phép cho ngày trong quá khứ (trước ngày {today.strftime('%d/%m/%Y')}). Vui lòng chọn ngày bắt đầu từ hôm nay trở đi."
        }

    # Tính số ngày nghỉ (ước lượng sơ bộ, tính cả ngày bắt đầu và kết thúc)
    total_days = float((end_d - start_d).days + 1)
    if total_days <= 0:
        return {"error": "Số ngày xin nghỉ phải lớn hơn 0."}

    # 2. Kiểm tra trùng lặp thời gian với các đơn đã nộp (PENDING, STORE_APPROVED, HR_APPROVED)
    overlap_res = await db.execute(text("""
        SELECT request_id, start_date, end_date, status
        FROM leave_requests
        WHERE employee_id = :emp_id
          AND status IN ('PENDING', 'STORE_APPROVED', 'HR_APPROVED')
          AND start_date <= :end_date AND end_date >= :start_date
        LIMIT 1
    """), {
        "emp_id": emp_id,
        "start_date": start_d,
        "end_date": end_d
    })
    overlap = overlap_res.mappings().first()
    if overlap:
        s_str = overlap['start_date'].strftime('%d/%m/%Y') if hasattr(overlap['start_date'], 'strftime') else str(overlap['start_date'])
        e_str = overlap['end_date'].strftime('%d/%m/%Y') if hasattr(overlap['end_date'], 'strftime') else str(overlap['end_date'])
        return {
            "error": f"Bạn đã có đơn nghỉ phép (Mã #{overlap['request_id']}) trong khoảng thời gian {s_str} đến {e_str} đang chờ duyệt hoặc đã được phê duyệt. Hệ thống không cho phép tạo đơn trùng lịch."
        }

    # 3. Check leave type
    type_res = await db.execute(text("SELECT leave_type_id, type_code, type_name, max_days_allowed, requires_attachment FROM leave_types WHERE type_code = :tc"), {"tc": leave_type_code})
    lt = type_res.mappings().first()
    if not lt:
        return {"error": f"Loại phép '{leave_type_code}' không hợp lệ. Các loại hỗ trợ: PHEP_NAM, NGHI_OM, THAI_SAN, VIEC_RIENG, KHONG_LUONG, THOI_VIEC."}

    # 4. Kiểm tra số dư phép khả dụng nếu là PHEP_NAM hoặc hạn mức tối đa của loại phép
    available_limit = None
    if leave_type_code == "PHEP_NAM":
        bal = await get_my_leave_balance({}, current_user, db)
        rem = bal.get("annual_leave_remaining", 0)
        pend = bal.get("annual_leave_pending", 0)
        avail = max(0.0, rem - pend)
        available_limit = avail
        if total_days > avail:
            return {
                "error": f"Số ngày nghỉ yêu cầu ({total_days} ngày) vượt quá số ngày phép năm còn lại khả dụng của bạn ({avail} ngày; đã dùng: {bal.get('annual_leave_used', 0)} ngày, đang chờ duyệt: {pend} ngày). Vui lòng điều chỉnh lại thời gian hoặc chọn loại nghỉ không lương (KHONG_LUONG)."
            }
    else:
        max_days = lt.get("max_days_allowed")
        if max_days and float(max_days) > 0:
            available_limit = float(max_days)
            if total_days > float(max_days):
                return {
                    "error": f"Loại nghỉ '{lt['type_name']}' chỉ được nghỉ tối đa {max_days} ngày theo quy định. Bạn đang đăng ký {total_days} ngày. Vui lòng điều chỉnh lại thời gian."
                }

    requires_att = bool(lt["requires_attachment"])
    hint = "Loại đơn này bắt buộc đính kèm minh chứng hợp lệ (tệp giấy xác nhận khám chữa bệnh / viện phí / đơn thôi việc hoặc liên kết minh chứng)." if requires_att else None
    display_reason = reason if reason else "Đăng ký qua Trợ lý AI Chatbot"

    start_fmt = start_d.strftime("%d/%m/%Y")
    end_fmt = end_d.strftime("%d/%m/%Y")

    return {
        "status": "PROPOSED",
        "action_proposal": {
            "action_type": "create_leave_request",
            "title": f"Tạo đơn {lt['type_name']}",
            "description": f"Xác nhận nộp đơn {lt['type_name']} từ ngày {start_fmt} đến {end_fmt} ({total_days} ngày) với lý do: '{display_reason}'.",
            "requires_attachment": requires_att,
            "attachment_hint": hint,
            "payload": {
                "employee_id": emp_id,
                "leave_type_id": lt["leave_type_id"],
                "leave_type_code": lt["type_code"],
                "leave_type_name": lt["type_name"],
                "start_date": start_date_str,
                "end_date": end_date_str,
                "total_days": total_days,
                "available_days": available_limit,
                "reason": display_reason,
                "requires_attachment": requires_att
            }
        }
    }


async def cancel_leave_request(args: Dict[str, Any], current_user: dict, db: AsyncSession) -> Dict[str, Any]:
    """
    HITL Tool: Đề xuất hủy đơn nghỉ phép của chính mình khi đơn còn ở PENDING / STORE_APPROVED.
    Hỗ trợ:
    1. Hủy theo request_id cụ thể (e.g. #70) hoặc danh sách request_ids
    2. Hủy tất cả đơn đang chờ duyệt (cancel_all=True)
    3. Tự động đề xuất hủy nếu nhân viên chỉ có đúng 1 đơn đang chờ duyệt
    4. Liệt kê danh sách đơn chờ duyệt nếu nhân viên có nhiều đơn và chưa chỉ rõ mã
    """
    emp_id = current_user.get("employee_id")
    if not emp_id:
        return {"error": "Tài khoản chưa được liên kết với hồ sơ nhân viên."}

    req_id = args.get("request_id")
    req_ids = args.get("request_ids") or []
    cancel_all = bool(args.get("cancel_all", False))

    # Truy vấn danh sách các đơn đang ở trạng thái PENDING hoặc STORE_APPROVED của nhân viên
    q_pending = text("""
        SELECT lr.request_id, lr.start_date, lr.end_date, lr.total_days, lt.type_name, lr.status, lr.created_at
        FROM leave_requests lr
        JOIN leave_types lt ON lr.leave_type_id = lt.leave_type_id
        WHERE lr.employee_id = :emp_id AND lr.status IN ('PENDING', 'STORE_APPROVED')
        ORDER BY lr.created_at DESC
    """)
    res_pending = await db.execute(q_pending, {"emp_id": emp_id})
    pending_rows = [dict(r) for r in res_pending.mappings().all()]

    # Trường hợp 1: Hủy danh sách cụ thể nhiều ID (request_ids)
    if req_ids and len(req_ids) > 1:
        target_rows = [r for r in pending_rows if r["request_id"] in req_ids]
        if not target_rows:
            return {"error": f"Không tìm thấy các đơn ({', '.join(f'#{i}' for i in req_ids)}) đang chờ duyệt để hủy."}
        id_tags = ", ".join(f"#{r['request_id']}" for r in target_rows)
        return {
            "status": "PROPOSED",
            "action_proposal": {
                "action_type": "cancel_leave_request",
                "title": f"Hủy {len(target_rows)} đơn nghỉ phép ({id_tags})",
                "description": f"Bạn có chắc chắn muốn hủy {len(target_rows)} đơn nghỉ phép đang chờ duyệt ({id_tags}) không?",
                "requires_attachment": False,
                "payload": {
                    "cancel_all": False,
                    "request_ids": [r["request_id"] for r in target_rows],
                    "reason": args.get("reason", "Nhân viên yêu cầu hủy đơn qua AI Chatbot")
                }
            }
        }

    # Trường hợp 2: Hủy tất cả đơn đang chờ duyệt (cancel_all=True)
    if cancel_all:
        if not pending_rows:
            return {"error": "Bạn hiện không có đơn nghỉ phép nào đang ở trạng thái chờ duyệt (PENDING/STORE_APPROVED) để hủy."}

        target_ids = [r["request_id"] for r in pending_rows]
        id_tags = ", ".join(f"#{rid}" for rid in target_ids)
        return {
            "status": "PROPOSED",
            "action_proposal": {
                "action_type": "cancel_leave_request",
                "title": f"Hủy tất cả ({len(pending_rows)}) đơn nghỉ phép đang chờ duyệt",
                "description": f"Bạn có chắc chắn muốn hủy toàn bộ {len(pending_rows)} đơn nghỉ phép đang chờ duyệt ({id_tags}) không?",
                "requires_attachment": False,
                "payload": {
                    "cancel_all": True,
                    "request_ids": target_ids,
                    "reason": args.get("reason", "Nhân viên yêu cầu hủy toàn bộ đơn chờ duyệt qua AI Chatbot")
                }
            }
        }

    # Trường hợp 3: Có chỉ định request_id cụ thể (hoặc req_ids có 1 phần tử)
    single_target_id = req_id or (req_ids[0] if req_ids else None)
    if single_target_id:
        res = await db.execute(
            text("""
                SELECT lr.request_id, lr.employee_id, lr.status, lr.start_date, lr.end_date, lr.total_days, lt.type_name
                FROM leave_requests lr
                JOIN leave_types lt ON lr.leave_type_id = lt.leave_type_id
                WHERE lr.request_id = :id
            """),
            {"id": int(single_target_id)}
        )
        row = res.mappings().first()
        if not row:
            return {"error": f"Không tìm thấy đơn nghỉ phép #{single_target_id} trong hệ thống."}

        if row["employee_id"] != emp_id and not is_hr_or_admin(current_user):
            return {"error": "Truy cập bị từ chối: Bạn chỉ có thể hủy đơn nghỉ phép của chính mình."}

        if row["status"] in ["CANCELLED", "REJECTED"]:
            return {"error": f"Đơn #{single_target_id} đã ở trạng thái {row['status']}, không thể hủy tiếp."}

        if row["status"] == "HR_APPROVED":
            return {"error": f"Đơn #{single_target_id} đã được HR phê duyệt chính thức. Để hủy đơn này, vui lòng liên hệ trực tiếp phòng Nhân sự."}

        s_str = row['start_date'].strftime('%d/%m/%Y') if hasattr(row['start_date'], 'strftime') else str(row['start_date'])
        e_str = row['end_date'].strftime('%d/%m/%Y') if hasattr(row['end_date'], 'strftime') else str(row['end_date'])

        return {
            "status": "PROPOSED",
            "action_proposal": {
                "action_type": "cancel_leave_request",
                "title": f"Hủy đơn nghỉ phép #{row['request_id']}",
                "description": f"Bạn có chắc chắn muốn hủy đơn {row['type_name']} #{row['request_id']} (từ ngày {s_str} đến {e_str}, {row['total_days']} ngày) không?",
                "requires_attachment": False,
                "payload": {
                    "request_id": row["request_id"],
                    "reason": args.get("reason", "Nhân viên tự hủy qua AI Chatbot")
                }
            }
        }

    # Trường hợp 4: Không truyền ID
    if not pending_rows:
        return {"error": "Bạn hiện không có đơn nghỉ phép nào đang ở trạng thái chờ duyệt (PENDING/STORE_APPROVED) để hủy."}

    # Nếu chỉ có đúng 1 đơn đang chờ duyệt -> tự động đề xuất hủy đơn đó
    if len(pending_rows) == 1:
        single = pending_rows[0]
        s_str = single['start_date'].strftime('%d/%m/%Y') if hasattr(single['start_date'], 'strftime') else str(single['start_date'])
        e_str = single['end_date'].strftime('%d/%m/%Y') if hasattr(single['end_date'], 'strftime') else str(single['end_date'])
        return {
            "status": "PROPOSED",
            "action_proposal": {
                "action_type": "cancel_leave_request",
                "title": f"Hủy đơn nghỉ phép #{single['request_id']}",
                "description": f"Bạn có chắc chắn muốn hủy đơn {single['type_name']} #{single['request_id']} (từ ngày {s_str} đến {e_str}, {single['total_days']} ngày) không?",
                "requires_attachment": False,
                "payload": {
                    "request_id": single["request_id"],
                    "reason": args.get("reason", "Nhân viên tự hủy qua AI Chatbot")
                }
            }
        }

    # Nếu có nhiều hơn 1 đơn đang chờ duyệt -> trả về dữ liệu danh sách để AI trình bày rõ ràng
    lines = [f"Bạn hiện có **{len(pending_rows)} đơn nghỉ phép** đang chờ duyệt:"]
    for r in pending_rows:
        s_str = r['start_date'].strftime('%d/%m/%Y') if hasattr(r['start_date'], 'strftime') else str(r['start_date'])
        e_str = r['end_date'].strftime('%d/%m/%Y') if hasattr(r['end_date'], 'strftime') else str(r['end_date'])
        lines.append(f"• **Đơn #{r['request_id']}**: {r['type_name']} (từ {s_str} đến {e_str}, {r['total_days']} ngày)")
    lines.append(f"\n👉 Bạn muốn hủy đơn cụ thể nào (ví dụ: *'Hủy đơn #{pending_rows[0]['request_id']}'*) hay muốn hủy tất cả (*'Hủy tất cả đơn chờ duyệt'*?)")

    return {
        "status": "MULTIPLE_PENDING",
        "message": "\n".join(lines),
        "pending_count": len(pending_rows)
    }


async def get_pending_leave_requests(args: Dict[str, Any], current_user: dict, db: AsyncSession) -> Dict[str, Any]:
    if not (is_hr_or_admin(current_user) or is_store_manager(current_user)):
        return {"error": "Truy cập bị từ chối: Chỉ Quản lý chi nhánh hoặc HR mới có thẩm quyền xem danh sách đơn chờ duyệt."}

    where = []
    params: Dict[str, Any] = {}

    if is_store_manager(current_user) and not is_hr_or_admin(current_user):
        where.append("lr.status = 'PENDING' AND e.store_id = :store_id")
        params["store_id"] = current_user.get("store_id")
    else:
        status_filter = args.get("status", "ALL_PENDING")
        if status_filter == "PENDING":
            where.append("lr.status = 'PENDING'")
        elif status_filter == "STORE_APPROVED":
            where.append("lr.status = 'STORE_APPROVED'")
        else:
            where.append("lr.status IN ('PENDING', 'STORE_APPROVED')")

    query = text(f"""
        SELECT lr.request_id, e.employee_code, e.full_name, s.store_name, lt.type_name,
               lr.start_date, lr.end_date, lr.total_days, lr.status, lr.reason, lr.created_at
        FROM leave_requests lr
        JOIN employees e ON lr.employee_id = e.employee_id
        LEFT JOIN stores s ON e.store_id = s.store_id
        JOIN leave_types lt ON lr.leave_type_id = lt.leave_type_id
        WHERE {' AND '.join(where)}
        ORDER BY lr.created_at ASC
    """)
    res = await db.execute(query, params)
    rows = [dict(r) for r in res.mappings().all()]
    return {"total_pending": len(rows), "requests": rows}


# ===================================================================================
# 4. PAYROLL & COMPENSATION TOOLS (4 tools) - NO SALES COMMISSION!
# ===================================================================================

async def get_my_payroll(args: Dict[str, Any], current_user: dict, db: AsyncSession) -> Dict[str, Any]:
    emp_id = current_user.get("employee_id")
    if not emp_id:
        return {"error": "Tài khoản chưa được liên kết với nhân viên."}

    period = args.get("salary_period")
    if not period:
        # Lấy kỳ lương gần nhất
        p_res = await db.execute(text("SELECT salary_period FROM payrolls WHERE employee_id = :id ORDER BY salary_period DESC LIMIT 1"), {"id": emp_id})
        period = p_res.scalar()
        if not period:
            return {"error": "Chưa có bảng lương nào được phát hành cho bạn."}

    query = text("""
        SELECT p.payroll_id, p.salary_period, p.standard_working_days, p.actual_working_days,
               p.contract_salary, p.total_allowances, p.total_bonuses, p.total_insurance,
               p.total_deductions, p.gross_income, p.net_salary, p.payment_status
        FROM payrolls p
        WHERE p.employee_id = :id AND p.salary_period = :period
    """)
    res = await db.execute(query, {"id": emp_id, "period": period})
    p_row = res.mappings().first()
    if not p_row:
        return {"error": f"Không tìm thấy bảng lương kỳ {period} của bạn."}

    # Chi tiết khoản phụ cấp dự án và phụ cấp khác
    details_res = await db.execute(text("""
        SELECT item_code, item_name, item_type, amount, notes
        FROM payroll_details
        WHERE payroll_id = :pid
    """), {"pid": p_row["payroll_id"]})
    details = [dict(d) for d in details_res.mappings().all()]

    return {
        "summary": dict(p_row),
        "details": details,
        "note": "Thu nhập biến đổi tại TechZone căn cứ theo Phụ cấp phân bổ từ các Dự án tham gia (không áp dụng hoa hồng bán hàng cá nhân)."
    }


async def get_my_payroll_history(args: Dict[str, Any], current_user: dict, db: AsyncSession) -> Dict[str, Any]:
    emp_id = current_user.get("employee_id")
    if not emp_id:
        return {"error": "Tài khoản chưa được liên kết với nhân viên."}

    limit = int(args.get("limit", 6))
    query = text("""
        SELECT salary_period, contract_salary, total_allowances, gross_income, net_salary, payment_status
        FROM payrolls
        WHERE employee_id = :id
        ORDER BY salary_period DESC
        LIMIT :lim
    """)
    res = await db.execute(query, {"id": emp_id, "lim": limit})
    return {"history": [dict(r) for r in res.mappings().all()]}


async def get_employee_payroll(args: Dict[str, Any], current_user: dict, db: AsyncSession) -> Dict[str, Any]:
    if not is_accountant(current_user):
        return {"error": "Truy cập bị từ chối: Chỉ Kế toán, HR Manager hoặc Ban Giám đốc mới có quyền tra cứu bảng lương nhân sự khác."}

    emp_ident = args.get("employee_id") or args.get("employee_code")
    period = args.get("salary_period")
    if not emp_ident or not period:
        return {"error": "Vui lòng cung cấp mã nhân viên và kỳ lương (salary_period, ví dụ: 2026-03)."}

    emp_res = await db.execute(text("SELECT employee_id, full_name, employee_code FROM employees WHERE employee_id::text = :id OR LOWER(employee_code) = LOWER(:id)"), {"id": str(emp_ident).strip()})
    emp = emp_res.mappings().first()
    if not emp:
        return {"error": "Không tìm thấy nhân viên."}

    query = text("""
        SELECT p.payroll_id, p.salary_period, p.contract_salary, p.total_allowances,
               p.gross_income, p.net_salary, p.payment_status
        FROM payrolls p
        WHERE p.employee_id = :id AND p.salary_period = :period
    """)
    res = await db.execute(query, {"id": emp["employee_id"], "period": period})
    row = res.mappings().first()
    if not row:
        return {"error": f"Không tìm thấy bảng lương kỳ {period} của nhân viên {emp['full_name']}."}

    return {"employee": dict(emp), "payroll": dict(row)}


async def get_payroll_period(args: Dict[str, Any], current_user: dict, db: AsyncSession) -> Dict[str, Any]:
    if not is_accountant(current_user):
        return {"error": "Truy cập bị từ chối: Chỉ Kế toán, HR Manager hoặc Admin mới có quyền xem tổng hợp kỳ lương."}

    period = args.get("salary_period")
    if not period:
        return {"error": "Vui lòng chỉ định kỳ lương (ví dụ: 2026-03)."}

    query = text("""
        SELECT COUNT(*) as total_employees,
               SUM(gross_income) as total_gross,
               SUM(net_salary) as total_net,
               SUM(total_allowances) as total_project_allowances,
               COUNT(*) FILTER (WHERE payment_status = 'PAID') as paid_count
        FROM payrolls
        WHERE salary_period = :p
    """)
    res = await db.execute(query, {"p": period})
    row = res.mappings().first()
    return {"salary_period": period, "statistics": dict(row) if row else {}}


# ===================================================================================
# 5. PROJECT MANAGEMENT TOOLS (2 tools) - Core Replacement for Commissions
# ===================================================================================

async def get_my_projects(args: Dict[str, Any], current_user: dict, db: AsyncSession) -> Dict[str, Any]:
    emp_id = current_user.get("employee_id")
    if not emp_id:
        return {"error": "Tài khoản chưa được liên kết với nhân viên."}

    query = text("""
        SELECT p.project_id, p.project_code, p.project_name, p.status as project_status,
               pm.project_role, pr.role_name,
               COALESCE(NULLIF(pm.project_allowance, 0), pra.allowance_amount, 0) as monthly_allowance,
               pm.joined_date, pm.is_active
        FROM project_members pm
        JOIN projects p ON pm.project_id = p.project_id
        LEFT JOIN project_roles pr ON pm.project_role = pr.role_code
        LEFT JOIN project_role_allowances pra ON pm.project_role = pra.role_code AND pra.is_active = TRUE
        WHERE pm.employee_id = :id AND pm.is_active = TRUE
        ORDER BY p.start_date DESC
    """)
    res = await db.execute(query, {"id": emp_id})
    projects = [dict(r) for r in res.mappings().all()]
    total_allowance = sum(float(p.get("monthly_allowance") or 0) for p in projects)

    return {
        "employee_name": current_user.get("full_name"),
        "total_active_projects": len(projects),
        "total_monthly_project_allowance": total_allowance,
        "projects": projects
    }


async def get_project_detail(args: Dict[str, Any], current_user: dict, db: AsyncSession) -> Dict[str, Any]:
    proj_ident = args.get("project_id") or args.get("project_code")
    if not proj_ident:
        return {"error": "Vui lòng cung cấp mã hoặc ID dự án."}

    p_res = await db.execute(text("""
        SELECT project_id, project_code, project_name, start_date, end_date, budget, status, description
        FROM projects
        WHERE project_id::text = :ident OR LOWER(project_code) = LOWER(:ident)
    """), {"ident": str(proj_ident).strip()})
    project = p_res.mappings().first()
    if not project:
        return {"error": f"Không tìm thấy dự án '{proj_ident}'."}

    # Fetch members
    m_res = await db.execute(text("""
        SELECT e.employee_code, e.full_name, pm.project_role, pr.role_name,
               COALESCE(NULLIF(pm.project_allowance, 0), pra.allowance_amount, 0) as allowance,
               pm.joined_date, pm.is_active
        FROM project_members pm
        JOIN employees e ON pm.employee_id = e.employee_id
        LEFT JOIN project_roles pr ON pm.project_role = pr.role_code
        LEFT JOIN project_role_allowances pra ON pm.project_role = pra.role_code AND pra.is_active = TRUE
        WHERE pm.project_id = :pid
    """), {"pid": project["project_id"]})
    members = [dict(m) for m in m_res.mappings().all()]

    return {
        "project": dict(project),
        "total_members": len(members),
        "members": members
    }


# ===================================================================================
# 6. STORE & BRANCH TOOLS (3 tools)
# ===================================================================================

async def get_store_info(args: Dict[str, Any], current_user: dict, db: AsyncSession) -> Dict[str, Any]:
    store_id = args.get("store_id") or current_user.get("store_id")
    if not store_id:
        return {"error": "Vui lòng chỉ định cửa hàng (store_id)."}

    # Scope check
    if not is_hr_or_admin(current_user) and is_store_manager(current_user):
        if int(store_id) != current_user.get("store_id"):
            return {"error": "Truy cập bị từ chối: Cửa hàng trưởng chỉ được xem thông tin chi nhánh của mình."}

    query = text("""
        SELECT s.store_id, s.store_code, s.store_name, s.address, s.district, s.city, s.phone,
               mgr.full_name as manager_name,
               COUNT(e.employee_id) FILTER (WHERE e.employment_status = 'ACTIVE') as active_headcount
        FROM stores s
        LEFT JOIN employees mgr ON s.manager_employee_id = mgr.employee_id
        LEFT JOIN employees e ON s.store_id = e.store_id
        WHERE s.store_id = :sid
        GROUP BY s.store_id, mgr.full_name
    """)
    res = await db.execute(query, {"sid": int(store_id)})
    row = res.mappings().first()
    return dict(row) if row else {"error": "Không tìm thấy cửa hàng."}


async def get_store_employees(args: Dict[str, Any], current_user: dict, db: AsyncSession) -> Dict[str, Any]:
    store_id = args.get("store_id") or current_user.get("store_id")
    if not store_id:
        return {"error": "Vui lòng chỉ định cửa hàng (store_id)."}

    if not is_hr_or_admin(current_user):
        if is_store_manager(current_user):
            if int(store_id) != current_user.get("store_id"):
                return {"error": "Truy cập bị từ chối: Cửa hàng trưởng chỉ xem nhân sự thuộc cửa hàng mình."}
        else:
            return {"error": "Truy cập bị từ chối."}

    query = text("""
        SELECT e.employee_id, e.employee_code, e.full_name, pos.position_name, e.phone, e.employment_status
        FROM employees e
        LEFT JOIN positions pos ON e.position_id = pos.position_id
        WHERE e.store_id = :sid AND e.employment_status = 'ACTIVE'
        ORDER BY pos.position_id ASC, e.employee_id ASC
    """)
    res = await db.execute(query, {"sid": int(store_id)})
    employees = [dict(r) for r in res.mappings().all()]
    return {"store_id": int(store_id), "total_active": len(employees), "employees": employees}


async def get_store_schedule(args: Dict[str, Any], current_user: dict, db: AsyncSession) -> Dict[str, Any]:
    store_id = args.get("store_id") or current_user.get("store_id")
    work_date_str = args.get("work_date", str(date.today()))

    if not is_hr_or_admin(current_user) and is_store_manager(current_user):
        if int(store_id) != current_user.get("store_id"):
            return {"error": "Truy cập bị từ chối: Chỉ được xem ca làm chi nhánh của mình."}

    query = text("""
        SELECT ws.schedule_id, e.employee_code, e.full_name, sh.shift_name, sh.start_time, sh.end_time, ws.notes
        FROM work_schedules ws
        JOIN employees e ON ws.employee_id = e.employee_id
        JOIN work_shifts sh ON ws.shift_id = sh.shift_id
        WHERE ws.store_id = :sid AND ws.work_date = :wdate AND ws.cancelled_at IS NULL
        ORDER BY sh.start_time ASC
    """)
    res = await db.execute(query, {"sid": int(store_id), "wdate": work_date_str})
    return {"store_id": int(store_id), "work_date": work_date_str, "schedules": [dict(r) for r in res.mappings().all()]}


# ===================================================================================
# 7. EXECUTIVE & HR ANALYTICS TOOLS (3 tools)
# ===================================================================================

async def get_employee_statistics(args: Dict[str, Any], current_user: dict, db: AsyncSession) -> Dict[str, Any]:
    if not is_hr_or_admin(current_user):
        return {"error": "Truy cập bị từ chối: Chỉ HR Manager hoặc Ban Giám đốc mới có quyền xem thống kê toàn diện nhân sự."}

    stats_res = await db.execute(text("""
        SELECT
            COUNT(*) as total_employees,
            COUNT(*) FILTER (WHERE employment_status = 'ACTIVE') as active_count,
            COUNT(*) FILTER (WHERE employment_status = 'PROBATION') as probation_count,
            COUNT(*) FILTER (WHERE employment_status = 'RESIGNED') as resigned_count,
            COUNT(*) FILTER (WHERE gender = 'MALE') as male_count,
            COUNT(*) FILTER (WHERE gender = 'FEMALE') as female_count
        FROM employees
    """))
    return dict(stats_res.mappings().first() or {})


async def get_attendance_summary(args: Dict[str, Any], current_user: dict, db: AsyncSession) -> Dict[str, Any]:
    if not (is_hr_or_admin(current_user) or is_store_manager(current_user)):
        return {"error": "Truy cập bị từ chối."}

    today = date.today()
    month = int(args.get("month", today.month))
    year = int(args.get("year", today.year))
    store_id = args.get("store_id")

    if is_store_manager(current_user) and not is_hr_or_admin(current_user):
        store_id = current_user.get("store_id")

    where = ["EXTRACT(MONTH FROM a.work_date) = :m", "EXTRACT(YEAR FROM a.work_date) = :y"]
    params: Dict[str, Any] = {"m": month, "y": year}
    if store_id:
        where.append("a.store_id = :sid")
        params["sid"] = int(store_id)

    query = text(f"""
        SELECT COUNT(*) as total_records,
               COUNT(*) FILTER (WHERE a.late_minutes > 0) as late_shifts,
               SUM(a.late_minutes) as total_late_minutes,
               SUM(a.overtime_hours) as total_overtime_hours,
               SUM(a.actual_work_hours) as total_actual_work_hours
        FROM attendances a
        WHERE {' AND '.join(where)}
    """)
    res = await db.execute(query, params)
    return {"month": month, "year": year, "summary": dict(res.mappings().first() or {})}


async def get_leave_statistics(args: Dict[str, Any], current_user: dict, db: AsyncSession) -> Dict[str, Any]:
    if not (is_hr_or_admin(current_user) or is_store_manager(current_user)):
        return {"error": "Truy cập bị từ chối."}

    year = int(args.get("year", date.today().year))
    store_id = args.get("store_id")

    if is_store_manager(current_user) and not is_hr_or_admin(current_user):
        store_id = current_user.get("store_id")

    where = ["EXTRACT(YEAR FROM lr.start_date) = :y"]
    params: Dict[str, Any] = {"y": year}
    if store_id:
        where.append("e.store_id = :sid")
        params["sid"] = int(store_id)

    query = text(f"""
        SELECT lt.type_name, COUNT(lr.request_id) as total_requests,
               SUM(lr.total_days) as total_days
        FROM leave_requests lr
        JOIN leave_types lt ON lr.leave_type_id = lt.leave_type_id
        JOIN employees e ON lr.employee_id = e.employee_id
        WHERE {' AND '.join(where)} AND lr.status = 'HR_APPROVED'
        GROUP BY lt.type_name
    """)
    res = await db.execute(query, params)
    return {"year": year, "breakdown": [dict(r) for r in res.mappings().all()]}


# ===================================================================================
# REGISTRY MAP (Exact 26 tools)
# ===================================================================================

HRM_TOOLS_REGISTRY = {
    # 1. Profile & Search
    "get_my_profile": get_my_profile,
    "get_employee_profile": get_employee_profile,
    "search_employees": search_employees,
    "get_employee_contract": get_employee_contract,
    # 2. Attendance & Schedule
    "get_my_attendance": get_my_attendance,
    "get_employee_attendance": get_employee_attendance,
    "get_my_work_schedule": get_my_work_schedule,
    "get_employee_work_schedule": get_employee_work_schedule,
    # 3. Leave & HITL
    "get_my_leave_balance": get_my_leave_balance,
    "get_my_leave_requests": get_my_leave_requests,
    "get_leave_request_detail": get_leave_request_detail,
    "create_leave_request": create_leave_request,
    "cancel_leave_request": cancel_leave_request,
    "get_pending_leave_requests": get_pending_leave_requests,
    # 4. Payroll
    "get_my_payroll": get_my_payroll,
    "get_my_payroll_history": get_my_payroll_history,
    "get_employee_payroll": get_employee_payroll,
    "get_payroll_period": get_payroll_period,
    # 5. Projects & Allowance
    "get_my_projects": get_my_projects,
    "get_project_detail": get_project_detail,
    # 6. Store
    "get_store_info": get_store_info,
    "get_store_employees": get_store_employees,
    "get_store_schedule": get_store_schedule,
    # 7. Analytics
    "get_employee_statistics": get_employee_statistics,
    "get_attendance_summary": get_attendance_summary,
    "get_leave_statistics": get_leave_statistics,
}
