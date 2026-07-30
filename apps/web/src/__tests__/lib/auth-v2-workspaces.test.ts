jest.mock("@/lib/db-pool", () => ({
  getPool: jest.fn(),
}));

import { getPool } from "@/lib/db-pool";
import {
  getActiveWorkspace,
  hasWorkspacePermission,
  requireWorkspacePermission,
  requireWorkspaceRole,
  WorkspaceAccessDeniedError,
} from "@/lib/auth-v2/workspaces";

const mockGetPool = jest.mocked(getPool);

describe("auth v2 workspace authorization DAL", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("loads only an active workspace and active server-side membership", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{
        id: "9",
        name: "Agency",
        slug: "agency",
        role: "recruiter",
        bootstrapUserId: "42",
      }],
      rowCount: 1,
    });
    mockGetPool.mockReturnValue({ query } as never);

    await expect(getActiveWorkspace({
      userId: "42",
      workspaceId: "9",
    })).resolves.toMatchObject({
      id: "9",
      role: "recruiter",
    });

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("workspace_members");
    expect(sql).toContain("membership.status = 'active'");
    expect(sql).toContain("workspace.status = 'active'");
    expect(sql).toContain("workspace.deleted_at IS NULL");
    expect(query.mock.calls[0]?.[1]).toEqual(["42", "9"]);
  });

  test("uses an explicit least-privilege permission map", () => {
    expect(hasWorkspacePermission("owner", "billing:manage")).toBe(true);
    expect(hasWorkspacePermission("admin", "members:manage")).toBe(true);
    expect(hasWorkspacePermission("recruiter", "opportunities:write")).toBe(true);
    expect(hasWorkspacePermission("viewer", "opportunities:write")).toBe(false);
    expect(hasWorkspacePermission("billing", "billing:manage")).toBe(true);
    expect(hasWorkspacePermission("billing", "leads:read")).toBe(false);
  });

  test("fails closed for insufficient roles and permissions", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{
        id: "9",
        name: "Agency",
        slug: "agency",
        role: "viewer",
        bootstrapUserId: "42",
      }],
      rowCount: 1,
    });
    mockGetPool.mockReturnValue({ query } as never);

    await expect(requireWorkspaceRole({
      userId: "42",
      workspaceId: "9",
      roles: ["owner", "admin"],
    })).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);

    await expect(requireWorkspacePermission({
      userId: "42",
      workspaceId: "9",
      permission: "leads:write",
    })).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
  });
});
