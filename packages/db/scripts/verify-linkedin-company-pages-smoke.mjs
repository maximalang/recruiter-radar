import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildFetchSummary,
  resolveLinkedinInput,
  resolveLinkedinProviderInput,
} from './source-linkedin-company-pages.mjs';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const fixturePath = resolve(scriptDir, './linkedin-company-pages-smoke-fixture.json');

process.env.LINKEDIN_COMPANY_PAGES_INPUT_FILE = fixturePath;
delete process.env.DATABASE_URL;

const input = resolveLinkedinInput();
const summary = buildFetchSummary(input);

assert.equal(summary.source, 'linkedin-company-pages');
assert.equal(summary.action, 'fetch');
assert.equal(summary.inputMode, 'file');
assert.equal(summary.inputFilePath, fixturePath);
assert.equal(summary.recordsReceived, 4);
assert.equal(summary.normalizedRecords, 4);
assert.equal(summary.skippedRecords, 0);

const rec1 = input.normalizedRecords.find((r) => r.signalExternalId === 'li-smoke-1');
assert.ok(rec1, 'missing normalized record li-smoke-1');
assert.equal(rec1.companyName, 'TechFlow Solutions');
assert.equal(rec1.companyDomain, 'techflow.example');
assert.equal(rec1.linkedinCompanyId, '12345678');
assert.equal(rec1.jobTitle, 'Senior Backend Developer');
assert.equal(rec1.location, 'Москва');
assert.equal(rec1.primarySourceKey, 'linkedin:12345678');

const rec2 = input.normalizedRecords.find((r) => r.signalExternalId === 'li-smoke-2');
assert.ok(rec2, 'missing normalized record li-smoke-2');
assert.equal(rec2.jobTitle, 'Product Manager');
assert.equal(rec2.primarySourceKey, 'linkedin:12345678');

const rec3 = input.normalizedRecords.find((r) => r.signalExternalId === 'li-smoke-3');
assert.ok(rec3, 'missing normalized record li-smoke-3');
assert.equal(rec3.companyName, 'DataVerse Inc');
assert.equal(rec3.linkedinCompanyId, '87654321');
assert.equal(rec3.primarySourceKey, 'linkedin:87654321');

const rec4 = input.normalizedRecords.find((r) => r.companyName === 'NoId Corp');
assert.ok(rec4, 'missing normalized record for NoId Corp');
assert.equal(rec4.jobTitle, 'QA Engineer');
assert.equal(rec4.primarySourceKey, 'company-name:noid corp');

for (const record of input.normalizedRecords) {
  assert.equal(record.orgSourceKeys.length > 0, true, `record ${record.signalExternalId} must have orgSourceKeys`);
  assert.ok(record.primarySourceKey, `record ${record.signalExternalId} must have primarySourceKey`);
  assert.ok(record.signalExternalId, `record must have non-empty signalExternalId`);
  assert.ok(record.jobTitle, `record ${record.signalExternalId} must have non-empty jobTitle (used as headline)`);

  // org_source_refs.external_id must be org-level only (linkedinCompanyId), never job-level
  const orgRefExternalId = record.linkedinCompanyId ?? null;
  if (orgRefExternalId) {
    assert.notEqual(orgRefExternalId, record.externalId,
      `org ref external_id must not be job-level id for ${record.signalExternalId}`);
  }
  // If no linkedinCompanyId, org ref external_id should be null
  if (!record.linkedinCompanyId) {
    assert.equal(orgRefExternalId, null,
      `org ref external_id must be null when no linkedinCompanyId for ${record.signalExternalId}`);
  }
}

const providerMode = await runProviderModeSmoke();

console.log(JSON.stringify({
  ok: true,
  source: 'linkedin-company-pages',
  mode: 'read-only-smoke',
  fixturePath,
  recordsReceived: summary.recordsReceived,
  normalizedRecords: summary.normalizedRecords,
  skippedRecords: summary.skippedRecords,
  providerMode,
  verifiedExternalIds: ['li-smoke-1', 'li-smoke-2', 'li-smoke-3', 'NoId Corp derived'],
  sideEffects: { databaseUrlUsed: false },
}, null, 2));

async function runProviderModeSmoke() {
  const originalFetch = globalThis.fetch;
  const requestedHeaders = [];

  globalThis.fetch = async (_url, options = {}) => {
    requestedHeaders.push(options.headers ?? {});

    if (options.headers?.authorization !== 'Bearer linkedin-smoke-token') {
      return jsonResponse({ error: 'unauthorized' }, { status: 401 });
    }

    return jsonResponse({
      records: [
        {
          external_id: 'li-provider-1',
          linkedin_company_id: '555001',
          company_name: 'LinkedIn Provider Co',
          company_domain: 'linkedin-provider.example',
          job_title: 'Machine Learning Engineer',
          job_posting_url: 'https://www.linkedin.com/jobs/view/li-provider-1',
          published_at: '2026-05-01T00:00:00.000Z',
        },
      ],
    });
  };

  try {
    const providerInput = await resolveLinkedinProviderInput({
      providerUrl: 'https://provider.example/linkedin?api_key=secret-value',
      providerToken: 'linkedin-smoke-token',
    });
    const providerSummary = buildFetchSummary(providerInput);

    assert.equal(providerSummary.inputMode, 'provider-token');
    assert.equal(providerSummary.recordsReceived, 1);
    assert.equal(providerSummary.normalizedRecords, 1);
    assert.equal(providerSummary.skippedRecords, 0);
    assert.equal(providerInput.normalizedRecords[0].primarySourceKey, 'linkedin:555001');
    assert.equal(providerInput.normalizedRecords[0].jobTitle, 'Machine Learning Engineer');
    assert.equal(requestedHeaders.length, 1);

    globalThis.fetch = async () => jsonResponse({ data: [] });
    await assert.rejects(
      () => resolveLinkedinProviderInput({
        providerUrl: 'https://provider.example/linkedin-invalid',
        providerToken: 'linkedin-smoke-token',
      }),
      /records array/,
    );

    globalThis.fetch = async () => jsonResponse({
      records: [{ company_name: 'Broken LinkedIn Provider Co' }],
    });
    await assert.rejects(
      () => resolveLinkedinProviderInput({
        providerUrl: 'https://provider.example/linkedin-broken',
        providerToken: 'linkedin-smoke-token',
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
