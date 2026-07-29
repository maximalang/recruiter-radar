import { NextResponse } from "next/server";

import { readCurrentAuthSession } from "@/lib/auth-v2/current-session";
import { beginPasskeyRegistration } from "@/lib/auth-v2/passkeys";
import {
  isAuthSameOriginRequest,
  resolveAuthClientAddress,
} from "@/lib/auth-v2/security";
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
  const options = await beginPasskeyRegistration({
    session,
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
