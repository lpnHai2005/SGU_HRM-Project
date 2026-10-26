"""
TechZone HRM - AI Chatbot Concurrent Load & Stress Test
Mô phỏng 30-50 yêu cầu đồng thời truy vấn RAG Chatbot Pipeline:
- Kiểm tra tính ổn định của Connection Pool AsyncSession Supabase
- Đo lường RPS (Requests Per Second), tỷ lệ thành công (Success Rate %)
- Đo lường độ trễ p50, p90, p95, p99
- Đo lường hiệu quả tăng tốc của Policy Response Cache
"""

import os
import sys
import time
import asyncio
from typing import List, Dict, Any

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
sys.path.insert(0, BACKEND_DIR)

from dotenv import load_dotenv
load_dotenv(os.path.join(BACKEND_DIR, ".env"))

from app.core.database import AsyncSessionLocal
from app.core.ai_chatbot_graph import run_ai_chatbot_pipeline
from app.core.ai_chatbot_cache import ai_policy_cache

TEST_QUERIES = [
    # Nhóm Chính sách (sẽ được cache sau lượt đầu)
    "Quy định đi trễ trên 15 phút tại TechZone bị xử phạt như thế nào?",
    "Tiêu chuẩn số ngày công trong tháng để hưởng 100% lương hợp đồng?",
    "Bán kính GPS Geofence cho phép chấm công tại cửa hàng là bao nhiêu?",
    "Quy trình nộp đơn nghỉ phép ốm đau gồm mấy cấp?",
    "Chính sách phụ cấp thâm niên làm việc tại TechZone tính ra sao?",
    # Nhóm Chào hỏi
    "Xin chào bạn",
    "Hello chatbot",
    # Nhóm An toàn
    "Thời tiết hôm nay ở Đà Nẵng thế nào?",
    "Viết mã Python kết nối database",
    # Nhóm Dữ liệu cá nhân
    "Tôi còn bao nhiêu ngày phép năm?",
]


VALID_USER_IDS = [1, 3, 4, 5, 6]

async def send_single_query(sem: asyncio.Semaphore, query: str, user_id: int, req_idx: int) -> Dict[str, Any]:
    test_user = {
        "user_id": user_id,
        "employee_id": user_id,
        "full_name": f"Nhân viên Test #{user_id}",
        "roles": ["EMPLOYEE"],
        "store_id": 1,
        "store_name": "TechZone Store 01"
    }

    thread_id = f"loadtest-u{user_id}-req{req_idx}"
    async with sem:
        t0 = time.perf_counter()
        async with AsyncSessionLocal() as db:
            try:
                res = await run_ai_chatbot_pipeline(
                    query=query,
                    current_user=test_user,
                    db=db,
                    thread_id=thread_id
                )
                dur_ms = round((time.perf_counter() - t0) * 1000, 1)
                is_ok = bool(res.get("final_answer"))
                return {"status": "SUCCESS" if is_ok else "EMPTY", "latency_ms": dur_ms, "query": query}
            except Exception as e:
                dur_ms = round((time.perf_counter() - t0) * 1000, 1)
                return {"status": "ERROR", "error": str(e), "latency_ms": dur_ms, "query": query}


async def run_load_test(concurrency: int = 15, total_requests: int = 40):
    print("=" * 80)
    print(f"BẮT ĐẦU LOAD TEST AI CHATBOT PIPELINE (CONCURRENCY={concurrency}, TOTAL={total_requests})")
    print("=" * 80)

    # 1. Đo lường Cold Request (Chưa có cache)
    print("\n--- ĐỢT 1: LƯỢT GỌI ĐẦU TIÊN (COLD CACHE - TRUY VẤN CSDL + RRF) ---")
    sem = asyncio.Semaphore(concurrency)
    cold_tasks = []
    for i in range(len(TEST_QUERIES)):
        uid = VALID_USER_IDS[i % len(VALID_USER_IDS)]
        cold_tasks.append(send_single_query(sem, TEST_QUERIES[i], user_id=uid, req_idx=1))

    t_start_cold = time.perf_counter()
    cold_results = await asyncio.gather(*cold_tasks)
    total_cold_time = time.perf_counter() - t_start_cold

    cold_latencies = [r["latency_ms"] for r in cold_results if r["status"] == "SUCCESS"]
    cold_latencies.sort()
    p50_cold = cold_latencies[len(cold_latencies) // 2] if cold_latencies else 0

    print(f"✓ Đã hoàn thành {len(cold_results)} cold requests trong {total_cold_time:.2f}s")
    print(f"• Latency trung vị khi chưa cache: {p50_cold:.1f}ms")

    # 2. Đo lường Warm Requests dưới tải cao (Có cache + Concurrency)
    print(f"\n--- ĐỢT 2: CHỊU TẢI CAO VỚI POLICY CACHE ({total_requests} REQUESTS ĐỒNG THỜI) ---")
    warm_tasks = []
    for i in range(total_requests):
        q = TEST_QUERIES[i % len(TEST_QUERIES)]
        uid = VALID_USER_IDS[i % len(VALID_USER_IDS)]
        warm_tasks.append(send_single_query(sem, q, user_id=uid, req_idx=i))

    t_start_warm = time.perf_counter()
    warm_results = await asyncio.gather(*warm_tasks)
    total_warm_time = time.perf_counter() - t_start_warm

    success_count = sum(1 for r in warm_results if r["status"] == "SUCCESS")
    error_count = sum(1 for r in warm_results if r["status"] == "ERROR")
    warm_latencies = [r["latency_ms"] for r in warm_results if r["status"] == "SUCCESS"]
    warm_latencies.sort()

    p50_warm = warm_latencies[int(len(warm_latencies) * 0.50)] if warm_latencies else 0
    p90_warm = warm_latencies[int(len(warm_latencies) * 0.90)] if warm_latencies else 0
    p95_warm = warm_latencies[int(len(warm_latencies) * 0.95)] if warm_latencies else 0
    p99_warm = warm_latencies[int(len(warm_latencies) * 0.99)] if warm_latencies else 0
    rps = round(total_requests / total_warm_time, 2)

    speedup = round(p50_cold / max(1.0, p50_warm), 1) if p50_warm > 0 else 1.0

    # Dọn dẹp tin nhắn loadtest trong ai_chat_messages
    async with AsyncSessionLocal() as db:
        from sqlalchemy import text
        await db.execute(text("DELETE FROM ai_chat_messages WHERE thread_id LIKE 'loadtest-%'"))
        await db.commit()

    print("=" * 80)
    print("KẾT QUẢ KIỂM THỬ CHỊU TẢI & TĂNG TỐC BỘ ĐỆM:")
    print("=" * 80)
    print(f"• Tổng số requests hoàn thành : {len(warm_results)}/{total_requests}")
    print(f"• Tỷ lệ thành công (Success)   : {success_count / total_requests * 100:.1f}% ({success_count} passed, {error_count} failed)")
    print(f"• Thông lượng xử lý (RPS)      : {rps} requests/second")
    print(f"• Thời gian hoàn thành tổng    : {total_warm_time:.2f} seconds")
    print(f"• Độ trễ trung vị (p50 Latency): {p50_warm:.1f} ms")
    print(f"• Độ trễ p90 Latency           : {p90_warm:.1f} ms")
    print(f"• Độ trễ p95 Latency           : {p95_warm:.1f} ms")
    print(f"• Độ trễ p99 Latency           : {p99_warm:.1f} ms")
    print(f"• Tốc độ tăng tốc nhờ Cache    : Nhanh hơn {speedup}x so với truy vấn CSDL gốc")
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(run_load_test(concurrency=15, total_requests=45))
