jest.mock("next/headers", () => ({
  headers: jest.fn(),
}));
jest.mock("next/navigation", () => ({
  redirect: jest.fn(),
}));
jest.mock("@/lib/auth-v2/current-session", () => ({
  readCurrentAuthSession: jest.fn(),
}));
jest.mock("@/lib/auth-v2/account-security", () => ({
  ACCOUNT_DELETION_CONFIRMATION: "УДАЛИТЬ АККАУНТ",
  requestAccountDeletion: jest.fn(),
  requestAccountEmailChange: jest.fn(),
}));
jest.mock("@/lib/auth-v2/session-cookie", () => ({
  clearAuthV2SessionCookie: jest.fn(),
}));
jest.mock("@/lib/auth-v2/sessions", () => ({
  revokeAllAuthSessions: jest.fn(),
  revokeAuthSessionById: jest.fn(),
}));

import {
  deleteAccountAction,
  endAllSessionsAction,
  endCurrentSessionAction,
  endOtherSessionsAction,
  requestEmailChangeAction,
  revokeSessionAction,
} from "@/app/settings/security/actions";
import {
  requestAccountDeletion,
  requestAccountEmailChange,
} from "@/lib/auth-v2/account-security";
import { readCurrentAuthSession } from "@/lib/auth-v2/current-session";
import { clearAuthV2SessionCookie } from "@/lib/auth-v2/session-cookie";
import {
  revokeAllAuthSessions,
  revokeAuthSessionById,
} from "@/lib/auth-v2/sessions";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

const mockHeaders = jest.mocked(headers);
const mockRedirect = jest.mocked(redirect);
const mockReadSession = jest.mocked(readCurrentAuthSession);
const mockDelete = jest.mocked(requestAccountDeletion);
const mockEmailChange = jest.mocked(requestAccountEmailChange);
const mockClearCookie = jest.mocked(clearAuthV2SessionCookie);
const mockRevokeAll = jest.mocked(revokeAllAuthSessions);
const mockRevokeById = jest.mocked(revokeAuthSessionById);
const session = {
  id: "77",
  userId: "42",
  workspaceId: "9",
  lastAuthenticatedAt: new Date(),
} as never;

describe("auth v2 account security actions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AUTH_SITE_URL = "https://radar.example";
    mockHeaders.mockResolvedValue(new Headers({
      Origin: "https://radar.example",
      "Sec-Fetch-Site": "same-origin",
    }) as never);
    mockReadSession.mockResolvedValue(session);
    mockRevokeById.mockResolvedValue(true);
    mockRevokeAll.mockResolvedValue(2);
    mockEmailChange.mockResolvedValue({ ok: true, delivery: "sent" });
    mockDelete.mockResolvedValue({ ok: true });
  });

  afterAll(() => {
    delete process.env.AUTH_SITE_URL;
  });

  test("scopes a selected-session revocation to the authenticated user", async () => {
    const formData = new FormData();
    formData.set("sessionId", "88");
    formData.set("userId", "999");

    await revokeSessionAction(formData);

    expect(mockRevokeById).toHaveBeenCalledWith({
      userId: "42",
      sessionId: "88",
      reason: "security_action",
    });
    expect(mockRedirect).toHaveBeenCalledWith(
      "/settings/security?sessions=ended",
    );
  });

  test("ends the current session and clears only the server cookie", async () => {
    await endCurrentSessionAction();

    expect(mockRevokeById).toHaveBeenCalledWith({
      userId: "42",
      sessionId: "77",
      reason: "logout",
    });
    expect(mockClearCookie).toHaveBeenCalledTimes(1);
    expect(mockRedirect).toHaveBeenCalledWith("/login?loggedOut=1");
  });

  test("keeps the current session when ending all other sessions", async () => {
    await endOtherSessionsAction();

    expect(mockRevokeAll).toHaveBeenCalledWith({
      userId: "42",
      exceptSessionId: "77",
    });
    expect(mockClearCookie).not.toHaveBeenCalled();
  });

  test("ends every session and clears the current cookie", async () => {
    await endAllSessionsAction();

    expect(mockRevokeAll).toHaveBeenCalledWith({ userId: "42" });
    expect(mockClearCookie).toHaveBeenCalledTimes(1);
    expect(mockRedirect).toHaveBeenCalledWith("/login?loggedOut=all");
  });

  test("keeps the cookie when current-session revocation fails", async () => {
    mockRevokeById.mockResolvedValue(false);

    await endCurrentSessionAction();

    expect(mockClearCookie).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith(
      "/settings/security?sessions=unavailable",
    );
  });

  test("does not claim other-session success when the database is unavailable", async () => {
    mockRevokeAll.mockResolvedValue(null);

    await endOtherSessionsAction();

    expect(mockRedirect).toHaveBeenCalledWith(
      "/settings/security?sessions=unavailable",
    );
    expect(mockRedirect).not.toHaveBeenCalledWith(
      "/settings/security?sessions=others-ended",
    );
  });

  test("keeps the cookie when all-session revocation is unavailable", async () => {
    mockRevokeAll.mockResolvedValue(null);

    await endAllSessionsAction();

    expect(mockClearCookie).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith(
      "/settings/security?sessions=unavailable",
    );
    expect(mockRedirect).not.toHaveBeenCalledWith("/login?loggedOut=all");
  });

  test("rejects cross-origin mutations before resolving a session", async () => {
    mockHeaders.mockResolvedValue(new Headers({
      Origin: "https://attacker.example",
      "Sec-Fetch-Site": "cross-site",
    }) as never);
    mockRedirect.mockImplementationOnce(() => {
      throw new Error("redirected");
    });

    await expect(endAllSessionsAction()).rejects.toThrow("redirected");

    expect(mockReadSession).not.toHaveBeenCalled();
    expect(mockRevokeAll).not.toHaveBeenCalled();
  });

  test("passes only the new email and server-derived session to the core", async () => {
    const formData = new FormData();
    formData.set("email", "new@example.com");
    formData.set("workspaceId", "999");

    await requestEmailChangeAction(formData);

    expect(mockEmailChange).toHaveBeenCalledWith({
      session,
      newEmail: "new@example.com",
    });
    expect(mockRedirect).toHaveBeenCalledWith(
      "/settings/security?email=requested",
    );
  });

  test("turns recent-auth failures into an explicit reauthentication CTA", async () => {
    mockEmailChange.mockResolvedValue({
      ok: false,
      code: "reauth_required",
    });

    await requestEmailChangeAction(new FormData());

    expect(mockRedirect).toHaveBeenCalledWith(
      "/settings/security?email=reauth",
    );
  });

  test("deletes only after the core validates the exact phrase", async () => {
    const formData = new FormData();
    formData.set("confirmation", "УДАЛИТЬ АККАУНТ");
    formData.set("userId", "999");

    await deleteAccountAction(formData);

    expect(mockDelete).toHaveBeenCalledWith({
      session,
      confirmation: "УДАЛИТЬ АККАУНТ",
    });
    expect(mockClearCookie).toHaveBeenCalledTimes(1);
    expect(mockRedirect).toHaveBeenCalledWith(
      "/login?accountDeletion=requested",
    );
  });
});
