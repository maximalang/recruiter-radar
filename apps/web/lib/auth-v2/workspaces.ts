import { getPool } from "../db-pool";
import { logError } from "../runtime";

const POSITIVE_ID_PATTERN = /^[1-9]\d*$/;
const MAX_POSTGRES_BIGINT = BigInt("9223372036854775807");

export const WORKSPACE_ROLES = [
  "owner",
  "admin",
  "recruiter",
  "viewer",
  "billing",
] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const WORKSPACE_PERMISSIONS = [
  "workspace:read",
  "workspace:update",
  "members:read",
  "members:invite",
  "members:manage",
  "billing:read",
  "billing:manage",
  "profiles:read",
  "profiles:write",
  "leads:read",
  "leads:write",
  "opportunities:read",
  "opportunities:write",
  "notifications:read",
  "notifications:write",
  "exports:create",
] as const;

export type WorkspacePermission = (typeof WORKSPACE_PERMISSIONS)[number];

const allPermissions = new Set<WorkspacePermission>(WORKSPACE_PERMISSIONS);
const productReadPermissions = [
  "workspace:read",
  "members:read",
  "profiles:read",
  "leads:read",
  "opportunities:read",
  "notifications:read",
] as const satisfies readonly WorkspacePermission[];
const productWritePermissions = [
  ...productReadPermissions,
  "profiles:write",
  "leads:write",
  "opportunities:write",
  "notifications:write",
  "exports:create",
] as const satisfies readonly WorkspacePermission[];

const ROLE_PERMISSIONS: Readonly<
  Record<WorkspaceRole, ReadonlySet<WorkspacePermission>>
> = {
  owner: allPermissions,
  admin: new Set([
    ...productWritePermissions,
    "workspace:update",
    "members:invite",
    "members:manage",
    "billing:read",
  ]),
  recruiter: new Set(productWritePermissions),
  viewer: new Set(productReadPermissions),
  billing: new Set([
    "workspace:read",
    "billing:read",
    "billing:manage",
  ]),
};

export type ActiveWorkspace = {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
};

type WorkspaceRow = ActiveWorkspace;

export class WorkspaceAccessDeniedError extends Error {
  constructor() {
    super("Active workspace access required.");
    this.name = "WorkspaceAccessDeniedError";
  }
}

function validId(value: string): boolean {
  if (!POSITIVE_ID_PATTERN.test(value)) return false;
  try {
    return BigInt(value) <= MAX_POSTGRES_BIGINT;
  } catch {
    return false;
  }
}

function isWorkspaceRole(value: string): value is WorkspaceRole {
  return (WORKSPACE_ROLES as readonly string[]).includes(value);
}

export function hasWorkspacePermission(
  role: WorkspaceRole,
  permission: WorkspacePermission,
): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export async function getActiveWorkspace(input: {
  userId: string;
  workspaceId: string;
}): Promise<ActiveWorkspace | null> {
  if (!validId(input.userId) || !validId(input.workspaceId)) return null;

  const pool = getPool();
  if (!pool) return null;
  try {
    const result = await pool.query<WorkspaceRow>(
      `SELECT
         workspace.id::TEXT AS id,
         workspace.name,
         workspace.slug,
         membership.role
       FROM workspace_members AS membership
       JOIN workspaces AS workspace
         ON workspace.id = membership.workspace_id
       WHERE membership.user_id = $1
         AND membership.workspace_id = $2
         AND membership.status = 'active'
         AND workspace.status = 'active'
         AND workspace.deleted_at IS NULL
       LIMIT 1`,
      [input.userId, input.workspaceId],
    );
    const workspace = result.rows[0];
    if (!workspace || !isWorkspaceRole(workspace.role)) return null;
    return workspace;
  } catch (error) {
    logError("auth_v2.workspace_read_failed", error);
    return null;
  }
}

export async function requireWorkspace(input: {
  userId: string;
  workspaceId: string;
}): Promise<ActiveWorkspace> {
  const workspace = await getActiveWorkspace(input);
  if (!workspace) throw new WorkspaceAccessDeniedError();
  return workspace;
}

export async function requireWorkspaceRole(input: {
  userId: string;
  workspaceId: string;
  roles: readonly WorkspaceRole[];
}): Promise<ActiveWorkspace> {
  const workspace = await requireWorkspace(input);
  if (!input.roles.includes(workspace.role)) {
    throw new WorkspaceAccessDeniedError();
  }
  return workspace;
}

export async function requireWorkspacePermission(input: {
  userId: string;
  workspaceId: string;
  permission: WorkspacePermission;
}): Promise<ActiveWorkspace> {
  const workspace = await requireWorkspace(input);
  if (!hasWorkspacePermission(workspace.role, input.permission)) {
    throw new WorkspaceAccessDeniedError();
  }
  return workspace;
}
