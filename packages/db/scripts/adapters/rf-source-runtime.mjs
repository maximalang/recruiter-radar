import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

import {
  assertProviderNormalization,
  extractProviderRecords,
} from './provider-contract.mjs';
import {
  buildRussianLegalNameSourceKey,
  buildSourceKeyAliases,
  countSensitiveFields,
  dedupeNormalizedRecords,
  dropSensitiveFields,
  stripBom,
} from './source-records.mjs';
import { loadEnvFile, normalizeDomain } from '../lib/common-utils.mjs';
import { upsertSignalEvidenceLineage } from '../lib/source-lineage-writer.mjs';
import { fetchJson } from './source-http.mjs';
import {
  assertOrgSourceRefOwner,
  classifyStrongIdentityKey,
  isOrganizationIdentityConflict,
  OrganizationIdentityConflictError,
  resolveOrganizationOwner,
} from './organization-resolution.mjs';
import { buildSourceRunMetrics, recordSourceRunObservation } from '../lib/source-health-recorder.mjs';
import { redactSourceRuntimeSecrets } from '../lib/source-secret-redaction.mjs';

export { loadEnvFile, normalizeDomain };

const { Client } = pg;
const SUPPORTED_ACTIONS = new Set(['fetch', 'ingest', 'pipeline']);

export function resolveSuccessfulIngestZeroReason(input, stats) {
  if (input?.zeroReason) return input.zeroReason;
  const normalizedCount = Array.isArray(input?.normalizedRecords) ? input.normalizedRecords.length : 0;
  const rejectedCount = Math.max(0, Number(stats?.organizationResolutionRejects ?? 0));
  const acceptedCount = Math.max(0, normalizedCount - rejectedCount);
  return acceptedCount > 0 && Number(stats?.signalUpsertCount ?? 0) === 0
    ? 'no-new-signals'
    : undefined;
}

export function createStandardSourceRuntime(config) {
  const sourceId = config.sourceId;

  function resolveFileInput(inputFilePath) {
    const resolvedPath = resolve(process.cwd(), inputFilePath);

    if (!existsSync(resolvedPath)) {
      throw new Error(`${config.inputFileEnvName ?? 'SOURCE_INPUT_FILE'} does not exist: ${resolvedPath}`);
    }

    const rawContent = stripBom(readFileSync(resolvedPath, 'utf8'));
    const records = parseInputRecords(rawContent, resolvedPath, config.extractRecords);

    return buildInputFromRecords({
      inputMode: 'file',
      inputFilePath: resolvedPath,
      records,
    });
  }

  async function resolveProviderInput({ providerUrl, providerToken, providerHeaders, providerLabel }) {
    const authHeaders = providerHeaders ?? { authorization: `Bearer ${providerToken}` };
    let body;

    try {
      body = await fetchJson(providerUrl, {
        sourceName: providerLabel ?? `${sourceId} provider`,
        headers: authHeaders,
      });
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nVerify provider config for ${sourceId}.`,
        { cause: error },
      );
    }

    const records = (config.extractProviderRecords ?? extractProviderRecords)(body, sourceId);
    const input = buildInputFromRecords({
      inputMode: 'provider-token',
      inputFilePath: null,
      records,
      rejectAllSkipped: true,
    });

    assertProviderNormalization({
      sourceId,
      recordsReceived: records.length,
      normalizedRecords: input.normalizedRecords,
      skippedRecords: input.skippedRecords,
    });

    return input;
  }

  function buildInputFromRecords({ inputMode, inputFilePath, records, rejectAllSkipped = false, extra = {} }) {
    const fetchedAt = new Date().toISOString();
    const normalizedRecords = [];
    let skippedRecords = 0;
    let sensitiveFieldsDropped = 0;

    for (const [index, rawRecord] of records.entries()) {
      const unwrappedRecord = unwrapRecord(rawRecord);
      sensitiveFieldsDropped += countSensitiveFields(unwrappedRecord);
      const record = dropSensitiveFields(unwrappedRecord);
      const normalized = config.normalizeRecord(record, {
        fetchedAt,
        lineNumber: index + 1,
        sourceId,
      });

      if (!normalized) {
        skippedRecords += 1;
        continue;
      }

      normalizedRecords.push(finalizeRecord(normalized, fetchedAt, index + 1));
    }

    const dedupeResult = dedupeNormalizedRecords(normalizedRecords);

    if (rejectAllSkipped && records.length > 0 && dedupeResult.records.length === 0) {
      throw new Error(
        `${sourceId} returned ${records.length} records but 0 normalized records (${skippedRecords} skipped). Check source mapping before running in production.`,
      );
    }

    return {
      inputMode,
      inputFilePath,
      recordsReceived: records.length,
      recordsAfterDedupe: dedupeResult.records.length,
      duplicateRecords: dedupeResult.duplicateRecords,
      normalizedRecords: dedupeResult.records,
      skippedRecords,
      sensitiveFieldsDropped,
      ...extra,
    };
  }

  async function ingest({ connectionString, input }) {
    const client = new Client({
      connectionString,
      connectionTimeoutMillis: resolveDbConnectionTimeoutMillis(),
    });

    let orgUpsertCount = 0;
    let signalUpsertCount = 0;
    let evidenceUpsertCount = 0;
    let evidenceCreatedCount = 0;
    let lineageCreatedCount = 0;
    let organizationResolutionRejects = 0;

    await client.connect();

    try {
      await client.query('BEGIN');

      for (const record of input.normalizedRecords) {
        let orgResult;
        try {
          orgResult = await upsertOrgSourceRef(client, sourceId, record);
        } catch (error) {
          if (!isOrganizationIdentityConflict(error)) throw error;
          organizationResolutionRejects += 1;
          continue;
        }
        orgUpsertCount += orgResult.insertedOrg ? 1 : 0;

        const signalPayload = buildSignalPayload(sourceId, config, record);
        const evidenceRole = record.evidenceRole ?? config.evidenceRole;
        const evidenceTier = evidenceRole === 'primary_platform' ? 'corroboration' : 'context';
        const lineage = await upsertSignalEvidenceLineage(client, {
          orgId: orgResult.orgId,
          signalType: record.signalType ?? config.signalType,
          source: sourceId,
          sourceFamily: config.sourceFamily ?? sourceId,
          externalId: record.signalExternalId,
          headline: record.headline,
          summary: record.summary,
          sourceUrl: record.sourceUrl,
          publishedAt: record.occurredAt,
          normalizedAt: record.fetchedAt,
          payload: signalPayload,
          sourceRecordType: record.sourceRecordType ?? config.sourceRecordType,
          evidenceTier,
          confidence: record.confidence,
          extractionMethod: record.extractionMethod ?? input.inputMode,
          organizationResolutionReason: orgResult.resolutionReason,
        });
        signalUpsertCount += lineage.signalUpsertCount;
        evidenceUpsertCount += lineage.evidenceUpsertCount;
        evidenceCreatedCount += lineage.evidenceCreatedCount;
        lineageCreatedCount += lineage.lineageCreatedCount;
      }

      input.organizationResolutionRejects = organizationResolutionRejects;
      if (input.normalizedRecords.length > 0
        && organizationResolutionRejects === input.normalizedRecords.length) {
        throw new Error(`organization identity conflict: ${sourceId} rejected every normalized record at the identity gate.`);
      }

      await client.query('COMMIT');

      return {
        orgUpsertCount,
        signalUpsertCount,
        evidenceUpsertCount,
        evidenceCreatedCount,
        lineageCreatedCount,
        organizationResolutionRejects,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      await client.end();
    }
  }

  async function runCli(argv, resolveInput) {
    const requestedAction = argv[0]?.trim() || 'pipeline';
    const databaseUrl = process.env.DATABASE_URL?.trim();
    const startedAt = Date.now();
    let input = null;

    if (!SUPPORTED_ACTIONS.has(requestedAction)) {
      console.error(
        `Usage: node ${config.scriptName ?? `packages/db/scripts/source-${sourceId}.mjs`} <fetch|ingest|pipeline>\n`
          + (config.usageText ?? ''),
      );
      process.exit(1);
    }

    try {
      input = await resolveInput();

      if (requestedAction === 'fetch') {
        await persistRunHealth(databaseUrl, buildSourceRunMetrics({ sourceId, action: requestedAction, startedAt, completedAt: Date.now(), input }));
        console.log(JSON.stringify(buildFetchSummary(input), null, 2));
        return;
      }

      if (!databaseUrl) {
        console.error(
          `DATABASE_URL is not set. Add it to your environment or .env file before running ${sourceId} ingest or pipeline.`,
        );
        process.exit(1);
      }

      const stats = await ingest({ connectionString: databaseUrl, input });
      await persistRunHealth(databaseUrl, buildSourceRunMetrics({ sourceId, action: requestedAction, startedAt, completedAt: Date.now(), input }));

      if (requestedAction === 'ingest') {
        console.log(JSON.stringify(buildIngestSummary(input, stats), null, 2));
        return;
      }

      console.log(JSON.stringify(buildPipelineSummary(input, stats), null, 2));
    } catch (error) {
      await persistRunHealth(databaseUrl, buildSourceRunMetrics({ sourceId, action: requestedAction, startedAt, completedAt: Date.now(), input, error }));
      const message = redactSourceRuntimeSecrets(
        error instanceof Error ? error.message : String(error),
      );
      console.error(`${sourceId} ${requestedAction} failed: ${message}`);
      process.exit(1);
    }
  }

  function buildFetchSummary(input) {
    return {
      source: sourceId,
      action: 'fetch',
      inputMode: input.inputMode,
      inputFilePath: input.inputFilePath,
      ...(config.buildSummaryExtras?.(input) ?? {}),
      recordsReceived: input.recordsReceived,
      parsedRecords: input.recordsReceived,
      recordsAfterDedupe: input.recordsAfterDedupe ?? input.normalizedRecords.length,
      duplicateRecords: input.duplicateRecords,
      normalizedRecords: input.normalizedRecords.length,
      skippedRecords: input.skippedRecords,
      sensitiveFieldsDropped: input.sensitiveFieldsDropped ?? 0,
      zeroReason: input.zeroReason ?? undefined,
    };
  }

  function buildIngestSummary(input, stats) {
    return {
      source: sourceId,
      action: 'ingest',
      inputMode: input.inputMode,
      inputFilePath: input.inputFilePath,
      ...(config.buildSummaryExtras?.(input) ?? {}),
      recordsReceived: input.recordsReceived,
      parsedRecords: input.recordsReceived,
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
      organizationResolutionRejects: stats.organizationResolutionRejects,
      zeroReason: resolveSuccessfulIngestZeroReason(input, stats),
    };
  }

  function buildPipelineSummary(input, stats) {
    return {
      source: sourceId,
      action: 'pipeline',
      inputMode: input.inputMode,
      inputFilePath: input.inputFilePath,
      ...(config.buildSummaryExtras?.(input) ?? {}),
      recordsReceived: input.recordsReceived,
      parsedRecords: input.recordsReceived,
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
      organizationResolutionRejects: stats.organizationResolutionRejects,
      zeroReason: resolveSuccessfulIngestZeroReason(input, stats),
    };
  }

  return {
    runCli,
    resolveFileInput,
    resolveProviderInput,
    buildInputFromRecords,
    ingest,
    buildFetchSummary,
    buildIngestSummary,
    buildPipelineSummary,
  };
}

async function persistRunHealth(connectionString, metrics) {
  if (!connectionString) return;
  const client = new Client({ connectionString, connectionTimeoutMillis: resolveDbConnectionTimeoutMillis() });
  try {
    await client.connect();
    await recordSourceRunObservation(client, metrics);
  } catch (error) {
    console.error(`source health observation skipped: ${error instanceof Error ? error.message : 'unknown error'}`);
  } finally {
    await client.end().catch(() => {});
  }
}

async function upsertOrgSourceRef(client, sourceId, record) {
  const resolution = await resolveOrganizationOwner(client, sourceId, record);
  const canonicalInn = canonicalLegalIdentifier(record, 'inn');
  const canonicalOgrn = canonicalLegalIdentifier(record, 'ogrn');
  let orgId = resolution.orgId;
  let insertedOrg = false;

  if (!orgId) {
    const insertedOrgResult = await client.query(
      `
        INSERT INTO orgs (name, domain, website_url, inn, ogrn)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `,
      [record.orgName, record.companyDomain, record.companyWebsiteUrl, canonicalInn, canonicalOgrn],
    );

    orgId = insertedOrgResult.rows[0].id;
    insertedOrg = true;
  }

  const canonicalUpdate = await client.query(
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
        END,
        inn = COALESCE(inn, $5::text),
        ogrn = COALESCE(ogrn, $6::text)
      WHERE id = $1::bigint
        AND (inn IS NULL OR $5::text IS NULL OR inn = $5::text)
        AND (ogrn IS NULL OR $6::text IS NULL OR ogrn = $6::text)
    `,
    [orgId, record.orgDisplayName, record.companyDomain, record.companyWebsiteUrl, canonicalInn, canonicalOgrn],
  );
  if (canonicalUpdate.rowCount !== 1) {
    throw new OrganizationIdentityConflictError(`canonical legal identity conflict for organization ${orgId}`);
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
        sourceId,
        sourceKey,
        sourceKey === record.primarySourceKey ? record.orgExternalId ?? null : null,
        record.orgDisplayName,
        buildOrgSourceMetadata(sourceId, record, sourceKey),
      ],
    );
    await assertOrgSourceRefOwner(client, sourceId, sourceKey, orgId);
  }

  return { orgId, insertedOrg, resolutionReason: resolution.resolutionReason };
}

function canonicalLegalIdentifier(record, type) {
  const typedSourceKey = type === 'inn' ? record.innSourceKey : record.ogrnSourceKey;
  if (typedSourceKey != null && classifyStrongIdentityKey(typedSourceKey)?.type !== type) {
    throw new OrganizationIdentityConflictError(`${type}SourceKey is not a checksum-valid ${type.toUpperCase()} identity`);
  }
  const declaredKeys = [
    ...(record.orgSourceKeys ?? []),
    ...(record.orgSourceAliasKeys ?? []),
    record.primarySourceKey,
    record.innSourceKey,
    record.ogrnSourceKey,
  ].filter((value) => typeof value === 'string');
  const legalKeys = declaredKeys.filter((sourceKey) => sourceKey.startsWith(`${type}:`));
  const strongValues = [...new Set(legalKeys.map((sourceKey) => {
    const identity = classifyStrongIdentityKey(sourceKey);
    if (identity?.type !== type) {
      throw new OrganizationIdentityConflictError(`invalid ${type.toUpperCase()} identity key in source record`);
    }
    return identity.key.slice(type.length + 1);
  }))];
  if (strongValues.length > 1) {
    throw new OrganizationIdentityConflictError(`multiple checksum-valid ${type.toUpperCase()} identities in one source record`);
  }

  const claimedValue = type === 'inn'
    ? normalizeLegalInn(record.inn)
    : normalizeLegalOgrn(record.ogrn);
  if (record[type] != null) {
    const claimedIdentity = claimedValue
      ? classifyStrongIdentityKey(`${type}:${claimedValue}`)
      : null;
    if (claimedIdentity?.type !== type) {
      throw new OrganizationIdentityConflictError(`invalid ${type.toUpperCase()} field in source record`);
    }
  }
  if (strongValues.length === 0) return null;
  if (claimedValue != null && claimedValue !== strongValues[0]) {
    throw new OrganizationIdentityConflictError(`source ${type.toUpperCase()} field conflicts with its strong identity key`);
  }
  return strongValues[0];
}

function buildSignalPayload(sourceId, config, record) {
  return {
    ...(record.payload ?? {}),
    source: sourceId,
    evidence_role: record.evidenceRole ?? config.evidenceRole,
    source_entity_type: record.sourceEntityType ?? 'company',
    source_entity_key: record.primarySourceKey,
    source_entity_alias_keys: buildSourceKeyAliases(record.orgSourceKeys, record.orgSourceAliasKeys, record.primarySourceKey),
    source_entity_external_id: record.orgExternalId ?? null,
    source_entity_display_name: record.orgDisplayName,
    source_entity_name: record.orgName,
    source_record_type: record.sourceRecordType ?? config.sourceRecordType,
    source_record_id: record.signalExternalId,
    source_record_title: record.recordTitle ?? record.headline,
    source_record_url: record.sourceUrl,
    source_record_published_at: record.occurredAt,
    org_source_key: record.primarySourceKey,
    company_name: record.companyName,
    company_domain: record.companyDomain,
    company_website_url: record.companyWebsiteUrl,
    inn: canonicalLegalIdentifier(record, 'inn'),
    ogrn: canonicalLegalIdentifier(record, 'ogrn'),
    fetched_at: record.fetchedAt,
  };
}

function buildOrgSourceMetadata(sourceId, record, sourceKey) {
  return {
    ...(record.orgMetadata ?? {}),
    source: sourceId,
    source_key: sourceKey,
    source_alias_keys: buildSourceKeyAliases(record.orgSourceKeys, record.orgSourceAliasKeys, sourceKey),
    external_id: sourceKey === record.primarySourceKey ? record.orgExternalId ?? null : null,
    display_name: record.orgDisplayName,
    company_name: record.companyName,
    company_domain: record.companyDomain,
    company_website_url: record.companyWebsiteUrl,
    inn: canonicalLegalIdentifier(record, 'inn'),
    ogrn: canonicalLegalIdentifier(record, 'ogrn'),
  };
}

function finalizeRecord(record, fetchedAt, lineNumber) {
  return {
    ...record,
    lineNumber: record.lineNumber ?? lineNumber,
    fetchedAt: record.fetchedAt ?? fetchedAt,
    occurredAt: record.occurredAt ?? fetchedAt,
    orgExternalId: record.orgExternalId ?? null,
  };
}

function parseInputRecords(rawContent, inputFilePath, extractRecords) {
  const trimmedContent = rawContent.trim();

  if (trimmedContent === '') {
    return [];
  }

  const parsed = parseJson(trimmedContent, inputFilePath);

  if (extractRecords) {
    return extractRecords(parsed, inputFilePath);
  }

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (Array.isArray(parsed?.records)) {
    return parsed.records;
  }

  throw new Error(`${inputFilePath} must contain a JSON array or a {records: [...]} object.`);
}

function unwrapRecord(rawRecord) {
  return rawRecord?.vacancy && typeof rawRecord.vacancy === 'object'
    ? rawRecord.vacancy
    : rawRecord;
}

export function extractArrayRecords(body) {
  if (Array.isArray(body)) {
    return body;
  }

  if (Array.isArray(body?.records)) {
    return body.records;
  }

  return [];
}

export function buildCompanyIdentity({
  companyName,
  companyDomain,
  companyWebsiteUrl,
  inn,
  ogrn,
  fallbackName,
  lineNumber,
}) {
  const inferredDomain = companyDomain ?? extractHostname(companyWebsiteUrl);
  const orgName = companyName ?? fallbackName ?? inferredDomain ?? `Source org ${lineNumber}`;
  const companyNameSourceKey = companyName ? `company-name:${normalizeSourceKeyText(companyName)}` : null;
  const innSourceKey = inn ? `inn:${inn}` : null;
  const ogrnSourceKey = ogrn ? `ogrn:${ogrn}` : null;
  const domainSourceKey = inferredDomain ? `domain:${inferredDomain}` : null;
  const primarySourceKey = innSourceKey ?? ogrnSourceKey ?? domainSourceKey ?? companyNameSourceKey;
  const russianLegalNameSourceKey = primarySourceKey !== companyNameSourceKey
    ? buildRussianLegalNameSourceKey(companyName)
    : null;
  const strongCompanyNameSourceKey = primarySourceKey === companyNameSourceKey ? companyNameSourceKey : null;
  const orgSourceKeys = [primarySourceKey, innSourceKey, ogrnSourceKey, domainSourceKey, strongCompanyNameSourceKey].filter(
    (value, index, values) => Boolean(value) && values.indexOf(value) === index,
  );
  const orgSourceAliasKeys = buildSourceKeyAliases(orgSourceKeys, [companyNameSourceKey, russianLegalNameSourceKey]);

  if (orgSourceKeys.length === 0) {
    return null;
  }

  return {
    orgName,
    orgDisplayName: companyName ?? fallbackName ?? inferredDomain,
    companyDomain: inferredDomain,
    primarySourceKey,
    innSourceKey,
    ogrnSourceKey,
    domainSourceKey,
    companyNameSourceKey,
    russianLegalNameSourceKey,
    orgSourceKeys,
    orgSourceAliasKeys,
  };
}

export function parseCommaSeparated(value) {
  if (!value || typeof value !== 'string') {
    return [];
  }

  return value.split(/\r?\n|,|;/).map((item) => item.trim()).filter(Boolean);
}

export function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

export function normalizeLegalInn(value) {
  const digits = toDigits(value);
  return digits?.length === 10 ? digits : null;
}

export function normalizeLegalOgrn(value) {
  const digits = toDigits(value);
  return digits?.length === 13 ? digits : null;
}

export function toDigits(value) {
  const text = toNonEmptyText(value);
  return text ? text.replace(/\D/g, '') : null;
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

export function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse JSON from ${label}: ${message}`);
  }
}

export function resolveDbConnectionTimeoutMillis() {
  const rawValue = process.env.DB_CONNECTION_TIMEOUT_MS?.trim();

  if (!rawValue) {
    return 5000;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 5000;
}

