jest.mock("@/lib/digestFeedback", () => ({
  isDigestFeedbackAction: jest.fn((value: unknown) => value === "accepted"),
  updateDigestOrgStateFeedback: jest.fn(),
}));

import { POST } from "@/app/api/digest/feedback/route";
import { updateDigestOrgStateFeedback } from "@/lib/digestFeedback";

const mockUpdate = jest.mocked(updateDigestOrgStateFeedback);

describe("digest feedback route error handling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DIGEST_API_KEY = "test-key";
  });

  afterAll(() => {
    delete process.env.DIGEST_API_KEY;
  });

  test("does not expose unexpected internal error details", async () => {
    mockUpdate.mockRejectedValueOnce(new Error("relation digest_org_state does not exist"));

    const response = await POST(new Request("http://localhost/api/digest/feedback", {
      method: "POST",
      headers: { "x-api-key": "test-key", "content-type": "application/json" },
      body: JSON.stringify({ clientProfileId: "7", orgId: "11", action: "accepted" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Failed to update digest feedback state." });
  });
});
