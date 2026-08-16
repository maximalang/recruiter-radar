import assert from 'node:assert/strict';
import pg from 'pg';

import { createStandardSourceRuntime } from './adapters/rf-source-runtime.mjs';

const { Client } = pg;
const ACK = 'SOURCE_IDENTITY_LINEAGE_DB_TEST_ACK';
const PREFIX = 'pass-a-lineage-verify';

if (process.env[ACK] !== 'isolated') {
  throw new Error(`${ACK}=isolated is required; never run this verifier against a user database`);
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

function runtime(sourceId, externalId, sourceUrl) {
  return createStandardSourceRuntime({
    sourceId,
    signalType: 'job_posting',
    evidenceRole: 'primary_platform',
    sourceRecordType: 'vacancy',
    normalizeRecord: (raw, { fetchedAt }) => ({
      orgName: 'ООО Проверка Лайнедж',
      orgDisplayName: 'Проверка Лайнедж',
      companyName: 'ООО Проверка Лайнедж',
      companyDomain: 'lineage-verifier.example',
      companyWebsiteUrl: 'https://lineage-verifier.example',
      inn: '7707083893',
      ogrn: null,
      primarySourceKey: 'inn:7707083893',
      innSourceKey: 'inn:7707083893',
      ogrnSourceKey: null,
      domainSourceKey: 'domain:lineage-verifier.example',
      companyNameSourceKey: 'company-name:ооо проверка лайнедж',
      orgSourceKeys: ['inn:7707083893', 'domain:lineage-verifier.example'],
      orgSourceAliasKeys: [],
      orgExternalId: externalId,
      signalExternalId: externalId,
      headline: raw.headline,
      summary: 'isolated source lineage verification',
      payload: { inn: '1234567890', ogrn: '1234567890123' },
      orgMetadata: { inn: '1234567890', ogrn: '1234567890123' },
      sourceUrl,
      occurredAt: '2026-08-12T09:00:00.000Z',
      fetchedAt,
      evidenceRole: 'primary_platform',
      extractionMethod: 'isolated-db-verifier',
    }),
  });
}

function weakNameRuntime(sourceId, externalId, sourceUrl) {
  return createStandardSourceRuntime({
    sourceId,
    signalType: 'job_posting',
    evidenceRole: 'primary_platform',
    sourceRecordType: 'vacancy',
    normalizeRecord: (raw, { fetchedAt }) => ({
      orgName: 'ООО Одинаковое Имя',
      orgDisplayName: 'Одинаковое Имя',
      companyName: 'Одинаковое Имя',
      companyDomain: null,
      companyWebsiteUrl: null,
      inn: null,
      ogrn: null,
      primarySourceKey: 'company-name:одинаковое имя',
      innSourceKey: null,
      ogrnSourceKey: null,
      domainSourceKey: null,
      companyNameSourceKey: 'company-name:одинаковое имя',
      orgSourceKeys: ['company-name:одинаковое имя'],
      orgSourceAliasKeys: [],
      orgExternalId: externalId,
      signalExternalId: externalId,
      headline: raw.headline,
      summary: 'weak-name isolation verification',
      sourceUrl,
      occurredAt: '2026-08-12T09:00:00.000Z',
      fetchedAt,
      evidenceRole: 'primary_platform',
      extractionMethod: 'isolated-db-verifier',
    }),
  });
}

function partialConflictRuntime(sourceId) {
  return createStandardSourceRuntime({
    sourceId,
    signalType: 'job_posting',
    evidenceRole: 'primary_platform',
    sourceRecordType: 'vacancy',
    normalizeRecord: (raw, { fetchedAt }) => {
      const conflict = raw.kind === 'conflict';
      const domain = conflict ? 'lineage-verifier.example' : 'lineage-safe.example';
      const inn = conflict ? '7707083893' : null;
      return {
        orgName: conflict ? 'Conflict candidate' : 'Safe candidate',
        orgDisplayName: conflict ? 'Conflict candidate' : 'Safe candidate',
        companyName: conflict ? 'Conflict candidate' : 'Safe candidate',
        companyDomain: domain,
        companyWebsiteUrl: `https://${domain}`,
        inn,
        ogrn: null,
        primarySourceKey: inn ? `inn:${inn}` : `domain:${domain}`,
        innSourceKey: inn ? `inn:${inn}` : null,
        ogrnSourceKey: null,
        domainSourceKey: `domain:${domain}`,
        companyNameSourceKey: null,
        orgSourceKeys: inn ? [`inn:${inn}`, `domain:${domain}`] : [`domain:${domain}`],
        orgSourceAliasKeys: [],
        orgExternalId: raw.id,
        signalExternalId: raw.id,
        headline: raw.id,
        summary: 'partial conflict isolation verification',
        sourceUrl: `https://${domain}/${raw.id}`,
        occurredAt: '2026-08-12T09:00:00.000Z',
        fetchedAt,
        evidenceRole: 'primary_platform',
        extractionMethod: 'isolated-db-verifier',
      };
    },
  });
}

function canonicalConflictRuntime(sourceId) {
  return createStandardSourceRuntime({
    sourceId,
    signalType: 'job_posting',
    evidenceRole: 'primary_platform',
    sourceRecordType: 'vacancy',
    normalizeRecord: (raw, { fetchedAt }) => {
      const strongInn = raw.invalidKey ? '1234567890' : '9102013580';
      return {
        orgName: 'Canonical conflict candidate',
        orgDisplayName: 'Canonical conflict candidate',
        companyName: 'Canonical conflict candidate',
        companyDomain: 'lineage-verifier.example',
        companyWebsiteUrl: 'https://lineage-verifier.example',
        inn: raw.omitInn || raw.invalidKey ? null : strongInn,
        ogrn: null,
        primarySourceKey: `inn:${strongInn}`,
        innSourceKey: `inn:${strongInn}`,
        ogrnSourceKey: null,
        domainSourceKey: 'domain:lineage-verifier.example',
        companyNameSourceKey: null,
        orgSourceKeys: [`inn:${strongInn}`, 'domain:lineage-verifier.example'],
        orgSourceAliasKeys: [],
        orgExternalId: raw.id,
        signalExternalId: raw.id,
        headline: raw.id,
        summary: 'canonical conflict isolation verification',
        sourceUrl: `https://lineage-verifier.example/${raw.id}`,
        occurredAt: '2026-08-12T09:00:00.000Z',
        fetchedAt,
        evidenceRole: 'primary_platform',
        extractionMethod: 'isolated-db-verifier',
      };
    },
  });
}

async function ingest(sourceId, externalId, sourceUrl) {
  const adapter = runtime(sourceId, externalId, sourceUrl);
  const input = adapter.buildInputFromRecords({
    inputMode: 'isolated-db-verifier',
    inputFilePath: null,
    records: [{ headline: externalId }],
  });
  return adapter.ingest({ connectionString: process.env.DATABASE_URL, input });
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const dirty = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM source_signal_evidence_lineage_v1
     WHERE source LIKE $1`,
    [`${PREFIX}%`],
  );
  assert.equal(dirty.rows[0].count, 0, 'verifier requires a fresh isolated database');

  const first = await ingest(`${PREFIX}-one`, 'vacancy-1', 'https://source-one.example/vacancy-1');
  const second = await ingest(`${PREFIX}-two`, 'vacancy-2', 'https://source-two.example/vacancy-2');
  const replay = await ingest(`${PREFIX}-one`, 'vacancy-1', 'https://source-one.example/vacancy-1');

  assert.equal(first.evidenceCreatedCount, 1);
  assert.equal(second.orgUpsertCount, 0, 'validated INN/domain must reuse the cross-source organization');
  assert.equal(replay.evidenceCreatedCount, 0, 'replay must not duplicate evidence');
  assert.equal(replay.lineageCreatedCount, 0, 'replay must not duplicate lineage');

  const persistedLegalIdentity = await client.query(
    `SELECT orgs.inn, orgs.ogrn, org_source_refs.metadata
     FROM orgs
     JOIN org_source_refs ON org_source_refs.org_id = orgs.id
     WHERE org_source_refs.source = $1
     LIMIT 1`,
    [`${PREFIX}-one`],
  );
  assert.equal(persistedLegalIdentity.rows[0].inn, '7707083893', 'validated INN must cross the canonical org persistence boundary');
  assert.equal(persistedLegalIdentity.rows[0].metadata.inn, '7707083893', 'custom metadata must not override canonical INN');
  assert.equal(persistedLegalIdentity.rows[0].metadata.ogrn, null, 'custom metadata must not inject OGRN');
  const persistedSignalIdentity = await client.query(
    `SELECT payload->>'inn' AS inn, payload->>'ogrn' AS ogrn
     FROM signals
     WHERE source = $1
     LIMIT 1`,
    [`${PREFIX}-one`],
  );
  assert.equal(persistedSignalIdentity.rows[0].inn, '7707083893', 'custom payload must not override canonical INN');
  assert.equal(persistedSignalIdentity.rows[0].ogrn, null, 'custom payload must not inject OGRN');

  const counts = await client.query(
    `SELECT
       COUNT(DISTINCT organization_id)::int AS organizations,
       COUNT(DISTINCT signal_id)::int AS signals,
       COUNT(DISTINCT evidence_id)::int AS evidence,
       COUNT(*)::int AS lineage,
       ARRAY_AGG(DISTINCT evidence_tier ORDER BY evidence_tier) AS tiers
     FROM source_signal_evidence_lineage_v1
     WHERE source LIKE $1`,
    [`${PREFIX}%`],
  );
  assert.deepEqual(counts.rows[0], {
    organizations: 1,
    signals: 2,
    evidence: 2,
    lineage: 2,
    tiers: ['corroboration'],
  });

  await assert.rejects(
    client.query(
      `UPDATE source_signal_evidence_lineage_v1
       SET source = 'tampered'
       WHERE source = $1`,
      [`${PREFIX}-one`],
    ),
    /append-only/,
  );

  const weakSources = [`${PREFIX}-weak-one`, `${PREFIX}-weak-two`];
  for (const [index, sourceId] of weakSources.entries()) {
    const adapter = weakNameRuntime(
      sourceId,
      `weak-vacancy-${index + 1}`,
      `https://weak-source-${index + 1}.example/vacancy`,
    );
    const input = adapter.buildInputFromRecords({
      inputMode: 'isolated-db-verifier',
      inputFilePath: null,
      records: [{ headline: `weak-vacancy-${index + 1}` }],
    });
    const result = await adapter.ingest({ connectionString: process.env.DATABASE_URL, input });
    assert.equal(result.orgUpsertCount, 1, 'company name alone must not merge organizations across sources');
  }
  const weakOwners = await client.query(
    `SELECT COUNT(DISTINCT org_id)::int AS count
     FROM org_source_refs
     WHERE source = ANY($1::text[])`,
    [weakSources],
  );
  assert.equal(weakOwners.rows[0].count, 2, 'weak company names must remain source-local');

  const conflictingOrg = await client.query(
    `INSERT INTO orgs (name) VALUES ('Conflicting legacy owner') RETURNING id`,
  );
  await client.query(
    `INSERT INTO org_source_refs (org_id, source, source_key, display_name, metadata)
     VALUES ($1, $2, 'inn:7707083893', 'Conflicting legacy owner', '{}'::jsonb)`,
    [conflictingOrg.rows[0].id, `${PREFIX}-legacy-conflict`],
  );
  await assert.rejects(
    ingest(`${PREFIX}-three`, 'vacancy-3', 'https://source-three.example/vacancy-3'),
    /organization identity conflict/,
  );

  const partialAdapter = partialConflictRuntime(`${PREFIX}-partial`);
  const partialInput = partialAdapter.buildInputFromRecords({
    inputMode: 'isolated-db-verifier',
    inputFilePath: null,
    records: [
      { id: 'partial-conflict', kind: 'conflict' },
      { id: 'partial-safe', kind: 'safe' },
    ],
  });
  const partial = await partialAdapter.ingest({
    connectionString: process.env.DATABASE_URL,
    input: partialInput,
  });
  assert.equal(partial.organizationResolutionRejects, 1);
  assert.equal(partial.signalUpsertCount, 1);

  const canonicalConflict = canonicalConflictRuntime(`${PREFIX}-canonical-conflict`);
  const canonicalConflictResult = await canonicalConflict.ingest({
    connectionString: process.env.DATABASE_URL,
    input: canonicalConflict.buildInputFromRecords({
      inputMode: 'isolated-db-verifier',
      inputFilePath: null,
      records: [{ id: 'canonical-conflict' }],
    }),
  });
  assert.equal(canonicalConflictResult.organizationResolutionRejects, 1);
  const keyOnlyCanonicalConflict = canonicalConflictRuntime(`${PREFIX}-canonical-key-only-conflict`);
  const keyOnlyCanonicalConflictResult = await keyOnlyCanonicalConflict.ingest({
    connectionString: process.env.DATABASE_URL,
    input: keyOnlyCanonicalConflict.buildInputFromRecords({
      inputMode: 'isolated-db-verifier',
      inputFilePath: null,
      records: [{ id: 'canonical-key-only-conflict', omitInn: true }],
    }),
  });
  assert.equal(keyOnlyCanonicalConflictResult.organizationResolutionRejects, 1);
  const invalidKeyConflict = canonicalConflictRuntime(`${PREFIX}-invalid-legal-key`);
  const invalidKeyConflictResult = await invalidKeyConflict.ingest({
    connectionString: process.env.DATABASE_URL,
    input: invalidKeyConflict.buildInputFromRecords({
      inputMode: 'isolated-db-verifier',
      inputFilePath: null,
      records: [{ id: 'invalid-legal-key', invalidKey: true }],
    }),
  });
  assert.equal(invalidKeyConflictResult.organizationResolutionRejects, 1);
  const poisonedStrongRef = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM org_source_refs
     WHERE source = ANY($1::text[])`,
    [[`${PREFIX}-canonical-conflict`, `${PREFIX}-canonical-key-only-conflict`, `${PREFIX}-invalid-legal-key`]],
  );
  assert.equal(poisonedStrongRef.rows[0].count, 0, 'rejected canonical identifiers must not persist source refs');

  console.log(JSON.stringify({
    event: 'source_identity_lineage.verified',
    ...counts.rows[0],
    replayEvidenceCreated: replay.evidenceCreatedCount,
    replayLineageCreated: replay.lineageCreatedCount,
    weakNameOwners: weakOwners.rows[0].count,
    legalIdentityPersisted: persistedLegalIdentity.rows[0].inn === '7707083893',
    rejectedCanonicalRefs: poisonedStrongRef.rows[0].count,
    partialConflictRejects: partial.organizationResolutionRejects,
    conflictMode: 'fail-closed',
  }));
} finally {
  await client.end();
}
