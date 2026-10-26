"""
Unit Tests for Production Readiness Enhancements:
1. Role-based RAG Scope Check & Hybrid Search with RRF
2. Policy Response Cache (In-Memory LRU + TTL eviction)
3. UserRateLimiter with Sliding Window & Memory Leak Prevention (Garbage Collection)
"""

import time
import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock

from app.core.ai_chatbot_cache import PolicyResponseCache
from app.api.v1.endpoints.ai_chatbot import UserRateLimiter
from app.core.ai_chatbot_graph import retriever_node


# ===================================================================================
# 1. POLICY RESPONSE CACHE TESTS
# ===================================================================================

def test_policy_cache_set_and_get():
    cache = PolicyResponseCache(capacity=10, default_ttl=60)
    cache.clear()

    q = "Quy định đi trễ trên 15 phút tại TechZone?"
    data = {
        "answer": "Bị khấu trừ 50.000 VNĐ",
        "sources": ["TZ-DOC-01 (Trang 2)"],
        "tools_used": [],
        "confidence": 0.98
    }

    # Cache miss
    assert cache.get(q, "EMPLOYEE") is None

    # Cache set & hit
    cache.set(q, data, "EMPLOYEE")
    cached = cache.get(q, "EMPLOYEE")
    assert cached is not None
    assert cached["answer"] == "Bị khấu trừ 50.000 VNĐ"
    assert cached["sources"] == ["TZ-DOC-01 (Trang 2)"]


def test_policy_cache_role_isolation():
    cache = PolicyResponseCache(capacity=10, default_ttl=60)
    cache.clear()

    q = "Quy chế bảo mật thông tin nhân sự"
    emp_data = {"answer": "Chỉ xem thông tin bản thân", "sources": []}
    admin_data = {"answer": "Toàn quyền quản trị nhân sự", "sources": []}

    cache.set(q, emp_data, "EMPLOYEE")
    cache.set(q, admin_data, "ADMIN")

    assert cache.get(q, "EMPLOYEE")["answer"] == "Chỉ xem thông tin bản thân"
    assert cache.get(q, "ADMIN")["answer"] == "Toàn quyền quản trị nhân sự"


def test_policy_cache_ttl_expiration():
    cache = PolicyResponseCache(capacity=10, default_ttl=1)  # 1 second TTL
    cache.clear()

    q = "Quy chế công ty"
    cache.set(q, {"answer": "Nội quy TechZone"}, "EMPLOYEE", ttl=1)
    assert cache.get(q, "EMPLOYEE") is not None

    time.sleep(1.1)
    # Expired
    assert cache.get(q, "EMPLOYEE") is None


# ===================================================================================
# 2. USER RATE LIMITER TESTS (SLIDING WINDOW & GARBAGE COLLECTION)
# ===================================================================================

def test_rate_limiter_sliding_window():
    limiter = UserRateLimiter(max_requests=2, window_seconds=1)
    user_id = 12345

    assert limiter.is_allowed(user_id) is True
    assert limiter.is_allowed(user_id) is True
    # 3rd request in same window fails
    assert limiter.is_allowed(user_id) is False

    time.sleep(1.1)
    # After window passes, allowed again
    assert limiter.is_allowed(user_id) is True


def test_rate_limiter_memory_garbage_collection():
    limiter = UserRateLimiter(max_requests=5, window_seconds=1)

    # Simulate 100 calls to trigger periodic garbage collection
    for i in range(101):
        limiter.is_allowed(user_id=1000 + (i % 5))

    # All entries exist in memory
    assert len(limiter.history) <= 5

    # Wait for window to expire
    time.sleep(1.1)

    # Next 100 calls will prune old expired user entries
    for i in range(100):
        limiter.is_allowed(user_id=9999)

    # Old users (1000-1004) should have been pruned by GC
    assert 1000 not in limiter.history
    assert 1001 not in limiter.history


# ===================================================================================
# 3. HYBRID RETRIEVER & ROLE CHECK TESTS
# ===================================================================================

@pytest.mark.asyncio
async def test_retriever_node_role_scoping_and_hybrid():
    db = AsyncMock()

    class MockNestedContext:
        async def __aenter__(self):
            return self
        async def __aexit__(self, exc_type, exc_val, exc_tb):
            pass

    db.begin_nested = MagicMock(side_effect=lambda: MockNestedContext())

    # Mock SP result
    sp_mock_row = {
        "id": 1,
        "document_title": "Quy chế nội bộ",
        "category": "NOI_QUY",
        "chunk_content": "Nhân viên phải tuân thủ giờ làm việc quy định.",
        "metadata": {"target_roles": ["EMPLOYEE"]},
        "similarity": 0.88
    }
    mock_sp_res = MagicMock()
    mock_sp_res.mappings.return_value.all.return_value = [sp_mock_row]

    # Mock Lexical result
    lex_mock_row = {
        "id": 2,
        "document_title": "Nội quy kỷ luật",
        "category": "NOI_QUY",
        "chunk_content": "Đi trễ trên 15 phút sẽ bị trừ 50.000 VNĐ.",
        "metadata": {"target_roles": ["ALL"]},
        "similarity": 0.75
    }
    mock_lex_res = MagicMock()
    mock_lex_res.mappings.return_value.all.return_value = [lex_mock_row]

    db.execute.side_effect = [mock_sp_res, mock_lex_res]

    state = {
        "query": "Quy định đi trễ trên 15 phút bị phạt bao nhiêu tiền?",
        "rewritten_query": None,
        "current_user": {
            "user_id": 1,
            "roles": ["EMPLOYEE"]
        }
    }

    res = await retriever_node(state, db)
    assert "retrieved_chunks" in res
    chunks = res["retrieved_chunks"]
    assert len(chunks) > 0
    # Both documents merged via RRF
    chunk_titles = [c["document_title"] for c in chunks]
    assert "Quy chế nội bộ" in chunk_titles or "Nội quy kỷ luật" in chunk_titles


@pytest.mark.asyncio
async def test_auth_scope_node_contract_planning():
    from app.core.ai_chatbot_graph import auth_scope_node

    state = {
        "query": "thông tin hợp đồng của tôi",
        "current_user": {
            "user_id": 2,
            "employee_id": 2,
            "roles": ["EMPLOYEE"]
        },
        "intent": "PERSONAL_DATA"
    }

    auth_res = await auth_scope_node(state)
    assert auth_res["tool_auth_status"] == "ALLOWED"
    assert len(auth_res["tools_planned"]) == 1
    assert auth_res["tools_planned"][0]["tool"] == "get_employee_contract"


@pytest.mark.asyncio
async def test_auth_scope_node_project_allowance_planning():
    from app.core.ai_chatbot_graph import auth_scope_node

    user = {
        "user_id": 2,
        "employee_id": 2,
        "roles": ["EMPLOYEE"]
    }
    # Câu hỏi người dùng gặp phải trong thực tế
    queries = [
        "Các dự án và mức phụ cấp tôi đang tham gia",
        "dự án tôi đang tham gia",
        "mức phụ cấp của tôi",
        "dự án của tôi"
    ]
    for q in queries:
        state = {
            "query": q,
            "current_user": user,
            "intent": "PERSONAL_DATA"
        }
        res = await auth_scope_node(state)
        assert res["tool_auth_status"] == "ALLOWED", f"Failed for query: {q}"
        assert any(t["tool"] == "get_my_projects" for t in res["tools_planned"]), f"Expected get_my_projects for: {q}"


@pytest.mark.asyncio
async def test_auth_scope_node_self_service_coverage():
    from app.core.ai_chatbot_graph import auth_scope_node

    user = {
        "user_id": 2,
        "employee_id": 2,
        "employee_code": "TZ-002",
        "roles": ["EMPLOYEE"],
        "store_id": 1
    }
    test_cases = [
        ("thông tin của bản thân", "get_my_profile"),
        ("tôi còn bao nhiêu ngày phép", "get_my_leave_balance"),
        ("các đơn xin nghỉ của tôi", "get_my_leave_requests"),
        ("phiếu lương của tôi", "get_my_payroll"),
        ("lịch sử nhận lương của tôi", "get_my_payroll_history"),
        ("lịch làm việc của tôi", "get_my_work_schedule"),
        ("chấm công của tôi tháng này", "get_my_attendance"),
        ("thông tin cửa hàng của tôi", "get_store_info"),
        ("chi tiết đơn nghỉ #50", "get_leave_request_detail"),
    ]
    for query, expected_tool in test_cases:
        state = {
            "query": query,
            "current_user": user,
            "intent": "PERSONAL_DATA"
        }
        res = await auth_scope_node(state)
        assert res["tool_auth_status"] == "ALLOWED", f"Denied for: {query}"
        planned_names = [t["tool"] for t in res["tools_planned"]]
        assert expected_tool in planned_names, f"Expected {expected_tool} for '{query}', got {planned_names}"


def test_format_tool_results_offline_projects():
    from app.core.ai_chatbot_graph import format_tool_results_offline

    user = {"full_name": "Trần Thị Bình"}
    tool_results = [
        {
            "tool": "get_my_projects",
            "status": "SUCCESS",
            "data": {
                "total_active_projects": 1,
                "total_monthly_project_allowance_formatted": "1,500,000 VNĐ",
                "projects": [
                    {
                        "project_name": "Dự án Chuyển đổi số",
                        "project_code": "PRJ-ERP-HRM",
                        "role_name": "Project Lead",
                        "monthly_allowance_formatted": "1,500,000 VNĐ",
                        "status_label": "Đang tiến hành",
                        "joined_date_str": "01/07/2026"
                    }
                ]
            }
        }
    ]
    lines = format_tool_results_offline(user, tool_results)
    full_text = "\n".join(lines)
    assert "Dự án & Phụ cấp Cá nhân" in full_text
    assert "1,500,000 VNĐ" in full_text
    assert "PRJ-ERP-HRM" in full_text
    assert "Project Lead" in full_text


