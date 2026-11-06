"""Offline regression tests: python -m unittest test_attendance_sessions -v."""
import unittest
from datetime import datetime, date, time, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import HTTPException, FastAPI
from httpx import AsyncClient, ASGITransport
from app.core.attendance import VIETNAM_TZ, attendance_context, availability, require_available, session_metrics
from app.api.v1.endpoints import attendances as api
from app.api.v1.endpoints import overtime_reconciliations as reconciliation_api
from app.api.deps import get_current_user
from app.core.database import get_db
from app.api.v1.endpoints.operations import _shift_deviation_minutes, enrich_session_record, verified_ot_metrics

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

    def test_checkout_records_elapsed_hours_without_implicit_break_deduction(self):
        att = dict(check_in_time=datetime(2026, 9, 26, 9, tzinfo=VIETNAM_TZ),
                   work_date=date(2026, 9, 26), start_time=time(8), end_time=time(16),
                   work_hours=8, late_minutes=60,
                   attendance_context={'version': 1, 'actual': {
                       'start_time': '08:00:00', 'end_time': '16:00:00',
                       'work_hours': 8,
                   }})
        metrics = session_metrics(att, datetime(2026, 9, 26, 17, tzinfo=VIETNAM_TZ))
        self.assertEqual(metrics['actual_work_hours'], 8)
        self.assertEqual(metrics['overtime_hours'], 0)
        self.assertEqual(metrics['status'], 'LATE')

    def test_afternoon_checkout_records_full_elapsed_hours(self):
        att = dict(check_in_time=datetime(2026, 9, 26, 13, tzinfo=VIETNAM_TZ),
                   work_date=date(2026, 9, 26), start_time=time(13), end_time=time(21),
                   work_hours=8, late_minutes=0,
                   attendance_context={'version': 1, 'actual': {
                       'start_time': '13:00:00', 'end_time': '21:00:00',
                       'work_hours': 8,
                   }})
        metrics = session_metrics(att, datetime(2026, 9, 26, 21, tzinfo=VIETNAM_TZ))
        self.assertEqual(metrics['actual_work_hours'], 8)
        self.assertEqual(metrics['overtime_hours'], 0)
        self.assertEqual(metrics['status'], 'NORMAL')

    def test_attendance_context_does_not_infer_break_policy(self):
        shift = dict(shift_id=2, start_time=time(8), end_time=time(16), work_hours=8,
                     break_minutes=60)
        context = attendance_context(shift, None, 1)
        self.assertEqual(context['version'], 1)
        self.assertNotIn('break_minutes', context['actual'])

    def test_activity_duration_matches_attendance_elapsed_hours(self):
        row = dict(
            attendance_id=10, employee_id=3, work_date=date(2026, 9, 26),
            check_in_time=datetime(2026, 9, 26, 9, tzinfo=VIETNAM_TZ),
            check_out_time=datetime(2026, 9, 26, 17, tzinfo=VIETNAM_TZ),
            actual_work_hours=8, late_minutes=0, early_minutes=0, overtime_hours=0,
            attendance_context={'version': 1, 'actual': {
                'start_time': '08:00:00', 'end_time': '16:00:00', 'work_hours': 8,
            }},
        )
        enriched = enrich_session_record(row)
        self.assertEqual(enriched['raw_duration_minutes'], 480)
        self.assertEqual(enriched['net_duration_minutes'], 480)
        self.assertIsNone(enriched['break_minutes'])

    def test_legacy_checkout_uses_elapsed_hours(self):
        att = dict(check_in_time=datetime(2026, 9, 26, 9, tzinfo=VIETNAM_TZ),
                   work_date=date(2026, 9, 26), start_time=time(8), end_time=time(16),
                   work_hours=7, late_minutes=60)
        metrics = session_metrics(att, datetime(2026, 9, 26, 17, tzinfo=VIETNAM_TZ))
        self.assertEqual(metrics['actual_work_hours'], 8)
        self.assertEqual(metrics['overtime_hours'], 1)

    def test_shift_reassignment_uses_ceil_late_and_overnight_end(self):
        late, early = _shift_deviation_minutes(
            datetime(2026, 9, 26, 22, 15, 1),
            datetime(2026, 9, 27, 5, 59, 59),
            date(2026, 9, 26), time(22), time(6),
        )
        self.assertEqual(late, 16)  # started-minute rounding matches check-in
        self.assertEqual(early, 0)  # checkout is one second before 06:00 (floor whole minutes)

    def test_verified_ot_ledger_deduplicates_month_and_session_hours(self):
        session = dict(attendance_id=10, employee_id=3,
                       check_in_time=datetime(2026, 10, 31, 16, tzinfo=VIETNAM_TZ),
                       check_out_time=datetime(2026, 10, 31, 18, tzinfo=VIETNAM_TZ))
        interval = {"starts_at": "2026-10-31T16:30:00+07:00",
                    "ends_at": "2026-10-31T17:30:00+07:00"}
        reconciliations = [
            dict(employee_id=3, request_id=1, verified_microseconds=3_600_000_000,
                 eligible_intervals=[interval], attendance_ids=[10]),
            dict(employee_id=3, request_id=2, verified_microseconds=3_600_000_000,
                 eligible_intervals=[interval], attendance_ids=[10]),
        ]
        employee_hours, session_hours, request_ids, ambiguous = verified_ot_metrics(
            reconciliations, [session], date(2026, 10, 1), date(2026, 10, 31))
        self.assertEqual(employee_hours[3], 1)
        self.assertEqual(session_hours[10], 1)
        self.assertEqual(request_ids[10], {1, 2})
        self.assertEqual(ambiguous, set())

    def test_verified_ot_not_double_attributed_to_overlapping_sessions(self):
        sessions = [
            dict(attendance_id=10, employee_id=3,
                 check_in_time=datetime(2026, 10, 31, 16, tzinfo=VIETNAM_TZ),
                 check_out_time=datetime(2026, 10, 31, 18, tzinfo=VIETNAM_TZ)),
            dict(attendance_id=11, employee_id=3,
                 check_in_time=datetime(2026, 10, 31, 17, tzinfo=VIETNAM_TZ),
                 check_out_time=datetime(2026, 10, 31, 19, tzinfo=VIETNAM_TZ)),
        ]
        reconciliation = [dict(employee_id=3, request_id=1, verified_microseconds=3_600_000_000,
                               eligible_intervals=[{"starts_at": "2026-10-31T17:30:00+07:00",
                                                    "ends_at": "2026-10-31T18:30:00+07:00"}],
                               attendance_ids=[10, 11])]
        _, session_hours, _, ambiguous = verified_ot_metrics(
            reconciliation, sessions, date(2026, 10, 1), date(2026, 10, 31))
        self.assertEqual(session_hours, {})
        self.assertEqual(ambiguous, {10, 11})

    def test_verified_ot_is_split_at_local_month_boundary(self):
        session = dict(attendance_id=10, employee_id=3,
                       check_in_time=datetime(2026, 10, 31, 23, tzinfo=VIETNAM_TZ),
                       check_out_time=datetime(2026, 11, 1, 1, tzinfo=VIETNAM_TZ))
        reconciliation = [dict(employee_id=3, request_id=7, verified_microseconds=3_600_000_000,
                               eligible_intervals=[{"starts_at": "2026-10-31T23:30:00+07:00",
                                                    "ends_at": "2026-11-01T00:30:00+07:00"}],
                               attendance_ids=[10])]
        oct_hours, _, _, _ = verified_ot_metrics(
            reconciliation, [session], date(2026, 10, 1), date(2026, 10, 31))
        nov_hours, _, _, _ = verified_ot_metrics(
            reconciliation, [session], date(2026, 11, 1), date(2026, 11, 30))
        self.assertEqual(oct_hours[3], 0.5)
        self.assertEqual(nov_hours[3], 0.5)
        self.assertEqual(oct_hours[3] + nov_hours[3], 1)

class ReconciliationListFilterTests(unittest.IsolatedAsyncioTestCase):
    async def test_employee_filter_is_added_without_widening_manager_scope(self):
        db = AsyncMock()
        db.execute.side_effect = [result(scalar=True), result(rows=[])]
        response = await reconciliation_api.list_reconciliations(
            status=None, date_from=None, date_to=None, store_id=None,
            employee_id=42, limit=100, offset=25,
            user={"user_id": 2, "employee_id": 20, "store_id": 1,
                  "roles": ["STORE_MANAGER"]},
            db=db,
        )

        self.assertEqual(response, [])
        query, params = db.execute.call_args_list[1].args
        self.assertIn("r.employee_id=:selected_employee", str(query))
        self.assertIn("(r.store_id=:store OR r.employee_id=:employee)", str(query))
        self.assertIn("LIMIT :limit OFFSET :offset", str(query))
        self.assertEqual(params["selected_employee"], 42)
        self.assertEqual(params["store"], 1)
        self.assertEqual(params["offset"], 25)

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
        self.network_check = patch.object(api, 'require_store_web_network', new=AsyncMock())
        self.network_check.start()

    async def asyncTearDown(self):
        self.clock.stop()
        self.network_check.stop()
        await self.client.aclose()

    async def test_new_session_insert_not_overwrite(self):
        self.db.execute.side_effect = [result(dict(employee_id=3, store_id=1, full_name='Test')),
            result(dict(check_in_time=NOW-timedelta(hours=1), check_out_time=NOW-timedelta(seconds=60))),
            result(dict(shift_id=1, start_time=time(8), end_time=time(16), work_hours=8, shift_name='Morning')),
            result(None), result(scalar=99)]
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

    async def test_proxy_checkin_forbidden_for_every_role_and_store_scope(self):
        for role in ['EMPLOYEE', 'STORE_MANAGER', 'HR_MANAGER', 'ADMIN', 'DIRECTOR']:
            for target_employee_id in [4, 5]:
                with self.subTest(role=role, target_employee_id=target_employee_id):
                    actor = dict(employee_id=3, store_id=1, roles=[role])
                    self.app.dependency_overrides[get_current_user] = lambda actor=actor: actor
                    self.db.execute.reset_mock()
                    self.db.commit.reset_mock()
                    response = await self.client.post(
                        '/attendances/check-in',
                        json={'employee_id': target_employee_id, 'shift_id': 1},
                    )
                    self.assertEqual(response.status_code, 403, response.text)
                    self.db.execute.assert_not_awaited()
                    self.db.commit.assert_not_awaited()

    async def test_unmapped_account_cannot_check_in_or_out(self):
        actor = dict(employee_id=None, store_id=1, roles=['STORE_MANAGER'])
        self.app.dependency_overrides[get_current_user] = lambda: actor
        for path, body in [
            ('/attendances/check-in', {'shift_id': 1}),
            ('/attendances/check-out', {'attendance_id': 99}),
        ]:
            with self.subTest(path=path):
                self.db.execute.reset_mock()
                self.db.commit.reset_mock()
                response = await self.client.post(path, json=body)
                self.assertEqual(response.status_code, 403, response.text)
                self.db.execute.assert_not_awaited()
                self.db.commit.assert_not_awaited()

    async def test_missing_or_invalid_jwt_rejected_before_attendance_access(self):
        app = FastAPI()
        app.include_router(api.router, prefix='/attendances')
        app.dependency_overrides[get_db] = lambda: self.db
        async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
            for path, body in [
                ('/attendances/check-in', {'shift_id': 1}),
                ('/attendances/check-out', {'attendance_id': 99}),
            ]:
                for headers in [{}, {'Authorization': 'Bearer invalid-token'}]:
                    with self.subTest(path=path, headers=headers):
                        self.db.reset_mock()
                        response = await client.post(path, json=body, headers=headers)
                        self.assertEqual(response.status_code, 401, response.text)
                        self.db.execute.assert_not_awaited()
                        self.db.commit.assert_not_awaited()

    async def test_privileged_roles_can_check_in_and_out_self(self):
        for role in ['HR_MANAGER', 'ADMIN', 'DIRECTOR']:
            with self.subTest(role=role):
                actor = dict(employee_id=3, store_id=1, roles=[role])
                self.app.dependency_overrides[get_current_user] = lambda actor=actor: actor
                self.db.reset_mock()
                body = await self.check_in_for_schedule(None)
                self.assertEqual(body['attendance_id'], 99)

                self.db.commit.reset_mock()
                att = dict(attendance_id=99, employee_id=3, store_id=1,
                           check_in_time=NOW-timedelta(hours=2), check_out_time=None,
                           work_date=NOW.date(), start_time=time(8), end_time=time(16),
                           work_hours=8, late_minutes=0)
                self.db.execute.side_effect = [
                    result(dict(employee_id=3)),
                    result(dict(employee_id=3, store_id=1, full_name='Self')),
                    result(att), result(),
                ]
                response = await self.client.post('/attendances/check-out', json={'attendance_id': 99})
                self.assertEqual(response.status_code, 200, response.text)
                self.db.commit.assert_awaited_once()

    async def test_proxy_checkout_forbidden_for_every_role_without_writes(self):
        for role in ['EMPLOYEE', 'STORE_MANAGER', 'HR_MANAGER', 'ADMIN', 'DIRECTOR']:
            with self.subTest(role=role):
                actor = dict(employee_id=3, store_id=1, roles=[role])
                self.app.dependency_overrides[get_current_user] = lambda actor=actor: actor
                self.db.execute.reset_mock()
                self.db.commit.reset_mock()
                self.db.execute.side_effect = [result(dict(employee_id=4))]
                response = await self.client.post(
                    '/attendances/check-out', json={'attendance_id': 99},
                )
                self.assertEqual(response.status_code, 403, response.text)
                self.db.execute.assert_awaited_once()
                statement = str(self.db.execute.await_args.args[0]).lower()
                self.assertTrue(statement.lstrip().startswith('select'))
                self.assertNotIn('insert', statement)
                self.assertNotIn('update', statement)
                self.db.commit.assert_not_awaited()

    async def test_manager_can_check_in_and_out_self(self):
        manager = dict(employee_id=3, store_id=1, roles=['STORE_MANAGER'])
        self.app.dependency_overrides[get_current_user] = lambda: manager
        body = await self.check_in_for_schedule(None)
        self.assertEqual(body['attendance_id'], 99)

        self.db.commit.reset_mock()
        att = dict(attendance_id=99, employee_id=3, store_id=1,
                   check_in_time=NOW-timedelta(hours=2), check_out_time=None,
                   work_date=NOW.date(), start_time=time(8), end_time=time(16),
                   work_hours=8, late_minutes=0)
        self.db.execute.side_effect = [
            result(dict(employee_id=3)),
            result(dict(employee_id=3, store_id=1, full_name='Manager')),
            result(att),
            result(),
        ]
        response = await self.client.post('/attendances/check-out', json={'attendance_id': 99})
        self.assertEqual(response.status_code, 200, response.text)
        self.db.commit.assert_awaited_once()

    async def test_manager_attendance_read_scope_remains_available(self):
        manager = dict(employee_id=3, store_id=1, roles=['STORE_MANAGER'])
        self.app.dependency_overrides[get_current_user] = lambda: manager
        self.db.execute.return_value = result(rows=[])
        response = await self.client.get('/attendances?employee_id=4')
        self.assertEqual(response.status_code, 200, response.text)
        statement, params = self.db.execute.await_args.args
        self.assertIn('a.store_id = :mgr_store_id', str(statement))
        self.assertEqual(params['mgr_store_id'], 1)

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
            result(dict(employee_id=3, store_id=1)), result(dict(employee_id=3, store_id=1, check_in_time=NOW, check_out_time=NOW))]
        response = await self.client.post('/attendances/check-out', json={'attendance_id':1})
        self.assertEqual(response.status_code, 409)
        self.db.commit.assert_not_awaited()

    async def test_checkout_persists_calculated_status(self):
        att = dict(attendance_id=1, employee_id=3, store_id=1, check_in_time=NOW-timedelta(hours=1), check_out_time=None,
                   work_date=NOW.date(), start_time=time(8), end_time=time(16), work_hours=8, late_minutes=60)
        self.db.execute.side_effect = [result(dict(employee_id=3, store_id=1)), result(att), result()]
        response = await self.client.post('/attendances/check-out', json={})
        self.assertEqual(response.status_code, 200, response.text)
        persisted = self.db.execute.call_args_list[-1].args[1]
        self.assertEqual(persisted['status'], response.json()['status'])
        self.assertEqual(persisted['actual_work_hours'], 1)
        self.assertEqual(response.json()['next_check_in_at'], (NOW+timedelta(seconds=60)).isoformat())

    async def test_checkout_minimum_sixty_seconds(self):
        for elapsed in [0, 59, 59.9, 60, 61]:
            with self.subTest(elapsed=elapsed):
                self.db.reset_mock()
                att = dict(attendance_id=1, employee_id=3, store_id=1, check_in_time=NOW-timedelta(seconds=elapsed), check_out_time=None,
                           work_date=NOW.date(), start_time=time(8), end_time=time(16), work_hours=8, late_minutes=0)
                self.db.execute.side_effect = [result(dict(employee_id=3,store_id=1)), result(att), result()]
                response = await self.client.post('/attendances/check-out',json={})
                if elapsed < 60:
                    self.assertEqual(response.status_code,429,response.text)
                    self.assertGreaterEqual(int(response.headers['Retry-After']),1)
                    self.db.commit.assert_not_awaited()
                    self.assertEqual(self.db.execute.await_count,2)
                else:
                    self.assertEqual(response.status_code,200,response.text)
                    self.db.commit.assert_awaited_once()

    async def test_history_scoped_and_all_sessions(self):
        self.db.execute.return_value = result(rows=[])
        response = await self.client.get('/attendances/my-history?period=2026-09')
        self.assertEqual(response.status_code, 200)
        query, params = self.db.execute.call_args.args
        self.assertIn('a.employee_id = :emp_id', str(query))
        self.assertEqual(params, dict(emp_id=3, period='2026-09'))

    async def check_in_for_schedule(self, schedule):
        self.db.execute.side_effect = [result(dict(employee_id=3, store_id=1, full_name='Test')),
            result(None), result(dict(shift_id=1, start_time=time(8), end_time=time(16), work_hours=8, shift_name='Morning')),
            result(schedule), result(scalar=99)]
        response = await self.client.post('/attendances/check-in', json={'shift_id':1})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    async def test_no_schedule_allowed_and_marked_unscheduled(self):
        body = await self.check_in_for_schedule(None)
        self.assertEqual(body['schedule_status'], 'UNSCHEDULED')
        self.assertIsNone(body['attendance_context']['planned'])
        import json
        saved = json.loads(self.db.execute.call_args.args[1]['context'])
        self.assertEqual(saved, body['attendance_context'])

    async def test_wrong_assigned_shift_is_rejected(self):
        self.db.execute.side_effect = [result(dict(employee_id=3, store_id=1, full_name='Test')),
            result(None), result(dict(shift_id=1, start_time=time(8), end_time=time(16), work_hours=7)),
            result(dict(schedule_id=10, shift_id=2, store_id=1))]
        response = await self.client.post('/attendances/check-in', json={'shift_id':1})
        self.assertEqual(response.status_code, 409, response.text)

    async def test_afternoon_grace_boundary(self):
        start = NOW.replace(hour=13, minute=0, second=0)
        for seconds, expected in [(899, 'NORMAL'), (900, 'NORMAL'), (901, 'LATE'), (960, 'LATE')]:
            with self.subTest(seconds=seconds), patch.object(api, 'local_now', return_value=start+timedelta(seconds=seconds)):
                self.db.execute.side_effect = [result(dict(employee_id=3, store_id=1, full_name='Test')),
                    result(None), result(dict(shift_id=2, start_time=time(13), end_time=time(21), work_hours=8, shift_name='Afternoon')),
                    result(dict(schedule_id=10, shift_id=2, store_id=1)), result(scalar=99)]
                response = await self.client.post('/attendances/check-in', json={'shift_id':2})
                self.assertEqual(response.status_code, 201, response.text)
                self.assertEqual(response.json()['status'], expected)
                self.assertEqual(response.json()['schedule_status'], 'MATCHED')

    async def test_late_and_overtime_preserve_numbers(self):
        att = dict(attendance_id=1, employee_id=3, store_id=1, check_in_time=NOW.replace(hour=9), check_out_time=None,
                   work_date=NOW.date(), start_time=time(8), end_time=time(16), work_hours=8, late_minutes=60)
        self.db.execute.side_effect = [result(dict(employee_id=3, store_id=1)), result(att), result()]
        with patch.object(api, 'local_now', return_value=NOW.replace(hour=18)):
            response = await self.client.post('/attendances/check-out', json={})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['status'], 'LATE')
        self.assertEqual(response.json()['overtime_hours'], 1)
        self.assertEqual(self.db.execute.call_args.args[1]['overtime_hours'], 1)
        checkout_update = str(self.db.execute.call_args.args[0]).lower()
        self.assertNotIn('late_minutes =', checkout_update)
        self.assertIn('update attendances', checkout_update)
        self.assertNotIn('overtime_requests', checkout_update)
        self.assertNotIn('attendance_overtime_approvals', checkout_update)

    async def test_schedule_edited_after_checkin_uses_snapshot(self):
        body = await self.check_in_for_schedule(dict(schedule_id=10, shift_id=1, store_id=1))
        # Simulate current shift now being 13:00-21:00/7h; original was 08:00-16:00/8h.
        att = dict(attendance_id=99, employee_id=3, store_id=1, check_in_time=NOW.replace(hour=8), check_out_time=None,
                   work_date=NOW.date(), start_time=time(13), end_time=time(21), work_hours=7,
                   late_minutes=0, attendance_context=body['attendance_context'])
        self.db.execute.side_effect = [result(dict(employee_id=3, store_id=1)), result(att), result()]
        with patch.object(api, 'local_now', return_value=NOW.replace(hour=16)):
            response = await self.client.post('/attendances/check-out', json={})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['early_minutes'], 0)
        self.assertEqual(response.json()['overtime_hours'], 0)
        self.assertEqual(response.json()['status'], 'NORMAL')

if __name__ == '__main__':
    unittest.main()
