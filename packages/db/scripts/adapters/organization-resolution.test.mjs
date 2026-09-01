import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OrganizationIdentityConflictError,
  classifyStrongIdentityKey,
  isOrganizationIdentityConflict,
  resolveOrganizationOwner,
} from './organization-resolution.mjs';

const MULTITENANT_DOMAIN_KEYS = [
  'domain:foo.github.io',
  'domain:bar.notion.site',
  'domain:tenant.wixsite.com',
  'domain:tenant.blogspot.com',
  'domain:shop.myshopify.com',
  'domain:foo.co.in',
  'domain:foo.com.sg',
  'domain:foo.co.za',
];

test('rejects public-suffix and multitenant domains as strong identities', () => {
  for (const key of MULTITENANT_DOMAIN_KEYS) {
    assert.equal(classifyStrongIdentityKey(key), null, `must reject ${key}`);
  }
  // myshopify.com must be rejected bare and as tenant subdomains (Gap 1).
  assert.equal(classifyStrongIdentityKey('domain:myshopify.com'), null);
  assert.equal(classifyStrongIdentityKey('domain:tenant.myshopify.com'), null);
  assert.deepEqual(classifyStrongIdentityKey('domain:company.ru'), {
    key: 'domain:company.ru',
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
