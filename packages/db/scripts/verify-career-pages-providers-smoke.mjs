import assert from 'node:assert/strict';

import {
  mapAshbyJobBoardPayload,
  mapGreenhouseBoardPayload,
  mapLeverPostingsPayload,
  mapRecruiteeCareersPayload,
  mapSmartRecruitersPostingsPayload,
  mapTeamtailorRss,
  mapPersonioXml,
  mapPublicCareerRss,
  mapWorkablePublicJobsPayload,
  detectCareerPageTargetFromHtml,
  fetchSmartRecruitersPostingsRecords,
  isHostedAtsVacancyUrl,
  extractTaleoJobListRecords,
  extractVacancyCardsFromSameDomainHtml,
} from './source-career-pages.mjs';

// Offline coverage for the greenhouse-board / lever-postings response mappers.
// These adapters used to be exercised only by hitting the live boards in the
// career-pages fetch smoke, which was network-dependent and flaky (a live board
// returns hundreds of postings, never the fixture count). Mapping is now pure
// and verified here against canonical API payloads.

const greenhousePayload = {
  meta: { name: 'Discord', url: 'https://boards.greenhouse.io/discord' },
  jobs: [
    {
      id: 123,
      title: 'Software Engineer',
      absolute_url: 'https://boards.greenhouse.io/discord/jobs/123',
      location: { name: 'San Francisco' },
      metadata: [{ name: 'Employment Type', value: 'FULL_TIME' }],
      updated_at: '2026-05-26T00:00:00.000Z',
    },
  ],
};

const greenhouseTarget = {
  id: 'discord-greenhouse',
  adapter: 'greenhouse-board',
  companyName: 'Discord',
  companyDomain: 'discord.com',
  companyWebsiteUrl: 'https://discord.com/',
  careerPageUrl: 'https://boards.greenhouse.io/discord',
};

const greenhouseRecords = mapGreenhouseBoardPayload(greenhousePayload, greenhouseTarget);
assert.equal(greenhouseRecords.length, 1);
assert.deepEqual(
  {
    company_name: greenhouseRecords[0].company_name,
    company_domain: greenhouseRecords[0].company_domain,
    job_posting_url: greenhouseRecords[0].job_posting_url,
    job_title: greenhouseRecords[0].job_title,
    external_id: greenhouseRecords[0].external_id,
    location: greenhouseRecords[0].location,
    employment_type: greenhouseRecords[0].employment_type,
    occurred_at: greenhouseRecords[0].occurred_at,
    source_record_type: greenhouseRecords[0].source_record_type,
  },
  {
    company_name: 'Discord',
    company_domain: 'discord.com',
    job_posting_url: 'https://boards.greenhouse.io/discord/jobs/123',
    job_title: 'Software Engineer',
    external_id: '123',
    location: 'San Francisco',
    employment_type: 'FULL_TIME',
    occurred_at: '2026-05-26T00:00:00.000Z',
    source_record_type: 'job_posting',
  },
);

// Empty / malformed payloads must yield zero records, not throw.
assert.deepEqual(mapGreenhouseBoardPayload(null, greenhouseTarget), []);
assert.deepEqual(mapGreenhouseBoardPayload({}, greenhouseTarget), []);

const leverPayload = [
  {
    id: '456',
    text: 'Data Analyst',
    hostedUrl: 'https://jobs.lever.co/dnb/456',
    categories: { location: 'New York', commitment: 'FULL_TIME' },
    updatedAt: 1779408000000,
  },
];

const leverTarget = {
  id: 'dnb-lever',
  adapter: 'lever-postings',
  companyName: 'Dun & Bradstreet',
  companyDomain: 'dnb.com',
  companyWebsiteUrl: 'https://www.dnb.com/',
  careerPageUrl: 'https://jobs.lever.co/dnb',
};

const leverRecords = mapLeverPostingsPayload(leverPayload, leverTarget);
assert.equal(leverRecords.length, 1);
assert.equal(leverRecords[0].company_name, 'Dun & Bradstreet');
assert.equal(leverRecords[0].job_posting_url, 'https://jobs.lever.co/dnb/456');
assert.equal(leverRecords[0].job_title, 'Data Analyst');
assert.equal(leverRecords[0].external_id, '456');
assert.equal(leverRecords[0].location, 'New York');
assert.equal(leverRecords[0].employment_type, 'FULL_TIME');
assert.equal(leverRecords[0].source_record_type, 'job_posting');

assert.deepEqual(mapLeverPostingsPayload(null, leverTarget), []);
assert.deepEqual(mapLeverPostingsPayload({}, leverTarget), []);

const sharedTarget = {
  id: 'example-public-ats',
  companyName: 'Example Org',
  companyDomain: 'example.org',
  companyWebsiteUrl: 'https://example.org/',
};

const ashbyRecords = mapAshbyJobBoardPayload({
  jobs: [{
    id: 'ashby-1',
    title: 'Engineering Manager',
    department: 'Engineering',
    team: 'Platform',
    employmentType: 'FullTime',
    location: 'Remote - EU',
    publishedAt: '2026-08-01T10:00:00.000Z',
    isListed: true,
    jobUrl: 'https://jobs.ashbyhq.com/Example/ashby-1',
  }, {
    id: 'ashby-hidden',
    title: 'Hidden role',
    isListed: false,
    jobUrl: 'https://jobs.ashbyhq.com/Example/ashby-hidden',
  }],
}, { ...sharedTarget, adapter: 'ashby-job-board', careerPageUrl: 'https://jobs.ashbyhq.com/Example' });
assert.equal(ashbyRecords.length, 1, 'Ashby must keep only publicly listed jobs');
assert.equal(ashbyRecords[0].external_id, 'ashby-1');
assert.equal(ashbyRecords[0].employment_type, 'FullTime');
assert.equal(ashbyRecords[0].raw_target_adapter, 'ashby-job-board');

const recruiteeRecords = mapRecruiteeCareersPayload({
  offers: [{
    id: 2705873,
    title: 'Animator',
    company_name: 'Framestore',
    department: 'Film',
    employment_type_code: 'fulltime_fixed_term',
    locations: [{ name: 'Melbourne' }],
    published_at: '2026-08-11 02:57:45 UTC',
    careers_url: 'https://framestore.recruitee.com/o/animator-2033',
  }],
}, { ...sharedTarget, adapter: 'recruitee-careers', careerPageUrl: 'https://framestore.recruitee.com' });
assert.equal(recruiteeRecords.length, 1);
assert.equal(recruiteeRecords[0].company_name, 'Example Org', 'seed ownership must win over provider display data');
assert.equal(recruiteeRecords[0].location, 'Melbourne');
assert.equal(recruiteeRecords[0].external_id, '2705873');

const workableRecords = mapWorkablePublicJobsPayload({
  jobs: [{
    shortcode: 'DCE4E00CFF',
    title: 'Fullstack Developer',
    employment_type: 'Full-time',
    department: 'Engineering',
    url: 'https://apply.workable.com/j/DCE4E00CFF',
    published_on: '2026-01-06',
    locations: [{ city: 'Pune', region: 'Maharashtra', country: 'India' }],
  }],
}, { ...sharedTarget, adapter: 'workable-public-jobs', careerPageUrl: 'https://apply.workable.com/example/' });
assert.equal(workableRecords.length, 1);
assert.equal(workableRecords[0].external_id, 'DCE4E00CFF');
assert.equal(workableRecords[0].location, 'Pune, Maharashtra, India');

const smartRecruitersRecords = mapSmartRecruitersPostingsPayload({
  content: [{
    id: '744000143115219',
    name: 'Senior Information Security Engineer',
    ref: 'https://api.smartrecruiters.com/v1/companies/example/postings/744000143115219',
    releasedDate: '2026-08-12T14:04:56.128Z',
    location: { fullLocation: 'Poland, REMOTE, Poland' },
    department: { label: 'Engineering' },
    typeOfEmployment: { label: 'Full-time' },
  }],
}, { ...sharedTarget, adapter: 'smartrecruiters-postings', careerPageUrl: 'https://careers.smartrecruiters.com/example' });
assert.equal(smartRecruitersRecords.length, 1);
assert.equal(smartRecruitersRecords[0].external_id, '744000143115219');
assert.equal(smartRecruitersRecords[0].location, 'Poland, REMOTE, Poland');
assert.equal(smartRecruitersRecords[0].job_posting_url, 'https://api.smartrecruiters.com/v1/companies/example/postings/744000143115219');

const teamtailorTarget = {
  ...sharedTarget,
  adapter: 'teamtailor-rss',
  careerPageUrl: 'https://example.teamtailor.com/jobs',
};
const teamtailorRecords = mapTeamtailorRss(`<?xml version="1.0"?>
  <rss><channel><item>
    <guid>https://example.teamtailor.com/jobs/123-platform-engineer</guid>
    <title><![CDATA[Platform Engineer]]></title>
    <link>https://example.teamtailor.com/jobs/123-platform-engineer</link>
    <pubDate>Wed, 12 Aug 2026 10:00:00 GMT</pubDate>
    <category>Engineering</category>
  </item></channel></rss>`, teamtailorTarget);
assert.equal(teamtailorRecords.length, 1);
assert.equal(teamtailorRecords[0].job_title, 'Platform Engineer');
assert.equal(teamtailorRecords[0].job_posting_url, 'https://example.teamtailor.com/jobs/123-platform-engineer');
assert.equal(teamtailorRecords[0].extraction_method, 'teamtailor-rss');

const pinpointRecords = mapPublicCareerRss(`<?xml version="1.0"?>
  <rss><channel><item>
    <guid>https://example.pinpointhq.com/jobs/454797</guid>
    <title>Database Architect</title>
    <link>https://example.pinpointhq.com/jobs/454797</link>
  </item></channel></rss>`, {
  ...sharedTarget,
  adapter: 'hosted-career-page',
  careerPageUrl: 'https://example.pinpointhq.com/jobs',
}, 'pinpoint-rss');
assert.equal(pinpointRecords.length, 1);
assert.equal(pinpointRecords[0].extraction_method, 'pinpoint-rss');

const personioTarget = {
  ...sharedTarget,
  adapter: 'personio-xml',
  careerPageUrl: 'https://example.jobs.personio.de',
};
const personioRecords = mapPersonioXml(`<?xml version="1.0" encoding="UTF-8"?>
  <workzag-jobs><position>
    <id>456</id>
    <name><![CDATA[Senior Data Engineer]]></name>
    <office>Berlin</office>
    <employmentType>permanent</employmentType>
    <createdAt>2026-08-11T12:00:00+00:00</createdAt>
  </position></workzag-jobs>`, personioTarget);
assert.equal(personioRecords.length, 1);
assert.equal(personioRecords[0].job_title, 'Senior Data Engineer');
assert.equal(personioRecords[0].job_posting_url, 'https://example.jobs.personio.de/job/456');
assert.equal(personioRecords[0].extraction_method, 'personio-xml');

const feedDetection = detectCareerPageTargetFromHtml(`
  <a href="https://example.teamtailor.com/jobs">Jobs</a>
  <a href="https://example.jobs.personio.de">More jobs</a>
`, {
  baseUrl: 'https://example.org/careers',
  orgName: 'Example Org',
  domain: 'example.org',
  websiteUrl: 'https://example.org/',
});
assert.ok(feedDetection.targets.some((target) => target.adapter === 'teamtailor-rss'));
assert.ok(feedDetection.targets.some((target) => target.adapter === 'personio-xml'));

let smartRecruitersRequestOptions = null;
const smartRecruitersFallback = await fetchSmartRecruitersPostingsRecords({
  ...sharedTarget,
  adapter: 'smartrecruiters-postings',
  careerPageUrl: 'https://careers.smartrecruiters.com/example',
  sourceUrl: 'https://api.smartrecruiters.com/v1/companies/example/postings',
}, {
  fetchJsonImpl: async (_url, _targetId, options) => {
    smartRecruitersRequestOptions = options;
    const error = new Error('HTTP 403');
    error.status = 403;
    throw error;
  },
  fetchPublicCareersImpl: async () => ({
    records: [{
      company_name: 'Example Org',
      job_title: 'Public Careers Engineer',
      job_posting_url: 'https://careers.smartrecruiters.com/example/job/123',
    }],
    diagnostics: { escalationStage: 'rendered-dom', escalationAttempts: [] },
  }),
});
assert.deepEqual(smartRecruitersRequestOptions, { allowProxyRetry: false });
assert.equal(smartRecruitersFallback.records.length, 1);
assert.equal(smartRecruitersFallback.records[0].raw_target_adapter, 'smartrecruiters-public-careers');
assert.equal(smartRecruitersFallback.diagnostics.publicCareersFallback, true);
assert.equal(smartRecruitersFallback.diagnostics.officialApiStatus, 403);

assert.equal(isHostedAtsVacancyUrl('https://acme.wd1.myworkdayjobs.com/en-US/External/job/Engineer_R1', 'workday'), true);
assert.equal(isHostedAtsVacancyUrl('https://acme.wd1.myworkdayjobs.com/en-US/External/benefits', 'workday'), false);
assert.equal(isHostedAtsVacancyUrl('https://activeprospect.applytojob.com/apply/abc123/Engineer', 'jazzhr'), true);
assert.equal(isHostedAtsVacancyUrl('https://activeprospect.applytojob.com/privacy', 'jazzhr'), false);

const taleoRecords = extractTaleoJobListRecords(
  '!|!53475!|!Senior Solutions Engineer!|!53475!|!Senior Solutions Engineer!|!53475!|!53475!|!53475!|!53475!|!53475!|!2600007I!|!',
  {
    ...sharedTarget,
    adapter: 'hosted-career-page',
    sourceUrl: 'https://example.taleo.net/careersection/ex/joblist.ftl',
    careerPageUrl: 'https://example.taleo.net/careersection/ex/joblist.ftl',
  },
);
assert.equal(taleoRecords.length, 1);
assert.equal(taleoRecords[0].job_title, 'Senior Solutions Engineer');
assert.equal(taleoRecords[0].job_posting_url, 'https://example.taleo.net/careersection/ex/jobdetail.ftl?job=2600007I');

const templatedCardRecords = extractVacancyCardsFromSameDomainHtml(`
  <a href="/p/000b69e1dea701-engineer">
    <h2>Platform Engineer</h2><span>Berlin</span>%BUTTON_APPLY%
  </a>
  <a href="/p/111b69e1dea701-empty">%BUTTON_APPLY%</a>
`, {
  companyName: 'Example Org',
  careerPageUrl: 'https://example.breezy.hr/',
});
assert.equal(templatedCardRecords.length, 1);
assert.equal(templatedCardRecords[0].job_title, 'Platform Engineer');

for (const mapper of [
  mapAshbyJobBoardPayload,
  mapRecruiteeCareersPayload,
  mapWorkablePublicJobsPayload,
  mapSmartRecruitersPostingsPayload,
]) {
  assert.deepEqual(mapper(null, sharedTarget), []);
  assert.deepEqual(mapper({}, sharedTarget), []);
}

console.log(JSON.stringify({
  ok: true,
  smoke: 'career-pages-providers',
  mode: 'offline-parse',
  greenhouseRecords: greenhouseRecords.length,
  leverRecords: leverRecords.length,
  ashbyRecords: ashbyRecords.length,
  recruiteeRecords: recruiteeRecords.length,
  workableRecords: workableRecords.length,
  smartRecruitersRecords: smartRecruitersRecords.length,
  teamtailorRecords: teamtailorRecords.length,
  personioRecords: personioRecords.length,
}, null, 2));
