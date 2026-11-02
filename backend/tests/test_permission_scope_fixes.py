"""DB-free checks for the RBAC scope fixes (annual payroll export, leave calendar)."""
import asyncio
import unittest

from fastapi import HTTPException

from app.api.v1.endpoints.payrolls import export_annual_payroll_excel, list_payrolls
from app.api.v1.endpoints.leaves import get_leave_calendar
from app.core.ai_chatbot_tools import get_employee_payroll


class Result:
    def mappings(self):
        return self

    def all(self):
        return []


class RecordingDb:
    def __init__(self):
        self.queries = []

    async def execute(self, statement, params=None):
        self.queries.append((str(statement), params or {}))
        return Result()


class DenyDb:
    async def execute(self, *_args, **_kwargs):
        raise AssertionError('Request must be denied before querying data')


def export(user, db, store_id=None):
    return asyncio.run(export_annual_payroll_excel(year='2026', employee_id=None, store_id=store_id, current_user=user, db=db))


class AnnualExportScopeTests(unittest.TestCase):
    def test_store_manager_cannot_export_other_store(self):
        with self.assertRaises(HTTPException) as caught:
            export({'roles': ['STORE_MANAGER'], 'store_id': 1}, DenyDb(), store_id=2)
        self.assertEqual(caught.exception.status_code, 403)

    def test_store_manager_export_is_forced_to_own_store(self):
        db = RecordingDb()
        with self.assertRaises(HTTPException) as caught:  # no rows -> 404, but the query must be scoped
            export({'roles': ['STORE_MANAGER'], 'store_id': 1}, db)
        self.assertEqual(caught.exception.status_code, 404)
        query, params = db.queries[-1]
        self.assertIn('e.store_id = :store_id', query)
        self.assertEqual(params['store_id'], 1)

    def test_unlinked_employee_cannot_export_company(self):
        with self.assertRaises(HTTPException) as caught:
            export({'roles': ['EMPLOYEE'], 'employee_id': None}, DenyDb())
        self.assertEqual(caught.exception.status_code, 403)


class LeaveCalendarScopeTests(unittest.TestCase):
    def test_employee_sees_only_own_leaves(self):
        db = RecordingDb()
        asyncio.run(get_leave_calendar(month='2026-10', store_id=None, employee_id=None,
                                       current_user={'roles': ['EMPLOYEE'], 'employee_id': 12, 'store_id': 1}, db=db))
        self.assertEqual(len(db.queries), 2)
        for query, params in db.queries:
            self.assertIn('employee_id = :user_emp_id', query)
            self.assertNotIn('user_store_id', params)
            self.assertEqual(params['user_emp_id'], 12)

    def test_director_can_filter_by_employee(self):
        db = RecordingDb()
        asyncio.run(get_leave_calendar(month='2026-10', store_id=None, employee_id=12,
                                       current_user={'roles': ['DIRECTOR'], 'employee_id': 1}, db=db))
        self.assertEqual(db.queries[0][1]['employee_id'], 12)


class OneRow:
    def __init__(self, row):
        self.row = row

    def mappings(self):
        return self

    def first(self):
        return self.row


class StoreManagerPayrollTests(unittest.TestCase):
    def test_store_manager_payroll_list_hides_drafts(self):
        db = RecordingDb()
        asyncio.run(list_payrolls(period='2026-10', employee_id=None, store_id=None, payment_status=None,
                                  current_user={'roles': ['STORE_MANAGER'], 'store_id': 1}, db=db))
        query, params = db.queries[0]
        self.assertIn("payment_status IN ('CONFIRMED','PAID')", query)
        self.assertEqual(params['mgr_store_id'], 1)

    def test_chatbot_store_manager_cannot_read_other_store_payroll(self):
        class Db:
            async def execute(self, statement, params=None):
                assert 'FROM payrolls' not in str(statement), 'Must deny before reading payroll'
                return OneRow({'employee_id': 9, 'full_name': 'X', 'employee_code': 'TZ-009', 'store_id': 2})
        res = asyncio.run(get_employee_payroll({'employee_code': 'TZ-009', 'salary_period': '2026-10'},
                                               {'roles': ['STORE_MANAGER'], 'store_id': 1, 'employee_id': 5}, Db()))
        self.assertIn('error', res)


if __name__ == '__main__':
    unittest.main()
