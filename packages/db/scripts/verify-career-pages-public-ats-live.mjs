import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { countSensitiveFields } from './adapters/source-records.mjs';
import { fetchText } from './adapters/source-http.mjs';
import { detectCareerPageTargetFromHtml, fetchCareerPagesInput } from './source-career-pages.mjs';

const tempDirectory = mkdtempSync(join(tmpdir(), 'rr-public-ats-'));
const targetsFilePath = join(tempDirectory, 'targets.json');
const previousTargetsFile = process.env.CAREER_PAGES_TARGETS_FILE;
const previousFetchBudget = process.env.CAREER_PAGES_FETCH_BUDGET_MS;

const targets = [
  {
    id: 'discord-greenhouse-live',
    adapter: 'greenhouse-board',
    company_name: 'Discord',
    company_domain: 'discord.com',
    company_website_url: 'https://discord.com/',
    career_page_url: 'https://boards.greenhouse.io/discord',
    source_url: 'https://boards-api.greenhouse.io/v1/boards/discord/jobs?content=true',
  },
  {
    id: 'dnb-lever-live',
    adapter: 'lever-postings',
    company_name: 'Dun & Bradstreet',
    company_domain: 'dnb.com',
    company_website_url: 'https://www.dnb.com/',
    career_page_url: 'https://jobs.lever.co/dnb',
    source_url: 'https://api.lever.co/v0/postings/dnb?mode=json',
  },
  {
    id: 'ashby-live',
    adapter: 'ashby-job-board',
    company_name: 'Ashby',
    company_domain: 'ashbyhq.com',
    company_website_url: 'https://www.ashbyhq.com/',
    career_page_url: 'https://jobs.ashbyhq.com/Ashby',
    source_url: 'https://api.ashbyhq.com/posting-api/job-board/Ashby?includeCompensation=true',
  },
  {
    id: 'framestore-recruitee-live',
    adapter: 'recruitee-careers',
    company_name: 'Framestore',
    company_domain: 'framestore.com',
    company_website_url: 'https://www.framestore.com/',
    career_page_url: 'https://framestore.recruitee.com',
    source_url: 'https://framestore.recruitee.com/api/offers/',
  },
  {
    id: 'blue-altair-workable-live',
    adapter: 'workable-public-jobs',
    company_name: 'Blue Altair',
    company_domain: 'bluealtair.com',
    company_website_url: 'https://www.bluealtair.com/',
    career_page_url: 'https://apply.workable.com/blue-altair/',
    source_url: 'https://www.workable.com/api/accounts/blue-altair?details=true',
  },
  {
    id: 'smartrecruiters-live',
    adapter: 'smartrecruiters-postings',
    company_name: 'SmartRecruiters Inc',
    company_domain: 'smartrecruiters.com',
    company_website_url: 'https://www.smartrecruiters.com/',
    career_page_url: 'https://careers.smartrecruiters.com/smartrecruiters',
    source_url: 'https://api.smartrecruiters.com/v1/companies/smartrecruiters/postings?limit=100&offset=0',
  },
];

try {
  writeFileSync(targetsFilePath, `${JSON.stringify({ targets }, null, 2)}\n`, 'utf8');
  process.env.CAREER_PAGES_TARGETS_FILE = targetsFilePath;
  process.env.CAREER_PAGES_FETCH_BUDGET_MS = '0';

  const input = await fetchCareerPagesInput({ persistSnapshot: false });
  assert.equal(input.targetsProcessed, targets.length);
  assert.equal(input.targetResults.length, targets.length);
  assert.ok(input.recordsReceived > 0, 'public ATS endpoints must return published jobs');
  assert.equal(input.skippedRecords, 0, 'every fetched public ATS record must normalize');
  assert.equal(input.budgetExhausted, false);

  const resultsByAdapter = new Map(input.targetResults.map((result) => [result.adapter, result]));
  for (const target of targets) {
    const result = resultsByAdapter.get(target.adapter);
    assert.ok(result, `${target.adapter} must produce a target result`);
    assert.equal(result.outcome, 'parsed', `${target.adapter} must parse live published jobs`);
    assert.ok(result.recordsFetched > 0, `${target.adapter} must return at least one live job`);
  }

  for (const record of input.normalizedRecords) {
    assert.ok(record.signalExternalId, 'normalized ATS job must have a deterministic external id');
    assert.ok(record.jobTitle, 'normalized ATS job must have a title');
    assert.ok(record.jobPostingUrl, 'normalized ATS job must preserve a public evidence URL');
    assert.equal(countSensitiveFields(record.rawRecord), 0, 'persistable ATS records must contain no sensitive fields');
  }
  assert.deepEqual(
    [...new Set(input.normalizedRecords.map((record) => record.sourceId))].sort(),
    ['ashby', 'greenhouse', 'lever', 'recruitee', 'smartrecruiters', 'workable'],
    'each ATS adapter must persist under its own auditable source id',
  );

  const liveDiscoveryCases = [
    {
      orgName: 'Framestore',
      domain: 'framestore.com',
      websiteUrl: 'https://www.framestore.com/',
      pageUrl: 'https://www.framestore.com/careers',
      expectedAdapter: 'recruitee-careers',
    },
    {
      orgName: 'Blue Altair',
      domain: 'bluealtair.com',
      websiteUrl: 'https://www.bluealtair.com/',
      pageUrl: 'https://www.bluealtair.com/careers',
      expectedAdapter: 'workable-public-jobs',
    },
  ];
  const liveDiscoveries = [];

  for (const discoveryCase of liveDiscoveryCases) {
    const { response, body } = await fetchText(discoveryCase.pageUrl, {
      sourceName: `public ATS discovery ${discoveryCase.orgName}`,
      headers: {
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'user-agent': 'RecruiterRadarSourceVerifier/1.0',
      },
      redirect: 'follow',
    });
    const detection = detectCareerPageTargetFromHtml(body, {
      baseUrl: response.url,
      orgName: discoveryCase.orgName,
      domain: discoveryCase.domain,
      websiteUrl: discoveryCase.websiteUrl,
    });
    assert.ok(
      detection.targets.some((target) => target.adapter === discoveryCase.expectedAdapter),
      `${discoveryCase.orgName} corporate page must auto-discover ${discoveryCase.expectedAdapter}`,
    );
    liveDiscoveries.push({
      company: discoveryCase.orgName,
      adapter: discoveryCase.expectedAdapter,
      resolvedUrl: response.url,
    });
  }

  console.log(JSON.stringify({
    ok: true,
    smoke: 'career-pages-public-ats-live',
    targets: input.targetResults.map((result) => ({
      adapter: result.adapter,
      recordsFetched: result.recordsFetched,
      outcome: result.outcome,
      extractionMethod: result.extractionMethod,
    })),
    recordsReceived: input.recordsReceived,
    normalizedRecords: input.normalizedRecords.length,
    skippedRecords: input.skippedRecords,
    sensitiveFieldsDropped: input.sensitiveFieldsDropped,
    liveDiscoveries,
  }, null, 2));
} finally {
  if (previousTargetsFile === undefined) delete process.env.CAREER_PAGES_TARGETS_FILE;
  else process.env.CAREER_PAGES_TARGETS_FILE = previousTargetsFile;
  if (previousFetchBudget === undefined) delete process.env.CAREER_PAGES_FETCH_BUDGET_MS;
  else process.env.CAREER_PAGES_FETCH_BUDGET_MS = previousFetchBudget;
  rmSync(tempDirectory, { recursive: true, force: true });
}
