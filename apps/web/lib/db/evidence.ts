/**
 * Evidence bundle helpers — Phase 2 of docs/plan.md v2.0.
 *
 * Evidence is a structural object, not free-form text. Each item carries
 * a tier classification used by FIUR scoring and confidence gates.
 *
 * Pure module — no I/O. The DB writer lives in packages/db/lib/evidence.mjs
 * and uses these helpers for the deterministic content_hash that gives
 * the writer its idempotency.
 */

import { createHash } from 'node:crypto'

export type EvidenceTier = 'direct' | 'corroboration' | 'context'

export interface EvidenceItemInput {
  source: string
  url: string
  fetchedAt: string | Date
  tier: EvidenceTier
  /**
   * Reference into the source-specific payload store (e.g. `org_source_refs.id`
   * or a JSON pointer). Stored as JSON — caller decides shape.
   */
  payloadRef?: unknown
  orgId?: number | null
  leadId?: number | null
}

export interface EvidenceItemRecord extends EvidenceItemInput {
  contentHash: string
  fetchedAt: string
}

const VALID_TIERS: ReadonlySet<EvidenceTier> = new Set(['direct', 'corroboration', 'context'])

export function isEvidenceTier(value: unknown): value is EvidenceTier {
  return typeof value === 'string' && VALID_TIERS.has(value as EvidenceTier)
}

function normaliseUrl(raw: string): string {
  const trimmed = raw.trim()
  try {
    const u = new URL(trimmed)
    u.hash = ''
    // strip trailing slash on path for stability
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1)
    }
    return u.toString()
  } catch {
    return trimmed
  }
}

function toIso(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) {
    throw new Error(`evidence: invalid fetchedAt value: ${String(value)}`)
  }
  return d.toISOString()
}

/**
 * Deterministic content hash. Two evidence items that point to the same
 * source URL fetched at the same instant with the same tier will collide,
 * which is exactly the idempotency we want for the writer.
 */
export function evidenceContentHash(input: EvidenceItemInput): string {
  if (!isEvidenceTier(input.tier)) {
    throw new Error(`evidence: invalid tier: ${String(input.tier)}`)
  }
  if (!input.source || input.source.trim().length === 0) {
    throw new Error('evidence: source is required')
  }
  if (!input.url || input.url.trim().length === 0) {
    throw new Error('evidence: url is required')
  }

  const parts = [
    input.source.trim().toLowerCase(),
    normaliseUrl(input.url),
    toIso(input.fetchedAt),
    input.tier,
  ]
  return createHash('sha256').update(parts.join('')).digest('hex')
}

export function buildEvidenceRecord(input: EvidenceItemInput): EvidenceItemRecord {
  return {
    ...input,
    fetchedAt: toIso(input.fetchedAt),
    contentHash: evidenceContentHash(input),
  }
}
