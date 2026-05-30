import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SOURCE_ACTIONS } from './source-contract.mjs';
import { listSources } from './source-registry.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../../..');
const sourceScriptsDir = resolve(repoRoot, 'packages/db/scripts');
const expectedSources = [
  'hh',
  'career-pages',
  'linkedin-company-pages',
  'tech-job-boards',
  'egrul-fns',
  'company-site',
  'funding-business-signals',
];
const digestLeadSources = ['career-pages', 'hh'];
const providerTokenSources = [
  'linkedin-company-pages',
  'egrul-fns',
  'funding-business-signals',
];
const requireLiveConfig = process.argv.includes('--require-live-config')
  || process.env.SOURCE_READINESS_REQUIRE_LIVE_CONFIG === '1';
const liveConfigRules = {
  hh: [
    ['HH_USER_AGENT'],
  ],
  'career-pages': [
    ['CAREER_PAGES_INPUT_FILE'],
    ['CAREER_PAGES_TARGETS_FILE'],
    ['DATABASE_URL'],
  ],
  'linkedin-company-pages': [
    ['LINKEDIN_PROVIDER_API_URL', 'LINKEDIN_PROVIDER_API_TOKEN'],
  ],
  'tech-job-boards': [
    ['TECH_JOB_BOARDS_GREENHOUSE_TOKENS'],
    ['TECH_JOB_BOARDS_LEVER_SLUGS'],
  ],
  'egrul-fns': [
    ['EGRUL_FNS_PROVIDER_API_URL', 'EGRUL_FNS_PROVIDER_API_TOKEN'],
  ],
  'company-site': [
    ['COMPANY_SITE_TARGETS_FILE'],
  ],
  'funding-business-signals': [
    ['FUNDING_SIGNALS_PROVIDER_API_URL', 'FUNDING_SIGNALS_PROVIDER_API_TOKEN'],
  ],
};

const sources = listSources();
const sourceIds = sources.map((source) => source.id).sort();

assert.deepEqual(sourceIds, [...expectedSources].sort(), 'source registry must contain exactly the supported source families');

for (const source of sources) {
  assert.equal(source.status, 'active', `${source.id} must be active`);
  assert.equal(source.runnable, true, `${source.id} must be runnable`);
  assert.equal(source.liveCapable, true, `${source.id} must expose a live-capable fetch mode`);
  assert.deepEqual(source.capabilities, SOURCE_ACTIONS, `${source.id} must support all source actions`);

  for (const action of SOURCE_ACTIONS) {
    const actionEntry = source.actionMap[action];
    assert.ok(actionEntry, `${source.id}.${action} must exist in actionMap`);
    assert.equal(actionEntry.supported, true, `${source.id}.${action} must be supported`);
    assert.equal(actionEntry.runnable, true, `${source.id}.${action} must be runnable`);
    assert.ok(actionEntry.script, `${source.id}.${action} must have a script`);

    if (!actionEntry.script.startsWith('internal:')) {
      assert.equal(
        existsSync(resolve(repoRoot, actionEntry.script)),
        true,
        `${source.id}.${action} script must exist: ${actionEntry.script}`,
      );
    }
  }
}

for (const sourceId of providerTokenSources) {
  const source = sources.find((entry) => entry.id === sourceId);
  assert.ok(source.fetchModes.includes('provider-token'), `${sourceId} must include provider-token fetch mode`);

  const scriptPath = resolve(repoRoot, source.actionMap.fetch.script);
  const scriptText = readFileSync(scriptPath, 'utf8');
  assert.match(
    scriptText,
    /provider-contract\.mjs/,
    `${sourceId} must use the shared provider contract parser`,
  );
}

const digestSql = readFileSync(resolve(sourceScriptsDir, 'source-digest-evidence.sql'), 'utf8');
const digestSourceMatch = digestSql.match(/signal\.source\s+IN\s*\(([^)]*)\)/i);
assert.ok(digestSourceMatch, 'source-digest-evidence.sql must have an explicit source allow-list');

const digestSources = [...digestSourceMatch[1].matchAll(/'([^']+)'/g)]
  .map((match) => match[1])
  .sort();
assert.deepEqual(
  digestSources,
  [...digestLeadSources].sort(),
  'digest lead selection must stay limited to lead-originating sources',
);

const directFetchCallers = findMjsFiles(sourceScriptsDir)
  .filter((filePath) => !filePath.endsWith(resolve(sourceScriptsDir, 'adapters/source-http.mjs')))
  .filter((filePath) => /\bfetch\s*\(/.test(readFileSync(filePath, 'utf8')))
  .map((filePath) => filePath.slice(repoRoot.length + 1).replaceAll('\\', '/'));

assert.deepEqual(
  directFetchCallers,
  [],
  'source HTTP calls must go through adapters/source-http.mjs',
);

const liveConfigSummary = expectedSources.map((sourceId) => {
  const rules = liveConfigRules[sourceId] ?? [];
  const configured = rules.some((rule) => rule.every((envName) => hasEnvValue(envName)));
  const acceptedEnvSets = rules.map((rule) => rule.join(' + '));

  return {
    sourceId,
    configured,
    acceptedEnvSets,
  };
});
const missingLiveConfig = liveConfigSummary.filter((item) => !item.configured);

if (requireLiveConfig && missingLiveConfig.length > 0) {
  const formatted = missingLiveConfig
    .map((item) => `${item.sourceId}: ${item.acceptedEnvSets.join(' OR ')}`)
    .join('; ');

  throw new Error(`Missing live source config: ${formatted}`);
}

console.log(JSON.stringify({
  ok: true,
  smoke: 'source-readiness',
  sources: expectedSources.length,
  liveCapableSources: sources.filter((source) => source.liveCapable).length,
  digestLeadSources,
  providerTokenSources,
  liveConfigRequired: requireLiveConfig,
  liveConfigConfigured: liveConfigSummary.filter((item) => item.configured).length,
  liveConfigMissing: missingLiveConfig
    .map((item) => ({
      sourceId: item.sourceId,
      acceptedEnvSets: item.acceptedEnvSets,
    })),
  directFetchCallers,
}, null, 2));

function findMjsFiles(dirPath) {
  const results = [];

  for (const entry of readdirSync(dirPath)) {
    const entryPath = resolve(dirPath, entry);
    const stats = statSync(entryPath);

    if (stats.isDirectory()) {
      results.push(...findMjsFiles(entryPath));
      continue;
    }

    if (stats.isFile() && extname(entryPath) === '.mjs') {
      results.push(entryPath);
    }
  }

  return results;
}

function hasEnvValue(envName) {
  return typeof process.env[envName] === 'string' && process.env[envName].trim() !== '';
}
