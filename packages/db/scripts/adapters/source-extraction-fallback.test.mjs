import assert from 'node:assert/strict';

import { fetchExtractionMarkdown } from './source-extraction-fallback.mjs';

{
  const result = await fetchExtractionMarkdown('https://example.test/careers', {
    crawl4aiApiUrl: null,
    firecrawlApiKey: null,
  });
  assert.equal(result.available, false);
  assert.equal(result.provider, null);
}

{
  const result = await fetchExtractionMarkdown('https://example.test/careers', {
    crawl4aiApiUrl: 'http://crawl4ai.internal',
    crawl4aiFetch: async (url, init) => {
      assert.equal(url, 'http://crawl4ai.internal/md');
      assert.equal(JSON.parse(init.body).url, 'https://example.test/careers');
      return new Response(JSON.stringify({ markdown: '# Jobs\n[Engineer](https://example.test/jobs/1)' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  assert.equal(result.available, true);
  assert.equal(result.provider, 'crawl4ai');
  assert.match(result.markdown, /Engineer/);
}

{
  const result = await fetchExtractionMarkdown('https://example.test/careers', {
    crawl4aiApiUrl: 'http://crawl4ai.internal',
    crawl4aiFetch: async () => new Response('unavailable', { status: 502 }),
    firecrawlApiKey: 'test-only-key',
    firecrawlScrape: async (url) => ({
      url,
      markdown: '# Vacancies\n[Analyst](https://example.test/jobs/2)',
    }),
  });
  assert.equal(result.available, true);
  assert.equal(result.provider, 'firecrawl');
  assert.match(result.markdown, /Analyst/);
  assert.equal(result.attempts[0].outcome, 'error');
  assert.equal(result.attempts[1].outcome, 'parsed');
}

console.log(JSON.stringify({ ok: true, smoke: 'source-extraction-fallback' }, null, 2));
