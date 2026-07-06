import assert from 'node:assert/strict';

import {
  buildCareerPagesDiscoverySeedsQuery,
  detectCareerPageTargetFromHtml,
  extractJobPostingsFromHtml,
  mapJsonLdJobPostings,
  resolveCareerPagesDiscoveredTargetsOutputPath,
  resolveCareerPagesDiscoveryReviewOutputPath,
} from './source-career-pages.mjs';

const seedsQuery = buildCareerPagesDiscoverySeedsQuery();
assert.equal(typeof seedsQuery, 'string', 'seeds query must be a string');
assert.ok(seedsQuery.includes('FROM orgs'), 'seeds query must select FROM orgs');
assert.ok(
  !/AND\s+signals\.source\s*=\s*'hh'/i.test(seedsQuery),
  'seeds query must not restrict signals to HH only',
);
assert.ok(
  /signals\.source\s*(<>|!=)\s*'career-pages'/i.test(seedsQuery),
  'seeds query must exclude career-pages signals to prevent recursion',
);
assert.ok(
  !/HAVING[\s\S]*FILTER\s*\(\s*WHERE\s+signals\.source\s*=\s*'hh'\s*\)/i.test(seedsQuery),
  'HAVING clause must not be HH-only',
);
assert.ok(
  /COUNT\(DISTINCT\s+signals\.id\)\s*>\s*0/i.test(seedsQuery),
  'HAVING clause must require at least one non-career-pages signal',
);

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
// The company's own /careers page is now a real target (same-domain-jsonld),
// not a dead needs_review note — this is the RU-native direct-surface path.
assert.equal(sameDomainDetection.targets.length, 1);
assert.deepEqual(sameDomainDetection.targets[0], {
  id: 'same.example-same-domain-jsonld',
  adapter: 'same-domain-jsonld',
  company_name: 'Same',
  company_domain: 'same.example',
  company_website_url: 'https://same.example/',
  career_page_url: 'https://same.example/careers',
  source_url: 'https://same.example/careers',
});
assert.equal(sameDomainDetection.sameDomainCareerPageUrl, 'https://same.example/careers');
assert.deepEqual(sameDomainDetection.notes, ['same-domain-careers:https://same.example/careers']);

// JSON-LD JobPosting extraction: RU career pages emit schema.org markup for
// Яндекс.Работа / Google Jobs. Verify we walk @graph + arrays and map only
// fields the standard carries (no fabricated company/contact).
const jsonLdHtml = `
  <html><head>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "JobPosting",
          "title": "Инженер-программист",
          "datePosted": "2026-07-01",
          "url": "https://same.example/careers/backend",
          "identifier": { "@type": "PropertyValue", "value": "vac-42" },
          "employmentType": "FULL_TIME",
          "hiringOrganization": { "@type": "Organization", "name": "Смолл ООО", "sameAs": "https://same.example" },
          "jobLocation": { "@type": "Place", "address": { "@type": "PostalAddress", "addressLocality": "Москва" } }
        },
        { "@type": "WebSite", "name": "not a job" }
      ]
    }
    </script>
  </head><body></body></html>
`;
const postings = extractJobPostingsFromHtml(jsonLdHtml);
assert.equal(postings.length, 1, 'must extract exactly one JobPosting from @graph');

const mapped = mapJsonLdJobPostings(postings, {
  companyName: 'Same',
  companyDomain: 'same.example',
  companyWebsiteUrl: 'https://same.example/',
  careerPageUrl: 'https://same.example/careers',
});
assert.equal(mapped.length, 1);
assert.equal(mapped[0].job_title, 'Инженер-программист');
assert.equal(mapped[0].company_name, 'Смолл ООО');
assert.equal(mapped[0].external_id, 'vac-42');
assert.equal(mapped[0].location, 'Москва');
assert.equal(mapped[0].job_posting_url, 'https://same.example/careers/backend');
assert.equal(mapped[0].career_page_url, 'https://same.example/careers');
assert.equal(mapped[0].source_record_type, 'job_posting');

// Empty / malformed LD+JSON must yield nothing, never throw.
assert.deepEqual(extractJobPostingsFromHtml('<script type="application/ld+json">{ bad json </script>'), []);
assert.deepEqual(extractJobPostingsFromHtml(''), []);

console.log(JSON.stringify({
  ok: true,
  smoke: 'career-pages-discovery',
  outputs: {
    discoveredTargetsFile: resolveCareerPagesDiscoveredTargetsOutputPath(),
    discoveryReviewFile: resolveCareerPagesDiscoveryReviewOutputPath(),
  },
}, null, 2));
