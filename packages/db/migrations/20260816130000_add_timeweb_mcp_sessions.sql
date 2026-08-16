CREATE TABLE IF NOT EXISTS timeweb_mcp_sessions (
  session_id UUID PRIMARY KEY,
  subject TEXT NOT NULL UNIQUE,
  upstream_session_id TEXT,
  protocol_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  recovery_count INTEGER NOT NULL DEFAULT 0 CHECK (recovery_count >= 0),
  CONSTRAINT timeweb_mcp_sessions_subject_len CHECK (char_length(subject) BETWEEN 1 AND 256),
  CONSTRAINT timeweb_mcp_sessions_upstream_len CHECK (upstream_session_id IS NULL OR char_length(upstream_session_id) BETWEEN 1 AND 256),
  CONSTRAINT timeweb_mcp_sessions_protocol_len CHECK (char_length(protocol_version) BETWEEN 1 AND 64)
);

CREATE INDEX IF NOT EXISTS timeweb_mcp_sessions_expires_idx
  ON timeweb_mcp_sessions (expires_at);
