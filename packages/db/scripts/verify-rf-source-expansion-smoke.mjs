import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildFetchSummary as buildTransparentSummary, resolveTransparentBusinessFnsConfiguredInput } from './source-transparent-business-fns.mjs';
import { buildFetchSummary as buildFedresursSummary, resolveFedresursConfiguredInput } from './source-fedresurs.mjs';
import { buildFetchSummary as buildSuperjobSummary, resolveSuperjobConfiguredInput } from './source-superjob.mjs';
import { buildFetchSummary as buildHabrSummary, resolveHabrCareerConfiguredInput } from './source-habr-career.mjs';
import { buildFetchSummary as buildNewsroomsSummary, resolveCompanyNewsroomsConfiguredInput } from './source-company-newsrooms.mjs';
import { buildFetchSummary as buildMediaSummary, resolveIndustryMediaConfiguredInput } from './source-industry-media.mjs';
import { buildFetchSummary as buildRegionalSummary, resolveRegionalJobBoardsConfiguredInput } from './source-regional-job-boards.mjs';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const jobFixturePath = resolve(scriptDir, './rf-job-sources-smoke-fixture.json');
const registryFixturePath = resolve(scriptDir, './rf-registry-sources-smoke-fixture.json');
const contextFixturePath = resolve(scriptDir, './rf-context-sources-smoke-fixture.json');
const newsroomsTargetsPath = resolve(scriptDir, './company-newsrooms-smoke-targets.json');

delete process.env.DATABASE_URL;

const fileModeResults = [];
fileModeResults.push(await verifyFileMode({
  source: 'transparent-business-fns',
  env: 'TRANSPARENT_BUSINESS_FNS_INPUT_FILE',
  fixturePath: registryFixturePath,
  resolveInput: resolveTransparentBusinessFnsConfiguredInput,
  buildSummary: buildTransparentSummary,
  expectedPrimaryKey: 'inn:7712345678',
  expectedOrgExternalId: '7712345678',
  expectedSignalType: 'other',
  expectedRecordsReceived: 4,
  expectedSkippedRecords: 2,
}));
fileModeResults.push(await verifyFileMode({
  source: 'fedresurs',
  env: 'FEDRESURS_INPUT_FILE',
  fixturePath: contextFixturePath,
  resolveInput: resolveFedresursConfiguredInput,
  buildSummary: buildFedresursSummary,
  expectedPrimaryKey: 'domain:context-rf-smoke.example',
  expectedOrgExternalId: null,
  expectedSignalType: 'other',
  expectedRecordsReceived: 4,
  expectedSkippedRecords: 2,
}));
fileModeResults.push(await verifyFileMode({
  source: 'superjob',
  env: 'SUPERJOB_INPUT_FILE',
  fixturePath: jobFixturePath,
  resolveInput: resolveSuperjobConfiguredInput,
  buildSummary: buildSuperjobSummary,
  expectedPrimaryKey: 'domain:tech-rf-smoke.example',
  expectedOrgExternalId: null,
  expectedSignalType: 'job_posting',
  expectedRecordsReceived: 4,
  expectedSkippedRecords: 2,
}));
fileModeResults.push(await verifyFileMode({
  source: 'habr-career',
  env: 'HABR_CAREER_INPUT_FILE',
  fixturePath: jobFixturePath,
  resolveInput: resolveHabrCareerConfiguredInput,
  buildSummary: buildHabrSummary,
  expectedPrimaryKey: 'domain:tech-rf-smoke.example',
  expectedOrgExternalId: null,
  expectedSignalType: 'job_posting',
  expectedRecordsReceived: 4,
  expectedSkippedRecords: 2,
}));
fileModeResults.push(await verifyFileMode({
  source: 'company-newsrooms',
  env: 'COMPANY_NEWSROOMS_INPUT_FILE',
  fixturePath: contextFixturePath,
  resolveInput: resolveCompanyNewsroomsConfiguredInput,
  buildSummary: buildNewsroomsSummary,
  expectedPrimaryKey: 'domain:context-rf-smoke.example',
  expectedOrgExternalId: null,
  expectedSignalType: 'other',
  expectedRecordsReceived: 4,
  expectedSkippedRecords: 2,
}));
fileModeResults.push(await verifyFileMode({
  source: 'industry-media',
  env: 'INDUSTRY_MEDIA_INPUT_FILE',
  fixturePath: contextFixturePath,
  resolveInput: resolveIndustryMediaConfiguredInput,
  buildSummary: buildMediaSummary,
  expectedPrimaryKey: 'domain:context-rf-smoke.example',
  expectedOrgExternalId: null,
  expectedSignalType: 'other',
  expectedRecordsReceived: 4,
  expectedSkippedRecords: 2,
}));
fileModeResults.push(await verifyFileMode({
  source: 'regional-job-boards',
  env: 'REGIONAL_JOB_BOARDS_INPUT_FILE',
  fixturePath: jobFixturePath,
  resolveInput: resolveRegionalJobBoardsConfiguredInput,
  buildSummary: buildRegionalSummary,
  expectedPrimaryKey: 'domain:tech-rf-smoke.example',
  expectedOrgExternalId: null,
  expectedSignalType: 'job_posting',
  expectedRecordsReceived: 4,
  expectedSkippedRecords: 2,
}));

const providerMode = await verifyProviderMode();
const newsroomsLiveMode = await verifyNewsroomsLiveMode();

console.log(JSON.stringify({
  ok: true,
  smoke: 'rf-source-expansion',
  fileModeResults,
  providerMode,
  newsroomsLiveMode,
  evidenceBoundary: 'new RF sources are runnable but not promoted to digest selection',
  sideEffects: { databaseUrlUsed: false },
}, null, 2));

async function verifyFileMode({
  source,
  env,
  fixturePath,
  resolveInput,
  buildSummary,
  expectedPrimaryKey,
  expectedOrgExternalId,
  expectedSignalType,
  expectedRecordsReceived = 3,
  expectedDuplicateRecords = 1,
  expectedNormalizedRecords = 1,
  expectedSkippedRecords = 1,
}) {
  clearInputEnv();
  process.env[env] = fixturePath;
  const input = await resolveInput();
  const summary = buildSummary(input);
  assert.equal(summary.source, source);
  assert.equal(summary.inputMode, 'file');
  assert.equal(summary.recordsReceived, expectedRecordsReceived);
  assert.equal(summary.duplicateRecords, expectedDuplicateRecords);
  assert.equal(summary.normalizedRecords, expectedNormalizedRecords);
  assert.equal(summary.skippedRecords, expectedSkippedRecords);

  const record = input.normalizedRecords[0];
  assert.equal(record.primarySourceKey, expectedPrimaryKey);
  assert.equal(record.orgExternalId, expectedOrgExternalId);
  assert.equal(record.signalType, expectedSignalType);
  assert.ok(record.signalExternalId.startsWith(`${source}:`));

  if (expectedSignalType === 'job_posting') {
    assert.equal(record.payload.job_title, 'Backend Developer');
    assert.equal(record.payload.email, undefined);
    assert.equal(
      input.normalizedRecords.some((item) => item.primarySourceKey === 'domain:jobs.example'),
      false,
      `${source} must not use the job-board URL domain as company identity`,
    );
  }

  if (source === 'fedresurs' || source === 'company-newsrooms' || source === 'industry-media') {
    assert.equal(
      input.normalizedRecords.some((item) => item.primarySourceKey === 'domain:media.example'),
      false,
      `${source} must not use publisher/article URL domains as company identity`,
    );
  }

  if (source !== 'transparent-business-fns') {
    assert.notEqual(record.evidenceRole, 'lead', `${source} must not bypass evidence boundaries`);
  }

  return {
    source,
    inputMode: summary.inputMode,
    normalizedRecords: summary.normalizedRecords,
    duplicateRecords: summary.duplicateRecords,
    skippedRecords: summary.skippedRecords,
  };
}

async function verifyProviderMode() {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url, options = {}) => {
    requested.push({ url: String(url), headers: options.headers ?? {} });
    if (String(url).includes('superjob')) {
      assert.equal(options.headers?.['X-Api-App-Id'], 'superjob-smoke-app');
      return jsonResponse({ objects: [jobProviderRecord()] });
    }
    return jsonResponse({ records: [registryProviderRecord()] });
  };

  try {
    clearInputEnv();
    process.env.SUPERJOB_PROVIDER_API_URL = 'https://provider.example/superjob';
    process.env.SUPERJOB_API_APP_ID = 'superjob-smoke-app';
    const superjobInput = await resolveSuperjobConfiguredInput();
    assert.equal(superjobInput.inputMode, 'provider-token');
    assert.equal(superjobInput.normalizedRecords.length, 1);

    clearInputEnv();
    process.env.TRANSPARENT_BUSINESS_FNS_PROVIDER_API_URL = 'https://provider.example/transparent';
    process.env.TRANSPARENT_BUSINESS_FNS_PROVIDER_API_TOKEN = 'transparent-smoke-token';
    const transparentInput = await resolveTransparentBusinessFnsConfiguredInput();
    assert.equal(transparentInput.inputMode, 'provider-token');
    assert.equal(transparentInput.normalizedRecords.length, 1);

    return { requestedUrls: requested.length, providerRecordsVerified: 2 };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function verifyNewsroomsLiveMode() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    url: 'https://newsroom-smoke.example/news/region-launch',
    headers: { get: () => 'text/html; charset=utf-8' },
    text: async () => '<!doctype html><html><head><title>Regional launch</title><meta name="description" content="Newsroom Smoke Co opens a regional operations hub"></head><body><main>Newsroom Smoke Co announces a regional launch and expansion.</main></body></html>',
  });

  try {
    clearInputEnv();
    process.env.COMPANY_NEWSROOMS_TARGETS_FILE = newsroomsTargetsPath;
    const input = await resolveCompanyNewsroomsConfiguredInput();
    const summary = buildNewsroomsSummary(input);
    assert.equal(summary.inputMode, 'live-public');
    assert.equal(summary.liveProvider, 'curated-company-newsrooms');
    assert.equal(summary.recordsReceived, 1);
    assert.equal(summary.normalizedRecords, 1);
    assert.equal(input.normalizedRecords[0].evidenceRole, 'context');
    return { inputMode: summary.inputMode, normalizedRecords: summary.normalizedRecords };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function clearInputEnv() {
  for (const key of Object.keys(process.env)) {
    if (key.endsWith('_INPUT_FILE') || key.endsWith('_TARGETS_FILE') || key.includes('_PROVIDER_API_') || key === 'SUPERJOB_API_APP_ID') {
      delete process.env[key];
    }
  }
}

function jobProviderRecord() {
  return {
    id: 'provider-job-1',
    job_title: 'Provider Developer',
    company_name: 'Provider Job Co',
    company_domain: 'provider-job.example',
    job_posting_url: 'https://provider-job.example/jobs/provider-job-1',
  };
}

function registryProviderRecord() {
  return {
    id: 'provider-registry-1',
    company_name: 'Provider Registry Co',
    inn: '7722334455',
    ogrn: '1027700132195',
  };
}

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'ERROR',
    url: 'https://provider.example/source',
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}
