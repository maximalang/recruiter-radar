jest.mock("@/lib/auth-v2/current-session", () => ({
  readCurrentAuthSession: jest.fn(),
}));
jest.mock("@/lib/auth-v2/passkeys", () => ({
  beginPasskeyAuthentication: jest.fn(),
  beginPasskeyRegistration: jest.fn(),
  finishPasskeyAuthentication: jest.fn(),
  finishPasskeyRegistration: jest.fn(),
  removeUserPasskey: jest.fn(),
  renameUserPasskey: jest.fn(),
}));
jest.mock("@/lib/auth-v2/session-cookie", () => ({
  readAuthV2SessionCookie: jest.fn(),
  writeAuthV2SessionCookie: jest.fn(),
}));
jest.mock("@/lib/auth-v2/sessions", () => ({
  isRecentAuthentication: jest.fn(() => true),
  readAuthSession: jest.fn(),
}));
jest.mock("@/lib/auth-v2/session-environment", () => ({
  classifyAuthSessionEnvironment: jest.fn(() => ({
    deviceLabel: "Computer",
    browserLabel: "Chrome",
    environmentLabel: "Windows",
  })),
}));
jest.mock("@/lib/session", () => ({
  clearLegacyOwnerSession: jest.fn(),
}));

import { POST as registrationOptions } from "@/app/api/auth/passkeys/registration/options/route";
import { POST as registrationVerify } from "@/app/api/auth/passkeys/registration/verify/route";
import { POST as authenticationOptions } from "@/app/api/auth/passkeys/authentication/options/route";
import { POST as authenticationVerify } from "@/app/api/auth/passkeys/authentication/verify/route";
import {
  DELETE as deletePasskey,
  PATCH as renamePasskey,
} from "@/app/api/auth/passkeys/[id]/route";
import { readCurrentAuthSession } from "@/lib/auth-v2/current-session";
import {
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
  removeUserPasskey,
  renameUserPasskey,
} from "@/lib/auth-v2/passkeys";
import {
  readAuthV2SessionCookie,
  writeAuthV2SessionCookie,
} from "@/lib/auth-v2/session-cookie";
import {
  readAuthSession,
} from "@/lib/auth-v2/sessions";

const mockReadCurrentSession = jest.mocked(readCurrentAuthSession);
const mockBeginAuthentication = jest.mocked(beginPasskeyAuthentication);
const mockBeginRegistration = jest.mocked(beginPasskeyRegistration);
const mockFinishAuthentication = jest.mocked(finishPasskeyAuthentication);
const mockFinishRegistration = jest.mocked(finishPasskeyRegistration);
const mockRemovePasskey = jest.mocked(removeUserPasskey);
const mockRenamePasskey = jest.mocked(renameUserPasskey);
const mockReadSessionCookie = jest.mocked(readAuthV2SessionCookie);
const mockWriteSessionCookie = jest.mocked(writeAuthV2SessionCookie);
const mockReadSession = jest.mocked(readAuthSession);
const timestamp = new Date("2026-07-29T12:00:00.000Z");
const session = {
  id: "17",
  userId: "42",
  workspaceId: "9",
  authMethod: "magic_link",
  deviceLabel: null,
  browserLabel: null,
  environmentLabel: null,
  createdAt: timestamp,
  lastSeenAt: timestamp,
  idleExpiresAt: timestamp,
  absoluteExpiresAt: timestamp,
  rotatedAt: timestamp,
  lastAuthenticatedAt: timestamp,
  rotationDue: false,
} as const;

function request(pathname: string, body?: unknown, origin = "https://radar.example") {
  return new Request(`https://radar.example${pathname}`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Sec-Fetch-Site": origin === "https://radar.example"
        ? "same-origin"
        : "cross-site",
      "Content-Type": "application/json",
      "User-Agent": "Test Browser",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function requestWithDeclaredLength(
  pathname: string,
  body: string,
  contentLength: number,
): Request {
  return new Request(`https://radar.example${pathname}`, {
    method: "POST",
    headers: {
      Origin: "https://radar.example",
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json",
      "Content-Length": String(contentLength),
      "User-Agent": "Test Browser",
    },
    body,
  });
}

describe("auth v2 passkey HTTP boundaries", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AUTH_SITE_URL = "https://radar.example";
    process.env.AUTH_PLATFORM_V2_ENABLED = "true";
    process.env.AUTH_PASSKEYS_ENABLED = "true";
    mockReadCurrentSession.mockResolvedValue(session);
    mockReadSessionCookie.mockResolvedValue(null);
    mockReadSession.mockResolvedValue(null);
    mockBeginRegistration.mockResolvedValue({ challenge: "registration" } as never);
    mockFinishRegistration.mockResolvedValue({
      ok: true,
      passkey: { id: "7", name: "MacBook" },
    } as never);
    mockBeginAuthentication.mockResolvedValue({ challenge: "authentication" } as never);
    mockFinishAuthentication.mockResolvedValue({
      ok: true,
      userId: "42",
      onboardingRequired: false,
      returnTo: "/dashboard",
      session: { id: "91", token: "a".repeat(64) },
    });
    mockRenamePasskey.mockResolvedValue(true);
    mockRemovePasskey.mockResolvedValue("removed");
  });

  afterAll(() => {
    delete process.env.AUTH_SITE_URL;
    delete process.env.AUTH_PLATFORM_V2_ENABLED;
    delete process.env.AUTH_PASSKEYS_ENABLED;
  });

  test("rejects anonymous or cross-origin registration before issuing a challenge", async () => {
    mockReadCurrentSession.mockResolvedValueOnce(null);
    const anonymous = await registrationOptions(request(
      "/api/auth/passkeys/registration/options",
    ));
    const crossOrigin = await registrationOptions(request(
      "/api/auth/passkeys/registration/options",
      undefined,
      "https://attacker.example",
    ));

    expect(anonymous.status).toBe(401);
    expect(crossOrigin.status).toBe(403);
    expect(mockBeginRegistration).not.toHaveBeenCalled();
  });

  test("issues and verifies registration only for the active recent session", async () => {
    const options = await registrationOptions(request(
      "/api/auth/passkeys/registration/options",
    ));
    const verification = await registrationVerify(request(
      "/api/auth/passkeys/registration/verify",
      { name: "MacBook", response: { id: "credential" } },
    ));

    expect(mockBeginRegistration).toHaveBeenCalledWith(expect.objectContaining({
      session,
      userAgent: "Test Browser",
    }));
    expect(mockFinishRegistration).toHaveBeenCalledWith(expect.objectContaining({
      session,
      name: "MacBook",
      response: { id: "credential" },
    }));
    expect(options.headers.get("Cache-Control")).toContain("no-store");
    expect(verification.status).toBe(200);
  });

  test("keeps authentication discoverable and rotates away an existing browser session", async () => {
    mockReadSessionCookie.mockResolvedValue("b".repeat(64));
    mockReadSession.mockResolvedValue({
      ...session,
      id: "19",
      userId: "55",
    });

    const options = await authenticationOptions(request(
      "/api/auth/passkeys/authentication/options",
      { returnTo: "/settings/security" },
    ));
    const verification = await authenticationVerify(request(
      "/api/auth/passkeys/authentication/verify",
      { response: { id: "credential" } },
    ));

    expect(mockBeginAuthentication).toHaveBeenCalledWith(expect.objectContaining({
      returnTo: "/settings/security",
    }));
    expect(mockFinishAuthentication).toHaveBeenCalledWith(expect.objectContaining({
      response: { id: "credential" },
      replaceSession: {
        id: "19",
        userId: "55",
      },
      sessionEnvironment: {
        deviceLabel: "Computer",
        browserLabel: "Chrome",
        environmentLabel: "Windows",
      },
    }));
    expect(mockWriteSessionCookie).toHaveBeenCalledWith("a".repeat(64));
    await expect(options.json()).resolves.toEqual({
      ok: true,
      options: { challenge: "authentication" },
    });
    await expect(verification.json()).resolves.toEqual({
      ok: true,
      destination: "/dashboard",
    });
  });

  test("does not disclose whether an authentication credential exists", async () => {
    mockFinishAuthentication.mockResolvedValue({
      ok: false,
      code: "verification_failed",
    });

    const response = await authenticationVerify(request(
      "/api/auth/passkeys/authentication/verify",
      { response: { id: "unknown" } },
    ));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "authentication_failed",
    });
    expect(mockWriteSessionCookie).not.toHaveBeenCalled();
  });

  test("rejects oversized public passkey bodies before ceremony work", async () => {
    const options = await authenticationOptions(requestWithDeclaredLength(
      "/api/auth/passkeys/authentication/options",
      "{}",
      2 * 1024 + 1,
    ));
    const verification = await authenticationVerify(requestWithDeclaredLength(
      "/api/auth/passkeys/authentication/verify",
      '{"response":{}}',
      32 * 1024 + 1,
    ));

    expect(options.status).toBe(400);
    expect(verification.status).toBe(400);
    expect(mockBeginAuthentication).not.toHaveBeenCalled();
    expect(mockFinishAuthentication).not.toHaveBeenCalled();
  });

  test("scopes rename and removal to the current account", async () => {
    const rename = await renamePasskey(
      request("/api/auth/passkeys/7", { name: "Work laptop" }),
      { params: Promise.resolve({ id: "7" }) },
    );
    const remove = await deletePasskey(
      request("/api/auth/passkeys/7"),
      { params: Promise.resolve({ id: "7" }) },
    );

    expect(mockRenamePasskey).toHaveBeenCalledWith({
      userId: "42",
      passkeyId: "7",
      name: "Work laptop",
    });
    expect(mockRemovePasskey).toHaveBeenCalledWith({
      session,
      passkeyId: "7",
    });
    expect(rename.status).toBe(200);
    expect(remove.status).toBe(200);
  });
});
