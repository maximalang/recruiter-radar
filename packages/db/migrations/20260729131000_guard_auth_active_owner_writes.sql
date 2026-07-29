BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

CREATE FUNCTION auth_lock_owner_writes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM PG_ADVISORY_XACT_LOCK_SHARED(
    HASHTEXTEXTENDED('auth-owner-scoped-writes', 0::BIGINT)
  );
  RETURN NULL;
END;
$$;

CREATE FUNCTION auth_require_active_owner_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  resolved_owner_id BIGINT;
  resolved_workspace_id BIGINT;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'client_profiles' THEN
      resolved_owner_id := NEW.owner_id;
      resolved_workspace_id := NEW.workspace_id;
    WHEN 'notification_provider_accounts' THEN
      resolved_owner_id := NEW.owner_id;
      resolved_workspace_id := NEW.workspace_id;
    WHEN 'notification_inbound_events' THEN
      SELECT provider.owner_id, provider.workspace_id
      INTO resolved_owner_id, resolved_workspace_id
      FROM notification_provider_accounts AS provider
      WHERE provider.id = NEW.provider_account_id;
    WHEN 'notification_delivery_attempts' THEN
      SELECT profile.owner_id, profile.workspace_id
      INTO resolved_owner_id, resolved_workspace_id
      FROM notification_delivery_jobs AS job
      JOIN client_profiles AS profile
        ON profile.id = job.client_profile_id
      WHERE job.id = NEW.job_id;
    ELSE
      SELECT profile.owner_id, profile.workspace_id
      INTO resolved_owner_id, resolved_workspace_id
      FROM client_profiles AS profile
      WHERE profile.id = NEW.client_profile_id;
  END CASE;

  IF resolved_owner_id IS NULL THEN
    RAISE EXCEPTION 'active owner context is required'
      USING ERRCODE = '23503';
  END IF;

  IF resolved_workspace_id IS NULL THEN
    resolved_workspace_id := auth_workspace_resolve_user(
      resolved_owner_id,
      NULL
    );
  END IF;

  PERFORM account.id
  FROM users AS account
  WHERE account.id = resolved_owner_id
    AND account.status = 'active'
    AND account.deleted_at IS NULL
  FOR KEY SHARE OF account;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active account is required for owner-scoped writes'
      USING ERRCODE = '42501';
  END IF;

  PERFORM membership.user_id
  FROM workspace_members AS membership
  JOIN workspaces AS workspace
    ON workspace.id = membership.workspace_id
  WHERE membership.workspace_id = resolved_workspace_id
    AND membership.user_id = resolved_owner_id
    AND membership.status = 'active'
    AND workspace.status = 'active'
    AND workspace.deleted_at IS NULL
  FOR KEY SHARE OF membership, workspace;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active workspace owner context is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER client_profiles_lock_owner_writes
BEFORE INSERT OR UPDATE ON client_profiles
FOR EACH STATEMENT
EXECUTE FUNCTION auth_lock_owner_writes();

CREATE TRIGGER client_profiles_require_active_owner
BEFORE INSERT OR UPDATE ON client_profiles
FOR EACH ROW
EXECUTE FUNCTION auth_require_active_owner_write();

CREATE TRIGGER web_push_subscriptions_lock_owner_writes
BEFORE INSERT OR UPDATE ON web_push_subscriptions
FOR EACH STATEMENT
EXECUTE FUNCTION auth_lock_owner_writes();

CREATE TRIGGER web_push_subscriptions_require_active_owner
BEFORE INSERT OR UPDATE ON web_push_subscriptions
FOR EACH ROW
EXECUTE FUNCTION auth_require_active_owner_write();

CREATE TRIGGER lead_channel_deliveries_lock_owner_writes
BEFORE INSERT OR UPDATE ON lead_channel_deliveries
FOR EACH STATEMENT
EXECUTE FUNCTION auth_lock_owner_writes();

CREATE TRIGGER lead_channel_deliveries_require_active_owner
BEFORE INSERT OR UPDATE ON lead_channel_deliveries
FOR EACH ROW
EXECUTE FUNCTION auth_require_active_owner_write();

CREATE TRIGGER notification_provider_accounts_lock_owner_writes
BEFORE INSERT OR UPDATE ON notification_provider_accounts
FOR EACH STATEMENT
EXECUTE FUNCTION auth_lock_owner_writes();

CREATE TRIGGER notification_provider_accounts_require_active_owner
BEFORE INSERT OR UPDATE ON notification_provider_accounts
FOR EACH ROW
EXECUTE FUNCTION auth_require_active_owner_write();

CREATE TRIGGER notification_endpoints_lock_owner_writes
BEFORE INSERT OR UPDATE ON notification_endpoints
FOR EACH STATEMENT
EXECUTE FUNCTION auth_lock_owner_writes();

CREATE TRIGGER notification_endpoints_require_active_owner
BEFORE INSERT OR UPDATE ON notification_endpoints
FOR EACH ROW
EXECUTE FUNCTION auth_require_active_owner_write();

CREATE TRIGGER notification_routes_lock_owner_writes
BEFORE INSERT OR UPDATE ON notification_routes
FOR EACH STATEMENT
EXECUTE FUNCTION auth_lock_owner_writes();

CREATE TRIGGER notification_routes_require_active_owner
BEFORE INSERT OR UPDATE ON notification_routes
FOR EACH ROW
EXECUTE FUNCTION auth_require_active_owner_write();

CREATE TRIGGER notification_delivery_jobs_lock_owner_writes
BEFORE INSERT OR UPDATE ON notification_delivery_jobs
FOR EACH STATEMENT
EXECUTE FUNCTION auth_lock_owner_writes();

CREATE TRIGGER notification_delivery_jobs_require_active_owner
BEFORE INSERT OR UPDATE ON notification_delivery_jobs
FOR EACH ROW
EXECUTE FUNCTION auth_require_active_owner_write();

CREATE TRIGGER notification_delivery_attempts_lock_owner_writes
BEFORE INSERT OR UPDATE ON notification_delivery_attempts
FOR EACH STATEMENT
EXECUTE FUNCTION auth_lock_owner_writes();

CREATE TRIGGER notification_delivery_attempts_require_active_owner
BEFORE INSERT OR UPDATE ON notification_delivery_attempts
FOR EACH ROW
EXECUTE FUNCTION auth_require_active_owner_write();

CREATE TRIGGER notification_inbound_events_lock_owner_writes
BEFORE INSERT OR UPDATE ON notification_inbound_events
FOR EACH STATEMENT
EXECUTE FUNCTION auth_lock_owner_writes();

CREATE TRIGGER notification_inbound_events_require_active_owner
BEFORE INSERT OR UPDATE ON notification_inbound_events
FOR EACH ROW
EXECUTE FUNCTION auth_require_active_owner_write();

COMMIT;
