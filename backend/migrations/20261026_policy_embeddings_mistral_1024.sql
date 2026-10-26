-- Migration: Cập nhật policy_embeddings sang 1024 chiều cho mô hình mistral-embed-2312
-- Ngày: 26/10/2026

-- 1. Kích hoạt pgvector nếu chưa có
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Xóa index cũ nếu có
DROP INDEX IF EXISTS idx_policy_embeddings_vector;

-- 3. Cập nhật kiểu cột embedding thành vector(1024)
ALTER TABLE policy_embeddings 
    ALTER COLUMN embedding TYPE vector(1024);

-- 4. Tạo chỉ mục HNSW tối ưu tìm kiếm Cosine Similarity cho 1024 chiều
CREATE INDEX IF NOT EXISTS idx_policy_embeddings_vector 
    ON policy_embeddings USING hnsw (embedding vector_cosine_ops);

-- 5. Hàm truy vấn ngữ nghĩa tích hợp phân quyền vai trò (Role-based RAG)
CREATE OR REPLACE FUNCTION match_policy_documents_mistral(
    query_embedding vector(1024),
    match_threshold float DEFAULT 0.3,
    match_count int DEFAULT 5,
    user_role varchar DEFAULT 'EMPLOYEE'
)
RETURNS TABLE (
    id bigint,
    document_title varchar,
    category varchar,
    chunk_content text,
    metadata jsonb,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        pe.id,
        pe.document_title,
        pe.category,
        pe.chunk_content,
        pe.metadata,
        (1 - (pe.embedding <=> query_embedding))::float AS similarity
    FROM policy_embeddings pe
    WHERE 
        pe.embedding IS NOT NULL
        AND (
            pe.metadata->'target_roles' IS NULL 
            OR pe.metadata->'target_roles' ? user_role 
            OR pe.metadata->'target_roles' ? 'ALL'
        )
        AND (1 - (pe.embedding <=> query_embedding)) > match_threshold
    ORDER BY pe.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
