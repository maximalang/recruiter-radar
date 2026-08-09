jest.mock("@/lib/db-pool", () => ({ getPool: jest.fn() }));

import { getClientProfileById, listClientProfiles } from "@/lib/clientProfiles";
import { getPool } from "@/lib/db-pool";

const mockGetPool = jest.mocked(getPool);
const query = jest.fn();

describe("client profile ownership SQL", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    mockGetPool.mockReturnValue({ query } as never);
  });

  test("user-scoped profile lists never include unowned legacy profiles", async () => {
    await listClientProfiles("42");
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("WHERE owner_id = $1");
    expect(sql).not.toContain("owner_id IS NULL");
  });

  test("user-scoped profile lookup requires an exact owner", async () => {
    await getClientProfileById("7", "42");
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("AND owner_id = $2");
    expect(sql).not.toContain("owner_id IS NULL");
    expect(query.mock.calls[0]?.[1]).toEqual([7, "42"]);
  });
});
