import assert from 'node:assert/strict';
import test from 'node:test';
import { upsertSignalEvidenceLineageBatch } from './source-lineage-writer.mjs';

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
