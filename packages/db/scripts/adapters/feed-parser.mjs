/** Parse bounded RSS 2.0 / Atom entries into a source-neutral shape. */
export function parseRssAtomFeed(xml, feedUrl, { maxItems = 100 } = {}) {
  const records = [];
  const seen = new Set();
  const blocks = [
    ...extractElementBlocks(xml, 'item'),
    ...extractElementBlocks(xml, 'entry'),
  ];

  for (const block of blocks) {
    const rawUrl = extractElementText(block, 'link') ?? extractLinkHref(block);
    const url = resolvePublicUrl(rawUrl, feedUrl);
    const title = cleanText(extractElementText(block, 'title'), 500);
    const publishedAt = parsePublishedDate(
      extractElementText(block, 'pubDate')
        ?? extractElementText(block, 'published')
        ?? extractElementText(block, 'updated')
        ?? extractElementText(block, 'dc:date'),
    );
    const summary = cleanText(
      extractElementText(block, 'description')
        ?? extractElementText(block, 'summary')
        ?? extractElementText(block, 'content'),
      5_000,
    );
    const externalId = cleanText(
      extractElementText(block, 'guid') ?? extractElementText(block, 'id'),
      512,
    ) ?? url;

    if (!url || !title || title.length < 8 || !publishedAt || seen.has(url)) continue;
    seen.add(url);
    records.push({ externalId, url, title, summary, publishedAt });
    if (records.length >= maxItems) break;
  }

  return records;
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
  if (!match) return null;
  const href = match[1].match(/\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
  return decodeEntities(href?.[1] ?? href?.[2] ?? href?.[3] ?? '');
}

function resolvePublicUrl(value, baseUrl) {
  if (!value) return null;
  try {
    const rawUrl = decodeEntities(String(value).trim());
    if (rawUrl.length > 2_048) return null;
    const url = new URL(rawUrl, baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function parsePublishedDate(value) {
  const text = cleanText(value);
  if (!text) return null;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function stripMarkup(value) {
  return decodeEntities(String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '));
}

function cleanText(value, maxLength = 1_000) {
  const text = stripMarkup(value).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maxLength) : null;
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
