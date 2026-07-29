jest.mock("@/lib/db-pool", () => ({
  getPool: jest.fn(),
}));

import { getPool } from "@/lib/db-pool";
import {
  RecentAuthenticationRequiredError,
  listAuthSessions,
  requireRecentAuthentication,
} from "@/lib/auth-v2/sessions";
import { classifyAuthSessionEnvironment } from "@/lib/auth-v2/session-environment";

const mockGetPool = jest.mocked(getPool);

describe("auth v2 session management", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("derives bounded presentation labels without retaining the raw user agent", () => {
    const rawUserAgent = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
      "private-marker-that-must-not-be-retained",
    ].join(" ");

    const result = classifyAuthSessionEnvironment(rawUserAgent);

    expect(result).toEqual({
      deviceLabel: "Компьютер",
      browserLabel: "Chrome",
      environmentLabel: "Windows",
    });
    expect(JSON.stringify(result)).not.toContain("private-marker");
  });

  test("lists only the authenticated user's live sessions and never selects network identifiers", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          id: "17",
          authMethod: "magic_link",
          deviceLabel: "Компьютер",
          browserLabel: "Chrome",
          environmentLabel: "Windows",
          createdAt: new Date("2026-07-20T10:00:00.000Z"),
          lastSeenAt: new Date("2026-07-29T10:00:00.000Z"),
        },
        {
          id: "18",
          authMethod: "passkey",
          deviceLabel: "Мобильное устройство",
          browserLabel: "Safari",
          environmentLabel: "iOS",
          createdAt: new Date("2026-07-21T10:00:00.000Z"),
          lastSeenAt: new Date("2026-07-28T10:00:00.000Z"),
        },
      ],
      rowCount: 2,
    });
    mockGetPool.mockReturnValue({ query } as never);

    const sessions = await listAuthSessions({
      userId: "42",
      currentSessionId: "17",
      now: new Date("2026-07-29T12:00:00.000Z"),
    });

    expect(query.mock.calls[0]?.[1]).toEqual([
      "42",
      new Date("2026-07-29T12:00:00.000Z"),
      "17",
    ]);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("session.user_id = $1");
    expect(sql).not.toContain("request_ip_hash");
    expect(sql).not.toContain("user_agent_hash");
    expect(sessions).toEqual([
      expect.objectContaining({ id: "17", current: true }),
      expect.objectContaining({ id: "18", current: false }),
    ]);
  });

  test("rejects stale or future recent-auth timestamps on the server", () => {
    expect(() => requireRecentAuthentication(
      { lastAuthenticatedAt: new Date("2026-07-29T10:00:00.000Z") },
      new Date("2026-07-29T12:00:00.000Z"),
    )).toThrow(RecentAuthenticationRequiredError);
    expect(() => requireRecentAuthentication(
      { lastAuthenticatedAt: new Date("2026-07-29T12:00:01.000Z") },
      new Date("2026-07-29T12:00:00.000Z"),
    )).toThrow(RecentAuthenticationRequiredError);
  });
});
