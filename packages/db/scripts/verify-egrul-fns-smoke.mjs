import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildFetchSummary, resolveEgrulFnsInput } from './source-egrul-fns.mjs';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const fixturePath = resolve(scriptDir, './egrul-fns-smoke-fixture.json');
const originalInputFile = process.env.EGRUL_FNS_INPUT_FILE;

process.env.EGRUL_FNS_INPUT_FILE = fixturePath;
delete process.env.DATABASE_URL;

const input = resolveEgrulFnsInput();
const summary = buildFetchSummary(input);

assert.equal(summary.source, 'egrul-fns');
assert.equal(summary.action, 'fetch');
assert.equal(summary.inputMode, 'file');
assert.equal(summary.inputFilePath, fixturePath);
assert.equal(summary.recordsReceived, 4);
assert.equal(summary.normalizedRecords, 2);
assert.equal(summary.skippedRecords, 2);
assert.equal(summary.duplicateRecords, 0);

const rec1 = input.normalizedRecords.find((record) => record.signalExternalId === 'egrul-smoke-1');
assert.ok(rec1, 'missing normalized record egrul-smoke-1');
assert.equal(rec1.inn, '7701234567');
assert.equal(rec1.ogrn, '1027700123456');
assert.equal(rec1.kpp, '770101001');
assert.equal(rec1.companyDomain, 'techfuture.example');
assert.equal(rec1.status, 'active');
assert.equal(rec1.okved, '62.01');
assert.equal(rec1.headName, undefined, 'EGRUL must not keep director/person names');
assert.equal(rec1.primarySourceKey, 'inn:7701234567');
assert.equal(rec1.sourceUrl, 'https://www.nalog.gov.ru/rn77/service/egrip2/');

const rec2 = input.normalizedRecords.find((record) => record.signalExternalId === 'egrul-smoke-2');
assert.ok(rec2, 'missing normalized record egrul-smoke-2');
assert.equal(rec2.inn, '7702345678');
assert.equal(rec2.primarySourceKey, 'inn:7702345678');
assert.equal(rec2.sourceUrl, 'https://www.nalog.gov.ru/rn77/service/egrip2/');

assert.equal(
  input.normalizedRecords.find((record) => record.inn === '770312345678'),
  undefined,
  '12-digit INN/IP records must be skipped',
);
assert.equal(
  input.normalizedRecords.find((record) => record.signalExternalId === 'unofficial-mirror-record'),
  undefined,
  'records without an official FNS source URL must be skipped',
);

for (const record of input.normalizedRecords) {
  assert.equal(record.orgSourceKeys.length > 0, true);
  assert.ok(record.primarySourceKey);
  assert.ok(record.innSourceKey || record.ogrnSourceKey || record.domainSourceKey);
  assert.ok(record.signalExternalId);
  assert.ok(record.orgName);
  assert.match(record.sourceUrl, /^https:\/\/(?:www\.)?nalog\.gov\.ru\//);
}

delete process.env.EGRUL_FNS_INPUT_FILE;
process.env.EGRUL_FNS_INNS = '7709000002';
process.env.EGRUL_FNS_PROVIDER_API_URL = 'https://provider.example/egrul';
process.env.EGRUL_FNS_PROVIDER_API_TOKEN = 'not-a-real-token';
assert.throws(() => resolveEgrulFnsInput(), /official FNS integration snapshot/i);

if (originalInputFile === undefined) delete process.env.EGRUL_FNS_INPUT_FILE;
else process.env.EGRUL_FNS_INPUT_FILE = originalInputFile;
delete process.env.EGRUL_FNS_INNS;
delete process.env.EGRUL_FNS_PROVIDER_API_URL;
delete process.env.EGRUL_FNS_PROVIDER_API_TOKEN;

console.log(JSON.stringify({
  ok: true,
  source: 'egrul-fns',
  mode: 'official-fns-snapshot-only',
  fixturePath,
  recordsReceived: summary.recordsReceived,
  normalizedRecords: summary.normalizedRecords,
  skippedRecords: summary.skippedRecords,
  evidenceBoundary: 'enrichment-only, never lead-originating',
  sideEffects: { databaseUrlUsed: false },
}, null, 2));
