import assert from 'node:assert/strict';
import test from 'node:test';
import { upsertSignalEvidenceLineage, upsertSignalEvidenceLineageBatch } from './source-lineage-writer.mjs';

function input(externalId) {
  return {
    orgId: 42,
    signalType: 'job_posting',
    source: 'career-pages',
    sourceFamily: 'company-owned-career',
    externalId,
    headline: `Role ${externalId}`,
    summary: 'Public vacancy',
    sourceUrl: `https://example.test/jobs/${externalId}`,
    publishedAt: '2026-08-14T00:00:00.000Z',
    normalizedAt: '2026-08-14T00:05:00.000Z',
    payload: { externalId },
    sourceRecordType: 'job_posting',
    evidenceTier: 'direct',
    extractionMethod: 'jsonld',
    organizationResolutionReason: 'validated-strong-key',
  };
}

test('persists a vacancy batch through one set-based database round trip', async () => {
  const calls = [];
  const client = { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{
      signalUpsertCount: 2,
      evidenceUpsertCount: 2,
      evidenceCreatedCount: 2,
      lineageCreatedCount: 2,
      familyIngestionStats: { 'career-pages': { signalUpsertCount: 2, evidenceCreatedCount: 2 } },
    }] };
  } };

  const result = await upsertSignalEvidenceLineageBatch(client, [input('one'), input('two')]);

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /JSONB_TO_RECORDSET/);
  assert.match(calls[0].sql, /INSERT INTO signals/);
  assert.match(calls[0].sql, /INSERT INTO evidence_items/);
  assert.match(calls[0].sql, /INSERT INTO source_signal_evidence_lineage_v1/);
  assert.equal(JSON.parse(calls[0].params[0]).length, 2);
  assert.deepEqual(result, {
    signalUpsertCount: 2,
    evidenceUpsertCount: 2,
    evidenceCreatedCount: 2,
    lineageCreatedCount: 2,
    familyIngestionStats: { 'career-pages': { signalUpsertCount: 2, evidenceCreatedCount: 2 } },
  });
});

test('rejects duplicate signal identities before opening a database round trip', async () => {
  const client = { query: async () => assert.fail('query must not run') };
  await assert.rejects(
    upsertSignalEvidenceLineageBatch(client, [input('same'), input('same')]),
    /appears more than once/,
  );
});

test('single upsert anchors a lineaged signal to its original organization', async () => {
  // Regression: re-ingesting a vacancy whose employer re-resolved to another
  // org must NOT move signals.org_id — lineage rows reference
  // (signal_id, organization_id) with ON DELETE RESTRICT, so the move aborts
  // the whole ingest batch via FK violation.
  const calls = [];
  const client = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (/INSERT INTO signals/.test(sql)) {
      // CASE arm taken: lineage exists, the returned row keeps the original org
      // 731 even though the fresh resolution proposed 999.
      return { rows: [{ id: 73385, org_id: 731, source_url: 'https://example.test/jobs/x', occurred_at: '2026-08-14T00:00:00.000Z', payload: {} }], rowCount: 1 };
    }
    if (/INSERT INTO evidence_items/.test(sql)) {
      return { rows: [{ id: 555 }], rowCount: 1 };
    }
    if (/INSERT INTO source_signal_evidence_lineage_v1/.test(sql)) {
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  } };

  const result = await upsertSignalEvidenceLineage(client, { ...input('x'), orgId: 999 });

  assert.match(calls[0].sql, /existing_lineage\.signal_id = signals\.id/);
  assert.equal(calls[1].params[0], 731, 'evidence must be written against the anchored org');
  assert.equal(calls[2].params[2], 731, 'lineage must reference the anchored org');
  assert.equal(result.orgAnchorKeeps, 1);
});

test('batch upsert applies the same lineage org anchor and reports keeps', async () => {
  const calls = [];
  const client = { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{
      signalUpsertCount: 1,
      evidenceUpsertCount: 1,
      evidenceCreatedCount: 1,
      lineageCreatedCount: 1,
      orgAnchorKeeps: 1,
      familyIngestionStats: {},
    }] };
  } };

  const result = await upsertSignalEvidenceLineageBatch(client, [input('one')]);

  assert.match(calls[0].sql, /existing_lineage\.signal_id = signals\.id/);
  assert.match(calls[0].sql, /USING \(source, external_id\)/);
  assert.doesNotMatch(calls[0].sql, /USING \(org_id, source, external_id\)/);
  assert.equal(result.orgAnchorKeeps, 1);
});

test('empty batch reports a stable zeroed shape', async () => {
  const client = { query: async () => assert.fail('query must not run') };
  assert.deepEqual(await upsertSignalEvidenceLineageBatch(client, []), {
    signalUpsertCount: 0,
    evidenceUpsertCount: 0,
    evidenceCreatedCount: 0,
    lineageCreatedCount: 0,
    orgAnchorKeeps: 0,
  });
});
