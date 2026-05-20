import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildFetchSummary,
  resolveRabotaRossiiConfiguredInput,
  resolveRabotaRossiiLiveInput,
} from './source-rabota-rossii.mjs';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const fixturePath = resolve(scriptDir, './rabota-rossii-smoke-fixture.json');

process.env.RABOTA_ROSSII_INPUT_FILE = fixturePath;
delete process.env.RABOTA_ROSSII_SEARCH_TEXT;
delete process.env.DATABASE_URL;

const input = await resolveRabotaRossiiConfiguredInput();
const summary = buildFetchSummary(input);

assert.equal(summary.source, 'rabota-rossii');
assert.equal(summary.action, 'fetch');
assert.equal(summary.inputMode, 'file');
assert.equal(summary.inputFilePath, fixturePath);
assert.equal(summary.recordsReceived, 5);
assert.equal(summary.duplicateRecords, 1);
assert.equal(summary.normalizedRecords, 2);
assert.equal(summary.skippedRecords, 2);

const rec1 = input.normalizedRecords.find((r) => r.signalExternalId === 'rabota-rossii:rr-smoke-1');
assert.ok(rec1, 'missing Rabota Rossii smoke record 1');
assert.equal(rec1.primarySourceKey, 'inn:7729670341');
assert.equal(rec1.orgExternalId, '7729670341');
assert.equal(rec1.companyDomain, 'rdp-smoke.example');
assert.equal(rec1.jobTitle, 'Python Developer');
assert.equal(rec1.payload.job_title, 'Python Developer');
assert.equal(rec1.payload.email, undefined, 'personal/company emails from source payload must not be stored');
assert.equal(rec1.payload.contact_person, undefined, 'contact_person must not be stored');

const rec2 = input.normalizedRecords.find((r) => r.signalExternalId === 'rabota-rossii:rr-smoke-2');
assert.ok(rec2, 'missing Rabota Rossii smoke record 2');
assert.equal(rec2.primarySourceKey, 'domain:turbo-smoke.example');
assert.equal(rec2.orgExternalId, null, 'job-level id must not leak into org refs');
assert.equal(
  input.normalizedRecords.some((record) => record.primarySourceKey === 'domain:trudvsem.ru'),
  false,
  'Rabota Rossii must not use the platform URL domain as company identity',
);

const liveMode = await runLiveModeSmoke();

console.log(JSON.stringify({
  ok: true,
  source: 'rabota-rossii',
  mode: 'read-only-smoke',
  fixturePath,
  recordsReceived: summary.recordsReceived,
  duplicateRecords: summary.duplicateRecords,
  normalizedRecords: summary.normalizedRecords,
  skippedRecords: summary.skippedRecords,
  liveMode,
  evidenceBoundary: 'primary-platform, not promoted to digest until confidence gates pass',
  sideEffects: { databaseUrlUsed: false },
}, null, 2));

async function runLiveModeSmoke() {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];

  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return jsonResponse({
      status: '200',
      meta: { total: 1, limit: 1 },
      results: {
        vacancies: [
          {
            vacancy: {
              id: 'rr-live-1',
              'job-name': 'Live Data Engineer',
              'creation-date': '2026-05-03T09:00:00+03:00',
              company: {
                name: 'Live Rabota Co',
                inn: '7712345678',
                site: 'https://live-rabota.example/',
                email: 'personal@live-rabota.example',
              },
              region: { name: 'Moscow' },
              vac_url: 'https://trudvsem.ru/vacancy/card/7712345678/rr-live-1',
              contact_person: 'Must Not Persist',
            },
          },
        ],
      },
    });
  };

  try {
    const liveInput = await resolveRabotaRossiiLiveInput({
      searchText: 'data engineer',
      regionCode: '7700000000000',
      offset: 0,
      limit: 1,
    });
    assert.equal(liveInput.inputMode, 'live-public');
    assert.equal(liveInput.liveProvider, 'trudvsem-opendata');
    assert.equal(liveInput.recordsReceived, 1);
    assert.equal(liveInput.normalizedRecords.length, 1);
    assert.equal(liveInput.normalizedRecords[0].payload.email, undefined);
    assert.equal(requestedUrls.length, 1);
    const requestedUrl = new URL(requestedUrls[0]);
    assert.equal(requestedUrl.hostname, 'opendata.trudvsem.ru');
    assert.equal(requestedUrl.pathname, '/api/v1/vacancies');
    assert.equal(requestedUrl.searchParams.get('text'), 'data engineer');
    assert.equal(requestedUrl.searchParams.get('region_code'), '7700000000000');

    return {
      inputMode: liveInput.inputMode,
      liveProvider: liveInput.liveProvider,
      requestedUrls: requestedUrls.length,
      normalizedRecords: liveInput.normalizedRecords.length,
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'ERROR',
    url: 'https://opendata.trudvsem.ru/api/v1/vacancies',
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}
