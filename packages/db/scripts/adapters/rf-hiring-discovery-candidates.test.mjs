import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRfHiringDiscoveryCandidate,
  resolveCandidateIdentity,
} from './rf-hiring-discovery-candidates.mjs';

const FAMILY = {
  id: 'rabota-ru',
  platformDomains: ['rabota.ru'],
};

test('name-only job-board evidence stays unresolved and cannot synthesize employer identity', () => {
  const candidate = buildRfHiringDiscoveryCandidate({
    family: FAMILY,
    posting: {
      title: 'Backend developer',
      employerName: 'ООО Ромашка',
      vacancyUrl: 'https://www.rabota.ru/vacancy/123456?utm_source=test',
      externalId: '123456',
      extractionMethod: 'json-ld-job-posting',
    },
    detectedAt: '2026-08-19T20:00:00Z',
  });

  assert.ok(candidate);
  assert.equal(candidate.vacancyKey, 'id:123456');
  assert.equal(candidate.vacancyUrl, 'https://www.rabota.ru/vacancy/123456');
  assert.equal(candidate.employerName, 'ООО Ромашка');
  assert.equal(candidate.employerWebsiteUrl, null);
  assert.deepEqual(candidate.strongIdentityKeys, []);
});

test('job-board platform URL is retained only as employer profile, never employer website', () => {
  const candidate = buildRfHiringDiscoveryCandidate({
    family: FAMILY,
    posting: {
      title: 'Recruiter',
      employerName: 'Example',
      employerUrl: 'https://www.rabota.ru/company/42',
      vacancyUrl: 'https://www.rabota.ru/vacancy/123456',
    },
  });

  assert.ok(candidate);
  assert.equal(candidate.employerWebsiteUrl, null);
  assert.equal(candidate.employerProfileUrl, 'https://www.rabota.ru/company/42');
  assert.deepEqual(candidate.strongIdentityKeys, []);
});

test('direct employer website contributes the canonical strong domain key', () => {
  const candidate = buildRfHiringDiscoveryCandidate({
    family: FAMILY,
    posting: {
      title: 'Recruiter',
      employerName: 'Example',
      employerUrl: 'https://careers.example.ru/jobs',
      vacancyUrl: 'https://www.rabota.ru/vacancy/123457',
    },
  });

  assert.ok(candidate);
  assert.equal(candidate.employerWebsiteUrl, 'https://careers.example.ru/jobs');
  assert.deepEqual(candidate.strongIdentityKeys, ['domain:example.ru']);
});

test('agency publisher is preserved as publisher evidence but cannot become target employer identity', () => {
  const candidate = buildRfHiringDiscoveryCandidate({
    family: { id: 'geekjob', platformDomains: ['geekjob.ru'] },
    posting: {
      title: 'Senior AI Engineer',
      employerName: 'NEWHR',
      employerUrl: 'https://geekjob.ru/company/661d1ab166825803e30eefc2',
      publisherType: 'agency',
      employerInn: '7707083893',
      strongIdentityKeys: ['domain:newhr.ru'],
      vacancyUrl: 'https://geekjob.ru/vacancy/69e2482a2215b591570d4e22',
      externalId: '69e2482a2215b591570d4e22',
    },
  });

  assert.ok(candidate);
  assert.equal(candidate.publisherType, 'agency');
  assert.equal(candidate.employerName, null);
  assert.equal(candidate.employerProfileUrl, null);
  assert.equal(candidate.employerWebsiteUrl, null);
  assert.deepEqual(candidate.strongIdentityKeys, []);
  assert.equal(candidate.payload.publisher_name, 'NEWHR');
  assert.equal(candidate.payload.publisher_profile_url, 'https://geekjob.ru/company/661d1ab166825803e30eefc2');
  assert.equal(candidate.payload.employer_inn, null);
});

test('resolver leaves no-strong-key candidate pending without querying identity owners', async () => {
  const client = {
    query: async () => {
      throw new Error('database must not be queried without a strong identity key');
    },
  };
  const result = await resolveCandidateIdentity(client, { strongIdentityKeys: [] });
  assert.deepEqual(result, {
    status: 'pending',
    orgId: null,
    reason: 'strong-identity-required',
    strongKeys: [],
  });
});

test('resolver fails closed when one strong key maps to multiple organization owners', async () => {
  const queries = [];
  const client = {
    query: async (sql) => {
      queries.push(sql);
      if (String(sql).includes('pg_advisory_xact_lock')) return { rows: [] };
      if (String(sql).includes('FROM org_source_refs')) return { rows: [{ org_id: '10' }, { org_id: '11' }] };
      if (String(sql).includes('FROM orgs')) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };

  const result = await resolveCandidateIdentity(client, { strongIdentityKeys: ['domain:example.ru'] });
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.orgId, null);
  assert.equal(result.reason, 'strong-key-multiple-owners');
  assert.deepEqual(result.ownerIds, ['10', '11']);
  assert.ok(queries.length >= 2);
});
