import { fetchText } from './source-http.mjs';
import { fetchPublicPageWithEscalation } from './public-page-escalation.mjs';
import { extractRfJobDetailFallback } from './rf-job-board-detail-fallback.mjs';
import {
  canonicalizePublicUrl,
  extractEmbeddedJsonDocuments,
  isRobotsPathAllowed,
  resolvePublicRobotsPolicy,
} from './site-discovery.mjs';

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_LINKS = 250;
const MAX_PAGINATION_LINKS = 20;
const MAX_EMBEDDED_NODES = 5_000;
const MAX_EMBEDDED_POSTINGS = 250;

export async function discoverRfJobBoardSurface(family, surface, {
  fetchTextImpl = fetchText,
  signal,
  maxLinks = MAX_LINKS,
  maxPaginationLinks = MAX_PAGINATION_LINKS,
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
  if (!isRobotsPathAllowed(baseUrl, policy.robots)) return blocked('robots-disallow', policy.robotsState);

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
      surface,
      policy,
      { maxLinks, maxPaginationLinks },
    ),
    parseMarkdown: (markdown, pageUrl) => extractDiscoveryRecordsFromMarkdown(
      markdown,
      pageUrl,
      family,
      surface,
      policy,
      { maxLinks, maxPaginationLinks },
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
  const paginationLinks = [];
  const postingKeys = new Set();
  const linkKeys = new Set();
  const pageKeys = new Set();
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
    } else if (record.kind === 'pagination-link' && !pageKeys.has(record.url)) {
      pageKeys.add(record.url);
      paginationLinks.push(record.url);
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
    paginationLinks: Object.freeze(paginationLinks),
    discoveredCount: linkKeys.size,
  });
}

/**
 * Extract explicit vacancy records from schema.org and public application state.
 * Embedded state is never executed. A generic state object is accepted only when
 * it carries both a job title and an explicit same-platform URL that matches the
 * family's stable vacancy-detail route. IDs are never converted into guessed
 * URLs and private API/XHR endpoints are never called.
 */
export function extractPublicJobPostingsFromHtml(html, pageUrl, family = null) {
  const documents = extractEmbeddedJsonDocuments(html, { maxDocuments: 50 });
  const postings = [];
  const seen = new Set();

  for (const node of documents.flatMap(flattenJsonLdNodes)) {
    if (!isJobPostingNode(node)) continue;
    const posting = mapJobPostingNode(node, pageUrl);
    appendPosting(postings, seen, posting);
  }

  if (family?.id) {
    const state = { nodes: 0, postings: 0 };
    for (const document of documents) {
      collectEmbeddedVacancyPostings(document, {
        family,
        pageUrl,
        postings,
        seen,
        state,
        depth: 0,
      });
      if (state.nodes >= MAX_EMBEDDED_NODES || state.postings >= MAX_EMBEDDED_POSTINGS) break;
    }
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
  const candidates = [];
  const seen = new Set();
  for (const match of String(html ?? '').matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const canonical = resolveVacancyUrl(decodeHtmlAttribute(match[1]), page, family?.platformDomains ?? [], family?.id);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    candidates.push(canonical);
    if (candidates.length >= Math.max(1, maxLinks)) break;
  }
  return candidates;
}

export function extractPublicPaginationLinks(
  html,
  pageUrl,
  family,
  surface = { baseUrl: pageUrl },
  { maxLinks = MAX_PAGINATION_LINKS } = {},
) {
  let page;
  let root;
  try {
    page = new URL(pageUrl);
    root = new URL(surface?.paginationBaseUrl ?? surface?.baseUrl ?? pageUrl);
  } catch {
    return [];
  }
  const links = [];
  const seen = new Set();
  const current = canonicalizePublicUrl(page.toString());
  for (const match of String(html ?? '').matchAll(/<a\b([^>]*)\bhref\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = `${match[1] ?? ''} ${match[3] ?? ''}`;
    const text = stripHtml(match[4]);
    if (!looksLikePaginationAnchor(attrs, text, match[2])) continue;
    let resolved;
    try {
      resolved = new URL(decodeHtmlAttribute(match[2]), page);
    } catch {
      continue;
    }
    const canonical = canonicalizePublicUrl(resolved.toString());
    if (!canonical || canonical === current || seen.has(canonical)) continue;
    if (!isAllowedPlatformOrigin(canonical, family?.platformDomains ?? [])) continue;
    // Numeric vacancy IDs look pagination-like. Detail routes always win.
    if (isRfVacancyDetailUrl(canonical, family?.id)) continue;
    if (!belongsToListingSurface(canonical, root)) continue;
    seen.add(canonical);
    links.push(canonical);
    if (links.length >= Math.max(1, maxLinks)) break;
  }
  return links;
}

function extractDiscoveryRecordsFromHtml(html, pageUrl, family, surface, policy, { maxLinks, maxPaginationLinks }) {
  if (Buffer.byteLength(String(html ?? ''), 'utf8') > MAX_HTML_BYTES) return [];
  const records = [];
  const postings = extractPublicJobPostingsFromHtml(html, pageUrl, family)
    .filter((posting) => isRfVacancyDetailUrl(posting.vacancyUrl, family.id)
      && isAllowedPlatformOrigin(posting.vacancyUrl, family.platformDomains)
      && isRobotsPathAllowed(posting.vacancyUrl, policy.robots));
  for (const posting of postings) records.push({ kind: 'job-posting', posting });

  if (postings.length === 0) {
    const fallbackPosting = extractRfJobDetailFallback(html, pageUrl, family);
    if (fallbackPosting
      && isAllowedPlatformOrigin(fallbackPosting.vacancyUrl, family.platformDomains)
      && isRobotsPathAllowed(fallbackPosting.vacancyUrl, policy.robots)) {
      records.push({ kind: 'job-posting', posting: fallbackPosting });
    }
  }

  const links = extractPublicVacancyLinks(html, pageUrl, family, { maxLinks })
    .filter((url) => isRobotsPathAllowed(url, policy.robots));
  for (const url of links) records.push({ kind: 'vacancy-link', url });

  const paginationLinks = extractPublicPaginationLinks(html, pageUrl, family, surface, { maxLinks: maxPaginationLinks })
    .filter((url) => isRobotsPathAllowed(url, policy.robots));
  for (const url of paginationLinks) records.push({ kind: 'pagination-link', url });
  return records;
}

function extractDiscoveryRecordsFromMarkdown(markdown, pageUrl, family, surface, policy, { maxLinks, maxPaginationLinks }) {
  let page;
  try {
    page = new URL(pageUrl);
  } catch {
    return [];
  }
  const records = [];
  const seen = new Set();
  const text = String(markdown ?? '');
  const markdownLinks = [...text.matchAll(/\[([^\]]*)\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g)];
  const rawUrls = [
    ...markdownLinks.map((match) => match[2]),
    ...[...text.matchAll(/https?:\/\/[^\s<>)\]]+/g)].map((match) => match[0]),
  ];
  for (const raw of rawUrls) {
    const canonical = resolveVacancyUrl(raw, page, family.platformDomains, family.id);
    if (!canonical || seen.has(canonical) || !isRobotsPathAllowed(canonical, policy.robots)) continue;
    seen.add(canonical);
    records.push({ kind: 'vacancy-link', url: canonical });
    if (seen.size >= Math.max(1, maxLinks)) break;
  }

  const paginationSeen = new Set();
  let root;
  try {
    root = new URL(surface?.paginationBaseUrl ?? surface?.baseUrl ?? pageUrl);
  } catch {
    root = page;
  }
  for (const match of markdownLinks) {
    if (!looksLikePaginationAnchor('', match[1], match[2])) continue;
    let resolved;
    try {
      resolved = new URL(match[2], page);
    } catch {
      continue;
    }
    const canonical = canonicalizePublicUrl(resolved.toString());
    if (!canonical || paginationSeen.has(canonical)) continue;
    if (!isAllowedPlatformOrigin(canonical, family.platformDomains)) continue;
    if (isRfVacancyDetailUrl(canonical, family.id)) continue;
    if (!belongsToListingSurface(canonical, root)) continue;
    if (!isRobotsPathAllowed(canonical, policy.robots)) continue;
    paginationSeen.add(canonical);
    records.push({ kind: 'pagination-link', url: canonical });
    if (paginationSeen.size >= Math.max(1, maxPaginationLinks)) break;
  }
  return records;
}

function collectEmbeddedVacancyPostings(node, context) {
  if (context.depth > 10 || context.state.nodes >= MAX_EMBEDDED_NODES || context.state.postings >= MAX_EMBEDDED_POSTINGS) return;
  if (!node || typeof node !== 'object') return;
  context.state.nodes += 1;

  if (Array.isArray(node)) {
    for (const item of node) {
      collectEmbeddedVacancyPostings(item, { ...context, depth: context.depth + 1 });
      if (context.state.nodes >= MAX_EMBEDDED_NODES || context.state.postings >= MAX_EMBEDDED_POSTINGS) break;
    }
    return;
  }

  if (!isJobPostingNode(node)) {
    const posting = mapEmbeddedVacancyNode(node, context.pageUrl, context.family);
    if (appendPosting(context.postings, context.seen, posting)) context.state.postings += 1;
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      collectEmbeddedVacancyPostings(value, { ...context, depth: context.depth + 1 });
      if (context.state.nodes >= MAX_EMBEDDED_NODES || context.state.postings >= MAX_EMBEDDED_POSTINGS) break;
    }
  }
}

function mapJobPostingNode(node, pageUrl) {
  const title = nonEmptyText(node?.title ?? node?.name);
  const url = resolvePublicUrl(node?.url ?? node?.['@id'], pageUrl);
  if (!title || !url) return null;
  return Object.freeze({
    title,
    employerName: nonEmptyText(node?.hiringOrganization?.name),
    employerUrl: resolvePublicUrl(node?.hiringOrganization?.sameAs ?? node?.hiringOrganization?.url, pageUrl),
    vacancyUrl: url,
    datePosted: normalizeDate(node?.datePosted),
    validThrough: normalizeDate(node?.validThrough),
    location: extractJobLocation(node?.jobLocation),
    employmentType: normalizeEmploymentType(node?.employmentType),
    externalId: extractIdentifier(node?.identifier),
    publisherType: inferStructuredPublisherType(node),
    extractionMethod: 'json-ld-job-posting',
  });
}

function mapEmbeddedVacancyNode(node, pageUrl, family) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
  const title = firstText(node, [
    'vacancyName', 'vacancy_name', 'jobTitle', 'job_title', 'positionTitle',
    'position_title', 'profession', 'title',
  ]);
  if (!title || title.length > 300) return null;

  const rawUrl = firstText(node, [
    'vacancyUrl', 'vacancy_url', 'jobUrl', 'job_url', 'alternateUrl',
    'alternate_url', 'detailUrl', 'detail_url', 'seoUrl', 'seo_url', 'href',
    'link', 'path', 'url',
  ]);
  const vacancyUrl = resolvePublicUrl(rawUrl, pageUrl);
  if (!vacancyUrl
    || !isAllowedPlatformOrigin(vacancyUrl, family?.platformDomains ?? [])
    || !isRfVacancyDetailUrl(vacancyUrl, family?.id)) return null;

  const employer = firstObject(node, ['hiringOrganization', 'employer', 'company', 'organization']);
  const employerName = nonEmptyText(
    employer?.name ?? employer?.displayName ?? employer?.display_name
      ?? node?.employerName ?? node?.employer_name ?? node?.companyName ?? node?.company_name,
  );
  const rawEmployerUrl = employer?.sameAs ?? employer?.website ?? employer?.websiteUrl
    ?? employer?.website_url ?? employer?.profileUrl ?? employer?.profile_url ?? employer?.url
    ?? node?.employerUrl ?? node?.employer_url ?? node?.companyUrl ?? node?.company_url;
  const employerUrl = resolvePublicUrl(rawEmployerUrl, pageUrl);
  const externalId = firstText(node, ['vacancyId', 'vacancy_id', 'externalId', 'external_id'])
    ?? extractIdentifier(node?.identifier);

  return Object.freeze({
    title,
    employerName,
    employerUrl,
    vacancyUrl,
    datePosted: normalizeDate(firstValue(node, [
      'datePosted', 'date_posted', 'publishedAt', 'published_at',
      'publicationDate', 'publication_date', 'createdAt', 'created_at',
    ])),
    validThrough: normalizeDate(firstValue(node, ['validThrough', 'valid_through', 'expiresAt', 'expires_at'])),
    location: extractEmbeddedLocation(node),
    employmentType: normalizeEmploymentType(firstValue(node, ['employmentType', 'employment_type'])),
    externalId,
    publisherType: inferStructuredPublisherType({
      hiringOrganization: employer,
      description: node?.description ?? node?.summary,
    }),
    extractionMethod: 'embedded-public-app-state',
  });
}

function appendPosting(postings, seen, posting) {
  if (!posting) return false;
  const key = `${posting.vacancyUrl}|${posting.title}`;
  if (seen.has(key)) return false;
  seen.add(key);
  postings.push(posting);
  return true;
}

function firstText(object, names) {
  for (const name of names) {
    const value = object?.[name];
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    const text = nonEmptyText(value);
    if (text) return text;
  }
  return null;
}

function firstValue(object, names) {
  for (const name of names) {
    if (object?.[name] !== undefined && object?.[name] !== null) return object[name];
  }
  return null;
}

function firstObject(object, names) {
  for (const name of names) {
    const value = object?.[name];
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  }
  return null;
}

function resolvePublicUrl(value, pageUrl) {
  const text = nonEmptyText(typeof value === 'number' ? String(value) : value);
  if (!text) return null;
  try {
    return canonicalizePublicUrl(new URL(text, pageUrl).toString());
  } catch {
    return null;
  }
}

function extractEmbeddedLocation(node) {
  const value = firstValue(node, ['location', 'locationName', 'location_name', 'city', 'area', 'region']);
  if (typeof value === 'string' || typeof value === 'number') return nonEmptyText(String(value));
  if (!value || typeof value !== 'object') return null;
  return nonEmptyText(value?.name ?? value?.title ?? value?.city ?? value?.addressLocality ?? value?.address?.addressLocality);
}

function validateDiscoveryRecord(record) {
  if (record?.kind === 'job-posting') return Boolean(nonEmptyText(record.posting?.title) && canonicalizePublicUrl(record.posting?.vacancyUrl));
  return (record?.kind === 'vacancy-link' || record?.kind === 'pagination-link') && Boolean(canonicalizePublicUrl(record.url));
}

function resolveVacancyUrl(raw, page, platformDomains, familyId) {
  let resolved;
  try {
    resolved = new URL(raw, page);
  } catch {
    return null;
  }
  const canonical = canonicalizePublicUrl(resolved.toString());
  if (!canonical || !isAllowedPlatformOrigin(canonical, platformDomains) || !isRfVacancyDetailUrl(canonical, familyId)) return null;
  return canonical;
}

export function isRfVacancyDetailUrl(value, familyId) {
  let path;
  try {
    path = new URL(value, 'https://example.invalid').pathname;
  } catch {
    return false;
  }
  if (familyId === 'geekjob') return /^\/vacancy\/[A-Za-z0-9_-]+\/?$/i.test(path);
  if (familyId === 'getmatch') return /^\/vacancies\/\d+(?:-[^/]+)?\/?$/i.test(path);
  if (familyId === 'rabota-ru') return /^\/vacancy\/\d{5,}\/?$/i.test(path);
  if (familyId === 'zarplata-ru') return /^\/vacancy\/\d{5,}\/?$/i.test(path);
  if (familyId === 'avito-rabota') return /\/vakansii\/[^/]+_\d{5,}\/?$/i.test(path);
  return false;
}

function looksLikePaginationAnchor(attrs, text, href) {
  const normalizedText = stripHtml(text).trim().toLowerCase();
  const normalizedAttrs = String(attrs ?? '').toLowerCase();
  const normalizedHref = String(href ?? '').toLowerCase();
  return /\brel\s*=\s*["']?next\b/.test(normalizedAttrs)
    || /(?:^|\s)(?:next|далее|следующая|след|›|»)(?:\s|$)/i.test(normalizedText)
    || /^\d{1,3}$/.test(normalizedText)
    || /[?&](?:page|p)=\d+\b/.test(normalizedHref)
    || /\/\d+\/?(?:[?#].*)?$/.test(normalizedHref);
}

function belongsToListingSurface(candidateUrl, rootUrl) {
  const candidate = new URL(candidateUrl);
  const root = rootUrl instanceof URL ? rootUrl : new URL(rootUrl);
  const rootPath = root.pathname.replace(/\/+$/, '') || '/';
  const candidatePath = candidate.pathname.replace(/\/+$/, '') || '/';
  if (rootPath === '/') return candidate.origin === root.origin;
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}/`);
}

function inferStructuredPublisherType(node) {
  const value = [node?.hiringOrganization?.['@type'], node?.hiringOrganization?.description, node?.description]
    .flat().filter(Boolean).join(' ');
  return /(?:recruit(?:ing|ment)\s+agency|staffing\s+agency|рекрутингов(?:ое|ая)\s+агентств|кадров(?:ое|ая)\s+агентств)/i.test(value)
    ? 'agency'
    : 'unknown';
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
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  const text = nonEmptyText(typeof value === 'number' ? String(value) : value);
  if (!text || !Number.isFinite(Date.parse(text))) return null;
  return new Date(Date.parse(text)).toISOString();
}

function nonEmptyText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

function stripHtml(value) {
  return String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&raquo;|&#187;/gi, '»')
    .replace(/&rsaquo;|&#8250;/gi, '›')
    .replace(/\s+/g, ' ')
    .trim();
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
    paginationLinks: Object.freeze([]),
    discoveredCount: 0,
  });
}
