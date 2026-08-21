import assert from 'node:assert/strict';
import test from 'node:test';

import { bootstrapCandidateOrganization } from './rf-candidate-org-bootstrap.mjs';

const pending = (keys) => ({
  status: 'pending',
  orgId: null,
  reason: 'strong-key-owner-not-yet-known',
  strongKeys: keys,
});

test('bootstraps a never-seen direct employer from an exact official domain key', async () => {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      const text = String(sql);
      calls.push({ text, params });
      if (text.includes('SELECT DISTINCT org_id::TEXT')) return { rows: [] };
      if (text.includes('FROM orgs') && text.includes('LOWER(domain)')) return { rows: [] };
      if (text.includes('INSERT INTO orgs')) return { rows: [{ id: '501' }] };
      if (text.includes('INSERT INTO org_source_refs')) return { rows: [], rowCount: 1 };
      throw new Error(`unexpected query: ${text}`);
    },
  };

  const result = await bootstrapCandidateOrganization(client, {
    sourceFamily: 'geekjob',
    employerName: 'Direct Employer',
    employerWebsiteUrl: 'https://www.direct-example.ru/careers',
    vacancyUrl: 'https://geekjob.ru/vacancy/abc123',
    externalVacancyId: 'abc123',
    publisherType: 'unknown',
    strongIdentityKeys: ['domain:direct-example.ru'],
  }, pending(['domain:direct-example.ru']));

  assert.equal(result.bootstrapped, true);
  assert.deepEqual(result.resolution, {
    status: 'resolved',
    orgId: '501',
    reason: 'new-organization',
    strongKeys: ['domain:direct-example.ru'],
  });
  const orgInsert = calls.find((call) => call.text.includes('INSERT INTO orgs'));
  assert.deepEqual(orgInsert.params, [
    'Direct Employer',
    'direct-example.ru',
    'https://www.direct-example.ru/careers',
  ]);
});

test('agency publisher can never bootstrap the target employer', async () => {
  const client = {
    query: async () => {
      throw new Error('database must not be touched for agency publisher bootstrap');
    },
  };
  const result = await bootstrapCandidateOrganization(client, {
    sourceFamily: 'getmatch',
    employerName: 'Recruiting Agency',
    employerWebsiteUrl: 'https://agency.example/',
    publisherType: 'agency',
    strongIdentityKeys: ['domain:agency.example'],
  }, pending(['domain:agency.example']));

  assert.equal(result.bootstrapped, false);
  assert.equal(result.resolution.status, 'pending');
  assert.equal(result.resolution.reason, 'agency-publisher-cannot-bootstrap-employer');
});

test('domain key must exactly match the employer website before new org creation', async () => {
  const client = {
    query: async () => {
      throw new Error('database must not be touched for mismatched domain identity');
    },
  };
  const result = await bootstrapCandidateOrganization(client, {
    sourceFamily: 'zarplata-ru',
    employerName: 'Example',
    employerWebsiteUrl: 'https://example.ru/jobs',
    publisherType: 'unknown',
    strongIdentityKeys: ['domain:other-company.ru'],
  }, pending(['domain:other-company.ru']));

  assert.equal(result.bootstrapped, false);
  assert.equal(result.resolution.reason, 'bootstrap-strong-key-not-employer-scoped');
});

test('legal employer identity can bootstrap without a website when INN is strong and scoped', async () => {
  const client = {
    query: async (sql) => {
      const text = String(sql);
      if (text.includes('SELECT DISTINCT org_id::TEXT')) return { rows: [] };
      if (text.includes('INSERT INTO orgs')) return { rows: [{ id: '777' }] };
      if (text.includes('INSERT INTO org_source_refs')) return { rows: [], rowCount: 1 };
      throw new Error(`unexpected query: ${text}`);
    },
  };
  const result = await bootstrapCandidateOrganization(client, {
    sourceFamily: 'rabota-ru',
    employerName: 'ООО Ромашка',
    publisherType: 'unknown',
    strongIdentityKeys: ['inn:7707083893'],
  }, pending(['inn:7707083893']));

  assert.equal(result.bootstrapped, true);
  assert.equal(result.resolution.orgId, '777');
  assert.equal(result.resolution.reason, 'new-organization');
});

test('race to a pre-existing owner resolves without creating a second organization', async () => {
  let insertedOrg = false;
  const client = {
    query: async (sql) => {
      const text = String(sql);
      if (text.includes('SELECT DISTINCT org_id::TEXT')) return { rows: [{ org_id: '42' }] };
      if (text.includes('FROM orgs') && text.includes('LOWER(domain)')) return { rows: [{ org_id: '42' }] };
      if (text.includes('INSERT INTO org_source_refs')) return { rows: [], rowCount: 1 };
      if (text.includes('INSERT INTO orgs')) {
        insertedOrg = true;
        throw new Error('must not create a duplicate organization');
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
  const result = await bootstrapCandidateOrganization(client, {
    sourceFamily: 'geekjob',
    employerName: 'Known Employer',
    employerWebsiteUrl: 'https://known.example.ru/',
    publisherType: 'unknown',
    strongIdentityKeys: ['domain:known.example.ru'],
  }, pending(['domain:known.example.ru']));

  assert.equal(insertedOrg, false);
  assert.equal(result.bootstrapped, false);
  assert.equal(result.resolution.status, 'resolved');
  assert.equal(result.resolution.orgId, '42');
  assert.equal(result.resolution.reason, 'validated-strong-key');
});
