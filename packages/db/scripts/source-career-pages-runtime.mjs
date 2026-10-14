import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';

import { buildSourceRunMetrics, recordSourceRunObservation } from './lib/source-health-recorder.mjs';

const { Client } = pg;
const execFileAsync = promisify(execFile);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const coreScript = resolve(scriptDir, 'source-career-pages.mjs');
const TARGET_PROVENANCE_SOURCES = new Set([
  'greenhouse',
  'lever',
  'ashby',
  'recruitee',
  'workable',
  'smartrecruiters',
]);
const TARGET_SCOPED_SIGNAL_SOURCES = ['career-pages', ...TARGET_PROVENANCE_SOURCES];
const SOURCE_BY_ADAPTER = new Map([
  ['greenhouse-board', 'greenhouse'],
  ['lever-postings', 'lever'],
  ['ashby-job-board', 'ashby'],
  ['recruitee-careers', 'recruitee'],
  ['workable-public-jobs', 'workable'],
  ['smartrecruiters-postings', 'smartrecruiters'],
  ['smartrecruiters-public-careers', 'smartrecruiters'],
]);

export async function runCareerPagesRuntime(argv = process.argv.slice(2)) {
  const action = argv[0]?.trim() || 'pipeline';
  const startedAt = new Date();

  try {
    const result = await execFileAsync(process.execPath, [coreScript, ...argv], {
      env: process.env,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    const completedAt = new Date();
    const stdout = String(result.stdout ?? '');
    const stderr = String(result.stderr ?? '');

    if (action === 'pipeline') {
      const summary = parseFinalJsonObject(stdout);
      if (!summary) {
        throw new Error('career-pages runtime wrapper could not parse the final pipeline summary.');
      }
      await persistTargetRunObservations({ summary, startedAt, completedAt });
    }

    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  } catch (error) {
    const stdout = typeof error?.stdout === 'string' ? error.stdout : '';
    const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    const message = error instanceof Error ? error.message : String(error);
    if (!stderr.includes(message)) {
      process.stderr.write(`career-pages runtime wrapper failed: ${message}\n`);
    }
    process.exitCode = Number.isInteger(error?.code) ? error.code : 1;
  }
}

const invokedAsScript = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  await runCareerPagesRuntime();
}

export async function persistTargetRunObservations(
  { summary, startedAt, completedAt },
  { databaseUrl = process.env.DATABASE_URL?.trim(), ClientConstructor = Client } = {},
) {
  const targetResults = Array.isArray(summary.targetResults) ? summary.targetResults : [];
  const recordsReceived = nonNegativeInteger(summary.recordsReceived);
  const zeroTargetRun = targetResults.length === 0 && recordsReceived === 0;
  if (targetResults.length === 0 && recordsReceived > 0) {
    throw new Error('career-pages returned records without any target-scoped run results.');
  }
  if (zeroTargetRun && nonEmptyText(summary.zeroReason) !== 'no-eligible-company-targets') {
    throw new Error('career-pages zero-target run must report zeroReason=no-eligible-company-targets.');
  }
  const identityRejectedTargetKeys = new Set(
    Array.isArray(summary.organizationResolutionRejectedTargetKeys)
      ? summary.organizationResolutionRejectedTargetKeys.map(nonEmptyText).filter(Boolean)
      : [],
  );

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to persist career-page run observations.');
  }

  const client = new ClientConstructor({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    await client.query('BEGIN');

    if (zeroTargetRun) {
      await recordSourceRunObservation(client, buildSourceRunMetrics({
        sourceId: 'career-pages',
        action: 'pipeline',
        startedAt,
        completedAt,
        input: {
          recordsReceived,
          duplicateRecords: nonNegativeInteger(summary.duplicateRecords),
          organizationResolutionRejects: nonNegativeInteger(summary.organizationResolutionRejects),
          normalizedRecords: [],
        },
      }));
      await client.query('COMMIT');
      return;
    }

    const targetDefinitions = loadTargetDefinitions(summary.targetsFilePath);
    if (targetDefinitions.size === 0) {
      throw new Error('career-pages target observations require the exact targets file used by the run.');
    }

    // The core career-page normalizer retains raw_target_id inside payload.raw.
    // Promote that already-observed provenance field to the payload root so the
    // canonical publication writer can bind each signal to the exact source
    // target without parsing source-specific raw payloads itself. This is an
    // idempotent compatibility projection, not a new identity inference.
    await client.query(
      `UPDATE signals
       SET payload = JSONB_SET(
         payload,
         '{raw_target_id}',
         TO_JSONB(payload->'raw'->>'raw_target_id'),
         true
       )
       WHERE source = ANY($1::TEXT[])
         AND NULLIF(payload->>'raw_target_id', '') IS NULL
         AND NULLIF(payload->'raw'->>'raw_target_id', '') IS NOT NULL`,
      [TARGET_SCOPED_SIGNAL_SOURCES],
    );

    for (const result of targetResults) {
      const targetKey = nonEmptyText(result?.id);
      if (!targetKey) continue;
      const target = targetDefinitions.get(targetKey);
      if (!target) {
        throw new Error(`career-pages target result has no matching target definition: ${targetKey}`);
      }
      const organizationId = await resolveTargetOrganizationId(client, target);
      if (!organizationId) {
        // Fail closed for lifecycle semantics: an unresolved target can never be
        // used as proof that a company's vacancy disappeared.
        continue;
      }
      const provenanceSource = resolveTargetProvenanceSource(result, target);
      const identityRejected = identityRejectedTargetKeys.has(targetKey);
      const targetOutcome = identityRejected
        ? 'organization-identity-conflict'
        : nonEmptyText(result?.outcome) ?? 'unknown';
      const outcome = identityRejected ? 'failure' : classifyTargetOutcome(result, targetOutcome);
      const recordsFetched = nonNegativeInteger(result?.recordsFetched);
      const latencyMs = nonNegativeInteger(result?.durationMs);
      const extractionMethod = nonEmptyText(result?.extractionMethod) ?? 'unknown';
      const errorCode = identityRejected ? 'organization-identity-conflict' : nonEmptyText(result?.errorCategory)
        ?? (outcome === 'success' ? null : targetOutcome);

      await client.query(
        `INSERT INTO source_run_observations (
           source_id, execution_source_id, scope, organization_id, target_key,
           target_outcome, action, started_at, completed_at, outcome,
           records_fetched, records_accepted, duplicate_records,
           organization_resolution_rejects, extraction_methods, latency_ms,
           error_code
         ) VALUES (
           $1, 'career-pages', 'target', $2, $3, $4, 'pipeline', $5, $6, $7,
           $8, 0, 0, 0, $9::JSONB, $10, $11
         )`,
        [
          provenanceSource,
          organizationId,
          targetKey,
          targetOutcome,
          startedAt.toISOString(),
          completedAt.toISOString(),
          outcome,
          recordsFetched,
          JSON.stringify({ [extractionMethod]: recordsFetched }),
          latencyMs,
          errorCode,
        ],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

function loadTargetDefinitions(value) {
  const configuredPath = nonEmptyText(value);
  if (!configuredPath) return new Map();
  const filePath = resolve(configuredPath);
  if (!existsSync(filePath)) return new Map();
  const parsed = JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  const targets = Array.isArray(parsed) ? parsed : parsed?.targets;
  if (!Array.isArray(targets)) return new Map();
  return new Map(targets.flatMap((target) => {
    const id = nonEmptyText(target?.id);
    return id ? [[id, target]] : [];
  }));
}

async function resolveTargetOrganizationId(client, target) {
  const domain = normalizeDomain(
    target?.company_domain
      ?? target?.companyDomain
      ?? domainFromUrl(target?.company_website_url ?? target?.companyWebsiteUrl),
  );
  if (!domain) return null;
  const result = await client.query(
    `SELECT id::TEXT AS id
     FROM orgs
     WHERE LOWER(BTRIM(domain)) = LOWER(BTRIM($1))
     ORDER BY id
     LIMIT 2`,
    [domain],
  );
  return result.rows.length === 1 ? result.rows[0].id : null;
}

function resolveTargetProvenanceSource(result, target) {
  const adapter = nonEmptyText(result?.adapter ?? target?.adapter ?? target?.type)?.toLowerCase();
  const adapterSource = adapter ? SOURCE_BY_ADAPTER.get(adapter) : null;
  if (adapterSource) return adapterSource;

  const family = nonEmptyText(
    result?.hostedAtsFamily
      ?? result?.hosted_ats_family
      ?? target?.hosted_ats_family
      ?? target?.hostedAtsFamily,
  )?.toLowerCase();
  return family && TARGET_PROVENANCE_SOURCES.has(family) ? family : 'career-pages';
}

function classifyTargetOutcome(result, targetOutcome) {
  if (targetOutcome === 'parsed' || targetOutcome === 'no-vacancies-present' || targetOutcome === 'not-modified') {
    return 'success';
  }
  const details = `${targetOutcome}\n${result?.errorCategory ?? ''}\n${JSON.stringify(result?.escalationAttempts ?? [])}`;
  if (/(?:\b429\b|throttl|rate[-_ ]?limit|deferred)/i.test(details)) return 'rate_limited';
  if (result?.stoppedByPolicy || /(?:blocked|robots|http-(?:401|403|407|451)|access-policy)/i.test(details)) {
    return 'blocked';
  }
  return 'failure';
}

function parseFinalJsonObject(value) {
  const candidates = [];
  const starts = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"' && starts.length > 0) {
      inString = true;
      continue;
    }
    if (char === '{') starts.push(index);
    else if (char === '}' && starts.length > 0) {
      const start = starts.pop();
      if (start !== undefined) candidates.push(value.slice(start, index + 1));
    }
  }
  for (const candidate of candidates.reverse()) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return null;
}

function normalizeDomain(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  return normalized || null;
}

function domainFromUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    return new URL(value).hostname.replace(/^www\./i, '');
  } catch {
    return null;
  }
}

function nonEmptyText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}
