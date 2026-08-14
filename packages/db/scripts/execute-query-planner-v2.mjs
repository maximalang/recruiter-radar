import { createHash } from 'node:crypto';
import pg from 'pg';

import { normalizeJobPostingRecord } from './adapters/rf-source-normalizers.mjs';
import { resolveRabotaRossiiConfiguredInput } from './source-rabota-rossii.mjs';
import { resolveSuperjobConfiguredInput } from './source-superjob.mjs';
import { writeEvidence } from './lib/evidence-writer.mjs';

const { Client } = pg;
const PLANNER_VERSION = 'query-planner-v2';
const DEFAULT_ALLOWED_SOURCES = Object.freeze(['rabota-rossii']);
const MAX_REQUESTS_PER_RUN = 50;
const STALE_SOURCE_EXECUTION_AFTER_MS = 20 * 60 * 1000;
const INTERRUPTED_EXECUTION_REASON = 'EXECUTION_INTERRUPTED_STALE';

const SEARCH_ENV_KEYS = Object.freeze({
  hh: [
    'HH_SEARCH_TEXT', 'HH_PAGES', 'HH_AREA', 'HH_EMPLOYMENT', 'HH_SCHEDULE',
    'HH_EXPERIENCE', 'HH_PROFESSIONAL_ROLE', 'HH_INDUSTRY', 'HH_DATE_FROM',
    'HH_DATE_TO', 'HH_ORDER_BY', 'HH_SEARCH_FIELD', 'HH_PER_PAGE',
    'HH_LABEL', 'HH_SEARCH_PARAMS_JSON',
  ],
  superjob: [
    'SUPERJOB_KEYWORD', 'SUPERJOB_PAGES', 'SUPERJOB_TOWN',
    'SUPERJOB_COUNT', 'SUPERJOB_PAGE',
  ],
  'rabota-rossii': [
    'RABOTA_ROSSII_SEARCH_TEXT', 'RABOTA_ROSSII_REGION_CODE',
    'RABOTA_ROSSII_REGION_CODES', 'RABOTA_ROSSII_OFFSET',
    'RABOTA_ROSSII_LIMIT', 'RABOTA_ROSSII_PAGES',
  ],
});

function parseArgs(argv) {
  const result = {
    workspaceId: null,
    clientProfileId: null,
    limit: 20,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workspace-id') result.workspaceId = argv[++index] ?? null;
    else if (arg === '--client-profile-id') result.clientProfileId = argv[++index] ?? null;
    else if (arg === '--limit') result.limit = Number(argv[++index]);
    else if (arg === '--dry-run') result.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  result.workspaceId = positiveId(result.workspaceId, 'workspace');
  result.clientProfileId = result.clientProfileId == null
    ? null
    : positiveId(result.clientProfileId, 'client profile');
  if (!Number.isInteger(result.limit) || result.limit < 1 || result.limit > MAX_REQUESTS_PER_RUN) {
    throw new Error(`--limit must be between 1 and ${MAX_REQUESTS_PER_RUN}`);
  }
  return result;
}

function allowedSources(env = process.env) {
  const raw = env.COMMERCIAL_SIGNAL_ALLOWED_QUERY_SOURCES?.trim();
  const values = raw
    ? raw.split(',').map((value) => value.trim()).filter(Boolean)
    : [...DEFAULT_ALLOWED_SOURCES];
  return new Set(values);
}

export function queryPlannerSourceProductionStatus(source, env = process.env) {
  const allowlist = allowedSources(env);
  if (!allowlist.has(source)) {
    return { allowed: false, reasonCode: 'SOURCE_NOT_OPERATOR_APPROVED' };
  }
  if (source === 'rabota-rossii') {
    return { allowed: true, reasonCode: 'OFFICIAL_OPEN_DATA_ADAPTER' };
  }
  if (source === 'hh') {
    if (!env.HH_USER_AGENT?.trim()) {
      return { allowed: false, reasonCode: 'HH_USER_AGENT_REQUIRED' };
    }
    return { allowed: true, reasonCode: 'HH_PUBLIC_API_EXPLICITLY_APPROVED' };
  }
  if (source === 'superjob') {
    if (!env.SUPERJOB_API_APP_ID?.trim()) {
      return { allowed: false, reasonCode: 'SUPERJOB_API_CREDENTIAL_REQUIRED' };
    }
    return { allowed: true, reasonCode: 'SUPERJOB_API_EXPLICITLY_APPROVED' };
  }
  return { allowed: false, reasonCode: 'SOURCE_UNSUPPORTED' };
}

export async function runQueryPlannerSourceExecutions({
  connectionString,
  workspaceId,
  clientProfileId = null,
  limit = 20,
  dryRun = false,
  env = process.env,
}) {
  const client = new Client({ connectionString });
  await client.connect();
  const stats = {
    workspaceId: positiveId(workspaceId, 'workspace'),
    clientProfileId: clientProfileId == null
      ? null
      : positiveId(clientProfileId, 'client profile'),
    dryRun: Boolean(dryRun),
    requestsScanned: 0,
    requestsExecuted: 0,
    requestsBlocked: 0,
    requestsFailed: 0,
    staleExecutionsReconciled: 0,
    fetchedRecords: 0,
    uniqueCompanies: 0,
    signalUpserts: 0,
    evidenceWrites: 0,
    executionIds: [],
    blocked: [],
    failures: [],
  };

  try {
    if (!stats.dryRun) {
      const recovery = await reconcileStaleQueryPlannerSourceExecutions({
        workspaceId: stats.workspaceId,
        clientProfileId: stats.clientProfileId,
        now: new Date(),
      }, client);
      stats.staleExecutionsReconciled = recovery.reconciled;
    }
    const requests = await loadCurrentRequests(
      client,
      stats.workspaceId,
      stats.clientProfileId,
      Math.min(Math.max(Number(limit) || 20, 1), MAX_REQUESTS_PER_RUN),
    );
    for (const request of requests) {
      stats.requestsScanned += 1;
      const policy = queryPlannerSourceProductionStatus(request.source, env);
      if (!policy.allowed) {
        stats.requestsBlocked += 1;
        stats.blocked.push({
          sharedRequestId: request.sharedRequestId,
          source: request.source,
          reasonCode: policy.reasonCode,
        });
        continue;
      }
      if (stats.dryRun) continue;

      let executionId = null;
      try {
        executionId = await createExecution(client, request, stats.workspaceId, stats.clientProfileId);
        const input = await withExactQueryEnv(
          request.source,
          request.queryEnv,
          env,
          () => resolveSourceInput(request.source, env),
        );
        const ingest = await ingestNormalizedRecords({
          client,
          executionId,
          source: request.source,
          input,
        });
        await completeExecution(client, executionId, ingest);
        stats.requestsExecuted += 1;
        stats.fetchedRecords += ingest.fetchedRecords;
        stats.uniqueCompanies += ingest.uniqueCompanies;
        stats.signalUpserts += ingest.signalUpserts;
        stats.evidenceWrites += ingest.evidenceWrites;
        stats.executionIds.push(executionId);
      } catch (error) {
        stats.requestsFailed += 1;
        const reasonCode = sourceErrorCode(error);
        stats.failures.push({
          sharedRequestId: request.sharedRequestId,
          source: request.source,
          executionId,
          reasonCode,
        });
        if (executionId) {
          await failExecution(client, executionId, reasonCode).catch(() => undefined);
        }
      }
    }
    return stats;
  } finally {
    await client.end();
  }
}

export async function reconcileStaleQueryPlannerSourceExecutions({
  workspaceId,
  clientProfileId = null,
  now = new Date(),
}, client) {
  const normalizedWorkspaceId = positiveId(workspaceId, 'workspace');
  const normalizedClientProfileId = clientProfileId == null
    ? null
    : positiveId(clientProfileId, 'client profile');
  const completedAt = validDate(now);
  const staleBefore = new Date(
    completedAt.getTime() - STALE_SOURCE_EXECUTION_AFTER_MS,
  );
  const result = await client.query(
    `UPDATE query_plan_source_executions AS execution
     SET status = 'failed',
         completed_at = $3,
         error_code = '${INTERRUPTED_EXECUTION_REASON}'
     WHERE execution.status = 'running'
       AND execution.started_at < $4
       AND EXISTS (
         SELECT 1
         FROM query_plan_source_execution_consumers AS consumer
         WHERE consumer.execution_id = execution.id
           AND consumer.workspace_id = $1
           AND ($2::BIGINT IS NULL OR consumer.client_profile_id = $2)
       )`,
    [
      normalizedWorkspaceId,
      normalizedClientProfileId,
      completedAt,
      staleBefore,
    ],
  );
  return { reconciled: Math.max(0, Number(result.rowCount ?? 0)) };
}

async function loadCurrentRequests(client, workspaceId, clientProfileId, limit) {
  const result = await client.query(
    `SELECT
       shared.id::TEXT AS "sharedRequestId",
       shared.source,
       shared.shared_request_hash AS "sharedRequestHash",
       shared.query_env AS "queryEnv",
       shared.page_budget AS "pageBudget",
       ARRAY_AGG(consumer.plan_snapshot_id::TEXT ORDER BY consumer.plan_snapshot_id)
         AS "planSnapshotIds"
     FROM query_plan_shared_requests shared
     JOIN query_plan_request_consumers consumer
       ON consumer.shared_request_id = shared.id
      AND consumer.workspace_id = $1
      AND ($2::BIGINT IS NULL OR consumer.client_profile_id = $2)
     JOIN query_plan_snapshots plan
       ON plan.id = consumer.plan_snapshot_id
      AND plan.workspace_id = consumer.workspace_id
      AND plan.client_profile_id = consumer.client_profile_id
     WHERE shared.planner_version = $3
       AND plan.status = 'ready'
       AND NOT EXISTS (
         SELECT 1
         FROM query_plan_snapshots newer
         WHERE newer.workspace_id = plan.workspace_id
           AND newer.client_profile_id = plan.client_profile_id
           AND newer.planner_version = plan.planner_version
           AND newer.plan_identity = plan.plan_identity
           AND newer.plan_generation > plan.plan_generation
       )
     GROUP BY shared.id
     ORDER BY shared.id
     LIMIT $4`,
    [workspaceId, clientProfileId, PLANNER_VERSION, limit],
  );
  return result.rows.map((row) => ({
    sharedRequestId: positiveId(row.sharedRequestId, 'shared request'),
    source: String(row.source),
    sharedRequestHash: hash(row.sharedRequestHash, 'shared request hash'),
    queryEnv: stringRecord(row.queryEnv),
    pageBudget: Number(row.pageBudget),
    planSnapshotIds: Array.isArray(row.planSnapshotIds)
      ? row.planSnapshotIds.map((id) => positiveId(id, 'plan snapshot'))
      : [],
  }));
}

async function createExecution(client, request, workspaceId, clientProfileId) {
  await client.query('BEGIN');
  try {
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`query-plan-source:${request.sharedRequestId}`],
    );
    const current = await client.query(
      `SELECT COALESCE(MAX(execution_generation), 0)::INTEGER AS generation
       FROM query_plan_source_executions
       WHERE shared_request_id = $1`,
      [request.sharedRequestId],
    );
    const generation = Number(current.rows[0]?.generation ?? 0) + 1;
    const executionIdentity = sha256(stableStringify({
      sharedRequestId: request.sharedRequestId,
      sharedRequestHash: request.sharedRequestHash,
      executionDate: new Date().toISOString().slice(0, 10),
    }));
    const inserted = await client.query(
      `INSERT INTO query_plan_source_executions (
         shared_request_id, source, shared_request_hash,
         execution_identity, execution_generation, request_snapshot,
         status, started_at
       )
       VALUES ($1, $2, $3, $4, $5, $6::JSONB, 'running', NOW())
       RETURNING id::TEXT AS id`,
      [
        request.sharedRequestId,
        request.source,
        request.sharedRequestHash,
        executionIdentity,
        generation,
        JSON.stringify({
          plannerVersion: PLANNER_VERSION,
          source: request.source,
          sharedRequestHash: request.sharedRequestHash,
          queryEnv: request.queryEnv,
          pageBudget: request.pageBudget,
          consumerScope: {
            workspaceId,
            clientProfileId,
          },
        }),
      ],
    );
    const executionId = inserted.rows[0].id;
    const consumers = await client.query(
      `INSERT INTO query_plan_source_execution_consumers (
         execution_id, plan_snapshot_id, workspace_id, client_profile_id
       )
       SELECT $1, consumer.plan_snapshot_id, consumer.workspace_id,
              consumer.client_profile_id
       FROM query_plan_request_consumers consumer
       JOIN query_plan_snapshots plan
         ON plan.id = consumer.plan_snapshot_id
        AND plan.workspace_id = consumer.workspace_id
        AND plan.client_profile_id = consumer.client_profile_id
       WHERE consumer.shared_request_id = $2
         AND consumer.workspace_id = $3
         AND ($4::BIGINT IS NULL OR consumer.client_profile_id = $4)
         AND plan.status = 'ready'
         AND NOT EXISTS (
           SELECT 1 FROM query_plan_snapshots newer
           WHERE newer.workspace_id = plan.workspace_id
             AND newer.client_profile_id = plan.client_profile_id
             AND newer.planner_version = plan.planner_version
             AND newer.plan_identity = plan.plan_identity
             AND newer.plan_generation > plan.plan_generation
         )
       ON CONFLICT DO NOTHING`,
      [executionId, request.sharedRequestId, workspaceId, clientProfileId],
    );
    if ((consumers.rowCount ?? 0) === 0) {
      throw new Error('NO_CURRENT_QUERY_PLAN_CONSUMERS');
    }
    await client.query('COMMIT');
    return executionId;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function resolveSourceInput(source, env) {
  if (source === 'superjob') return resolveSuperjobConfiguredInput();
  if (source === 'rabota-rossii') return resolveRabotaRossiiConfiguredInput();
  if (source === 'hh') return resolveHhInput(env);
  throw new Error('SOURCE_UNSUPPORTED');
}

async function resolveHhInput(env) {
  // HH is operator-gated and is not part of the default production allowlist.
  // Load its proxy-only dependencies only after that policy gate has passed so
  // an unavailable HH runtime cannot prevent Rabota Rossii from starting.
  const {
    fetchHhVacancyPages,
    resolveHhVacancySearchConfig,
  } = await import('./adapters/hh.mjs');
  const userAgent = env.HH_USER_AGENT?.trim();
  if (!userAgent) throw new Error('HH_USER_AGENT_REQUIRED');
  const fetchedAt = new Date().toISOString();
  const result = await fetchHhVacancyPages({
    userAgent,
    config: resolveHhVacancySearchConfig(process.env),
  });
  const normalized = [];
  let skippedRecords = 0;
  for (const [index, vacancy] of result.items.entries()) {
    const salary = vacancy?.salary && typeof vacancy.salary === 'object'
      ? [vacancy.salary.from, vacancy.salary.to, vacancy.salary.currency]
        .filter((value) => value !== null && value !== undefined && value !== '')
        .join('–')
      : null;
    const employerId = vacancy?.employer?.id == null
      ? null
      : String(vacancy.employer.id).trim();
    const record = normalizeJobPostingRecord({
      company_name: vacancy?.employer?.name,
      job_title: vacancy?.name,
      external_id: vacancy?.id,
      job_posting_url: vacancy?.alternate_url,
      published_at: vacancy?.published_at,
      location: vacancy?.area?.name,
      salary,
      employment_type: vacancy?.employment?.name,
      experience: vacancy?.experience?.name,
      tags: Array.isArray(vacancy?.professional_roles)
        ? vacancy.professional_roles.map((role) => role?.name).filter(Boolean)
        : [],
      source_board: 'hh',
    }, { fetchedAt, lineNumber: index + 1, sourceId: 'hh' }, { defaultBoard: 'hh' });
    if (!record) {
      skippedRecords += 1;
      continue;
    }
    if (employerId) {
      const employerKey = `employer:${employerId}`;
      record.primarySourceKey = employerKey;
      record.orgSourceKeys = uniqueStrings([employerKey, ...record.orgSourceKeys]);
      record.orgExternalId = employerId;
    }
    // Preserve the legacy HH signal identity; the old HH writer stores the raw
    // vacancy id in signals.external_id rather than prefixing it with "hh:".
    if (vacancy?.id != null && String(vacancy.id).trim()) {
      record.signalExternalId = String(vacancy.id).trim();
    }
    normalized.push(record);
  }
  const deduped = dedupeBy(normalized, (record) => record.signalExternalId);
  return {
    inputMode: 'live-public',
    inputFilePath: null,
    recordsReceived: result.items.length,
    recordsAfterDedupe: deduped.length,
    duplicateRecords: Math.max(0, normalized.length - deduped.length),
    normalizedRecords: deduped,
    skippedRecords,
    sensitiveFieldsDropped: 0,
    liveProvider: 'hh-public-api',
    pagesFetched: result.pagesFetched,
  };
}

async function ingestNormalizedRecords({ client, executionId, source, input }) {
  const stats = {
    fetchedRecords: Number(input.recordsReceived ?? input.normalizedRecords?.length ?? 0),
    uniqueCompanies: 0,
    signalUpserts: 0,
    evidenceWrites: 0,
  };
  const companies = new Set();
  await client.query('BEGIN');
  try {
    for (const record of input.normalizedRecords ?? []) {
      if (!record?.sourceUrl || !String(record.sourceUrl).trim()) {
        continue;
      }
      if (!record?.signalExternalId || !String(record.signalExternalId).trim()) {
        continue;
      }
      const org = await upsertOrgSourceRef(client, source, record);
      companies.add(String(org.orgId));
      const signal = await client.query(
        `INSERT INTO signals (
           org_id, signal_type, source, external_id, headline, summary,
           source_url, occurred_at, payload
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::JSONB)
         ON CONFLICT (source, external_id) DO UPDATE SET
           org_id = EXCLUDED.org_id,
           signal_type = EXCLUDED.signal_type,
           headline = EXCLUDED.headline,
           summary = EXCLUDED.summary,
           source_url = EXCLUDED.source_url,
           occurred_at = EXCLUDED.occurred_at,
           payload = EXCLUDED.payload
         RETURNING id::TEXT AS id, org_id::TEXT AS "organizationId",
                   external_id AS "externalId"`,
        [
          org.orgId,
          record.signalType ?? 'job_posting',
          source,
          record.signalExternalId,
          record.headline,
          record.summary,
          record.sourceUrl,
          record.occurredAt,
          JSON.stringify(buildSignalPayload(source, record)),
        ],
      );
      const signalRow = signal.rows[0];
      if (!signalRow) throw new Error('SIGNAL_UPSERT_FAILED');
      await client.query(
        `INSERT INTO query_plan_source_execution_signals (
           execution_id, signal_id, organization_id, source, external_id
         )
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (execution_id, signal_id) DO NOTHING`,
        [
          executionId,
          signalRow.id,
          signalRow.organizationId,
          source,
          signalRow.externalId,
        ],
      );
      const evidence = await writeEvidence(client, {
        source,
        url: record.sourceUrl,
        fetchedAt: record.fetchedAt ?? new Date().toISOString(),
        tier: record.evidenceRole === 'context' ? 'context' : 'direct',
        orgId: Number(signalRow.organizationId),
        payloadRef: {
          queryPlanSourceExecutionId: executionId,
          sourceRecordId: String(record.signalExternalId),
          signalId: signalRow.id,
          sourceRecordType: record.sourceRecordType ?? 'job_posting',
        },
      });
      stats.signalUpserts += 1;
      if (evidence.inserted) stats.evidenceWrites += 1;
    }
    stats.uniqueCompanies = companies.size;
    await client.query('COMMIT');
    return stats;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function completeExecution(client, executionId, stats) {
  await client.query(
    `UPDATE query_plan_source_executions
     SET status = 'succeeded',
         fetched_records = $2,
         unique_companies = $3,
         signal_upserts = $4,
         completed_at = NOW(),
         error_code = NULL
     WHERE id = $1 AND status = 'running'`,
    [
      executionId,
      stats.fetchedRecords,
      stats.uniqueCompanies,
      stats.signalUpserts,
    ],
  );
}

async function failExecution(client, executionId, errorCode) {
  await client.query(
    `UPDATE query_plan_source_executions
     SET status = 'failed', completed_at = NOW(), error_code = $2
     WHERE id = $1 AND status = 'running'`,
    [executionId, errorCode],
  );
}

async function upsertOrgSourceRef(client, source, record) {
  const sourceKeys = uniqueStrings(record.orgSourceKeys ?? [record.primarySourceKey]);
  if (!record.primarySourceKey || sourceKeys.length === 0) {
    throw new Error('ORGANIZATION_IDENTITY_MISSING');
  }
  for (const sourceKey of [...sourceKeys].sort()) {
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))',
      [source, sourceKey],
    );
  }
  const existing = await client.query(
    `SELECT org_id
     FROM org_source_refs
     WHERE source = $1 AND source_key = ANY($2::TEXT[])
     ORDER BY CASE WHEN source_key = $3 THEN 0 ELSE 1 END, id
     LIMIT 1`,
    [source, sourceKeys, record.primarySourceKey],
  );
  let orgId = existing.rows[0]?.org_id;
  if (!orgId) {
    const inserted = await client.query(
      `INSERT INTO orgs (name, domain, website_url)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [record.orgName, record.companyDomain, record.companyWebsiteUrl],
    );
    orgId = inserted.rows[0].id;
  }
  for (const sourceKey of sourceKeys) {
    await client.query(
      `INSERT INTO org_source_refs (
         org_id, source, source_key, external_id, display_name, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6::JSONB)
       ON CONFLICT (source, source_key) DO UPDATE SET
         external_id = COALESCE(EXCLUDED.external_id, org_source_refs.external_id),
         display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), org_source_refs.display_name),
         metadata = COALESCE(org_source_refs.metadata, '{}'::JSONB) || EXCLUDED.metadata`,
      [
        orgId,
        source,
        sourceKey,
        sourceKey === record.primarySourceKey ? record.orgExternalId ?? null : null,
        record.orgDisplayName,
        JSON.stringify({
          source,
          source_key: sourceKey,
          source_entity_key: record.primarySourceKey,
          source_entity_alias_keys: record.orgSourceAliasKeys ?? [],
          company_name: record.companyName,
          company_domain: record.companyDomain,
          company_website_url: record.companyWebsiteUrl,
          inn: record.inn,
          ogrn: record.ogrn,
        }),
      ],
    );
  }
  await client.query(
    `UPDATE orgs SET
       name = CASE WHEN name IS NULL OR BTRIM(name) = '' THEN $2 ELSE name END,
       domain = COALESCE(NULLIF(domain, ''), $3),
       website_url = COALESCE(NULLIF(website_url, ''), $4)
     WHERE id = $1`,
    [orgId, record.orgDisplayName ?? record.orgName, record.companyDomain, record.companyWebsiteUrl],
  );
  return { orgId };
}

function buildSignalPayload(source, record) {
  return {
    source,
    evidence_role: record.evidenceRole ?? 'primary_platform',
    source_entity_type: record.sourceEntityType ?? 'company',
    source_entity_key: record.primarySourceKey,
    source_entity_alias_keys: record.orgSourceAliasKeys ?? [],
    source_entity_external_id: record.orgExternalId ?? null,
    source_entity_display_name: record.orgDisplayName,
    source_record_type: record.sourceRecordType ?? 'job_posting',
    source_record_id: record.signalExternalId,
    source_record_title: record.recordTitle ?? record.headline,
    source_record_url: record.sourceUrl,
    source_record_published_at: record.occurredAt,
    org_source_key: record.primarySourceKey,
    company_name: record.companyName,
    company_domain: record.companyDomain,
    company_website_url: record.companyWebsiteUrl,
    inn: record.inn,
    ogrn: record.ogrn,
    fetched_at: record.fetchedAt,
    ...(record.payload ?? {}),
  };
}

async function withExactQueryEnv(source, queryEnv, baseEnv, callback) {
  const keys = SEARCH_ENV_KEYS[source] ?? [];
  const previous = new Map();
  for (const key of keys) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(queryEnv)) {
    if (!keys.includes(key)) {
      throw new Error(`QUERY_ENV_KEY_NOT_EXECUTABLE:${key}`);
    }
    process.env[key] = value;
  }
  // Credentials and source-infrastructure settings stay outside the plan, but
  // the search/query knobs themselves are now exactly the persisted snapshot.
  for (const [key, value] of Object.entries(baseEnv)) {
    if (!(key in process.env) && !keys.includes(key) && typeof value === 'string') {
      process.env[key] = value;
    }
  }
  try {
    return await callback();
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function sourceErrorCode(error) {
  const source = error instanceof Error ? `${error.name}:${error.message}` : String(error);
  const normalized = source
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  return normalized || 'SOURCE_EXECUTION_FAILED';
}

function stringRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('query_env must be an object');
  }
  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new Error(`query_env value ${key} must be a non-empty string`);
    }
    result[key] = raw;
  }
  return result;
}

function uniqueStrings(values) {
  return [...new Set((values ?? []).map((value) => String(value).trim()).filter(Boolean))];
}

function dedupeBy(values, keyFn) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = keyFn(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function positiveId(value, label) {
  const normalized = String(value ?? '').trim();
  if (!/^[1-9]\d{0,18}$/.test(normalized) || BigInt(normalized) > 9223372036854775807n) {
    throw new Error(`Invalid ${label} identifier.`);
  }
  return BigInt(normalized).toString();
}

function validDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('Invalid timestamp.');
  return date;
}

function hash(value, label) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`Invalid ${label}.`);
  return normalized;
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`,
  );
  return `{${entries.join(',')}}`;
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const args = parseArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
  }
  try {
    const result = await runQueryPlannerSourceExecutions({
      connectionString,
      ...args,
      env: process.env,
    });
    console.log(JSON.stringify(result));
    if (result.requestsFailed > 0) process.exitCode = 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
