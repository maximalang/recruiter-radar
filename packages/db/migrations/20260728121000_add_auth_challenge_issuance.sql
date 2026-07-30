SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

CREATE FUNCTION issue_auth_login_challenge(
  input_email_normalized TEXT,
  input_token_hash TEXT,
  input_return_to TEXT,
  input_global_key_hash TEXT,
  input_email_key_hash TEXT,
  input_request_ip_hash TEXT,
  input_user_agent_hash TEXT,
  input_now TIMESTAMPTZ DEFAULT clock_timestamp()
)
RETURNS TABLE (
  issued BOOLEAN,
  challenge_id BIGINT
)
LANGUAGE plpgsql
AS $$
DECLARE
  resolved_user_id BIGINT;
  resolved_purpose TEXT;
  global_allowed BOOLEAN;
  email_allowed BOOLEAN;
  ip_allowed BOOLEAN := TRUE;
  inserted_challenge_id BIGINT;
  action_now TIMESTAMPTZ;
BEGIN
  IF input_email_normalized IS NULL
     OR input_token_hash !~ '^[a-f0-9]{64}$'
     OR input_global_key_hash !~ '^[a-f0-9]{64}$'
     OR input_email_key_hash !~ '^[a-f0-9]{64}$'
     OR (
       input_request_ip_hash IS NOT NULL
       AND input_request_ip_hash !~ '^[a-f0-9]{64}$'
     )
     OR (
       input_user_agent_hash IS NOT NULL
       AND input_user_agent_hash !~ '^[a-f0-9]{64}$'
     ) THEN
    RAISE EXCEPTION 'invalid auth challenge input';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'auth-challenge:' || input_email_normalized,
      0
    )
  );

  SELECT GREATEST(
    input_now,
    COALESCE(MAX(created_at), input_now)
  )
  INTO action_now
  FROM auth_challenges
  WHERE email_normalized = input_email_normalized
    AND purpose IN ('login', 'signup')
    AND consumed_at IS NULL
    AND invalidated_at IS NULL;

  SELECT consume_auth_rate_limit(
    'global',
    input_global_key_hash,
    60,
    100,
    action_now
  )
  INTO global_allowed;
  SELECT consume_auth_rate_limit(
    'email_hash',
    input_email_key_hash,
    900,
    3,
    action_now
  )
  INTO email_allowed;
  IF input_request_ip_hash IS NOT NULL THEN
    SELECT consume_auth_rate_limit(
      'trusted_ip_hash',
      input_request_ip_hash,
      900,
      10,
      action_now
    )
    INTO ip_allowed;
  END IF;

  IF NOT global_allowed OR NOT email_allowed OR NOT ip_allowed THEN
    RETURN QUERY SELECT FALSE, NULL::BIGINT;
    RETURN;
  END IF;

  SELECT id
  INTO resolved_user_id
  FROM users
  WHERE status <> 'deleted'
    AND (
      email_normalized = input_email_normalized
      OR (
        email_normalized IS NULL
        AND split_part(email, '@', 1)
          = split_part(input_email_normalized, '@', 1)
        AND LOWER(split_part(email, '@', 2))
          = split_part(input_email_normalized, '@', 2)
      )
    )
  ORDER BY (email_normalized IS NOT NULL) DESC, id
  LIMIT 1
  FOR UPDATE;

  IF resolved_user_id IS NULL THEN
    resolved_purpose := 'signup';
  ELSE
    resolved_purpose := 'login';
  END IF;

  UPDATE auth_challenges
  SET invalidated_at = action_now
  WHERE email_normalized = input_email_normalized
    AND purpose IN ('login', 'signup')
    AND consumed_at IS NULL
    AND invalidated_at IS NULL;

  INSERT INTO auth_challenges (
    purpose,
    email_normalized,
    user_id,
    token_hash,
    return_to,
    send_status,
    request_ip_hash,
    user_agent_hash,
    expires_at,
    created_at
  )
  VALUES (
    resolved_purpose,
    input_email_normalized,
    resolved_user_id,
    input_token_hash,
    input_return_to,
    'pending',
    input_request_ip_hash,
    input_user_agent_hash,
    action_now + INTERVAL '15 minutes',
    action_now
  )
  RETURNING id INTO inserted_challenge_id;

  INSERT INTO auth_security_events (
    event_type,
    user_id,
    subject_hash,
    request_ip_hash,
    user_agent_hash,
    metadata,
    created_at
  )
  VALUES (
    'login_requested',
    resolved_user_id,
    input_email_key_hash,
    input_request_ip_hash,
    input_user_agent_hash,
    JSONB_BUILD_OBJECT('challenge_purpose', resolved_purpose),
    action_now
  );

  RETURN QUERY SELECT TRUE, inserted_challenge_id;
END;
$$;
