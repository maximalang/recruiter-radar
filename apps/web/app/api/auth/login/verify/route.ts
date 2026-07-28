import { NextResponse } from "next/server";

import { ACCOUNT_LOGIN_PENDING_COOKIE } from "@/lib/account-login-cookie";
import { isLoginChallengeActive } from "@/lib/account-auth";
import { isAuthV2LoginChallengeActive } from "@/lib/auth-v2/challenges";
import { getAuthV2Flags } from "@/lib/auth-v2/config";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  let token = "";
  try {
    const body = await request.json() as { token?: unknown };
    token = typeof body.token === "string" ? body.token.trim() : "";
  } catch {
    token = "";
  }

  let active = false;
  if (getAuthV2Flags().platform) {
    active = await isAuthV2LoginChallengeActive(token).catch(() => false);
    if (!active) {
      active = await isLoginChallengeActive(token).catch(() => false);
    }
  } else {
    active = await isLoginChallengeActive(token).catch(() => false);
  }
  const response = NextResponse.json({
    ok: active,
    next: active ? "/auth/confirm" : "/login?error=invalid-link",
  });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  if (active) {
    response.cookies.set(ACCOUNT_LOGIN_PENDING_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.SESSION_SECURE_COOKIE !== "false",
      path: "/",
      maxAge: 60 * 15,
    });
  }
  return response;
}
