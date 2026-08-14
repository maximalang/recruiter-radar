import { performance } from 'node:perf_hooks';
import pg from 'pg';

import {
  buildNormalizedInput,
  ingestCareerPages,
} from './source-career-pages.mjs';

const { Client } = pg;
const RECORD_COUNT = 700;
const COMPANY_COUNT = 35;

if (process.env.CAREER_PAGES_BENCHMARK_ACK !== 'isolated') {
  throw new Error('CAREER_PAGES_BENCHMARK_ACK=isolated is required.');
}
const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error('DATABASE_URL is required.');
const persistenceMode = process.argv[2];
if (!['legacy', 'batch'].includes(persistenceMode)) {
  throw new Error('Usage: benchmark-career-pages-persistence.mjs <legacy|batch>');
}

const fetchedAt = '2026-08-14T00:00:00.000Z';
const records = Array.from({ length: RECORD_COUNT }, (_, index) => {
  const companyIndex = index % COMPANY_COUNT;
  const companyDomain = `benchmark-${companyIndex}.example.test`;
  return {
    company_name: `Benchmark Company ${companyIndex}`,
    company_domain: companyDomain,
    company_website_url: `https://${companyDomain}/`,
    career_page_url: `https://${companyDomain}/careers`,
    job_posting_url: `https://${companyDomain}/careers/vacancy-${index}`,
    job_title: `Benchmark vacancy ${index}`,
    external_id: `benchmark-vacancy-${index}`,
    occurred_at: fetchedAt,
    extraction_method: 'greenhouse-api',
    raw_target_adapter: 'greenhouse-board',
    org_external_id: `benchmark-company-${companyIndex}`,
  };
});
const input = buildNormalizedInput({
  records,
  inputMode: 'benchmark',
  inputFilePath: null,
  targetsFilePath: null,
  fetchOutputPath: null,
  targetResults: [],
  discoverySummary: null,
});

const startedAt = performance.now();
const stats = await ingestCareerPages({ connectionString, input, persistenceMode });
const durationMs = Math.round(performance.now() - startedAt);

const verifier = new Client({ connectionString });
await verifier.connect();
try {
  const { rows: [counts] } = await verifier.query(`
    SELECT
      (SELECT COUNT(*)::INTEGER FROM signals) AS signals,
      (SELECT COUNT(*)::INTEGER FROM evidence_items) AS evidence,
      (SELECT COUNT(*)::INTEGER FROM source_signal_evidence_lineage_v1) AS lineage
  `);
  if (counts.signals !== RECORD_COUNT || counts.evidence !== RECORD_COUNT || counts.lineage !== RECORD_COUNT) {
    throw new Error(`Persistence count mismatch: ${JSON.stringify(counts)}`);
  }
} finally {
  await verifier.end();
}

process.stdout.write(`${JSON.stringify({
  persistenceMode,
  recordCount: RECORD_COUNT,
  companyCount: COMPANY_COUNT,
  durationMs,
  stats,
})}\n`);
