SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '1min';

ALTER TABLE opportunity_outcome_events
  ADD COLUMN actor_workspace_id BIGINT,
  ADD COLUMN actor_role_snapshot TEXT;

ALTER TABLE opportunity_outcome_events
  ADD CONSTRAINT opportunity_outcome_events_actor_workspace_fkey
    FOREIGN KEY (actor_workspace_id)
    REFERENCES workspaces(id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT opportunity_outcome_events_actor_context_check
    CHECK (
      (
        actor_workspace_id IS NULL
        AND actor_role_snapshot IS NULL
      )
      OR (
        actor_type = 'user'
        AND actor_user_id IS NOT NULL
        AND actor_workspace_id IS NOT NULL
        AND actor_role_snapshot IN (
          'owner',
          'admin',
          'recruiter',
          'viewer',
          'billing'
        )
      )
    );

COMMENT ON COLUMN opportunity_outcome_events.actor_workspace_id IS
  'Active Auth v2 workspace at action time; NULL denotes legacy attribution.';
COMMENT ON COLUMN opportunity_outcome_events.actor_role_snapshot IS
  'Immutable Auth v2 workspace role at action time; NULL denotes legacy attribution.';
