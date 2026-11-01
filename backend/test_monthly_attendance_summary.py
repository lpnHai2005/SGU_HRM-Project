"""
Test suite for ATT-UI-03A — BỔ SUNG SỐ NGÀY ĐI TRỄ, SỐ PHIÊN VÀ TỔNG PHÚT ĐI TRỄ
Covers all 10 mandatory test scenarios specified in ATT-UI-03A §9:
1. Một ngày có một phiên đi trễ: 1 ngày, 1 phiên.
2. Một ngày có hai phiên đi trễ: 1 ngày, 2 phiên.
3. Hai ngày khác nhau có hai phiên đi trễ: 2 ngày, 2 phiên.
4. Phiên không khớp lịch (SHIFT_MISMATCH / UNSCHEDULED): không được tính là đi trễ hợp lệ.
5. Phiên một phút bất thường (SHORT_SESSION <= 15m): cần HR xác minh, không tính trễ hợp lệ.
6. Phiên thiếu checkout (OPEN_SESSION): không tự kết luận, cần HR rà soát.
7. Ca qua đêm: tính đúng work_date của phiên.
8. Tránh nhân bản do JOIN: không tăng số ngày hoặc số phiên.
9. Dữ liệu NULL: không đổi thành 0 sai nghĩa (raw_duration, outside hours).
10. Bộ lọc tháng: thống kê đúng kỳ (2026-10 vs 2026-09).
"""

import sys
import unittest
from datetime import date, datetime, timedelta, timezone

from app.api.v1.endpoints.operations import (
    enrich_session_record,
    is_valid_late_session,
    is_valid_early_session,
    PROJECT_GRACE_PERIOD_MINUTES,
)

VIETNAM_TZ = timezone(timedelta(hours=7))

class TestAttUi03a(unittest.TestCase):

    def setUp(self):
        self.base_valid_session = {
            "attendance_id": 100,
            "employee_id": 10,
            "work_date": date(2026, 10, 5),
            "check_in_time": datetime(2026, 10, 5, 8, 20, tzinfo=VIETNAM_TZ),
            "check_out_time": datetime(2026, 10, 5, 16, 0, tzinfo=VIETNAM_TZ),
            "actual_work_hours": 7.67,
            "late_minutes": 20, # > 15 grace period
            "early_minutes": 0,
            "overtime_hours": 0.0,
            "schedule_status": "MATCHED",
            "shift_name": "Ca sáng",
            "scheduled_start": "08:00:00",
            "scheduled_end": "16:00:00",
        }

    def test_01_single_day_single_late_session(self):
        """1. Một ngày có một phiên đi trễ: 1 ngày, 1 phiên."""
        s = dict(self.base_valid_session)
        enrich_session_record(s)
        self.assertTrue(s["is_valid_late"])
        self.assertFalse(s["needs_hr_review"])

        sessions = [s]
        valid_late = [r for r in sessions if r["is_valid_late"]]
        late_days = len({r["work_date"] for r in valid_late})
        late_sessions = len(valid_late)
        late_minutes = sum(r["late_minutes"] for r in valid_late)

        self.assertEqual(late_days, 1)
        self.assertEqual(late_sessions, 1)
        self.assertEqual(late_minutes, 20)

    def test_02_single_day_two_late_sessions(self):
        """2. Một ngày có hai phiên đi trễ: 1 ngày, 2 phiên."""
        s1 = dict(self.base_valid_session, attendance_id=101, late_minutes=25)
        s2 = dict(self.base_valid_session, attendance_id=102, late_minutes=30,
                  check_in_time=datetime(2026, 10, 5, 17, 30, tzinfo=VIETNAM_TZ),
                  check_out_time=datetime(2026, 10, 5, 21, 30, tzinfo=VIETNAM_TZ))
        enrich_session_record(s1)
        enrich_session_record(s2)

        self.assertTrue(s1["is_valid_late"])
        self.assertTrue(s2["is_valid_late"])

        sessions = [s1, s2]
        valid_late = [r for r in sessions if r["is_valid_late"]]
        late_days = len({r["work_date"] for r in valid_late})
        late_sessions = len(valid_late)
        late_minutes = sum(r["late_minutes"] for r in valid_late)

        self.assertEqual(late_days, 1) # Same work_date
        self.assertEqual(late_sessions, 2)
        self.assertEqual(late_minutes, 55)

    def test_03_two_days_two_late_sessions(self):
        """3. Hai ngày khác nhau có hai phiên đi trễ: 2 ngày, 2 phiên."""
        s1 = dict(self.base_valid_session, attendance_id=103, work_date=date(2026, 10, 5), late_minutes=20)
        s2 = dict(self.base_valid_session, attendance_id=104, work_date=date(2026, 10, 6), late_minutes=35)
        enrich_session_record(s1)
        enrich_session_record(s2)

        sessions = [s1, s2]
        valid_late = [r for r in sessions if r["is_valid_late"]]
        late_days = len({r["work_date"] for r in valid_late})
        late_sessions = len(valid_late)
        late_minutes = sum(r["late_minutes"] for r in valid_late)

        self.assertEqual(late_days, 2)
        self.assertEqual(late_sessions, 2)
        self.assertEqual(late_minutes, 55)

    def test_04_schedule_mismatch_not_valid_late(self):
        """4. Phiên không khớp lịch (SHIFT_MISMATCH / UNSCHEDULED): không được tính là đi trễ hợp lệ."""
        s_mismatch = dict(self.base_valid_session, schedule_status="SHIFT_MISMATCH", late_minutes=45)
        s_unscheduled = dict(self.base_valid_session, schedule_status="UNSCHEDULED", late_minutes=30)
        enrich_session_record(s_mismatch)
        enrich_session_record(s_unscheduled)

        self.assertFalse(s_mismatch["is_valid_late"])
        self.assertTrue(s_mismatch["needs_hr_review"])
        self.assertEqual(s_mismatch["session_quality_status"], "OUTSIDE_SHIFT")

        self.assertFalse(s_unscheduled["is_valid_late"])
        self.assertTrue(s_unscheduled["needs_hr_review"])
        self.assertEqual(s_unscheduled["session_quality_status"], "OUTSIDE_SHIFT")

    def test_05_one_minute_short_session_needs_review(self):
        """5. Phiên một phút bất thường (như Phạm Quốc Dũng 10/10/2026): cần HR xác minh."""
        s = dict(
            self.base_valid_session,
            work_date=date(2026, 10, 10),
            check_in_time=datetime(2026, 10, 10, 19, 9, tzinfo=VIETNAM_TZ),
            check_out_time=datetime(2026, 10, 10, 19, 10, tzinfo=VIETNAM_TZ), # 1 min duration
            late_minutes=670, # fake hundreds of minutes
            actual_work_hours=0.02
        )
        enrich_session_record(s)

        self.assertFalse(s["is_valid_late"])
        self.assertTrue(s["needs_hr_review"])
        self.assertEqual(s["session_quality_status"], "SHORT_SESSION")
        self.assertIn("SHORT_SESSION", s["quality_flags"])
        self.assertEqual(s["raw_duration_minutes"], 1)

    def test_06_missing_checkout_open_session(self):
        """6. Phiên thiếu checkout: không tự kết luận, cần HR rà soát."""
        s = dict(
            self.base_valid_session,
            check_out_time=None,
            late_minutes=30
        )
        enrich_session_record(s)

        self.assertFalse(s["is_valid_late"])
        self.assertTrue(s["needs_hr_review"])
        self.assertEqual(s["session_quality_status"], "OPEN_SESSION")
        self.assertIn("OPEN_SESSION", s["quality_flags"])

    def test_07_overnight_shift_preserves_work_date(self):
        """7. Ca qua đêm: tính đúng work_date, không lấy ngày của server hay check-out."""
        s = dict(
            self.base_valid_session,
            work_date=date(2026, 10, 15),
            check_in_time=datetime(2026, 10, 15, 22, 20, tzinfo=VIETNAM_TZ),
            check_out_time=datetime(2026, 10, 16, 6, 0, tzinfo=VIETNAM_TZ), # next day
            late_minutes=20,
            shift_name="Ca đêm",
            scheduled_start="22:00:00",
            scheduled_end="06:00:00"
        )
        enrich_session_record(s)

        self.assertTrue(s["is_valid_late"])
        self.assertEqual(s["work_date"], date(2026, 10, 15))

    def test_08_duplicate_join_idempotency(self):
        """8. Tránh nhân bản do JOIN: COUNT(DISTINCT work_date) và distinct session_id."""
        s1 = dict(self.base_valid_session, attendance_id=201, late_minutes=20)
        # Duplicate record that could arise from improper table JOIN
        s1_dup = dict(self.base_valid_session, attendance_id=201, late_minutes=20)
        enrich_session_record(s1)
        enrich_session_record(s1_dup)

        # De-duplicate by attendance_id
        session_map = {s["attendance_id"]: s for s in [s1, s1_dup]}
        unique_sessions = list(session_map.values())

        valid_late = [r for r in unique_sessions if r["is_valid_late"]]
        late_days = len({r["work_date"] for r in valid_late})
        late_sessions = len(valid_late)

        self.assertEqual(late_days, 1)
        self.assertEqual(late_sessions, 1)

    def test_09_null_handling_semantics(self):
        """9. Dữ liệu NULL: không đổi thành 0 sai nghĩa."""
        s = dict(
            self.base_valid_session,
            check_in_time=datetime(2026, 10, 5, 8, 0, tzinfo=VIETNAM_TZ),
            check_out_time=None,
            late_minutes=0
        )
        enrich_session_record(s)
        # raw_duration_minutes should be None when check_out is None, NOT 0
        self.assertIsNone(s["raw_duration_minutes"])

    def test_10_grace_period_policy(self):
        """10. Grace period: late_minutes <= 15 is within grace period, not late."""
        s_grace = dict(self.base_valid_session, late_minutes=15)
        enrich_session_record(s_grace)
        self.assertFalse(s_grace["is_valid_late"])
        self.assertTrue(s_grace["is_grace_late"])

        s_over_grace = dict(self.base_valid_session, late_minutes=16)
        enrich_session_record(s_over_grace)
        self.assertTrue(s_over_grace["is_valid_late"])
        self.assertFalse(s_over_grace["is_grace_late"])

    def test_11_company_late_penalty_and_grace_policy(self):
        """11. Company policy: 15m grace (0d, 0 penalty), 16m (>15m -> 1d, 1 session, 50k penalty), 2 sessions same day (1d, 2 sessions, 100k penalty)."""
        penalty_per_violation = 50000

        # Case A: 15 mins (<= tolerance)
        s15 = dict(self.base_valid_session, late_minutes=15)
        enrich_session_record(s15)
        self.assertFalse(s15["is_valid_late"])
        self.assertTrue(s15["is_grace_late"])
        penalty_15 = (1 if s15["is_valid_late"] else 0) * penalty_per_violation
        self.assertEqual(penalty_15, 0)

        # Case B: 16 mins (> tolerance)
        s16 = dict(self.base_valid_session, late_minutes=16)
        enrich_session_record(s16)
        self.assertTrue(s16["is_valid_late"])
        self.assertEqual(s16["late_minutes"], 16) # full minutes preserved, NOT 16-15
        penalty_16 = (1 if s16["is_valid_late"] else 0) * penalty_per_violation
        self.assertEqual(penalty_16, 50000)

        # Case C: 1 day with 2 late sessions (>15 mins each: 20m and 25m)
        s_day_c1 = dict(self.base_valid_session, attendance_id=301, work_date=date(2026, 10, 8), late_minutes=20)
        s_day_c2 = dict(self.base_valid_session, attendance_id=302, work_date=date(2026, 10, 8), late_minutes=25,
                        check_in_time=datetime(2026, 10, 8, 17, 25, tzinfo=VIETNAM_TZ),
                        check_out_time=datetime(2026, 10, 8, 21, 30, tzinfo=VIETNAM_TZ))
        enrich_session_record(s_day_c1)
        enrich_session_record(s_day_c2)

        day_c_sessions = [s_day_c1, s_day_c2]
        valid_late_c = [r for r in day_c_sessions if r["is_valid_late"]]
        late_days_c = len({r["work_date"] for r in valid_late_c})
        late_sessions_c = len(valid_late_c)
        verified_late_minutes_c = sum(r["late_minutes"] for r in valid_late_c)
        penalty_amount_c = late_sessions_c * penalty_per_violation

        self.assertEqual(late_days_c, 1) # 1 late day
        self.assertEqual(late_sessions_c, 2) # 2 violation sessions
        self.assertEqual(verified_late_minutes_c, 45) # 20 + 25
        self.assertEqual(penalty_amount_c, 100000) # 2 * 50,000 VND


async def run_live_database_tests():
    """Integration tests against actual PostgreSQL database."""
    from app.api.v1.endpoints.operations import monthly_attendance
    from app.core.database import AsyncSessionLocal, engine

    try:
        async with AsyncSessionLocal() as db:
            user = {"roles": ["ADMIN"], "user_id": 1}

            # 1. Test 2026-10 (Pham Quoc Dung anomaly handling)
            res_10 = await monthly_attendance(period="2026-10", user=user, db=db)
            summary_10 = res_10["summary"]

            assert "total_late_days" in summary_10
            assert "total_late_sessions" in summary_10
            assert "total_late_minutes" in summary_10
            assert "total_late_penalty_amount" in summary_10
            assert "employees_with_late" in summary_10
            assert "total_needs_review_sessions" in summary_10
            assert res_10.get("late_tolerance_minutes") == 15
            assert res_10.get("late_penalty_amount") == 50000

            dung = next((p for p in res_10["employees"] if p["employee_id"] == 4), None)
            assert dung is not None

            # Dung on 10/10 has 1-minute test pings with 670m & 879m fake late minutes
            # None of these qualify as valid late sessions
            assert dung["late_day_count"] == 0, f"Expected 0 late days, got {dung['late_day_count']}"
            assert dung["late_session_count"] == 0, f"Expected 0 late sessions, got {dung['late_session_count']}"
            assert dung["verified_late_minutes"] == 0, f"Expected 0 verified late mins, got {dung['verified_late_minutes']}"
            assert dung["late_penalty_amount"] == 0, f"Expected 0 penalty, got {dung['late_penalty_amount']}"

            # Raw minutes are preserved for HR inspection
            assert dung["raw_late_minutes"] > 0
            assert dung["needs_review_session_count"] >= 10
            assert dung["attendance_quality_status"] == "NEEDS_HR_REVIEW"
            print("[PASS] Live DB: October regression test on Pham Quoc Dung passed successfully.")

            # 2. Test 2026-09 (Legitimate late attendance session)
            res_09 = await monthly_attendance(period="2026-09", user=user, db=db)
            summary_09 = res_09["summary"]

            assert summary_09["total_late_days"] == 1
            assert summary_09["total_late_sessions"] == 1
            assert summary_09["total_late_minutes"] == 20
            assert summary_09["total_late_penalty_amount"] == 50000
            assert summary_09["employees_with_late"] == 1
            print("[PASS] Live DB: September legitimate late verification passed successfully.")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    # 1. Run unittest for rule verification (10 mandatory test scenarios)
    suite = unittest.TestLoader().loadTestsFromTestCase(TestAttUi03a)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    if not result.wasSuccessful():
        sys.exit(1)

    # 2. Run live database integration test
    import asyncio
    asyncio.run(run_live_database_tests())
    print("\nALL 10 ATT-UI-03A TEST SCENARIOS + LIVE DB REGRESSION PASSED!")

