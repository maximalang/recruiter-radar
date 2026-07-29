jest.mock("@/lib/db-pool", () => ({
  getClient: jest.fn(),
  getPool: jest.fn(),
}));
jest.mock("@/lib/email/transport", () => ({
  sendEmail: jest.fn(),
}));
jest.mock("@/lib/runtime", () => ({
  logError: jest.fn(),
  logEvent: jest.fn(),
  logWarn: jest.fn(),
}));

import { readLoginChallengeState } from "@/lib/account-auth";
import { getPool } from "@/lib/db-pool";

const mockGetPool = jest.mocked(getPool);

describe("legacy login challenge preview state", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each([
    {
      consumedAt: null,
      expiresAt: new Date("2026-07-29T12:15:00.000Z"),
      expected: {
        status: "active",
        maskedEmail: "o***r@e***e.com",
        userId: "42",
      },
    },
    {
      consumedAt: null,
      expiresAt: new Date("2026-07-29T11:59:00.000Z"),
      expected: { status: "expired", userId: "42" },
    },
    {
      consumedAt: new Date("2026-07-29T12:01:00.000Z"),
      expiresAt: new Date("2026-07-29T12:15:00.000Z"),
      expected: { status: "used", userId: "42" },
    },
  ])("returns $expected.status without consuming", async ({
    consumedAt,
    expiresAt,
    expected,
  }) => {
    mockGetPool.mockReturnValue({
      query: jest.fn().mockResolvedValue({
        rows: [{
          email: "owner@example.com",
          userId: "42",
          consumedAt,
          expiresAt,
        }],
        rowCount: 1,
      }),
    } as never);

    await expect(readLoginChallengeState(
      "a".repeat(64),
      new Date("2026-07-29T12:00:00.000Z"),
    )).resolves.toEqual(expected);
  });
});
