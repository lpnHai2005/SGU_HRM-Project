CREATE TABLE IF NOT EXISTS notification_reads (
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    notice_id VARCHAR(120) NOT NULL,
    read_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, notice_id)
);
