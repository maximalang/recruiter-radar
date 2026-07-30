import {
  bindNotificationEndpoint,
  createNotificationBindingInstructions,
} from "@/lib/notifications";
import { hashNotificationToken } from "@/lib/notification-secrets";

const mockPoolQuery = jest.fn();
const mockClientQuery = jest.fn();
const mockRelease = jest.fn();
const mockConnect = jest.fn(async () => ({
  query: mockClientQuery,
  release: mockRelease,
}));

jest.mock("@/lib/db-pool", () => ({
  getPool: () => ({
    query: mockPoolQuery,
    connect: mockConnect,
  }),
}));

describe("notification owner-write fence ordering", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClientQuery.mockImplementation(async (sqlValue: unknown) => {
      const sql = String(sqlValue);
      if (sql.includes("bind_token_hash AS")) {
        return {
          rowCount: 1,
          rows: [{
            id: "endpoint-1",
            bindTokenHash: hashNotificationToken("binding-token"),
          }],
        };
      }
      if (sql.includes("SELECT id::text AS id")) {
        return { rowCount: 1, rows: [{ id: "endpoint-1" }] };
      }
      return { rowCount: 1, rows: [] };
    });
  });

  test("binding instructions take the shared fence before locking an endpoint", async () => {
    mockPoolQuery.mockResolvedValue({
      rowCount: 1,
      rows: [{
        id: "account-1",
        provider: "telegram",
        clientProfileId: "profile-1",
        providerMetadata: { username: "radar_bot" },
      }],
    });

    await expect(createNotificationBindingInstructions({
      ownerId: "owner-1",
      connectionId: "account-1",
    })).resolves.toMatchObject({
      privateLink: expect.stringContaining("https://t.me/radar_bot"),
    });

    expect(mockClientQuery.mock.calls[0]?.[0]).toBe("BEGIN");
    expect(String(mockClientQuery.mock.calls[1]?.[0])).toContain(
      "pg_advisory_xact_lock_shared",
    );
    expect(mockClientQuery.mock.calls[1]?.[1]).toEqual([
      "auth-owner-scoped-writes",
    ]);
    expect(String(mockClientQuery.mock.calls[2]?.[0])).toContain("FOR UPDATE");
  });

  test("provider binding takes the shared fence before locking an endpoint", async () => {
    const account = {
      id: "account-1",
      publicId: "public-1",
      ownerId: "owner-1",
      clientProfileId: "profile-1",
      provider: "telegram",
      displayName: "Radar bot",
      status: "active",
      externalAccountId: "external-1",
      externalAccountName: "radar_bot",
      secretCiphertext: "ciphertext",
      providerMetadata: { username: "radar_bot" },
    } as Parameters<typeof bindNotificationEndpoint>[0]["account"];

    await expect(bindNotificationEndpoint({
      account,
      bindToken: "binding-token",
      destinationId: "chat-1",
      destinationLabel: "Recruiting team",
      endpointType: "telegram_group",
    })).resolves.toEqual({ status: "bound" });

    expect(mockClientQuery.mock.calls[0]?.[0]).toBe("BEGIN");
    expect(String(mockClientQuery.mock.calls[1]?.[0])).toContain(
      "pg_advisory_xact_lock_shared",
    );
    expect(mockClientQuery.mock.calls[1]?.[1]).toEqual([
      "auth-owner-scoped-writes",
    ]);
    expect(String(mockClientQuery.mock.calls[2]?.[0])).toContain("FOR UPDATE");
  });
});
