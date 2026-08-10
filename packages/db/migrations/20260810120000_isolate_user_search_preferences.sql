BEGIN;

LOCK TABLE user_search_preferences IN SHARE ROW EXCLUSIVE MODE;

-- Search preferences are profile-planner inputs, not global ingestion config.
-- Backfill the tenant context first so every preference has an explicit owner.
UPDATE user_search_preferences AS preference
SET workspace_id = ensure_auth_user_workspace(preference.user_id)
WHERE preference.workspace_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM user_search_preferences
    WHERE workspace_id IS NULL
  ) THEN
    RAISE EXCEPTION 'search preference isolation requires explicit workspace ownership';
  END IF;
END;
$$;

-- Namespace every per-user preference away from the raw source ids consumed by
-- shared ingestion. A query for source = 'hh' can no longer see a tenant-owned
-- planner preference; Query Planner v2 reads the planner:* namespace explicitly.
UPDATE user_search_preferences
SET source = 'planner:' || source
WHERE source NOT LIKE 'planner:%';

ALTER TABLE user_search_preferences
  ALTER COLUMN workspace_id SET NOT NULL;

ALTER TABLE user_search_preferences
  DROP CONSTRAINT user_search_preferences_pkey,
  ADD CONSTRAINT user_search_preferences_pkey
    PRIMARY KEY (workspace_id, user_id, source),
  ADD CONSTRAINT user_search_preferences_planner_namespace
    CHECK (
      source LIKE 'planner:%'
      AND BTRIM(SUBSTRING(source FROM 9)) <> ''
    );

COMMENT ON TABLE user_search_preferences IS
  'Workspace-owned Query Planner search preferences. source is namespaced as planner:<source>; shared ingestion must never consume these rows as global source configuration.';

COMMIT;
