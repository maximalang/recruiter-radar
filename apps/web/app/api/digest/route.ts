import { NextResponse } from "next/server";

import { runDigestForClientProfile } from "../../../lib/digest";
import { assertDigestEntitlementByClientProfileId } from "../../../lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const digestApiKey = process.env.DIGEST_API_KEY;
  if (!digestApiKey) return NextResponse.json({ error: "DIGEST_API_KEY is not configured." }, { status: 500 });
  if (request.headers.get("x-api-key") !== digestApiKey) return NextResponse.json({ error: "Invalid or missing x-api-key header." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const clientProfileId = searchParams.get("clientProfileId");
  if (!clientProfileId) return NextResponse.json({ error: "clientProfileId is required." }, { status: 400 });

  const limitParam = searchParams.get("limit");
  const cooldownDaysParam = searchParams.get("cooldownDays");
  const sourceKey = searchParams.get("sourceKey");

  try {
    await assertDigestEntitlementByClientProfileId(clientProfileId);
    const result = await runDigestForClientProfile({ clientProfileId, sourceKey, limit: limitParam ? Number(limitParam) : undefined, cooldownDays: cooldownDaysParam ? Number(cooldownDaysParam) : undefined });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run digest.";
    const status = message.includes("not found") ? 404 : message.includes("inactive") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
