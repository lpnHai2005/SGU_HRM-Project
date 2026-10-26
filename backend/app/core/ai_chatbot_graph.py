from uuid import uuid4
"""
TechZone HRM - LangGraph AI Chatbot Engine
Cấu trúc Agentic StateGraph: Router -> Retriever -> Grader -> Rewrite / Tools -> Validator -> Generator.
Tuân thủ nghiêm ngặt:
- Guardrail: Chặn tuyệt đối câu hỏi ngoài phạm vi dự án HRM TechZone.
- Self-RAG: Chấm điểm liên quan (Relevance Grader) và Viết lại truy vấn (Query Rewrite < 2 lần).
- RBAC Scope Check & HITL Action Proposals.
- Tracing tự động qua LangSmith khi có LANGCHAIN_API_KEY.
"""

import os
import re
import json
from typing import Dict, Any, List, Optional, TypedDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.config import settings
from app.core.ai_chatbot_tools import HRM_TOOLS_REGISTRY, is_hr_or_admin, is_store_manager, is_accountant
from app.core.ai_chatbot_db import save_chat_message

# Kích hoạt cấu hình LangSmith Tracing (hỗ trợ cả LANGSMITH_* và LANGCHAIN_*)
langsmith_key = getattr(settings, "LANGSMITH_API_KEY", "") or getattr(settings, "LANGCHAIN_API_KEY", "") or os.getenv("LANGSMITH_API_KEY", "") or os.getenv("LANGCHAIN_API_KEY", "")
if langsmith_key:
    os.environ["LANGCHAIN_TRACING_V2"] = "true"
    os.environ["LANGSMITH_TRACING"] = "true"
    os.environ["LANGCHAIN_API_KEY"] = langsmith_key
    os.environ["LANGSMITH_API_KEY"] = langsmith_key
    ep = getattr(settings, "LANGSMITH_ENDPOINT", "") or getattr(settings, "LANGCHAIN_ENDPOINT", "") or os.getenv("LANGSMITH_ENDPOINT", "") or os.getenv("LANGCHAIN_ENDPOINT", "") or "https://api.smith.langchain.com"
    os.environ["LANGCHAIN_ENDPOINT"] = ep
    os.environ["LANGSMITH_ENDPOINT"] = ep
    prj = getattr(settings, "LANGSMITH_PROJECT", "") or getattr(settings, "LANGCHAIN_PROJECT", "") or os.getenv("LANGSMITH_PROJECT", "") or os.getenv("LANGCHAIN_PROJECT", "") or "hrm-rag-chatbot"
    os.environ["LANGCHAIN_PROJECT"] = prj
    os.environ["LANGSMITH_PROJECT"] = prj

try:
    from langsmith import traceable
except Exception:
    def traceable(*args, **kwargs):
        def decorator(f):
            return f
        return decorator


# ===================================================================================
# GRAPH STATE
# ===================================================================================

class AgentState(TypedDict):
    query: str
    thread_id: str
    rewritten_query: Optional[str]
    retry_count: int
    intent: str  # "OUT_OF_SCOPE" | "POLICY" | "PERSONAL_DATA" | "HYBRID"
    current_user: dict
    retrieved_chunks: List[Dict[str, Any]]
    is_context_relevant: bool
    tools_planned: List[Dict[str, Any]]  # [{"tool": "name", "args": {...}}]
    tool_auth_status: str  # "ALLOWED" | "DENIED" | "NONE"
    tool_denied_reason: Optional[str]
    tool_results: List[Dict[str, Any]]
    action_proposal: Optional[Dict[str, Any]]
    requires_action: bool
    final_answer: str
    sources: List[str]
    tools_used: List[str]


# ===================================================================================
# HELPER: MISTRAL CLIENTS
# ===================================================================================

def get_mistral_llm():
    if not settings.MISTRAL_API_KEY:
        return None
    try:
        from langchain_mistralai import ChatMistralAI
        return ChatMistralAI(
            model=settings.MISTRAL_CHAT_MODEL,
            mistral_api_key=settings.MISTRAL_API_KEY,
            temperature=settings.MISTRAL_TEMPERATURE,
        )
    except Exception:
        return None


def get_mistral_embeddings():
    if not settings.MISTRAL_API_KEY:
        return None
    try:
        from langchain_mistralai import MistralAIEmbeddings
        return MistralAIEmbeddings(
            model=settings.MISTRAL_EMBED_MODEL,
            mistral_api_key=settings.MISTRAL_API_KEY,
        )
    except Exception:
        return None


# ===================================================================================
# 1. INTENT ROUTER NODE
# ===================================================================================

OUT_OF_SCOPE_KEYWORDS = [
    "thời tiết", "nấu ăn", "công thức nấu", "phim", "bóng đá", "tổng thống", "vũ trụ",
    "viết thơ", "tình yêu", "code python", "lập trình java", "bitcoin", "crypto", "chứng khoán mỹ"
]

POLICY_KEYWORDS = [
    "quy chế", "nội quy", "chính sách", "quy định", "hướng dẫn", "tiền lương",
    "phạt", "kỷ luật", "thâm niên", "bảo hiểm", "thai sản", "nghỉ ốm", "tăng ca", "ot",
    "geofence", "gps", "hợp đồng", "thử việc", "đổi ca", "phụ cấp dự án", "tiêu chuẩn 26 công"
]

PERSONAL_DATA_KEYWORDS = [
    "của tôi", "lương của tôi", "bảng lương", "phép năm của tôi", "số dư phép",
    "lịch làm", "ca làm", "chấm công", "dự án của tôi", "tạo đơn", "hủy đơn",
    "hồ sơ của tôi", "danh sách nhân viên", "nhân sự chi nhánh", "đơn chờ duyệt"
]


@traceable(name="1_Intent_Router_Node")
async def router_node(state: AgentState) -> Dict[str, Any]:
    q = state["query"].lower().strip()

    # 1. Guardrail: Out-of-Scope Detection
    if any(k in q for k in OUT_OF_SCOPE_KEYWORDS):
        return {"intent": "OUT_OF_SCOPE"}

    # 2. Check for tool intent (Personal HR data / Actions)
    has_personal = any(k in q for k in PERSONAL_DATA_KEYWORDS) or any(
        act in q for act in ["nghỉ phép từ", "xin nghỉ", "hủy đơn", "tra cứu nhân viên", "thống kê nhân sự"]
    )
    has_policy = any(k in q for k in POLICY_KEYWORDS)

    if has_personal and has_policy:
        intent = "HYBRID"
    elif has_personal:
        intent = "PERSONAL_DATA"
    elif has_policy:
        intent = "POLICY"
    else:
        # Mặc định tìm kiếm chính sách nếu không rõ
        intent = "POLICY"

    return {"intent": intent}


# ===================================================================================
# 2. VECTOR RETRIEVER NODE (pgvector + Document Chunks)
# ===================================================================================

@traceable(name="2_Vector_Retriever_Node", run_type="retriever")
async def retriever_node(state: AgentState, db: AsyncSession) -> Dict[str, Any]:
    query_text = state.get("rewritten_query") or state["query"]
    emb_client = get_mistral_embeddings()
    chunks = []

    if emb_client:
        try:
            query_vec = emb_client.embed_query(query_text)
            vec_str = "[" + ",".join(str(x) for x in query_vec) + "]"
            res = await db.execute(text("""
                SELECT id, document_title, category, chunk_content, metadata,
                       1 - (embedding <=> CAST(:vec AS vector)) AS similarity
                FROM policy_embeddings
                WHERE embedding IS NOT NULL
                ORDER BY embedding <=> CAST(:vec AS vector)
                LIMIT 4
            """), {"vec": vec_str})
            chunks = [dict(r) for r in res.mappings().all()]
        except Exception:
            chunks = []

    # Fallback text search nếu chưa có embeddings hoặc kết quả rỗng
    if not chunks:
        words = [w for w in re.split(r"\s+", query_text) if len(w) > 2]
        like_clauses = " OR ".join([f"chunk_content ILIKE :w{i}" for i in range(min(5, len(words)))])
        if not like_clauses:
            like_clauses = "1=1"
        params = {f"w{i}": f"%{words[i]}%" for i in range(min(5, len(words)))}

        res = await db.execute(text(f"""
            SELECT id, document_title, category, chunk_content, metadata, 0.85 as similarity
            FROM policy_embeddings
            WHERE {like_clauses}
            LIMIT 4
        """), params)
        chunks = [dict(r) for r in res.mappings().all()]

    return {"retrieved_chunks": chunks}


# ===================================================================================
# 3. CONTEXT RELEVANCE GRADER NODE (Self-RAG)
# ===================================================================================

@traceable(name="3_Context_Relevance_Grader_Node")
async def grader_node(state: AgentState) -> Dict[str, Any]:
    chunks = state.get("retrieved_chunks", [])
    if not chunks:
        return {"is_context_relevant": False}

    # Đơn giản & hiệu quả: kiểm tra độ tương đồng hoặc sự xuất hiện từ khóa ngữ nghĩa
    query_terms = set(re.findall(r"\w+", (state.get("rewritten_query") or state["query"]).lower()))
    meaningful_terms = {w for w in query_terms if len(w) > 2}

    matched_count = 0
    for c in chunks:
        content = c.get("chunk_content", "").lower()
        if any(term in content for term in meaningful_terms):
            matched_count += 1

    is_relevant = matched_count > 0 or any(float(c.get("similarity", 0)) > 0.65 for c in chunks)
    return {"is_context_relevant": is_relevant}


# ===================================================================================
# 4. QUERY REWRITE NODE
# ===================================================================================

@traceable(name="4_Query_Rewrite_Node")
async def rewrite_node(state: AgentState) -> Dict[str, Any]:
    current_retry = state.get("retry_count", 0) + 1
    raw_query = state["query"]
    llm = get_mistral_llm()

    if llm:
        try:
            prompt = (
                f"Viết lại câu hỏi sau thành 1 truy vấn ngắn gọn chuẩn tiếng Việt để tra cứu cơ sở chính sách nhân sự:\n"
                f"Câu gốc: {raw_query}\n"
                f"Truy vấn tối ưu:"
            )
            resp = await llm.ainvoke(prompt)
            rewritten = resp.content.strip().strip('"')
        except Exception:
            rewritten = raw_query + " quy định chính sách techzone"
    else:
        rewritten = raw_query + " quy định chính sách"

    return {"rewritten_query": rewritten, "retry_count": current_retry}


# ===================================================================================
# 5. AUTH / SCOPE CHECK NODE (HRM Tools Intent Detection & Scope Check)
# ===================================================================================

@traceable(name="5_Auth_Scope_Node")
async def auth_scope_node(state: AgentState) -> Dict[str, Any]:
    q = state["query"].lower().strip()
    user = state["current_user"]
    tools_planned: List[Dict[str, Any]] = []

    # 1. Tạo đơn nghỉ phép (HITL)
    if any(k in q for k in ["tạo đơn nghỉ", "xin nghỉ phép", "xin nghỉ ốm", "xin thai sản", "nghỉ không lương"]):
        leave_code = "PHEP_NAM"
        if "ốm" in q or "bệnh" in q:
            leave_code = "NGHI_OM"
        elif "thai sản" in q or "sinh con" in q:
            leave_code = "THAI_SAN"
        elif "không lương" in q:
            leave_code = "KHONG_LUONG"
        elif "thôi việc" in q or "nghỉ việc" in q:
            leave_code = "THOI_VIEC"

        # Trích xuất ngày nếu có định dạng YYYY-MM-DD
        dates = re.findall(r"\b(\d{4}-\d{2}-\d{2})\b", q)
        start_d = dates[0] if len(dates) > 0 else str(date.today())
        end_d = dates[1] if len(dates) > 1 else start_d

        tools_planned.append({
            "tool": "create_leave_request",
            "args": {
                "leave_type_code": leave_code,
                "start_date": start_d,
                "end_date": end_d,
                "reason": "Đăng ký qua Trợ lý AI Chatbot"
            }
        })

    # 2. Hủy đơn nghỉ phép (HITL)
    elif "hủy đơn" in q or "hủy nghỉ" in q:
        req_match = re.search(r"#?(\d+)", q)
        req_id = int(req_match.group(1)) if req_match else None
        tools_planned.append({
            "tool": "cancel_leave_request",
            "args": {"request_id": req_id, "reason": "Nhân viên yêu cầu hủy đơn"}
        })

    # 3. Xem bảng lương cá nhân (Projects instead of commission)
    elif any(k in q for k in ["bảng lương", "tiền lương của tôi", "lương tháng"]):
        tools_planned.append({"tool": "get_my_payroll", "args": {}})

    # 4. Dự án & phụ cấp dự án
    elif any(k in q for k in ["dự án của tôi", "phụ cấp dự án", "dự án đang tham gia"]):
        tools_planned.append({"tool": "get_my_projects", "args": {}})

    # 5. Số dư ngày phép
    elif any(k in q for k in ["số dư phép", "còn bao nhiêu ngày phép", "phép năm của tôi"]):
        tools_planned.append({"tool": "get_my_leave_balance", "args": {}})

    # 6. Lịch làm việc cá nhân
    elif any(k in q for k in ["lịch làm", "ca làm của tôi", "lịch trực"]):
        tools_planned.append({"tool": "get_my_work_schedule", "args": {}})

    # 7. Chấm công cá nhân
    elif any(k in q for k in ["chấm công của tôi", "giờ công", "đi trễ"]):
        tools_planned.append({"tool": "get_my_attendance", "args": {}})

    # 8. Hồ sơ cá nhân
    elif any(k in q for k in ["hồ sơ của tôi", "thông tin cá nhân", "mã nhân viên của tôi"]):
        tools_planned.append({"tool": "get_my_profile", "args": {}})

    # 9. Đơn chờ duyệt (Quản lý)
    elif any(k in q for k in ["đơn chờ duyệt", "danh sách chờ duyệt"]):
        if not (is_hr_or_admin(user) or is_store_manager(user)):
            return {
                "tool_auth_status": "DENIED",
                "tool_denied_reason": "Truy cập bị từ chối: Chỉ Quản lý chi nhánh hoặc HR mới có quyền xem đơn chờ duyệt.",
                "tools_planned": []
            }
        tools_planned.append({"tool": "get_pending_leave_requests", "args": {}})

    # 10. Thống kê nhân sự (Admin/HR)
    elif any(k in q for k in ["thống kê nhân sự", "tổng số nhân viên"]):
        if not is_hr_or_admin(user):
            return {
                "tool_auth_status": "DENIED",
                "tool_denied_reason": "Truy cập bị từ chối: Chỉ HR Manager hoặc Ban Giám đốc mới có quyền xem thống kê nhân sự.",
                "tools_planned": []
            }
        tools_planned.append({"tool": "get_employee_statistics", "args": {}})

    # 11. Tìm kiếm nhân viên
    elif any(k in q for k in ["tìm nhân viên", "tra cứu nhân viên", "danh sách nhân viên"]):
        if not (is_hr_or_admin(user) or is_store_manager(user)):
            return {
                "tool_auth_status": "DENIED",
                "tool_denied_reason": "Truy cập bị từ chối: Nhân viên thông thường không có quyền tìm kiếm nhân sự khác.",
                "tools_planned": []
            }
        tools_planned.append({"tool": "search_employees", "args": {"keyword": ""}})

    # Fallback: Nếu không match tool cụ thể, chuyển sang xem profile
    if not tools_planned and state["intent"] in ["PERSONAL_DATA", "HYBRID"]:
        tools_planned.append({"tool": "get_my_profile", "args": {}})

    return {
        "tool_auth_status": "ALLOWED",
        "tool_denied_reason": None,
        "tools_planned": tools_planned
    }


# ===================================================================================
# 6. TOOLS EXECUTION NODE
# ===================================================================================

@traceable(name="6_Tools_Execution_Node", run_type="tool")
async def tools_node(state: AgentState, db: AsyncSession) -> Dict[str, Any]:
    if state.get("tool_auth_status") != "ALLOWED":
        return {"tool_results": [], "tools_used": []}

    planned = state.get("tools_planned", [])
    current_user = state["current_user"]
    results = []
    tools_used = []
    action_prop = None
    req_act = False

    for plan in planned:
        t_name = plan["tool"]
        t_args = plan.get("args", {})
        fn = HRM_TOOLS_REGISTRY.get(t_name)
        if fn:
            tools_used.append(t_name)
            res = await fn(t_args, current_user, db)
            results.append({"tool": t_name, "output": res})

            # Kiểm tra xem có Action Proposal HITL không
            if isinstance(res, dict) and res.get("status") == "PROPOSED" and "action_proposal" in res:
                action_prop = res["action_proposal"]
                req_act = True

    return {
        "tool_results": results,
        "tools_used": tools_used,
        "action_proposal": action_prop,
        "requires_action": req_act
    }


# ===================================================================================
# 7. TOOL RESULT VALIDATOR NODE
# ===================================================================================

@traceable(name="7_Tool_Result_Validator_Node")
async def validator_node(state: AgentState) -> Dict[str, Any]:
    # Kiểm tra xem có lỗi trong kết quả tools không
    results = state.get("tool_results", [])
    validated = []
    for r in results:
        out = r.get("output", {})
        if isinstance(out, dict) and "error" in out:
            validated.append({"tool": r["tool"], "status": "ERROR", "message": out["error"]})
        else:
            validated.append({"tool": r["tool"], "status": "SUCCESS", "data": out})
    return {"tool_results": validated}


# ===================================================================================
# 8. ANSWER GENERATOR NODE (Synthesizer + PDF Citations)
# ===================================================================================

@traceable(name="8_Answer_Generator_Node")
async def generator_node(state: AgentState) -> Dict[str, Any]:
    intent = state.get("intent")
    user = state["current_user"]
    sources = []

    # 1. Guardrail Refusal
    if intent == "OUT_OF_SCOPE":
        return {
            "final_answer": (
                "Xin lỗi, tôi là **Trợ lý AI Nhân sự TechZone HRM** và chỉ hỗ trợ giải đáp các câu hỏi trong phạm vi "
                "quy chế, chính sách, chấm công, dự án và dữ liệu nhân sự nội bộ của TechZone.\n\n"
                "Tôi không thể phản hồi các câu hỏi ngoài phạm vi này. Bạn vui lòng đặt câu hỏi liên quan đến nhân sự hoặc công việc tại TechZone!"
            ),
            "sources": [],
            "tools_used": []
        }

    # 2. Access Denied
    if state.get("tool_auth_status") == "DENIED":
        return {
            "final_answer": f"⛔ **Không thể thực hiện:** {state.get('tool_denied_reason', 'Truy cập bị từ chối do không đủ quyền hạn.')}",
            "sources": [],
            "tools_used": []
        }

    # 3. Thu thập Trích dẫn PDF
    chunks = state.get("retrieved_chunks", [])
    pdf_context_blocks = []
    for c in chunks:
        doc_title = c.get("document_title", "Tài liệu chính sách")
        meta = c.get("metadata") or {}
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except Exception:
                meta = {}
        page_num = meta.get("page", 1)
        doc_code = meta.get("doc_code", "")

        citation_pill = f"{doc_title} (Trang {page_num})"
        if citation_pill not in sources:
            sources.append(citation_pill)

        pdf_context_blocks.append(f"[{doc_title} - Trang {page_num}]:\n{c.get('chunk_content', '')}")

    context_str = "\n\n---\n\n".join(pdf_context_blocks)
    tool_results = state.get("tool_results", [])
    tool_str = json.dumps(tool_results, default=str, ensure_ascii=False, indent=2) if tool_results else ""

    # 4. Nếu có Action Proposal (HITL)
    if state.get("requires_action") and state.get("action_proposal"):
        prop = state["action_proposal"]
        answer = (
            f"Tôi đã chuẩn bị xong yêu cầu: **{prop['title']}**.\n\n"
            f"{prop['description']}\n\n"
        )
        if prop.get("requires_attachment"):
            answer += f"⚠️ **Lưu ý:** {prop.get('attachment_hint')}\n\n"
        answer += "👉 Vui lòng xem lại thông tin trên thẻ xác nhận bên dưới và nhấn **Xác nhận** để hệ thống ghi nhận."
        return {
            "final_answer": answer,
            "sources": sources,
            "tools_used": state.get("tools_used", [])
        }

    # 5. Tạo câu trả lời qua Mistral LLM
    llm = get_mistral_llm()
    if llm:
        system_prompt = (
            f"Bạn là Trợ lý AI Nhân sự TechZone HRM chuyên nghiệp, chính xác, thân thiện.\n"
            f"Người dùng hiện tại: {user.get('full_name')} (Vai trò: {', '.join(user.get('roles', []))}, Chi nhánh: {user.get('store_name')}).\n\n"
            f"QUY TẮC BẮT BUỘC:\n"
            f"1. Tuyệt đối KHÔNG trả lời bất kỳ thông tin nào ngoài phạm vi nhân sự TechZone.\n"
            f"2. Công ty KHÔNG áp dụng hoa hồng bán hàng cá nhân. Thu nhập biến đổi dựa trên Phụ cấp tham gia Dự án.\n"
            f"3. Khi đưa ra thông tin từ tài liệu, hãy trích dẫn tên tài liệu và số trang rõ ràng.\n"
            f"4. Trả lời bằng Markdown đẹp, gạch đầu dòng rõ ràng, số liệu VNĐ định dạng có dấu phẩy.\n\n"
            f"DỮ LIỆU TÀI LIỆU CHÍNH SÁCH (PDF):\n{context_str or 'Không có trích đoạn phù hợp'}\n\n"
            f"DỮ LIỆU TỪ HỆ THỐNG HRM (TOOLS):\n{tool_str or 'Không có gọi tool'}\n"
        )
        try:
            res = await llm.ainvoke(
                [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": state["query"]}
                ],
                config={"metadata": {"thread_id": state.get("thread_id")}}
            )
            return {
                "final_answer": res.content,
                "sources": sources,
                "tools_used": state.get("tools_used", [])
            }
        except Exception as e:
            pass

    # Fallback khi LLM offline: tổng hợp trực tiếp
    lines = [f"Xin chào **{user.get('full_name', '')}**! Dưới đây là thông tin tra cứu từ hệ thống TechZone HRM:"]
    if tool_results:
        for r in tool_results:
            if r.get("status") == "SUCCESS":
                lines.append(f"\n**Dữ liệu từ {r['tool']}:**")
                data = r.get("data", {})
                if isinstance(data, dict):
                    for k, v in list(data.items())[:6]:
                        lines.append(f"- **{k}**: {v}")
    if chunks:
        lines.append("\n**Căn cứ theo quy chế công ty:**")
        for c in chunks[:2]:
            lines.append(f"> {c.get('chunk_content', '')[:200]}...")

    lines.append("\n*(Ghi chú: Cấu hình MISTRAL_API_KEY trong .env để kích hoạt mô hình sinh câu trả lời tự nhiên nhất)*")
    return {
        "final_answer": "\n".join(lines),
        "sources": sources,
        "tools_used": state.get("tools_used", [])
    }


# ===================================================================================
# GRAPH WORKFLOW ORCHESTRATION
# ===================================================================================

@traceable(name="TechZone_HRM_AI_Chatbot_Pipeline", run_type="chain")
async def run_ai_chatbot_pipeline(
    query: str,
    current_user: dict,
    db: AsyncSession,
    thread_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Điều phối luồng StateGraph theo đúng Graph Architecture:
    Router -> [Retriever -> Grader -> Retry / Tools -> Validator] -> Generator -> Final Answer
    Ghi nhận Thread ID tự động vào LangSmith Threads.
    """
    if not thread_id or not str(thread_id).strip():
        thread_id = f"thread-user-{current_user.get('user_id', 0)}-{uuid4().hex[:8]}"

    try:
        from langsmith import get_current_run_tree
        run_tree = get_current_run_tree()
        if run_tree:
            run_tree.metadata["thread_id"] = str(thread_id).strip()
            run_tree.metadata["session_id"] = str(thread_id).strip()
            run_tree.metadata["user_id"] = current_user.get("user_id")
            run_tree.metadata["user_name"] = current_user.get("full_name")
            run_tree.metadata["roles"] = current_user.get("roles")
    except Exception:
        pass

    state: AgentState = {
        "query": query,
        "thread_id": str(thread_id).strip(),
        "rewritten_query": None,
        "retry_count": 0,
        "intent": "POLICY",
        "current_user": current_user,
        "retrieved_chunks": [],
        "is_context_relevant": False,
        "tools_planned": [],
        "tool_auth_status": "NONE",
        "tool_denied_reason": None,
        "tool_results": [],
        "action_proposal": None,
        "requires_action": False,
        "final_answer": "",
        "sources": [],
        "tools_used": []
    }

    # 1. Router
    r_res = await router_node(state)
    state.update(r_res)

    if state["intent"] == "OUT_OF_SCOPE":
        gen_res = await generator_node(state)
        state.update(gen_res)
        return state

    # 2. Nhánh Retrieval (nếu là POLICY hoặc HYBRID)
    if state["intent"] in ["POLICY", "HYBRID"]:
        ret_res = await retriever_node(state, db)
        state.update(ret_res)

        grd_res = await grader_node(state)
        state.update(grd_res)

        # Self-RAG Retry Loop (tối đa 2 lần)
        while not state["is_context_relevant"] and state["retry_count"] < 2:
            rew_res = await rewrite_node(state)
            state.update(rew_res)
            ret_res = await retriever_node(state, db)
            state.update(ret_res)
            grd_res = await grader_node(state)
            state.update(grd_res)

    # 3. Nhánh Tools (nếu là PERSONAL_DATA hoặc HYBRID)
    if state["intent"] in ["PERSONAL_DATA", "HYBRID"]:
        auth_res = await auth_scope_node(state)
        state.update(auth_res)

        if state["tool_auth_status"] == "ALLOWED":
            tls_res = await tools_node(state, db)
            state.update(tls_res)
            val_res = await validator_node(state)
            state.update(val_res)

    # 4. Generator
    gen_res = await generator_node(state)
    state.update(gen_res)

    # 5. Lưu trữ lịch sử trò chuyện chính thức vào Supabase PostgreSQL
    try:
        await save_chat_message(
            db=db,
            thread_id=state["thread_id"],
            user_id=current_user.get("user_id"),
            employee_id=current_user.get("employee_id"),
            sender="user",
            content=query
        )
        await save_chat_message(
            db=db,
            thread_id=state["thread_id"],
            user_id=current_user.get("user_id"),
            employee_id=current_user.get("employee_id"),
            sender="assistant",
            content=state.get("final_answer", ""),
            sources=state.get("sources", []),
            tools_used=state.get("tools_used", []),
            action_proposal=state.get("action_proposal")
        )
    except Exception as e:
        # Ghi nhận lỗi lưu DB nhưng không làm gián đoạn câu trả lời của user
        print(f"Lỗi lưu trữ tin nhắn vào Supabase: {e}")

    return state


# ===================================================================================
# ===================================================================================
# STREAMING PIPELINE (SSE SERVER-SENT EVENTS)
# ===================================================================================

@traceable(name="TechZone_HRM_AI_Chatbot_Stream_Pipeline", run_type="chain")
async def stream_ai_chatbot_pipeline(
    query: str,
    current_user: Dict[str, Any],
    db: AsyncSession,
    thread_id: Optional[str] = None
):
    """
    Ham sinh luong su kien SSE truc tiep cho giao dien chat:
    - Yield cac dict: event=token, text=...
    - Tu dong luu hoi thoai vao Supabase PostgreSQL
    """
    if not thread_id:
        thread_id = str(uuid4())

    try:
        from langsmith.run_trees import get_current_run_tree
        run_tree = get_current_run_tree()
        if run_tree:
            run_tree.metadata["thread_id"] = thread_id
            run_tree.metadata["session_id"] = thread_id
            run_tree.metadata["user_id"] = current_user.get("user_id")
            run_tree.metadata["user_name"] = current_user.get("full_name")
            run_tree.metadata["roles"] = current_user.get("roles")
    except Exception:
        pass

    state: AgentState = {
        "query": query,
        "thread_id": thread_id,
        "rewritten_query": None,
        "retry_count": 0,
        "intent": "POLICY",
        "current_user": current_user,
        "retrieved_chunks": [],
        "is_context_relevant": False,
        "tools_planned": [],
        "tool_auth_status": "NONE",
        "tool_denied_reason": None,
        "tool_results": [],
        "action_proposal": None,
        "requires_action": False,
        "final_answer": "",
        "sources": [],
        "tools_used": []
    }

    # Bat dau stream
    yield {"event": "start", "thread_id": thread_id}

    # 1. Router
    r_res = await router_node(state)
    state.update(r_res)

    if state["intent"] == "OUT_OF_SCOPE":
        msg = (
            "Xin lỗi, tôi là **Trợ lý AI Nhân sự TechZone HRM** và chỉ hỗ trợ giải đáp các câu hỏi trong phạm vi "
            "quy chế, chính sách, chấm công, dự án và dữ liệu nhân sự nội bộ của TechZone.\n\n"
            "Tôi không thể phản hồi các câu hỏi ngoài phạm vi này. Bạn vui lòng đặt câu hỏi liên quan đến nhân sự hoặc công việc tại TechZone!"
        )
        yield {"event": "token", "text": msg}
        yield {"event": "done", "answer": msg, "sources": [], "tools_used": [], "thread_id": thread_id}
        await _save_turn(db, thread_id, current_user, query, msg, [], [], None)
        return

    # 2. Nhanh Retrieval
    if state["intent"] in ["POLICY", "HYBRID"]:
        yield {"event": "status", "message": "Đang tra cứu cơ sở chính sách & quy chế công ty..."}
        ret_res = await retriever_node(state, db)
        state.update(ret_res)

        grd_res = await grader_node(state)
        state.update(grd_res)

        while not state["is_context_relevant"] and state["retry_count"] < 2:
            rew_res = await rewrite_node(state)
            state.update(rew_res)
            ret_res = await retriever_node(state, db)
            state.update(ret_res)
            grd_res = await grader_node(state)
            state.update(grd_res)

    # 3. Nhanh Tools
    if state["intent"] in ["PERSONAL_DATA", "HYBRID"]:
        yield {"event": "status", "message": "Đang kiểm tra quyền hạn và tra cứu dữ liệu nhân sự..."}
        auth_res = await auth_scope_node(state)
        state.update(auth_res)

        if state["tool_auth_status"] == "DENIED":
            denied_msg = f"⛔ **Không thể thực hiện:** {state.get('tool_denied_reason', 'Truy cập bị từ chối do không đủ quyền hạn.')}"
            yield {"event": "token", "text": denied_msg}
            yield {"event": "done", "answer": denied_msg, "sources": [], "tools_used": [], "thread_id": thread_id}
            await _save_turn(db, thread_id, current_user, query, denied_msg, [], [], None)
            return

        if state["tool_auth_status"] == "ALLOWED":
            tls_res = await tools_node(state, db)
            state.update(tls_res)
            val_res = await validator_node(state)
            state.update(val_res)

    # 4. Neu co Action Proposal (HITL)
    if state.get("requires_action") and state.get("action_proposal"):
        prop = state["action_proposal"]
        proposal_text = (
            f"Tôi đã chuẩn bị xong yêu cầu: **{prop['title']}**.\n\n"
            f"{prop['description']}\n\n"
        )
        if prop.get("requires_attachment"):
            proposal_text += f"⚠️ **Lưu ý:** {prop.get('attachment_hint')}\n\n"
        proposal_text += "👉 Vui lòng xem lại thông tin trên thẻ xác nhận bên dưới và nhấn **Xác nhận** để hệ thống ghi nhận."

        yield {"event": "token", "text": proposal_text}
        yield {
            "event": "done",
            "answer": proposal_text,
            "sources": state.get("sources", []),
            "tools_used": state.get("tools_used", []),
            "action_proposal": prop,
            "requires_action": True,
            "thread_id": thread_id
        }
        await _save_turn(db, thread_id, current_user, query, proposal_text, state.get("sources", []), state.get("tools_used", []), prop)
        return

    # 5. Sinh cau tra loi qua Streaming (Mistral AI astream)
    sources = []
    chunks = state.get("retrieved_chunks", [])
    pdf_context_blocks = []
    for c in chunks:
        doc_title = c.get("document_title", "Tài liệu chính sách")
        meta = c.get("metadata") or {}
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except Exception:
                meta = {}
        page_num = meta.get("page", 1)
        citation_pill = f"{doc_title} (Trang {page_num})"
        if citation_pill not in sources:
            sources.append(citation_pill)
        pdf_context_blocks.append(f"[{doc_title} - Trang {page_num}]:\n{c.get('chunk_content', '')}")

    context_str = "\n\n---\n\n".join(pdf_context_blocks)
    tool_results = state.get("tool_results", [])
    tool_str = json.dumps(tool_results, default=str, ensure_ascii=False, indent=2) if tool_results else ""
    user = current_user

    system_prompt = (
        f"Bạn là Trợ lý AI Nhân sự TechZone HRM chuyên nghiệp, chính xác, thân thiện.\n"
        f"Người dùng hiện tại: {user.get('full_name')} (Vai trò: {', '.join(user.get('roles', []))}, Chi nhánh: {user.get('store_name')}).\n\n"
        f"QUY TẮC BẮT BUỘC VỀ NỘI DUNG & TRÌNH BÀY (DỄ ĐỌC TRÊN GIAO DIỆN CHAT):\n"
        f"1. Tuyệt đối KHÔNG trả lời bất kỳ thông tin nào ngoài phạm vi nhân sự TechZone.\n"
        f"2. Công ty KHÔNG áp dụng hoa hồng bán hàng cá nhân. Thu nhập biến đổi hoàn toàn dựa trên Phụ cấp tham gia Dự án.\n"
        f"3. Khi đưa ra thông tin từ tài liệu, trích dẫn tên tài liệu và số trang rõ ràng.\n"
        f"4. QUY TẮC BỐ CỤC CHO KHUNG CHAT (QUAN TRỌNG ĐỂ KHÔNG BỊ RỐI):\n"
        f"   - Bố cục thoáng, khoảng cách dòng hợp lý, dùng tiêu đề nhỏ gọn (###), không lạm dụng quá nhiều dấu --- hoặc *** liên tiếp.\n"
        f"   - Khi hiển thị bảng, chỉ dùng bảng gọn gàng 2-3 cột: | Khoản mục | Số tiền | Ghi chú |.\n"
        f"   - Nếu tóm tắt nhanh các chỉ số (ngày công, trạng thái, tổng thực nhận), dùng danh sách gạch đầu dòng có icon thay vì vẽ bảng quá nhiều cột ngang làm vỡ khung chat.\n"
        f"   - Số tiền luôn có dấu phẩy hoặc chấm ngăn cách hàng nghìn và kèm chữ VNĐ.\n\n"
        f"DỮ LIỆU TÀI LIỆU CHÍNH SÁCH (PDF):\n{context_str or 'Không có trích đoạn phù hợp'}\n\n"
        f"DỮ LIỆU TỪ HỆ THỐNG HRM (TOOLS):\n{tool_str or 'Không có gọi tool'}\n"
    )

    llm = get_mistral_llm()
    accumulated_tokens = []

    if llm:
        try:
            async for chunk in llm.astream(
                [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": state["query"]}
                ],
                config={"metadata": {"thread_id": thread_id}}
            ):
                token = chunk.content or ""
                accumulated_tokens.append(token)
                yield {"event": "token", "text": token}
        except Exception as e:
            fallback = f"Xin lỗi, có lỗi khi sinh câu trả lời trực tiếp: {e}"
            accumulated_tokens.append(fallback)
            yield {"event": "token", "text": fallback}
    else:
        # Fallback offline
        fb_lines = [f"Xin chào **{user.get('full_name', '')}**! Dưới đây là thông tin tra cứu:"]
        if tool_results:
            for r in tool_results:
                if r.get("status") == "SUCCESS":
                    data = r.get("data", {})
                    if isinstance(data, dict):
                        for k, v in list(data.items())[:6]:
                            fb_lines.append(f"• **{k}**: {v}")
        fallback_msg = "\n".join(fb_lines)
        accumulated_tokens.append(fallback_msg)
        yield {"event": "token", "text": fallback_msg}

    final_answer = "".join(accumulated_tokens)

    # Phat tin hieu hoan tat
    yield {
        "event": "done",
        "answer": final_answer,
        "sources": sources,
        "tools_used": state.get("tools_used", []),
        "thread_id": thread_id
    }

    # Luu tru chinh thuc vao Supabase PostgreSQL
    await _save_turn(
        db,
        thread_id,
        current_user,
        query,
        final_answer,
        sources,
        state.get("tools_used", []),
        state.get("action_proposal")
    )


async def _save_turn(db, thread_id, current_user, query, answer, sources, tools_used, action_prop):
    try:
        await save_chat_message(
            db=db,
            thread_id=thread_id,
            user_id=current_user.get("user_id"),
            employee_id=current_user.get("employee_id"),
            sender="user",
            content=query
        )
        await save_chat_message(
            db=db,
            thread_id=thread_id,
            user_id=current_user.get("user_id"),
            employee_id=current_user.get("employee_id"),
            sender="assistant",
            content=answer,
            sources=sources,
            tools_used=tools_used,
            action_proposal=action_prop
        )
    except Exception as e:
        print(f"Lỗi lưu trữ hội thoại vào Supabase: {e}")
