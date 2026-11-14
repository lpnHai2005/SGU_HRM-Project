from fastapi.testclient import TestClient

from app.api.deps import record_audit_log
from app.main import app


class FakeDB:
    def __init__(self):
        self.params = None

    async def execute(self, query, params=None):
        self.params = params

    async def commit(self):
        pass


def test_audit_log_falls_back_to_request_client_ip():
    db = FakeDB()

    @app.get("/__test_audit_ip")
    async def _route():
        await record_audit_log(db, 1, "TEST", "x")
        return {}

    try:
        TestClient(app).get("/__test_audit_ip")
    finally:
        app.router.routes.pop()
    assert db.params["ip_address"] == "testclient"
