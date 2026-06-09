BEGIN;

-- Per-user search preferences for each source (hh, superjob, habr-career).
-- Replaces ENV-based search params (HH_SEARCH_TEXT, SUPERJOB_KEYWORD, etc.)
-- with per-user config stored as JSONB keyed by API parameter name.
--
-- Technical keys (API tokens, USER_AGENT) stay in ENV.
-- Only search/query params move here.

CREATE TABLE user_search_preferences (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  params JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_search_preferences_source_not_blank CHECK (BTRIM(source) <> ''),
  CONSTRAINT user_search_preferences_params_is_object CHECK (jsonb_typeof(params) = 'object'),
  PRIMARY KEY (user_id, source)
);

CREATE INDEX user_search_preferences_source_idx ON user_search_preferences (source);

CREATE TRIGGER user_search_preferences_set_updated_at
BEFORE UPDATE ON user_search_preferences
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;
