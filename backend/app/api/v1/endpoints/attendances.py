from typing import Optional, List, Dict, Any
from datetime import date, datetime, time, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.core.database import get_db
from app.api.deps import get_current_user, require_roles, log_audit
from app.schemas.schemas import (
    CheckInRequest, CheckOutRequest, AttendanceOut,
    ShiftScheduleCreate, ShiftScheduleOut, WorkShiftOut,
    AttendanceSummaryOut, TodayAttendanceStatusOut
)

from app.core.attendance import local_now, VIETNAM_TZ, availability, require_available, session_metrics

router = APIRouter()


async def authorize_employee(db, user, employee_id, lock=False):
    if not employee_id:
        raise HTTPException(400, "Tài khoản chưa liên kết hồ sơ nhân viên.")
    employee = (await db.execute(text(
        "SELECT employee_id, store_id, full_name FROM employees WHERE employee_id = :id" +
        (" FOR UPDATE" if lock else "")
    ), {"id": employee_id})).mappings().first()
    if not employee:
        raise HTTPException(404, "Không tìm thấy nhân viên.")
    roles = set(user.get("roles", []))
    if employee_id != user.get("employee_id") and not roles.intersection({"ADMIN", "HR_MANAGER"}):
        if "STORE_MANAGER" not in roles or not user.get("store_id") or employee["store_id"] != user["store_id"]:
            raise HTTPException(403, "Không có quyền truy cập chấm công nhân viên này.")
    return employee


async def latest_session(db, employee_id):
    return (await db.execute(text("""
        SELECT attendance_id, check_in_time, check_out_time FROM attendances
        WHERE employee_id = :id AND check_in_time IS NOT NULL
        ORDER BY (check_out_time IS NULL) DESC, check_in_time DESC, attendance_id DESC LIMIT 1
    """), {"id": employee_id})).mappings().first()



# ===================================================================================
# 1. DANH MỤC CA LÀM VIỆC (WORK SHIFTS)
# ===================================================================================

@router.get("/shifts", response_model=List[WorkShiftOut], summary="Danh sách các ca làm việc TechZone")
async def list_work_shifts(db: AsyncSession = Depends(get_db)):
    """
    Truy vấn danh mục ca làm việc:
    - Ca Sáng (08:00 - 16:00, 8h)
    - Ca Chiều (13:00 - 21:00, 8h)
    - Ca Full (08:00 - 21:00, 12h)
    """
    query = text("""
        SELECT shift_id, shift_code, shift_name, start_time, end_time, work_hours
        FROM work_shifts
        ORDER BY shift_id ASC
    """)
    res = await db.execute(query)
    return res.mappings().all()


# ===================================================================================
# 2. TRẠNG THÁI CHẤM CÔNG HÔM NAY (TODAY STATUS)
# ===================================================================================

@router.get("/today-status", response_model=TodayAttendanceStatusOut, summary="Trạng thái điểm danh hôm nay của nhân viên")
async def get_today_attendance_status(
    employee_id: Optional[int] = Query(None, description="ID nhân viên (dành cho quản lý tra cứu)"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Kiểm tra trạng thái ca làm việc hôm nay:
    - Đã check-in chưa? Thời gian nào?
    - Đã check-out chưa?
    - Số phút đi muộn / về sớm hiện tại.
    """
    target_emp_id = employee_id or current_user.get("employee_id")
    target_employee = await authorize_employee(db, current_user, target_emp_id)
    if not target_emp_id:
        raise HTTPException(status_code=400, detail="Không tìm thấy mã hồ sơ nhân viên liên kết")

    today = local_now().date()

    query = text("""
        SELECT a.attendance_id, a.employee_id, a.store_id, s.store_name,
               a.shift_id, ws.shift_name, a.work_date,
               a.check_in_time, a.check_out_time,
               a.late_minutes, a.early_minutes, a.overtime_hours, a.actual_work_hours,
               a.status, a.notes
        FROM attendances a
        LEFT JOIN stores s ON a.store_id = s.store_id
        LEFT JOIN work_shifts ws ON a.shift_id = ws.shift_id
        WHERE a.employee_id = :emp_id AND (a.work_date = :today OR
              (a.check_in_time IS NOT NULL AND a.check_out_time IS NULL))
        ORDER BY (a.check_in_time IS NOT NULL AND a.check_out_time IS NULL) DESC, a.attendance_id DESC
        LIMIT 1
    """)
    res = await db.execute(query, {"emp_id": target_emp_id, "today": today})
    att = res.mappings().first()

    state = availability(await latest_session(db, target_emp_id), local_now())

    if not att:
        # Kiểm tra xem có lịch phân ca hôm nay không
        sched_res = await db.execute(text("""
            SELECT ws.shift_id, sh.shift_name, ws.store_id, s.store_name
            FROM work_schedules ws
            JOIN work_shifts sh ON ws.shift_id = sh.shift_id
            LEFT JOIN stores s ON ws.store_id = s.store_id
            WHERE ws.employee_id = :emp_id AND ws.work_date = :today
            LIMIT 1
        """), {"emp_id": target_emp_id, "today": today})
        sched = sched_res.mappings().first()

        return TodayAttendanceStatusOut(
            **state,
            work_date=today,
            has_checked_in=False,
            has_checked_out=False,
            attendance_id=None,
            check_in_time=None,
            check_out_time=None,
            late_minutes=0,
            early_minutes=0,
            actual_work_hours=0.0,
            overtime_hours=0.0,
            status="NOT_CHECKED_IN",
            shift_id=sched["shift_id"] if sched else 1,
            shift_name=sched["shift_name"] if sched else "Ca Sáng (08:00 - 16:00)",
            store_id=sched["store_id"] if sched else target_employee["store_id"],
            store_name=sched["store_name"] if sched else None,
            notes=None
        )

    has_in = att["check_in_time"] is not None
    has_out = att["check_out_time"] is not None

    return TodayAttendanceStatusOut(
        **state,
        work_date=att["work_date"],
        has_checked_in=has_in,
        has_checked_out=has_out,
        attendance_id=att["attendance_id"],
        check_in_time=att["check_in_time"],
        check_out_time=att["check_out_time"],
        late_minutes=att["late_minutes"] or 0,
        early_minutes=att["early_minutes"] or 0,
        actual_work_hours=float(att["actual_work_hours"] or 0.0),
        overtime_hours=float(att["overtime_hours"] or 0.0),
        status=att["status"] or ("CHECKED_OUT" if has_out else "WORKING"),
        shift_id=att["shift_id"],
        shift_name=att["shift_name"],
        store_id=att["store_id"],
        store_name=att["store_name"],
        notes=att["notes"]
    )


# ===================================================================================
# 3. TỔNG HỢP BẢNG CHẤM CÔNG THEO THÁNG (THEO MẪU CHUCNANG1.JPG)
# ===================================================================================

@router.get("/my-summary", response_model=AttendanceSummaryOut, summary="Tổng hợp bảng chấm công tháng cá nhân (Khớp giao diện chucnang1.jpg)")
async def get_my_attendance_summary(
    period: Optional[str] = Query(None, pattern=r"^[0-9]{4}-(0[1-9]|1[0-2])$", description="Kỳ tháng tra cứu (YYYY-MM), ví dụ: 2026-09"),
    employee_id: Optional[int] = Query(None, description="ID nhân viên (chỉ dành cho Quản lý / HR tra cứu)"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Trả về toàn bộ 8 chỉ số theo thiết kế giao diện di động chucnang1.jpg:
    1. Ngày công: công hoàn thành / 26 công chuẩn, tổng số giờ làm việc thực tế
    2. Quỹ phép: phép năm, nghỉ thực tế đã duyệt, quỹ còn lại
    3. Đi muộn: số lần, tổng số phút đi muộn
    4. Về sớm: số lần, tổng số phút về sớm
    5. Làm thêm: số giờ làm thêm
    6. Công tác: số ngày đi công tác
    7. Tăng ca: số công ca tăng, số giờ OT
    8. Quỹ nghỉ bù: tổng số ngày nghỉ bù tích lũy
    """
    target_emp_id = employee_id or current_user.get("employee_id")
    target_employee = await authorize_employee(db, current_user, target_emp_id)
    if not target_emp_id:
        raise HTTPException(status_code=400, detail="Không tìm thấy mã hồ sơ nhân viên liên kết")

    # Xác định kỳ tháng tra cứu
    now = local_now()
    if period and len(period.split("-")) == 2:
        parts = period.split("-")
        year = int(parts[0])
        month = int(parts[1])
    else:
        year = now.year
        month = now.month

    period_str = f"{year:04d}-{month:02d}"
    formatted_period = f"{month:02d}/{year:04d}"

    # Lấy thông tin nhân viên
    emp_res = await db.execute(
        text("SELECT full_name FROM employees WHERE employee_id = :emp_id"),
        {"emp_id": target_emp_id}
    )
    emp_row = emp_res.mappings().first()
    emp_name = emp_row["full_name"] if emp_row else None

    # 1. Truy vấn các bản ghi chấm công trong tháng
    att_query = text("""
        SELECT
            COUNT(DISTINCT CASE WHEN check_in_time IS NOT NULL THEN work_date END) as actual_days,
            COALESCE(SUM(actual_work_hours), 0) as total_hours,
            COUNT(CASE WHEN late_minutes > 15 THEN 1 END) as late_count,
            COALESCE(SUM(CASE WHEN late_minutes > 15 THEN late_minutes ELSE 0 END), 0) as total_late_minutes,
            COUNT(CASE WHEN early_minutes > 0 THEN 1 END) as early_count,
            COALESCE(SUM(early_minutes), 0) as total_early_minutes,
            COALESCE(SUM(overtime_hours), 0) as total_ot_hours,
            COUNT(CASE WHEN overtime_hours > 0 THEN 1 END) as ot_shifts_count
        FROM attendances
        WHERE employee_id = :emp_id
          AND TO_CHAR(work_date, 'YYYY-MM') = :period
    """)
    att_res = await db.execute(att_query, {"emp_id": target_emp_id, "period": period_str})
    att_stats = att_res.mappings().first()

    actual_days = float(att_stats["actual_days"] or 0)
    total_hours = round(float(att_stats["total_hours"] or 0), 1)
    late_count = int(att_stats["late_count"] or 0)
    total_late_minutes = int(att_stats["total_late_minutes"] or 0)
    early_count = int(att_stats["early_count"] or 0)
    total_early_minutes = int(att_stats["total_early_minutes"] or 0)
    ot_shifts = int(att_stats["ot_shifts_count"] or 0)
    total_ot_hours = round(float(att_stats["total_ot_hours"] or 0), 1)

    # 2. Truy vấn quỹ phép & nghỉ thực tế trong kỳ từ bảng leave_requests & employees
    seniority_bonus = 0.0
    emp_join = await db.execute(
        text("SELECT join_date FROM employees WHERE employee_id = :emp_id"),
        {"emp_id": target_emp_id}
    )
    emp_join_row = emp_join.mappings().first()
    if emp_join_row and emp_join_row["join_date"]:
        join_d = emp_join_row["join_date"]
        years = (date.today() - join_d).days // 365
        seniority_bonus = float(max(0, years // 5))  # 1 ngày phép cộng thêm cho mỗi 5 năm

    annual_total = 12.0 + seniority_bonus

    # Đếm số ngày nghỉ phép năm đã dùng trong năm
    leaves_year_res = await db.execute(
        text("""
            SELECT COALESCE(SUM(lr.total_days), 0) as used_days
            FROM leave_requests lr
            JOIN leave_types lt ON lr.leave_type_id = lt.leave_type_id
            WHERE lr.employee_id = :emp_id
              AND lr.status = 'HR_APPROVED'
              AND lt.type_code = 'PHEP_NAM'
              AND TO_CHAR(lr.start_date, 'YYYY') = :year_str
        """),
        {"emp_id": target_emp_id, "year_str": str(year)}
    )
    used_year_row = leaves_year_res.mappings().first()
    used_in_year = float(used_year_row["used_days"] or 0) if used_year_row else 0.0

    # Đếm số ngày nghỉ đã duyệt chính thức trong tháng này
    leaves_month_res = await db.execute(
        text("""
            SELECT COALESCE(SUM(total_days), 0) as used_this_month
            FROM leave_requests
            WHERE employee_id = :emp_id
              AND status = 'HR_APPROVED'
              AND (TO_CHAR(start_date, 'YYYY-MM') = :period OR TO_CHAR(end_date, 'YYYY-MM') = :period)
        """),
        {"emp_id": target_emp_id, "period": period_str}
    )
    used_month_row = leaves_month_res.mappings().first()
    actual_leave_days = float(used_month_row["used_this_month"] or 0) if used_month_row else 0.0

    remaining_leave = max(0.0, annual_total - used_in_year)

    # 3. Ngày công tác trong tháng (tính từ đơn có ghi chú công tác)
    business_trip_res = await db.execute(
        text("""
            SELECT COALESCE(SUM(total_days), 0) as trip_days
            FROM leave_requests
            WHERE employee_id = :emp_id
              AND status = 'HR_APPROVED'
              AND reason ILIKE '%công tác%'
              AND (TO_CHAR(start_date, 'YYYY-MM') = :period OR TO_CHAR(end_date, 'YYYY-MM') = :period)
        """),
        {"emp_id": target_emp_id, "period": period_str}
    )
    trip_row = business_trip_res.mappings().first()
    trip_days = float(trip_row["trip_days"] or 0) if trip_row else 0.0

    # 4. Quỹ nghỉ bù (tính từ ngày OT tích lũy hoặc số ngày nghỉ bù)
    compensatory_leave_days = 0.0

    return AttendanceSummaryOut(
        period=formatted_period,
        month=month,
        year=year,
        employee_id=target_emp_id,
        employee_name=emp_name,
        working_days={
            "standard_days": 26,
            "actual_days": actual_days,
            "total_hours": total_hours,
        },
        leave_quota={
            "annual_leave": annual_total,
            "used_leave": actual_leave_days,
            "remaining_leave": remaining_leave,
        },
        late_arrivals={
            "count": late_count,
            "minutes": total_late_minutes,
        },
        early_departures={
            "count": early_count,
            "minutes": total_early_minutes,
        },
        extra_work={
            "hours": total_ot_hours,
        },
        business_trips={
            "days": trip_days,
        },
        overtime={
            "shifts_count": ot_shifts,
            "hours": total_ot_hours,
        },
        compensatory_leave={
            "total": compensatory_leave_days,
        }
    )


# ===================================================================================
# 4. DANH SÁCH & LỊCH SỬ CHẤM CÔNG (LIST & HISTORY)
# ===================================================================================

@router.get("", response_model=List[AttendanceOut], summary="Danh sách chấm công toàn diện (Lọc theo ngày / tháng / cửa hàng / nhân viên)")
async def list_attendances(
    work_date: Optional[date] = Query(None, description="Ngày làm việc cụ thể"),
    period: Optional[str] = Query(None, pattern=r"^[0-9]{4}-(0[1-9]|1[0-2])$", description="Kỳ tháng làm việc (YYYY-MM)"),
    store_id: Optional[int] = Query(None, description="Lọc theo cửa hàng"),
    employee_id: Optional[int] = Query(None, description="Lọc theo mã nhân viên"),
    status: Optional[str] = Query(None, description="Lọc theo trạng thái chấm công"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    query = """
        SELECT a.attendance_id, a.employee_id, e.full_name as employee_name,
               a.store_id, s.store_name, a.shift_id, ws.shift_name,
               a.work_date, a.check_in_time, a.check_out_time,
               a.late_minutes, a.early_minutes, a.overtime_hours, a.actual_work_hours,
               a.status, a.notes
        FROM attendances a
        JOIN employees e ON a.employee_id = e.employee_id
        LEFT JOIN stores s ON a.store_id = s.store_id
        LEFT JOIN work_shifts ws ON a.shift_id = ws.shift_id
        WHERE 1=1
    """
    params: Dict[str, Any] = {}

    # Store manager chỉ xem chi nhánh của mình
    user_roles = current_user.get("roles", [])
    if not set(user_roles).intersection({"ADMIN", "HR_MANAGER", "STORE_MANAGER"}):
        raise HTTPException(403, "Chỉ quản lý được truy cập danh sách chấm công.")
    if "STORE_MANAGER" in user_roles and "ADMIN" not in user_roles and "HR_MANAGER" not in user_roles:
        query += " AND a.store_id = :mgr_store_id"
        params["mgr_store_id"] = current_user.get("store_id")
    elif store_id:
        query += " AND a.store_id = :store_id"
        params["store_id"] = store_id

    if work_date:
        query += " AND a.work_date = :work_date"
        params["work_date"] = work_date
    elif period:
        query += " AND TO_CHAR(a.work_date, 'YYYY-MM') = :period"
        params["period"] = period

    if employee_id:
        query += " AND a.employee_id = :emp_id"
        params["emp_id"] = employee_id

    if status:
        query += " AND a.status = :status"
        params["status"] = status

    query += " ORDER BY a.work_date DESC, a.attendance_id DESC"
    res = await db.execute(text(query), params)
    return res.mappings().all()


@router.get("/my-history", response_model=List[AttendanceOut], summary="Lịch sử chấm công của chính mình")
async def get_my_attendance_history(
    period: Optional[str] = Query(None, pattern=r"^[0-9]{4}-(0[1-9]|1[0-2])$", description="Kỳ tháng (YYYY-MM), ví dụ 2026-09"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    emp_id = current_user.get("employee_id")
    if not emp_id:
        raise HTTPException(status_code=400, detail="Tài khoản này chưa được liên kết với hồ sơ nhân viên")

    query = """
        SELECT a.attendance_id, a.employee_id, e.full_name as employee_name,
               a.store_id, s.store_name, a.shift_id, ws.shift_name,
               a.work_date, a.check_in_time, a.check_out_time,
               a.late_minutes, a.early_minutes, a.overtime_hours, a.actual_work_hours,
               a.status, a.notes
        FROM attendances a
        JOIN employees e ON a.employee_id = e.employee_id
        LEFT JOIN stores s ON a.store_id = s.store_id
        LEFT JOIN work_shifts ws ON a.shift_id = ws.shift_id
        WHERE a.employee_id = :emp_id
    """
    params = {"emp_id": emp_id}
    if period:
        query += " AND TO_CHAR(a.work_date, 'YYYY-MM') = :period"
        params["period"] = period

    query += " ORDER BY a.work_date DESC, a.attendance_id DESC"
    res = await db.execute(text(query), params)
    return res.mappings().all()


# ===================================================================================
# 5. CHECK-IN & CHECK-OUT VÀO / RA CA LÀM VIỆC
# ===================================================================================

@router.post("/check-in", status_code=201, summary="Mở lượt chấm công mới")
async def check_in(req: CheckInRequest, current_user: dict = Depends(get_current_user),
                   db: AsyncSession = Depends(get_db)):
    emp_id = req.employee_id or current_user.get("employee_id")
    employee = await authorize_employee(db, current_user, emp_id, lock=True)
    # Employee row lock serializes all check-in/check-out requests, including first entry.
    now = local_now()
    require_available(await latest_session(db, emp_id), now)
    if not employee["store_id"]:
        raise HTTPException(400, "Nhân viên chưa được phân cửa hàng.")
    shift = (await db.execute(text("SELECT * FROM work_shifts WHERE shift_id = :id"),
                             {"id": req.shift_id})).mappings().first()
    if not shift:
        raise HTTPException(404, "Không tìm thấy ca làm việc.")
    work_date = now.date()
    if shift["end_time"] <= shift["start_time"] and now.time() < shift["end_time"]:
        work_date -= timedelta(days=1)
    start = datetime.combine(work_date, shift["start_time"], VIETNAM_TZ)
    late = max(0, int((now - start).total_seconds() / 60))
    attendance_status = "LATE" if late > 15 else "NORMAL"
    notes = " | ".join(filter(None, [req.notes,
        f"Vị trí: {req.location}" if req.location else None,
        f"Thiết bị: {req.device_info}" if req.device_info else None]))
    result = await db.execute(text("""
        INSERT INTO attendances (employee_id, store_id, shift_id, work_date,
            check_in_time, late_minutes, early_minutes, actual_work_hours, overtime_hours, status, notes)
        VALUES (:emp, :store, :shift, :day, :now, :late, 0, 0, 0, :status, :notes)
        RETURNING attendance_id
    """), dict(emp=emp_id, store=employee["store_id"], shift=req.shift_id,
               day=work_date, now=now, late=late, status=attendance_status, notes=notes))
    attendance_id = result.scalar_one()
    await db.commit()
    return dict(message="Check-in thành công.", attendance_id=attendance_id,
                employee_name=employee["full_name"], time=now.strftime("%H:%M:%S"),
                check_in_time=now, work_date=work_date, status=attendance_status,
                late_minutes=late, shift_name=shift["shift_name"])


@router.post("/check-out", summary="Đóng lượt chấm công đang mở")
async def check_out(req: CheckOutRequest, current_user: dict = Depends(get_current_user),
                    db: AsyncSession = Depends(get_db)):
    emp_id = current_user.get("employee_id")
    if req.attendance_id:
        owner = (await db.execute(text("SELECT employee_id FROM attendances WHERE attendance_id = :id"),
                                 {"id": req.attendance_id})).mappings().first()
        if not owner:
            raise HTTPException(404, "Không tìm thấy lượt chấm công.")
        emp_id = owner["employee_id"]
    await authorize_employee(db, current_user, emp_id, lock=True)
    condition = "a.attendance_id = :id" if req.attendance_id else "a.employee_id = :id AND a.check_in_time IS NOT NULL AND a.check_out_time IS NULL"
    att = (await db.execute(text("""
        SELECT a.*, ws.start_time, ws.end_time, ws.work_hours
        FROM attendances a JOIN work_shifts ws ON ws.shift_id = a.shift_id
        WHERE """ + condition + " ORDER BY a.attendance_id DESC LIMIT 1 FOR UPDATE OF a"),
        {"id": req.attendance_id or emp_id})).mappings().first()
    if not att:
        raise HTTPException(404, "Không có lượt đang mở để check-out.")
    if not att["check_in_time"] or att["check_out_time"]:
        raise HTTPException(409, "Lượt này chưa check-in hoặc đã check-out.")
    now = local_now()
    metrics = session_metrics(att, now)
    notes = " | ".join(filter(None, [req.notes, f"Vị trí: {req.location}" if req.location else None]))
    await db.execute(text("""
        UPDATE attendances SET check_out_time = :now, actual_work_hours = :actual_work_hours,
            overtime_hours = :overtime_hours, early_minutes = :early_minutes, status = :status,
            notes = concat_ws(' | ', NULLIF(notes, ''), NULLIF(:notes, '')), updated_at = CURRENT_TIMESTAMP
        WHERE attendance_id = :id
    """), dict(now=now, id=att["attendance_id"], notes=notes, **metrics))
    await db.commit()
    return dict(message="Check-out thành công.", attendance_id=att["attendance_id"],
                check_out_time=now, next_check_in_at=now + timedelta(seconds=60), **metrics)


# ===================================================================================
# 6. PHÂN CA LÀM VIỆC (SHIFT SCHEDULES)
# ===================================================================================

@router.get("/shift-schedules", response_model=List[ShiftScheduleOut], summary="Danh sách phân ca làm việc chi tiết (Week 2.3)")
async def list_shift_schedules(
    store_id: Optional[int] = Query(None, description="Lọc theo cửa hàng"),
    work_date: Optional[date] = Query(None, description="Lọc theo ngày"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    query = """
        SELECT ws.schedule_id, ws.employee_id, e.full_name as employee_name,
               ws.store_id, s.store_name, ws.shift_id, sh.shift_name,
               ws.work_date, ws.notes
        FROM work_schedules ws
        JOIN employees e ON ws.employee_id = e.employee_id
        LEFT JOIN stores s ON ws.store_id = s.store_id
        LEFT JOIN work_shifts sh ON ws.shift_id = sh.shift_id
        WHERE 1=1
    """
    params: Dict[str, Any] = {}
    if store_id:
        query += " AND ws.store_id = :store_id"
        params["store_id"] = store_id
    if work_date:
        query += " AND ws.work_date = :work_date"
        params["work_date"] = work_date
    query += " ORDER BY ws.work_date ASC, ws.schedule_id ASC"
    res = await db.execute(text(query), params)
    return res.mappings().all()


@router.post("/shift-schedules", summary="Phân ca làm việc cho nhân viên (Week 2.3)")
async def assign_shift_schedule(
    req: ShiftScheduleCreate,
    current_user: dict = Depends(require_roles(["STORE_MANAGER", "HR_MANAGER", "ADMIN"])),
    db: AsyncSession = Depends(get_db)
):
    await db.execute(text("""
        INSERT INTO work_schedules (employee_id, store_id, shift_id, work_date, notes)
        VALUES (:emp_id, :store_id, :shift_id, :work_date, :notes)
        ON CONFLICT (employee_id, work_date)
        DO UPDATE SET store_id = EXCLUDED.store_id,
                      shift_id = EXCLUDED.shift_id,
                      notes = EXCLUDED.notes;
    """), {
        "emp_id": req.employee_id, "store_id": req.store_id,
        "shift_id": req.shift_id, "work_date": req.work_date,
        "notes": req.notes or "Phân ca theo kế hoạch tuần"
    })
    await db.commit()
    return {"message": "Phân ca làm việc thành công!", "employee_id": req.employee_id, "work_date": str(req.work_date)}
