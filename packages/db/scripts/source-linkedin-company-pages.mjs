import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

import {
  assertProviderNormalization,
  extractProviderRecords,
} from './adapters/provider-contract.mjs';
import { buildRfJobQuality } from './adapters/rf-source-normalizers.mjs';
import {
  buildRussianLegalNameSourceKey,
  buildSourceKeyAliases,
  countSensitiveFields,
  dedupeNormalizedRecords,
  dropSensitiveFields,
  stripBom,
} from './adapters/source-records.mjs';
import { fetchJson } from './adapters/source-http.mjs';
import { assertOrgSourceRefOwner, resolveOrganizationOwner } from './adapters/organization-resolution.mjs';
import { loadEnvFile, normalizeDomain, runScriptCli } from './lib/common-utils.mjs';
import { upsertSignalEvidenceLineage } from './lib/source-lineage-writer.mjs';

const { Client } = pg;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDir, '../../../.env');
const SOURCE_ID = 'linkedin-company-pages';
const SIGNAL_TYPE = 'job_posting';
const SUPPORTED_ACTIONS = new Set(['fetch', 'ingest', 'pipeline']);

loadEnvFile(rootEnvPath);

export async function runLinkedinCompanyPagesCli(argv = process.argv.slice(2)) {
  const requestedAction = argv[0]?.trim() || 'pipeline';
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!SUPPORTED_ACTIONS.has(requestedAction)) {
    console.error(
      'Usage: node packages/db/scripts/source-linkedin-company-pages.mjs <fetch|ingest|pipeline>\n'
        + 'Input: set LINKEDIN_COMPANY_PAGES_INPUT_FILE to a JSON array or { records: [...] } file.',
    );
    process.exit(1);
  }

  try {
    let input = resolveLinkedinInput();

    if (input.inputMode === 'provider-pending') {
      input = await resolveLinkedinProviderInput(input);
    }

    if (requestedAction === 'fetch') {
      console.log(JSON.stringify(buildFetchSummary(input), null, 2));
      return;
    }

    if (!databaseUrl) {
      console.error(
        'DATABASE_URL is not set. Add it to your environment or .env file before running linkedin-company-pages ingest or pipeline.',
      );
      process.exit(1);
    }

    const stats = await ingestLinkedinCompanyPages({
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
    console.error(`linkedin-company-pages ${requestedAction} failed: ${message}`);
    process.exit(1);
  }
}

export function resolveLinkedinInput() {
  const inputFilePath = process.env.LINKEDIN_COMPANY_PAGES_INPUT_FILE?.trim();

  if (inputFilePath) {
    return resolveLinkedinFileInput(inputFilePath);
  }

  const providerUrl = process.env.LINKEDIN_PROVIDER_API_URL?.trim();
  const providerToken = process.env.LINKEDIN_PROVIDER_API_TOKEN?.trim();

  if (providerUrl && providerToken) {
    return { inputMode: 'provider-pending', providerUrl, providerToken };
  }

  throw new Error(
    'No input configured for linkedin-company-pages.\n'
      + 'Set LINKEDIN_COMPANY_PAGES_INPUT_FILE for file mode, or\n'
      + 'set LINKEDIN_PROVIDER_API_URL and LINKEDIN_PROVIDER_API_TOKEN for provider mode.\n'
      + 'Direct LinkedIn scraping is not supported — a compliant paid provider is required.',
  );
}

export async function resolveLinkedinProviderInput({ providerUrl, providerToken }) {
  let body;

  try {
    body = await fetchJson(providerUrl, {
      sourceName: 'linkedin-company-pages provider',
      headers: {
        authorization: `Bearer ${providerToken}`,
      },
    });
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n`
        + 'Verify LINKEDIN_PROVIDER_API_URL and LINKEDIN_PROVIDER_API_TOKEN are correct.',
      { cause: error },
    );
  }

  const records = extractProviderRecords(body, SOURCE_ID);
  const fetchedAt = new Date().toISOString();
  const sensitiveFieldsDropped = records.reduce((total, record) => total + countSensitiveFields(record), 0);
  const sanitizedRecords = records.map((record) => dropSensitiveFields(record));
  const normalizedRecords = [];
  let skippedRecords = 0;

  for (const [index, record] of sanitizedRecords.entries()) {
    const normalized = normalizeLinkedinRecord(record, fetchedAt, index + 1);

    if (!normalized) {
      skippedRecords += 1;
      continue;
    }

    normalizedRecords.push(normalized);
  }

  const dedupeResult = dedupeNormalizedRecords(normalizedRecords);

  assertProviderNormalization({
    sourceId: SOURCE_ID,
    recordsReceived: records.length,
    normalizedRecords: dedupeResult.records,
    skippedRecords,
  });

  return {
    inputMode: 'provider-token',
    inputFilePath: null,
    recordsReceived: records.length,
    recordsAfterDedupe: dedupeResult.records.length,
    duplicateRecords: dedupeResult.duplicateRecords,
    normalizedRecords: dedupeResult.records,
    skippedRecords,
    sensitiveFieldsDropped,
  };
}

function resolveLinkedinFileInput(inputFilePath) {
  const resolvedPath = resolve(process.cwd(), inputFilePath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`LINKEDIN_COMPANY_PAGES_INPUT_FILE does not exist: ${resolvedPath}`);
  }

  const rawContent = stripBom(readFileSync(resolvedPath, 'utf8'));
  const records = parseInputRecords(rawContent, resolvedPath);
  const fetchedAt = new Date().toISOString();
  const sensitiveFieldsDropped = records.reduce((total, record) => total + countSensitiveFields(record), 0);
  const sanitizedRecords = records.map((record) => dropSensitiveFields(record));
  const normalizedRecords = [];
  let skippedRecords = 0;

  for (const [index, record] of sanitizedRecords.entries()) {
    const normalized = normalizeLinkedinRecord(record, fetchedAt, index + 1);

    if (!normalized) {
      skippedRecords += 1;
      continue;
    }

    normalizedRecords.push(normalized);
  }

  const dedupeResult = dedupeNormalizedRecords(normalizedRecords);

  return {
    inputMode: 'file',
    inputFilePath: resolvedPath,
    recordsReceived: records.length,
    recordsAfterDedupe: dedupeResult.records.length,
    duplicateRecords: dedupeResult.duplicateRecords,
    normalizedRecords: dedupeResult.records,
    skippedRecords,
    sensitiveFieldsDropped,
  };
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
    'LINKEDIN_COMPANY_PAGES_INPUT_FILE must contain a JSON array or a {"records": [...]} object.',
  );
}

function normalizeLinkedinRecord(record, fetchedAt, lineNumber) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return null;
  }

  const companyName = toNonEmptyText(record.company_name ?? record.org_name);
  const companyDomain = normalizeDomain(record.company_domain ?? record.domain);
  const companyWebsiteUrl = toUrlOrNull(record.company_website_url ?? record.website_url);
  const linkedinUrl = toUrlOrNull(record.linkedin_url ?? record.company_linkedin_url ?? record.profile_url);
  const jobTitle = toNonEmptyText(record.job_title ?? record.title ?? record.role);
  const jobPostingUrl = toUrlOrNull(record.job_posting_url ?? record.job_url);
  const location = toNonEmptyText(record.location ?? record.city);
  const employmentType = toNonEmptyText(record.employment_type);
  const salary = toNonEmptyText(record.salary ?? record.compensation);
  const linkedinCompanyId = toNonEmptyText(record.linkedin_company_id ?? record.company_id);
  const externalId = toNonEmptyText(record.external_id ?? record.id ?? record.job_id);
  const occurredAt = toTimestampOrNull(record.occurred_at ?? record.published_at ?? record.posted_at) ?? fetchedAt;
  const rfQuality = buildRfJobQuality({
    companyName,
    jobTitle,
    location,
    salary,
    employmentType,
    occurredAt,
    fetchedAt,
    board: 'linkedin',
  });

  const inferredDomain = companyDomain ?? extractHostname(companyWebsiteUrl);

  if (!companyName && !inferredDomain && !linkedinCompanyId) {
    return null;
  }

  if (!jobTitle) {
    return null;
  }

  if (!jobPostingUrl && !linkedinUrl) {
    return null;
  }

  const orgName = companyName ?? inferredDomain ?? `LinkedIn Org ${lineNumber}`;
  const primarySourceKey = buildPrimarySourceKey({ linkedinCompanyId, inferredDomain, companyName });
  const domainSourceKey = inferredDomain ? `domain:${inferredDomain}` : null;
  const companyNameSourceKey = companyName ? `company-name:${normalizeSourceKeyText(companyName)}` : null;
  const linkedinSourceKey = linkedinCompanyId ? `linkedin:${linkedinCompanyId}` : null;
  const russianLegalNameSourceKey = primarySourceKey !== companyNameSourceKey
    ? buildRussianLegalNameSourceKey(companyName)
    : null;
  const strongCompanyNameSourceKey = primarySourceKey === companyNameSourceKey ? companyNameSourceKey : null;
  const orgSourceKeys = [primarySourceKey, domainSourceKey, linkedinSourceKey, strongCompanyNameSourceKey].filter(
    (value, idx, values) => Boolean(value) && values.indexOf(value) === idx,
  );
  const orgSourceAliasKeys = buildSourceKeyAliases(orgSourceKeys, [companyNameSourceKey, russianLegalNameSourceKey]);

  if (orgSourceKeys.length === 0) {
    return null;
  }

  const signalExternalId = buildSignalExternalId({ externalId, jobPostingUrl, primarySourceKey, jobTitle });

  return {
    lineNumber,
    fetchedAt,
    occurredAt,
    externalId,
    companyName,
    companyDomain: inferredDomain,
    companyWebsiteUrl,
    linkedinUrl,
    linkedinCompanyId,
    jobTitle,
    jobPostingUrl,
    location,
    employmentType,
    salary,
    regionCanonical: rfQuality.regionCanonical,
    salaryRub: rfQuality.salaryRub,
    workModeFlags: rfQuality.workModeFlags,
    freshness: rfQuality.freshness,
    qualityPenalties: rfQuality.qualityPenalties,
    orgName,
    orgDisplayName: companyName ?? inferredDomain,
    primarySourceKey,
    domainSourceKey,
    companyNameSourceKey,
    linkedinSourceKey,
    russianLegalNameSourceKey,
    orgSourceKeys,
    orgSourceAliasKeys,
    signalExternalId,
  };
}

function buildPrimarySourceKey({ linkedinCompanyId, inferredDomain, companyName }) {
  if (linkedinCompanyId) {
    return `linkedin:${linkedinCompanyId}`;
  }

  if (inferredDomain) {
    return `domain:${inferredDomain}`;
  }

  if (companyName) {
    return `company-name:${normalizeSourceKeyText(companyName)}`;
  }

  return null;
}

function buildSignalExternalId({ externalId, jobPostingUrl, primarySourceKey, jobTitle }) {
  if (externalId) {
    return externalId;
  }

  if (jobPostingUrl) {
    return `job-url:${jobPostingUrl}`;
  }

  return `derived:${primarySourceKey}:${normalizeSourceKeyText(jobTitle)}`;
}

async function ingestLinkedinCompanyPages({ connectionString, input }) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: resolveDbConnectionTimeoutMillis(),
  });

  let orgUpsertCount = 0;
  let signalUpsertCount = 0;
  let evidenceUpsertCount = 0;
  let evidenceCreatedCount = 0;
  let lineageCreatedCount = 0;

  await client.connect();

  try {
    await client.query('BEGIN');

    for (const record of input.normalizedRecords) {
      const orgResult = await upsertOrgSourceRef(client, record);
      orgUpsertCount += orgResult.insertedOrg ? 1 : 0;

      const lineage = await upsertSignalEvidenceLineage(client, {
        orgId: orgResult.orgId,
        signalType: SIGNAL_TYPE,
        source: SOURCE_ID,
        sourceFamily: 'linkedin-company',
        externalId: record.signalExternalId,
        headline: record.jobTitle,
        summary: buildSignalSummaryText(record),
        sourceUrl: record.jobPostingUrl ?? record.linkedinUrl,
        publishedAt: record.occurredAt,
        normalizedAt: record.fetchedAt,
        payload: buildSignalPayload(record),
        sourceRecordType: 'job_posting',
        evidenceTier: 'corroboration',
        extractionMethod: input.inputMode,
        organizationResolutionReason: orgResult.resolutionReason,
      });

      signalUpsertCount += lineage.signalUpsertCount;
      evidenceUpsertCount += lineage.evidenceUpsertCount;
      evidenceCreatedCount += lineage.evidenceCreatedCount;
      lineageCreatedCount += lineage.lineageCreatedCount;
    }

    await client.query('COMMIT');

    return { orgUpsertCount, signalUpsertCount, evidenceUpsertCount, evidenceCreatedCount, lineageCreatedCount };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

async function upsertOrgSourceRef(client, record) {
  const resolution = await resolveOrganizationOwner(client, SOURCE_ID, record);
  let orgId = resolution.orgId;
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
        sourceKey === record.primarySourceKey ? record.linkedinCompanyId ?? null : null,
        record.orgDisplayName,
        buildOrgSourceMetadata(record, sourceKey),
      ],
    );
    await assertOrgSourceRefOwner(client, SOURCE_ID, sourceKey, orgId);
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

  return { orgId, insertedOrg, resolutionReason: resolution.resolutionReason };
}

export function buildFetchSummary(input) {
  return {
    source: SOURCE_ID,
    action: 'fetch',
    inputMode: input.inputMode,
    inputFilePath: input.inputFilePath,
    recordsReceived: input.recordsReceived,
    recordsAfterDedupe: input.recordsAfterDedupe ?? input.normalizedRecords.length,
    duplicateRecords: input.duplicateRecords,
    normalizedRecords: input.normalizedRecords.length,
    skippedRecords: input.skippedRecords,
    sensitiveFieldsDropped: input.sensitiveFieldsDropped ?? 0,
  };
}

function buildIngestSummary(input, stats) {
  return {
    source: SOURCE_ID,
    action: 'ingest',
    inputMode: input.inputMode,
    inputFilePath: input.inputFilePath,
    recordsReceived: input.recordsReceived,
    recordsAfterDedupe: input.recordsAfterDedupe ?? input.normalizedRecords.length,
    duplicateRecords: input.duplicateRecords,
    normalizedRecords: input.normalizedRecords.length,
    skippedRecords: input.skippedRecords,
    sensitiveFieldsDropped: input.sensitiveFieldsDropped ?? 0,
    orgsCreated: stats.orgUpsertCount,
    signalUpsertsCompleted: stats.signalUpsertCount,
    evidenceUpsertsCompleted: stats.evidenceUpsertCount,
    evidenceCreated: stats.evidenceCreatedCount,
    lineageCreated: stats.lineageCreatedCount,
  };
}

function buildPipelineSummary(input, stats) {
  return {
    source: SOURCE_ID,
    action: 'pipeline',
    inputMode: input.inputMode,
    inputFilePath: input.inputFilePath,
    recordsReceived: input.recordsReceived,
    recordsAfterDedupe: input.recordsAfterDedupe ?? input.normalizedRecords.length,
    duplicateRecords: input.duplicateRecords,
    normalizedRecords: input.normalizedRecords.length,
    skippedRecords: input.skippedRecords,
    sensitiveFieldsDropped: input.sensitiveFieldsDropped ?? 0,
    orgsCreated: stats.orgUpsertCount,
    signalUpsertsCompleted: stats.signalUpsertCount,
    evidenceUpsertsCompleted: stats.evidenceUpsertCount,
    evidenceCreated: stats.evidenceCreatedCount,
    lineageCreated: stats.lineageCreatedCount,
  };
}

function buildSignalSummaryText(record) {
  const fragments = [];

  if (record.companyName) {
    fragments.push(record.companyName);
  }

  if (record.location) {
    fragments.push(`регион: ${record.location}`);
  }

  if (record.linkedinUrl) {
    fragments.push('LinkedIn company page');
  }

  return fragments.length > 0
    ? `Вакансия с LinkedIn (${fragments.join(', ')})`
    : 'Вакансия с LinkedIn company page';
}

function buildSignalPayload(record) {
  return {
    source: SOURCE_ID,
    evidence_role: 'secondary_platform',
    source_entity_type: 'company',
    source_entity_key: record.primarySourceKey,
    source_entity_alias_keys: buildSourceKeyAliases(record.orgSourceKeys, record.orgSourceAliasKeys, record.primarySourceKey),
    source_entity_external_id: record.linkedinCompanyId ?? record.externalId,
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
    linkedin_url: record.linkedinUrl,
    linkedin_company_id: record.linkedinCompanyId,
    job_posting_url: record.jobPostingUrl,
    job_title: record.jobTitle,
    location: record.location,
    region_canonical: record.regionCanonical,
    employment_type: record.employmentType,
    salary: record.salary,
    salary_rub_min: record.salaryRub.min,
    salary_rub_max: record.salaryRub.max,
    salary_currency: record.salaryRub.currency,
    is_remote: record.workModeFlags.remote,
    is_hybrid: record.workModeFlags.hybrid,
    is_rotational: record.workModeFlags.rotational,
    vacancy_freshness: record.freshness,
    quality_penalties: record.qualityPenalties,
    fetched_at: record.fetchedAt,
  };
}

function buildOrgSourceMetadata(record, sourceKey) {
  return {
    source: SOURCE_ID,
    source_key: sourceKey,
    source_alias_keys: buildSourceKeyAliases(record.orgSourceKeys, record.orgSourceAliasKeys, sourceKey),
    external_id: sourceKey === record.primarySourceKey ? record.linkedinCompanyId ?? null : null,
    display_name: record.orgDisplayName,
    company_name: record.companyName,
    company_domain: record.companyDomain,
    company_website_url: record.companyWebsiteUrl,
    linkedin_url: record.linkedinUrl,
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

// loadEnvFile moved to ./lib/common-utils.mjs
// normalizeDomain moved to ./lib/common-utils.mjs

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
  await runScriptCli('source-linkedin-company-pages', runLinkedinCompanyPagesCli);
}
