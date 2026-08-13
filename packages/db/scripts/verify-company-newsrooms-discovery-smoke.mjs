import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  discoverCompanyNewsroomUrls,
  extractCompanyNewsroomItemsFromHtml,
  parseCompanyNewsroomFeed,
} from './adapters/company-newsroom-crawl.mjs';
import {
  buildFetchSummary,
  resolveCompanyNewsroomsLiveInput,
} from './source-company-newsrooms.mjs';

const target = {
  url: 'https://vk.company/',
  company_name: 'VK',
  company_domain: 'vk.company',
};

const rootHtml = `
  <html><head>
    <link rel="alternate" type="application/rss+xml" href="/ru/press/rss.xml">
  </head><body>
    <a href="/ru/press/releases/">Пресс-релизы</a>
    <a href="https://media.example/news/vk">СМИ о компании</a>
    <a href="https://vk.com/vk">Социальная сеть</a>
  </body></html>
`;

const discovered = discoverCompanyNewsroomUrls(rootHtml, target.url);
assert.deepEqual(discovered.pageUrls, ['https://vk.company/ru/press/releases/']);
assert.deepEqual(discovered.feedUrls, ['https://vk.company/ru/press/rss.xml']);

const listingHtml = `
  <html><body><main>
    <a href="/press/releases/12382/">12 августа 2026 MAX стал доступен пользователям в новых регионах</a>
    <a href="/press/releases/12381/">11 августа 2026 VK открыла новый технологический центр</a>
    <a href="/ru/press/releases/">Пресс-релизы</a>
    <a href="/ru/press/contacts/">Контакты для СМИ</a>
    <a href="https://media.example/articles/vk">Публикация внешнего СМИ от 10 августа 2026</a>
  </main></body></html>
`;

const htmlItems = extractCompanyNewsroomItemsFromHtml(
  listingHtml,
  'https://vk.company/ru/press/releases/',
  target,
);
assert.equal(htmlItems.length, 2);
assert.deepEqual(htmlItems.map((item) => item.source_url), [
  'https://vk.company/press/releases/12382/',
  'https://vk.company/press/releases/12381/',
]);
assert.equal(htmlItems[0].headline, 'MAX стал доступен пользователям в новых регионах');
assert.equal(htmlItems[0].occurred_at, '2026-08-12T00:00:00.000Z');
assert.equal(htmlItems[0].company_name, 'VK');
assert.equal(htmlItems[0].company_domain, 'vk.company');
assert.equal(htmlItems[0].publisher, 'company-newsroom');
assert.equal(htmlItems.some((item) => item.source_url.includes('media.example')), false);

const jsonLdItems = extractCompanyNewsroomItemsFromHtml(`
  <script type="application/ld+json">{
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    "mainEntityOfPage": { "@id": "/press/releases/12379/" },
    "headline": "VK представила новую платформу для бизнеса",
    "datePublished": "2026-08-09T08:00:00+03:00",
    "description": "Официальный запуск новой платформы."
  }</script>
`, 'https://vk.company/ru/press/releases/', target);
assert.equal(jsonLdItems.length, 1);
assert.equal(jsonLdItems[0].source_url, 'https://vk.company/press/releases/12379/');
assert.equal(jsonLdItems[0].occurred_at, '2026-08-09T05:00:00.000Z');
assert.equal(jsonLdItems[0].extraction_method, 'json-ld');

const feedXml = `
  <?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0"><channel>
    <item>
      <title>VK запустила программу для разработчиков</title>
      <link>https://vk.company/ru/press/releases/12380/</link>
      <pubDate>Mon, 10 Aug 2026 09:30:00 GMT</pubDate>
      <description>Новая программа помогает технологическим командам.</description>
    </item>
    <item>
      <title>Внешний пересказ</title>
      <link>https://media.example/vk-repost</link>
      <pubDate>Mon, 10 Aug 2026 10:00:00 GMT</pubDate>
    </item>
  </channel></rss>
`;

const feedItems = parseCompanyNewsroomFeed(
  feedXml,
  'https://vk.company/ru/press/rss.xml',
  target,
);
assert.equal(feedItems.length, 1);
assert.equal(feedItems[0].source_url, 'https://vk.company/ru/press/releases/12380/');
assert.equal(feedItems[0].occurred_at, '2026-08-10T09:30:00.000Z');
assert.equal(feedItems[0].summary, 'Новая программа помогает технологическим командам.');

const ambiguousHtml = `
  <nav>
    <a href="/ru/press/releases/archive/">Архив</a>
    <a href="/ru/press/releases/search/">Поиск</a>
    <a href="/ru/press/releases/next/">Следующая страница</a>
  </nav>
`;
assert.deepEqual(
  extractCompanyNewsroomItemsFromHtml(
    ambiguousHtml,
    'https://vk.company/ru/press/releases/',
    target,
  ),
  [],
);

let privateFetchAttempted = false;
const originalPrivateFetch = globalThis.fetch;
globalThis.fetch = async () => {
  privateFetchAttempted = true;
  throw new Error('private URL must not be fetched');
};
try {
  const privateTargets = await (await import('./adapters/company-newsroom-crawl.mjs')).fetchCompanyNewsrooms([
    { url: 'http://127.0.0.1/internal', company_name: 'Invalid', company_domain: '127.0.0.1' },
    { url: 'http://2130706433/internal', company_name: 'Invalid numeric IP' },
    { url: 'http://[::1]/internal', company_name: 'Invalid IPv6' },
  ]);
  assert.equal(privateTargets.every((item) => item.error?.startsWith('Invalid company-newsrooms target:')), true);
  assert.equal(privateFetchAttempted, false);
} finally {
  globalThis.fetch = originalPrivateFetch;
}

const expectedZero = await verifyExpectedZeroContracts();

console.log(JSON.stringify({
  ok: true,
  smoke: 'company-newsrooms-discovery',
  newsroomPagesDiscovered: discovered.pageUrls.length,
  feedsDiscovered: discovered.feedUrls.length,
  htmlItems: htmlItems.length,
  jsonLdItems: jsonLdItems.length,
  feedItems: feedItems.length,
  externalPublisherItemsAccepted: 0,
  ambiguousNavigationItemsAccepted: 0,
  privateTargetsFetched: 0,
  expectedZero,
}, null, 2));

async function verifyExpectedZeroContracts() {
  const tempDir = mkdtempSync(join(tmpdir(), 'rr-company-newsrooms-zero-'));
  const emptyTargetsPath = join(tempDir, 'empty.json');
  const reachableTargetsPath = join(tempDir, 'reachable.json');
  const failedTargetsPath = join(tempDir, 'failed.json');
  writeFileSync(emptyTargetsPath, '[]');
  writeFileSync(reachableTargetsPath, JSON.stringify([target]));
  writeFileSync(failedTargetsPath, JSON.stringify([{ ...target, url: 'https://unreachable.vk.company/' }]));

  const empty = await resolveCompanyNewsroomsLiveInput({ targetsFilePath: emptyTargetsPath });
  const emptySummary = buildFetchSummary(empty);
  assert.equal(emptySummary.zeroReason, 'no-eligible-company-targets');
  assert.equal(emptySummary.normalizedRecords, 0);

  const originalFetch = globalThis.fetch;
  try {
    process.env.COMPANY_NEWSROOMS_ALLOW_PRIVATE_TEST_TARGETS = 'true';
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      url: target.url,
      headers: { get: () => 'text/html; charset=utf-8' },
      text: async () => '<html><body><a href="/ru/press/releases/">Пресс-релизы</a><nav>Архив публикаций</nav></body></html>',
    });
    const reachable = await resolveCompanyNewsroomsLiveInput({ targetsFilePath: reachableTargetsPath });
    const reachableSummary = buildFetchSummary(reachable);
    assert.equal(reachableSummary.zeroReason, 'no-company-newsroom-items');
    assert.equal(reachableSummary.crawlSuccesses, 1);
    assert.equal(reachableSummary.normalizedRecords, 0);

    let requestCount = 0;
    globalThis.fetch = async (url) => {
      requestCount += 1;
      if (String(url) === target.url) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          url: target.url,
          headers: { get: () => 'text/html; charset=utf-8' },
          text: async () => '<html><body><a href="/ru/press/releases/">Пресс-релизы</a></body></html>',
        };
      }
      throw new Error('simulated discovered-page failure');
    };
    await assert.rejects(
      () => resolveCompanyNewsroomsLiveInput({ targetsFilePath: reachableTargetsPath }),
      /discovered 1 newsroom resources, but all were unreachable/,
    );
    assert.ok(requestCount > 1);

    globalThis.fetch = async () => { throw new Error('simulated network failure'); };
    await assert.rejects(
      () => resolveCompanyNewsroomsLiveInput({ targetsFilePath: failedTargetsPath }),
      /could not reach any of 1 targets/,
    );

    return {
      emptyTargets: emptySummary.zeroReason,
      reachableWithoutItems: reachableSummary.zeroReason,
      discoveredButUnreachableRejected: true,
      allUnreachableRejected: true,
    };
  } finally {
    delete process.env.COMPANY_NEWSROOMS_ALLOW_PRIVATE_TEST_TARGETS;
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
}
