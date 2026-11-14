"""DB-free: admin password reset always sets the fixed default password."""
import asyncio
import unittest
from unittest.mock import patch

from app.api.v1.endpoints import users
from app.core.security import verify_password


class Result:
    def __init__(self, row=None):
        self.row = row

    def mappings(self):
        return self

    def first(self):
        return self.row


class FakeDb:
    def __init__(self, user_row):
        self.user_row = user_row
        self.updates = []
        self.commits = 0

    async def execute(self, statement, params=None):
        sql = str(statement)
        if sql.lstrip().upper().startswith("UPDATE"):
            self.updates.append(params)
            return Result()
        return Result(self.user_row)

    async def commit(self):
        self.commits += 1


class Request:
    client = None


class ResetPasswordTests(unittest.TestCase):
    def run_reset(self, user_row):
        db = FakeDb(user_row)

        async def go():
            with patch.object(users, "record_audit_log", return_value=None):
                return await users.reset_user_password(
                    user_id=5, request=Request(), db=db, current_user={"user_id": 1, "roles": ["ADMIN"]})
        return db, asyncio.run(go())

    def test_resets_to_default_password(self):
        db, result = self.run_reset({"user_id": 5, "username": "tz005"})
        self.assertEqual(len(db.updates), 1)
        self.assertEqual(db.updates[0]["id"], 5)
        self.assertTrue(verify_password("TechZone@2026", db.updates[0]["hash"]))
        self.assertEqual(db.commits, 1)
        self.assertIn("TechZone@2026", result["message"])

    def test_unknown_user_is_404_and_writes_nothing(self):
        from fastapi import HTTPException
        db = FakeDb(None)
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(users.reset_user_password(
                user_id=99, request=Request(), db=db, current_user={"user_id": 1, "roles": ["ADMIN"]}))
        self.assertEqual(caught.exception.status_code, 404)
        self.assertEqual(db.updates, [])


if __name__ == "__main__":
    unittest.main()
