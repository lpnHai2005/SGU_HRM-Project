import sys
import os
import unittest
import asyncio
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.abspath("backend"))

from app.core.ai_chatbot_graph import (
    sanitize_trace_inputs, sanitize_trace_outputs,
    router_node, extract_dates_from_query,
    tools_node, generator_node, get_mistral_llm
)
from app.core.ai_chatbot_tools import (
    assert_can_access_employee, mask_middle,
    get_my_projects, get_project_detail,
    get_my_payroll, get_my_payroll_history,
    validate_leave_request
)
from app.core.ai_chatbot_db import (
    resolve_thread_id, create_action_proposal,
    get_action_proposal, update_action_proposal_status,
    get_chat_history, save_turn
)


class TestPhase1BToPhase5(unittest.TestCase):

    # =========================================================================
    # 1B.1 LangSmith Sanitization
    # =========================================================================
    def test_sanitize_trace_outputs_masks_sensitive_data(self):
        raw_outputs = {
            "final_answer": "Bảng lương của bạn là 25,000,000 VNĐ",
            "tool_results": [
                {
                    "tool": "get_my_payroll",
                    "output": {
                        "summary": {
                            "payroll_id": 10,
                            "contract_salary": 20000000,
                            "net_salary": 18500000,
                            "gross_income": 22000000,
                            "payment_status": "PAID"
                        }
                    }
                }
            ]
        }
        sanitized = sanitize_trace_outputs(raw_outputs)
        summary = sanitized["tool_results"][0]["output"]["summary"]
        self.assertEqual(summary["contract_salary"], "[MASKED_SENSITIVE]")
        self.assertEqual(summary["net_salary"], "[MASKED_SENSITIVE]")
        self.assertEqual(summary["gross_income"], "[MASKED_SENSITIVE]")
        self.assertEqual(summary["payment_status"], "PAID")

    # =========================================================================
    # 1B.3 Project Allowances & Role Scoping
    # =========================================================================
    def test_get_project_detail_hides_budget_and_other_allowances_for_employee(self):
        async def _test():
            db = AsyncMock()
            regular_emp = {
                "user_id": 101,
                "employee_id": 5,
                "employee_code": "EMP005",
                "full_name": "Nguyễn Văn Regular",
                "roles": ["EMPLOYEE"]
            }
            # Project mock
            p_res = MagicMock()
            p_res.mappings.return_value.first.return_value = {
                "project_id": 1,
                "project_code": "PRJ_ALPHA",
                "project_name": "Dự án Alpha",
                "budget": 500000000.0,
                "status": "IN_PROGRESS",
                "description": "Chiến dịch bán hàng"
            }
            # Membership mock
            mem_res = MagicMock()
            mem_res.first.return_value = (1,)

            # Members list mock
            m_res = MagicMock()
            m_res.mappings.return_value.all.return_value = [
                {
                    "employee_code": "EMP005",
                    "full_name": "Nguyễn Văn Regular",
                    "project_role": "MEMBER",
                    "role_name": "Thành viên",
                    "allowance": 2000000.0
                },
                {
                    "employee_code": "EMP001",
                    "full_name": "Lê Văn Lead",
                    "project_role": "LEAD",
                    "role_name": "Trưởng nhóm",
                    "allowance": 5000000.0
                }
            ]
            db.execute.side_effect = [p_res, mem_res, m_res]

            res = await get_project_detail({"project_id": 1}, regular_emp, db)
            self.assertNotIn("budget", res["project"])  # Budget is hidden
            self.assertEqual(res["members"][0]["allowance"], 2000000.0)  # Own allowance kept
            self.assertNotIn("allowance", res["members"][1])  # Other member's allowance removed

        asyncio.run(_test())

    # =========================================================================
    # 1B.4 tools_node Exception Isolation
    # =========================================================================
    def test_tools_node_error_isolation(self):
        async def _test():
            db = AsyncMock()
            state = {
                "tool_auth_status": "ALLOWED",
                "tools_planned": [{"tool": "get_my_payroll", "args": {}}],
                "current_user": {"user_id": 1, "employee_id": 2, "roles": ["EMPLOYEE"]}
            }
            # Mock get_my_payroll raising unexpected exception
            with patch("app.core.ai_chatbot_graph.HRM_TOOLS_REGISTRY", {"get_my_payroll": AsyncMock(side_effect=Exception("Database down"))}):
                res = await tools_node(state, db)
                self.assertEqual(len(res["tool_results"]), 1)
                self.assertIn("error", res["tool_results"][0]["output"])
                self.assertIn("get_my_payroll", res["tools_used"])

        asyncio.run(_test())

    # =========================================================================
    # 1B.5 assert_can_access_employee (Fail-Closed)
    # =========================================================================
    def test_assert_can_access_employee_fail_closed(self):
        regular_user = {"employee_id": 10, "store_id": 1, "roles": ["EMPLOYEE"]}
        store_manager = {"employee_id": 2, "store_id": 1, "roles": ["STORE_MANAGER"]}
        admin_user = {"employee_id": 1, "store_id": None, "roles": ["ADMIN"]}

        # Admin: always allowed
        self.assertIsNone(assert_can_access_employee(admin_user, 999, 999))
        self.assertIsNone(assert_can_access_employee(admin_user, None, None))

        # Regular user: only own employee_id
        self.assertIsNone(assert_can_access_employee(regular_user, 10, 1))
        self.assertIsNotNone(assert_can_access_employee(regular_user, 11, 1))
        self.assertIsNotNone(assert_can_access_employee(regular_user, None, 1))

        # Store manager: own store or own employee_id
        self.assertIsNone(assert_can_access_employee(store_manager, 10, 1))
        self.assertIsNone(assert_can_access_employee(store_manager, 2, 2))
        self.assertIsNotNone(assert_can_access_employee(store_manager, 30, 2))
        # Fail-closed: None != None
        self.assertIsNotNone(assert_can_access_employee(store_manager, None, None))

    # =========================================================================
    # 1B.6 HYBRID Intent Handling
    # =========================================================================
    def test_generator_node_hybrid_with_denied_tools(self):
        async def _test():
            state = {
                "intent": "HYBRID",
                "tool_auth_status": "DENIED",
                "tool_denied_reason": "Chưa hỗ trợ qua chatbot",
                "retrieved_chunks": [
                    {
                        "document_title": "Quy chế làm việc",
                        "chunk_content": "Mỗi năm nhân viên được 12 ngày phép có lương.",
                        "metadata": {"page": 5}
                    }
                ],
                "current_user": {"full_name": "Test User", "roles": ["EMPLOYEE"]},
                "tool_results": [],
                "tools_used": []
            }
            res = await generator_node(state)
            self.assertIn("final_answer", res)
            self.assertIn("Quy chế làm việc", res["sources"][0])

        asyncio.run(_test())

    # =========================================================================
    # 1B.7 Fail-Closed resolve_thread_id
    # =========================================================================
    def test_resolve_thread_id_fail_closed_on_db_error(self):
        async def _test():
            db = AsyncMock()
            db.execute.side_effect = Exception("DB Connection timeout")
            tid = await resolve_thread_id(db, user_id=99, thread_id="suspect_thread_123")
            # Must generate a fresh secure thread, not keep the unverified one
            self.assertTrue(tid.startswith("thread-user-99-"))
            self.assertNotEqual(tid, "suspect_thread_123")

        asyncio.run(_test())

    # =========================================================================
    # 1B.9 Proposal Query UUID Hardening
    # =========================================================================
    def test_get_action_proposal_invalid_uuid(self):
        async def _test():
            db = AsyncMock()
            res = await get_action_proposal(db, "not-a-valid-uuid")
            self.assertIsNone(res)
            db.execute.assert_not_called()

        asyncio.run(_test())

    # =========================================================================
    # 2.1 Chat History Ordering
    # =========================================================================
    def test_get_chat_history_chronological_order(self):
        async def _test():
            db = AsyncMock()
            # Mock DB returning DESC (newest first)
            mock_res = MagicMock()
            mock_res.mappings.return_value.all.return_value = [
                {"message_id": 3, "content": "Tin nhắn 3 (mới nhất)", "created_at": "2026-10-27T10:02:00"},
                {"message_id": 2, "content": "Tin nhắn 2", "created_at": "2026-10-27T10:01:00"},
                {"message_id": 1, "content": "Tin nhắn 1 (cũ nhất)", "created_at": "2026-10-27T10:00:00"}
            ]
            db.execute.return_value = mock_res
            rows = await get_chat_history(db, user_id=1, limit=3)
            # Must be reversed to chronological ascending (oldest first)
            self.assertEqual(rows[0]["message_id"], 1)
            self.assertEqual(rows[1]["message_id"], 2)
            self.assertEqual(rows[2]["message_id"], 3)

        asyncio.run(_test())

    # =========================================================================
    # 2.2 Payroll Payment Status Filtering
    # =========================================================================
    def test_get_my_payroll_filters_draft_for_regular_employees(self):
        async def _test():
            db = AsyncMock()
            regular_emp = {"employee_id": 88, "roles": ["EMPLOYEE"]}
            # Mock period query returning None (no CONFIRMED/PAID found)
            p_res = MagicMock()
            p_res.scalar.return_value = None
            db.execute.return_value = p_res

            res = await get_my_payroll({}, regular_emp, db)
            self.assertIn("error", res)
            self.assertIn("Chưa có bảng lương chính thức nào", res["error"])

        asyncio.run(_test())

    # =========================================================================
    # 2.3 Router Exact Greeting & Temperature
    # =========================================================================
    def test_router_exact_greetings(self):
        async def _test():
            greetings = ["Xin chào", "chào", "Hello!", "hi...", "halo"]
            for g in greetings:
                state = {"query": g, "current_user": {"user_id": 1}}
                r = await router_node(state)
                self.assertEqual(r["intent"], "GREETING", f"Failed for {g}")

        asyncio.run(_test())

    # =========================================================================
    # 2.4 Parameter Extraction (Asia/Ho_Chi_Minh & Word Boundaries)
    # =========================================================================
    def test_extract_dates_ngay_mai_word_boundary(self):
        tz_vn = timezone(timedelta(hours=7))
        today = datetime.now(tz_vn).date()
        tomorrow = (today + timedelta(days=1)).isoformat()

        # Should match "ngày mai"
        s1, e1 = extract_dates_from_query("Tôi muốn nghỉ ngày mai")
        self.assertEqual(s1, tomorrow)

        # Should NOT match substring "khuyến mãi"
        s2, e2 = extract_dates_from_query("Chương trình khuyến mãi ngày 28/10")
        self.assertEqual(s2, date(today.year, 10, 28).isoformat())

    # =========================================================================
    # 2.7 Unified Leave Validation Service
    # =========================================================================
    def test_validate_leave_request_unified(self):
        async def _test():
            db = AsyncMock()
            user = {"employee_id": 5, "roles": ["EMPLOYEE"]}

            # Mock employee lookup
            mock_emp = MagicMock()
            mock_emp.mappings.return_value.first.return_value = {
                "employee_id": 5,
                "full_name": "Test User",
                "store_id": 1,
                "employment_status": "ACTIVE"
            }
            db.execute.return_value = mock_emp

            # Case: start > end
            res1 = await validate_leave_request(db, user, "PHEP_NAM", date(2026, 11, 5), date(2026, 11, 2), "Test")
            self.assertFalse(res1["valid"])
            self.assertIn("không được lớn hơn", res1["error"])

            # Case: past date
            yesterday = date.today() - timedelta(days=1)
            res2 = await validate_leave_request(db, user, "PHEP_NAM", yesterday, yesterday, "Test")
            self.assertFalse(res2["valid"])
            self.assertIn("quá khứ", res2["error"])

        asyncio.run(_test())

    # =========================================================================
    # 3.1 Atomic save_turn
    # =========================================================================
    def test_save_turn_atomic_rollback_on_failure(self):
        async def _test():
            db = AsyncMock()
            # Second execute raises error
            db.execute.side_effect = [MagicMock(mappings=MagicMock(return_value=MagicMock(first=MagicMock(return_value={"message_id": 1})))), Exception("Failed to save assistant turn")]
            with self.assertRaises(Exception):
                await save_turn(db, "tid-1", 1, 1, "Hello", "Hi")
            db.rollback.assert_called_once()

        asyncio.run(_test())


if __name__ == "__main__":
    suite = unittest.TestLoader().loadTestsFromTestCase(TestPhase1BToPhase5)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
