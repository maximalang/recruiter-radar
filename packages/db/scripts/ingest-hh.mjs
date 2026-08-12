import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import {
  fetchHhVacancyPages,
  resolveHhVacancySearchConfig,
} from './adapters/hh.mjs';
import {
  buildRussianLegalNameSourceKey,
  buildSourceKeyAliases,
  dedupeNormalizedRecords,
  stripBom,
} from './adapters/source-records.mjs';
import { toUrlOrNull } from './adapters/rf-source-runtime.mjs';
import {
  assertOrgSourceRefOwner,
  resolveOrganizationOwner,
} from './adapters/organization-resolution.mjs';
import { extractDomain } from './lib/adapter-base.mjs';
import { upsertSignalEvidenceLineage } from './lib/source-lineage-writer.mjs';

const { Client } = pg;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDir, '../../../.env');
const hhSource = 'hh';

loadEnvFile(rootEnvPath);

if (typeof fetch !== 'function') {
  console.error('Built-in fetch is unavailable. Use Node.js 18+ to run this script.');
  process.exit(1);
}

const hhUserAgent = process.env.HH_USER_AGENT?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!hhUserAgent) {
  console.error(
    'HH_USER_AGENT is not set. Add it to your environment or .env file, then run `npm run hh:ingest` again.',
  );
  process.exit(1);
}

if (!databaseUrl) {
  console.error(
    'DATABASE_URL is not set. Add it to your environment or .env file, then run `npm run hh:ingest` again.',
  );
  process.exit(1);
}

try {
  const searchConfig = resolveHhVacancySearchConfig();
  const hhFetch = await fetchVacancies(hhUserAgent, searchConfig);
  const vacancies = hhFetch.items;
  const normalizedVacancyResult = normalizeVacancies(vacancies);
  const normalizedVacancies = normalizedVacancyResult.records;
  const stats =
    normalizedVacancies.length === 0
      ? {
          hhVacancyUpsertCount: 0,
          signalUpsertCount: 0,
          evidenceUpsertCount: 0,
          evidenceCreatedCount: 0,
          lineageCreatedCount: 0,
          skippedSignalCount: 0,
        }
      : await upsertVacancies(databaseUrl, normalizedVacancies);

  console.log(`hh search text: ${searchConfig.searchText}`);
  console.log(`hh pages fetched: ${hhFetch.pagesFetched}`);
  console.log(`vacancies received: ${vacancies.length}`);
  console.log(`duplicate vacancies skipped before upsert: ${normalizedVacancyResult.duplicateRecords}`);
  console.log(`hh vacancy upserts completed: ${stats.hhVacancyUpsertCount}`);
  console.log(`normalized signal upserts completed: ${stats.signalUpsertCount}`);

  // JSON metrics for programmatic parsing by source-ingest.ts
  console.log(JSON.stringify({
    source: 'hh',
    action: 'pipeline',
    recordsReceived: vacancies.length,
    parsedRecords: vacancies.length,
    recordsAfterDedupe: normalizedVacancies.length,
    duplicateRecords: normalizedVacancyResult.duplicateRecords,
    normalizedRecords: normalizedVacancies.length,
    skippedRecords: normalizedVacancyResult.duplicateRecords + (stats.skippedSignalCount || 0),
    signalUpsertsCompleted: stats.signalUpsertCount,
    evidenceUpsertsCompleted: stats.evidenceUpsertCount,
    evidenceCreated: stats.evidenceCreatedCount,
    lineageCreated: stats.lineageCreatedCount,
  }));

  if (stats.skippedSignalCount > 0) {
    console.log(`vacancies skipped for normalized layer: ${stats.skippedSignalCount}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const causeMessage =
    error instanceof Error && error.cause instanceof Error ? error.cause.message : '';

  console.error(`HH ingestion failed: ${message}`);

  if (causeMessage) {
    console.error(`cause: ${causeMessage}`);
  }

  process.exitCode = 1;
}

async function fetchVacancies(userAgent, config) {
  return fetchHhVacancyPages({
    userAgent,
    config,
  });
}

function normalizeVacancies(vacancies) {
  const fetchedAt = new Date().toISOString();
  const normalizedVacancies = [];

  for (const vacancy of vacancies) {
    const normalizedVacancy = normalizeVacancy(vacancy, fetchedAt);

    if (normalizedVacancy) {
      normalizedVacancies.push(normalizedVacancy);
    }
  }

  const dedupeResult = dedupeNormalizedRecords(normalizedVacancies, (vacancy) => vacancy.hhVacancyId);

  return {
    records: dedupeResult.records,
    duplicateRecords: dedupeResult.duplicateRecords,
  };
}

function normalizeVacancy(vacancy, fetchedAt) {
  if (!vacancy || typeof vacancy !== 'object') {
    return null;
  }

  const hhVacancyId = toNonEmptyText(vacancy.id);
  const vacancyName = toNonEmptyText(vacancy.name);

  if (!hhVacancyId || !vacancyName) {
    return null;
  }

  const hhEmployerId = toNonEmptyText(vacancy.employer?.id);
  const employerName = toNonEmptyText(vacancy.employer?.name);
  const employerIdSourceKey = buildEmployerIdSourceKey(hhEmployerId);
  const employerNameSourceKey = buildEmployerNameSourceKey(employerName);
  const orgSourceKey = buildOrgSourceKey(hhEmployerId, employerName);
  const russianLegalNameSourceKey = orgSourceKey !== employerNameSourceKey
    ? buildRussianLegalNameSourceKey(employerName)
    : null;

  // Only use employer.site_url — the employer's self-declared corporate website.
  // Do NOT fall back to employer.url / alternate_url as those are HH platform pages
  // (e.g. https://hh.ru/employer/12345), not actual company websites.
  const employerSiteUrl = toUrlOrNull(vacancy.employer?.site_url);
  // Derive the bare domain from the same self-declared corporate website.
  // orgs.domain is a first-class column (unique on LOWER(domain)); without
  // this, HH ingest leaves it NULL and downstream readers fall back to
  // re-deriving from website_url on every read.
  const employerDomain = extractDomain(employerSiteUrl);

  return {
    hhVacancyId,
    hhEmployerId,
    employerName,
    employerSiteUrl,
    employerDomain,
    orgName: employerName ?? buildFallbackEmployerName(hhEmployerId),
    orgDisplayName: employerName,
    orgSourceKey,
    orgSourceAliasKey: employerIdSourceKey && employerNameSourceKey && employerIdSourceKey !== employerNameSourceKey
      ? employerNameSourceKey
      : null,
    orgSourceAliasKeys: [employerNameSourceKey].filter(
      (sourceKey, index, sourceKeys) => Boolean(sourceKey) && sourceKey !== orgSourceKey && sourceKeys.indexOf(sourceKey) === index,
    ),
    orgSourceWeakAliasKeys: [russianLegalNameSourceKey].filter(Boolean),
    vacancyName,
    areaName: toNonEmptyText(vacancy.area?.name),
    publishedAt: toTimestampOrNull(vacancy.published_at),
    alternateUrl: toNonEmptyText(vacancy.alternate_url),
    payload: vacancy,
    fetchedAt,
  };
}

async function upsertVacancies(connectionString, vacancies) {
  const client = new Client({
    connectionString,
  });

  const hhVacancyUpsertQuery = `
    INSERT INTO hh_vacancies (
      hh_vacancy_id,
      hh_employer_id,
      employer_name,
      vacancy_name,
      area_name,
      published_at,
      alternate_url,
      payload,
      fetched_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (hh_vacancy_id) DO UPDATE
    SET
      hh_employer_id = EXCLUDED.hh_employer_id,
      employer_name = EXCLUDED.employer_name,
      vacancy_name = EXCLUDED.vacancy_name,
      area_name = EXCLUDED.area_name,
      published_at = EXCLUDED.published_at,
      alternate_url = EXCLUDED.alternate_url,
      payload = EXCLUDED.payload,
      fetched_at = EXCLUDED.fetched_at
  `;

  let hhVacancyUpsertCount = 0;
  let signalUpsertCount = 0;
  let evidenceUpsertCount = 0;
  let evidenceCreatedCount = 0;
  let lineageCreatedCount = 0;
  let skippedSignalCount = 0;

  await client.connect();

  try {
    await client.query('BEGIN');

    for (const vacancy of vacancies) {
      const hhVacancyResult = await client.query(hhVacancyUpsertQuery, [
        vacancy.hhVacancyId,
        vacancy.hhEmployerId,
        vacancy.employerName,
        vacancy.vacancyName,
        vacancy.areaName,
        vacancy.publishedAt,
        vacancy.alternateUrl,
        vacancy.payload,
        vacancy.fetchedAt,
      ]);

      hhVacancyUpsertCount += hhVacancyResult.rowCount ?? 0;

      if (!vacancy.orgSourceKey || !vacancy.orgName) {
        skippedSignalCount += 1;
        continue;
      }

      const org = await upsertOrgSourceRef(client, vacancy);
      const lineage = await upsertSignalEvidenceLineage(client, {
        orgId: org.orgId,
        signalType: 'job_posting',
        source: hhSource,
        sourceFamily: 'job-board',
        externalId: vacancy.hhVacancyId,
        headline: vacancy.vacancyName,
        summary: buildSignalSummary(vacancy),
        sourceUrl: vacancy.alternateUrl,
        publishedAt: vacancy.publishedAt ?? vacancy.fetchedAt,
        normalizedAt: vacancy.fetchedAt,
        payload: buildSignalPayload(vacancy),
        sourceRecordType: 'job_posting',
        evidenceTier: 'corroboration',
        extractionMethod: 'hh-api',
        organizationResolutionReason: org.resolutionReason,
      });

      signalUpsertCount += lineage.signalUpsertCount;
      evidenceUpsertCount += lineage.evidenceUpsertCount;
      evidenceCreatedCount += lineage.evidenceCreatedCount;
      lineageCreatedCount += lineage.lineageCreatedCount;
    }

    await client.query('COMMIT');

    return {
      hhVacancyUpsertCount,
      signalUpsertCount,
      evidenceUpsertCount,
      evidenceCreatedCount,
      lineageCreatedCount,
      skippedSignalCount,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

async function upsertOrgSourceRef(client, vacancy) {
  const sourceKeys = buildOrgSourceKeys(vacancy);
  const resolution = await resolveOrganizationOwner(client, hhSource, {
    orgSourceKeys: sourceKeys,
    companyDomain: vacancy.employerDomain,
  });
  let orgId = resolution.orgId;

  if (!orgId) {
    // Insert with NULL domain first; domain is set afterwards via the
    // savepoint-protected setOrgDomain() so a unique-index conflict on
    // LOWER(domain) can never abort this batch transaction.
    const insertedOrgResult = await client.query(
      `
        INSERT INTO orgs (name, website_url)
        VALUES ($1, $2)
        RETURNING id
      `,
      [vacancy.orgName, vacancy.employerSiteUrl || null],
    );

    orgId = insertedOrgResult.rows[0].id;
  }

  await upsertOrgSourceKeys(client, orgId, vacancy);
  await updateOrgSourceRef(client, orgId, vacancy);
  await setOrgDomain(client, orgId, vacancy);

  return { orgId, resolutionReason: resolution.resolutionReason };
}

// Best-effort domain enrichment. orgs has a UNIQUE index on LOWER(domain), so a
// concurrent ingest (different connection) can claim the same domain between our
// NOT EXISTS check and this UPDATE. Domain is non-critical — the read side falls
// back to website_url — so we wrap the write in a SAVEPOINT and swallow a unique
// violation (SQLSTATE 23505), leaving domain NULL rather than rolling back the
// whole batch.
async function setOrgDomain(client, orgId, vacancy) {
  const domain = vacancy.employerDomain || null;
  if (!domain) return;

  await client.query('SAVEPOINT set_org_domain');
  try {
    await client.query(
      `
        UPDATE orgs
        SET domain = $2
        WHERE id = $1
          AND (domain IS NULL OR BTRIM(domain) = '')
          AND NOT EXISTS (
            SELECT 1 FROM orgs other
            WHERE other.id <> orgs.id AND LOWER(other.domain) = LOWER($2)
          )
      `,
      [orgId, domain],
    );
    await client.query('RELEASE SAVEPOINT set_org_domain');
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT set_org_domain');
    await client.query('RELEASE SAVEPOINT set_org_domain');
    if (error?.code !== '23505') throw error;
    // Unique-index race lost — another org already owns this domain. Leave NULL.
  }
}

async function updateOrgSourceRef(client, orgId, vacancy) {
  // Single UPDATE for both name and website_url — avoids double round-trip per vacancy
  await client.query(
    `
      UPDATE orgs
      SET
        name = CASE
          WHEN $2 IS NOT NULL AND BTRIM($2) <> '' AND (name IS NULL OR BTRIM(name) = '' OR name = $3)
            THEN $2
          ELSE name
        END,
        website_url = CASE
          WHEN $4 IS NOT NULL AND BTRIM($4) <> '' AND (website_url IS NULL OR BTRIM(website_url) = '')
            THEN $4
          ELSE website_url
        END
      WHERE id = $1
    `,
    [
      orgId,
      vacancy.orgDisplayName,
      buildFallbackEmployerName(vacancy.hhEmployerId),
      vacancy.employerSiteUrl || null,
    ],
  );

  await client.query(
    `
      UPDATE org_source_refs
      SET
        display_name = CASE
          WHEN $4 IS NULL OR BTRIM($4) = '' THEN display_name
          WHEN display_name IS NULL OR BTRIM(display_name) = '' THEN $4
          ELSE display_name
        END
      WHERE org_id = $1
        AND source = $2
        AND source_key = ANY($3)
    `,
    [orgId, hhSource, buildOrgSourceKeys(vacancy), vacancy.orgDisplayName],
  );
}

async function upsertOrgSourceKeys(client, orgId, vacancy) {
  const sourceRefs = buildOrgSourceKeys(vacancy).map((sourceKey) => ({
    sourceKey,
    externalId: sourceKey === vacancy.orgSourceKey ? vacancy.hhEmployerId : null,
    displayName: vacancy.orgDisplayName,
  }));

  for (const sourceRef of sourceRefs) {
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
        hhSource,
        sourceRef.sourceKey,
        sourceRef.externalId,
        sourceRef.displayName,
        buildOrgSourceMetadata(vacancy, sourceRef.sourceKey, sourceRef.externalId),
      ],
    );
    await assertOrgSourceRefOwner(client, hhSource, sourceRef.sourceKey, orgId);
  }
}

function buildOrgSourceMetadata(vacancy, sourceKey = vacancy.orgSourceKey, externalId = vacancy.hhEmployerId) {
  return {
    source: hhSource,
    source_key: sourceKey,
    source_alias_key: sourceKey === vacancy.orgSourceKey ? vacancy.orgSourceAliasKey : vacancy.orgSourceKey,
    source_alias_keys: buildSourceKeyAliases(buildOrgSourceKeys(vacancy), vacancy.orgSourceWeakAliasKeys, sourceKey),
    external_id: externalId,
    display_name: vacancy.orgDisplayName,
    employer_name: vacancy.employerName,
    org_name: vacancy.orgName,
  };
}

function buildSignalPayload(vacancy) {
  return {
    source: hhSource,
    source_entity_type: 'employer',
    source_entity_key: vacancy.orgSourceKey,
    source_entity_alias_key: vacancy.orgSourceAliasKey,
    source_entity_alias_keys: buildSourceKeyAliases(buildOrgSourceKeys(vacancy), vacancy.orgSourceWeakAliasKeys, vacancy.orgSourceKey),
    source_entity_external_id: vacancy.hhEmployerId,
    source_entity_display_name: vacancy.employerName,
    source_entity_name: vacancy.orgName,
    source_record_type: 'job_posting',
    source_record_id: vacancy.hhVacancyId,
    source_record_title: vacancy.vacancyName,
    source_record_url: vacancy.alternateUrl,
    source_record_published_at: vacancy.publishedAt,
    org_source_key: vacancy.orgSourceKey,
    hh_vacancy_id: vacancy.hhVacancyId,
    hh_employer_id: vacancy.hhEmployerId,
    employer_name: vacancy.employerName,
    vacancy_name: vacancy.vacancyName,
    area_name: vacancy.areaName,
    published_at: vacancy.publishedAt,
    alternate_url: vacancy.alternateUrl,
    fetched_at: vacancy.fetchedAt,
  };
}

function buildSignalSummary(vacancy) {
  const fragments = [];

  if (vacancy.employerName) {
    fragments.push(vacancy.employerName);
  }

  if (vacancy.areaName) {
    fragments.push(`регион: ${vacancy.areaName}`);
  }

  if (fragments.length === 0) {
    return 'Новая вакансия из hh.ru';
  }

  return `Вакансия hh.ru (${fragments.join(', ')})`;
}

function buildOrgSourceKey(hhEmployerId, employerName) {
  return buildEmployerIdSourceKey(hhEmployerId) ?? buildEmployerNameSourceKey(employerName);
}

function buildEmployerIdSourceKey(hhEmployerId) {
  return hhEmployerId ? `employer:${hhEmployerId}` : null;
}

function buildEmployerNameSourceKey(employerName) {
  const normalizedEmployerName = normalizeSourceKeyText(employerName);
  return normalizedEmployerName ? `employer-name:${normalizedEmployerName}` : null;
}

function buildOrgSourceKeys(vacancy) {
  const domainSourceKey = vacancy.employerDomain ? `domain:${vacancy.employerDomain}` : null;
  return [vacancy.orgSourceKey, domainSourceKey, ...(vacancy.orgSourceAliasKeys ?? [])].filter(
    (sourceKey, index, sourceKeys) => Boolean(sourceKey) && sourceKeys.indexOf(sourceKey) === index,
  );
}

function normalizeSourceKeyText(value) {
  if (!value) {
    return null;
  }

  const normalizedValue = value.trim().replace(/\s+/g, ' ').toLowerCase();
  return normalizedValue === '' ? null : normalizedValue;
}

function buildFallbackEmployerName(hhEmployerId) {
  return hhEmployerId ? `Работодатель HH ${hhEmployerId}` : null;
}

function loadEnvFile(filePath) {
  if (process.env.SOURCE_ENV_FILE_DISABLED === 'true') {
    return;
  }

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
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function toNonEmptyText(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.trim();
  return normalizedValue === '' ? null : normalizedValue;
}

function toTimestampOrNull(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}
