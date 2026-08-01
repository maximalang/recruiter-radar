BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '1min';

ALTER TABLE opportunity_outcome_events
  ADD COLUMN assigned_user_id BIGINT;

ALTER TABLE opportunity_outcome_events
  ADD CONSTRAINT opportunity_outcome_events_assigned_user_fkey
    FOREIGN KEY (assigned_user_id)
    REFERENCES users(id)
    ON DELETE SET NULL;

COMMENT ON COLUMN opportunity_outcome_events.assigned_user_id IS
  'Workflow assignee captured when the event is appended; NULL denotes unassigned or legacy attribution.';

COMMIT;
