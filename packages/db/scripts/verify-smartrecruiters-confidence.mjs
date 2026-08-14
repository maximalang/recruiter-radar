#!/usr/bin/env node

import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

import { countSensitiveFields } from './adapters/source-records.mjs';
import {
  buildNormalizedInput,
  fetchSmartRecruitersPostingsRecords,
} from './source-career-pages.mjs';
import {
  SMARTRECRUITERS_CONFIDENCE_THRESHOLDS,
  buildSmartRecruitersGoldSet,
  evaluateSmartRecruitersGoldSet,
} from './lib/smartrecruiters-confidence.mjs';

const LIVE_ENABLED = process.env.SMARTRECRUITERS_CONFIDENCE_LIVE === '1';
const LIVE_TARGET = {
  id: 'smartrecruiters-confidence-live',
  adapter: 'smartrecruiters-postings',
  companyName: 'SmartRecruiters Inc',
  companyDomain: 'smartrecruiters.com',
  companyWebsiteUrl: 'https://www.smartrecruiters.com/',
  careerPageUrl: 'https://careers.smartrecruiters.com/smartrecruiters',
  sourceUrl: 'https://api.smartrecruiters.com/v1/companies/smartrecruiters/postings?limit=100&offset=0',
};

export async function verifySmartRecruitersConfidence({ live = LIVE_ENABLED } = {}) {
  const report = evaluateSmartRecruitersGoldSet(buildSmartRecruitersGoldSet());
  assert.equal(report.passed, true, `SmartRecruiters gold-set confidence failed: ${JSON.stringify(report.failedCases)}`);

  let liveReport = { ran: false, status: 'skipped' };
  if (live) {
    const fetched = await fetchSmartRecruitersPostingsRecords(LIVE_TARGET);
    const input = buildNormalizedInput({
      records: fetched.records,
      inputMode: 'live-confidence',
      inputFilePath: null,
      targetsFilePath: null,
      fetchOutputPath: null,
      targetResults: [],
      discoverySummary: null,
      rejectAllSkipped: true,
    });
    assert.ok(input.normalizedRecords.length >= 2, 'live SmartRecruiters surface must normalize at least two current vacancies');
    for (const record of input.normalizedRecords) {
      assert.equal(record.sourceId, 'smartrecruiters');
      assert.equal(record.companyDomain, LIVE_TARGET.companyDomain);
      assert.ok(isOfficialUrl(record.jobPostingUrl), `non-official SmartRecruiters evidence URL: ${record.jobPostingUrl}`);
      assert.equal(countSensitiveFields(record.rawRecord), 0, `sensitive live payload survived for ${record.signalExternalId}`);
    }
    liveReport = {
      ran: true,
      status: 'passed',
      recordsFetched: fetched.records.length,
      recordsNormalized: input.normalizedRecords.length,
      extractionStage: fetched.diagnostics?.escalationStage ?? null,
      officialApiOutcome: fetched.diagnostics?.officialApiOutcome ?? 'available',
    };
  }

  return {
    ok: true,
    source: 'smartrecruiters',
    mode: live ? 'gold-set-plus-live' : 'gold-set',
    thresholds: SMARTRECRUITERS_CONFIDENCE_THRESHOLDS,
    metrics: report,
    live: liveReport,
  };
}

function isOfficialUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'jobs.smartrecruiters.com' || hostname === 'api.smartrecruiters.com';
  } catch {
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await verifySmartRecruitersConfidence(), null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      source: 'smartrecruiters',
      error: error instanceof Error ? error.message : String(error),
    }, null, 2));
    process.exit(1);
  }
}
