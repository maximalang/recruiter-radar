BEGIN;

CREATE FUNCTION change_auth_session_workspace(
  input_current_token_hash TEXT,
  input_next_token_hash TEXT,
  input_target_workspace_id BIGINT,
  input_now TIMESTAMPTZ DEFAULT clock_timestamp()
)
RETURNS SETOF auth_sessions
LANGUAGE plpgsql
AS $$
BEGIN
  IF input_current_token_hash !~ '^[a-f0-9]{64}$'
     OR input_next_token_hash !~ '^[a-f0-9]{64}$'
     OR input_current_token_hash = input_next_token_hash
     OR input_target_workspace_id IS NULL
     OR input_target_workspace_id <= 0
     OR input_now IS NULL THEN
    RAISE EXCEPTION 'invalid workspace session switch input'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH switched AS (
    UPDATE auth_sessions AS session
    SET
      workspace_id = input_target_workspace_id,
      token_hash = input_next_token_hash,
      previous_token_hash = NULL,
      previous_token_valid_until = NULL,
      last_seen_at = input_now,
      idle_expires_at = LEAST(
        input_now + INTERVAL '14 days',
        session.absolute_expires_at
      ),
      rotated_at = input_now
    FROM users AS account
    WHERE session.token_hash = input_current_token_hash
      AND session.user_id = account.id
      AND session.workspace_id IS NOT NULL
      AND session.workspace_id <> input_target_workspace_id
      AND session.revoked_at IS NULL
      AND session.idle_expires_at > input_now
      AND session.absolute_expires_at > input_now
      AND account.status = 'active'
      AND account.email_verified_at IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM workspace_members AS membership
        JOIN workspaces AS workspace
          ON workspace.id = membership.workspace_id
        WHERE membership.workspace_id = session.workspace_id
          AND membership.user_id = session.user_id
          AND membership.status = 'active'
          AND workspace.status = 'active'
          AND workspace.deleted_at IS NULL
      )
      AND EXISTS (
        SELECT 1
        FROM workspace_members AS membership
        JOIN workspaces AS workspace
          ON workspace.id = membership.workspace_id
        WHERE membership.workspace_id = input_target_workspace_id
          AND membership.user_id = session.user_id
          AND membership.status = 'active'
          AND workspace.status = 'active'
          AND workspace.deleted_at IS NULL
      )
    RETURNING session.*
  ),
  recorded AS (
    INSERT INTO auth_security_events (
      event_type,
      outcome,
      user_id,
      workspace_id,
      session_id,
      request_ip_hash,
      user_agent_hash,
      metadata,
      created_at
    )
    SELECT
      'workspace_switched',
      'success',
      switched.user_id,
      switched.workspace_id,
      switched.id,
      switched.request_ip_hash,
      switched.user_agent_hash,
      JSONB_BUILD_OBJECT('source', 'web'),
      input_now
    FROM switched
    RETURNING id
  )
  SELECT switched.*
  FROM switched
  WHERE (SELECT COUNT(*) FROM recorded) = 1;
END;
$$;

COMMENT ON FUNCTION change_auth_session_workspace(TEXT, TEXT, BIGINT, TIMESTAMPTZ)
IS 'Current-token-only CAS workspace switch with immediate rotation and audit.';

COMMIT;
