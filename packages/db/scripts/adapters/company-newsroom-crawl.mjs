import { isIP } from 'node:net';

import { fetchText } from './source-http.mjs';
import { parseRssAtomFeed } from './feed-parser.mjs';

const NEWSROOM_PATH_PATTERN = /(?:^|\/)(?:news|newsroom|press|media|press-center|press_center|novosti|press-releases|press_releases)(?:\/|$)/i;
const FEED_TYPE_PATTERN = /(?:application|text)\/(?:rss|atom)\+xml/i;
const FEED_PATH_PATTERN = /(?:\.rss|\.xml|\/feed\/?)(?:$|[?#])/i;
const NAVIGATION_SEGMENTS = new Set([
  'archive', 'archives', 'category', 'contacts', 'contact', 'feed', 'media',
  'next', 'page', 'press', 'releases', 'search', 'tag', 'tags',
]);
const RUSSIAN_MONTHS = new Map([
  ['января', 0], ['февраля', 1], ['марта', 2], ['апреля', 3],
  ['мая', 4], ['июня', 5], ['июля', 6], ['августа', 7],
  ['сентября', 8], ['октября', 9], ['ноября', 10], ['декабря', 11],
]);

/** Discover only company-owned newsroom listing and feed URLs. */
export function discoverCompanyNewsroomUrls(html, baseUrl) {
  const pageUrls = new Set();
  const feedUrls = new Set();

  for (const tag of extractTags(html, 'link')) {
    const attrs = parseAttributes(tag);
    const rel = String(attrs.rel ?? '').toLowerCase();
    const type = String(attrs.type ?? '').toLowerCase();
    const url = resolveSameCompanyUrl(attrs.href, baseUrl);

    if (url && rel.split(/\s+/).includes('alternate') && FEED_TYPE_PATTERN.test(type)) {
      feedUrls.add(url);
    }
  }

  for (const anchor of extractAnchors(html)) {
    const url = resolveSameCompanyUrl(anchor.href, baseUrl);
    if (!url) continue;

    const parsed = new URL(url);
    if (FEED_PATH_PATTERN.test(`${parsed.pathname}${parsed.search}`)) {
      feedUrls.add(url);
    } else if (NEWSROOM_PATH_PATTERN.test(parsed.pathname) && isNewsroomListingLink(parsed, anchor.text)) {
      pageUrls.add(url);
    }
  }

  return {
    pageUrls: [...pageUrls],
    feedUrls: [...feedUrls],
  };
}

/** Extract article-level records from a company-owned newsroom listing page. */
export function extractCompanyNewsroomItemsFromHtml(html, pageUrl, target) {
  const records = [];
  const seen = new Set();

  for (const article of extractJsonLdArticles(html)) {
    const sourceUrl = resolveSameCompanyUrl(
      extractJsonLdUrl(article.url ?? article.mainEntityOfPage),
      pageUrl,
      target,
    );
    const headline = cleanText(article.headline ?? article.name);
    const occurredAt = parsePublishedDate(article.datePublished ?? article.dateCreated);

    if (!sourceUrl || !headline || headline.length < 12 || !occurredAt) continue;
    addRecord(records, seen, buildRecord({
      target,
      sourceUrl,
      headline,
      summary: cleanText(article.description),
      occurredAt,
      extractionMethod: 'json-ld',
    }));
  }

  for (const anchor of extractAnchors(html)) {
    const sourceUrl = resolveSameCompanyUrl(anchor.href, pageUrl, target);
    const rawText = cleanText(anchor.text);
    if (!sourceUrl || !rawText || !isArticleUrl(sourceUrl, pageUrl)) continue;

    const dated = extractDatedHeadline(rawText);
    if (!dated) continue;

    addRecord(records, seen, buildRecord({
      target,
      sourceUrl,
      headline: dated.headline,
      summary: null,
      occurredAt: dated.occurredAt,
      extractionMethod: 'dated-link',
    }));
  }

  return records.slice(0, 50);
}

/** Parse RSS or Atom while rejecting links that do not belong to the company. */
export function parseCompanyNewsroomFeed(xml, feedUrl, target) {
  const records = [];
  const seen = new Set();
  for (const item of parseRssAtomFeed(xml, feedUrl, { maxItems: 50 })) {
    const sourceUrl = resolveSameCompanyUrl(item.url, feedUrl, target);
    if (!sourceUrl || item.title.length < 12) continue;
    addRecord(records, seen, buildRecord({
      target,
      sourceUrl,
      headline: item.title,
      summary: item.summary,
      occurredAt: item.publishedAt,
      extractionMethod: 'company-feed',
    }));
  }

  return records.slice(0, 50);
}

/** Fetch bounded company targets and return per-target diagnostics plus records. */
export async function fetchCompanyNewsrooms(targets, { signal, concurrency = 3 } = {}) {
  if (!Array.isArray(targets)) return [];

  const results = new Array(targets.length);
  const queue = targets.map((target, index) => ({ target: normalizeTarget(target), index }));

  async function worker() {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      results[next.index] = next.target
        ? await fetchTarget(next.target, { signal })
        : invalidTargetResult(targets[next.index]);
    }
  }

  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), queue.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

async function fetchTarget(target, { signal } = {}) {
  const diagnostics = {
    target,
    records: [],
    rootFetched: false,
    pagesDiscovered: 0,
    feedsDiscovered: 0,
    pagesFetched: 0,
    feedsFetched: 0,
    errors: [],
    error: null,
  };

  const root = await fetchResource(target.url, { signal, kind: 'page' });
  if (root.error) {
    diagnostics.errors.push(root.error);
    diagnostics.error = root.error;
    return diagnostics;
  }

  diagnostics.rootFetched = true;
  const discovered = discoverCompanyNewsroomUrls(root.body, target.url);
  const pageUrls = new Set(discovered.pageUrls);
  const feedUrls = new Set(discovered.feedUrls);
  if (NEWSROOM_PATH_PATTERN.test(new URL(target.url).pathname)) pageUrls.add(target.url);
  const resources = [];
  const queuedResources = new Set();
  const enqueue = (kind, url) => {
    const key = `${kind}:${url}`;
    if (queuedResources.has(key) || resources.length >= 8) return;
    queuedResources.add(key);
    resources.push({ kind, url });
  };
  for (const pageUrl of pageUrls) enqueue('page', pageUrl);
  for (const feedUrl of feedUrls) enqueue('feed', feedUrl);

  for (let index = 0; index < resources.length && index < 8; index += 1) {
    const resource = resources[index];
    const fetched = resource.url === target.url
      ? root
      : await fetchResource(resource.url, { signal, kind: resource.kind });
    if (fetched.error) {
      diagnostics.errors.push(fetched.error);
      continue;
    }

    if (resource.kind === 'feed') {
      diagnostics.feedsFetched += 1;
      diagnostics.records.push(...parseCompanyNewsroomFeed(fetched.body, resource.url, target));
    } else {
      diagnostics.pagesFetched += 1;
      diagnostics.records.push(...extractCompanyNewsroomItemsFromHtml(fetched.body, resource.url, target));
      const nested = discoverCompanyNewsroomUrls(fetched.body, resource.url);
      for (const pageUrl of nested.pageUrls) pageUrls.add(pageUrl);
      for (const feedUrl of nested.feedUrls) {
        feedUrls.add(feedUrl);
        enqueue('feed', feedUrl);
      }
    }
  }

  diagnostics.pagesDiscovered = pageUrls.size;
  diagnostics.feedsDiscovered = feedUrls.size;
  diagnostics.records = dedupeRecords(diagnostics.records).slice(0, 50);
  return diagnostics;
}

async function fetchResource(url, { signal, kind }) {
  try {
    const { response, body } = await fetchText(url, {
      sourceName: 'company-newsrooms',
      headers: {
        'user-agent': 'RecruiterRadar/1.0 (company-owned newsroom discovery)',
        accept: kind === 'feed'
          ? 'application/rss+xml, application/atom+xml, application/xml, text/xml'
          : 'text/html, application/xhtml+xml',
      },
      signal,
      timeoutMs: 15000,
      redirect: 'follow',
    });
    if (!resolveSameCompanyUrl(response.url || url, url)) {
      return { body: null, error: `Cross-domain or non-public redirect rejected for ${url}` };
    }
    const contentType = String(response.headers.get('content-type') ?? '').toLowerCase();
    const accepted = kind === 'feed'
      ? contentType.includes('xml') || contentType.includes('rss') || contentType.includes('atom') || body.trimStart().startsWith('<')
      : contentType.includes('html');
    if (!accepted) return { body: null, error: `Unsupported ${kind} content-type for ${url}: ${contentType || 'missing'}` };
    return { body, error: null };
  } catch (error) {
    return { body: null, error: error?.message ?? String(error) };
  }
}

function buildRecord({ target, sourceUrl, headline, summary, occurredAt, extractionMethod }) {
  return {
    company_name: target.company_name ?? null,
    company_domain: target.company_domain ?? new URL(target.url).hostname,
    company_website_url: target.url,
    source_url: sourceUrl,
    headline,
    title: headline,
    summary,
    occurred_at: occurredAt,
    event_type: inferEventType(headline),
    publisher: 'company-newsroom',
    extraction_method: extractionMethod,
  };
}

function inferEventType(headline) {
  const text = headline.toLowerCase();
  if (/инвест|финанс|funding|investment/.test(text)) return 'funding';
  if (/откр|расшир|регион|expan|launch|new office/.test(text)) return 'expansion';
  if (/назнач|руковод|директор|leadership|appoint/.test(text)) return 'leadership_change';
  if (/партнер|сотруднич|partner/.test(text)) return 'partnership';
  return 'company_news';
}

function extractDatedHeadline(value) {
  const text = cleanText(value);
  if (!text) return null;

  const russian = text.match(/^(\d{1,2})\s+([а-яё]+)\s+(20\d{2})\s*[—–:-]?\s*(.+)$/iu);
  if (russian) {
    const month = RUSSIAN_MONTHS.get(russian[2].toLowerCase());
    const occurredAt = month === undefined ? null : toIsoDate(Number(russian[3]), month, Number(russian[1]));
    const headline = cleanText(russian[4]);
    return occurredAt && headline?.length >= 12 ? { occurredAt, headline } : null;
  }

  const iso = text.match(/^(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\s*[—–:-]?\s*(.+)$/u);
  if (iso) {
    const occurredAt = toIsoDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    const headline = cleanText(iso[4]);
    return occurredAt && headline?.length >= 12 ? { occurredAt, headline } : null;
  }

  return null;
}

function parsePublishedDate(value) {
  const text = cleanText(value);
  if (!text) return null;
  const timestamp = Date.parse(text);
  if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
  const russian = extractDatedHeadline(`${text} placeholder headline`);
  return russian?.occurredAt ?? null;
}

function toIsoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return date.toISOString();
}

function isArticleUrl(candidate, listing) {
  const url = new URL(candidate);
  const listingUrl = new URL(listing);
  const candidatePath = url.pathname.replace(/\/+$/, '');
  const listingPath = listingUrl.pathname.replace(/\/+$/, '');
  if (candidatePath === listingPath) return false;
  const finalSegment = candidatePath.split('/').filter(Boolean).at(-1)?.toLowerCase() ?? '';
  if (!finalSegment || NAVIGATION_SEGMENTS.has(finalSegment)) return false;
  if (candidatePath.startsWith(`${listingPath}/`)) return true;

  // Some official sites localize only the listing URL (for example `/ru/press/`
  // while article permalinks live under `/press/`). Same-company ownership plus
  // a newsroom path and dated anchor text remain mandatory at the caller.
  return NEWSROOM_PATH_PATTERN.test(candidatePath)
    && (/\d/.test(finalSegment) || finalSegment.length >= 8);
}

function isNewsroomListingLink(url, anchorText) {
  const finalSegment = url.pathname.split('/').filter(Boolean).at(-1)?.toLowerCase() ?? '';
  if (['news', 'newsroom', 'press', 'media', 'press-center', 'press_center', 'novosti', 'releases', 'press-releases', 'press_releases'].includes(finalSegment)) {
    return true;
  }
  const text = cleanText(anchorText)?.toLowerCase() ?? '';
  return /^(?:news|newsroom|press(?: releases)?|media|новости|пресс(?:-центр|-релизы| релизы)?)$/iu.test(text);
}

function normalizeTarget(target) {
  const value = typeof target === 'string' ? { url: target } : target;
  if (!value || typeof value !== 'object') return null;
  try {
    const url = new URL(value.url);
    if (!isPublicHttpUrl(url)) return null;
    url.hash = '';
    return {
      url: url.toString(),
      company_name: cleanText(value.company_name),
      company_domain: normalizeHostname(value.company_domain) ?? url.hostname.toLowerCase(),
    };
  } catch {
    return null;
  }
}

function resolveSameCompanyUrl(value, baseUrl, target = null) {
  if (!value) return null;
  try {
    const url = new URL(decodeEntities(String(value).trim()), baseUrl);
    if (!isPublicHttpUrl(url)) return null;
    const expectedHost = normalizeHostname(target?.company_domain) ?? new URL(baseUrl).hostname.toLowerCase();
    if (!isSameCompanyHost(url.hostname, expectedHost)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function isPublicHttpUrl(url) {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
  // Company-owned public surfaces must use a DNS hostname. Reject every IP
  // literal, including uncommon IPv4 spellings canonicalized by URL and
  // IPv4-mapped IPv6 forms, instead of maintaining an incomplete range list.
  return isIP(host) === 0;
}

function isSameCompanyHost(candidate, expected) {
  const left = normalizeHostname(candidate);
  const right = normalizeHostname(expected);
  if (!left || !right) return false;
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}

function normalizeHostname(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    const host = value.includes('://') ? new URL(value).hostname : value;
    return host.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '') || null;
  } catch {
    return null;
  }
}

function extractJsonLdArticles(html) {
  const articles = [];
  const pattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of String(html ?? '').matchAll(pattern)) {
    try {
      collectJsonLdArticles(JSON.parse(decodeEntities(match[1])), articles);
    } catch {
      // Malformed publisher JSON-LD must not fail the target crawl.
    }
  }
  return articles;
}

function collectJsonLdArticles(value, output) {
  if (Array.isArray(value)) {
    for (const item of value) collectJsonLdArticles(item, output);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
  if (types.some((type) => ['Article', 'BlogPosting', 'NewsArticle'].includes(type))) output.push(value);
  if (value['@graph']) collectJsonLdArticles(value['@graph'], output);
}

function extractJsonLdUrl(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return typeof value['@id'] === 'string'
    ? value['@id']
    : typeof value.url === 'string'
      ? value.url
      : null;
}

function extractAnchors(html) {
  const anchors = [];
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of String(html ?? '').matchAll(pattern)) {
    const attrs = parseAttributes(match[1]);
    if (attrs.href) anchors.push({ href: attrs.href, text: stripMarkup(match[2]) });
  }
  return anchors;
}

function extractTags(html, tagName) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  return String(html ?? '').match(pattern) ?? [];
}

function parseAttributes(tag) {
  const attrs = {};
  const pattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of String(tag ?? '').matchAll(pattern)) {
    attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

function extractElementBlocks(xml, tagName) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  return [...String(xml ?? '').matchAll(pattern)].map((match) => match[1]);
}

function extractElementText(xml, tagName) {
  const escaped = tagName.replace(':', '\\:');
  const pattern = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i');
  const match = String(xml ?? '').match(pattern);
  return match ? stripMarkup(match[1]) : null;
}

function extractLinkHref(xml) {
  const match = String(xml ?? '').match(/<link\b([^>]*)\/?\s*>/i);
  return match ? parseAttributes(match[1]).href ?? null : null;
}

function stripMarkup(value) {
  return decodeEntities(String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '));
}

function decodeEntities(value) {
  return String(value ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function cleanText(value) {
  const text = stripMarkup(value).replace(/\s+/g, ' ').trim();
  return text || null;
}

function addRecord(records, seen, record) {
  if (!record || seen.has(record.source_url)) return;
  seen.add(record.source_url);
  records.push(record);
}

function dedupeRecords(records) {
  const seen = new Set();
  return records.filter((record) => {
    if (!record?.source_url || seen.has(record.source_url)) return false;
    seen.add(record.source_url);
    return true;
  });
}

function invalidTargetResult(target) {
  const error = `Invalid company-newsrooms target: ${JSON.stringify(target)}`;
  return {
    target,
    records: [],
    rootFetched: false,
    pagesDiscovered: 0,
    feedsDiscovered: 0,
    pagesFetched: 0,
    feedsFetched: 0,
    errors: [error],
    error,
  };
}
