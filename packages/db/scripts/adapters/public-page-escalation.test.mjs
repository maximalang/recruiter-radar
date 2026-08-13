import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchPublicPageWithEscalation } from './public-page-escalation.mjs';

const policy = {
  blocked: false,
  reason: null,
  robotsState: 'loaded',
  robots: { rules: [] },
};

test('public page escalation reaches rendered DOM after weak static HTML', async () => {
  const result = await fetchPublicPageWithEscalation({
    url: 'https://company.example/news/',
    sourceName: 'company-newsrooms',
    parseHtml: (html) => html.includes('validated article')
      ? [{ url: 'https://company.example/news/1', title: 'validated article' }]
      : [],
    validateRecord: (record) => record.url.startsWith('https://company.example/news/') && record.title.length > 5,
    dependencies: {
      accessPolicy: policy,
      fetchText: async () => ({
        response: { url: 'https://company.example/news/' },
        body: '<html><body>JavaScript required</body></html>',
      }),
      renderPool: {
        fetchPage: async () => ({
          url: 'https://company.example/news/',
          status: 200,
          html: '<html><body>validated article</body></html>',
        }),
      },
    },
  });

  assert.equal(result.selectedStage, 'rendered-dom');
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.attempts.map((attempt) => attempt.stage), [
    'static-http',
    'structured-data',
    'rendered-dom',
  ]);
});

test('public page escalation validates extraction output and never bypasses denial', async () => {
  let extractionCalled = false;
  const blocked = await fetchPublicPageWithEscalation({
    url: 'https://company.example/careers',
    sourceName: 'company-site',
    parseHtml: () => [],
    parseMarkdown: () => [{ url: 'https://company.example/jobs/1', title: 'Engineer' }],
    validateRecord: () => true,
    dependencies: {
      accessPolicy: { ...policy, blocked: true, reason: 'robots-http-403' },
      fetchExtractionMarkdown: async () => {
        extractionCalled = true;
        return { available: true, provider: 'crawl4ai', markdown: 'ignored' };
      },
    },
  });
  assert.equal(blocked.stoppedByPolicy, true);
  assert.equal(extractionCalled, false);

  const extracted = await fetchPublicPageWithEscalation({
    url: 'https://company.example/careers',
    sourceName: 'company-site',
    parseHtml: () => [],
    parseMarkdown: () => [
      { url: 'https://company.example/jobs/1', title: 'Engineer' },
      { url: 'https://attacker.example/jobs/2', title: 'Fabricated' },
    ],
    validateRecord: (record) => record.url.startsWith('https://company.example/jobs/'),
    dependencies: {
      accessPolicy: policy,
      rendered: false,
      fetchText: async () => ({
        response: { url: 'https://company.example/careers' },
        body: '<html><body>empty</body></html>',
      }),
      fetchExtractionMarkdown: async () => ({
        available: true,
        provider: 'crawl4ai',
        markdown: '[Engineer](https://company.example/jobs/1)',
        attempts: [],
      }),
    },
  });
  assert.equal(extracted.selectedStage, 'extraction');
  assert.deepEqual(extracted.records, [
    { url: 'https://company.example/jobs/1', title: 'Engineer' },
  ]);
  assert.equal(extracted.attempts.at(-1).rejectedRecords, 1);
});
