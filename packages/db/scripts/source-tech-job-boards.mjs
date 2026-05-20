import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

import { fetchGreenhouseBoards, parseGreenhouseJobs } from './adapters/greenhouse.mjs';
import { fetchLeverCompanies, parseLeverPostings } from './adapters/lever.mjs';
import {
  buildRussianLegalNameSourceKey,
  buildSourceKeyAliases,
  dedupeNormalizedRecords,
  stripBom,
} from './adapters/source-records.mjs';

const { Client } = pg;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDir, '../../../.env');
const SOURCE_ID = 'tech-job-boards';
const SIGNAL_TYPE = 'job_posting';
const SUPPORTED_ACTIONS = new Set(['fetch', 'ingest', 'pipeline']);

loadEnvFile(rootEnvPath);

export async function runTechJobBoardsCli(argv = process.argv.slice(2)) {
  const requestedAction = argv[0]?.trim() || 'pipeline';
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!SUPPORTED_ACTIONS.has(requestedAction)) {
    console.error(
      'Usage: node packages/db/scripts/source-tech-job-boards.mjs <fetch|ingest|pipeline>\n'
        + 'Input: set TECH_JOB_BOARDS_INPUT_FILE to a JSON array or { records: [...] } file.',
    );
    process.exit(1);
  }

  try {
    let input = resolveTechJobBoardsInput();

    if (input.inputMode === 'live-pending') {
      input = await resolveTechJobBoardsLiveInput(input);
    }

    if (requestedAction === 'fetch') {
      console.log(JSON.stringify(buildFetchSummary(input), null, 2));
      return;
    }

    if (!databaseUrl) {
      console.error(
        'DATABASE_URL is not set. Add it to your environment or .env file before running tech-job-boards ingest or pipeline.',
      );
      process.exit(1);
    }

    const stats = await ingestTechJobBoards({
      connectionString: databaseUrl,
      input,
    });

    if (requestedAction === 'ingest') {
      console.log(JSON.stringify(buildIngestSummary(input, stats), null, 2));
      return;
    }

    console.log(JSON.stringify(buildPipelineSummary(input, stats), null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`tech-job-boards ${requestedAction} failed: ${message}`);
    process.exit(1);
  }
}

export function resolveTechJobBoardsInput() {
  const inputFilePath = process.env.TECH_JOB_BOARDS_INPUT_FILE?.trim();

  if (inputFilePath) {
    return resolveFileInput(inputFilePath);
  }

  const greenhouseTokens = parseCommaSeparated(process.env.TECH_JOB_BOARDS_GREENHOUSE_TOKENS);
  const leverSlugs = parseCommaSeparated(process.env.TECH_JOB_BOARDS_LEVER_SLUGS);

  if (greenhouseTokens.length > 0 || leverSlugs.length > 0) {
    return { inputMode: 'live-pending', greenhouseTokens, leverSlugs };
  }

  throw new Error(
    'No input configured for tech-job-boards.\n'
      + 'Set TECH_JOB_BOARDS_INPUT_FILE for file mode, or\n'
      + 'set TECH_JOB_BOARDS_GREENHOUSE_TOKENS and/or TECH_JOB_BOARDS_LEVER_SLUGS for live mode.',
  );
}

export async function resolveTechJobBoardsLiveInput({ greenhouseTokens, leverSlugs }) {
  const records = [];

  if (greenhouseTokens.length > 0) {
    const ghJobs = await fetchGreenhouseBoards(greenhouseTokens);
    records.push(...ghJobs);
  }

  if (leverSlugs.length > 0) {
    const leverJobs = await fetchLeverCompanies(leverSlugs);
    records.push(...leverJobs);
  }

  const fetchedAt = new Date().toISOString();
  const deduped = dedupeRecords(records);
  const normalizedRecords = [];
  let skippedRecords = 0;

  for (const [index, record] of deduped.entries()) {
    const normalized = normalizeTechJobBoardRecord(record, fetchedAt, index + 1);

    if (!normalized) {
      skippedRecords += 1;
      continue;
    }

    normalizedRecords.push(normalized);
  }

  const normalizedDedupeResult = dedupeNormalizedRecords(normalizedRecords);

  return {
    inputMode: 'live-public',
    inputFilePath: null,
    recordsReceived: records.length,
    recordsAfterDedupe: deduped.length,
    duplicateRecords: records.length - deduped.length + normalizedDedupeResult.duplicateRecords,
    normalizedRecords: normalizedDedupeResult.records,
    skippedRecords,
  };
}

function resolveFileInput(inputFilePath) {
  const resolvedPath = resolve(process.cwd(), inputFilePath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`TECH_JOB_BOARDS_INPUT_FILE does not exist: ${resolvedPath}`);
  }

  const rawContent = stripBom(readFileSync(resolvedPath, 'utf8'));
  const records = parseInputRecords(rawContent, resolvedPath);
  const fetchedAt = new Date().toISOString();
  const deduped = dedupeRecords(records);
  const normalizedRecords = [];
  let skippedRecords = 0;

  for (const [index, record] of deduped.entries()) {
    const normalized = normalizeTechJobBoardRecord(record, fetchedAt, index + 1);

    if (!normalized) {
      skippedRecords += 1;
      continue;
    }

    normalizedRecords.push(normalized);
  }

  const normalizedDedupeResult = dedupeNormalizedRecords(normalizedRecords);

  return {
    inputMode: 'file',
    inputFilePath: resolvedPath,
    recordsReceived: records.length,
    recordsAfterDedupe: deduped.length,
    duplicateRecords: records.length - deduped.length + normalizedDedupeResult.duplicateRecords,
    normalizedRecords: normalizedDedupeResult.records,
    skippedRecords,
  };
}

function parseCommaSeparated(value) {
  if (!value || typeof value !== 'string') {
    return [];
  }

  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseInputRecords(rawContent, inputFilePath) {
  const trimmedContent = rawContent.trim();

  if (trimmedContent === '') {
    return [];
  }

  const parsed = parseJson(trimmedContent, inputFilePath);

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (Array.isArray(parsed?.records)) {
    return parsed.records;
  }

  throw new Error(
    'TECH_JOB_BOARDS_INPUT_FILE must contain a JSON array or a {"records": [...]} object.',
  );
}

function dedupeRecords(records) {
  const seen = new Map();

  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      continue;
    }

    const key = buildDedupeKey(record);

    if (!key) {
      seen.set(`__no_key_${seen.size}`, record);
      continue;
    }

    if (!seen.has(key)) {
      seen.set(key, record);
    }
  }

  return [...seen.values()];
}

function buildDedupeKey(record) {
  const externalId = toNonEmptyText(record.external_id ?? record.id ?? record.job_id);

  if (externalId) {
    const board = toNonEmptyText(record.board ?? record.source_board) ?? '';
    return `${board}:${externalId}`;
  }

  const jobUrl = toUrlOrNull(record.job_posting_url ?? record.job_url ?? record.url);

  if (jobUrl) {
    return `url:${jobUrl}`;
  }

  const title = normalizeSourceKeyText(record.job_title ?? record.title ?? record.role);
  const company = normalizeSourceKeyText(record.company_name ?? record.org_name);

  if (title && company) {
    return `title:${company}:${title}`;
  }

  return null;
}

function normalizeTechJobBoardRecord(record, fetchedAt, lineNumber) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return null;
  }

  const companyName = toNonEmptyText(record.company_name ?? record.org_name);
  const companyDomain = normalizeDomain(record.company_domain ?? record.domain);
  const companyWebsiteUrl = toUrlOrNull(record.company_website_url ?? record.website_url);
  const jobTitle = toNonEmptyText(record.job_title ?? record.title ?? record.role);
  const jobPostingUrl = toUrlOrNull(record.job_posting_url ?? record.job_url ?? record.url);
  const location = toNonEmptyText(record.location ?? record.city);
  const employmentType = toNonEmptyText(record.employment_type);
  const board = toNonEmptyText(record.board ?? record.source_board) ?? 'unknown';
  const externalId = toNonEmptyText(record.external_id ?? record.id ?? record.job_id);
  const occurredAt = toTimestampOrNull(record.occurred_at ?? record.published_at ?? record.posted_at) ?? fetchedAt;
  const salary = toNonEmptyText(record.salary ?? record.compensation);
  const tags = Array.isArray(record.tags) ? record.tags.map((t) => String(t).trim()).filter(Boolean) : [];

  const inferredDomain = companyDomain ?? extractHostname(companyWebsiteUrl) ?? extractHostname(jobPostingUrl);

  if (!companyName && !inferredDomain) {
    return null;
  }

  if (!jobTitle) {
    return null;
  }

  const orgName = companyName ?? inferredDomain ?? `Tech Board Org ${lineNumber}`;
  const primarySourceKey = buildPrimarySourceKey({ inferredDomain, companyName });
  const domainSourceKey = inferredDomain ? `domain:${inferredDomain}` : null;
  const companyNameSourceKey = companyName ? `company-name:${normalizeSourceKeyText(companyName)}` : null;
  const russianLegalNameSourceKey = primarySourceKey !== companyNameSourceKey
    ? buildRussianLegalNameSourceKey(companyName)
    : null;
  const strongCompanyNameSourceKey = primarySourceKey === companyNameSourceKey ? companyNameSourceKey : null;
  const orgSourceKeys = [primarySourceKey, domainSourceKey, strongCompanyNameSourceKey].filter(
    (value, idx, values) => Boolean(value) && values.indexOf(value) === idx,
  );
  const orgSourceAliasKeys = buildSourceKeyAliases(orgSourceKeys, [companyNameSourceKey, russianLegalNameSourceKey]);

  if (orgSourceKeys.length === 0) {
    return null;
  }

  const signalExternalId = buildSignalExternalId({ externalId, jobPostingUrl, primarySourceKey, jobTitle, board });

  return {
    lineNumber,
    fetchedAt,
    occurredAt,
    externalId,
    companyName,
    companyDomain: inferredDomain,
    companyWebsiteUrl,
    jobTitle,
    jobPostingUrl,
    location,
    employmentType,
    board,
    salary,
    tags,
    orgName,
    orgDisplayName: companyName ?? inferredDomain,
    primarySourceKey,
    domainSourceKey,
    companyNameSourceKey,
    russianLegalNameSourceKey,
    orgSourceKeys,
    orgSourceAliasKeys,
    signalExternalId,
  };
}

function buildPrimarySourceKey({ inferredDomain, companyName }) {
  if (inferredDomain) {
    return `domain:${inferredDomain}`;
  }

  if (companyName) {
    return `company-name:${normalizeSourceKeyText(companyName)}`;
  }

  return null;
}

function buildSignalExternalId({ externalId, jobPostingUrl, primarySourceKey, jobTitle, board }) {
  if (externalId) {
    return `${board}:${externalId}`;
  }

  if (jobPostingUrl) {
    return `job-url:${jobPostingUrl}`;
  }

  return `derived:${primarySourceKey}:${normalizeSourceKeyText(jobTitle)}`;
}

async function ingestTechJobBoards({ connectionString, input }) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: resolveDbConnectionTimeoutMillis(),
  });

  const signalUpsertQuery = `
    INSERT INTO signals (
      org_id,
      signal_type,
      source,
      external_id,
      headline,
      summary,
      source_url,
      occurred_at,
      payload
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (source, external_id) DO UPDATE
    SET
      org_id = EXCLUDED.org_id,
      headline = EXCLUDED.headline,
      summary = EXCLUDED.summary,
      source_url = EXCLUDED.source_url,
      occurred_at = EXCLUDED.occurred_at,
      payload = EXCLUDED.payload
  `;

  let orgUpsertCount = 0;
  let signalUpsertCount = 0;

  await client.connect();

  try {
    await client.query('BEGIN');

    for (const record of input.normalizedRecords) {
      const orgResult = await upsertOrgSourceRef(client, record);
      orgUpsertCount += orgResult.insertedOrg ? 1 : 0;

      const signalResult = await client.query(signalUpsertQuery, [
        orgResult.orgId,
        SIGNAL_TYPE,
        SOURCE_ID,
        record.signalExternalId,
        record.jobTitle,
        buildSignalSummaryText(record),
        record.jobPostingUrl,
        record.occurredAt,
        buildSignalPayload(record),
      ]);

      signalUpsertCount += signalResult.rowCount ?? 0;
    }

    await client.query('COMMIT');

    return { orgUpsertCount, signalUpsertCount };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

async function upsertOrgSourceRef(client, record) {
  await lockOrgSourceKeys(client, record.orgSourceKeys);

  const existingRefResult = await client.query(
    `
      SELECT org_id
      FROM org_source_refs
      WHERE source = $1::text
        AND source_key = ANY($2::text[])
      ORDER BY
        CASE
          WHEN source_key = $3 THEN 0
          WHEN source_key = $4 THEN 1
          WHEN source_key = $5 THEN 2
          ELSE 3
        END,
        id ASC
      LIMIT 1
    `,
    [
      SOURCE_ID,
      record.orgSourceKeys,
      record.primarySourceKey,
      record.domainSourceKey,
      record.companyNameSourceKey,
    ],
  );

  let orgId = existingRefResult.rows[0]?.org_id;
  let insertedOrg = false;

  if (!orgId) {
    const insertedOrgResult = await client.query(
      `
        INSERT INTO orgs (name, domain, website_url)
        VALUES ($1, $2, $3)
        RETURNING id
      `,
      [record.orgName, record.companyDomain, record.companyWebsiteUrl],
    );

    orgId = insertedOrgResult.rows[0].id;
    insertedOrg = true;
  }

  for (const sourceKey of record.orgSourceKeys) {
    await client.query(
      `
        INSERT INTO org_source_refs (
          org_id,
          source,
          source_key,
          external_id,
          display_name,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (source, source_key) DO UPDATE
        SET
          external_id = COALESCE(EXCLUDED.external_id, org_source_refs.external_id),
          display_name = CASE
            WHEN EXCLUDED.display_name IS NULL OR BTRIM(EXCLUDED.display_name) = '' THEN org_source_refs.display_name
            WHEN org_source_refs.display_name IS NULL OR BTRIM(org_source_refs.display_name) = '' THEN EXCLUDED.display_name
            ELSE org_source_refs.display_name
          END,
          metadata = COALESCE(org_source_refs.metadata, '{}'::jsonb) || EXCLUDED.metadata
      `,
      [
        orgId,
        SOURCE_ID,
        sourceKey,
        null,
        record.orgDisplayName,
        buildOrgSourceMetadata(record, sourceKey),
      ],
    );
  }

  await client.query(
    `
      UPDATE orgs
      SET
        name = CASE
          WHEN $2::text IS NULL OR BTRIM($2::text) = '' THEN name
          WHEN name IS NULL OR BTRIM(name) = '' THEN $2::text
          ELSE name
        END,
        domain = CASE
          WHEN $3::text IS NULL OR BTRIM($3::text) = '' THEN domain
          WHEN domain IS NULL OR BTRIM(domain) = '' THEN $3::text
          ELSE domain
        END,
        website_url = CASE
          WHEN $4::text IS NULL OR BTRIM($4::text) = '' THEN website_url
          WHEN website_url IS NULL OR BTRIM(website_url) = '' THEN $4::text
          ELSE website_url
        END
      WHERE id = $1::bigint
    `,
    [orgId, record.orgDisplayName, record.companyDomain, record.companyWebsiteUrl],
  );

  return { orgId, insertedOrg };
}

async function lockOrgSourceKeys(client, sourceKeys) {
  for (const sourceKey of [...sourceKeys].sort()) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))', [
      SOURCE_ID,
      sourceKey,
    ]);
  }
}

export function buildFetchSummary(input) {
  return {
    source: SOURCE_ID,
    action: 'fetch',
    inputMode: input.inputMode,
    inputFilePath: input.inputFilePath,
    recordsReceived: input.recordsReceived,
    recordsAfterDedupe: input.recordsAfterDedupe,
    duplicateRecords: input.duplicateRecords,
    normalizedRecords: input.normalizedRecords.length,
    skippedRecords: input.skippedRecords,
  };
}

function buildIngestSummary(input, stats) {
  return {
    source: SOURCE_ID,
    action: 'ingest',
    inputMode: input.inputMode,
    inputFilePath: input.inputFilePath,
    recordsReceived: input.recordsReceived,
    recordsAfterDedupe: input.recordsAfterDedupe,
    duplicateRecords: input.duplicateRecords,
    normalizedRecords: input.normalizedRecords.length,
    skippedRecords: input.skippedRecords,
    orgsCreated: stats.orgUpsertCount,
    signalUpsertsCompleted: stats.signalUpsertCount,
  };
}

function buildPipelineSummary(input, stats) {
  return {
    source: SOURCE_ID,
    action: 'pipeline',
    inputMode: input.inputMode,
    inputFilePath: input.inputFilePath,
    recordsReceived: input.recordsReceived,
    recordsAfterDedupe: input.recordsAfterDedupe,
    duplicateRecords: input.duplicateRecords,
    normalizedRecords: input.normalizedRecords.length,
    skippedRecords: input.skippedRecords,
    orgsCreated: stats.orgUpsertCount,
    signalUpsertsCompleted: stats.signalUpsertCount,
  };
}

function buildSignalSummaryText(record) {
  const fragments = [];

  if (record.companyName) {
    fragments.push(record.companyName);
  }

  if (record.board !== 'unknown') {
    fragments.push(`доска: ${record.board}`);
  }

  if (record.location) {
    fragments.push(`регион: ${record.location}`);
  }

  return fragments.length > 0
    ? `Вакансия с тех-доски (${fragments.join(', ')})`
    : 'Вакансия с технической job board';
}

function buildSignalPayload(record) {
  return {
    source: SOURCE_ID,
    evidence_role: 'primary_platform',
    source_entity_type: 'company',
    source_entity_key: record.primarySourceKey,
    source_entity_alias_keys: buildSourceKeyAliases(record.orgSourceKeys, record.orgSourceAliasKeys, record.primarySourceKey),
    source_entity_external_id: record.externalId,
    source_entity_display_name: record.orgDisplayName,
    source_entity_name: record.orgName,
    source_record_type: 'job_posting',
    source_record_id: record.signalExternalId,
    source_record_title: record.jobTitle,
    source_record_url: record.jobPostingUrl,
    source_record_published_at: record.occurredAt,
    org_source_key: record.primarySourceKey,
    company_name: record.companyName,
    company_domain: record.companyDomain,
    company_website_url: record.companyWebsiteUrl,
    job_posting_url: record.jobPostingUrl,
    job_title: record.jobTitle,
    location: record.location,
    employment_type: record.employmentType,
    board: record.board,
    salary: record.salary,
    tags: record.tags,
    fetched_at: record.fetchedAt,
  };
}

function buildOrgSourceMetadata(record, sourceKey) {
  return {
    source: SOURCE_ID,
    source_key: sourceKey,
    source_alias_keys: buildSourceKeyAliases(record.orgSourceKeys, record.orgSourceAliasKeys, sourceKey),
    display_name: record.orgDisplayName,
    company_name: record.companyName,
    company_domain: record.companyDomain,
    company_website_url: record.companyWebsiteUrl,
  };
}

export function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse JSON from ${label}: ${message}`);
  }
}

function resolveDbConnectionTimeoutMillis() {
  const rawValue = process.env.DB_CONNECTION_TIMEOUT_MS?.trim();

  if (!rawValue) {
    return 5000;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 5000;
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const envFile = stripBom(readFileSync(filePath, 'utf8'));

  for (const rawLine of envFile.split(/\r?\n/)) {
    const trimmedLine = rawLine.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = rawLine.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = rawLine.slice(0, separatorIndex).trim();

    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = rawLine.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

export function normalizeDomain(value) {
  const normalizedValue = normalizeSourceKeyText(value);
  return normalizedValue ? normalizedValue.replace(/^www\./, '') : null;
}

export function normalizeSourceKeyText(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.trim().replace(/\s+/g, ' ').toLowerCase();
  return normalizedValue === '' ? null : normalizedValue;
}

export function toNonEmptyText(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.trim();
  return normalizedValue === '' ? null : normalizedValue;
}

export function toTimestampOrNull(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function toUrlOrNull(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.trim();

  if (normalizedValue === '') {
    return null;
  }

  try {
    return new URL(normalizedValue).toString();
  } catch {
    return null;
  }
}

export function extractHostname(value) {
  if (!value) {
    return null;
  }

  try {
    return normalizeDomain(new URL(value).hostname);
  } catch {
    return null;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runTechJobBoardsCli();
}
