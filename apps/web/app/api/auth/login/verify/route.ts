import { NextResponse } from "next/server";

import { ACCOUNT_LOGIN_PENDING_COOKIE } from "@/lib/account-login-cookie";
import { readLoginChallengeState } from "@/lib/account-auth";
import { readAuthV2LoginChallengeState } from "@/lib/auth-v2/challenges";
import {
  isAuthPlatformV2EnabledForUser,
} from "@/lib/auth-v2/config";
import { readLimitedJsonObject } from "@/lib/auth-v2/passkey-http";
import { isAuthSameOriginRequest } from "@/lib/auth-v2/security";

export const dynamic = "force-dynamic";

const LOGIN_VERIFY_MAX_BYTES = 1_024;

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthSameOriginRequest(request)) {
    return NextResponse.json(
      { ok: false, next: "/login?error=invalid-origin" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const body = await readLimitedJsonObject(request, LOGIN_VERIFY_MAX_BYTES);
  if (!body) {
    return NextResponse.json(
      { ok: false, next: "/auth/confirm?status=invalid", status: "invalid" },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store, max-age=0",
          "Referrer-Policy": "no-referrer",
        },
      },
    );
  }
  const token = typeof body.token === "string" ? body.token.trim() : "";

  const v2State = await readAuthV2LoginChallengeState(token)
    .catch(() => ({ status: "invalid" as const, userId: null }));
  const useV2 = (
    v2State.status !== "invalid"
    && isAuthPlatformV2EnabledForUser(v2State.userId)
  );
  const state = useV2
    ? v2State
    : await readLoginChallengeState(token)
      .catch(() => ({ status: "invalid" as const, userId: null }));
  const active = state.status === "active";
  const knownChallenge = state.status !== "invalid";
  const next = knownChallenge
    ? "/auth/confirm"
    : "/auth/confirm?status=invalid";

  const response = NextResponse.json({
    ok: active,
    next,
    status: state.status,
  });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  if (knownChallenge) {
    response.cookies.set(ACCOUNT_LOGIN_PENDING_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: active ? 60 * 15 : 60 * 5,
    });
  }
  return response;
}
