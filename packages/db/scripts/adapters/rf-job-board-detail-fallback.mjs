import { canonicalizePublicUrl } from './site-discovery.mjs';

const AGENCY_MARKERS = [
  /агентств[оа]\s*\/\s*hr\s*ресурс/i,
  /рекрутингов(?:ое|ая)\s+агентств/i,
  /кадров(?:ое|ое\s+)?агентств/i,
  /recruit(?:ing|ment)\s+agency/i,
  /staffing\s+agency/i,
];

/**
 * Conservative HTML fallback for public vacancy detail pages that expose the
 * job in server-rendered markup but omit schema.org JobPosting.
 *
 * This extracts only a vacancy title, source id/date and the platform employer
 * profile link. Direct employer identity is resolved later from the profile.
 * If the page explicitly identifies the publisher as a recruiting/staffing
 * agency, the profile is tagged as publisher-only and MUST NOT become target
 * employer identity.
 */
export function extractRfJobDetailFallback(html, pageUrl, family) {
  const text = String(html ?? '');
  const canonicalPageUrl = canonicalizePublicUrl(pageUrl);
  if (!canonicalPageUrl || !looksLikeDetailPage(canonicalPageUrl, family?.id)) return null;

  const title = extractHeading(text);
  if (!title) return null;

  const publisherType = AGENCY_MARKERS.some((pattern) => pattern.test(stripHtml(text.slice(0, 120_000))))
    ? 'agency'
    : 'unknown';
  const employer = extractPlatformEmployerLink(text, canonicalPageUrl, family?.id);
  const datePosted = extractPublishedDate(text);
  const externalId = extractExternalVacancyId(canonicalPageUrl, family?.id);

  return Object.freeze({
    title,
    employerName: employer?.name ?? null,
    employerUrl: employer?.url ?? null,
    publisherType,
    vacancyUrl: canonicalPageUrl,
    datePosted,
    validThrough: null,
    location: null,
    employmentType: Object.freeze([]),
    externalId,
    extractionMethod: 'html-vacancy-detail-fallback',
  });
}

function looksLikeDetailPage(url, familyId) {
  const path = new URL(url).pathname;
  if (familyId === 'geekjob') return /^\/vacancy\/[A-Za-z0-9_-]+\/?$/i.test(path);
  if (familyId === 'getmatch') return /^\/vacancies\/\d+(?:-[^/]+)?\/?$/i.test(path);
  if (familyId === 'rabota-ru') return /^\/vacancy\/\d+\/?$/i.test(path);
  if (familyId === 'zarplata-ru') return /^\/vacancy\/\d+\/?$/i.test(path);
  if (familyId === 'avito-rabota') return /\/vakansii\/[^/]+_\d+\/?$/i.test(path);
  return false;
}

function extractHeading(html) {
  const match = String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const title = cleanText(match?.[1]);
  return title && title.length <= 240 ? title : null;
}

function extractPlatformEmployerLink(html, pageUrl, familyId) {
  const patterns = {
    geekjob: /<a\b[^>]*href=["']([^"']*\/company\/[A-Za-z0-9_-]+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    getmatch: /<a\b[^>]*href=["']([^"']*\/companies\/[A-Za-z0-9_-]+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    'rabota-ru': /<a\b[^>]*href=["']([^"']*\/company\/(?!\/?["'])[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    'zarplata-ru': /<a\b[^>]*href=["']([^"']*\/employer\/\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
  };
  const pattern = patterns[familyId];
  if (!pattern) return null;

  for (const match of String(html).matchAll(pattern)) {
    const url = resolveSamePlatformUrl(match[1], pageUrl);
    const name = cleanText(match[2]);
    if (!url || !name || isNavigationText(name)) continue;
    return { url, name };
  }
  return null;
}

function extractPublishedDate(html) {
  for (const pattern of [
    /<time\b[^>]*datetime=["']([^"']+)["']/i,
    /<meta\b[^>]*(?:property|name)=["'](?:article:published_time|datePublished|date)["'][^>]*content=["']([^"']+)["']/i,
    /<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:article:published_time|datePublished|date)["']/i,
  ]) {
    const match = String(html).match(pattern);
    const normalized = normalizeDate(match?.[1]);
    if (normalized) return normalized;
  }
  return null;
}

function extractExternalVacancyId(url, familyId) {
  const path = new URL(url).pathname;
  const patterns = {
    geekjob: /^\/vacancy\/([A-Za-z0-9_-]+)/i,
    getmatch: /^\/vacancies\/(\d+)/i,
    'rabota-ru': /^\/vacancy\/(\d+)/i,
    'zarplata-ru': /^\/vacancy\/(\d+)/i,
    'avito-rabota': /_(\d+)\/?$/i,
  };
  return path.match(patterns[familyId])?.[1] ?? null;
}

function resolveSamePlatformUrl(raw, pageUrl) {
  try {
    const page = new URL(pageUrl);
    const resolved = new URL(decodeHtml(raw), page);
    if (resolved.protocol !== 'https:') return null;
    const pageRoot = registrablePlatformRoot(page.hostname);
    const resolvedRoot = registrablePlatformRoot(resolved.hostname);
    if (!pageRoot || pageRoot !== resolvedRoot) return null;
    return canonicalizePublicUrl(resolved.toString());
  } catch {
    return null;
  }
}

function registrablePlatformRoot(hostname) {
  const parts = String(hostname ?? '').toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join('.') : null;
}

function normalizeDate(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return new Date(Date.parse(value)).toISOString();
}

function isNavigationText(value) {
  return /^(?:вакансии|все\s+вакансии|компания|о\s+компании|работодатель|назад|далее)$/i.test(value.trim());
}

function cleanText(value) {
  const text = stripHtml(value)
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

function stripHtml(value) {
  return String(value ?? '').replace(/<[^>]+>/g, ' ');
}

function decodeHtml(value) {
  return String(value ?? '')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}
