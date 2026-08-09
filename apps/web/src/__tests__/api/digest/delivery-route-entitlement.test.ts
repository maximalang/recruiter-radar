jest.mock("@/lib/db", () => ({
  getPool: jest.fn(),
  assertDigestEntitlementByClientProfileId: jest.fn(),
}));
jest.mock("@/lib/digest", () => ({ runDigestForClientProfile: jest.fn() }));
jest.mock("@/lib/digest/deliver-candidates", () => ({ deliverCandidatesForRun: jest.fn() }));

import { POST } from "@/app/api/digest/delivery/route";
import { runDigestForClientProfile } from "@/lib/digest";
import { deliverCandidatesForRun } from "@/lib/digest/deliver-candidates";
import { assertDigestEntitlementByClientProfileId, getPool } from "@/lib/db";

const mockAssert = jest.mocked(assertDigestEntitlementByClientProfileId);
const mockGetPool = jest.mocked(getPool);
const mockRunDigest = jest.mocked(runDigestForClientProfile);
const mockDeliver = jest.mocked(deliverCandidatesForRun);

describe("digest delivery entitlement composition", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DIGEST_API_KEY = "test-key";
    mockGetPool.mockReturnValue({ query: jest.fn() } as never);
    mockRunDigest.mockResolvedValue({
      run: { id: "88" },
      clientProfile: { id: "7" },
    } as never);
    mockDeliver.mockResolvedValue({ ok: true, sent: 1, failed: 0, skipped: 0, failures: [] });
  });

  afterAll(() => {
    delete process.env.DIGEST_API_KEY;
  });

  test("requires digest and delivery before generating a new run", async () => {
    const response = await POST(requestForProfile("7"));

    expect(response.status).toBe(200);
    expect(mockAssert.mock.calls).toEqual([["7", "digest"], ["7", "delivery"]]);
    expect(mockRunDigest).toHaveBeenCalledWith({ clientProfileId: "7" });
  });

  test("does not generate when digest access is missing", async () => {
    mockAssert.mockRejectedValueOnce(new Error("No active subscription or pilot."));
    const response = await POST(requestForProfile("7"));

    expect(response.status).toBe(403);
    expect(mockRunDigest).not.toHaveBeenCalled();
    expect(mockDeliver).not.toHaveBeenCalled();
  });
});

function requestForProfile(clientProfileId: string): Request {
  return new Request("http://localhost/api/digest/delivery", {
    method: "POST",
    headers: { "x-api-key": "test-key", "content-type": "application/json" },
    body: JSON.stringify({ clientProfileId }),
  });
}
