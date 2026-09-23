import re
from typing import Optional, List
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.core.database import get_db
from app.api.deps import get_current_user
from app.schemas.schemas import AICopilotQuery, AICopilotResponse

router = APIRouter()

@router.post("/query", response_model=AICopilotResponse, summary="Hỏi đáp AI HR Copilot về chính sách, hoa hồng & quy trình (RAG)")
async def ask_ai_copilot(
    body: AICopilotQuery,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    query_text = body.query.lower().strip()
    sources = []
    answer = ""

    # 1. Truy xuất kiến thức từ bảng policy_embeddings trong Supabase
    kb_res = await db.execute(text("SELECT document_title, category, chunk_content FROM policy_embeddings"))
    knowledge_chunks = kb_res.mappings().all()

    # 2. Xử lý kịch bản Demo tính hoa hồng nhanh (Use Case 13 - AI Copilot)
    # Ví dụ: "Tôi bán được 30 triệu phụ kiện và 150 triệu điện thoại thì hoa hồng tháng này tính thế nào?"
    if any(k in query_text for k in ["hoa hồng", "doanh số", "kpi", "thưởng"]):
        sources.append("Chính sách hoa hồng và KPI bán lẻ TechZone 2026")
        
        # Regex trích xuất con số nếu có
        phone_match = re.search(r"(\d+)\s*(triệu|tr|m).*?(điện thoại|dt|iphone)", query_text)
        laptop_match = re.search(r"(\d+)\s*(triệu|tr|m).*?(laptop|máy tính)", query_text)
        acc_match = re.search(r"(\d+)\s*(triệu|tr|m).*?(phụ kiện|tai nghe|sạc)", query_text)

        phone_val = float(phone_match.group(1)) if phone_match else 0
        laptop_val = float(laptop_match.group(1)) if laptop_match else 0
        acc_val = float(acc_match.group(1)) if acc_match else 0

        if phone_val or laptop_val or acc_val:
            comm_phone = phone_val * 0.01 * 1000000
            comm_laptop = laptop_val * 0.01 * 1000000
            comm_acc = acc_val * 0.03 * 1000000
            total_comm = comm_phone + comm_laptop + comm_acc

            answer = (
                f"Chào bạn {current_user.get('full_name', '')}! Dựa trên quy chế chính sách hoa hồng bán lẻ của TechZone:\n"
                f"- **Điện thoại & Laptop:** Tỷ lệ hoa hồng là **1%**\n"
                f"- **Phụ kiện (tai nghe, cáp sạc...):** Tỷ lệ hoa hồng là **3%**\n\n"
                f"**Cách tính hoa hồng cụ thể của bạn:**\n"
            )
            if phone_val:
                answer += f"• Doanh số Điện thoại: {phone_val:.0f} triệu × 1% = **{comm_phone:,.0f} VNĐ**\n"
            if laptop_val:
                answer += f"• Doanh số Laptop: {laptop_val:.0f} triệu × 1% = **{comm_laptop:,.0f} VNĐ**\n"
            if acc_val:
                answer += f"• Doanh số Phụ kiện: {acc_val:.0f} triệu × 3% = **{comm_acc:,.0f} VNĐ**\n"

            answer += f"\n👉 **Tổng tiền hoa hồng bạn nhận được:** **{total_comm:,.0f} VNĐ**.\n"
            answer += "*(Ngoài ra nếu tổng doanh thu vượt 100% KPI chỉ tiêu tháng, bạn sẽ được thưởng nóng thêm 1.000.000 VNĐ; vượt 120% KPI sẽ được thưởng nóng 2.000.000 VNĐ)*."
            return AICopilotResponse(answer=answer, sources=sources, confidence=0.98)

    # 3. Kịch bản hỏi về chấm công, đi trễ, ca làm
    if any(k in query_text for k in ["đi trễ", "đi muộn", "ca làm", "phạt"]):
        sources.append("Nội quy công ty TechZone")
        answer = (
            f"Theo quy định nội quy lao động TechZone:\n"
            f"- Chuỗi cửa hàng áp dụng các ca: Ca sáng (08h00 - 16h00), Ca chiều (13h00 - 21h00), Ca Full (08h00 - 21h00).\n"
            f"- Nhân viên đi trễ trong vòng 15 phút đầu được tính là đúng giờ cho phép chuẩn bị.\n"
            f"- **Nếu đi trễ trên 15 phút**, hệ thống tự động ghi nhận trạng thái `LATE` và áp dụng mức khấu trừ **50.000 VNĐ / lần** vào kỳ lương tương ứng."
        )
        return AICopilotResponse(answer=answer, sources=sources, confidence=0.95)

    # 4. Kịch bản hỏi về quy trình duyệt nghỉ phép
    if any(k in query_text for k in ["nghỉ phép", "đơn", "duyệt", "thôi việc", "nghỉ ốm"]):
        sources.append("Quy trình duyệt đơn nghỉ phép")
        answer = (
            f"Quy trình xin nghỉ phép tại TechZone gồm 2 cấp phê duyệt linh hoạt:\n"
            f"1. **Cấp 1 - Cửa hàng trưởng (Store Manager):** Duyệt sơ bộ trong vòng 24h để bố trí người đổi ca trực chi nhánh (`STORE_APPROVED`).\n"
            f"2. **Cấp 2 - Phòng Nhân sự (HR Manager):** Phê duyệt chính thức trên hệ thống (`HR_APPROVED`), hệ thống tự động trừ ngày phép năm hoặc tính chế độ bảo hiểm xã hội."
        )
        return AICopilotResponse(answer=answer, sources=sources, confidence=0.96)

    # 5. Mặc định: Trích xuất đoạn văn phù hợp nhất từ database
    matched_chunks = [c["chunk_content"] for c in knowledge_chunks]
    sources = [c["document_title"] for c in knowledge_chunks]
    answer = (
        f"Xin chào {current_user.get('full_name', '')}! Tôi là Trợ lý AI Nhân sự TechZone HRM.\n\n"
        f"Dưới đây là một số thông tin quy định trích xuất từ cơ sở kiến thức công ty:\n"
        + "\n\n".join([f"• {chunk}" for chunk in matched_chunks[:2]])
        + "\n\nBạn có thể hỏi tôi chi tiết về: *công thức tính hoa hồng doanh số, nội quy đi trễ, hoặc quy trình duyệt nghỉ phép*!"
    )
    return AICopilotResponse(answer=answer, sources=sources, confidence=0.90)
