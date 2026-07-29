"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { requestAccountLogin, sanitizeAccountReturnTo } from "@/lib/account-auth";
import {
  requestAuthV2Login,
  shouldRequestAuthV2Login,
} from "@/lib/auth-v2/challenges";
import {
  resolveAuthClientAddress,
  normalizeAuthEmail,
  sanitizeAuthReturnTo,
} from "@/lib/auth-v2/security";
import { clearOwnerSession } from "@/lib/session";

export type LoginFormState =
  | {
    ok: true;
    email: string;
    returnTo: string;
    requestedAt: number;
  }
  | { ok: false; error: string }
  | null;

export async function requestLoginAction(
  _previous: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const email = normalizeAuthEmail(formData.get("email"));
  if (!email) {
    return { ok: false, error: "Укажите один корректный email." };
  }
  const requestHeaders = await headers();
  const clientAddress = resolveAuthClientAddress({
    directAddress: null,
    headers: requestHeaders,
  });
  const returnTo = sanitizeAuthReturnTo(formData.get("returnTo"));
  const result = await shouldRequestAuthV2Login(email.canonical)
    ? await requestAuthV2Login({
      email: email.canonical,
      returnTo,
      clientAddress,
      userAgent: requestHeaders.get("user-agent"),
    })
    : await requestAccountLogin({
      email: email.canonical,
      returnTo: sanitizeAccountReturnTo(returnTo),
      sourceKey: clientAddress,
    });
  if (!result.ok) return result;
  return {
    ok: true,
    email: email.canonical,
    returnTo,
    requestedAt: Date.now(),
  };
}

export async function logoutAction(): Promise<never> {
  await clearOwnerSession();
  redirect("/login?loggedOut=1");
}
