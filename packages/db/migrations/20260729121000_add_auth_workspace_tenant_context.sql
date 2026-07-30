SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '1min';

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
