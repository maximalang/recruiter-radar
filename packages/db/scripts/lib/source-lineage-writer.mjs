import { writeEvidence } from './evidence-writer.mjs';

const EVIDENCE_TIERS = new Set(['direct', 'corroboration', 'context']);

export async function upsertSignalEvidenceLineage(client, input) {
  if (!input.sourceUrl) {
    throw new Error(`${input.source}/${input.externalId} cannot create evidence without an original source URL`);
  }
  if (!EVIDENCE_TIERS.has(input.evidenceTier)) {
    throw new Error(`${input.source}/${input.externalId} has invalid evidence tier ${input.evidenceTier}`);
  }

  const signal = await client.query(
    `INSERT INTO signals (
       org_id, signal_type, source, external_id, headline, summary,
       source_url, occurred_at, payload
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (source, external_id) DO UPDATE
     SET
       org_id = EXCLUDED.org_id,
       headline = EXCLUDED.headline,
       summary = EXCLUDED.summary,
       source_url = EXCLUDED.source_url,
       occurred_at = EXCLUDED.occurred_at,
       payload = EXCLUDED.payload
     RETURNING id, org_id, source_url, occurred_at, payload`,
    [
      input.orgId,
      input.signalType,
      input.source,
      input.externalId,
      input.headline,
      input.summary,
      input.sourceUrl,
      input.publishedAt,
      input.payload,
    ],
  );
  const signalRow = signal.rows[0];

  const evidence = await writeEvidence(client, {
    source: input.source,
    url: signalRow.source_url,
    fetchedAt: signalRow.occurred_at,
    tier: input.evidenceTier,
    orgId: Number(signalRow.org_id),
    payloadRef: {
      signal_id: Number(signalRow.id),
      source_external_id: input.externalId,
      source_record_type: input.sourceRecordType,
      normalized_at: input.normalizedAt,
    },
  });

  const lineage = await client.query(
    `INSERT INTO source_signal_evidence_lineage_v1 (
       signal_id, evidence_id, organization_id, source, source_family,
       external_id, source_url, fetched_at, published_at, normalized_at,
       evidence_tier, confidence, extraction_method,
       organization_resolution_reason, signal_payload_snapshot
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8, $10, $11, $12, $13, $14)
     ON CONFLICT (signal_id, evidence_id) DO NOTHING`,
    [
      signalRow.id,
      evidence.id,
      signalRow.org_id,
      input.source,
      input.sourceFamily ?? input.source,
      input.externalId,
      signalRow.source_url,
      input.normalizedAt,
      signalRow.occurred_at,
      input.evidenceTier,
      JSON.stringify({
        state: input.confidence == null ? 'unavailable' : 'reported',
        value: input.confidence ?? null,
      }),
      input.extractionMethod ?? 'unknown',
      input.organizationResolutionReason,
      JSON.stringify(input.payload ?? {}),
    ],
  );

  return {
    signalUpsertCount: signal.rowCount ?? 0,
    evidenceUpsertCount: 1,
    evidenceCreatedCount: evidence.inserted ? 1 : 0,
    lineageCreatedCount: lineage.rowCount ?? 0,
  };
}
