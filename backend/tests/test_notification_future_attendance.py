import unittest

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import engine
from app.api.v1.endpoints.operations import notifications


class FutureAttendanceNotificationTests(unittest.IsolatedAsyncioTestCase):
    async def test_future_attendance_is_not_notified_before_event_time(self):
        async with engine.connect() as conn:
            tx = await conn.begin()
            try:
                statements = [
                    """CREATE TEMP TABLE employees(
                        employee_id int,full_name text,store_id int) ON COMMIT DROP""",
                    """CREATE TEMP TABLE leave_requests(
                        request_id int,employee_id int,status text,updated_at timestamptz)
                        ON COMMIT DROP""",
                    """CREATE TEMP TABLE notification_reads(
                        user_id int,notice_id text) ON COMMIT DROP""",
                    """CREATE TEMP TABLE overtime_requests(
                        request_id int,created_by int,employee_id int,store_id int)
                        ON COMMIT DROP""",
                    """CREATE TEMP TABLE overtime_request_events(
                        event_id int,request_id int,action text,to_status text,
                        created_at timestamptz,actor_id int) ON COMMIT DROP""",
                    """CREATE TEMP TABLE attendances(
                        attendance_id int,employee_id int,check_in_time timestamptz,
                        check_out_time timestamptz,late_minutes int) ON COMMIT DROP""",
                    """INSERT INTO employees VALUES(21,'Synthetic Employee',1)""",
                    """INSERT INTO overtime_requests VALUES(501,2,21,1)""",
                    """INSERT INTO overtime_request_events VALUES
                        (1,501,'SUBMIT','PENDING_EMPLOYEE_CONFIRMATION',now(),2)""",
                    """INSERT INTO attendances VALUES
                        (601,21,now()-interval '1 hour',NULL,0),
                        (602,21,now()+interval '1 day',NULL,0)""",
                ]
                for statement in statements:
                    await conn.execute(text(statement))
                async with AsyncSession(
                    bind=conn, join_transaction_mode="create_savepoint"
                ) as db:
                    result = await notifications(
                        user={"user_id": 3, "employee_id": 21, "roles": ["EMPLOYEE"]},
                        db=db,
                    )
                self.assertIn("overtime-event-1", {item["id"] for item in result})
                attendance_ids = {
                    item["id"] for item in result if item["id"].startswith("attendance-")
                }
                self.assertIn("attendance-in-601", attendance_ids)
                self.assertNotIn("attendance-in-602", attendance_ids)
            finally:
                await tx.rollback()
                await engine.dispose()


if __name__ == "__main__":
    unittest.main()
