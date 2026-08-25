jest.mock("@/lib/auth-v2/authorization", () => ({
  getSession: jest.fn(),
}));
jest.mock("@/lib/auth-v2/security", () => ({
  isAuthSameOriginRequest: jest.fn(),
}));
jest.mock("@/lib/trial", () => ({
  activateVerifiedTrial: jest.fn(),
}));

import { POST } from "@/app/api/trial/activate/route";
import { getSession } from "@/lib/auth-v2/authorization";
import { isAuthSameOriginRequest } from "@/lib/auth-v2/security";
import { activateVerifiedTrial } from "@/lib/trial";

const mockGetSession = jest.mocked(getSession);
const mockSameOrigin = jest.mocked(isAuthSameOriginRequest);
const mockActivate = jest.mocked(activateVerifiedTrial);

function request(): Request {
  return new Request("https://recruiter-radar.ru/api/trial/activate", {
    method: "POST",
    headers: { origin: "https://recruiter-radar.ru" },
  });
}

describe("trial activation route security", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSameOrigin.mockReturnValue(true);
  });

  test("rejects cross-origin requests before reading the session", async () => {
    mockSameOrigin.mockReturnValue(false);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  test("rejects legacy and workspace-less sessions", async () => {
    mockGetSession
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ mode: "legacy", userId: "42", dataOwnerId: "42", workspaceId: null } as never)
      .mockResolvedValueOnce({ mode: "auth_v2", userId: "42", dataOwnerId: "42", workspaceId: null } as never);

    await expect(POST(request())).resolves.toMatchObject({ status: 401 });
    await expect(POST(request())).resolves.toMatchObject({ status: 401 });
    await expect(POST(request())).resolves.toMatchObject({ status: 401 });
    expect(mockActivate).not.toHaveBeenCalled();
  });

  test("activates only the authenticated user's active workspace", async () => {
    mockGetSession.mockResolvedValue({
      mode: "auth_v2",
      userId: "42",
      dataOwnerId: "42",
      workspaceId: "9",
      role: "owner",
      session: null,
    } as never);
    mockActivate.mockResolvedValue({
      status: "activated",
      claimId: "91",
      grantId: "92",
      startsAt: "2026-08-25T12:00:00.000Z",
      endsAt: "2026-08-28T12:00:00.000Z",
    });

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ status: "activated", claimId: "91" });
    expect(mockActivate).toHaveBeenCalledWith({ userId: "42", workspaceId: "9" });
  });

  test("does not expose internal failures or allow activation bypass", async () => {
    mockGetSession.mockResolvedValue({
      mode: "auth_v2",
      userId: "42",
      dataOwnerId: "42",
      workspaceId: "9",
      role: "owner",
      session: null,
    } as never);
    mockActivate.mockRejectedValue(new Error("database password leaked"));

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "trial_unavailable" });
  });
});
