import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { countSensitiveFields } from './adapters/source-records.mjs';
import { fetchText } from './adapters/source-http.mjs';
import { fetchCareerPagesInput } from './source-career-pages.mjs';

const tempDirectory = mkdtempSync(join(tmpdir(), 'rr-russian-ats-'));
const targetsFilePath = join(tempDirectory, 'targets.json');
const previous = {
  targetsFile: process.env.CAREER_PAGES_TARGETS_FILE,
  fetchBudget: process.env.CAREER_PAGES_FETCH_BUDGET_MS,
  renderSettle: process.env.CAREER_PAGES_RENDER_SETTLE_MS,
};

const targets = [
  ['potok', 'B1', 'b1.ru', 'https://b1.potok.io/open/jobs', 'page-unreachable'],
  ['huntflow', 'hate agency', 'hateagency.com', 'https://hatehr.huntflow.io/', 'parsed'],
  ['friendwork', 'GGSEL', 'ggsel.net', 'https://jobs.friend.work/ggsel/113802', 'parsed'],
  ['e-staff', 'Lamoda', 'lamoda.ru', 'https://job.lamoda.ru/vacancies', 'parsed'],
  ['talantix', 'ZennoLab', 'zennolab.com', 'https://talantix.ru/form/OBjUfTGmI2oHKyP9ipazTA', 'page-unreachable'],
].map(([family, companyName, companyDomain, sourceUrl, expectedOutcome]) => ({
  id: `${family}-live`,
  adapter: 'hosted-career-page',
  hosted_ats_family: family,
  company_name: companyName,
  company_domain: companyDomain,
  company_website_url: `https://${companyDomain}/`,
  career_page_url: sourceUrl,
  source_url: sourceUrl,
  expectedOutcome,
}));

try {
  writeFileSync(targetsFilePath, `${JSON.stringify({ targets }, null, 2)}\n`, 'utf8');
  process.env.CAREER_PAGES_TARGETS_FILE = targetsFilePath;
  process.env.CAREER_PAGES_FETCH_BUDGET_MS = '0';
  process.env.CAREER_PAGES_RENDER_SETTLE_MS = '5000';

  const input = await fetchCareerPagesInput({ persistSnapshot: false });
  assert.equal(input.targetsProcessed, targets.length);
  assert.equal(input.targetResults.length, targets.length);
  assert.equal(input.budgetExhausted, false);
  assert.equal(input.skippedRecords, 0, 'every accepted Russian ATS record must normalize');

  const resultsByFamily = new Map(input.targetResults.map((result) => [
    targets.find((target) => target.id === result.id)?.hosted_ats_family,
    result,
  ]));
  const recordsByFamily = new Map(targets.map((target) => [
    target.hosted_ats_family,
    input.normalizedRecords.filter((record) => record.rawRecord?.hosted_ats_family === target.hosted_ats_family),
  ]));

  for (const target of targets) {
    const result = resultsByFamily.get(target.hosted_ats_family);
    const records = recordsByFamily.get(target.hosted_ats_family) ?? [];
    assert.ok(result, `${target.hosted_ats_family} must produce a live result`);
    assert.equal(
      result.outcome,
      target.expectedOutcome,
      `${target.hosted_ats_family} live result: ${JSON.stringify(result)}`,
    );
    if (target.expectedOutcome !== 'parsed') {
      assert.equal(result.errorCategory, 'access-policy:robots-disallowed');
      assert.equal(result.recordsFetched, 0);
      continue;
    }
    assert.ok(result.recordsFetched > 0, `${target.hosted_ats_family} must return a live vacancy`);
    assert.ok(records.length > 0, `${target.hosted_ats_family} must normalize its live vacancies`);

    const detail = records[0];
    assert.ok(detail.jobPostingUrl, `${target.hosted_ats_family} must preserve a vacancy detail URL`);
    const fetchedDetail = await fetchText(detail.jobPostingUrl, {
      sourceName: `${target.hosted_ats_family} public vacancy detail evidence`,
      headers: {
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'user-agent': 'RecruiterRadarSourceVerifier/1.0',
      },
    });
    assert.ok(fetchedDetail.body.length > 100, `${target.hosted_ats_family} detail page must contain public content`);
  }

  for (const record of input.normalizedRecords) {
    assert.equal(record.sourceId, 'career-pages');
    assert.ok(record.signalExternalId);
    assert.ok(record.jobTitle);
    assert.ok(record.jobPostingUrl);
    assert.equal(countSensitiveFields(record.rawRecord), 0);
  }

  console.log(JSON.stringify({
    ok: true,
    smoke: 'career-pages-russian-ats-live',
    families: input.targetResults.map((result) => ({
      family: targets.find((target) => target.id === result.id)?.hosted_ats_family,
      recordsFetched: result.recordsFetched,
      outcome: result.outcome,
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
  rmSync(tempDirectory, { recursive: true, force: true });
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
