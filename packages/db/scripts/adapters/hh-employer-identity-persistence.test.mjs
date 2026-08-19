import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHhEmployersMissingIdentityQuery,
  persistHhEmployerIdentity,
} from './hh-employer-identity-persistence.mjs';

test('missing-identity query targets numeric HH employer ids without org domain/site', () => {
  const sql = buildHhEmployersMissingIdentityQuery();
  assert.match(sql, /refs\.source = 'hh'/);
  assert.match(sql, /refs\.external_id ~ '\^\\d\+\$'/);
  assert.match(sql, /orgs\.domain/);
  assert.match(sql, /orgs\.website_url/);
  assert.match(sql, /signals\.source = 'hh'/);
});

test('persists an unambiguous official employer domain on the existing HH org', async () => {
  const queries = [];
  const client = {
    query: async (sql, params) => {
      const text = String(sql);
      queries.push({ text, params });
      if (text.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (text.includes('FROM org_source_refs') && text.includes('source_key = $1') && !text.includes("source = 'hh'")) {
        return { rows: [] };
      }
      if (text.includes('FROM orgs') && text.includes('LOWER(domain)')) return { rows: [] };
      if (text.includes('FROM orgs') && text.includes('FOR UPDATE')) {
        return { rows: [{ id: '10', name: 'Example', domain: null, website_url: null }] };
      }
      if (text.startsWith('UPDATE orgs') || text.includes('\n     SET\n       domain')) return { rowCount: 1, rows: [] };
      if (text.includes('INSERT INTO org_source_refs')) return { rowCount: 1, rows: [] };
      if (text.includes("WHERE source = 'hh' AND source_key")) return { rows: [{ org_id: '10' }] };
      throw new Error(`unexpected query: ${text}`);
    },
  };

  const result = await persistHhEmployerIdentity(client, {
    orgId: '10',
    employerId: '1455',
    employerName: 'Example',
    detail: {
      siteUrl: 'https://www.example.ru/careers',
      trusted: true,
      type: 'company',
      openVacancies: 7,
    },
  });

  assert.equal(result.status, 'enriched');
  assert.equal(result.domain, 'example.ru');
  const insert = queries.find((query) => query.text.includes('INSERT INTO org_source_refs'));
  assert.equal(insert.params[1], 'domain:example.ru');
});

test('social or job-platform site cannot become HH employer strong domain', async () => {
  const client = { query: async () => { throw new Error('database must not be touched'); } };
  for (const siteUrl of ['https://vk.com/example', 'https://hh.ru/employer/1455', 'https://t.me/example']) {
    const result = await persistHhEmployerIdentity(client, {
      orgId: '10',
      employerId: '1455',
      employerName: 'Example',
      detail: { siteUrl },
    });
    assert.equal(result.status, 'rejected', siteUrl);
    assert.equal(result.reason, 'site-domain-not-strong-employer-identity');
  }
});

test('domain already owned by another organization fails closed', async () => {
  const client = {
    query: async (sql) => {
      const text = String(sql);
      if (text.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (text.includes('FROM org_source_refs')) return { rows: [{ org_id: '99' }] };
      if (text.includes('FROM orgs') && text.includes('LOWER(domain)')) return { rows: [{ org_id: '99' }] };
      throw new Error(`unexpected query after ownership conflict: ${text}`);
    },
  };
  const result = await persistHhEmployerIdentity(client, {
    orgId: '10',
    employerId: '1455',
    employerName: 'Example',
    detail: { siteUrl: 'https://example.ru' },
  });
  assert.equal(result.status, 'conflict');
  assert.equal(result.reason, 'domain-owned-by-another-organization');
  assert.deepEqual(result.ownerIds, ['99']);
});

test('existing different org domain is never overwritten by HH detail', async () => {
  const client = {
    query: async (sql) => {
      const text = String(sql);
      if (text.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (text.includes('FROM org_source_refs')) return { rows: [] };
      if (text.includes('FROM orgs') && text.includes('LOWER(domain)')) return { rows: [] };
      if (text.includes('FROM orgs') && text.includes('FOR UPDATE')) {
        return { rows: [{ id: '10', name: 'Example', domain: 'old-example.ru', website_url: 'https://old-example.ru' }] };
      }
      throw new Error(`unexpected write after domain mismatch: ${text}`);
    },
  };
  const result = await persistHhEmployerIdentity(client, {
    orgId: '10',
    employerId: '1455',
    employerName: 'Example',
    detail: { siteUrl: 'https://new-example.ru' },
  });
  assert.equal(result.status, 'conflict');
  assert.equal(result.reason, 'organization-already-has-different-domain');
});
