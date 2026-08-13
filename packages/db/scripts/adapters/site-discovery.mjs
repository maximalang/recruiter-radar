import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import { fetchText, fetchWithSourcePolicy, SourceHttpError } from './source-http.mjs';

const CAREER_PATH_PATTERN = /(?:^|\/)(?:career|careers|job|jobs|vacancy|vacancies|vakansii|rabota|work-with-us|join-us|join-our-team)(?:\/|$)/i;
const TRACKING_QUERY_KEY = /^(?:utm_.+|ref|from|source|campaign)$/i;
const MAX_SITEMAP_BYTES = 2 * 1024 * 1024;
const MAX_SITEMAP_URLS = 500;

/** Parse the rules that apply to the product crawler (`*` is the safe default). */
export function parseRobotsTxt(value, userAgent = 'RecruiterRadarCareerPages') {
  const lines = String(value ?? '').replace(/^\uFEFF/, '').split(/\r?\n/);
  const groups = [];
  const sitemaps = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line) continue;
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    const directive = line.slice(0, separator).trim().toLowerCase();
    const valueText = line.slice(separator + 1).trim();

    if (directive === 'sitemap') {
      const url = canonicalizePublicUrl(valueText, { keepTracking: true });
      if (url && !sitemaps.includes(url)) sitemaps.push(url);
      continue;
    }

    if (directive === 'user-agent') {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(valueText.toLowerCase());
      continue;
    }

    if (!current || !['allow', 'disallow'].includes(directive)) continue;
    // An empty Disallow means "allow everything" and adds no rule.
    if (!valueText) continue;
    current.rules.push({ directive, path: valueText });
  }

  const normalizedAgent = String(userAgent).toLowerCase();
  const exactGroups = groups.filter((group) => group.agents.some((agent) => (
    agent !== '*' && normalizedAgent.includes(agent)
  )));
  const applicable = exactGroups.length > 0
    ? exactGroups
    : groups.filter((group) => group.agents.includes('*'));

  return {
    rules: applicable.flatMap((group) => group.rules),
    sitemaps,
  };
}

/** RFC-style longest-match decision. Equal-length Allow wins over Disallow. */
export function isRobotsPathAllowed(value, robots) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  const path = `${parsed.pathname}${parsed.search}`;
  const matches = (robots?.rules ?? [])
    .map((rule) => ({ ...rule, specificity: robotsRuleSpecificity(rule.path) }))
    .filter((rule) => robotsRuleMatches(path, rule.path))
    .sort((left, right) => (
      right.specificity - left.specificity
      || Number(right.directive === 'allow') - Number(left.directive === 'allow')
    ));
  return matches.length === 0 || matches[0].directive === 'allow';
}

/** Parse a bounded sitemap URL set or sitemap index without executing markup. */
export function parseSitemapXml(value, { maxUrls = MAX_SITEMAP_URLS } = {}) {
  const xml = String(value ?? '');
  const kind = /<\s*sitemapindex\b/i.test(xml)
    ? 'index'
    : /<\s*urlset\b/i.test(xml) ? 'urlset' : 'unknown';
  const urls = [];
  const seen = new Set();
  for (const match of xml.matchAll(/<\s*loc\b[^>]*>([\s\S]*?)<\/\s*loc\s*>/gi)) {
    const decoded = decodeXmlText(match[1]).trim();
    const normalized = canonicalizePublicUrl(decoded, { keepTracking: true });
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
    if (urls.length >= Math.max(1, maxUrls)) break;
  }
  return { kind, urls };
}

/** Keep only same-origin public career paths and canonicalize tracking noise away. */
export function selectCareerUrls(values, baseUrl, { maxUrls = 50 } = {}) {
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  const selected = [];
  const seen = new Set();
  for (const value of values ?? []) {
    const normalized = canonicalizePublicUrl(value);
    if (!normalized) continue;
    const parsed = new URL(normalized);
    if (parsed.origin !== base.origin || !CAREER_PATH_PATTERN.test(parsed.pathname)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    selected.push(normalized);
    if (selected.length >= Math.max(1, maxUrls)) break;
  }
  return selected;
}

/**
 * Parse only explicit JSON script blocks. This never evaluates JavaScript and
 * intentionally ignores arbitrary assignments/private XHR endpoints.
 */
export function extractEmbeddedJsonDocuments(html, { maxDocuments = 20, maxDocumentBytes = 512_000 } = {}) {
  const documents = [];
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptPattern.exec(String(html ?? ''))) !== null && documents.length < maxDocuments) {
    const attributes = match[1] ?? '';
    const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1]?.toLowerCase() ?? '';
    const id = /\bid\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1] ?? '';
    if (!['application/json', 'application/ld+json'].includes(type)
      && !['__NEXT_DATA__', '__NUXT_DATA__'].includes(id)) continue;
    const raw = match[2]?.trim();
    if (!raw || Buffer.byteLength(raw, 'utf8') > maxDocumentBytes) continue;
    try {
      documents.push(JSON.parse(raw));
    } catch {
      // Malformed publisher JSON is ignored; HTML fallback remains available.
    }
  }
  return documents;
}

/**
 * Reusable, bounded robots + sitemap discovery for company-owned surfaces.
 * Network/5xx/401/403 robots failures are fail-closed; 404/410 means no rules.
 */
export async function discoverCareerUrlsFromWebsite(baseUrl, {
  fetchTextImpl = fetchText,
  signal,
  maxSitemaps = 3,
  maxUrls = 50,
} = {}) {
  const policy = await resolvePublicRobotsPolicy(baseUrl, { fetchTextImpl, signal });
  if (policy.blocked) return { ...blockedDiscovery(policy.reason), robotsState: policy.robotsState };
  const base = policy.baseUrl;
  const baseOrigin = new URL(base).origin;
  const { robots, robotsState } = policy;

  const sitemapCandidates = robots.sitemaps.length > 0
    ? robots.sitemaps
    : [new URL('/sitemap.xml', baseOrigin).toString()];
  const queue = sitemapCandidates.filter((url) => isSameOrigin(url, baseOrigin));
  const visited = new Set();
  const discovered = [];
  const errors = [];

  while (queue.length > 0 && visited.size < Math.max(1, maxSitemaps)) {
    const sitemapUrl = queue.shift();
    if (!sitemapUrl || visited.has(sitemapUrl)) continue;
    visited.add(sitemapUrl);
    try {
      const result = await fetchTextImpl(sitemapUrl, {
        sourceName: 'career-pages sitemap',
        headers: { accept: 'application/xml,text/xml;q=0.9,*/*;q=0.1', 'user-agent': 'RecruiterRadarCareerPages/1.0' },
        redirect: 'follow',
        signal,
        retries: 0,
        timeoutMs: 7_000,
      });
      if (!isSameOrigin(result.response?.url ?? sitemapUrl, baseOrigin)) {
        errors.push('sitemap-cross-origin-redirect');
        continue;
      }
      if (Buffer.byteLength(result.body ?? '', 'utf8') > MAX_SITEMAP_BYTES) {
        errors.push('sitemap-too-large');
        continue;
      }
      const parsed = parseSitemapXml(result.body);
      if (parsed.kind === 'index') {
        for (const child of parsed.urls) {
          if (isSameOrigin(child, baseOrigin) && !visited.has(child)) queue.push(child);
        }
      } else {
        discovered.push(...parsed.urls);
      }
    } catch (error) {
      errors.push(`sitemap-${safeErrorCategory(error)}`);
    }
  }

  const careerUrls = selectCareerUrls(discovered, base, { maxUrls })
    .filter((url) => isRobotsPathAllowed(url, robots));
  return {
    blocked: false,
    robotsState,
    robots,
    sitemapUrlsFetched: [...visited],
    careerUrls,
    errors: [...new Set(errors)],
  };
}

/** Resolve only the public robots policy without triggering sitemap discovery. */
export async function resolvePublicRobotsPolicy(baseUrl, {
  fetchTextImpl = fetchText,
  signal,
  userAgent = 'RecruiterRadarCareerPages',
} = {}) {
  const base = canonicalizePublicUrl(baseUrl, { keepTracking: true });
  if (!base) return { ...blockedDiscovery('invalid-base-url'), baseUrl: null, reason: 'invalid-base-url' };
  const baseOrigin = new URL(base).origin;
  const robotsUrl = new URL('/robots.txt', baseOrigin).toString();
  try {
    const result = await fetchTextImpl(robotsUrl, {
      sourceName: 'public-source robots',
      headers: { accept: 'text/plain,*/*;q=0.1', 'user-agent': `${userAgent}/1.0` },
      redirect: 'follow',
      signal,
      retries: 1,
      timeoutMs: 5_000,
    });
    if (!isSameOrigin(result.response?.url ?? robotsUrl, baseOrigin)) {
      return { ...blockedDiscovery('robots-cross-origin-redirect'), baseUrl: base, reason: 'robots-cross-origin-redirect' };
    }
    return {
      blocked: false,
      reason: null,
      baseUrl: base,
      robotsState: 'loaded',
      robots: parseRobotsTxt(result.body, userAgent),
    };
  } catch (error) {
    if (![404, 410].includes(Number(error?.status))) {
      const reason = `robots-${safeErrorCategory(error)}`;
      return { ...blockedDiscovery(reason), baseUrl: base, reason };
    }
    return {
      blocked: false,
      reason: null,
      baseUrl: base,
      robotsState: 'missing',
      robots: { rules: [], sitemaps: [] },
    };
  }
}

export function canonicalizePublicUrl(value, { keepTracking = false } = {}) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || isIP(host) !== 0) {
      return null;
    }
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
      url.port = '';
    }
    url.hash = '';
    if (!keepTracking) {
      for (const key of [...url.searchParams.keys()]) {
        if (TRACKING_QUERY_KEY.test(key)) url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch {
    return null;
  }
}

export function buildConditionalRequestHeaders(previous = {}) {
  const headers = {};
  if (isBoundedHeader(previous.etag)) headers['if-none-match'] = previous.etag.trim();
  if (isBoundedHeader(previous.lastModified)) headers['if-modified-since'] = previous.lastModified.trim();
  return headers;
}

export function extractHttpValidators(headers) {
  const etag = headers?.get?.('etag')?.trim() || null;
  const lastModified = headers?.get?.('last-modified')?.trim() || null;
  return { etag, lastModified };
}

/** Execute a conditional GET without hiding 304, validators, or content hash. */
export async function fetchConditionalText(url, {
  previous = {},
  fetchImpl = fetch,
  headers = {},
  sourceName = 'conditional source',
  ...options
} = {}) {
  const response = await fetchWithSourcePolicy(url, {
    ...options,
    fetchImpl,
    sourceName,
    headers: {
      ...headers,
      ...buildConditionalRequestHeaders(previous),
    },
  });
  const validators = extractHttpValidators(response.headers);
  if (response.status === 304) {
    return {
      notModified: true,
      response,
      body: null,
      contentHash: previous.contentHash ?? null,
      validators: {
        etag: validators.etag ?? previous.etag ?? null,
        lastModified: validators.lastModified ?? previous.lastModified ?? null,
      },
    };
  }
  if (!response.ok) {
    throw new SourceHttpError(`${sourceName} returned HTTP ${response.status}.`, {
      url: canonicalizePublicUrl(response.url || url, { keepTracking: true }) ?? '<invalid-url>',
      status: response.status,
      statusText: response.statusText,
    });
  }
  const body = await response.text();
  return {
    notModified: false,
    response,
    body,
    contentHash: hashSourceContent(body),
    validators,
  };
}

export function hashSourceContent(value) {
  return createHash('sha256').update(value).digest('hex');
}

function blockedDiscovery(reason) {
  return {
    blocked: true,
    robotsState: 'blocked',
    robots: { rules: [], sitemaps: [] },
    sitemapUrlsFetched: [],
    careerUrls: [],
    errors: [reason],
  };
}

function robotsRuleSpecificity(value) {
  return String(value).replace(/[*$]/g, '').length;
}

function robotsRuleMatches(path, value) {
  const pattern = String(value);
  if (!pattern.startsWith('/')) return false;
  const anchored = pattern.endsWith('$');
  const body = pattern.slice(0, anchored ? -1 : undefined)
    .split('*')
    .map(escapeRegExp)
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`).test(path);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeXmlText(value) {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function isSameOrigin(value, expectedOrigin) {
  try {
    return new URL(value).origin === expectedOrigin;
  } catch {
    return false;
  }
}

function safeErrorCategory(error) {
  const status = Number(error?.status);
  if (Number.isInteger(status) && status >= 400 && status <= 599) return `http-${status}`;
  if (error?.name === 'AbortError' || /timeout/i.test(error?.message ?? '')) return 'timeout';
  return 'network-error';
}

function isBoundedHeader(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 512 && !/[\r\n]/.test(value);
}
