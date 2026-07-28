SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

ALTER TABLE auth_sessions
  ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'magic_link',
  ADD COLUMN device_label TEXT;

ALTER TABLE auth_sessions
  ADD CONSTRAINT auth_sessions_auth_method_check
    CHECK (auth_method IN ('magic_link', 'passkey', 'legacy_exchange')),
  ADD CONSTRAINT auth_sessions_device_label_check
    CHECK (
      device_label IS NULL
      OR (
        BTRIM(device_label) <> ''
        AND OCTET_LENGTH(device_label) <= 120
        AND device_label !~ '[[:cntrl:]]'
      )
    );

CREATE UNIQUE INDEX auth_security_events_challenge_replay_uidx
  ON auth_security_events (subject_hash)
  WHERE event_type = 'challenge_replayed'
    AND subject_hash IS NOT NULL;

CREATE FUNCTION consume_auth_login_challenge(
  input_challenge_token_hash TEXT,
  input_session_token_hash TEXT,
  input_global_verification_key_hash TEXT,
  input_verification_ip_key_hash TEXT,
  input_now TIMESTAMPTZ DEFAULT clock_timestamp()
)
RETURNS TABLE (
  consumed BOOLEAN,
  user_id BIGINT,
  session_id BIGINT,
  email TEXT,
  full_name TEXT,
  email_verified_at TIMESTAMPTZ,
  return_to TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  challenge_identity TEXT;
  locked_challenge RECORD;
  resolved_user RECORD;
  global_verification_allowed BOOLEAN;
  ip_verification_allowed BOOLEAN := TRUE;
  inserted_session_id BIGINT;
  replay_reason TEXT;
BEGIN
  IF input_challenge_token_hash !~ '^[a-f0-9]{64}$'
     OR input_session_token_hash !~ '^[a-f0-9]{64}$'
     OR input_global_verification_key_hash !~ '^[a-f0-9]{64}$'
     OR (
       input_verification_ip_key_hash IS NOT NULL
       AND input_verification_ip_key_hash !~ '^[a-f0-9]{64}$'
     ) THEN
    RAISE EXCEPTION 'invalid auth challenge consumption input';
  END IF;

  SELECT consume_auth_rate_limit(
    'global',
    input_global_verification_key_hash,
    900,
    1000,
    input_now
  )
  INTO global_verification_allowed;
  IF input_verification_ip_key_hash IS NOT NULL THEN
    SELECT consume_auth_rate_limit(
      'challenge_verify',
      input_verification_ip_key_hash,
      900,
      10,
      input_now
    )
    INTO ip_verification_allowed;
  END IF;
  IF NOT global_verification_allowed OR NOT ip_verification_allowed THEN
    RETURN QUERY
      SELECT FALSE, NULL::BIGINT, NULL::BIGINT, NULL::TEXT,
        NULL::TEXT, NULL::TIMESTAMPTZ, NULL::TEXT;
    RETURN;
  END IF;

  SELECT candidate.email_normalized
  INTO challenge_identity
  FROM auth_challenges AS candidate
  WHERE candidate.token_hash = input_challenge_token_hash
    AND candidate.purpose IN ('login', 'signup')
  LIMIT 1;

  IF challenge_identity IS NULL THEN
    RETURN QUERY
      SELECT FALSE, NULL::BIGINT, NULL::BIGINT, NULL::TEXT,
        NULL::TEXT, NULL::TIMESTAMPTZ, NULL::TEXT;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'auth-challenge:' || challenge_identity,
      0
    )
  );

  SELECT
    challenge.id,
    challenge.purpose,
    challenge.email_normalized,
    challenge.user_id,
    challenge.return_to,
    challenge.request_ip_hash,
    challenge.user_agent_hash,
    challenge.created_at,
    challenge.expires_at,
    challenge.consumed_at,
    challenge.invalidated_at
  INTO locked_challenge
  FROM auth_challenges AS challenge
  WHERE challenge.token_hash = input_challenge_token_hash
    AND challenge.purpose IN ('login', 'signup')
  LIMIT 1
  FOR UPDATE;

  IF locked_challenge.id IS NULL THEN
    RETURN QUERY
      SELECT FALSE, NULL::BIGINT, NULL::BIGINT, NULL::TEXT,
        NULL::TEXT, NULL::TIMESTAMPTZ, NULL::TEXT;
    RETURN;
  END IF;

  IF locked_challenge.consumed_at IS NOT NULL
     OR locked_challenge.invalidated_at IS NOT NULL
     OR locked_challenge.expires_at <= input_now THEN
    replay_reason := CASE
      WHEN locked_challenge.consumed_at IS NOT NULL THEN 'consumed'
      WHEN locked_challenge.invalidated_at IS NOT NULL THEN 'invalidated'
      ELSE 'expired'
    END;

    IF replay_reason = 'expired' THEN
      UPDATE auth_challenges AS challenge
      SET invalidated_at = input_now
      WHERE challenge.id = locked_challenge.id
        AND challenge.consumed_at IS NULL
        AND challenge.invalidated_at IS NULL;
    END IF;

    INSERT INTO auth_security_events (
      event_type,
      outcome,
      user_id,
      subject_hash,
      request_ip_hash,
      user_agent_hash,
      metadata,
      created_at
    )
    VALUES (
      'challenge_replayed',
      'denied',
      locked_challenge.user_id,
      input_challenge_token_hash,
      locked_challenge.request_ip_hash,
      locked_challenge.user_agent_hash,
      JSONB_BUILD_OBJECT('reason_code', replay_reason),
      input_now
    )
    ON CONFLICT (subject_hash)
      WHERE event_type = 'challenge_replayed'
        AND subject_hash IS NOT NULL
      DO NOTHING;

    RETURN QUERY
      SELECT FALSE, NULL::BIGINT, NULL::BIGINT, NULL::TEXT,
        NULL::TEXT, NULL::TIMESTAMPTZ, NULL::TEXT;
    RETURN;
  END IF;

  SELECT
    account.id,
    account.email,
    account.full_name,
    account.email_verified_at,
    account.status
  INTO resolved_user
  FROM users AS account
  WHERE (
      locked_challenge.user_id IS NOT NULL
      AND account.id = locked_challenge.user_id
      AND (
        account.email_normalized = locked_challenge.email_normalized
        OR (
          account.email_normalized IS NULL
          AND LOWER(account.email) = LOWER(locked_challenge.email_normalized)
        )
      )
    )
    OR (
      locked_challenge.user_id IS NULL
      AND (
        account.email_normalized = locked_challenge.email_normalized
        OR (
          account.email_normalized IS NULL
          AND LOWER(account.email) = LOWER(locked_challenge.email_normalized)
        )
      )
    )
  ORDER BY (account.email_normalized IS NOT NULL) DESC, account.id
  LIMIT 1
  FOR UPDATE;

  IF resolved_user.id IS NULL AND locked_challenge.user_id IS NOT NULL THEN
    UPDATE auth_challenges AS challenge
    SET invalidated_at = input_now
    WHERE challenge.id = locked_challenge.id;

    INSERT INTO auth_security_events (
      event_type,
      outcome,
      user_id,
      subject_hash,
      request_ip_hash,
      user_agent_hash,
      metadata,
      created_at
    )
    VALUES (
      'login_failed',
      'denied',
      locked_challenge.user_id,
      input_challenge_token_hash,
      locked_challenge.request_ip_hash,
      locked_challenge.user_agent_hash,
      JSONB_BUILD_OBJECT('reason_code', 'challenge_identity_changed'),
      input_now
    );

    RETURN QUERY
      SELECT FALSE, NULL::BIGINT, NULL::BIGINT, NULL::TEXT,
        NULL::TEXT, NULL::TIMESTAMPTZ, NULL::TEXT;
    RETURN;
  END IF;

  IF resolved_user.id IS NOT NULL AND resolved_user.status <> 'active' THEN
    UPDATE auth_challenges AS challenge
    SET invalidated_at = input_now
    WHERE challenge.id = locked_challenge.id;

    INSERT INTO auth_security_events (
      event_type,
      outcome,
      user_id,
      subject_hash,
      request_ip_hash,
      user_agent_hash,
      metadata,
      created_at
    )
    VALUES (
      'login_failed',
      'denied',
      resolved_user.id,
      input_challenge_token_hash,
      locked_challenge.request_ip_hash,
      locked_challenge.user_agent_hash,
      JSONB_BUILD_OBJECT('reason_code', 'account_unavailable'),
      input_now
    );

    RETURN QUERY
      SELECT FALSE, NULL::BIGINT, NULL::BIGINT, NULL::TEXT,
        NULL::TEXT, NULL::TIMESTAMPTZ, NULL::TEXT;
    RETURN;
  END IF;

  IF resolved_user.id IS NULL THEN
    INSERT INTO users (
      email,
      email_normalized,
      email_verified_at,
      last_authenticated_at,
      created_at,
      updated_at
    )
    VALUES (
      locked_challenge.email_normalized,
      locked_challenge.email_normalized,
      input_now,
      input_now,
      input_now,
      input_now
    )
    RETURNING
      users.id,
      users.email,
      users.full_name,
      users.email_verified_at,
      users.status
    INTO resolved_user;
  ELSE
    UPDATE users AS account
    SET
      email_normalized = COALESCE(
        account.email_normalized,
        locked_challenge.email_normalized
      ),
      email_verified_at = COALESCE(account.email_verified_at, input_now),
      last_authenticated_at = input_now,
      updated_at = input_now
    WHERE account.id = resolved_user.id
    RETURNING
      account.id,
      account.email,
      account.full_name,
      account.email_verified_at,
      account.status
    INTO resolved_user;
  END IF;

  INSERT INTO auth_sessions (
    user_id,
    workspace_id,
    token_hash,
    auth_method,
    request_ip_hash,
    user_agent_hash,
    created_at,
    last_seen_at,
    idle_expires_at,
    absolute_expires_at,
    rotated_at,
    last_authenticated_at
  )
  VALUES (
    resolved_user.id,
    NULL,
    input_session_token_hash,
    'magic_link',
    locked_challenge.request_ip_hash,
    locked_challenge.user_agent_hash,
    input_now,
    input_now,
    input_now + INTERVAL '14 days',
    input_now + INTERVAL '30 days',
    input_now,
    input_now
  )
  RETURNING auth_sessions.id INTO inserted_session_id;

  UPDATE auth_challenges AS challenge
  SET consumed_at = input_now
  WHERE challenge.id = locked_challenge.id;

  INSERT INTO auth_security_events (
    event_type,
    user_id,
    session_id,
    request_ip_hash,
    user_agent_hash,
    metadata,
    created_at
  )
  VALUES
    (
      'login_succeeded',
      resolved_user.id,
      inserted_session_id,
      locked_challenge.request_ip_hash,
      locked_challenge.user_agent_hash,
      JSONB_BUILD_OBJECT(
        'challenge_purpose',
        locked_challenge.purpose,
        'method',
        'magic_link'
      ),
      input_now
    ),
    (
      'session_created',
      resolved_user.id,
      inserted_session_id,
      locked_challenge.request_ip_hash,
      locked_challenge.user_agent_hash,
      JSONB_BUILD_OBJECT('method', 'magic_link'),
      input_now
    );

  RETURN QUERY
    SELECT
      TRUE,
      resolved_user.id,
      inserted_session_id,
      resolved_user.email,
      resolved_user.full_name,
      resolved_user.email_verified_at,
      locked_challenge.return_to;
END;
$$;
