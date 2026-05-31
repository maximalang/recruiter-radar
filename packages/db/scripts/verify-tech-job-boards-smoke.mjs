import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildFetchSummary,
  resolveTechJobBoardsInput,
  resolveTechJobBoardsLiveInput,
  resolveTechJobBoardsProviderInput,
} from './source-tech-job-boards.mjs';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const fixturePath = resolve(scriptDir, './tech-job-boards-smoke-fixture.json');

process.env.TECH_JOB_BOARDS_INPUT_FILE = fixturePath;
delete process.env.DATABASE_URL;

const input = resolveTechJobBoardsInput();
const summary = buildFetchSummary(input);

assert.equal(summary.source, 'tech-job-boards');
assert.equal(summary.action, 'fetch');
assert.equal(summary.inputMode, 'file');
assert.equal(summary.inputFilePath, fixturePath);
assert.equal(summary.recordsReceived, 6);
assert.equal(summary.recordsAfterDedupe, 5, 'duplicate record should be removed by dedupe');
assert.equal(summary.duplicateRecords, 1);
assert.equal(summary.normalizedRecords, 4);
assert.equal(summary.skippedRecords, 1);

const rec1 = input.normalizedRecords.find((r) => r.signalExternalId === 'habr-career:tjb-smoke-1');
assert.ok(rec1, 'missing normalized record tjb-smoke-1');
assert.equal(rec1.companyName, 'CloudNine Systems');
assert.equal(rec1.companyDomain, 'cloudnine.example');
assert.equal(rec1.jobTitle, 'DevOps Engineer');
assert.equal(rec1.board, 'habr-career');
assert.equal(rec1.salary, '300 000 — 450 000 ₽');
assert.deepEqual(rec1.tags, ['kubernetes', 'terraform', 'aws']);
assert.equal(rec1.primarySourceKey, 'domain:cloudnine.example');

const rec2 = input.normalizedRecords.find((r) => r.signalExternalId === 'habr-career:tjb-smoke-2');
assert.ok(rec2, 'missing normalized record tjb-smoke-2');
assert.equal(rec2.jobTitle, 'Senior Go Developer');

const noDuplicate = input.normalizedRecords.filter((r) => r.externalId === 'tjb-smoke-2');
assert.equal(noDuplicate.length, 1, 'duplicate should have been deduped');

const rec3 = input.normalizedRecords.find((r) => r.signalExternalId === 'getmatch:tjb-smoke-3');
assert.ok(rec3, 'missing normalized record tjb-smoke-3');
assert.equal(rec3.companyName, 'FinTech Pro');
assert.equal(rec3.board, 'getmatch');

const rec4 = input.normalizedRecords.find((r) => r.companyName === 'Minimal Board Co');
assert.ok(rec4, 'missing normalized record for Minimal Board Co');
assert.equal(rec4.board, 'unknown');
assert.equal(rec4.jobTitle, 'Python Developer');
assert.equal(
  input.normalizedRecords.some((r) => r.primarySourceKey === 'domain:jobs.example'),
  false,
  'tech-job-boards must not use job-board URL domains as company identity',
);

for (const record of input.normalizedRecords) {
  assert.equal(record.orgSourceKeys.length > 0, true, `record ${record.signalExternalId} must have orgSourceKeys`);
  assert.ok(record.primarySourceKey, `record ${record.signalExternalId} must have primarySourceKey`);
  assert.ok(record.signalExternalId, `record must have non-empty signalExternalId`);
  assert.ok(record.jobTitle, `record ${record.signalExternalId} must have non-empty jobTitle (used as headline)`);

  // org_source_refs.external_id must always be null for tech-job-boards (no org-level id exists)
  // The externalId field is job-level and must NOT leak into org refs
  assert.ok(record.externalId === null || typeof record.externalId === 'string',
    `externalId must be string or null for ${record.signalExternalId}`);
}

const liveMode = await runLiveModeSmoke();
const providerMode = await runProviderModeSmoke();

console.log(JSON.stringify({
  ok: true,
  source: 'tech-job-boards',
  mode: 'read-only-smoke',
  fixturePath,
  recordsReceived: summary.recordsReceived,
  recordsAfterDedupe: summary.recordsAfterDedupe,
  duplicateRecords: summary.duplicateRecords,
  normalizedRecords: summary.normalizedRecords,
  skippedRecords: summary.skippedRecords,
  dedupeVerified: true,
  liveMode,
  providerMode,
  verifiedExternalIds: ['tjb-smoke-1', 'tjb-smoke-2', 'tjb-smoke-3', 'Minimal Board Co derived'],
  sideEffects: { databaseUrlUsed: false },
}, null, 2));

async function runLiveModeSmoke() {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    requestedUrls.push(requestUrl);

    if (requestUrl.includes('boards-api.greenhouse.io')) {
      return jsonResponse({
        name: 'Greenhouse Live Co',
        jobs: [
          {
            id: 9001,
            title: 'Platform Engineer',
            absolute_url: 'https://boards.greenhouse.io/liveco/jobs/9001',
            updated_at: '2026-05-01T00:00:00.000Z',
            location: { name: 'Remote' },
            departments: [{ name: 'Engineering' }],
          },
        ],
      });
    }

    if (requestUrl.includes('api.lever.co')) {
      return jsonResponse([
        {
          id: 'lever-live-1',
          text: 'Data Engineer',
          hostedUrl: 'https://jobs.lever.co/liveco/lever-live-1',
          createdAt: Date.UTC(2026, 4, 1),
          categories: {
            team: 'Lever Live Co',
            location: 'Moscow',
            department: 'Data',
            commitment: 'Full-time',
          },
        },
      ]);
    }

    return jsonResponse({ ok: false }, { status: 404 });
  };

  try {
    const liveInput = await resolveTechJobBoardsLiveInput({
      greenhouseTokens: ['liveco'],
      leverSlugs: ['liveco'],
    });
    const liveSummary = buildFetchSummary(liveInput);

    assert.equal(liveSummary.inputMode, 'live-public');
    assert.equal(liveSummary.recordsReceived, 2);
    assert.equal(liveSummary.recordsAfterDedupe, 2);
    assert.equal(liveSummary.duplicateRecords, 0);
    assert.equal(liveSummary.normalizedRecords, 2);
    assert.equal(liveSummary.skippedRecords, 0);
    assert.ok(
      liveInput.normalizedRecords.some((record) => record.board === 'greenhouse'),
      'live mode must include Greenhouse records',
    );
    assert.ok(
      liveInput.normalizedRecords.some((record) => record.board === 'lever'),
      'live mode must include Lever records',
    );

    return {
      inputMode: liveSummary.inputMode,
      requestedUrls: requestedUrls.length,
      normalizedRecords: liveSummary.normalizedRecords,
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function runProviderModeSmoke() {
  const originalFetch = globalThis.fetch;
  const requested = [];

  globalThis.fetch = async (url, options = {}) => {
    requested.push({ url: String(url), headers: options.headers ?? {} });
    return jsonResponse({
      records: [
        {
          external_id: 'provider-job-1',
          board: 'api-mega-list-provider',
          company_name: 'Provider Jobs Co',
          company_domain: 'provider-jobs.example',
          job_title: 'Provider Platform Engineer',
          job_posting_url: 'https://jobs.example/provider-job-1',
          location: 'Moscow',
          email: 'must-not-persist@example.com',
        },
        {
          external_id: 'provider-board-only',
          board: 'api-mega-list-provider',
          job_title: 'Board-only Provider Engineer',
          job_posting_url: 'https://jobs.example/provider-board-only',
        },
      ],
    });
  };

  try {
    const providerInput = await resolveTechJobBoardsProviderInput({
      providerUrl: 'https://provider.example/jobs',
      providerToken: 'provider-smoke-token',
    });
    const providerSummary = buildFetchSummary(providerInput);

    assert.equal(providerSummary.inputMode, 'provider-token');
    assert.equal(providerSummary.recordsReceived, 2);
    assert.equal(providerSummary.recordsAfterDedupe, 2);
    assert.equal(providerSummary.normalizedRecords, 1);
    assert.equal(providerSummary.skippedRecords, 1);
    assert.equal(requested[0].headers.authorization, 'Bearer provider-smoke-token');
    assert.equal(providerInput.normalizedRecords[0].primarySourceKey, 'domain:provider-jobs.example');
    assert.equal(providerInput.normalizedRecords[0].externalId, 'provider-job-1');
    assert.equal(providerInput.normalizedRecords[0].email, undefined);
    assert.equal(
      providerInput.normalizedRecords.some((record) => record.primarySourceKey === 'domain:jobs.example'),
      false,
      'provider mode must not use provider/job-board URL domains as company identity',
    );

    globalThis.fetch = async () => jsonResponse({
      records: [
        {
          external_id: 'bad-provider-job',
          board: 'api-mega-list-provider',
          job_title: 'No Company Identity',
          job_posting_url: 'https://jobs.example/bad-provider-job',
        },
      ],
    });

    await assert.rejects(
      () => resolveTechJobBoardsProviderInput({
        providerUrl: 'https://provider.example/jobs-bad',
        providerToken: 'provider-smoke-token',
      }),
      /0 normalized records/,
    );

    return {
      inputMode: providerSummary.inputMode,
      authHeaderVerified: true,
      normalizedRecords: providerSummary.normalizedRecords,
      skippedRecords: providerSummary.skippedRecords,
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
