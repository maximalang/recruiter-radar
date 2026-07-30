BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM workspace_invites)
     OR EXISTS (
       SELECT 1
       FROM workspace_members AS membership
       JOIN workspaces AS workspace
         ON workspace.id = membership.workspace_id
       WHERE workspace.bootstrap_user_id IS NULL
          OR membership.user_id <> workspace.bootstrap_user_id
          OR membership.role <> 'owner'
          OR membership.status <> 'active'
     ) THEN
    RAISE EXCEPTION
      'workspace tenant-context rollback refused: collaborative state exists';
  END IF;
END;
$$;

DROP TRIGGER opportunities_assign_workspace ON opportunities;
DROP TRIGGER notification_provider_accounts_assign_workspace
  ON notification_provider_accounts;
DROP TRIGGER user_search_preferences_assign_workspace
  ON user_search_preferences;
DROP TRIGGER deliveries_assign_workspace ON deliveries;
DROP TRIGGER leads_assign_workspace ON leads;
DROP TRIGGER pilot_enrollments_assign_workspace ON pilot_enrollments;
DROP TRIGGER checkout_orders_assign_workspace ON checkout_orders;
DROP TRIGGER subscriptions_assign_workspace ON subscriptions;
DROP TRIGGER client_profiles_assign_workspace ON client_profiles;

DROP FUNCTION backfill_auth_workspace_user(BIGINT);
DROP FUNCTION auth_workspace_assign_delivery_tenant();
DROP FUNCTION auth_workspace_assign_profile_tenant();
DROP FUNCTION auth_workspace_assign_profile_owner_tenant();
DROP FUNCTION auth_workspace_assign_user_tenant();
DROP FUNCTION auth_workspace_resolve_lead(BIGINT, BIGINT, BIGINT);
DROP FUNCTION auth_workspace_resolve_profile(BIGINT, BIGINT, BIGINT);
DROP FUNCTION auth_workspace_resolve_user(BIGINT, BIGINT);

ALTER TABLE notification_delivery_jobs
  DROP CONSTRAINT notification_jobs_route_context_fkey,
  DROP CONSTRAINT notification_jobs_endpoint_context_fkey,
  DROP CONSTRAINT notification_jobs_provider_profile_fkey;
ALTER TABLE notification_routes
  DROP CONSTRAINT notification_routes_endpoint_profile_fkey;
ALTER TABLE notification_endpoints
  DROP CONSTRAINT notification_endpoints_provider_profile_fkey;

ALTER TABLE opportunities
  DROP CONSTRAINT opportunities_profile_workspace_fkey,
  DROP CONSTRAINT opportunities_workspace_member_fkey;
ALTER TABLE notification_provider_accounts
  DROP CONSTRAINT notification_provider_accounts_profile_workspace_fkey,
  DROP CONSTRAINT notification_provider_accounts_workspace_member_fkey;
ALTER TABLE user_search_preferences
  DROP CONSTRAINT user_search_preferences_workspace_member_fkey;
ALTER TABLE deliveries
  DROP CONSTRAINT deliveries_lead_workspace_fkey,
  DROP CONSTRAINT deliveries_workspace_member_fkey;
ALTER TABLE leads
  DROP CONSTRAINT leads_workspace_member_fkey;
ALTER TABLE pilot_enrollments
  DROP CONSTRAINT pilot_enrollments_workspace_member_fkey;
ALTER TABLE checkout_orders
  DROP CONSTRAINT checkout_orders_workspace_member_fkey;
ALTER TABLE subscriptions
  DROP CONSTRAINT subscriptions_workspace_member_fkey;
ALTER TABLE client_profiles
  DROP CONSTRAINT client_profiles_workspace_member_fkey;

DROP INDEX opportunities_id_owner_workspace_uidx;
DROP INDEX notification_routes_context_uidx;
DROP INDEX notification_endpoints_profile_uidx;
DROP INDEX notification_endpoints_context_uidx;
DROP INDEX notification_provider_accounts_profile_uidx;
DROP INDEX notification_provider_accounts_context_uidx;
DROP INDEX leads_id_user_workspace_uidx;
DROP INDEX client_profiles_id_owner_workspace_uidx;

ALTER TABLE opportunities
  DROP COLUMN workspace_id;
ALTER TABLE notification_provider_accounts
  DROP COLUMN workspace_id;
ALTER TABLE user_search_preferences
  DROP COLUMN workspace_id;
ALTER TABLE deliveries
  DROP COLUMN workspace_id;
ALTER TABLE leads
  DROP COLUMN workspace_id;
ALTER TABLE pilot_enrollments
  DROP COLUMN workspace_id;
ALTER TABLE checkout_orders
  DROP COLUMN workspace_id;
ALTER TABLE subscriptions
  DROP COLUMN workspace_id;
ALTER TABLE client_profiles
  DROP COLUMN workspace_id;

COMMIT;
