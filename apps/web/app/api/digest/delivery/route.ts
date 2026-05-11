import { NextResponse } from "next/server";

import { runDigestForClientProfile } from "../../../../lib/digest";
import { assertDigestEntitlementByClientProfileId, getPool, sendLeadToTelegram } from "../../../../lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const digestApiKey = process.env.DIGEST_API_KEY;
  if (!digestApiKey) return NextResponse.json({ error: "DIGEST_API_KEY is not configured." }, { status: 500 });
  if (request.headers.get("x-api-key") !== digestApiKey) return NextResponse.json({ error: "Invalid or missing x-api-key header." }, { status: 401 });

  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "DATABASE_URL is not set." }, { status: 500 });

  let payload: { clientProfileId?: string; digestRunId?: string } = {};
  try { payload = (await request.json()) as { clientProfileId?: string; digestRunId?: string }; } catch {}

  const clientProfileId = payload.clientProfileId?.trim();
  const digestRunId = payload.digestRunId?.trim();
  if (!clientProfileId && !digestRunId) return NextResponse.json({ error: "clientProfileId or digestRunId is required." }, { status: 400 });

  try {
    let runId = digestRunId;
    let resolvedClientProfileId = clientProfileId;

    if (runId) {
      const runMeta = await pool.query<{ clientProfileId: string }>(`SELECT client_profile_id::TEXT AS "clientProfileId" FROM digest_runs WHERE id = $1 LIMIT 1`, [runId]);
      if (runMeta.rowCount !== 1) return NextResponse.json({ error: "digestRunId not found." }, { status: 404 });
      resolvedClientProfileId = runMeta.rows[0].clientProfileId;
      await assertDigestEntitlementByClientProfileId(resolvedClientProfileId);
    } else {
      await assertDigestEntitlementByClientProfileId(resolvedClientProfileId as string);
      const runResult = await runDigestForClientProfile({ clientProfileId: resolvedClientProfileId as string });
      runId = runResult.run.id;
      resolvedClientProfileId = runResult.clientProfile.id;
    }

    const candidates = await pool.query<{ id: number }>(`SELECT id FROM digest_candidates WHERE digest_run_id = $1 ORDER BY id ASC`, [runId]);
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    const failures: Array<{ digestCandidateId: number; error: string }> = [];

    for (const row of candidates.rows) {
      const result = await sendLeadToTelegram(row.id);
      if (result.ok) sent += 1;
      else {
        failed += 1;
        failures.push({ digestCandidateId: row.id, error: result.error });
      }
    }

    const ok = failed === 0;
    return NextResponse.json({ ok, digestRunId: runId, clientProfileId: resolvedClientProfileId, counters: { sent, failed, skipped }, failures }, { status: ok ? 200 : 503 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to deliver digest.";
    const status = message.includes("not found") ? 404 : message.includes("inactive") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
