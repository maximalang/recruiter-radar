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
  console.error('DATABASE_URL is not set. Add it to your environment or .env file, then run `node packages/db/scripts/verify-digest-selection-smoke.mjs` again.');
  process.exit(1);
}

const fixture = createFixture();
const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
let cleanupIds = null;

try {
  await client.connect();
  cleanupIds = await setupFixture(client, fixture);

  const defaultRows = await fetchDigestRows(client, 'default', 50);
  const defaultFixtureRows = defaultRows.filter((row) =>
    [fixture.cityMatchName, fixture.cityMissName].includes(row.source_display_name)
  );
  const defaultItems = rerankForClient(defaultFixtureRows, {
    targetCity: 'Москва',
    specialization: 'recruiter',
  });
  assert.equal(defaultItems.length, 2, 'default digest should include both fixture orgs');
  assert.equal(defaultItems[0].source_display_name, fixture.cityMatchName, 'scoped org should rerank first');

  const careerPageRows = await fetchDigestRows(client, 'career-pages', 10);
  assert.deepEqual(careerPageRows.map((row) => row.source_display_name), [fixture.cityMatchName]);

  const domainRows = await fetchDigestRows(client, `domain:${fixture.cityMissDomain}`, 10);
  assert.deepEqual(domainRows.map((row) => row.source_display_name), [fixture.cityMissName]);

  console.log(JSON.stringify({
    ok: true,
    smoke: 'digest-selection',
    verified: {
      scopedBoostWinner: defaultItems[0].source_display_name,
      careerPagesSelection: careerPageRows.map((row) => row.source_display_name),
      domainSelection: domainRows.map((row) => row.source_display_name),
    },
  }, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Digest selection smoke failed: ${message}`);
  process.exitCode = 1;
} finally {
  if (cleanupIds) {
    await cleanupFixture(client, cleanupIds).catch(() => {});
  }
  await client.end().catch(() => {});
}

function createFixture() {
  const runId = `digest-selection-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

  return {
    agencyName: `Digest Selection ${runId}`,
    cityMatchName: `Scoped Match ${runId}`,
    cityMissName: `Unscoped Match ${runId}`,
    cityMatchDomain: `${runId}-match.example`,
    cityMissDomain: `${runId}-miss.example`,
  };
}

async function fetchDigestRows(client, sourceKey, limit) {
  const result = await client.query(
    `
      WITH ranked_candidates AS (
        ${digestEvidenceQuery}
      )
      SELECT
        ranked_candidates.rank,
        ranked_candidates.source_display_name,
        ranked_candidates.source_families,
        ranked_candidates.evidence_titles,
        ranked_candidates.location_names,
        ranked_candidates.total_score
      FROM ranked_candidates
      WHERE (
        $1 = 'default'
        OR $1 = ANY(ranked_candidates.source_families)
        OR $1 = ANY(COALESCE(ranked_candidates.candidate_source_keys, ARRAY[]::text[]))
      )
      ORDER BY ranked_candidates.rank ASC
      LIMIT $2
    `,
    [sourceKey, limit],
  );

  return result.rows;
}

function rerankForClient(rows, clientProfile) {
  return [...rows].sort((left, right) => {
    const leftScopeScore = getClientScopeScore(left, clientProfile);
    const rightScopeScore = getClientScopeScore(right, clientProfile);

    if (leftScopeScore !== rightScopeScore) {
      return rightScopeScore - leftScopeScore;
    }

    if (left.total_score !== right.total_score) {
      return right.total_score - left.total_score;
    }

    return left.rank - right.rank;
  });
}

function getClientScopeScore(item, clientProfile) {
  return (
    getScopedFieldScore(clientProfile.targetCity, item.location_names, { exactMatch: 5, phraseMatch: 3, tokenMatch: 1 }) +
    getScopedFieldScore(clientProfile.specialization, item.evidence_titles, { exactMatch: 5, phraseMatch: 3, tokenMatch: 1 })
  );
}

function getScopedFieldScore(value, fields, weights) {
  const normalizedValue = normalizeSearchText(value ?? '');

  if (!normalizedValue || !Array.isArray(fields) || fields.length === 0) {
    return 0;
  }

  const normalizedFields = fields
    .map((field) => normalizeSearchText(String(field)))
    .filter((field) => field.length > 0);

  if (normalizedFields.some((field) => field === normalizedValue)) {
    return weights.exactMatch;
  }

  if (normalizedFields.some((field) => field.includes(normalizedValue) || normalizedValue.includes(field))) {
    return weights.phraseMatch;
  }

  const tokens = Array.from(new Set(normalizedValue.split(' ').filter((token) => token.length >= 3)));
  return tokens.filter((token) => normalizedFields.some((field) => field.includes(token))).length * weights.tokenMatch;
}

function normalizeSearchText(value) {
  return value
    .toLocaleLowerCase('ru-RU')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function setupFixture(client, fixture) {
  await assertRequiredTablesExist(client);
  await client.query('BEGIN');

  try {
    const clientProfileResult = await client.query(
      `
        INSERT INTO client_profiles (agency_name, target_city, specialization, daily_digest_limit)
        VALUES ($1, 'Москва', 'recruiter', 5)
        RETURNING id
      `,
      [fixture.agencyName],
    );

    const orgResult = await client.query(
      `
        INSERT INTO orgs (name, domain, website_url)
        VALUES
          ($1, $2, $3),
          ($4, $5, $6)
        RETURNING id, name
      `,
      [
        fixture.cityMatchName,
        fixture.cityMatchDomain,
        `https://${fixture.cityMatchDomain}/`,
        fixture.cityMissName,
        fixture.cityMissDomain,
        `https://${fixture.cityMissDomain}/`,
      ],
    );

    const matchOrgId = orgResult.rows.find((row) => row.name === fixture.cityMatchName).id;
    const missOrgId = orgResult.rows.find((row) => row.name === fixture.cityMissName).id;

    await client.query(
      `
        INSERT INTO org_source_refs (org_id, source, source_key, external_id, display_name, metadata)
        VALUES
          ($1, 'career-pages', $2, 'career-match', $3, '{}'::jsonb),
          ($4, 'hh', $5, 'hh-miss', $6, '{}'::jsonb)
      `,
      [
        matchOrgId,
        `domain:${fixture.cityMatchDomain}`,
        fixture.cityMatchName,
        missOrgId,
        `domain:${fixture.cityMissDomain}`,
        fixture.cityMissName,
      ],
    );

    await client.query(
      `
        INSERT INTO signals (org_id, signal_type, source, external_id, headline, source_url, occurred_at, payload)
        VALUES
          (
            $1,
            'job_posting',
            'career-pages',
            'career-match-signal',
            'Senior Recruiter',
            $2,
            NOW() - interval '1 day',
            $3::jsonb
          ),
          (
            $4,
            'job_posting',
            'hh',
            'hh-miss-signal',
            'Senior Recruiter',
            $5,
            NOW() - interval '1 day',
            $6::jsonb
          )
      `,
      [
        matchOrgId,
        `https://${fixture.cityMatchDomain}/careers/recruiter`,
        JSON.stringify({
          source_entity_external_id: 'career-match',
          source_entity_display_name: fixture.cityMatchName,
          source_entity_key: `domain:${fixture.cityMatchDomain}`,
          company_domain: fixture.cityMatchDomain,
          location: 'Москва',
        }),
        missOrgId,
        `https://${fixture.cityMissDomain}/jobs/recruiter`,
        JSON.stringify({
          hh_employer_id: 'hh-miss',
          employer_name: fixture.cityMissName,
          company_domain: fixture.cityMissDomain,
          area_name: 'Санкт-Петербург',
        }),
      ],
    );

    await client.query('COMMIT');

    return {
      clientProfileId: clientProfileResult.rows[0].id,
      orgIds: [matchOrgId, missOrgId],
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function cleanupFixture(client, ids) {
  await client.query('BEGIN');
  try {
    await client.query(`DELETE FROM signals WHERE org_id = ANY($1::bigint[])`, [ids.orgIds]);
    await client.query(`DELETE FROM org_source_refs WHERE org_id = ANY($1::bigint[])`, [ids.orgIds]);
    await client.query(`DELETE FROM orgs WHERE id = ANY($1::bigint[])`, [ids.orgIds]);
    await client.query(`DELETE FROM client_profiles WHERE id = $1`, [ids.clientProfileId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function assertRequiredTablesExist(client) {
  const result = await client.query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1)
    `,
    [['client_profiles', 'orgs', 'org_source_refs', 'signals']],
  );
  const existingTables = new Set(result.rows.map((row) => row.table_name));
  const missingTables = ['client_profiles', 'orgs', 'org_source_refs', 'signals'].filter((tableName) => !existingTables.has(tableName));
  assert.equal(missingTables.length, 0, `Missing required public tables for digest selection verify: ${missingTables.join(', ')}`);
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
