/**
 * Evidence writer — Phase 2 of docs/plan.md v2.0.
 *
 * Adapters call writeEvidence() with a pg client to persist normalised
 * evidence into evidence_items. Idempotent by (org_id, content_hash) /
 * (content_hash) when org_id is null.
 *
 * Mirrors the pure helper in apps/web/lib/db/evidence.ts — keep the two
 * hash inputs in lockstep. If you change the hash recipe here, change it
 * there (and add a regression test).
 */

import { createHash } from 'node:crypto';

const VALID_TIERS = new Set(['direct', 'corroboration', 'context']);

function normaliseUrl(raw) {
  const trimmed = String(raw).trim();
  try {
    const u = new URL(trimmed);
    u.hash = '';
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return trimmed;
  }
}

function toIso(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`evidence: invalid fetchedAt value: ${String(value)}`);
  }
  return d.toISOString();
}

export function evidenceContentHash({ source, url, fetchedAt, tier }) {
  if (!VALID_TIERS.has(tier)) throw new Error(`evidence: invalid tier: ${String(tier)}`);
  if (!source || String(source).trim().length === 0) {
    throw new Error('evidence: source is required');
  }
  if (!url || String(url).trim().length === 0) {
    throw new Error('evidence: url is required');
  }
  const parts = [
    String(source).trim().toLowerCase(),
    normaliseUrl(url),
    toIso(fetchedAt),
    tier,
  ];
  return createHash('sha256').update(parts.join('')).digest('hex');
}

/**
 * Insert one evidence item. Returns the inserted row id, or the existing
 * row id if the (org_id, content_hash) pair already exists. Adapters
 * remain pure fetchers — only this writer talks to evidence_items.
 *
 * @param {import('pg').PoolClient | import('pg').Client} client
 * @param {{
 *   source: string,
 *   url: string,
 *   fetchedAt: string | Date,
 *   tier: 'direct' | 'corroboration' | 'context',
 *   orgId?: number | null,
 *   leadId?: number | null,
 *   payloadRef?: unknown,
 * }} input
 * @returns {Promise<{ id: number, contentHash: string, inserted: boolean }>}
 */
export async function writeEvidence(client, input) {
  const contentHash = evidenceContentHash(input);
  const fetchedAt = toIso(input.fetchedAt);
  const orgId = input.orgId ?? null;
  const leadId = input.leadId ?? null;
  const payloadRef = input.payloadRef ?? {};

  const insert = await client.query(
    `INSERT INTO evidence_items
       (org_id, lead_id, source, url, fetched_at, content_hash, tier, payload_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      orgId,
      leadId,
      String(input.source).trim(),
      String(input.url).trim(),
      fetchedAt,
      contentHash,
      input.tier,
      JSON.stringify(payloadRef),
    ]
  );

  if (insert.rowCount === 1) {
    return { id: Number(insert.rows[0].id), contentHash, inserted: true };
  }

  const existing = await client.query(
    orgId === null
      ? `SELECT id FROM evidence_items
           WHERE org_id IS NULL AND content_hash = $1
           LIMIT 1`
      : `SELECT id FROM evidence_items
           WHERE org_id = $1 AND content_hash = $2
           LIMIT 1`,
    orgId === null ? [contentHash] : [orgId, contentHash]
  );

  if (existing.rowCount === 0) {
    throw new Error('evidence: insert was suppressed but no existing row found');
  }
  return { id: Number(existing.rows[0].id), contentHash, inserted: false };
}

/**
 * Convenience batch writer. Sequential to keep transactional semantics
 * predictable — adapters typically batch O(10) items.
 */
export async function writeEvidenceBatch(client, items) {
  const out = [];
  for (const item of items) {
    out.push(await writeEvidence(client, item));
  }
  return out;
}
