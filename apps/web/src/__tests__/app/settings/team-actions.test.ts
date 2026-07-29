jest.mock("next/headers", () => ({
  headers: jest.fn(),
}));
jest.mock("next/navigation", () => ({
  redirect: jest.fn(),
}));
jest.mock("@/lib/auth-v2/current-session", () => ({
  readCurrentAuthSession: jest.fn(),
}));
jest.mock("@/lib/auth-v2/session-cookie", () => ({
  clearAuthV2SessionCookie: jest.fn(),
}));
jest.mock("@/lib/auth-v2/workspace-team", () => ({
  changeWorkspaceMemberRole: jest.fn(),
  inviteWorkspaceMember: jest.fn(),
  removeWorkspaceMember: jest.fn(),
  revokeWorkspaceInvite: jest.fn(),
  transferWorkspaceOwnership: jest.fn(),
}));

import {
  changeMemberRoleAction,
  inviteMemberAction,
  removeMemberAction,
  revokeInviteAction,
  transferOwnershipAction,
} from "@/app/settings/team/actions";
import { readCurrentAuthSession } from "@/lib/auth-v2/current-session";
import { clearAuthV2SessionCookie } from "@/lib/auth-v2/session-cookie";
import {
  changeWorkspaceMemberRole,
  inviteWorkspaceMember,
  removeWorkspaceMember,
  revokeWorkspaceInvite,
  transferWorkspaceOwnership,
} from "@/lib/auth-v2/workspace-team";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

const mockHeaders = jest.mocked(headers);
const mockRedirect = jest.mocked(redirect);
const mockReadSession = jest.mocked(readCurrentAuthSession);
const mockClearCookie = jest.mocked(clearAuthV2SessionCookie);
const mockChangeRole = jest.mocked(changeWorkspaceMemberRole);
const mockInvite = jest.mocked(inviteWorkspaceMember);
const mockRemove = jest.mocked(removeWorkspaceMember);
const mockRevokeInvite = jest.mocked(revokeWorkspaceInvite);
const mockTransfer = jest.mocked(transferWorkspaceOwnership);
const session = {
  id: "77",
  userId: "42",
  workspaceId: "9",
  lastAuthenticatedAt: new Date(),
} as never;

describe("auth v2 workspace team actions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AUTH_SITE_URL = "https://radar.example";
    mockHeaders.mockResolvedValue(new Headers({
      Origin: "https://radar.example",
      "Sec-Fetch-Site": "same-origin",
    }) as never);
    mockReadSession.mockResolvedValue(session);
    mockInvite.mockResolvedValue({ ok: true, delivery: "sent" });
    mockChangeRole.mockResolvedValue({ ok: true });
    mockRemove.mockResolvedValue({ ok: true });
    mockRevokeInvite.mockResolvedValue({ ok: true });
    mockTransfer.mockResolvedValue({ ok: true });
  });

  afterAll(() => {
    delete process.env.AUTH_SITE_URL;
  });

  test("derives actor and workspace from the session for invitations", async () => {
    const formData = new FormData();
    formData.set("email", "new@example.com");
    formData.set("role", "recruiter");
    formData.set("actorUserId", "999");
    formData.set("workspaceId", "888");

    await inviteMemberAction(formData);

    expect(mockInvite).toHaveBeenCalledWith({
      actorUserId: "42",
      workspaceId: "9",
      email: "new@example.com",
      role: "recruiter",
    });
    expect(mockRedirect).toHaveBeenCalledWith("/settings/team?invite=sent");
  });

  test("rejects owner as a generic invitation role before the core", async () => {
    const formData = new FormData();
    formData.set("email", "owner@example.com");
    formData.set("role", "owner");

    await inviteMemberAction(formData);

    expect(mockInvite).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith("/settings/team?invite=invalid");
  });

  test("scopes role, removal, and invite revocation to the current workspace", async () => {
    const roleForm = new FormData();
    roleForm.set("targetUserId", "55");
    roleForm.set("role", "viewer");
    roleForm.set("workspaceId", "888");
    await changeMemberRoleAction(roleForm);

    const removeForm = new FormData();
    removeForm.set("targetUserId", "56");
    await removeMemberAction(removeForm);

    const revokeForm = new FormData();
    revokeForm.set("inviteId", "66");
    await revokeInviteAction(revokeForm);

    expect(mockChangeRole).toHaveBeenCalledWith({
      actorUserId: "42",
      workspaceId: "9",
      targetUserId: "55",
      role: "viewer",
    });
    expect(mockRemove).toHaveBeenCalledWith({
      actorUserId: "42",
      workspaceId: "9",
      targetUserId: "56",
    });
    expect(mockRevokeInvite).toHaveBeenCalledWith({
      actorUserId: "42",
      workspaceId: "9",
      inviteId: "66",
    });
  });

  test("clears the obsolete owner session after ownership transfer", async () => {
    const formData = new FormData();
    formData.set("targetUserId", "55");
    formData.set("actorUserId", "999");

    await transferOwnershipAction(formData);

    expect(mockTransfer).toHaveBeenCalledWith({
      session,
      targetUserId: "55",
    });
    expect(mockClearCookie).toHaveBeenCalledTimes(1);
    expect(mockRedirect).toHaveBeenCalledWith(
      "/login?ownership=transferred",
    );
  });

  test("does not clear the session when transfer needs recent auth", async () => {
    mockTransfer.mockResolvedValue({
      ok: false,
      code: "reauth_required",
    });
    const formData = new FormData();
    formData.set("targetUserId", "55");

    await transferOwnershipAction(formData);

    expect(mockClearCookie).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith(
      "/settings/team?transfer=reauth",
    );
  });

  test("rejects cross-origin changes before resolving tenant context", async () => {
    mockHeaders.mockResolvedValue(new Headers({
      Origin: "https://attacker.example",
      "Sec-Fetch-Site": "cross-site",
    }) as never);
    mockRedirect.mockImplementationOnce(() => {
      throw new Error("redirected");
    });

    await expect(removeMemberAction(new FormData())).rejects.toThrow(
      "redirected",
    );

    expect(mockReadSession).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
  });
});
