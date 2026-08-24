#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import pg from 'pg';

import { RF_DISCOVERY_FAMILY_IDS } from './adapters/rf-discovery-families.mjs';

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL?.trim();
assert.ok(databaseUrl, 'DATABASE_URL is required.');
if (process.env.RF_SOURCE_INTELLIGENCE_V2_ENABLED !== '1') {
  throw new Error('RF Source Intelligence V2 runner is opt-in. Set RF_SOURCE_INTELLIGENCE_V2_ENABLED=1.');
}

const familyArgs = process.argv
  .filter((arg) => arg.startsWith('--family='))
  .map((arg) => arg.slice('--family='.length).trim())
  .filter(Boolean);
const families = familyArgs.length > 0 ? [...new Set(familyArgs)] : [...RF_DISCOVERY_FAMILY_IDS];
for (const family of families) {
  if (!RF_DISCOVERY_FAMILY_IDS.includes(family)) throw new Error(`Unknown RF discovery family: ${family}`);
}
const enrichLimit = normalizeLimit(readArg('--enrich-limit='), 100, 1000);
const reconcileLimit = normalizeLimit(readArg('--reconcile-limit='), 500, 5000);
const phaseTimeoutMs = normalizeLimit(process.env.RF_SOURCE_INTELLIGENCE_PHASE_TIMEOUT_MS, 8 * 60_000, 30 * 60_000, 10_000);
const failOnFamilyFailure = process.argv.includes('--fail-on-family-failure');
const jsonOutput = process.argv.includes('--json');
const scriptDir = resolve(import.meta.dirname);

const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
await client.connect();
let lockAcquired = false;
const startedAt = new Date();
const familyReports = [];

try {
  const lock = await client.query(
    "SELECT pg_try_advisory_lock(hashtext('rf-source-intelligence-v2')) AS acquired",
  );
  lockAcquired = lock.rows[0]?.acquired === true;
  if (!lockAcquired) {
    const report = {
      ok: true,
      skipped: true,
      reason: 'another-rf-source-intelligence-v2-cycle-is-running',
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      families: [],
    };
    console.log(jsonOutput ? JSON.stringify(report) : JSON.stringify(report, null, 2));
    process.exit(0);
  }

  for (const family of families) {
    const report = {
      family,
      startedAt: new Date().toISOString(),
      phases: {},
      ok: true,
    };

    report.phases.discovery = runPhase('discover-rf-job-board.mjs', [
      `--family=${family}`,
      '--json',
    ]);
    if (!report.phases.discovery.ok) report.ok = false;

    report.phases.enrichment = runPhase('enrich-rf-hiring-candidates.mjs', [
      `--family=${family}`,
      `--limit=${enrichLimit}`,
      '--json',
    ]);
    if (!report.phases.enrichment.ok) report.ok = false;

    report.phases.reconciliation = runPhase('reconcile-rf-hiring-candidates.mjs', [
      `--family=${family}`,
      `--limit=${reconcileLimit}`,
      '--json',
    ]);
    if (!report.phases.reconciliation.ok) report.ok = false;

    report.completedAt = new Date().toISOString();
    familyReports.push(report);
  }
} finally {
  if (lockAcquired) {
    try {
      await client.query("SELECT pg_advisory_unlock(hashtext('rf-source-intelligence-v2'))");
    } catch {
      // Session close releases the advisory lock even if explicit unlock fails.
    }
  }
  await client.end();
}

const failedFamilies = familyReports.filter((family) => !family.ok).map((family) => family.family);
const report = {
  ok: failedFamilies.length === 0,
  skipped: false,
  mode: 'stage-enrich-reconcile-no-promotion',
  promotionEnabled: false,
  startedAt: startedAt.toISOString(),
  completedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAt.getTime(),
  families: familyReports,
  failedFamilies,
};
console.log(jsonOutput ? JSON.stringify(report) : JSON.stringify(report, null, 2));
if (failOnFamilyFailure && failedFamilies.length > 0) process.exitCode = 1;

function runPhase(scriptName, args) {
  const phaseStartedAt = new Date();
  const result = spawnSync(process.execPath, [resolve(scriptDir, scriptName), ...args], {
    cwd: resolve(scriptDir, '../../..'),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      RF_DISCOVERY_PROMOTE: '0',
    },
    encoding: 'utf8',
    timeout: phaseTimeoutMs,
  });
  const parsed = parseJsonOutput(result.stdout);
  return {
    ok: !result.error && result.status === 0 && parsed?.ok === true,
    exitCode: result.status,
    signal: result.signal,
    durationMs: Date.now() - phaseStartedAt.getTime(),
    result: parsed,
    error: result.error?.message ?? bounded(result.stderr) ?? (parsed?.ok === false ? 'phase-reported-failure' : null),
  };
}

function parseJsonOutput(stdout) {
  const text = String(stdout ?? '').trim();
  if (!text) return null;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Human-readable output may precede a final JSON line.
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readArg(prefix) {
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function normalizeLimit(value, fallback, max, min = 1) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function bounded(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, 1000) : null;
}
