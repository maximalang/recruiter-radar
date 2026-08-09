jest.mock("@/lib/db", () => ({ getPool: jest.fn() }));
jest.mock("@/lib/auth-v2/authorization", () => ({
  getAuthorizedOwnerId: jest.fn(),
}));
jest.mock("@/lib/leads-data", () => ({ updateLeadFeedback: jest.fn() }));
jest.mock("@/lib/entitlements", () => ({ hasFeatureAccess: jest.fn() }));

import { updateLeadFeedbackAction } from "@/app/leads/[id]/actions";
import { getAuthorizedOwnerId } from "@/lib/auth-v2/authorization";
import { getPool } from "@/lib/db";
import { updateLeadFeedback } from "@/lib/leads-data";
import { hasFeatureAccess } from "@/lib/entitlements";

const mockGetAuthorizedOwnerId = jest.mocked(getAuthorizedOwnerId);
const mockGetPool = jest.mocked(getPool);
const mockUpdateLeadFeedback = jest.mocked(updateLeadFeedback);
const mockHasFeatureAccess = jest.mocked(hasFeatureAccess);

describe("lead action ownership boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthorizedOwnerId.mockResolvedValue("42");
    mockHasFeatureAccess.mockResolvedValue(true);
  });

  test("denies feedback mutation when canonical dashboard access is inactive", async () => {
    mockHasFeatureAccess.mockResolvedValue(false);

    await expect(updateLeadFeedbackAction("9", "7", "accepted"))
      .rejects.toThrow("active dashboard entitlement required");

    expect(mockHasFeatureAccess).toHaveBeenCalledWith("42", "dashboard");
    expect(mockGetPool).not.toHaveBeenCalled();
    expect(mockUpdateLeadFeedback).not.toHaveBeenCalled();
  });

  test("fails closed for an unowned client profile", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    mockGetPool.mockReturnValue({ query } as never);

    await expect(updateLeadFeedbackAction("9", "7", "accepted"))
      .rejects.toThrow("ownership check failed");

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("owner_id = $2");
    expect(sql).not.toContain("owner_id IS NULL");
    expect(query.mock.calls[0]?.[1]).toEqual(["7", "42"]);
    expect(mockUpdateLeadFeedback).not.toHaveBeenCalled();
  });
});
