/**
 * Tests for the per-org enrichment cost guard (spec §2 / Block 1 §4).
 *
 * Contract: at most ONE provider call per org per 24h. The check-and-record is
 * atomic, so a second weak lead for the same org inside the window is blocked.
 * Tests run without REDIS_URL, exercising the in-memory fallback path; the Redis
 * path uses the same SET-NX-EX semantics in production.
 */

import {
  tryConsumeEnrichmentQuota,
  ENRICHMENT_QUOTA_WINDOW_MS,
  __resetEnrichmentQuotaForTests,
} from '@/lib/ai/enrichment/enrichmentRateLimit';

beforeEach(() => {
  __resetEnrichmentQuotaForTests();
});

describe('tryConsumeEnrichmentQuota', () => {
  it('allows the first call for an org', async () => {
    const d = await tryConsumeEnrichmentQuota('org-1', 1_000);
    expect(d.allowed).toBe(true);
  });

  it('blocks a second call within the 24h window', async () => {
    await tryConsumeEnrichmentQuota('org-1', 1_000);
    const second = await tryConsumeEnrichmentQuota('org-1', 1_000 + ENRICHMENT_QUOTA_WINDOW_MS - 1);
    expect(second.allowed).toBe(false);
    expect(second.retryAtMs).toBe(1_000 + ENRICHMENT_QUOTA_WINDOW_MS);
  });

  it('allows again once the window has elapsed', async () => {
    await tryConsumeEnrichmentQuota('org-1', 1_000);
    const later = await tryConsumeEnrichmentQuota('org-1', 1_000 + ENRICHMENT_QUOTA_WINDOW_MS);
    expect(later.allowed).toBe(true);
  });

  it('tracks each org independently', async () => {
    await tryConsumeEnrichmentQuota('org-1', 1_000);
    const otherOrg = await tryConsumeEnrichmentQuota('org-2', 1_000);
    expect(otherOrg.allowed).toBe(true);
  });

  it('is atomic: two sequential calls for one org → only one passes', async () => {
    // Same timestamp, simulating two weak leads hitting the guard together.
    const first = await tryConsumeEnrichmentQuota('org-1', 5_000);
    const second = await tryConsumeEnrichmentQuota('org-1', 5_000);
    expect([first.allowed, second.allowed].filter(Boolean)).toHaveLength(1);
  });
});
