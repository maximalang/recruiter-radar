/**
 * Enrichment cost guard — a per-org daily quota for the external AI provider.
 *
 * The ScrapeGraphAI extract/scrape calls cost money per request, so enrichment
 * must be rate-limited independently of throughput throttling. The rule here is a
 * COST rule, not a latency rule: at most ONE real provider call per org per 24h.
 * A weak page does not change minute-to-minute, so a daily ceiling is plenty of
 * recovery signal while bounding spend.
 *
 * In-memory by design (per the Stage-2 brief): the window lives in a module-level
 * Map keyed by orgId. This is correct for a single-process run and avoids a DB
 * migration; a multi-instance deployment will later swap this for the existing
 * Redis layer (see REDIS_URL) behind the same `tryConsumeEnrichmentQuota` call.
 *
 * This module never talks to the provider — it only gates and LOGS. The actual
 * call is made by the caller (repairWeakCareerPage) only after the quota allows.
 */

/** Daily window. One real provider call per org per this period. */
export const ENRICHMENT_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

/** orgId → epoch-ms of the last consumed enrichment call. */
const lastCallByOrg = new Map<string, number>();

export interface QuotaDecision {
  /** True when a call is permitted now (and has been recorded). */
  allowed: boolean;
  /** When the next call becomes allowed, ms since epoch (only when blocked). */
  retryAtMs?: number;
}

/**
 * Try to consume one enrichment call for `orgId`. If the org has not called
 * within the window, records `now` and returns allowed. Otherwise returns
 * blocked with the time the window reopens. Atomic for a single process: the
 * check and the record happen together so two concurrent weak leads for the same
 * org cannot both pass.
 *
 * @param orgId organization the enrichment is for (cost is attributed per org).
 * @param now   injectable clock for deterministic tests; defaults to Date.now().
 */
export function tryConsumeEnrichmentQuota(orgId: string, now: number = Date.now()): QuotaDecision {
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
 * clean slate without leaking state across cases. Not exported from the public
 * lib/ai surface.
 */
export function __resetEnrichmentQuotaForTests(): void {
  lastCallByOrg.clear();
}
