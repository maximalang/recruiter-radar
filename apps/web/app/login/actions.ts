"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { requestAccountLogin, sanitizeAccountReturnTo, type LoginRequestResult } from "@/lib/account-auth";
import { clearOwnerSession } from "@/lib/session";

export type LoginFormState = LoginRequestResult | null;

function requestSource(forwardedFor: string | null, realIp: string | null): string {
  const candidate = (forwardedFor?.split(",")[0] ?? realIp ?? "unknown").trim();
  return candidate.slice(0, 96) || "unknown";
}

export async function requestLoginAction(
  _previous: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const requestHeaders = await headers();
  return requestAccountLogin({
    email: formData.get("email"),
    returnTo: sanitizeAccountReturnTo(formData.get("returnTo")),
    sourceKey: requestSource(requestHeaders.get("x-forwarded-for"), requestHeaders.get("x-real-ip")),
  });
}

export async function logoutAction(): Promise<never> {
  await clearOwnerSession();
  redirect("/login?loggedOut=1");
}
