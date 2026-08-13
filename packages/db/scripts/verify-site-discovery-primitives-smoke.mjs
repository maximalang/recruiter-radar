import assert from 'node:assert/strict';

import {
  buildConditionalRequestHeaders,
  canonicalizePublicUrl,
  discoverCareerUrlsFromWebsite,
  extractHttpValidators,
  extractEmbeddedJsonDocuments,
  fetchConditionalText,
  hashSourceContent,
  isRobotsPathAllowed,
  parseRobotsTxt,
  parseSitemapXml,
  selectCareerUrls,
} from './adapters/site-discovery.mjs';

const robots = parseRobotsTxt(`
User-agent: *
Disallow: /private/
Disallow: /jobs/internal
Allow: /jobs/
Sitemap: https://example.com/sitemap-index.xml
`);

assert.deepEqual(robots.sitemaps, ['https://example.com/sitemap-index.xml']);
assert.equal(isRobotsPathAllowed('https://example.com/jobs/backend', robots), true);
assert.equal(isRobotsPathAllowed('https://example.com/jobs/internal', robots), false);
assert.equal(isRobotsPathAllowed('https://example.com/private/jobs', robots), false);

const sitemap = parseSitemapXml(`
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/about</loc></url>
  <url><loc>https://example.com/careers/backend?utm_source=sitemap</loc></url>
  <url><loc>https://outside.example/jobs/ignored</loc></url>
</urlset>
`);
assert.deepEqual(sitemap.urls, [
  'https://example.com/about',
  'https://example.com/careers/backend?utm_source=sitemap',
  'https://outside.example/jobs/ignored',
]);
assert.deepEqual(selectCareerUrls(sitemap.urls, 'https://example.com/'), [
  'https://example.com/careers/backend',
]);

assert.equal(
  canonicalizePublicUrl('HTTPS://Example.com:443/jobs/42/?utm_source=x&ref=home#apply'),
  'https://example.com/jobs/42',
);
assert.equal(canonicalizePublicUrl('http://127.0.0.1/jobs'), null);
assert.equal(canonicalizePublicUrl('http://[::1]/jobs'), null);
assert.equal(canonicalizePublicUrl('https://careers.local/jobs'), null);
assert.equal(canonicalizePublicUrl('https://user:secret@example.com/jobs'), null);
assert.deepEqual(buildConditionalRequestHeaders({
  etag: 'W/"abc"',
  lastModified: 'Wed, 12 Aug 2026 10:00:00 GMT',
}), {
  'if-none-match': 'W/"abc"',
  'if-modified-since': 'Wed, 12 Aug 2026 10:00:00 GMT',
});
assert.deepEqual(extractHttpValidators(new Headers({
  etag: 'W/"next"',
  'last-modified': 'Thu, 13 Aug 2026 10:00:00 GMT',
})), {
  etag: 'W/"next"',
  lastModified: 'Thu, 13 Aug 2026 10:00:00 GMT',
});
assert.match(hashSourceContent('stable body'), /^[a-f0-9]{64}$/);
assert.equal(hashSourceContent('stable body'), hashSourceContent(Buffer.from('stable body')));
assert.deepEqual(extractEmbeddedJsonDocuments(`
  <script>window.__PRIVATE__ = {"ignored":true}</script>
  <script id="__NEXT_DATA__" type="application/json">{"props":{"job":{"@type":"JobPosting","title":"Backend"}}}</script>
`), [{ props: { job: { '@type': 'JobPosting', title: 'Backend' } } }]);

let conditionalHeaders;
const conditional = await fetchConditionalText('https://example.com/feed.xml', {
  previous: {
    etag: 'W/"old"',
    lastModified: 'Wed, 12 Aug 2026 10:00:00 GMT',
    contentHash: 'a'.repeat(64),
  },
  retries: 0,
  fetchImpl: async (_url, options) => {
    conditionalHeaders = new Headers(options.headers);
    return new Response(null, { status: 304, headers: { etag: 'W/"old"' } });
  },
});
assert.equal(conditional.notModified, true);
assert.equal(conditional.body, null);
assert.equal(conditional.contentHash, 'a'.repeat(64));
assert.equal(conditionalHeaders.get('if-none-match'), 'W/"old"');
assert.equal(conditionalHeaders.get('if-modified-since'), 'Wed, 12 Aug 2026 10:00:00 GMT');

const resources = new Map([
  ['https://example.com/robots.txt', `User-agent: *\nDisallow: /careers/private\nSitemap: https://example.com/sitemap-index.xml\n`],
  ['https://example.com/sitemap-index.xml', `<sitemapindex><sitemap><loc>https://example.com/jobs.xml</loc></sitemap></sitemapindex>`],
  ['https://example.com/jobs.xml', `<urlset>
    <url><loc>https://example.com/careers</loc></url>
    <url><loc>https://example.com/careers/private</loc></url>
    <url><loc>https://outside.example/jobs</loc></url>
  </urlset>`],
]);
const liveDiscovery = await discoverCareerUrlsFromWebsite('https://example.com/', {
  maxSitemaps: 3,
  fetchTextImpl: async (url) => {
    const body = resources.get(url);
    if (body === undefined) {
      const error = new Error('not found');
      error.status = 404;
      throw error;
    }
    return { response: { url, headers: new Headers() }, body };
  },
});
assert.equal(liveDiscovery.blocked, false);
assert.deepEqual(liveDiscovery.careerUrls, ['https://example.com/careers']);
assert.deepEqual(liveDiscovery.sitemapUrlsFetched, [
  'https://example.com/sitemap-index.xml',
  'https://example.com/jobs.xml',
]);

console.log(JSON.stringify({
  ok: true,
  smoke: 'site-discovery-primitives',
  robotsRules: robots.rules.length,
  sitemapUrls: sitemap.urls.length,
}, null, 2));
