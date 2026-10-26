"""
Script trích xuất 8 tài liệu PDF TechZone HRM, phân chia chunks ngữ nghĩa
và nạp vào bảng policy_embeddings trên Supabase (PostgreSQL 1024-dim).
Hỗ trợ cả Mistral Embeddings thực tế lẫn Offline/Fallback mode.
"""

import os
import sys
import json
import asyncio
from datetime import datetime
from dotenv import load_dotenv

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
sys.path.insert(0, BACKEND_DIR)

load_dotenv(os.path.join(BACKEND_DIR, ".env"))

import pypdfium2 as pdfium
from langchain_text_splitters import RecursiveCharacterTextSplitter
from app.core.database import AsyncSessionLocal
from sqlalchemy import text

DOC_CONFIG = {
    "TZ-DOC-01": {"category": "NOI_QUY", "title": "Nội quy lao động & Kỷ luật chuỗi bán lẻ", "roles": ["ALL"]},
    "TZ-DOC-02": {"category": "TIEN_LUONG", "title": "Quy chế tiền lương & Phúc lợi 26 công chuẩn", "roles": ["ALL"]},
    "TZ-DOC-03": {"category": "DU_AN", "title": "Quy chế quản trị dự án & Phụ cấp dự án vào lương", "roles": ["ALL"]},
    "TZ-DOC-04": {"category": "NGHI_PHEP", "title": "Quy trình nghỉ phép, thai sản & thôi việc 2 cấp", "roles": ["ALL"]},
    "TZ-DOC-05": {"category": "CHAM_CONG", "title": "Quy chuẩn chấm công Geofence & Tăng ca OT", "roles": ["ALL"]},
    "TZ-DOC-06": {"category": "NHAN_SU", "title": "Quy chế hợp đồng lao động, bổ nhiệm & RBAC", "roles": ["ALL"]},
    "TZ-DOC-07": {"category": "HUONG_DAN", "title": "Sổ tay hướng dẫn sử dụng phần mềm TechZone HRM", "roles": ["ALL"]},
    "TZ-DOC-08": {"category": "FAQ", "title": "Sổ tay giải đáp tình huống thường gặp FAQ", "roles": ["ALL"]},
}


def get_mistral_embeddings():
    api_key = os.getenv("MISTRAL_API_KEY", "").strip()
    if not api_key:
        return None
    try:
        from langchain_mistralai import MistralAIEmbeddings
        model = os.getenv("MISTRAL_EMBED_MODEL", "mistral-embed-2312")
        return MistralAIEmbeddings(model=model, mistral_api_key=api_key)
    except Exception as e:
        print(f"Không thể khởi tạo MistralAIEmbeddings: {e}")
        return None


async def ingest_all_pdfs():
    pdf_dir = os.path.join(BACKEND_DIR, "data", "knowledge_base_pdfs")
    if not os.path.exists(pdf_dir):
        print(f"Lỗi: Không tìm thấy thư mục {pdf_dir}")
        return

    pdf_files = [f for f in os.listdir(pdf_dir) if f.endswith(".pdf")]
    pdf_files.sort()

    print("=" * 80)
    print(f"BẮT ĐẦU INGESTION {len(pdf_files)} TÀI LIỆU PDF VÀO SUPABASE (VECTOR 1024-DIM)")
    print("=" * 80)

    embeddings_client = get_mistral_embeddings()
    if embeddings_client:
        print("✓ Đã kết nối Mistral AI Embeddings (model: mistral-embed-2312)")
    else:
        print("⚠ Chưa có MISTRAL_API_KEY trong .env -> Sẽ nạp văn bản và metadata chunks (embedding tạm để None)")

    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=600,
        chunk_overlap=80,
        separators=["\n\n", "\n", "• ", ". ", " "]
    )

    all_chunks = []

    for fname in pdf_files:
        doc_code = fname[:9]
        cfg = DOC_CONFIG.get(doc_code, {"category": "GENERAL", "title": fname, "roles": ["ALL"]})
        pdf_path = os.path.join(pdf_dir, fname)

        pdf = pdfium.PdfDocument(pdf_path)
        for page_idx, page in enumerate(pdf):
            page_text = page.get_textpage().get_text_range()
            if not page_text or len(page_text.strip()) < 30:
                continue

            splits = text_splitter.split_text(page_text)
            for split_idx, split_content in enumerate(splits):
                chunk_meta = {
                    "doc_code": doc_code,
                    "filename": fname,
                    "page_number": page_idx + 1,
                    "total_pages": len(pdf),
                    "chunk_index": split_idx + 1,
                    "target_roles": cfg["roles"],
                    "ingested_at": datetime.now().isoformat()
                }
                all_chunks.append({
                    "document_title": cfg["title"],
                    "category": cfg["category"],
                    "chunk_content": split_content.strip(),
                    "metadata": chunk_meta
                })

    print(f"Tổng số chunks trích xuất được từ {len(pdf_files)} PDF: {len(all_chunks)} chunks.")

    # Tạo vector embedding nếu có key
    if embeddings_client:
        print("Đang tính toán vector embeddings qua Mistral API...")
        texts_to_embed = [c["chunk_content"] for c in all_chunks]
        try:
            vectors = embeddings_client.embed_documents(texts_to_embed)
            for i, vec in enumerate(vectors):
                all_chunks[i]["embedding"] = vec
            print("✓ Đã sinh xong vector embeddings 1024 chiều!")
        except Exception as e:
            print(f"Lỗi gọi API Mistral Embeddings: {e}")
            for c in all_chunks:
                c["embedding"] = None
    else:
        for c in all_chunks:
            c["embedding"] = None

    # Nạp vào database
    print("Đang ghi vào bảng policy_embeddings trong CSDL Supabase...")
    async with AsyncSessionLocal() as db:
        # Xóa các bản ghi cũ của các tài liệu này để nạp lại mới
        await db.execute(text("DELETE FROM policy_embeddings WHERE metadata->>'doc_code' LIKE 'TZ-DOC%'"))

        for c in all_chunks:
            vec_val = c.get("embedding")
            if vec_val:
                vec_str = "[" + ",".join(str(x) for x in vec_val) + "]"
                await db.execute(text("""
                    INSERT INTO policy_embeddings (document_title, category, chunk_content, metadata, embedding)
                    VALUES (:title, :cat, :content, CAST(:meta AS jsonb), CAST(:embed AS vector))
                """), {
                    "title": c["document_title"],
                    "cat": c["category"],
                    "content": c["chunk_content"],
                    "meta": json.dumps(c["metadata"], ensure_ascii=False),
                    "embed": vec_str
                })
            else:
                await db.execute(text("""
                    INSERT INTO policy_embeddings (document_title, category, chunk_content, metadata, embedding)
                    VALUES (:title, :cat, :content, CAST(:meta AS jsonb), NULL)
                """), {
                    "title": c["document_title"],
                    "cat": c["category"],
                    "content": c["chunk_content"],
                    "meta": json.dumps(c["metadata"], ensure_ascii=False)
                })

        await db.commit()

    print("=" * 80)
    print(f" ✓ ĐÃ NẠP THÀNH CÔNG {len(all_chunks)} CHUNKS TỪ 8 TÀI LIỆU PDF VÀO SUPABASE!")
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(ingest_all_pdfs())
