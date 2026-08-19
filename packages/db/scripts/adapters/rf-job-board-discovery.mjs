import { fetchText } from './source-http.mjs';
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
 * This primitive is intentionally static/structured-data only. A caller can
 * escalate to rendered DOM through source-escalation when static extraction is
 * empty, but robots/access-control outcomes remain terminal policy decisions.
 */
export async function discoverRfJobBoardSurface(family, surface, {
  fetchTextImpl = fetchText,
  signal,
  maxLinks = MAX_LINKS,
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

  let response;
  try {
    response = await fetchTextImpl(baseUrl, {
      sourceName: `rf-discovery:${family.id}`,
      headers: {
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'user-agent': 'RecruiterRadarSourceDiscovery/1.0',
      },
      redirect: 'follow',
      signal,
      retries: 1,
      timeoutMs: 10_000,
    });
  } catch (error) {
    return {
      ...blocked('fetch-error', policy.robotsState),
      httpStatus: Number.isInteger(Number(error?.status)) ? Number(error.status) : null,
      errorCategory: boundedText(error?.message),
    };
  }

  const finalUrl = canonicalizePublicUrl(response.response?.url ?? baseUrl, { keepTracking: true });
  if (!finalUrl || !isAllowedPlatformOrigin(finalUrl, family.platformDomains)) {
    return blocked('cross-platform-redirect', policy.robotsState);
  }

  const html = response.body ?? '';
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    return blocked('html-too-large', policy.robotsState);
  }

  const structuredPostings = extractPublicJobPostingsFromHtml(html, finalUrl);
  const vacancyLinks = extractPublicVacancyLinks(html, finalUrl, family, { maxLinks })
    .filter((url) => isRobotsPathAllowed(url, policy.robots));

  return Object.freeze({
    blocked: false,
    reason: null,
    robotsState: policy.robotsState,
    selectedStage: structuredPostings.length > 0 ? 'structured-data' : 'static-http',
    finalUrl,
    structuredPostings: Object.freeze(structuredPostings),
    vacancyLinks: Object.freeze(vacancyLinks),
    discoveredCount: Math.max(structuredPostings.length, vacancyLinks.length),
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
    let resolved;
    try {
      resolved = new URL(decodeHtmlAttribute(match[1]), page);
    } catch {
      continue;
    }
    const canonical = canonicalizePublicUrl(resolved.toString());
    if (!canonical || seen.has(canonical)) continue;
    if (!isAllowedPlatformOrigin(canonical, platformDomains)) continue;
    if (!looksLikeVacancyPath(new URL(canonical).pathname, family?.id)) continue;
    seen.add(canonical);
    candidates.push(canonical);
    if (candidates.length >= Math.max(1, maxLinks)) break;
  }
  return candidates;
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

function boundedText(value) {
  const text = nonEmptyText(value);
  return text ? text.slice(0, 240) : null;
}

function blocked(reason, robotsState = 'blocked') {
  return Object.freeze({
    blocked: true,
    reason,
    robotsState,
    selectedStage: null,
    finalUrl: null,
    structuredPostings: Object.freeze([]),
    vacancyLinks: Object.freeze([]),
    discoveredCount: 0,
  });
}
