import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { SOURCE_ACTIONS } from './source-contract.mjs';
import { listPrimaryIngestionSourceIds, listSources } from './source-registry.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../../..');
const sourceScriptsDir = resolve(repoRoot, 'packages/db/scripts');
const webSourceRegistryPath = resolve(repoRoot, 'apps/web/lib/sources/source-registry.ts');
const expectedSources = [
  'hh',
  'rabota-rossii',
  'career-pages',
  'linkedin-company-pages',
  'tech-job-boards',
  'egrul-fns',
  'company-site',
  'funding-business-signals',
  'transparent-business-fns',
  'fedresurs',
  'superjob',
  'habr-career',
  'company-newsrooms',
  'industry-media',
  'regional-job-boards',
];
// Sources whose signals are eligible to ORIGINATE a digest lead. The digest SQL
// (source-digest-evidence.sql) admits only signal_type = 'job_posting', so this set
// is exactly the sources whose adapters emit job_posting signals. Final lead status
// is still gated downstream by evidence_quality + the A/B/C/D confidence gates.
// News sources (company-newsrooms, industry-media) emit signalType 'other' and are
// enrichment-context only — they are intentionally NOT lead-originating.
const digestLeadSources = [
  'hh',
  'career-pages',
  'rabota-rossii',
  'superjob',
  'habr-career',
  'tech-job-boards',
  'linkedin-company-pages',
  'regional-job-boards',
];
const digestContextSources = [
  'funding-business-signals',
  'fedresurs',
  'transparent-business-fns',
  'egrul-fns',
  'company-site',
  'company-newsrooms',
  'industry-media',
];
const providerTokenSources = [
  'linkedin-company-pages',
  'tech-job-boards',
  'egrul-fns',
  'funding-business-signals',
  'transparent-business-fns',
  'fedresurs',
  'superjob',
  'habr-career',
  'company-newsrooms',
  'industry-media',
  'regional-job-boards',
];
const requireLiveConfig = process.argv.includes('--require-live-config')
  || process.env.SOURCE_READINESS_REQUIRE_LIVE_CONFIG === '1';
const includeProviderRequired = process.argv.includes('--include-provider-required')
  || process.env.SOURCE_READINESS_INCLUDE_PROVIDER_REQUIRED === '1';
const liveConfigRules = {
  hh: [
    liveRule(['HH_USER_AGENT']),
  ],
  'rabota-rossii': [
    liveRule(['RABOTA_ROSSII_SEARCH_TEXT']),
    liveRule(['RABOTA_ROSSII_INPUT_FILE']),
  ],
  'career-pages': [
    liveRule(['CAREER_PAGES_INPUT_FILE']),
    liveRule(['CAREER_PAGES_TARGETS_FILE']),
    liveRule(['DATABASE_URL']),
  ],
  'linkedin-company-pages': [
    providerRule(['LINKEDIN_PROVIDER_API_URL', 'LINKEDIN_PROVIDER_API_TOKEN']),
  ],
  'tech-job-boards': [
    liveRule(['TECH_JOB_BOARDS_GREENHOUSE_TOKENS']),
    liveRule(['TECH_JOB_BOARDS_LEVER_SLUGS']),
    providerRule(['TECH_JOB_BOARDS_PROVIDER_API_URL', 'TECH_JOB_BOARDS_PROVIDER_API_TOKEN']),
  ],
  'egrul-fns': [
    liveRule(['EGRUL_FNS_INNS']),
    providerRule(['EGRUL_FNS_PROVIDER_API_URL', 'EGRUL_FNS_PROVIDER_API_TOKEN']),
  ],
  'company-site': [
    liveRule(['COMPANY_SITE_TARGETS_FILE']),
  ],
  'funding-business-signals': [
    liveRule(['FUNDING_SIGNALS_GDELT_QUERIES']),
    liveRule(['FUNDING_SIGNALS_GDELT_QUERIES_JSON']),
    providerRule(['FUNDING_SIGNALS_PROVIDER_API_URL', 'FUNDING_SIGNALS_PROVIDER_API_TOKEN']),
  ],
  'transparent-business-fns': [
    providerRule(['TRANSPARENT_BUSINESS_FNS_PROVIDER_API_URL', 'TRANSPARENT_BUSINESS_FNS_PROVIDER_API_TOKEN']),
    liveRule(['TRANSPARENT_BUSINESS_FNS_INPUT_FILE']),
  ],
  fedresurs: [
    providerRule(['FEDRESURS_PROVIDER_API_URL', 'FEDRESURS_PROVIDER_API_TOKEN']),
    liveRule(['FEDRESURS_INPUT_FILE']),
  ],
  superjob: [
    providerRule(['SUPERJOB_PROVIDER_API_URL', 'SUPERJOB_API_APP_ID']),
    liveRule(['SUPERJOB_INPUT_FILE']),
  ],
  'habr-career': [
    providerRule(['HABR_CAREER_PROVIDER_API_URL', 'HABR_CAREER_PROVIDER_API_TOKEN']),
    liveRule(['HABR_CAREER_INPUT_FILE']),
  ],
  'company-newsrooms': [
    providerRule(['COMPANY_NEWSROOMS_PROVIDER_API_URL', 'COMPANY_NEWSROOMS_PROVIDER_API_TOKEN']),
    liveRule(['COMPANY_NEWSROOMS_INPUT_FILE']),
    liveRule(['COMPANY_NEWSROOMS_TARGETS_FILE']),
  ],
  'industry-media': [
    providerRule(['INDUSTRY_MEDIA_PROVIDER_API_URL', 'INDUSTRY_MEDIA_PROVIDER_API_TOKEN']),
    liveRule(['INDUSTRY_MEDIA_INPUT_FILE']),
  ],
  'regional-job-boards': [
    providerRule(['REGIONAL_JOB_BOARDS_PROVIDER_API_URL', 'REGIONAL_JOB_BOARDS_PROVIDER_API_TOKEN']),
    liveRule(['REGIONAL_JOB_BOARDS_INPUT_FILE']),
  ],
};

const sources = listSources();
const sourceIds = sources.map((source) => source.id).sort();
const webSources = readWebSourceRegistry(webSourceRegistryPath);
const webSourceIds = webSources.map((source) => source.id).sort();

assert.deepEqual(sourceIds, [...expectedSources].sort(), 'source registry must contain exactly the supported source families');
assert.deepEqual(
  webSourceIds,
  sourceIds,
  'web and DB source registries must contain the same source families',
);
assert.deepEqual(
  webSources.filter((source) => source.isPrimary).map((source) => source.id).sort(),
  listPrimaryIngestionSourceIds().sort(),
  'web and DB source registries must select the same primary ingestion sources',
);

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
  const runtimeText = readFileSync(resolve(sourceScriptsDir, 'adapters/rf-source-runtime.mjs'), 'utf8');
  assert.equal(
    /provider-contract\.mjs/.test(scriptText)
      || (/rf-source-runtime\.mjs/.test(scriptText) && /provider-contract\.mjs/.test(runtimeText)),
    true,
    `${sourceId} must use the shared provider contract parser directly or through rf-source-runtime`,
  );
}

const digestSql = readFileSync(resolve(sourceScriptsDir, 'source-digest-evidence.sql'), 'utf8');
const digestSourceMatch = digestSql.match(
  /signal\.signal_type\s*=\s*'job_posting'[\s\S]{0,240}?signal\.source\s+IN\s*\(([^)]*)\)/i,
);
assert.ok(
  digestSourceMatch,
  'source-digest-evidence.sql must have an explicit job_posting source allow-list',
);

const digestSources = [...digestSourceMatch[1].matchAll(/'([^']+)'/g)]
  .map((match) => match[1])
  .sort();
assert.deepEqual(
  digestSources,
  [...digestLeadSources].sort(),
  'digest lead selection must stay limited to lead-originating sources',
);

const digestContextMatch = digestSql.match(
  /signal\.signal_type\s+IN\s*\(\s*'other'\s*,\s*'funding'\s*\)[\s\S]{0,240}?signal\.source\s+IN\s*\(([^)]*)\)/i,
);
assert.ok(
  digestContextMatch,
  'source-digest-evidence.sql must have an explicit context source allow-list',
);
const digestContextSourceIds = [...digestContextMatch[1].matchAll(/'([^']+)'/g)]
  .map((match) => match[1])
  .sort();
assert.deepEqual(
  digestContextSourceIds,
  [...digestContextSources].sort(),
  'digest context selection must contain every approved context-only source',
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
  const configured = rules.some((rule) => isRuleConfigured(rule));
  const launchRequired = rules.some((rule) => rule.kind === 'launch');
  const providerRequired = rules.some((rule) => rule.kind === 'provider');
  const providerConfigured = rules.some((rule) => rule.kind === 'provider' && isRuleConfigured(rule));
  const acceptedEnvSets = rules.map((rule) => formatRule(rule));
  const status = configured ? 'configured' : launchRequired ? 'missing' : 'provider-required';

  return {
    sourceId,
    status,
    configured,
    launchRequired,
    providerRequired,
    providerConfigured,
    acceptedEnvSets,
  };
});
const missingLiveConfig = liveConfigSummary.filter((item) => item.status === 'missing');
const providerRequiredLiveConfig = liveConfigSummary.filter((item) => item.status === 'provider-required');
const blockingLiveConfig = includeProviderRequired
  ? [...missingLiveConfig, ...providerRequiredLiveConfig]
  : missingLiveConfig;

if (requireLiveConfig && blockingLiveConfig.length > 0) {
  const formatted = blockingLiveConfig
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
  digestContextSources,
  providerTokenSources,
  liveConfigRequired: requireLiveConfig,
  providerConfigRequired: includeProviderRequired,
  liveConfigConfigured: liveConfigSummary.filter((item) => item.configured).length,
  liveConfigMissing: missingLiveConfig
    .map((item) => ({
      sourceId: item.sourceId,
      status: item.status,
      acceptedEnvSets: item.acceptedEnvSets,
    })),
  liveConfigProviderRequired: providerRequiredLiveConfig
    .map((item) => ({
      sourceId: item.sourceId,
      status: item.status,
      acceptedEnvSets: item.acceptedEnvSets,
    })),
  directFetchCallers,
}, null, 2));

function liveRule(envNames) {
  return { kind: 'launch', envNames };
}

function providerRule(envNames) {
  return { kind: 'provider', envNames };
}

function isRuleConfigured(rule) {
  return rule.envNames.every((envName) => hasEnvValue(envName));
}

function formatRule(rule) {
  return rule.envNames.join(' + ');
}

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

function readWebSourceRegistry(filePath) {
  const sourceFile = ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const registryDeclaration = sourceFile.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations)
    .find((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === 'SOURCE_REGISTRY');

  assert.ok(
    registryDeclaration?.initializer && ts.isArrayLiteralExpression(registryDeclaration.initializer),
    'web SOURCE_REGISTRY must be an array literal',
  );

  return registryDeclaration.initializer.elements.map((element) => {
    assert.ok(ts.isObjectLiteralExpression(element), 'web SOURCE_REGISTRY entries must be object literals');
    const idProperty = element.properties.find((property) => (
      ts.isPropertyAssignment(property)
      && ts.isIdentifier(property.name)
      && property.name.text === 'id'
    ));
    assert.ok(
      idProperty && ts.isPropertyAssignment(idProperty) && ts.isStringLiteral(idProperty.initializer),
      'every web SOURCE_REGISTRY entry must have a string id',
    );
    const primaryProperty = element.properties.find((property) => (
      ts.isPropertyAssignment(property)
      && ts.isIdentifier(property.name)
      && property.name.text === 'isPrimary'
    ));
    assert.ok(
      primaryProperty
        && ts.isPropertyAssignment(primaryProperty)
        && (primaryProperty.initializer.kind === ts.SyntaxKind.TrueKeyword
          || primaryProperty.initializer.kind === ts.SyntaxKind.FalseKeyword),
      `web SOURCE_REGISTRY entry ${idProperty.initializer.text} must have a boolean isPrimary`,
    );
    return {
      id: idProperty.initializer.text,
      isPrimary: primaryProperty.initializer.kind === ts.SyntaxKind.TrueKeyword,
    };
  });
}
