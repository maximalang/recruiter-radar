/**
 * Delivery diagnostics — answers "why are leads not reaching Telegram?"
 *
 * Read-only. Walks the same gates the daily-radar pipeline enforces, in order,
 * and prints PASS/FAIL for each so the first silent blocker is obvious:
 *   1. Active subscription / pilot entitlement
 *   2. Active client profile WITH telegram_chat_id (delivery target)
 *   3. Signal freshness (digest-evidence requires published_at within 45 days)
 *   4. How many orgs the digest-evidence query yields, split by confidence gate
 *
 * Usage: node packages/db/scripts/diagnose-delivery.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDir, '../../../.env');
const digestEvidenceQuery = readFileSync(resolve(scriptDir, './source-digest-evidence.sql'), 'utf8');

loadEnvFile(rootEnvPath);

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Add it to .env, then re-run.');
  process.exit(1);
}

const client = new Client({ connectionString: databaseUrl });

async function main() {
  await client.connect();
  const out = [];
  const line = (s) => out.push(s);

  line('=== DELIVERY DIAGNOSTICS ===\n');

  // --- Gate 1: subscriptions ---
  line('--- 1. Subscriptions (entitlement) ---');
  const subs = await safe(() =>
    client.query(
      `SELECT user_id, status, plan, current_period_end
       FROM subscriptions ORDER BY updated_at DESC NULLS LAST LIMIT 10`
    )
  );
  if (subs.error) {
    line(`  ⚠ query failed: ${subs.error}`);
  } else if (subs.rows.length === 0) {
    line('  ✗ FAIL: no subscription rows at all.');
  } else {
    const active = subs.rows.filter((r) => ['trial', 'active', 'past_due'].includes(r.status));
    line(`  rows: ${subs.rows.length}, entitling (trial/active/past_due): ${active.length}`);
    for (const r of subs.rows) {
      const ok = ['trial', 'active', 'past_due'].includes(r.status) ? '✓' : '·';
      line(`    ${ok} user=${r.user_id} status=${r.status} plan=${r.plan ?? '—'} end=${fmt(r.current_period_end)}`);
    }
    line(active.length > 0 ? '  ✓ PASS: at least one entitling subscription.' : '  ✗ FAIL: no entitling subscription.');
  }
  line('');

  // --- Gate 2: client profiles + telegram target ---
  line('--- 2. Client profiles & Telegram target ---');
  const profiles = await safe(() =>
    client.query(
      `SELECT id::TEXT AS id, is_active,
              (telegram_chat_id IS NOT NULL) AS has_tg,
              telegram_chat_id
       FROM client_profiles ORDER BY created_at DESC NULLS LAST LIMIT 10`
    )
  );
  if (profiles.error) {
    line(`  ⚠ query failed: ${profiles.error}`);
  } else if (profiles.rows.length === 0) {
    line('  ✗ FAIL: no client_profiles rows.');
  } else {
    const deliverable = profiles.rows.filter((r) => r.is_active && r.has_tg);
    line(`  rows: ${profiles.rows.length}, deliverable (is_active AND telegram_chat_id): ${deliverable.length}`);
    for (const r of profiles.rows) {
      const ok = r.is_active && r.has_tg ? '✓' : '·';
      line(`    ${ok} id=${r.id} active=${r.is_active} tg=${r.has_tg ? r.telegram_chat_id : 'NULL'}`);
    }
    line(deliverable.length > 0 ? '  ✓ PASS: a deliverable profile exists.' : '  ✗ FAIL: no active profile with telegram_chat_id — daily-radar will skip delivery.');
  }
  line('');

  // --- Gate 3: signal freshness ---
  line('--- 3. Signal freshness (digest-evidence needs published_at within 45d) ---');
  const fresh = await safe(() =>
    client.query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE published_at >= NOW() - interval '45 days') AS within_45d,
         COUNT(*) FILTER (WHERE published_at >= NOW() - interval '14 days') AS within_14d,
         MAX(published_at) AS newest
       FROM signals`
    )
  );
  if (fresh.error) {
    line(`  ⚠ query failed: ${fresh.error}`);
  } else {
    const r = fresh.rows[0];
    line(`  signals total: ${r.total}, within 45d: ${r.within_45d}, within 14d: ${r.within_14d}, newest: ${fmt(r.newest)}`);
    line(Number(r.within_45d) > 0 ? '  ✓ PASS: fresh signals present.' : '  ✗ FAIL: no signals within 45 days — digest-evidence yields nothing.');
  }
  line('');

  // --- Gate 4: digest-evidence output by confidence gate ---
  line('--- 4. Digest-evidence candidates by confidence gate ---');
  const evid = await safe(() =>
    client.query(
      `SELECT confidence_gate, COUNT(*) AS n
       FROM ( ${digestEvidenceQuery} ) e
       GROUP BY confidence_gate ORDER BY confidence_gate`
    )
  );
  if (evid.error) {
    line(`  ⚠ query failed: ${evid.error}`);
  } else if (evid.rows.length === 0) {
    line('  ✗ FAIL: digest-evidence query returned 0 candidates (nothing to deliver).');
  } else {
    let ab = 0;
    for (const r of evid.rows) {
      const auto = r.confidence_gate === 'A' || r.confidence_gate === 'B';
      if (auto) ab += Number(r.n);
      line(`    gate ${r.confidence_gate}: ${r.n}${auto ? '  (auto-deliver)' : '  (held/review)'}`);
    }
    line(ab > 0 ? `  ✓ PASS: ${ab} candidate(s) at gate A/B would auto-deliver.` : '  ✗ FAIL: candidates exist but none at gate A/B — all held for review.');
  }
  line('');

  line('=== END ===');
  console.log(out.join('\n'));
}

async function safe(fn) {
  try {
    return await fn();
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), rows: [] };
  }
}

function fmt(v) {
  if (!v) return '—';
  try {
    return new Date(v).toISOString().slice(0, 16).replace('T', ' ');
  } catch {
    return String(v);
  }
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const envFile = readFileSync(filePath, 'utf8').replace(/^﻿/, '');
  for (const rawLine of envFile.split(/\r?\n/)) {
    const trimmedLine = rawLine.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) continue;
    const separatorIndex = rawLine.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = rawLine.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = rawLine.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

main()
  .catch((e) => {
    console.error('diagnose-delivery failed:');
    console.error('  code:', e?.code ?? '(none)');
    console.error('  message:', e?.message ?? '(empty)');
    if (e?.stack) console.error(e.stack);
    process.exitCode = 1;
  })
  .finally(() => client.end().catch(() => {}));
