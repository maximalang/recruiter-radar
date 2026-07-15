import { NextResponse } from "next/server";

import { ACCOUNT_LOGIN_PENDING_COOKIE } from "@/lib/account-login-cookie";
import { isLoginChallengeActive } from "@/lib/account-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  let token = "";
  try {
    const body = await request.json() as { token?: unknown };
    token = typeof body.token === "string" ? body.token.trim() : "";
  } catch {
    token = "";
  }

  const active = await isLoginChallengeActive(token).catch(() => false);
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
