import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDir, '../../../.env');
const dbConnectionTimeoutMillis = resolveDbConnectionTimeoutMillis();
const defaultTargetsFilePath = resolve(scriptDir, './career-pages-targets.json');
const defaultFetchOutputPath = resolve(scriptDir, './.cache/career-pages-fetch.json');
const SOURCE_ID = 'career-pages';
const SUPPORTED_ACTIONS = new Set(['fetch', 'ingest', 'pipeline']);

loadEnvFile(rootEnvPath);

export async function runCareerPagesCli(argv = process.argv.slice(2)) {
  const requestedAction = argv[0]?.trim() || 'pipeline';
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!SUPPORTED_ACTIONS.has(requestedAction)) {
    console.error(
      'Usage: node packages/db/scripts/source-career-pages.mjs <fetch|ingest|pipeline>\n'
        + 'Input options: set CAREER_PAGES_INPUT_FILE to a JSON/JSONL snapshot, or configure CAREER_PAGES_TARGETS_FILE for live fetch targets.',
    );
    process.exit(1);
  }

  try {
    const input = await resolveCareerPagesInput(requestedAction);

    if (requestedAction === 'fetch') {
      console.log(JSON.stringify(buildFetchSummary(input), null, 2));
      process.exit(0);
    }

    if (!databaseUrl) {
      console.error(
        'DATABASE_URL is not set. Add it to your environment or .env file before running career-pages ingest or pipeline.',
      );
      process.exit(1);
    }

    const stats = await ingestCareerPages({
      connectionString: databaseUrl,
      input,
    });

    if (requestedAction === 'ingest') {
      console.log(JSON.stringify(buildIngestSummary(input, stats), null, 2));
      process.exit(0);
    }

    console.log(
      JSON.stringify(
        {
          source: SOURCE_ID,
          action: 'pipeline',
          inputMode: input.inputMode,
          inputFilePath: input.inputFilePath,
          targetsFilePath: input.targetsFilePath,
          fetchOutputPath: input.fetchOutputPath,
          targetsProcessed: input.targetsProcessed,
          recordsReceived: input.recordsReceived,
          normalizedRecords: input.normalizedRecords.length,
          skippedRecords: input.skippedRecords,
          orgsCreated: stats.orgUpsertCount,
          signalUpsertsCompleted: stats.signalUpsertCount,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`career-pages ${requestedAction} failed: ${message}`);
    process.exit(1);
  }
}

export async function resolveCareerPagesInput(action) {
  const inputFilePath = process.env.CAREER_PAGES_INPUT_FILE?.trim();

  if (inputFilePath) {
    return loadCareerPagesInputFromFile(inputFilePath, 'file');
  }

  return fetchCareerPagesInput({
    persistSnapshot: action === 'fetch' || action === 'pipeline',
  });
}

function loadCareerPagesInputFromFile(inputFilePath, inputMode = 'file') {
  const resolvedPath = resolve(process.cwd(), inputFilePath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`CAREER_PAGES_INPUT_FILE does not exist: ${resolvedPath}`);
  }

  const rawContent = readFileSync(resolvedPath, 'utf8').replace(/^\uFEFF/, '');
  const records = parseInputRecords(rawContent, resolvedPath);

  return buildNormalizedInput({
    records,
    inputMode,
    inputFilePath: resolvedPath,
    targetsFilePath: null,
    fetchOutputPath: null,
    targetResults: [],
  });
}

export async function fetchCareerPagesInput({ persistSnapshot }) {
  const targetsFilePath = resolveCareerPagesTargetsFilePath();
  const targetsConfig = loadCareerPagesTargetsConfig(targetsFilePath);
  const targetResults = [];
  const records = [];

  for (const [index, target] of targetsConfig.targets.entries()) {
    const targetResult = await fetchCareerPageTarget(target, index + 1);
    targetResults.push(targetResult.summary);
    records.push(...targetResult.records);
  }

  const normalizedInput = buildNormalizedInput({
    records,
    inputMode: 'fetch',
    inputFilePath: null,
    targetsFilePath,
    fetchOutputPath: null,
    targetResults,
  });

  if (!persistSnapshot) {
    return normalizedInput;
  }

  const fetchOutputPath = resolveCareerPagesFetchOutputPath();
  mkdirSync(dirname(fetchOutputPath), { recursive: true });
  writeFileSync(
    fetchOutputPath,
    `${JSON.stringify({ records: normalizedInput.normalizedRecords.map((record) => record.rawRecord) }, null, 2)}\n`,
    'utf8',
  );

  return {
    ...normalizedInput,
    fetchOutputPath,
  };
}

function resolveCareerPagesTargetsFilePath() {
  const configuredPath = process.env.CAREER_PAGES_TARGETS_FILE?.trim();
  const resolvedPath = resolve(process.cwd(), configuredPath || defaultTargetsFilePath);

  if (!existsSync(resolvedPath)) {
    throw new Error(
      `CAREER_PAGES_TARGETS_FILE does not exist: ${resolvedPath}. Create it from packages/db/scripts/career-pages-targets.example.json or set CAREER_PAGES_INPUT_FILE.`,
    );
  }

  return resolvedPath;
}

function loadCareerPagesTargetsConfig(targetsFilePath) {
  const parsed = parseJson(readFileSync(targetsFilePath, 'utf8').replace(/^\uFEFF/, ''), targetsFilePath);
  const targets = Array.isArray(parsed) ? parsed : parsed?.targets;

  if (!Array.isArray(targets)) {
    throw new Error('CAREER_PAGES_TARGETS_FILE must contain a JSON array or a {"targets": [...]} object.');
  }

  return {
    targets: targets.filter(Boolean),
  };
}

async function fetchCareerPageTarget(target, index) {
  const normalizedTarget = normalizeFetchTarget(target, index);
  let records;

  if (normalizedTarget.adapter === 'greenhouse-board') {
    records = await fetchGreenhouseBoardRecords(normalizedTarget);
  } else if (normalizedTarget.adapter === 'lever-postings') {
    records = await fetchLeverPostingsRecords(normalizedTarget);
  } else if (normalizedTarget.adapter === 'json-feed') {
    records = await fetchJsonFeedRecords(normalizedTarget);
  } else if (normalizedTarget.adapter === 'static-records') {
    records = normalizedTarget.records.map((record) => ({
      ...record,
      company_name: toNonEmptyText(record?.company_name ?? record?.companyName) ?? normalizedTarget.companyName,
      company_domain: normalizeDomain(record?.company_domain ?? record?.companyDomain) ?? normalizedTarget.companyDomain,
      company_website_url: toUrlOrNull(record?.company_website_url ?? record?.companyWebsiteUrl) ?? normalizedTarget.companyWebsiteUrl,
      career_page_url: toUrlOrNull(record?.career_page_url ?? record?.careerPageUrl) ?? normalizedTarget.careerPageUrl,
    }));
  } else {
    throw new Error(`Unsupported career-pages target adapter: ${normalizedTarget.adapter}`);
  }

  return {
    records,
    summary: {
      id: normalizedTarget.id,
      adapter: normalizedTarget.adapter,
      companyName: normalizedTarget.companyName,
      sourceUrl: normalizedTarget.sourceUrl,
      recordsFetched: records.length,
    },
  };
}

function normalizeFetchTarget(target, index) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    throw new Error(`career-pages target #${index} must be an object.`);
  }

  const adapter = toNonEmptyText(target.adapter ?? target.type);

  if (!adapter) {
    throw new Error(`career-pages target #${index} is missing adapter.`);
  }

  const id = toNonEmptyText(target.id) ?? `target-${index}`;
  const companyName = toNonEmptyText(target.company_name ?? target.companyName);
  const companyDomain = normalizeDomain(target.company_domain ?? target.companyDomain);
  const companyWebsiteUrl = toUrlOrNull(target.company_website_url ?? target.companyWebsiteUrl);
  const careerPageUrl = toUrlOrNull(target.career_page_url ?? target.careerPageUrl ?? target.url);

  if (adapter === 'static-records') {
    const records = Array.isArray(target.records) ? target.records : [];

    return {
      id,
      adapter,
      companyName,
      companyDomain,
      companyWebsiteUrl,
      careerPageUrl,
      sourceUrl: null,
      records,
    };
  }

  const sourceUrl = toUrlOrNull(target.source_url ?? target.sourceUrl ?? target.url);

  if (!sourceUrl) {
    throw new Error(`career-pages target ${id} is missing a valid source URL.`);
  }

  return {
    id,
    adapter,
    companyName,
    companyDomain,
    companyWebsiteUrl,
    careerPageUrl,
    sourceUrl,
  };
}

async function fetchGreenhouseBoardRecords(target) {
  const payload = await fetchJson(target.sourceUrl, target.id);
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];

  return jobs.map((job, index) => ({
    company_name: target.companyName ?? toNonEmptyText(payload?.meta?.name),
    company_domain: target.companyDomain,
    company_website_url: target.companyWebsiteUrl,
    career_page_url: target.careerPageUrl ?? toUrlOrNull(payload?.meta?.url),
    job_posting_url: toUrlOrNull(job?.absolute_url ?? job?.url),
    job_title: toNonEmptyText(job?.title),
    external_id: stringifyExternalId(job?.id, target.id, index),
    location: toNonEmptyText(job?.location?.name),
    employment_type: toNonEmptyText(job?.metadata?.find((entry) => /employment/i.test(entry?.name ?? ''))?.value),
    occurred_at: toTimestampOrNull(job?.updated_at ?? job?.created_at),
    source_record_type: 'job_posting',
    raw_target_id: target.id,
    raw_target_adapter: target.adapter,
    raw: job,
  }));
}

async function fetchLeverPostingsRecords(target) {
  const payload = await fetchJson(target.sourceUrl, target.id);
  const jobs = Array.isArray(payload) ? payload : [];

  return jobs.map((job, index) => ({
    company_name: target.companyName,
    company_domain: target.companyDomain,
    company_website_url: target.companyWebsiteUrl,
    career_page_url: target.careerPageUrl,
    job_posting_url: toUrlOrNull(job?.hostedUrl ?? job?.applyUrl),
    job_title: toNonEmptyText(job?.text),
    external_id: stringifyExternalId(job?.id, target.id, index),
    location: toNonEmptyText(job?.categories?.location ?? job?.categories?.team),
    employment_type: toNonEmptyText(job?.categories?.commitment),
    occurred_at: toTimestampOrNull(job?.updatedAt ?? job?.createdAt),
    source_record_type: 'job_posting',
    raw_target_id: target.id,
    raw_target_adapter: target.adapter,
    raw: job,
  }));
}

async function fetchJsonFeedRecords(target) {
  const payload = await fetchJson(target.sourceUrl, target.id);
  const records = Array.isArray(payload) ? payload : payload?.records;

  if (!Array.isArray(records)) {
    throw new Error(`career-pages target ${target.id} json-feed response must be an array or { records: [...] }.`);
  }

  return records.map((record) => ({
    ...record,
    company_name: toNonEmptyText(record.company_name ?? record.companyName) ?? target.companyName,
    company_domain: normalizeDomain(record.company_domain ?? record.companyDomain) ?? target.companyDomain,
    company_website_url: toUrlOrNull(record.company_website_url ?? record.companyWebsiteUrl) ?? target.companyWebsiteUrl,
    career_page_url: toUrlOrNull(record.career_page_url ?? record.careerPageUrl) ?? target.careerPageUrl,
  }));
}

async function fetchJson(url, targetId) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json, text/plain;q=0.9, */*;q=0.1',
      'user-agent': 'RecruiterRadarCareerPages/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`career-pages target ${targetId} fetch failed with HTTP ${response.status} for ${url}`);
  }

  const responseText = await response.text();
  return parseJson(responseText, url);
}

function buildNormalizedInput({ records, inputMode, inputFilePath, targetsFilePath, fetchOutputPath, targetResults }) {
  const fetchedAt = new Date().toISOString();
  const normalizedRecords = [];
  let skippedRecords = 0;

  for (const [index, record] of records.entries()) {
    const normalizedRecord = normalizeCareerPageRecord(record, fetchedAt, index + 1);

    if (!normalizedRecord) {
      skippedRecords += 1;
      continue;
    }

    normalizedRecords.push(normalizedRecord);
  }

  return {
    inputMode,
    inputFilePath,
    targetsFilePath,
    fetchOutputPath,
    targetsProcessed: targetResults.length,
    targetResults,
    recordsReceived: records.length,
    normalizedRecords,
    skippedRecords,
  };
}

function parseInputRecords(rawContent, inputFilePath) {
  const trimmedContent = rawContent.trim();

  if (trimmedContent === '') {
    return [];
  }

  const extension = extname(inputFilePath).toLowerCase();

  if (extension === '.jsonl' || extension === '.ndjson') {
    return trimmedContent
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => parseJson(line, `${inputFilePath}:${index + 1}`));
  }

  const parsed = parseJson(trimmedContent, inputFilePath);

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (Array.isArray(parsed?.records)) {
    return parsed.records;
  }

  throw new Error(
    'CAREER_PAGES_INPUT_FILE must contain a JSON array, a {"records": [...]} object, or JSONL/NDJSON lines.',
  );
}

async function ingestCareerPages({ connectionString, input }) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: dbConnectionTimeoutMillis,
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
    VALUES ($1, 'job_posting', $2, $3, $4, $5, $6, $7, $8)
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
      const orgUpsertResult = await upsertOrgSourceRef(client, record);
      orgUpsertCount += orgUpsertResult.insertedOrg ? 1 : 0;

      const signalResult = await client.query(signalUpsertQuery, [
        orgUpsertResult.orgId,
        SOURCE_ID,
        record.signalExternalId,
        record.jobTitle,
        buildSignalSummary(record),
        record.jobPostingUrl,
        record.occurredAt,
        buildSignalPayload(record),
      ]);

      signalUpsertCount += signalResult.rowCount ?? 0;
    }

    await client.query('COMMIT');

    return {
      orgUpsertCount,
      signalUpsertCount,
    };
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
        sourceKey === record.primarySourceKey ? record.orgExternalId : null,
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
          WHEN name IS NULL OR BTRIM(name) = '' OR name = $5::text THEN $2::text
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
    [
      orgId,
      record.orgDisplayName,
      record.companyDomain,
      record.companyWebsiteUrl,
      buildFallbackOrgName(record),
    ],
  );

  return {
    orgId,
    insertedOrg,
  };
}

async function lockOrgSourceKeys(client, sourceKeys) {
  for (const sourceKey of [...sourceKeys].sort()) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))', [
      SOURCE_ID,
      sourceKey,
    ]);
  }
}

function normalizeCareerPageRecord(record, fetchedAt, lineNumber) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return null;
  }

  const rawRecord = record.raw && typeof record.raw === 'object' && !Array.isArray(record.raw)
    ? record
    : record;
  const companyName = toNonEmptyText(record.company_name ?? record.org_name ?? record.company);
  const companyDomain = normalizeDomain(record.company_domain ?? record.domain);
  const companyWebsiteUrl = toUrlOrNull(record.company_website_url ?? record.website_url ?? record.website);
  const careerPageUrl = toUrlOrNull(record.career_page_url ?? record.page_url ?? record.url);
  const jobPostingUrl = toUrlOrNull(record.job_posting_url ?? record.job_url ?? careerPageUrl);
  const jobTitle = toNonEmptyText(record.job_title ?? record.title ?? record.role);
  const recordExternalId = toNonEmptyText(record.external_id ?? record.id ?? record.job_id);
  const occurrenceInput = record.occurred_at ?? record.published_at ?? record.detected_at;
  const occurredAt = toTimestampOrNull(occurrenceInput) ?? fetchedAt;
  const sourceRecordType = toNonEmptyText(record.source_record_type) ?? 'job_posting';
  const location = toNonEmptyText(record.location ?? record.city ?? record.area_name);
  const pageTitle = toNonEmptyText(record.page_title);
  const employmentType = toNonEmptyText(record.employment_type);
  const orgExternalId = toNonEmptyText(record.org_external_id ?? record.company_id ?? record.employer_id);

  if (!companyName && !companyDomain && !careerPageUrl) {
    return null;
  }

  if (!jobTitle) {
    return null;
  }

  const inferredDomain = companyDomain
    ?? extractHostname(jobPostingUrl)
    ?? extractHostname(careerPageUrl)
    ?? extractHostname(companyWebsiteUrl);
  const orgName = companyName ?? inferredDomain ?? buildFallbackOrgName({ lineNumber });
  const primarySourceKey = buildPrimarySourceKey({ orgExternalId, inferredDomain, companyName, careerPageUrl });
  const domainSourceKey = inferredDomain ? `domain:${inferredDomain}` : null;
  const companyNameSourceKey = companyName ? `company-name:${normalizeSourceKeyText(companyName)}` : null;
  const orgSourceKeys = [primarySourceKey, domainSourceKey, companyNameSourceKey].filter(
    (value, idx, values) => Boolean(value) && values.indexOf(value) === idx,
  );

  if (orgSourceKeys.length === 0) {
    return null;
  }

  const signalExternalId = buildSignalExternalId({
    recordExternalId,
    jobPostingUrl,
    careerPageUrl,
    jobTitle,
    orgSourceKey: primarySourceKey,
  });

  return {
    rawRecord,
    lineNumber,
    fetchedAt,
    occurredAt,
    sourceRecordType,
    orgExternalId,
    companyName,
    companyDomain: inferredDomain,
    companyWebsiteUrl,
    careerPageUrl,
    jobPostingUrl,
    jobTitle,
    location,
    pageTitle,
    employmentType,
    orgName,
    orgDisplayName: companyName ?? inferredDomain,
    primarySourceKey,
    domainSourceKey,
    companyNameSourceKey,
    orgSourceKeys,
    signalExternalId,
  };
}

export function buildFetchSummary(input) {
  return {
    source: SOURCE_ID,
    action: 'fetch',
    inputMode: input.inputMode,
    inputFilePath: input.inputFilePath,
    targetsFilePath: input.targetsFilePath,
    fetchOutputPath: input.fetchOutputPath,
    targetsProcessed: input.targetsProcessed,
    targetResults: input.targetResults,
    recordsReceived: input.recordsReceived,
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
    targetsFilePath: input.targetsFilePath,
    fetchOutputPath: input.fetchOutputPath,
    targetsProcessed: input.targetsProcessed,
    recordsReceived: input.recordsReceived,
    normalizedRecords: input.normalizedRecords.length,
    skippedRecords: input.skippedRecords,
    orgsCreated: stats.orgUpsertCount,
    signalUpsertsCompleted: stats.signalUpsertCount,
  };
}

function buildSignalExternalId({ recordExternalId, jobPostingUrl, careerPageUrl, jobTitle, orgSourceKey }) {
  if (recordExternalId) {
    return recordExternalId;
  }

  if (jobPostingUrl) {
    return `job-url:${jobPostingUrl}`;
  }

  if (careerPageUrl) {
    return `career-page:${careerPageUrl}#${normalizeSourceKeyText(jobTitle)}`;
  }

  return `derived:${orgSourceKey}:${normalizeSourceKeyText(jobTitle)}`;
}

function buildPrimarySourceKey({ orgExternalId, inferredDomain, companyName, careerPageUrl }) {
  if (orgExternalId) {
    return `org:${orgExternalId}`;
  }

  if (inferredDomain) {
    return `domain:${inferredDomain}`;
  }

  if (companyName) {
    return `company-name:${normalizeSourceKeyText(companyName)}`;
  }

  if (careerPageUrl) {
    return `career-page:${careerPageUrl}`;
  }

  return null;
}

function buildOrgSourceMetadata(record, sourceKey) {
  return {
    source: SOURCE_ID,
    source_key: sourceKey,
    source_alias_keys: record.orgSourceKeys.filter((value) => value !== sourceKey),
    external_id: sourceKey === record.primarySourceKey ? record.orgExternalId : null,
    display_name: record.orgDisplayName,
    company_name: record.companyName,
    company_domain: record.companyDomain,
    company_website_url: record.companyWebsiteUrl,
    career_page_url: record.careerPageUrl,
  };
}

function buildSignalPayload(record) {
  return {
    source: SOURCE_ID,
    source_entity_type: 'company',
    source_entity_key: record.primarySourceKey,
    source_entity_alias_keys: record.orgSourceKeys.filter((value) => value !== record.primarySourceKey),
    source_entity_external_id: record.orgExternalId,
    source_entity_display_name: record.orgDisplayName,
    source_entity_name: record.orgName,
    source_record_type: record.sourceRecordType,
    source_record_id: record.signalExternalId,
    source_record_title: record.jobTitle,
    source_record_url: record.jobPostingUrl,
    source_record_published_at: record.occurredAt,
    org_source_key: record.primarySourceKey,
    company_name: record.companyName,
    company_domain: record.companyDomain,
    company_website_url: record.companyWebsiteUrl,
    career_page_url: record.careerPageUrl,
    job_posting_url: record.jobPostingUrl,
    job_title: record.jobTitle,
    location: record.location,
    page_title: record.pageTitle,
    employment_type: record.employmentType,
    fetched_at: record.fetchedAt,
    raw: record.rawRecord,
  };
}

function buildSignalSummary(record) {
  const fragments = [];

  if (record.companyName) {
    fragments.push(record.companyName);
  }

  if (record.location) {
    fragments.push(`регион: ${record.location}`);
  }

  if (record.careerPageUrl) {
    fragments.push('прямая career page');
  }

  return fragments.length > 0
    ? `Вакансия с career page (${fragments.join(', ')})`
    : 'Вакансия с прямой career page';
}

function buildFallbackOrgName(record) {
  if (record.companyDomain) {
    return record.companyDomain;
  }

  if (record.lineNumber) {
    return `Career Page Org ${record.lineNumber}`;
  }

  return 'Career Page Org';
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

export function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const envFile = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');

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

export function resolveCareerPagesFetchOutputPath() {
  const configuredPath = process.env.CAREER_PAGES_FETCH_OUTPUT_FILE?.trim();
  return resolve(process.cwd(), configuredPath || defaultFetchOutputPath);
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

export function stringifyExternalId(value, targetId, index) {
  const normalizedValue = toNonEmptyText(value);
  return normalizedValue ?? `${targetId}:${index + 1}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCareerPagesCli();
}
