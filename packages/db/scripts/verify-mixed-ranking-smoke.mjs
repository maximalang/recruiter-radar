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
    'DATABASE_URL is not set. Add it to your environment or .env file, then run `node packages/db/scripts/verify-mixed-ranking-smoke.mjs` again.',
  );
  process.exit(1);
}

const client = new Client({ connectionString: databaseUrl });

try {
  await client.connect();
  await client.query('BEGIN');
  await setupFixture(client);

  const result = await client.query(`${digestEvidenceQuery}\nLIMIT 5`);
  const rows = result.rows;

  assert.equal(rows.length, 3, 'expected three ranked rows from the smoke fixture');
  assert.equal(rows[0].source_external_id, 'career-1', 'career-pages row should rank first');
  assert.deepEqual(rows[0].source_families, ['career-pages']);
  assert.equal(rows[1].source_external_id, 'hh-1', 'hh direct row should rank second');
  assert.deepEqual(rows[1].source_families, ['hh']);
  assert.equal(rows[2].source_external_id, 'hh-agg-1', 'aggregated hh row should rank after direct proofs');
  assert.deepEqual(rows[2].source_families, ['hh']);
  assert.ok(rows[0].total_score > rows[1].total_score, 'career-pages direct proof should outrank older hh direct proof');
  assert.ok(rows[1].total_score > rows[2].total_score, 'direct hh proof should outrank hh aggregation');

  console.log('mixed ranking smoke passed');
  console.table(
    rows.map((row) => ({
      rank: row.rank,
      source_external_id: row.source_external_id,
      source_families: Array.isArray(row.source_families) ? row.source_families.join(', ') : '',
      quality_code: row.quality_code,
      total_score: row.total_score,
    })),
  );

  await client.query('ROLLBACK');
} catch (error) {
  try {
    await client.query('ROLLBACK');
  } catch {}

  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Mixed ranking smoke failed: ${message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}

async function setupFixture(client) {
  await client.query(`
    CREATE TEMP TABLE orgs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
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
      headline TEXT,
      occurred_at TIMESTAMPTZ,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb
    ) ON COMMIT DROP;
  `);

  await client.query(`
    INSERT INTO orgs (id, name)
    VALUES
      ('org-hh-direct', 'HH Direct Co'),
      ('org-career-direct', 'Career Direct Co'),
      ('org-hh-agg', 'HH Aggregated Co');

    INSERT INTO org_source_refs (org_id, source, external_id, display_name, source_key, metadata)
    VALUES (
      'org-hh-agg',
      'hh',
      'hh-agg-1',
      'HH Aggregated Co',
      'domain:agg.example',
      '{"source_alias_keys": ["domain:agg.example"]}'::jsonb
    );

    INSERT INTO signals (org_id, source, signal_type, headline, occurred_at, payload)
    VALUES
      (
        'org-hh-direct',
        'hh',
        'job_posting',
        'Senior Recruiter',
        NOW() - interval '5 days',
        '{"hh_employer_id": "hh-1", "employer_name": "HH Direct Co"}'::jsonb
      ),
      (
        'org-hh-direct',
        'hh',
        'job_posting',
        'Talent Partner',
        NOW() - interval '5 days',
        '{"hh_employer_id": "hh-1", "employer_name": "HH Direct Co"}'::jsonb
      ),
      (
        'org-career-direct',
        'career-pages',
        'job_posting',
        'People Ops Lead',
        NOW() - interval '1 day',
        '{"source_entity_external_id": "career-1", "source_entity_display_name": "Career Direct Co"}'::jsonb
      ),
      (
        'org-hh-agg',
        'hh',
        'job_posting',
        'Recruiting Coordinator',
        NOW() - interval '1 day',
        '{"company_domain": "agg.example", "company_name": "HH Aggregated Co"}'::jsonb
      );
  `);
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const envFile = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');

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
