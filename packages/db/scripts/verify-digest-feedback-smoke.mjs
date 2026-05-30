import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDir, '../../../.env');
const rootDir = resolve(scriptDir, '../../..');

loadEnvFile(rootEnvPath);

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Add it to your environment or .env file, then run `node packages/db/scripts/verify-digest-feedback-smoke.mjs` again.');
  process.exit(1);
}

const { updateDigestOrgStateFeedback } = await import(
  pathToFileURL(resolve(rootDir, 'apps/web/lib/digestFeedback.ts')).href
);

const client = new Client({ connectionString: databaseUrl });

try {
  await client.connect();
  await client.query('BEGIN');

  const fixture = await setupFixture(client);

  const acceptedState = await updateDigestOrgStateFeedback({
    clientProfileId: fixture.clientProfileId,
    digestCandidateId: fixture.acceptedCandidateId,
    action: 'accepted',
    note: 'Strong fit, keep out of future digests'
  }, client);

  assert.equal(acceptedState.feedbackStatus, 'contacted');
  assert.equal(acceptedState.lastDigestCandidateId, String(fixture.acceptedCandidateId));
  assert.equal(acceptedState.orgId, String(fixture.acceptedOrgId));
  assert.equal(acceptedState.feedbackNote, 'Strong fit, keep out of future digests');
  assert.equal(acceptedState.suppressedUntil, 'infinity');

  const snoozedState = await updateDigestOrgStateFeedback({
    clientProfileId: fixture.clientProfileId,
    orgId: fixture.snoozedOrgId,
    action: 'snooze',
    note: 'Retry later',
    snoozeDays: 14
  }, client);

  assert.equal(snoozedState.feedbackStatus, 'snooze');
  assert.equal(snoozedState.feedbackNote, 'Retry later');
  assert.ok(snoozedState.suppressedUntil, 'snooze should set suppressed_until');

  const stateRows = await client.query(`
    SELECT
      org_id::BIGINT AS org_id,
      feedback_status::TEXT AS feedback_status,
      feedback_note,
      suppressed_until,
      last_digest_candidate_id::BIGINT AS last_digest_candidate_id
    FROM client_digest_org_state
    WHERE client_profile_id = $1
    ORDER BY org_id ASC
  `, [fixture.clientProfileId]);

  assert.equal(stateRows.rowCount, 2, 'expected two client_digest_org_state rows');

  const digestVisibility = await client.query(`
    SELECT org_id::BIGINT AS org_id
    FROM client_digest_org_state
    WHERE client_profile_id = $1
      AND (
        COALESCE(suppressed_until, '-infinity'::timestamptz) <= NOW()
        AND COALESCE(cooldown_until, '-infinity'::timestamptz) <= NOW()
        AND COALESCE(feedback_status, 'none') NOT IN ('contacted', 'replied', 'won', 'badfit', 'dismissed')
      )
  `, [fixture.clientProfileId]);

  assert.deepEqual(digestVisibility.rows, [], 'accepted/snoozed orgs should stay out of the next digest window');

  console.log('digest feedback smoke passed');
} catch (error) {
  try {
    await client.query('ROLLBACK');
  } catch {}

  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Digest feedback smoke failed: ${message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}

async function setupFixture(client) {
  const clientProfileResult = await client.query(`
    INSERT INTO client_profiles (agency_name, daily_digest_limit)
    VALUES ($1, 5)
    RETURNING id
  `, [`Digest feedback smoke ${Date.now()}`]);

  const acceptedOrgResult = await client.query(`
    INSERT INTO orgs (name)
    VALUES ('Accepted Fixture Org')
    RETURNING id
  `);
  const snoozedOrgResult = await client.query(`
    INSERT INTO orgs (name)
    VALUES ('Snoozed Fixture Org')
    RETURNING id
  `);

  const acceptedRunResult = await client.query(`
    INSERT INTO digest_runs (client_profile_id, source_key, status, requested_limit, selected_count, cooldown_days, completed_at)
    VALUES ($1, 'smoke', 'completed', 1, 1, 3, NOW())
    RETURNING id
  `, [clientProfileResult.rows[0].id]);

  const acceptedCandidateResult = await client.query(`
    INSERT INTO digest_candidates (
      digest_run_id,
      client_profile_id,
      org_id,
      source_external_id,
      source_display_name,
      source_families,
      vacancies_count,
      distinct_vacancy_names_count,
      latest_published_at,
      total_score,
      reasons,
      opener,
      payload
    )
    VALUES (
      $1,
      $2,
      $3,
      'accept-1',
      'Accepted Fixture Org',
      '["hh"]'::jsonb,
      2,
      2,
      NOW(),
      80,
      '["reason-1", "reason-2"]'::jsonb,
      'Fixture opener',
      '{}'::jsonb
    )
    RETURNING id
  `, [acceptedRunResult.rows[0].id, clientProfileResult.rows[0].id, acceptedOrgResult.rows[0].id]);

  return {
    clientProfileId: clientProfileResult.rows[0].id,
    acceptedOrgId: acceptedOrgResult.rows[0].id,
    snoozedOrgId: snoozedOrgResult.rows[0].id,
    acceptedCandidateId: acceptedCandidateResult.rows[0].id
  };
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

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}
