BEGIN;

LOCK TABLE user_search_preferences IN ACCESS EXCLUSIVE MODE;

-- The legacy identity (user_id, source) cannot represent the same user's
-- preference for the same source in multiple workspaces. Refuse a lossy down.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM user_search_preferences
    GROUP BY user_id, SUBSTRING(source FROM 9)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'search preference isolation rollback refused: multi-workspace preferences would collide';
  END IF;
END;
$$;

ALTER TABLE user_search_preferences
  DROP CONSTRAINT user_search_preferences_planner_namespace,
  DROP CONSTRAINT user_search_preferences_pkey;

UPDATE user_search_preferences
SET source = SUBSTRING(source FROM 9)
WHERE source LIKE 'planner:%';

ALTER TABLE user_search_preferences
  ADD CONSTRAINT user_search_preferences_pkey PRIMARY KEY (user_id, source),
  ALTER COLUMN workspace_id DROP NOT NULL;

COMMENT ON TABLE user_search_preferences IS NULL;

COMMIT;
