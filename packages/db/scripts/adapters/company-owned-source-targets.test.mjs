import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadCompanyOwnedSourceTargets,
  loadCompanyOwnedSourceTargetsFromDatabase,
} from './company-owned-source-targets.mjs';

test('loads bounded ownership-bound targets for each enrolled provider', async () => {
  const rows = [
    discoveredRow('github-company-org', 'organization:Acme', 'Acme'),
    discoveredRow('youtube-company-channels', 'channel:UCabcDEF_123', 'UCabcDEF_123'),
    discoveredRow('youtube-company-channels', 'handle:acmeofficial', '@AcmeOfficial'),
    discoveredRow('telegram-company-channels', 'channel:acme_news', 'acme_news'),
  ];
  const queries = [];
  const client = {
    query: async (sql, values) => {
      queries.push({ sql, values });
      return { rows: rows.filter((row) => row.source === values[0]) };
    },
  };

  assert.deepEqual(await loadCompanyOwnedSourceTargets(client, 'github-company-org'), [{
    organization_login: 'Acme',
    company_name: 'Acme Ltd',
    company_domain: 'acme.example',
    company_website_url: 'https://acme.example/',
  }]);
  assert.deepEqual(await loadCompanyOwnedSourceTargets(client, 'youtube-company-channels'), [
    {
      channel_id: 'UCabcDEF_123',
      company_name: 'Acme Ltd',
      company_domain: 'acme.example',
      company_website_url: 'https://acme.example/',
      ownership_proof_url: 'https://acme.example/about',
    },
    {
      channel_handle: '@AcmeOfficial',
      company_name: 'Acme Ltd',
      company_domain: 'acme.example',
      company_website_url: 'https://acme.example/',
      ownership_proof_url: 'https://acme.example/about',
    },
  ]);
  assert.deepEqual(await loadCompanyOwnedSourceTargets(client, 'telegram-company-channels'), [{
    channel_username: 'acme_news',
    company_name: 'Acme Ltd',
    company_domain: 'acme.example',
    company_website_url: 'https://acme.example/',
    ownership_proof_url: 'https://acme.example/about',
  }]);

  assert.equal(queries.length, 3);
  for (const query of queries) {
    assert.match(query.sql, /ref\.org_id = org\.id/);
    assert.match(query.sql, /discovery_state/);
    assert.match(query.sql, /LIMIT \$2/);
    assert.equal(query.values[1], 50);
  }
});

test('rejects unsupported sources before querying', async () => {
  const client = { query: async () => assert.fail('must not query') };
  await assert.rejects(
    loadCompanyOwnedSourceTargets(client, 'github-user-profile'),
    /Unsupported company-owned source/,
  );
});

test('closes the database client after loading targets', async () => {
  const lifecycle = [];
  class FakeClient {
    constructor(options) { lifecycle.push(['construct', options]); }
    async connect() { lifecycle.push(['connect']); }
    async query() { return { rows: [] }; }
    async end() { lifecycle.push(['end']); }
  }

  const targets = await loadCompanyOwnedSourceTargetsFromDatabase(
    'postgres://database.test/recruiter_radar',
    'github-company-org',
    { ClientClass: FakeClient },
  );

  assert.deepEqual(targets, []);
  assert.deepEqual(lifecycle, [
    ['construct', { connectionString: 'postgres://database.test/recruiter_radar' }],
    ['connect'],
    ['end'],
  ]);
});

function discoveredRow(source, sourceKey, externalId) {
  return {
    source,
    source_key: sourceKey,
    external_id: externalId,
    company_name: 'Acme Ltd',
    company_domain: 'acme.example',
    company_website_url: 'https://acme.example/',
    metadata: {
      discovery_state: 'company-owned-link',
      ownership_proof_url: 'https://acme.example/about',
    },
  };
}
