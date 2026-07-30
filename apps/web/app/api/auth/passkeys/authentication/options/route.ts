import { NextResponse } from "next/server";

import {
  PASSKEY_AUTHENTICATION_OPTIONS_MAX_BYTES,
  readLimitedJsonObject,
} from "@/lib/auth-v2/passkey-http";
import { beginPasskeyAuthentication } from "@/lib/auth-v2/passkeys";
import {
  isAuthSameOriginRequest,
  resolveAuthClientAddress,
} from "@/lib/auth-v2/security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthSameOriginRequest(request)) {
    return json({ ok: false, code: "invalid_origin" }, 403);
  }
  const body = await readLimitedJsonObject(
    request,
    PASSKEY_AUTHENTICATION_OPTIONS_MAX_BYTES,
  );
  if (!body) return json({ ok: false, code: "invalid_request" }, 400);
  const options = await beginPasskeyAuthentication({
    returnTo: body.returnTo,
    clientAddress: resolveAuthClientAddress({
      directAddress: null,
      headers: request.headers,
    }),
    userAgent: request.headers.get("user-agent"),
  });
  return options
    ? json({ ok: true, options })
    : json({ ok: false, code: "unavailable" }, 503);
}

function json(body: object, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}
