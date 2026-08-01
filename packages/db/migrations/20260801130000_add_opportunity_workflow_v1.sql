BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '1min';

CREATE TABLE opportunity_workflow_events (
  id BIGSERIAL PRIMARY KEY,
  owner_id BIGINT NOT NULL,
  workspace_id BIGINT NOT NULL,
  opportunity_id BIGINT NOT NULL,
  actor_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  actor_role_snapshot TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'workflow_updated',
  assigned_to_user_id BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  next_action_type TEXT,
  next_action_due_at TIMESTAMPTZ,
  workflow_priority TEXT NOT NULL,
  internal_note TEXT,
  changed_fields TEXT[] NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT opportunity_workflow_events_id_context_unique
    UNIQUE (id, owner_id, workspace_id),
  CONSTRAINT opportunity_workflow_events_opportunity_fkey
    FOREIGN KEY (opportunity_id, owner_id, workspace_id)
    REFERENCES opportunities(id, owner_id, workspace_id)
    ON DELETE RESTRICT,
  CONSTRAINT opportunity_workflow_events_actor_workspace_check
    CHECK (actor_workspace_id = workspace_id),
  CONSTRAINT opportunity_workflow_events_actor_role_check
    CHECK (actor_role_snapshot IN ('owner', 'admin', 'recruiter')),
  CONSTRAINT opportunity_workflow_events_type_check
    CHECK (event_type = 'workflow_updated'),
  CONSTRAINT opportunity_workflow_events_next_action_check
    CHECK (
      next_action_type IS NULL OR next_action_type IN (
        'review', 'contact', 'follow_up', 'prepare_meeting', 'send_proposal'
      )
    ),
  CONSTRAINT opportunity_workflow_events_due_at_check
    CHECK (next_action_due_at IS NULL OR next_action_type IS NOT NULL),
  CONSTRAINT opportunity_workflow_events_priority_check
    CHECK (workflow_priority IN ('low', 'normal', 'high')),
  CONSTRAINT opportunity_workflow_events_note_check
    CHECK (
      internal_note IS NULL OR (
        BTRIM(internal_note) <> ''
        AND CHAR_LENGTH(internal_note) <= 2000
      )
    ),
  CONSTRAINT opportunity_workflow_events_changed_fields_check
    CHECK (
      CARDINALITY(changed_fields) > 0
      AND changed_fields <@ ARRAY[
        'assignedToUserId',
        'nextActionType',
        'nextActionDueAt',
        'workflowPriority',
        'internalNote'
      ]::TEXT[]
    ),
  CONSTRAINT opportunity_workflow_events_idempotency_key_check
    CHECK (BTRIM(idempotency_key) <> '' AND CHAR_LENGTH(idempotency_key) <= 160),
  CONSTRAINT opportunity_workflow_events_payload_hash_check
    CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT opportunity_workflow_events_idempotency_unique
    UNIQUE (owner_id, workspace_id, idempotency_key)
);

CREATE TABLE opportunity_workflow_state (
  owner_id BIGINT NOT NULL,
  workspace_id BIGINT NOT NULL,
  opportunity_id BIGINT NOT NULL,
  assigned_to_user_id BIGINT,
  next_action_type TEXT,
  next_action_due_at TIMESTAMPTZ,
  workflow_priority TEXT NOT NULL DEFAULT 'normal',
  internal_note TEXT,
  last_event_id BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_id, workspace_id, opportunity_id),
  CONSTRAINT opportunity_workflow_state_opportunity_fkey
    FOREIGN KEY (opportunity_id, owner_id, workspace_id)
    REFERENCES opportunities(id, owner_id, workspace_id)
    ON DELETE RESTRICT,
  CONSTRAINT opportunity_workflow_state_assignee_fkey
    FOREIGN KEY (workspace_id, assigned_to_user_id)
    REFERENCES workspace_members(workspace_id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT opportunity_workflow_state_last_event_fkey
    FOREIGN KEY (last_event_id, owner_id, workspace_id)
    REFERENCES opportunity_workflow_events(id, owner_id, workspace_id)
    ON DELETE RESTRICT,
  CONSTRAINT opportunity_workflow_state_next_action_check
    CHECK (
      next_action_type IS NULL OR next_action_type IN (
        'review', 'contact', 'follow_up', 'prepare_meeting', 'send_proposal'
      )
    ),
  CONSTRAINT opportunity_workflow_state_due_at_check
    CHECK (next_action_due_at IS NULL OR next_action_type IS NOT NULL),
  CONSTRAINT opportunity_workflow_state_priority_check
    CHECK (workflow_priority IN ('low', 'normal', 'high')),
  CONSTRAINT opportunity_workflow_state_note_check
    CHECK (
      internal_note IS NULL OR (
        BTRIM(internal_note) <> ''
        AND CHAR_LENGTH(internal_note) <= 2000
      )
    )
);

CREATE INDEX opportunity_workflow_events_opportunity_recorded_idx
  ON opportunity_workflow_events (
    workspace_id,
    opportunity_id,
    recorded_at DESC,
    id DESC
  );

CREATE INDEX opportunity_workflow_state_today_idx
  ON opportunity_workflow_state (
    workspace_id,
    next_action_due_at ASC,
    workflow_priority DESC,
    opportunity_id DESC
  );

CREATE INDEX opportunity_workflow_state_assignee_idx
  ON opportunity_workflow_state (
    workspace_id,
    assigned_to_user_id,
    workflow_priority DESC,
    next_action_due_at ASC
  );

CREATE OR REPLACE FUNCTION reject_opportunity_workflow_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'opportunity_workflow_events is append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER opportunity_workflow_events_append_only
BEFORE UPDATE OR DELETE ON opportunity_workflow_events
FOR EACH ROW
EXECUTE FUNCTION reject_opportunity_workflow_event_mutation();

COMMENT ON TABLE opportunity_workflow_events IS
  'Append-only internal workflow activity; not a commercial outcome ledger.';
COMMENT ON COLUMN opportunity_workflow_events.internal_note IS
  'Internal workspace-only note; excluded from outcome analytics snapshots.';

COMMIT;
