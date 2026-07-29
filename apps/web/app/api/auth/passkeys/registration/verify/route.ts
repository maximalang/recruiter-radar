import { NextResponse } from "next/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";

import { readCurrentAuthSession } from "@/lib/auth-v2/current-session";
import { readLimitedJsonObject } from "@/lib/auth-v2/passkey-http";
import { finishPasskeyRegistration } from "@/lib/auth-v2/passkeys";
import { isAuthSameOriginRequest } from "@/lib/auth-v2/security";
import { isRecentAuthentication } from "@/lib/auth-v2/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthSameOriginRequest(request)) {
    return json({ ok: false, code: "invalid_origin" }, 403);
  }
  const session = await readCurrentAuthSession({ requireWorkspace: true });
  if (!session?.workspaceId) {
    return json({ ok: false, code: "authentication_required" }, 401);
  }
  if (!isRecentAuthentication(session)) {
    return json({ ok: false, code: "reauth_required" }, 401);
  }
  const body = await readLimitedJsonObject(request);
  if (!body || typeof body.response !== "object" || body.response === null) {
    return json({ ok: false, code: "invalid_request" }, 400);
  }
  const result = await finishPasskeyRegistration({
    session,
    response: body.response as RegistrationResponseJSON,
    name: body.name,
  });
  if (result.ok) return json({ ok: true, passkey: result.passkey });
  const status = result.code === "reauth_required"
    ? 401
    : result.code === "rate_limited"
      ? 429
    : result.code === "unavailable"
      ? 503
      : result.code === "credential_exists"
        ? 409
        : 400;
  return json({ ok: false, code: result.code }, status);
}

function json(body: object, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}
