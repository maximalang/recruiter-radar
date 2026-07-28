import { NextResponse } from "next/server";

import { ACCOUNT_LOGIN_PENDING_COOKIE } from "@/lib/account-login-cookie";
import { isLoginChallengeActive } from "@/lib/account-auth";
import {
  isAuthV2LoginChallengeActive,
  readAuthV2LoginChallengePreview,
} from "@/lib/auth-v2/challenges";
import {
  getAuthV2Flags,
  isAuthPlatformV2EnabledForUser,
} from "@/lib/auth-v2/config";
import { isAuthSameOriginRequest } from "@/lib/auth-v2/security";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthSameOriginRequest(request)) {
    return NextResponse.json(
      { ok: false, next: "/login?error=invalid-origin" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

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
    const preview = await readAuthV2LoginChallengePreview(token)
      .catch(() => null);
    if (preview && isAuthPlatformV2EnabledForUser(preview.userId)) {
      active = true;
    } else {
      active = await isLoginChallengeActive(token).catch(() => false);
    }
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
      secure: true,
      path: "/",
      maxAge: 60 * 15,
    });
  }
  return response;
}
