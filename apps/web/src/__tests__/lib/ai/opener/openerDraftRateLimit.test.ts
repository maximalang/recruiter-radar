/**
 * D3 opener-draft quota tests — the per-org cost guard for LLM generations
 * (mirrors the enrichment cost-guard contract).
 *
 * Contract under test:
 *   - at most ONE generation per org per 15-minute window (in-memory fallback
 *     path; CI has no REDIS_URL), with the reopen time returned when blocked.
 *   - the audit line ai.opener.api_call is sanitized: provider/model/orgId/
 *     traceId/success/tokens only — no API key, no base URL, no draft text.
 */

import { logEvent } from '@/lib/runtime';
import {
  logOpenerDraftApiCall,
  OPENER_DRAFT_QUOTA_WINDOW_MS,
  tryConsumeOpenerDraftQuota,
  __resetOpenerDraftQuotaForTests,
} from '@/lib/ai/opener/openerDraftRateLimit';

jest.mock('@/lib/runtime', () => ({
  logEvent: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

const mockLogEvent = jest.mocked(logEvent);

const T0 = Date.UTC(2026, 9, 1, 12, 0, 0); // 2026-10-01T12:00:00Z

beforeEach(() => {
  __resetOpenerDraftQuotaForTests();
  jest.clearAllMocks();
  delete process.env.REDIS_URL; // force the deterministic in-memory path
});

describe('tryConsumeOpenerDraftQuota', () => {
  it('allows the first generation for an org', async () => {
    const decision = await tryConsumeOpenerDraftQuota('9', T0);
    expect(decision).toEqual({ allowed: true });
  });

  it('blocks a second generation inside the window and reports the reopen time', async () => {
    await tryConsumeOpenerDraftQuota('9', T0);
    const blocked = await tryConsumeOpenerDraftQuota('9', T0 + 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAtMs).toBe(T0 + OPENER_DRAFT_QUOTA_WINDOW_MS);
  });

  it('allows again after the window elapsed', async () => {
    await tryConsumeOpenerDraftQuota('9', T0);
    const after = await tryConsumeOpenerDraftQuota('9', T0 + OPENER_DRAFT_QUOTA_WINDOW_MS + 1);
    expect(after).toEqual({ allowed: true });
  });

  it('attributes quotas per org (a different org is unaffected)', async () => {
    await tryConsumeOpenerDraftQuota('9', T0);
    expect((await tryConsumeOpenerDraftQuota('10', T0 + 1)).allowed).toBe(true);
  });

  it('keeps a 15-minute window', () => {
    expect(OPENER_DRAFT_QUOTA_WINDOW_MS).toBe(15 * 60 * 1000);
  });
});

describe('logOpenerDraftApiCall — sanitized audit trail', () => {
  it('emits ai.opener.api_call with attribution only (no key, no URL, no draft text)', () => {
    logOpenerDraftApiCall({
      orgId: '9',
      provider: 'codexoid',
      model: 'codexoid/test-model',
      traceId: 'trace-1',
      success: true,
      tokensUsed: 42,
    });

    expect(mockLogEvent).toHaveBeenCalledTimes(1);
    const [event, payload] = mockLogEvent.mock.calls[0];
    expect(event).toBe('ai.opener.api_call');
    expect(payload).toEqual({
      provider: 'codexoid',
      model: 'codexoid/test-model',
      orgId: '9',
      traceId: 'trace-1',
      success: true,
      tokensUsed: 42,
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('sk-');
    expect(serialized).not.toContain('http');
  });

  it('tolerates missing optional fields with explicit nulls', () => {
    logOpenerDraftApiCall({ orgId: '9' });
    const [, payload] = mockLogEvent.mock.calls[0];
    expect(payload).toEqual({ provider: null, model: null, orgId: '9', traceId: null, success: null, tokensUsed: null });
  });
});
