import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { countSensitiveFields } from './adapters/source-records.mjs';
import { fetchText } from './adapters/source-http.mjs';
import { fetchCareerPagesInput } from './source-career-pages.mjs';

const tempDirectory = mkdtempSync(join(tmpdir(), 'rr-hosted-ats-'));
const targetsFilePath = join(tempDirectory, 'targets.json');
const previous = {
  targetsFile: process.env.CAREER_PAGES_TARGETS_FILE,
  fetchBudget: process.env.CAREER_PAGES_FETCH_BUDGET_MS,
  renderSettle: process.env.CAREER_PAGES_RENDER_SETTLE_MS,
  hostedLimit: process.env.CAREER_PAGES_HOSTED_FEED_JOB_LIMIT,
};

const targets = [
  ['workday', 'FICO', 'fico.com', 'https://fico.wd1.myworkdayjobs.com/en-US/External'],
  ['bamboohr', 'Switch2 Energy', 'switch2.co.uk', 'https://switch2.bamboohr.com/careers'],
  ['pinpoint', 'Gaming Innovation Group', 'gig.com', 'https://gig.pinpointhq.com/jobs'],
  ['breezy', 'Cronos Europa', 'cronoseuropa.com', 'https://cronoseuropa.breezy.hr/'],
  ['comeet', 'Port', 'port.io', 'https://www.comeet.com/jobs/port/59.004'],
  ['jazzhr', 'ActiveProspect', 'activeprospect.com', 'https://activeprospect.applytojob.com/apply'],
  ['icims', 'American Career College', 'americancareercollege.edu', 'https://careers-americancareercollege.icims.com/jobs/search?in_iframe=1&ss=1'],
  ['oracle-taleo', 'Radware', 'radware.com', 'https://radware.taleo.net/careersection/ex/joblist.ftl'],
  ['oracle-cloud', 'HDB Financial Services', 'hdbfs.com', 'https://hdbc.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/jobs'],
  ['sap-successfactors', 'Arthrex', 'arthrex.com', 'https://careers.arthrex.com/go/View-All-Jobs/8415700/'],
].map(([family, companyName, companyDomain, sourceUrl]) => ({
  id: `${family}-live`,
  adapter: 'hosted-career-page',
  hosted_ats_family: family,
  company_name: companyName,
  company_domain: companyDomain,
  company_website_url: `https://${companyDomain}/`,
  career_page_url: sourceUrl,
  source_url: sourceUrl,
}));

try {
  writeFileSync(targetsFilePath, `${JSON.stringify({ targets }, null, 2)}\n`, 'utf8');
  process.env.CAREER_PAGES_TARGETS_FILE = targetsFilePath;
  process.env.CAREER_PAGES_FETCH_BUDGET_MS = '0';
  process.env.CAREER_PAGES_RENDER_SETTLE_MS = '7000';
  process.env.CAREER_PAGES_HOSTED_FEED_JOB_LIMIT = '5';

  const { body: sapPublicHtml } = await fetchText(targets.at(-1).source_url, {
    sourceName: 'SAP SuccessFactors public career surface evidence',
    headers: {
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
      'user-agent': 'RecruiterRadarSourceVerifier/1.0',
    },
  });
  assert.match(
    sapPublicHtml,
    /(?:SAP as service provider|careerSiteCompanyId|successfactors)/i,
    'Arthrex employer-owned public jobs page must expose SAP SuccessFactors provenance',
  );

  const input = await fetchCareerPagesInput({ persistSnapshot: false });
  assert.equal(input.targetsProcessed, targets.length);
  assert.equal(input.targetResults.length, targets.length);
  assert.equal(input.budgetExhausted, false);
  assert.equal(input.skippedRecords, 0, 'every accepted hosted ATS record must normalize');

  const resultsByFamily = new Map(input.targetResults.map((result) => [
    targets.find((target) => target.id === result.id)?.hosted_ats_family,
    result,
  ]));
  for (const target of targets) {
    const result = resultsByFamily.get(target.hosted_ats_family);
    assert.ok(result, `${target.hosted_ats_family} must produce a live result`);
    assert.equal(
      result.outcome,
      'parsed',
      `${target.hosted_ats_family} must parse a real public employer surface: ${result.errorCategory ?? 'no-error-category'}`,
    );
    assert.ok(result.recordsFetched > 0, `${target.hosted_ats_family} must return a live vacancy`);
  }

  for (const record of input.normalizedRecords) {
    assert.equal(record.sourceId, 'career-pages');
    assert.ok(record.signalExternalId, 'hosted ATS record must have a deterministic external id');
    assert.ok(record.jobTitle, 'hosted ATS record must have a vacancy title');
    assert.ok(record.jobPostingUrl, 'hosted ATS record must preserve a canonical public URL');
    assert.equal(countSensitiveFields(record.rawRecord), 0, 'persistable hosted ATS record must contain no sensitive fields');
  }

  console.log(JSON.stringify({
    ok: true,
    smoke: 'career-pages-hosted-ats-live',
    families: input.targetResults.map((result) => ({
      family: targets.find((target) => target.id === result.id)?.hosted_ats_family,
      recordsFetched: result.recordsFetched,
      escalationStage: result.escalationStage,
      extractionMethod: result.extractionMethod,
      resolvedUrl: result.resolvedUrl,
    })),
    recordsReceived: input.recordsReceived,
    normalizedRecords: input.normalizedRecords.length,
    skippedRecords: input.skippedRecords,
  }, null, 2));
} finally {
  restoreEnv('CAREER_PAGES_TARGETS_FILE', previous.targetsFile);
  restoreEnv('CAREER_PAGES_FETCH_BUDGET_MS', previous.fetchBudget);
  restoreEnv('CAREER_PAGES_RENDER_SETTLE_MS', previous.renderSettle);
  restoreEnv('CAREER_PAGES_HOSTED_FEED_JOB_LIMIT', previous.hostedLimit);
  rmSync(tempDirectory, { recursive: true, force: true });
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
