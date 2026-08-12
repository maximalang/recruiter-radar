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

const { Client } = pg;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDir, '../../../.env');
const SOURCE_ID = 'egrul-fns';
const SIGNAL_TYPE = 'other';
const SUPPORTED_ACTIONS = new Set(['fetch', 'ingest', 'pipeline']);
const DEFAULT_PUBLIC_BASE_URL = 'https://egrul.org/';
const PUBLIC_PROVIDER = 'egrul-public-json';
const EGRUL_ATTRS = '@attributes';
const EGRUL_KEYS = Object.freeze({
  legalEntity: '\u0421\u0432\u042e\u041b',
  ceasedLegalEntity: '\u0421\u0432\u041f\u0440\u0435\u043a\u0440\u042e\u041b',
  issueDate: '\u0414\u0430\u0442\u0430\u0412\u044b\u043f',
  ogrn: '\u041e\u0413\u0420\u041d',
  ogrnDate: '\u0414\u0430\u0442\u0430\u041e\u0413\u0420\u041d',
  inn: '\u0418\u041d\u041d',
  kpp: '\u041a\u041f\u041f',
  name: '\u0421\u0432\u041d\u0430\u0438\u043c\u042e\u041b',
  fullName: '\u041d\u0430\u0438\u043c\u042e\u041b\u041f\u043e\u043b\u043d',
  shortNameBlock: '\u0421\u0432\u041d\u0430\u0438\u043c\u042e\u041b\u0421\u043e\u043a\u0440',
  shortName: '\u041d\u0430\u0438\u043c\u0421\u043e\u043a\u0440',
  address: '\u0421\u0432\u0410\u0434\u0440\u0435\u0441\u042e\u041b',
  addressRf: '\u0410\u0434\u0440\u0435\u0441\u0420\u0424',
  postalCode: '\u0418\u043d\u0434\u0435\u043a\u0441',
  region: '\u0420\u0435\u0433\u0438\u043e\u043d',
  regionName: '\u041d\u0430\u0438\u043c\u0420\u0435\u0433\u0438\u043e\u043d',
  street: '\u0423\u043b\u0438\u0446\u0430',
  streetType: '\u0422\u0438\u043f\u0423\u043b\u0438\u0446\u0430',
  streetName: '\u041d\u0430\u0438\u043c\u0423\u043b\u0438\u0446\u0430',
  house: '\u0414\u043e\u043c',
  okvedReport: '\u0421\u0432\u041e\u041a\u0412\u042d\u0414\u041e\u0442\u0447',
  okvedReportMain: '\u0421\u0432\u041e\u041a\u0412\u042d\u0414\u041e\u0442\u0447\u041e\u0441\u043d',
  okved: '\u0421\u0432\u041e\u041a\u0412\u042d\u0414',
  okvedMain: '\u0421\u0432\u041e\u041a\u0412\u042d\u0414\u041e\u0441\u043d',
  okvedCode: '\u041a\u043e\u0434\u041e\u041a\u0412\u042d\u0414',
  okvedName: '\u041d\u0430\u0438\u043c\u041e\u041a\u0412\u042d\u0414',
});


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
    let input = resolveEgrulFnsInput();

    if (input.inputMode === 'provider-pending') {
      input = await resolveEgrulProviderInput(input);
    } else if (input.inputMode === 'public-pending') {
      input = await resolveEgrulPublicInput(input);
    }

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

  const providerUrl = process.env.EGRUL_FNS_PROVIDER_API_URL?.trim();
  const providerToken = process.env.EGRUL_FNS_PROVIDER_API_TOKEN?.trim();

  if (providerUrl && providerToken) {
    return { inputMode: 'provider-pending', providerUrl, providerToken };
  }

  const inns = parsePublicInns();

  if (inns.length > 0) {
    return {
      inputMode: 'public-pending',
      inns,
      publicBaseUrl: process.env.EGRUL_FNS_PUBLIC_BASE_URL?.trim() || DEFAULT_PUBLIC_BASE_URL,
    };
  }

  throw new Error(
    'No input configured for egrul-fns.\n'
      + 'Set EGRUL_FNS_INPUT_FILE for file mode, or\n'
      + 'set EGRUL_FNS_INNS for public JSON mirror mode, or\n'
      + 'set EGRUL_FNS_PROVIDER_API_URL and EGRUL_FNS_PROVIDER_API_TOKEN for provider mode. '
      + 'Direct FNS scraping is not supported.',
  );
}

export async function resolveEgrulProviderInput({ providerUrl, providerToken }) {
  let body;

  try {
    body = await fetchJson(providerUrl, {
      sourceName: 'egrul-fns provider',
      headers: {
        authorization: `Bearer ${providerToken}`,
      },
    });
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n`
        + 'Verify EGRUL_FNS_PROVIDER_API_URL and EGRUL_FNS_PROVIDER_API_TOKEN are correct.',
      { cause: error },
    );
  }

  const records = extractProviderRecords(body, SOURCE_ID);
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

export async function resolveEgrulPublicInput({ inns, publicBaseUrl = DEFAULT_PUBLIC_BASE_URL }) {
  const records = [];

  for (const inn of inns) {
    const body = await fetchPublicEgrulRecord({ inn, publicBaseUrl });
    records.push(mapPublicEgrulRecord(body, inn));
  }

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

  if (records.length > 0 && dedupeResult.records.length === 0) {
    throw new Error(
      `${SOURCE_ID} public EGRUL returned ${records.length} records but 0 normalized records`
        + ` (${skippedRecords} skipped). Check public EGRUL mapping and INN list.`,
    );
  }

  return {
    inputMode: 'live-public',
    inputFilePath: null,
    liveProvider: PUBLIC_PROVIDER,
    innsRequested: inns.length,
    recordsReceived: records.length,
    duplicateRecords: dedupeResult.duplicateRecords,
    normalizedRecords: dedupeResult.records,
    skippedRecords,
  };
}

async function fetchPublicEgrulRecord({ inn, publicBaseUrl }) {
  const url = new URL(`${inn}.json`, ensureTrailingSlash(publicBaseUrl));

  return fetchJson(url, {
    sourceName: 'egrul-fns public json',
    timeoutMs: 30000,
    retries: 2,
    retryDelayMs: 1000,
    headers: {
      'user-agent': 'RecruiterRadar/1.0 (egrul-fns)',
    },
  });
}

function mapPublicEgrulRecord(body, requestedInn) {
  const legalEntity = body?.[EGRUL_KEYS.legalEntity] ?? body?.[EGRUL_KEYS.ceasedLegalEntity];

  if (!legalEntity || typeof legalEntity !== 'object') {
    return null;
  }

  const attrs = attrsOf(legalEntity);
  const nameBlock = legalEntity[EGRUL_KEYS.name] ?? {};
  const nameAttrs = attrsOf(nameBlock);
  const shortNameAttrs = attrsOf(nameBlock[EGRUL_KEYS.shortNameBlock]);
  const okvedAttrs = attrsOf(
    legalEntity[EGRUL_KEYS.okvedReport]?.[EGRUL_KEYS.okvedReportMain]
      ?? legalEntity[EGRUL_KEYS.okved]?.[EGRUL_KEYS.okvedMain],
  );
  const inn = toNonEmptyText(attrs[EGRUL_KEYS.inn]) ?? requestedInn;
  const ogrn = toNonEmptyText(attrs[EGRUL_KEYS.ogrn]);

  return {
    external_id: ogrn ? `egrul:ogrn:${ogrn}` : `egrul:inn:${inn}`,
    company_name: toNonEmptyText(shortNameAttrs[EGRUL_KEYS.shortName])
      ?? toNonEmptyText(nameAttrs[EGRUL_KEYS.fullName]),
    inn,
    ogrn,
    kpp: toNonEmptyText(attrs[EGRUL_KEYS.kpp]),
    registration_date: toNonEmptyText(attrs[EGRUL_KEYS.ogrnDate]),
    status: body?.[EGRUL_KEYS.ceasedLegalEntity] ? 'inactive' : 'active',
    legal_address: buildPublicEgrulAddress(legalEntity),
    okved: toNonEmptyText(okvedAttrs[EGRUL_KEYS.okvedCode]),
    okved_description: toNonEmptyText(okvedAttrs[EGRUL_KEYS.okvedName]),
    detected_at: toTimestampOrNull(attrs[EGRUL_KEYS.issueDate]) ?? new Date().toISOString(),
  };
}

function buildPublicEgrulAddress(legalEntity) {
  const addressRf = legalEntity[EGRUL_KEYS.address]?.[EGRUL_KEYS.addressRf];
  const addressAttrs = attrsOf(addressRf);
  const regionAttrs = attrsOf(addressRf?.[EGRUL_KEYS.region]);
  const streetAttrs = attrsOf(addressRf?.[EGRUL_KEYS.street]);
  const street = [streetAttrs[EGRUL_KEYS.streetType], streetAttrs[EGRUL_KEYS.streetName]]
    .map(toNonEmptyText)
    .filter(Boolean)
    .join(' ');
  const parts = [
    addressAttrs[EGRUL_KEYS.postalCode],
    regionAttrs[EGRUL_KEYS.regionName],
    street,
    addressAttrs[EGRUL_KEYS.house],
  ]
    .map(toNonEmptyText)
    .filter(Boolean);

  return parts.length > 0 ? parts.join(', ') : null;
}

function attrsOf(value) {
  return value?.[EGRUL_ATTRS] && typeof value[EGRUL_ATTRS] === 'object'
    ? value[EGRUL_ATTRS]
    : {};
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

function parsePublicInns() {
  const rawInns = process.env.EGRUL_FNS_INNS?.trim();

  if (!rawInns) {
    return [];
  }

  return rawInns
    .split(/\r?\n|,|;/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.replace(/\D/g, ''))
    .filter((value, index, values) => value.length === 10 && values.indexOf(value) === index);
}

function ensureTrailingSlash(value) {
  return value.endsWith('/') ? value : `${value}/`;
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
  const detectedAt = toTimestampOrNull(record.detected_at ?? record.occurred_at ?? record.fetched_at) ?? fetchedAt;

  if (!inn && !ogrn) {
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
        buildSignalHeadline(record),
        buildSignalSummaryText(record),
        null,
        record.detectedAt,
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
    ...buildLiveEgrulSummary(input),
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
    ...buildLiveEgrulSummary(input),
    recordsReceived: input.recordsReceived,
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
    ...buildLiveEgrulSummary(input),
    recordsReceived: input.recordsReceived,
    duplicateRecords: input.duplicateRecords,
    normalizedRecords: input.normalizedRecords.length,
    skippedRecords: input.skippedRecords,
    orgsCreated: stats.orgUpsertCount,
    signalUpsertsCompleted: stats.signalUpsertCount,
  };
}

function buildLiveEgrulSummary(input) {
  if (input.inputMode !== 'live-public') {
    return {};
  }

  return {
    liveProvider: input.liveProvider,
    innsRequested: input.innsRequested,
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
