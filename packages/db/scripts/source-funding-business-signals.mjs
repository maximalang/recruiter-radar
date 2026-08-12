import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

import {
  assertProviderNormalization,
  extractProviderRecords,
} from './adapters/provider-contract.mjs';
import {
  buildRussianLegalNameSourceKey,
  buildSourceKeyAliases,
  dedupeNormalizedRecords,
  stripBom,
} from './adapters/source-records.mjs';
import { loadEnvFile, normalizeDomain } from './lib/common-utils.mjs';
import { fetchJson } from './adapters/source-http.mjs';
import { assertOrgSourceRefOwner, resolveOrganizationOwner } from './adapters/organization-resolution.mjs';
import { upsertSignalEvidenceLineage } from './lib/source-lineage-writer.mjs';

const { Client } = pg;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDir, '../../../.env');
const SOURCE_ID = 'funding-business-signals';
const SUPPORTED_ACTIONS = new Set(['fetch', 'ingest', 'pipeline']);


export async function runFundingBusinessSignalsCli(argv = process.argv.slice(2)) {
  const requestedAction = argv[0]?.trim() || 'pipeline';
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!SUPPORTED_ACTIONS.has(requestedAction)) {
    console.error(
      'Usage: node packages/db/scripts/source-funding-business-signals.mjs <fetch|ingest|pipeline>\n'
        + 'Input: set FUNDING_BUSINESS_SIGNALS_INPUT_FILE to a JSON array or { records: [...] } file.',
    );
    process.exit(1);
  }

  try {
    let input = resolveFundingInput();

    if (input.inputMode === 'provider-pending') {
      input = await resolveFundingProviderInput(input);
    } else if (input.inputMode === 'gdelt-pending') {
      input = await resolveFundingGdeltInput(input);
    }

    if (requestedAction === 'fetch') {
      console.log(JSON.stringify(buildFetchSummary(input), null, 2));
      return;
    }

    if (!databaseUrl) {
      console.error(
        'DATABASE_URL is not set. Add it to your environment or .env file before running funding-business-signals ingest or pipeline.',
      );
      process.exit(1);
    }

    const stats = await ingestFundingSignals({
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
    console.error(`funding-business-signals ${requestedAction} failed: ${message}`);
    process.exit(1);
  }
}

export function resolveFundingInput() {
  const inputFilePath = process.env.FUNDING_BUSINESS_SIGNALS_INPUT_FILE?.trim();

  if (inputFilePath) {
    return resolveFundingFileInput(inputFilePath);
  }

  const providerUrl = process.env.FUNDING_SIGNALS_PROVIDER_API_URL?.trim();
  const providerToken = process.env.FUNDING_SIGNALS_PROVIDER_API_TOKEN?.trim();

  if (providerUrl && providerToken) {
    return { inputMode: 'provider-pending', providerUrl, providerToken };
  }

  const gdeltQueries = parseGdeltQueries();

  if (gdeltQueries.length > 0) {
    return { inputMode: 'gdelt-pending', gdeltQueries };
  }

  if (process.env.FUNDING_SIGNALS_GDELT_QUERIES_JSON?.trim()) {
    return {
      inputMode: 'expected-zero',
      inputFilePath: null,
      recordsReceived: 0,
      duplicateRecords: 0,
      normalizedRecords: [],
      skippedRecords: 0,
      zeroReason: 'no-eligible-company-targets',
    };
  }

  throw new Error(
    'No input configured for funding-business-signals.\n'
      + 'Set FUNDING_BUSINESS_SIGNALS_INPUT_FILE for file mode, or\n'
      + 'set FUNDING_SIGNALS_PROVIDER_API_URL and FUNDING_SIGNALS_PROVIDER_API_TOKEN for provider mode, or\n'
      + 'set FUNDING_SIGNALS_GDELT_QUERIES for free GDELT live-public news context mode.',
  );
}

export async function resolveFundingProviderInput({ providerUrl, providerToken }) {
  let body;

  try {
    body = await fetchJson(providerUrl, {
      sourceName: 'funding-business-signals provider',
      headers: {
        authorization: `Bearer ${providerToken}`,
      },
    });
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n`
        + 'Verify FUNDING_SIGNALS_PROVIDER_API_URL and FUNDING_SIGNALS_PROVIDER_API_TOKEN are correct.',
      { cause: error },
    );
  }

  const records = extractProviderRecords(body, SOURCE_ID);
  const fetchedAt = new Date().toISOString();
  const normalizedRecords = [];
  let skippedRecords = 0;

  for (const [index, record] of records.entries()) {
    const normalized = normalizeFundingRecord(record, fetchedAt, index + 1);

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
    duplicateRecords: dedupeResult.duplicateRecords,
    normalizedRecords: dedupeResult.records,
    skippedRecords,
  };
}

export async function resolveFundingGdeltInput({ gdeltQueries }) {
  const records = [];
  let previousRequestStartedAt = 0;

  for (const queryConfig of gdeltQueries) {
    const waitMs = Math.max(0, resolveGdeltMinIntervalMs() - (Date.now() - previousRequestStartedAt));
    if (waitMs > 0) {
      await new Promise((resolveWait) => setTimeout(resolveWait, waitMs));
    }
    previousRequestStartedAt = Date.now();
    const gdeltRecords = await fetchGdeltRecords(queryConfig);
    records.push(...gdeltRecords);
  }

  const syndication = dedupeGdeltSyndicationRecords(records);
  const fetchedAt = new Date().toISOString();
  const normalizedRecords = [];
  let skippedRecords = 0;

  for (const [index, record] of syndication.records.entries()) {
    const normalized = normalizeFundingRecord(record, fetchedAt, index + 1);

    if (!normalized) {
      skippedRecords += 1;
      continue;
    }

    normalizedRecords.push(normalized);
  }

  const dedupeResult = dedupeNormalizedRecords(normalizedRecords);

  if (records.length > 0 && dedupeResult.records.length === 0) {
    throw new Error(
      `${SOURCE_ID} GDELT returned ${records.length} records but 0 normalized records`
        + ` (${skippedRecords} skipped). Check GDELT query mapping.`,
    );
  }

  return {
    inputMode: 'live-public',
    inputFilePath: null,
    liveProvider: 'gdelt-doc-api',
    queriesReceived: gdeltQueries.length,
    recordsReceived: records.length,
    duplicateRecords: syndication.duplicateRecords + dedupeResult.duplicateRecords,
    normalizedRecords: dedupeResult.records,
    skippedRecords,
  };
}

async function fetchGdeltRecords(queryConfig) {
  const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  url.searchParams.set('query', queryConfig.query);
  url.searchParams.set('mode', 'ArtList');
  url.searchParams.set('format', 'json');
  url.searchParams.set('maxrecords', String(queryConfig.maxRecords));
  url.searchParams.set('timespan', queryConfig.timespan);
  url.searchParams.set('sort', 'datedesc');

  const body = await fetchJson(url, {
    sourceName: 'funding-business-signals gdelt',
    nodeHttpFallback: true,
    preferNodeHttpFallback: process.env.FUNDING_SIGNALS_GDELT_TRANSPORT !== 'fetch',
    retries: 2,
    retryDelayMs: 6000,
    timeoutMs: resolveGdeltTimeoutMs(),
    headers: {
      'user-agent': 'RecruiterRadar/1.0 (funding-business-signals)',
    },
  });
  const articles = Array.isArray(body?.articles) ? body.articles : [];

  return articles.map((article, index) => mapGdeltArticle(article, queryConfig, index));
}

function mapGdeltArticle(article, queryConfig, index) {
  const title = toNonEmptyText(article?.title);
  const url = toUrlOrNull(article?.url);
  const domain = normalizeDomain(article?.domain) ?? extractHostname(url);
  const eventType = inferGdeltEventType(title);

  return {
    external_id: toNonEmptyText(article?.url) ?? `gdelt:${queryConfig.query}:${index + 1}`,
    company_name: queryConfig.companyName,
    company_domain: queryConfig.companyDomain,
    headline: title,
    summary: toNonEmptyText(article?.seendate)
      ? `GDELT news context, seen at ${article.seendate}`
      : 'GDELT news context',
    source_url: url,
    event_type: eventType,
    published_at: parseGdeltDate(article?.seendate),
    source: 'gdelt-doc-api',
    publisher_domain: domain,
    gdelt_query: queryConfig.query,
    syndication_fingerprint: buildGdeltSyndicationKey({
      company_domain: queryConfig.companyDomain,
      headline: title,
      published_at: parseGdeltDate(article?.seendate),
    }),
    raw: article,
  };
}

function resolveFundingFileInput(inputFilePath) {
  const resolvedPath = resolve(process.cwd(), inputFilePath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`FUNDING_BUSINESS_SIGNALS_INPUT_FILE does not exist: ${resolvedPath}`);
  }

  const rawContent = stripBom(readFileSync(resolvedPath, 'utf8'));
  const records = parseInputRecords(rawContent, resolvedPath);
  const fetchedAt = new Date().toISOString();
  const normalizedRecords = [];
  let skippedRecords = 0;

  for (const [index, record] of records.entries()) {
    const normalized = normalizeFundingRecord(record, fetchedAt, index + 1);

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

function parseGdeltQueries() {
  const rawJson = process.env.FUNDING_SIGNALS_GDELT_QUERIES_JSON?.trim();

  if (rawJson) {
    const parsed = parseJson(rawJson, 'FUNDING_SIGNALS_GDELT_QUERIES_JSON');
    const queries = Array.isArray(parsed) ? parsed : parsed?.queries;

    if (!Array.isArray(queries)) {
      throw new Error('FUNDING_SIGNALS_GDELT_QUERIES_JSON must be a JSON array or {"queries": [...]} object.');
    }

    return queries.map((query, index) => normalizeGdeltQuery(query, index + 1));
  }

  const rawQueries = process.env.FUNDING_SIGNALS_GDELT_QUERIES?.trim();

  if (!rawQueries) {
    return [];
  }

  return rawQueries
    .split(/\r?\n|;/)
    .map((query) => query.trim())
    .filter(Boolean)
    .map((query, index) => normalizeGdeltQuery(query, index + 1));
}

function normalizeGdeltQuery(value, lineNumber) {
  const query = typeof value === 'string'
    ? value
    : toNonEmptyText(value?.query);

  if (!query) {
    throw new Error(`GDELT query #${lineNumber} must have a non-empty query.`);
  }

  const maxRecords = clampInteger(
    typeof value === 'object' ? value?.max_records ?? value?.maxRecords : process.env.FUNDING_SIGNALS_GDELT_MAX_RECORDS,
    10,
    1,
    250,
  );
  const timespan = toNonEmptyText(
    typeof value === 'object' ? value?.timespan : process.env.FUNDING_SIGNALS_GDELT_TIMESPAN,
  ) ?? '30d';

  return {
    query,
    companyName: typeof value === 'object'
      ? toNonEmptyText(value.company_name ?? value.companyName)
      : null,
    companyDomain: typeof value === 'object'
      ? normalizeDomain(value.company_domain ?? value.companyDomain)
      : null,
    maxRecords,
    timespan,
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
    'FUNDING_BUSINESS_SIGNALS_INPUT_FILE must contain a JSON array or a {"records": [...]} object.',
  );
}

const FUNDING_EVENT_TYPES = new Set([
  'seed', 'series_a', 'series_b', 'series_c', 'series_d',
  'pre_seed', 'grant', 'ipo', 'acquisition', 'merger',
  'funding_round', 'venture', 'angel', 'crowdfunding',
]);

function resolveSignalType(record) {
  const eventType = normalizeSourceKeyText(record.event_type ?? record.signal_type ?? record.type);

  if (eventType && FUNDING_EVENT_TYPES.has(eventType)) {
    return 'funding';
  }

  return 'other';
}

function normalizeFundingRecord(record, fetchedAt, lineNumber) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return null;
  }

  const companyName = toNonEmptyText(record.company_name ?? record.org_name);
  const companyDomain = normalizeDomain(record.company_domain ?? record.domain);
  const companyWebsiteUrl = toUrlOrNull(record.company_website_url ?? record.website_url);
  const headline = toNonEmptyText(record.headline ?? record.title);
  const summary = toNonEmptyText(record.summary ?? record.description);
  const sourceUrl = toUrlOrNull(record.source_url ?? record.url ?? record.article_url);
  const publisherDomain = normalizeDomain(record.publisher_domain ?? record.source_domain ?? record.publisher);
  const discoveryQuery = toNonEmptyText(record.gdelt_query ?? record.query);
  const syndicationFingerprint = toNonEmptyText(record.syndication_fingerprint);
  const eventType = toNonEmptyText(record.event_type ?? record.signal_type ?? record.type);
  const amount = toNonEmptyText(record.amount ?? record.funding_amount);
  const currency = toNonEmptyText(record.currency) ?? 'USD';
  const investors = Array.isArray(record.investors) ? record.investors.map((i) => String(i).trim()).filter(Boolean) : [];
  const externalId = toNonEmptyText(record.external_id ?? record.id);
  const detectedAt = toTimestampOrNull(record.detected_at ?? record.occurred_at ?? record.published_at) ?? fetchedAt;
  const signalType = resolveSignalType(record);

  const inferredDomain = companyDomain ?? extractHostname(companyWebsiteUrl);

  if (!companyName && !inferredDomain) {
    return null;
  }

  if (!headline && !summary) {
    return null;
  }

  if (!sourceUrl) {
    return null;
  }

  const resolvedHeadline = headline ?? buildFallbackHeadline({ companyName, eventType, inferredDomain });

  const orgName = companyName ?? inferredDomain ?? `Funding Org ${lineNumber}`;
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

  const signalExternalId = buildSignalExternalId({ externalId, sourceUrl, primarySourceKey, lineNumber });

  return {
    lineNumber,
    fetchedAt,
    detectedAt,
    externalId,
    companyName,
    companyDomain: inferredDomain,
    companyWebsiteUrl,
    headline: resolvedHeadline,
    summary,
    sourceUrl,
    publisherDomain,
    discoveryQuery,
    syndicationFingerprint,
    eventType,
    signalType,
    amount,
    currency,
    investors,
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

function buildSignalExternalId({ externalId, sourceUrl, primarySourceKey, lineNumber }) {
  if (externalId) {
    return externalId;
  }

  if (sourceUrl) {
    return `source-url:${sourceUrl}`;
  }

  return `derived:${primarySourceKey}:${lineNumber}`;
}

async function ingestFundingSignals({ connectionString, input }) {
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
        signalType: record.signalType,
        source: SOURCE_ID,
        sourceFamily: 'business-context',
        externalId: record.signalExternalId,
        headline: record.headline,
        summary: record.summary ?? buildSignalSummaryText(record),
        sourceUrl: record.sourceUrl,
        publishedAt: record.detectedAt,
        normalizedAt: record.fetchedAt,
        payload: buildSignalPayload(record),
        sourceRecordType: 'business-event',
        evidenceTier: 'context',
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
        null,
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
    ...buildLiveFundingSummary(input),
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
    ...buildLiveFundingSummary(input),
    recordsReceived: input.recordsReceived,
    duplicateRecords: input.duplicateRecords,
    normalizedRecords: input.normalizedRecords.length,
    skippedRecords: input.skippedRecords,
    orgsCreated: stats.orgUpsertCount,
    signalUpsertsCompleted: stats.signalUpsertCount,
    evidenceUpsertsCompleted: stats.evidenceUpsertCount,
    evidenceCreated: stats.evidenceCreatedCount,
    lineageCreated: stats.lineageCreatedCount,
    zeroReason: input.zeroReason ?? undefined,
  };
}

function buildPipelineSummary(input, stats) {
  return {
    source: SOURCE_ID,
    action: 'pipeline',
    inputMode: input.inputMode,
    inputFilePath: input.inputFilePath,
    ...buildLiveFundingSummary(input),
    recordsReceived: input.recordsReceived,
    duplicateRecords: input.duplicateRecords,
    normalizedRecords: input.normalizedRecords.length,
    skippedRecords: input.skippedRecords,
    orgsCreated: stats.orgUpsertCount,
    signalUpsertsCompleted: stats.signalUpsertCount,
    evidenceUpsertsCompleted: stats.evidenceUpsertCount,
    evidenceCreated: stats.evidenceCreatedCount,
    lineageCreated: stats.lineageCreatedCount,
    zeroReason: input.zeroReason ?? undefined,
  };
}

function buildLiveFundingSummary(input) {
  if (input.inputMode !== 'live-public') {
    return {};
  }

  return {
    liveProvider: input.liveProvider,
    queriesReceived: input.queriesReceived,
  };
}

function buildFallbackHeadline({ companyName, eventType, inferredDomain }) {
  const subject = companyName ?? inferredDomain ?? 'Компания';
  const event = eventType ? ` — ${eventType}` : '';
  return `${subject}${event}`;
}

function inferGdeltEventType(title) {
  const normalizedTitle = normalizeSourceKeyText(title) ?? '';

  if (/\bseries\s*a\b/.test(normalizedTitle)) return 'series_a';
  if (/\bseries\s*b\b/.test(normalizedTitle)) return 'series_b';
  if (/\bseries\s*c\b/.test(normalizedTitle)) return 'series_c';
  if (/\bseries\s*d\b/.test(normalizedTitle)) return 'series_d';
  if (/pre[-\s]?seed/.test(normalizedTitle)) return 'pre_seed';
  if (/\bseed\b/.test(normalizedTitle)) return 'seed';
  if (/\bgrant\b/.test(normalizedTitle)) return 'grant';
  if (/\bipo\b|initial public offering/.test(normalizedTitle)) return 'ipo';
  if (/acquir|acquisition|takeover/.test(normalizedTitle)) return 'acquisition';
  if (/\bmerger\b|\bmerges\b/.test(normalizedTitle)) return 'merger';
  if (/funding|raises|raised|investment|invests|venture|capital/.test(normalizedTitle)) return 'funding_round';
  if (/hiring|recruit|vacanc|jobs|open positions/.test(normalizedTitle)) return 'hiring_context';
  if (/government contract|public contract|wins contract|awarded contract/.test(normalizedTitle)) return 'government_contract';
  if (/layoff|redundan|job cuts|сокращ|увольнен/.test(normalizedTitle)) return 'layoffs';
  if (/restructur|реорганизац|реструктур/.test(normalizedTitle)) return 'restructuring';
  if (/expands|expansion|launches|opens office|new office|new factory|opens factory/.test(normalizedTitle)) return 'expansion';

  return 'press_mention';
}

function parseGdeltDate(value) {
  const text = toNonEmptyText(value);

  if (!text) {
    return null;
  }

  const compactMatch = text.match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2}))?$/);

  if (compactMatch) {
    const [, year, month, day, hour = '00', minute = '00', second = '00'] = compactMatch;
    const date = new Date(Date.UTC(
      Number.parseInt(year, 10),
      Number.parseInt(month, 10) - 1,
      Number.parseInt(day, 10),
      Number.parseInt(hour, 10),
      Number.parseInt(minute, 10),
      Number.parseInt(second, 10),
    ));

    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  return toTimestampOrNull(text);
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

function resolveGdeltTimeoutMs() {
  return clampInteger(process.env.FUNDING_SIGNALS_GDELT_TIMEOUT_MS, 60000, 5000, 120000);
}

function resolveGdeltMinIntervalMs() {
  return clampInteger(process.env.FUNDING_SIGNALS_GDELT_MIN_INTERVAL_MS, 6000, 5000, 30000);
}

function buildSignalSummaryText(record) {
  const fragments = [];

  if (record.companyName) {
    fragments.push(record.companyName);
  }

  if (record.eventType) {
    fragments.push(`событие: ${record.eventType}`);
  }

  if (record.amount) {
    fragments.push(`сумма: ${record.amount} ${record.currency}`);
  }

  return fragments.length > 0
    ? `Бизнес-сигнал (${fragments.join(', ')})`
    : 'Бизнес-сигнал';
}

function buildSignalPayload(record) {
  return {
    source: SOURCE_ID,
    evidence_role: 'context',
    source_entity_type: 'company',
    source_entity_key: record.primarySourceKey,
    source_entity_alias_keys: buildSourceKeyAliases(record.orgSourceKeys, record.orgSourceAliasKeys, record.primarySourceKey),
    source_entity_external_id: null,
    source_entity_display_name: record.orgDisplayName,
    source_entity_name: record.orgName,
    source_record_type: 'business_signal',
    source_record_id: record.signalExternalId,
    source_record_title: record.headline,
    source_record_url: record.sourceUrl,
    source_record_published_at: record.detectedAt,
    org_source_key: record.primarySourceKey,
    company_name: record.companyName,
    company_domain: record.companyDomain,
    company_website_url: record.companyWebsiteUrl,
    event_type: record.eventType,
    signal_type: record.signalType,
    amount: record.amount,
    currency: record.currency,
    investors: record.investors,
    source_url: record.sourceUrl,
    publisher_domain: record.publisherDomain,
    discovery_query: record.discoveryQuery,
    syndication_fingerprint: record.syndicationFingerprint,
    fetched_at: record.fetchedAt,
  };
}

function dedupeGdeltSyndicationRecords(records) {
  const seen = new Set();
  const deduped = [];
  let duplicateRecords = 0;
  for (const record of records) {
    const key = buildGdeltSyndicationKey(record);
    if (key && seen.has(key)) {
      duplicateRecords += 1;
      continue;
    }
    if (key) seen.add(key);
    deduped.push(record);
  }
  return { records: deduped, duplicateRecords };
}

function buildGdeltSyndicationKey(record) {
  const company = normalizeDomain(record?.company_domain);
  const headline = normalizeSourceKeyText(record?.headline ?? record?.title)
    ?.replace(/[^a-z0-9\u0400-\u04ff]+/giu, ' ')
    .trim();
  const published = toTimestampOrNull(record?.published_at ?? record?.occurred_at);
  if (!company || !headline || !published) return null;
  return `${company}|${published.slice(0, 10)}|${headline}`;
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
  await runFundingBusinessSignalsCli();
}
