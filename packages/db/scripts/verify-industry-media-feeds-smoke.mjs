import assert from 'node:assert/strict';

import {
  fetchCuratedIndustryFeeds,
  matchIndustryFeedItems,
  normalizeTrackedCompanies,
  validateCuratedFeedRegistry,
} from './adapters/curated-industry-feeds.mjs';
import { parseRssAtomFeed } from './adapters/feed-parser.mjs';

const registry = validateCuratedFeedRegistry([{
  id: 'official-finance-feed',
  publisher: 'Official Finance Publisher',
  url: 'https://official.example/feed.xml',
  allowed_host: 'official.example',
  category: 'finance',
  trust_tier: 'official',
  polling_interval_minutes: 60,
}]);
const targets = normalizeTrackedCompanies([
  { company_name: 'Acme Bank', company_domain: 'acme.example' },
  { company_name: 'INN 7700000000', company_domain: 'placeholder.example' },
]);
assert.equal(targets.length, 1);

const xml = `<?xml version="1.0"?><rss><channel>
  <item><guid>article-1</guid><title>Acme Bank opens a new office</title><link>https://official.example/news/acme</link><pubDate>Wed, 12 Aug 2026 10:00:00 GMT</pubDate><description>Expansion in Moscow.</description></item>
  <item><guid>article-2</guid><title>Unrelated market statistics</title><link>https://official.example/news/market</link><pubDate>Wed, 12 Aug 2026 11:00:00 GMT</pubDate></item>
</channel></rss>`;
const items = parseRssAtomFeed(xml, registry[0].url);
assert.equal(items.length, 2);
const matched = matchIndustryFeedItems(items, registry[0], targets);
assert.equal(matched.length, 1);
assert.equal(matched[0].company_domain, 'acme.example');
assert.equal(matched[0].event_type, 'expansion');
assert.equal(matched[0].context_only, true);
assert.equal(matched[0].summary, null);

const fetched = await fetchCuratedIndustryFeeds(registry, targets, {
  fetchTextImpl: async () => ({ response: { url: registry[0].url }, body: xml }),
  lookupImpl: async () => [{ address: '8.8.8.8', family: 4 }],
});
assert.equal(fetched.records.length, 1);
assert.equal(fetched.diagnostics[0].error, null);

const redirected = await fetchCuratedIndustryFeeds(registry, targets, {
  fetchTextImpl: async () => ({ response: { url: 'https://untrusted.example/feed.xml' }, body: xml }),
  lookupImpl: async () => [{ address: '8.8.8.8', family: 4 }],
});
assert.equal(redirected.records.length, 0);
assert.match(redirected.diagnostics[0].error, /left allowed host/i);

const privateDns = await fetchCuratedIndustryFeeds(registry, targets, {
  fetchTextImpl: async () => ({ response: { url: registry[0].url }, body: xml }),
  lookupImpl: async () => [{ address: '127.0.0.1', family: 4 }],
});
assert.equal(privateDns.records.length, 0);
assert.match(privateDns.diagnostics[0].error, /private or reserved/i);

assert.throws(() => validateCuratedFeedRegistry([{ ...registry[0], url: 'http://127.0.0.1/feed' }]), /public HTTPS DNS URL/i);

console.log(JSON.stringify({
  ok: true,
  smoke: 'industry-media-curated-feeds',
  feeds: registry.length,
  parsedItems: items.length,
  matchedCompanyItems: matched.length,
  unsafeRedirectRejected: true,
  privateDnsRejected: true,
  evidenceBoundary: 'context-only, never hiring proof',
}, null, 2));
