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
const publicAtsHtml = `
  <html>
    <body>
      <a href="https://jobs.ashbyhq.com/Ashby">Ashby jobs</a>
      <a href="https://framestore.recruitee.com/o/animator-2033">Framestore jobs</a>
      <a href="https://apply.workable.com/blue-altair/">Blue Altair jobs</a>
      <a href="https://careers.smartrecruiters.com/smartrecruiters">SmartRecruiters jobs</a>
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

const publicAtsDetection = detectCareerPageTargetFromHtml(publicAtsHtml, {
  baseUrl: 'https://example.org/',
  orgName: 'Example Org',
  domain: 'example.org',
  websiteUrl: 'https://example.org/',
});
assert.deepEqual(publicAtsDetection.targets, [
  {
    id: 'example.org-ashby-job-board',
    adapter: 'ashby-job-board',
    company_name: 'Example Org',
    company_domain: 'example.org',
    company_website_url: 'https://example.org/',
    career_page_url: 'https://jobs.ashbyhq.com/Ashby',
    source_url: 'https://api.ashbyhq.com/posting-api/job-board/Ashby?includeCompensation=true',
  },
  {
    id: 'example.org-recruitee-careers',
    adapter: 'recruitee-careers',
    company_name: 'Example Org',
    company_domain: 'example.org',
    company_website_url: 'https://example.org/',
    career_page_url: 'https://framestore.recruitee.com',
    source_url: 'https://framestore.recruitee.com/api/offers/',
  },
  {
    id: 'example.org-workable-public-jobs',
    adapter: 'workable-public-jobs',
    company_name: 'Example Org',
    company_domain: 'example.org',
    company_website_url: 'https://example.org/',
    career_page_url: 'https://apply.workable.com/blue-altair/',
    source_url: 'https://www.workable.com/api/accounts/blue-altair?details=true',
  },
  {
    id: 'example.org-smartrecruiters-postings',
    adapter: 'smartrecruiters-postings',
    company_name: 'Example Org',
    company_domain: 'example.org',
    company_website_url: 'https://example.org/',
    career_page_url: 'https://careers.smartrecruiters.com/smartrecruiters',
    source_url: 'https://api.smartrecruiters.com/v1/companies/smartrecruiters/postings?limit=100&offset=0',
  },
]);

const redirectedAtsDetection = detectCareerPageTargetFromHtml('', {
  baseUrl: 'https://jobs.ashbyhq.com/Ashby',
  orgName: 'Ashby',
  domain: 'ashbyhq.com',
  websiteUrl: 'https://www.ashbyhq.com/',
});
assert.equal(redirectedAtsDetection.targets.length, 1, 'a direct redirect to an ATS board must be discoverable');
assert.equal(redirectedAtsDetection.targets[0].adapter, 'ashby-job-board');

const hostedAtsCases = [
  ['workday', 'https://acme.wd3.myworkdayjobs.com/en-US/External'],
  ['teamtailor', 'https://acme.teamtailor.com/'],
  ['personio', 'https://acme.jobs.personio.com/'],
  ['bamboohr', 'https://acme.bamboohr.com/careers'],
  ['pinpoint', 'https://acme.pinpointhq.com/'],
  ['breezy', 'https://acme.breezy.hr/'],
  ['comeet', 'https://www.comeet.com/jobs/acme/123'],
  ['jazzhr', 'https://acme.applytojob.com/apply'],
  ['icims', 'https://careers-acme.icims.com/jobs/intro'],
  ['oracle-taleo', 'https://acme.taleo.net/careersection/external/jobsearch.ftl'],
  ['oracle-cloud', 'https://acme.fa.eu2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1'],
  ['sap-successfactors', 'https://career5.successfactors.eu/career?company=acme'],
];
for (const [family, url] of hostedAtsCases) {
  const detection = detectCareerPageTargetFromHtml(`<a href="${url}">Jobs</a>`, {
    baseUrl: 'https://acme.example/',
    orgName: 'Acme',
    domain: 'acme.example',
    websiteUrl: 'https://acme.example/',
  });
  assert.equal(detection.targets.length, 1, `${family} public page must be detected`);
  assert.equal(detection.targets[0].adapter, 'hosted-career-page');
  assert.equal(detection.targets[0].hosted_ats_family, family);
  const expectedUrl = new URL(url).pathname === '/' ? new URL(url).toString() : url.replace(/\/$/, '');
  assert.equal(detection.targets[0].source_url, expectedUrl);
}

const privateHostedApi = detectCareerPageTargetFromHtml(
  '<a href="https://acme.teamtailor.com/api/jobs">private endpoint</a>',
  { baseUrl: 'https://acme.example/', orgName: 'Acme', domain: 'acme.example', websiteUrl: 'https://acme.example/' },
);
assert.deepEqual(privateHostedApi.targets, [], 'private hosted ATS API paths must not be adopted');

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

const assetOnlyDetection = detectCareerPageTargetFromHtml(`
  <html><body>
    <img src="https://careers.example/assets/careers-social-image.jpg" />
    <a href="https://careers.example/assets/jobs-banner.png">About us</a>
  </body></html>
`, {
  baseUrl: 'https://careers.example/',
  orgName: 'Asset Only',
  domain: 'example',
  websiteUrl: 'https://example/',
});
assert.deepEqual(assetOnlyDetection.targets, [], 'career-named image assets must not become vacancy targets');

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

const embeddedPostings = extractJobPostingsFromHtml(`
  <script id="__NEXT_DATA__" type="application/json">
    {"props":{"pageProps":{"jobs":[{"@type":"JobPosting","title":"Data Engineer","url":"https://same.example/careers/data"}]}}}
  </script>
`);
assert.equal(embeddedPostings.length, 1, 'must discover JobPosting in bounded non-executable embedded JSON');
assert.equal(embeddedPostings[0].title, 'Data Engineer');

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
