import { NextResponse } from "next/server";

import { getClientProfileByOwnerId } from "@/lib/clientProfiles";
import { readOwnerSession } from "@/lib/session";
import { revokeSubscription } from "@/lib/webPush";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Revokes a browser push subscription for the authenticated owner's profile.
 *
 * Anti-IDOR: revocation is scoped to (session owner's profile, endpoint), so a
 * caller cannot revoke another profile's subscription by guessing an endpoint.
 */
export async function POST(request: Request) {
  const ownerId = await readOwnerSession();
  if (!ownerId) {
    return NextResponse.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
  }

  const profile = await getClientProfileByOwnerId(ownerId);
  if (!profile) {
    return NextResponse.json({ error: "Профиль не найден." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const endpoint = (body as { endpoint?: unknown })?.endpoint;
  if (typeof endpoint !== "string" || !endpoint.trim()) {
    return NextResponse.json({ error: "endpoint is required." }, { status: 400 });
  }

  const result = await revokeSubscription({ clientProfileId: profile.id, endpoint });
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Failed to revoke subscription." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
