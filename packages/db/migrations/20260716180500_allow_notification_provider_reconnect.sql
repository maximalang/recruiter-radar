BEGIN;

-- Allow notification provider reconnect after revocation by dropping the
-- legacy owner-scoped unique index from 20260716010000_add_notification_delivery_platform.sql.
--
-- The legacy object enforced uniqueness over (owner_id, provider,
-- external_account_id) for non-revoked rows. It is superseded by the new
-- global identity index (20260716180000), which keys on (provider,
-- external_account_id) and is sufficient to prevent cross-owner takeover.
--
-- The legacy object is a partial UNIQUE INDEX (CREATE UNIQUE INDEX ... WHERE),
-- not a table constraint, so it is dropped by name via DROP INDEX IF EXISTS.
-- pg_constraint / information_schema.table_constraints do not carry partial
-- indexes, so a constraint-name lookup would silently miss it. IF EXISTS keeps
-- this migration idempotent and safe on databases that never carried the legacy
-- index (fresh bootstrap, or a DB where it was already removed).

DROP INDEX IF EXISTS uq_notification_provider_account_external;

COMMIT;
