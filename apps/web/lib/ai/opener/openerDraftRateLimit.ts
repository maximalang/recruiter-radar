/**
 * Opener-draft cost guard — a short per-org window for the LLM generation.
 *
 * The draft-opener generation calls the configured OpenAI-compatible provider,
 * which costs tokens per request, so it is rate-limited independently of
 * throughput throttling. The rule here is a COST rule: at most ONE real
 * provider call per org per 15 minutes. A lead's evidence does not change
 * minute-to-minute, so a short window is plenty for "regenerate" UX while
 * bounding spend (owner directive 2026-10-01: no new paid providers, no
 * unbounded generation).
 *
 * Storage: Redis-backed when `ioredis` is installed AND `REDIS_URL` is set — a
 * single atomic `SET key <now> NX EX 900` is the check-and-record, correct
 * across instances. Without `REDIS_URL` it falls back to an in-memory Map keyed
 * by orgId (dev/test / single-process). Same `tryConsumeOpenerDraftQuota`
 * signature either way; only the backing store differs.
 *
 * This module never talks to the provider — it only gates and LOGS. The actual
 * call is made by the caller only after the quota allows. Mirrors
 * lib/ai/enrichment/enrichmentRateLimit.ts (the enrichment cost guard).
 */

import { logEvent } from '@/lib/runtime';

/** Generation window. One real provider call per org per this period. */
export const OPENER_DRAFT_QUOTA_WINDOW_MS = 15 * 60 * 1000;

/** Redis TTL for the per-org key — the 15-minute window, in seconds. */
const OPENER_DRAFT_QUOTA_TTL_SECONDS = 900;

/** Redis key for an org's quota window. */
function quotaKey(orgId: string): string {
  return `opener-draft:${orgId}`;
}

// ─── In-memory fallback store ────────────────────────────────────────────────

/** orgId → epoch-ms of the last consumed generation call (no-Redis fallback). */
const lastCallByOrg = new Map<string, number>();

// ─── Redis bootstrap (optional — ioredis may not be installed) ───────────────

type RedisClient = {
  set: (
    key: string,
    value: string,
    ex: 'EX',
    ttl: number,
    nx: 'NX',
  ) => Promise<string | null>;
  pttl: (key: string) => Promise<number>;
  del: (key: string) => Promise<number>;
};

let _redis: RedisClient | null = null;
let _redisInitAttempted = false;

function getRedis(): RedisClient | null {
  if (_redisInitAttempted) return _redis;
  _redisInitAttempted = true;
  if (!process.env.REDIS_URL) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const IORedis = require('ioredis') as new (
      url: string,
      opts: Record<string, unknown>,
    ) => RedisClient;
    _redis = new IORedis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      connectTimeout: 2_000,
    });
    return _redis;
  } catch {
    return null;
  }
}

// ─── Decision + consume ──────────────────────────────────────────────────────

export interface OpenerDraftQuotaDecision {
  /** True when a call is permitted now (and has been recorded). */
  allowed: boolean;
  /** When the next call becomes allowed, ms since epoch (only when blocked). */
  retryAtMs?: number;
}

/**
 * Try to consume one opener-draft generation for `orgId`. If the org has not
 * generated within the window, records it and returns allowed; otherwise
 * returns blocked with the time the window reopens.
 *
 * Redis path: `SET opener-draft:{orgId} <now> NX EX 900` — the set succeeds
 * only if the key is absent, so the check and the record are a single atomic
 * op and two concurrent generations for one org across instances cannot both
 * pass. On any Redis error it degrades to the in-memory store rather than
 * blocking the feature.
 *
 * In-memory path: a module-level Map, atomic within one process (no await
 * between read and write).
 *
 * @param orgId organization the generation is for (cost is attributed per org).
 * @param now   injectable clock for deterministic tests; defaults to Date.now().
 */
export async function tryConsumeOpenerDraftQuota(
  orgId: string,
  now: number = Date.now(),
): Promise<OpenerDraftQuotaDecision> {
  const redis = getRedis();
  if (redis) {
    try {
      const set = await redis.set(
        quotaKey(orgId),
        String(now),
        'EX',
        OPENER_DRAFT_QUOTA_TTL_SECONDS,
        'NX',
      );
      if (set === 'OK') return { allowed: true };
      // Blocked — derive the reopen time from the key's remaining TTL.
      const pttl = await redis.pttl(quotaKey(orgId));
      const retryAtMs = pttl > 0 ? now + pttl : now + OPENER_DRAFT_QUOTA_WINDOW_MS;
      return { allowed: false, retryAtMs };
    } catch {
      // Fall through to in-memory rather than fail closed on a Redis hiccup.
    }
  }

  const last = lastCallByOrg.get(orgId);
  if (last !== undefined && now - last < OPENER_DRAFT_QUOTA_WINDOW_MS) {
    return { allowed: false, retryAtMs: last + OPENER_DRAFT_QUOTA_WINDOW_MS };
  }
  lastCallByOrg.set(orgId, now);
  return { allowed: true };
}

/**
 * Structured log for a real (quota-passing) provider call — the D3 "AI
 * generation trace" (AGENTS.md data-model expectations). Keeps a single audit
 * line per spend event so generation is traceable: which provider/model, which
 * org, the correlation traceId stored alongside the draft, whether it produced
 * a usable draft, and tokens if the provider reported them. Sanitized by
 * construction: no API key, no base URL, no draft text. Logging is the only
 * side effect — no provider call here.
 */
export function logOpenerDraftApiCall(entry: {
  orgId: string;
  /** Which provider the quota was spent on (codexoid/openai/unknown). */
  provider?: string;
  /** Model name passed to the provider. */
  model?: string;
  /** Correlation id persisted in StoredOpenerDraft.traceId. */
  traceId?: string;
  /** Whether the call produced a usable draft. */
  success?: boolean;
  tokensUsed?: number | null;
}): void {
  logEvent('ai.opener.api_call', {
    provider: entry.provider ?? null,
    model: entry.model ?? null,
    orgId: entry.orgId,
    traceId: entry.traceId ?? null,
    success: entry.success ?? null,
    tokensUsed: entry.tokensUsed ?? null,
  });
}

/**
 * Reset the in-memory quota window. Test-only — lets unit tests start from a
 * clean slate without leaking state across cases. Tests run without REDIS_URL,
 * so clearing the in-memory Map is sufficient; not exported from the public
 * lib/ai surface.
 */
export function __resetOpenerDraftQuotaForTests(): void {
  lastCallByOrg.clear();
}
