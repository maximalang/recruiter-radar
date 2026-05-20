import { fetchText } from './source-http.mjs';

export function parseCompanyPage(html, url) {
  if (!html || typeof html !== 'string') {
    return null;
  }

  const title = extractTagContent(html, 'title');
  const metaDescription = extractMetaContent(html, 'name', 'description');
  const ogTitle = extractMetaContent(html, 'property', 'og:title');
  const ogDescription = extractMetaContent(html, 'property', 'og:description');

  const bodyText = extractVisibleText(html);
  const signals = detectSignals(bodyText);
  const contactPaths = extractContactPaths(html, url, bodyText);

  return {
    page_url: url,
    page_title: ogTitle ?? title ?? null,
    summary: ogDescription ?? metaDescription ?? truncate(bodyText, 500) ?? null,
    signals,
    contact_paths: contactPaths,
    _meta: { crawled: true },
  };
}

export async function fetchCompanyPage(url, { signal, timeoutMs = 15000 } = {}) {
  try {
    const { response, body: html } = await fetchText(url, {
      sourceName: 'company-site',
      headers: {
        'user-agent': 'RecruiterRadar/1.0 (company-site enrichment)',
        accept: 'text/html',
      },
      signal,
      timeoutMs,
      redirect: 'follow',
    });

    const contentType = response.headers.get('content-type') ?? '';

    if (!contentType.includes('text/html')) {
      return { url, error: `Non-HTML content-type: ${contentType}`, record: null };
    }

    const record = parseCompanyPage(html, url);
    return { url, error: null, record };
  } catch (err) {
    return { url, error: err.message ?? String(err), record: null };
  }
}

export async function fetchCompanyPages(targets, { signal, concurrency = 3 } = {}) {
  const results = [];
  const queue = [...targets];

  async function worker() {
    while (queue.length > 0) {
      const target = queue.shift();

      if (!target) break;

      const url = typeof target === 'string' ? target : target.url;
      const companyName = typeof target === 'object' ? target.company_name ?? null : null;
      const companyDomain = typeof target === 'object' ? target.company_domain ?? null : null;

      const result = await fetchCompanyPage(url, { signal });

      if (result.record) {
        result.record.company_name = companyName;
        result.record.company_domain = companyDomain;
      }

      results.push(result);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => worker());
  await Promise.all(workers);

  return results;
}

function extractTagContent(html, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'i');
  const match = html.match(regex);
  const text = match?.[1]?.trim() ?? null;
  return text === '' ? null : text;
}

function extractMetaContent(html, attrName, attrValue) {
  const escaped = attrValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+${attrName}=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+${attrName}=["']${escaped}["']`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match?.[1]) {
      const text = match[1].trim();
      return text === '' ? null : text;
    }
  }

  return null;
}

function extractVisibleText(html) {
  let text = html;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/&nbsp;/gi, ' ');
  text = text.replace(/&amp;/gi, '&');
  text = text.replace(/&lt;/gi, '<');
  text = text.replace(/&gt;/gi, '>');
  text = text.replace(/&quot;/gi, '"');
  text = text.replace(/&#\d+;/g, ' ');
  text = text.replace(/&\w+;/g, ' ');
  text = text.replace(/\s+/g, ' ');
  return text.trim();
}

function detectSignals(text) {
  if (!text) return [];

  const lower = text.toLowerCase();
  const signals = [];
  const patterns = [
    { keyword: 'вакансии', signal: 'hiring_section' },
    { keyword: 'careers', signal: 'hiring_section' },
    { keyword: 'мы ищем', signal: 'active_hiring' },
    { keyword: 'we are hiring', signal: 'active_hiring' },
    { keyword: 'join our team', signal: 'active_hiring' },
    { keyword: 'присоединяйтесь', signal: 'active_hiring' },
    { keyword: 'открытые позиции', signal: 'open_positions' },
    { keyword: 'open positions', signal: 'open_positions' },
  ];

  for (const { keyword, signal } of patterns) {
    if (lower.includes(keyword) && !signals.includes(signal)) {
      signals.push(signal);
    }
  }

  return signals;
}

function extractContactPaths(html, baseUrl, visibleText) {
  const contactPaths = [];
  const seen = new Set();

  for (const href of extractHrefValues(html)) {
    const lowerHref = href.toLowerCase();

    if (lowerHref.startsWith('mailto:')) {
      addGenericEmailPath(contactPaths, seen, href.slice('mailto:'.length), 'mailto');
      continue;
    }

    if (!lowerHref.startsWith('tel:')) {
      addContactPagePath(contactPaths, seen, href, baseUrl);
    }
  }

  for (const token of String(visibleText ?? '').split(' ')) {
    addGenericEmailPath(contactPaths, seen, token, 'text');
  }

  return contactPaths;
}

function extractHrefValues(html) {
  const hrefValues = [];
  let searchFrom = 0;
  const lowerHtml = html.toLowerCase();

  while (searchFrom < html.length) {
    const anchorStart = lowerHtml.indexOf('<a', searchFrom);

    if (anchorStart === -1) {
      break;
    }

    const anchorEnd = html.indexOf('>', anchorStart);

    if (anchorEnd === -1) {
      break;
    }

    const hrefValue = extractHrefFromTag(html.slice(anchorStart, anchorEnd + 1));

    if (hrefValue) {
      hrefValues.push(hrefValue);
    }

    searchFrom = anchorEnd + 1;
  }

  return hrefValues;
}

function extractHrefFromTag(tag) {
  const lowerTag = tag.toLowerCase();
  const hrefIndex = lowerTag.indexOf('href');

  if (hrefIndex === -1) {
    return null;
  }

  const separatorIndex = tag.indexOf('=', hrefIndex);

  if (separatorIndex === -1) {
    return null;
  }

  const rawValue = tag.slice(separatorIndex + 1).trimStart();
  const quote = rawValue.charAt(0);

  if (quote !== String.fromCharCode(34) && quote !== String.fromCharCode(39)) {
    let unquotedValue = rawValue.split(' ')[0];

    if (unquotedValue.endsWith('>')) {
      unquotedValue = unquotedValue.slice(0, -1);
    }

    return decodeHtmlAttribute(unquotedValue);
  }

  const endIndex = rawValue.indexOf(quote, 1);
  return decodeHtmlAttribute(endIndex === -1 ? rawValue.slice(1) : rawValue.slice(1, endIndex));
}

function addGenericEmailPath(contactPaths, seen, value, source) {
  const email = normalizeEmail(value);

  if (!email || !isSafeGenericEmail(email)) {
    return;
  }

  const key = `generic_email:${email}`;

  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  contactPaths.push({ type: 'generic_email', value: email, source });
}

function addContactPagePath(contactPaths, seen, href, baseUrl) {
  const contactUrl = normalizeContactUrl(href, baseUrl);

  if (!contactUrl || !isContactPageUrl(contactUrl, baseUrl)) {
    return;
  }

  const key = `contact_page:${contactUrl}`;

  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  contactPaths.push({ type: 'contact_page', url: contactUrl, source: 'link' });
}

function normalizeEmail(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }

  let email = trimEmailBoundaryChars(decodeUriComponent(value).split('?')[0].trim().toLowerCase());

  if (email.startsWith('<') && email.endsWith('>')) {
    email = email.slice(1, -1);
  }

  const parts = email.split('@');

  if (parts.length !== 2 || !parts[0] || !parts[1] || !parts[1].includes('.')) {
    return null;
  }

  if (email.includes(' ') || email.includes('/') || email.includes('\\')) {
    return null;
  }

  return email;
}

function trimEmailBoundaryChars(value) {
  let text = value;

  while (text.length > 0 && EMAIL_BOUNDARY_CHARS.has(text.charAt(text.length - 1))) {
    text = text.slice(0, -1);
  }

  return text;
}

function isSafeGenericEmail(email) {
  const localPart = email.split('@')[0].replace(/[._+]+/g, '-');

  if (GENERIC_EMAIL_LOCAL_PARTS.has(localPart)) {
    return true;
  }

  const parts = localPart.split('-').filter(Boolean);
  return parts.length === 2
    && GENERIC_EMAIL_LOCAL_PARTS.has(parts[0])
    && GENERIC_EMAIL_SUFFIXES.has(parts[1]);
}

function normalizeContactUrl(href, baseUrl) {
  try {
    const url = new URL(decodeHtmlAttribute(href), baseUrl);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function isContactPageUrl(value, baseUrl) {
  try {
    const url = new URL(value);
    const base = new URL(baseUrl);

    if (url.origin !== base.origin) {
      return false;
    }

    const searchablePath = `${url.pathname} ${url.search}`.toLowerCase();
    return CONTACT_PAGE_PATH_KEYWORDS.some((keyword) => searchablePath.includes(keyword));
  } catch {
    return false;
  }
}

function decodeHtmlAttribute(value) {
  return String(value)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, String.fromCharCode(34))
    .replace(/&#39;/g, String.fromCharCode(39));
}

function decodeUriComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const GENERIC_EMAIL_LOCAL_PARTS = new Set([
  'career',
  'careers',
  'contact',
  'hello',
  'hr',
  'info',
  'job',
  'jobs',
  'kadry',
  'office',
  'people',
  'rabota',
  'recruiting',
  'recruitment',
  'talent',
  'vacancy',
  'vacancies',
  'work',
]);

const EMAIL_BOUNDARY_CHARS = new Set(['.', ',', ';', ':', ')', ']', '}']);

const GENERIC_EMAIL_SUFFIXES = new Set([
  'career',
  'careers',
  'contact',
  'department',
  'group',
  'jobs',
  'office',
  'recruiting',
  'recruitment',
  'team',
  'vacancy',
  'work',
]);

const CONTACT_PAGE_PATH_KEYWORDS = [
  'contact',
  'contacts',
  'feedback',
  'kontakty',
  'kontakt',
  'rekvizity',
  'requisites',
];

function truncate(text, maxLength) {
  if (!text) return null;
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + '…';
}
