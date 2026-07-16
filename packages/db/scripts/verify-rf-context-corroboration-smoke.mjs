// Smoke test for РФ context-source corroboration of job_posting leads.
//
// Proves the core gate-lift behavior added to source-digest-evidence.sql:
//   1. Gate C → B lift: a single-source HH lead (gate C) corroborated by a
//      funding-business-signals record that shares the same INN merges under
//      one corroboration_key → source_families grows to 2 → gate lifts to B.
//      The context source must NOT inflate vacancies_count / evidence_titles
//      / latest_published_at (those stay job_posting-only).
//   2. Gate D preserved: an org with ONLY a funding (context) signal and NO
//      job_posting signal never surfaces as a lead (enrichment_context is
//      dropped by the scored CTE). Context never originates a lead.
//   3. Context headline never leaks into evidence_titles: a funding-round
//      headline must not appear as a "vacancy" title.
//
// Uses TEMP tables inside a transaction (like verify-mixed-ranking-smoke.mjs),
// so it needs a live DATABASE_URL but leaves no persistent state.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDir, '../../../.env');
const digestEvidenceQuery = readFileSync(resolve(scriptDir, './source-digest-evidence.sql'), 'utf8');

loadEnvFile(rootEnvPath);

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  console.error(
    'DATABASE_URL is not set. Add it to your environment or .env file, then run `node packages/db/scripts/verify-rf-context-corroboration-smoke.mjs` again.',
  );
  process.exit(1);
}

const SHARED_INN = '7701234567'; // 10-digit legal entity INN shared by both fragments

const client = new Client({ connectionString: databaseUrl });

try {
  await client.connect();
  await client.query('BEGIN');
  await setupFixture(client);

  const result = await client.query(`${digestEvidenceQuery}\nLIMIT 50`);
  const rows = result.rows;

  // The context-only org (funding only, no job_posting) must NOT appear as a lead.
  const contextOnlyName = 'Context Only Co';
  assert.ok(
    !rows.some((row) => row.source_display_name === contextOnlyName),
    'a context-only org (funding signal, no job_posting) must never surface as a lead (Gate D)',
  );

  // The corroborated HH org: was a single-source HH lead (gate C) before the
  // funding context shared its INN. With the context corroboration it should
  // now have 2 source families and gate B.
  const corroboratedName = 'Corroborated HH Co';
  const corroborated = rows.find((row) => row.source_display_name === corroboratedName);

  assert.ok(corroborated, 'corroborated HH org should appear as a lead');
  assert.ok(
    corroborated.source_families.includes('hh'),
    'corroborated lead keeps the HH originator family',
  );
  assert.ok(
    corroborated.source_families.includes('funding-business-signals'),
    'corroborated lead gains the funding context family (cross-source corroboration)',
  );
  assert.equal(
    corroborated.confidence_gate,
    'B',
    'single-source HH lead corroborated by a РФ context source sharing the INN should lift from gate C to gate B',
  );

  // Hiring-metric guard: the funding context must NOT inflate the vacancy
  // count or leak its event headline into the open-role titles.
  assert.equal(
    corroborated.vacancies_count,
    1,
    'funding context signal must not inflate vacancies_count (hiring metrics stay job_posting-only)',
  );
  assert.ok(
    !corroborated.evidence_titles.includes('Series B funding round'),
    'funding event headline must never appear as an open-role title in evidence_titles',
  );
  assert.ok(
    corroborated.evidence_titles.includes('Senior Recruiter'),
    'the HH originator vacancy title stays in evidence_titles',
  );

  // is_cross_source_corroborated: the corroboration merged 2 fragmented org_ids
  // (one written by HH, one by funding) under the shared INN key.
  assert.ok(
    corroborated.is_cross_source_corroborated === true,
    'corroborated lead should report is_cross_source_corroborated=true (2 org fragments merged on INN)',
  );

  console.log(JSON.stringify({
    ok: true,
    smoke: 'rf-context-corroboration',
    verified: {
      contextOnlyOrgExcluded: !rows.some((row) => row.source_display_name === contextOnlyName),
      corroboratedGate: corroborated.confidence_gate,
      corroboratedSourceFamilies: corroborated.source_families,
      corroboratedVacanciesCount: corroborated.vacancies_count,
      corroboratedEvidenceTitles: corroborated.evidence_titles,
      crossSourceCorroborated: corroborated.is_cross_source_corroborated,
    },
  }, null, 2));

  await client.query('ROLLBACK');
} catch (error) {
  try {
    await client.query('ROLLBACK');
  } catch {}

  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`RF context corroboration smoke failed: ${message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}

async function setupFixture(client) {
  await client.query(`
    CREATE TEMP TABLE orgs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      domain TEXT,
      website_url TEXT,
      career_page_url TEXT
    ) ON COMMIT DROP;

    CREATE TEMP TABLE org_source_refs (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      org_id TEXT NOT NULL,
      source TEXT NOT NULL,
      external_id TEXT,
      display_name TEXT,
      source_key TEXT,
      metadata JSONB DEFAULT '{}'::jsonb
    ) ON COMMIT DROP;

    CREATE TEMP TABLE signals (
      org_id TEXT NOT NULL,
      source TEXT NOT NULL,
      signal_type TEXT NOT NULL,
      external_id TEXT,
      headline TEXT,
      occurred_at TIMESTAMPTZ,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb
    ) ON COMMIT DROP;
  `);

  // Two HH fragments + two funding fragments, sharing an INN pairwise so the
  // corroboration_key (inn:) merges them across sources.
  await client.query(`
    INSERT INTO orgs (id, name, domain, website_url, career_page_url) VALUES
      ('org-hh-corroborated', 'Corroborated HH Co', 'corroborated.example', 'https://corroborated.example/', null),
      ('org-funding-corroborated', 'Corroborated HH Co', 'corroborated.example', 'https://corroborated.example/', null),
      ('org-funding-only', 'Context Only Co', 'contextonly.example', 'https://contextonly.example/', null);

    INSERT INTO org_source_refs (org_id, source, external_id, display_name, source_key, metadata) VALUES
      ('org-hh-corroborated', 'hh', 'hh-corrob-1', 'Corroborated HH Co', 'inn:${SHARED_INN}', '{}'::jsonb),
      ('org-funding-corroborated', 'funding-business-signals', 'fund-corrob-1', 'Corroborated HH Co', 'inn:${SHARED_INN}', '{}'::jsonb),
      ('org-funding-only', 'funding-business-signals', 'fund-only-1', 'Context Only Co', 'inn:7709999999', '{}'::jsonb);

    INSERT INTO signals (org_id, source, signal_type, external_id, headline, occurred_at, payload) VALUES
      (
        'org-hh-corroborated',
        'hh',
        'job_posting',
        'hh-corrob-signal',
        'Senior Recruiter',
        NOW() - interval '1 day',
        '{"hh_employer_id": "hh-corrob-1", "employer_name": "Corroborated HH Co"}'::jsonb
      ),
      (
        'org-funding-corroborated',
        'funding-business-signals',
        'funding',
        'fund-corrob-signal',
        'Series B funding round',
        NOW() - interval '2 days',
        '{"source_entity_external_id": "fund-corrob-1", "source_entity_display_name": "Corroborated HH Co", "event_type": "series_b"}'::jsonb
      ),
      (
        'org-funding-only',
        'funding-business-signals',
        'funding',
        'fund-only-signal',
        'Series A funding round',
        NOW() - interval '2 days',
        '{"source_entity_external_id": "fund-only-1", "source_entity_display_name": "Context Only Co", "event_type": "series_a"}'::jsonb
      );
  `);
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const envFile = readFileSync(filePath, 'utf8').replace(/^﻿/, '');

  for (const rawLine of envFile.split(/\r?\n/)) {
    const trimmedLine = rawLine.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = rawLine.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = rawLine.slice(0, separatorIndex).trim();

    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = rawLine.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}
