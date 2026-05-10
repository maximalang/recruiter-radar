import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { runDigestForClientProfile } from "../../../../lib/digest";
import { getPool } from "../../../../lib/db";
import { getTelegramBotToken, sendTelegramTextMessage } from "../../../../lib/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const digestApiKey = process.env.DIGEST_API_KEY;
  if (!digestApiKey) return NextResponse.json({ error: "DIGEST_API_KEY is not configured." }, { status: 500 });
  if (request.headers.get("x-api-key") !== digestApiKey) return NextResponse.json({ error: "Invalid or missing x-api-key header." }, { status: 401 });

  const payload = (await request.json().catch(() => ({}))) as { clientProfileId?: string; limit?: number; cooldownDays?: number; sourceKey?: string };
  if (!payload.clientProfileId) return NextResponse.json({ error: "clientProfileId is required." }, { status: 400 });

  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "DATABASE_URL is not set." }, { status: 500 });

  const { botToken, error } = getTelegramBotToken();
  if (!botToken) return NextResponse.json({ error: error ?? "TELEGRAM_BOT_TOKEN is not configured." }, { status: 500 });

  const digest = await runDigestForClientProfile({
    clientProfileId: payload.clientProfileId,
    limit: payload.limit,
    cooldownDays: payload.cooldownDays,
    sourceKey: payload.sourceKey
  });
  const candidates = await pool.query<{ id: string; orgName: string; opener: string; score: number; chatId: string | null }>(`
    SELECT dc.id::text AS id, o.name AS "orgName", dc.opener, dc.total_score AS score, cp.telegram_chat_id::text AS "chatId"
    FROM digest_candidates dc
    INNER JOIN orgs o ON o.id = dc.org_id
    INNER JOIN client_profiles cp ON cp.id = dc.client_profile_id
    WHERE dc.digest_run_id = $1
    ORDER BY dc.id ASC
  `, [digest.run.id]);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const candidate of candidates.rows) {
    const alreadySent = await pool.query(`SELECT 1 FROM digest_delivery_attempts WHERE digest_candidate_id = $1 AND status = 'sent' LIMIT 1`, [candidate.id]);
    if ((alreadySent.rowCount ?? 0) > 0) {
      skipped += 1;
      continue;
    }

    const attemptKey = `telegram:${candidate.id}:${Date.now()}:${randomUUID()}`;
    const queued = await pool.query<{ id: string }>(`
      INSERT INTO digest_delivery_attempts (digest_candidate_id, idempotency_key, channel, status)
      VALUES ($1, $2, 'telegram', 'queued')
      RETURNING id::text AS id
    `, [candidate.id, attemptKey]);

    if (!candidate.chatId) {
      failed += 1;
      await pool.query(`UPDATE digest_delivery_attempts SET status = 'failed', error_message = 'Client profile telegram_chat_id is not configured.', attempted_at = NOW() WHERE id = $1`, [queued.rows[0].id]);
      continue;
    }

    try {
      await sendTelegramTextMessage(`Recruiter Radar\n\nКомпания: ${candidate.orgName}\nScore: ${candidate.score}\n\n${candidate.opener}`, { botToken, chatId: candidate.chatId });
      sent += 1;
      await pool.query(`UPDATE digest_delivery_attempts SET status = 'sent', error_message = NULL, attempted_at = NOW() WHERE id = $1`, [queued.rows[0].id]);
    } catch (e) {
      failed += 1;
      const message = e instanceof Error ? e.message : "Telegram delivery failed.";
      await pool.query(`UPDATE digest_delivery_attempts SET status = 'failed', error_message = LEFT($2, 1000), attempted_at = NOW() WHERE id = $1`, [queued.rows[0].id, message]);
    }
  }

  const response = { ok: failed === 0, runId: digest.run.id, selected: candidates.rowCount, sent, skipped, failed };
  if (failed > 0) return NextResponse.json(response, { status: 503 });
  return NextResponse.json(response);
}
