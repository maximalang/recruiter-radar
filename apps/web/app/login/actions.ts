"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { requestAccountLogin, sanitizeAccountReturnTo, type LoginRequestResult } from "@/lib/account-auth";
import {
  requestAuthV2Login,
  shouldRequestAuthV2Login,
} from "@/lib/auth-v2/challenges";
import {
  resolveAuthClientAddress,
  sanitizeAuthReturnTo,
} from "@/lib/auth-v2/security";
import { clearOwnerSession } from "@/lib/session";

export type LoginFormState = LoginRequestResult | null;

export async function requestLoginAction(
  _previous: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const requestHeaders = await headers();
  const clientAddress = resolveAuthClientAddress({
    directAddress: null,
    headers: requestHeaders,
  });
  if (await shouldRequestAuthV2Login(formData.get("email"))) {
    return requestAuthV2Login({
      email: formData.get("email"),
      returnTo: sanitizeAuthReturnTo(formData.get("returnTo")),
      clientAddress,
      userAgent: requestHeaders.get("user-agent"),
    });
  }
  return requestAccountLogin({
    email: formData.get("email"),
    returnTo: sanitizeAccountReturnTo(formData.get("returnTo")),
    sourceKey: clientAddress,
  });
}

export async function logoutAction(): Promise<never> {
  await clearOwnerSession();
  redirect("/login?loggedOut=1");
}
