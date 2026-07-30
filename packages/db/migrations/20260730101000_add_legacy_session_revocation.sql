SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

ALTER TABLE auth_security_events
  DROP CONSTRAINT auth_security_events_type_check,
  DROP CONSTRAINT auth_security_events_legacy_subject_check;

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
    ),
  ADD CONSTRAINT auth_security_events_legacy_subject_check
    CHECK (
      event_type NOT IN (
        'legacy_session_migrated',
        'legacy_session_revoked'
      )
      OR subject_hash IS NOT NULL
    );

CREATE UNIQUE INDEX IF NOT EXISTS
  auth_security_events_legacy_revocation_uidx
  ON auth_security_events (subject_hash)
  WHERE event_type = 'legacy_session_revoked'
    AND subject_hash IS NOT NULL;
