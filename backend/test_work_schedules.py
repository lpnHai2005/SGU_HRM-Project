"""Offline calendar and authorization policy regression."""
import unittest
from datetime import date,time,timedelta
from fastapi import HTTPException
from app.core.work_schedule import interval,scope
from app.api.v1.endpoints.work_schedules import bounds

class CalendarRules(unittest.TestCase):
    def test_week_crosses_year(self):
        self.assertEqual(bounds(date(2026,1,1),'week'),(date(2025,12,29),date(2026,1,3)))
    def test_week_ends_on_saturday(self):
        self.assertEqual(bounds(date(2026,10,10),'week'),(date(2026,10,5),date(2026,10,10)))
    def test_leap_month(self):
        self.assertEqual(bounds(date(2028,2,5),'month'),(date(2028,2,1),date(2028,2,29)))
    def test_overnight(self):
        start,end=interval(date(2026,10,10),time(22),time(6))
        self.assertEqual(end-start,timedelta(hours=8))
    def test_equal_times_is_next_day(self):
        start,end=interval(date(2026,10,10),time(8),time(8))
        self.assertEqual(end-start,timedelta(days=1))
    def test_employee_scope_cannot_be_removed(self):
        params={}; sql=scope({'roles':['EMPLOYEE'],'employee_id':4},params)
        self.assertIn('employee_id=:scope_employee',sql)
        self.assertEqual(params,{'scope_employee':4})
    def test_manager_scope(self):
        params={}; self.assertIn('store_id',scope({'roles':['STORE_MANAGER'],'store_id':5},params))
        self.assertEqual(params,{'scope_store':5})
    def test_missing_identity_denied(self):
        with self.assertRaises(HTTPException): scope({'roles':['EMPLOYEE']},{})

if __name__=='__main__': unittest.main()
