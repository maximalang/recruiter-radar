jest.mock("@/lib/db", () => ({
  assertDigestEntitlementByClientProfileId: jest.fn(),
}));
jest.mock("@/lib/digest", () => ({ runDigestForClientProfile: jest.fn() }));

import { GET } from "@/app/api/digest/route";
import { runDigestForClientProfile } from "@/lib/digest";
import { assertDigestEntitlementByClientProfileId } from "@/lib/db";

const mockAssert = jest.mocked(assertDigestEntitlementByClientProfileId);
const mockRunDigest = jest.mocked(runDigestForClientProfile);

describe("digest route error handling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DIGEST_API_KEY = "test-key";
    mockAssert.mockResolvedValue(undefined as never);
  });

  afterAll(() => {
    delete process.env.DIGEST_API_KEY;
  });

  test("does not expose unexpected internal error details", async () => {
    mockRunDigest.mockRejectedValueOnce(new Error("connect ECONNREFUSED 10.0.0.4:5432"));

    const response = await GET(new Request(
      "http://localhost/api/digest?clientProfileId=7",
      { headers: { "x-api-key": "test-key" } },
    ));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to run digest.");
    expect(JSON.stringify(body)).not.toContain("10.0.0.4");
  });
});
