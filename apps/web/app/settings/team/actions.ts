"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { readCurrentAuthSession } from "@/lib/auth-v2/current-session";
import { clearAuthV2SessionCookie } from "@/lib/auth-v2/session-cookie";
import { isAuthSameOriginRequest } from "@/lib/auth-v2/security";
import {
  changeWorkspaceMemberRole,
  inviteWorkspaceMember,
  removeWorkspaceMember,
  revokeWorkspaceInvite,
  transferWorkspaceOwnership,
} from "@/lib/auth-v2/workspace-team";
import type { WorkspaceRole } from "@/lib/auth-v2/workspaces";
import type { AuthSession } from "@/lib/auth-v2/sessions";

const TEAM_ROLES = new Set<WorkspaceRole>([
  "admin",
  "recruiter",
  "viewer",
  "billing",
]);

function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function formRole(formData: FormData): WorkspaceRole | null {
  const value = formString(formData, "role") as WorkspaceRole;
  return TEAM_ROLES.has(value) ? value : null;
}

async function requireTeamSession(): Promise<AuthSession> {
  const requestHeaders = await headers();
  if (!isAuthSameOriginRequest({ headers: requestHeaders })) {
    return redirect("/settings/team?error=request");
  }
  const session = await readCurrentAuthSession({ requireWorkspace: true });
  if (!session?.workspaceId) {
    return redirect("/login?returnTo=/settings/team");
  }
  return session;
}

export async function inviteMemberAction(
  formData: FormData,
): Promise<never> {
  const session = await requireTeamSession();
  const role = formRole(formData);
  if (!role) return redirect("/settings/team?invite=invalid");

  const result = await inviteWorkspaceMember({
    actorUserId: session.userId,
    workspaceId: session.workspaceId!,
    email: formData.get("email"),
    role,
  });
  if (result.ok) {
    redirect(
      result.delivery === "sent"
        ? "/settings/team?invite=sent"
        : "/settings/team?invite=delivery",
    );
  }
  redirect(`/settings/team?invite=${result.code}`);
}

export async function changeMemberRoleAction(
  formData: FormData,
): Promise<never> {
  const session = await requireTeamSession();
  const role = formRole(formData);
  if (!role) return redirect("/settings/team?member=invalid");

  const result = await changeWorkspaceMemberRole({
    actorUserId: session.userId,
    workspaceId: session.workspaceId!,
    targetUserId: formString(formData, "targetUserId"),
    role,
  });
  redirect(
    result.ok
      ? "/settings/team?member=role-changed"
      : `/settings/team?member=${result.code}`,
  );
}

export async function removeMemberAction(
  formData: FormData,
): Promise<never> {
  const session = await requireTeamSession();
  const result = await removeWorkspaceMember({
    actorUserId: session.userId,
    workspaceId: session.workspaceId!,
    targetUserId: formString(formData, "targetUserId"),
  });
  redirect(
    result.ok
      ? "/settings/team?member=removed"
      : `/settings/team?member=${result.code}`,
  );
}

export async function revokeInviteAction(
  formData: FormData,
): Promise<never> {
  const session = await requireTeamSession();
  const result = await revokeWorkspaceInvite({
    actorUserId: session.userId,
    workspaceId: session.workspaceId!,
    inviteId: formString(formData, "inviteId"),
  });
  redirect(
    result.ok
      ? "/settings/team?invite=revoked"
      : `/settings/team?invite=${result.code}`,
  );
}

export async function transferOwnershipAction(
  formData: FormData,
): Promise<never> {
  const session = await requireTeamSession();
  const result = await transferWorkspaceOwnership({
    session,
    targetUserId: formString(formData, "targetUserId"),
  });
  if (result.ok) {
    await clearAuthV2SessionCookie();
    redirect("/login?ownership=transferred");
  }
  redirect(
    result.code === "reauth_required"
      ? "/settings/team?transfer=reauth"
      : `/settings/team?transfer=${result.code}`,
  );
}
