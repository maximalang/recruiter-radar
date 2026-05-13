import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { runDigestForClientProfile } from "../../../../lib/digest";
import { assertDigestEntitlementByClientProfileId, getPool, sendLeadToTelegram } from "../../../../lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DELIVERY_STALE_SECONDS = 120;

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

    const candidates = await pool.query<{ id: number }>(`
      SELECT id
      FROM digest_candidates
      WHERE digest_run_id = $1
        AND (payload->>'confidenceGate' NOT IN ('C', 'D') OR payload->>'confidenceGate' IS NULL)
      ORDER BY id ASC
    `, [runId]);
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    const failures: Array<{ digestCandidateId: number; error: string }> = [];

    for (const row of candidates.rows) {
      const claimToken = randomUUID();
      const idempotencyKey = `digest:${runId}:candidate:${row.id}:telegram`;

      const claim = await pool.query<{ id: number; status: string; ownsClaim: boolean }>(`
        INSERT INTO digest_delivery_attempts (
          digest_candidate_id, idempotency_key, channel, status, processing_claimed_at, processing_claim_token
        )
        VALUES ($1, $2, 'telegram', 'processing', NOW(), $3)
        ON CONFLICT (digest_candidate_id, idempotency_key)
        DO UPDATE SET
          processing_claimed_at = CASE
            WHEN digest_delivery_attempts.status = 'failed'
              OR (digest_delivery_attempts.status = 'processing' AND digest_delivery_attempts.processing_claimed_at < NOW() - ($4::int * INTERVAL '1 second'))
            THEN NOW() ELSE digest_delivery_attempts.processing_claimed_at END,
          processing_claim_token = CASE
            WHEN digest_delivery_attempts.status = 'failed'
              OR (digest_delivery_attempts.status = 'processing' AND digest_delivery_attempts.processing_claimed_at < NOW() - ($4::int * INTERVAL '1 second'))
            THEN EXCLUDED.processing_claim_token ELSE digest_delivery_attempts.processing_claim_token END,
          status = CASE
            WHEN digest_delivery_attempts.status = 'failed'
              OR (digest_delivery_attempts.status = 'processing' AND digest_delivery_attempts.processing_claimed_at < NOW() - ($4::int * INTERVAL '1 second'))
            THEN 'processing' ELSE digest_delivery_attempts.status END
        RETURNING id, status::TEXT AS status, processing_claim_token = $3 AS "ownsClaim"
      `, [row.id, idempotencyKey, claimToken, DELIVERY_STALE_SECONDS]);

      const attempt = claim.rows[0];
      if (attempt.status === "sent") {
        skipped += 1;
        continue;
      }
      if (!attempt.ownsClaim) {
        skipped += 1;
        continue;
      }

      try {
        const result = await sendLeadToTelegram(row.id);
        if (result.ok) {
          const finalize = await pool.query(
            `UPDATE digest_delivery_attempts SET status = 'sent', error_message = NULL WHERE id = $1 AND processing_claim_token = $2`,
            [attempt.id, claimToken]
          );
          if (finalize.rowCount !== 1) {
            failed += 1;
            failures.push({ digestCandidateId: row.id, error: "Failed to persist sent status due to claim ownership loss." });
            continue;
          }
          sent += 1;
        } else {
          const finalize = await pool.query(
            `UPDATE digest_delivery_attempts SET status = 'failed', error_message = LEFT($3, 1000) WHERE id = $1 AND processing_claim_token = $2`,
            [attempt.id, claimToken, result.error]
          );
          failed += 1;
          failures.push({ digestCandidateId: row.id, error: finalize.rowCount === 1 ? result.error : "Failed delivery and failed to persist failure status due to claim ownership loss." });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Delivery exception.";
        await pool.query(
          `UPDATE digest_delivery_attempts SET status = 'failed', error_message = LEFT($3, 1000) WHERE id = $1 AND processing_claim_token = $2`,
          [attempt.id, claimToken, message]
        );
        failed += 1;
        failures.push({ digestCandidateId: row.id, error: message });
      }
    }

    const ok = failed === 0;
    return NextResponse.json({ ok, digestRunId: runId, clientProfileId: resolvedClientProfileId, counters: { sent, failed, skipped }, failures }, { status: ok ? 200 : 503 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to deliver digest.";
    const status = message.includes("Invalid") ? 400 : message.includes("not found") ? 404 : message.includes("inactive") || message.includes("No active subscription") || message.includes("entitlement") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

function isPositiveIntegerString(value: string): boolean {
  return /^\d+$/.test(value);
}
