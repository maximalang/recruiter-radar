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
  if (!digestApiKey) return NextResponse.json({ error: "Digest API is unavailable." }, { status: 500 });
  if (request.headers.get("x-api-key") !== digestApiKey) return NextResponse.json({ error: "Invalid or missing x-api-key header." }, { status: 401 });

  const clientProfileId = resolveClientProfileId(request);
  if (!clientProfileId) return NextResponse.json({ error: "clientProfileId is required." }, { status: 400 });

  try {
    await assertDigestEntitlementByClientProfileId(clientProfileId);
    const items = await getHhDigestItems({ clientProfileId });
    return NextResponse.json({ clientProfileId, items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message.includes("inactive") || message.includes("No active subscription") || message.includes("entitlement")
      ? 403
      : message.includes("not found")
        ? 404
        : 500;
    const publicMessage = status === 403
      ? "entitlement_required"
      : status === 404
        ? "client_profile_not_found"
        : "Failed to load HH digest.";
    return NextResponse.json({ error: publicMessage }, { status });
  }
}
