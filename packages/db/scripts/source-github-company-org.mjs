import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { fetchGitHubCompanyOrganizations } from './adapters/github-company-org.mjs';
import { loadCompanyOwnedSourceTargetsFromDatabase } from './adapters/company-owned-source-targets.mjs';
import { normalizeContextEventRecord } from './adapters/rf-source-normalizers.mjs';
import { createStandardSourceRuntime, loadEnvFile, parseJson } from './adapters/rf-source-runtime.mjs';
import { stripBom } from './adapters/source-records.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const SOURCE_ID = 'github-company-org';
const DEFAULT_CACHE_PATH = resolve(scriptDir, './.cache/github-company-org-state.json');

loadEnvFile(resolve(scriptDir, '../../../.env'));

const runtime = createStandardSourceRuntime({
  sourceId: SOURCE_ID,
  signalType: 'other',
  evidenceRole: 'context',
  sourceRecordType: 'github_company_repository',
  inputFileEnvName: 'GITHUB_COMPANY_ORG_INPUT_FILE',
  usageText: 'Default: DB-enrolled company-owned organization refs. GITHUB_COMPANY_ORG_TARGETS_JSON/FILE is an override; GITHUB_TOKEN is optional rate-limit capacity only.',
  normalizeRecord: (record, context) => normalizeContextEventRecord(record, context, {
    sourceRecordType: 'github_company_repository',
    defaultEventType: 'technology_activity',
    contextOnly: true,
  }),
  buildSummaryExtras: (input) => input.inputMode === 'live-public' || input.inputMode === 'expected-zero'
    ? {
      liveProvider: 'github-rest-public-organizations',
      targetsProcessed: input.targetsProcessed,
      ownershipVerified: input.ownershipVerified,
      targetsFailed: input.targetsFailed,
      notModified: input.notModified,
      enrollmentSource: input.enrollmentSource,
      zeroReason: input.zeroReason ?? undefined,
    }
    : {},
});

export function resolveGitHubCompanyOrgInput() {
  const inputFile = process.env.GITHUB_COMPANY_ORG_INPUT_FILE?.trim();
  if (inputFile) return runtime.resolveFileInput(inputFile);
  const targetsFile = process.env.GITHUB_COMPANY_ORG_TARGETS_FILE?.trim();
  const targetsJson = process.env.GITHUB_COMPANY_ORG_TARGETS_JSON?.trim();
  if (!targetsFile && !targetsJson) {
    return { inputMode: 'database-pending' };
  }
  const targets = targetsFile
    ? parseJson(stripBom(readFileSync(resolve(process.cwd(), targetsFile), 'utf8')), targetsFile)
    : parseJson(targetsJson, 'GITHUB_COMPANY_ORG_TARGETS_JSON');
  return { inputMode: 'live-pending', targets, enrollmentSource: 'manual-override' };
}

export async function resolveGitHubCompanyOrgLiveInput({ targets, enrollmentSource }, options = {}) {
  if (!Array.isArray(targets)) throw new Error('GitHub company organization targets must be a JSON array.');
  const cachePath = resolve(process.cwd(), process.env.GITHUB_COMPANY_ORG_CACHE_FILE?.trim() || DEFAULT_CACHE_PATH);
  const state = readCache(cachePath);
  const fetched = await fetchGitHubCompanyOrganizations(targets, {
    fetchImpl: options.fetchImpl,
    now: options.now,
    lookbackDays: process.env.GITHUB_COMPANY_ORG_LOOKBACK_DAYS,
    token: process.env.GITHUB_TOKEN,
    cache: state.organizations,
  });
  if (fetched.cacheUpdates.length > 0) writeCache(cachePath, state, fetched.cacheUpdates);
  const ownershipVerified = fetched.diagnostics.filter((item) => item.ownershipVerified).length;
  const targetsFailed = fetched.diagnostics.filter((item) => item.error).length;
  if (targets.length > 0 && ownershipVerified === 0 && targetsFailed === targets.length) {
    throw new Error('github-company-org could not prove ownership for any configured organization.');
  }
  return runtime.buildInputFromRecords({
    inputMode: 'live-public', inputFilePath: null, records: fetched.records, rejectAllSkipped: true,
    extra: {
      targetsProcessed: targets.length,
      ownershipVerified,
      targetsFailed,
      notModified: fetched.diagnostics.filter((item) => item.notModified).length,
      enrollmentSource,
      zeroReason: fetched.records.length === 0 ? 'no-recent-company-repository-events' : null,
    },
  });
}

export async function resolveGitHubCompanyOrgConfiguredInput(options = {}) {
  let input = resolveGitHubCompanyOrgInput();
  if (input.inputMode === 'database-pending') {
    const targets = options.loadTargets
      ? await options.loadTargets(SOURCE_ID)
      : await loadCompanyOwnedSourceTargetsFromDatabase(process.env.DATABASE_URL, SOURCE_ID);
    if (targets.length === 0) {
      return runtime.buildInputFromRecords({
        inputMode: 'expected-zero', inputFilePath: null, records: [],
        extra: { targetsProcessed: 0, ownershipVerified: 0, targetsFailed: 0, notModified: 0, enrollmentSource: 'database', zeroReason: 'no-eligible-company-targets' },
      });
    }
    input = { inputMode: 'live-pending', targets, enrollmentSource: 'database' };
  }
  return input.inputMode === 'live-pending' ? resolveGitHubCompanyOrgLiveInput(input, options) : input;
}

export const buildFetchSummary = runtime.buildFetchSummary;
export async function runGitHubCompanyOrgCli(argv = process.argv.slice(2)) {
  await runtime.runCli(argv, resolveGitHubCompanyOrgConfiguredInput);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runGitHubCompanyOrgCli();
}

function readCache(cachePath) {
  if (!existsSync(cachePath)) return { version: 1, organizations: {} };
  try {
    const parsed = JSON.parse(stripBom(readFileSync(cachePath, 'utf8')));
    return parsed?.version === 1 && parsed.organizations && typeof parsed.organizations === 'object'
      ? parsed : { version: 1, organizations: {} };
  } catch { return { version: 1, organizations: {} }; }
}

function writeCache(cachePath, state, updates) {
  const next = { version: 1, organizations: { ...state.organizations } };
  for (const update of updates) next.organizations[update.organizationLogin] = { etag: update.etag, updatedAt: new Date().toISOString() };
  mkdirSync(dirname(cachePath), { recursive: true });
  const temporaryPath = `${cachePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, cachePath);
}
