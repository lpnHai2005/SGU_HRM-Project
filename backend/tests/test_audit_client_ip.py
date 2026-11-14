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


def _client_ip(headers, trust):
    from app.core.config import settings
    from app.main import ClientIPMiddleware
    import asyncio

    seen = {}

    async def inner(scope, receive, send):
        seen["ip"] = scope["client"][0]

    old, settings.TRUST_TRUE_CLIENT_IP = settings.TRUST_TRUE_CLIENT_IP, trust
    try:
        asyncio.run(ClientIPMiddleware(inner)(
            {"type": "http", "client": ("10.25.80.5", 1), "headers": headers}, None, None))
    finally:
        settings.TRUST_TRUE_CLIENT_IP = old
    return seen["ip"]


def test_true_client_ip_used_only_when_trusted_and_valid():
    real = [(b"true-client-ip", b"222.253.44.191"), (b"x-forwarded-for", b"1.2.3.4, 222.253.44.191")]
    assert _client_ip(real, True) == "222.253.44.191"
    assert _client_ip(real, False) == "10.25.80.5"  # local/dev: header không được tin
    assert _client_ip([(b"true-client-ip", b"not-an-ip")], True) == "10.25.80.5"
    assert _client_ip([(b"x-forwarded-for", b"1.2.3.4")], True) == "10.25.80.5"  # XFF giả bị bỏ qua
