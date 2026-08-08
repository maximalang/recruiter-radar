import pg from 'pg';

import { fetchCompanyPage } from './adapters/company-site-crawl.mjs';
import { writeEvidence } from './lib/evidence-writer.mjs';

const { Client } = pg;
const SOURCE_ID = 'company-site';
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;
const MAX_ATTEMPTS = 3;
const RETRY_HOURS = 12;
const CAREER_PATHS = Object.freeze([
  '/careers',
  '/career',
  '/jobs',
  '/vacancies',
  '/vacancy',
  '/rabota',
]);
const CAREER_SIGNAL_CODES = new Set([
  'hiring_section',
  'active_hiring',
  'open_positions',
]);

function parseArgs(argv) {
  const result = { workspaceId: null, limit: DEFAULT_LIMIT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workspace-id') result.workspaceId = argv[++index] ?? null;
    else if (arg === '--limit') result.limit = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  result.workspaceId = positiveId(result.workspaceId, 'workspace');
  if (!Number.isInteger(result.limit) || result.limit < 1 || result.limit > MAX_LIMIT) {
    throw new Error(`--limit must be between 1 and ${MAX_LIMIT}`);
  }
  return result;
}

export async function processCommercialSignalEnrichment({
  connectionString,
  workspaceId,
  limit = DEFAULT_LIMIT,
  now = new Date(),
}) {
  const normalizedWorkspaceId = positiveId(workspaceId, 'workspace');
  const boundedLimit = integerBetween(limit, 1, MAX_LIMIT, 'limit');
  const evaluationTime = validDate(now);
  const client = new Client({ connectionString });
  await client.connect();

  const stats = {
    workspaceId: normalizedWorkspaceId,
    scanned: 0,
    completed: 0,
    blocked: 0,
    retried: 0,
    careerPagesFound: 0,
    contactPathsFound: 0,
    evidenceWritten: 0,
    organizationIds: [],
    rescoringOrganizationIds: [],
    failures: [],
  };

  try {
    for (let index = 0; index < boundedLimit; index += 1) {
      const item = await claimNextItem(client, normalizedWorkspaceId, evaluationTime);
      if (!item) break;
      stats.scanned += 1;
      stats.organizationIds.push(item.organizationId);

      try {
        const result = await enrichQueueItem(client, item, evaluationTime);
        stats.evidenceWritten += result.evidenceIds.length;
        stats.contactPathsFound += result.contactPaths.length;
        if (result.careerPageUrl) stats.careerPagesFound += 1;

        if (result.hasSafeContactPath) {
          await completeQueueItem(client, item, result, evaluationTime);
          stats.completed += 1;
          stats.rescoringOrganizationIds.push(item.organizationId);
        } else if (item.attemptCount >= MAX_ATTEMPTS) {
          await blockQueueItem(
            client,
            item,
            'NO_SAFE_CORPORATE_CONTACT_AFTER_RETRIES',
            result,
            evaluationTime,
          );
          stats.blocked += 1;
        } else {
          await retryQueueItem(
            client,
            item,
            'NO_SAFE_CORPORATE_CONTACT_YET',
            result,
            evaluationTime,
          );
          stats.retried += 1;
        }
      } catch (error) {
        const reasonCode = errorCode(error);
        stats.failures.push({
          queueId: item.queueId,
          organizationId: item.organizationId,
          reasonCode,
        });
        if (item.attemptCount >= MAX_ATTEMPTS) {
          await blockQueueItem(
            client,
            item,
            reasonCode,
            emptyEnrichmentResult(),
            evaluationTime,
          ).catch(() => undefined);
          stats.blocked += 1;
        } else {
          await retryQueueItem(
            client,
            item,
            reasonCode,
            emptyEnrichmentResult(),
            evaluationTime,
          ).catch(() => undefined);
          stats.retried += 1;
        }
      }
    }
    stats.organizationIds = uniqueIds(stats.organizationIds);
    stats.rescoringOrganizationIds = uniqueIds(stats.rescoringOrganizationIds);
    return stats;
  } finally {
    await client.end();
  }
}

async function claimNextItem(client, workspaceId, now) {
  await client.query('BEGIN');
  try {
    const result = await client.query(
      `SELECT
         queue.id::TEXT AS "queueId",
         queue.lineage_id::TEXT AS "lineageId",
         queue.workspace_id::TEXT AS "workspaceId",
         queue.client_profile_id::TEXT AS "clientProfileId",
         queue.organization_id::TEXT AS "organizationId",
         queue.attempt_count AS "attemptCount",
         org.name AS "organizationName",
         org.domain,
         org.website_url AS "websiteUrl",
         org.career_page_url AS "careerPageUrl"
       FROM commercial_signal_enrichment_queue queue
       JOIN commercial_signal_opportunity_lineage lineage
         ON lineage.id = queue.lineage_id
        AND lineage.workspace_id = queue.workspace_id
        AND lineage.client_profile_id = queue.client_profile_id
        AND lineage.organization_id = queue.organization_id
       JOIN opportunity_candidates candidate
         ON candidate.id = lineage.candidate_id
       JOIN orgs org ON org.id = queue.organization_id
       WHERE queue.workspace_id = $1
         AND queue.status = 'pending'
         AND queue.next_attempt_at <= $2::TIMESTAMPTZ
         AND candidate.status = 'qualified_needs_enrichment'
         AND candidate.valid_until > $2::TIMESTAMPTZ
       ORDER BY queue.next_attempt_at ASC, queue.id ASC
       LIMIT 1
       FOR UPDATE OF queue SKIP LOCKED`,
      [workspaceId, now.toISOString()],
    );
    const row = result.rows[0];
    if (!row) {
      await client.query('COMMIT');
      return null;
    }
    const nextAttemptCount = Number(row.attemptCount ?? 0) + 1;
    await client.query(
      `UPDATE commercial_signal_enrichment_queue
       SET status = 'running',
           attempt_count = $2,
           updated_at = $3::TIMESTAMPTZ
       WHERE id = $1`,
      [row.queueId, nextAttemptCount, now.toISOString()],
    );
    await client.query('COMMIT');
    return {
      queueId: positiveId(row.queueId, 'queue'),
      lineageId: positiveId(row.lineageId, 'lineage'),
      workspaceId: positiveId(row.workspaceId, 'workspace'),
      clientProfileId: positiveId(row.clientProfileId, 'client profile'),
      organizationId: positiveId(row.organizationId, 'organization'),
      attemptCount: nextAttemptCount,
      organizationName: textOrNull(row.organizationName),
      domain: domainOrNull(row.domain),
      websiteUrl: urlOrNull(row.websiteUrl),
      careerPageUrl: urlOrNull(row.careerPageUrl),
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function enrichQueueItem(client, item, now) {
  const seedUrl = item.websiteUrl ?? deriveWebsiteUrl(item.domain);
  if (!seedUrl) {
    return {
      ...emptyEnrichmentResult(),
      reasonCode: 'ORGANIZATION_HAS_NO_CORPORATE_SURFACE',
    };
  }

  const probeUrls = buildProbeUrls(seedUrl, item.careerPageUrl);
  const successful = [];
  for (const url of probeUrls) {
    const fetched = await fetchCompanyPage(url, { timeoutMs: 12_000 });
    if (!fetched.record) continue;
    successful.push({ url: fetched.url ?? url, record: fetched.record });
  }

  const contactPaths = dedupeContactPaths(successful.flatMap(({ record }) =>
    Array.isArray(record.contact_paths) ? record.contact_paths : []));
  const careerPageUrl = chooseCareerPage(successful, seedUrl, item.careerPageUrl);
  const evidenceIds = [];

  for (const page of successful) {
    const surfaceType = page.url === careerPageUrl
      ? 'careers_page'
      : contactPaths.some((path) => path.type === 'contact_page' && path.url === page.url)
        ? 'corporate_contact_page'
        : null;
    if (!surfaceType && page.url !== seedUrl) continue;
    const evidence = await writeEvidence(client, {
      source: SOURCE_ID,
      url: page.url,
      fetchedAt: now,
      tier: 'corroboration',
      orgId: Number(item.organizationId),
      payloadRef: {
        enrichmentLineageId: item.lineageId,
        queueId: item.queueId,
        surfaceType: surfaceType ?? 'generic_corporate_contact',
        signals: safeStringArray(page.record.signals),
        contactPathTypes: dedupeContactPaths(
          Array.isArray(page.record.contact_paths) ? page.record.contact_paths : [],
        ).map(contactPathType),
      },
    });
    const normalizedSurfaceType = surfaceType ?? 'generic_corporate_contact';
    await client.query(
      `INSERT INTO commercial_signal_enrichment_evidence (
         lineage_id, evidence_id, workspace_id, client_profile_id,
         organization_id, surface_type
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (lineage_id, evidence_id, surface_type) DO NOTHING`,
      [
        item.lineageId,
        evidence.id,
        item.workspaceId,
        item.clientProfileId,
        item.organizationId,
        normalizedSurfaceType,
      ],
    );
    evidenceIds.push(String(evidence.id));
  }

  if (careerPageUrl && !item.careerPageUrl) {
    await client.query(
      `UPDATE orgs
       SET career_page_url = $2, updated_at = NOW()
       WHERE id = $1
         AND (career_page_url IS NULL OR BTRIM(career_page_url) = '')`,
      [item.organizationId, careerPageUrl],
    );
  }

  const safePaths = contactPaths.map((path) => {
    if (path.type === 'generic_email') {
      return { type: 'generic_email', value: String(path.value) };
    }
    return { type: 'contact_page', url: String(path.url) };
  });

  return {
    careerPageUrl,
    contactPaths: safePaths,
    evidenceIds: uniqueIds(evidenceIds),
    hasSafeContactPath: Boolean(careerPageUrl || safePaths.length > 0),
    reasonCode: careerPageUrl || safePaths.length > 0
      ? 'SAFE_CORPORATE_SURFACE_FOUND'
      : successful.length > 0
        ? 'CORPORATE_SURFACE_FETCHED_NO_SAFE_CONTACT'
        : 'CORPORATE_SURFACE_FETCH_FAILED',
  };
}

async function completeQueueItem(client, item, result, now) {
  await client.query(
    `UPDATE commercial_signal_enrichment_queue
     SET status = 'completed',
         result_snapshot = $2::JSONB,
         updated_at = $3::TIMESTAMPTZ
     WHERE id = $1 AND status = 'running'`,
    [item.queueId, JSON.stringify(publicResult(result)), now.toISOString()],
  );
}

async function blockQueueItem(client, item, reasonCode, result, now) {
  await client.query(
    `UPDATE commercial_signal_enrichment_queue
     SET status = 'blocked',
         result_snapshot = $2::JSONB,
         updated_at = $3::TIMESTAMPTZ
     WHERE id = $1 AND status = 'running'`,
    [
      item.queueId,
      JSON.stringify({ ...publicResult(result), reasonCode }),
      now.toISOString(),
    ],
  );
}

async function retryQueueItem(client, item, reasonCode, result, now) {
  const nextAttemptAt = new Date(now.getTime() + RETRY_HOURS * 60 * 60 * 1000);
  await client.query(
    `UPDATE commercial_signal_enrichment_queue
     SET status = 'pending',
         next_attempt_at = $2::TIMESTAMPTZ,
         result_snapshot = $3::JSONB,
         updated_at = $4::TIMESTAMPTZ
     WHERE id = $1 AND status = 'running'`,
    [
      item.queueId,
      nextAttemptAt.toISOString(),
      JSON.stringify({ ...publicResult(result), reasonCode }),
      now.toISOString(),
    ],
  );
}

function publicResult(result) {
  return {
    careerPageUrl: result.careerPageUrl ?? null,
    contactPaths: Array.isArray(result.contactPaths) ? result.contactPaths : [],
    evidenceIds: Array.isArray(result.evidenceIds) ? result.evidenceIds : [],
    reasonCode: result.reasonCode ?? null,
  };
}

function buildProbeUrls(seedUrl, existingCareerPageUrl) {
  const seed = new URL(seedUrl);
  seed.hash = '';
  seed.search = '';
  const urls = [seed.toString()];
  if (existingCareerPageUrl && sameOrigin(existingCareerPageUrl, seed.toString())) {
    urls.push(new URL(existingCareerPageUrl).toString());
  }
  for (const path of CAREER_PATHS) {
    urls.push(new URL(path, seed.origin).toString());
  }
  return [...new Set(urls)].slice(0, 8);
}

function chooseCareerPage(successful, seedUrl, existingCareerPageUrl) {
  if (existingCareerPageUrl && successful.some((page) =>
    normalizeUrl(page.url) === normalizeUrl(existingCareerPageUrl))) {
    return normalizeUrl(existingCareerPageUrl);
  }
  const candidate = successful.find(({ url, record }) =>
    sameOrigin(url, seedUrl)
      && isCareerLikePath(url)
      && safeStringArray(record.signals).some((signal) => CAREER_SIGNAL_CODES.has(signal)));
  return candidate ? normalizeUrl(candidate.url) : null;
}

function dedupeContactPaths(values) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    if (value.type === 'generic_email' && typeof value.value === 'string') {
      const email = value.value.trim().toLowerCase();
      if (!isGenericEmailShape(email)) continue;
      const key = `generic_email:${email}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ type: 'generic_email', value: email });
    } else if (value.type === 'contact_page' && typeof value.url === 'string') {
      const url = urlOrNull(value.url);
      if (!url) continue;
      const key = `contact_page:${url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ type: 'contact_page', url });
    }
  }
  return result;
}

function contactPathType(path) {
  return path.type === 'generic_email'
    ? 'company_email'
    : 'corporate_contact_page';
}

function isGenericEmailShape(value) {
  return /^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value);
}

function isCareerLikePath(value) {
  try {
    const path = new URL(value).pathname.toLowerCase();
    return /(career|careers|job|jobs|vacanc|rabota|work)/.test(path);
  } catch {
    return false;
  }
}

function sameOrigin(left, right) {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

function deriveWebsiteUrl(domain) {
  return domain ? `https://${domain}` : null;
}

function domainOrNull(value) {
  const text = textOrNull(value)?.toLowerCase() ?? null;
  if (!text || /[\s/@]/.test(text)) return null;
  return text;
}

function urlOrNull(value) {
  const text = textOrNull(value);
  if (!text) return null;
  try {
    const url = new URL(text.includes('://') ? text : `https://${text}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeUrl(value) {
  const url = new URL(value);
  url.hash = '';
  return url.toString();
}

function textOrNull(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function safeStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean).slice(0, 32)
    : [];
}

function uniqueIds(values) {
  return [...new Set(values.map((value) => positiveId(value, 'identifier')))]
    .sort((left, right) => BigInt(left) < BigInt(right) ? -1 : 1);
}

function emptyEnrichmentResult() {
  return {
    careerPageUrl: null,
    contactPaths: [],
    evidenceIds: [],
    hasSafeContactPath: false,
    reasonCode: null,
  };
}

function errorCode(error) {
  const value = error instanceof Error ? `${error.name}:${error.message}` : String(error);
  const normalized = value.toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  return normalized || 'ENRICHMENT_FAILED';
}

function positiveId(value, label) {
  const normalized = String(value ?? '').trim();
  if (!/^[1-9]\d{0,18}$/.test(normalized)
      || BigInt(normalized) > 9223372036854775807n) {
    throw new Error(`Invalid ${label} identifier.`);
  }
  return BigInt(normalized).toString();
}

function integerBetween(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return number;
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid enrichment time.');
  return date;
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const args = parseArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
  }
  try {
    const result = await processCommercialSignalEnrichment({
      connectionString,
      ...args,
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
