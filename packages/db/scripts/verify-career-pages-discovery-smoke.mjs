import assert from 'node:assert/strict';

import {
  detectCareerPageTargetFromHtml,
  resolveCareerPagesDiscoveredTargetsOutputPath,
  resolveCareerPagesDiscoveryReviewOutputPath,
} from './source-career-pages.mjs';

const greenhouseHtml = `
  <html>
    <body>
      <a href="https://boards.greenhouse.io/acme">Jobs</a>
    </body>
  </html>
`;
const leverHtml = `
  <html>
    <body>
      <a href="https://jobs.lever.co/zenhire">Careers</a>
    </body>
  </html>
`;
const sameDomainHtml = `
  <html>
    <body>
      <a href="/careers">Open roles</a>
    </body>
  </html>
`;

const greenhouseDetection = detectCareerPageTargetFromHtml(greenhouseHtml, {
  baseUrl: 'https://acme.example/',
  orgName: 'Acme',
  domain: 'acme.example',
  websiteUrl: 'https://acme.example/',
});
assert.equal(greenhouseDetection.targets.length, 1);
assert.deepEqual(greenhouseDetection.targets[0], {
  id: 'acme.example-greenhouse-board',
  adapter: 'greenhouse-board',
  company_name: 'Acme',
  company_domain: 'acme.example',
  company_website_url: 'https://acme.example/',
  career_page_url: 'https://boards.greenhouse.io/acme',
  source_url: 'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true',
});
assert.equal(greenhouseDetection.sameDomainCareerPageUrl, null);

const leverDetection = detectCareerPageTargetFromHtml(leverHtml, {
  baseUrl: 'https://zenhire.example/',
  orgName: 'Zenhire',
  domain: 'zenhire.example',
  websiteUrl: 'https://zenhire.example/',
});
assert.equal(leverDetection.targets.length, 1);
assert.deepEqual(leverDetection.targets[0], {
  id: 'zenhire.example-lever-postings',
  adapter: 'lever-postings',
  company_name: 'Zenhire',
  company_domain: 'zenhire.example',
  company_website_url: 'https://zenhire.example/',
  career_page_url: 'https://jobs.lever.co/zenhire',
  source_url: 'https://api.lever.co/v0/postings/zenhire?mode=json',
});

const sameDomainDetection = detectCareerPageTargetFromHtml(sameDomainHtml, {
  baseUrl: 'https://same.example/',
  orgName: 'Same',
  domain: 'same.example',
  websiteUrl: 'https://same.example/',
});
assert.equal(sameDomainDetection.targets.length, 0);
assert.equal(sameDomainDetection.sameDomainCareerPageUrl, 'https://same.example/careers');
assert.deepEqual(sameDomainDetection.notes, ['same-domain-careers:https://same.example/careers']);

console.log(JSON.stringify({
  ok: true,
  smoke: 'career-pages-discovery',
  outputs: {
    discoveredTargetsFile: resolveCareerPagesDiscoveredTargetsOutputPath(),
    discoveryReviewFile: resolveCareerPagesDiscoveryReviewOutputPath(),
  },
}, null, 2));
