from app.api.v1.endpoints.auth import _normalize_login_credentials
from app.core import security


def test_login_trims_username_but_preserves_password_verbatim():
    password = "  valid password  "

    username, parsed_password = _normalize_login_credentials("  admin  ", password)

    assert username == "admin"
    assert parsed_password == password


def test_login_rejects_non_string_password_as_missing():
    username, password = _normalize_login_credentials("admin", None)

    assert username == "admin"
    assert password == ""


def test_bcrypt_verification_error_fails_closed(monkeypatch):
    def raise_bcrypt_error(*_args, **_kwargs):
        raise ValueError("invalid bcrypt data")

    monkeypatch.setattr(security.bcrypt, "checkpw", raise_bcrypt_error)

    assert security.verify_password("123456", "$2b$12$synthetic-invalid-hash") is False
