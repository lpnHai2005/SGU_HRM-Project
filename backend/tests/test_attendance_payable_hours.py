"""Regression tests for attendance/payroll payable hours.

Regular paid hours are the intersection of a closed attendance session with its
fixed shift, less the applicable break. Pre-shift and post-shift time cannot
replace late or early minutes. HR raw-work credit is bounded by the same shift
window. The SQL parity cases require the additive fixed-shift migration.
"""

import asyncio
import json
import unittest
from calendar import monthrange
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.engine import make_url

from app.api.v1.endpoints.operations import (
    enrich_session_record,
    raw_work_credit,
    summarize_work_sessions,
)

VN = timezone(timedelta(hours=7))
GRACE_MINUTES = 15

# (giờ bắt đầu, giờ kết thúc, giờ công, phút nghỉ giữa ca)
CA_SANG = ("08:00:00", "16:00:00", 8.0, 0)
CA_CHIEU = ("13:00:00", "21:00:00", 8.0, 0)
CA_HANH_CHINH = ("08:00:00", "17:00:00", 8.0, 60)
CA_DEM = ("22:00:00", "06:00:00", 8.0, 0)

PAYABLE_SIGNATURE = (
    "public.fn_attendance_payable_hours("
    "jsonb,numeric,timestamptz,timestamptz,integer,numeric,numeric,numeric,date,time,time,integer)"
)

# Cùng biểu thức sp_generate_monthly_payroll dùng để tính giờ mỗi phiên.
PAYABLE_EXPR = f"""public.fn_attendance_payable_hours(
    a.attendance_context, a.actual_work_hours, a.check_in_time, a.check_out_time, a.late_minutes,
    COALESCE(sh.work_hours, NULLIF(a.attendance_context->'actual'->>'work_hours', '')::NUMERIC),
    ota.approved_hours, {GRACE_MINUTES}, a.work_date,
    COALESCE(sh.start_time, NULLIF(a.attendance_context->'actual'->>'start_time', '')::TIME),
    COALESCE(sh.end_time, NULLIF(a.attendance_context->'actual'->>'end_time', '')::TIME),
    COALESCE(NULLIF(a.attendance_context->'actual'->>'break_minutes', '')::INTEGER, sh.break_minutes))"""

ATTENDANCE_JOINS = """
    FROM attendances a
    LEFT JOIN work_shifts sh ON sh.shift_id = a.shift_id
    LEFT JOIN attendance_overtime_approvals ota
           ON ota.attendance_id = a.attendance_id AND ota.decision = 'APPROVED'"""


def session(start, end, shift=CA_SANG, late=0, decision=None, approved_ot=0.0, day=10, aid=1, year=2026, month=11):
    """Một phiên đã qua enrich_session_record; end=None là phiên chưa check-out."""
    d = date(year, month, day)
    c_in = datetime.combine(d, time.fromisoformat(start), VN)
    c_out = None
    if end:
        c_out = datetime.combine(d, time.fromisoformat(end), VN)
        if c_out <= c_in:
            c_out += timedelta(days=1)
    hours = round((c_out - c_in).total_seconds() / 3600, 2) if c_out else 0.0
    row = {
        "attendance_id": aid, "employee_id": 4, "work_date": d,
        "check_in_time": c_in, "check_out_time": c_out, "actual_work_hours": hours,
        "late_minutes": late, "early_minutes": 0, "overtime_hours": max(0.0, round(hours - shift[2], 2)),
        "schedule_status": "MATCHED", "scheduled_start": shift[0], "scheduled_end": shift[1],
        "scheduled_hours": shift[2], "break_minutes": shift[3], "approved_ot_hours": approved_ot,
        "attendance_context": {"schedule_status": "MATCHED"},
    }
    if decision:
        review = {"review_decision": decision, "review_status": "RESOLVED", "version": 1}
        if decision == "CONFIRMED_RAW_WORK":
            review.update(raw_work_credit(row))
        row["attendance_context"]["hr_review"] = review
    return enrich_session_record(row, GRACE_MINUTES)


def payable_parity_cases(year=2026, month=11):
    """Synthetic cases: original 16 discrepancies plus overnight edge cases."""
    month_end = monthrange(year, month)[1]
    return [
        session("08:10", "16:00", late=10, year=year, month=month),
        session("08:10", "17:00", late=10, year=year, month=month),
        session("08:10", "17:00", late=10, approved_ot=1.0, year=year, month=month),
        session("13:30", "21:30", shift=CA_CHIEU, late=30, year=year, month=month),
        session("13:30", "21:00", shift=CA_CHIEU, late=30, year=year, month=month),
        session("08:00", "15:00", year=year, month=month),
        session("08:00", "16:00", decision="EXCLUDED_INVALID", year=year, month=month),
        session("08:00", "16:00", decision="NEEDS_MORE_INFO", year=year, month=month),
        session("08:10", "17:00", late=10, decision="CONFIRMED_RAW_WORK", year=year, month=month),
        session("08:16", "16:00", late=16, year=year, month=month),
        session("08:30", "17:00", shift=CA_HANH_CHINH, late=30, year=year, month=month),
        session("07:58", "17:00", shift=CA_HANH_CHINH, year=year, month=month),
        session("08:00", "12:00", shift=CA_HANH_CHINH, year=year, month=month),
        session("13:00", "17:00", shift=CA_HANH_CHINH, year=year, month=month),
        session("07:48", "16:05", shift=CA_HANH_CHINH, day=3, year=year, month=month),
        session("08:10", "17:00", shift=CA_HANH_CHINH, late=10, decision="CONFIRMED_RAW_WORK", year=year, month=month),
        session("22:00", "06:00", shift=CA_DEM, year=year, month=month),
        session("22:30", "06:30", shift=CA_DEM, late=30, year=year, month=month),
        session("22:00", "06:00", shift=CA_DEM, day=month_end, year=year, month=month),
    ]


class TestPayableHoursPolicy(unittest.TestCase):
    def test_late_minutes_are_not_added_back_to_regular_hours(self):
        """A 10-minute grace period does not turn 7h50 in-shift time into 8 hours."""
        r = session("08:10", "16:00", late=10)
        self.assertEqual(r["payable_hours"], 7.83)
        self.assertEqual(r["grace_credit_hours"], 0.0)
        self.assertFalse(r["is_valid_late"])

    def test_extra_hours_after_shift_are_not_base_hours(self):
        """Staying after 16:00 does not compensate for arriving at 08:10."""
        r = session("08:10", "17:00", late=10)
        self.assertEqual(r["payable_hours"], 7.83)
        self.assertEqual(r["over_cap_hours"], 1.0)
        self.assertEqual(r["ot_paid_hours"], 0.0)

    def test_approved_ot_is_paid_once(self):
        """Approved OT is tracked separately and never added to regular shift hours."""
        r = session("08:10", "17:00", late=10, approved_ot=1.0)
        self.assertEqual(r["payable_hours"], 7.83)
        self.assertEqual(r["ot_paid_hours"], 1.0)

    def test_late_beyond_grace_is_not_compensated_by_staying(self):
        """A 30-minute late arrival remains a 30-minute shortfall despite staying late."""
        r = session("13:30", "21:30", shift=CA_CHIEU, late=30)
        self.assertEqual(r["payable_hours"], 7.5)
        self.assertEqual(r["grace_credit_hours"], 0.0)
        self.assertTrue(r["is_valid_late"])

    def test_late_beyond_grace_not_compensated(self):
        self.assertEqual(session("13:30", "21:00", shift=CA_CHIEU, late=30)["payable_hours"], 7.5)

    def test_early_leave_is_deducted(self):
        self.assertEqual(session("08:00", "15:00")["payable_hours"], 7.0)

    def test_hr_excluded_and_hold(self):
        self.assertEqual(session("08:00", "16:00", decision="EXCLUDED_INVALID")["payable_hours"], 0.0)
        self.assertEqual(session("08:00", "16:00", decision="NEEDS_MORE_INFO")["payable_hours"], 0.0)

    def test_hr_confirmed_raw_work_does_not_add_grace(self):
        """HR confirmation credits measured in-shift time, without grace compensation."""
        r = session("08:10", "17:00", late=10, decision="CONFIRMED_RAW_WORK")
        self.assertEqual(r["actual_work_hours"], 7.83)
        self.assertEqual(r["payable_hours"], 7.83)
        self.assertEqual(r["grace_credit_hours"], 0.0)

    def test_november_3_early_checkout_is_55_minutes_not_43(self):
        """07:48 is 12 minutes before the shift and cannot offset leaving at 16:05."""
        r = session("07:48", "16:05", shift=CA_HANH_CHINH, day=3)
        short_hours = round(max(0.0, CA_HANH_CHINH[2] - r["payable_hours"]), 2)

        self.assertEqual(r["raw_work_hours"], 8.28)       # 07:48–16:05 elapsed
        self.assertEqual(r["in_shift_hours"], 8.08)       # only 08:00–16:05
        self.assertEqual(r["over_cap_hours"], 0.2)        # the 12 pre-shift minutes
        self.assertEqual(r["break_deducted_hours"], 1.0)
        self.assertEqual(r["payable_hours"], 7.08)         # 8h05 − 1h break
        self.assertEqual(short_hours, 0.92)
        self.assertEqual(round(short_hours * 60), 55)
        self.assertEqual(round(short_hours * 110_000), 101_200)
        summary = summarize_work_sessions([r])
        self.assertEqual(summary["actual_work_hours"], 7.08)

        # Reproduce the old SQL arithmetic: raw elapsed time minus break credited
        # the 12 minutes before 08:00, producing the reported 43-minute deficit.
        old_payable = round(r["raw_work_hours"] - 1.0, 2)
        old_short = round(CA_HANH_CHINH[2] - old_payable, 2)
        self.assertEqual(old_payable, 7.28)
        self.assertEqual(old_short, 0.72)
        self.assertEqual(round(old_short * 60), 43)
        self.assertEqual(round(old_short * 110_000), 79_200)

    def test_hr_credit_above_shift_overlap_is_clamped(self):
        r = session("07:48", "16:05", shift=CA_HANH_CHINH, decision="CONFIRMED_RAW_WORK", day=3)
        r["attendance_context"]["hr_review"]["credited_work_hours"] = 99.0
        enrich_session_record(r, GRACE_MINUTES)
        self.assertEqual(r["payable_hours"], 7.08)
        self.assertLessEqual(r["payable_hours"], CA_HANH_CHINH[2])

    def test_hr_credit_below_shift_overlap_is_respected_before_break(self):
        r = session("07:48", "16:05", shift=CA_HANH_CHINH, decision="CONFIRMED_RAW_WORK", day=3)
        r["attendance_context"]["hr_review"]["credited_work_hours"] = 7.5
        enrich_session_record(r, GRACE_MINUTES)
        self.assertEqual(r["payable_hours"], 6.5)

    def test_hr_confirmed_raw_work_attendance_and_payroll_candidate_match(self):
        r = session("07:48", "16:05", shift=CA_HANH_CHINH, decision="CONFIRMED_RAW_WORK", day=3)
        summary = summarize_work_sessions([r])
        self.assertEqual(r["attendance_context"]["hr_review"]["credited_work_hours"], 8.08)
        self.assertEqual(r["payable_hours"], 7.08)
        self.assertEqual(summary["actual_work_hours"], 7.08)

    def test_hr_needs_more_info_is_on_payroll_hold(self):
        r = session("08:00", "16:00", decision="NEEDS_MORE_INFO")
        summary = summarize_work_sessions([r])
        self.assertTrue(r["payroll_hold"])
        self.assertEqual(r["payable_hours"], 0.0)
        self.assertEqual(summary["actual_work_hours"], 0.0)
        self.assertEqual(summary["held_session_count"], 1)

    def test_hr_excluded_session_does_not_enter_payroll_hours(self):
        r = session("08:00", "16:00", decision="EXCLUDED_INVALID")
        self.assertTrue(r["is_excluded"])
        self.assertEqual(r["payable_hours"], 0.0)
        self.assertEqual(r["actual_work_hours"], 0.0)
        summary = summarize_work_sessions([r])
        self.assertEqual(summary["actual_work_hours"], 0.0)

    def test_hr_credit_helper_fails_closed_without_fixed_shift(self):
        r = session("08:00", "16:00")
        r["scheduled_start"] = None
        r["scheduled_end"] = None
        r["scheduled_hours"] = None
        self.assertEqual(raw_work_credit(r)["credited_work_hours"], 0.0)
        result = enrich_session_record(r, GRACE_MINUTES)
        self.assertTrue(result["payroll_hold"])
        self.assertEqual(result["payable_hours"], 0.0)

    def test_office_shift_break_is_deducted(self):
        """Ca hành chính 08–17 (nghỉ 60'): vào 08:30 ra 17:00 → 8,5 − 1 = 7,5h."""
        r = session("08:30", "17:00", shift=CA_HANH_CHINH, late=30)
        self.assertEqual(r["break_deducted_hours"], 1.0)
        self.assertEqual(r["payable_hours"], 7.5)

    def test_office_shift_full_day_and_grace(self):
        self.assertEqual(session("07:58", "17:00", shift=CA_HANH_CHINH)["payable_hours"], 8.0)
        self.assertEqual(session("08:10", "17:00", shift=CA_HANH_CHINH, late=10)["payable_hours"], 7.83)

    def test_office_shift_half_day_has_no_break(self):
        """Không kéo qua giữa ca (12:30) → không trừ nghỉ."""
        self.assertEqual(session("08:00", "12:00", shift=CA_HANH_CHINH)["payable_hours"], 4.0)
        self.assertEqual(session("13:00", "17:00", shift=CA_HANH_CHINH)["payable_hours"], 4.0)

    def test_overnight_shift_ends_on_next_calendar_day(self):
        r = session("22:00", "06:00", shift=CA_DEM)
        self.assertEqual(r["in_shift_hours"], 8.0)
        self.assertEqual(r["payable_hours"], 8.0)

    def test_overnight_shift_crosses_month_boundary(self):
        r = session("22:00", "06:00", shift=CA_DEM, day=30)
        self.assertEqual(r["check_out_time"].date(), date(2026, 12, 1))
        self.assertEqual(r["in_shift_hours"], 8.0)
        self.assertEqual(r["payable_hours"], 8.0)

    def test_overnight_time_after_shift_does_not_compensate_for_late_arrival(self):
        r = session("22:30", "06:30", shift=CA_DEM, late=30)
        self.assertEqual(r["in_shift_hours"], 7.5)
        self.assertEqual(r["over_cap_hours"], 0.5)
        self.assertEqual(r["payable_hours"], 7.5)

    def test_open_session_has_no_hours(self):
        self.assertEqual(session("08:00", None)["payable_hours"], 0.0)

    def test_summary_balance(self):
        rows = [
            session("08:10", "17:00", late=10, approved_ot=0.5, day=3, aid=1),
            session("13:30", "21:30", shift=CA_CHIEU, late=30, day=4, aid=2),
            session("08:00", "16:00", decision="EXCLUDED_INVALID", day=5, aid=3),
            session("08:00", "16:00", decision="NEEDS_MORE_INFO", day=6, aid=4),
            session("07:00", "16:00", decision="CONFIRMED_RAW_WORK", day=7, aid=5),
            session("08:30", "17:00", shift=CA_HANH_CHINH, late=30, day=8, aid=6),
        ]
        s = summarize_work_sessions(rows)
        self.assertEqual(s["working_days"], 4)
        self.assertEqual(s["actual_work_hours"], 30.83)
        # excluded_hours currently includes HR-excluded time plus trimmed
        # outside-shift time; the latter is also exposed separately below.
        self.assertEqual(s["excluded_hours"], 10.5)
        self.assertEqual(s["held_hours"], 8.0)
        self.assertEqual(s["ot_paid_hours"], 0.5)
        self.assertEqual(s["outside_schedule_hours"], 2.5)
        self.assertEqual(s["break_deducted_hours"], 1.0)


class TestPayableHoursMatchSqlOnLocalDb(unittest.TestCase):
    """So bảng công (Python) với fn_attendance_payable_hours (SQL) trên DB local — chỉ đọc.

    Chỉ dùng query SELECT với session dữ liệu giả lập; đối chiếu cần migration
    20261122. Test được skip nếu không phải loopback hoặc function chưa tồn tại.
    """

    PERIOD = (date(2026, 11, 1), date(2026, 11, 30))

    @classmethod
    def setUpClass(cls):
        from app.core.config import settings
        url = make_url(str(getattr(settings, "DATABASE_URL", "") or ""))
        if url.host not in ("127.0.0.1", "localhost") or url.port != 55322 or url.database != "postgres":
            raise unittest.SkipTest("Chỉ so parity trên Supabase Local (loopback:55322/postgres).")

    def _run(self, query):
        """Chạy query(db) trong transaction chỉ đọc; bỏ qua test nếu chưa có hàm SQL."""
        from app.core.database import AsyncSessionLocal, engine

        async def main():
            try:
                async with AsyncSessionLocal() as db:
                    await db.execute(text("SET TRANSACTION READ ONLY"))
                    exists = (await db.execute(
                        text("SELECT to_regprocedure(:sig) IS NOT NULL"), {"sig": PAYABLE_SIGNATURE})).scalar_one()
                    return await query(db) if exists else None
            finally:
                await engine.dispose()

        result = asyncio.run(main())
        if result is None:
            self.skipTest("Không có function Payroll 12 tham số để kiểm tra; xác minh schema và migration 20261122.")
        return result

    def test_scenarios_python_equals_sql(self):
        self._assert_scenarios_match_sql(payable_parity_cases())

    def test_july_2026_synthetic_cases_match_sql(self):
        self._assert_scenarios_match_sql(payable_parity_cases(year=2026, month=7))

    def _assert_scenarios_match_sql(self, cases):
        sql = text(
            "SELECT public.fn_attendance_payable_hours(CAST(:ctx AS jsonb), CAST(:hours AS numeric), :check_in, :check_out,"
            " CAST(:late AS integer), CAST(:shift_hours AS numeric), CAST(:ot AS numeric), CAST(:grace AS numeric),"
            " :work_date, :shift_start, :shift_end, CAST(:break_minutes AS integer))")

        async def query(db):
            values = []
            for r in cases:
                values.append(float((await db.execute(sql, {
                    "ctx": json.dumps(r["attendance_context"]), "hours": r["raw_work_hours"],
                    "check_in": r["check_in_time"], "check_out": r["check_out_time"], "late": r["late_minutes"],
                    "shift_hours": r["scheduled_hours"], "ot": r["approved_ot_hours"], "grace": GRACE_MINUTES,
                    "work_date": r["work_date"], "shift_start": time.fromisoformat(r["scheduled_start"]),
                    "shift_end": time.fromisoformat(r["scheduled_end"]), "break_minutes": r["break_minutes"],
                })).scalar_one()))
            return values

        for r, sql_value in zip(cases, self._run(query)):
            review = r.get("hr_review") or {}
            decision = review.get("review_decision", "NO_HR_REVIEW")
            with self.subTest(
                check_in=r["check_in_time"].time(),
                check_out=r["check_out_time"].time(),
                hr_decision=decision,
            ):
                self.assertEqual(
                    r["payable_hours"],
                    sql_value,
                    f"Attendance={r['payable_hours']}h, active Payroll SQL={sql_value}h, decision={decision}",
                )

    def test_attendance_table_equals_payroll_rule_for_all_employees(self):
        params = {"start": self.PERIOD[0], "end": self.PERIOD[1]}
        sessions_sql = text(f"""
            SELECT a.attendance_id, a.employee_id, a.work_date, a.check_in_time, a.check_out_time,
                   a.actual_work_hours, a.late_minutes, a.early_minutes, a.overtime_hours, a.status,
                   a.attendance_context,
                   COALESCE(a.attendance_context->>'schedule_status', 'LEGACY_UNKNOWN') AS schedule_status,
                   sh.start_time AS scheduled_start, sh.end_time AS scheduled_end,
                   sh.work_hours AS scheduled_hours, sh.break_minutes AS break_minutes,
                   COALESCE(ota.approved_hours, 0) AS approved_ot_hours
            {ATTENDANCE_JOINS}
            WHERE a.work_date BETWEEN :start AND :end""")
        payroll_sql = text(f"""
            SELECT d.employee_id, COUNT(*) FILTER (WHERE d.hours > 0) AS days, ROUND(SUM(d.hours), 2) AS hours
            FROM (SELECT a.employee_id, a.work_date, SUM({PAYABLE_EXPR}) AS hours
                  {ATTENDANCE_JOINS}
                  WHERE a.work_date BETWEEN :start AND :end
                  GROUP BY a.employee_id, a.work_date) d
            GROUP BY d.employee_id""")

        async def query(db):
            rows = [dict(r) for r in (await db.execute(sessions_sql, params)).mappings().all()]
            payroll = {r["employee_id"]: (int(r["days"]), float(r["hours"]))
                       for r in (await db.execute(payroll_sql, params)).mappings().all()}
            return rows, payroll

        rows, payroll = self._run(query)
        if not rows:
            self.skipTest("DB local không có chấm công kỳ 2026-11")
        by_employee = {}
        for r in rows:
            for key in ("actual_work_hours", "overtime_hours", "scheduled_hours", "approved_ot_hours"):
                r[key] = float(r[key]) if r[key] is not None else None
            enrich_session_record(r, GRACE_MINUTES)
            by_employee.setdefault(r["employee_id"], []).append(r)
        for employee_id, employee_rows in by_employee.items():
            with self.subTest(employee_id=employee_id):
                table = summarize_work_sessions(employee_rows)
                days, hours = payroll.get(employee_id, (0, 0.0))
                self.assertEqual(table["working_days"], days)
                self.assertAlmostEqual(table["actual_work_hours"], hours, places=2)


if __name__ == "__main__":
    unittest.main()
