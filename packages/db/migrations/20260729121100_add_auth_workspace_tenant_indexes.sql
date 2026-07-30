-- migrate:concurrent-indexes
--
-- This phase must run outside a transaction. The migrator validates and
-- executes every statement separately, removes an invalid partial build on
-- retry, and records the migration only after all indexes are valid.

CREATE INDEX CONCURRENTLY IF NOT EXISTS client_profiles_workspace_idx
  ON client_profiles (workspace_id, id)
  WHERE workspace_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS subscriptions_workspace_idx
  ON subscriptions (workspace_id, status)
  WHERE workspace_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS checkout_orders_workspace_idx
  ON checkout_orders (workspace_id, created_at DESC)
  WHERE workspace_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS pilot_enrollments_workspace_idx
  ON pilot_enrollments (workspace_id, status)
  WHERE workspace_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS leads_workspace_idx
  ON leads (workspace_id, status, updated_at DESC)
  WHERE workspace_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS deliveries_workspace_idx
  ON deliveries (workspace_id, status, created_at DESC)
  WHERE workspace_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS user_search_preferences_workspace_idx
  ON user_search_preferences (workspace_id, source)
  WHERE workspace_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS notification_provider_accounts_workspace_idx
  ON notification_provider_accounts (workspace_id, status, provider)
  WHERE workspace_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS opportunities_workspace_idx
  ON opportunities (workspace_id, status, opportunity_score DESC, id DESC)
  WHERE workspace_id IS NOT NULL;

-- These non-partial unique indexes are parent keys for composite tenant FKs.
-- NULL workspace values remain legal during the compatibility window.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS client_profiles_id_owner_workspace_uidx
  ON client_profiles (id, owner_id, workspace_id);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS leads_id_user_workspace_uidx
  ON leads (id, user_id, workspace_id);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS notification_provider_accounts_context_uidx
  ON notification_provider_accounts (
    id,
    client_profile_id,
    owner_id,
    workspace_id
  );
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS notification_provider_accounts_profile_uidx
  ON notification_provider_accounts (id, client_profile_id);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS notification_endpoints_context_uidx
  ON notification_endpoints (
    id,
    client_profile_id,
    provider_account_id
  );
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS notification_endpoints_profile_uidx
  ON notification_endpoints (id, client_profile_id);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS notification_routes_context_uidx
  ON notification_routes (id, client_profile_id, endpoint_id);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS opportunities_id_owner_workspace_uidx
  ON opportunities (id, owner_id, workspace_id);
