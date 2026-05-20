import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildFetchSummary,
  resolveEgrulFnsInput,
  resolveEgrulProviderInput,
  resolveEgrulPublicInput,
} from './source-egrul-fns.mjs';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const fixturePath = resolve(scriptDir, './egrul-fns-smoke-fixture.json');

process.env.EGRUL_FNS_INPUT_FILE = fixturePath;
delete process.env.DATABASE_URL;

const input = resolveEgrulFnsInput();
const summary = buildFetchSummary(input);

assert.equal(summary.source, 'egrul-fns');
assert.equal(summary.action, 'fetch');
assert.equal(summary.inputMode, 'file');
assert.equal(summary.inputFilePath, fixturePath);
assert.equal(summary.recordsReceived, 3);
assert.equal(summary.normalizedRecords, 2);
assert.equal(summary.skippedRecords, 1);
assert.equal(summary.duplicateRecords, 0);

const rec1 = input.normalizedRecords.find((r) => r.signalExternalId === 'egrul-smoke-1');
assert.ok(rec1, 'missing normalized record egrul-smoke-1');
assert.equal(rec1.companyName, 'ООО Технологии Будущего');
assert.equal(rec1.inn, '7701234567');
assert.equal(rec1.ogrn, '1027700123456');
assert.equal(rec1.kpp, '770101001');
assert.equal(rec1.companyDomain, 'techfuture.example');
assert.equal(rec1.status, 'active');
assert.equal(rec1.legalAddress, 'г. Москва, ул. Тверская, д. 1');
assert.equal(rec1.okved, '62.01');
assert.equal(rec1.headName, undefined, 'EGRUL must not keep director/person names');
assert.equal(rec1.primarySourceKey, 'inn:7701234567');

const rec2 = input.normalizedRecords.find((r) => r.signalExternalId === 'egrul-smoke-2');
assert.ok(rec2, 'missing normalized record egrul-smoke-2');
assert.equal(rec2.companyName, 'АО Дата Системс');
assert.equal(rec2.inn, '7702345678');
assert.equal(rec2.primarySourceKey, 'inn:7702345678');

const soleProprietorRecord = input.normalizedRecords.find((r) => r.inn === '770312345678');
assert.equal(soleProprietorRecord, undefined, '12-digit INN/IP records must be skipped');

for (const record of input.normalizedRecords) {
  assert.equal(record.orgSourceKeys.length > 0, true, `record ${record.signalExternalId} must have orgSourceKeys`);
  assert.ok(record.primarySourceKey, `record ${record.signalExternalId} must have primarySourceKey`);
  assert.ok(record.innSourceKey || record.ogrnSourceKey || record.domainSourceKey, 'must have at least one registry key');
  assert.ok(record.signalExternalId, `record must have non-empty signalExternalId`);

  // egrul-fns: org_source_refs.external_id should be INN or OGRN (valid org-level ids)
  const orgRefExternalId = record.inn ?? record.ogrn ?? null;
  assert.ok(orgRefExternalId, `egrul record ${record.signalExternalId} must have INN or OGRN as org-level external_id`);

  // Verify headline would be non-empty (buildSignalHeadline uses orgName)
  assert.ok(record.orgName, `record ${record.signalExternalId} must have non-empty orgName for headline`);
}

const providerMode = await runProviderModeSmoke();
const livePublicMode = await runLivePublicModeSmoke();

console.log(JSON.stringify({
  ok: true,
  source: 'egrul-fns',
  mode: 'read-only-smoke',
  fixturePath,
  recordsReceived: summary.recordsReceived,
  normalizedRecords: summary.normalizedRecords,
  skippedRecords: summary.skippedRecords,
  evidenceBoundary: 'enrichment-only, never lead-originating',
  providerMode,
  livePublicMode,
  verifiedExternalIds: ['egrul-smoke-1', 'egrul-smoke-2'],
  sideEffects: { databaseUrlUsed: false },
}, null, 2));

async function runProviderModeSmoke() {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (_url, options = {}) => {
    if (options.headers?.authorization !== 'Bearer egrul-smoke-token') {
      return jsonResponse({ error: 'unauthorized' }, { status: 401 });
    }

    return jsonResponse({
      records: [
        {
          external_id: 'egrul-provider-1',
          company_name: 'Provider Registry Co',
          inn: '7709000001',
          ogrn: '1027709000001',
          status: 'active',
          detected_at: '2026-05-01T00:00:00.000Z',
        },
      ],
    });
  };

  try {
    const providerInput = await resolveEgrulProviderInput({
      providerUrl: 'https://provider.example/egrul?token=secret-value',
      providerToken: 'egrul-smoke-token',
    });
    const providerSummary = buildFetchSummary(providerInput);

    assert.equal(providerSummary.inputMode, 'provider-token');
    assert.equal(providerSummary.recordsReceived, 1);
    assert.equal(providerSummary.normalizedRecords, 1);
    assert.equal(providerSummary.skippedRecords, 0);
    assert.equal(providerInput.normalizedRecords[0].primarySourceKey, 'inn:7709000001');
    assert.equal(providerInput.normalizedRecords[0].status, 'active');

    globalThis.fetch = async () => jsonResponse({ data: [] });
    await assert.rejects(
      () => resolveEgrulProviderInput({
        providerUrl: 'https://provider.example/egrul-invalid',
        providerToken: 'egrul-smoke-token',
      }),
      /records array/,
    );

    globalThis.fetch = async () => jsonResponse({
      records: [{ status: 'active' }],
    });
    await assert.rejects(
      () => resolveEgrulProviderInput({
        providerUrl: 'https://provider.example/egrul-broken',
        providerToken: 'egrul-smoke-token',
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

async function runLivePublicModeSmoke() {
  const originalFetch = globalThis.fetch;
  const originalInputFile = process.env.EGRUL_FNS_INPUT_FILE;
  const originalInns = process.env.EGRUL_FNS_INNS;
  const originalBaseUrl = process.env.EGRUL_FNS_PUBLIC_BASE_URL;

  delete process.env.EGRUL_FNS_INPUT_FILE;
  process.env.EGRUL_FNS_INNS = '7709000002';
  process.env.EGRUL_FNS_PUBLIC_BASE_URL = 'https://egrul.example/';

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);

    if (!requestUrl.endsWith('/7709000002.json')) {
      return jsonResponse({ error: 'unexpected url' }, { status: 404 });
    }

    return jsonResponse({
      '\u0421\u0432\u042e\u041b': {
        '@attributes': {
          '\u0414\u0430\u0442\u0430\u0412\u044b\u043f': '2026-05-08',
          '\u041e\u0413\u0420\u041d': '1027709000002',
          '\u0414\u0430\u0442\u0430\u041e\u0413\u0420\u041d': '2002-08-16',
          '\u0418\u041d\u041d': '7709000002',
          '\u041a\u041f\u041f': '770901001',
        },
        '\u0421\u0432\u041d\u0430\u0438\u043c\u042e\u041b': {
          '@attributes': { '\u041d\u0430\u0438\u043c\u042e\u041b\u041f\u043e\u043b\u043d': 'LIVE EGRUL LLC' },
          '\u0421\u0432\u041d\u0430\u0438\u043c\u042e\u041b\u0421\u043e\u043a\u0440': { '@attributes': { '\u041d\u0430\u0438\u043c\u0421\u043e\u043a\u0440': 'LIVE EGRUL' } },
        },
      },
    });
  };

  try {
    const pendingInput = resolveEgrulFnsInput();
    assert.equal(pendingInput.inputMode, 'public-pending');
    assert.deepEqual(pendingInput.inns, ['7709000002']);

    const liveInput = await resolveEgrulPublicInput(pendingInput);
    const liveSummary = buildFetchSummary(liveInput);

    assert.equal(liveSummary.inputMode, 'live-public');
    assert.equal(liveSummary.liveProvider, 'egrul-public-json');
    assert.equal(liveSummary.innsRequested, 1);
    assert.equal(liveSummary.recordsReceived, 1);
    assert.equal(liveSummary.normalizedRecords, 1);
    assert.equal(liveSummary.skippedRecords, 0);
    assert.equal(liveInput.normalizedRecords[0].companyName, 'LIVE EGRUL');
    assert.equal(liveInput.normalizedRecords[0].inn, '7709000002');
    assert.equal(liveInput.normalizedRecords[0].ogrn, '1027709000002');
    assert.equal(liveInput.normalizedRecords[0].primarySourceKey, 'inn:7709000002');

    return {
      inputMode: liveSummary.inputMode,
      liveProvider: liveSummary.liveProvider,
      normalizedRecords: liveSummary.normalizedRecords,
    };
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv('EGRUL_FNS_INPUT_FILE', originalInputFile);
    restoreEnv('EGRUL_FNS_INNS', originalInns);
    restoreEnv('EGRUL_FNS_PUBLIC_BASE_URL', originalBaseUrl);
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
