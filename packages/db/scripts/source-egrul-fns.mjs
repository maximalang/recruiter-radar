import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

import {
  buildRussianLegalNameSourceKey,
  buildSourceKeyAliases,
  dedupeNormalizedRecords,
  stripBom,
} from './adapters/source-records.mjs';
import { normalizeDomain } from './lib/common-utils.mjs';
import { assertOrgSourceRefOwner, resolveOrganizationOwner } from './adapters/organization-resolution.mjs';
import { upsertSignalEvidenceLineage } from './lib/source-lineage-writer.mjs';

const { Client } = pg;
const SOURCE_ID = 'egrul-fns';
const SIGNAL_TYPE = 'other';
const SUPPORTED_ACTIONS = new Set(['fetch', 'ingest', 'pipeline']);


export async function runEgrulFnsCli(argv = process.argv.slice(2)) {
  const requestedAction = argv[0]?.trim() || 'pipeline';
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!SUPPORTED_ACTIONS.has(requestedAction)) {
    console.error(
      'Usage: node packages/db/scripts/source-egrul-fns.mjs <fetch|ingest|pipeline>\n'
        + 'Input: set EGRUL_FNS_INPUT_FILE to a JSON array or { records: [...] } file.',
    );
    process.exit(1);
  }

  try {
    const input = resolveEgrulFnsInput();

    if (requestedAction === 'fetch') {
      console.log(JSON.stringify(buildFetchSummary(input), null, 2));
      return;
    }

    if (!databaseUrl) {
      console.error(
        'DATABASE_URL is not set. Add it to your environment or .env file before running egrul-fns ingest or pipeline.',
      );
      process.exit(1);
    }

    const stats = await ingestEgrulFns({
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
    console.error(`egrul-fns ${requestedAction} failed: ${message}`);
    process.exit(1);
  }
}

export function resolveEgrulFnsInput() {
  const inputFilePath = process.env.EGRUL_FNS_INPUT_FILE?.trim();

  if (inputFilePath) {
    return resolveEgrulFileInput(inputFilePath);
  }

  throw new Error(
    'No official FNS integration snapshot configured for egrul-fns.\n'
      + 'Set EGRUL_FNS_INPUT_FILE to a reviewed export from the official FNS integration. '
      + 'Third-party mirrors and arbitrary provider endpoints are not accepted.',
  );
}

function resolveEgrulFileInput(inputFilePath) {
  const resolvedPath = resolve(process.cwd(), inputFilePath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`EGRUL_FNS_INPUT_FILE does not exist: ${resolvedPath}`);
  }

  const rawContent = stripBom(readFileSync(resolvedPath, 'utf8'));
  const records = parseInputRecords(rawContent, resolvedPath);
  const fetchedAt = new Date().toISOString();
  const normalizedRecords = [];
  let skippedRecords = 0;

  for (const [index, record] of records.entries()) {
    const normalized = normalizeEgrulRecord(record, fetchedAt, index + 1);

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
    duplicateRecords: dedupeResult.duplicateRecords,
    normalizedRecords: dedupeResult.records,
    skippedRecords,
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
    'EGRUL_FNS_INPUT_FILE must contain a JSON array or a {"records": [...]} object.',
  );
}

function normalizeEgrulRecord(record, fetchedAt, lineNumber) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return null;
  }

  const companyName = toNonEmptyText(record.company_name ?? record.org_name ?? record.full_name ?? record.short_name);
  const inn = normalizeLegalInn(record.inn);
  const ogrn = normalizeLegalOgrn(record.ogrn);
  const kpp = toNonEmptyText(record.kpp);
  const companyDomain = normalizeDomain(record.company_domain ?? record.domain);
  const companyWebsiteUrl = toUrlOrNull(record.company_website_url ?? record.website_url);
  const registrationDate = toNonEmptyText(record.registration_date ?? record.reg_date);
  const status = toNonEmptyText(record.status ?? record.entity_status) ?? 'active';
  const legalAddress = toNonEmptyText(record.legal_address ?? record.address);
  const okved = toNonEmptyText(record.okved ?? record.main_okved);
  const okvedDescription = toNonEmptyText(record.okved_description ?? record.activity_description);
  const externalId = toNonEmptyText(record.external_id ?? record.id);
  const sourceUrl = normalizeOfficialFnsSourceUrl(record.source_url ?? record.url);
  const detectedAt = toTimestampOrNull(record.detected_at ?? record.occurred_at ?? record.fetched_at) ?? fetchedAt;

  if ((!inn && !ogrn) || !sourceUrl) {
    return null;
  }

  const inferredDomain = companyDomain ?? extractHostname(companyWebsiteUrl);
  const fallbackName = buildLegalEntityFallbackName({ inn, ogrn, lineNumber });
  const orgName = companyName ?? fallbackName;
  const primarySourceKey = buildPrimarySourceKey({ inn, ogrn, inferredDomain, companyName });
  const innSourceKey = inn ? `inn:${inn}` : null;
  const ogrnSourceKey = ogrn ? `ogrn:${ogrn}` : null;
  const domainSourceKey = inferredDomain ? `domain:${inferredDomain}` : null;
  const companyNameSourceKey = companyName ? `company-name:${normalizeSourceKeyText(companyName)}` : null;
  const russianLegalNameSourceKey = buildRussianLegalNameSourceKey(companyName);
  const orgSourceKeys = [primarySourceKey, innSourceKey, ogrnSourceKey, domainSourceKey].filter(
    (value, idx, values) => Boolean(value) && values.indexOf(value) === idx,
  );
  const orgSourceAliasKeys = buildSourceKeyAliases(orgSourceKeys, [companyNameSourceKey, russianLegalNameSourceKey]);

  if (orgSourceKeys.length === 0) {
    return null;
  }

  const signalExternalId = buildSignalExternalId({ externalId, inn, ogrn, primarySourceKey, lineNumber });

  return {
    lineNumber,
    fetchedAt,
    detectedAt,
    externalId,
    companyName,
    companyDomain: inferredDomain,
    companyWebsiteUrl,
    inn,
    ogrn,
    kpp,
    registrationDate,
    status,
    legalAddress,
    okved,
    okvedDescription,
    sourceUrl,
    orgName,
    orgDisplayName: companyName ?? fallbackName,
    primarySourceKey,
    innSourceKey,
    ogrnSourceKey,
    domainSourceKey,
    companyNameSourceKey,
    russianLegalNameSourceKey,
    orgSourceKeys,
    orgSourceAliasKeys,
    signalExternalId,
  };
}

function buildPrimarySourceKey({ inn, ogrn, inferredDomain, companyName }) {
  if (inn) {
    return `inn:${inn}`;
  }

  if (ogrn) {
    return `ogrn:${ogrn}`;
  }

  if (inferredDomain) {
    return `domain:${inferredDomain}`;
  }

  if (companyName) {
    return `company-name:${normalizeSourceKeyText(companyName)}`;
  }

  return null;
}

function buildSignalExternalId({ externalId, inn, ogrn, primarySourceKey, lineNumber }) {
  if (externalId) {
    return externalId;
  }

  if (inn) {
    return `egrul:inn:${inn}`;
  }

  if (ogrn) {
    return `egrul:ogrn:${ogrn}`;
  }

  return `derived:${primarySourceKey}:${lineNumber}`;
}

function normalizeLegalInn(value) {
  const digits = toDigits(value);
  return digits?.length === 10 ? digits : null;
}

function normalizeLegalOgrn(value) {
  const digits = toDigits(value);
  return digits?.length === 13 ? digits : null;
}

export function normalizeOfficialFnsSourceUrl(value) {
  const normalizedUrl = toUrlOrNull(value);

  if (!normalizedUrl) {
    return null;
  }

  const url = new URL(normalizedUrl);
  const officialHosts = new Set([
    'nalog.gov.ru',
    'www.nalog.gov.ru',
    'data.nalog.gov.ru',
    'file.nalog.ru',
  ]);

  return url.protocol === 'https:' && officialHosts.has(url.hostname.toLowerCase())
    ? url.toString()
    : null;
}

function toDigits(value) {
  const text = toNonEmptyText(value);
  return text ? text.replace(/\D/g, '') : null;
}

function buildLegalEntityFallbackName({ inn, ogrn, lineNumber }) {
  if (inn) {
    return `INN ${inn}`;
  }

  if (ogrn) {
    return `OGRN ${ogrn}`;
  }

  return `Registry entity ${lineNumber}`;
}

async function ingestEgrulFns({ connectionString, input }) {
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
        sourceFamily: 'fns-official-registry',
        externalId: record.signalExternalId,
        headline: buildSignalHeadline(record),
        summary: buildSignalSummaryText(record),
        sourceUrl: record.sourceUrl,
        publishedAt: record.detectedAt,
        normalizedAt: record.fetchedAt,
        payload: buildSignalPayload(record),
        sourceRecordType: 'registry_entry',
        evidenceTier: 'context',
        confidence: 0.9,
        extractionMethod: 'official-fns-integration-snapshot',
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
        sourceKey === record.primarySourceKey ? (record.inn ?? record.ogrn ?? record.externalId) : null,
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
    duplicateRecords: input.duplicateRecords,
    normalizedRecords: input.normalizedRecords.length,
    skippedRecords: input.skippedRecords,
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
    duplicateRecords: input.duplicateRecords,
    normalizedRecords: input.normalizedRecords.length,
    skippedRecords: input.skippedRecords,
    orgsCreated: stats.orgUpsertCount,
    signalUpsertsCompleted: stats.signalUpsertCount,
    evidenceUpsertsCompleted: stats.evidenceUpsertCount,
    evidenceCreated: stats.evidenceCreatedCount,
    lineageCreated: stats.lineageCreatedCount,
  };
}

function buildSignalHeadline(record) {
  const fragments = [record.orgName];

  if (record.inn) {
    fragments.push(`ИНН ${record.inn}`);
  }

  return fragments.join(' — ');
}

function buildSignalSummaryText(record) {
  const fragments = [];

  if (record.companyName) {
    fragments.push(record.companyName);
  }

  if (record.inn) {
    fragments.push(`ИНН: ${record.inn}`);
  }

  if (record.ogrn) {
    fragments.push(`ОГРН: ${record.ogrn}`);
  }

  if (record.status) {
    fragments.push(`статус: ${record.status}`);
  }

  if (record.legalAddress) {
    fragments.push(`адрес: ${record.legalAddress}`);
  }

  return fragments.length > 0
    ? `Запись ЕГРЮЛ/ФНС (${fragments.join('; ')})`
    : 'Запись ЕГРЮЛ/ФНС';
}

function buildSignalPayload(record) {
  return {
    source: SOURCE_ID,
    evidence_role: 'enrichment',
    source_entity_type: 'legal_entity',
    source_entity_key: record.primarySourceKey,
    source_entity_alias_keys: buildSourceKeyAliases(record.orgSourceKeys, record.orgSourceAliasKeys, record.primarySourceKey),
    source_entity_external_id: record.inn ?? record.ogrn ?? record.externalId,
    source_entity_display_name: record.orgDisplayName,
    source_entity_name: record.orgName,
    source_record_type: 'registry_entry',
    source_record_id: record.signalExternalId,
    source_record_published_at: record.detectedAt,
    source_url: record.sourceUrl,
    context_only: true,
    hiring_proof: false,
    org_source_key: record.primarySourceKey,
    company_name: record.companyName,
    company_domain: record.companyDomain,
    company_website_url: record.companyWebsiteUrl,
    inn: record.inn,
    ogrn: record.ogrn,
    kpp: record.kpp,
    registration_date: record.registrationDate,
    status: record.status,
    legal_address: record.legalAddress,
    okved: record.okved,
    okved_description: record.okvedDescription,
    fetched_at: record.fetchedAt,
  };
}

function buildOrgSourceMetadata(record, sourceKey) {
  return {
    source: SOURCE_ID,
    source_key: sourceKey,
    source_alias_keys: buildSourceKeyAliases(record.orgSourceKeys, record.orgSourceAliasKeys, sourceKey),
    external_id: sourceKey === record.primarySourceKey ? (record.inn ?? record.ogrn ?? record.externalId) : null,
    display_name: record.orgDisplayName,
    company_name: record.companyName,
    company_domain: record.companyDomain,
    inn: record.inn,
    ogrn: record.ogrn,
    source_url: record.sourceUrl,
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
  await runEgrulFnsCli();
}
