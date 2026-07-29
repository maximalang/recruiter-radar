jest.mock("@/lib/auth-v2/config", () => ({
  isAuthPlatformV2EnabledForUser: jest.fn(),
  isAuthWorkspacesV2EnabledForUser: jest.fn(),
}));
jest.mock("@/lib/auth-v2/session-cookie", () => ({
  readAuthV2SessionCookie: jest.fn(),
}));
jest.mock("@/lib/auth-v2/sessions", () => ({
  readAuthSession: jest.fn(),
}));

import {
  isAuthPlatformV2EnabledForUser,
  isAuthWorkspacesV2EnabledForUser,
} from "@/lib/auth-v2/config";
import { readCurrentAuthSession } from "@/lib/auth-v2/current-session";
import { readAuthV2SessionCookie } from "@/lib/auth-v2/session-cookie";
import {
  readAuthSession,
  type AuthSession,
} from "@/lib/auth-v2/sessions";

const mockEnabled = jest.mocked(isAuthPlatformV2EnabledForUser);
const mockWorkspacesEnabled = jest.mocked(isAuthWorkspacesV2EnabledForUser);
const mockReadCookie = jest.mocked(readAuthV2SessionCookie);
const mockReadSession = jest.mocked(readAuthSession);
const sessionTimestamp = new Date("2026-07-29T12:00:00.000Z");
const session: AuthSession = {
  id: "17",
  userId: "42",
  workspaceId: "9",
  authMethod: "magic_link",
  deviceLabel: null,
  browserLabel: null,
  environmentLabel: null,
  createdAt: sessionTimestamp,
  lastSeenAt: sessionTimestamp,
  idleExpiresAt: sessionTimestamp,
  absoluteExpiresAt: sessionTimestamp,
  rotatedAt: sessionTimestamp,
  lastAuthenticatedAt: sessionTimestamp,
  rotationDue: false,
};

describe("auth v2 current server session boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadCookie.mockResolvedValue("a".repeat(64));
    mockReadSession.mockResolvedValue(session);
    mockEnabled.mockReturnValue(true);
    mockWorkspacesEnabled.mockReturnValue(true);
  });

  test("returns the database session without exposing the cookie token", async () => {
    await expect(readCurrentAuthSession()).resolves.toBe(session);
    expect(mockReadSession).toHaveBeenCalledWith("a".repeat(64));
    expect(readCurrentAuthSession).not.toHaveProperty("token");
  });

  test("fails closed before a session lookup when the cookie is unavailable", async () => {
    mockReadCookie.mockResolvedValue(null);

    await expect(readCurrentAuthSession()).resolves.toBeNull();
    expect(mockReadSession).not.toHaveBeenCalled();
  });

  test("fails closed when the platform rollout does not include the user", async () => {
    mockEnabled.mockReturnValue(false);

    await expect(readCurrentAuthSession()).resolves.toBeNull();
  });

  test("requires an active workspace only when the caller asks for one", async () => {
    mockReadSession.mockResolvedValue({
      ...session,
      workspaceId: null,
    });

    await expect(readCurrentAuthSession()).resolves.toMatchObject({
      userId: "42",
      workspaceId: null,
    });
    await expect(readCurrentAuthSession({
      requireWorkspace: true,
    })).resolves.toBeNull();
  });

  test("fails closed when a workspace route is outside the workspace rollout", async () => {
    mockWorkspacesEnabled.mockReturnValue(false);

    await expect(readCurrentAuthSession({
      requireWorkspace: true,
    })).resolves.toBeNull();
    expect(mockWorkspacesEnabled).toHaveBeenCalledWith("42");
  });
});
