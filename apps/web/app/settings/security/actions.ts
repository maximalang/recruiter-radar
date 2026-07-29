"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  requestAccountDeletion,
  requestAccountEmailChange,
} from "@/lib/auth-v2/account-security";
import { readCurrentAuthSession } from "@/lib/auth-v2/current-session";
import { clearAuthV2SessionCookie } from "@/lib/auth-v2/session-cookie";
import {
  revokeAllAuthSessions,
  revokeAuthSessionById,
  type AuthSession,
} from "@/lib/auth-v2/sessions";
import { isAuthSameOriginRequest } from "@/lib/auth-v2/security";

const POSITIVE_ID = /^[1-9]\d*$/;

async function requireSecuritySession(): Promise<AuthSession> {
  const requestHeaders = await headers();
  if (!isAuthSameOriginRequest({ headers: requestHeaders })) {
    redirect("/settings/security?error=request");
  }
  const session = await readCurrentAuthSession({ requireWorkspace: true });
  if (!session) {
    redirect("/login?returnTo=/settings/security");
  }
  return session;
}

export async function revokeSessionAction(formData: FormData): Promise<never> {
  const session = await requireSecuritySession();
  const selected = formData.get("sessionId");
  if (
    typeof selected !== "string"
    || !POSITIVE_ID.test(selected)
    || selected === session.id
  ) {
    redirect("/settings/security?sessions=invalid");
  }
  const revoked = await revokeAuthSessionById({
    userId: session.userId,
    sessionId: selected,
    reason: "security_action",
  });
  redirect(
    revoked
      ? "/settings/security?sessions=ended"
      : "/settings/security?sessions=unavailable",
  );
}

export async function endCurrentSessionAction(): Promise<never> {
  const session = await requireSecuritySession();
  await revokeAuthSessionById({
    userId: session.userId,
    sessionId: session.id,
    reason: "logout",
  });
  await clearAuthV2SessionCookie();
  redirect("/login?loggedOut=1");
}

export async function endOtherSessionsAction(): Promise<never> {
  const session = await requireSecuritySession();
  await revokeAllAuthSessions({
    userId: session.userId,
    exceptSessionId: session.id,
  });
  redirect("/settings/security?sessions=others-ended");
}

export async function endAllSessionsAction(): Promise<never> {
  const session = await requireSecuritySession();
  await revokeAllAuthSessions({ userId: session.userId });
  await clearAuthV2SessionCookie();
  redirect("/login?loggedOut=all");
}

export async function requestEmailChangeAction(
  formData: FormData,
): Promise<never> {
  const session = await requireSecuritySession();
  const result = await requestAccountEmailChange({
    session,
    newEmail: formData.get("email"),
  });
  if (result.ok) {
    redirect(
      result.delivery === "sent"
        ? "/settings/security?email=requested"
        : "/settings/security?email=delivery",
    );
  }
  redirect(
    result.code === "reauth_required"
      ? "/settings/security?email=reauth"
      : `/settings/security?email=${result.code}`,
  );
}

export async function deleteAccountAction(
  formData: FormData,
): Promise<never> {
  const session = await requireSecuritySession();
  const result = await requestAccountDeletion({
    session,
    confirmation: formData.get("confirmation"),
  });
  if (result.ok) {
    await clearAuthV2SessionCookie();
    redirect("/login?accountDeletion=requested");
  }
  redirect(`/settings/security?deletion=${result.code}`);
}
