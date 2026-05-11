import { NextResponse } from "next/server";

import { runDigestForClientProfile } from "../../../../lib/digest";
import { assertDigestEntitlementByClientProfileId, getPool, sendLeadToTelegram } from "../../../../lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PROCESSING_STALE_AFTER_MINUTES = 10;

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
  if (clientProfileId && !isPositiveIntegerString(clientProfileId)) return NextResponse.json({ error: "Invalid clientProfileId." }, { status: 400 });
  if (digestRunId && !isPositiveIntegerString(digestRunId)) return NextResponse.json({ error: "Invalid digestRunId." }, { status: 400 });

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
      const priorSent = await pool.query<{ ok: boolean }>(
        `SELECT TRUE AS ok FROM digest_delivery_attempts WHERE digest_candidate_id = $1 AND channel = 'telegram' AND status = 'sent' LIMIT 1`,
        [row.id]
      );
      if (priorSent.rowCount === 1) {
        skipped += 1;
        continue;
      }

      const attemptKey = `dg:${runId}:candidate:${row.id}`;
      const claimedAttempt = await pool.query<{ id: number }>(
        `INSERT INTO digest_delivery_attempts (digest_candidate_id, idempotency_key, channel, status)
         VALUES ($1, $2, 'telegram', 'processing')
         ON CONFLICT (digest_candidate_id, idempotency_key) DO NOTHING
         RETURNING id`,
        [row.id, attemptKey]
      );

      if (claimedAttempt.rowCount === 0) {
        const existingAttempt = await pool.query<{ status: string }>(
          `SELECT status::TEXT AS status FROM digest_delivery_attempts WHERE digest_candidate_id = $1 AND idempotency_key = $2 LIMIT 1`,
          [row.id, attemptKey]
        );
        const existingStatus = existingAttempt.rows[0]?.status;
        if (existingStatus === 'sent') {
          skipped += 1;
          continue;
        }

        const reclaimed = await pool.query(
          `UPDATE digest_delivery_attempts
           SET status = 'processing', error_message = NULL, attempted_at = NOW()
           WHERE digest_candidate_id = $1
             AND idempotency_key = $2
             AND (
               status = 'failed'
               OR (status = 'processing' AND attempted_at < NOW() - ($3::INT * INTERVAL '1 minute'))
             )`,
          [row.id, attemptKey, PROCESSING_STALE_AFTER_MINUTES]
        );
        if (reclaimed.rowCount !== 1) {
          skipped += 1;
          continue;
        }
      }

      let result: Awaited<ReturnType<typeof sendLeadToTelegram>>;
      try {
        result = await sendLeadToTelegram(row.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown delivery error';
        failed += 1;
        failures.push({ digestCandidateId: row.id, error: message });
        await pool.query(
          `UPDATE digest_delivery_attempts SET status = 'failed', error_message = LEFT($3, 1000), attempted_at = NOW() WHERE digest_candidate_id = $1 AND idempotency_key = $2`,
          [row.id, attemptKey, message]
        );
        continue;
      }

      if (result.ok) {
        sent += 1;
        await pool.query(
          `UPDATE digest_delivery_attempts SET status = 'sent', error_message = NULL, attempted_at = NOW() WHERE digest_candidate_id = $1 AND idempotency_key = $2`,
          [row.id, attemptKey]
        );
      } else {
        failed += 1;
        failures.push({ digestCandidateId: row.id, error: result.error });
        await pool.query(
          `UPDATE digest_delivery_attempts SET status = 'failed', error_message = LEFT($3, 1000), attempted_at = NOW() WHERE digest_candidate_id = $1 AND idempotency_key = $2`,
          [row.id, attemptKey, result.error]
        );
      }
    }

    const ok = failed === 0;
    return NextResponse.json({ ok, digestRunId: runId, clientProfileId: resolvedClientProfileId, counters: { sent, failed, skipped }, failures }, { status: ok ? 200 : 503 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to deliver digest.";
    const status = message.includes("not found") ? 404 : message.includes("inactive") || message.includes("No active subscription") || message.includes("entitlement") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

function isPositiveIntegerString(value: string): boolean {
  return /^\d+$/.test(value);
}
