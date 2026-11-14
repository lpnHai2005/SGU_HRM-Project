"""DB-free checks: ADMIN is confined to the /admin module, other roles cannot reach it."""
import asyncio
import unittest

import httpx
from fastapi import HTTPException

from app.api.deps import deny_admin, get_current_user
from app.api.v1.endpoints.stores import admin as store_admin
from app.core.security import create_access_token
from app.main import app

BUSINESS_GETS = [
    "/api/v1/employees", "/api/v1/leaves", "/api/v1/payrolls", "/api/v1/contracts",
    "/api/v1/attendances", "/api/v1/work-shifts", "/api/v1/resignations",
    "/api/v1/overtime-requests", "/api/v1/reports/dashboard-kpis",
]


def call(method, path, token=None, user=None, **kw):
    async def run():
        # test_poi_search.py installs a global override on the stores guard; hide it here.
        hidden = app.dependency_overrides.pop(store_admin, None)
        if user is not None:
            app.dependency_overrides[get_current_user] = lambda: user
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
                headers = {"Authorization": f"Bearer {token}"} if token else {}
                return await c.request(method, path, headers=headers, **kw)
        finally:
            app.dependency_overrides.pop(get_current_user, None)
            if hidden is not None:
                app.dependency_overrides[store_admin] = hidden
    return asyncio.run(run())


class DenyAdminTests(unittest.TestCase):
    def test_no_token_is_left_to_endpoint(self):
        self.assertIsNone(deny_admin(None))

    def test_staff_token_passes(self):
        self.assertIsNone(deny_admin(create_access_token("u", roles=["HR_MANAGER"])))

    def test_admin_token_is_forbidden(self):
        with self.assertRaises(HTTPException) as caught:
            deny_admin(create_access_token("a", roles=["ADMIN"]))
        self.assertEqual(caught.exception.status_code, 403)


class AdminCannotReachBusinessApi(unittest.TestCase):
    def test_business_routers_return_403_for_admin(self):
        token = create_access_token("a", roles=["ADMIN"])
        for path in BUSINESS_GETS:
            with self.subTest(path=path):
                self.assertEqual(call("GET", path, token=token).status_code, 403)

    def test_payroll_calculate_is_403_for_admin(self):
        token = create_access_token("a", roles=["ADMIN"])
        self.assertEqual(call("POST", "/api/v1/payrolls/calculate", token=token, json={}).status_code, 403)


class StaffCannotReachAdminApi(unittest.TestCase):
    def test_admin_only_endpoints_return_403_for_staff(self):
        for role in ("HR_MANAGER", "DIRECTOR", "STORE_MANAGER", "EMPLOYEE"):
            user = {"user_id": 1, "username": "x", "roles": [role], "permissions": [], "is_active": True}
            for method, path in [
                ("GET", "/api/v1/users"), ("GET", "/api/v1/users/linkable-employees"),
                ("GET", "/api/v1/roles"), ("GET", "/api/v1/roles/matrix"),
                ("GET", "/api/v1/audit-logs"), ("POST", "/api/v1/stores"),
                ("POST", "/api/v1/admin/sync-employee-statuses"),
            ]:
                with self.subTest(role=role, path=path):
                    self.assertEqual(call(method, path, user=user, json={}).status_code, 403)


if __name__ == "__main__":
    unittest.main()
