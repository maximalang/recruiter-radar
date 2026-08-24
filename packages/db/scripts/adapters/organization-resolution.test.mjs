import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyStrongIdentityKey,
  OrganizationIdentityConflictError,
  isOrganizationIdentityConflict,
  resolveOrganizationOwner,
} from './organization-resolution.mjs';

test('public profile and social domains are never strong employer identities', () => {
  for (const domain of [
    'vk.com', 'company.vk.com', 't.me', 'youtube.com', 'rutube.ru',
    'dzen.ru', 'ok.ru', 'instagram.com', 'facebook.com',
  ]) {
    assert.equal(classifyStrongIdentityKey(`domain:${domain}`), null, domain);
  }
  assert.deepEqual(classifyStrongIdentityKey('domain:example.ru'), {
    key: 'domain:example.ru',
    type: 'domain',
  });
});

test('identity ambiguity is exposed as a typed fail-closed rejection', async () => {
  const client = {
    query: async (sql) => {
      if (sql.includes('SELECT DISTINCT org_id, source_key')) {
        return { rows: [
          { org_id: '10', source_key: 'domain:example.test' },
          { org_id: '20', source_key: 'domain:example.test' },
        ] };
      }
      if (sql.includes('SELECT id FROM orgs')) return { rows: [] };
      return { rows: [] };
    },
  };

  await assert.rejects(
    resolveOrganizationOwner(client, 'career-pages', {
      orgSourceKeys: ['domain:example.test'],
    }),
    (error) => {
      assert.ok(error instanceof OrganizationIdentityConflictError);
      assert.equal(error.code, 'organization_identity_conflict');
      assert.equal(isOrganizationIdentityConflict(error), true);
      return true;
    },
  );
});
