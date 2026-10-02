import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4
from fastapi import HTTPException
from app.api.v1.endpoints import mobile_attendance as mobile, auth

class StaffEndpoints(unittest.IsolatedAsyncioTestCase):
    async def test_no_schedule_does_not_invent_morning_shift(self):
        db=AsyncMock(); row=MagicMock(); row.mappings.return_value.first.return_value=None; db.execute.return_value=row
        with patch.object(mobile.attendances,'authorize_employee',AsyncMock(return_value={'employee_id':17,'store_id':2})), patch.object(mobile.attendances,'latest_session',AsyncMock(return_value=None)):
            result=await mobile.attendances.get_today_attendance_status(None,{'employee_id':17},db)
        self.assertIsNone(result.shift_id);self.assertIsNone(result.shift_name);self.assertEqual(result.schedule_status,'UNSCHEDULED')

    async def test_schedules_only_current_employee(self):
        db=AsyncMock(); rows=MagicMock(); rows.mappings.return_value.all.return_value=[]; db.execute.return_value=rows
        with patch.object(mobile.attendances,'authorize_employee',AsyncMock(return_value={'employee_id':17})):
            self.assertEqual(await mobile.my_schedules('2026-10',{'employee_id':17},db),[])
        self.assertEqual(db.execute.call_args.args[1],{'emp':17,'period':'2026-10'})
        self.assertIn('ws.employee_id=:emp',str(db.execute.call_args.args[0]))

    async def test_pending_result_scoped_and_locked(self):
        db=AsyncMock(); row=MagicMock(); row.mappings.return_value.first.return_value={'verification_status':'SUCCESS','result':{'attendance_id':3}}; db.execute.return_value=row
        request_id=uuid4()
        with patch.object(mobile.attendances,'authorize_employee',AsyncMock(return_value={'employee_id':17})) as owner:
            result=await mobile.request_result(request_id,{'employee_id':17},db)
            self.assertTrue(owner.call_args.kwargs['lock'])
        self.assertEqual(result['state'],'SUCCESS'); self.assertEqual(db.execute.call_args.args[1],{'emp':17,'id':request_id})

    async def test_pending_missing_is_not_success(self):
        db=AsyncMock(); row=MagicMock(); row.mappings.return_value.first.return_value=None; db.execute.return_value=row
        with patch.object(mobile.attendances,'authorize_employee',AsyncMock(return_value={'employee_id':17})):
            self.assertEqual(await mobile.request_result(uuid4(),{},db),{'state':'NOT_FOUND'})

    async def test_password_wrong_current_never_writes(self):
        db=AsyncMock(); row=MagicMock(); row.scalar_one_or_none.return_value='old-secret'; db.execute.return_value=row
        with self.assertRaises(HTTPException) as e:
            await auth.change_password(auth.PasswordChange(current_password='wrong',new_password='new-secret'),{'user_id':4},db)
        self.assertEqual(e.exception.status_code,400); self.assertEqual(db.execute.await_count,1);db.commit.assert_not_awaited()

    async def test_password_malformed_hash_fails_closed(self):
        db=AsyncMock(); row=MagicMock(); row.scalar_one_or_none.return_value='$2b$invalid';db.execute.return_value=row
        with self.assertRaises(HTTPException): await auth.change_password(auth.PasswordChange(current_password='123456',new_password='new-secret'),{'user_id':4},db)
        db.commit.assert_not_awaited()

    async def test_password_changes_only_current_account(self):
        db=AsyncMock();row=MagicMock();row.scalar_one_or_none.return_value='old-secret';db.execute.return_value=row
        with patch.object(auth,'get_password_hash',return_value='new-bcrypt-hash'):
            await auth.change_password(auth.PasswordChange(current_password='old-secret',new_password='new-secret'),{'user_id':4},db)
        self.assertEqual(db.execute.call_args.args[1],{'hash':'new-bcrypt-hash','id':4});db.commit.assert_awaited_once()

    async def test_password_validation_before_database(self):
        for value in ['short','old-secret','a'*73,' spaced-secret ']:
            db=AsyncMock()
            with self.assertRaises(HTTPException): await auth.change_password(auth.PasswordChange(current_password='old-secret',new_password=value),{'user_id':4},db)
            db.execute.assert_not_awaited()

if __name__=='__main__':unittest.main()
