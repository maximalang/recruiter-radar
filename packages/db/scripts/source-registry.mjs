import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { isAbsolute, normalize, join, basename } from 'node:path';
import {
  SOURCE_ACTIONS,
  SOURCE_STATUS_SEMANTICS,
  createActionMap,
  defineSource,
} from './source-contract.mjs';
import {
  DIGEST_SOURCES,
  SOURCE_COVERAGE_TIERS,
  validateSourceCoverage,
} from './source-coverage-requirements.mjs';
import {
  evaluateSourceReadiness,
  getSourceReadinessContract,
} from './source-readiness.mjs';
import sourcePolicyContract from '../source-policy.json' with { type: 'json' };

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../../..');
const hhDigestScriptPath = './packages/db/scripts/report-hh-digest.mjs';
const hhFetchScriptPath = './packages/db/scripts/fetch-hh.mjs';
const hhIngestScriptPath = './packages/db/scripts/ingest-hh.mjs';
const hhDigestAbsoluteScriptPath = resolve(scriptDir, './report-hh-digest.mjs');
const hhFetchAbsoluteScriptPath = resolve(scriptDir, './fetch-hh.mjs');
const hhIngestAbsoluteScriptPath = resolve(scriptDir, './ingest-hh.mjs');
const careerPagesScriptPath = './packages/db/scripts/source-career-pages.mjs';
const careerPagesAbsoluteScriptPath = resolve(scriptDir, './source-career-pages.mjs');
const publicAtsSources = Object.freeze([
  ['greenhouse', './packages/db/scripts/source-greenhouse.mjs', './source-greenhouse.mjs', 'Greenhouse public job boards discovered from company career pages.'],
  ['lever', './packages/db/scripts/source-lever.mjs', './source-lever.mjs', 'Lever public postings discovered from company career pages.'],
  ['ashby', './packages/db/scripts/source-ashby.mjs', './source-ashby.mjs', 'Ashby public Job Posting API boards discovered from company career pages.'],
  ['recruitee', './packages/db/scripts/source-recruitee.mjs', './source-recruitee.mjs', 'Recruitee public Careers Site API boards discovered from company career pages.'],
  ['workable', './packages/db/scripts/source-workable.mjs', './source-workable.mjs', 'Workable public account jobs discovered from company career pages.'],
  ['smartrecruiters', './packages/db/scripts/source-smartrecruiters.mjs', './source-smartrecruiters.mjs', 'SmartRecruiters public Posting API boards discovered from company career pages.'],
]);
const companySiteScriptPath = './packages/db/scripts/source-company-site.mjs';
const companySiteAbsoluteScriptPath = resolve(scriptDir, './source-company-site.mjs');
const linkedinScriptPath = './packages/db/scripts/source-linkedin-company-pages.mjs';
const linkedinAbsoluteScriptPath = resolve(scriptDir, './source-linkedin-company-pages.mjs');
const techJobBoardsScriptPath = './packages/db/scripts/source-tech-job-boards.mjs';
const techJobBoardsAbsoluteScriptPath = resolve(scriptDir, './source-tech-job-boards.mjs');
const egrulFnsScriptPath = './packages/db/scripts/source-egrul-fns.mjs';
const egrulFnsAbsoluteScriptPath = resolve(scriptDir, './source-egrul-fns.mjs');
const fundingScriptPath = './packages/db/scripts/source-funding-business-signals.mjs';
const fundingAbsoluteScriptPath = resolve(scriptDir, './source-funding-business-signals.mjs');
const rabotaRossiiScriptPath = './packages/db/scripts/source-rabota-rossii.mjs';
const rabotaRossiiAbsoluteScriptPath = resolve(scriptDir, './source-rabota-rossii.mjs');
const transparentBusinessFnsScriptPath = './packages/db/scripts/source-transparent-business-fns.mjs';
const transparentBusinessFnsAbsoluteScriptPath = resolve(scriptDir, './source-transparent-business-fns.mjs');
const fedresursScriptPath = './packages/db/scripts/source-fedresurs.mjs';
const fedresursAbsoluteScriptPath = resolve(scriptDir, './source-fedresurs.mjs');
const superjobScriptPath = './packages/db/scripts/source-superjob.mjs';
const superjobAbsoluteScriptPath = resolve(scriptDir, './source-superjob.mjs');
const habrCareerScriptPath = './packages/db/scripts/source-habr-career.mjs';
const habrCareerAbsoluteScriptPath = resolve(scriptDir, './source-habr-career.mjs');
const companyNewsroomsScriptPath = './packages/db/scripts/source-company-newsrooms.mjs';
const companyNewsroomsAbsoluteScriptPath = resolve(scriptDir, './source-company-newsrooms.mjs');
const industryMediaScriptPath = './packages/db/scripts/source-industry-media.mjs';
const industryMediaAbsoluteScriptPath = resolve(scriptDir, './source-industry-media.mjs');
const regionalJobBoardsScriptPath = './packages/db/scripts/source-regional-job-boards.mjs';
const regionalJobBoardsAbsoluteScriptPath = resolve(scriptDir, './source-regional-job-boards.mjs');
const registry = new Map();
const sourceReadinessContract = getSourceReadinessContract();
// Mirrors the TS registry `isPrimary: true` set (apps/web/lib/sources/source-registry.ts):
// sources enrolled in the daily-radar ingestion pipeline. Kept in sync manually
// because the TS registry is not importable from this .mjs build context.
// Scheduling and digest eligibility are separate: hosted ATS aliases are
// ingested by the unified career-pages scheduler but persist under their real
// provider ids. `inDigest` therefore uses the canonical digest list + policy,
// not membership in this scheduler set.
const PRIMARY_INGESTION_SOURCES = Object.freeze(
  new Set(['hh', 'superjob', 'habr-career', 'rabota-rossii', 'career-pages'])
);
registerSource(
  defineSource({
    id: 'hh',
    kind: 'job-board',
    sourceClass: 'primary-platform',
    evidenceTier: 'medium-signal',
    defaultConfidence: 0.74,
    status: 'active',
    fetchModes: ['file', 'live-public'],
    description: 'Primary active platform source for hiring evidence via HeadHunter вакансии.',
    capabilities: SOURCE_ACTIONS,
    scripts: {
      fetch: hhFetchScriptPath,
      ingest: hhIngestScriptPath,
      pipeline: 'internal:hh-pipeline',
    },
    actionMap: createActionMap({
      status: 'active',
      capabilities: SOURCE_ACTIONS,
      scripts: {
        fetch: hhFetchScriptPath,
        ingest: hhIngestScriptPath,
        pipeline: 'internal:hh-pipeline',
      },
    }),
    runner: {
      fetch: () => runScript(hhFetchAbsoluteScriptPath),
      ingest: () => runScript(hhIngestAbsoluteScriptPath),
      pipeline: async () => {
        const ingestResult = await runScript(hhIngestAbsoluteScriptPath);
        const digestResult = await runScript(hhDigestAbsoluteScriptPath);

        return {
          ingestResult,
          digestResult,
          summary: {
            vacanciesIngested: parseVacanciesIngested(ingestResult.stdout),
            digestCompaniesCount: parseDigestCompaniesCount(digestResult.stdout),
          },
        };
      },
    },
  }),
);

registerRunnableScriptSource({
  id: 'rabota-rossii',
  kind: 'job-board',
  sourceClass: 'primary-platform',
  evidenceTier: 'medium-signal',
  defaultConfidence: 0.7,
  fetchModes: ['file', 'live-public'],
  description: 'Official Rabota Rossii open-data vacancies for regional and public-adjacent hiring coverage.',
  scriptPath: rabotaRossiiScriptPath,
  absoluteScriptPath: rabotaRossiiAbsoluteScriptPath,
});

registerSource(
  defineSource({
    id: 'career-pages',
    kind: 'career-page',
    sourceClass: 'company-surface',
    evidenceTier: 'high-signal',
    defaultConfidence: 0.92,
    status: 'active',
    fetchModes: ['file', 'live-public'],
    description: 'Direct company career pages and вакансии sections as high-quality primary evidence.',
    capabilities: SOURCE_ACTIONS,
    scripts: {
      fetch: careerPagesScriptPath,
      ingest: careerPagesScriptPath,
      pipeline: careerPagesScriptPath,
    },
    actionMap: createActionMap({
      status: 'active',
      capabilities: SOURCE_ACTIONS,
      scripts: {
        fetch: careerPagesScriptPath,
        ingest: careerPagesScriptPath,
        pipeline: careerPagesScriptPath,
      },
    }),
    runner: {
      fetch: () => runSourceScript(careerPagesAbsoluteScriptPath, 'fetch'),
      ingest: () => runSourceScript(careerPagesAbsoluteScriptPath, 'ingest'),
      pipeline: () => runSourceScript(careerPagesAbsoluteScriptPath, 'pipeline'),
    },
  }),
);

for (const [id, scriptPath, localScriptPath, description] of publicAtsSources) {
  registerRunnableScriptSource({
    id,
    kind: 'career-page',
    sourceClass: 'company-surface',
    evidenceTier: 'high-signal',
    defaultConfidence: 0.9,
    fetchModes: ['live-public'],
    description,
    scriptPath,
    absoluteScriptPath: resolve(scriptDir, localScriptPath),
  });
}

registerSource(
  defineSource({
    id: 'linkedin-company-pages',
    kind: 'professional-network',
    sourceClass: 'primary-platform',
    evidenceTier: 'medium-signal',
    defaultConfidence: 0.72,
    status: 'active',
    fetchModes: ['file', 'provider-token'],
    description: 'LinkedIn company pages and related employer surfaces as secondary platform evidence.',
    capabilities: SOURCE_ACTIONS,
    scripts: {
      fetch: linkedinScriptPath,
      ingest: linkedinScriptPath,
      pipeline: linkedinScriptPath,
    },
    actionMap: createActionMap({
      status: 'active',
      capabilities: SOURCE_ACTIONS,
      scripts: {
        fetch: linkedinScriptPath,
        ingest: linkedinScriptPath,
        pipeline: linkedinScriptPath,
      },
    }),
    runner: {
      fetch: () => runSourceScript(linkedinAbsoluteScriptPath, 'fetch'),
      ingest: () => runSourceScript(linkedinAbsoluteScriptPath, 'ingest'),
      pipeline: () => runSourceScript(linkedinAbsoluteScriptPath, 'pipeline'),
    },
  }),
);

registerSource(
  defineSource({
    id: 'tech-job-boards',
    kind: 'job-board',
    sourceClass: 'primary-platform',
    evidenceTier: 'medium-signal',
    defaultConfidence: 0.68,
    status: 'active',
    fetchModes: ['file', 'live-public', 'provider-token'],
    description: 'Specialized tech job boards and compliant job snapshot providers beyond HH for additional market coverage.',
    capabilities: SOURCE_ACTIONS,
    scripts: {
      fetch: techJobBoardsScriptPath,
      ingest: techJobBoardsScriptPath,
      pipeline: techJobBoardsScriptPath,
    },
    actionMap: createActionMap({
      status: 'active',
      capabilities: SOURCE_ACTIONS,
      scripts: {
        fetch: techJobBoardsScriptPath,
        ingest: techJobBoardsScriptPath,
        pipeline: techJobBoardsScriptPath,
      },
    }),
    runner: {
      fetch: () => runSourceScript(techJobBoardsAbsoluteScriptPath, 'fetch'),
      ingest: () => runSourceScript(techJobBoardsAbsoluteScriptPath, 'ingest'),
      pipeline: () => runSourceScript(techJobBoardsAbsoluteScriptPath, 'pipeline'),
    },
  }),
);

registerSource(
  defineSource({
    id: 'egrul-fns',
    kind: 'company-registry',
    sourceClass: 'registry-reference',
    evidenceTier: 'high-signal',
    defaultConfidence: 0.9,
    status: 'active',
    fetchModes: ['file', 'live-public', 'provider-token'],
    description: 'EGRUL/FNS company registry data for legal entity verification and enrichment.',
    capabilities: SOURCE_ACTIONS,
    scripts: {
      fetch: egrulFnsScriptPath,
      ingest: egrulFnsScriptPath,
      pipeline: egrulFnsScriptPath,
    },
    actionMap: createActionMap({
      status: 'active',
      capabilities: SOURCE_ACTIONS,
      scripts: {
        fetch: egrulFnsScriptPath,
        ingest: egrulFnsScriptPath,
        pipeline: egrulFnsScriptPath,
      },
    }),
    runner: {
      fetch: () => runSourceScript(egrulFnsAbsoluteScriptPath, 'fetch'),
      ingest: () => runSourceScript(egrulFnsAbsoluteScriptPath, 'ingest'),
      pipeline: () => runSourceScript(egrulFnsAbsoluteScriptPath, 'pipeline'),
    },
  }),
);

registerSource(
  defineSource({
    id: 'company-site',
    kind: 'company-site',
    sourceClass: 'company-surface',
    evidenceTier: 'medium-signal',
    defaultConfidence: 0.68,
    status: 'active',
    fetchModes: ['file', 'live-public'],
    description: 'Direct company websites outside dedicated careers sections for corroborating evidence.',
    capabilities: SOURCE_ACTIONS,
    scripts: {
      fetch: companySiteScriptPath,
      ingest: companySiteScriptPath,
      pipeline: companySiteScriptPath,
    },
    actionMap: createActionMap({
      status: 'active',
      capabilities: SOURCE_ACTIONS,
      scripts: {
        fetch: companySiteScriptPath,
        ingest: companySiteScriptPath,
        pipeline: companySiteScriptPath,
      },
    }),
    runner: {
      fetch: () => runSourceScript(companySiteAbsoluteScriptPath, 'fetch'),
      ingest: () => runSourceScript(companySiteAbsoluteScriptPath, 'ingest'),
      pipeline: () => runSourceScript(companySiteAbsoluteScriptPath, 'pipeline'),
    },
  }),
);

registerSource(
  defineSource({
    id: 'funding-business-signals',
    kind: 'business-signal',
    sourceClass: 'market-signal',
    evidenceTier: 'context-only',
    defaultConfidence: 0.58,
    status: 'active',
    fetchModes: ['file', 'live-public', 'provider-token'],
    description: 'Funding, hiring, growth, and other business signals for supporting context only.',
    capabilities: SOURCE_ACTIONS,
    scripts: {
      fetch: fundingScriptPath,
      ingest: fundingScriptPath,
      pipeline: fundingScriptPath,
    },
    actionMap: createActionMap({
      status: 'active',
      capabilities: SOURCE_ACTIONS,
      scripts: {
        fetch: fundingScriptPath,
        ingest: fundingScriptPath,
        pipeline: fundingScriptPath,
      },
    }),
    runner: {
      fetch: () => runSourceScript(fundingAbsoluteScriptPath, 'fetch'),
      ingest: () => runSourceScript(fundingAbsoluteScriptPath, 'ingest'),
      pipeline: () => runSourceScript(fundingAbsoluteScriptPath, 'pipeline'),
    },
  }),
);

registerRunnableScriptSource({
  id: 'transparent-business-fns',
  kind: 'company-registry',
  sourceClass: 'registry-reference',
  evidenceTier: 'high-signal',
  defaultConfidence: 0.86,
  fetchModes: ['file', 'provider-token'],
  description: 'Transparent Business/FNS company context for size, risk, registry and exclusion enrichment only.',
  scriptPath: transparentBusinessFnsScriptPath,
  absoluteScriptPath: transparentBusinessFnsAbsoluteScriptPath,
});

registerRunnableScriptSource({
  id: 'fedresurs',
  kind: 'business-signal',
  sourceClass: 'market-signal',
  evidenceTier: 'context-only',
  defaultConfidence: 0.62,
  fetchModes: ['file', 'provider-token'],
  description: 'Fedresurs corporate events, audit, license and asset context; never lead-originating.',
  scriptPath: fedresursScriptPath,
  absoluteScriptPath: fedresursAbsoluteScriptPath,
});

registerRunnableScriptSource({
  id: 'superjob',
  kind: 'job-board',
  sourceClass: 'primary-platform',
  evidenceTier: 'medium-signal',
  defaultConfidence: 0.66,
  fetchModes: ['file', 'provider-token'],
  description: 'SuperJob vacancy coverage through the official app-key API with explicit direct-employer eligibility.',
  scriptPath: superjobScriptPath,
  absoluteScriptPath: superjobAbsoluteScriptPath,
});

registerRunnableScriptSource({
  id: 'habr-career',
  kind: 'job-board',
  sourceClass: 'primary-platform',
  evidenceTier: 'medium-signal',
  defaultConfidence: 0.69,
  fetchModes: ['file', 'live-public', 'provider-token'],
  description: 'Habr Career IT vacancy coverage via snapshots/provider/live HTML; live-public pending robots/legal review and confidence gates before digest use.',
  scriptPath: habrCareerScriptPath,
  absoluteScriptPath: habrCareerAbsoluteScriptPath,
});

registerRunnableScriptSource({
  id: 'company-newsrooms',
  kind: 'company-site',
  sourceClass: 'company-surface',
  evidenceTier: 'context-only',
  defaultConfidence: 0.6,
  fetchModes: ['file', 'live-public', 'provider-token'],
  description: 'Company newsroom and press-center context from curated targets or provider snapshots; supporting evidence only.',
  scriptPath: companyNewsroomsScriptPath,
  absoluteScriptPath: companyNewsroomsAbsoluteScriptPath,
});

registerRunnableScriptSource({
  id: 'industry-media',
  kind: 'business-signal',
  sourceClass: 'market-signal',
  evidenceTier: 'context-only',
  defaultConfidence: 0.52,
  fetchModes: ['file', 'provider-token'],
  description: 'Curated industry media context after manual/legal source review; never lead-originating.',
  scriptPath: industryMediaScriptPath,
  absoluteScriptPath: industryMediaAbsoluteScriptPath,
});

registerRunnableScriptSource({
  id: 'regional-job-boards',
  kind: 'job-board',
  sourceClass: 'primary-platform',
  evidenceTier: 'medium-signal',
  defaultConfidence: 0.58,
  fetchModes: ['file', 'provider-token'],
  description: 'Regional job-board snapshots/provider feeds after legal and robots review; not in digest by default.',
  scriptPath: regionalJobBoardsScriptPath,
  absoluteScriptPath: regionalJobBoardsAbsoluteScriptPath,
});

export function listSources() {
  return [...registry.values()];
}

export function listPrimaryIngestionSourceIds() {
  return [...PRIMARY_INGESTION_SOURCES];
}

export function getSource(sourceId) {
  const source = registry.get(sourceId);

  if (!source) {
    throw new Error(`Unknown source: ${sourceId}`);
  }

  return source;
}

export function listSourceSummaries() {
  return listSources().map((source) => {
    const readiness = evaluateSourceReadiness(
      source.id,
      source.readiness,
      sourceReadinessContract.pipelineProfiles,
    );

    return {
      id: source.id,
      kind: source.kind,
      sourceClass: source.sourceClass,
      evidenceTier: source.evidenceTier,
      defaultConfidence: source.defaultConfidence,
      priority: source.priority,
      leadEligibility: source.leadEligibility,
      promotionStatus: source.promotionStatus,
      status: source.status,
      runnable: source.runnable,
      fetchModes: source.fetchModes,
      liveCapable: source.liveCapable,
      statusDescription: SOURCE_STATUS_SEMANTICS[source.status].description,
      description: source.description ?? null,
      capabilities: source.capabilities,
      actionMap: source.actionMap,
      readiness,
    };
  });
}

export async function executeSourceAction(sourceId, action) {
  const source = getSource(sourceId);

  if (!SOURCE_ACTIONS.includes(action)) {
    throw new Error(`Unknown source action: ${action}`);
  }

  if (!source.runnable) {
    throw new Error(`Source ${source.id} is metadata-only for now. Run source:list to inspect active sources and actions.`);
  }

  if (!source.capabilities.includes(action)) {
    throw new Error(`Source ${source.id} does not support action: ${action}`);
  }

  return {
    source,
    result: await source.runner[action](),
  };
}

function registerSource(source) {
  if (registry.has(source.id)) {
    throw new Error(`Duplicate source registration: ${source.id}`);
  }

  const readiness = sourceReadinessContract.sources[source.id];
  const canonicalPolicy = sourcePolicyContract[source.id];

  if (!readiness) {
    throw new Error(`Missing source readiness metadata: ${source.id}`);
  }

  if (!canonicalPolicy) {
    throw new Error(`Missing canonical source policy metadata: ${source.id}`);
  }

  registry.set(source.id, Object.freeze({
    ...source,
    ...canonicalPolicy,
    readiness,
  }));
}

function registerRunnableScriptSource({
  id,
  kind,
  sourceClass,
  evidenceTier,
  defaultConfidence,
  fetchModes,
  description,
  scriptPath,
  absoluteScriptPath,
}) {
  registerSource(
    defineSource({
      id,
      kind,
      sourceClass,
      evidenceTier,
      defaultConfidence,
      status: 'active',
      fetchModes,
      description,
      capabilities: SOURCE_ACTIONS,
      scripts: {
        fetch: scriptPath,
        ingest: scriptPath,
        pipeline: scriptPath,
      },
      actionMap: createActionMap({
        status: 'active',
        capabilities: SOURCE_ACTIONS,
        scripts: {
          fetch: scriptPath,
          ingest: scriptPath,
          pipeline: scriptPath,
        },
      }),
      runner: {
        fetch: () => runSourceScript(absoluteScriptPath, 'fetch'),
        ingest: () => runSourceScript(absoluteScriptPath, 'ingest'),
        pipeline: () => runSourceScript(absoluteScriptPath, 'pipeline'),
      },
    }),
  );
}

function registerPlannedSource({ id, kind, sourceClass, evidenceTier, defaultConfidence, description }) {
  registerSource(
    defineSource({
      id,
      kind,
      sourceClass,
      evidenceTier,
      defaultConfidence,
      status: 'planned',
      description,
      capabilities: [],
      actionMap: createActionMap({
        status: 'planned',
        capabilities: [],
      }),
    }),
  );
}

function runScript(scriptPath, args = []) {
  return new Promise((resolvePromise, rejectPromise) => {
    // Validate and sanitize script path
    if (!scriptPath || typeof scriptPath !== 'string') {
      rejectPromise(new Error('Invalid script path'));
      return;
    }

    // Resolve to absolute path and normalize to prevent traversal
    const resolvedPath = isAbsolute(scriptPath)
      ? normalize(scriptPath)
      : normalize(join(repoRoot, scriptPath));

    // Ensure path is within the repository
    if (!resolvedPath.startsWith(repoRoot)) {
      rejectPromise(new Error('Script path must be within the repository'));
      return;
    }

    // Validate script is a .mjs file
    if (!resolvedPath.endsWith('.mjs')) {
      rejectPromise(new Error('Only .mjs scripts are allowed'));
      return;
    }

    // Validate arguments
    const validArgs = args.filter(arg => {
      if (typeof arg !== 'string') return false;
      // Remove shell metacharacters that could lead to command injection
      const sanitized = arg.replace(/[;&|`$(){}[\]\\]/g, '');
      return sanitized !== '';
    });

    const stdoutChunks = [];
    const stderrChunks = [];
    const child = spawn(process.execPath, [resolvedPath, ...validArgs], {
      cwd: repoRoot,
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: false, // Disable shell to prevent additional injection risks
    });

    child.stdout.on('data', (chunk) => {
      stdoutChunks.push(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderrChunks.push(chunk);
    });

    child.on('error', (error) => {
      rejectPromise(error);
    });

    child.on('close', (code, signal) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');

      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }

      const details = signal
        ? `signal ${signal}`
        : `exit code ${code ?? 'unknown'}`;
      const stderrDetails = stderr.trim();
      const errorSuffix = stderrDetails ? `: ${stderrDetails}` : '';
      rejectPromise(new Error(`${resolvedPath} failed with ${details}${errorSuffix}`));
    });
  });
}

async function runSourceScript(scriptPath, action) {
  const result = await runScript(scriptPath, [action]);
  return {
    ...result,
    summary: parseJsonSummary(result.stdout, scriptPath, action),
  };
}

function parseJsonSummary(output, scriptPath, action) {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`Unable to parse ${action} JSON output from ${scriptPath}.`);
  }
}

function parseVacanciesIngested(output) {
  const match = output.match(/upserts completed:\s*(\d+)/i);

  if (!match) {
    throw new Error('Unable to parse vacancies ingested from hh:ingest output.');
  }

  return Number(match[1]);
}

function parseDigestCompaniesCount(output) {
  let parsed;

  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error('Unable to parse hh:digest JSON output.');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('hh:digest output is not a JSON array.');
  }

  return parsed.length;
}

export function validateSourceCoverageReport() {
  const allSources = listSources();
  const coverageReport = validateSourceCoverage(allSources);

  return {
    allSources,
    coverageReport,
    requiredTiers: SOURCE_COVERAGE_TIERS,
    timestamp: new Date().toISOString(),
    passed: coverageReport.errors.length === 0,
    summary: {
      P1: {
        total: SOURCE_COVERAGE_TIERS.P1.sources.length,
        present: coverageReport.P1.present.length,
        compliant: coverageReport.P1.compliant.length,
        missing: coverageReport.P1.missing,
        nonCompliant: coverageReport.P1.nonCompliant,
      },
      P2: {
        total: SOURCE_COVERAGE_TIERS.P2.sources.length,
        present: coverageReport.P2.present.length,
        compliant: coverageReport.P2.compliant.length,
        missing: coverageReport.P2.missing,
        nonCompliant: coverageReport.P2.nonCompliant,
      },
      P3: {
        total: SOURCE_COVERAGE_TIERS.P3.sources.length,
        present: coverageReport.P3.present.length,
        compliant: coverageReport.P3.compliant.length,
        missing: coverageReport.P3.missing,
        nonCompliant: coverageReport.P3.nonCompliant,
      },
      errors: coverageReport.errors,
      warnings: coverageReport.warnings,
    },
  };
}

export function exportSourceCoverageDetails() {
  const allSources = listSources();
  const coverageReport = validateSourceCoverage(allSources);

  return {
    sources: allSources.map(source => {
      const readiness = evaluateSourceReadiness(
        source.id,
        source.readiness,
        sourceReadinessContract.pipelineProfiles,
      );

      return {
        id: source.id,
        kind: source.kind,
        sourceClass: source.sourceClass,
        evidenceTier: source.evidenceTier,
        defaultConfidence: source.defaultConfidence,
        priority: source.priority,
        leadEligibility: source.leadEligibility,
        promotionStatus: source.promotionStatus,
        status: source.status,
        runnable: source.runnable,
        fetchModes: source.fetchModes,
        liveCapable: source.liveCapable,
        description: source.description,
        readiness,
        productionBlockers: readiness.blockers,
        requiredTier: Object.entries(SOURCE_COVERAGE_TIERS).find(([_, config]) =>
          config.sources.includes(source.id)
        )?.[0] || 'none',
        // Runtime capability and policy eligibility do not establish live readiness.
        inDigest:
          DIGEST_SOURCES.includes(source.id) &&
          source.promotionStatus === 'digest-allowed',
      };
    }),
    coverage: coverageReport,
    requirements: SOURCE_COVERAGE_TIERS,
  };
}
