"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { clearPendingAccountLogin, readPendingAccountLogin } from "@/lib/account-login-cookie";
import { consumeAccountLogin } from "@/lib/account-auth";
import {
  consumeAuthV2Login,
  readAuthV2LoginChallengePreview,
} from "@/lib/auth-v2/challenges";
import {
  isAuthOnboardingV2EnabledForUser,
  isAuthPlatformV2EnabledForUser,
} from "@/lib/auth-v2/config";
import {
  readAuthV2SessionCookie,
  writeAuthV2SessionCookie,
} from "@/lib/auth-v2/session-cookie";
import {
  revokeAuthSessionForAccountSwitch,
} from "@/lib/auth-v2/sessions";
import { classifyAuthSessionEnvironment } from "@/lib/auth-v2/session-environment";
import {
  isAuthSameOriginRequest,
  resolveAuthClientAddress,
} from "@/lib/auth-v2/security";
import {
  assertOwnerSessionConfigured,
  clearLegacyOwnerSession,
  readLegacyOwnerSessionCookie,
  writeOwnerSession,
} from "@/lib/session";

export async function confirmAccountLoginAction(): Promise<never> {
  assertOwnerSessionConfigured();
  const requestHeaders = await headers();
  if (!isAuthSameOriginRequest({ headers: requestHeaders })) {
    return redirect("/login?error=invalid-origin");
  }
  const token = await readPendingAccountLogin();
  const v2Preview = token
    ? await readAuthV2LoginChallengePreview(token).catch(() => null)
    : null;
  if (
    token
    && v2Preview
    && isAuthPlatformV2EnabledForUser(v2Preview.userId)
  ) {
    const clientAddress = resolveAuthClientAddress({
      directAddress: null,
      headers: requestHeaders,
    });
    const previousToken = await readAuthV2SessionCookie();
    const legacyToken = await readLegacyOwnerSessionCookie();
    const result = await consumeAuthV2Login({
      token,
      clientAddress,
      legacyToken,
      sessionEnvironment: classifyAuthSessionEnvironment(
        requestHeaders.get("user-agent"),
      ),
    });
    if (result) {
      if (previousToken) {
        const revocation = await revokeAuthSessionForAccountSwitch(
          previousToken,
        );
        if (revocation === "unavailable") {
          await clearPendingAccountLogin();
          return redirect("/login?error=session-switch-unavailable");
        }
      }
      await writeAuthV2SessionCookie(result.session.token);
      await clearLegacyOwnerSession();
      await clearPendingAccountLogin();
      const destination =
        result.onboardingRequired
        && result.returnTo === "/dashboard"
        && isAuthOnboardingV2EnabledForUser(result.account.id)
          ? "/onboarding"
          : result.returnTo;
      return redirect(destination);
    }
  }

  const legacyResult = token ? await consumeAccountLogin(token) : null;
  if (!legacyResult) {
    await clearPendingAccountLogin();
    return redirect("/login?error=invalid-link");
  }
  await writeOwnerSession(legacyResult.account.id);
  await clearPendingAccountLogin();
  return redirect(legacyResult.returnTo);
}

export async function cancelAccountLoginAction(): Promise<never> {
  const requestHeaders = await headers();
  if (!isAuthSameOriginRequest({ headers: requestHeaders })) {
    return redirect("/login?error=invalid-origin");
  }
  await clearPendingAccountLogin();
  return redirect("/login");
}
