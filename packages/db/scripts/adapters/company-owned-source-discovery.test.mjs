import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractCompanyOwnedSourceLinks,
  persistCompanyOwnedSourceLinks,
} from './company-owned-source-discovery.mjs';
import { parseCompanyPage } from './company-site-crawl.mjs';

test('extracts bounded company-level provider links and rejects non-enrollment surfaces', () => {
  const links = extractCompanyOwnedSourceLinks([
    'https://github.com/acme',
    'https://github.com/acme/repository',
    'https://github.com/login',
    'https://www.youtube.com/channel/UCabcDEF_123',
    'https://youtube.com/@AcmeOfficial',
    'https://youtube.com/watch?v=private-context',
    'https://t.me/acme_news',
    'https://t.me/acme_news/42',
    'https://t.me/+invite-token',
    'https://t.me/share/url?url=https://example.test',
    'javascript:alert(1)',
  ], 'https://acme.example/about');

  assert.deepEqual(links, [
    {
      sourceId: 'github-company-org',
      sourceKey: 'organization:acme',
      externalId: 'acme',
      providerUrl: 'https://github.com/acme',
      ownershipProofUrl: 'https://acme.example/about',
    },
    {
      sourceId: 'youtube-company-channels',
      sourceKey: 'channel:UCabcDEF_123',
      externalId: 'UCabcDEF_123',
      providerUrl: 'https://youtube.com/channel/UCabcDEF_123',
      ownershipProofUrl: 'https://acme.example/about',
    },
    {
      sourceId: 'youtube-company-channels',
      sourceKey: 'handle:acmeofficial',
      externalId: '@AcmeOfficial',
      providerUrl: 'https://youtube.com/@AcmeOfficial',
      ownershipProofUrl: 'https://acme.example/about',
    },
    {
      sourceId: 'telegram-company-channels',
      sourceKey: 'channel:acme_news',
      externalId: 'acme_news',
      providerUrl: 'https://t.me/acme_news',
      ownershipProofUrl: 'https://acme.example/about',
    },
  ]);
});

test('persists company-owned discovery references with parameterized ownership metadata', async () => {
  const queries = [];
  const client = {
    query: async (sql, values) => {
      queries.push({ sql, values });
      if (/SELECT org_id/.test(sql)) return { rows: [{ org_id: '17' }] };
      return { rows: [], rowCount: 1 };
    },
  };
  const links = extractCompanyOwnedSourceLinks(
    ['https://t.me/acme_news'],
    'https://acme.example/about',
  );

  const count = await persistCompanyOwnedSourceLinks(client, {
    orgId: 17,
    companyName: 'Acme',
    companyDomain: 'acme.example',
    companyWebsiteUrl: 'https://acme.example/',
    links,
    observedAt: '2026-08-14T03:00:00.000Z',
  });

  assert.equal(count, 1);
  assert.equal(queries.length, 2);
  assert.match(queries[0].sql, /INSERT INTO org_source_refs/);
  assert.match(queries[0].sql, /WHERE org_source_refs\.org_id = EXCLUDED\.org_id/);
  assert.equal(queries[0].values[0], 17);
  assert.equal(queries[0].values[1], 'telegram-company-channels');
  assert.equal(queries[0].values[2], 'channel:acme_news');
  assert.equal(queries[0].values[3], 'acme_news');
  const metadata = JSON.parse(queries[0].values[5]);
  assert.deepEqual(metadata, {
    discovery_state: 'company-owned-link',
    provider_url: 'https://t.me/acme_news',
    ownership_proof_url: 'https://acme.example/about',
    company_domain: 'acme.example',
    company_website_url: 'https://acme.example/',
    first_discovered_at: '2026-08-14T03:00:00.000Z',
    last_seen_at: '2026-08-14T03:00:00.000Z',
  });
  assert.equal(JSON.stringify(metadata).includes('email'), false);
  assert.equal(JSON.stringify(metadata).includes('phone'), false);
});

test('company-site parsing surfaces only company-level ownership candidates', () => {
  const record = parseCompanyPage(`
    <html>
      <head><title>Acme</title></head>
      <body>
        <a href="https://github.com/acme">GitHub</a>
        <a href="https://github.com/acme/private-repository">Repository</a>
        <a href="https://youtube.com/@AcmeOfficial">YouTube</a>
        <a href="https://t.me/acme_news/10">Message</a>
      </body>
    </html>
  `, 'https://acme.example/about');

  assert.deepEqual(record?.owned_source_links, [
    {
      sourceId: 'github-company-org',
      sourceKey: 'organization:acme',
      externalId: 'acme',
      providerUrl: 'https://github.com/acme',
      ownershipProofUrl: 'https://acme.example/about',
    },
    {
      sourceId: 'youtube-company-channels',
      sourceKey: 'handle:acmeofficial',
      externalId: '@AcmeOfficial',
      providerUrl: 'https://youtube.com/@AcmeOfficial',
      ownershipProofUrl: 'https://acme.example/about',
    },
  ]);
});

test('persistence rejects a provider URL whose claimed source identity was tampered', async () => {
  const client = { query: async () => assert.fail('must not query') };
  const count = await persistCompanyOwnedSourceLinks(client, {
    orgId: 17,
    companyName: 'Acme',
    companyDomain: 'acme.example',
    companyWebsiteUrl: 'https://acme.example/',
    links: [{
      sourceId: 'telegram-company-channels',
      sourceKey: 'channel:different',
      externalId: 'different',
      providerUrl: 'https://github.com/acme',
      ownershipProofUrl: 'https://acme.example/about',
    }],
  });
  assert.equal(count, 0);
});
