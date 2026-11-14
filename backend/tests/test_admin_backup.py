import pytest
from fastapi import HTTPException
from app.api.v1.endpoints import admin

URL = "postgresql+psycopg2://u:p@host:5432/postgres"


def fake_which(available):
    return lambda name: f"/bin/{name}" if name in available else None


def test_uses_local_pg_dump_and_strips_driver(monkeypatch):
    monkeypatch.setattr(admin.shutil, "which", fake_which({"pg_dump", "docker"}))
    cmd = admin.pg_dump_command(URL)
    assert cmd[0] == "pg_dump"
    assert cmd[1] == "postgresql://u:p@host:5432/postgres"


def test_falls_back_to_docker(monkeypatch):
    monkeypatch.setattr(admin.shutil, "which", fake_which({"docker"}))
    assert admin.pg_dump_command(URL)[:4] == ["docker", "run", "--rm", "postgres:17"]


def test_errors_without_tools(monkeypatch):
    monkeypatch.setattr(admin.shutil, "which", fake_which(set()))
    with pytest.raises(HTTPException):
        admin.pg_dump_command(URL)
