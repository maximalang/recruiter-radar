import { NextResponse } from "next/server";

import { getClientProfileByOwnerId } from "@/lib/clientProfiles";
import { getAuthorizedOwnerId } from "@/lib/auth-v2/authorization";
import { saveSubscription, type WebPushSubscriptionInput } from "@/lib/webPush";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Stores a browser push subscription for the authenticated owner's profile.
 *
 * Anti-IDOR: the target profile is resolved ONLY from the session owner. The
 * request body carries the browser subscription, never a profileId — a forged
 * id cannot attach a subscription to someone else's profile.
 */
export async function POST(request: Request) {
  const ownerId = await getAuthorizedOwnerId("notifications:write");
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

  const subscription = parseSubscription(body);
  if (!subscription) {
    return NextResponse.json({ error: "Invalid push subscription." }, { status: 400 });
  }

  const result = await saveSubscription({ clientProfileId: profile.id, subscription });
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Failed to save subscription." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

function parseSubscription(body: unknown): WebPushSubscriptionInput | null {
  if (!body || typeof body !== "object") return null;
  const sub = (body as { subscription?: unknown }).subscription ?? body;
  if (!sub || typeof sub !== "object") return null;

  const endpoint = (sub as { endpoint?: unknown }).endpoint;
  const keys = (sub as { keys?: unknown }).keys;
  if (typeof endpoint !== "string" || !endpoint.trim()) return null;
  if (!keys || typeof keys !== "object") return null;

  const p256dh = (keys as { p256dh?: unknown }).p256dh;
  const auth = (keys as { auth?: unknown }).auth;
  if (typeof p256dh !== "string" || !p256dh.trim()) return null;
  if (typeof auth !== "string" || !auth.trim()) return null;

  return { endpoint, keys: { p256dh, auth } };
}
