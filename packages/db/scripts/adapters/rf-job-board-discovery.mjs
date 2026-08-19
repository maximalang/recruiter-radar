import { fetchText } from './source-http.mjs';
import { fetchPublicPageWithEscalation } from './public-page-escalation.mjs';
import {
  canonicalizePublicUrl,
  extractEmbeddedJsonDocuments,
  isRobotsPathAllowed,
  resolvePublicRobotsPolicy,
} from './site-discovery.mjs';

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_LINKS = 250;

/**
 * Discover public RF job-board artifacts without claiming ingestion readiness.
 * The acquisition path is shared with other public-page sources and can use a
 * health-aware stageOrder. Robots/access controls remain terminal policy stops;
 * rendered/extraction stages are fallbacks for ordinary transport/parser drift,
 * never anti-bot bypasses.
 */
export async function discoverRfJobBoardSurface(family, surface, {
  fetchTextImpl = fetchText,
  signal,
  maxLinks = MAX_LINKS,
  stageOrder = family?.transportStages,
  renderPool,
  fetchExtractionMarkdownImpl,
  rendered = true,
} = {}) {
  const baseUrl = canonicalizePublicUrl(surface?.baseUrl, { keepTracking: true });
  if (!baseUrl) return blocked('invalid-surface-url');

  const policy = await resolvePublicRobotsPolicy(baseUrl, {
    fetchTextImpl,
    signal,
    userAgent: 'RecruiterRadarSourceDiscovery',
  });
  if (policy.blocked) return blocked(policy.reason ?? 'robots-policy-blocked', policy.robotsState);
  if (!isRobotsPathAllowed(baseUrl, policy.robots)) {
    return blocked('robots-disallow', policy.robotsState);
  }

  const result = await fetchPublicPageWithEscalation({
    url: baseUrl,
    sourceName: `rf-discovery:${family.id}`,
    signal,
    timeoutMs: 10_000,
    headers: {
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
      'user-agent': 'RecruiterRadarSourceDiscovery/1.0',
    },
    stageOrder,
    parseHtml: (html, pageUrl) => extractDiscoveryRecordsFromHtml(
      html,
      pageUrl,
      family,
      policy,
      { maxLinks },
    ),
    parseMarkdown: (markdown, pageUrl) => extractDiscoveryRecordsFromMarkdown(
      markdown,
      pageUrl,
      family,
      policy,
      { maxLinks },
    ),
    validateRecord: validateDiscoveryRecord,
    dependencies: {
      fetchText: fetchTextImpl,
      accessPolicy: policy,
      renderPool,
      fetchExtractionMarkdown: fetchExtractionMarkdownImpl,
      rendered,
    },
  });

  const structuredPostings = [];
  const vacancyLinks = [];
  const postingKeys = new Set();
  const linkKeys = new Set();
  for (const record of result.records) {
    if (record.kind === 'job-posting') {
      const key = `${record.posting.vacancyUrl}|${record.posting.title}`;
      if (!postingKeys.has(key)) {
        postingKeys.add(key);
        structuredPostings.push(record.posting);
      }
      if (!linkKeys.has(record.posting.vacancyUrl)) {
        linkKeys.add(record.posting.vacancyUrl);
        vacancyLinks.push(record.posting.vacancyUrl);
      }
    } else if (record.kind === 'vacancy-link' && !linkKeys.has(record.url)) {
      linkKeys.add(record.url);
      vacancyLinks.push(record.url);
    }
  }

  return Object.freeze({
    blocked: result.stoppedByPolicy === true,
    reason: result.error ?? null,
    robotsState: result.robotsState ?? policy.robotsState,
    selectedStage: result.selectedStage,
    finalUrl: result.url ?? baseUrl,
    attempts: Object.freeze((result.attempts ?? []).map((attempt) => Object.freeze({ ...attempt }))),
    structuredPostings: Object.freeze(structuredPostings),
    vacancyLinks: Object.freeze(vacancyLinks),
    discoveredCount: linkKeys.size,
  });
}

export function extractPublicJobPostingsFromHtml(html, pageUrl) {
  const documents = extractEmbeddedJsonDocuments(html, { maxDocuments: 50 });
  const nodes = documents.flatMap(flattenJsonLdNodes);
  const postings = [];
  const seen = new Set();

  for (const node of nodes) {
    if (!isJobPostingNode(node)) continue;
    const title = nonEmptyText(node.title ?? node.name);
    const employerName = nonEmptyText(node.hiringOrganization?.name);
    const url = canonicalizePublicUrl(node.url ?? node['@id'] ?? pageUrl);
    if (!title || !url) continue;

    const identity = [url, title, employerName ?? ''].join('|');
    if (seen.has(identity)) continue;
    seen.add(identity);

    postings.push(Object.freeze({
      title,
      employerName,
      employerUrl: canonicalizePublicUrl(
        node.hiringOrganization?.sameAs ?? node.hiringOrganization?.url ?? null,
      ),
      vacancyUrl: url,
      datePosted: normalizeDate(node.datePosted),
      validThrough: normalizeDate(node.validThrough),
      location: extractJobLocation(node.jobLocation),
      employmentType: normalizeEmploymentType(node.employmentType),
      externalId: extractIdentifier(node.identifier),
      extractionMethod: 'json-ld-job-posting',
    }));
  }

  return postings;
}

export function extractPublicVacancyLinks(html, pageUrl, family, { maxLinks = MAX_LINKS } = {}) {
  let page;
  try {
    page = new URL(pageUrl);
  } catch {
    return [];
  }
  const platformDomains = family?.platformDomains ?? [];
  const candidates = [];
  const seen = new Set();

  for (const match of String(html ?? '').matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const canonical = resolveVacancyUrl(decodeHtmlAttribute(match[1]), page, platformDomains, family?.id);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    candidates.push(canonical);
    if (candidates.length >= Math.max(1, maxLinks)) break;
  }
  return candidates;
}

function extractDiscoveryRecordsFromHtml(html, pageUrl, family, policy, { maxLinks }) {
  if (Buffer.byteLength(String(html ?? ''), 'utf8') > MAX_HTML_BYTES) return [];
  const records = [];
  const postings = extractPublicJobPostingsFromHtml(html, pageUrl)
    .filter((posting) => (
      isAllowedPlatformOrigin(posting.vacancyUrl, family.platformDomains)
      && isRobotsPathAllowed(posting.vacancyUrl, policy.robots)
    ));
  for (const posting of postings) records.push({ kind: 'job-posting', posting });

  const links = extractPublicVacancyLinks(html, pageUrl, family, { maxLinks })
    .filter((url) => isRobotsPathAllowed(url, policy.robots));
  for (const url of links) records.push({ kind: 'vacancy-link', url });
  return records;
}

function extractDiscoveryRecordsFromMarkdown(markdown, pageUrl, family, policy, { maxLinks }) {
  let page;
  try {
    page = new URL(pageUrl);
  } catch {
    return [];
  }
  const records = [];
  const seen = new Set();
  const text = String(markdown ?? '');
  const candidates = [
    ...[...text.matchAll(/\[[^\]]*\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g)].map((match) => match[1]),
    ...[...text.matchAll(/https?:\/\/[^\s<>)\]]+/g)].map((match) => match[0]),
  ];
  for (const raw of candidates) {
    const canonical = resolveVacancyUrl(raw, page, family.platformDomains, family.id);
    if (!canonical || seen.has(canonical) || !isRobotsPathAllowed(canonical, policy.robots)) continue;
    seen.add(canonical);
    records.push({ kind: 'vacancy-link', url: canonical });
    if (records.length >= Math.max(1, maxLinks)) break;
  }
  return records;
}

function validateDiscoveryRecord(record) {
  if (record?.kind === 'job-posting') {
    return Boolean(nonEmptyText(record.posting?.title) && canonicalizePublicUrl(record.posting?.vacancyUrl));
  }
  return record?.kind === 'vacancy-link' && Boolean(canonicalizePublicUrl(record.url));
}

function resolveVacancyUrl(raw, page, platformDomains, familyId) {
  let resolved;
  try {
    resolved = new URL(raw, page);
  } catch {
    return null;
  }
  const canonical = canonicalizePublicUrl(resolved.toString());
  if (!canonical) return null;
  if (!isAllowedPlatformOrigin(canonical, platformDomains)) return null;
  if (!looksLikeVacancyPath(new URL(canonical).pathname, familyId)) return null;
  return canonical;
}

function flattenJsonLdNodes(document) {
  if (Array.isArray(document)) return document.flatMap(flattenJsonLdNodes);
  if (!document || typeof document !== 'object') return [];
  const graph = Array.isArray(document['@graph']) ? document['@graph'].flatMap(flattenJsonLdNodes) : [];
  return [document, ...graph];
}

function isJobPostingNode(node) {
  const type = node?.['@type'];
  if (Array.isArray(type)) return type.some((value) => String(value).toLowerCase() === 'jobposting');
  return typeof type === 'string' && type.toLowerCase() === 'jobposting';
}

function looksLikeVacancyPath(pathname, familyId) {
  const path = pathname.toLowerCase();
  const generic = /\/(?:vacanc(?:y|ies)|vakansii|jobs?)(?:\/|$)/i.test(path);
  if (generic) return true;
  if (familyId === 'avito-rabota') return /\/vakansii(?:\/|$)/i.test(path);
  if (familyId === 'rabota-ru') return /\/vacancy(?:\/|$)/i.test(path);
  return false;
}

function isAllowedPlatformOrigin(url, platformDomains) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return platformDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function extractJobLocation(value) {
  const locations = Array.isArray(value) ? value : value ? [value] : [];
  const parts = [];
  for (const location of locations) {
    const address = location?.address ?? location;
    for (const candidate of [address?.addressLocality, address?.addressRegion, address?.addressCountry]) {
      const text = typeof candidate === 'object' ? candidate?.name : candidate;
      if (nonEmptyText(text)) parts.push(nonEmptyText(text));
    }
  }
  return [...new Set(parts)].filter(Boolean).join(', ') || null;
}

function normalizeEmploymentType(value) {
  if (Array.isArray(value)) return value.map(nonEmptyText).filter(Boolean);
  const text = nonEmptyText(value);
  return text ? [text] : [];
}

function extractIdentifier(value) {
  if (typeof value === 'string' || typeof value === 'number') return nonEmptyText(String(value));
  return nonEmptyText(value?.value ?? value?.name ?? null);
}

function normalizeDate(value) {
  const text = nonEmptyText(value);
  if (!text || !Number.isFinite(Date.parse(text))) return null;
  return new Date(Date.parse(text)).toISOString();
}

function nonEmptyText(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

function decodeHtmlAttribute(value) {
  return String(value)
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function blocked(reason, robotsState = 'blocked') {
  return Object.freeze({
    blocked: true,
    reason,
    robotsState,
    selectedStage: null,
    finalUrl: null,
    attempts: Object.freeze([{ stage: 'static-http', outcome: 'blocked', reason }]),
    structuredPostings: Object.freeze([]),
    vacancyLinks: Object.freeze([]),
    discoveredCount: 0,
  });
}
