/**
 * verify-lineage-org-anchor.mjs — executable DB regression for the
 * lineage-anchored organization contract in source-lineage-writer.mjs.
 *
 * Scenario (production incident 2026-10-07, superjob FK rollback):
 *   A vacancy is ingested under org A and gains append-only lineage.
 *   The employer later re-resolves to org B (rename / new strong key).
 *   The next ingest must keep the signal anchored at org A (the composite
 *   lineage FK is ON DELETE RESTRICT) AND still link the new evidence row —
 *   every join downstream of the signal upsert must use the RETURNED
 *   (anchored) org, never the freshly proposed one.
 *
 * Runs against a disposable database created from DATABASE_URL and dropped at
 * the end. Guarded by LINEAGE_ANCHOR_DB_TEST_ACK=isolated so it is never
 * pointed at a non-disposable database by accident.
 *
 * Usage:
 *   DATABASE_URL=postgres://... LINEAGE_ANCHOR_DB_TEST_ACK=isolated \
 *     node packages/db/scripts/verify-lineage-org-anchor.mjs
 */
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import pg from 'pg';

import {
  upsertSignalEvidenceLineage,
  upsertSignalEvidenceLineageBatch,
} from './lib/source-lineage-writer.mjs';

const { Client } = pg;
const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '../../..');

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl || process.env.LINEAGE_ANCHOR_DB_TEST_ACK !== 'isolated') {
  throw new Error('DATABASE_URL and LINEAGE_ANCHOR_DB_TEST_ACK=isolated are required for the disposable lineage-anchor DB verifier.');
}

const databaseName = `lineage_anchor_${process.pid}_${Date.now()}`;
const isolatedUrl = new URL(databaseUrl);
isolatedUrl.pathname = `/${databaseName}`;
isolatedUrl.searchParams.delete('schema');

const admin = new Client({ connectionString: databaseUrl });
let created = false;
let failures = 0;
let checks = 0;

function check(label, condition, detail = '') {
  checks += 1;
  if (condition) {
    process.stdout.write(`  PASS ${label}\n`);
  } else {
    failures += 1;
    process.stdout.write(`  FAIL ${label}${detail ? ` — ${detail}` : ''}\n`);
  }
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function record(orgId, externalId, publishedAt, overrides = {}) {
  return {
    orgId,
    signalType: 'job_posting',
    source: 'career-pages',
    sourceFamily: 'company-owned-career',
    externalId,
    headline: `Role ${externalId}`,
    summary: 'Public vacancy',
    sourceUrl: `https://example.test/jobs/${externalId}`,
    publishedAt,
    normalizedAt: publishedAt,
    payload: { externalId },
    sourceRecordType: 'job_posting',
    evidenceTier: 'corroboration',
    confidence: null,
    extractionMethod: 'jsonld',
    organizationResolutionReason: 'new-organization',
    ...overrides,
  };
}

const T1 = '2026-10-06T10:00:00.000Z';
const T2 = '2026-10-07T10:00:00.000Z';

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  created = true;

  await execFileAsync(process.execPath, [resolve(root, 'packages/db/scripts/migrate.mjs')], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: isolatedUrl.toString() },
    maxBuffer: 30 * 1024 * 1024,
    windowsHide: true,
  });

  const db = new Client({ connectionString: isolatedUrl.toString() });
  await db.connect();
  try {
    const orgA = Number((await db.query(`INSERT INTO orgs (name) VALUES ('Anchor Org A') RETURNING id`)).rows[0].id);
    const orgB = Number((await db.query(`INSERT INTO orgs (name) VALUES ('Fresh Org B') RETURNING id`)).rows[0].id);
    const orgC = Number((await db.query(`INSERT INTO orgs (name) VALUES ('Other Org C') RETURNING id`)).rows[0].id);
    process.stdout.write(`[lineage-anchor] orgs A=${orgA} B=${orgB} C=${orgC}\n`);

    // --- Single-row path -------------------------------------------------
    process.stdout.write('[lineage-anchor] single-row path\n');
    await db.query('BEGIN');
    const seed = await upsertSignalEvidenceLineage(db, record(orgA, 'anchor-single-1', T1));
    check('seed: lineage created', seed.lineageCreatedCount === 1, JSON.stringify(seed));
    check('seed: no anchor keep', (seed.orgAnchorKeeps ?? 0) === 0);

    const seedSignal = await db.query(
      `SELECT id, org_id FROM signals WHERE source = 'career-pages' AND external_id = 'anchor-single-1'`,
    );
    const signalId = Number(seedSignal.rows[0].id);
    check('seed: signal at org A', Number(seedSignal.rows[0].org_id) === orgA);

    // Re-ingest the same identity under a freshly resolved org B with a new
    // fetch timestamp (new evidence row must still be linked to the signal).
    const reingest = await upsertSignalEvidenceLineage(db, record(orgB, 'anchor-single-1', T2));
    const signalAfter = await db.query(
      `SELECT org_id FROM signals WHERE id = $1`, [signalId],
    );
    const lineageRows = await db.query(
      `SELECT organization_id, COUNT(*)::INT AS c FROM source_signal_evidence_lineage_v1 WHERE signal_id = $1 GROUP BY organization_id ORDER BY organization_id`,
      [signalId],
    );
    check('single: signal stays anchored at org A', Number(signalAfter.rows[0].org_id) === orgA);
    check('single: orgAnchorKeeps = 1', reingest.orgAnchorKeeps === 1, JSON.stringify(reingest));
    check('single: new evidence linked (lineageCreatedCount = 1)', reingest.lineageCreatedCount === 1, JSON.stringify(reingest));
    check('single: 2 lineage rows, all at org A', lineageRows.rows.length === 1
      && Number(lineageRows.rows[0].organization_id) === orgA
      && lineageRows.rows[0].c === 2, JSON.stringify(lineageRows.rows));
    await db.query('ROLLBACK');

    // --- Batch path (mixed batch: 1 anchored conflict + 2 fresh) ---------
    process.stdout.write('[lineage-anchor] batch path\n');
    await db.query('BEGIN');
    const batchSeed = await upsertSignalEvidenceLineageBatch(db, [record(orgA, 'anchor-batch-1', T1)]);
    check('batch seed: lineage created', batchSeed.lineageCreatedCount === 1, JSON.stringify(batchSeed));

    const mixed = await upsertSignalEvidenceLineageBatch(db, [
      record(orgB, 'anchor-batch-1', T2), // anchored: must keep org A
      record(orgC, 'batch-fresh-1', T2),
      record(orgC, 'batch-fresh-2', T2),
    ]);
    const batchSignal = await db.query(
      `SELECT id, org_id FROM signals WHERE source = 'career-pages' AND external_id = 'anchor-batch-1'`,
    );
    const batchLineage = await db.query(
      `SELECT s.external_id, l.organization_id, COUNT(*)::INT AS c
       FROM source_signal_evidence_lineage_v1 l
       JOIN signals s ON s.id = l.signal_id
       WHERE s.source = 'career-pages' AND s.external_id IN ('anchor-batch-1', 'batch-fresh-1', 'batch-fresh-2')
       GROUP BY s.external_id, l.organization_id ORDER BY s.external_id`,
    );
    check('batch: anchored signal keeps org A', Number(batchSignal.rows[0].org_id) === orgA);
    check('batch: orgAnchorKeeps = 1', mixed.orgAnchorKeeps === 1, JSON.stringify(mixed));
    check('batch: all three records linked (lineageCreatedCount = 3)', mixed.lineageCreatedCount === 3, JSON.stringify(mixed));
    check('batch: lineage orgs anchored (A,A for re-ingest; C for fresh)', (() => {
      const map = Object.fromEntries(batchLineage.rows.map((r) => [r.external_id, [Number(r.organization_id), r.c]]));
      return JSON.stringify(map['anchor-batch-1']) === `${JSON.stringify([orgA, 2])}`
        && JSON.stringify(map['batch-fresh-1']) === `${JSON.stringify([orgC, 1])}`
        && JSON.stringify(map['batch-fresh-2']) === `${JSON.stringify([orgC, 1])}`;
    })(), JSON.stringify(batchLineage.rows));
    await db.query('ROLLBACK');
  } finally {
    await db.end();
  }
} finally {
  if (created) {
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`).catch(() => undefined);
  }
  await admin.end().catch(() => undefined);
}

process.stdout.write(`\n[lineage-anchor] ${checks - failures}/${checks} checks passed\n`);
if (failures > 0) {
  process.stdout.write('[lineage-anchor] FAILED\n');
  process.exit(1);
}
process.stdout.write('[lineage-anchor] OK\n');
