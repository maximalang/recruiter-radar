import { GET as exportLeads } from "@/app/api/leads/export/route";
import { GET as exportLead } from "@/app/api/leads/[id]/export/route";
import { getAuthorizedOwnerId } from "@/lib/auth-v2/authorization";
import { hasFeatureAccess } from "@/lib/entitlements";
import { getLeadDetail, getLeadsForAllProfiles } from "@/lib/leads-data";
import { listClientProfiles } from "@/lib/clientProfiles";

jest.mock("@/lib/auth-v2/authorization", () => ({ getAuthorizedOwnerId: jest.fn() }));
jest.mock("@/lib/entitlements", () => ({ hasFeatureAccess: jest.fn() }));
jest.mock("@/lib/clientProfiles", () => ({
  getClientProfileById: jest.fn(),
  listClientProfiles: jest.fn(),
}));
jest.mock("@/lib/leads-data", () => ({
  getLeadDetail: jest.fn(),
  getLeadsForAllProfiles: jest.fn(),
  VALID_FEEDBACK_STATUSES: new Set(),
}));
jest.mock("@/lib/leads-csv", () => ({
  leadsToCsv: jest.fn(() => "csv"),
  singleLeadToCsv: jest.fn(() => "csv"),
}));

describe("lead export entitlement gates", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getAuthorizedOwnerId).mockResolvedValue("owner-42");
    jest.mocked(hasFeatureAccess).mockResolvedValue(false);
  });

  test("bulk export denies access before reading profiles or leads", async () => {
    const response = await exportLeads(new Request("http://localhost/api/leads/export"));
    expect(response.status).toBe(403);
    expect(hasFeatureAccess).toHaveBeenCalledWith("owner-42", "api");
    expect(listClientProfiles).not.toHaveBeenCalled();
    expect(getLeadsForAllProfiles).not.toHaveBeenCalled();
  });

  test("single export denies access before probing a lead id", async () => {
    const response = await exportLead(new Request("http://localhost/api/leads/99/export") as never, {
      params: Promise.resolve({ id: "99" }),
    });
    expect(response.status).toBe(403);
    expect(getLeadDetail).not.toHaveBeenCalled();
  });
});
