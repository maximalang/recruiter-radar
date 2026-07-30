import { checkOperatorAccess, type OperatorAuthResult } from "../operator-auth";
import { readOwnerSession } from "../session";
import {
  isAuthV2SessionReadEnabledForUser,
  isAuthWorkspacesV2EnabledForUser,
} from "./config";
import { readAuthV2SessionCookieState } from "./session-cookie";
import {
  readAuthSession,
  requireRecentAuthentication as requireSessionRecentAuthentication,
  type AuthSession,
} from "./sessions";
import {
  getActiveWorkspace,
  hasWorkspacePermission,
  type WorkspacePermission,
  type WorkspaceRole,
} from "./workspaces";

export type CustomerAuthorization = {
  mode: "auth_v2" | "auth_v2_compat" | "legacy";
  userId: string;
  dataOwnerId: string;
  workspaceId: string | null;
  role: WorkspaceRole | null;
  session: AuthSession | null;
};

export class AuthorizationRequiredError extends Error {
  constructor() {
    super("Customer authorization required.");
    this.name = "AuthorizationRequiredError";
  }
}

export class SystemAdminRequiredError extends Error {
  constructor() {
    super("System administrator authorization required.");
    this.name = "SystemAdminRequiredError";
  }
}

type CustomerAuthorizationOptions = {
  permission?: WorkspacePermission;
  permissions?: readonly WorkspacePermission[];
};

export async function getSession(
  options: CustomerAuthorizationOptions = {},
): Promise<CustomerAuthorization | null> {
  const v2Cookie = await readAuthV2SessionCookieState();
  if (v2Cookie.status === "invalid") return null;

  if (v2Cookie.status === "valid") {
    const session = await readAuthSession(v2Cookie.token);
    if (
      !session
      || session.rotationDue
      || !isAuthV2SessionReadEnabledForUser(session.userId)
    ) {
      return null;
    }

    if (isAuthWorkspacesV2EnabledForUser(session.userId)) {
      if (!session.workspaceId) return null;
      let workspace;
      try {
        workspace = await getActiveWorkspace({
          userId: session.userId,
          workspaceId: session.workspaceId,
        });
      } catch {
        return null;
      }
      if (!workspace) return null;

      const requiredPermissions = [
        ...(options.permission ? [options.permission] : []),
        ...(options.permissions ?? []),
      ];
      if (
        requiredPermissions.some(
          (permission) => !hasWorkspacePermission(workspace.role, permission),
        )
      ) {
        return null;
      }

      return {
        mode: "auth_v2",
        userId: session.userId,
        dataOwnerId: workspace.bootstrapUserId,
        workspaceId: workspace.id,
        role: workspace.role,
        session,
      };
    }

    return {
      mode: "auth_v2_compat",
      userId: session.userId,
      dataOwnerId: session.userId,
      workspaceId: session.workspaceId,
      role: null,
      session,
    };
  }

  const legacyUserId = await readOwnerSession();
  if (!legacyUserId) return null;
  return {
    mode: "legacy",
    userId: legacyUserId,
    dataOwnerId: legacyUserId,
    workspaceId: null,
    role: null,
    session: null,
  };
}

export async function requireSession(
  options: CustomerAuthorizationOptions = {},
): Promise<CustomerAuthorization> {
  const authorization = await getSession(options);
  if (!authorization) throw new AuthorizationRequiredError();
  return authorization;
}

export function requireRecentAuthentication(
  authorization: Pick<CustomerAuthorization, "session">,
  now = new Date(),
  maxAgeSeconds?: number,
): void {
  requireSessionRecentAuthentication(
    authorization.session ?? { lastAuthenticatedAt: null },
    now,
    maxAgeSeconds,
  );
}

export async function getAuthorizedOwnerId(
  permission: WorkspacePermission,
): Promise<string | null> {
  return (await getSession({ permission }))?.dataOwnerId ?? null;
}

export async function getAuthorizedUserId(
  permission: WorkspacePermission,
): Promise<string | null> {
  return (await getSession({ permission }))?.userId ?? null;
}

export async function requireSystemAdmin(): Promise<
  Extract<OperatorAuthResult, { ok: true }>
> {
  const result = await checkOperatorAccess();
  if (!result.ok) throw new SystemAdminRequiredError();
  return result;
}
