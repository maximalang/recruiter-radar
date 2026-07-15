"use server";

import { redirect } from "next/navigation";

import { clearPendingAccountLogin, readPendingAccountLogin } from "@/lib/account-login-cookie";
import { consumeAccountLogin } from "@/lib/account-auth";
import { assertOwnerSessionConfigured, writeOwnerSession } from "@/lib/session";

export async function confirmAccountLoginAction(): Promise<never> {
  assertOwnerSessionConfigured();
  const token = await readPendingAccountLogin();
  const result = token ? await consumeAccountLogin(token) : null;
  if (!result) {
    await clearPendingAccountLogin();
    redirect("/login?error=invalid-link");
  }
  await writeOwnerSession(result.account.id);
  await clearPendingAccountLogin();
  redirect(result.returnTo);
}
