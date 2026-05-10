import { NextResponse } from "next/server";

import { runDigestForClientProfile } from "../../../../lib/digest";
import { getLatestDigestCandidateIdsByClientProfile, hasClientProfilePremiumEntitlement, sendLeadToTelegram } from "../../../../lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const digestApiKey = process.env.DIGEST_API_KEY;
  if (!digestApiKey) return NextResponse.json({ error: "DIGEST_API_KEY is not configured." }, { status: 500 });
  if (request.headers.get("x-api-key") !== digestApiKey) return NextResponse.json({ error: "Invalid or missing x-api-key header." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as { clientProfileId?: string; limit?: number; cooldownDays?: number; sourceKey?: string };
  const clientProfileId = body.clientProfileId?.trim();
  if (!clientProfileId) return NextResponse.json({ error: "clientProfileId is required." }, { status: 400 });

  const entitlement = await hasClientProfilePremiumEntitlement(clientProfileId);
  if (!entitlement.allowed) return NextResponse.json({ error: entitlement.reason ?? "Premium entitlement is required for digest." }, { status: 403 });

  const digest = await runDigestForClientProfile({ clientProfileId, limit: body.limit, cooldownDays: body.cooldownDays, sourceKey: body.sourceKey });
  const candidateIds = await getLatestDigestCandidateIdsByClientProfile(clientProfileId);

  const delivery = await Promise.all(candidateIds.map(async (id) => ({ digestCandidateId: id, result: await sendLeadToTelegram(id) })));
  return NextResponse.json({ ok: true, runId: digest.run.id, delivered: delivery.filter((x) => x.result.ok).length, failed: delivery.filter((x) => !x.result.ok && !x.result.skipped).length, skipped: delivery.filter((x) => x.result.skipped).length, delivery });
}
