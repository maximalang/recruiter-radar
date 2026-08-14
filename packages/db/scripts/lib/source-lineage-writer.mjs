import { evidenceContentHash, writeEvidence } from './evidence-writer.mjs';

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

/**
 * Set-based form of upsertSignalEvidenceLineage. One JSON recordset crosses
 * the client/server boundary and the CTEs preserve the same signal, evidence,
 * and append-only lineage contracts for a whole normalized vacancy batch.
 */
export async function upsertSignalEvidenceLineageBatch(client, inputs) {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    return {
      signalUpsertCount: 0,
      evidenceUpsertCount: 0,
      evidenceCreatedCount: 0,
      lineageCreatedCount: 0,
    };
  }

  const seenSignals = new Set();
  const rows = inputs.map((input, ordinal) => {
    if (!input.sourceUrl) {
      throw new Error(`${input.source}/${input.externalId} cannot create evidence without an original source URL`);
    }
    if (!EVIDENCE_TIERS.has(input.evidenceTier)) {
      throw new Error(`${input.source}/${input.externalId} has invalid evidence tier ${input.evidenceTier}`);
    }
    const signalKey = `${input.source}\u0000${input.externalId}`;
    if (seenSignals.has(signalKey)) {
      throw new Error(`${input.source}/${input.externalId} appears more than once in a lineage batch`);
    }
    seenSignals.add(signalKey);
    const fetchedAt = new Date(input.publishedAt).toISOString();
    return {
      ordinal,
      org_id: input.orgId,
      signal_type: input.signalType,
      source: input.source,
      external_id: input.externalId,
      headline: input.headline,
      summary: input.summary,
      source_url: input.sourceUrl,
      published_at: fetchedAt,
      normalized_at: new Date(input.normalizedAt).toISOString(),
      payload: input.payload ?? {},
      source_family: input.sourceFamily ?? input.source,
      source_record_type: input.sourceRecordType,
      evidence_tier: input.evidenceTier,
      evidence_hash: evidenceContentHash({
        source: input.source,
        url: input.sourceUrl,
        fetchedAt,
        tier: input.evidenceTier,
      }),
      extraction_method: input.extractionMethod ?? 'unknown',
      organization_resolution_reason: input.organizationResolutionReason,
      confidence: {
        state: input.confidence == null ? 'unavailable' : 'reported',
        value: input.confidence ?? null,
      },
      health_family: input.healthFamily ?? input.source,
    };
  });

  const result = await client.query(`
    WITH input_rows AS MATERIALIZED (
      SELECT *
      FROM JSONB_TO_RECORDSET($1::JSONB) AS row(
        ordinal INTEGER,
        org_id BIGINT,
        signal_type TEXT,
        source TEXT,
        external_id TEXT,
        headline TEXT,
        summary TEXT,
        source_url TEXT,
        published_at TIMESTAMPTZ,
        normalized_at TIMESTAMPTZ,
        payload JSONB,
        source_family TEXT,
        source_record_type TEXT,
        evidence_tier TEXT,
        evidence_hash TEXT,
        extraction_method TEXT,
        organization_resolution_reason TEXT,
        confidence JSONB,
        health_family TEXT
      )
    ),
    upserted_signals AS (
      INSERT INTO signals (
        org_id, signal_type, source, external_id, headline, summary,
        source_url, occurred_at, payload
      )
      SELECT org_id, signal_type::signal_kind, source, external_id, headline, summary,
        source_url, published_at, payload
      FROM input_rows
      ORDER BY ordinal
      ON CONFLICT (source, external_id) DO UPDATE SET
        org_id = EXCLUDED.org_id,
        headline = EXCLUDED.headline,
        summary = EXCLUDED.summary,
        source_url = EXCLUDED.source_url,
        occurred_at = EXCLUDED.occurred_at,
        payload = EXCLUDED.payload
      RETURNING id, org_id, source, external_id, source_url, occurred_at, payload
    ),
    signal_rows AS MATERIALIZED (
      SELECT input_rows.*, signals.id AS signal_id,
        signals.source_url AS persisted_source_url,
        signals.occurred_at AS persisted_occurred_at,
        signals.payload AS persisted_payload
      FROM input_rows
      JOIN upserted_signals signals USING (org_id, source, external_id)
    ),
    inserted_evidence AS (
      INSERT INTO evidence_items (
        org_id, lead_id, source, url, fetched_at, content_hash, tier, payload_ref
      )
      SELECT org_id, NULL, source, persisted_source_url,
        persisted_occurred_at, evidence_hash, evidence_tier,
        JSONB_BUILD_OBJECT(
          'signal_id', signal_id,
          'source_external_id', external_id,
          'source_record_type', source_record_type,
          'normalized_at', normalized_at
        )
      FROM signal_rows
      ORDER BY ordinal
      ON CONFLICT DO NOTHING
      RETURNING id, org_id, content_hash
    ),
    evidence_rows AS MATERIALIZED (
      SELECT id, org_id, content_hash FROM inserted_evidence
      UNION ALL
      SELECT DISTINCT evidence.id, evidence.org_id, evidence.content_hash
      FROM evidence_items evidence
      JOIN signal_rows input
        ON input.org_id = evidence.org_id
        AND input.evidence_hash = evidence.content_hash
      WHERE NOT EXISTS (
        SELECT 1 FROM inserted_evidence inserted
        WHERE inserted.org_id = evidence.org_id
          AND inserted.content_hash = evidence.content_hash
      )
    ),
    inserted_lineage AS (
      INSERT INTO source_signal_evidence_lineage_v1 (
        signal_id, evidence_id, organization_id, source, source_family,
        external_id, source_url, fetched_at, published_at, normalized_at,
        evidence_tier, confidence, extraction_method,
        organization_resolution_reason, signal_payload_snapshot
      )
      SELECT input.signal_id, evidence.id, input.org_id, input.source,
        input.source_family, input.external_id, input.persisted_source_url,
        input.normalized_at, input.persisted_occurred_at, input.normalized_at,
        input.evidence_tier, input.confidence, input.extraction_method,
        input.organization_resolution_reason, input.persisted_payload
      FROM signal_rows input
      JOIN evidence_rows evidence
        ON evidence.org_id = input.org_id
        AND evidence.content_hash = input.evidence_hash
      ON CONFLICT (signal_id, evidence_id) DO NOTHING
      RETURNING id
    ),
    family_stats AS (
      SELECT input.health_family,
        COUNT(*)::INTEGER AS signal_upsert_count,
        COUNT(inserted.id)::INTEGER AS evidence_created_count
      FROM signal_rows input
      LEFT JOIN inserted_evidence inserted
        ON inserted.org_id = input.org_id
        AND inserted.content_hash = input.evidence_hash
      GROUP BY input.health_family
    )
    SELECT
      (SELECT COUNT(*)::INTEGER FROM upserted_signals) AS "signalUpsertCount",
      (SELECT COUNT(*)::INTEGER FROM input_rows) AS "evidenceUpsertCount",
      (SELECT COUNT(*)::INTEGER FROM inserted_evidence) AS "evidenceCreatedCount",
      (SELECT COUNT(*)::INTEGER FROM inserted_lineage) AS "lineageCreatedCount",
      COALESCE((
        SELECT JSONB_OBJECT_AGG(health_family, JSONB_BUILD_OBJECT(
          'signalUpsertCount', signal_upsert_count,
          'evidenceCreatedCount', evidence_created_count
        ))
        FROM family_stats
      ), '{}'::JSONB) AS "familyIngestionStats"
  `, [JSON.stringify(rows)]);

  return result.rows[0];
}
