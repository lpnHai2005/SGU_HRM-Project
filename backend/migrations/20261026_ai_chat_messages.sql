-- Migration: Tạo bảng lưu trữ lịch sử trò chuyện chính thức của AI Chatbot
CREATE TABLE IF NOT EXISTS ai_chat_messages (
    message_id BIGSERIAL PRIMARY KEY,
    thread_id VARCHAR(100) NOT NULL,
    user_id INT REFERENCES users(user_id) ON DELETE SET NULL,
    employee_id INT REFERENCES employees(employee_id) ON DELETE SET NULL,
    sender VARCHAR(20) NOT NULL CHECK (sender IN ('user', 'assistant')),
    content TEXT NOT NULL,
    sources JSONB DEFAULT '[]'::jsonb,
    tools_used JSONB DEFAULT '[]'::jsonb,
    action_proposal JSONB DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_thread ON ai_chat_messages(thread_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_user ON ai_chat_messages(user_id, created_at DESC);
