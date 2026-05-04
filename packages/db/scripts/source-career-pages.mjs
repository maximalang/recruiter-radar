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
const defaultDiscoveredTargetsOutputPath = resolve(scriptDir, './.cache/career-pages-discovered-targets.json');
const defaultDiscoveryReviewOutputPath = resolve(scriptDir, './.cache/career-pages-discovery-review.json');
const SOURCE_ID = 'career-pages';
const SUPPORTED_ACTIONS = new Set(['fetch', 'ingest', 'pipeline']);

loadEnvFile(rootEnvPath);

export async function runCareerPagesCli(argv = process.argv.slice(2)) {
  const requestedAction = argv[0]?.trim() || 'pipeline';
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!SUPPORTED_ACTIONS.has(requestedAction)) {
    console.error(
      'Usage: node packages/db/scripts/source-career-pages.mjs <fetch|ingest|pipeline>\n'
        + 'Input options: set CAREER_PAGES_INPUT_FILE to a JSON/JSONL snapshot, configure CAREER_PAGES_TARGETS_FILE for manual targets, or set DATABASE_URL for repo-native auto-discovery.',
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
          discoverySummary: input.discoverySummary,
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
    discoverySummary: null,
  });
}

export async function fetchCareerPagesInput({ persistSnapshot }) {
  const targetsConfig = await resolveCareerPagesTargetsConfig({ persistSnapshot });
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
    targetsFilePath: targetsConfig.targetsFilePath,
    fetchOutputPath: null,
    targetResults,
    discoverySummary: targetsConfig.discoverySummary ?? null,
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

async function resolveCareerPagesTargetsConfig({ persistSnapshot }) {
  const configuredPath = process.env.CAREER_PAGES_TARGETS_FILE?.trim();

  if (configuredPath) {
    const targetsFilePath = resolveCareerPagesTargetsFilePath(configuredPath);
    return {
      ...loadCareerPagesTargetsConfig(targetsFilePath),
      targetsFilePath,
      discoverySummary: null,
    };
  }

  if (existsSync(defaultTargetsFilePath)) {
    return {
      ...loadCareerPagesTargetsConfig(defaultTargetsFilePath),
      targetsFilePath: defaultTargetsFilePath,
      discoverySummary: null,
    };
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error(
      `CAREER_PAGES_TARGETS_FILE is not set and default targets file is missing: ${defaultTargetsFilePath}. Create it from packages/db/scripts/career-pages-targets.example.json, set CAREER_PAGES_INPUT_FILE, or set DATABASE_URL for auto-discovery.`,
    );
  }

  return discoverCareerPagesTargets({ connectionString: databaseUrl, persistSnapshot });
}

function resolveCareerPagesTargetsFilePath(configuredPath = process.env.CAREER_PAGES_TARGETS_FILE?.trim()) {
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

async function discoverCareerPagesTargets({ connectionString, persistSnapshot }) {
  const seeds = await loadCareerPagesDiscoverySeeds(connectionString);
  const discovery = await discoverCareerPageTargetsFromSeeds(seeds);
  const targetsFilePath = persistSnapshot ? resolveCareerPagesDiscoveredTargetsOutputPath() : null;
  const reviewFilePath = persistSnapshot ? resolveCareerPagesDiscoveryReviewOutputPath() : null;

  if (persistSnapshot) {
    mkdirSync(dirname(targetsFilePath), { recursive: true });
    writeFileSync(targetsFilePath, `${JSON.stringify({ targets: discovery.targets }, null, 2)}\n`, 'utf8');
    writeFileSync(
      reviewFilePath,
      `${JSON.stringify({ generated_at: new Date().toISOString(), summary: discovery.summary, review: discovery.review }, null, 2)}\n`,
      'utf8',
    );
  }

  return {
    targets: discovery.targets,
    targetsFilePath,
    discoverySummary: {
      ...discovery.summary,
      reviewFilePath,
    },
  };
}

async function loadCareerPagesDiscoverySeeds(connectionString) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: dbConnectionTimeoutMillis,
  });

  await client.connect();

  try {
    const result = await client.query(
      `
        SELECT
          orgs.id,
          orgs.name,
          orgs.domain,
          orgs.website_url,
          MAX(CASE WHEN refs.source = 'hh' THEN refs.display_name END) AS hh_display_name,
          MAX(CASE WHEN refs.source = 'hh' THEN refs.external_id END) AS hh_employer_id,
          COUNT(DISTINCT signals.id) FILTER (WHERE signals.source = 'hh') AS hh_signal_count,
          MAX(signals.occurred_at) FILTER (WHERE signals.source = 'hh') AS last_hh_signal_at
        FROM orgs
        LEFT JOIN org_source_refs AS refs
          ON refs.org_id = orgs.id
        LEFT JOIN signals
          ON signals.org_id = orgs.id
         AND signals.source = 'hh'
        WHERE COALESCE(NULLIF(BTRIM(orgs.domain), ''), NULLIF(BTRIM(orgs.website_url), '')) IS NOT NULL
        GROUP BY orgs.id, orgs.name, orgs.domain, orgs.website_url
        HAVING COUNT(DISTINCT signals.id) FILTER (WHERE signals.source = 'hh') > 0
        ORDER BY MAX(signals.occurred_at) FILTER (WHERE signals.source = 'hh') DESC NULLS LAST, orgs.id DESC
        LIMIT $1
      `,
      [resolveCareerPagesDiscoveryLimit()],
    );

    return result.rows
      .map((row) => ({
        orgId: Number(row.id),
        orgName: toNonEmptyText(row.name),
        domain: normalizeDomain(row.domain),
        websiteUrl: toUrlOrNull(row.website_url) ?? deriveWebsiteUrlFromDomain(row.domain),
        hhDisplayName: toNonEmptyText(row.hh_display_name),
        hhEmployerId: toNonEmptyText(row.hh_employer_id),
        hhSignalCount: Number(row.hh_signal_count ?? 0),
        lastHhSignalAt:
          typeof row.last_hh_signal_at === 'string'
            ? row.last_hh_signal_at
            : row.last_hh_signal_at?.toISOString?.() ?? null,
      }))
      .filter((seed) => seed.domain || seed.websiteUrl);
  } finally {
    await client.end();
  }
}

async function discoverCareerPageTargetsFromSeeds(seeds) {
  const targetMap = new Map();
  const review = [];

  for (const seed of seeds) {
    const probe = await probeCareerPageSeed(seed);

    for (const target of probe.targets) {
      const dedupeKey = `${target.adapter}:${target.source_url}`;
      const existingTarget = targetMap.get(dedupeKey);

      if (!existingTarget) {
        targetMap.set(dedupeKey, target);
        continue;
      }

      if (!existingTarget.company_domain && target.company_domain) {
        existingTarget.company_domain = target.company_domain;
      }

      if (!existingTarget.company_website_url && target.company_website_url) {
        existingTarget.company_website_url = target.company_website_url;
      }
    }

    review.push({
      org_id: seed.orgId,
      org_name: seed.orgName,
      company_domain: seed.domain,
      company_website_url: seed.websiteUrl,
      hh_display_name: seed.hhDisplayName,
      hh_employer_id: seed.hhEmployerId,
      hh_signal_count: seed.hhSignalCount,
      last_hh_signal_at: seed.lastHhSignalAt,
      detected_targets: probe.targets.length,
      review_status: probe.targets.length > 0 ? 'resolved' : 'needs_review',
      attempted_urls: probe.attemptedUrls,
      detected_same_domain_career_page_url: probe.sameDomainCareerPageUrl,
      notes: probe.notes,
    });
  }

  return {
    targets: [...targetMap.values()].sort((left, right) => left.id.localeCompare(right.id)),
    review,
    summary: {
      seedsConsidered: seeds.length,
      targetsResolved: targetMap.size,
      unresolvedSeeds: review.filter((item) => item.review_status !== 'resolved').length,
    },
  };
}

async function probeCareerPageSeed(seed) {
  const attemptedUrls = buildCareerPageProbeUrls(seed);
  const pages = [];

  for (const url of attemptedUrls) {
    const page = await fetchHtmlPage(url);

    if (page) {
      pages.push(page);
    }
  }

  const targets = [];
  const notes = [];
  let sameDomainCareerPageUrl = null;

  for (const page of pages) {
    const detection = detectCareerPageTargetFromHtml(page.html, {
      baseUrl: page.url,
      orgName: seed.hhDisplayName ?? seed.orgName,
      domain: seed.domain,
      websiteUrl: seed.websiteUrl,
    });

    targets.push(...detection.targets);

    if (!sameDomainCareerPageUrl && detection.sameDomainCareerPageUrl) {
      sameDomainCareerPageUrl = detection.sameDomainCareerPageUrl;
    }

    if (detection.notes.length > 0) {
      notes.push(...detection.notes);
    }
  }

  return {
    targets: dedupeDiscoveryTargets(targets, seed),
    attemptedUrls,
    sameDomainCareerPageUrl,
    notes: [...new Set(notes)],
  };
}

function dedupeDiscoveryTargets(targets, seed) {
  const targetMap = new Map();

  for (const target of targets) {
    const normalizedTarget = {
      ...target,
      company_name: target.company_name ?? seed.hhDisplayName ?? seed.orgName,
      company_domain: target.company_domain ?? seed.domain,
      company_website_url: target.company_website_url ?? seed.websiteUrl,
    };
    const dedupeKey = `${normalizedTarget.adapter}:${normalizedTarget.source_url}`;

    if (!targetMap.has(dedupeKey)) {
      targetMap.set(dedupeKey, normalizedTarget);
    }
  }

  return [...targetMap.values()];
}

function buildCareerPageProbeUrls(seed) {
  const baseUrl = seed.websiteUrl ?? deriveWebsiteUrlFromDomain(seed.domain);

  if (!baseUrl) {
    return [];
  }

  return [...new Set([
    baseUrl,
    new URL('/careers', baseUrl).toString(),
    new URL('/jobs', baseUrl).toString(),
    new URL('/vacancies', baseUrl).toString(),
    new URL('/about/careers', baseUrl).toString(),
  ])];
}

async function fetchHtmlPage(url) {
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'user-agent': 'RecruiterRadarCareerPages/1.0',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get('content-type') ?? '';

    if (!/html|text\//i.test(contentType)) {
      return null;
    }

    return {
      url: response.url,
      html: await response.text(),
    };
  } catch {
    return null;
  }
}

export function detectCareerPageTargetFromHtml(html, seed) {
  const text = typeof html === 'string' ? html : '';
  const targets = [];
  const notes = [];
  const greenhouseLink = matchFirstUrl(
    text,
    /https?:\/\/(?:boards\.)?greenhouse\.io\/[A-Za-z0-9_-]+|https?:\/\/boards-api\.greenhouse\.io\/v1\/boards\/[A-Za-z0-9_-]+\/jobs\?content=true/gi,
  );
  const leverLink = matchFirstUrl(
    text,
    /https?:\/\/jobs\.lever\.co\/[A-Za-z0-9_-]+|https?:\/\/api\.lever\.co\/v0\/postings\/[A-Za-z0-9_-]+\?mode=json/gi,
  );
  const sameDomainCareerPageUrl = extractSameDomainCareerPageUrl(text, seed.baseUrl ?? seed.websiteUrl ?? null);

  if (greenhouseLink) {
    const slug = extractGreenhouseSlug(greenhouseLink);

    if (slug) {
      targets.push(buildDiscoveredTarget({
        adapter: 'greenhouse-board',
        providerSlug: slug,
        companyName: seed.orgName,
        companyDomain: seed.domain,
        companyWebsiteUrl: seed.websiteUrl,
        careerPageUrl: normalizeGreenhouseCareerPageUrl(greenhouseLink, slug),
        sourceUrl: `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
      }));
    }
  }

  if (leverLink) {
    const slug = extractLeverSlug(leverLink);

    if (slug) {
      targets.push(buildDiscoveredTarget({
        adapter: 'lever-postings',
        providerSlug: slug,
        companyName: seed.orgName,
        companyDomain: seed.domain,
        companyWebsiteUrl: seed.websiteUrl,
        careerPageUrl: `https://jobs.lever.co/${slug}`,
        sourceUrl: `https://api.lever.co/v0/postings/${slug}?mode=json`,
      }));
    }
  }

  if (!greenhouseLink && !leverLink && sameDomainCareerPageUrl) {
    notes.push(`same-domain-careers:${sameDomainCareerPageUrl}`);
  }

  return {
    targets,
    sameDomainCareerPageUrl,
    notes,
  };
}

function buildDiscoveredTarget({ adapter, providerSlug, companyName, companyDomain, companyWebsiteUrl, careerPageUrl, sourceUrl }) {
  return {
    id: `${normalizeSourceKeyText(companyDomain ?? companyName ?? providerSlug) ?? providerSlug}-${adapter}`,
    adapter,
    company_name: companyName,
    company_domain: companyDomain,
    company_website_url: companyWebsiteUrl,
    career_page_url: careerPageUrl,
    source_url: sourceUrl,
  };
}

function matchFirstUrl(value, pattern) {
  const match = value.match(pattern);
  return match?.[0] ? decodeHtmlUrl(match[0]) : null;
}

function decodeHtmlUrl(value) {
  return value.replace(/&amp;/g, '&');
}

function extractGreenhouseSlug(value) {
  const match = value.match(/(?:boards-api\.greenhouse\.io\/v1\/boards\/|greenhouse\.io\/)([A-Za-z0-9_-]+)/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function extractLeverSlug(value) {
  const match = value.match(/jobs\.lever\.co\/([A-Za-z0-9_-]+)|api\.lever\.co\/v0\/postings\/([A-Za-z0-9_-]+)/i);
  return match?.[1]?.toLowerCase() ?? match?.[2]?.toLowerCase() ?? null;
}

function normalizeGreenhouseCareerPageUrl(url, slug) {
  return /boards-api\.greenhouse\.io/i.test(url) ? `https://boards.greenhouse.io/${slug}` : url;
}

function extractSameDomainCareerPageUrl(value, baseUrl) {
  if (!baseUrl) {
    return null;
  }

  const baseHostname = extractHostname(baseUrl);

  if (!baseHostname) {
    return null;
  }

  const hrefPattern = /https?:\/\/[^"'\s<>]+|href=["']([^"']+)["']/gi;
  let match;

  while ((match = hrefPattern.exec(value)) !== null) {
    const href = decodeHtmlUrl(match[1] ?? match[0]);
    const absoluteUrl = toAbsoluteUrlOrNull(href, baseUrl);

    if (!absoluteUrl || extractHostname(absoluteUrl) !== baseHostname) {
      continue;
    }

    if (/career|jobs|vacanc/i.test(absoluteUrl)) {
      return absoluteUrl;
    }
  }

  return null;
}

function toAbsoluteUrlOrNull(value, baseUrl) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

function deriveWebsiteUrlFromDomain(value) {
  const domain = normalizeDomain(value);
  return domain ? `https://${domain}/` : null;
}

function resolveCareerPagesDiscoveryLimit() {
  const rawValue = process.env.CAREER_PAGES_DISCOVERY_LIMIT?.trim();

  if (!rawValue) {
    return 50;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 50;
}

export function resolveCareerPagesDiscoveredTargetsOutputPath() {
  const configuredPath = process.env.CAREER_PAGES_DISCOVERED_TARGETS_FILE?.trim();
  return resolve(process.cwd(), configuredPath || defaultDiscoveredTargetsOutputPath);
}

export function resolveCareerPagesDiscoveryReviewOutputPath() {
  const configuredPath = process.env.CAREER_PAGES_DISCOVERY_REVIEW_FILE?.trim();
  return resolve(process.cwd(), configuredPath || defaultDiscoveryReviewOutputPath);
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

function buildNormalizedInput({ records, inputMode, inputFilePath, targetsFilePath, fetchOutputPath, targetResults, discoverySummary }) {
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
    discoverySummary: discoverySummary ?? null,
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
    discoverySummary: input.discoverySummary,
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
    discoverySummary: input.discoverySummary,
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
