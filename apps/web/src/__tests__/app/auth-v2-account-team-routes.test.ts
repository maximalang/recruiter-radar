jest.mock("@/lib/auth-v2/account-security", () => ({
  confirmAccountEmailChange: jest.fn(),
}));
jest.mock("@/lib/auth-v2/current-session", () => ({
  readCurrentAuthSession: jest.fn(),
}));
jest.mock("@/lib/auth-v2/pending-action-cookie", () => ({
  clearPendingAuthActionToken: jest.fn(),
  readPendingAuthActionToken: jest.fn(),
  writePendingAuthActionToken: jest.fn(),
}));
jest.mock("@/lib/auth-v2/session-cookie", () => ({
  readAuthV2SessionCookie: jest.fn(),
  writeAuthV2SessionCookie: jest.fn(),
}));
jest.mock("@/lib/auth-v2/sessions", () => ({
  changeActiveWorkspace: jest.fn(),
}));
jest.mock("@/lib/auth-v2/workspace-team", () => ({
  acceptWorkspaceInvite: jest.fn(),
}));

import { POST as prepareEmail } from "@/app/api/auth/email-change/prepare/route";
import { POST as confirmEmail } from "@/app/api/auth/email-change/confirm/route";
import { POST as prepareInvite } from "@/app/api/auth/invite/prepare/route";
import { POST as acceptInvite } from "@/app/api/auth/invite/accept/route";
import { confirmAccountEmailChange } from "@/lib/auth-v2/account-security";
import { readCurrentAuthSession } from "@/lib/auth-v2/current-session";
import {
  clearPendingAuthActionToken,
  readPendingAuthActionToken,
  writePendingAuthActionToken,
} from "@/lib/auth-v2/pending-action-cookie";
import {
  readAuthV2SessionCookie,
  writeAuthV2SessionCookie,
} from "@/lib/auth-v2/session-cookie";
import {
  changeActiveWorkspace,
  type AuthSession,
} from "@/lib/auth-v2/sessions";
import { acceptWorkspaceInvite } from "@/lib/auth-v2/workspace-team";

const mockConfirmEmail = jest.mocked(confirmAccountEmailChange);
const mockReadSession = jest.mocked(readCurrentAuthSession);
const mockClearPending = jest.mocked(clearPendingAuthActionToken);
const mockReadPending = jest.mocked(readPendingAuthActionToken);
const mockWritePending = jest.mocked(writePendingAuthActionToken);
const mockReadSessionCookie = jest.mocked(readAuthV2SessionCookie);
const mockWriteSessionCookie = jest.mocked(writeAuthV2SessionCookie);
const mockChangeWorkspace = jest.mocked(changeActiveWorkspace);
const mockAcceptInvite = jest.mocked(acceptWorkspaceInvite);
const sessionTimestamp = new Date("2026-07-29T12:00:00.000Z");
const session: AuthSession = {
  id: "77",
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

function request(
  pathname: string,
  body?: unknown,
  origin = "https://radar.example",
): Request {
  return new Request(`https://radar.example${pathname}`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Sec-Fetch-Site": origin === "https://radar.example"
        ? "same-origin"
        : "cross-site",
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("auth v2 email-change and invite routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AUTH_SITE_URL = "https://radar.example";
    mockReadSession.mockResolvedValue(session);
    mockReadPending.mockResolvedValue("a".repeat(64));
    mockReadSessionCookie.mockResolvedValue("b".repeat(64));
    mockConfirmEmail.mockResolvedValue({
      ok: true,
      preservedCurrentSession: true,
    });
    mockAcceptInvite.mockResolvedValue({
      ok: true,
      workspaceId: "19",
    });
    mockChangeWorkspace.mockResolvedValue({
      token: "c".repeat(64),
      session: { ...session, workspaceId: "19" },
    });
  });

  afterAll(() => {
    delete process.env.AUTH_SITE_URL;
  });

  test("moves fragment tokens into the correct HttpOnly pending cookie", async () => {
    const emailResponse = await prepareEmail(request(
      "/api/auth/email-change/prepare",
      { token: "d".repeat(64) },
    ));
    const inviteResponse = await prepareInvite(request(
      "/api/auth/invite/prepare",
      { token: "e".repeat(64) },
    ));

    expect(mockWritePending).toHaveBeenNthCalledWith(
      1,
      "email_change",
      "d".repeat(64),
    );
    expect(mockWritePending).toHaveBeenNthCalledWith(
      2,
      "workspace_invite",
      "e".repeat(64),
    );
    await expect(emailResponse.json()).resolves.toEqual({ ok: true });
    await expect(inviteResponse.json()).resolves.toEqual({ ok: true });
  });

  test("rejects malformed or cross-origin prepare requests without a cookie write", async () => {
    const malformed = await prepareEmail(request(
      "/api/auth/email-change/prepare",
      { token: "invalid" },
    ));
    const crossOrigin = await prepareInvite(request(
      "/api/auth/invite/prepare",
      { token: "e".repeat(64) },
      "https://attacker.example",
    ));

    expect(malformed.status).toBe(400);
    expect(crossOrigin.status).toBe(403);
    expect(mockWritePending).not.toHaveBeenCalled();
  });

  test("confirms an email from the pending cookie and preserves only a matching current session", async () => {
    const response = await confirmEmail(request(
      "/api/auth/email-change/confirm",
    ));

    expect(mockConfirmEmail).toHaveBeenCalledWith({
      token: "a".repeat(64),
      currentSession: session,
    });
    expect(mockClearPending).toHaveBeenCalledWith("email_change");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      destination: "/settings/security?email=changed",
    });
  });

  test("keeps an invite pending across the required login boundary", async () => {
    mockReadSession.mockResolvedValue(null);

    const response = await acceptInvite(request("/api/auth/invite/accept"));

    expect(response.status).toBe(401);
    expect(mockAcceptInvite).not.toHaveBeenCalled();
    expect(mockClearPending).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      ok: false,
      loginUrl: "/login?returnTo=/auth/invite",
    });
  });

  test("accepts the email-bound invite and rotates into the accepted workspace", async () => {
    const response = await acceptInvite(request("/api/auth/invite/accept"));

    expect(mockAcceptInvite).toHaveBeenCalledWith({
      token: "a".repeat(64),
      session,
    });
    expect(mockChangeWorkspace).toHaveBeenCalledWith({
      token: "b".repeat(64),
      workspaceId: "19",
    });
    expect(mockWriteSessionCookie).toHaveBeenCalledWith("c".repeat(64));
    expect(mockClearPending).toHaveBeenCalledWith("workspace_invite");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      destination: "/dashboard?invite=accepted",
    });
  });

  test("clears a wrong-email invite without disclosing it to another account later", async () => {
    mockAcceptInvite.mockResolvedValue({
      ok: false,
      code: "email_mismatch",
    });

    const response = await acceptInvite(request("/api/auth/invite/accept"));

    expect(response.status).toBe(403);
    expect(mockClearPending).toHaveBeenCalledWith("workspace_invite");
    expect(mockChangeWorkspace).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "email_mismatch",
    });
  });
});
