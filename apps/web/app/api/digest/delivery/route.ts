import { NextResponse } from "next/server";

import { runDigestForClientProfile } from "../../../../lib/digest";
import { getPool, sendLeadToTelegram } from "../../../../lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const digestApiKey = process.env.DIGEST_API_KEY;
  if (!digestApiKey) return NextResponse.json({ error: "DIGEST_API_KEY is not configured." }, { status: 500 });
  if (request.headers.get("x-api-key") !== digestApiKey) {
    return NextResponse.json({ error: "Invalid or missing x-api-key header." }, { status: 401 });
  }

  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "DATABASE_URL is not set." }, { status: 500 });

  let payload: { clientProfileId?: string; digestRunId?: string } = {};
  try { payload = (await request.json()) as { clientProfileId?: string; digestRunId?: string }; } catch {}

  const clientProfileId = payload.clientProfileId?.trim();
  const digestRunId = payload.digestRunId?.trim();
  if (!clientProfileId && !digestRunId) {
    return NextResponse.json({ error: "clientProfileId or digestRunId is required." }, { status: 400 });
  }

  try {
    let runId = digestRunId;
    let resolvedClientProfileId = clientProfileId;

    if (!runId) {
      const runResult = await runDigestForClientProfile({ clientProfileId: resolvedClientProfileId as string });
      runId = runResult.run.id;
      resolvedClientProfileId = runResult.clientProfile.id;
    }

    const runMeta = await pool.query<{ clientProfileId: string }>(
      `SELECT client_profile_id::TEXT AS "clientProfileId" FROM digest_runs WHERE id = $1 LIMIT 1`,
      [runId]
    );
    if (runMeta.rowCount !== 1) return NextResponse.json({ error: "digestRunId not found." }, { status: 404 });
    resolvedClientProfileId = runMeta.rows[0].clientProfileId;
    const candidates = await pool.query<{ id: number }>(
      `SELECT id FROM digest_candidates WHERE digest_run_id = $1 ORDER BY id ASC`,
      [runId]
    );

    const results = [] as Array<{ digestCandidateId: number; ok: boolean; error?: string }>;
    for (const row of candidates.rows) {
      const sent = await sendLeadToTelegram(row.id);
      results.push(sent.ok ? { digestCandidateId: row.id, ok: true } : { digestCandidateId: row.id, ok: false, error: sent.error });
    }

    return NextResponse.json({ ok: true, digestRunId: runId, clientProfileId: resolvedClientProfileId, delivered: results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to deliver digest.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
