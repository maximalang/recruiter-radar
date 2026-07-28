"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { clearPendingAccountLogin, readPendingAccountLogin } from "@/lib/account-login-cookie";
import { consumeAccountLogin } from "@/lib/account-auth";
import { consumeAuthV2Login } from "@/lib/auth-v2/challenges";
import { getAuthV2Flags } from "@/lib/auth-v2/config";
import {
  readAuthV2SessionCookie,
  writeAuthV2SessionCookie,
} from "@/lib/auth-v2/session-cookie";
import {
  readAuthSession,
  revokeAuthSessionById,
} from "@/lib/auth-v2/sessions";
import { resolveAuthClientAddress } from "@/lib/auth-v2/security";
import {
  assertOwnerSessionConfigured,
  clearLegacyOwnerSession,
  writeOwnerSession,
} from "@/lib/session";

export async function confirmAccountLoginAction(): Promise<never> {
  assertOwnerSessionConfigured();
  const token = await readPendingAccountLogin();
  if (token && getAuthV2Flags().platform) {
    const requestHeaders = await headers();
    const clientAddress = resolveAuthClientAddress({
      directAddress: null,
      headers: requestHeaders,
    });
    const previousToken = await readAuthV2SessionCookie();
    const previousSession = previousToken
      ? await readAuthSession(previousToken)
      : null;
    const result = await consumeAuthV2Login({ token, clientAddress });
    if (result) {
      if (
        previousSession
        && previousSession.id !== result.session.id
      ) {
        await revokeAuthSessionById({
          userId: previousSession.userId,
          sessionId: previousSession.id,
          reason: "security_action",
        });
      }
      await writeAuthV2SessionCookie(result.session.token);
      await clearLegacyOwnerSession();
      await clearPendingAccountLogin();
      return redirect(result.returnTo);
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
