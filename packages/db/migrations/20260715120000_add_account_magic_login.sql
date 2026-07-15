BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS account_login_challenges (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  request_key_hash CHAR(64) NOT NULL,
  return_to TEXT NOT NULL DEFAULT '/dashboard',
  send_status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT account_login_challenges_token_hash_format CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT account_login_challenges_request_key_hash_format CHECK (request_key_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT account_login_challenges_return_to_local CHECK (return_to ~ '^/[^/]'),
  CONSTRAINT account_login_challenges_send_status CHECK (send_status IN ('pending', 'sent', 'failed')),
  CONSTRAINT account_login_challenges_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS account_login_challenges_user_created_idx
  ON account_login_challenges (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS account_login_challenges_request_created_idx
  ON account_login_challenges (request_key_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS account_login_challenges_expires_idx
  ON account_login_challenges (expires_at);
CREATE INDEX IF NOT EXISTS account_login_challenges_created_idx
  ON account_login_challenges (created_at DESC);

COMMIT;
