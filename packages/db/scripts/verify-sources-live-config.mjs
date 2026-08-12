#!/usr/bin/env node

import { listEvaluatedSourceReadiness } from './source-readiness.mjs';

const jsonOutput = process.argv.includes('--json');
const reportOnly = process.argv.includes('--report-only');
const sources = listEvaluatedSourceReadiness();
const requiredLaunchSources = sources.filter((source) => source.eligibility === 'digest-eligible');
const launchReady = requiredLaunchSources.every((source) => (
  source.configured
  && source.liveVerified
  && source.confidenceApproved
  && source.finalState === 'digest-eligible'
));

const report = {
  ok: launchReady,
  generatedAt: new Date().toISOString(),
  launchReady,
  requiredLaunchSourceIds: requiredLaunchSources.map((source) => source.id),
  summary: {
    total: sources.length,
    configured: sources.filter((source) => source.configured).length,
    liveReachable: sources.filter((source) => source.liveReachable).length,
    liveVerified: sources.filter((source) => source.liveVerified).length,
    providerRequired: sources.filter((source) => source.finalState === 'provider-required').length,
    legalReviewRequired: sources.filter((source) => source.finalState === 'legal-review-required').length,
    blocked: sources.filter((source) => source.finalState === 'blocked').length,
  },
  sources,
};

if (jsonOutput) {
  console.log(JSON.stringify(report));
} else {
  printHumanReport(report);
}

if (!reportOnly && !launchReady) {
  process.exitCode = 1;
}

function printHumanReport(value) {
  console.log('=== SOURCE RUNTIME READINESS ===');
  console.log(`Generated: ${value.generatedAt}`);
  console.log('Configuration, reachability, and live verification are independent states.\n');

  for (const source of value.sources) {
    console.log(`${source.id}: ${source.finalState}`);
    console.log(`  implemented=${source.implementation === 'implemented'} fixture=${source.fixtureTested} contract=${source.contractTested}`);
    console.log(`  configured=${source.configured} liveReachable=${source.liveReachable} liveVerified=${source.liveVerified}`);
    console.log(`  confidence=${source.confidence} eligibility=${source.eligibility} legalReview=${source.legalReview}`);
    if (!source.configured && source.acceptedEnvSets.length > 0) {
      console.log(`  acceptedConfig=${source.acceptedEnvSets.map((envSet) => envSet.join(' + ')).join(' OR ')}`);
    }
    for (const blocker of source.blockers) {
      console.log(`  blocker=${blocker}`);
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Total: ${value.summary.total}`);
  console.log(`Configured: ${value.summary.configured}`);
  console.log(`Live reachable: ${value.summary.liveReachable}`);
  console.log(`Live verified: ${value.summary.liveVerified}`);
  console.log(`Provider required: ${value.summary.providerRequired}`);
  console.log(`Legal review required: ${value.summary.legalReviewRequired}`);
  console.log(`Blocked: ${value.summary.blocked}`);
  console.log(`Launch ready: ${value.launchReady ? 'YES' : 'NO'}`);
}
