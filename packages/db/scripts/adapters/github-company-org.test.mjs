import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchGitHubCompanyOrganizations } from './github-company-org.mjs';

const target = {
  organization_login: 'VKCOM',
  company_name: 'VK',
  company_domain: 'vk.com',
  company_website_url: 'https://vk.com/',
};

test('emits bounded context-only repository events for a verified company organization', async () => {
  const requested = [];
  const result = await fetchGitHubCompanyOrganizations([target], {
    now: new Date('2026-08-14T00:00:00Z'),
    fetchImpl: async (url, options) => {
      requested.push({ url: String(url), headers: options.headers });
      if (String(url).endsWith('/orgs/VKCOM')) {
        return jsonResponse({
          login: 'VKCOM', type: 'Organization', is_verified: true,
          blog: 'https://vk.com/', html_url: 'https://github.com/VKCOM',
        });
      }
      return jsonResponse([
        {
          id: 101, name: 'new-platform', full_name: 'VKCOM/new-platform', fork: false,
          html_url: 'https://github.com/VKCOM/new-platform', description: 'Public platform',
          created_at: '2026-08-10T00:00:00Z', pushed_at: '2026-08-13T00:00:00Z',
          owner: { login: 'VKCOM', type: 'Organization' },
        },
        {
          id: 102, name: 'old-repo', full_name: 'VKCOM/old-repo', fork: false,
          html_url: 'https://github.com/VKCOM/old-repo', created_at: '2020-01-01T00:00:00Z',
          pushed_at: '2020-01-02T00:00:00Z', owner: { login: 'VKCOM', type: 'Organization' },
        },
      ], { etag: '"repos-v1"' });
    },
  });

  assert.equal(result.records.length, 1);
  assert.deepEqual(result.records[0], {
    external_id: 'github-repository:101:new-repository',
    company_name: 'VK',
    company_domain: 'vk.com',
    company_website_url: 'https://vk.com/',
    source_url: 'https://github.com/VKCOM/new-platform',
    headline: 'VK opened public repository new-platform',
    summary: 'Public platform',
    event_type: 'new_project',
    published_at: '2026-08-10T00:00:00.000Z',
    extraction_method: 'github-rest-org-repositories',
    publisher: 'GitHub verified organization VKCOM',
    category: 'company-technology-context',
  });
  assert.equal(result.diagnostics[0].ownershipVerified, true);
  assert.equal(result.cacheUpdates[0].etag, '"repos-v1"');
  assert.equal(requested.every(({ url }) => !/contributors|members|users\//.test(url)), true);
});

test('fails closed when GitHub organization ownership cannot be proven', async () => {
  for (const org of [
    { login: 'VKCOM', type: 'User', is_verified: true, blog: 'https://vk.com/' },
    { login: 'VKCOM', type: 'Organization', is_verified: true, blog: 'https://example.com/' },
    { login: 'VKCOM', type: 'Organization', is_verified: false, blog: 'https://vk.com/' },
  ]) {
    const result = await fetchGitHubCompanyOrganizations([target], {
      fetchImpl: async () => jsonResponse(org),
    });
    assert.equal(result.records.length, 0);
    assert.equal(result.diagnostics[0].ownershipVerified, false);
  }
});

test('uses a cached ETag and treats 304 as a successful no-change result', async () => {
  const headers = [];
  const result = await fetchGitHubCompanyOrganizations([target], {
    cache: { VKCOM: { etag: '"repos-v1"' } },
    fetchImpl: async (url, options) => {
      if (String(url).endsWith('/orgs/VKCOM')) return jsonResponse({ login: 'VKCOM', type: 'Organization', is_verified: true, blog: 'https://vk.com/' });
      headers.push(options.headers);
      return new Response(null, { status: 304 });
    },
  });
  assert.equal(headers[0]['If-None-Match'], '"repos-v1"');
  assert.equal(result.records.length, 0);
  assert.equal(result.diagnostics[0].notModified, true);
});

function jsonResponse(value, { etag } = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json', ...(etag ? { etag } : {}) },
  });
}
