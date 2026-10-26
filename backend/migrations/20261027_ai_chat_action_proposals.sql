-- backend/migrations/20261027_ai_chat_action_proposals.sql
-- Migration: Bảng quản lý đề xuất hành động Human-in-the-Loop (HITL) cho AI Chatbot TechZone
-- Đảm bảo an toàn giao dịch: Cưỡng chế xác nhận ở server, chống IDOR, chống double-submit (idempotent), kiểm soát hết hạn.

CREATE TABLE IF NOT EXISTS ai_chat_action_proposals (
    proposal_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    thread_id VARCHAR(100) NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED')),
    execution_result JSONB,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_action_proposals_user_status ON ai_chat_action_proposals(user_id, status);
CREATE INDEX IF NOT EXISTS idx_action_proposals_thread ON ai_chat_action_proposals(thread_id);
