import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';

const flags = new Set(process.argv.slice(2));

const sourceScripts = [
  'ingest-hh.mjs',
  'source-superjob.mjs',
  'source-habr-career.mjs',
  'source-linkedin-company-pages.mjs',
  'source-career-pages.mjs',
  'source-greenhouse.mjs',
  'source-lever.mjs',
  'source-ashby.mjs',
  'source-recruitee.mjs',
  'source-workable.mjs',
  'source-smartrecruiters.mjs',
  'source-egrul-fns.mjs',
  'source-rabota-rossii.mjs',
  'source-company-site.mjs',
  'source-funding-business-signals.mjs',
  'source-fedresurs.mjs',
  'source-transparent-business-fns.mjs',
  'source-company-newsrooms.mjs',
  'source-industry-media.mjs',
  'source-github-company-org.mjs',
  'source-youtube-company-channels.mjs',
  'source-telegram-company-channels.mjs',
  'source-fns-open-data.mjs',
  'source-government-procurement.mjs',
  'source-cbr-registry.mjs',
  'source-rosstat-open-data.mjs',
  'source-rospatent-open-data.mjs',
];

const runtimeSupportScripts = [
  'source-career-pages-runtime.mjs',
  'derive-source-temporal-intelligence.mjs',
];

const governmentSyncScripts = [
  'sync-fns-open-data-snapshot.mjs',
  'sync-government-procurement-snapshot.mjs',
  'sync-rosstat-open-data-snapshot.mjs',
  'sync-rospatent-open-data-snapshot.mjs',
];

const requiredMigrationFiles = [
  '20260814040000_add_canonical_vacancy_lifecycle.sql',
  '20260814050000_add_source_scheduler_state.sql',
  '20260814060000_add_source_target_run_scope.sql',
  '20260814070000_add_daily_radar_run_lease.sql',
];

async function verifyFilesystem() {
  const requiredPaths = [
    ...sourceScripts.map((name) => `packages/db/scripts/${name}`),
    ...runtimeSupportScripts.map((name) => `packages/db/scripts/${name}`),
    ...governmentSyncScripts.map((name) => `packages/db/scripts/${name}`),
    ...requiredMigrationFiles.map((name) => `packages/db/migrations/${name}`),
    '/etc/ssl/certs/ca-certificates.crt',
    '/etc/ssl/certs/russian-trusted-ca-bundle.pem',
  ];
  await Promise.all(requiredPaths.map((path) => access(resolve(path), constants.R_OK)));

  await import('teleproto');
  await import('pg');
  await import('playwright');

  const stateRoot = process.env.SOURCE_RUNTIME_STATE_ROOT?.trim();
  if (!stateRoot) throw new Error('SOURCE_RUNTIME_STATE_ROOT is required in the final image.');
  await mkdir(stateRoot, { recursive: true });
  const probe = resolve(stateRoot, `.write-probe-${process.pid}`);
  await writeFile(probe, 'source-runtime-image\n', { flag: 'wx' });
  await rm(probe);

  const snapshotRoot = process.env.SOURCE_SNAPSHOT_ROOT?.trim();
  if (snapshotRoot) await access(resolve(snapshotRoot), constants.R_OK | constants.W_OK);

  console.log(JSON.stringify({
    check: 'filesystem',
    sources: sourceScripts.length,
    runtimeSupportScripts: runtimeSupportScripts.length,
    status: 'passed',
  }));
}

async function verifyBrowser() {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (!executablePath) throw new Error('PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH is required.');
  await access(executablePath, constants.X_OK);
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent('<main data-source-runtime="ready">ready</main>');
    if (await page.locator('main').getAttribute('data-source-runtime') !== 'ready') {
      throw new Error('Chromium page smoke did not produce the expected DOM.');
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ check: 'browser', executablePath, status: 'passed' }));
}

async function verifyDatabase() {
  if (!process.env.DATABASE_URL?.trim()) throw new Error('DATABASE_URL is required.');
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const requiredTables = [
    'source_run_observations',
    'source_health_state',
    'source_scheduler_state',
    'source_temporal_observations',
    'source_temporal_derived_events',
    'canonical_vacancies_v1',
    'canonical_vacancy_publications_v1',
    'canonical_vacancy_observations_v1',
    'canonical_vacancy_events_v1',
    'daily_radar_run_state',
  ];
  const requiredColumns = new Map([
    ['source_run_observations', [
      'scope',
      'execution_source_id',
      'organization_id',
      'target_key',
      'target_outcome',
    ]],
    ['canonical_vacancy_publications_v1', ['source_target_key']],
  ]);
  try {
    const result = await pool.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::TEXT[])`,
      [requiredTables],
    );
    const present = new Set(result.rows.map((row) => row.table_name));
    const missing = requiredTables.filter((table) => !present.has(table));
    if (missing.length > 0) throw new Error(`Source runtime tables are missing: ${missing.join(', ')}`);

    for (const [table, columns] of requiredColumns) {
      const columnResult = await pool.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = $1
           AND column_name = ANY($2::TEXT[])`,
        [table, columns],
      );
      const presentColumns = new Set(columnResult.rows.map((row) => row.column_name));
      const missingColumns = columns.filter((column) => !presentColumns.has(column));
      if (missingColumns.length > 0) {
        throw new Error(`Source runtime columns are missing from ${table}: ${missingColumns.join(', ')}`);
      }
    }
  } finally {
    await pool.end();
  }
  console.log(JSON.stringify({
    check: 'database',
    tables: requiredTables.length,
    targetScopeColumns: [...requiredColumns.values()].flat().length,
    status: 'passed',
  }));
}

if (flags.size === 0 || ![...flags].every((flag) => ['--filesystem', '--browser', '--database'].includes(flag))) {
  throw new Error('Usage: verify-source-runtime-image.mjs <--filesystem|--browser|--database> [...]');
}
if (flags.has('--filesystem')) await verifyFilesystem();
if (flags.has('--browser')) await verifyBrowser();
if (flags.has('--database')) await verifyDatabase();