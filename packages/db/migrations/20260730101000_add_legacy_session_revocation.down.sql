BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM auth_security_events
    WHERE event_type = 'legacy_session_revoked'
  ) THEN
    RAISE EXCEPTION
      'legacy session revocation rollback refused: logout tombstones exist';
  END IF;
END;
$$;

DROP INDEX IF EXISTS auth_security_events_legacy_revocation_uidx;

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
      event_type <> 'legacy_session_migrated'
      OR subject_hash IS NOT NULL
    );

COMMIT;
