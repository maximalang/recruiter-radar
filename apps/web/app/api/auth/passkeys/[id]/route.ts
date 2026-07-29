import { NextResponse } from "next/server";

import { readCurrentAuthSession } from "@/lib/auth-v2/current-session";
import { readLimitedJsonObject } from "@/lib/auth-v2/passkey-http";
import {
  removeUserPasskey,
  renameUserPasskey,
} from "@/lib/auth-v2/passkeys";
import { isAuthSameOriginRequest } from "@/lib/auth-v2/security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  if (!isAuthSameOriginRequest(request)) {
    return json({ ok: false, code: "invalid_origin" }, 403);
  }
  const session = await readCurrentAuthSession({ requireWorkspace: true });
  if (!session?.workspaceId) {
    return json({ ok: false, code: "authentication_required" }, 401);
  }
  const body = await readLimitedJsonObject(request);
  const { id } = await context.params;
  if (!body) return json({ ok: false, code: "invalid_request" }, 400);
  const renamed = await renameUserPasskey({
    userId: session.userId,
    passkeyId: id,
    name: body.name,
  });
  return renamed
    ? json({ ok: true })
    : json({ ok: false, code: "unavailable" }, 404);
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  if (!isAuthSameOriginRequest(request)) {
    return json({ ok: false, code: "invalid_origin" }, 403);
  }
  const session = await readCurrentAuthSession({ requireWorkspace: true });
  if (!session?.workspaceId) {
    return json({ ok: false, code: "authentication_required" }, 401);
  }
  const { id } = await context.params;
  const removed = await removeUserPasskey({
    session,
    passkeyId: id,
  });
  return removed === "removed"
    ? json({ ok: true })
    : removed === "reauth_required"
      ? json({ ok: false, code: removed }, 401)
      : json({ ok: false, code: removed }, 404);
}

function json(body: object, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}
