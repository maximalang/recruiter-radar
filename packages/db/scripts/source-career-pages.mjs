import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

import {
  buildRfJobQuality,
} from './adapters/rf-source-normalizers.mjs';
import { assertProviderNormalization } from './adapters/provider-contract.mjs';
import {
  buildRussianLegalNameSourceKey,
  buildSourceKeyAliases,
  countSensitiveFields,
  dedupeNormalizedRecords,
  dropSensitiveFields,
  stripBom,
} from './adapters/source-records.mjs';
import { fetchJson as fetchJsonWithPolicy, fetchText } from './adapters/source-http.mjs';
import { runSourceEscalation } from './adapters/source-escalation.mjs';
import { fetchExtractionMarkdown } from './adapters/source-extraction-fallback.mjs';
import { createPlaywrightBrowserPool } from './adapters/playwright-browser-pool.mjs';
import {
  createCareerPagesIncrementalState,
  shouldSkipExpensiveCareerFallback,
} from './adapters/career-pages-incremental-state.mjs';
import {
  buildCareerPagesHealth,
  detectCareerPagesHealthAnomalies,
  resolveCareerPagesHealthFamily,
} from './adapters/career-pages-health.mjs';
import {
  canonicalizePublicUrl,
  discoverCareerUrlsFromWebsite,
  extractEmbeddedJsonDocuments,
  fetchConditionalText,
  isRobotsPathAllowed,
  resolvePublicRobotsPolicy,
} from './adapters/site-discovery.mjs';
import {
  assertOrgSourceRefOwner,
  isOrganizationIdentityConflict,
  resolveOrganizationOwner,
} from './adapters/organization-resolution.mjs';
import { loadEnvFile, normalizeDomain, runScriptCli } from './lib/common-utils.mjs';
import {
  upsertSignalEvidenceLineage,
  upsertSignalEvidenceLineageBatch,
} from './lib/source-lineage-writer.mjs';
import {
  extractCareerPageContactPaths,
  toPersistableContactPaths,
} from './lib/career-page-contacts.mjs';
import { resolveSuccessfulIngestZeroReason } from './adapters/rf-source-runtime.mjs';

const { Client } = pg;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDir, '../../../.env');
const dbConnectionTimeoutMillis = resolveDbConnectionTimeoutMillis();
const defaultTargetsFilePath = resolve(scriptDir, './career-pages-targets.json');
const defaultFetchOutputPath = resolve(scriptDir, './.cache/career-pages-fetch.json');
const defaultDiscoveredTargetsOutputPath = resolve(scriptDir, './.cache/career-pages-discovered-targets.json');
const defaultDiscoveryReviewOutputPath = resolve(scriptDir, './.cache/career-pages-discovery-review.json');
const defaultHealthStatePath = resolve(scriptDir, './.cache/career-pages-health.json');
const defaultIncrementalStatePath = resolve(scriptDir, './.cache/career-pages-incremental.json');
const SOURCE_ID = 'career-pages';
const CAREER_EXTRACTION_VERSION = 'v1';
const SUPPORTED_ACTIONS = new Set(['fetch', 'ingest', 'pipeline']);
let careerPageRenderPool = null;
const careerPageAccessPolicyCache = new Map();

loadEnvFile(rootEnvPath);

export { loadEnvFile };

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
      const summary = buildFetchSummary(input);
      persistCareerPagesHealth(summary.health);
      console.log(JSON.stringify(summary, null, 2));
      return;
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
      const summary = buildIngestSummary(input, stats);
      persistCareerPagesHealth(summary.health);
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    const health = buildHealthForInput(input, stats);
    persistCareerPagesHealth(health);
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
          parsedRecords: input.recordsReceived,
          recordsAfterDedupe: input.recordsAfterDedupe ?? input.normalizedRecords.length,
          duplicateRecords: input.duplicateRecords,
          normalizedRecords: input.normalizedRecords.length,
          skippedRecords: input.skippedRecords,
          sensitiveFieldsDropped: input.sensitiveFieldsDropped ?? 0,
          targetResults: input.targetResults,
          extractionBreakdown: summarizeExtractionBreakdown(input.targetResults),
          orgsCreated: stats.orgUpsertCount,
          signalUpsertsCompleted: stats.signalUpsertCount,
          evidenceUpsertsCompleted: stats.evidenceUpsertCount,
          evidenceCreated: stats.evidenceCreatedCount,
          lineageCreated: stats.lineageCreatedCount,
          organizationResolutionRejects: stats.organizationResolutionRejects,
          organizationResolutionRejectedTargetKeys: stats.organizationResolutionRejectedTargetKeys,
          zeroReason: resolveSuccessfulIngestZeroReason(input, stats),
          health,
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

  const rawContent = stripBom(readFileSync(resolvedPath, 'utf8'));
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
  const targets = filterCareerPageTargets(targetsConfig.targets);
  const targetResults = [];
  const records = [];
  // Read-only verifiers pass persistSnapshot=false and must always exercise the
  // real transport instead of inheriting or mutating production crawl state.
  const incrementalState = persistSnapshot
    ? createCareerPagesIncrementalState({ filePath: resolveCareerPagesIncrementalStatePath() })
    : null;

  // Wall-clock fetch budget. career-pages crawls targets sequentially and only
  // writes to the DB once the whole loop finishes, so when it runs inside the
  // daily-radar pipeline (a 120s execFile timeout per source) a mid-crawl kill
  // would discard every record fetched so far. Stopping early on a budget lets
  // the partial batch reach ingestion; remaining targets are picked up on the
  // next run. Default leaves headroom under the 120s pipeline timeout for the
  // ingest write. Set CAREER_PAGES_FETCH_BUDGET_MS=0 to disable (manual runs).
  const fetchBudgetMs = resolveCareerPagesFetchBudgetMs();
  const fetchStartedAt = Date.now();
  let budgetExhausted = false;

  for (const [index, target] of targets.entries()) {
    if (fetchBudgetMs > 0 && index > 0 && Date.now() - fetchStartedAt >= fetchBudgetMs) {
      budgetExhausted = true;
      break;
    }
    // Isolate per-target failures: one unreachable target (network reset,
    // foreign host, malformed feed) must not discard every record fetched so
    // far and fail the whole source. Record the failure in the summary and
    // continue — the partial batch still reaches ingestion, and the bad target
    // is retried on the next run.
    const targetStartedAt = Date.now();
    try {
      const targetResult = await fetchCareerPageTarget(target, index + 1, { incrementalState });
      targetResults.push({
        ...targetResult.summary,
        durationMs: Date.now() - targetStartedAt,
      });
      records.push(...targetResult.records);
    } catch (error) {
      targetResults.push({
        id: toNonEmptyText(target?.id) ?? `target-${index + 1}`,
        adapter: toNonEmptyText(target?.adapter ?? target?.type) ?? null,
        hostedAtsFamily: toNonEmptyText(target?.hosted_ats_family ?? target?.hostedAtsFamily) ?? null,
        companyName: toNonEmptyText(target?.company_name ?? target?.companyName) ?? null,
        sourceUrl: toUrlOrNull(target?.source_url ?? target?.sourceUrl ?? target?.url),
        recordsFetched: 0,
        outcome: 'page-unreachable',
        pageFetched: false,
        errorCategory: classifyCareerPageFetchError(error),
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - targetStartedAt,
      });
    }
  }

  await closeCareerPageRenderPool();
  incrementalState?.flush();

  const normalizedInput = buildNormalizedInput({
    records,
    inputMode: 'fetch',
    inputFilePath: null,
    targetsFilePath: targetsConfig.targetsFilePath,
    fetchOutputPath: null,
    targetResults,
    discoverySummary: targetsConfig.discoverySummary ?? null,
    targetsTotal: targets.length,
    budgetExhausted,
    rejectAllSkipped: true,
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
  const parsed = parseJson(stripBom(readFileSync(targetsFilePath, 'utf8')), targetsFilePath);
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

export function buildCareerPagesDiscoverySeedsQuery() {
  return `
        SELECT
          orgs.id,
          orgs.name,
          orgs.domain,
          orgs.website_url,
          MAX(CASE WHEN refs.source = 'hh' THEN refs.display_name END) AS hh_display_name,
          MAX(CASE WHEN refs.source = 'hh' THEN refs.external_id END) AS hh_employer_id,
          COUNT(DISTINCT signals.id) FILTER (WHERE signals.source = 'hh') AS hh_signal_count,
          MAX(signals.occurred_at) FILTER (WHERE signals.source = 'hh') AS last_hh_signal_at,
          COUNT(DISTINCT signals.id) AS signal_count,
          MAX(signals.occurred_at) AS last_signal_at
        FROM orgs
        LEFT JOIN org_source_refs AS refs
          ON refs.org_id = orgs.id
         AND refs.source <> 'career-pages'
        LEFT JOIN signals
          ON signals.org_id = orgs.id
         AND signals.source <> 'career-pages'
        WHERE COALESCE(NULLIF(BTRIM(orgs.domain), ''), NULLIF(BTRIM(orgs.website_url), '')) IS NOT NULL
          AND (
            NULLIF(BTRIM(orgs.domain), '') IS NULL
            OR NOT EXISTS (
              SELECT 1
              FROM orgs AS domain_peer
              WHERE domain_peer.id <> orgs.id
                AND REGEXP_REPLACE(
                  LOWER(BTRIM(domain_peer.domain)),
                  '^(www|career|careers|job|jobs|hr|vacancy|vacancies)\\.',
                  ''
                ) = REGEXP_REPLACE(
                  LOWER(BTRIM(orgs.domain)),
                  '^(www|career|careers|job|jobs|hr|vacancy|vacancies)\\.',
                  ''
                )
            )
          )
        GROUP BY orgs.id, orgs.name, orgs.domain, orgs.website_url
        HAVING COUNT(DISTINCT signals.id) > 0
        ORDER BY MAX(signals.occurred_at) DESC NULLS LAST, orgs.id DESC
        LIMIT $1
      `;
}

async function loadCareerPagesDiscoverySeeds(connectionString) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: dbConnectionTimeoutMillis,
  });

  await client.connect();

  try {
    const result = await client.query(
      buildCareerPagesDiscoverySeedsQuery(),
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
        signalCount: Number(row.signal_count ?? 0),
        lastSignalAt:
          typeof row.last_signal_at === 'string'
            ? row.last_signal_at
            : row.last_signal_at?.toISOString?.() ?? null,
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
      signal_count: seed.signalCount,
      last_signal_at: seed.lastSignalAt,
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
  const baseUrl = seed.websiteUrl ?? deriveWebsiteUrlFromDomain(seed.domain);
  const siteDiscovery = baseUrl
    ? await discoverCareerUrlsFromWebsite(baseUrl, { maxSitemaps: 3, maxUrls: 6 })
    : null;
  const attemptedUrls = siteDiscovery?.blocked
    ? []
    : [...new Set([
      ...buildCareerPageProbeUrls(seed),
      ...(siteDiscovery?.careerUrls ?? []),
    ])].filter((url) => isRobotsPathAllowed(url, siteDiscovery?.robots));
  const pages = [];

  for (const url of attemptedUrls) {
    const page = await fetchHtmlPage(url);

    if (page) {
      pages.push(page);
    }
  }

  const targets = [];
  const notes = siteDiscovery
    ? [
      `robots:${siteDiscovery.robotsState}`,
      `sitemaps-fetched:${siteDiscovery.sitemapUrlsFetched.length}`,
      ...siteDiscovery.errors,
    ]
    : [];
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

  // Russian company career pages live under a wider set of paths than the
  // EN-default /careers and /jobs. /career (singular), /about/vacancies,
  // /ru/jobs, /jobs/list, and /vacancies/all are common on RU corporate
  // sites (Тинькофф, Авито, Яндекс-style paths, VK, Ozon). Probing them
  // increases the same-domain JSON-LD hit rate — every added probe is a
  // fetch of the company's OWN verified domain, so nothing is fabricated.
  // Deduped via Set; 404s are swallowed by fetchHtmlPage (returns null).
  return [...new Set([
    baseUrl,
    new URL('/careers', baseUrl).toString(),
    new URL('/career', baseUrl).toString(),
    new URL('/jobs', baseUrl).toString(),
    new URL('/vacancies', baseUrl).toString(),
    new URL('/vacancies/all', baseUrl).toString(),
    new URL('/about/careers', baseUrl).toString(),
    new URL('/about/vacancies', baseUrl).toString(),
    new URL('/ru/jobs', baseUrl).toString(),
    new URL('/ru/vacancies', baseUrl).toString(),
    new URL('/jobs/list', baseUrl).toString(),
    new URL('/work-with-us', baseUrl).toString(),
    new URL('/company/jobs', baseUrl).toString(),
    new URL('/about/jobs', baseUrl).toString(),
  ])];
}

function filterCareerPageTargets(targets) {
  const adapterFilter = process.env.CAREER_PAGES_ADAPTER_FILTER?.trim();

  if (!adapterFilter) {
    return targets;
  }

  return targets.filter((target) => toNonEmptyText(target?.adapter ?? target?.type) === adapterFilter);
}

async function fetchHtmlPage(url) {
  return (await fetchHtmlPageDetailed(url)).page;
}

async function fetchHtmlPageDetailed(url, { previous = {} } = {}) {
  try {
    const conditional = await fetchConditionalText(url, {
      previous,
      sourceName: 'career-pages discovery',
      headers: {
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'user-agent': 'RecruiterRadarCareerPages/1.0',
      },
      redirect: 'follow',
    });
    const { response, body: html } = conditional;

    if (conditional.notModified) {
      return {
        page: null,
        diagnostics: {
          pageFetched: true,
          resolvedUrl: response.url || url,
          errorCategory: null,
          notModified: true,
          validators: conditional.validators,
          contentHash: conditional.contentHash,
        },
      };
    }

    if (!response.ok) {
      return {
        page: null,
        diagnostics: {
          pageFetched: false,
          fetchFailure: true,
          errorCategory: `http-${response.status}`,
        },
      };
    }

    const contentType = response.headers.get('content-type') ?? '';

    if (!/html|text\//i.test(contentType)) {
      return {
        page: null,
        diagnostics: {
          pageFetched: true,
          contentUnsupported: true,
          resolvedUrl: response.url,
          errorCategory: 'unsupported-content-type',
          validators: conditional.validators,
          contentHash: conditional.contentHash,
        },
      };
    }

    return {
      page: {
        url: response.url,
        html,
      },
      diagnostics: {
        pageFetched: true,
        resolvedUrl: response.url,
        errorCategory: null,
        notModified: false,
        validators: conditional.validators,
        contentHash: conditional.contentHash,
      },
    };
  } catch (error) {
    return {
      page: null,
      diagnostics: {
        pageFetched: false,
        fetchFailure: true,
        errorCategory: classifyCareerPageFetchError(error),
      },
    };
  }
}

function classifyCareerPageFetchError(error) {
  const status = Number(error?.status);
  if (Number.isInteger(status) && status >= 400 && status <= 599) return `http-${status}`;
  const code = typeof error?.code === 'string' ? error.code.trim().toLowerCase() : '';
  if (code) return code;
  if (error?.name === 'AbortError' || /timeout/i.test(error?.message ?? '')) return 'timeout';
  return 'network-error';
}

export function detectCareerPageTargetFromHtml(html, seed) {
  const text = typeof html === 'string' ? html : '';
  // A company career URL may redirect directly to a hosted ATS board. The
  // resolved URL is then a stronger fingerprint than the board HTML, which
  // often contains no link back to itself.
  const fingerprintText = `${toNonEmptyText(seed?.baseUrl) ?? ''}\n${text}`;
  const targets = [];
  const notes = [];
  const greenhouseLink = matchFirstUrl(
    fingerprintText,
    /https?:\/\/(?:boards\.)?greenhouse\.io\/[A-Za-z0-9_-]+|https?:\/\/boards-api\.greenhouse\.io\/v1\/boards\/[A-Za-z0-9_-]+\/jobs\?content=true/gi,
  );
  const leverLink = matchFirstUrl(
    fingerprintText,
    /https?:\/\/jobs\.lever\.co\/[A-Za-z0-9_-]+|https?:\/\/api\.lever\.co\/v0\/postings\/[A-Za-z0-9_-]+\?mode=json/gi,
  );
  const ashbyLink = matchFirstUrl(
    fingerprintText,
    /https?:\/\/(?:jobs\.ashbyhq\.com\/[A-Za-z0-9_-]+|api\.ashbyhq\.com\/posting-api\/job-board\/[A-Za-z0-9_-]+(?:\?[^"'\s<>]*)?)/gi,
  );
  const recruiteeLink = matchFirstUrl(
    fingerprintText,
    /https?:\/\/[A-Za-z0-9-]+\.recruitee\.com(?:\/(?:api\/offers\/?|o\/[A-Za-z0-9_-]+)?)?/gi,
  );
  const workableLink = matchFirstUrl(
    fingerprintText,
    /https?:\/\/(?:apply\.workable\.com\/[A-Za-z0-9_-]+\/?|www\.workable\.com\/api\/accounts\/[A-Za-z0-9_-]+(?:\?[^"'\s<>]*)?)/gi,
  );
  const smartRecruitersLink = matchFirstUrl(
    fingerprintText,
    /https?:\/\/(?:careers\.smartrecruiters\.com\/[A-Za-z0-9_-]+|api\.smartrecruiters\.com\/v1\/companies\/[A-Za-z0-9_-]+\/postings(?:\?[^"'\s<>]*)?)/gi,
  );
  const teamtailorLink = matchFirstPublicFeedSurface(fingerprintText, 'teamtailor');
  const personioLink = matchFirstPublicFeedSurface(fingerprintText, 'personio');
  const sameDomainCareerPageUrl = extractSameDomainCareerPageUrl(text, seed.baseUrl ?? seed.websiteUrl ?? null);
  const hostedCareerPages = extractHostedCareerPageUrls(fingerprintText);
  const eStaffFingerprint = /"hrSystem"\s*:\s*\{[^{}]*"name"\s*:\s*"e-?staff"|vacancy_response_e-?staff/i.test(text);

  if (eStaffFingerprint && sameDomainCareerPageUrl) {
    targets.push(buildDiscoveredTarget({
      adapter: 'hosted-career-page',
      providerSlug: `e-staff-${extractHostname(sameDomainCareerPageUrl) ?? 'careers'}`,
      companyName: seed.orgName,
      companyDomain: seed.domain,
      companyWebsiteUrl: seed.websiteUrl,
      careerPageUrl: sameDomainCareerPageUrl,
      sourceUrl: sameDomainCareerPageUrl,
      hostedAtsFamily: 'e-staff',
    }));
  }

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

  if (ashbyLink) {
    const slug = extractAshbySlug(ashbyLink);

    if (slug) {
      targets.push(buildDiscoveredTarget({
        adapter: 'ashby-job-board',
        providerSlug: slug,
        companyName: seed.orgName,
        companyDomain: seed.domain,
        companyWebsiteUrl: seed.websiteUrl,
        careerPageUrl: `https://jobs.ashbyhq.com/${slug}`,
        sourceUrl: `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`,
      }));
    }
  }

  if (recruiteeLink) {
    const slug = extractRecruiteeSlug(recruiteeLink);

    if (slug) {
      targets.push(buildDiscoveredTarget({
        adapter: 'recruitee-careers',
        providerSlug: slug,
        companyName: seed.orgName,
        companyDomain: seed.domain,
        companyWebsiteUrl: seed.websiteUrl,
        careerPageUrl: `https://${slug}.recruitee.com`,
        sourceUrl: `https://${slug}.recruitee.com/api/offers/`,
      }));
    }
  }

  if (workableLink) {
    const slug = extractWorkableSlug(workableLink);

    if (slug) {
      targets.push(buildDiscoveredTarget({
        adapter: 'workable-public-jobs',
        providerSlug: slug,
        companyName: seed.orgName,
        companyDomain: seed.domain,
        companyWebsiteUrl: seed.websiteUrl,
        careerPageUrl: `https://apply.workable.com/${slug}/`,
        sourceUrl: `https://www.workable.com/api/accounts/${slug}?details=true`,
      }));
    }
  }

  if (smartRecruitersLink) {
    const slug = extractSmartRecruitersSlug(smartRecruitersLink);

    if (slug) {
      targets.push(buildDiscoveredTarget({
        adapter: 'smartrecruiters-postings',
        providerSlug: slug,
        companyName: seed.orgName,
        companyDomain: seed.domain,
        companyWebsiteUrl: seed.websiteUrl,
        careerPageUrl: `https://careers.smartrecruiters.com/${slug}`,
        sourceUrl: `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100&offset=0`,
      }));
    }
  }

  if (teamtailorLink) {
    const teamtailorUrl = new URL(teamtailorLink);
    targets.push(buildDiscoveredTarget({
      adapter: 'teamtailor-rss',
      providerSlug: teamtailorUrl.hostname.split('.')[0],
      companyName: seed.orgName,
      companyDomain: seed.domain,
      companyWebsiteUrl: seed.websiteUrl,
      careerPageUrl: `${teamtailorUrl.origin}/jobs`,
      sourceUrl: `${teamtailorUrl.origin}/jobs.rss?per_page=200`,
    }));
  }

  if (personioLink) {
    const personioUrl = new URL(personioLink);
    targets.push(buildDiscoveredTarget({
      adapter: 'personio-xml',
      providerSlug: personioUrl.hostname.split('.')[0],
      companyName: seed.orgName,
      companyDomain: seed.domain,
      companyWebsiteUrl: seed.websiteUrl,
      careerPageUrl: personioUrl.origin,
      sourceUrl: `${personioUrl.origin}/xml?language=en`,
    }));
  }

  if (targets.length === 0 && hostedCareerPages.length > 0) {
    for (const hosted of hostedCareerPages) {
      const publicSurfaceUrl = normalizeHostedCareerSurfaceUrl(hosted.url, hosted.family);
      targets.push(buildDiscoveredTarget({
        adapter: 'hosted-career-page',
        providerSlug: `${hosted.family}-${hosted.hostname}`,
        companyName: seed.orgName,
        companyDomain: seed.domain,
        companyWebsiteUrl: seed.websiteUrl,
        careerPageUrl: hosted.url,
        sourceUrl: publicSurfaceUrl,
        hostedAtsFamily: hosted.family,
      }));
    }
  }

  if (targets.length === 0 && sameDomainCareerPageUrl) {
    // The company's OWN career page (same host as its website) is a direct,
    // company-owned hiring surface — exactly the RU-native case foreign ATS
    // detection (Greenhouse/Lever) misses. Emit a target that reads schema.org
    // JobPosting JSON-LD from that page (the markup RU sites publish for
    // Яндекс.Работа / Google Jobs), so it becomes a real career-pages signal
    // instead of a dead `needs_review` note.
    notes.push(`same-domain-careers:${sameDomainCareerPageUrl}`);
    targets.push(buildDiscoveredTarget({
      adapter: 'same-domain-jsonld',
      providerSlug: seed.domain ?? extractHostname(sameDomainCareerPageUrl) ?? 'careers',
      companyName: seed.orgName,
      companyDomain: seed.domain,
      companyWebsiteUrl: seed.websiteUrl,
      careerPageUrl: sameDomainCareerPageUrl,
      sourceUrl: sameDomainCareerPageUrl,
    }));
  }

  return {
    targets,
    sameDomainCareerPageUrl,
    notes,
  };
}

/**
 * Extract schema.org JobPosting objects from a page's `application/ld+json`
 * blocks. RU company career pages publish this markup for Яндекс.Работа /
 * Google for Jobs, so it is a reliable, non-brittle structured surface — far
 * more durable than scraping bespoke HTML. Walks arrays, `@graph`, and
 * `ItemList`/`ListItem` wrappers to find every `@type: JobPosting`.
 */
export function extractJobPostingsFromHtml(html) {
  const text = typeof html === 'string' ? html : '';
  const postings = [];
  for (const document of extractEmbeddedJsonDocuments(text)) {
    collectJobPostings(document, postings, 0);
  }

  return postings;
}

function collectJobPostings(node, acc, depth) {
  if (!node || depth > 6 || acc.length >= 200) {
    return;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      collectJobPostings(item, acc, depth + 1);
    }
    return;
  }

  if (typeof node !== 'object') {
    return;
  }

  const type = node['@type'];
  const isJobPosting = Array.isArray(type)
    ? type.some((entry) => String(entry).toLowerCase() === 'jobposting')
    : String(type ?? '').toLowerCase() === 'jobposting';

  if (isJobPosting) {
    acc.push(node);
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      collectJobPostings(value, acc, depth + 1);
    }
  }
}

/**
 * Map extracted schema.org JobPosting objects to the career-pages record shape
 * (same contract as mapGreenhouseBoardPayload). Only reads fields the standard
 * actually carries — never fabricates a company, contact, or salary. Records
 * without a job title are dropped downstream by normalizeCareerPageRecord.
 */
export function mapJsonLdJobPostings(postings, seed) {
  const list = Array.isArray(postings) ? postings : [];
  const seedInfo = seed && typeof seed === 'object' ? seed : {};

  return list.map((posting, index) => {
    const source = posting && typeof posting === 'object' ? posting : {};
    const hiringOrg = asPlainObject(source.hiringOrganization);
    const companyName = toNonEmptyText(hiringOrg.name) ?? seedInfo.companyName ?? null;
    const companyWebsiteUrl = toUrlOrNull(hiringOrg.sameAs) ?? seedInfo.companyWebsiteUrl ?? null;
    const jobPostingUrl = toUrlOrNull(source.url) ?? seedInfo.careerPageUrl ?? null;

    return {
      company_name: companyName,
      company_domain: seedInfo.companyDomain ?? null,
      company_website_url: companyWebsiteUrl,
      career_page_url: seedInfo.careerPageUrl ?? null,
      job_posting_url: jobPostingUrl,
      job_title: toNonEmptyText(source.title ?? source.name),
      external_id: extractJsonLdIdentifier(source) ?? stringifyExternalId(null, seedInfo.careerPageUrl ?? 'jsonld', index),
      location: extractJsonLdLocation(source.jobLocation),
      employment_type: normalizeJsonLdEmploymentType(source.employmentType),
      occurred_at: toTimestampOrNull(source.datePosted ?? source.datePublished),
      source_record_type: 'job_posting',
      raw_target_adapter: 'same-domain-jsonld',
      // Contact surface extracted from the career-page HTML (one pass per page,
      // shared across every vacancy on it). Passed through to the signal payload
      // so the agency-facing surfaces see the concrete contact, not just "there
      // is a career page". Null when the page exposed no contact surface.
      contact_paths: seedInfo.contactPaths ?? null,
      raw: source,
    };
  });
}

/**
 * HTML-card fallback extractor for same-domain RU career pages that publish
 * vacancies as repeated HTML items WITHOUT schema.org JSON-LD markup.
 *
 * Many Russian corporate career sites (Bitrix/1C-Bitrix, custom CMS, older
 * VK/Ozon-style pages) render vacancies as a list/table of cards where each
 * card carries a vacancy title inside a link that points to a same-domain
 * vacancy detail page. `extractJobPostingsFromHtml` (JSON-LD only) returns []
 * for these pages, so without this fallback the company's direct hiring proof
 * — a gate-A/B originator — is silently lost after the page was already
 * discovered + fetched (a real cost).
 *
 * Evidence-first guardrails (non-negotiable):
 *   - A record requires BOTH a non-empty title AND a same-domain vacancy URL.
 *     No title + no same-domain link → dropped (never fabricated).
 *   - The link host MUST match the career page host (same-domain only). An
 *     external board link (greenhouse/lever/hh) is NOT a same-domain vacancy
 *     — those have their own adapters and would double-count.
 *   - No company name, contact, email, phone, or salary is invented. Company
 *     identity is seeded from the target (the page we already trust to be the
 *     company's own surface); per-card fields are read only when present.
 *   - Cap at 200 cards/page to bound runaway markup (mirrors JSON-LD cap).
 *
 * Extraction strategy (tolerant, two markup generations):
 *   1. Anchor-driven: scan every <a href> on the page; keep anchors whose
 *      visible text looks like a vacancy title (>= 3 chars, not pure nav) AND
 *      whose href resolves to the SAME host. This is the most reliable signal
 *      because RU career pages almost always link the title to the vacancy
 *      detail page on their own domain.
 *   2. Heading-driven fallback: when a card has a heading (h1-h4) but no usable
 *      anchor text, pair the heading with the first same-domain href inside the
 *      card block.
 *
 * Returns the career-pages record shape (same contract as mapJsonLdJobPostings)
 * tagged with `raw_target_adapter: 'same-domain-html-cards'` so the signal
 * payload's extraction_method is auditable downstream.
 */
export function extractVacancyCardsFromSameDomainHtml(html, seed) {
  const text = typeof html === 'string' ? html : '';
  if (!text) return [];

  const seedInfo = seed && typeof seed === 'object' ? seed : {};
  const careerPageUrl = toUrlOrNull(seedInfo.careerPageUrl ?? seedInfo.sourceUrl);
  const baseHost = careerPageUrl ? extractHostname(careerPageUrl) : null;
  if (!baseHost) return [];

  const records = [];
  const seenUrls = new Set();

  // Strategy 1 — anchor-driven. Find every <a href="..."> with visible text.
  const anchorPattern = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(text)) !== null) {
    if (records.length >= 200) break;
    const href = decodeHtmlUrl(match[1]);
    const absoluteUrl = toAbsoluteUrlOrNull(href, careerPageUrl);
    if (!absoluteUrl) continue;
    if (extractHostname(absoluteUrl) !== baseHost) continue;
    // Skip the career-page index itself and pure-fragment/same-page links —
    // we want vacancy DETAIL pages, not the listing page we're already on.
    if (normalizeUrlForDedupe(absoluteUrl) === normalizeUrlForDedupe(careerPageUrl)) continue;

    const headingHtml = /<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/i.exec(match[2])?.[1];
    const title = cleanCardText(headingHtml ?? match[2]);
    if (!isPlausibleVacancyTitle(title)) continue;

    // Dedupe by vacancy URL: a listing page often links the same vacancy twice
    // (card title + "подробнее"). Keep the first occurrence.
    const dedupeKey = normalizeUrlForDedupe(absoluteUrl);
    if (seenUrls.has(dedupeKey)) continue;
    seenUrls.add(dedupeKey);

    // Capture a window of HTML around the anchor so per-card field extraction
    // (location/salary/employment) can read sibling elements inside the same
    // card block. ±600 chars is enough for a typical card without leaking into
    // the neighbouring card. The anchor text alone never carries those fields.
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;
    const windowStart = Math.max(0, matchStart - 600);
    const windowEnd = Math.min(text.length, matchEnd + 200);
    const cardWindow = text.slice(windowStart, windowEnd);

    records.push(buildSameDomainHtmlCardRecord({
      title,
      vacancyUrl: absoluteUrl,
      cardHtml: cardWindow,
      seedInfo,
      careerPageUrl,
    }));
  }

  return records;
}

function buildSameDomainHtmlCardRecord({ title, vacancyUrl, cardHtml, seedInfo, careerPageUrl }) {
  // Read only fields that are actually present on the card. Never fabricate.
  const location = toNonEmptyText(extractFirstMatch(cardHtml, LOCATION_CARD_PATTERNS));
  const employmentType = toNonEmptyText(extractFirstMatch(cardHtml, EMPLOYMENT_CARD_PATTERNS));
  const salary = toNonEmptyText(extractFirstMatch(cardHtml, SALARY_CARD_PATTERNS));

  return {
    company_name: seedInfo.companyName ?? null,
    company_domain: seedInfo.companyDomain ?? null,
    company_website_url: seedInfo.companyWebsiteUrl ?? null,
    career_page_url: seedInfo.careerPageUrl ?? careerPageUrl ?? null,
    job_posting_url: vacancyUrl,
    job_title: title,
    external_id: `html-card:${vacancyUrl}`,
    location,
    employment_type: employmentType,
    salary,
    occurred_at: null, // HTML cards rarely carry a reliable date; do NOT guess
    source_record_type: 'job_posting',
    raw_target_adapter: 'same-domain-html-cards',
    extraction_method: 'html-card-fallback',
    // Contact surface extracted from the career-page HTML (one pass per page).
    contact_paths: seedInfo.contactPaths ?? null,
    raw: { vacancyUrl, title, location, employmentType, salary },
  };
}

// Card-level field patterns. Match a value inside a classed element near the
// title. Tolerant of RU + EN class names and BEM `__` / `-` separators common
// on Bitrix/1C-Bitrix RU corporate sites (`vacancy-card__location`,
// `vacancy__city`, `job-item-salary`). Kept conservative: a false negative
// (missed field) is cheap; a false positive (wrong value dressed as evidence)
// is expensive.
const LOCATION_CARD_PATTERNS = [
  /class="[^"]*\b(?:vacancy|job|vac|position)[A-Za-z_-]*(?:location|city|region|geo|place)\b[^"]*"[^>]*>([\s\S]*?)<\//i,
  /class="[^"]*\b(?:location|city|region|geo)[A-Za-z_-]*\b[^"]*"[^>]*>([\s\S]*?)<\//i,
];
const EMPLOYMENT_CARD_PATTERNS = [
  /class="[^"]*\b(?:vacancy|job|vac|position)[A-Za-z_-]*(?:type|schedule|employment|work[-_]?type|mode|format)\b[^"]*"[^>]*>([\s\S]*?)<\//i,
  /class="[^"]*\b(?:employment|schedule|work[-_]?type|work[-_]?mode|format)[A-Za-z_-]*\b[^"]*"[^>]*>([\s\S]*?)<\//i,
];
const SALARY_CARD_PATTERNS = [
  /class="[^"]*\b(?:vacancy|job|vac|position)[A-Za-z_-]*(?:salary|compensation|pay|wage)\b[^"]*"[^>]*>([\s\S]*?)<\//i,
  /class="[^"]*\b(?:salary|compensation)[A-Za-z_-]*\b[^"]*"[^>]*>([\s\S]*?)<\//i,
];

function extractFirstMatch(haystack, patterns) {
  for (const pattern of patterns) {
    const match = haystack.match(pattern);
    const value = cleanCardText(match?.[1]);
    if (value) return value;
  }
  return null;
}

// A plausible vacancy title: 3..120 chars after trim, not pure punctuation,
// and not obvious navigation chrome ("подробнее", "откликнуться", "все
// вакансии", "apply", "details"). Reject boilerplate so it never becomes a
// fake vacancy headline. Plural/case endings tolerated for RU.
const NAV_BOILERPLATE = /^(?:подробнее|откликнутьс[яьи]|все\s+ваканси(?:и|я|й)?|посмотреть\s+все|смотреть\s+(?:все\s+)?ваканси(?:и|я|й)?|apply|details|read\s+more|view\s+(?:all|jobs?)|learn\s+more|вакансии?|jobs?|careers?|back|назад|далее|подать\s+заявку|подробнее\s+о\s+ваканси)$/i;
function isPlausibleVacancyTitle(value) {
  const title = toNonEmptyText(value);
  if (!title) return false;
  if (title.length < 3 || title.length > 120) return false;
  if (NAV_BOILERPLATE.test(title.trim())) return false;
  // Must contain at least one letter (Cyrillic or Latin). A pure number/symbol
  // string is not a vacancy title.
  return /[\p{L}]/u.test(title);
}

function normalizeUrlForDedupe(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    // Drop marketing utm_* query params so the same vacancy linked from two
    // campaign contexts dedupes to one record.
    const keep = [];
    for (const [key, value] of u.searchParams) {
      if (!key.startsWith('utm_')) keep.push([key, value]);
    }
    u.search = keep.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    return u.toString();
  } catch {
    return String(url);
  }
}

function cleanCardText(value) {
  if (typeof value !== 'string') return null;
  const stripped = value
    .replace(/<[^>]+>/g, ' ') // drop nested tags
    .replace(/%[A-Z][A-Z0-9_]*%/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return stripped === '' ? null : stripped;
}

function asPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function extractJsonLdIdentifier(posting) {
  const identifier = posting.identifier;

  if (identifier && typeof identifier === 'object' && !Array.isArray(identifier)) {
    return toNonEmptyText(identifier.value ?? identifier['@id'] ?? identifier.name);
  }

  return toNonEmptyText(identifier);
}

function extractJsonLdLocation(jobLocation) {
  const location = Array.isArray(jobLocation) ? jobLocation[0] : jobLocation;
  const address = asPlainObject(asPlainObject(location).address);

  return (
    toNonEmptyText(address.addressLocality)
    ?? toNonEmptyText(address.addressRegion)
    ?? toNonEmptyText(asPlainObject(location).name)
  );
}

function normalizeJsonLdEmploymentType(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => toNonEmptyText(entry)).filter(Boolean).join(', ') || null;
  }

  return toNonEmptyText(value);
}

function buildDiscoveredTarget({ adapter, providerSlug, companyName, companyDomain, companyWebsiteUrl, careerPageUrl, sourceUrl, hostedAtsFamily = null }) {
  const baseId = normalizeSourceKeyText(companyDomain ?? companyName ?? providerSlug) ?? providerSlug;
  const target = {
    id: hostedAtsFamily ? `${baseId}-${adapter}-${providerSlug}` : `${baseId}-${adapter}`,
    adapter,
    company_name: companyName,
    company_domain: companyDomain,
    company_website_url: companyWebsiteUrl,
    career_page_url: careerPageUrl,
    source_url: sourceUrl,
  };
  if (hostedAtsFamily) target.hosted_ats_family = hostedAtsFamily;
  return target;
}

function extractHostedCareerPageUrls(value, maxTargets = 4) {
  const targets = [];
  const seen = new Set();
  for (const match of String(value ?? '').matchAll(/https?:\/\/[^"'\s<>]+/gi)) {
    const url = canonicalizePublicUrl(decodeHtmlUrl(match[0]));
    if (!url || seen.has(url)) continue;
    const parsed = new URL(url);
    if (/\.(?:avif|gif|jpe?g|png|svg|webp|css|js|map|ico)$/i.test(parsed.pathname)) continue;
    if (/(?:^|\/)(?:api|rest|graphql|oauth|auth|internal|services)(?:\/|$)/i.test(parsed.pathname)) continue;
    const family = classifyHostedAtsUrl(parsed);
    if (!family) continue;
    seen.add(url);
    targets.push({ family, hostname: parsed.hostname.toLowerCase(), url });
    if (targets.length >= Math.max(1, maxTargets)) break;
  }
  return targets;
}

function classifyHostedAtsUrl(url) {
  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  if (host.endsWith('.myworkdayjobs.com')) return 'workday';
  if (host.endsWith('.teamtailor.com')) return 'teamtailor';
  if (host.endsWith('.jobs.personio.com') || host.endsWith('.jobs.personio.de')) return 'personio';
  if (host.endsWith('.bamboohr.com') && /^\/(?:careers?|jobs?)(?:\/|$)/i.test(path)) return 'bamboohr';
  if (host.endsWith('.pinpointhq.com')) return 'pinpoint';
  if (host.endsWith('.breezy.hr')) return 'breezy';
  if ((host === 'comeet.com' || host.endsWith('.comeet.com')) && /^\/jobs(?:\/|$)/i.test(path)) return 'comeet';
  if (host.endsWith('.applytojob.com')) return 'jazzhr';
  if (host.endsWith('.icims.com') && /\/jobs(?:\/|$)/i.test(path)) return 'icims';
  if (host.endsWith('.taleo.net') && /\/careersection(?:\/|$)/i.test(path)) return 'oracle-taleo';
  if (host.endsWith('.oraclecloud.com') && /\/hcmui\/candidateexperience(?:\/|$)/i.test(path)) return 'oracle-cloud';
  if ((host.endsWith('.successfactors.com') || host.endsWith('.successfactors.eu'))
    && /\/career(?:\/|$)/i.test(path)) return 'sap-successfactors';
  if (host.endsWith('.potok.io') && /^\/open\/jobs(?:\/|$)/i.test(path)) return 'potok';
  if (host.endsWith('.huntflow.io')) return 'huntflow';
  if ((host === 'skillaz.ru' || host.endsWith('.skillaz.ru'))
    && /^\/(?:jobs?|vacanc(?:y|ies))(?:\/|$)/i.test(path)) return 'skillaz';
  if (((host === 'friendwork.ru' || host.endsWith('.friendwork.ru'))
      && /^\/(?:jobs?|vacanc(?:y|ies)|career)(?:\/|$)/i.test(path))
    || (host === 'jobs.friend.work' && /^\/[^/]+(?:\/\d+)?\/?$/i.test(path))) return 'friendwork';
  if (host === 'talantix.ru' && /^\/(?:form|ats\/vacancy)(?:\/|$)/i.test(path)) return 'talantix';
  return null;
}

function normalizeHostedCareerSurfaceUrl(value, family) {
  if (family !== 'icims') return value;
  const url = new URL(value);
  if (!/\/jobs\/search$/i.test(url.pathname)) url.pathname = '/jobs/search';
  url.searchParams.set('ss', '1');
  url.searchParams.set('in_iframe', '1');
  url.searchParams.sort();
  return url.toString();
}

function matchFirstPublicFeedSurface(value, provider) {
  for (const match of String(value ?? '').matchAll(/https?:\/\/[^"'\s<>]+/gi)) {
    const publicUrl = canonicalizePublicUrl(decodeHtmlUrl(match[0]));
    if (!publicUrl) continue;
    const parsed = new URL(publicUrl);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname;
    if (provider === 'teamtailor'
      && host.endsWith('.teamtailor.com')
      && (path === '/' || /^\/jobs(?:\.rss|\/|$)/i.test(path))) return publicUrl;
    if (provider === 'personio'
      && (host.endsWith('.jobs.personio.de') || host.endsWith('.jobs.personio.com'))
      && (path === '/' || /^\/(?:job|xml)(?:\/|$)/i.test(path))) return publicUrl;
  }
  return null;
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

function extractAshbySlug(value) {
  const match = value.match(/(?:jobs\.ashbyhq\.com\/|posting-api\/job-board\/)([A-Za-z0-9_-]+)/i);
  return match?.[1] ?? null;
}

function extractRecruiteeSlug(value) {
  const match = value.match(/https?:\/\/([A-Za-z0-9-]+)\.recruitee\.com/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function extractWorkableSlug(value) {
  const match = value.match(/apply\.workable\.com\/([A-Za-z0-9_-]+)|workable\.com\/api\/accounts\/([A-Za-z0-9_-]+)/i);
  return match?.[1]?.toLowerCase() ?? match?.[2]?.toLowerCase() ?? null;
}

function extractSmartRecruitersSlug(value) {
  const match = value.match(/careers\.smartrecruiters\.com\/([A-Za-z0-9_-]+)|api\.smartrecruiters\.com\/v1\/companies\/([A-Za-z0-9_-]+)/i);
  return match?.[1] ?? match?.[2] ?? null;
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

    const absoluteHostname = extractHostname(absoluteUrl);
    const rootBaseHostname = baseHostname.replace(/^www\./i, '');
    if (!absoluteUrl || !absoluteHostname || (
      absoluteHostname !== rootBaseHostname
      && !absoluteHostname.endsWith(`.${rootBaseHostname}`)
    )) {
      continue;
    }

    const parsedUrl = new URL(absoluteUrl);
    const hasCareerPathSegment = /\/(?:careers?|jobs?|vacanc(?:y|ies))(?:\/|$)/i.test(parsedUrl.pathname);

    if (hasCareerPathSegment && !/\.(?:avif|gif|jpe?g|png|svg|webp|css|js|map|ico)$/i.test(parsedUrl.pathname)) {
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
    // Raised from 50 → 120 (2026-07-06): career-pages is the ONLY gate-A/B
    // direct surface, and the 2026-07-05 prod audit showed the deliverable
    // pool for corporate_only agencies is ~16 gate-B orgs — a burst-then-dry
    // pilot risk. Each discovered same-domain career page is a potential new
    // gate-B lead (or a 2nd source family that promotes an existing gate-C
    // org to gate-B via cross-source corroboration in source-digest-evidence.sql).
    // The 90s CAREER_PAGES_FETCH_BUDGET_MS still caps wall-clock runtime; the
    // seed limit only widens the candidate set the budget draws from. No
    // fabricated targets — every seed is a real org with an existing signal
    // and a known domain, probed by fetching its own website.
    return 120;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 120;
}

/**
 * Wall-clock fetch budget (ms) for the sequential crawl loop. Default 90s
 * leaves ~30s headroom under the daily-radar 120s execFile timeout for the
 * ingest write. 0 disables the budget (manual / off-pipeline runs that want to
 * crawl every discovered target regardless of time).
 */
function resolveCareerPagesFetchBudgetMs() {
  const rawValue = process.env.CAREER_PAGES_FETCH_BUDGET_MS?.trim();

  if (rawValue === undefined || rawValue === '') {
    return 90_000;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : 90_000;
}

export function resolveCareerPagesDiscoveredTargetsOutputPath() {
  const configuredPath = process.env.CAREER_PAGES_DISCOVERED_TARGETS_FILE?.trim();
  return resolve(process.cwd(), configuredPath || defaultDiscoveredTargetsOutputPath);
}

export function resolveCareerPagesDiscoveryReviewOutputPath() {
  const configuredPath = process.env.CAREER_PAGES_DISCOVERY_REVIEW_FILE?.trim();
  return resolve(process.cwd(), configuredPath || defaultDiscoveryReviewOutputPath);
}

async function fetchCareerPageTarget(target, index, { incrementalState = null } = {}) {
  const normalizedTarget = normalizeFetchTarget(target, index);
  let records;
  let fetchDiagnostics = {};

  if (normalizedTarget.adapter === 'greenhouse-board') {
    records = await fetchGreenhouseBoardRecords(normalizedTarget);
  } else if (normalizedTarget.adapter === 'lever-postings') {
    records = await fetchLeverPostingsRecords(normalizedTarget);
  } else if (normalizedTarget.adapter === 'ashby-job-board') {
    records = await fetchAshbyJobBoardRecords(normalizedTarget);
  } else if (normalizedTarget.adapter === 'recruitee-careers') {
    records = await fetchRecruiteeCareersRecords(normalizedTarget);
  } else if (normalizedTarget.adapter === 'workable-public-jobs') {
    records = await fetchWorkablePublicJobsRecords(normalizedTarget);
  } else if (normalizedTarget.adapter === 'smartrecruiters-postings') {
    const fetched = await fetchSmartRecruitersPostingsRecords(normalizedTarget);
    records = fetched.records;
    fetchDiagnostics = fetched.diagnostics;
  } else if (normalizedTarget.adapter === 'smartrecruiters-public-careers') {
    const fetched = await fetchSmartRecruitersPublicCareersRecords(normalizedTarget);
    records = fetched.records;
    fetchDiagnostics = fetched.diagnostics;
  } else if (normalizedTarget.adapter === 'teamtailor-rss') {
    const feedTarget = { ...normalizedTarget };
    const fetched = await fetchSameDomainJsonLdRecords({
      ...normalizedTarget,
      sourceUrl: normalizedTarget.careerPageUrl,
      hostedAtsFamily: 'teamtailor',
    }, {
      officialFeed: () => fetchTeamtailorRssRecords(feedTarget),
      incrementalState,
    });
    records = fetched.records;
    fetchDiagnostics = fetched.diagnostics;
  } else if (normalizedTarget.adapter === 'personio-xml') {
    const feedTarget = { ...normalizedTarget };
    const fetched = await fetchSameDomainJsonLdRecords({
      ...normalizedTarget,
      sourceUrl: normalizedTarget.careerPageUrl,
      hostedAtsFamily: 'personio',
    }, {
      officialFeed: () => fetchPersonioXmlRecords(feedTarget),
      incrementalState,
    });
    records = fetched.records;
    fetchDiagnostics = fetched.diagnostics;
  } else if (['same-domain-jsonld', 'hosted-career-page'].includes(normalizedTarget.adapter)) {
    const fetched = await fetchSameDomainJsonLdRecords(normalizedTarget, { incrementalState });
    records = fetched.records;
    fetchDiagnostics = fetched.diagnostics;
    if (normalizedTarget.hostedAtsFamily) {
      for (const record of records) {
        record.hosted_ats_family = normalizedTarget.hostedAtsFamily;
        record.raw_target_adapter = 'hosted-career-page';
      }
    }
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
      outcome: resolveCareerPageTargetOutcome({
        adapter: normalizedTarget.adapter,
        recordsFetched: records.length,
        ...fetchDiagnostics,
      }),
      pageFetched: fetchDiagnostics.pageFetched ?? true,
      resolvedUrl: fetchDiagnostics.resolvedUrl ?? normalizedTarget.sourceUrl,
      errorCategory: fetchDiagnostics.errorCategory ?? null,
      escalationStage: fetchDiagnostics.escalationStage ?? null,
      escalationAttempts: fetchDiagnostics.escalationAttempts ?? [],
      stoppedByPolicy: fetchDiagnostics.stoppedByPolicy ?? false,
      notModified: fetchDiagnostics.notModified ?? false,
      // Per-target extraction diagnostics. For same-domain targets this names
      // which extractor produced the records ('jsonld' vs 'html-card-fallback')
      // so a discovered target that fetched a page but yielded 0 is inspectable
      // in the fetch summary instead of silently lost. Other adapters report
      // their native adapter id. A 0-record same-domain target is flagged
      // `extractionMethod: 'none'` so the operator can see the gap.
      extractionMethod: resolveExtractionMethodForSummary(records, normalizedTarget.adapter),
      hostedAtsFamily: normalizedTarget.hostedAtsFamily,
    },
  };
}

export function resolveCareerPageTargetOutcome({
  adapter,
  recordsFetched,
  pageFetched = false,
  fetchFailure = false,
  contentUnsupported = false,
  notModified = false,
}) {
  if (notModified) return 'not-modified';
  if (fetchFailure) return 'page-unreachable';
  if (contentUnsupported) return 'extractor-unsupported';
  if (recordsFetched > 0) return 'parsed';
  if (['same-domain-jsonld', 'hosted-career-page'].includes(adapter) && pageFetched) return 'extraction-zero-unexpected';
  if (pageFetched) return 'no-vacancies-present';
  return 'page-unreachable';
}

function resolveExtractionMethodForSummary(records, adapter) {
  if (Array.isArray(records) && records.length > 0) {
    const method = records[0]?.extraction_method;
    if (typeof method === 'string' && method.trim() !== '') return method;
    if (adapter === 'greenhouse-board') return 'greenhouse-api';
    if (adapter === 'lever-postings') return 'lever-api';
    if (adapter === 'ashby-job-board') return 'ashby-public-api';
    if (adapter === 'recruitee-careers') return 'recruitee-careers-api';
    if (adapter === 'workable-public-jobs') return 'workable-public-api';
    if (adapter === 'smartrecruiters-postings') return 'smartrecruiters-posting-api';
    if (adapter === 'teamtailor-rss') return 'teamtailor-rss';
    if (adapter === 'personio-xml') return 'personio-xml';
    if (adapter === 'json-feed') return 'json-feed';
    if (adapter === 'static-records') return 'static-records';
    return adapter ?? 'unknown';
  }
  // 0 records: distinguish "no extractor matched" from "adapter ran but found
  // nothing". same-domain-jsonld is the path that now has the HTML fallback —
  // a 0 here means the page had neither JSON-LD nor usable HTML cards.
  if (['same-domain-jsonld', 'hosted-career-page'].includes(adapter)) return 'none';
  return adapter ?? 'none';
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
  const hostedAtsFamily = toNonEmptyText(target.hosted_ats_family ?? target.hostedAtsFamily);

  if (adapter === 'static-records') {
    const records = Array.isArray(target.records) ? target.records : [];

    return {
      id,
      adapter,
      companyName,
      companyDomain,
      companyWebsiteUrl,
      careerPageUrl,
      hostedAtsFamily,
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
    hostedAtsFamily,
    sourceUrl,
  };
}

async function fetchGreenhouseBoardRecords(target) {
  const payload = await fetchJson(target.sourceUrl, target.id);
  return mapGreenhouseBoardPayload(payload, target);
}

export function mapGreenhouseBoardPayload(payload, target) {
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
    extraction_method: 'greenhouse-api',
    raw_target_id: target.id,
    raw_target_adapter: target.adapter,
    raw: job,
  }));
}

async function fetchLeverPostingsRecords(target) {
  const payload = await fetchJson(target.sourceUrl, target.id);
  return mapLeverPostingsPayload(payload, target);
}

export function mapLeverPostingsPayload(payload, target) {
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
    extraction_method: 'lever-api',
    raw_target_id: target.id,
    raw_target_adapter: target.adapter,
    raw: job,
  }));
}

async function fetchAshbyJobBoardRecords(target) {
  const payload = await fetchJson(target.sourceUrl, target.id);
  return mapAshbyJobBoardPayload(payload, target);
}

export function mapAshbyJobBoardPayload(payload, target) {
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];

  return jobs
    .filter((job) => job?.isListed !== false)
    .map((job, index) => ({
      company_name: target.companyName,
      company_domain: target.companyDomain,
      company_website_url: target.companyWebsiteUrl,
      career_page_url: target.careerPageUrl,
      job_posting_url: toUrlOrNull(job?.jobUrl ?? job?.applyUrl),
      job_title: toNonEmptyText(job?.title),
      external_id: stringifyExternalId(job?.id, target.id, index),
      location: toNonEmptyText(job?.location),
      employment_type: toNonEmptyText(job?.employmentType),
      occurred_at: toTimestampOrNull(job?.publishedAt),
      tags: [job?.department, job?.team, job?.workplaceType].map(toNonEmptyText).filter(Boolean),
      source_record_type: 'job_posting',
      extraction_method: 'ashby-public-api',
      raw_target_id: target.id,
      raw_target_adapter: target.adapter,
      raw: job,
    }));
}

async function fetchRecruiteeCareersRecords(target) {
  const payload = await fetchJson(target.sourceUrl, target.id);
  return mapRecruiteeCareersPayload(payload, target);
}

export function mapRecruiteeCareersPayload(payload, target) {
  const offers = Array.isArray(payload?.offers) ? payload.offers : [];

  return offers.map((offer, index) => ({
    company_name: target.companyName ?? toNonEmptyText(offer?.company_name),
    company_domain: target.companyDomain,
    company_website_url: target.companyWebsiteUrl,
    career_page_url: target.careerPageUrl,
    job_posting_url: toUrlOrNull(offer?.careers_url ?? offer?.careers_apply_url),
    job_title: toNonEmptyText(offer?.title),
    external_id: stringifyExternalId(offer?.id ?? offer?.slug, target.id, index),
    location: formatRecruiteeLocation(offer),
    employment_type: toNonEmptyText(offer?.employment_type_code),
    occurred_at: toTimestampOrNull(offer?.published_at ?? offer?.updated_at ?? offer?.created_at),
    tags: [offer?.department, ...(Array.isArray(offer?.tags) ? offer.tags : [])].map(toNonEmptyText).filter(Boolean),
    source_record_type: 'job_posting',
    extraction_method: 'recruitee-careers-api',
    raw_target_id: target.id,
    raw_target_adapter: target.adapter,
    raw: offer,
  }));
}

async function fetchWorkablePublicJobsRecords(target) {
  const payload = await fetchJson(target.sourceUrl, target.id);
  return mapWorkablePublicJobsPayload(payload, target);
}

export function mapWorkablePublicJobsPayload(payload, target) {
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];

  return jobs.map((job, index) => ({
    company_name: target.companyName ?? toNonEmptyText(payload?.name),
    company_domain: target.companyDomain,
    company_website_url: target.companyWebsiteUrl,
    career_page_url: target.careerPageUrl,
    job_posting_url: toUrlOrNull(job?.url ?? job?.shortlink ?? job?.application_url),
    job_title: toNonEmptyText(job?.title),
    external_id: stringifyExternalId(job?.shortcode ?? job?.id, target.id, index),
    location: formatWorkableLocation(job),
    employment_type: toNonEmptyText(job?.employment_type),
    occurred_at: toTimestampOrNull(job?.published_on ?? job?.created_at),
    tags: [job?.department, job?.function, job?.industry].map(toNonEmptyText).filter(Boolean),
    source_record_type: 'job_posting',
    extraction_method: 'workable-public-api',
    raw_target_id: target.id,
    raw_target_adapter: target.adapter,
    raw: job,
  }));
}

export async function fetchSmartRecruitersPostingsRecords(target, {
  fetchJsonImpl = fetchJson,
  fetchPublicCareersImpl = fetchSameDomainJsonLdRecords,
} = {}) {
  const records = [];
  let sourceUrl = target.sourceUrl;

  try {
    while (sourceUrl) {
      const payload = await fetchJsonImpl(sourceUrl, target.id, { allowProxyRetry: false });
      records.push(...mapSmartRecruitersPostingsPayload(payload, target));
      const offset = Number(payload?.offset);
      const limit = Number(payload?.limit);
      const totalFound = Number(payload?.totalFound);
      const nextOffset = offset + limit;

      if (!Number.isFinite(offset) || !Number.isFinite(limit) || limit <= 0
        || !Number.isFinite(totalFound) || nextOffset >= totalFound) {
        sourceUrl = null;
      } else {
        const nextUrl = new URL(sourceUrl);
        nextUrl.searchParams.set('offset', String(nextOffset));
        sourceUrl = nextUrl.toString();
      }
    }
  } catch (error) {
    const status = Number(error?.status ?? error?.cause?.status);
    if (status !== 403 || !target.careerPageUrl) throw error;
    const publicPage = await fetchSmartRecruitersPublicCareersRecords(target, {
      fetchPublicCareersImpl,
    });
    return {
      records: publicPage.records,
      diagnostics: {
        ...publicPage.diagnostics,
        officialApiStatus: 403,
        officialApiOutcome: 'blocked',
        publicCareersFallback: true,
      },
    };
  }

  return {
    records,
    diagnostics: {
      escalationStage: 'official-feed',
      escalationAttempts: [{
        stage: 'official-feed',
        outcome: records.length > 0 ? 'parsed' : 'empty',
        httpStatus: 200,
        records: records.length,
        rejectedRecords: 0,
        reason: null,
      }],
      stoppedByPolicy: false,
    },
  };
}

export async function fetchSmartRecruitersPublicCareersRecords(target, {
  fetchPublicCareersImpl = fetchSameDomainJsonLdRecords,
} = {}) {
  const publicPage = await fetchPublicCareersImpl({
    ...target,
    adapter: 'hosted-career-page',
    sourceUrl: target.careerPageUrl ?? target.sourceUrl,
    hostedAtsFamily: 'smartrecruiters',
  });
  return {
    records: publicPage.records.map((record) => ({
      ...record,
      raw_target_adapter: 'smartrecruiters-public-careers',
      hosted_ats_family: 'smartrecruiters',
      source_transport: publicPage.diagnostics?.escalationStage === 'rendered-dom'
        ? 'public-careers-rendered'
        : 'static-public-careers',
    })),
    diagnostics: publicPage.diagnostics,
  };
}

export function mapSmartRecruitersPostingsPayload(payload, target) {
  const postings = Array.isArray(payload?.content) ? payload.content : [];

  return postings.map((posting) => mapSmartRecruitersPosting(posting, target)).filter(Boolean);
}

function mapSmartRecruitersPosting(posting, target) {
  if (!posting || typeof posting !== 'object' || Array.isArray(posting)) return null;
  const externalId = toNonEmptyText(posting.id ?? posting.uuid);
  const jobTitle = toNonEmptyText(posting.name);
  const jobPostingUrl = toUrlOrNull(posting.postingUrl ?? posting.ref);
  const releasedDate = toNonEmptyText(posting.releasedDate);
  const occurredAt = toTimestampOrNull(releasedDate);
  if (!externalId || !jobTitle || !isOwnedSmartRecruitersPostingUrl(jobPostingUrl, target)) return null;
  if (releasedDate && !occurredAt) return null;

  return {
    company_name: target.companyName ?? toNonEmptyText(posting?.company?.name),
    company_domain: target.companyDomain,
    company_website_url: target.companyWebsiteUrl,
    career_page_url: target.careerPageUrl,
    job_posting_url: jobPostingUrl,
    job_title: jobTitle,
    external_id: externalId,
    location: toNonEmptyText(posting?.location?.fullLocation)
      ?? joinLocationParts(posting?.location?.city, posting?.location?.region, posting?.location?.country),
    employment_type: toNonEmptyText(posting?.typeOfEmployment?.label),
    occurred_at: occurredAt,
    tags: [posting?.department?.label, posting?.function?.label, posting?.industry?.label]
      .map(toNonEmptyText)
      .filter(Boolean),
    source_record_type: 'job_posting',
    extraction_method: 'smartrecruiters-posting-api',
    source_transport: 'official-api',
    raw_target_id: target.id,
    raw_target_adapter: target.adapter,
    raw: posting,
  };
}

function isOwnedSmartRecruitersPostingUrl(value, target) {
  if (!value) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const expectedSlug = extractSmartRecruitersSlug(target.careerPageUrl ?? target.sourceUrl)?.toLowerCase();
  if (!expectedSlug) return false;
  const parts = url.pathname.split('/').filter(Boolean);
  if (url.hostname.toLowerCase() === 'jobs.smartrecruiters.com') {
    return parts.length >= 2 && parts[0].toLowerCase() === expectedSlug;
  }
  if (url.hostname.toLowerCase() === 'api.smartrecruiters.com') {
    return parts.length >= 5
      && parts[0].toLowerCase() === 'v1'
      && parts[1].toLowerCase() === 'companies'
      && parts[2].toLowerCase() === expectedSlug
      && parts[3].toLowerCase() === 'postings';
  }
  return false;
}

export async function fetchTeamtailorRssRecords(target, { fetchTextImpl = fetchText } = {}) {
  const source = new URL(target.sourceUrl);
  const pageSize = Math.min(Math.max(Number(source.searchParams.get('per_page')) || 100, 1), 200);
  const initialOffset = Math.max(Number(source.searchParams.get('offset')) || 0, 0);
  const jobLimit = resolveTeamtailorJobLimit();
  const records = [];
  const seen = new Set();

  for (let offset = initialOffset; records.length < jobLimit; offset += pageSize) {
    const pageUrl = new URL(source);
    pageUrl.searchParams.set('per_page', String(pageSize));
    pageUrl.searchParams.set('offset', String(offset));
    const { body } = await fetchTextImpl(pageUrl.toString(), {
      sourceName: `career-pages target ${target.id}`,
      headers: {
        accept: 'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.1',
        'user-agent': 'RecruiterRadarCareerPages/1.0',
      },
    });
    const pageRecords = mapTeamtailorRss(body, target);
    for (const record of pageRecords) {
      const key = record.external_id ?? record.job_posting_url;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      records.push(record);
      if (records.length >= jobLimit) break;
    }
    if (pageRecords.length < pageSize) break;
  }
  return records;
}

export function mapTeamtailorRss(xml, target) {
  return mapPublicCareerRss(xml, target, 'teamtailor-rss');
}

export function mapPublicCareerRss(xml, target, method = 'public-career-rss') {
  return extractXmlBlocks(xml, 'item').map((item, index) => {
    const jobUrl = canonicalizePublicUrl(extractXmlValue(item, 'link'))
      ?? canonicalizePublicUrl(extractXmlValue(item, 'guid'));
    const department = toNonEmptyText(extractXmlValue(item, 'tt:department'));
    const role = toNonEmptyText(extractXmlValue(item, 'tt:role'));
    const categories = extractXmlValues(item, 'category').map(toNonEmptyText).filter(Boolean);
    return {
      company_name: target.companyName,
      company_domain: target.companyDomain,
      company_website_url: target.companyWebsiteUrl,
      career_page_url: target.careerPageUrl,
      job_posting_url: jobUrl,
      job_title: toNonEmptyText(extractXmlValue(item, 'title')),
      external_id: stringifyExternalId(
        extractXmlValue(item, 'guid') ?? jobUrl,
        target.id,
        index,
      ),
      occurred_at: toTimestampOrNull(extractXmlValue(item, 'pubDate')),
      location: extractTeamtailorLocation(item),
      department,
      role,
      remote_status: toNonEmptyText(extractXmlValue(item, 'remoteStatus')),
      tags: [...new Set([...categories, department, role].filter(Boolean))],
      source_record_type: 'job_posting',
      extraction_method: method,
      raw_target_id: target.id,
      raw_target_adapter: target.adapter,
      raw: { xml: item.slice(0, 20_000) },
    };
  });
}

function extractTeamtailorLocation(item) {
  const locations = extractXmlBlocks(item, 'tt:location')
    .map((location) => joinLocationParts(
      extractXmlValue(location, 'tt:name') ?? extractXmlValue(location, 'tt:city'),
      extractXmlValue(location, 'tt:country'),
    ))
    .filter(Boolean);
  return [...new Set(locations)].join(' | ') || null;
}

function resolveTeamtailorJobLimit() {
  const raw = Number(process.env.CAREER_PAGES_TEAMTAILOR_JOB_LIMIT);
  return Number.isFinite(raw) && raw >= 1 ? Math.min(Math.floor(raw), 5_000) : 1_000;
}

async function fetchPersonioXmlRecords(target) {
  const { body } = await fetchText(target.sourceUrl, {
    sourceName: `career-pages target ${target.id}`,
    headers: {
      accept: 'application/xml,text/xml;q=0.9,*/*;q=0.1',
      'user-agent': 'RecruiterRadarCareerPages/1.0',
    },
  });
  return mapPersonioXml(body, target);
}

export function mapPersonioXml(xml, target) {
  const baseUrl = toUrlOrNull(target.careerPageUrl ?? target.sourceUrl);
  return extractXmlBlocks(xml, 'position').map((position, index) => {
    const id = toNonEmptyText(extractXmlValue(position, 'id'));
    const directUrl = toUrlOrNull(
      extractXmlValue(position, 'jobUrl')
      ?? extractXmlValue(position, 'url'),
    );
    const jobUrl = directUrl ?? (id && baseUrl ? new URL(`/job/${encodeURIComponent(id)}`, baseUrl).toString() : null);
    return {
      company_name: target.companyName,
      company_domain: target.companyDomain,
      company_website_url: target.companyWebsiteUrl,
      career_page_url: target.careerPageUrl,
      job_posting_url: jobUrl,
      job_title: toNonEmptyText(extractXmlValue(position, 'name')),
      external_id: stringifyExternalId(id, target.id, index),
      location: joinLocationParts(
        extractXmlValue(position, 'office'),
        extractXmlValue(position, 'recruitingCategory'),
      ),
      employment_type: toNonEmptyText(extractXmlValue(position, 'employmentType')),
      occurred_at: toTimestampOrNull(
        extractXmlValue(position, 'createdAt') ?? extractXmlValue(position, 'updatedAt'),
      ),
      tags: [
        extractXmlValue(position, 'department'),
        extractXmlValue(position, 'schedule'),
      ].map(toNonEmptyText).filter(Boolean),
      source_record_type: 'job_posting',
      extraction_method: 'personio-xml',
      raw_target_id: target.id,
      raw_target_adapter: target.adapter,
      raw: { xml: position.slice(0, 20_000) },
    };
  });
}

function extractXmlBlocks(xml, tagName) {
  const text = typeof xml === 'string' ? xml : '';
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  return [...text.matchAll(pattern)].slice(0, 500).map((match) => match[1]);
}

function extractXmlValues(xml, tagName) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  return [...String(xml ?? '').matchAll(pattern)].slice(0, 50).map((match) => decodeXmlValue(match[1]));
}

function extractXmlValue(xml, tagName) {
  return extractXmlValues(xml, tagName)[0] ?? null;
}

function decodeXmlValue(value) {
  return String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function formatRecruiteeLocation(offer) {
  const locations = Array.isArray(offer?.locations)
    ? offer.locations.map((location) => toNonEmptyText(location?.name)
      ?? joinLocationParts(location?.city, location?.state, location?.country)).filter(Boolean)
    : [];
  return locations.join(' | ')
    || toNonEmptyText(offer?.location)
    || joinLocationParts(offer?.city, offer?.state_name, offer?.country);
}

function formatWorkableLocation(job) {
  const locations = Array.isArray(job?.locations)
    ? job.locations.map((location) => joinLocationParts(
      location?.city,
      location?.region ?? location?.state,
      location?.country,
    )).filter(Boolean)
    : [];
  return locations.join(' | ') || joinLocationParts(job?.city, job?.state, job?.country);
}

function joinLocationParts(...parts) {
  const values = parts.map(toNonEmptyText).filter(Boolean);
  return [...new Set(values)].join(', ') || null;
}

async function fetchSameDomainStaticRecords(target, { previous = null } = {}) {
  const fetchResult = await fetchHtmlPageDetailed(target.sourceUrl, { previous: previous ?? {} });
  if (shouldSkipExpensiveCareerFallback(previous, {
    ...fetchResult.diagnostics,
    extractionVersion: CAREER_EXTRACTION_VERSION,
  })) {
    return {
      records: [],
      diagnostics: {
        ...fetchResult.diagnostics,
        notModified: true,
        incrementalSkip: 'unchanged-static-content',
      },
      artifact: null,
    };
  }
  const page = fetchResult.page;

  if (!page) {
    return { records: [], diagnostics: fetchResult.diagnostics, artifact: null };
  }

  const careerPageUrl = page.url ?? target.careerPageUrl ?? target.sourceUrl;
  const seed = {
    companyName: target.companyName,
    companyDomain: target.companyDomain,
    companyWebsiteUrl: target.companyWebsiteUrl,
    careerPageUrl,
    sourceUrl: target.sourceUrl,
  };

  // Auto-discovery: the career-page HTML is already fetched, so extract the
  // concrete contact surface (HR/careers email, phone, Telegram, contact-form)
  // the company publishes on its OWN hiring page — exactly the data the agency
  // would otherwise open the page to find by hand. One pass per page, deduped,
  // capped, persisted on every record so the digest/lead-detail/FIUR paths all
  // see it. No fabrication: values are pulled verbatim from the page. Empty
  // when the page carries no contact surface — downstream reachability is then
  // gated honestly instead of silently zero (the pre-slice gap).
  seed.contactPaths = toPersistableContactPaths(
    extractCareerPageContactPaths(page.html, careerPageUrl),
  );

  // JSON-LD first: schema.org JobPosting markup is the structurally-trusted
  // surface (Яндекс.Работа / Google for Jobs). If present, it wins and the HTML
  // fallback is skipped to avoid double-counting the same vacancy.
  const postings = extractJobPostingsFromHtml(page.html);
  const jsonLdRecords = mapJsonLdJobPostings(postings, seed);

  if (jsonLdRecords.length > 0) {
    tagRecordsWithExtractionMethod(jsonLdRecords, 'jsonld');
    return {
      records: jsonLdRecords,
      diagnostics: { pageFetched: true, resolvedUrl: page.url },
      artifact: page,
    };
  }

  const hostedStructuredRecords = extractHostedStructuredRecords(page.html, target, seed);
  if (hostedStructuredRecords.length > 0) {
    return {
      records: hostedStructuredRecords,
      diagnostics: { pageFetched: true, resolvedUrl: page.url },
      artifact: page,
    };
  }

  // HTML-card fallback: many RU corporate career pages (Bitrix/1C-Bitrix,
  // custom CMS) publish vacancies as HTML cards with NO JSON-LD. Without this
  // fallback the company's direct hiring proof — the only gate-A/B originator
  // — is silently lost after the page was already fetched. The fallback is
  // guarded: title + same-domain URL required, no fabricated fields.
  const htmlCardRecords = extractVacancyCardsFromSameDomainHtml(page.html, seed);
  return {
    records: htmlCardRecords,
    diagnostics: { pageFetched: true, resolvedUrl: page.url },
    artifact: page,
  };
}

async function fetchSameDomainJsonLdRecords(target, {
  officialFeed = null,
  incrementalState = null,
} = {}) {
  const accessPolicy = await resolveCareerTargetAccessPolicy(target.sourceUrl, {
    allowedRobotsRedirectOrigins: target.hostedAtsFamily === 'smartrecruiters'
      ? ['https://jobs.smartrecruiters.com']
      : [],
  });
  if (accessPolicy.blocked || !isRobotsPathAllowed(target.sourceUrl, accessPolicy.robots)) {
    const reason = accessPolicy.blocked
      ? `access-policy:${accessPolicy.reason}`
      : 'access-policy:robots-disallowed';
    return {
      records: [],
      diagnostics: {
        errorCategory: reason,
        resolvedUrl: target.sourceUrl,
        escalationStage: null,
        escalationAttempts: [{
          stage: 'static-http',
          outcome: 'blocked',
          httpStatus: null,
          records: 0,
          rejectedRecords: 0,
          reason,
        }],
        stoppedByPolicy: true,
        robotsState: accessPolicy.robotsState,
      },
    };
  }

  const hostedOfficialFeed = officialFeed ?? resolveHostedOfficialFeed(target);
  const previousIncremental = incrementalState?.get(target.sourceUrl) ?? null;
  let staticResult = null;
  const seed = buildCareerExtractionSeed(target);
  const validatedRedirectHosts = new Set();
  const escalation = await runSourceEscalation({
    context: { target },
    validateRecord: (record) => validateCareerVacancyRecord(record, target, {
      additionalAllowedHosts: [...validatedRedirectHosts],
    }),
    stages: {
      'official-feed': hostedOfficialFeed
        ? async () => ({ records: await hostedOfficialFeed() })
        : undefined,
      'static-http': async () => {
        staticResult ??= await fetchSameDomainStaticRecords(target, { previous: previousIncremental });
        const validatedHost = extractHostname(staticResult.artifact?.url);
        if (validatedHost) validatedRedirectHosts.add(validatedHost);
        const errorCategory = staticResult.diagnostics?.errorCategory ?? null;
        if (staticResult.diagnostics?.incrementalSkip) {
          return {
            status: 'not-modified',
            terminal: true,
            artifact: staticResult,
            reason: staticResult.diagnostics.incrementalSkip,
          };
        }
        const httpStatus = parseHttpErrorCategory(errorCategory);
        if ([401, 403, 407, 451].includes(httpStatus)) {
          return { status: 'blocked', httpStatus, reason: errorCategory };
        }
        if (httpStatus === 429) {
          return { status: 'deferred', httpStatus, reason: errorCategory };
        }
        if (!staticResult.artifact) {
          return { status: 'error', reason: errorCategory ?? 'static-fetch-empty' };
        }
        if (looksLikeAccessChallenge(staticResult.artifact.html)) {
          return { status: 'blocked', accessControl: true, reason: 'access-challenge-page' };
        }
        return { artifact: staticResult };
      },
      'structured-data': async ({ artifact }) => ({
        records: artifact?.records ?? [],
      }),
      'rendered-dom': async () => {
        if (process.env.CAREER_PAGES_RENDERED_FALLBACK_ENABLED?.trim().toLowerCase() === 'false') {
          return { status: 'empty', reason: 'rendered-fallback-disabled' };
        }
        const page = await getCareerPageRenderPool().fetchPage({
          url: target.sourceUrl,
          timeoutMs: resolveRenderedFallbackTimeoutMs(),
          settleMs: resolveRenderedFallbackSettleMs(target),
          headers: { 'user-agent': 'RecruiterRadarCareerPages/1.0' },
        });
        if ([401, 403, 407, 451].includes(page.status)) {
          return { status: 'blocked', httpStatus: page.status, reason: `http-${page.status}` };
        }
        if (page.status === 429) {
          return { status: 'deferred', httpStatus: page.status, reason: 'http-429' };
        }
        if (page.status < 200 || page.status >= 400) {
          return { status: 'error', httpStatus: page.status, reason: `http-${page.status}` };
        }
        if (looksLikeAccessChallenge(page.html)) {
          return { status: 'blocked', accessControl: true, reason: 'access-challenge-page' };
        }
        const validatedHost = extractHostname(page.url);
        if (validatedHost) validatedRedirectHosts.add(validatedHost);
        const renderedSeed = {
          ...seed,
          careerPageUrl: page.url,
          sourceUrl: page.url,
        };
        const hostedDetailRecords = extractHostedStructuredRecords(page.html, target, renderedSeed);
        return {
          artifact: { page },
          records: hostedDetailRecords.length > 0
            ? hostedDetailRecords
            : extractDeterministicDomRecords(page.html, renderedSeed, 'playwright'),
        };
      },
      extraction: async () => {
        const extracted = await fetchExtractionMarkdown(target.sourceUrl);
        if (!extracted.available) {
          return { status: 'empty', reason: summarizeExtractionAttempts(extracted.attempts) };
        }
        return {
          artifact: { provider: extracted.provider },
          records: extractVacanciesFromMarkdown(extracted.markdown, seed, extracted.provider),
        };
      },
    },
  });

  if (staticResult?.diagnostics) {
    const diagnostics = staticResult.diagnostics;
    const hasIncrementalMetadata = diagnostics.contentHash
      || diagnostics.validators?.etag
      || diagnostics.validators?.lastModified;
    if (hasIncrementalMetadata) {
      incrementalState?.update(target.sourceUrl, {
        ...diagnostics.validators,
        contentHash: diagnostics.contentHash,
        reusableStatic: diagnostics.incrementalSkip
          ? previousIncremental?.reusableStatic === true
          : escalation.selectedStage === 'structured-data' && escalation.records.length > 0,
        selectedStage: diagnostics.incrementalSkip
          ? previousIncremental?.selectedStage
          : escalation.selectedStage,
        extractionVersion: CAREER_EXTRACTION_VERSION,
      });
    }
  }

  return {
    records: escalation.records,
    diagnostics: {
      ...(staticResult?.diagnostics ?? {}),
      resolvedUrl: escalation.artifact?.page?.url
        ?? staticResult?.diagnostics?.resolvedUrl
        ?? target.sourceUrl,
      escalationStage: escalation.selectedStage,
      escalationAttempts: escalation.attempts,
      stoppedByPolicy: escalation.stoppedByPolicy,
      notModified: escalation.attempts.some((attempt) => attempt.outcome === 'not-modified'),
    },
  };
}

function resolveHostedOfficialFeed(target) {
  if (target?.hostedAtsFamily === 'bamboohr') return () => fetchBambooHrPublicList(target);
  if (target?.hostedAtsFamily === 'oracle-cloud') return () => fetchOracleCloudSitemapRecords(target);
  if (target?.hostedAtsFamily === 'e-staff') return () => fetchEStaffSitemapRecords(target);
  if (target?.hostedAtsFamily !== 'pinpoint') return null;
  let source;
  try {
    source = new URL(target.sourceUrl);
  } catch {
    return null;
  }
  const rssUrl = new URL('/jobs.rss', source.origin).toString();
  return async () => {
    const { body } = await fetchText(rssUrl, {
      sourceName: `career-pages target ${target.id}`,
      headers: {
        accept: 'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.1',
        'user-agent': 'RecruiterRadarCareerPages/1.0',
      },
    });
    return mapPublicCareerRss(body, {
      ...target,
      careerPageUrl: target.careerPageUrl ?? target.sourceUrl,
    }, 'pinpoint-rss');
  };
}

export function extractEStaffSitemapVacancyUrls(xml, careerPageUrl) {
  let origin;
  try {
    origin = new URL(careerPageUrl).origin;
  } catch {
    return [];
  }
  const urls = [];
  const seen = new Set();
  for (const match of String(xml ?? '').matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
    const publicUrl = canonicalizePublicUrl(decodeHtmlUrl(match[1]));
    if (!publicUrl || seen.has(publicUrl)) continue;
    const parsed = new URL(publicUrl);
    if (parsed.origin !== origin || !isHostedAtsVacancyUrl(publicUrl, 'e-staff')) continue;
    seen.add(publicUrl);
    urls.push(publicUrl);
  }
  return urls;
}

async function fetchEStaffSitemapRecords(target) {
  const origin = new URL(target.sourceUrl).origin;
  const sitemapUrl = new URL('/sitemap.xml', origin).toString();
  const { body } = await fetchText(sitemapUrl, {
    sourceName: `career-pages target ${target.id}`,
    headers: {
      accept: 'application/xml,text/xml;q=0.9,*/*;q=0.1',
      'user-agent': 'RecruiterRadarCareerPages/1.0',
    },
  });
  const records = [];
  const urls = extractEStaffSitemapVacancyUrls(body, target.sourceUrl)
    .slice(0, resolveHostedFeedJobLimit());
  for (const jobUrl of urls) {
    const policy = await resolveCareerTargetAccessPolicy(jobUrl);
    if (policy.blocked || !isRobotsPathAllowed(jobUrl, policy.robots)) continue;
    const page = await fetchText(jobUrl, {
      sourceName: `career-pages target ${target.id}`,
      headers: {
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'user-agent': 'RecruiterRadarCareerPages/1.0',
      },
    });
    const record = extractHostedJobDetailRecord(page.body, jobUrl, target, 'e-staff-sitemap-detail');
    if (record) records.push(record);
  }
  return records;
}

async function fetchBambooHrPublicList(target) {
  const origin = new URL(target.sourceUrl).origin;
  const payload = await fetchJson(new URL('/careers/list', origin).toString(), target.id, {
    allowProxyRetry: false,
  });
  const jobs = Array.isArray(payload?.result) ? payload.result : [];
  return jobs.slice(0, 200).map((job, index) => {
    const id = toNonEmptyText(job?.id);
    return {
      company_name: target.companyName,
      company_domain: target.companyDomain,
      company_website_url: target.companyWebsiteUrl,
      career_page_url: target.careerPageUrl ?? target.sourceUrl,
      job_posting_url: id ? new URL(`/careers/${encodeURIComponent(id)}`, origin).toString() : null,
      job_title: toNonEmptyText(job?.jobOpeningName),
      external_id: stringifyExternalId(id, target.id, index),
      location: joinLocationParts(job?.location?.city, job?.location?.state, job?.atsLocation?.country),
      employment_type: toNonEmptyText(job?.employmentStatusLabel ?? job?.employmentType),
      occurred_at: null,
      source_record_type: 'job_posting',
      extraction_method: 'bamboohr-public-list',
      raw_target_id: target.id,
      raw_target_adapter: target.adapter,
      hosted_ats_family: 'bamboohr',
      raw: job,
    };
  });
}

async function fetchOracleCloudSitemapRecords(target) {
  const origin = new URL(target.sourceUrl).origin;
  const sitemapUrl = new URL('/hcmUI/CandidateExperience/sitemaps/jobpostings', origin).toString();
  const { body } = await fetchText(sitemapUrl, {
    sourceName: `career-pages target ${target.id}`,
    headers: {
      accept: 'application/xml,text/xml;q=0.9,*/*;q=0.1',
      'user-agent': 'RecruiterRadarCareerPages/1.0',
    },
  });
  const urls = extractXmlValues(body, 'loc')
    .map((value) => canonicalizePublicUrl(value))
    .filter((value) => value && new URL(value).origin === origin && /\/job\//i.test(new URL(value).pathname))
    .slice(0, resolveHostedFeedJobLimit());
  const records = [];
  for (const jobUrl of urls) {
    const page = await getCareerPageRenderPool().fetchPage({
      url: jobUrl,
      timeoutMs: resolveRenderedFallbackTimeoutMs(),
      settleMs: resolveRenderedFallbackSettleMs(target),
      headers: { 'user-agent': 'RecruiterRadarCareerPages/1.0' },
    });
    if (page.status < 200 || page.status >= 400 || looksLikeAccessChallenge(page.html)) continue;
    const record = extractHostedJobDetailRecord(page.html, jobUrl, target, 'oracle-cloud-sitemap-rendered');
    if (record) records.push(record);
  }
  return records;
}

function resolveHostedFeedJobLimit() {
  const raw = Number(process.env.CAREER_PAGES_HOSTED_FEED_JOB_LIMIT);
  return Number.isFinite(raw) && raw >= 1 ? Math.min(Math.floor(raw), 50) : 10;
}

function extractHostedStructuredRecords(html, target, seed) {
  if (target?.hostedAtsFamily === 'oracle-taleo') return extractTaleoJobListRecords(html, target, seed);
  if (isHostedAtsVacancyUrl(target?.sourceUrl, target?.hostedAtsFamily)) {
    const detail = extractHostedJobDetailRecord(
      html,
      target.sourceUrl,
      target,
      `${target.hostedAtsFamily}-public-detail`,
    );
    return detail ? [detail] : [];
  }
  return [];
}

function extractHostedJobDetailRecord(html, jobUrl, target, method) {
  const titleHtml = /<h1\b[^>]*(?:job-details__title|job-title|posting-headline)[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]
    ?? /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const title = cleanCardText(titleHtml);
  const publicUrl = canonicalizePublicUrl(jobUrl);
  if (!title || !publicUrl || !isPlausibleVacancyTitle(title)) return null;
  return {
    company_name: target.companyName,
    company_domain: target.companyDomain,
    company_website_url: target.companyWebsiteUrl,
    career_page_url: target.careerPageUrl ?? target.sourceUrl,
    job_posting_url: publicUrl,
    job_title: title,
    external_id: `${method}:${publicUrl}`,
    occurred_at: null,
    source_record_type: 'job_posting',
    extraction_method: method,
    raw_target_id: target.id,
    raw_target_adapter: target.adapter,
    hosted_ats_family: target.hostedAtsFamily,
    raw: { title, jobUrl: publicUrl },
  };
}

export function extractTaleoJobListRecords(html, target, seed = buildCareerExtractionSeed(target)) {
  const text = typeof html === 'string' ? html : '';
  const records = [];
  const seen = new Set();
  const pattern = /!\|!(\d+)!\|!([^!]{3,160}?)!\|!\1!\|!\2!\|!\1!\|!\1!\|!\1!\|!\1!\|!\1!\|!([A-Z0-9]+)!\|!/g;
  let match;
  while ((match = pattern.exec(text)) !== null && records.length < 200) {
    const title = cleanCardText(match[2]);
    const requisitionId = toNonEmptyText(match[3]);
    if (!title || !requisitionId || !isPlausibleVacancyTitle(title) || seen.has(requisitionId)) continue;
    seen.add(requisitionId);
    const source = new URL(target.sourceUrl);
    source.pathname = source.pathname.replace(/job(?:search|list)\.ftl$/i, 'jobdetail.ftl');
    source.search = '';
    source.searchParams.set('job', requisitionId);
    records.push({
      company_name: seed.companyName,
      company_domain: seed.companyDomain,
      company_website_url: seed.companyWebsiteUrl,
      career_page_url: seed.careerPageUrl,
      job_posting_url: source.toString(),
      job_title: title,
      external_id: requisitionId,
      occurred_at: null,
      source_record_type: 'job_posting',
      extraction_method: 'taleo-public-joblist',
      raw_target_id: target.id,
      raw_target_adapter: target.adapter,
      hosted_ats_family: 'oracle-taleo',
      raw: { requisitionId, title, taleoInternalId: match[1] },
    });
  }
  return records;
}

function buildCareerExtractionSeed(target) {
  return {
    companyName: target.companyName,
    companyDomain: target.companyDomain,
    companyWebsiteUrl: target.companyWebsiteUrl,
    careerPageUrl: target.careerPageUrl ?? target.sourceUrl,
    sourceUrl: target.sourceUrl,
  };
}

function extractDeterministicDomRecords(html, seed, prefix) {
  const jsonLdRecords = mapJsonLdJobPostings(extractJobPostingsFromHtml(html), seed);
  if (jsonLdRecords.length > 0) {
    return tagRecordsWithExtractionMethod(jsonLdRecords, `${prefix}-jsonld`);
  }
  return tagRecordsWithExtractionMethod(
    extractVacancyCardsFromSameDomainHtml(html, seed),
    `${prefix}-dom`,
  );
}

export function extractVacanciesFromMarkdown(markdown, seed, provider = 'extraction') {
  const text = typeof markdown === 'string' ? markdown : '';
  const careerPageUrl = toUrlOrNull(seed?.careerPageUrl ?? seed?.sourceUrl);
  if (!text || !careerPageUrl) return [];

  const records = [];
  const seen = new Set();
  const linkPattern = /\[([^\]\n]{3,160})\]\((https?:\/\/[^\s)]+)\)/g;
  let match;
  while ((match = linkPattern.exec(text)) !== null && records.length < 200) {
    const title = cleanCardText(match[1]);
    const vacancyUrl = canonicalizePublicUrl(match[2]);
    if (!title || !vacancyUrl || !isPlausibleVacancyTitle(title)) continue;
    const key = normalizeUrlForDedupe(vacancyUrl);
    if (seen.has(key)) continue;
    seen.add(key);
    records.push({
      company_name: seed.companyName ?? null,
      company_domain: seed.companyDomain ?? null,
      company_website_url: seed.companyWebsiteUrl ?? null,
      career_page_url: careerPageUrl,
      job_posting_url: vacancyUrl,
      job_title: title,
      external_id: `${provider}:${vacancyUrl}`,
      occurred_at: null,
      source_record_type: 'job_posting',
      raw_target_adapter: 'extraction-markdown',
      extraction_method: `${provider}-markdown`,
      raw: { title, vacancyUrl, provider },
    });
  }
  return records;
}

export function validateCareerVacancyRecord(record, target, { additionalAllowedHosts = [] } = {}) {
  const expectedCompany = toNonEmptyText(target?.companyName);
  const actualCompany = toNonEmptyText(record?.company_name ?? record?.companyName);
  const title = toNonEmptyText(record?.job_title ?? record?.jobTitle ?? record?.title);
  const publicUrl = canonicalizePublicUrl(
    record?.job_posting_url ?? record?.jobPostingUrl ?? record?.url,
  );
  if (!expectedCompany || !actualCompany || !title || !publicUrl) return false;
  if (normalizeCompanyValidationName(expectedCompany) !== normalizeCompanyValidationName(actualCompany)) return false;
  if (!isPlausibleVacancyTitle(title)) return false;

  const allowedHosts = [
    target?.sourceUrl,
    target?.careerPageUrl,
    target?.companyWebsiteUrl,
    ...additionalAllowedHosts,
  ].map((value) => extractHostname(value) ?? normalizeDomain(value)).filter(Boolean);
  const recordHost = extractHostname(publicUrl);
  const hostAllowed = Boolean(recordHost && allowedHosts.some((host) => (
    recordHost === host || recordHost.endsWith(`.${host}`) || host.endsWith(`.${recordHost}`)
  )));
  return hostAllowed && isHostedAtsVacancyUrl(publicUrl, target?.hostedAtsFamily);
}

function normalizeCompanyValidationName(value) {
  const legalSuffixes = new Set([
    'inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'company', 'co',
    'plc', 'gmbh', 'ag', 'sa', 'sas', 'sarl', 'bv', 'nv', 'ооо', 'оао', 'пао', 'ао', 'зао',
  ]);
  const parts = String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  while (parts.length > 1 && legalSuffixes.has(parts.at(-1))) parts.pop();
  return parts.join(' ');
}

export function isHostedAtsVacancyUrl(value, family) {
  if (!family) return true;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const path = url.pathname;
  const patterns = {
    workday: /\/job\//i,
    teamtailor: /\/jobs\/\d[^/]*(?:\/|$)/i,
    personio: /\/job\/\d+(?:\/|$)/i,
    bamboohr: /\/(?:careers?|jobs?)\/(?:job\/)?\d+(?:\/|$)/i,
    pinpoint: /\/jobs\/\d+(?:[-/]|$)/i,
    breezy: /\/p\/[a-f0-9]+(?:[-/]|$)/i,
    comeet: /\/jobs\/[^/]+\/[^/]+\/[^/]+(?:\/|$)/i,
    jazzhr: /\/apply\/[A-Za-z0-9_-]+(?:\/|$)/i,
    icims: /\/jobs\/\d+(?:\/|$)/i,
    'oracle-taleo': /\/jobdetail\.ftl(?:\?|$)/i,
    'oracle-cloud': /\/job\//i,
    'sap-successfactors': /(?:\/job\/|[?&](?:career_job_req_id|jobId)=)/i,
    smartrecruiters: /(?:\/job\/[^/]+(?:\/|$)|^\/[A-Za-z0-9_-]+\/\d{6,}(?:[-/]|$))/i,
    potok: /\/open\/jobs\/\d+(?:\/|$)/i,
    huntflow: /\/(?:vacancy|jobs?)\/[^/]+(?:\/|$)/i,
    skillaz: /\/(?:vacanc(?:y|ies)|jobs?)\/[^/]+(?:\/|$)/i,
    friendwork: /(?:\/(?:vacanc(?:y|ies)|jobs?)\/[^/]+(?:\/|$)|^\/[^/]+\/\d+\/?$)/i,
    talantix: /\/(?:form|ats\/vacancy)\/[^/]+(?:\/|$)/i,
    'e-staff': /^\/vacancies\/[^/?#]+(?:\/|$)/i,
  };
  return patterns[family]?.test(`${path}${url.search}`) ?? true;
}

async function resolveCareerTargetAccessPolicy(value, { allowedRobotsRedirectOrigins = [] } = {}) {
  const publicUrl = canonicalizePublicUrl(value, { keepTracking: true });
  if (!publicUrl) {
    return { blocked: true, reason: 'invalid-public-url', robotsState: 'invalid', robots: { rules: [] } };
  }
  const origin = new URL(publicUrl).origin;
  const cacheKey = `${origin}|${[...allowedRobotsRedirectOrigins].sort().join(',')}`;
  let pending = careerPageAccessPolicyCache.get(cacheKey);
  if (!pending) {
    pending = resolvePublicRobotsPolicy(origin, { allowedRedirectOrigins: allowedRobotsRedirectOrigins });
    careerPageAccessPolicyCache.set(cacheKey, pending);
  }
  const discovery = await pending;
  return {
    blocked: discovery.blocked,
    reason: discovery.reason ?? discovery.errors?.[0] ?? 'blocked',
    robotsState: discovery.robotsState,
    robots: discovery.robots ?? { rules: [] },
  };
}

function parseHttpErrorCategory(value) {
  const match = typeof value === 'string' ? value.match(/^http-(\d{3})$/) : null;
  return match ? Number(match[1]) : null;
}

function looksLikeAccessChallenge(html) {
  const sample = typeof html === 'string' ? html.slice(0, 200_000) : '';
  return /(?:cf-chl-|cloudflare\s+ray\s+id|<title[^>]*>[^<]*(?:captcha|verify\s+(?:you\s+are\s+)?human|access\s+denied|attention\s+required)|id=["'](?:captcha|challenge)["'])/i.test(sample);
}

function summarizeExtractionAttempts(attempts) {
  if (!Array.isArray(attempts) || attempts.length === 0) return 'extraction-provider-not-configured';
  return attempts.map((attempt) => `${attempt.provider}:${attempt.outcome}`).join(',').slice(0, 240);
}

function getCareerPageRenderPool() {
  careerPageRenderPool ??= createPlaywrightBrowserPool();
  return careerPageRenderPool;
}

async function closeCareerPageRenderPool() {
  const pool = careerPageRenderPool;
  careerPageRenderPool = null;
  if (pool) await pool.close();
}

function resolveRenderedFallbackTimeoutMs() {
  const raw = Number(process.env.CAREER_PAGES_RENDER_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 1_000 ? Math.min(Math.floor(raw), 120_000) : 30_000;
}

function resolveRenderedFallbackSettleMs(target) {
  const raw = Number(process.env.CAREER_PAGES_RENDER_SETTLE_MS);
  if (Number.isFinite(raw) && raw >= 0) return Math.min(Math.floor(raw), 15_000);
  return target?.hostedAtsFamily ? 5_000 : 1_500;
}

function tagRecordsWithExtractionMethod(records, method) {
  for (const record of records) {
    record.extraction_method = method;
  }
  return records;
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

async function fetchJson(url, targetId, { allowProxyRetry = true } = {}) {
  const requestOptions = {
    sourceName: `career-pages target ${targetId}`,
    headers: {
      accept: 'application/json, text/plain;q=0.9, */*;q=0.1',
      'user-agent': 'RecruiterRadarCareerPages/1.0',
    },
  };
  try {
    return await fetchJsonWithPolicy(url, requestOptions);
  } catch (error) {
    const proxyUrl = process.env.PUBLIC_ATS_PROXY_URL?.trim() || process.env.HH_PROXY_URL?.trim();

    // Some otherwise-public ATS endpoints reject the production datacenter IP
    // while remaining accessible through the already-configured compliant
    // source egress. Retry only an explicit 403, never hide other failures.
    if (allowProxyRetry && error?.status === 403 && proxyUrl) {
      const { resolveHhProxyDispatcher, resolveHhProxyFetch } = await import('./adapters/hh.mjs');
      const proxyEnv = { HH_PROXY_URL: proxyUrl };
      return fetchJsonWithPolicy(url, {
        ...requestOptions,
        dispatcher: resolveHhProxyDispatcher(proxyEnv),
        fetchImpl: resolveHhProxyFetch(proxyEnv),
      });
    }

    throw new Error(
      `career-pages target ${targetId} fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export function buildNormalizedInput({ records, inputMode, inputFilePath, targetsFilePath, fetchOutputPath, targetResults, discoverySummary, targetsTotal = null, budgetExhausted = false, rejectAllSkipped = false }) {
  const fetchedAt = new Date().toISOString();
  const sensitiveFieldsDropped = records.reduce((total, record) => total + countSensitiveFields(record), 0);
  const sanitizedRecords = records.map((record) => dropSensitiveFields(record));
  const normalizedRecords = [];
  let skippedRecords = 0;

  for (const [index, record] of sanitizedRecords.entries()) {
    const normalizedRecord = normalizeCareerPageRecord(record, fetchedAt, index + 1);

    if (!normalizedRecord) {
      skippedRecords += 1;
      continue;
    }

    normalizedRecords.push(normalizedRecord);
  }

  // Provider-local IDs are not globally unique (many boards use small numeric
  // IDs). Namespace fetch-time dedupe by concrete source so unrelated ATS
  // vacancies cannot suppress one another before canonical cross-source
  // vacancy reconciliation preserves their separate provenance edges.
  const dedupeKey = (record) => `${record.sourceId}:${record.signalExternalId}`;
  const dedupeResult = dedupeNormalizedRecords(normalizedRecords, dedupeKey);
  const familyDuplicateCounts = {};
  for (const family of new Set(normalizedRecords.map((record) => record.healthFamily))) {
    const familyRecords = normalizedRecords.filter((record) => record.healthFamily === family);
    familyDuplicateCounts[family] = dedupeNormalizedRecords(familyRecords, dedupeKey).duplicateRecords;
  }

  // Live crawl must fail loudly when the fetcher returns records but the
  // normalizer drops every one of them (markup drift, key mismatch). Without
  // this the pipeline silently reports 0 leads — the exact habr-career
  // "N records but 0 normalized" failure mode the provider contract guards.
  // File mode stays permissive: an empty/all-skipped snapshot is legitimate.
  if (rejectAllSkipped) {
    assertProviderNormalization({
      sourceId: SOURCE_ID,
      recordsReceived: records.length,
      normalizedRecords: dedupeResult.records,
      skippedRecords,
    });
  }

  return {
    inputMode,
    inputFilePath,
    targetsFilePath,
    fetchOutputPath,
    targetsProcessed: targetResults.length,
    targetsTotal: targetsTotal ?? targetResults.length,
    budgetExhausted,
    targetResults,
    discoverySummary: discoverySummary ?? null,
    recordsReceived: records.length,
    recordsAfterDedupe: dedupeResult.records.length,
    duplicateRecords: dedupeResult.duplicateRecords,
    familyDuplicateCounts,
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

export async function ingestCareerPages({ connectionString, input, persistenceMode = 'batch' }) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: dbConnectionTimeoutMillis,
  });

  let orgUpsertCount = 0;
  let signalUpsertCount = 0;
  let evidenceUpsertCount = 0;
  let evidenceCreatedCount = 0;
  let lineageCreatedCount = 0;
  let organizationResolutionRejects = 0;
  const organizationResolutionRejectedTargetKeys = new Set();
  const familyIngestionStats = {};

  await client.connect();

  try {
    await client.query('BEGIN');

    if (persistenceMode === 'legacy') {
      for (const record of input.normalizedRecords) {
        let orgUpsertResult;
        try {
          orgUpsertResult = await upsertOrgSourceRef(client, record);
        } catch (error) {
          if (!isOrganizationIdentityConflict(error)) throw error;
          organizationResolutionRejects += 1;
          addRejectedTargetKeys(organizationResolutionRejectedTargetKeys, [record]);
          continue;
        }
        orgUpsertCount += orgUpsertResult.insertedOrg ? 1 : 0;
        const lineage = await upsertSignalEvidenceLineage(
          client,
          buildCareerLineageInput(record, orgUpsertResult),
        );
        signalUpsertCount += lineage.signalUpsertCount;
        evidenceUpsertCount += lineage.evidenceUpsertCount;
        evidenceCreatedCount += lineage.evidenceCreatedCount;
        lineageCreatedCount += lineage.lineageCreatedCount;
        const familyStats = familyIngestionStats[record.healthFamily] ??= {
          signalUpsertCount: 0,
          evidenceCreatedCount: 0,
        };
        familyStats.signalUpsertCount += lineage.signalUpsertCount;
        familyStats.evidenceCreatedCount += lineage.evidenceCreatedCount;
      }
    } else if (persistenceMode === 'batch') {
      const recordsByOrganization = new Map();
      for (const record of input.normalizedRecords) {
        const identityKey = JSON.stringify([
          record.sourceId,
          record.primarySourceKey,
          [...record.orgSourceKeys].sort(),
          [...record.orgSourceAliasKeys].sort(),
          record.companyDomain,
        ]);
        const group = recordsByOrganization.get(identityKey) ?? [];
        group.push(record);
        recordsByOrganization.set(identityKey, group);
      }

      const lineageInputs = [];
      for (const records of recordsByOrganization.values()) {
        let orgUpsertResult;
        try {
          orgUpsertResult = await upsertOrgSourceRef(client, records[0]);
        } catch (error) {
          if (!isOrganizationIdentityConflict(error)) throw error;
          organizationResolutionRejects += records.length;
          addRejectedTargetKeys(organizationResolutionRejectedTargetKeys, records);
          continue;
        }
        orgUpsertCount += orgUpsertResult.insertedOrg ? 1 : 0;
        for (const record of records) {
          lineageInputs.push(buildCareerLineageInput(record, orgUpsertResult));
        }
      }

      const lineage = await upsertSignalEvidenceLineageBatch(client, lineageInputs);
      signalUpsertCount = lineage.signalUpsertCount;
      evidenceUpsertCount = lineage.evidenceUpsertCount;
      evidenceCreatedCount = lineage.evidenceCreatedCount;
      lineageCreatedCount = lineage.lineageCreatedCount;
      Object.assign(familyIngestionStats, lineage.familyIngestionStats ?? {});
    } else {
      throw new Error(`Unsupported career-pages persistence mode: ${persistenceMode}`);
    }

    input.organizationResolutionRejects = organizationResolutionRejects;
    if (input.normalizedRecords.length > 0
      && organizationResolutionRejects === input.normalizedRecords.length) {
      throw new Error('organization identity conflict: career-pages rejected every normalized record at the identity gate.');
    }

    await client.query('COMMIT');

    return {
      orgUpsertCount,
      signalUpsertCount,
      evidenceUpsertCount,
      evidenceCreatedCount,
      lineageCreatedCount,
      familyIngestionStats,
      organizationResolutionRejects,
      organizationResolutionRejectedTargetKeys: [...organizationResolutionRejectedTargetKeys].sort(),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

function addRejectedTargetKeys(targetKeys, records) {
  for (const record of records) {
    const targetKey = toNonEmptyText(
      record?.rawRecord?.raw_target_id ?? record?.rawRecord?.rawTargetId,
    );
    if (targetKey) targetKeys.add(targetKey);
  }
}

async function upsertOrgSourceRef(client, record) {
  // The shared resolver acquires deterministic source-local and validated
  // strong-key locks before it selects an existing owner or permits creation.
  const resolution = await resolveOrganizationOwner(client, record.sourceId, record);
  let orgId = resolution.orgId;
  let insertedOrg = false;

  if (!orgId) {
    // Insert with NULL domain first; domain + career_page_url are set afterwards
    // via the savepoint-protected UPDATE below so a unique-index conflict on
    // LOWER(domain) (an org with the same domain already exists under a different
    // source) can never abort this batch. Mirrors ingest-hh.mjs setOrgDomain.
    const insertedOrgResult = await client.query(
      `
        INSERT INTO orgs (name, website_url)
        VALUES ($1, $2)
        RETURNING id
      `,
      [record.orgName, record.companyWebsiteUrl],
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
        record.sourceId,
        sourceKey,
        sourceKey === record.primarySourceKey ? record.orgExternalId : null,
        record.orgDisplayName,
        buildOrgSourceMetadata(record, sourceKey),
      ],
    );
    await assertOrgSourceRefOwner(client, record.sourceId, sourceKey, orgId);
  }

  // Name / website_url / career_page_url are conflict-free (no unique index on
  // them) — update them directly. career_page_url is the field AI enrichment
  // reads, so it MUST land even when domain cannot.
  await client.query(
    `
      UPDATE orgs
      SET
        name = CASE
          WHEN $2::text IS NULL OR BTRIM($2::text) = '' THEN name
          WHEN name IS NULL OR BTRIM(name) = '' OR name = $5::text THEN $2::text
          ELSE name
        END,
        website_url = CASE
          WHEN $3::text IS NULL OR BTRIM($3::text) = '' THEN website_url
          WHEN website_url IS NULL OR BTRIM(website_url) = '' THEN $3::text
          ELSE website_url
        END,
        career_page_url = CASE
          WHEN $4::text IS NULL OR BTRIM($4::text) = '' THEN career_page_url
          WHEN career_page_url IS NULL OR BTRIM(career_page_url) = '' THEN $4::text
          ELSE career_page_url
        END
      WHERE id = $1::bigint
    `,
    [
      orgId,
      record.orgDisplayName,
      record.companyWebsiteUrl,
      record.careerPageUrl ?? null,
      buildFallbackOrgName(record),
    ],
  );

  // Domain is set separately under a savepoint: orgs has a UNIQUE index on
  // LOWER(domain), so a conflict (same domain under another source) must not
  // abort the batch. Domain is non-critical — the read side falls back to
  // website_url. Mirrors ingest-hh.mjs setOrgDomain.
  await setOrgDomainSavepoint(client, orgId, record.companyDomain);

  return {
    orgId,
    insertedOrg,
    resolutionReason: resolution.resolutionReason,
  };
}

// Best-effort domain enrichment. orgs has a UNIQUE index on LOWER(domain), so a
// conflict (the same domain already claimed by another source) must not abort
// the batch. We only set domain when the org has none and no other org owns it,
// wrapped in a SAVEPOINT that swallows SQLSTATE 23505. Domain is non-critical —
// the read side falls back to website_url. Mirrors ingest-hh.mjs setOrgDomain.
async function setOrgDomainSavepoint(client, orgId, domain) {
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
            WHERE other.id <> $1 AND LOWER(other.domain) = LOWER($2)
          )
      `,
      [orgId, domain],
    );
    await client.query('RELEASE SAVEPOINT set_org_domain');
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT set_org_domain');
    const sqlstate = error?.code ?? '';
    if (sqlstate !== '23505') throw error;
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
  const sourceId = resolveCareerPageSourceId(record.raw_target_adapter);
  const extractionMethod = toNonEmptyText(record.extraction_method) ?? 'unknown';
  const sourceTransport = toNonEmptyText(record.source_transport);
  const hostedAtsFamily = toNonEmptyText(record.hosted_ats_family);
  const healthFamily = resolveCareerPagesHealthFamily({
    hostedAtsFamily,
    adapter: record.raw_target_adapter,
    sourceId,
  });
  const location = toNonEmptyText(record.location ?? record.city ?? record.area_name);
  const pageTitle = toNonEmptyText(record.page_title);
  const employmentType = toNonEmptyText(record.employment_type);
  const salary = toNonEmptyText(record.salary ?? record.compensation);
  const orgExternalId = toNonEmptyText(record.org_external_id ?? record.company_id ?? record.employer_id);
  // Contact surface extracted from the career-page HTML (see
  // extractCareerPageContactPaths). Normalized to a compact array; null/empty
  // → [] so the payload field is always a stable array downstream.
  const contactPaths = Array.isArray(record.contact_paths)
    ? record.contact_paths.filter(
      (p) => p && typeof p === 'object' && typeof p.category === 'string' && typeof p.value === 'string',
    ).map((p) => ({ category: p.category, value: p.value }))
    : [];
  const rfQuality = buildRfJobQuality({
    companyName,
    jobTitle,
    location,
    salary,
    employmentType,
    occurredAt,
    fetchedAt,
    board: SOURCE_ID,
  });

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
    sourceId,
    extractionMethod,
    sourceTransport,
    hostedAtsFamily,
    healthFamily,
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
    russianLegalNameSourceKey,
    orgSourceKeys,
    orgSourceAliasKeys,
    signalExternalId,
    contactPaths,
  };
}

export function resolveCareerPageSourceId(adapter) {
  const sourceByAdapter = {
    'greenhouse-board': 'greenhouse',
    'lever-postings': 'lever',
    'ashby-job-board': 'ashby',
    'recruitee-careers': 'recruitee',
    'workable-public-jobs': 'workable',
    'smartrecruiters-postings': 'smartrecruiters',
    'smartrecruiters-public-careers': 'smartrecruiters',
  };
  return sourceByAdapter[toNonEmptyText(adapter)] ?? SOURCE_ID;
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
    parsedRecords: input.recordsReceived,
    recordsAfterDedupe: input.recordsAfterDedupe ?? input.normalizedRecords.length,
    duplicateRecords: input.duplicateRecords,
    normalizedRecords: input.normalizedRecords.length,
    skippedRecords: input.skippedRecords,
    sensitiveFieldsDropped: input.sensitiveFieldsDropped ?? 0,
    // Extraction-quality observability: how many targets yielded records by
    // each extractor, and how many discovered same-domain career pages had
    // NEITHER JSON-LD nor usable HTML cards (extractionMethod 'none'). The
    // 'none' count is the previously-silent gap — a discovered+ fetched direct
    // surface that produced 0 evidence. Surfaced here so source quality is
    // inspectable from the fetch summary without a DB query.
    extractionBreakdown: summarizeExtractionBreakdown(input.targetResults),
    health: buildHealthForInput(input),
  };
}

function summarizeExtractionBreakdown(targetResults) {
  const breakdown = { jsonld: 0, 'html-card-fallback': 0, 'greenhouse-api': 0, 'lever-api': 0, 'json-feed': 0, 'static-records': 0, none: 0, other: 0 };
  let zeroRecordSameDomain = 0;
  if (!Array.isArray(targetResults)) return { ...breakdown, zeroRecordSameDomainTargets: 0 };
  for (const result of targetResults) {
    const method = toNonEmptyText(result?.extractionMethod) ?? 'other';
    if (Object.prototype.hasOwnProperty.call(breakdown, method)) {
      breakdown[method] += 1;
    } else {
      breakdown.other += 1;
    }
    if (method === 'none' && (result?.adapter === 'same-domain-jsonld')) {
      zeroRecordSameDomain += 1;
    }
  }
  return { ...breakdown, zeroRecordSameDomainTargets: zeroRecordSameDomain };
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
    parsedRecords: input.recordsReceived,
    recordsAfterDedupe: input.recordsAfterDedupe ?? input.normalizedRecords.length,
    duplicateRecords: input.duplicateRecords,
    normalizedRecords: input.normalizedRecords.length,
    skippedRecords: input.skippedRecords,
    sensitiveFieldsDropped: input.sensitiveFieldsDropped ?? 0,
    extractionBreakdown: summarizeExtractionBreakdown(input.targetResults),
    orgsCreated: stats.orgUpsertCount,
    signalUpsertsCompleted: stats.signalUpsertCount,
    evidenceUpsertsCompleted: stats.evidenceUpsertCount,
    evidenceCreated: stats.evidenceCreatedCount,
    lineageCreated: stats.lineageCreatedCount,
    organizationResolutionRejects: stats.organizationResolutionRejects,
    organizationResolutionRejectedTargetKeys: stats.organizationResolutionRejectedTargetKeys,
    zeroReason: resolveSuccessfulIngestZeroReason(input, stats),
    health: buildHealthForInput(input, stats),
  };
}

function buildCareerLineageInput(record, orgUpsertResult) {
  return {
    orgId: orgUpsertResult.orgId,
    signalType: 'job_posting',
    source: record.sourceId,
    sourceFamily: 'company-owned-career',
    externalId: record.signalExternalId,
    headline: record.jobTitle,
    summary: buildSignalSummary(record),
    sourceUrl: record.jobPostingUrl,
    publishedAt: record.occurredAt,
    normalizedAt: record.fetchedAt,
    payload: buildSignalPayload(record),
    sourceRecordType: record.sourceRecordType,
    evidenceTier: 'direct',
    extractionMethod: record.extractionMethod,
    organizationResolutionReason: orgUpsertResult.resolutionReason,
    healthFamily: record.healthFamily,
  };
}

function buildHealthForInput(input, stats = null) {
  const current = buildCareerPagesHealth({
    targetResults: input.targetResults,
    recordsReceived: input.recordsReceived,
    recordsAfterDedupe: input.recordsAfterDedupe,
    duplicateRecords: input.duplicateRecords,
    skippedRecords: input.skippedRecords,
    ingestionStats: stats,
    familyIngestionStats: stats?.familyIngestionStats,
    familyDuplicateCounts: input.familyDuplicateCounts,
  });
  const previous = loadCareerPagesHealthState();
  return {
    ...current,
    generatedAt: new Date().toISOString(),
    anomalies: detectCareerPagesHealthAnomalies(current, previous),
  };
}

function loadCareerPagesHealthState() {
  const statePath = resolveCareerPagesHealthStatePath();
  if (!existsSync(statePath)) return null;
  try {
    return parseJson(stripBom(readFileSync(statePath, 'utf8')), statePath);
  } catch {
    return null;
  }
}

function persistCareerPagesHealth(health) {
  if (!health) return;
  const statePath = resolveCareerPagesHealthStatePath();
  const temporaryPath = `${statePath}.tmp`;
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(temporaryPath, `${JSON.stringify(health, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, statePath);
}

function resolveCareerPagesHealthStatePath() {
  const configured = process.env.CAREER_PAGES_HEALTH_STATE_FILE?.trim();
  return resolve(process.cwd(), configured || defaultHealthStatePath);
}

function resolveCareerPagesIncrementalStatePath() {
  const configured = process.env.CAREER_PAGES_INCREMENTAL_STATE_FILE?.trim();
  return resolve(process.cwd(), configured || defaultIncrementalStatePath);
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
    source: record.sourceId,
    source_key: sourceKey,
    source_alias_keys: buildSourceKeyAliases(record.orgSourceKeys, record.orgSourceAliasKeys, sourceKey),
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
    source: record.sourceId,
    source_entity_type: 'company',
    source_entity_key: record.primarySourceKey,
    source_entity_alias_keys: buildSourceKeyAliases(record.orgSourceKeys, record.orgSourceAliasKeys, record.primarySourceKey),
    source_entity_external_id: record.orgExternalId,
    source_entity_display_name: record.orgDisplayName,
    source_entity_name: record.orgName,
    source_record_type: record.sourceRecordType,
    source_record_id: record.signalExternalId,
    source_record_title: record.jobTitle,
    source_record_url: record.jobPostingUrl,
    source_record_published_at: record.occurredAt,
    extraction_method: record.extractionMethod,
    source_transport: record.sourceTransport,
    org_source_key: record.primarySourceKey,
    company_name: record.companyName,
    company_domain: record.companyDomain,
    company_website_url: record.companyWebsiteUrl,
    career_page_url: record.careerPageUrl,
    job_posting_url: record.jobPostingUrl,
    job_title: record.jobTitle,
    location: record.location,
    region_canonical: record.regionCanonical,
    page_title: record.pageTitle,
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
    // Auto-discovered contact surface from the career-page HTML (HR/careers
    // email, phone, Telegram, contact-form). Stable array; [] when the page
    // exposed no contact surface. Read by the digest SQL query, lead-detail,
    // and FIUR reachability so the agency sees the concrete path the system
    // found — not just "there is a career page".
    contact_paths: record.contactPaths ?? [],
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

// loadEnvFile moved to ./lib/common-utils.mjs

export function resolveCareerPagesFetchOutputPath() {
  const configuredPath = process.env.CAREER_PAGES_FETCH_OUTPUT_FILE?.trim();
  return resolve(process.cwd(), configuredPath || defaultFetchOutputPath);
}

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

export function stringifyExternalId(value, targetId, index) {
  const normalizedValue = toNonEmptyText(value);
  return normalizedValue ?? `${targetId}:${index + 1}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runScriptCli('source-career-pages', runCareerPagesCli);
}
