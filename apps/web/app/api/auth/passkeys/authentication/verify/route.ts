import { NextResponse } from "next/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";

import {
  isAuthOnboardingV2EnabledForUser,
} from "@/lib/auth-v2/config";
import {
  PASSKEY_AUTHENTICATION_VERIFY_MAX_BYTES,
  readLimitedJsonObject,
} from "@/lib/auth-v2/passkey-http";
import { finishPasskeyAuthentication } from "@/lib/auth-v2/passkeys";
import {
  readAuthV2SessionCookie,
  writeAuthV2SessionCookie,
} from "@/lib/auth-v2/session-cookie";
import { classifyAuthSessionEnvironment } from "@/lib/auth-v2/session-environment";
import { readAuthSession } from "@/lib/auth-v2/sessions";
import {
  isAuthSameOriginRequest,
  resolveAuthClientAddress,
} from "@/lib/auth-v2/security";
import { clearLegacyOwnerSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthSameOriginRequest(request)) {
    return json({ ok: false, code: "invalid_origin" }, 403);
  }
  const body = await readLimitedJsonObject(
    request,
    PASSKEY_AUTHENTICATION_VERIFY_MAX_BYTES,
  );
  if (!body || typeof body.response !== "object" || body.response === null) {
    return json({ ok: false, code: "invalid_request" }, 400);
  }

  const previousToken = await readAuthV2SessionCookie().catch(() => null);
  const previousSession = previousToken
    ? await readAuthSession(previousToken)
    : null;
  const userAgent = request.headers.get("user-agent");
  const result = await finishPasskeyAuthentication({
    response: body.response as AuthenticationResponseJSON,
    clientAddress: resolveAuthClientAddress({
      directAddress: null,
      headers: request.headers,
    }),
    userAgent,
    sessionEnvironment: classifyAuthSessionEnvironment(userAgent),
    replaceSession: previousSession
      ? {
        id: previousSession.id,
        userId: previousSession.userId,
      }
      : null,
  });
  if (!result.ok) {
    return result.code === "rate_limited"
      ? json({ ok: false, code: "try_again_later" }, 429)
      : result.code === "unavailable"
        ? json({ ok: false, code: "authentication_failed" }, 503)
        : json({ ok: false, code: "authentication_failed" }, 401);
  }

  await writeAuthV2SessionCookie(result.session.token);
  await clearLegacyOwnerSession();
  const destination = (
    result.onboardingRequired
    && result.returnTo === "/dashboard"
    && isAuthOnboardingV2EnabledForUser(result.userId)
  )
    ? "/onboarding"
    : result.returnTo;
  return json({ ok: true, destination });
}

function json(body: object, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}
