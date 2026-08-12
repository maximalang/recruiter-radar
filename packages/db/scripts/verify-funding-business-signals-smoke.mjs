import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildFetchSummary,
  resolveFundingGdeltInput,
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
assert.equal(summary.duplicateRecords, 0);
assert.equal(summary.normalizedRecords, 4);
assert.equal(summary.skippedRecords, 1);

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
assert.equal(rec4, undefined, 'record without an original article URL must be rejected before ingest');

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
const gdeltMode = await runGdeltModeSmoke();
const expectedZeroMode = runExpectedZeroSmoke();

console.log(JSON.stringify({
  ok: true,
  source: 'funding-business-signals',
  mode: 'read-only-smoke',
  fixturePath,
  recordsReceived: summary.recordsReceived,
  duplicateRecords: summary.duplicateRecords,
  normalizedRecords: summary.normalizedRecords,
  skippedRecords: summary.skippedRecords,
  evidenceBoundary: 'context-only, never lead-originating',
  providerMode,
  gdeltMode,
  expectedZeroMode,
  signalTypeDistribution: {
    funding: input.normalizedRecords.filter((r) => r.signalType === 'funding').length,
    other: input.normalizedRecords.filter((r) => r.signalType === 'other').length,
  },
  verifiedExternalIds: ['fund-smoke-1', 'fund-smoke-2', 'fund-smoke-3', 'fund-smoke-5'],
  sideEffects: { databaseUrlUsed: false },
}, null, 2));

function runExpectedZeroSmoke() {
  const originalInputFile = process.env.FUNDING_BUSINESS_SIGNALS_INPUT_FILE;
  const originalQueriesJson = process.env.FUNDING_SIGNALS_GDELT_QUERIES_JSON;

  delete process.env.FUNDING_BUSINESS_SIGNALS_INPUT_FILE;
  process.env.FUNDING_SIGNALS_GDELT_QUERIES_JSON = '{"queries":[]}';

  try {
    const expectedZeroInput = resolveFundingInput();
    const expectedZeroSummary = buildFetchSummary(expectedZeroInput);

    assert.equal(expectedZeroSummary.inputMode, 'expected-zero');
    assert.equal(expectedZeroSummary.recordsReceived, 0);
    assert.equal(expectedZeroSummary.normalizedRecords, 0);
    assert.equal(expectedZeroSummary.zeroReason, 'no-eligible-company-targets');

    return {
      inputMode: expectedZeroSummary.inputMode,
      zeroReason: expectedZeroSummary.zeroReason,
    };
  } finally {
    restoreEnv('FUNDING_BUSINESS_SIGNALS_INPUT_FILE', originalInputFile);
    restoreEnv('FUNDING_SIGNALS_GDELT_QUERIES_JSON', originalQueriesJson);
  }
}

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
          source_url: 'https://funding-provider.example/events/series-a',
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
    assert.equal(providerSummary.duplicateRecords, 0);
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

async function runGdeltModeSmoke() {
  const originalFetch = globalThis.fetch;
  const originalInputFile = process.env.FUNDING_BUSINESS_SIGNALS_INPUT_FILE;
  const originalQueriesJson = process.env.FUNDING_SIGNALS_GDELT_QUERIES_JSON;
  const originalTransport = process.env.FUNDING_SIGNALS_GDELT_TRANSPORT;
  const requestedUrls = [];

  delete process.env.FUNDING_BUSINESS_SIGNALS_INPUT_FILE;
  process.env.FUNDING_SIGNALS_GDELT_TRANSPORT = 'fetch';
  process.env.FUNDING_SIGNALS_GDELT_QUERIES_JSON = JSON.stringify([
    {
      query: 'RocketScale Series B hiring',
      company_name: '\u041e\u041e\u041e RocketScale',
      company_domain: 'rocketscale.example',
      max_records: 2,
      timespan: '7d',
    },
  ]);

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    requestedUrls.push(requestUrl);

    if (!requestUrl.includes('api.gdeltproject.org/api/v2/doc/doc')) {
      return jsonResponse({ error: 'unexpected url' }, { status: 404 });
    }

    return jsonResponse({
      articles: [
        {
          title: 'RocketScale raises Series B to expand hiring',
          url: 'https://news.example/rocketscale-series-b',
          domain: 'news.example',
          seendate: '20260501123000',
        },
        {
          title: 'RocketScale raises Series B to expand hiring',
          url: 'https://syndication.example/rocketscale-series-b-copy',
          domain: 'syndication.example',
          seendate: '20260501124500',
        },
      ],
    });
  };

  try {
    const pendingInput = resolveFundingInput();
    assert.equal(pendingInput.inputMode, 'gdelt-pending');
    assert.equal(pendingInput.gdeltQueries.length, 1);
    assert.equal(pendingInput.gdeltQueries[0].companyName, '\u041e\u041e\u041e RocketScale');
    assert.equal(pendingInput.gdeltQueries[0].companyDomain, 'rocketscale.example');
    assert.equal(pendingInput.gdeltQueries[0].maxRecords, 2);
    assert.equal(pendingInput.gdeltQueries[0].timespan, '7d');

    const gdeltInput = await resolveFundingGdeltInput(pendingInput);
    const gdeltSummary = buildFetchSummary(gdeltInput);

    assert.equal(gdeltSummary.inputMode, 'live-public');
    assert.equal(gdeltSummary.liveProvider, 'gdelt-doc-api');
    assert.equal(gdeltSummary.queriesReceived, 1);
    assert.equal(gdeltSummary.recordsReceived, 2);
    assert.equal(gdeltSummary.duplicateRecords, 1);
    assert.equal(gdeltSummary.normalizedRecords, 1);
    assert.equal(gdeltSummary.skippedRecords, 0);

    const gdeltRecord = gdeltInput.normalizedRecords[0];
    assert.equal(gdeltRecord.companyName, '\u041e\u041e\u041e RocketScale');
    assert.equal(gdeltRecord.companyDomain, 'rocketscale.example');
    assert.equal(gdeltRecord.discoveryQuery, 'RocketScale Series B hiring');
    assert.match(gdeltRecord.syndicationFingerprint, /^rocketscale\.example\|2026-05-01\|/);
    assert.equal(gdeltRecord.orgSourceKeys.includes('ru-legal-name:rocketscale'), false);
    assert.ok(gdeltRecord.orgSourceAliasKeys.includes('ru-legal-name:rocketscale'));
    assert.equal(gdeltRecord.eventType, 'series_b');
    assert.equal(gdeltRecord.signalType, 'funding');
    assert.equal(gdeltRecord.detectedAt, '2026-05-01T12:30:00.000Z');

    globalThis.fetch = async () => jsonResponse({
      articles: [{
        title: 'Unusable story without entity',
        url: 'https://media.example/entityless-funding-story',
        domain: 'media.example',
        seendate: '20260501123000',
      }],
    });
    await assert.rejects(
      () => resolveFundingGdeltInput({
        gdeltQueries: [{ query: 'entityless funding', maxRecords: 1, timespan: '7d' }],
      }),
      /0 normalized records/,
    );

    return {
      inputMode: gdeltSummary.inputMode,
      liveProvider: gdeltSummary.liveProvider,
      requestedUrls: requestedUrls.length,
      normalizedRecords: gdeltSummary.normalizedRecords,
      allSkippedRejected: true,
    };
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv('FUNDING_BUSINESS_SIGNALS_INPUT_FILE', originalInputFile);
    restoreEnv('FUNDING_SIGNALS_GDELT_QUERIES_JSON', originalQueriesJson);
    restoreEnv('FUNDING_SIGNALS_GDELT_TRANSPORT', originalTransport);
  }
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}
