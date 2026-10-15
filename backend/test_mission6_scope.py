"""Fast, DB-free checks for the new project/sales scope boundaries."""
import asyncio
import unittest

from fastapi import HTTPException

from app.api.v1.endpoints.payrolls import list_projects_with_allowances, list_sales_records, record_sales
from app.api.v1.endpoints.reports import get_payroll_fund_summary
from app.api.v1.endpoints.employees import list_contracts
from app.schemas.schemas import SalesRecordCreate


class EmptyDb:
    async def execute(self, *_args, **_kwargs):
        raise AssertionError('A missing scope must be denied before querying data')


class Result:
    def __init__(self, rows):
        self.rows = rows

    def mappings(self):
        return self

    def all(self):
        return self.rows

    def first(self):
        return self.rows[0] if self.rows else None


class ScopedDb:
    def __init__(self):
        self.queries = []

    async def execute(self, statement, params):
        query = str(statement)
        self.queries.append((query, params))
        if 'SELECT * FROM projects' in query:
            return Result([{'project_id': 7, 'budget': 500000}])
        return Result([{'project_member_id': 9, 'employee_id': 12}])


class Mission6ScopeTests(unittest.TestCase):
    def test_manager_without_store_cannot_read_payroll_fund(self):
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(get_payroll_fund_summary(period='2026-10', current_user={'roles': ['STORE_MANAGER'], 'store_id': None}, db=EmptyDb()))
        self.assertEqual(caught.exception.status_code, 403)

    def test_manager_payroll_fund_queries_use_assigned_store(self):
        db = ScopedDb()
        asyncio.run(get_payroll_fund_summary(period='2026-10', current_user={'roles': ['STORE_MANAGER'], 'store_id': 3}, db=db))
        self.assertEqual(len(db.queries), 2)
        for query, params in db.queries:
            self.assertIn('e.store_id = :store_id', query)
            self.assertEqual(params['store_id'], 3)

    def test_staff_contracts_are_limited_to_self(self):
        db = ScopedDb()
        asyncio.run(list_contracts(employee_id=None, current_user={'roles': ['EMPLOYEE'], 'employee_id': 12}, db=db))
        self.assertIn('c.employee_id = :self_employee_id', db.queries[0][0])
        self.assertEqual(db.queries[0][1]['self_employee_id'], 12)

    def test_staff_project_queries_are_scoped_and_budget_hidden(self):
        db = ScopedDb()
        projects = asyncio.run(list_projects_with_allowances(current_user={'roles': ['EMPLOYEE'], 'employee_id': 12}, db=db))
        self.assertEqual(db.queries[0][1]['employee_id'], 12)
        self.assertIn('pm.employee_id = :employee_id', db.queries[0][0])
        self.assertIn('pm.employee_id = :employee_id', db.queries[1][0])
        self.assertIsNone(projects[0]['budget'])
        self.assertEqual(projects[0]['members'][0]['employee_id'], 12)

    def test_manager_without_store_cannot_list_projects(self):
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(list_projects_with_allowances(current_user={'roles': ['STORE_MANAGER'], 'store_id': None}, db=EmptyDb()))
        self.assertEqual(caught.exception.status_code, 403)

    def test_staff_without_employee_cannot_list_projects(self):
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(list_projects_with_allowances(current_user={'roles': ['EMPLOYEE'], 'employee_id': None}, db=EmptyDb()))
        self.assertEqual(caught.exception.status_code, 403)

    def test_manager_without_store_cannot_list_sales(self):
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(list_sales_records(period='2026-10', store_id=None, employee_id=None, current_user={'roles': ['STORE_MANAGER'], 'store_id': None}, db=EmptyDb()))
        self.assertEqual(caught.exception.status_code, 403)

    def test_manager_cannot_record_sales_for_another_store(self):
        request = SalesRecordCreate(employee_id=1, store_id=4, salary_period='2026-10', phone_revenue=100)
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(record_sales(req=request, current_user={'roles': ['STORE_MANAGER'], 'store_id': 3}, db=EmptyDb()))
        self.assertEqual(caught.exception.status_code, 403)


if __name__ == '__main__':
    unittest.main()
