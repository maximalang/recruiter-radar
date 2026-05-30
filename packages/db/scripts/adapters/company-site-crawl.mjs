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

  return {
    page_url: url,
    page_title: ogTitle ?? title ?? null,
    summary: ogDescription ?? metaDescription ?? truncate(bodyText, 500) ?? null,
    signals,
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

function truncate(text, maxLength) {
  if (!text) return null;
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + '…';
}
