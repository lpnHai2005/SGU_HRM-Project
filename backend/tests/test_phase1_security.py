# backend/tests/test_phase1_security.py
import pytest
import asyncio
from uuid import uuid4
from datetime import datetime, timezone, timedelta
from pydantic import ValidationError
from unittest.mock import AsyncMock, MagicMock

from app.schemas.schemas import (
    AIChatbotQuery, AIChatbotConfirmActionRequest
)
from app.core.ai_chatbot_db import (
    resolve_thread_id, create_action_proposal, get_action_proposal, update_action_proposal_status
)
from app.core.ai_chatbot_tools import (
    search_employees, get_attendance_summary, get_leave_statistics,
    get_store_info, get_store_schedule, get_project_detail, get_my_profile
)
from app.api.v1.endpoints.ai_chatbot import UserRateLimiter


# ===================================================================================
# 1.1 THREAD_ID RESOLUTION & IDOR PREVENTION
# ===================================================================================

@pytest.mark.asyncio
async def test_resolve_thread_id_new_or_empty():
    db = AsyncMock()
    # Empty thread
    res = await resolve_thread_id(db, user_id=42, thread_id=None)
    assert res.startswith("thread-user-42-")

    res2 = await resolve_thread_id(db, user_id=42, thread_id="")
    assert res2.startswith("thread-user-42-")


@pytest.mark.asyncio
async def test_resolve_thread_id_same_user():
    db = AsyncMock()
    mock_row = MagicMock()
    mock_row.__getitem__.side_effect = lambda key: 42 if key == "user_id" else None
    mock_res = MagicMock()
    mock_res.mappings.return_value.first.return_value = mock_row
    db.execute.return_value = mock_res

    res = await resolve_thread_id(db, user_id=42, thread_id="my-existing-thread")
    assert res == "my-existing-thread"


@pytest.mark.asyncio
async def test_resolve_thread_id_idor_hijack_prevention():
    db = AsyncMock()
    # Thread belongs to user 99, but user 42 is requesting it
    mock_row = MagicMock()
    mock_row.__getitem__.side_effect = lambda key: 99 if key == "user_id" else None
    mock_res = MagicMock()
    mock_res.mappings.return_value.first.return_value = mock_row
    db.execute.return_value = mock_res

    res = await resolve_thread_id(db, user_id=42, thread_id="victim-thread-99")
    # Must reject victim's thread and generate a fresh thread for user 42
    assert res != "victim-thread-99"
    assert res.startswith("thread-user-42-")


# ===================================================================================
# 1.3 SCHEMA VALIDATIONS
# ===================================================================================

def test_schema_confirmed_is_required():
    # confirmed has NO default value, must be provided
    with pytest.raises(ValidationError):
        AIChatbotConfirmActionRequest(
            action_type="create_leave_request",
            payload={}
        )

    # Providing confirmed=True works
    req = AIChatbotConfirmActionRequest(
        action_type="create_leave_request",
        payload={},
        confirmed=True
    )
    assert req.confirmed is True


def test_schema_action_type_literal():
    # Only "create_leave_request" or "cancel_leave_request" allowed
    with pytest.raises(ValidationError):
        AIChatbotConfirmActionRequest(
            action_type="drop_table_users",
            payload={},
            confirmed=True
        )


def test_schema_attachment_url_https_only():
    # http:// must fail
    with pytest.raises(ValidationError) as exc:
        AIChatbotConfirmActionRequest(
            action_type="create_leave_request",
            payload={},
            confirmed=True,
            attachment_url="http://insecure.site/malware.png"
        )
    assert "HTTPS" in str(exc.value)

    # https:// must pass
    req = AIChatbotConfirmActionRequest(
        action_type="create_leave_request",
        payload={},
        confirmed=True,
        attachment_url="https://res.cloudinary.com/proof.pdf"
    )
    assert req.attachment_url == "https://res.cloudinary.com/proof.pdf"


def test_schema_query_and_thread_id_bounds():
    # Query length bound
    with pytest.raises(ValidationError):
        AIChatbotQuery(query="")

    with pytest.raises(ValidationError):
        AIChatbotQuery(query="x" * 1001)

    # Thread ID regex pattern
    with pytest.raises(ValidationError):
        AIChatbotQuery(query="hello", thread_id="invalid thread id with spaces")

    valid_query = AIChatbotQuery(query="hello", thread_id="thread-user-1-abc123")
    assert valid_query.thread_id == "thread-user-1-abc123"


# ===================================================================================
# 1.4 FAIL-OPEN STORE_ID MITIGATION
# ===================================================================================

@pytest.mark.asyncio
async def test_fail_open_store_id_store_manager_null():
    db = AsyncMock()
    sm_user_no_store = {
        "user_id": 10,
        "employee_id": 10,
        "roles": ["STORE_MANAGER"],
        "store_id": None
    }

    # 1. search_employees
    res1 = await search_employees({}, sm_user_no_store, db)
    assert "error" in res1
    assert "chưa được cấu hình chi nhánh" in res1["error"]

    # 2. get_attendance_summary
    res2 = await get_attendance_summary({}, sm_user_no_store, db)
    assert "error" in res2
    assert "chưa được cấu hình chi nhánh" in res2["error"]

    # 3. get_leave_statistics
    res3 = await get_leave_statistics({}, sm_user_no_store, db)
    assert "error" in res3
    assert "chưa được cấu hình chi nhánh" in res3["error"]


@pytest.mark.asyncio
async def test_rbac_store_tools_regular_employee():
    db = AsyncMock()
    emp_user = {
        "user_id": 20,
        "employee_id": 20,
        "roles": ["EMPLOYEE"],
        "store_id": 1
    }

    # Cannot query another store
    res_store = await get_store_info({"store_id": 2}, emp_user, db)
    assert "error" in res_store
    assert "Truy cập bị từ chối" in res_store["error"]

    # Cannot query schedule of another store
    res_sched = await get_store_schedule({"store_id": 2}, emp_user, db)
    assert "error" in res_sched
    assert "Truy cập bị từ chối" in res_sched["error"]

    # Handles string / invalid store_id safely
    res_bad = await get_store_schedule({"store_id": "bad_id"}, emp_user, db)
    assert "error" in res_bad


@pytest.mark.asyncio
async def test_rbac_project_detail_non_member():
    db = AsyncMock()
    emp_user = {
        "user_id": 20,
        "employee_id": 20,
        "roles": ["EMPLOYEE"]
    }
    # Mock project exists
    mock_p_res = MagicMock()
    mock_p_res.mappings.return_value.first.return_value = {"project_id": 5, "project_name": "Secret Project"}

    # Mock member check returns empty (not a member)
    mock_m_res = MagicMock()
    mock_m_res.first.return_value = None

    db.execute.side_effect = [mock_p_res, mock_m_res]

    res = await get_project_detail({"project_id": 5}, emp_user, db)
    assert "error" in res
    assert "Truy cập bị từ chối" in res["error"]


# ===================================================================================
# 1.5 SENSITIVE PROFILE DATA MASKING
# ===================================================================================

@pytest.mark.asyncio
async def test_sensitive_profile_masking():
    db = AsyncMock()
    emp_user = {"user_id": 5, "employee_id": 5, "roles": ["EMPLOYEE"]}

    mock_row = {
        "employee_id": 5,
        "full_name": "Nguyễn Văn Test",
        "phone": "0901234567",
        "company_email": "test@techzone.vn",
        "bank_account_number": "123456789",
        "bank_name": "Vietcombank",
        "tax_code": "TAX999",
        "insurance_code": "BHXH888"
    }
    mock_res = MagicMock()
    mock_res.mappings.return_value.first.return_value = mock_row
    db.execute.return_value = mock_res

    # Normal query: sensitive fields are excluded from LLM context
    res_normal = await get_my_profile({"query": "Xem thông tin hồ sơ của tôi"}, emp_user, db)
    assert "full_name" in res_normal
    assert "bank_account_number" not in res_normal
    assert "tax_code" not in res_normal
    assert "insurance_code" not in res_normal

    # Explicit query asking for bank account: fields are preserved with middle masking (1B.10)
    res_explicit = await get_my_profile({"query": "Cho tôi xem số tài khoản ngân hàng của tôi"}, emp_user, db)
    assert "bank_account_number" in res_explicit
    assert res_explicit["bank_account_number"] == "12***6789"


# ===================================================================================
# 1.8 RATE LIMITER
# ===================================================================================

def test_user_rate_limiter():
    limiter = UserRateLimiter(max_requests=3, window_seconds=60)
    uid = 999

    assert limiter.is_allowed(uid) is True
    assert limiter.is_allowed(uid) is True
    assert limiter.is_allowed(uid) is True
    # 4th request must be rejected
    assert limiter.is_allowed(uid) is False

    # Another user is unaffected
    assert limiter.is_allowed(888) is True
