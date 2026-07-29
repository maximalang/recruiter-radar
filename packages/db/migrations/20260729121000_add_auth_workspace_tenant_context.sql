BEGIN;

-- Workspace rollout is additive. Legacy owner_id/user_id columns remain the
-- compatibility authority until the canary has proved full parity.
ALTER TABLE client_profiles
  ADD COLUMN workspace_id BIGINT;
ALTER TABLE subscriptions
  ADD COLUMN workspace_id BIGINT;
ALTER TABLE checkout_orders
  ADD COLUMN workspace_id BIGINT;
ALTER TABLE pilot_enrollments
  ADD COLUMN workspace_id BIGINT;
ALTER TABLE leads
  ADD COLUMN workspace_id BIGINT;
ALTER TABLE deliveries
  ADD COLUMN workspace_id BIGINT;
ALTER TABLE user_search_preferences
  ADD COLUMN workspace_id BIGINT;
ALTER TABLE notification_provider_accounts
  ADD COLUMN workspace_id BIGINT;
ALTER TABLE opportunities
  ADD COLUMN workspace_id BIGINT;

CREATE INDEX client_profiles_workspace_idx
  ON client_profiles (workspace_id, id)
  WHERE workspace_id IS NOT NULL;
CREATE INDEX subscriptions_workspace_idx
  ON subscriptions (workspace_id, status)
  WHERE workspace_id IS NOT NULL;
CREATE INDEX checkout_orders_workspace_idx
  ON checkout_orders (workspace_id, created_at DESC)
  WHERE workspace_id IS NOT NULL;
CREATE INDEX pilot_enrollments_workspace_idx
  ON pilot_enrollments (workspace_id, status)
  WHERE workspace_id IS NOT NULL;
CREATE INDEX leads_workspace_idx
  ON leads (workspace_id, status, updated_at DESC)
  WHERE workspace_id IS NOT NULL;
CREATE INDEX deliveries_workspace_idx
  ON deliveries (workspace_id, status, created_at DESC)
  WHERE workspace_id IS NOT NULL;
CREATE INDEX user_search_preferences_workspace_idx
  ON user_search_preferences (workspace_id, source)
  WHERE workspace_id IS NOT NULL;
CREATE INDEX notification_provider_accounts_workspace_idx
  ON notification_provider_accounts (workspace_id, status, provider)
  WHERE workspace_id IS NOT NULL;
CREATE INDEX opportunities_workspace_idx
  ON opportunities (workspace_id, status, opportunity_score DESC, id DESC)
  WHERE workspace_id IS NOT NULL;

-- These non-partial unique indexes are parent keys for composite tenant FKs.
-- NULL workspace values remain legal during the compatibility window.
CREATE UNIQUE INDEX client_profiles_id_owner_workspace_uidx
  ON client_profiles (id, owner_id, workspace_id);
CREATE UNIQUE INDEX leads_id_user_workspace_uidx
  ON leads (id, user_id, workspace_id);
CREATE UNIQUE INDEX notification_provider_accounts_context_uidx
  ON notification_provider_accounts (
    id,
    client_profile_id,
    owner_id,
    workspace_id
  );
CREATE UNIQUE INDEX notification_provider_accounts_profile_uidx
  ON notification_provider_accounts (id, client_profile_id);
CREATE UNIQUE INDEX notification_endpoints_context_uidx
  ON notification_endpoints (
    id,
    client_profile_id,
    provider_account_id
  );
CREATE UNIQUE INDEX notification_endpoints_profile_uidx
  ON notification_endpoints (id, client_profile_id);
CREATE UNIQUE INDEX notification_routes_context_uidx
  ON notification_routes (id, client_profile_id, endpoint_id);
CREATE UNIQUE INDEX opportunities_id_owner_workspace_uidx
  ON opportunities (id, owner_id, workspace_id);

ALTER TABLE client_profiles
  ADD CONSTRAINT client_profiles_workspace_member_fkey
  FOREIGN KEY (workspace_id, owner_id)
  REFERENCES workspace_members(workspace_id, user_id)
  DEFERRABLE INITIALLY IMMEDIATE
  NOT VALID;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_workspace_member_fkey
  FOREIGN KEY (workspace_id, user_id)
  REFERENCES workspace_members(workspace_id, user_id)
  DEFERRABLE INITIALLY IMMEDIATE
  NOT VALID;

ALTER TABLE checkout_orders
  ADD CONSTRAINT checkout_orders_workspace_member_fkey
  FOREIGN KEY (workspace_id, user_id)
  REFERENCES workspace_members(workspace_id, user_id)
  DEFERRABLE INITIALLY IMMEDIATE
  NOT VALID;

ALTER TABLE pilot_enrollments
  ADD CONSTRAINT pilot_enrollments_workspace_member_fkey
  FOREIGN KEY (workspace_id, user_id)
  REFERENCES workspace_members(workspace_id, user_id)
  DEFERRABLE INITIALLY IMMEDIATE
  NOT VALID;

ALTER TABLE leads
  ADD CONSTRAINT leads_workspace_member_fkey
  FOREIGN KEY (workspace_id, user_id)
  REFERENCES workspace_members(workspace_id, user_id)
  DEFERRABLE INITIALLY IMMEDIATE
  NOT VALID;

ALTER TABLE deliveries
  ADD CONSTRAINT deliveries_workspace_member_fkey
  FOREIGN KEY (workspace_id, user_id)
  REFERENCES workspace_members(workspace_id, user_id)
  DEFERRABLE INITIALLY IMMEDIATE
  NOT VALID,
  ADD CONSTRAINT deliveries_lead_workspace_fkey
  FOREIGN KEY (lead_id, user_id, workspace_id)
  REFERENCES leads(id, user_id, workspace_id)
  ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE
  NOT VALID;

ALTER TABLE user_search_preferences
  ADD CONSTRAINT user_search_preferences_workspace_member_fkey
  FOREIGN KEY (workspace_id, user_id)
  REFERENCES workspace_members(workspace_id, user_id)
  DEFERRABLE INITIALLY IMMEDIATE
  NOT VALID;

ALTER TABLE notification_provider_accounts
  ADD CONSTRAINT notification_provider_accounts_workspace_member_fkey
  FOREIGN KEY (workspace_id, owner_id)
  REFERENCES workspace_members(workspace_id, user_id)
  DEFERRABLE INITIALLY IMMEDIATE
  NOT VALID,
  ADD CONSTRAINT notification_provider_accounts_profile_workspace_fkey
  FOREIGN KEY (client_profile_id, owner_id, workspace_id)
  REFERENCES client_profiles(id, owner_id, workspace_id)
  ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE
  NOT VALID;

ALTER TABLE opportunities
  ADD CONSTRAINT opportunities_workspace_member_fkey
  FOREIGN KEY (workspace_id, owner_id)
  REFERENCES workspace_members(workspace_id, user_id)
  DEFERRABLE INITIALLY IMMEDIATE
  NOT VALID,
  ADD CONSTRAINT opportunities_profile_workspace_fkey
  FOREIGN KEY (client_profile_id, owner_id, workspace_id)
  REFERENCES client_profiles(id, owner_id, workspace_id)
  ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE
  NOT VALID;

-- Notification descendants remain transitively scoped to avoid a second,
-- mutable workspace authority. These constraints reject mixed-profile graphs.
ALTER TABLE notification_endpoints
  ADD CONSTRAINT notification_endpoints_provider_profile_fkey
  FOREIGN KEY (provider_account_id, client_profile_id)
  REFERENCES notification_provider_accounts(id, client_profile_id)
  ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE
  NOT VALID;

ALTER TABLE notification_routes
  ADD CONSTRAINT notification_routes_endpoint_profile_fkey
  FOREIGN KEY (endpoint_id, client_profile_id)
  REFERENCES notification_endpoints(id, client_profile_id)
  ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE
  NOT VALID;

ALTER TABLE notification_delivery_jobs
  ADD CONSTRAINT notification_jobs_provider_profile_fkey
  FOREIGN KEY (provider_account_id, client_profile_id)
  REFERENCES notification_provider_accounts(id, client_profile_id)
  ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE
  NOT VALID,
  ADD CONSTRAINT notification_jobs_endpoint_context_fkey
  FOREIGN KEY (endpoint_id, client_profile_id, provider_account_id)
  REFERENCES notification_endpoints(
    id,
    client_profile_id,
    provider_account_id
  )
  ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE
  NOT VALID,
  ADD CONSTRAINT notification_jobs_route_context_fkey
  FOREIGN KEY (route_id, client_profile_id, endpoint_id)
  REFERENCES notification_routes(id, client_profile_id, endpoint_id)
  ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE
  NOT VALID;

CREATE OR REPLACE FUNCTION auth_workspace_resolve_user(
  user_id_value BIGINT,
  requested_workspace_id BIGINT
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  resolved_workspace_id BIGINT;
BEGIN
  IF user_id_value IS NULL THEN
    RAISE EXCEPTION 'workspace tenant owner is required'
      USING ERRCODE = '23502';
  END IF;

  resolved_workspace_id := COALESCE(
    requested_workspace_id,
    ensure_auth_user_workspace(user_id_value)
  );

  IF NOT EXISTS (
    SELECT 1
    FROM workspace_members AS membership
    JOIN workspaces AS workspace
      ON workspace.id = membership.workspace_id
    WHERE membership.workspace_id = resolved_workspace_id
      AND membership.user_id = user_id_value
      AND membership.status = 'active'
      AND workspace.status = 'active'
      AND workspace.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'active workspace membership is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN resolved_workspace_id;
END;
$$;

CREATE OR REPLACE FUNCTION auth_workspace_resolve_profile(
  client_profile_id_value BIGINT,
  owner_id_value BIGINT,
  requested_workspace_id BIGINT
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  profile_owner_id BIGINT;
  profile_workspace_id BIGINT;
BEGIN
  SELECT profile.owner_id, profile.workspace_id
  INTO profile_owner_id, profile_workspace_id
  FROM client_profiles AS profile
  WHERE profile.id = client_profile_id_value
  FOR UPDATE;

  IF profile_owner_id IS NULL OR profile_owner_id <> owner_id_value THEN
    RAISE EXCEPTION 'client profile owner mismatch'
      USING ERRCODE = '23503';
  END IF;

  IF requested_workspace_id IS NOT NULL
     AND profile_workspace_id IS NOT NULL
     AND requested_workspace_id <> profile_workspace_id THEN
    RAISE EXCEPTION 'client profile workspace mismatch'
      USING ERRCODE = '23503';
  END IF;

  profile_workspace_id := auth_workspace_resolve_user(
    profile_owner_id,
    COALESCE(profile_workspace_id, requested_workspace_id)
  );

  UPDATE client_profiles
  SET workspace_id = profile_workspace_id
  WHERE id = client_profile_id_value
    AND workspace_id IS NULL;

  RETURN profile_workspace_id;
END;
$$;

CREATE OR REPLACE FUNCTION auth_workspace_resolve_lead(
  lead_id_value BIGINT,
  user_id_value BIGINT,
  requested_workspace_id BIGINT
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  lead_user_id BIGINT;
  lead_workspace_id BIGINT;
BEGIN
  SELECT lead.user_id, lead.workspace_id
  INTO lead_user_id, lead_workspace_id
  FROM leads AS lead
  WHERE lead.id = lead_id_value
  FOR UPDATE;

  IF lead_user_id IS NULL OR lead_user_id <> user_id_value THEN
    RAISE EXCEPTION 'lead owner mismatch'
      USING ERRCODE = '23503';
  END IF;

  IF requested_workspace_id IS NOT NULL
     AND lead_workspace_id IS NOT NULL
     AND requested_workspace_id <> lead_workspace_id THEN
    RAISE EXCEPTION 'lead workspace mismatch'
      USING ERRCODE = '23503';
  END IF;

  lead_workspace_id := auth_workspace_resolve_user(
    lead_user_id,
    COALESCE(lead_workspace_id, requested_workspace_id)
  );

  UPDATE leads
  SET workspace_id = lead_workspace_id
  WHERE id = lead_id_value
    AND workspace_id IS NULL;

  RETURN lead_workspace_id;
END;
$$;

CREATE OR REPLACE FUNCTION auth_workspace_assign_user_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.workspace_id := auth_workspace_resolve_user(
    NEW.user_id,
    NEW.workspace_id
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION auth_workspace_assign_profile_owner_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.workspace_id := auth_workspace_resolve_user(
    NEW.owner_id,
    NEW.workspace_id
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION auth_workspace_assign_profile_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.workspace_id := auth_workspace_resolve_profile(
    NEW.client_profile_id,
    NEW.owner_id,
    NEW.workspace_id
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION auth_workspace_assign_delivery_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.workspace_id := auth_workspace_resolve_lead(
    NEW.lead_id,
    NEW.user_id,
    NEW.workspace_id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER client_profiles_assign_workspace
BEFORE INSERT OR UPDATE ON client_profiles
FOR EACH ROW
EXECUTE FUNCTION auth_workspace_assign_profile_owner_tenant();

CREATE TRIGGER subscriptions_assign_workspace
BEFORE INSERT OR UPDATE ON subscriptions
FOR EACH ROW
EXECUTE FUNCTION auth_workspace_assign_user_tenant();

CREATE TRIGGER checkout_orders_assign_workspace
BEFORE INSERT OR UPDATE ON checkout_orders
FOR EACH ROW
EXECUTE FUNCTION auth_workspace_assign_user_tenant();

CREATE TRIGGER pilot_enrollments_assign_workspace
BEFORE INSERT OR UPDATE ON pilot_enrollments
FOR EACH ROW
EXECUTE FUNCTION auth_workspace_assign_user_tenant();

CREATE TRIGGER leads_assign_workspace
BEFORE INSERT OR UPDATE ON leads
FOR EACH ROW
EXECUTE FUNCTION auth_workspace_assign_user_tenant();

CREATE TRIGGER deliveries_assign_workspace
BEFORE INSERT OR UPDATE ON deliveries
FOR EACH ROW
EXECUTE FUNCTION auth_workspace_assign_delivery_tenant();

CREATE TRIGGER user_search_preferences_assign_workspace
BEFORE INSERT OR UPDATE ON user_search_preferences
FOR EACH ROW
EXECUTE FUNCTION auth_workspace_assign_user_tenant();

CREATE TRIGGER notification_provider_accounts_assign_workspace
BEFORE INSERT OR UPDATE ON notification_provider_accounts
FOR EACH ROW
EXECUTE FUNCTION auth_workspace_assign_profile_tenant();

CREATE TRIGGER opportunities_assign_workspace
BEFORE INSERT OR UPDATE ON opportunities
FOR EACH ROW
EXECUTE FUNCTION auth_workspace_assign_profile_tenant();

CREATE OR REPLACE FUNCTION backfill_auth_workspace_user(
  user_id_value BIGINT
)
RETURNS TABLE (
  workspace_id BIGINT,
  changed_rows BIGINT
)
LANGUAGE plpgsql
AS $$
DECLARE
  resolved_workspace_id BIGINT;
  statement_rows BIGINT;
  total_rows BIGINT := 0;
BEGIN
  resolved_workspace_id := ensure_auth_user_workspace(user_id_value);

  UPDATE client_profiles AS profile
  SET workspace_id = resolved_workspace_id
  WHERE profile.owner_id = user_id_value
    AND profile.workspace_id IS NULL;
  GET DIAGNOSTICS statement_rows = ROW_COUNT;
  total_rows := total_rows + statement_rows;

  UPDATE subscriptions AS subscription
  SET workspace_id = resolved_workspace_id
  WHERE subscription.user_id = user_id_value
    AND subscription.workspace_id IS NULL;
  GET DIAGNOSTICS statement_rows = ROW_COUNT;
  total_rows := total_rows + statement_rows;

  UPDATE checkout_orders AS checkout_order
  SET workspace_id = resolved_workspace_id
  WHERE checkout_order.user_id = user_id_value
    AND checkout_order.workspace_id IS NULL;
  GET DIAGNOSTICS statement_rows = ROW_COUNT;
  total_rows := total_rows + statement_rows;

  UPDATE pilot_enrollments AS enrollment
  SET workspace_id = resolved_workspace_id
  WHERE enrollment.user_id = user_id_value
    AND enrollment.workspace_id IS NULL;
  GET DIAGNOSTICS statement_rows = ROW_COUNT;
  total_rows := total_rows + statement_rows;

  UPDATE leads AS lead
  SET workspace_id = resolved_workspace_id
  WHERE lead.user_id = user_id_value
    AND lead.workspace_id IS NULL;
  GET DIAGNOSTICS statement_rows = ROW_COUNT;
  total_rows := total_rows + statement_rows;

  UPDATE deliveries AS delivery
  SET workspace_id = resolved_workspace_id
  WHERE delivery.user_id = user_id_value
    AND delivery.workspace_id IS NULL;
  GET DIAGNOSTICS statement_rows = ROW_COUNT;
  total_rows := total_rows + statement_rows;

  UPDATE user_search_preferences AS preference
  SET workspace_id = resolved_workspace_id
  WHERE preference.user_id = user_id_value
    AND preference.workspace_id IS NULL;
  GET DIAGNOSTICS statement_rows = ROW_COUNT;
  total_rows := total_rows + statement_rows;

  UPDATE notification_provider_accounts AS account
  SET workspace_id = resolved_workspace_id
  WHERE account.owner_id = user_id_value
    AND account.workspace_id IS NULL;
  GET DIAGNOSTICS statement_rows = ROW_COUNT;
  total_rows := total_rows + statement_rows;

  UPDATE opportunities AS opportunity
  SET workspace_id = resolved_workspace_id
  WHERE opportunity.owner_id = user_id_value
    AND opportunity.workspace_id IS NULL;
  GET DIAGNOSTICS statement_rows = ROW_COUNT;
  total_rows := total_rows + statement_rows;

  UPDATE auth_sessions AS session
  SET workspace_id = resolved_workspace_id
  WHERE session.user_id = user_id_value
    AND session.workspace_id IS NULL;
  GET DIAGNOSTICS statement_rows = ROW_COUNT;
  total_rows := total_rows + statement_rows;

  UPDATE auth_challenges AS challenge
  SET workspace_id = resolved_workspace_id
  WHERE challenge.user_id = user_id_value
    AND challenge.workspace_id IS NULL;
  GET DIAGNOSTICS statement_rows = ROW_COUNT;
  total_rows := total_rows + statement_rows;

  RETURN QUERY SELECT resolved_workspace_id, total_rows;
END;
$$;

COMMENT ON FUNCTION backfill_auth_workspace_user(BIGINT) IS
  'Idempotently fills nullable workspace context for one legacy tenant owner.';

COMMIT;
