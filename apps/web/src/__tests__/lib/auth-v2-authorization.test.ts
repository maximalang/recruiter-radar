jest.mock("@/lib/auth-v2/session-cookie", () => ({
  readAuthV2SessionCookieState: jest.fn(),
}));
jest.mock("@/lib/auth-v2/sessions", () => ({
  readAuthSession: jest.fn(),
  requireRecentAuthentication: jest.fn(),
}));
jest.mock("@/lib/auth-v2/config", () => ({
  isAuthV2SessionReadEnabledForUser: jest.fn(),
  isAuthWorkspacesV2EnabledForUser: jest.fn(),
}));
jest.mock("@/lib/auth-v2/workspaces", () => ({
  getActiveWorkspace: jest.fn(),
  hasWorkspacePermission: jest.fn(),
}));
jest.mock("@/lib/session", () => ({
  readOwnerSession: jest.fn(),
}));
jest.mock("@/lib/operator-auth", () => ({
  checkOperatorAccess: jest.fn(),
}));

import {
  getAuthorizedOwnerId,
  getSession,
  requireRecentAuthentication,
  requireSession,
  requireSystemAdmin,
} from "@/lib/auth-v2/authorization";
import {
  isAuthV2SessionReadEnabledForUser,
  isAuthWorkspacesV2EnabledForUser,
} from "@/lib/auth-v2/config";
import { readAuthV2SessionCookieState } from "@/lib/auth-v2/session-cookie";
import {
  readAuthSession,
  requireRecentAuthentication as requireSessionRecentAuthentication,
} from "@/lib/auth-v2/sessions";
import {
  getActiveWorkspace,
  hasWorkspacePermission,
} from "@/lib/auth-v2/workspaces";
import { checkOperatorAccess } from "@/lib/operator-auth";
import { readOwnerSession } from "@/lib/session";

const mockCheckOperatorAccess = jest.mocked(checkOperatorAccess);
const mockGetActiveWorkspace = jest.mocked(getActiveWorkspace);
const mockIsSessionReadEnabled = jest.mocked(
  isAuthV2SessionReadEnabledForUser,
);
const mockIsWorkspacesEnabled = jest.mocked(
  isAuthWorkspacesV2EnabledForUser,
);
const mockReadAuthSession = jest.mocked(readAuthSession);
const mockReadAuthV2CookieState = jest.mocked(readAuthV2SessionCookieState);
const mockReadOwnerSession = jest.mocked(readOwnerSession);
const mockRequireRecent = jest.mocked(
  requireSessionRecentAuthentication,
);
const mockHasWorkspacePermission = jest.mocked(hasWorkspacePermission);

const authSession = {
  id: "17",
  userId: "42",
  workspaceId: "9",
  authMethod: "magic_link",
  rotationDue: false,
  lastAuthenticatedAt: new Date("2026-07-29T12:00:00.000Z"),
} as never;
const workspace = {
  id: "9",
  name: "Northstar",
  slug: "northstar",
  role: "recruiter",
  bootstrapUserId: "7",
} as const;

describe("Auth v2 authorization DAL", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadAuthV2CookieState.mockResolvedValue({ status: "absent" });
    mockReadOwnerSession.mockResolvedValue(null);
    mockIsSessionReadEnabled.mockReturnValue(true);
    mockIsWorkspacesEnabled.mockReturnValue(true);
    mockGetActiveWorkspace.mockResolvedValue(workspace);
    mockHasWorkspacePermission.mockReturnValue(true);
  });

  test("separates the actor from the workspace data owner and enforces permission", async () => {
    mockReadAuthV2CookieState.mockResolvedValue({
      status: "valid",
      token: "v2-token",
    });
    mockReadAuthSession.mockResolvedValue(authSession);

    await expect(getSession({
      permission: "leads:write",
    })).resolves.toEqual({
      mode: "auth_v2",
      userId: "42",
      dataOwnerId: "7",
      workspaceId: "9",
      role: "recruiter",
      session: authSession,
    });
    expect(mockHasWorkspacePermission).toHaveBeenCalledWith(
      "recruiter",
      "leads:write",
    );
    expect(mockReadOwnerSession).not.toHaveBeenCalled();
  });

  test("enforces every permission required by a composite surface", async () => {
    mockReadAuthV2CookieState.mockResolvedValue({
      status: "valid",
      token: "v2-token",
    });
    mockReadAuthSession.mockResolvedValue(authSession);
    mockHasWorkspacePermission.mockImplementation(
      (_role, permission) => permission !== "notifications:read",
    );

    await expect(getSession({
      permissions: [
        "workspace:read",
        "profiles:read",
        "notifications:read",
      ],
    })).resolves.toBeNull();
    expect(mockHasWorkspacePermission).toHaveBeenCalledWith(
      "recruiter",
      "workspace:read",
    );
    expect(mockHasWorkspacePermission).toHaveBeenCalledWith(
      "recruiter",
      "profiles:read",
    );
    expect(mockHasWorkspacePermission).toHaveBeenCalledWith(
      "recruiter",
      "notifications:read",
    );
    expect(mockReadOwnerSession).not.toHaveBeenCalled();
  });

  test("never falls back to a legacy identity when a present v2 cookie is malformed", async () => {
    mockReadAuthV2CookieState.mockResolvedValue({ status: "invalid" });
    mockReadOwnerSession.mockResolvedValue("99");

    await expect(getSession({
      permission: "profiles:read",
    })).resolves.toBeNull();
    expect(mockReadAuthSession).not.toHaveBeenCalled();
    expect(mockReadOwnerSession).not.toHaveBeenCalled();
  });

  test("never falls back to a legacy identity when the v2 cookie cannot be read", async () => {
    mockReadAuthV2CookieState.mockRejectedValue(new Error("cookie read failed"));
    mockReadOwnerSession.mockResolvedValue("99");

    await expect(getSession({
      permission: "profiles:read",
    })).rejects.toThrow("cookie read failed");
    expect(mockReadOwnerSession).not.toHaveBeenCalled();
  });

  test("fails closed on a denied workspace permission without legacy fallback", async () => {
    mockReadAuthV2CookieState.mockResolvedValue({
      status: "valid",
      token: "v2-token",
    });
    mockReadAuthSession.mockResolvedValue(authSession);
    mockHasWorkspacePermission.mockReturnValue(false);
    mockReadOwnerSession.mockResolvedValue("99");

    await expect(getAuthorizedOwnerId("billing:manage")).resolves.toBeNull();
    expect(mockReadOwnerSession).not.toHaveBeenCalled();
  });

  test("preserves the legacy compatibility path when no v2 cookie exists", async () => {
    mockReadOwnerSession.mockResolvedValue("11");

    await expect(getSession({
      permission: "opportunities:read",
    })).resolves.toEqual({
      mode: "legacy",
      userId: "11",
      dataOwnerId: "11",
      workspaceId: null,
      role: null,
      session: null,
    });
    expect(mockHasWorkspacePermission).not.toHaveBeenCalled();
  });

  test("requires an active context and delegates recent-auth verification", async () => {
    await expect(requireSession()).rejects.toMatchObject({
      name: "AuthorizationRequiredError",
    });

    mockReadAuthV2CookieState.mockResolvedValue({
      status: "valid",
      token: "v2-token",
    });
    mockReadAuthSession.mockResolvedValue(authSession);
    const context = await requireSession({ permission: "workspace:read" });
    const now = new Date("2026-07-29T12:01:00.000Z");
    requireRecentAuthentication(context, now, 300);
    expect(mockRequireRecent).toHaveBeenCalledWith(authSession, now, 300);
  });

  test("keeps system-admin authorization on the operator boundary", async () => {
    mockCheckOperatorAccess.mockResolvedValue({
      ok: true,
      via: "api-key",
    });
    await expect(requireSystemAdmin()).resolves.toEqual({
      ok: true,
      via: "api-key",
    });

    mockCheckOperatorAccess.mockResolvedValue({
      ok: false,
      reason: "invalid",
    });
    await expect(requireSystemAdmin()).rejects.toMatchObject({
      name: "SystemAdminRequiredError",
    });
  });
});
