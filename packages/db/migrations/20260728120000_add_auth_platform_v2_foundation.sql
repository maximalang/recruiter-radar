SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_normalized TEXT,
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS onboarding_status TEXT NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS onboarding_step TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_data JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS last_authenticated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE users
  ADD CONSTRAINT users_auth_v2_email_normalized_check
    CHECK (
      email_normalized IS NULL
      OR (
        BTRIM(email_normalized) = email_normalized
        AND OCTET_LENGTH(email_normalized) BETWEEN 3 AND 254
        AND email_normalized !~ '[[:cntrl:],;]'
        AND email_normalized ~ '^[^@[:space:]]+@[a-z0-9][a-z0-9.-]*[a-z0-9]$'
        AND split_part(email_normalized, '@', 2) = LOWER(split_part(email_normalized, '@', 2))
        AND split_part(email_normalized, '@', 2) LIKE '%.%'
        AND split_part(email_normalized, '@', 2) !~ '(\.\.|-\.|\.-)'
      )
    ),
  ADD CONSTRAINT users_auth_v2_verified_identity_check
    CHECK (email_normalized IS NULL OR email_verified_at IS NOT NULL),
  ADD CONSTRAINT users_auth_v2_status_check
    CHECK (status IN ('active', 'suspended', 'deletion_pending', 'deleted')),
  ADD CONSTRAINT users_auth_v2_onboarding_status_check
    CHECK (onboarding_status IN ('not_started', 'in_progress', 'completed')),
  ADD CONSTRAINT users_auth_v2_onboarding_data_object_check
    CHECK (JSONB_TYPEOF(onboarding_data) = 'object'),
  ADD CONSTRAINT users_auth_v2_deleted_state_check
    CHECK ((status = 'deleted') = (deleted_at IS NOT NULL));

CREATE UNIQUE INDEX users_email_normalized_active_uidx
  ON users (email_normalized)
  WHERE email_normalized IS NOT NULL
    AND status <> 'deleted';

CREATE TABLE auth_challenges (
  id BIGSERIAL PRIMARY KEY,
  purpose TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  workspace_id BIGINT,
  token_hash CHAR(64) NOT NULL UNIQUE,
  return_to TEXT NOT NULL DEFAULT '/dashboard',
  send_status TEXT NOT NULL DEFAULT 'pending',
  request_ip_hash CHAR(64),
  user_agent_hash CHAR(64),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT auth_challenges_purpose_check
    CHECK (
      purpose IN (
        'login',
        'signup',
        'change_email',
        'workspace_invite',
        'reauthentication',
        'account_deletion',
        'passkey_registration',
        'passkey_authentication'
      )
    ),
  CONSTRAINT auth_challenges_email_normalized_check
    CHECK (
      BTRIM(email_normalized) = email_normalized
      AND OCTET_LENGTH(email_normalized) BETWEEN 3 AND 254
      AND email_normalized !~ '[[:cntrl:],;]'
      AND email_normalized ~ '^[^@[:space:]]+@[a-z0-9][a-z0-9.-]*[a-z0-9]$'
      AND split_part(email_normalized, '@', 2) = LOWER(split_part(email_normalized, '@', 2))
      AND split_part(email_normalized, '@', 2) LIKE '%.%'
      AND split_part(email_normalized, '@', 2) !~ '(\.\.|-\.|\.-)'
    ),
  CONSTRAINT auth_challenges_token_hash_check
    CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT auth_challenges_request_ip_hash_check
    CHECK (
      request_ip_hash IS NULL
      OR request_ip_hash ~ '^[a-f0-9]{64}$'
    ),
  CONSTRAINT auth_challenges_user_agent_hash_check
    CHECK (
      user_agent_hash IS NULL
      OR user_agent_hash ~ '^[a-f0-9]{64}$'
    ),
  CONSTRAINT auth_challenges_return_to_check
    CHECK (return_to ~ '^/[^/]' AND return_to !~ '[[:cntrl:]\\]'),
  CONSTRAINT auth_challenges_send_status_check
    CHECK (send_status IN ('pending', 'sent', 'failed', 'suppressed')),
  CONSTRAINT auth_challenges_expiry_check
    CHECK (
      expires_at > created_at
      AND expires_at <= created_at + CASE
        WHEN purpose IN ('login', 'signup') THEN INTERVAL '15 minutes'
        ELSE INTERVAL '1 hour'
      END
    ),
  CONSTRAINT auth_challenges_terminal_state_check
    CHECK (
      (
        consumed_at IS NULL
        OR (
          consumed_at >= created_at
          AND consumed_at <= expires_at
        )
      )
      AND (invalidated_at IS NULL OR invalidated_at >= created_at)
      AND (consumed_at IS NULL OR invalidated_at IS NULL)
    )
);

CREATE UNIQUE INDEX auth_challenges_active_identity_uidx
  ON auth_challenges (purpose, email_normalized)
  WHERE consumed_at IS NULL
    AND invalidated_at IS NULL;
CREATE INDEX auth_challenges_user_created_idx
  ON auth_challenges (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX auth_challenges_expiry_idx
  ON auth_challenges (expires_at)
  WHERE consumed_at IS NULL
    AND invalidated_at IS NULL;
CREATE INDEX auth_challenges_request_ip_created_idx
  ON auth_challenges (request_ip_hash, created_at DESC)
  WHERE request_ip_hash IS NOT NULL;

CREATE TABLE auth_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id BIGINT,
  token_hash CHAR(64) NOT NULL UNIQUE,
  previous_token_hash CHAR(64),
  previous_token_valid_until TIMESTAMPTZ,
  request_ip_hash CHAR(64),
  user_agent_hash CHAR(64),
  legacy_fingerprint_hash CHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idle_expires_at TIMESTAMPTZ NOT NULL,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  rotated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_authenticated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT,
  CONSTRAINT auth_sessions_token_hash_check
    CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT auth_sessions_previous_token_hash_check
    CHECK (
      previous_token_hash IS NULL
      OR (
        previous_token_hash ~ '^[a-f0-9]{64}$'
        AND previous_token_hash <> token_hash
      )
    ),
  CONSTRAINT auth_sessions_previous_token_window_check
    CHECK (
      (previous_token_hash IS NULL) = (previous_token_valid_until IS NULL)
      AND (
        previous_token_valid_until IS NULL
        OR (
          previous_token_valid_until > rotated_at
          AND previous_token_valid_until <= absolute_expires_at
          AND previous_token_valid_until <= rotated_at + INTERVAL '60 seconds'
        )
      )
    ),
  CONSTRAINT auth_sessions_request_ip_hash_check
    CHECK (
      request_ip_hash IS NULL
      OR request_ip_hash ~ '^[a-f0-9]{64}$'
    ),
  CONSTRAINT auth_sessions_user_agent_hash_check
    CHECK (
      user_agent_hash IS NULL
      OR user_agent_hash ~ '^[a-f0-9]{64}$'
    ),
  CONSTRAINT auth_sessions_legacy_fingerprint_hash_check
    CHECK (
      legacy_fingerprint_hash IS NULL
      OR legacy_fingerprint_hash ~ '^[a-f0-9]{64}$'
    ),
  CONSTRAINT auth_sessions_lifetime_check
    CHECK (
      created_at <= last_seen_at
      AND last_seen_at < idle_expires_at
      AND idle_expires_at <= last_seen_at + INTERVAL '14 days'
      AND idle_expires_at <= absolute_expires_at
      AND absolute_expires_at <= created_at + INTERVAL '30 days'
      AND rotated_at >= created_at
      AND rotated_at <= absolute_expires_at
      AND (
        last_authenticated_at IS NULL
        OR (
          last_authenticated_at >= created_at
          AND last_authenticated_at <= absolute_expires_at
        )
      )
    ),
  CONSTRAINT auth_sessions_revocation_check
    CHECK (
      (revoked_at IS NULL AND revoke_reason IS NULL)
      OR (
        revoked_at IS NOT NULL
        AND revoked_at >= created_at
        AND revoke_reason IS NOT NULL
        AND BTRIM(revoke_reason) <> ''
      )
    )
);

CREATE UNIQUE INDEX auth_sessions_legacy_fingerprint_uidx
  ON auth_sessions (legacy_fingerprint_hash)
  WHERE legacy_fingerprint_hash IS NOT NULL;
CREATE UNIQUE INDEX auth_sessions_previous_token_hash_uidx
  ON auth_sessions (previous_token_hash)
  WHERE previous_token_hash IS NOT NULL;
CREATE INDEX auth_sessions_user_active_idx
  ON auth_sessions (user_id, last_seen_at DESC)
  WHERE revoked_at IS NULL;
CREATE INDEX auth_sessions_expiry_idx
  ON auth_sessions (LEAST(idle_expires_at, absolute_expires_at))
  WHERE revoked_at IS NULL;

CREATE FUNCTION auth_security_metadata_is_safe(input_metadata JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  metadata_key TEXT;
  metadata_value JSONB;
  text_value TEXT;
BEGIN
  IF JSONB_TYPEOF(input_metadata) <> 'object'
     OR OCTET_LENGTH(input_metadata::TEXT) > 1024 THEN
    RETURN FALSE;
  END IF;

  FOR metadata_key, metadata_value IN
    SELECT key, value FROM JSONB_EACH(input_metadata)
  LOOP
    text_value := metadata_value #>> '{}';
    CASE metadata_key
      WHEN 'auth_version' THEN
        IF JSONB_TYPEOF(metadata_value) <> 'string'
           OR text_value NOT IN ('legacy', 'v2') THEN
          RETURN FALSE;
        END IF;
      WHEN 'backed_up', 'canary' THEN
        IF JSONB_TYPEOF(metadata_value) <> 'boolean' THEN
          RETURN FALSE;
        END IF;
      WHEN 'challenge_purpose' THEN
        IF JSONB_TYPEOF(metadata_value) <> 'string'
           OR text_value NOT IN (
             'login',
             'signup',
             'change_email',
             'workspace_invite',
             'reauthentication',
             'account_deletion',
             'passkey_registration',
             'passkey_authentication'
           ) THEN
          RETURN FALSE;
        END IF;
      WHEN 'delivery_status' THEN
        IF JSONB_TYPEOF(metadata_value) <> 'string'
           OR text_value NOT IN ('pending', 'sent', 'failed', 'suppressed') THEN
          RETURN FALSE;
        END IF;
      WHEN 'device_type' THEN
        IF JSONB_TYPEOF(metadata_value) <> 'string'
           OR text_value NOT IN (
             'single_device',
             'multi_device',
             'platform',
             'cross_platform',
             'unknown'
           ) THEN
          RETURN FALSE;
        END IF;
      WHEN 'invite_role', 'new_role', 'previous_role', 'role' THEN
        IF JSONB_TYPEOF(metadata_value) <> 'string'
           OR text_value NOT IN (
             'owner',
             'admin',
             'recruiter',
             'viewer',
             'billing'
           ) THEN
          RETURN FALSE;
        END IF;
      WHEN 'method' THEN
        IF JSONB_TYPEOF(metadata_value) <> 'string'
           OR text_value NOT IN (
             'magic_link',
             'passkey',
             'legacy_exchange',
             'email'
           ) THEN
          RETURN FALSE;
        END IF;
      WHEN 'onboarding_step' THEN
        IF JSONB_TYPEOF(metadata_value) <> 'string'
           OR text_value NOT IN ('agency', 'profile', 'delivery', 'complete') THEN
          RETURN FALSE;
        END IF;
      WHEN 'reason_code' THEN
        IF JSONB_TYPEOF(metadata_value) <> 'string'
           OR text_value !~ '^[a-z][a-z0-9_]{0,63}$' THEN
          RETURN FALSE;
        END IF;
      WHEN 'revoke_scope' THEN
        IF JSONB_TYPEOF(metadata_value) <> 'string'
           OR text_value NOT IN ('current', 'all') THEN
          RETURN FALSE;
        END IF;
      WHEN 'session_age_bucket' THEN
        IF JSONB_TYPEOF(metadata_value) <> 'string'
           OR text_value NOT IN ('new', 'day', 'week', 'month') THEN
          RETURN FALSE;
        END IF;
      WHEN 'source' THEN
        IF JSONB_TYPEOF(metadata_value) <> 'string'
           OR text_value NOT IN (
             'web',
             'email',
             'passkey',
             'legacy',
             'system',
             'db_verifier'
           ) THEN
          RETURN FALSE;
        END IF;
      WHEN 'workspace_count' THEN
        IF JSONB_TYPEOF(metadata_value) <> 'number'
           OR text_value !~ '^[0-9]{1,5}$'
           OR text_value::INTEGER > 10000 THEN
          RETURN FALSE;
        END IF;
      ELSE
        RETURN FALSE;
    END CASE;
  END LOOP;

  RETURN TRUE;
END;
$$;

CREATE TABLE auth_security_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'success',
  user_id BIGINT,
  workspace_id BIGINT,
  session_id BIGINT,
  subject_hash CHAR(64),
  request_ip_hash CHAR(64),
  user_agent_hash CHAR(64),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT auth_security_events_type_check
    CHECK (
      event_type IN (
        'login_requested',
        'login_email_sent',
        'login_email_failed',
        'login_succeeded',
        'login_failed',
        'challenge_replayed',
        'session_created',
        'session_rotated',
        'session_revoked',
        'all_sessions_revoked',
        'legacy_session_migrated',
        'workspace_created',
        'workspace_switched',
        'invite_created',
        'invite_accepted',
        'invite_revoked',
        'email_change_requested',
        'email_changed',
        'passkey_added',
        'passkey_removed',
        'account_deletion_requested',
        'onboarding_completed'
      )
    ),
  CONSTRAINT auth_security_events_outcome_check
    CHECK (outcome IN ('success', 'denied', 'failure')),
  CONSTRAINT auth_security_events_subject_hash_check
    CHECK (
      subject_hash IS NULL
      OR subject_hash ~ '^[a-f0-9]{64}$'
    ),
  CONSTRAINT auth_security_events_legacy_subject_check
    CHECK (
      event_type <> 'legacy_session_migrated'
      OR subject_hash IS NOT NULL
    ),
  CONSTRAINT auth_security_events_request_ip_hash_check
    CHECK (
      request_ip_hash IS NULL
      OR request_ip_hash ~ '^[a-f0-9]{64}$'
    ),
  CONSTRAINT auth_security_events_user_agent_hash_check
    CHECK (
      user_agent_hash IS NULL
      OR user_agent_hash ~ '^[a-f0-9]{64}$'
    ),
  CONSTRAINT auth_security_events_metadata_safe_check
    CHECK (auth_security_metadata_is_safe(metadata))
);

CREATE INDEX auth_security_events_user_created_idx
  ON auth_security_events (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX auth_security_events_type_created_idx
  ON auth_security_events (event_type, created_at DESC);
CREATE UNIQUE INDEX auth_security_events_legacy_exchange_uidx
  ON auth_security_events (subject_hash)
  WHERE event_type = 'legacy_session_migrated'
    AND subject_hash IS NOT NULL;

CREATE FUNCTION reject_auth_security_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'auth_security_events is append-only';
END;
$$;

CREATE TRIGGER auth_security_events_append_only
BEFORE UPDATE OR DELETE ON auth_security_events
FOR EACH ROW
EXECUTE FUNCTION reject_auth_security_event_mutation();

CREATE TRIGGER auth_security_events_reject_truncate
BEFORE TRUNCATE ON auth_security_events
FOR EACH STATEMENT
EXECUTE FUNCTION reject_auth_security_event_mutation();

CREATE TABLE auth_rate_limit_buckets (
  id BIGSERIAL PRIMARY KEY,
  bucket_scope TEXT NOT NULL,
  key_hash CHAR(64) NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT auth_rate_limit_buckets_scope_check
    CHECK (
      bucket_scope IN (
        'global',
        'trusted_ip_hash',
        'email_hash',
        'resend',
        'challenge_verify',
        'passkey_verify',
        'workspace_invite'
      )
    ),
  CONSTRAINT auth_rate_limit_buckets_key_hash_check
    CHECK (key_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT auth_rate_limit_buckets_hit_count_check
    CHECK (hit_count > 0),
  CONSTRAINT auth_rate_limit_buckets_window_check
    CHECK (
      window_started_at <= updated_at
      AND created_at <= updated_at
      AND expires_at > window_started_at
    ),
  UNIQUE (bucket_scope, key_hash, window_started_at)
);

CREATE INDEX auth_rate_limit_buckets_expiry_idx
  ON auth_rate_limit_buckets (expires_at);

CREATE FUNCTION consume_auth_rate_limit(
  input_scope TEXT,
  input_key_hash TEXT,
  input_window_seconds INTEGER,
  input_limit INTEGER,
  input_now TIMESTAMPTZ DEFAULT clock_timestamp()
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  canonical_window TIMESTAMPTZ;
  resulting_count INTEGER;
BEGIN
  IF input_scope NOT IN (
       'global',
       'trusted_ip_hash',
       'email_hash',
       'resend',
       'challenge_verify',
       'passkey_verify',
       'workspace_invite'
     )
     OR input_key_hash !~ '^[a-f0-9]{64}$'
     OR input_window_seconds NOT BETWEEN 1 AND 86400
     OR input_limit NOT BETWEEN 1 AND 100000 THEN
    RAISE EXCEPTION 'invalid auth rate limit bucket';
  END IF;

  canonical_window := TO_TIMESTAMP(
    FLOOR(EXTRACT(EPOCH FROM input_now) / input_window_seconds)
      * input_window_seconds
  );

  INSERT INTO auth_rate_limit_buckets (
    bucket_scope,
    key_hash,
    window_started_at,
    hit_count,
    expires_at,
    created_at,
    updated_at
  )
  VALUES (
    input_scope,
    input_key_hash,
    canonical_window,
    1,
    canonical_window + MAKE_INTERVAL(secs => input_window_seconds),
    input_now,
    input_now
  )
  ON CONFLICT (bucket_scope, key_hash, window_started_at)
  DO UPDATE SET
    hit_count = auth_rate_limit_buckets.hit_count + 1,
    expires_at = GREATEST(
      auth_rate_limit_buckets.expires_at,
      EXCLUDED.expires_at
    ),
    updated_at = GREATEST(
      auth_rate_limit_buckets.updated_at,
      EXCLUDED.updated_at
    )
  RETURNING hit_count INTO resulting_count;

  RETURN resulting_count <= input_limit;
END;
$$;
