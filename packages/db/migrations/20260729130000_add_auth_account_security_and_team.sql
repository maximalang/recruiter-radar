BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

ALTER TABLE auth_sessions
  ADD COLUMN browser_label TEXT,
  ADD COLUMN environment_label TEXT;

ALTER TABLE auth_sessions
  ADD CONSTRAINT auth_sessions_browser_label_check
    CHECK (
      browser_label IS NULL
      OR (
        BTRIM(browser_label) = browser_label
        AND browser_label <> ''
        AND OCTET_LENGTH(browser_label) <= 80
        AND browser_label !~ '[[:cntrl:]]'
      )
    ),
  ADD CONSTRAINT auth_sessions_environment_label_check
    CHECK (
      environment_label IS NULL
      OR (
        BTRIM(environment_label) = environment_label
        AND environment_label <> ''
        AND OCTET_LENGTH(environment_label) <= 120
        AND environment_label !~ '[[:cntrl:]]'
      )
    );

ALTER TABLE workspace_invites
  ADD COLUMN send_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN last_sent_at TIMESTAMPTZ;

ALTER TABLE workspace_invites
  ADD CONSTRAINT workspace_invites_send_status_check
    CHECK (send_status IN ('pending', 'sent', 'failed')),
  ADD CONSTRAINT workspace_invites_last_sent_check
    CHECK (
      last_sent_at IS NULL
      OR (
        last_sent_at >= created_at
        AND last_sent_at <= expires_at
      )
    );

CREATE TABLE account_deletion_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL
    REFERENCES users(id) ON DELETE RESTRICT,
  requested_by_session_id BIGINT,
  status TEXT NOT NULL DEFAULT 'pending',
  retention_policy_key TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  purge_after TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CONSTRAINT account_deletion_requests_status_check
    CHECK (status IN ('pending', 'cancelled', 'completed')),
  CONSTRAINT account_deletion_requests_policy_check
    CHECK (
      BTRIM(retention_policy_key) = retention_policy_key
      AND retention_policy_key ~ '^[a-z][a-z0-9_-]{0,63}$'
    ),
  CONSTRAINT account_deletion_requests_timestamps_check
    CHECK (
      (purge_after IS NULL OR purge_after >= requested_at)
      AND (cancelled_at IS NULL OR cancelled_at >= requested_at)
      AND (completed_at IS NULL OR completed_at >= requested_at)
    ),
  CONSTRAINT account_deletion_requests_terminal_state_check
    CHECK (
      (status = 'pending' AND cancelled_at IS NULL AND completed_at IS NULL)
      OR (status = 'cancelled' AND cancelled_at IS NOT NULL AND completed_at IS NULL)
      OR (status = 'completed' AND completed_at IS NOT NULL AND cancelled_at IS NULL)
    )
);

CREATE UNIQUE INDEX account_deletion_requests_user_pending_uidx
  ON account_deletion_requests (user_id)
  WHERE status = 'pending';
CREATE INDEX account_deletion_requests_purge_idx
  ON account_deletion_requests (purge_after, id)
  WHERE status = 'pending' AND purge_after IS NOT NULL;

ALTER TABLE auth_security_events
  ADD COLUMN target_user_id BIGINT;

ALTER TABLE auth_security_events
  DROP CONSTRAINT auth_security_events_type_check;

ALTER TABLE auth_security_events
  ADD CONSTRAINT auth_security_events_type_check
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
        'legacy_session_revoked',
        'workspace_created',
        'workspace_switched',
        'invite_created',
        'invite_accepted',
        'invite_revoked',
        'membership_role_changed',
        'membership_removed',
        'ownership_transferred',
        'email_change_requested',
        'email_changed',
        'passkey_added',
        'passkey_removed',
        'account_deletion_requested',
        'onboarding_completed'
      )
    );

CREATE INDEX auth_security_events_target_user_created_idx
  ON auth_security_events (target_user_id, created_at DESC)
  WHERE target_user_id IS NOT NULL;

CREATE FUNCTION invalidate_email_change_on_session_revoke()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
    UPDATE auth_challenges AS challenge
    SET invalidated_at = GREATEST(challenge.created_at, NEW.revoked_at)
    WHERE challenge.user_id = NEW.user_id
      AND challenge.purpose = 'change_email'
      AND challenge.consumed_at IS NULL
      AND challenge.invalidated_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER auth_sessions_invalidate_email_change_after_revoke
AFTER UPDATE OF revoked_at ON auth_sessions
FOR EACH ROW
EXECUTE FUNCTION invalidate_email_change_on_session_revoke();

COMMIT;
