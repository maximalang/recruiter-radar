import { NextResponse } from "next/server";

import { getHhDigestItems } from "../../../../lib/hhDigest";
import { assertDigestEntitlementByClientProfileId } from "../../../../lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function resolveClientProfileId(request: Request): string | null {
  const { searchParams } = new URL(request.url);
  return searchParams.get("clientProfileId")?.trim() || process.env.DAILY_DIGEST_CLIENT_PROFILE_ID?.trim() || null;
}

export async function GET(request: Request) {
  const digestApiKey = process.env.DIGEST_API_KEY;
  if (!digestApiKey) return NextResponse.json({ error: "DIGEST_API_KEY is not configured." }, { status: 500 });
  if (request.headers.get("x-api-key") !== digestApiKey) return NextResponse.json({ error: "Invalid or missing x-api-key header." }, { status: 401 });

  const clientProfileId = resolveClientProfileId(request);
  if (!clientProfileId) return NextResponse.json({ error: "clientProfileId is required. Set ?clientProfileId=... or DAILY_DIGEST_CLIENT_PROFILE_ID." }, { status: 400 });

  try {
    await assertDigestEntitlementByClientProfileId(clientProfileId);
    const items = await getHhDigestItems({ clientProfileId });
    return NextResponse.json({ clientProfileId, items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load HH digest.";
    const status = message.includes("not found") ? 404 : message.includes("inactive") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
