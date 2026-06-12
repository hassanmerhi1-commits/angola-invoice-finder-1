-- Phase 10 — user session log (login / logout / activity tracking)

CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    token_jti VARCHAR(64) NOT NULL,
    ip_address VARCHAR(64),
    workstation_id VARCHAR(128),
    user_agent TEXT,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP,
    end_reason VARCHAR(32)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_sessions_jti ON user_sessions(token_jti);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(ended_at) WHERE ended_at IS NULL;
