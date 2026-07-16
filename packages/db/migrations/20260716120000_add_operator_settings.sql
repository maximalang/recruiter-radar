-- Operator-managed runtime settings — lets the operator change the LLM
-- provider (API key + base URL + model) from the admin panel WITHOUT a redeploy
-- or an env edit. Single-row-per-key key/value store.
--
-- Design:
--   * `is_secret` marks rows whose `value` must be masked in every read surface
--     (the LLM API key). The admin panel and any logging never return a secret's
--     full value — only a presence flag + a masked tail (see
--     lib/operatorSettings.ts maskSecret). This mirrors llm-config.ts, which
--     already keeps the API key out of resolveLlmProviderConfig() so it never
--     reaches logs.
--   * Keys are a closed set (operator_settings_key_check); adding a new
--     operator-managed setting = one new key here + the reader, so an arbitrary
--     row can't be injected to influence the app.
--   * Nullable on purpose and starts empty — env stays the fallback, so a fresh
--     DB with no operator-set rows behaves exactly as before (no behavior change
--     until the operator actively sets a value).
--
-- Applied automatically on container start (docker-entrypoint → migrate.mjs,
-- runner sorts YYYYMMDDHHMMSS). No .down.sql needed — the table is additive and
-- safe to leave in place; a future teardown would `DROP TABLE operator_settings`.

BEGIN;

CREATE TABLE IF NOT EXISTS operator_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  is_secret BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE operator_settings
  DROP CONSTRAINT IF EXISTS operator_settings_key_not_blank;
ALTER TABLE operator_settings
  ADD CONSTRAINT operator_settings_key_not_blank CHECK (BTRIM(key) <> '');

ALTER TABLE operator_settings
  DROP CONSTRAINT IF EXISTS operator_settings_value_not_blank;
ALTER TABLE operator_settings
  ADD CONSTRAINT operator_settings_value_not_blank CHECK (BTRIM(value) <> '');

ALTER TABLE operator_settings
  DROP CONSTRAINT IF EXISTS operator_settings_key_allowed;
ALTER TABLE operator_settings
  ADD CONSTRAINT operator_settings_key_allowed CHECK (
    key IN ('llm_api_key', 'llm_base_url', 'llm_model')
  );

-- updated_at is maintained by the write path (setOperatorSetting sets NOW());
-- no trigger needed because there is exactly one writer and it always stamps it.

COMMIT;
