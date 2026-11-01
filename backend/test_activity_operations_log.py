import sys
if hasattr(sys.stdout, 'reconfigure'): sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, '.')
import unittest
import asyncio
from datetime import date, datetime, timedelta, timezone
from app.core.database import AsyncSessionLocal, engine
from app.api.v1.endpoints.operations import activity, enrich_session_record
from fastapi import HTTPException
from sqlalchemy import text

VIETNAM_TZ = timezone(timedelta(hours=7))

class TestAttUi05(unittest.TestCase):
    """Test unit logic for ATT-UI-05 assessment separation and duration calculations."""

    def setUp(self):
        self.base_session = {
            "attendance_id": 9991,
            "employee_id": 10,
            "store_id": 1,
            "shift_id": 1,
            "work_date": date(2026, 11, 1),
            "check_in_time": datetime(2026, 11, 1, 8, 0, tzinfo=VIETNAM_TZ),
            "check_out_time": datetime(2026, 11, 1, 16, 0, tzinfo=VIETNAM_TZ),
            "actual_work_hours": 7.0,
            "late_minutes": 0,
            "early_minutes": 0,
            "overtime_hours": 0.0,
            "schedule_status": "MATCHED",
            "shift_name": "Ca sáng bán lẻ",
            "scheduled_start": "08:00:00",
            "scheduled_end": "16:00:00",
            "break_minutes": 60,
            "attendance_context": {}
        }

    def test_01_on_time_morning_shift(self):
        """1. Ca sáng 08:00–16:00, vào 08:00: Đúng giờ, Khớp ca, Bình thường."""
        s = dict(self.base_session)
        enrich_session_record(s)
        self.assertEqual(s["session_quality_status"], "NORMAL")
        self.assertFalse(s["is_valid_late"])
        self.assertFalse(s["is_grace_late"])

    def test_02_grace_late_8_15(self):
        """2. Ca sáng, vào 08:15: Trễ 15p <= 15p -> Ân hạn, không phạt."""
        s = dict(self.base_session, late_minutes=15,
                 check_in_time=datetime(2026, 11, 1, 8, 15, tzinfo=VIETNAM_TZ))
        enrich_session_record(s)
        self.assertFalse(s["is_valid_late"])
        self.assertTrue(s["is_grace_late"])
        self.assertEqual(s["session_quality_status"], "NORMAL")

    def test_03_valid_late_8_16(self):
        """3. Ca sáng, vào 08:16: Trễ 16p > 15p -> Vi phạm hợp lệ."""
        s = dict(self.base_session, late_minutes=16,
                 check_in_time=datetime(2026, 11, 1, 8, 16, tzinfo=VIETNAM_TZ))
        enrich_session_record(s)
        self.assertTrue(s["is_valid_late"])
        self.assertFalse(s["is_grace_late"])
        self.assertEqual(s["session_quality_status"], "NORMAL")

    def test_04_excessive_late_13_00(self):
        """4. Ca sáng, vào 13:00: Trễ 300p > 240p -> EXCESSIVE_LATE, Chờ HR."""
        s = dict(self.base_session, late_minutes=300,
                 check_in_time=datetime(2026, 11, 1, 13, 0, tzinfo=VIETNAM_TZ))
        enrich_session_record(s)
        self.assertFalse(s["is_valid_late"])
        self.assertEqual(s["session_quality_status"], "NEEDS_REVIEW")
        self.assertIn("EXCESSIVE_LATE", s["quality_flags"])
        self.assertTrue(s["needs_hr_review"])

    def test_05_afternoon_shift_13_00_21_00_with_outside_hours(self):
        """5. Ca chiều 13:00-21:00, vào 14:00 và ra 22:00 -> Trễ 60p, ngoài ca 1.0h, Bình thường."""
        s = dict(self.base_session, shift_id=2, shift_name="Ca chiều bán lẻ",
                 scheduled_start="13:00:00", scheduled_end="21:00:00",
                 check_in_time=datetime(2026, 11, 1, 14, 0, tzinfo=VIETNAM_TZ),
                 check_out_time=datetime(2026, 11, 1, 22, 0, tzinfo=VIETNAM_TZ),
                 late_minutes=60, early_minutes=0, overtime_hours=1.0)
        enrich_session_record(s)
        self.assertEqual(s["session_quality_status"], "NORMAL")
        self.assertTrue(s["is_valid_late"])
        self.assertEqual(s["raw_duration_minutes"], 480)
        self.assertEqual(s["net_duration_minutes"], 420)

    def test_06_short_session(self):
        """6. Phiên ngắn <= 15m -> SHORT_SESSION."""
        s = dict(self.base_session,
                 check_in_time=datetime(2026, 11, 1, 8, 0, tzinfo=VIETNAM_TZ),
                 check_out_time=datetime(2026, 11, 1, 8, 10, tzinfo=VIETNAM_TZ))
        enrich_session_record(s)
        self.assertEqual(s["session_quality_status"], "SHORT_SESSION")
        self.assertIn("SHORT_SESSION", s["quality_flags"])

    def test_07_open_session(self):
        """7. Phiên thiếu checkout -> OPEN_SESSION."""
        s = dict(self.base_session, check_out_time=None)
        enrich_session_record(s)
        self.assertEqual(s["session_quality_status"], "OPEN_SESSION")
        self.assertIn("OPEN_SESSION", s["quality_flags"])


async def run_live_db_tests():
    print("\n--- RUNNING LIVE DB & API INTEGRATION TESTS FOR ATT-UI-05 ---")
    admin_user = {"roles": ["ADMIN"], "employee_id": 1, "user_id": 1}
    store_mgr_user = {"roles": ["STORE_MANAGER"], "employee_id": 2, "store_id": 1, "user_id": 2}

    async with AsyncSessionLocal() as session:
        # 1. Single day
        res_single = await activity(day=date(2026, 7, 31), user=admin_user, db=session)
        assert res_single["from_date"] == date(2026, 7, 31)
        assert res_single["to_date"] == date(2026, 7, 31)
        assert res_single["is_date_range"] is False
        assert "scheduled_employees" in res_single["summary"]
        assert "late_employees" in res_single["summary"]
        assert "late_sessions" in res_single["summary"]
        print(f"[PASS] Single day query (2026-07-31): {res_single['summary']['total_sessions']} sessions, scheduled={res_single['summary']['scheduled_employees']}.")

        # 2. Date range 7 days
        res_7d = await activity(from_date=date(2026, 7, 1), to_date=date(2026, 7, 7),
                                user=admin_user, db=session)
        assert res_7d["is_date_range"] is True
        s7 = res_7d["summary"]
        assert s7["total_sessions"] >= s7["checked_in"]
        assert s7["late_sessions"] >= s7["late_employees"]
        print(f"[PASS] 7-day range query (2026-07-01 to 2026-07-07): {s7['total_sessions']} sessions, late_employees={s7['late_employees']}, late_sessions={s7['late_sessions']}.")

        # 3. 31 days boundary validation
        res_31d = await activity(from_date=date(2026, 7, 1), to_date=date(2026, 7, 31),
                                 user=admin_user, db=session)
        assert res_31d["is_date_range"] is True
        print(f"[PASS] 31-day boundary query: Accepted and executed with {res_31d['summary']['total_sessions']} sessions.")

        # 4. Over 31 days validation (>31 days)
        try:
            await activity(from_date=date(2026, 7, 1), to_date=date(2026, 8, 5),
                           user=admin_user, db=session)
            assert False, "Should have raised HTTPException(400)"
        except HTTPException as e:
            assert e.status_code == 400
            assert "31 ngày" in e.detail
            print(f"[PASS] >31 days rejected correctly: HTTP 400 '{e.detail}'.")

        # 5. from_date > to_date validation
        try:
            await activity(from_date=date(2026, 7, 10), to_date=date(2026, 7, 5),
                           user=admin_user, db=session)
            assert False, "Should have raised HTTPException(400)"
        except HTTPException as e:
            assert e.status_code == 400
            assert "lớn hơn" in e.detail
            print(f"[PASS] from_date > to_date rejected correctly: HTTP 400 '{e.detail}'.")

        # 6. Store Manager Scoping
        res_sm = await activity(day=date(2026, 7, 31), user=store_mgr_user, db=session)
        for emp in res_sm["employees"]:
            assert emp["store_id"] == 1
        print(f"[PASS] RBAC enforced: Store Manager received only store_id=1 employees ({len(res_sm['employees'])} employees).")


if __name__ == "__main__":
    suite = unittest.TestLoader().loadTestsFromTestCase(TestAttUi05)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    if not result.wasSuccessful():
        sys.exit(1)

    asyncio.run(run_live_db_tests())
    print("\n>>> ALL 13 ATT-UI-05 TEST SCENARIOS + LIVE DB INTEGRATION TESTS PASSED 100%! <<<")
