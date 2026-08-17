-- Timeweb MCP local sessions are independent connection identities.
-- subject is ownership metadata, never a singleton key.

CREATE TABLE IF NOT EXISTS timeweb_mcp_sessions (
  session_id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  upstream_session_id TEXT,
  protocol_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  recovery_count INTEGER NOT NULL DEFAULT 0
);

DO $$
DECLARE
  sessions_rel OID;
  subject_attnum SMALLINT;
  session_attnum SMALLINT;
  item RECORD;
BEGIN
  SELECT c.oid
  INTO sessions_rel
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = current_schema()
    AND c.relname = 'timeweb_mcp_sessions'
    AND c.relkind IN ('r', 'p');

  SELECT attnum
  INTO subject_attnum
  FROM pg_attribute
  WHERE attrelid = sessions_rel
    AND attname = 'subject'
    AND NOT attisdropped;

  SELECT attnum
  INTO session_attnum
  FROM pg_attribute
  WHERE attrelid = sessions_rel
    AND attname = 'session_id'
    AND NOT attisdropped;

  -- Legacy schema used subject as PRIMARY KEY. Remove any one-column
  -- primary/unique constraint on subject without relying on generated names.
  FOR item IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = sessions_rel
      AND contype IN ('p', 'u')
      AND conkey = ARRAY[subject_attnum]::SMALLINT[]
  LOOP
    EXECUTE format('ALTER TABLE timeweb_mcp_sessions DROP CONSTRAINT %I', item.conname);
  END LOOP;

  -- Defensive cleanup if an unexpected primary key still exists on another key.
  FOR item IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = sessions_rel
      AND contype = 'p'
      AND conkey <> ARRAY[session_attnum]::SMALLINT[]
  LOOP
    EXECUTE format('ALTER TABLE timeweb_mcp_sessions DROP CONSTRAINT %I', item.conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = sessions_rel
      AND contype = 'p'
      AND conkey = ARRAY[session_attnum]::SMALLINT[]
  ) THEN
    ALTER TABLE timeweb_mcp_sessions ADD PRIMARY KEY (session_id);
  END IF;

  -- Legacy schema declared session_id UNIQUE. The PK now provides that invariant,
  -- so remove the redundant standalone unique constraint if it remains.
  FOR item IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = sessions_rel
      AND contype = 'u'
      AND conkey = ARRAY[session_attnum]::SMALLINT[]
  LOOP
    EXECUTE format('ALTER TABLE timeweb_mcp_sessions DROP CONSTRAINT %I', item.conname);
  END LOOP;
END
$$;

CREATE INDEX IF NOT EXISTS idx_timeweb_mcp_sessions_subject
  ON timeweb_mcp_sessions(subject);

CREATE INDEX IF NOT EXISTS idx_timeweb_mcp_sessions_expires_at
  ON timeweb_mcp_sessions(expires_at);
