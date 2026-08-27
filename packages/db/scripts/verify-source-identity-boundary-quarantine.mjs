#!/usr/bin/env node

// Disposable-DB proof for the RF identity boundary hardening.
//
// The fixture deliberately inserts legacy rows while the runtime trigger is
// disabled, replays the same canonicalize/quarantine policy as migration
// 20260826100100, then proves that:
//   - invalid strong keys are preserved only as auditable quarantine rows;
//   - mixed-case prefixes cannot bypass quarantine;
//   - safe domain variants are canonicalized without duplicate keys;
//   - public-suffix and shared-hosting domains do not merge organizations;
//   - quarantined keys do not corroborate otherwise unrelated organizations;
//   - a checksum-valid shared key still merges genuine fragments.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const { Client } = pg;
const digestEvidenceQuery = readFileSync(
  resolve(import.meta.dirname, './source-digest-evidence.sql'),
  'utf8',
);
const quarantineSuffix = ' [legacy-key-quarantined:20260826100100]';

assert.equal(process.env.SOURCE_LIVE_VERIFY, '1', 'SOURCE_LIVE_VERIFY=1 is required.');
assert.equal(
  process.env.SOURCE_IDENTITY_LINEAGE_DB_TEST_ACK,
  'isolated',
  'SOURCE_IDENTITY_LINEAGE_DB_TEST_ACK=isolated is required.',
);
assert.equal(
  process.env.SOURCE_QUARANTINE_POLICY_TEST_ACK,
  'isolated',
  'SOURCE_QUARANTINE_POLICY_TEST_ACK=isolated is required.',
);
const databaseUrl = process.env.DATABASE_URL?.trim();
assert.ok(databaseUrl, 'DATABASE_URL is required.');

const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });

try {
  await client.connect();
  await client.query('BEGIN');
  const fixture = await setupFixture(client);
  await replayLegacyKeyPolicy(client);
  await verifySqlGateSemantics(client);
  await verifyReconciledKeys(client, fixture);
  const digestRows = (await client.query(`${digestEvidenceQuery}\nLIMIT 100`)).rows;
  await verifyDigestBoundary(client, fixture, digestRows);

  console.log(JSON.stringify({
    ok: true,
    smoke: 'source-identity-boundary-quarantine',
    verified: {
      quarantinedRows: 15,
      canonicalizedRows: 2,
      invalidSharedKeyDidNotMerge: true,
      multitenantDomainDidNotMerge: true,
      trustedSharedKeyMerged: true,
      platformDomainBridgeRejected: true,
      runtimeGuardRemainsActive: true,
    },
  }, null, 2));
  await client.query('ROLLBACK');
} catch (error) {
  try {
    await client.query('ROLLBACK');
  } catch {}
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Source identity boundary quarantine failed: ${message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}

async function setupFixture(client) {
  const orgs = {};
  orgs.badInnA = await insertOrg(client, 'Bad INN A');
  orgs.badInnB = await insertOrg(client, 'Bad INN B');
  orgs.caseOnly = await insertOrg(client, 'Case Only Domain');
  orgs.collision = await insertOrg(client, 'Canonical Collision Domain');
  orgs.ipLiteral = await insertOrg(client, 'IP Literal Domain');
  orgs.mixedPrefix = await insertOrg(client, 'Mixed Prefix Domain');
  orgs.capsOnly = await insertOrg(client, 'Caps Only Domain');
  orgs.platformCareer = await insertOrg(client, 'Platform Career Domain', 'careers.hh.ru');
  orgs.platformNested = await insertOrg(client, 'Platform Nested Domain', 'hh.jobs.hh.ru');
  orgs.multitenantA = await insertOrg(client, 'Multitenant Domain A');
  orgs.multitenantB = await insertOrg(client, 'Multitenant Domain B');
  orgs.trustedA = await insertOrg(client, 'Trusted Merge A');
  orgs.trustedB = await insertOrg(client, 'Trusted Merge B');

  // The runtime guard is already installed by the migrations. Legacy fixtures
  // are the only writes allowed to bypass it, and only inside this rollbacked
  // verifier transaction.
  await client.query('ALTER TABLE org_source_refs DISABLE TRIGGER rr_org_source_refs_trust_guard');
  try {
    await insertRef(client, orgs.badInnA, 'hh', 'inn:7701234567', 'bad-inn-a', 'Bad INN A');
    await insertRef(client, orgs.badInnB, 'superjob', 'inn:7701234567', 'bad-inn-b', 'Bad INN B');
    await insertRef(client, orgs.badInnA, 'gdelt', 'inn:7701234567 [legacy-key-quarantined:attacker]', 'quarantine-marker-bypass', 'Bad INN A');
    await insertRef(client, orgs.badInnA, 'gdelt', 'inn:7701234567 [legacy-key-quarantined:20260826100100]', 'quarantine-exact-marker-bypass', 'Bad INN A');
    await insertRef(client, orgs.caseOnly, 'career-pages', 'domain:WWW.CaseOnly.Example', 'case-only', 'Case Only Domain');
    await insertRef(client, orgs.collision, 'career-pages', 'domain:collision.example', 'collision-canonical', 'Canonical Collision Domain');
    await insertRef(client, orgs.collision, 'career-pages', 'domain:WWW.Collision.Example', 'collision-variant', 'Canonical Collision Domain');
    await insertRef(client, orgs.ipLiteral, 'hh', 'domain:255.255.255.255', 'ip-literal', 'IP Literal Domain');
    await insertRef(client, orgs.mixedPrefix, 'superjob', 'Domain:WS-Solo-Fixture.Example.', 'mixed-prefix', 'Mixed Prefix Domain');
    await insertRef(client, orgs.capsOnly, 'rabota-rossii', 'domain:CAPSSOLO.EXAMPLE', 'caps-only', 'Caps Only Domain');

    // Weak source aliases are permitted and prove that the domain bridge, not
    // a platform host, controls cross-source identity.
    await insertRef(client, orgs.platformCareer, 'hh', 'company-name:platform-career', 'platform-career', 'Platform Career Domain');
    await insertRef(client, orgs.platformNested, 'superjob', 'company-name:platform-nested', 'platform-nested', 'Platform Nested Domain');

    // Shared-hosting and public-suffix variants are not company-owned identity
    // boundaries. The same github.io key is deliberately used by two different
    // orgs and source families to prove that quarantine prevents a merge.
    await insertRef(client, orgs.multitenantA, 'hh', 'domain:foo.github.io', 'multitenant-github-a', 'Multitenant Domain A');
    await insertRef(client, orgs.multitenantB, 'superjob', 'domain:foo.github.io', 'multitenant-github-b', 'Multitenant Domain B');
    await insertRef(client, orgs.multitenantA, 'rabota-rossii', 'domain:bar.notion.site', 'multitenant-notion', 'Multitenant Domain A');
    await insertRef(client, orgs.multitenantA, 'public-ats', 'domain:tenant.wixsite.com', 'multitenant-wix', 'Multitenant Domain A');
    await insertRef(client, orgs.multitenantA, 'hosted-ats', 'domain:tenant.blogspot.com', 'multitenant-blogspot', 'Multitenant Domain A');
    await insertRef(client, orgs.multitenantA, 'russian-ats', 'domain:foo.co.in', 'multitenant-co-in', 'Multitenant Domain A');
    await insertRef(client, orgs.multitenantA, 'company-context', 'domain:foo.com.sg', 'multitenant-com-sg', 'Multitenant Domain A');
    await insertRef(client, orgs.multitenantA, 'government-open-data', 'domain:foo.co.za', 'multitenant-co-za', 'Multitenant Domain A');

    // One valid strong key is shared by two different source/org fragments.
    await insertRef(client, orgs.trustedA, 'rabota-rossii', 'inn:7701234507', 'trusted-a', 'Trusted Merge A');
    await insertRef(client, orgs.trustedB, 'superjob', 'inn:7701234507', 'trusted-b', 'Trusted Merge B');
  } finally {
    await client.query('ALTER TABLE org_source_refs ENABLE TRIGGER rr_org_source_refs_trust_guard');
  }

  await createSignalTables(client);
  const signalIds = {};
  signalIds.badA = await insertSignal(client, orgs.badInnA, 'hh', 'bad-inn-a', 'Bad INN A role');
  signalIds.badB = await insertSignal(client, orgs.badInnB, 'superjob', 'bad-inn-b', 'Bad INN B role');
  signalIds.caseOnly = await insertSignal(client, orgs.caseOnly, 'career-pages', 'case-only', 'Case Only role');
  signalIds.collision = await insertSignal(client, orgs.collision, 'career-pages', 'collision-canonical', 'Collision role');
  signalIds.ipLiteral = await insertSignal(client, orgs.ipLiteral, 'hh', 'ip-literal', 'IP Literal role');
  signalIds.mixedPrefix = await insertSignal(client, orgs.mixedPrefix, 'superjob', 'mixed-prefix', 'Mixed Prefix role');
  signalIds.capsOnly = await insertSignal(client, orgs.capsOnly, 'rabota-rossii', 'caps-only', 'Caps Only role');
  signalIds.platformCareer = await insertSignal(client, orgs.platformCareer, 'hh', 'platform-career', 'Platform Career role');
  signalIds.platformNested = await insertSignal(client, orgs.platformNested, 'superjob', 'platform-nested', 'Platform Nested role');
  signalIds.multitenantA = await insertSignal(client, orgs.multitenantA, 'hh', 'multitenant-github-a', 'Multitenant A role');
  signalIds.multitenantB = await insertSignal(client, orgs.multitenantB, 'superjob', 'multitenant-github-b', 'Multitenant B role');
  signalIds.trustedA = await insertSignal(client, orgs.trustedA, 'rabota-rossii', 'trusted-a', 'Trusted A role');
  signalIds.trustedB = await insertSignal(client, orgs.trustedB, 'superjob', 'trusted-b', 'Trusted B role');

  return { orgs, signalIds };
}

async function createSignalTables(client) {
  await client.query(`
    CREATE TEMP TABLE signals (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      org_id BIGINT NOT NULL,
      signal_type TEXT NOT NULL,
      source TEXT NOT NULL,
      external_id TEXT,
      headline TEXT,
      source_url TEXT,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      payload JSONB NOT NULL DEFAULT '{}'::jsonb
    ) ON COMMIT DROP;

    CREATE TEMP TABLE source_signal_evidence_lineage_v1 (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      signal_id BIGINT NOT NULL,
      evidence_id BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    ) ON COMMIT DROP;
  `);
}

async function insertOrg(client, name, domain = null) {
  const result = await client.query(
    'INSERT INTO orgs (name, domain) VALUES ($1, $2) RETURNING id',
    [name, domain],
  );
  return String(result.rows[0].id);
}

async function insertRef(client, orgId, source, sourceKey, externalId, displayName) {
  await client.query(
    `INSERT INTO org_source_refs (org_id, source, source_key, external_id, display_name, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [orgId, source, sourceKey, externalId, displayName, JSON.stringify({ fixture: 'identity-boundary' })],
  );
}

async function insertSignal(client, orgId, source, externalId, headline) {
  const result = await client.query(
    `INSERT INTO signals (org_id, signal_type, source, external_id, headline, source_url, occurred_at, payload)
     VALUES ($1, 'job_posting', $2, $3, $4, $5, NOW(), $6::jsonb)
     RETURNING id`,
    [
      orgId,
      source,
      externalId,
      headline,
      `https://example.invalid/${externalId}`,
      JSON.stringify({
        source_entity_external_id: externalId,
        candidate_eligible: 'true',
      }),
    ],
  );
  const signalId = String(result.rows[0].id);
  await client.query(
    `INSERT INTO source_signal_evidence_lineage_v1 (signal_id, evidence_id)
     VALUES ($1, $2)`,
    [signalId, signalId],
  );
  return signalId;
}

async function replayLegacyKeyPolicy(client) {
  // The migration installs the guard only after these two cleanup phases. Keep
  // the verifier's replay order identical, then re-enable the guard before
  // testing future writes.
  await client.query('ALTER TABLE org_source_refs DISABLE TRIGGER rr_org_source_refs_trust_guard');
  try {
    await client.query(`
    WITH candidates AS (
      SELECT
        ref.org_id,
        ref.ctid AS rid,
        ref.source AS src,
        'domain:' || rr_canonical_company_domain(substring(ref.source_key FROM 8)) AS target_key,
        substring(ref.source_key FROM 8)
          = rr_canonical_company_domain(substring(ref.source_key FROM 8)) AS already_canonical
      FROM org_source_refs AS ref
      WHERE ref.source_key LIKE 'domain:%'
        AND NOT (
          RIGHT(ref.source_key, LENGTH('${quarantineSuffix}')) = '${quarantineSuffix}'
          AND ref.metadata->'quarantine'->>'migration' = '20260826100100_quarantine_legacy_source_keys'
        )
        AND rr_is_trusted_domain_key(ref.source_key) = false
        AND rr_is_trusted_domain_key('domain:' || rr_canonical_company_domain(substring(ref.source_key FROM 8))) = true
        AND NOT EXISTS (
          SELECT 1
          FROM org_source_refs AS existing
          WHERE existing.source = ref.source
            AND existing.source_key = 'domain:' || rr_canonical_company_domain(substring(ref.source_key FROM 8))
        )
    ),
    winners AS (
      SELECT DISTINCT ON (c.src, c.target_key) c.rid, c.target_key
      FROM candidates AS c
      ORDER BY c.src, c.target_key, c.already_canonical DESC, c.org_id ASC
    )
    UPDATE org_source_refs AS ref
    SET source_key = winners.target_key
    FROM winners
    WHERE ref.ctid = winners.rid
  `);

  await client.query(`
    UPDATE org_source_refs AS ref
    SET source_key = ref.source_key || '${quarantineSuffix}',
        metadata = COALESCE(ref.metadata, '{}'::jsonb) || jsonb_build_object(
          'quarantine', jsonb_build_object(
            'reason', 'legacy-nonconforming-source-key',
            'migration', '20260826100100_quarantine_legacy_source_keys',
            'original_key', ref.source_key,
            'at', NOW()
          )
        )
    WHERE NOT (
        RIGHT(ref.source_key, LENGTH('${quarantineSuffix}')) = '${quarantineSuffix}'
        AND ref.metadata->'quarantine'->>'migration' = '20260826100100_quarantine_legacy_source_keys'
      )
      AND (
        (left(lower(ref.source_key), 4) = 'inn:' AND NOT rr_is_trusted_inn_key(ref.source_key))
        OR (left(lower(ref.source_key), 5) = 'ogrn:' AND NOT rr_is_trusted_ogrn_key(ref.source_key))
        OR (left(lower(ref.source_key), 7) = 'domain:' AND NOT rr_is_trusted_domain_key(ref.source_key))
      )
  `);
  } finally {
    await client.query('ALTER TABLE org_source_refs ENABLE TRIGGER rr_org_source_refs_trust_guard');
  }
}

async function verifySqlGateSemantics(client) {
  const { rows } = await client.query(`
    SELECT
      rr_is_trusted_inn_key('inn:7701234507') AS valid_inn,
      rr_is_trusted_inn_key('inn:7701234567') AS invalid_inn,
      rr_is_trusted_inn_key(NULL) AS null_inn,
      rr_is_trusted_ogrn_key('ogrn:1027700132195') AS valid_ogrn,
      rr_is_trusted_ogrn_key('ogrn:1027700132194') AS invalid_ogrn,
      rr_is_trusted_ogrn_key(NULL) AS null_ogrn,
      rr_canonical_company_domain('WWW.Example.Test') AS canonical_domain,
      rr_canonical_company_domain('9999999999.1.1.1') AS large_numeric_hostname,
      rr_is_trusted_domain_key('domain:WWW.Example.Test') AS noncanonical_domain,
      rr_is_trusted_domain_key('domain:255.255.255.255') AS ip_literal,
      rr_is_trusted_domain_key('domain:hh.ru') AS platform_domain,
      rr_is_trusted_domain_key('domain:foo.github.io') AS github_pages,
      rr_is_trusted_domain_key('domain:bar.notion.site') AS notion_site,
      rr_is_trusted_domain_key('domain:tenant.wixsite.com') AS wixsite,
      rr_is_trusted_domain_key('domain:tenant.blogspot.com') AS blogspot,
      rr_is_trusted_domain_key('domain:foo.co.in') AS public_suffix_co_in,
      rr_is_trusted_domain_key('domain:foo.com.sg') AS public_suffix_com_sg,
      rr_is_trusted_domain_key('domain:foo.co.za') AS public_suffix_co_za,
      rr_is_trusted_domain_key(NULL) AS null_domain
  `);
  const [gate] = rows;
  assert.equal(gate.valid_inn, true);
  assert.equal(gate.invalid_inn, false);
  assert.equal(gate.null_inn, false);
  assert.equal(gate.valid_ogrn, true);
  assert.equal(gate.invalid_ogrn, false);
  assert.equal(gate.null_ogrn, false);
  assert.equal(gate.canonical_domain, 'example.test');
  assert.equal(gate.large_numeric_hostname, '9999999999.1.1.1');
  assert.equal(gate.noncanonical_domain, false);
  assert.equal(gate.ip_literal, false);
  assert.equal(gate.platform_domain, false);
  assert.equal(gate.github_pages, false);
  assert.equal(gate.notion_site, false);
  assert.equal(gate.wixsite, false);
  assert.equal(gate.blogspot, false);
  assert.equal(gate.public_suffix_co_in, false);
  assert.equal(gate.public_suffix_com_sg, false);
  assert.equal(gate.public_suffix_co_za, false);
  assert.equal(gate.null_domain, false);
}

async function verifyReconciledKeys(client, fixture) {
  const result = await client.query(
    `SELECT source, source_key, external_id, metadata
     FROM org_source_refs
     WHERE metadata ->> 'fixture' = 'identity-boundary'
     ORDER BY external_id`,
  );
  const byExternalId = new Map(result.rows.map((row) => [row.external_id, row]));
  const quarantined = result.rows.filter((row) => row.source_key.endsWith(quarantineSuffix));
  assert.equal(quarantined.length, 15, 'all nonconforming fixture rows must be quarantined');
  assert.equal(byExternalId.get('bad-inn-a').source_key.endsWith(quarantineSuffix), true);
  assert.equal(byExternalId.get('bad-inn-b').source_key.endsWith(quarantineSuffix), true);
  assert.equal(byExternalId.get('collision-variant').source_key.endsWith(quarantineSuffix), true);
  assert.equal(byExternalId.get('ip-literal').source_key.endsWith(quarantineSuffix), true);
  assert.equal(byExternalId.get('mixed-prefix').source_key.endsWith(quarantineSuffix), true);
  assert.equal(byExternalId.get('quarantine-marker-bypass').source_key, `inn:7701234567 [legacy-key-quarantined:attacker]${quarantineSuffix}`);
  assert.equal(byExternalId.get('quarantine-exact-marker-bypass').source_key, `inn:7701234567 [legacy-key-quarantined:20260826100100]${quarantineSuffix}`);
  for (const externalId of [
    'multitenant-github-a',
    'multitenant-github-b',
    'multitenant-notion',
    'multitenant-wix',
    'multitenant-blogspot',
    'multitenant-co-in',
    'multitenant-com-sg',
    'multitenant-co-za',
  ]) {
    assert.equal(byExternalId.get(externalId).source_key.endsWith(quarantineSuffix), true);
  }

  assert.equal(byExternalId.get('case-only').source_key, 'domain:caseonly.example');
  assert.equal(byExternalId.get('caps-only').source_key, 'domain:capssolo.example');
  assert.equal(byExternalId.get('collision-canonical').source_key, 'domain:collision.example');
  assert.equal(byExternalId.get('trusted-a').source_key, 'inn:7701234507');
  assert.equal(byExternalId.get('trusted-b').source_key, 'inn:7701234507');

  // The guard must reject new invalid strong keys after reconciliation. This
  // assertion is deliberately inside the rollbacked transaction.
  for (const [source, sourceKey] of [
    ['hh', 'INN:7701234567'],
    ['superjob', 'domain:foo.github.io'],
    ['rabota-rossii', 'domain:foo.co.in'],
  ]) {
    await client.query('SAVEPOINT identity_guard_test');
    try {
      await assert.rejects(
        insertRef(client, fixture.orgs.badInnA, source, sourceKey, `guard-rejected-${source}`, 'Bad INN A'),
        /rr-org-source-refs-cannot-add-failed-gate-key/,
      );
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT identity_guard_test');
      await client.query('RELEASE SAVEPOINT identity_guard_test');
    }
  }
}

async function verifyDigestBoundary(client, fixture, rows) {
  const rowForOrg = (orgId) => rows.find((row) =>
    Array.isArray(row.corroborated_org_ids)
      && row.corroborated_org_ids.map(String).includes(String(orgId))
  );

  const badA = rowForOrg(fixture.orgs.badInnA);
  const badB = rowForOrg(fixture.orgs.badInnB);
  assert.ok(badA && badB, 'both invalid-INN organizations remain independently visible');
  assert.notEqual(badA.corroboration_key, badB.corroboration_key, 'quarantined invalid INN must not merge fragments');
  assert.ok(!String(badA.corroboration_key).includes('7701234567'));
  assert.ok(!String(badB.corroboration_key).includes('7701234567'));

  const trusted = rowForOrg(fixture.orgs.trustedA);
  assert.ok(trusted, 'trusted shared-INN organization must remain visible');
  assert.ok(trusted.corroborated_org_ids.map(String).includes(String(fixture.orgs.trustedB)));
  assert.equal(trusted.corroboration_key, 'inn:7701234507');
  assert.equal(trusted.source_families.length, 2, 'trusted merge must preserve both source families');

  const caseOnly = rowForOrg(fixture.orgs.caseOnly);
  const capsOnly = rowForOrg(fixture.orgs.capsOnly);
  assert.equal(caseOnly.corroboration_key, 'domain:caseonly.example');
  assert.equal(capsOnly.corroboration_key, 'domain:capssolo.example');

  const platformCareer = rowForOrg(fixture.orgs.platformCareer);
  const platformNested = rowForOrg(fixture.orgs.platformNested);
  assert.ok(platformCareer && platformNested, 'platform-domain fixtures remain independently visible');
  assert.notEqual(platformCareer.corroboration_key, 'domain:hh.ru');
  assert.notEqual(platformNested.corroboration_key, 'domain:hh.jobs.hh.ru');
  assert.equal(platformCareer.corroboration_key, `org:${fixture.orgs.platformCareer}`);
  assert.equal(platformNested.corroboration_key, `org:${fixture.orgs.platformNested}`);

  const multitenantA = rowForOrg(fixture.orgs.multitenantA);
  const multitenantB = rowForOrg(fixture.orgs.multitenantB);
  assert.ok(multitenantA && multitenantB, 'multitenant-domain fixtures remain independently visible');
  assert.notEqual(multitenantA.corroboration_key, 'domain:foo.github.io');
  assert.notEqual(multitenantB.corroboration_key, 'domain:foo.github.io');
  assert.equal(multitenantA.corroboration_key, `org:${fixture.orgs.multitenantA}`);
  assert.equal(multitenantB.corroboration_key, `org:${fixture.orgs.multitenantB}`);
  assert.deepEqual(multitenantA.corroborated_org_ids.map(String), [String(fixture.orgs.multitenantA)]);
  assert.deepEqual(multitenantB.corroborated_org_ids.map(String), [String(fixture.orgs.multitenantB)]);
}
