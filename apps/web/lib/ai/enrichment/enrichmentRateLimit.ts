/**
 * Enrichment cost guard — a per-org daily quota for the external AI provider.
 *
 * The ScrapeGraphAI extract/scrape calls cost money per request, so enrichment
 * must be rate-limited independently of throughput throttling. The rule here is a
 * COST rule, not a latency rule: at most ONE real provider call per org per 24h.
 * A weak page does not change minute-to-minute, so a daily ceiling is plenty of
 * recovery signal while bounding spend.
 *
 * Storage: Redis-backed when `ioredis` is installed AND `REDIS_URL` is set — a
 * single atomic `SET key <now> NX EX 86400` is the check-and-record, correct
 * across instances. Without `REDIS_URL` it falls back to an in-memory Map keyed
 * by orgId (dev/test / single-process). Same `tryConsumeEnrichmentQuota`
 * signature either way; only the backing store differs.
 *
 * Because Redis I/O is async, `tryConsumeEnrichmentQuota` returns a Promise. The
 * sole production caller (repairWeakCareerPage) already runs inside an async
 * function, so this is a one-line `await`.
 *
 * This module never talks to the provider — it only gates and LOGS. The actual
 * call is made by the caller only after the quota allows.
 */

/** Daily window. One real provider call per org per this period. */
export const ENRICHMENT_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Redis TTL for the per-org key — the 24h window, in seconds. */
const ENRICHMENT_QUOTA_TTL_SECONDS = 86_400;

/** Redis key for an org's quota window. */
function quotaKey(orgId: string): string {
  return `enrichment:${orgId}`;
}

// ─── In-memory fallback store ────────────────────────────────────────────────

/** orgId → epoch-ms of the last consumed enrichment call (no-Redis fallback). */
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

export interface QuotaDecision {
  /** True when a call is permitted now (and has been recorded). */
  allowed: boolean;
  /** When the next call becomes allowed, ms since epoch (only when blocked). */
  retryAtMs?: number;
}

/**
 * Try to consume one enrichment call for `orgId`. If the org has not called
 * within the window, records it and returns allowed; otherwise returns blocked
 * with the time the window reopens.
 *
 * Redis path: `SET enrichment:{orgId} <now> NX EX 86400` — the set succeeds only
 * if the key is absent, so the check and the record are a single atomic op and
 * two concurrent weak leads for one org across instances cannot both pass. On any
 * Redis error it degrades to the in-memory store rather than blocking enrichment.
 *
 * In-memory path: a module-level Map, atomic within one process (no await between
 * read and write).
 *
 * @param orgId organization the enrichment is for (cost is attributed per org).
 * @param now   injectable clock for deterministic tests; defaults to Date.now().
 */
export async function tryConsumeEnrichmentQuota(
  orgId: string,
  now: number = Date.now(),
): Promise<QuotaDecision> {
  const redis = getRedis();
  if (redis) {
    try {
      const set = await redis.set(quotaKey(orgId), String(now), 'EX', ENRICHMENT_QUOTA_TTL_SECONDS, 'NX');
      if (set === 'OK') return { allowed: true };
      // Blocked — derive the reopen time from the key's remaining TTL.
      const pttl = await redis.pttl(quotaKey(orgId));
      const retryAtMs = pttl > 0 ? now + pttl : now + ENRICHMENT_QUOTA_WINDOW_MS;
      return { allowed: false, retryAtMs };
    } catch {
      // Fall through to in-memory rather than fail closed on a Redis hiccup.
    }
  }

  const last = lastCallByOrg.get(orgId);
  if (last !== undefined && now - last < ENRICHMENT_QUOTA_WINDOW_MS) {
    return { allowed: false, retryAtMs: last + ENRICHMENT_QUOTA_WINDOW_MS };
  }
  lastCallByOrg.set(orgId, now);
  return { allowed: true };
}

/**
 * Structured log for a real (quota-passing) provider call. Keeps a single audit
 * line per spend event so spend is traceable: which provider, which org, which
 * page, whether it produced a usable result, whether the Crawl4AI markdown
 * fallback was used, and tokens if the provider reported them. Logging is the
 * only side effect — no provider call here.
 */
export function logEnrichmentApiCall(entry: {
  orgId: string;
  url: string;
  /** Which provider the quota was spent on (scrapegraph today). */
  provider?: string;
  /** Whether the primary extract produced usable enrichment data. */
  success?: boolean;
  /** Whether the Crawl4AI markdown fallback prep path ran (primary empty). */
  fallbackUsed?: boolean;
  tokensUsed?: number | null;
}): void {
  console.info(
    JSON.stringify({
      level: 'info',
      event: 'ai.enrichment.api_call',
      provider: entry.provider ?? null,
      orgId: entry.orgId,
      url: entry.url,
      success: entry.success ?? null,
      fallbackUsed: entry.fallbackUsed ?? false,
      tokensUsed: entry.tokensUsed ?? null,
    }),
  );
}

/**
 * Reset the in-memory quota window. Test-only — lets unit tests start from a
 * clean slate without leaking state across cases. Tests run without REDIS_URL,
 * so clearing the in-memory Map is sufficient; not exported from the public
 * lib/ai surface.
 */
export function __resetEnrichmentQuotaForTests(): void {
  lastCallByOrg.clear();
}
