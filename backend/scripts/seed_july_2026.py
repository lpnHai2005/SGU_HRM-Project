import asyncio
import sys
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo
import json

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from sqlalchemy import text
from app.core.database import engine

VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")

async def seed_july():
    async with engine.connect() as conn:
        print("=== CLEANING EXISTING JULY 2026 TEST DATA ===")
        # Delete July overtime reconciliations first, then requests, then attendances, then schedules
        await conn.execute(text("""
            DELETE FROM overtime_reconciliations WHERE request_id IN (
                SELECT request_id FROM overtime_requests WHERE work_date >= '2026-07-01' AND work_date <= '2026-07-31'
            )
        """))
        await conn.execute(text("DELETE FROM overtime_requests WHERE work_date >= '2026-07-01' AND work_date <= '2026-07-31'"))
        await conn.execute(text("DELETE FROM attendances WHERE work_date >= '2026-07-01' AND work_date <= '2026-07-31'"))
        await conn.execute(text("DELETE FROM work_schedules WHERE work_date >= '2026-07-01' AND work_date <= '2026-07-31'"))
        await conn.commit()

        # Get current max IDs
        res_sched = await conn.execute(text("SELECT coalesce(max(schedule_id), 0) FROM work_schedules"))
        next_sched_id = res_sched.scalar() + 1

        res_att = await conn.execute(text("SELECT coalesce(max(attendance_id), 0) FROM attendances"))
        next_att_id = res_att.scalar() + 1

        res_ot = await conn.execute(text("SELECT coalesce(max(request_id), 0) FROM overtime_requests"))
        next_ot_id = res_ot.scalar() + 1

        print(f"Starting IDs -> schedule: {next_sched_id}, attendance: {next_att_id}, ot_request: {next_ot_id}")

        sched_records = []
        att_records = []
        ot_records = []
        rec_records = []

        now_vn = datetime.now(VN_TZ)

        # -------------------------------------------------------------
        # 1. PHẠM QUỐC DŨNG (Emp #4, Store 5 - Tân Bình, Shift 1: 08:00 - 16:00)
        # Ca Sáng Sweep Test:
        # Ngày 01: Checkin 07:00, Checkout 15:00 (vào sớm 1h, về sớm 1h -> early 60m)
        # Ngày 02: Checkin 08:00, Checkout 16:00 (chuẩn ca)
        # Ngày 03: Checkin 09:00, Checkout 17:00 (trễ 60m > 15m -> phạt 50k, ngoài ca 1h)
        # Ngày 04: Checkin 10:00, Checkout 18:00 (trễ 120m -> phạt 50k, ngoài ca 2h)
        # Ngày 05: Checkin 11:00, Checkout 19:00 (trễ 180m -> phạt 50k, ngoài ca 3h)
        # Ngày 06: Checkin 12:00, Checkout 20:00 (trễ 240m -> phạt 50k, ngoài ca 4h)
        # Ngày 07: Checkin 08:10, Checkout 16:10 (trễ 10m <= 15m -> ân hạn 0đ)
        # Ngày 08: Checkin 08:14, Checkout 16:14 (trễ 14m <= 15m -> ân hạn 0đ)
        # Ngày 09: Checkin 08:35, Checkout 16:00 (trễ 35m -> phạt 50k)
        # Ngày 10: CÓ ĐƠN OT 2H (16:00 - 18:00) -> Checkin 08:00, Checkout 18:00 (đã duyệt & đối soát)
        # Ngày 11: CÓ ĐƠN OT 3H (16:00 - 19:00) -> Checkin 08:00, Checkout 19:00 (đã duyệt & đối soát)
        # Ngày 12..31: Ngày làm chuẩn 08:00 - 16:00 (nghỉ các Chủ Nhật: 5, 12, 19, 26)
        # -------------------------------------------------------------
        for day in range(1, 32):
            w_date = date(2026, 7, day)
            if w_date.weekday() == 6:  # Chủ Nhật nghỉ
                continue

            curr_sched_id = next_sched_id
            next_sched_id += 1
            sched_records.append({
                "schedule_id": curr_sched_id,
                "employee_id": 4,
                "store_id": 5,
                "shift_id": 1,
                "work_date": w_date,
                "notes": f"Lịch phân ca sáng {w_date.strftime('%d/%m')}",
                "starts_at": datetime.combine(w_date, time(8, 0), tzinfo=VN_TZ),
                "ends_at": datetime.combine(w_date, time(16, 0), tzinfo=VN_TZ),
            })

            curr_att_id = next_att_id
            next_att_id += 1

            if day == 1:
                # In 07:00, Out 15:00 (Early 60m)
                cin = datetime.combine(w_date, time(7, 0, 0), tzinfo=VN_TZ)
                cout = datetime.combine(w_date, time(15, 0, 0), tzinfo=VN_TZ)
                att_records.append({
                    "attendance_id": curr_att_id, "employee_id": 4, "store_id": 5, "shift_id": 1, "work_date": w_date,
                    "check_in_time": cin, "check_out_time": cout, "late_minutes": 0, "early_minutes": 60,
                    "overtime_hours": 0.0, "actual_work_hours": 7.0, "status": "EARLY",
                    "attendance_context": json.dumps({"schedule_status": "MATCHED", "actual": {"shift_id": 1, "shift_name": "Ca sáng bán lẻ", "start_time": "08:00:00", "end_time": "16:00:00", "work_hours": 7.0}})
                })
            elif day == 2:
                # In 08:00, Out 16:00 (Chuẩn ca)
                cin = datetime.combine(w_date, time(8, 0, 0), tzinfo=VN_TZ)
                cout = datetime.combine(w_date, time(16, 0, 0), tzinfo=VN_TZ)
                att_records.append({
                    "attendance_id": curr_att_id, "employee_id": 4, "store_id": 5, "shift_id": 1, "work_date": w_date,
                    "check_in_time": cin, "check_out_time": cout, "late_minutes": 0, "early_minutes": 0,
                    "overtime_hours": 0.0, "actual_work_hours": 7.0, "status": "NORMAL",
                    "attendance_context": json.dumps({"schedule_status": "MATCHED", "actual": {"shift_id": 1, "shift_name": "Ca sáng bán lẻ", "start_time": "08:00:00", "end_time": "16:00:00", "work_hours": 7.0}})
                })
            elif day == 3:
                # In 09:00, Out 17:00 (Trễ 60m > 15m Phạt 50k - Tự ở lại bù giờ chỉ đủ 7h định mức, ngoài ca thô = 0.0h)
                cin = datetime.combine(w_date, time(9, 0, 0), tzinfo=VN_TZ)
                cout = datetime.combine(w_date, time(17, 0, 0), tzinfo=VN_TZ)
                att_records.append({
                    "attendance_id": curr_att_id, "employee_id": 4, "store_id": 5, "shift_id": 1, "work_date": w_date,
                    "check_in_time": cin, "check_out_time": cout, "late_minutes": 60, "early_minutes": 0,
                    "overtime_hours": 0.0, "actual_work_hours": 7.0, "status": "LATE",
                    "attendance_context": json.dumps({"schedule_status": "MATCHED", "actual": {"shift_id": 1, "shift_name": "Ca sáng bán lẻ", "start_time": "08:00:00", "end_time": "16:00:00", "work_hours": 7.0}})
                })
            elif day == 4:
                # In 10:00, Out 18:00 (Trễ 120m > 15m Phạt 50k - Tự ở lại bù giờ chỉ đủ 7h định mức, ngoài ca thô = 0.0h)
                cin = datetime.combine(w_date, time(10, 0, 0), tzinfo=VN_TZ)
                cout = datetime.combine(w_date, time(18, 0, 0), tzinfo=VN_TZ)
                att_records.append({
                    "attendance_id": curr_att_id, "employee_id": 4, "store_id": 5, "shift_id": 1, "work_date": w_date,
                    "check_in_time": cin, "check_out_time": cout, "late_minutes": 120, "early_minutes": 0,
                    "overtime_hours": 0.0, "actual_work_hours": 7.0, "status": "LATE",
                    "attendance_context": json.dumps({"schedule_status": "MATCHED", "actual": {"shift_id": 1, "shift_name": "Ca sáng bán lẻ", "start_time": "08:00:00", "end_time": "16:00:00", "work_hours": 7.0}})
                })
            elif day == 6:
                # Test nâng cao: Ca sáng 08:00 - 16:00 nhưng đi làm giờ ca chiều (In 13:00, Out 21:00)
                # Trễ 300p > 240p -> EXCESSIVE_LATE, NEEDS_REVIEW, chuyển sang unreviewed_late_minutes = 300p
                cin = datetime.combine(w_date, time(13, 0, 0), tzinfo=VN_TZ)
                cout = datetime.combine(w_date, time(21, 0, 0), tzinfo=VN_TZ)
                att_records.append({
                    "attendance_id": curr_att_id, "employee_id": 4, "store_id": 5, "shift_id": 1, "work_date": w_date,
                    "check_in_time": cin, "check_out_time": cout, "late_minutes": 300, "early_minutes": 0,
                    "overtime_hours": 0.0, "actual_work_hours": 7.0, "status": "LATE",
                    "attendance_context": json.dumps({"schedule_status": "MATCHED", "actual": {"shift_id": 1, "shift_name": "Ca sáng bán lẻ", "start_time": "08:00:00", "end_time": "16:00:00", "work_hours": 7.0}})
                })
            elif day == 7:
                # In 08:10, Out 16:10 (Trễ 10m <= 15m Ân hạn 0đ)
                cin = datetime.combine(w_date, time(8, 10, 0), tzinfo=VN_TZ)
                cout = datetime.combine(w_date, time(16, 10, 0), tzinfo=VN_TZ)
                att_records.append({
                    "attendance_id": curr_att_id, "employee_id": 4, "store_id": 5, "shift_id": 1, "work_date": w_date,
                    "check_in_time": cin, "check_out_time": cout, "late_minutes": 10, "early_minutes": 0,
                    "overtime_hours": 0.0, "actual_work_hours": 7.0, "status": "LATE",
                    "attendance_context": json.dumps({"schedule_status": "MATCHED", "actual": {"shift_id": 1, "shift_name": "Ca sáng bán lẻ", "start_time": "08:00:00", "end_time": "16:00:00", "work_hours": 7.0}})
                })
            elif day == 8:
                # In 08:14, Out 16:14 (Trễ 14m <= 15m Ân hạn 0đ)
                cin = datetime.combine(w_date, time(8, 14, 0), tzinfo=VN_TZ)
                cout = datetime.combine(w_date, time(16, 14, 0), tzinfo=VN_TZ)
                att_records.append({
                    "attendance_id": curr_att_id, "employee_id": 4, "store_id": 5, "shift_id": 1, "work_date": w_date,
                    "check_in_time": cin, "check_out_time": cout, "late_minutes": 14, "early_minutes": 0,
                    "overtime_hours": 0.0, "actual_work_hours": 7.0, "status": "LATE",
                    "attendance_context": json.dumps({"schedule_status": "MATCHED", "actual": {"shift_id": 1, "shift_name": "Ca sáng bán lẻ", "start_time": "08:00:00", "end_time": "16:00:00", "work_hours": 7.0}})
                })
            elif day == 9:
                # In 08:35, Out 16:00 (Trễ 35m > 15m Phạt 50k)
                cin = datetime.combine(w_date, time(8, 35, 0), tzinfo=VN_TZ)
                cout = datetime.combine(w_date, time(16, 0, 0), tzinfo=VN_TZ)
                att_records.append({
                    "attendance_id": curr_att_id, "employee_id": 4, "store_id": 5, "shift_id": 1, "work_date": w_date,
                    "check_in_time": cin, "check_out_time": cout, "late_minutes": 35, "early_minutes": 0,
                    "overtime_hours": 0.0, "actual_work_hours": 6.42, "status": "LATE",
                    "attendance_context": json.dumps({"schedule_status": "MATCHED", "actual": {"shift_id": 1, "shift_name": "Ca sáng bán lẻ", "start_time": "08:00:00", "end_time": "16:00:00", "work_hours": 7.0}})
                })
            elif day == 10:
                # In 08:00, Out 18:00 (CÓ ĐƠN OT 2H TỪ 16:00 ĐẾN 18:00)
                cin = datetime.combine(w_date, time(8, 0, 0), tzinfo=VN_TZ)
                cout = datetime.combine(w_date, time(18, 0, 0), tzinfo=VN_TZ)
                att_records.append({
                    "attendance_id": curr_att_id, "employee_id": 4, "store_id": 5, "shift_id": 1, "work_date": w_date,
                    "check_in_time": cin, "check_out_time": cout, "late_minutes": 0, "early_minutes": 0,
                    "overtime_hours": 2.0, "actual_work_hours": 9.0, "status": "OVERTIME",
                    "attendance_context": json.dumps({"schedule_status": "MATCHED", "actual": {"shift_id": 1, "shift_name": "Ca sáng bán lẻ", "start_time": "08:00:00", "end_time": "16:00:00", "work_hours": 7.0}})
                })
                # OT request & reconciliation row
                curr_ot_id = next_ot_id
                next_ot_id += 1
                ot_starts = datetime.combine(w_date, time(16, 0, 0), tzinfo=VN_TZ)
                ot_ends = datetime.combine(w_date, time(18, 0, 0), tzinfo=VN_TZ)
                ot_records.append({
                    "request_id": curr_ot_id, "employee_id": 4, "store_id": 5, "work_date": w_date,
                    "starts_at": ot_starts, "ends_at": ot_ends, "reason": "Tăng ca kiểm kê hàng tồn kho",
                    "created_by": 4, "status": "APPROVED", "reviewed_by": 2, "reviewed_at": now_vn,
                    "created_at": now_vn, "updated_at": now_vn, "request_type": "STANDARD"
                })
                rec_records.append({
                    "request_id": curr_ot_id, "employee_id": 4, "store_id": 5, "status": "VERIFIED",
                    "version": 1, "source_signature": f"REC_OT_{curr_ot_id}", "proposed_microseconds": 7200000000,
                    "verified_microseconds": 7200000000, "eligible_intervals": json.dumps([]), "attendance_ids": json.dumps([curr_att_id]),
                    "review_issues": json.dumps([]), "reviewed_by": 2, "reviewed_at": now_vn, "decision_reason": "Đối soát thành công",
                    "calculated_at": now_vn, "created_at": now_vn, "updated_at": now_vn
                })
            elif day == 11:
                # In 08:00, Out 19:00 (CÓ ĐƠN OT 3H TỪ 16:00 ĐẾN 19:00)
                cin = datetime.combine(w_date, time(8, 0, 0), tzinfo=VN_TZ)
                cout = datetime.combine(w_date, time(19, 0, 0), tzinfo=VN_TZ)
                att_records.append({
                    "attendance_id": curr_att_id, "employee_id": 4, "store_id": 5, "shift_id": 1, "work_date": w_date,
                    "check_in_time": cin, "check_out_time": cout, "late_minutes": 0, "early_minutes": 0,
                    "overtime_hours": 3.0, "actual_work_hours": 10.0, "status": "OVERTIME",
                    "attendance_context": json.dumps({"schedule_status": "MATCHED", "actual": {"shift_id": 1, "shift_name": "Ca sáng bán lẻ", "start_time": "08:00:00", "end_time": "16:00:00", "work_hours": 7.0}})
                })
                curr_ot_id = next_ot_id
                next_ot_id += 1
                ot_starts = datetime.combine(w_date, time(16, 0, 0), tzinfo=VN_TZ)
                ot_ends = datetime.combine(w_date, time(19, 0, 0), tzinfo=VN_TZ)
                ot_records.append({
                    "request_id": curr_ot_id, "employee_id": 4, "store_id": 5, "work_date": w_date,
                    "starts_at": ot_starts, "ends_at": ot_ends, "reason": "Tăng ca phụ trách đợt khuyến mãi",
                    "created_by": 4, "status": "APPROVED", "reviewed_by": 2, "reviewed_at": now_vn,
                    "created_at": now_vn, "updated_at": now_vn, "request_type": "STANDARD"
                })
                rec_records.append({
                    "request_id": curr_ot_id, "employee_id": 4, "store_id": 5, "status": "VERIFIED",
                    "version": 1, "source_signature": f"REC_OT_{curr_ot_id}", "proposed_microseconds": 10800000000,
                    "verified_microseconds": 10800000000, "eligible_intervals": json.dumps([]), "attendance_ids": json.dumps([curr_att_id]),
                    "review_issues": json.dumps([]), "reviewed_by": 2, "reviewed_at": now_vn, "decision_reason": "Đối soát thành công",
                    "calculated_at": now_vn, "created_at": now_vn, "updated_at": now_vn
                })
            elif day == 14:
                # In 08:00, Out 17:30 (Đúng giờ nhưng ở lại làm thêm 1.5h không có đơn OT -> test Giờ ngoài ca thô = 1.5h)
                cin = datetime.combine(w_date, time(8, 0, 0), tzinfo=VN_TZ)
                cout = datetime.combine(w_date, time(17, 30, 0), tzinfo=VN_TZ)
                att_records.append({
                    "attendance_id": curr_att_id, "employee_id": 4, "store_id": 5, "shift_id": 1, "work_date": w_date,
                    "check_in_time": cin, "check_out_time": cout, "late_minutes": 0, "early_minutes": 0,
                    "overtime_hours": 1.5, "actual_work_hours": 8.5, "status": "OVERTIME",
                    "attendance_context": json.dumps({"schedule_status": "MATCHED", "actual": {"shift_id": 1, "shift_name": "Ca sáng bán lẻ", "start_time": "08:00:00", "end_time": "16:00:00", "work_hours": 7.0}})
                })
            else:
                # Ngày thường đúng giờ 08:00 - 16:00
                cin = datetime.combine(w_date, time(7, 58, 0), tzinfo=VN_TZ)
                cout = datetime.combine(w_date, time(16, 2, 0), tzinfo=VN_TZ)
                att_records.append({
                    "attendance_id": curr_att_id, "employee_id": 4, "store_id": 5, "shift_id": 1, "work_date": w_date,
                    "check_in_time": cin, "check_out_time": cout, "late_minutes": 0, "early_minutes": 0,
                    "overtime_hours": 0.0, "actual_work_hours": 7.0, "status": "NORMAL",
                    "attendance_context": json.dumps({"schedule_status": "MATCHED", "actual": {"shift_id": 1, "shift_name": "Ca sáng bán lẻ", "start_time": "08:00:00", "end_time": "16:00:00", "work_hours": 7.0}})
                })

        # -------------------------------------------------------------
        # 2. LÊ VĂN CƯỜNG (Emp #3, Store 5 - Tân Bình, Shift 2: 13:00 - 21:00)
        # Ca Chiều Sweep Test:
        # Ngày 01: Checkin 12:00, Checkout 20:00 (vào sớm 1h, về sớm 1h -> early 60m)
        # Ngày 02: Checkin 13:00, Checkout 21:00 (chuẩn ca)
        # Ngày 03: Checkin 14:00, Checkout 22:00 (trễ 60m -> phạt 50k - Tự ở lại bù giờ chỉ đủ 7h định mức, ngoài ca thô = 0.0h)
        # Ngày 04: Checkin 15:00, Checkout 23:00 (trễ 120m -> phạt 50k - Tự ở lại bù giờ chỉ đủ 7h định mức, ngoài ca thô = 0.0h)
        # Ngày 06: Checkin 13:08, Checkout 21:00 (trễ 8m <= 15m -> ân hạn 0đ)
        # Ngày 07: Checkin 13:12, Checkout 21:00 (trễ 12m <= 15m -> ân hạn 0đ)
        # Ngày 15: CÓ ĐƠN OT 2H (21:00 - 23:00) -> Checkin 13:00, Checkout 23:00 (đã duyệt & đối soát)
        # Ngày 18: PHIÊN NGẮN BẤT THƯỜNG (SHORT_SESSION: 5 phút từ 13:00 đến 13:05 -> cờ rà soát)
        # Ngày 21: TEST NÂNG CAO - Phân ca chiều nhưng chấm công giờ ca sáng (In 08:00, Out 16:00 -> về sớm 300p > 240p -> EXCESSIVE_EARLY, unreviewed_early_minutes = 300p)
        # Ngày 22..31: Ngày làm chuẩn
        # -------------------------------------------------------------
        for day in range(1, 32):
            w_date = date(2026, 7, day)
            if w_date.weekday() == 6:  # Chủ Nhật nghỉ
                continue

            curr_sched_id = next_sched_id
            next_sched_id += 1
            sched_records.append({
                "schedule_id": curr_sched_id,
                "employee_id": 3,
                "store_id": 5,
                "shift_id": 2,
                "work_date": w_date,
                "notes": f"Lịch phân ca chiều {w_date.strftime('%d/%m')}",
                "starts_at": datetime.combine(w_date, time(13, 0), tzinfo=VN_TZ),
                "ends_at": datetime.combine(w_date, time(21, 0), tzinfo=VN_TZ),
            })

            curr_att_id = next_att_id
            next_att_id += 1

            if day == 1:
                # In 12:00, Out 20:00 (Early 60m)
                cin = datetime.combine(w_date, time(12, 0, 0), tzinfo=VN_TZ)
                cout = datetime.combine(w_date, time(20, 0, 0), tzinfo=VN_TZ)
                att_records.append({
                    "attendance_id": curr_att_id, "employee_id": 3, "store_id": 5, "shift_id": 2, "work_date": w_date,
                    "check_in_time": cin, "check_out_time": cout, "late_minutes": 0, "early_minutes": 60,
                    "overtime_hours": 0.0, "actual_work_hours": 7.0, "status": "EARLY",
                    "attendance_context": json.dumps({"schedule_status": "MATCHED", "actual": {"shift_id": 2, "shift_name": "Ca chiều bán lẻ", "start_time": "13:00:00", "end_time": "21:00:00", "work_hours": 7.0}})
                })
            elif day == 2:
                # In 13:00, Out 21:00 (Chuẩn ca)
                cin = datetime.combine(w_date, time(13, 0, 0), tzinfo=VN_TZ)
                cout = datetime.combine(w_date, time(21, 0, 0), tzinfo=VN_TZ)
                att_records.append({
                    "attendance_id": curr_att_id, "employee_id": 3, "store_id": 5, "shift_id": 2, "work_date": w_date,
                    "check_in_time": cin, "check_out_time": cout, "late_minutes": 0, "early_minutes": 0,
                    "overtime_hours": 0.0, "actual_work_hours": 7.0, "status": "NORMAL",
                    "attendance_context": json.dumps({"schedule_status": "MATCHED", "actual": {"shift_id": 2, "shift_name": "Ca chiều bán lẻ", "start_time": "13:00:00", "end_time": "21:00:00", "work_hours": 7.0}})
                })
            elif day == 3:
                # In 14:00, Out 22:00 (Trễ 60m -> phạt 50k - Tự ở lại bù giờ chỉ đủ 7h định mức, ngoài ca thô = 0.0h)
                cin = datetime.combine(w_date, time(14, 0, 0), tzinfo=VN_TZ)
                cout = datetime.combine(w_date, time(22, 0, 0), tzinfo=VN_TZ)
                att_records.append({
                    "attendance_id": curr_att_id, "employee_id": 3, "store_id": 5, "shift_id": 2, "work_date": w_date,
                    "check_in_time": cin, "check_out_time": cout, "late_minutes": 60, "early_minutes": 0,
                    "overtime_hours": 0.0, "actual_work_hours": 7.0, "status": "LATE",
                    "attendance_context": json.dumps({"schedule_status": "MATCHED", "actual": {"shift_id": 2, "shift_name": "Ca chiều bán lẻ", "start_time": "13:00:00", "end_time": "21:00:00", "work_hours": 7.0}})
                })
            elif day == 4:
                # In 15:00, Out 23:00 (Trễ 120m -> phạt 50k - Tự ở lại bù giờ chỉ đủ 7h định mức, ngoài ca thô = 0.0h)
                cin = datetime.combine(w_date, time(15, 0, 0), tzinfo=VN_TZ)
                cout = datetime.combine(w_date, time(23, 0, 0), tzinfo=VN_TZ)
                att_records.append({
                    "attendance_id": curr_att_id, "employee_id": 3, "store_id": 5, "shift_id": 2, "work_date": w_date,
                    "check_in_time": cin, "check_out_time": cout, "late_minutes": 120, "early_minutes": 0,
                    "overtime_hours": 0.0, "actual_work_hours": 7.0, "status": "LATE",
                    "attendance_context": json.dumps({"schedule_status": "MATCHED", "actual": {"shift_id": 2, "shift_name": "Ca chiều bán lẻ", "start_time": "13:00:00", "end_time": "21:00:00", "work_hours": 7.0}})
                })
            elif day == 6:
                # In 13:08, Out 21:00 (Trễ 8m <= 15m Ân hạn)
                cin = datetime.combine(w_date, time(13, 8, 0), tzinfo=VN_TZ)
                cout = datetime.combine(w_date, time(21, 0, 0), tzinfo=VN_TZ)
                att_records.append({
                    "attendance_id": curr_att_id, "employee_id": 3, "store_id": 5, "shift_id": 2, "work_date": w_date,
                    "check_in_time": cin, "check_out_time": cout, "late_minutes": 8, "early_minutes": 0,
                    "overtime_hours": 0.0, "actual_work_hours": 6.87, "status": "LATE",
                    "attendance_context": json.dumps({"schedule_status": "MATCHED", "actual": {"shift_id": 2, "shift_name": "Ca chiều bán lẻ", "start_time": "13:00:00", "end_time": "21:00:00", "work_hours": 7.0}})
                })
            elif day == 7:
                # In 13:12, Out 21:00 (Trễ 12m <= 15m Ân hạn)
                cin = datetime.combine(w_date, time(13, 12, 0), tzinfo=VN_TZ)
                cout = datetime.combine(w_date, time(21, 0, 0), tzinfo=VN_TZ)
                att_records.append({
                    "attendance_id": curr_att_id, "employee_id": 3, "store_id": 5, "shift_id": 2, "work_date": w_date,
                    "check_in_time": cin, "check_out_time": cout, "late_minutes": 12, "early_minutes": 0,
                    "overtime_hours": 0.0, "actual_work_hours": 6.8, "status": "LATE",
                    "attendance_context": json.dumps({"schedule_status": "MATCHED", "actual": {"shift_id": 2, "shift_name": "Ca chiều bán lẻ", "start_time": "13:00:00", "end_time": "21:00:00", "work_hours": 7.0}})
                })
            elif day == 15:
                # In 13:00, Out 23:00 (CÓ ĐƠN OT 2H TỪ 21:00 ĐẾN 23:00)
                cin = datetime.combine(w_date, time(13, 0, 0), tzinfo=VN_TZ)
                cout = datetime.combine(w_date, time(23, 0, 0), tzinfo=VN_TZ)
                att_records.append({
                    "attendance_id": curr_att_id, "employee_id": 3, "store_id": 5, "shift_id": 2, "work_date": w_date,
                    "check_in_time": cin, "check_out_time": cout, "late_minutes": 0, "early_minutes": 0,
                    "overtime_hours": 2.0, "actual_work_hours": 9.0, "status": "OVERTIME",
                    "attendance_context": json.dumps({"schedule_status": "MATCHED", "actual": {"shift_id": 2, "shift_name": "Ca chiều bán lẻ", "start_time": "13:00:00", "end_time": "21:00:00", "work_hours": 7.0}})
                })
                curr_ot_id = next_ot_id
                next_ot_id += 1
                ot_starts = datetime.combine(w_date, time(21, 0, 0), tzinfo=VN_TZ)
                ot_ends = datetime.combine(w_date, time(23, 0, 0), tzinfo=VN_TZ)
                ot_records.append({
                    "request_id": curr_ot_id, "employee_id": 3, "store_id": 5, "work_date": w_date,
                    "starts_at": ot_starts, "ends_at": ot_ends, "reason": "Tăng ca khóa sổ cửa hàng cuối ngày",
                    "created_by": 3, "status": "APPROVED", "reviewed_by": 2, "reviewed_at": now_vn,
                    "created_at": now_vn, "updated_at": now_vn, "request_type": "STANDARD"
                })
                rec_records.append({
                    "request_id": curr_ot_id, "employee_id": 3, "store_id": 5, "status": "VERIFIED",
                    "version": 1, "source_signature": f"REC_OT_{curr_ot_id}", "proposed_microseconds": 7200000000,
                    "verified_microseconds": 7200000000, "eligible_intervals": json.dumps([]), "attendance_ids": json.dumps([curr_att_id]),
                    "review_issues": json.dumps([]), "reviewed_by": 2, "reviewed_at": now_vn, "decision_reason": "Đối soát thành công",
                    "calculated_at": now_vn, "created_at": now_vn, "updated_at": now_vn
                })
            elif day == 18:
                # SHORT_SESSION (5 phút test máy) -> Cần HR rà soát
                cin = datetime.combine(w_date, time(13, 0, 0), tzinfo=VN_TZ)
                cout = datetime.combine(w_date, time(13, 5, 0), tzinfo=VN_TZ)
                att_records.append({
                    "attendance_id": curr_att_id, "employee_id": 3, "store_id": 5, "shift_id": 2, "work_date": w_date,
                    "check_in_time": cin, "check_out_time": cout, "late_minutes": 0, "early_minutes": 0,
                    "overtime_hours": 0.0, "actual_work_hours": 0.08, "status": "NORMAL",
                    "attendance_context": json.dumps({"schedule_status": "MATCHED", "actual": {"shift_id": 2, "shift_name": "Ca chiều bán lẻ", "start_time": "13:00:00", "end_time": "21:00:00", "work_hours": 7.0}})
                })
            elif day == 21:
                # Test nâng cao: Ca chiều 13:00 - 21:00 nhưng chấm công giờ ca sáng (In 08:00, Out 16:00)
                # Check-out lúc 16:00 so với ca chiều kết thúc 21:00 -> Về sớm 300p > 240p -> EXCESSIVE_EARLY, NEEDS_REVIEW, chuyển sang unreviewed_early_minutes = 300p
                cin = datetime.combine(w_date, time(8, 0, 0), tzinfo=VN_TZ)
                cout = datetime.combine(w_date, time(16, 0, 0), tzinfo=VN_TZ)
                att_records.append({
                    "attendance_id": curr_att_id, "employee_id": 3, "store_id": 5, "shift_id": 2, "work_date": w_date,
                    "check_in_time": cin, "check_out_time": cout, "late_minutes": 0, "early_minutes": 300,
                    "overtime_hours": 0.0, "actual_work_hours": 7.0, "status": "EARLY",
                    "attendance_context": json.dumps({"schedule_status": "MATCHED", "actual": {"shift_id": 2, "shift_name": "Ca chiều bán lẻ", "start_time": "13:00:00", "end_time": "21:00:00", "work_hours": 7.0}})
                })
            else:
                # Ngày thường đúng giờ 13:00 - 21:00
                cin = datetime.combine(w_date, time(12, 58, 0), tzinfo=VN_TZ)
                cout = datetime.combine(w_date, time(21, 2, 0), tzinfo=VN_TZ)
                att_records.append({
                    "attendance_id": curr_att_id, "employee_id": 3, "store_id": 5, "shift_id": 2, "work_date": w_date,
                    "check_in_time": cin, "check_out_time": cout, "late_minutes": 0, "early_minutes": 0,
                    "overtime_hours": 0.0, "actual_work_hours": 7.0, "status": "NORMAL",
                    "attendance_context": json.dumps({"schedule_status": "MATCHED", "actual": {"shift_id": 2, "shift_name": "Ca chiều bán lẻ", "start_time": "13:00:00", "end_time": "21:00:00", "work_hours": 7.0}})
                })

        # -------------------------------------------------------------
        # 3. HOÀNG THỊ EM (Emp #5, Store 5 - Tân Bình, Shift 1: 08:00 - 16:00)
        # Benchmark gương mẫu: 27 ngày công chuẩn giờ
        # Ngày 20: CÓ ĐƠN OT 1.5H (16:00 - 17:30) -> Checkin 08:00, Checkout 17:30 (đã duyệt & đối soát)
        # -------------------------------------------------------------
        for day in range(1, 32):
            w_date = date(2026, 7, day)
            if w_date.weekday() == 6:  # Chủ Nhật nghỉ
                continue

            curr_sched_id = next_sched_id
            next_sched_id += 1
            sched_records.append({
                "schedule_id": curr_sched_id,
                "employee_id": 5,
                "store_id": 5,
                "shift_id": 1,
                "work_date": w_date,
                "notes": f"Lịch phân ca sáng {w_date.strftime('%d/%m')}",
                "starts_at": datetime.combine(w_date, time(8, 0), tzinfo=VN_TZ),
                "ends_at": datetime.combine(w_date, time(16, 0), tzinfo=VN_TZ),
            })

            curr_att_id = next_att_id
            next_att_id += 1

            if day == 20:
                # CÓ ĐƠN OT 1.5H (16:00 - 17:30)
                cin = datetime.combine(w_date, time(7, 55, 0), tzinfo=VN_TZ)
                cout = datetime.combine(w_date, time(17, 30, 0), tzinfo=VN_TZ)
                att_records.append({
                    "attendance_id": curr_att_id, "employee_id": 5, "store_id": 5, "shift_id": 1, "work_date": w_date,
                    "check_in_time": cin, "check_out_time": cout, "late_minutes": 0, "early_minutes": 0,
                    "overtime_hours": 1.5, "actual_work_hours": 8.5, "status": "OVERTIME",
                    "attendance_context": json.dumps({"schedule_status": "MATCHED", "actual": {"shift_id": 1, "shift_name": "Ca sáng bán lẻ", "start_time": "08:00:00", "end_time": "16:00:00", "work_hours": 7.0}})
                })
                curr_ot_id = next_ot_id
                next_ot_id += 1
                ot_starts = datetime.combine(w_date, time(16, 0, 0), tzinfo=VN_TZ)
                ot_ends = datetime.combine(w_date, time(17, 30, 0), tzinfo=VN_TZ)
                ot_records.append({
                    "request_id": curr_ot_id, "employee_id": 5, "store_id": 5, "work_date": w_date,
                    "starts_at": ot_starts, "ends_at": ot_ends, "reason": "Tăng ca chốt doanh thu quầy thu ngân",
                    "created_by": 5, "status": "APPROVED", "reviewed_by": 2, "reviewed_at": now_vn,
                    "created_at": now_vn, "updated_at": now_vn, "request_type": "STANDARD"
                })
                rec_records.append({
                    "request_id": curr_ot_id, "employee_id": 5, "store_id": 5, "status": "VERIFIED",
                    "version": 1, "source_signature": f"REC_OT_{curr_ot_id}", "proposed_microseconds": 5400000000,
                    "verified_microseconds": 5400000000, "eligible_intervals": json.dumps([]), "attendance_ids": json.dumps([curr_att_id]),
                    "review_issues": json.dumps([]), "reviewed_by": 2, "reviewed_at": now_vn, "decision_reason": "Đối soát thành công",
                    "calculated_at": now_vn, "created_at": now_vn, "updated_at": now_vn
                })
            else:
                cin = datetime.combine(w_date, time(7, 55, 0), tzinfo=VN_TZ)
                cout = datetime.combine(w_date, time(16, 5, 0), tzinfo=VN_TZ)
                att_records.append({
                    "attendance_id": curr_att_id, "employee_id": 5, "store_id": 5, "shift_id": 1, "work_date": w_date,
                    "check_in_time": cin, "check_out_time": cout, "late_minutes": 0, "early_minutes": 0,
                    "overtime_hours": 0.0, "actual_work_hours": 7.0, "status": "NORMAL",
                    "attendance_context": json.dumps({"schedule_status": "MATCHED", "actual": {"shift_id": 1, "shift_name": "Ca sáng bán lẻ", "start_time": "08:00:00", "end_time": "16:00:00", "work_hours": 7.0}})
                })

        print(f"Total schedules to insert: {len(sched_records)}")
        print(f"Total attendances to insert: {len(att_records)}")
        print(f"Total overtime requests to insert: {len(ot_records)}")
        print(f"Total overtime reconciliations to insert: {len(rec_records)}")

        # Bulk insert schedules
        for s in sched_records:
            await conn.execute(text("""
                INSERT INTO work_schedules (schedule_id, employee_id, store_id, shift_id, work_date, notes, starts_at, ends_at)
                VALUES (:schedule_id, :employee_id, :store_id, :shift_id, :work_date, :notes, :starts_at, :ends_at)
            """), s)

        # Bulk insert attendances
        for a in att_records:
            await conn.execute(text("""
                INSERT INTO attendances (attendance_id, employee_id, store_id, shift_id, work_date, check_in_time, check_out_time, late_minutes, early_minutes, overtime_hours, actual_work_hours, status, attendance_context)
                VALUES (:attendance_id, :employee_id, :store_id, :shift_id, :work_date, :check_in_time, :check_out_time, :late_minutes, :early_minutes, :overtime_hours, :actual_work_hours, :status, CAST(:attendance_context AS jsonb))
            """), a)

        # Bulk insert overtime requests
        for o in ot_records:
            await conn.execute(text("""
                INSERT INTO overtime_requests (request_id, employee_id, store_id, work_date, starts_at, ends_at, reason, created_by, status, reviewed_by, reviewed_at, created_at, updated_at, request_type)
                VALUES (:request_id, :employee_id, :store_id, :work_date, :starts_at, :ends_at, :reason, :created_by, :status, :reviewed_by, :reviewed_at, :created_at, :updated_at, :request_type)
            """), o)

        # Bulk insert overtime reconciliations
        for r in rec_records:
            await conn.execute(text("""
                INSERT INTO overtime_reconciliations (request_id, employee_id, store_id, status, version, source_signature, proposed_microseconds, verified_microseconds, eligible_intervals, attendance_ids, review_issues, reviewed_by, reviewed_at, decision_reason, calculated_at, created_at, updated_at)
                VALUES (:request_id, :employee_id, :store_id, :status, :version, :source_signature, :proposed_microseconds, :verified_microseconds, CAST(:eligible_intervals AS jsonb), CAST(:attendance_ids AS jsonb), CAST(:review_issues AS jsonb), :reviewed_by, :reviewed_at, :decision_reason, :calculated_at, :created_at, :updated_at)
            """), r)

        await conn.commit()
        print("=== COMMITTED JULY 2026 TEST DATA WITH OT SCHEMAS SUCCESSFULLY ===")

async def test_monthly():
    # Verify by calling endpoint logic directly
    async with engine.connect() as conn:
        r = await conn.execute(text("SELECT count(*) FROM attendances WHERE work_date >= '2026-07-01' AND work_date <= '2026-07-31'"))
        att_c = r.scalar()
        r = await conn.execute(text("SELECT count(*) FROM overtime_requests WHERE work_date >= '2026-07-01' AND work_date <= '2026-07-31'"))
        ot_c = r.scalar()
        r = await conn.execute(text("SELECT count(*) FROM overtime_reconciliations WHERE request_id IN (SELECT request_id FROM overtime_requests WHERE work_date >= '2026-07-01' AND work_date <= '2026-07-31')"))
        rec_c = r.scalar()
        print(f"VERIFICATION: attendances={att_c}, overtime_requests={ot_c}, overtime_reconciliations={rec_c}")

async def main():
    await seed_july()
    await test_monthly()

if __name__ == '__main__':
    asyncio.run(main())
