#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

import { evaluateRfCoverageBenchmark } from './adapters/rf-coverage-benchmark.mjs';

const { Client } = pg;
const inputArg = process.argv.find((arg) => arg.startsWith('--input='));
const jsonOutput = process.argv.includes('--json');
const reportOnly = process.argv.includes('--report-only');
const noPersist = process.argv.includes('--no-persist');
const inputPath = inputArg ? resolve(inputArg.slice('--input='.length)) : null;
assert.ok(inputPath, 'Usage: run-rf-coverage-benchmark.mjs --input=<benchmark.json> [--json] [--report-only] [--no-persist]');

const databaseUrl = process.env.DATABASE_URL?.trim();
assert.ok(databaseUrl, 'DATABASE_URL is required.');

const manifest = JSON.parse(readFileSync(inputPath, 'utf8').replace(/^\uFEFF/, ''));
validateManifest(manifest);
const manifestHash = createHash('sha256').update(stableStringify(manifest)).digest('hex');
const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
await client.connect();

try {
  const benchmarkCompanies = await hydrateCompanyDetections(client, manifest);
  const attributionAudits = await hydrateAttributionAudits(client, manifest.attributionAudits ?? []);
  const demandAudits = await hydrateDemandAudits(client, manifest.demandAudits ?? []);
  const priorityOpportunities = hydratePriorityAudits(manifest.priorityOpportunities ?? []);

  const evaluation = evaluateRfCoverageBenchmark({
    benchmarkCompanies,
    attributionAudits,
    demandAudits,
    priorityOpportunities,
  });

  const report = {
    benchmarkId: manifest.benchmarkId,
    benchmarkVersion: manifest.version,
    manifestHash,
    windowStart: new Date(manifest.windowStart).toISOString(),
    windowEnd: new Date(manifest.windowEnd).toISOString(),
    generatedAt: new Date().toISOString(),
    ...evaluation,
    auditCoverage: {
      attributionRequested: manifest.attributionAudits?.length ?? 0,
      attributionObserved: attributionAudits.length,
      demandRequested: manifest.demandAudits?.length ?? 0,
      demandObserved: demandAudits.length,
      priorityRequested: manifest.priorityOpportunities?.length ?? 0,
      priorityObserved: priorityOpportunities.length,
    },
  };

  if (!noPersist) await persistReport(client, report);
  if (jsonOutput) console.log(JSON.stringify(report));
  else printHuman(report);
  if (!reportOnly && !report.pass) process.exitCode = 1;
} finally {
  await client.end();
}

async function hydrateCompanyDetections(client, manifest) {
  const rows = [];
  for (const company of manifest.companies) {
    const organizationId = requiredId(company.organizationId, 'companies[].organizationId');
    const evidenceAppearedAt = requiredDate(company.evidenceAppearedAt, 'companies[].evidenceAppearedAt');
    const result = await client.query(
      `SELECT MIN(created_at) AS detected_at
       FROM signals
       WHERE org_id = $1::BIGINT
         AND signal_type = 'job_posting'
         AND created_at >= $2::TIMESTAMPTZ
         AND created_at <= $3::TIMESTAMPTZ`,
      [organizationId, evidenceAppearedAt, manifest.windowEnd],
    );
    rows.push({
      id: nonEmptyText(company.id) ?? organizationId,
      organizationId,
      hiringActive: company.hiringActive === true,
      evidenceAppearedAt,
      detectedAt: result.rows[0]?.detected_at ? new Date(result.rows[0].detected_at).toISOString() : null,
    });
  }
  return rows;
}

async function hydrateAttributionAudits(client, audits) {
  const rows = [];
  for (const audit of audits) {
    const source = nonEmptyText(audit.source);
    const externalId = nonEmptyText(audit.externalId);
    const expectedOrganizationId = requiredId(audit.expectedOrganizationId, 'attributionAudits[].expectedOrganizationId');
    if (!source || !externalId) throw new TypeError('attributionAudits[] requires source and externalId.');

    const result = await client.query(
      `SELECT org_id::TEXT AS org_id
       FROM signals
       WHERE source = $1::TEXT AND external_id = $2::TEXT
       ORDER BY created_at ASC, id ASC
       LIMIT 2`,
      [source, externalId],
    );
    if (result.rows.length === 0) continue;
    const observedOrgIds = [...new Set(result.rows.map((row) => String(row.org_id)))];
    rows.push({
      id: nonEmptyText(audit.id) ?? `${source}:${externalId}`,
      expectedOrganizationId,
      observedOrganizationIds: observedOrgIds,
      wrongCompany: observedOrgIds.length !== 1 || observedOrgIds[0] !== expectedOrganizationId,
    });
  }
  return rows;
}

async function hydrateDemandAudits(client, audits) {
  const rows = [];
  for (const audit of audits) {
    const groundTruthDemandId = nonEmptyText(audit.groundTruthDemandId);
    if (!groundTruthDemandId || !Array.isArray(audit.publications) || audit.publications.length === 0) {
      throw new TypeError('demandAudits[] requires groundTruthDemandId and non-empty publications[].');
    }
    const canonicalIds = new Set();
    for (const publication of audit.publications) {
      const sourceFamily = nonEmptyText(publication.sourceFamily);
      const externalVacancyId = nonEmptyText(publication.externalVacancyId);
      if (!sourceFamily || !externalVacancyId) {
        throw new TypeError('demandAudits[].publications[] requires sourceFamily and externalVacancyId.');
      }
      const result = await client.query(
        `SELECT DISTINCT canonical_vacancy_id::TEXT AS canonical_vacancy_id
         FROM canonical_vacancy_publications_v1
         WHERE source_family = $1::TEXT
           AND external_vacancy_id = $2::TEXT
         ORDER BY canonical_vacancy_id`,
        [sourceFamily, externalVacancyId],
      );
      for (const row of result.rows) canonicalIds.add(String(row.canonical_vacancy_id));
    }
    rows.push({
      groundTruthDemandId,
      observedCanonicalDemandIds: [...canonicalIds].sort(compareIds),
    });
  }
  return rows;
}

function hydratePriorityAudits(audits) {
  return audits.map((audit) => {
    const directEvidence = audit.directEvidence === true;
    const independentFamilies = Array.isArray(audit.independentEvidenceFamilies)
      ? [...new Set(audit.independentEvidenceFamilies.map(nonEmptyText).filter(Boolean))]
      : [];
    return {
      id: nonEmptyText(audit.id),
      directEvidence,
      independentCorroboration: independentFamilies.length >= 2 || audit.independentCorroboration === true,
      independentEvidenceFamilies: independentFamilies,
    };
  });
}

async function persistReport(client, report) {
  await client.query(
    `INSERT INTO rf_coverage_benchmark_runs_v1 (
       benchmark_id, benchmark_version, manifest_hash, window_start, window_end,
       generated_at, passed, population, metrics, checks, report
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::JSONB,$9::JSONB,$10::JSONB,$11::JSONB)
     ON CONFLICT (benchmark_id, benchmark_version, manifest_hash, window_end)
     DO UPDATE SET
       generated_at = EXCLUDED.generated_at,
       passed = EXCLUDED.passed,
       population = EXCLUDED.population,
       metrics = EXCLUDED.metrics,
       checks = EXCLUDED.checks,
       report = EXCLUDED.report`,
    [
      report.benchmarkId,
      report.benchmarkVersion,
      report.manifestHash,
      report.windowStart,
      report.windowEnd,
      report.generatedAt,
      report.pass,
      JSON.stringify(report.population),
      JSON.stringify(report.metrics),
      JSON.stringify(report.checks),
      JSON.stringify(report),
    ],
  );
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new TypeError('Benchmark manifest must be an object.');
  if (!Number.isInteger(manifest.version) || manifest.version <= 0) throw new TypeError('Benchmark manifest version must be a positive integer.');
  if (!nonEmptyText(manifest.benchmarkId)) throw new TypeError('benchmarkId is required.');
  const start = Date.parse(manifest.windowStart);
  const end = Date.parse(manifest.windowEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new TypeError('windowStart/windowEnd must define a valid positive window.');
  if (!Array.isArray(manifest.companies) || manifest.companies.length === 0) throw new TypeError('companies must be non-empty.');
  if (!Array.isArray(manifest.attributionAudits) || manifest.attributionAudits.length === 0) throw new TypeError('attributionAudits must be non-empty.');
  if (!Array.isArray(manifest.demandAudits) || manifest.demandAudits.length === 0) throw new TypeError('demandAudits must be non-empty.');
  if (!Array.isArray(manifest.priorityOpportunities) || manifest.priorityOpportunities.length === 0) throw new TypeError('priorityOpportunities must be non-empty.');
  for (const company of manifest.companies) {
    requiredId(company.organizationId, 'companies[].organizationId');
    requiredDate(company.evidenceAppearedAt, 'companies[].evidenceAppearedAt');
    if (typeof company.hiringActive !== 'boolean') throw new TypeError('companies[].hiringActive must be boolean.');
  }
  return true;
}

function requiredId(value, label) {
  const text = nonEmptyText(String(value ?? ''));
  if (!text || !/^\d+$/.test(text)) throw new TypeError(`${label} must be a positive database id.`);
  return text;
}

function requiredDate(value, label) {
  const text = nonEmptyText(value);
  if (!text || !Number.isFinite(Date.parse(text))) throw new TypeError(`${label} must be a parseable date.`);
  return new Date(text).toISOString();
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function nonEmptyText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

function compareIds(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isSafeInteger(leftNumber) && Number.isSafeInteger(rightNumber)) return leftNumber - rightNumber;
  return String(left).localeCompare(String(right));
}

function printHuman(report) {
  console.log('=== RF SOURCE INTELLIGENCE V2 BENCHMARK ===');
  console.log(`Benchmark: ${report.benchmarkId} v${report.benchmarkVersion}`);
  console.log(`Window: ${report.windowStart} -> ${report.windowEnd}`);
  console.log(`Weekly recall: ${formatRate(report.metrics.weeklyRecall)}`);
  console.log(`Discovery latency p95: ${formatNumber(report.metrics.discoveryLatencyP95Hours)}h`);
  console.log(`Wrong-company attribution: ${formatRate(report.metrics.wrongCompanyAttributionRate)}`);
  console.log(`Duplicate hiring demand: ${formatRate(report.metrics.duplicateHiringDemandRate)}`);
  console.log(`Priority corroboration: ${formatRate(report.metrics.priorityCorroborationRate)}`);
  console.log(`Result: ${report.pass ? 'PASS' : 'FAIL'}`);
}

function formatRate(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : 'n/a';
}

function formatNumber(value) {
  return Number.isFinite(value) ? Number(value).toFixed(2) : 'n/a';
}
