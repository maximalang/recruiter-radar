BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM auth_security_events
    WHERE target_user_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'cannot roll back auth account/team schema while team audit events exist';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM account_deletion_requests
  ) THEN
    RAISE EXCEPTION
      'cannot roll back auth account/team schema while account deletion requests exist';
  END IF;
END;
$$;

DROP TRIGGER auth_sessions_invalidate_email_change_after_revoke
  ON auth_sessions;
DROP FUNCTION invalidate_email_change_on_session_revoke();

DROP INDEX auth_security_events_target_user_created_idx;

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
    );

ALTER TABLE auth_security_events
  DROP COLUMN IF EXISTS target_user_id;

DROP INDEX account_deletion_requests_purge_idx;
DROP INDEX account_deletion_requests_user_pending_uidx;
DROP TABLE account_deletion_requests;

ALTER TABLE workspace_invites
  DROP CONSTRAINT workspace_invites_last_sent_check,
  DROP CONSTRAINT workspace_invites_send_status_check,
  DROP COLUMN IF EXISTS last_sent_at,
  DROP COLUMN IF EXISTS send_status;

ALTER TABLE auth_sessions
  DROP CONSTRAINT auth_sessions_environment_label_check,
  DROP CONSTRAINT auth_sessions_browser_label_check,
  DROP COLUMN IF EXISTS environment_label,
  DROP COLUMN IF EXISTS browser_label;

COMMIT;
