import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getSource, listSources, validateSourceCoverageReport } from './source-registry.mjs';
import {
  PUBLIC_EXPANSION_SOURCE_IDS,
  createPublicExpansionSource,
  normalizeCbrFxSnapshotRecord,
  normalizeRorOrganizationRecord,
  normalizeTrudvsemDatasetRecord,
  parseCbrFxMirrorJson,
  parseCbrFxOfficialXml,
} from './adapters/public-source-expansion.mjs';
import sourcePolicy from '../source-policy.json' with { type: 'json' };
import readinessContract from '../source-readiness.json' with { type: 'json' };

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../../..');
const tsRegistryPath = resolve(repoRoot, 'apps/web/lib/sources/source-registry.ts');
const tsSchedulesPath = resolve(repoRoot, 'apps/web/lib/sources/source-schedules.ts');
const fixturePath = resolve(scriptDir, './public-source-expansion-smoke-fixture.json');

const JOB_BOARD_IDS = [
  'themuse',
  'landingjobs',
  'arbeitnow',
  'remoteok',
  'jobicy',
  'himalayas',
  'remotive',
  'weworkremotely',
  'hackernews-jobs',
];
const CONTEXT_IDS = ['hn-algolia', 'devto', 'gdelt-context', 'openalex', 'cbr-fx-daily', 'trudvsem-opendata-datasets'];

delete process.env.DATABASE_URL;

test('expansion registers exactly the 16 documented Class A sources', () => {
  assert.equal(PUBLIC_EXPANSION_SOURCE_IDS.length, 16);
  for (const id of [...JOB_BOARD_IDS, ...CONTEXT_IDS, 'ror']) {
    assert.ok(PUBLIC_EXPANSION_SOURCE_IDS.includes(id), `missing expansion id ${id}`);
  }
});

test('db registry reaches 43 sources with full action capabilities', () => {
  const sources = listSources();
  assert.equal(sources.length, 43);
  for (const id of PUBLIC_EXPANSION_SOURCE_IDS) {
    const source = getSource(id);
    assert.equal(source.status, 'active', `${id} must be active`);
    assert.deepEqual(source.capabilities, ['fetch', 'ingest', 'pipeline'], `${id} must expose fetch/ingest/pipeline`);
    assert.equal(source.scripts.fetch, `packages/db/scripts/source-${id}.mjs`);
    assert.ok(source.fetchModes.includes('file') && source.fetchModes.includes('live-public'), `${id} must support file and live-public modes`);
  }
});

test('expansion sources keep gated promotion and eligibility contracts', () => {
  for (const id of JOB_BOARD_IDS) {
    const source = getSource(id);
    assert.equal(source.kind, 'job-board');
    assert.equal(source.sourceClass, 'primary-platform');
    assert.equal(source.evidenceTier, 'medium-signal');
    assert.equal(source.leadEligibility, 'confidence-gated-evidence', `${id} must stay confidence-gated`);
    assert.equal(source.promotionStatus, 'blocked-from-digest-pending-confidence-tests', `${id} must stay blocked from digest`);
    assert.equal(source.readiness.pipelineProfile, 'hiring-gated-standard');
    assert.equal(source.readiness.confidence, 'pending');
  }
  for (const id of CONTEXT_IDS) {
    const source = getSource(id);
    assert.equal(source.leadEligibility, 'context-only');
    assert.equal(source.promotionStatus, 'never-lead-originating');
    assert.equal(source.readiness.eligibility, 'context-only');
  }
  const ror = getSource('ror');
  assert.equal(ror.kind, 'company-registry');
  assert.equal(ror.sourceClass, 'registry-reference');
  assert.equal(ror.evidenceTier, 'high-signal');
  assert.equal(ror.leadEligibility, 'enrichment-only');
  assert.equal(ror.promotionStatus, 'never-lead-originating');
});

test('policy and readiness metadata exist for every expansion source', () => {
  for (const id of PUBLIC_EXPANSION_SOURCE_IDS) {
    assert.ok(sourcePolicy[id], `${id} missing canonical policy`);
    const readiness = readinessContract.sources[id];
    assert.ok(readiness, `${id} missing readiness contract`);
    assert.equal(readiness.implementation, 'implemented');
    assert.equal(readiness.fixture, 'tested');
    assert.equal(readiness.contract, 'tested');
    assert.equal(readiness.requiresLiveVerification, true);
    assert.equal(readiness.legalReview, 'approved');
    assert.ok(readiness.verification.fixture.includes('npm run verify:public-source-expansion:smoke'));
    assert.ok(readiness.verification.live.includes('npm run verify:public-source-expansion:live'));
  }
  // 14 sources carry a recorded successful live-public verification.
  for (const id of PUBLIC_EXPANSION_SOURCE_IDS) {
    if (id === 'gdelt-context' || id === 'cbr-fx-daily') continue;
    const readiness = readinessContract.sources[id];
    assert.equal(readiness.live.state, 'verified', `${id} must be live-verified`);
    assert.match(readiness.live.verifiedAt, /^2026-10-01T\d{2}:\d{2}:\d{2}Z$/);
    assert.ok(readiness.live.evidence.length >= 1);
    assert.deepEqual(readiness.blockers, []);
  }
  // GDELT free tier was rate-limited and the official CBR endpoint was
  // TLS-blocked from the verification network on 2026-10-01: both stay
  // 'reachable' with explicit blockers until production verification.
  for (const id of ['gdelt-context', 'cbr-fx-daily']) {
    const readiness = readinessContract.sources[id];
    assert.equal(readiness.live.state, 'reachable');
    assert.ok(readiness.blockers.length >= 1, `${id} must document its blocker`);
    assert.ok(readiness.live.evidence.length >= 1);
  }
});

test('TS registry and schedules cover every expansion source', () => {
  const tsRegistry = readFileSync(tsRegistryPath, 'utf8');
  const tsSchedules = readFileSync(tsSchedulesPath, 'utf8');
  for (const id of PUBLIC_EXPANSION_SOURCE_IDS) {
    assert.ok(tsRegistry.includes(`  | '${id}'`), `${id} missing from SourceId union`);
    assert.ok(tsRegistry.includes(`id: '${id}',`), `${id} missing from SOURCE_REGISTRY`);
    assert.ok(tsRegistry.includes(`script: 'source-${id}.mjs'`), `${id} missing script wiring`);
    const scheduleKey = /^[a-z0-9]+$/.test(id) ? `${id}:` : `'${id}':`;
    assert.ok(tsSchedules.includes(scheduleKey), `${id} missing from SOURCE_SCHEDULES`);
  }
  // Job boards stay out of the daily pipeline; context sources are opt-in.
  assert.doesNotMatch(tsRegistry, /id: 'themuse',[\s\S]{0,400}isPrimary: true/);
  const entryCount = (tsRegistry.match(/\n    id: '/g) ?? []).length;
  assert.equal(entryCount, 43, 'TS SOURCE_REGISTRY must list 43 sources');
});

test('coverage validation stays error-free at 43 sources', () => {
  const report = validateSourceCoverageReport();
  assert.equal(report.allSources.length, 43);
  assert.deepEqual(report.coverageReport.errors, []);
  assert.equal(report.passed, true);
});

test('CBR FX parsers handle mirror JSON and official XML payloads', () => {
  const mirror = parseCbrFxMirrorJson({
    Date: '2026-10-02T11:30:00+03:00',
    Valute: {
      R01235: { ID: 'R01235', NumCode: '840', CharCode: 'USD', Nominal: 1, Name: 'US Dollar', Value: 83.2454, Previous: 83.5588 },
      R01239: { ID: 'R01239', NumCode: '978', CharCode: 'EUR', Nominal: 1, Name: 'Euro', Value: 91.1234, Previous: 91.5 },
    },
  }, 'https://www.cbr-xml-daily.ru/daily_json.js');
  assert.equal(mirror.snapshot_date, '2026-10-02');
  assert.equal(mirror.mirror, true);
  assert.equal(mirror.rates.USD.value, 83.2454);

  const official = parseCbrFxOfficialXml(
    '<ValCurs Date="02.10.2026" name="Daily"><Valute Id="R01235"><NumCode>840</NumCode><CharCode>USD</CharCode><Nominal>1</Nominal><Name>US Dollar</Name><Value>83,2454</Value><Previous>83,5588</Previous></Valute></ValCurs>',
    'https://www.cbr.ru/scripts/XML_daily.asp',
  );
  assert.equal(official.mirror, false);
  assert.equal(official.rates.USD.value, 83.2454);
  assert.equal(parseCbrFxOfficialXml('<ValCurs></ValCurs>', 'x'), null);
});

test('custom normalizers enforce identity contracts', () => {
  const meta = { fetchedAt: '2026-10-01T12:00:00.000Z', lineNumber: 1, sourceId: 'expansion-test' };
  const rorRecord = normalizeRorOrganizationRecord({
    company_name: 'Fixture Research Org',
    company_website_url: 'https://fixture-research.invalid',
    ror_id: 'https://ror.org/fixture0001',
    country_code: 'US',
    status: 'active',
    aliases: ['FRO'],
    source_url: 'https://ror.org/fixture0001',
  }, meta);
  assert.equal(rorRecord.primarySourceKey, 'domain:fixture-research.invalid');
  assert.equal(rorRecord.signalExternalId, 'expansion-test:https://ror.org/fixture0001');
  assert.equal(rorRecord.evidenceRole, 'enrichment');
  assert.equal(normalizeRorOrganizationRecord({ company_name: 'No ROR ID' }, meta), null);

  const fxRecord = normalizeCbrFxSnapshotRecord({
    snapshot_date: '2026-10-02',
    base_currency: 'RUB',
    rates: { USD: { nominal: 1, value: 83.2454 } },
    endpoint: 'https://www.cbr-xml-daily.ru/daily_json.js',
    mirror: true,
  }, { ...meta, sourceId: 'cbr-fx-daily' });
  assert.equal(fxRecord.primarySourceKey, 'domain:cbr.ru');
  assert.equal(fxRecord.signalExternalId, 'cbr-fx-daily:2026-10-02');
  assert.equal(fxRecord.signalType, 'other');
  assert.equal(normalizeCbrFxSnapshotRecord({ snapshot_date: '2026-10-02', rates: {} }, meta), null);

  const datasetRecord = normalizeTrudvsemDatasetRecord({
    identifier: '7710538364-vacancy',
    title: 'Fixture dataset',
    link: 'https://opendata.trudvsem.ru/7710538364-vacancy',
    format: 'xml',
    publisher_inn: '7710538364',
  }, { ...meta, sourceId: 'trudvsem-opendata-datasets' });
  assert.equal(datasetRecord.primarySourceKey, 'inn:7710538364');
  assert.equal(datasetRecord.orgExternalId, '7710538364');
  assert.equal(normalizeTrudvsemDatasetRecord({ identifier: '7710538364-x' }, meta), null);
});

test('file mode normalizes fixture sections through the production path', async () => {
  for (const id of ['themuse', 'hn-algolia', 'ror', 'cbr-fx-daily', 'trudvsem-opendata-datasets']) {
    const source = createPublicExpansionSource(id);
    process.env[source.spec.inputFileEnvName] = fixturePath;
    try {
      const input = await source.resolveInput();
      const summary = source.buildFetchSummary(input);
      assert.equal(summary.inputMode, 'file', id);
      assert.equal(summary.recordsReceived, 6, id);
      assert.equal(summary.normalizedRecords, 4, id);
      assert.equal(summary.skippedRecords, 2, id);
      assert.equal(summary.sensitiveFieldsDropped, 0, id);
    } finally {
      delete process.env[source.spec.inputFileEnvName];
    }
  }
});
