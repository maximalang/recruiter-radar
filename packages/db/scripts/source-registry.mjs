import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
  SOURCE_ACTIONS,
  SOURCE_STATUS_SEMANTICS,
  createActionMap,
  defineSource,
} from './source-contract.mjs';

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
const registry = new Map();

registerSource(
  defineSource({
    id: 'hh',
    kind: 'job-board',
    sourceClass: 'primary-platform',
    evidenceTier: 'medium-signal',
    defaultConfidence: 0.74,
    status: 'active',
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

registerSource(
  defineSource({
    id: 'career-pages',
    kind: 'career-page',
    sourceClass: 'company-surface',
    evidenceTier: 'high-signal',
    defaultConfidence: 0.92,
    status: 'active',
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

registerPlannedSource({
  id: 'linkedin-company-pages',
  kind: 'professional-network',
  sourceClass: 'primary-platform',
  evidenceTier: 'medium-signal',
  defaultConfidence: 0.72,
  description: 'LinkedIn company pages and related employer surfaces as secondary platform evidence.',
});

registerPlannedSource({
  id: 'tech-job-boards',
  kind: 'job-board',
  sourceClass: 'primary-platform',
  evidenceTier: 'medium-signal',
  defaultConfidence: 0.68,
  description: 'Specialized tech job boards beyond HH for additional market coverage.',
});

registerPlannedSource({
  id: 'egrul-fns',
  kind: 'company-registry',
  sourceClass: 'registry-reference',
  evidenceTier: 'high-signal',
  defaultConfidence: 0.9,
  description: 'EGRUL/FNS company registry data for legal entity verification and enrichment.',
});

registerPlannedSource({
  id: 'company-site',
  kind: 'company-site',
  sourceClass: 'company-surface',
  evidenceTier: 'medium-signal',
  defaultConfidence: 0.68,
  description: 'Direct company websites outside dedicated careers sections for corroborating evidence.',
});

registerPlannedSource({
  id: 'funding-business-signals',
  kind: 'business-signal',
  sourceClass: 'market-signal',
  evidenceTier: 'context-only',
  defaultConfidence: 0.58,
  description: 'Funding, hiring, growth, and other business signals for supporting context only.',
});

export function listSources() {
  return [...registry.values()];
}

export function getSource(sourceId) {
  const source = registry.get(sourceId);

  if (!source) {
    throw new Error(`Unknown source: ${sourceId}`);
  }

  return source;
}

export function listSourceSummaries() {
  return listSources().map((source) => ({
    id: source.id,
    kind: source.kind,
    sourceClass: source.sourceClass,
    evidenceTier: source.evidenceTier,
    defaultConfidence: source.defaultConfidence,
    status: source.status,
    runnable: source.runnable,
    statusDescription: SOURCE_STATUS_SEMANTICS[source.status].description,
    description: source.description ?? null,
    capabilities: source.capabilities,
    actionMap: source.actionMap,
  }));
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

  registry.set(source.id, source);
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
    const stdoutChunks = [];
    const stderrChunks = [];
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: repoRoot,
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => {
      stdoutChunks.push(chunk);
      process.stdout.write(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderrChunks.push(chunk);
      process.stderr.write(chunk);
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
      rejectPromise(new Error(`${scriptPath} failed with ${details}`));
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
