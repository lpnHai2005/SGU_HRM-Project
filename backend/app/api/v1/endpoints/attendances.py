from typing import Optional, List
from datetime import date, datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.core.database import get_db
from app.api.deps import get_current_user, require_roles
from app.schemas.schemas import (
    CheckInRequest, CheckOutRequest, AttendanceOut,
    ShiftScheduleCreate, ShiftScheduleOut
)

router = APIRouter()

@router.get("", response_model=List[AttendanceOut], summary="Danh sách chấm công (theo ngày / cửa hàng)")
async def list_attendances(
    work_date: Optional[date] = Query(None, description="Ngày làm việc (mặc định hôm nay)"),
    store_id: Optional[int] = Query(None, description="Lọc theo cửa hàng"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    target_date = work_date or date.today()
    query = """
        SELECT a.attendance_id, a.employee_id, e.full_name as employee_name,
               a.store_id, s.store_name, a.shift_id, ws.shift_name,
               a.work_date, a.check_in_time, a.check_out_time,
               a.late_minutes, a.early_minutes, a.overtime_hours, a.actual_work_hours,
               a.status, a.notes
        FROM attendances a
        JOIN employees e ON a.employee_id = e.employee_id
        JOIN stores s ON a.store_id = s.store_id
        JOIN work_shifts ws ON a.shift_id = ws.shift_id
        WHERE a.work_date = :work_date
    """
    params = {"work_date": target_date}

    # Store manager chỉ xem cửa hàng của mình
    if "STORE_MANAGER" in current_user.get("roles", []) and "ADMIN" not in current_user.get("roles", []):
        query += " AND a.store_id = :store_id"
        params["store_id"] = current_user.get("store_id")
    elif store_id:
        query += " AND a.store_id = :store_id"
        params["store_id"] = store_id

    query += " ORDER BY a.attendance_id DESC"
    res = await db.execute(text(query), params)
    return res.mappings().all()

@router.get("/my-history", response_model=List[AttendanceOut], summary="Lịch sử chấm công của chính mình")
async def get_my_attendance_history(
    period: Optional[str] = Query(None, description="Kỳ tháng (YYYY-MM)"),
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
        JOIN stores s ON a.store_id = s.store_id
        JOIN work_shifts ws ON a.shift_id = ws.shift_id
        WHERE a.employee_id = :emp_id
    """
    params = {"emp_id": emp_id}
    if period:
        query += " AND TO_CHAR(a.work_date, 'YYYY-MM') = :period"
        params["period"] = period

    query += " ORDER BY a.work_date DESC"
    res = await db.execute(text(query), params)
    return res.mappings().all()

@router.post("/check-in", summary="Nhân viên check-in vào ca làm việc (Rubric III.3.1.7)")
async def check_in(
    req: CheckInRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    emp_id = req.employee_id or current_user.get("employee_id")
    if not emp_id:
        raise HTTPException(status_code=400, detail="Không xác định được nhân viên")

    today = date.today()
    now = datetime.now()

    # Lấy thông tin cửa hàng của nhân viên
    emp_info = (await db.execute(
        text("SELECT store_id FROM employees WHERE employee_id = :id"), {"id": emp_id}
    )).mappings().first()
    store_id = emp_info["store_id"] if emp_info and emp_info["store_id"] else 1

    # Kiểm tra xem đã check-in hôm nay chưa
    check_exists = text("SELECT attendance_id FROM attendances WHERE employee_id = :emp_id AND work_date = :today")
    existing = (await db.execute(check_exists, {"emp_id": emp_id, "today": today})).scalar()

    # Lấy thông tin ca làm
    shift = (await db.execute(
        text("SELECT shift_id, start_time, work_hours FROM work_shifts WHERE shift_id = :id"),
        {"id": req.shift_id}
    )).mappings().first()

    # Tính số phút đi muộn (nếu sau giờ bắt đầu ca > 15 phút)
    shift_start = datetime.combine(today, shift["start_time"])
    late_minutes = 0
    status_str = "NORMAL"
    if now > shift_start:
        diff = (now - shift_start).total_seconds() / 60
        if diff > 0:
            late_minutes = int(diff)

    if existing:
        # Cập nhật check-in nếu chưa có
        await db.execute(text("""
            UPDATE attendances 
            SET check_in_time = :now, late_minutes = :late, status = :status, updated_at = CURRENT_TIMESTAMP
            WHERE attendance_id = :id
        """), {"now": now, "late": late_minutes, "status": status_str, "id": existing})
        att_id = existing
    else:
        # Tạo mới bản ghi
        res = await db.execute(text("""
            INSERT INTO attendances (
                employee_id, store_id, shift_id, work_date, check_in_time, 
                late_minutes, actual_work_hours, status, notes
            ) VALUES (
                :emp_id, :store_id, :shift_id, :work_date, :check_in,
                :late, :work_hours, :status, :notes
            ) RETURNING attendance_id;
        """), {
            "emp_id": emp_id, "store_id": store_id, "shift_id": req.shift_id,
            "work_date": today, "check_in": now, "late": late_minutes,
            "work_hours": float(shift["work_hours"]), "status": status_str,
            "notes": req.notes or "Check-in thành công qua ứng dụng"
        })
        att_id = res.scalar()

    await db.commit()
    return {
        "message": "Check-in vào ca thành công!",
        "attendance_id": att_id,
        "time": now.strftime("%H:%M:%S"),
        "status": status_str,
        "late_minutes": late_minutes
    }

@router.post("/check-out", summary="Nhân viên check-out ra khỏi ca")
async def check_out(
    req: CheckOutRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    now = datetime.now()
    att = (await db.execute(
        text("SELECT attendance_id, check_in_time, shift_id FROM attendances WHERE attendance_id = :id"),
        {"id": req.attendance_id}
    )).mappings().first()

    if not att:
        raise HTTPException(status_code=404, detail="Không tìm thấy bản ghi chấm công")

    actual_hours = 8.0
    overtime = 0.0
    if att["check_in_time"]:
        check_in_dt = att["check_in_time"]
        if hasattr(check_in_dt, "tzinfo") and check_in_dt.tzinfo is not None:
            check_in_dt = check_in_dt.replace(tzinfo=None)
        total_worked = (now - check_in_dt).total_seconds() / 3600
        actual_hours = round(max(0.1, min(total_worked, 12.0)), 1)
        if actual_hours > 8.0:
            overtime = round(actual_hours - 8.0, 1)

    await db.execute(text("""
        UPDATE attendances 
        SET check_out_time = :now, actual_work_hours = :act_hours, overtime_hours = :ot,
            notes = COALESCE(notes, '') || ' | Check-out lúc ' || :time_str,
            updated_at = CURRENT_TIMESTAMP
        WHERE attendance_id = :id
    """), {
        "now": now, "act_hours": actual_hours, "ot": overtime,
        "time_str": now.strftime("%H:%M:%S"), "id": req.attendance_id
    })
    await db.commit()

    return {"message": "Check-out hoàn tất!", "actual_hours": actual_hours, "overtime_hours": overtime}

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
        JOIN stores s ON ws.store_id = s.store_id
        JOIN work_shifts sh ON ws.shift_id = sh.shift_id
        WHERE 1=1
    """
    params = {}
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
    # Upsert phân ca (uq_emp_date)
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
