import { NextResponse } from "next/server";

import { runDigestForClientProfile } from "@/lib/digest";
import { deliverCandidatesForRun } from "@/lib/digest/deliver-candidates";
import { assertDigestEntitlementByClientProfileId, getPool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const digestApiKey = process.env.DIGEST_API_KEY;
  if (!digestApiKey) return NextResponse.json({ error: "Service is not configured." }, { status: 500 });
  if (request.headers.get("x-api-key") !== digestApiKey) return NextResponse.json({ error: "Invalid or missing x-api-key header." }, { status: 401 });

  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Service is unavailable." }, { status: 500 });

  let payload: { clientProfileId?: string; digestRunId?: string } = {};
  try { payload = (await request.json()) as { clientProfileId?: string; digestRunId?: string }; } catch {}

  const clientProfileId = payload.clientProfileId?.trim();
  const digestRunId = payload.digestRunId?.trim();
  if (!clientProfileId && !digestRunId) return NextResponse.json({ error: "clientProfileId or digestRunId is required." }, { status: 400 });
  if (clientProfileId && !isPositiveIntegerString(clientProfileId)) return NextResponse.json({ error: "Invalid clientProfileId." }, { status: 400 });
  if (digestRunId && !isPositiveIntegerString(digestRunId)) return NextResponse.json({ error: "Invalid digestRunId." }, { status: 400 });

  try {
    let runId = digestRunId;
    let resolvedClientProfileId = clientProfileId;

    if (runId) {
      const runMeta = await pool.query<{ clientProfileId: string }>(`SELECT client_profile_id::TEXT AS "clientProfileId" FROM digest_runs WHERE id = $1 LIMIT 1`, [runId]);
      if (runMeta.rowCount !== 1) return NextResponse.json({ error: "digestRunId not found." }, { status: 404 });
      resolvedClientProfileId = runMeta.rows[0].clientProfileId;
      await assertDigestEntitlementByClientProfileId(resolvedClientProfileId || '', 'delivery');
    } else {
      if (!resolvedClientProfileId) throw new Error("clientProfileId is required when digestRunId is not provided");
      await assertDigestEntitlementByClientProfileId(resolvedClientProfileId, 'digest');
      await assertDigestEntitlementByClientProfileId(resolvedClientProfileId || '', 'delivery');
      const runResult = await runDigestForClientProfile({ clientProfileId: resolvedClientProfileId });
      runId = runResult.run.id;
      resolvedClientProfileId = runResult.clientProfile.id;
    }

    const delivery = await deliverCandidatesForRun(runId!);

    return NextResponse.json({
      ok: delivery.ok,
      digestRunId: runId,
      clientProfileId: resolvedClientProfileId,
      counters: { sent: delivery.sent, failed: delivery.failed, skipped: delivery.skipped },
      failures: delivery.failures,
    }, { status: delivery.ok ? 200 : 503 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to deliver digest.";
    const status = message.includes("Invalid") ? 400 : message.includes("inactive") || message.includes("No active subscription") || message.includes("entitlement") ? 403 : message.includes("not found") ? 404 : 500;
    const publicMessage = status === 500 ? "Failed to deliver digest." : message;
    return NextResponse.json({ error: publicMessage }, { status });
  }
}

function isPositiveIntegerString(value: string): boolean {
  return /^[1-9]\d*$/.test(value);
}
