import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { parseRssAtomFeed } from './feed-parser.mjs';
import { fetchText } from './source-http.mjs';

const TRUST_TIERS = new Set(['official', 'high', 'standard']);
const MAX_FEEDS = 20;
const MAX_TARGETS = 200;
const MAX_FEED_BYTES = 2_000_000;

export function validateCuratedFeedRegistry(value) {
  if (!Array.isArray(value)) throw new Error('Industry-media feed registry must be a JSON array.');
  if (value.length > MAX_FEEDS) throw new Error(`Industry-media feed registry exceeds ${MAX_FEEDS} feeds.`);
  const feeds = value.map((feed, index) => normalizeFeed(feed, index));
  const ids = new Set();
  const urls = new Set();
  for (const feed of feeds) {
    if (ids.has(feed.id) || urls.has(feed.url)) {
      throw new Error(`Duplicate curated feed id or URL: ${feed.id}.`);
    }
    ids.add(feed.id);
    urls.add(feed.url);
  }
  return feeds;
}

export function normalizeTrackedCompanies(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const targets = [];
  for (const raw of value.slice(0, MAX_TARGETS)) {
    const companyName = cleanText(raw?.company_name);
    const companyDomain = normalizeHost(raw?.company_domain);
    if (!companyName || companyName.length < 4 || !companyDomain || isPlaceholderName(companyName)) continue;
    if (seen.has(companyDomain)) continue;
    seen.add(companyDomain);
    targets.push({ company_name: companyName, company_domain: companyDomain });
  }
  return targets;
}

export function matchIndustryFeedItems(items, feed, targets) {
  const records = [];
  const seen = new Set();
  for (const item of items) {
    const haystack = normalizeMatchText(`${item.title ?? ''} ${item.summary ?? ''}`);
    for (const target of targets) {
      if (!matchesCompany(haystack, target)) continue;
      const dedupeKey = `${target.company_domain}|${item.url}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      records.push({
        external_id: `${feed.id}:${item.externalId ?? item.url}:${target.company_domain}`,
        company_name: target.company_name,
        company_domain: target.company_domain,
        source_url: item.url,
        headline: item.title,
        // Keep the company-level headline and provenance only. Feed bodies may
        // contain names or contact details that are unnecessary for matching.
        summary: null,
        published_at: item.publishedAt,
        event_type: classifyEvent(item.title, item.summary),
        publisher: feed.publisher,
        category: feed.category,
        extraction_method: 'curated-rss-atom',
        feed_id: feed.id,
        feed_url: feed.url,
        trust_tier: feed.trust_tier,
        polling_interval_minutes: feed.polling_interval_minutes,
        context_only: true,
      });
    }
  }
  return records;
}

export async function fetchCuratedIndustryFeeds(
  registry,
  targets,
  { fetchTextImpl = fetchText, lookupImpl = lookup, signal } = {},
) {
  const feeds = validateCuratedFeedRegistry(registry);
  const companies = normalizeTrackedCompanies(targets);
  const records = [];
  const diagnostics = [];

  for (const feed of feeds) {
    try {
      await assertPublicDnsHost(new URL(feed.url).hostname, lookupImpl);
      const { response, body } = await fetchTextImpl(feed.url, {
        sourceName: `industry-media:${feed.id}`,
        signal,
        headers: {
          accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
          'user-agent': 'RecruiterRadar/1.0 (curated public feed reader)',
        },
      });
      const responseUrl = assertAllowedResponseHost(response?.url ?? feed.url, feed.allowed_host);
      await assertPublicDnsHost(responseUrl.hostname, lookupImpl);
      const declaredLength = Number.parseInt(response?.headers?.get?.('content-length') ?? '', 10);
      if ((Number.isFinite(declaredLength) && declaredLength > MAX_FEED_BYTES)
        || Buffer.byteLength(String(body ?? ''), 'utf8') > MAX_FEED_BYTES) {
        throw new Error(`Feed ${feed.id} exceeds the ${MAX_FEED_BYTES}-byte limit.`);
      }
      const items = parseRssAtomFeed(body, feed.url, { maxItems: 100 });
      const matches = matchIndustryFeedItems(items, feed, companies);
      records.push(...matches);
      diagnostics.push({ id: feed.id, items: items.length, matches: matches.length, error: null });
    } catch (error) {
      diagnostics.push({ id: feed.id, items: 0, matches: 0, error: error?.message ?? String(error) });
    }
  }

  return { records, diagnostics, feedsProcessed: feeds.length, companiesTracked: companies.length };
}

function normalizeFeed(feed, index) {
  if (!feed || typeof feed !== 'object' || Array.isArray(feed)) {
    throw new Error(`Invalid feed registry item ${index + 1}.`);
  }
  const id = cleanText(feed.id);
  const publisher = cleanText(feed.publisher);
  const category = cleanText(feed.category);
  const trustTier = cleanText(feed.trust_tier);
  const allowedHost = normalizeHost(feed.allowed_host);
  let url;
  try {
    url = new URL(feed.url);
  } catch {
    throw new Error(`Invalid feed URL for ${id ?? index + 1}.`);
  }
  if (!id || !publisher || !category || !TRUST_TIERS.has(trustTier) || !allowedHost) {
    throw new Error(`Feed ${id ?? index + 1} must declare publisher, allowed_host, category, and a valid trust_tier.`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || isIP(url.hostname) !== 0) {
    throw new Error(`Feed ${id} must use a public HTTPS DNS URL.`);
  }
  if (!hostMatches(url.hostname, allowedHost)) throw new Error(`Feed ${id} URL is outside allowed_host.`);
  const polling = Number.parseInt(String(feed.polling_interval_minutes ?? ''), 10);
  if (!Number.isFinite(polling) || polling < 15 || polling > 10080) {
    throw new Error(`Feed ${id} polling_interval_minutes must be between 15 and 10080.`);
  }
  return {
    id,
    publisher,
    category,
    trust_tier: trustTier,
    allowed_host: allowedHost,
    url: url.toString(),
    polling_interval_minutes: polling,
  };
}

function assertAllowedResponseHost(value, allowedHost) {
  const url = new URL(value);
  if (!hostMatches(url.hostname, allowedHost)) {
    throw new Error(`Feed redirect left allowed host ${allowedHost}.`);
  }
  return url;
}

async function assertPublicDnsHost(hostname, lookupImpl) {
  const normalized = normalizeHost(hostname);
  if (!normalized) throw new Error('Feed host must be a public DNS name.');
  const addresses = await lookupImpl(normalized, { all: true, verbatim: true });
  if (!Array.isArray(addresses) || addresses.length === 0
    || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error(`Feed host ${normalized} resolves to a private or reserved network address.`);
  }
}

function matchesCompany(haystack, target) {
  const name = normalizeMatchText(target.company_name);
  const domainStem = target.company_domain.split('.')[0]?.replace(/[-_]+/g, ' ');
  return (name.length >= 4 && containsPhrase(haystack, name))
    || (domainStem?.length >= 5 && containsPhrase(haystack, domainStem));
}

function containsPhrase(haystack, phrase) {
  return ` ${haystack} `.includes(` ${normalizeMatchText(phrase)} `);
}

function classifyEvent(title, summary) {
  const text = normalizeMatchText(`${title ?? ''} ${summary ?? ''}`);
  if (/\u0438\u043d\u0432\u0435\u0441\u0442|\u0444\u0438\u043d\u0430\u043d\u0441|funding|investment|\u0440\u0430\u0443\u043d\u0434/.test(text)) return 'funding';
  if (/\u043f\u043e\u0433\u043b\u043e\u0449|\u0441\u043b\u0438\u044f\u043d\u0438|acquisition|merger/.test(text)) return 'merger_acquisition';
  if (/\u043e\u0442\u043a\u0440|\u0440\u0430\u0441\u0448\u0438\u0440|\u0437\u0430\u043f\u0443\u0441\u043a|expansion|launch|new office|new factory/.test(text)) return 'expansion';
  if (/\u043a\u043e\u043d\u0442\u0440\u0430\u043a\u0442|\u0442\u0435\u043d\u0434\u0435\u0440|contract/.test(text)) return 'contract';
  if (/\u0441\u043e\u043a\u0440\u0430\u0449|\u0443\u0432\u043e\u043b\u044c\u043d\u0435\u043d|layoff|restructur/.test(text)) return 'restructuring';
  return 'industry_context';
}

function isPlaceholderName(value) {
  return /^(?:inn|ogrn|\u0438\u043d\u043d|\u043e\u0433\u0440\u043d)\b/i.test(value.trim());
}

function hostMatches(candidate, allowed) {
  const host = normalizeHost(candidate);
  return Boolean(host && allowed && (host === allowed || host.endsWith(`.${allowed}`)));
}

function normalizeHost(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const host = value.includes('://') ? new URL(value).hostname : value;
    const normalized = host.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    return normalized && isIP(normalized) === 0 ? normalized : null;
  } catch {
    return null;
  }
}

function normalizeMatchText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replaceAll('\u0451', '\u0435')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPrivateAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 0 || b === 168))
      || (a === 198 && (b === 18 || b === 19))
      || a >= 224;
  }
  if (family === 6) {
    const normalized = address.toLowerCase().split('%')[0];
    if (normalized.startsWith('::ffff:')) {
      return isPrivateAddress(normalized.slice('::ffff:'.length));
    }
    return normalized === '::' || normalized === '::1'
      || normalized.startsWith('fc') || normalized.startsWith('fd')
      || /^fe[89ab]/.test(normalized);
  }
  return true;
}

function cleanText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
