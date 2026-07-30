BEGIN;

CREATE TABLE workspaces (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  bootstrap_user_id BIGINT UNIQUE
    REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT workspaces_name_check
    CHECK (
      BTRIM(name) = name
      AND name <> ''
      AND OCTET_LENGTH(name) <= 160
      AND name !~ '[[:cntrl:]]'
    ),
  CONSTRAINT workspaces_slug_check
    CHECK (
      slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      AND OCTET_LENGTH(slug) <= 96
    ),
  CONSTRAINT workspaces_status_check
    CHECK (status IN ('active', 'suspended', 'deletion_pending', 'deleted')),
  CONSTRAINT workspaces_deleted_state_check
    CHECK (
      (status = 'deleted' AND deleted_at IS NOT NULL)
      OR (status <> 'deleted' AND deleted_at IS NULL)
    ),
  CONSTRAINT workspaces_timestamp_check
    CHECK (updated_at >= created_at)
);

CREATE INDEX workspaces_status_id_idx
  ON workspaces (status, id);

CREATE TABLE workspace_members (
  workspace_id BIGINT NOT NULL
    REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  invited_by BIGINT
    REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id),
  CONSTRAINT workspace_members_role_check
    CHECK (role IN ('owner', 'admin', 'recruiter', 'viewer', 'billing')),
  CONSTRAINT workspace_members_status_check
    CHECK (status IN ('active', 'suspended', 'removed')),
  CONSTRAINT workspace_members_timestamp_check
    CHECK (updated_at >= joined_at),
  CONSTRAINT workspace_members_inviter_check
    CHECK (invited_by IS NULL OR invited_by <> user_id)
);

CREATE UNIQUE INDEX workspace_members_user_workspace_uidx
  ON workspace_members (user_id, workspace_id);
CREATE INDEX workspace_members_user_active_idx
  ON workspace_members (user_id, workspace_id)
  WHERE status = 'active';
CREATE INDEX workspace_members_workspace_active_idx
  ON workspace_members (workspace_id, role, user_id)
  WHERE status = 'active';

CREATE TABLE workspace_invites (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL
    REFERENCES workspaces(id) ON DELETE CASCADE,
  email_normalized TEXT NOT NULL,
  role TEXT NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  invited_by BIGINT NOT NULL
    REFERENCES users(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by BIGINT
    REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workspace_invites_email_check
    CHECK (
      BTRIM(email_normalized) = email_normalized
      AND email_normalized <> ''
      AND OCTET_LENGTH(email_normalized) <= 320
      AND email_normalized !~ '[[:space:][:cntrl:]]'
    ),
  CONSTRAINT workspace_invites_role_check
    CHECK (role IN ('admin', 'recruiter', 'viewer', 'billing')),
  CONSTRAINT workspace_invites_token_hash_check
    CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT workspace_invites_expiry_check
    CHECK (expires_at > created_at),
  CONSTRAINT workspace_invites_acceptance_check
    CHECK (
      (accepted_at IS NULL AND accepted_by IS NULL)
      OR (
        accepted_at IS NOT NULL
        AND accepted_by IS NOT NULL
        AND accepted_at >= created_at
        AND accepted_at <= expires_at
      )
    ),
  CONSTRAINT workspace_invites_terminal_state_check
    CHECK (accepted_at IS NULL OR revoked_at IS NULL),
  CONSTRAINT workspace_invites_revocation_check
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE UNIQUE INDEX workspace_invites_active_email_uidx
  ON workspace_invites (workspace_id, email_normalized)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX workspace_invites_workspace_created_idx
  ON workspace_invites (workspace_id, created_at DESC);

CREATE FUNCTION ensure_auth_user_workspace(
  p_user_id BIGINT,
  p_now TIMESTAMPTZ DEFAULT CLOCK_TIMESTAMP()
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  workspace_id_value BIGINT;
  created_workspace_id BIGINT;
BEGIN
  IF p_user_id IS NULL OR p_user_id <= 0 THEN
    RAISE EXCEPTION 'valid user id is required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'workspace bootstrap user does not exist';
  END IF;

  PERFORM PG_ADVISORY_XACT_LOCK(
    HASHTEXTEXTENDED('auth-workspace:' || p_user_id::TEXT, 0::BIGINT)
  );

  SELECT workspace.id
  INTO workspace_id_value
  FROM workspaces AS workspace
  WHERE workspace.bootstrap_user_id = p_user_id
  FOR UPDATE;

  IF workspace_id_value IS NULL THEN
    INSERT INTO workspaces (
      name,
      slug,
      status,
      bootstrap_user_id,
      created_at,
      updated_at
    )
    VALUES (
      'Workspace ' || p_user_id::TEXT,
      'auth-bootstrap-' || p_user_id::TEXT,
      'active',
      p_user_id,
      p_now,
      p_now
    )
    RETURNING id
    INTO created_workspace_id;

    workspace_id_value := created_workspace_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM workspaces AS workspace
    WHERE workspace.id = workspace_id_value
      AND workspace.status = 'active'
      AND workspace.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'bootstrap workspace is not active';
  END IF;

  INSERT INTO workspace_members (
    workspace_id,
    user_id,
    role,
    status,
    joined_at,
    updated_at
  )
  VALUES (
    workspace_id_value,
    p_user_id,
    'owner',
    'active',
    p_now,
    p_now
  )
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1
    FROM workspace_members AS membership
    WHERE membership.workspace_id = workspace_id_value
      AND membership.user_id = p_user_id
      AND membership.role = 'owner'
      AND membership.status = 'active'
  ) THEN
    RAISE EXCEPTION 'bootstrap workspace owner membership is unavailable';
  END IF;

  IF created_workspace_id IS NOT NULL THEN
    INSERT INTO auth_security_events (
      event_type,
      outcome,
      user_id,
      workspace_id,
      metadata,
      created_at
    )
    VALUES (
      'workspace_created',
      'success',
      p_user_id,
      workspace_id_value,
      JSONB_BUILD_OBJECT(
        'source',
        'system',
        'auth_version',
        'v2'
      ),
      p_now
    );
  END IF;

  RETURN workspace_id_value;
END;
$$;

CREATE FUNCTION assign_auth_workspace_context()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  context_user_id BIGINT;
  resolved_workspace_id BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'auth_security_events' THEN
    IF NEW.workspace_id IS NULL AND NEW.session_id IS NOT NULL THEN
      SELECT session.workspace_id
      INTO NEW.workspace_id
      FROM auth_sessions AS session
      WHERE session.id = NEW.session_id;
    END IF;
    RETURN NEW;
  END IF;

  context_user_id := NEW.user_id;
  IF context_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.workspace_id IS NULL THEN
    resolved_workspace_id := ensure_auth_user_workspace(
      context_user_id,
      COALESCE(NEW.created_at, CLOCK_TIMESTAMP())
    );
    NEW.workspace_id := resolved_workspace_id;
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM workspace_members AS membership
    JOIN workspaces AS workspace
      ON workspace.id = membership.workspace_id
    WHERE membership.workspace_id = NEW.workspace_id
      AND membership.user_id = context_user_id
      AND membership.status = 'active'
      AND workspace.status = 'active'
      AND workspace.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'active workspace membership is required';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER auth_sessions_assign_workspace
BEFORE INSERT OR UPDATE OF user_id, workspace_id ON auth_sessions
FOR EACH ROW
EXECUTE FUNCTION assign_auth_workspace_context();

CREATE TRIGGER auth_challenges_assign_workspace
BEFORE INSERT OR UPDATE OF user_id, workspace_id ON auth_challenges
FOR EACH ROW
EXECUTE FUNCTION assign_auth_workspace_context();

CREATE TRIGGER auth_security_events_assign_workspace
BEFORE INSERT ON auth_security_events
FOR EACH ROW
EXECUTE FUNCTION assign_auth_workspace_context();

ALTER TABLE auth_sessions
  ADD CONSTRAINT auth_sessions_workspace_member_fkey
    FOREIGN KEY (workspace_id, user_id)
    REFERENCES workspace_members(workspace_id, user_id)
    ON DELETE RESTRICT;

ALTER TABLE auth_challenges
  ADD CONSTRAINT auth_challenges_workspace_fkey
    FOREIGN KEY (workspace_id)
    REFERENCES workspaces(id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT auth_challenges_workspace_member_fkey
    FOREIGN KEY (workspace_id, user_id)
    REFERENCES workspace_members(workspace_id, user_id)
    ON DELETE RESTRICT;

ALTER TABLE workspace_invites
  ADD CONSTRAINT workspace_invites_inviter_member_fkey
    FOREIGN KEY (workspace_id, invited_by)
    REFERENCES workspace_members(workspace_id, user_id)
    ON DELETE RESTRICT;

COMMIT;
