BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

DROP TRIGGER notification_inbound_events_require_active_owner
  ON notification_inbound_events;
DROP TRIGGER notification_inbound_events_lock_owner_writes
  ON notification_inbound_events;
DROP TRIGGER notification_delivery_attempts_require_active_owner
  ON notification_delivery_attempts;
DROP TRIGGER notification_delivery_attempts_lock_owner_writes
  ON notification_delivery_attempts;
DROP TRIGGER notification_delivery_jobs_require_active_owner
  ON notification_delivery_jobs;
DROP TRIGGER notification_delivery_jobs_lock_owner_writes
  ON notification_delivery_jobs;
DROP TRIGGER notification_routes_require_active_owner
  ON notification_routes;
DROP TRIGGER notification_routes_lock_owner_writes
  ON notification_routes;
DROP TRIGGER notification_endpoints_require_active_owner
  ON notification_endpoints;
DROP TRIGGER notification_endpoints_lock_owner_writes
  ON notification_endpoints;
DROP TRIGGER notification_provider_accounts_require_active_owner
  ON notification_provider_accounts;
DROP TRIGGER notification_provider_accounts_lock_owner_writes
  ON notification_provider_accounts;
DROP TRIGGER lead_channel_deliveries_require_active_owner
  ON lead_channel_deliveries;
DROP TRIGGER lead_channel_deliveries_lock_owner_writes
  ON lead_channel_deliveries;
DROP TRIGGER web_push_subscriptions_require_active_owner
  ON web_push_subscriptions;
DROP TRIGGER web_push_subscriptions_lock_owner_writes
  ON web_push_subscriptions;
DROP TRIGGER client_profiles_require_active_owner
  ON client_profiles;
DROP TRIGGER client_profiles_lock_owner_writes
  ON client_profiles;

DROP FUNCTION auth_require_active_owner_write();
DROP FUNCTION auth_lock_owner_writes();

COMMIT;
