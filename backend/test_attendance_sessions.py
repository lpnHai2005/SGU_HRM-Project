"""Offline regression tests: python -m unittest test_attendance_sessions -v."""
import unittest
from datetime import datetime, date, time, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import HTTPException, FastAPI
from httpx import AsyncClient, ASGITransport
from app.core.attendance import VIETNAM_TZ, availability, require_available, session_metrics
from app.api.v1.endpoints import attendances as api
from app.api.deps import get_current_user
from app.core.database import get_db

NOW = datetime(2026, 9, 26, 10, tzinfo=VIETNAM_TZ)
USER = dict(employee_id=3, store_id=1, roles=['EMPLOYEE'])

def result(row=None, scalar=None, rows=None):
    value = MagicMock()
    value.mappings.return_value.first.return_value = row
    value.mappings.return_value.all.return_value = rows or []
    value.scalar_one.return_value = scalar
    return value

class Rules(unittest.TestCase):
    def test_cooldown_boundaries(self):
        for seconds, expected in [(0, 60), (59, 1), (59.9, 1), (60, 0), (61, 0)]:
            last = dict(check_in_time=NOW-timedelta(hours=1), check_out_time=NOW-timedelta(seconds=seconds))
            self.assertEqual(availability(last, NOW)['cooldown_seconds_remaining'], expected)
            if expected:
                with self.assertRaises(HTTPException) as caught:
                    require_available(last, NOW)
                self.assertEqual(caught.exception.status_code, 429)
                self.assertEqual(caught.exception.headers['Retry-After'], str(expected))
            else:
                require_available(last, NOW)

    def test_open_session_blocks_next_day(self):
        with self.assertRaises(HTTPException) as caught:
            require_available(dict(check_in_time=NOW-timedelta(days=1), check_out_time=None), NOW)
        self.assertEqual(caught.exception.status_code, 409)

    def test_first_session(self):
        self.assertTrue(availability(None, NOW)['can_check_in'])

    def test_overnight_and_timezone(self):
        att = dict(check_in_time=datetime(2026, 9, 25, 15, tzinfo=timezone.utc),
                   work_date=date(2026, 9, 25), start_time=time(22), end_time=time(6),
                   work_hours=8, late_minutes=0)
        metrics = session_metrics(att, datetime(2026, 9, 26, 6, tzinfo=VIETNAM_TZ))
        self.assertEqual(metrics, dict(actual_work_hours=8, overtime_hours=0, early_minutes=0, status='NORMAL'))

    def test_short_session_not_inflated(self):
        att = dict(check_in_time=NOW, work_date=NOW.date(), start_time=time(8), end_time=time(16),
                   work_hours=8, late_minutes=120)
        metrics = session_metrics(att, NOW+timedelta(seconds=1))
        self.assertEqual(metrics['actual_work_hours'], 0)
        self.assertEqual(metrics['status'], 'LATE_AND_EARLY')

class Endpoints(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.db = AsyncMock()
        self.app = FastAPI()
        self.app.include_router(api.router, prefix='/attendances')
        self.app.dependency_overrides[get_current_user] = lambda: USER
        self.app.dependency_overrides[get_db] = lambda: self.db
        self.client = AsyncClient(transport=ASGITransport(app=self.app), base_url='http://test')
        self.clock = patch.object(api, 'local_now', return_value=NOW)
        self.clock.start()

    async def asyncTearDown(self):
        self.clock.stop()
        await self.client.aclose()

    async def test_new_session_insert_not_overwrite(self):
        self.db.execute.side_effect = [result(dict(employee_id=3, store_id=1, full_name='Test')),
            result(dict(check_in_time=NOW-timedelta(hours=1), check_out_time=NOW-timedelta(seconds=60))),
            result(dict(start_time=time(8), end_time=time(16), shift_name='Morning')), result(scalar=99)]
        response = await self.client.post('/attendances/check-in', json={'shift_id':1})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()['attendance_id'], 99)
        calls = self.db.execute.call_args_list
        self.assertIn('FOR UPDATE', str(calls[0].args[0]))
        self.assertIn('INSERT INTO attendances', str(calls[-1].args[0]))
        self.db.commit.assert_awaited_once()

    async def test_cross_employee_forbidden(self):
        self.db.execute.return_value = result(dict(employee_id=4, store_id=2))
        response = await self.client.post('/attendances/check-in', json={'employee_id':4})
        self.assertEqual(response.status_code, 403)
        self.db.commit.assert_not_awaited()

    async def test_manager_cross_branch_forbidden(self):
        self.app.dependency_overrides[get_current_user] = lambda: dict(USER, roles=['STORE_MANAGER'])
        self.db.execute.return_value = result(dict(employee_id=4, store_id=2))
        response = await self.client.get('/attendances/today-status?employee_id=4')
        self.assertEqual(response.status_code, 403)

    async def test_employee_cannot_list_everyone(self):
        response = await self.client.get('/attendances')
        self.assertEqual(response.status_code, 403)

    async def test_invalid_month_and_id(self):
        for path in ['/attendances/my-summary?period=2026-13', '/attendances/my-history?period=oops']:
            self.assertEqual((await self.client.get(path)).status_code, 422)
        self.assertEqual((await self.client.post('/attendances/check-in', json={'shift_id':0})).status_code, 422)

    async def test_double_checkout_rejected(self):
        self.db.execute.side_effect = [result(dict(employee_id=3)),
            result(dict(employee_id=3, store_id=1)), result(dict(check_in_time=NOW, check_out_time=NOW))]
        response = await self.client.post('/attendances/check-out', json={'attendance_id':1})
        self.assertEqual(response.status_code, 409)
        self.db.commit.assert_not_awaited()

    async def test_checkout_persists_calculated_status(self):
        att = dict(attendance_id=1, check_in_time=NOW-timedelta(hours=1), check_out_time=None,
                   work_date=NOW.date(), start_time=time(8), end_time=time(16), work_hours=8, late_minutes=60)
        self.db.execute.side_effect = [result(dict(employee_id=3, store_id=1)), result(att), result()]
        response = await self.client.post('/attendances/check-out', json={})
        self.assertEqual(response.status_code, 200, response.text)
        persisted = self.db.execute.call_args_list[-1].args[1]
        self.assertEqual(persisted['status'], response.json()['status'])
        self.assertEqual(persisted['actual_work_hours'], 1)
        self.assertEqual(response.json()['next_check_in_at'], (NOW+timedelta(seconds=60)).isoformat())

    async def test_history_scoped_and_all_sessions(self):
        self.db.execute.return_value = result(rows=[])
        response = await self.client.get('/attendances/my-history?period=2026-09')
        self.assertEqual(response.status_code, 200)
        query, params = self.db.execute.call_args.args
        self.assertIn('a.employee_id = :emp_id', str(query))
        self.assertEqual(params, dict(emp_id=3, period='2026-09'))

if __name__ == '__main__':
    unittest.main()
