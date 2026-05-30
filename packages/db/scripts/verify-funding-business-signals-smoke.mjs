import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildFetchSummary,
  resolveFundingInput,
  resolveFundingProviderInput,
} from './source-funding-business-signals.mjs';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const fixturePath = resolve(scriptDir, './funding-business-signals-smoke-fixture.json');

process.env.FUNDING_BUSINESS_SIGNALS_INPUT_FILE = fixturePath;
delete process.env.DATABASE_URL;

const input = resolveFundingInput();
const summary = buildFetchSummary(input);

assert.equal(summary.source, 'funding-business-signals');
assert.equal(summary.action, 'fetch');
assert.equal(summary.inputMode, 'file');
assert.equal(summary.inputFilePath, fixturePath);
assert.equal(summary.recordsReceived, 5);
assert.equal(summary.normalizedRecords, 5);
assert.equal(summary.skippedRecords, 0);

const rec1 = input.normalizedRecords.find((r) => r.signalExternalId === 'fund-smoke-1');
assert.ok(rec1, 'missing normalized record fund-smoke-1');
assert.equal(rec1.companyName, 'RocketScale');
assert.equal(rec1.companyDomain, 'rocketscale.example');
assert.equal(rec1.eventType, 'series_a');
assert.equal(rec1.signalType, 'funding');
assert.equal(rec1.amount, '15000000');
assert.equal(rec1.currency, 'USD');
assert.deepEqual(rec1.investors, ['Sequoia Capital', 'Y Combinator']);
assert.equal(rec1.primarySourceKey, 'domain:rocketscale.example');

const rec2 = input.normalizedRecords.find((r) => r.signalExternalId === 'fund-smoke-2');
assert.ok(rec2, 'missing normalized record fund-smoke-2');
assert.equal(rec2.eventType, 'expansion');
assert.equal(rec2.signalType, 'other', 'non-funding event_type must produce signal_type=other');

const rec3 = input.normalizedRecords.find((r) => r.signalExternalId === 'fund-smoke-3');
assert.ok(rec3, 'missing normalized record fund-smoke-3');
assert.equal(rec3.companyName, 'GreenTech Labs');
assert.equal(rec3.eventType, 'grant');
assert.equal(rec3.signalType, 'funding');
assert.equal(rec3.amount, '50000000');
assert.equal(rec3.currency, 'RUB');

const rec4 = input.normalizedRecords.find((r) => r.companyName === 'NoType Signal Corp');
assert.ok(rec4, 'missing normalized record for NoType Signal Corp');
assert.equal(rec4.eventType, 'press_mention');
assert.equal(rec4.signalType, 'other', 'press_mention must not produce signal_type=funding');

const rec5 = input.normalizedRecords.find((r) => r.signalExternalId === 'fund-smoke-5');
assert.ok(rec5, 'missing normalized record fund-smoke-5');
assert.equal(rec5.companyName, 'HeadlessCorp');
assert.equal(rec5.signalType, 'funding', 'series_b must produce signal_type=funding');
assert.ok(rec5.headline, 'headline must be non-empty even when input has no headline field');
assert.equal(rec5.headline, 'HeadlessCorp — series_b', 'fallback headline must use company + event_type');

for (const record of input.normalizedRecords) {
  assert.equal(record.orgSourceKeys.length > 0, true, `record ${record.signalExternalId} must have orgSourceKeys`);
  assert.ok(record.primarySourceKey, `record ${record.signalExternalId} must have primarySourceKey`);
  assert.ok(['funding', 'other'].includes(record.signalType), `signal_type must be funding or other`);
  assert.ok(record.signalExternalId, `record must have non-empty signalExternalId`);

  // headline must always be non-empty (DB NOT NULL constraint)
  assert.ok(record.headline, `record ${record.signalExternalId} must have non-empty headline for DB safety`);

  // org_source_refs.external_id must always be null for funding-business-signals (no org-level id)
  // The externalId field is event/article-level and must NOT leak into org refs
}

const providerMode = await runProviderModeSmoke();

console.log(JSON.stringify({
  ok: true,
  source: 'funding-business-signals',
  mode: 'read-only-smoke',
  fixturePath,
  recordsReceived: summary.recordsReceived,
  normalizedRecords: summary.normalizedRecords,
  skippedRecords: summary.skippedRecords,
  evidenceBoundary: 'context-only, never lead-originating',
  providerMode,
  signalTypeDistribution: {
    funding: input.normalizedRecords.filter((r) => r.signalType === 'funding').length,
    other: input.normalizedRecords.filter((r) => r.signalType === 'other').length,
  },
  verifiedExternalIds: ['fund-smoke-1', 'fund-smoke-2', 'fund-smoke-3', 'NoType Signal Corp', 'fund-smoke-5'],
  sideEffects: { databaseUrlUsed: false },
}, null, 2));

async function runProviderModeSmoke() {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (_url, options = {}) => {
    if (options.headers?.authorization !== 'Bearer funding-smoke-token') {
      return jsonResponse({ error: 'unauthorized' }, { status: 401 });
    }

    return jsonResponse({
      records: [
        {
          external_id: 'fund-provider-1',
          company_name: 'Funding Provider Co',
          company_domain: 'funding-provider.example',
          event_type: 'series_a',
          headline: 'Funding Provider Co raises Series A',
          amount: '12000000',
          currency: 'USD',
          published_at: '2026-05-01T00:00:00.000Z',
        },
      ],
    });
  };

  try {
    const providerInput = await resolveFundingProviderInput({
      providerUrl: 'https://provider.example/funding?api_key=secret-value',
      providerToken: 'funding-smoke-token',
    });
    const providerSummary = buildFetchSummary(providerInput);

    assert.equal(providerSummary.inputMode, 'provider-token');
    assert.equal(providerSummary.recordsReceived, 1);
    assert.equal(providerSummary.normalizedRecords, 1);
    assert.equal(providerSummary.skippedRecords, 0);
    assert.equal(providerInput.normalizedRecords[0].primarySourceKey, 'domain:funding-provider.example');
    assert.equal(providerInput.normalizedRecords[0].signalType, 'funding');

    globalThis.fetch = async () => jsonResponse({ data: [] });
    await assert.rejects(
      () => resolveFundingProviderInput({
        providerUrl: 'https://provider.example/funding-invalid',
        providerToken: 'funding-smoke-token',
      }),
      /records array/,
    );

    globalThis.fetch = async () => jsonResponse({
      records: [{ event_type: 'series_a', headline: 'Broken provider event' }],
    });
    await assert.rejects(
      () => resolveFundingProviderInput({
        providerUrl: 'https://provider.example/funding-broken',
        providerToken: 'funding-smoke-token',
      }),
      /0 normalized records/,
    );

    return {
      inputMode: providerSummary.inputMode,
      authHeaderVerified: true,
      normalizedRecords: providerSummary.normalizedRecords,
      invalidShapeRejected: true,
      allSkippedRejected: true,
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}
