import sys
import asyncio
from uuid import uuid4
from httpx import AsyncClient, ASGITransport

sys.path.insert(0, "backend")
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

from app.main import app
from app.core.security import create_access_token

async def test_api_e2e():
    print("--- BẮT ĐẦU TEST E2E API STREAMING & HISTORY PERSISTENCE ---")
    
    # 1. Tạo JWT token cho nhân viên kiểm thử
    token = create_access_token(subject="admin", roles=["ADMIN"])
    headers = {"Authorization": f"Bearer {token}"}
    
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Test 1: Lấy lịch sử ban đầu
        test_thread = f"e2e-thread-{uuid4().hex[:8]}"
        res_h0 = await client.get(f"/api/v1/ai-chatbot/history?thread_id={test_thread}", headers=headers)
        print(f"1. GET /history trước khi chat: Status {res_h0.status_code}, Messages count = {len(res_h0.json().get('messages', []))}")
        
        # Test 2: Gọi POST /stream với SSE
        print(f"2. Gửi câu hỏi qua POST /stream (thread_id: {test_thread})...")
        tokens_received = []
        events_received = []
        
        async with client.stream(
            "POST",
            "/api/v1/ai-chatbot/stream",
            json={"query": "Tôi muốn biết quy chế về phụ cấp dự án và hoa hồng bán hàng tại TechZone?", "thread_id": test_thread},
            headers=headers,
            timeout=30.0
        ) as response:
            print(f"   Stream response status: {response.status_code}")
            assert response.status_code == 200
            
            buffer = ""
            async for chunk in response.aiter_text():
                buffer += chunk
                while "\n\n" in buffer:
                    line, buffer = buffer.split("\n\n", 1)
                    if line.startswith("data: "):
                        import json
                        evt = json.loads(line[6:])
                        events_received.append(evt.get("event"))
                        if evt.get("event") == "token":
                            tokens_received.append(evt.get("text", ""))
                        elif evt.get("event") == "status":
                            print(f"   [STATUS UPDATE] {evt.get('message')}")
                        elif evt.get("event") == "done":
                            print(f"   [DONE] Trả lời hoàn tất! Sources: {len(evt.get('sources', []))}, Tools: {len(evt.get('tools_used', []))}")
        
        full_answer = "".join(tokens_received)
        print(f"\n3. Nội dung câu trả lời stream nhận được ({len(full_answer)} ký tự):\n{full_answer[:200]}...")
        assert len(full_answer) > 0, "Không nhận được token nào từ streaming!"
        assert "hoa hồng" in full_answer.lower() or "dự án" in full_answer.lower()
        
        # Test 3: Kiểm tra lịch sử sau khi chat đã lưu vào Supabase
        print("\n4. Kiểm tra GET /history sau khi chat để xác nhận đã lưu vào Supabase PostgreSQL...")
        res_h1 = await client.get(f"/api/v1/ai-chatbot/history?thread_id={test_thread}", headers=headers)
        assert res_h1.status_code == 200
        msgs = res_h1.json().get("messages", [])
        print(f"   Số lượng tin nhắn lưu trong Supabase: {len(msgs)}")
        for m in msgs:
            print(f"   - [{m['sender'].upper()}]: {m['content'][:70]}... (ID: {m.get('message_id')})")
        assert len(msgs) == 2, f"Mong đợi 2 tin nhắn (user + assistant), nhưng nhận được {len(msgs)}"

    print("\n✅ TẤT CẢ CÁC BƯỚC TEST E2E ĐỀU THÀNH CÔNG VÀ CHÍNH XÁC 100%!")

if __name__ == "__main__":
    asyncio.run(test_api_e2e())
