"""Unit tests for /api/v1/stores/poi-search endpoint.

These tests mock httpx.AsyncClient.get so they run fully offline.
The TRACKASIA_API_KEY env var is set via monkeypatch so the endpoint
does not return 503 'key not configured'.
"""
import pytest
import httpx
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient
from app.main import app
from app.api.v1.endpoints.stores import admin

client = TestClient(app)
app.dependency_overrides[admin] = lambda: {'user_id': 1, 'roles': ['ADMIN']}


# ─── helpers ────────────────────────────────────────────────────────────────

def _make_elapsed(seconds: float = 0.12):
    """Return an object whose .total_seconds() matches httpx.Response.elapsed API."""
    m = MagicMock()
    m.total_seconds.return_value = seconds
    return m


def _make_response(status_code: int, json_data: dict | None = None) -> MagicMock:
    """Build a MagicMock that looks like an httpx.Response."""
    r = MagicMock()
    r.status_code = status_code
    r.elapsed = _make_elapsed()
    r.json.return_value = json_data or {}
    if status_code == 200:
        r.raise_for_status.return_value = None
    else:
        r.raise_for_status.side_effect = httpx.HTTPStatusError(
            f"HTTP {status_code}",
            request=MagicMock(),
            response=r,
        )
    return r


TRACKASIA_KEY_PATCH = "app.core.config.settings.TRACKASIA_API_KEY"

SUCCESS_PAYLOAD = {
    "features": [
        {
            "properties": {"name": "Coffee Shop", "address": "123 Street"},
            "geometry": {"coordinates": [106.700, 10.800]},
        },
        {
            "properties": {"name": "Library", "address": "456 Avenue"},
            "geometry": {"coordinates": [106.710, 10.810]},
        },
    ]
}

EMPTY_PAYLOAD = {"features": []}


# ─── fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def set_api_key(monkeypatch):
    """Ensure TRACKASIA_API_KEY is non-empty so the endpoint doesn't return 503."""
    monkeypatch.setattr("app.core.config.settings.TRACKASIA_API_KEY", "test-key-xxx")


# ─── tests ───────────────────────────────────────────────────────────────────

def test_poi_search_success():
    mock_get = AsyncMock(return_value=_make_response(200, SUCCESS_PAYLOAD))
    with patch("httpx.AsyncClient.get", new=mock_get):
        response = client.get("/api/v1/stores/poi-search?q=Coffee")

    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "FeatureCollection"
    assert len(data["features"]) == 2
    for f in data["features"]:
        assert "name" in f
        assert "address" in f
        assert "latitude" in f
        assert "longitude" in f


def test_poi_search_empty_result():
    mock_get = AsyncMock(return_value=_make_response(200, EMPTY_PAYLOAD))
    with patch("httpx.AsyncClient.get", new=mock_get):
        response = client.get("/api/v1/stores/poi-search?q=Xyz")

    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "FeatureCollection"
    assert data["features"] == []


def test_poi_search_invalid_api_key():
    """TrackAsia 401 must be remapped to 502 (server-side config error)
    so the frontend interceptor never redirects to /login."""
    mock_get = AsyncMock(return_value=_make_response(401))
    with patch("httpx.AsyncClient.get", new=mock_get):
        response = client.get("/api/v1/stores/poi-search?q=Coffee")

    assert response.status_code == 502
    assert 'HTTP 401' in response.json()["detail"]

def test_poi_search_timeout():
    mock_get = AsyncMock(side_effect=httpx.TimeoutException("timed out"))
    with patch("httpx.AsyncClient.get", new=mock_get):
        response = client.get("/api/v1/stores/poi-search?q=Coffee")

    assert response.status_code == 504
    assert 'thời gian' in response.json()["detail"]

def test_poi_search_upstream_502():
    mock_get = AsyncMock(return_value=_make_response(502))
    with patch("httpx.AsyncClient.get", new=mock_get):
        response = client.get("/api/v1/stores/poi-search?q=Coffee")

    assert response.status_code == 502
    assert 'HTTP 502' in response.json()["detail"]

def test_poi_search_no_key_returns_503(monkeypatch):
    """If TRACKASIA_API_KEY is blank the endpoint must return 503, not crash."""
    monkeypatch.setattr("app.core.config.settings.TRACKASIA_API_KEY", "")
    response = client.get("/api/v1/stores/poi-search?q=Coffee")
    assert response.status_code == 503


def test_poi_search_q_too_short():
    """Query shorter than 3 chars must be rejected at the FastAPI validation layer."""
    response = client.get("/api/v1/stores/poi-search?q=ab")
    assert response.status_code == 422


def test_reverse_provider_401_is_not_forwarded_as_session_401():
    mock_get = AsyncMock(return_value=_make_response(401))
    with patch("httpx.AsyncClient.get", new=mock_get):
        response = client.get("/api/v1/stores/reverse-geocode?lat=10.7&lon=106.6")
    assert response.status_code == 502
    assert "HTTP 401" in response.json()["detail"]


def test_poi_search_discards_invalid_coordinates():
    payload = {"features": [
        {"properties": {"name": "Valid"}, "geometry": {"coordinates": [106.6, 10.7]}},
        {"properties": {"name": "Invalid"}, "geometry": {"coordinates": [999, 10.7]}},
        {"properties": {"name": "Missing"}, "geometry": {"coordinates": []}},
    ]}
    with patch("httpx.AsyncClient.get", new=AsyncMock(return_value=_make_response(200, payload))):
        response = client.get("/api/v1/stores/poi-search?q=place")
    assert response.status_code == 200
    assert [item["name"] for item in response.json()["features"]] == ["Valid"]


def test_poi_search_requires_admin_session():
    override = app.dependency_overrides.pop(admin, None)
    try:
        response = client.get("/api/v1/stores/poi-search?q=place")
    finally:
        if override is not None:
            app.dependency_overrides[admin] = override
    assert response.status_code == 401
