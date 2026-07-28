"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { requestAccountLogin, sanitizeAccountReturnTo, type LoginRequestResult } from "@/lib/account-auth";
import { requestAuthV2Login } from "@/lib/auth-v2/challenges";
import { getAuthV2Flags } from "@/lib/auth-v2/config";
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
  if (getAuthV2Flags().platform) {
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
