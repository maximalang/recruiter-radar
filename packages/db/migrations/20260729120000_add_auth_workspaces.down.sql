BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM workspace_invites) THEN
    RAISE EXCEPTION
      'workspace rollback refused: invitation history exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM workspaces AS workspace
    WHERE workspace.bootstrap_user_id IS NULL
       OR workspace.status <> 'active'
       OR workspace.deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'workspace rollback refused: non-bootstrap workspace state exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM workspace_members AS membership
    JOIN workspaces AS workspace
      ON workspace.id = membership.workspace_id
    WHERE membership.user_id <> workspace.bootstrap_user_id
       OR membership.role <> 'owner'
       OR membership.status <> 'active'
       OR membership.invited_by IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'workspace rollback refused: collaborative membership state exists';
  END IF;
END;
$$;

DROP TRIGGER auth_security_events_assign_workspace
  ON auth_security_events;
DROP TRIGGER auth_challenges_assign_workspace
  ON auth_challenges;
DROP TRIGGER auth_sessions_assign_workspace
  ON auth_sessions;

ALTER TABLE workspace_invites
  DROP CONSTRAINT workspace_invites_inviter_member_fkey;

ALTER TABLE auth_challenges
  DROP CONSTRAINT auth_challenges_workspace_member_fkey,
  DROP CONSTRAINT auth_challenges_workspace_fkey;

ALTER TABLE auth_sessions
  DROP CONSTRAINT auth_sessions_workspace_member_fkey;

UPDATE auth_challenges
SET workspace_id = NULL
WHERE workspace_id IS NOT NULL;

UPDATE auth_sessions
SET workspace_id = NULL
WHERE workspace_id IS NOT NULL;

DROP FUNCTION assign_auth_workspace_context();
DROP FUNCTION ensure_auth_user_workspace(BIGINT, TIMESTAMPTZ);

DROP TABLE workspace_invites;
DROP TABLE workspace_members;
DROP TABLE workspaces;

COMMIT;
