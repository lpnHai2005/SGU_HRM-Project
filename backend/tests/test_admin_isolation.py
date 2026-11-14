"""DB-free checks: ADMIN is a plain employee in business modules; other roles cannot reach /admin APIs."""
import asyncio
import unittest

import httpx
from fastapi import APIRouter, Depends, FastAPI

from app.api.deps import get_current_user, require_roles, staff_roles, staff_scope
from app.api.v1.endpoints.stores import admin as store_admin
from app.api.v1.router import api_router
from app.core.database import get_db
from app.core.security import create_access_token
from app.main import app

BUSINESS_PREFIXES = (
    "/employees", "/contracts", "/resignations", "/attendances", "/leaves", "/leave-requests",
    "/payrolls", "/payroll", "/reports", "/ai-chatbot", "/operations", "/fixed-schedules",
    "/work-schedules", "/work-shifts", "/overtime-requests", "/overtime-reconciliations",
    "/mobile-attendance",
)
ADMIN_PREFIXES = ("/users", "/roles", "/audit-logs", "/stores", "/admin")


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


class StaffRolesTests(unittest.TestCase):
    def test_admin_becomes_employee(self):
        self.assertEqual(staff_roles(["ADMIN"]), ["EMPLOYEE"])

    def test_other_roles_are_untouched(self):
        self.assertEqual(staff_roles(["HR_MANAGER"]), ["HR_MANAGER"])
        self.assertEqual(sorted(staff_roles(["ADMIN", "EMPLOYEE"])), ["EMPLOYEE"])


class FakeResult:
    def __init__(self, rows):
        self.rows = rows

    def mappings(self):
        return self

    def first(self):
        return self.rows[0] if self.rows else None

    def all(self):
        return self.rows


class FakeDb:
    """Answers get_current_user's two queries: the user row, then its role rows."""
    def __init__(self):
        self.calls = 0

    async def execute(self, *_args, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            return FakeResult([{"user_id": 1, "username": "tz001", "email": None, "phone": None, "avatar_url": None,
                                "is_active": True, "employee_id": 1, "employee_code": "TZ-001", "full_name": "A",
                                "store_id": None, "store_name": None, "department_name": None, "position_name": None}])
        return FakeResult([{"role_code": "ADMIN", "permission_code": None}])

    async def commit(self):
        pass


class StaffScopeOrderingTests(unittest.TestCase):
    """Runs the real get_current_user + require_roles behind a router with and without staff_scope."""

    def setUp(self):
        biz = APIRouter()
        adm = APIRouter()

        @biz.get("/who")
        async def biz_who(user=Depends(require_roles(["EMPLOYEE"]))):
            return user["roles"]

        @adm.get("/who")
        async def adm_who(user=Depends(get_current_user)):
            return user["roles"]

        self.app = FastAPI()
        self.app.include_router(biz, prefix="/biz", dependencies=[Depends(staff_scope)])
        self.app.include_router(adm, prefix="/adm")

        async def fake_db():
            yield FakeDb()
        self.app.dependency_overrides[get_db] = fake_db
        self.token = create_access_token("tz001", roles=["ADMIN"])

    def get(self, path):
        async def run():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://t") as c:
                return await c.get(path, headers={"Authorization": f"Bearer {self.token}"})
        return asyncio.run(run())

    def test_admin_is_employee_inside_business_router(self):
        res = self.get("/biz/who")
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json(), ["EMPLOYEE"])

    def test_admin_keeps_admin_role_outside_business_router(self):
        res = self.get("/adm/who")
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json(), ["ADMIN"])


class RouterWiringTests(unittest.TestCase):
    def test_every_business_route_has_staff_scope_and_admin_routes_do_not(self):
        for route in api_router.routes:
            path = getattr(route, "path", "")
            deps = {d.dependency for d in getattr(route, "dependencies", [])}
            with self.subTest(path=path):
                if path.startswith(BUSINESS_PREFIXES):
                    self.assertIn(staff_scope, deps)
                elif path.startswith(ADMIN_PREFIXES):
                    self.assertNotIn(staff_scope, deps)


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
