import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

import {
  buildRussianLegalNameSourceKey,
  buildSourceKeyAliases,
  dedupeNormalizedRecords,
  stripBom,
} from './adapters/source-records.mjs';
import { assertOrgSourceRefOwner, isOrganizationIdentityConflict, resolveOrganizationOwner } from './adapters/organization-resolution.mjs';
import {
  extractCompanyOwnedSourceLinks,
  persistCompanyOwnedSourceLinks,
} from './adapters/company-owned-source-discovery.mjs';
import { loadEnvFile, normalizeDomain } from './lib/common-utils.mjs';
import { upsertSignalEvidenceLineage } from './lib/source-lineage-writer.mjs';

const { Client } = pg;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDir, '../../../.env');
const SOURCE_ID = 'company-site';
const SIGNAL_TYPE = 'other';
const SUPPORTED_ACTIONS = new Set(['fetch', 'ingest', 'pipeline']);


export async function runCompanySiteCli(argv = process.argv.slice(2)) {
  const requestedAction = argv[0]?.trim() || 'pipeline';
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!SUPPORTED_ACTIONS.has(requestedAction)) {
    console.error(
      'Usage: node packages/db/scripts/source-company-site.mjs <fetch|ingest|pipeline>\n'
        + 'Input: set COMPANY_SITE_INPUT_FILE to a JSON array or { records: [...] } file.',
    );
    process.exit(1);
  }

  try {
    let input = resolveCompanySiteInput();

    if (input.inputMode === 'live-pending') {
      input = await resolveCompanySiteLiveInput(input);
    }

    if (requestedAction === 'fetch') {
      console.log(JSON.stringify(buildFetchSummary(input), null, 2));
      return;
    }

    if (!databaseUrl) {
      console.error(
        'DATABASE_URL is not set. Add it to your environment or .env file before running company-site ingest or pipeline.',
      );
      process.exit(1);
    }

    const stats = await ingestCompanySite({
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
    console.error(`company-site ${requestedAction} failed: ${message}`);
    process.exit(1);
  }
}

export function resolveCompanySiteInput() {
  const inputFilePath = process.env.COMPANY_SITE_INPUT_FILE?.trim();

  if (inputFilePath) {
    return resolveFileInput(inputFilePath);
  }

  const targetsFilePath = process.env.COMPANY_SITE_TARGETS_FILE?.trim();

  if (targetsFilePath) {
    return { inputMode: 'live-pending', targetsFilePath };
  }

  throw new Error(
    'No input configured for company-site.\n'
      + 'Set COMPANY_SITE_INPUT_FILE for file mode, or\n'
      + 'set COMPANY_SITE_TARGETS_FILE (JSON array of {url, company_name?, company_domain?}) for live crawl mode.',
  );
}

export async function resolveCompanySiteLiveInput({ targetsFilePath }, { dependencies = {} } = {}) {
  const { fetchCompanyPages } = await import('./adapters/company-site-crawl.mjs');
  const resolvedPath = resolve(process.cwd(), targetsFilePath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`COMPANY_SITE_TARGETS_FILE does not exist: ${resolvedPath}`);
  }

  const rawContent = stripBom(readFileSync(resolvedPath, 'utf8'));
  const targets = JSON.parse(rawContent);

  if (!Array.isArray(targets)) {
    throw new Error('COMPANY_SITE_TARGETS_FILE must contain a JSON array of targets.');
  }

  if (targets.length === 0) {
    return {
      inputMode: 'live-public',
      inputFilePath: null,
      targetsFilePath: resolvedPath,
      recordsReceived: 0,
      crawlSuccesses: 0,
      crawlErrors: 0,
      duplicateRecords: 0,
      normalizedRecords: [],
      skippedRecords: 0,
      zeroReason: 'no-eligible-company-targets',
    };
  }

  const crawlResults = await fetchCompanyPages(targets, { dependencies });
  const crawlErrors = crawlResults.filter((r) => r.error).length;
  const records = crawlResults
    .filter((r) => r.record !== null)
    .map((r) => r.record);
  const crawlSuccesses = records.length;

  if (crawlSuccesses === 0) {
    const errorSamples = crawlResults
      .filter((r) => r.error)
      .slice(0, 3)
      .map((r) => `${r.url ?? '<unknown>'}: ${r.error}`)
      .join('; ');

    throw new Error(
      `company-site live crawl produced 0 usable pages from ${targets.length} targets`
        + ` (${crawlErrors} errors)`
        + (errorSamples ? `: ${errorSamples}` : ''),
    );
  }

  const fetchedAt = new Date().toISOString();
  const normalizedRecords = [];
  let skippedRecords = 0;

  for (const [index, record] of records.entries()) {
    const normalized = normalizeCompanySiteRecord(record, fetchedAt, index + 1);

    if (!normalized) {
      skippedRecords += 1;
      continue;
    }

    normalizedRecords.push(normalized);
  }

  const dedupeResult = dedupeNormalizedRecords(normalizedRecords);

  if (dedupeResult.records.length === 0) {
    throw new Error(
      `company-site live crawl normalized 0 records from ${crawlSuccesses} crawled pages.`,
    );
  }

  return {
    inputMode: 'live-public',
    inputFilePath: null,
    targetsFilePath: resolvedPath,
    recordsReceived: targets.length,
    crawlSuccesses,
    crawlErrors,
    duplicateRecords: dedupeResult.duplicateRecords,
    normalizedRecords: dedupeResult.records,
    skippedRecords,
    zeroReason: null,
  };
}

function resolveFileInput(inputFilePath) {
  const resolvedPath = resolve(process.cwd(), inputFilePath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`COMPANY_SITE_INPUT_FILE does not exist: ${resolvedPath}`);
  }

  const rawContent = stripBom(readFileSync(resolvedPath, 'utf8'));
  const records = parseInputRecords(rawContent, resolvedPath);
  const fetchedAt = new Date().toISOString();
  const normalizedRecords = [];
  let skippedRecords = 0;

  for (const [index, record] of records.entries()) {
    const normalized = normalizeCompanySiteRecord(record, fetchedAt, index + 1);

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
    'COMPANY_SITE_INPUT_FILE must contain a JSON array or a {"records": [...]} object.',
  );
}

function normalizeCompanySiteRecord(record, fetchedAt, lineNumber) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return null;
  }

  const companyName = toNonEmptyText(record.company_name ?? record.org_name);
  const companyDomain = normalizeDomain(record.company_domain ?? record.domain);
  const companyWebsiteUrl = toUrlOrNull(record.company_website_url ?? record.website_url);
  const pageUrl = toUrlOrNull(record.page_url ?? record.url);
  const pageTitle = toNonEmptyText(record.page_title ?? record.title);
  const summary = toNonEmptyText(record.summary ?? record.description);
  const signals = Array.isArray(record.signals) ? record.signals : parseKeywords(record.keywords);
  const contactPaths = normalizeContactPaths(record.contact_paths ?? record.contactPaths);
  const rawOwnedSourceLinks = record.owned_source_links ?? record.ownedSourceLinks;
  const ownedSourceLinks = extractCompanyOwnedSourceLinks(
    Array.isArray(rawOwnedSourceLinks)
      ? rawOwnedSourceLinks.map((value) => value?.providerUrl ?? value?.provider_url ?? value)
      : [],
    pageUrl,
  );
  const detectedAt = toTimestampOrNull(record.detected_at ?? record.occurred_at) ?? fetchedAt;
  const externalId = toNonEmptyText(record.external_id ?? record.id);
  const inferredDomain = companyDomain
    ?? extractHostname(companyWebsiteUrl)
    ?? extractHostname(pageUrl);

  if (!companyName && !inferredDomain) {
    return null;
  }

  const orgName = companyName ?? inferredDomain ?? `Company Site Org ${lineNumber}`;
  const primarySourceKey = buildPrimarySourceKey({ externalId, inferredDomain, companyName });
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

  const signalExternalId = buildSignalExternalId({ externalId, pageUrl, primarySourceKey, lineNumber });

  return {
    lineNumber,
    fetchedAt,
    detectedAt,
    externalId,
    companyName,
    companyDomain: inferredDomain,
    companyWebsiteUrl,
    pageUrl,
    pageTitle,
    summary,
    signals,
    contactPaths,
    ownedSourceLinks,
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

function buildPrimarySourceKey({ externalId, inferredDomain, companyName }) {
  if (externalId) {
    return `ext:${externalId}`;
  }

  if (inferredDomain) {
    return `domain:${inferredDomain}`;
  }

  if (companyName) {
    return `company-name:${normalizeSourceKeyText(companyName)}`;
  }

  return null;
}

function buildSignalExternalId({ externalId, pageUrl, primarySourceKey, lineNumber }) {
  if (externalId) {
    return externalId;
  }

  if (pageUrl) {
    return `page-url:${pageUrl}`;
  }

  return `derived:${primarySourceKey}:${lineNumber}`;
}

async function ingestCompanySite({ connectionString, input }) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: resolveDbConnectionTimeoutMillis(),
  });

  let orgUpsertCount = 0;
  let signalUpsertCount = 0;
  let evidenceUpsertCount = 0;
  let evidenceCreatedCount = 0;
  let lineageCreatedCount = 0;
  let discoveredSourceRefCount = 0;
  let organizationResolutionRejects = 0;

  await client.connect();

  try {
    await client.query('BEGIN');

    for (const record of input.normalizedRecords) {
      let orgResult;
      try {
        orgResult = await upsertOrgSourceRef(client, record);
      } catch (error) {
        if (!isOrganizationIdentityConflict(error)) throw error;
        organizationResolutionRejects += 1;
        continue;
      }
      orgUpsertCount += orgResult.insertedOrg ? 1 : 0;
      discoveredSourceRefCount += await persistCompanyOwnedSourceLinks(client, {
        orgId: orgResult.orgId,
        companyName: record.orgDisplayName,
        companyDomain: record.companyDomain,
        companyWebsiteUrl: record.companyWebsiteUrl,
        links: record.ownedSourceLinks,
        observedAt: record.fetchedAt,
      });

      const lineage = await upsertSignalEvidenceLineage(client, {
        orgId: orgResult.orgId,
        signalType: SIGNAL_TYPE,
        source: SOURCE_ID,
        sourceFamily: 'company-owned-site',
        externalId: record.signalExternalId,
        headline: record.pageTitle ?? buildSignalHeadline(record),
        summary: record.summary ?? buildSignalSummaryText(record),
        sourceUrl: record.pageUrl,
        publishedAt: record.detectedAt,
        normalizedAt: record.fetchedAt,
        payload: buildSignalPayload(record),
        sourceRecordType: 'company-page',
        evidenceTier: 'context',
        extractionMethod: input.inputMode,
        organizationResolutionReason: orgResult.resolutionReason,
      });

      signalUpsertCount += lineage.signalUpsertCount;
      evidenceUpsertCount += lineage.evidenceUpsertCount;
      evidenceCreatedCount += lineage.evidenceCreatedCount;
      lineageCreatedCount += lineage.lineageCreatedCount;
    }

    if (input.normalizedRecords.length > 0
      && organizationResolutionRejects === input.normalizedRecords.length) {
      throw new Error('organization identity conflict: company-site rejected every normalized record at the identity gate.');
    }

    await client.query('COMMIT');

    return {
      orgUpsertCount,
      signalUpsertCount,
      evidenceUpsertCount,
      evidenceCreatedCount,
      lineageCreatedCount,
      discoveredSourceRefCount,
      organizationResolutionRejects,
    };
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
        sourceKey === record.primarySourceKey ? record.externalId : null,
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
    ...buildLiveCrawlSummary(input),
    recordsReceived: input.recordsReceived,
    duplicateRecords: input.duplicateRecords,
    normalizedRecords: input.normalizedRecords.length,
    skippedRecords: input.skippedRecords,
    zeroReason: input.zeroReason ?? undefined,
  };
}

function buildIngestSummary(input, stats) {
  return {
    source: SOURCE_ID,
    action: 'ingest',
    inputMode: input.inputMode,
    inputFilePath: input.inputFilePath,
    ...buildLiveCrawlSummary(input),
    recordsReceived: input.recordsReceived,
    duplicateRecords: input.duplicateRecords,
    normalizedRecords: input.normalizedRecords.length,
    skippedRecords: input.skippedRecords,
    orgsCreated: stats.orgUpsertCount,
    signalUpsertsCompleted: stats.signalUpsertCount,
    evidenceUpsertsCompleted: stats.evidenceUpsertCount,
    evidenceCreated: stats.evidenceCreatedCount,
    lineageCreated: stats.lineageCreatedCount,
    discoveredSourceRefs: stats.discoveredSourceRefCount,
    organizationResolutionRejects: stats.organizationResolutionRejects,
    zeroReason: input.zeroReason ?? undefined,
  };
}

function buildPipelineSummary(input, stats) {
  return {
    source: SOURCE_ID,
    action: 'pipeline',
    inputMode: input.inputMode,
    inputFilePath: input.inputFilePath,
    ...buildLiveCrawlSummary(input),
    recordsReceived: input.recordsReceived,
    duplicateRecords: input.duplicateRecords,
    normalizedRecords: input.normalizedRecords.length,
    skippedRecords: input.skippedRecords,
    orgsCreated: stats.orgUpsertCount,
    signalUpsertsCompleted: stats.signalUpsertCount,
    evidenceUpsertsCompleted: stats.evidenceUpsertCount,
    evidenceCreated: stats.evidenceCreatedCount,
    lineageCreated: stats.lineageCreatedCount,
    discoveredSourceRefs: stats.discoveredSourceRefCount,
    organizationResolutionRejects: stats.organizationResolutionRejects,
    zeroReason: input.zeroReason ?? undefined,
  };
}

function buildLiveCrawlSummary(input) {
  if (input.inputMode !== 'live-public') {
    return {};
  }

  return {
    targetsFilePath: input.targetsFilePath,
    crawlSuccesses: input.crawlSuccesses,
    crawlErrors: input.crawlErrors,
  };
}

function buildSignalHeadline(record) {
  if (record.pageTitle) {
    return record.pageTitle;
  }

  const fragments = [record.orgName ?? 'Company'];

  if (record.signals.length > 0) {
    fragments.push(`— ${record.signals.slice(0, 3).join(', ')}`);
  }

  return fragments.join(' ');
}

function buildSignalSummaryText(record) {
  const fragments = [];

  if (record.companyName) {
    fragments.push(record.companyName);
  }

  if (record.pageUrl) {
    fragments.push(`страница: ${record.pageUrl}`);
  }

  if (record.signals.length > 0) {
    fragments.push(`сигналы: ${record.signals.join(', ')}`);
  }

  return fragments.length > 0
    ? `Контекст с сайта компании (${fragments.join('; ')})`
    : 'Контекст с сайта компании';
}

function buildSignalPayload(record) {
  return {
    source: SOURCE_ID,
    evidence_role: 'enrichment',
    source_entity_type: 'company',
    source_entity_key: record.primarySourceKey,
    source_entity_alias_keys: buildSourceKeyAliases(record.orgSourceKeys, record.orgSourceAliasKeys, record.primarySourceKey),
    source_entity_external_id: record.externalId,
    source_entity_display_name: record.orgDisplayName,
    source_entity_name: record.orgName,
    source_record_type: 'company_surface_page',
    source_record_id: record.signalExternalId,
    source_record_title: record.pageTitle,
    source_record_url: record.pageUrl,
    source_record_published_at: record.detectedAt,
    org_source_key: record.primarySourceKey,
    company_name: record.companyName,
    company_domain: record.companyDomain,
    company_website_url: record.companyWebsiteUrl,
    page_url: record.pageUrl,
    page_title: record.pageTitle,
    summary: record.summary,
    signals: record.signals,
    contact_paths: record.contactPaths,
    owned_source_links: record.ownedSourceLinks,
    fetched_at: record.fetchedAt,
  };
}

function buildOrgSourceMetadata(record, sourceKey) {
  return {
    source: SOURCE_ID,
    source_key: sourceKey,
    source_alias_keys: buildSourceKeyAliases(record.orgSourceKeys, record.orgSourceAliasKeys, sourceKey),
    external_id: sourceKey === record.primarySourceKey ? record.externalId : null,
    display_name: record.orgDisplayName,
    company_name: record.companyName,
    company_domain: record.companyDomain,
    company_website_url: record.companyWebsiteUrl,
  };
}

function parseKeywords(value) {
  if (typeof value === 'string') {
    return value.split(',').map((s) => s.trim()).filter(Boolean);
  }

  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }

  return [];
}

function normalizeContactPaths(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const contactPaths = [];
  const seen = new Set();

  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }

    const email = normalizeContactEmail(item.value ?? item.email);

    if ((item.type === 'generic_email' || email) && isSafeGenericContactEmail(email)) {
      pushContactPath(contactPaths, seen, {
        type: 'generic_email',
        value: email,
        source: toNonEmptyText(item.source) ?? 'source',
      });
      continue;
    }

    const url = toUrlOrNull(item.url ?? item.value ?? item.href);

    if (url && (item.type === 'contact_page' || isContactPageUrl(url))) {
      pushContactPath(contactPaths, seen, {
        type: 'contact_page',
        url,
        source: toNonEmptyText(item.source) ?? 'source',
      });
    }
  }

  return contactPaths;
}

function pushContactPath(contactPaths, seen, contactPath) {
  const key = contactPath.type === 'generic_email'
    ? `${contactPath.type}:${contactPath.value}`
    : `${contactPath.type}:${contactPath.url}`;

  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  contactPaths.push(contactPath);
}

function normalizeContactEmail(value) {
  const text = toNonEmptyText(value);

  if (!text) {
    return null;
  }

  const email = trimEmailBoundaryChars(text.split('?')[0].trim().toLowerCase());
  const parts = email.split('@');

  if (parts.length !== 2 || !parts[0] || !parts[1] || !parts[1].includes('.')) {
    return null;
  }

  if (email.includes(' ') || email.includes('/') || email.includes('\\')) {
    return null;
  }

  return email;
}

function trimEmailBoundaryChars(value) {
  let text = value;

  while (text.length > 0 && EMAIL_BOUNDARY_CHARS.has(text.charAt(text.length - 1))) {
    text = text.slice(0, -1);
  }

  return text;
}

function isSafeGenericContactEmail(email) {
  if (!email) {
    return false;
  }

  const localPart = email.split('@')[0].replace(/[._+]+/g, '-');

  if (GENERIC_CONTACT_EMAIL_LOCAL_PARTS.has(localPart)) {
    return true;
  }

  const parts = localPart.split('-').filter(Boolean);
  return parts.length === 2
    && GENERIC_CONTACT_EMAIL_LOCAL_PARTS.has(parts[0])
    && GENERIC_CONTACT_EMAIL_SUFFIXES.has(parts[1]);
}

function isContactPageUrl(value) {
  try {
    const url = new URL(value);
    const searchablePath = `${url.pathname} ${url.search}`.toLowerCase();
    return CONTACT_PAGE_PATH_KEYWORDS.some((keyword) => searchablePath.includes(keyword));
  } catch {
    return false;
  }
}

const GENERIC_CONTACT_EMAIL_LOCAL_PARTS = new Set([
  'career',
  'careers',
  'contact',
  'hello',
  'hr',
  'info',
  'job',
  'jobs',
  'kadry',
  'office',
  'people',
  'rabota',
  'recruiting',
  'recruitment',
  'talent',
  'vacancy',
  'vacancies',
  'work',
]);

const EMAIL_BOUNDARY_CHARS = new Set(['.', ',', ';', ':', ')', ']', '}']);

const GENERIC_CONTACT_EMAIL_SUFFIXES = new Set([
  'career',
  'careers',
  'contact',
  'department',
  'group',
  'jobs',
  'office',
  'recruiting',
  'recruitment',
  'team',
  'vacancy',
  'work',
]);

const CONTACT_PAGE_PATH_KEYWORDS = [
  'contact',
  'contacts',
  'feedback',
  'kontakty',
  'kontakt',
  'rekvizity',
  'requisites',
];

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
  await runCompanySiteCli();
}
