"""
Test suite for ATT-UI-04 — HR REVIEW & RESOLUTION FOR ABNORMAL ATTENDANCE
Covers all required test scenarios in Section 10:
1. Ca 08:00–16:00, check-in 08:10 (grace late 10m <= 15m)
2. Ca 08:00–16:00, check-in 08:16 (valid late 16m > 15m)
3. Ca 08:00–16:00, check-in 13:00 (excessive late 300m > 240m, needs review)
4. Ca 13:00–21:00, check-in 13:00 (on time, normal)
5. Ca 13:00–21:00, check-in 08:00 (excessive early check-in 300m > 240m, needs review)
6. Ca sáng but shift reassigned (SHIFT_REASSIGNED)
7. Short session (SHORT_SESSION <= 15m)
8. Open session without checkout (OPEN_SESSION)
9. Overdue open session > 7 days (OVERDUE_OPEN_SESSION & payroll_hold)
10. Resolution CONFIRMED_LATE (re-evaluates as valid late, does not touch payroll)
11. Resolution EXCLUDED_INVALID (raw data kept, excluded from actual hours)
12. Resolution NEEDS_MORE_INFO (kept pending, payroll_hold)
13. Concurrency check (optimistic lock returns 409 on version mismatch)
14. RBAC check (unauthorized user returns 403, store manager scoped)
15. Audit trail verification (session audit_history & DB audit_logs)
"""

import asyncio
import json
import sys
import unittest
from datetime import date, datetime, timedelta, timezone

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

from app.api.v1.endpoints.operations import (
    enrich_session_record,
    is_valid_late_session,
    is_grace_late_session,
    is_valid_early_session,
    list_work_shifts,
    resolve_attendance_session,
    ResolveSessionRequest,
    EXCESSIVE_LATE_THRESHOLD_MINUTES,
    EXCESSIVE_EARLY_THRESHOLD_MINUTES,
    SHORT_SESSION_THRESHOLD_MINUTES,
    OVERDUE_OPEN_SESSION_DAYS,
    DEFAULT_LATE_TOLERANCE_MINUTES,
    DEFAULT_LATE_PENALTY_AMOUNT,
)
from app.core.database import AsyncSessionLocal, engine
from fastapi import HTTPException
from sqlalchemy import text

VIETNAM_TZ = timezone(timedelta(hours=7))


class TestAttUi04(unittest.TestCase):

    def setUp(self):
        self.base_session = {
            "attendance_id": 9991,
            "employee_id": 10,
            "store_id": 1,
            "shift_id": 1,
            "work_date": date(2026, 11, 1),
            "check_in_time": datetime(2026, 11, 1, 8, 10, tzinfo=VIETNAM_TZ),
            "check_out_time": datetime(2026, 11, 1, 16, 0, tzinfo=VIETNAM_TZ),
            "actual_work_hours": 7.83,
            "late_minutes": 10,
            "early_minutes": 0,
            "overtime_hours": 0.0,
            "schedule_status": "MATCHED",
            "shift_name": "Ca sáng bán lẻ",
            "scheduled_start": "08:00:00",
            "scheduled_end": "16:00:00",
            "attendance_context": {}
        }

    def test_01_grace_late_session_8_10(self):
        """1. Ca 08:00–16:00, check-in 08:10 (trễ 10p <= 15p: Ân hạn, không phạt)."""
        s = dict(self.base_session, late_minutes=10)
        enrich_session_record(s)
        self.assertFalse(s["is_valid_late"])
        self.assertTrue(s["is_grace_late"])
        self.assertEqual(s["session_quality_status"], "NORMAL")
        self.assertFalse(s["needs_hr_review"])

    def test_02_valid_late_session_8_16(self):
        """2. Ca 08:00–16:00, check-in 08:16 (trễ 16p > 15p: Vi phạm hợp lệ, tính 1 lần phạt)."""
        s = dict(self.base_session, late_minutes=16,
                 check_in_time=datetime(2026, 11, 1, 8, 16, tzinfo=VIETNAM_TZ))
        enrich_session_record(s)
        self.assertTrue(s["is_valid_late"])
        self.assertFalse(s["is_grace_late"])
        self.assertEqual(s["session_quality_status"], "NORMAL")
        self.assertFalse(s["needs_hr_review"])

    def test_03_excessive_late_session_13_00(self):
        """3. Ca 08:00–16:00, check-in 13:00 (trễ 300p > 240p EXCESSIVE_LATE: Chờ HR rà soát)."""
        s = dict(self.base_session, late_minutes=300,
                 check_in_time=datetime(2026, 11, 1, 13, 0, tzinfo=VIETNAM_TZ))
        enrich_session_record(s)
        self.assertFalse(s["is_valid_late"])
        self.assertEqual(s["session_quality_status"], "NEEDS_REVIEW")
        self.assertIn("EXCESSIVE_LATE", s["quality_flags"])
        self.assertTrue(s["needs_hr_review"])
        self.assertEqual(s["review_status"], "PENDING")

    def test_04_on_time_afternoon_shift_13_00(self):
        """4. Ca 13:00–21:00, check-in 13:00 (đúng giờ: NORMAL)."""
        s = dict(self.base_session, shift_id=2, shift_name="Ca chiều bán lẻ",
                 scheduled_start="13:00:00", scheduled_end="21:00:00",
                 check_in_time=datetime(2026, 11, 1, 13, 0, tzinfo=VIETNAM_TZ),
                 check_out_time=datetime(2026, 11, 1, 21, 0, tzinfo=VIETNAM_TZ),
                 late_minutes=0, early_minutes=0)
        enrich_session_record(s)
        self.assertEqual(s["session_quality_status"], "NORMAL")
        self.assertFalse(s["is_valid_late"])
        self.assertFalse(s["needs_hr_review"])

    def test_05_excessive_early_checkin_08_00(self):
        """5. Ca 13:00–21:00, check-in 08:00 (sớm 300p > 240p EXCESSIVE_EARLY: Chờ HR)."""
        s = dict(self.base_session, shift_id=2, shift_name="Ca chiều bán lẻ",
                 scheduled_start="13:00:00", scheduled_end="21:00:00",
                 check_in_time=datetime(2026, 11, 1, 8, 0, tzinfo=VIETNAM_TZ),
                 check_out_time=datetime(2026, 11, 1, 21, 0, tzinfo=VIETNAM_TZ),
                 late_minutes=0, early_minutes=300)
        enrich_session_record(s)
        self.assertEqual(s["session_quality_status"], "NEEDS_REVIEW")
        self.assertIn("EXCESSIVE_EARLY", s["quality_flags"])
        self.assertTrue(s["needs_hr_review"])

    def test_06_short_session_not_defaulted_trash(self):
        """6. Phiên ngắn <= 15m: Đánh dấu SHORT_SESSION, không tự kết luận rác, chờ HR."""
        s = dict(self.base_session,
                 check_in_time=datetime(2026, 11, 1, 8, 0, tzinfo=VIETNAM_TZ),
                 check_out_time=datetime(2026, 11, 1, 8, 10, tzinfo=VIETNAM_TZ),
                 raw_duration_minutes=10, actual_work_hours=0.17)
        enrich_session_record(s)
        self.assertEqual(s["session_quality_status"], "SHORT_SESSION")
        self.assertIn("SHORT_SESSION", s["quality_flags"])
        self.assertTrue(s["needs_hr_review"])
        self.assertFalse(s["is_valid_late"])

    def test_07_open_session_within_7_days(self):
        """7. Phiên OPEN_SESSION trong vòng 7 ngày: Chờ HR, không tự checkout."""
        today = date.today()
        s = dict(self.base_session, work_date=today,
                 check_in_time=datetime(today.year, today.month, today.day, 8, 0, tzinfo=VIETNAM_TZ),
                 check_out_time=None)
        enrich_session_record(s)
        self.assertEqual(s["session_quality_status"], "OPEN_SESSION")
        self.assertIn("OPEN_SESSION", s["quality_flags"])
        self.assertNotIn("OVERDUE_OPEN_SESSION", s["quality_flags"])
        self.assertFalse(s.get("is_overdue_open_session"))

    def test_08_open_session_overdue_7_days(self):
        """8. Phiên OPEN_SESSION quá 7 ngày: Gắn nhãn OVERDUE_OPEN_SESSION và payroll_hold."""
        old_date = date.today() - timedelta(days=10)
        s = dict(self.base_session, work_date=old_date,
                 check_in_time=datetime(old_date.year, old_date.month, old_date.day, 8, 0, tzinfo=VIETNAM_TZ),
                 check_out_time=None)
        enrich_session_record(s)
        self.assertEqual(s["session_quality_status"], "OPEN_SESSION")
        self.assertIn("OVERDUE_OPEN_SESSION", s["quality_flags"])
        self.assertTrue(s["is_overdue_open_session"])
        self.assertTrue(s["payroll_hold"])

    def test_09_resolution_confirmed_late_decision(self):
        """9. Quyết định CONFIRMED_LATE: Giữ nguyên session_quality_status, chuyển is_valid_late=True."""
        s = dict(self.base_session, late_minutes=300,
                 check_in_time=datetime(2026, 11, 1, 13, 0, tzinfo=VIETNAM_TZ),
                 attendance_context={
                     "hr_review": {
                         "review_status": "RESOLVED",
                         "review_decision": "CONFIRMED_LATE",
                         "reason": "Nhân viên xác nhận đi muộn do sự cố phương tiện",
                         "reviewed_by_name": "HR Manager",
                         "version": 1
                     }
                 })
        enrich_session_record(s)
        # Quality status remains technically NEEDS_REVIEW, not overwritten to NORMAL
        self.assertEqual(s["session_quality_status"], "NEEDS_REVIEW")
        self.assertEqual(s["review_decision"], "CONFIRMED_LATE")
        self.assertEqual(s["review_status"], "RESOLVED")
        self.assertTrue(s["is_valid_late"])
        self.assertFalse(s["needs_hr_review"])

    def test_10_resolution_excluded_invalid_decision(self):
        """10. Quyết định EXCLUDED_INVALID: Không xóa raw data, loại khỏi giờ công (actual_work_hours=0)."""
        s = dict(self.base_session, actual_work_hours=7.5,
                 attendance_context={
                     "hr_review": {
                         "review_status": "RESOLVED",
                         "review_decision": "EXCLUDED_INVALID",
                         "reason": "Máy chấm công quẹt thử nghiệm tại quầy thu ngân",
                         "reviewed_by_name": "HR Manager",
                         "version": 1
                     }
                 })
        enrich_session_record(s)
        self.assertEqual(s["review_decision"], "EXCLUDED_INVALID")
        self.assertTrue(s["is_excluded"])
        self.assertEqual(s["actual_work_hours"], 0.0)
        self.assertFalse(s["is_valid_late"])
        self.assertFalse(s["needs_hr_review"])

    def test_11_resolution_needs_more_info_decision(self):
        """11. Quyết định NEEDS_MORE_INFO: Giữ trạng thái chờ, gắn cờ payroll_hold."""
        s = dict(self.base_session, late_minutes=300,
                 attendance_context={
                     "hr_review": {
                         "review_status": "NEEDS_MORE_INFO",
                         "review_decision": "NEEDS_MORE_INFO",
                         "reason": "Yêu cầu nhân viên nộp biên bản giải trình cửa hàng trưởng",
                         "version": 1
                     }
                 })
        enrich_session_record(s)
        self.assertEqual(s["review_status"], "NEEDS_MORE_INFO")
        self.assertTrue(s["needs_hr_review"])
        self.assertTrue(s["payroll_hold"])
        self.assertFalse(s["is_valid_late"])


# ======================================================================
# Live DB Integration Tests (Endpoints, RBAC, Concurrency & Audit Logs)
# ======================================================================

async def run_live_db_tests():
    async with AsyncSessionLocal() as db:
        print("\n--- RUNNING LIVE DB & API INTEGRATION TESTS FOR ATT-UI-04 ---")

        # 1. Test GET /work-shifts
        shifts_res = await list_work_shifts(user={"roles": ["HR_MANAGER"]}, db=db)
        shifts = shifts_res.get("shifts") or []
        assert len(shifts) >= 4, f"Expected >= 4 shifts, found {len(shifts)}"
        shift_names = [s["shift_name"] for s in shifts]
        print(f"[PASS] GET /work-shifts returned {len(shifts)} shifts: {', '.join(shift_names[:3])}...")

        # 2. Setup a test attendance session in database
        # Find or create a test employee with store
        emp = (await db.execute(text("SELECT employee_id, store_id FROM employees WHERE store_id IS NOT NULL LIMIT 1"))).mappings().first()
        emp_id = emp["employee_id"]
        store_id = emp["store_id"]
        test_date = date(2026, 7, 28)

        # Clean prior test rows
        await db.execute(text("DELETE FROM attendances WHERE notes = 'TEST_ATT_UI_04_SESSION'"))
        await db.execute(text("""
            SELECT setval(pg_get_serial_sequence('attendances', 'attendance_id'), COALESCE(MAX(attendance_id), 1) + 1)
            FROM attendances
        """))
        await db.commit()

        # Insert test abnormal attendance session (late 300 minutes, shift 1)
        res = await db.execute(text("""
            INSERT INTO attendances (
                employee_id, store_id, shift_id, work_date,
                check_in_time, check_out_time, actual_work_hours,
                late_minutes, early_minutes, overtime_hours,
                status, notes, attendance_context, created_at, updated_at
            ) VALUES (
                :emp_id, :store_id, 1, :wdate,
                '2026-07-28 13:00:00+07', '2026-07-28 16:00:00+07', 3.0,
                300, 0, 0.0,
                'LATE', 'TEST_ATT_UI_04_SESSION',
                '{"schedule_status": "MATCHED"}', NOW(), NOW()
            ) RETURNING attendance_id
        """), {"emp_id": emp_id, "store_id": store_id, "wdate": test_date})
        test_session_id = res.scalar_one()
        await db.commit()
        print(f"[PASS] Created test abnormal session #{test_session_id} (check-in 13:00 for Ca Sáng, late 300m)")

        # 3. Test RBAC: Unauthorized user
        try:
            unauth_user = {"roles": ["EMPLOYEE"], "user_id": 999}
            await resolve_attendance_session(
                session_id=test_session_id,
                body=ResolveSessionRequest(decision="CONFIRMED_LATE", reason="Test unauthorized"),
                user=unauth_user,
                db=db
            )
            assert False, "Should have raised 403 Forbidden for EMPLOYEE"
        except HTTPException as e:
            assert e.status_code == 403
            print(f"[PASS] RBAC enforced: EMPLOYEE received HTTP 403 Forbidden ({e.detail})")

        # 4. Test RBAC: Store manager of different store
        try:
            other_sm = {"roles": ["STORE_MANAGER"], "user_id": 888, "store_id": store_id + 999}
            await resolve_attendance_session(
                session_id=test_session_id,
                body=ResolveSessionRequest(decision="CONFIRMED_LATE", reason="Wrong store test"),
                user=other_sm,
                db=db
            )
            assert False, "Should have raised 403 for mismatched store manager"
        except HTTPException as e:
            assert e.status_code == 403
            print(f"[PASS] RBAC enforced: Store Manager of different store received HTTP 403 ({e.detail})")

        # 5. Test HR Resolution: CONFIRMED_LATE
        hr_user = {"roles": ["HR_MANAGER"], "user_id": 1, "full_name": "Phạm Quản Trị HR"}
        resolve_res_1 = await resolve_attendance_session(
            session_id=test_session_id,
            body=ResolveSessionRequest(
                decision="CONFIRMED_LATE",
                reason="Nhân viên xác nhận đi muộn do ngập đường, biên bản số 102/BB-CH",
                version=0
            ),
            user=hr_user,
            db=db
        )
        assert resolve_res_1["success"] is True
        up_s1 = resolve_res_1["updated_session"]
        assert up_s1["review_decision"] == "CONFIRMED_LATE"
        assert up_s1["is_valid_late"] is True
        assert up_s1["needs_hr_review"] is False
        assert up_s1["session_quality_status"] == "NEEDS_REVIEW" # technical status preserved!
        print(f"[PASS] Action A: CONFIRMED_LATE successfully executed. is_valid_late=True, needs_hr_review=False.")

        # 6. Test Optimistic Concurrency: Attempt update with stale version
        try:
            await resolve_attendance_session(
                session_id=test_session_id,
                body=ResolveSessionRequest(
                    decision="EXCLUDED_INVALID",
                    reason="Stale conflict test",
                    version=0 # Stale! DB is now at version 1
                ),
                user=hr_user,
                db=db
            )
            assert False, "Should have raised 409 Conflict for stale version"
        except HTTPException as e:
            assert e.status_code == 409
            print(f"[PASS] Concurrency check: Stale version 0 received HTTP 409 Conflict ({e.detail})")

        # 7. Test Action B: SHIFT_REASSIGNED to Ca Chiều (shift 2: 13:00 - 21:00)
        # Check-in 13:00 for Ca Chiều -> on time (late 0 mins)!
        resolve_res_2 = await resolve_attendance_session(
            session_id=test_session_id,
            body=ResolveSessionRequest(
                decision="SHIFT_REASSIGNED",
                new_shift_id=2,
                reason="Điều chỉnh sang Ca Chiều theo thỏa thuận đổi ca đã phê duyệt",
                version=1
            ),
            user=hr_user,
            db=db
        )
        assert resolve_res_2["success"] is True
        up_s2 = resolve_res_2["updated_session"]
        assert up_s2["shift_id"] == 2
        assert up_s2["review_decision"] == "SHIFT_REASSIGNED"
        assert up_s2["late_minutes"] == 0 # recalculated against new shift!
        assert up_s2["is_valid_late"] is False
        print(f"[PASS] Action B: SHIFT_REASSIGNED to shift 2 executed. Recalculated late_minutes={up_s2['late_minutes']} (on time).")

        # 8. Test Action C: EXCLUDED_INVALID
        resolve_res_3 = await resolve_attendance_session(
            session_id=test_session_id,
            body=ResolveSessionRequest(
                decision="EXCLUDED_INVALID",
                reason="Phiên chấm công test máy",
                version=2
            ),
            user=hr_user,
            db=db
        )
        assert resolve_res_3["success"] is True
        up_s3 = resolve_res_3["updated_session"]
        assert up_s3["review_decision"] == "EXCLUDED_INVALID"
        assert up_s3["is_excluded"] is True
        assert up_s3["actual_work_hours"] == 0.0
        print(f"[PASS] Action C: EXCLUDED_INVALID executed. is_excluded=True, actual_work_hours=0.0.")

        # 9. Verify Audit Trail in Database (audit_logs table and session context)
        audit_row = (await db.execute(text("""
            SELECT log_id, action, entity_name, entity_id, user_id, old_values, new_values, created_at
            FROM audit_logs
            WHERE entity_name = 'attendances' AND entity_id = :sid
            ORDER BY log_id DESC LIMIT 1
        """), {"sid": str(test_session_id)})).mappings().first()

        assert audit_row is not None
        assert audit_row["action"] == "ATTENDANCE_SESSION_RESOLVE"
        assert audit_row["entity_id"] == str(test_session_id)
        print(f"[PASS] DB Audit Log verified: log_id={audit_row['log_id']}, action={audit_row['action']}, entity_id={audit_row['entity_id']}.")

        # Check session audit_history in attendance_context
        ctx_row = (await db.execute(text("SELECT attendance_context FROM attendances WHERE attendance_id = :sid"),
                                    {"sid": test_session_id})).mappings().first()
        ctx_val = ctx_row["attendance_context"]
        if isinstance(ctx_val, str): ctx_val = json.loads(ctx_val)
        audit_history = ctx_val.get("audit_history") or []
        assert len(audit_history) == 3 # 3 resolutions recorded in sequence!
        print(f"[PASS] Session audit_history preserved: {len(audit_history)} chronological review entries recorded.")

        # Cleanup test row
        await db.execute(text("DELETE FROM attendances WHERE attendance_id = :sid"), {"sid": test_session_id})
        await db.commit()
        print(f"[PASS] Cleaned up temporary test session #{test_session_id}.")


if __name__ == "__main__":
    suite = unittest.TestLoader().loadTestsFromTestCase(TestAttUi04)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    if not result.wasSuccessful():
        sys.exit(1)

    asyncio.run(run_live_db_tests())
    print("\n>>> ALL 15 ATT-UI-04 TEST SCENARIOS + LIVE DB INTEGRATION TESTS PASSED 100%! <<<")
