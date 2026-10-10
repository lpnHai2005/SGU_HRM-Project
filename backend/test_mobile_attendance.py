import unittest
import io
import httpx
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, patch
from uuid import uuid4
import jwt
from fastapi import HTTPException, UploadFile
from pydantic import ValidationError
from app.api.v1.endpoints import mobile_attendance as api
from app.core.config import settings
from test_attendance_sessions import result

USER = dict(employee_id=3, store_id=1, roles=['EMPLOYEE'])

def photo(employee=3, expired=False):
    return jwt.encode(dict(sub=str(employee), aud='mobile-photo', exp=datetime.now(timezone.utc)+timedelta(seconds=-1 if expired else 600), nonce=str(uuid4()), url='https://res.cloudinary.com/test/image/upload/proof.jpg'), settings.JWT_SECRET_KEY, algorithm=settings.ALGORITHM)

def body(**overrides):
    return api.MobileRequest(**(dict(request_id=uuid4(), photo_token=photo(), latitude=10, longitude=106, accuracy_meters=10, captured_at=datetime.now(timezone.utc), shift_id=1) | overrides))

class PhotoUpload(unittest.IsolatedAsyncioTestCase):
    async def test_provider_errors_are_not_session_or_network_errors(self):
        request = httpx.Request('POST', 'https://api.cloudinary.com/test')
        errors = [(httpx.HTTPStatusError('provider', request=request, response=httpx.Response(code, request=request)), expected)
                  for code, expected in [(401, 503), (403, 503), (500, 502)]]
        errors.append((httpx.ReadTimeout('timeout', request=request), 504))
        for error, expected in errors:
            with self.subTest(error=type(error).__name__, expected=expected):
                client = AsyncMock()
                client.__aenter__.return_value = client
                client.post.side_effect = error
                with patch.object(api.httpx, 'AsyncClient', return_value=client), \
                     patch.object(settings, 'CLOUDINARY_CLOUD_NAME', 'test'), \
                     patch.object(settings, 'CLOUDINARY_API_KEY', 'test'), \
                     patch.object(settings, 'CLOUDINARY_API_SECRET', 'test'):
                    with self.assertRaises(HTTPException) as caught:
                        await api.upload_photo(UploadFile(file=io.BytesIO(b'\xff\xd8\xfftest'), filename='selfie.jpg'), USER)
                self.assertEqual(caught.exception.status_code, expected)
                self.assertIn('Cloudinary', caught.exception.detail)

class Rules(unittest.TestCase):
    def test_distance(self):
        self.assertEqual(api.distance_meters(10,106,10,106), 0)
        self.assertAlmostEqual(api.distance_meters(0,0,0,1),111194.9, places=0)

    def test_gps_validation(self):
        for values in [dict(latitude=91), dict(longitude=float('nan')), dict(accuracy_meters=0), dict(accuracy_meters=101)]:
            with self.assertRaises(ValidationError): body(**values)

    def test_photo_owner(self):
        with self.assertRaises(HTTPException): api.verify_photo(photo(employee=4), 3)

    def test_expired_photo(self):
        with self.assertRaises(HTTPException): api.verify_photo(photo(expired=True),3)

    def test_photo_token_is_not_access_token(self):
        from app.core.security import decode_token
        self.assertIsNone(decode_token(photo()))

class Workflow(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.db = AsyncMock()
        self.owner = patch.object(api.attendances,'authorize_employee', AsyncMock(return_value=USER))
        self.fence = patch.object(api,'geofence', AsyncMock(return_value=dict(store_id=1,latitude=10,longitude=106,radius_meters=150)))
        self.owner.start(); self.fence.start()
    async def asyncTearDown(self):
        self.owner.stop(); self.fence.stop()

    async def test_idempotent_retry(self):
        self.db.execute.return_value = result(dict(check_type='CHECK_IN', result={'attendance_id':9}, verification_status='SUCCESS'))
        with patch.object(api.attendances,'check_in', AsyncMock()) as core:
            self.assertEqual(await api.perform('CHECK_IN',body(),USER,self.db), {'attendance_id':9})
            core.assert_not_awaited()

    async def test_request_cannot_change_action(self):
        self.db.execute.return_value = result(dict(check_type='CHECK_IN', result={}, verification_status='SUCCESS'))
        with self.assertRaises(HTTPException) as caught: await api.perform('CHECK_OUT',body(),USER,self.db)
        self.assertEqual(caught.exception.status_code,409)

    async def test_outside_radius_logs_without_attendance(self):
        empty = result(); empty.first.return_value = None
        self.db.execute.side_effect = [result(),empty,result()]
        with patch.object(api.attendances,'check_in',AsyncMock()) as core:
            with self.assertRaises(HTTPException) as caught: await api.perform('CHECK_IN',body(latitude=11),USER,self.db)
            self.assertEqual(caught.exception.status_code,422)
            core.assert_not_awaited()
        self.assertEqual(self.db.execute.call_args.args[1]['status'],'REJECTED_GPS_OUT_OF_RANGE')
        self.db.commit.assert_awaited_once()

    async def test_stale_gps_rejected(self):
        empty = result(); empty.first.return_value=None
        self.db.execute.side_effect=[result(),empty]
        with self.assertRaises(HTTPException):
            await api.perform('CHECK_IN',body(captured_at=datetime.now(timezone.utc)-timedelta(minutes=3)),USER,self.db)
        self.db.commit.assert_not_awaited()

    async def test_photo_replay_rejected(self):
        used = result(); used.first.return_value=(1,)
        self.db.execute.side_effect=[result(),used]
        with self.assertRaises(HTTPException) as caught: await api.perform('CHECK_IN',body(),USER,self.db)
        self.assertEqual(caught.exception.status_code,409)

    async def test_success_commits_after_proof(self):
        empty = result(); empty.first.return_value=None
        self.db.execute.side_effect=[result(),empty,result(dict(shift_id=1,store_id=1)),result()]
        async def core(req,user,db):
            await db.commit()
            self.db.commit.assert_not_awaited()
            return {'attendance_id':9}
        with patch.object(api.attendances,'check_in',core):
            self.assertEqual(await api.perform('CHECK_IN',body(),USER,self.db),{'attendance_id':9})
        self.assertEqual(self.db.execute.call_args.args[1]['att'],9)
        self.db.commit.assert_awaited_once()

    async def test_core_conflict_does_not_write_proof(self):
        empty = result(); empty.first.return_value=None
        self.db.execute.side_effect=[result(),empty,result(dict(shift_id=1,store_id=1))]
        with patch.object(api.attendances,'check_in',AsyncMock(side_effect=HTTPException(429,'wait'))):
            with self.assertRaises(HTTPException): await api.perform('CHECK_IN',body(),USER,self.db)
        self.db.commit.assert_not_awaited()

    async def test_assignment_required_and_cannot_be_changed(self):
        for schedule, shift in [(None, 1), (dict(shift_id=2,store_id=1), 1), (dict(shift_id=1,store_id=2), 1)]:
            self.db.execute.return_value = result(schedule)
            with self.assertRaises(HTTPException) as caught:
                await api.require_assigned_shift(self.db, USER, shift)
            self.assertEqual(caught.exception.status_code, 409)
        self.db.commit.assert_not_awaited()

if __name__ == '__main__': unittest.main()
