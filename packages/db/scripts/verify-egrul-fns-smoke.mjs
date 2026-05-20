import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildFetchSummary,
  resolveEgrulFnsInput,
  resolveEgrulProviderInput,
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
assert.equal(summary.normalizedRecords, 3);
assert.equal(summary.skippedRecords, 0);

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
assert.equal(rec1.headName, 'Иванов Иван Иванович');
assert.equal(rec1.primarySourceKey, 'inn:7701234567');

const rec2 = input.normalizedRecords.find((r) => r.signalExternalId === 'egrul-smoke-2');
assert.ok(rec2, 'missing normalized record egrul-smoke-2');
assert.equal(rec2.companyName, 'АО Дата Системс');
assert.equal(rec2.inn, '7702345678');
assert.equal(rec2.primarySourceKey, 'inn:7702345678');

const rec3 = input.normalizedRecords.find((r) => r.inn === '770312345678');
assert.ok(rec3, 'missing normalized record for ИП Петров');
assert.equal(rec3.companyName, 'ИП Петров');
assert.equal(rec3.primarySourceKey, 'inn:770312345678');
assert.equal(rec3.signalExternalId, 'egrul:inn:770312345678');

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
  verifiedExternalIds: ['egrul-smoke-1', 'egrul-smoke-2', 'egrul:inn:770312345678'],
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

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}
