import type { QueryResult } from 'pg'

import { hashCanonicalJson } from './canonical-hash'
import {
  buildCommercialSignalQualityEngineV2,
  type CommercialSignalQualityEngineV2Input,
  type CommercialSignalQualityEngineV2Result,
} from './commercial-signal-quality-engine-v2'
import {
  buildEvidenceIndependence,
  COMMERCIAL_SIGNAL_QUALITY_VERSION,
  type CommercialSignalEvidenceProvenance,
  type EvidenceIndependenceReasonCode,
} from './commercial-signal-quality-v2'

export type CommercialSignalQualityV2Db = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
  connect?: () => Promise<CommercialSignalQualityV2Db & { release: () => void }>
}

export type CommercialSignalQualityV2PersistenceInput = {
  candidateId: string
  organizationId: string
  workspaceId: string
  clientProfileId: string
  validUntil: string
  engineInput: CommercialSignalQualityEngineV2Input
  result: CommercialSignalQualityEngineV2Result
  evidence: CommercialSignalEvidenceProvenance[]
}

export type CommercialSignalQualityV2PersistenceResult = {
  qualitySnapshotId: string
  qualityGeneration: number
  inserted: boolean
  evidenceAttached: number
}

export type CommercialSignalQualityV2OpportunityLink = {
  qualitySnapshotId: string
  opportunityLineageId: string
  candidateId: string
  organizationId: string
  workspaceId: string
  clientProfileId: string
}

type NormalizedInput = CommercialSignalQualityV2PersistenceInput & {
  qualityIdentity: string
  inputHash: string
  evidenceRows: Array<CommercialSignalEvidenceProvenance & {
    decisionRole: 'positive' | 'negative' | 'contact_policy'
    evidenceIndependenceGroup: string
    correlationReasonCode: EvidenceIndependenceReasonCode
  }>
}

const REASON_PRIORITY: EvidenceIndependenceReasonCode[] = [
  'EVIDENCE_SAME_UPSTREAM',
  'EVIDENCE_REPUBLICATION',
  'EVIDENCE_CORRELATED',
  'EVIDENCE_ORIGIN_UNKNOWN',
  'EVIDENCE_INDEPENDENT',
]

export async function persistCommercialSignalQualityV2(
  rawInput: CommercialSignalQualityV2PersistenceInput,
  db: CommercialSignalQualityV2Db,
): Promise<CommercialSignalQualityV2PersistenceResult> {
  const input = normalizeInput(rawInput)
  const ownsClient = Boolean(db.connect) && !('release' in db)
  const client = ownsClient && db.connect ? await db.connect() : db
  try {
    return await persistTransaction(input, client)
  } finally {
    if (ownsClient && 'release' in client && typeof client.release === 'function') {
      client.release()
    }
  }
}

export async function linkCommercialSignalQualityV2Opportunity(
  raw: CommercialSignalQualityV2OpportunityLink,
  db: CommercialSignalQualityV2Db,
): Promise<void> {
  const input = {
    qualitySnapshotId: positiveId(raw.qualitySnapshotId, 'quality snapshot id'),
    opportunityLineageId: positiveId(raw.opportunityLineageId, 'opportunity lineage id'),
    candidateId: positiveId(raw.candidateId, 'candidate id'),
    organizationId: positiveId(raw.organizationId, 'organization id'),
    workspaceId: positiveId(raw.workspaceId, 'workspace id'),
    clientProfileId: positiveId(raw.clientProfileId, 'client profile id'),
  }
  const inserted = await db.query(
    `INSERT INTO commercial_signal_quality_opportunity_lineage (
       quality_snapshot_id, opportunity_lineage_id, candidate_id,
       organization_id, workspace_id, client_profile_id
     ) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (opportunity_lineage_id) DO NOTHING
     RETURNING opportunity_lineage_id`,
    [
      input.qualitySnapshotId, input.opportunityLineageId, input.candidateId,
      input.organizationId, input.workspaceId, input.clientProfileId,
    ],
  )
  if (inserted.rowCount === 1) return
  const existing = await db.query<{
    qualitySnapshotId: string
    candidateId: string
    organizationId: string
    workspaceId: string
    clientProfileId: string
  }>(
    `SELECT
       quality_snapshot_id::TEXT AS "qualitySnapshotId",
       candidate_id::TEXT AS "candidateId",
       organization_id::TEXT AS "organizationId",
       workspace_id::TEXT AS "workspaceId",
       client_profile_id::TEXT AS "clientProfileId"
     FROM commercial_signal_quality_opportunity_lineage
     WHERE opportunity_lineage_id = $1`,
    [input.opportunityLineageId],
  )
  const replay = existing.rows[0]
  if (!replay || Object.entries({
    qualitySnapshotId: input.qualitySnapshotId,
    candidateId: input.candidateId,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    clientProfileId: input.clientProfileId,
  }).some(([key, value]) => replay[key as keyof typeof replay] !== value)) {
    throw new Error('opportunity lineage link idempotency conflict')
  }
}

async function persistTransaction(
  input: NormalizedInput,
  db: CommercialSignalQualityV2Db,
): Promise<CommercialSignalQualityV2PersistenceResult> {
  await db.query('BEGIN')
  try {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `commercial-signal-quality-v2:${input.workspaceId}:` +
      `${input.clientProfileId}:${input.organizationId}:${input.candidateId}`,
    ])
    const replay = await findReplay(input, db)
    if (replay) {
      await db.query('COMMIT')
      return persistenceResult(replay.id, replay.qualityGeneration, false, 0)
    }
    const generation = await db.query<{ nextGeneration: number }>(
      `SELECT COALESCE(MAX(quality_generation), 0) + 1 AS "nextGeneration"
       FROM commercial_signal_quality_snapshots
       WHERE workspace_id = $1
         AND client_profile_id = $2
         AND organization_id = $3
         AND feature_version = $4
         AND quality_identity = $5`,
      [
        input.workspaceId,
        input.clientProfileId,
        input.organizationId,
        COMMERCIAL_SIGNAL_QUALITY_VERSION,
        input.qualityIdentity,
      ],
    )
    const qualityGeneration = positiveGeneration(
      generation.rows[0]?.nextGeneration,
    )
    const snapshot = await db.query<{
      id: string
      qualityGeneration: number
    }>(
      `INSERT INTO commercial_signal_quality_snapshots (
         candidate_id, organization_id, workspace_id, client_profile_id,
         quality_identity, quality_generation, quality_score,
         quality_coverage, quality_confidence, critical_coverage, actionable,
         components, reason_codes, feature_snapshot, input_hash,
         feature_version, model_type, calibration_status, decision_at, valid_until
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
         $12::JSONB, $13::TEXT[], $14::JSONB, $15, $16, $17, $18,
         $19::TIMESTAMPTZ, $20::TIMESTAMPTZ
       )
       ON CONFLICT (candidate_id, feature_version, input_hash) DO NOTHING
       RETURNING id::TEXT AS id, quality_generation AS "qualityGeneration"`,
      [
        input.candidateId,
        input.organizationId,
        input.workspaceId,
        input.clientProfileId,
        input.qualityIdentity,
        qualityGeneration,
        input.result.quality.qualityScore,
        input.result.quality.qualityCoverage,
        input.result.quality.qualityConfidence,
        input.result.quality.criticalCoverage,
        input.result.quality.actionable,
        JSON.stringify(input.result.components),
        input.result.reasonCodes,
        JSON.stringify({
          engineVersion: input.result.engineVersion,
          featureVersions: input.result.featureVersions,
          status: input.result.status,
          actionability: input.result.actionability,
          independence: input.result.independence,
          actionabilityIndependence: input.result.actionabilityIndependence,
          decisionEvidence: input.result.decisionEvidence,
          componentSources: input.result.componentSources,
          affirmativeEvidenceByComponent:
            input.result.affirmativeEvidenceByComponent,
          evidenceIds: input.result.evidenceIds,
        }),
        input.inputHash,
        COMMERCIAL_SIGNAL_QUALITY_VERSION,
        input.result.modelType,
        input.result.calibrationStatus,
        input.result.decisionAt,
        input.validUntil,
      ],
    )
    let qualitySnapshotId = snapshot.rows[0]?.id ?? null
    let persistedGeneration = snapshot.rows[0]?.qualityGeneration ?? null
    if (!qualitySnapshotId || persistedGeneration === null) {
      const reconciled = await findReplay(input, db)
      if (!reconciled) throw new Error('quality snapshot replay conflict')
      await db.query('COMMIT')
      return persistenceResult(
        reconciled.id,
        reconciled.qualityGeneration,
        false,
        0,
      )
    }
    const evidence = await persistEvidence(
      qualitySnapshotId,
      input,
      db,
    )
    await db.query('COMMIT')
    return persistenceResult(
      qualitySnapshotId,
      persistedGeneration,
      true,
      evidence.rowCount ?? 0,
    )
  } catch (error) {
    await db.query('ROLLBACK')
    throw error
  }
}

async function persistEvidence(
  qualitySnapshotId: string,
  input: NormalizedInput,
  db: CommercialSignalQualityV2Db,
): Promise<QueryResult> {
  const rows = input.evidenceRows
  return db.query(
    `INSERT INTO commercial_signal_quality_evidence (
       quality_snapshot_id, candidate_id, organization_id, workspace_id,
       client_profile_id, evidence_id, decision_role, source_kind,
       source_family, source_domain,
       upstream_origin, canonical_url, vacancy_fingerprint,
       publication_fingerprint, organization_domain, content_fingerprint,
       observed_at, evidence_independence_group, correlation_reason_code
     )
     SELECT
       $1, $2, $3, $4, $5,
       input.evidence_id, input.decision_role, input.source_kind,
       input.source_family, input.source_domain,
       input.upstream_origin, input.canonical_url, input.vacancy_fingerprint,
       input.publication_fingerprint, input.organization_domain,
       input.content_fingerprint, input.observed_at,
       input.evidence_independence_group, input.correlation_reason_code
     FROM UNNEST(
       $6::BIGINT[], $7::TEXT[], $8::TEXT[], $9::TEXT[], $10::TEXT[], $11::TEXT[],
       $12::TEXT[], $13::TEXT[], $14::TEXT[], $15::TEXT[], $16::TEXT[],
       $17::TIMESTAMPTZ[], $18::TEXT[], $19::TEXT[]
     ) AS input(
       evidence_id, decision_role, source_kind, source_family, source_domain,
       upstream_origin,
       canonical_url, vacancy_fingerprint, publication_fingerprint,
       organization_domain, content_fingerprint, observed_at,
       evidence_independence_group, correlation_reason_code
     )
     ON CONFLICT (quality_snapshot_id, evidence_id) DO NOTHING`,
    [
      qualitySnapshotId,
      input.candidateId,
      input.organizationId,
      input.workspaceId,
      input.clientProfileId,
      rows.map((item) => item.evidenceId),
      rows.map((item) => item.decisionRole),
      rows.map((item) => item.sourceKind),
      rows.map((item) => item.sourceFamily),
      rows.map((item) => item.sourceDomain),
      rows.map((item) => item.upstreamOrigin),
      rows.map((item) => item.canonicalUrl),
      rows.map((item) => item.vacancyFingerprint),
      rows.map((item) => item.publicationFingerprint),
      rows.map((item) => item.organizationDomain),
      rows.map((item) => item.contentFingerprint),
      rows.map((item) => item.observedAt),
      rows.map((item) => item.evidenceIndependenceGroup),
      rows.map((item) => item.correlationReasonCode),
    ],
  )
}

async function findReplay(
  input: NormalizedInput,
  db: CommercialSignalQualityV2Db,
): Promise<{ id: string; qualityGeneration: number } | null> {
  const existing = await db.query<{
    id: string
    qualityGeneration: number
  }>(
    `SELECT id::TEXT AS id, quality_generation AS "qualityGeneration"
     FROM commercial_signal_quality_snapshots
     WHERE candidate_id = $1
       AND organization_id = $2
       AND workspace_id = $3
       AND client_profile_id = $4
       AND feature_version = $5
       AND input_hash = $6`,
    [
      input.candidateId,
      input.organizationId,
      input.workspaceId,
      input.clientProfileId,
      COMMERCIAL_SIGNAL_QUALITY_VERSION,
      input.inputHash,
    ],
  )
  const row = existing.rows[0]
  return row ? {
    id: positiveId(row.id, 'quality snapshot id'),
    qualityGeneration: positiveGeneration(row.qualityGeneration),
  } : null
}

function normalizeInput(
  input: CommercialSignalQualityV2PersistenceInput,
): NormalizedInput {
  const canonicalResult = buildCommercialSignalQualityEngineV2(input.engineInput)
  if (hashCanonicalJson(canonicalResult) !== hashCanonicalJson(input.result)) {
    throw new Error('quality result does not match canonical engine input')
  }
  if (hashCanonicalJson(input.engineInput.evidence) !== hashCanonicalJson(input.evidence)) {
    throw new Error('quality evidence does not match canonical engine input')
  }
  if (input.result.featureVersions.quality !== COMMERCIAL_SIGNAL_QUALITY_VERSION) {
    throw new Error('quality feature version is invalid')
  }
  if (input.result.reasonCodes.length === 0) {
    throw new Error('quality reason codes are required')
  }
  assertConsistentResult(input.result)
  const candidateId = positiveId(input.candidateId, 'candidate id')
  const organizationId = positiveId(input.organizationId, 'organization id')
  const workspaceId = positiveId(input.workspaceId, 'workspace id')
  const clientProfileId = positiveId(input.clientProfileId, 'client profile id')
  const validUntil = timestamp(input.validUntil, 'valid until')
  const decisionAt = timestamp(input.result.decisionAt, 'decision at')
  if (decisionAt > validUntil) {
    throw new Error('quality validity cannot precede its decision')
  }
  const provenance = new Map(input.evidence.map((item) => [item.evidenceId, item]))
  if (provenance.size !== input.evidence.length) {
    throw new Error('quality evidence lineage contains duplicates')
  }
  const providedIds = [...provenance.keys()].sort(compareIds)
  const resultIds = [...new Set(input.result.evidenceIds)].sort(compareIds)
  if (resultIds.length !== input.result.evidenceIds.length ||
      !sameIds(providedIds, resultIds)) {
    throw new Error('quality evidence lineage must exactly match the result')
  }
  validateComponentEvidence(input.result, provenance)
  if (input.result.independence.excludedFutureEvidenceIds.length > 0) {
    throw new Error('future evidence cannot be persisted as decision lineage')
  }
  const expectedIndependence = buildEvidenceIndependence(
    input.evidence,
    new Date(decisionAt),
  )
  const positiveEvidence = input.evidence.filter((item) =>
    input.result.decisionEvidence.positiveEvidenceIds.includes(item.evidenceId))
  const expectedActionabilityIndependence = buildEvidenceIndependence(
    positiveEvidence,
    new Date(decisionAt),
  )
  if (
    hashCanonicalJson(expectedIndependence) !==
      hashCanonicalJson(input.result.independence) ||
    hashCanonicalJson(expectedActionabilityIndependence) !==
      hashCanonicalJson(input.result.actionabilityIndependence)
  ) {
    throw new Error('quality evidence independence does not match provenance')
  }
  const groupByEvidence = new Map<string, {
    group: string
    reason: EvidenceIndependenceReasonCode
  }>()
  for (const group of input.result.independence.groups) {
    const reason = REASON_PRIORITY.find((item) =>
      group.reasonCodes.includes(item))
    if (!reason) throw new Error('quality evidence correlation reason is missing')
    for (const evidenceId of group.evidenceIds) {
      groupByEvidence.set(evidenceId, {
        group: group.evidenceIndependenceGroup,
        reason,
      })
    }
  }
  if (!sameIds([...groupByEvidence.keys()].sort(compareIds), resultIds)) {
    throw new Error('quality evidence groups must exactly match the result')
  }
  const evidenceRows = input.result.evidenceIds.map((evidenceId) => {
    const item = provenance.get(evidenceId)
    const grouping = groupByEvidence.get(evidenceId)
    if (!item || !grouping) {
      throw new Error(`exact quality evidence lineage missing for ${evidenceId}`)
    }
    const decisionRole: NormalizedInput['evidenceRows'][number]['decisionRole'] =
      input.result.decisionEvidence.positiveEvidenceIds.includes(evidenceId)
        ? 'positive'
        : input.result.decisionEvidence.negativeEvidenceIds.includes(evidenceId)
          ? 'negative'
          : 'contact_policy'
    return {
      ...item,
      decisionRole,
      evidenceIndependenceGroup: grouping.group,
      correlationReasonCode: grouping.reason,
    }
  })
  if (evidenceRows.length === 0) throw new Error('exact quality evidence lineage required')
  const qualityIdentity = hashCanonicalJson({
    candidateId,
    organizationId,
    workspaceId,
    clientProfileId,
    featureVersion: COMMERCIAL_SIGNAL_QUALITY_VERSION,
  })
  const inputHash = hashCanonicalJson({
    qualityIdentity,
    result: input.result,
    evidence: evidenceRows,
    validUntil,
  })
  return {
    ...input,
    candidateId,
    organizationId,
    workspaceId,
    clientProfileId,
    validUntil,
    qualityIdentity,
    inputHash,
    evidenceRows,
  }
}

function validateComponentEvidence(
  result: CommercialSignalQualityEngineV2Result,
  provenance: ReadonlyMap<string, CommercialSignalEvidenceProvenance>,
): void {
  const declarations = [
    ['hiringNeed', 'hiring_need'],
    ['hiringFriction', 'hiring_friction'],
    ['agencyFit', 'agency_fit'],
    ['propensity', 'external_agency_propensity'],
    ['convergence', 'signal_convergence'],
    ['economics', 'economics_fit'],
    ['marketDifficulty', 'market_difficulty'],
  ] as const
  const affirmative: string[] = []
  for (const [sourceKey, componentKey] of declarations) {
    const component = result.components[componentKey]
    if (!component) throw new Error(`quality component ${componentKey} is missing`)
    const affirmativeIds = result.affirmativeEvidenceByComponent[componentKey]
    if (!Array.isArray(affirmativeIds) ||
      affirmativeIds.some((id) => !component.evidenceIds.includes(id))) {
      throw new Error(`${componentKey} affirmative evidence is inconsistent`)
    }
    if ((component.value ?? 0) === 0 && affirmativeIds.length > 0) {
      throw new Error(`${componentKey} non-positive value claims affirmative evidence`)
    }
    affirmative.push(...affirmativeIds)
    const declared = result.componentSources[sourceKey]
    const allowedKinds = declared === 'derived_deterministic'
      ? ['direct', 'official', 'derived_deterministic']
      : [declared]
    if (component.evidenceIds.some((id) => {
      const kind = provenance.get(id)?.sourceKind
      return kind === undefined || !allowedKinds.includes(kind as never)
    })) {
      throw new Error(`${componentKey} evidence does not match its declared source`)
    }
  }
  const expectedPositive = [...new Set([
    ...affirmative,
    ...result.decisionEvidence.currentHiringEvidenceIds,
  ])].sort(compareIds)
  const actualPositive = [...new Set(result.decisionEvidence.positiveEvidenceIds)]
    .sort(compareIds)
  if (!sameIds(expectedPositive, actualPositive)) {
    throw new Error('positive decision evidence does not match affirmative lineage')
  }
  if (result.decisionEvidence.currentHiringEvidenceIds.some((id) => {
    const kind = provenance.get(id)?.sourceKind
    return kind !== 'direct' && kind !== 'official'
  })) {
    throw new Error('current hiring evidence requires direct or official provenance')
  }
}

function persistenceResult(
  qualitySnapshotId: string,
  qualityGeneration: number,
  inserted: boolean,
  evidenceAttached: number,
): CommercialSignalQualityV2PersistenceResult {
  return {
    qualitySnapshotId: positiveId(qualitySnapshotId, 'quality snapshot id'),
    qualityGeneration: positiveGeneration(qualityGeneration),
    inserted,
    evidenceAttached,
  }
}

function positiveId(value: string, label: string): string {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${label} must be positive`)
  return value
}

function positiveGeneration(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('quality generation must be positive')
  }
  return parsed
}

function timestamp(value: string, label: string): string {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} is invalid`)
  return parsed.toISOString()
}

function assertConsistentResult(result: CommercialSignalQualityEngineV2Result): void {
  const componentSources = Object.values(result.componentSources)
  if (componentSources.length !== 7 || componentSources.some((source) =>
    !['direct', 'official', 'derived_deterministic'].includes(source))) {
    throw new Error('quality component source lineage is inconsistent')
  }
  const expectedActionability = result.status === 'qualified_actionable'
    ? 'actionable'
    : result.status === 'qualified_needs_enrichment'
      ? 'needs_enrichment'
      : result.status === 'review'
        ? 'review'
        : 'blocked'
  const qualified = result.status === 'qualified_actionable' ||
    result.status === 'qualified_needs_enrichment'
  const blockedReasons = new Set([
    'DO_NOT_CONTACT', 'CONFLICT_BLOCK', 'CURRENT_HIRING_EVIDENCE_MISSING',
    'QUALITY_INDEPENDENT_ORIGINS_LOW', 'QUALITY_CRITICAL_COVERAGE_LOW',
    'QUALITY_COVERAGE_LOW',
  ])
  const currentIds = [...new Set(result.decisionEvidence.currentHiringEvidenceIds)]
    .sort(compareIds)
  const positiveIds = [...new Set(result.decisionEvidence.positiveEvidenceIds)]
    .sort(compareIds)
  const negativeIds = [...new Set(result.decisionEvidence.negativeEvidenceIds)]
    .sort(compareIds)
  const contactIds = [...new Set(result.decisionEvidence.contactEvidenceIds)]
    .sort(compareIds)
  const partitionIds = [...new Set([...positiveIds, ...negativeIds, ...contactIds])]
    .sort(compareIds)
  const resultIds = [...new Set(result.evidenceIds)].sort(compareIds)
  const actionabilityIds = [...new Set(
    result.actionabilityIndependence.groups.flatMap((group) => group.evidenceIds),
  )].sort(compareIds)
  if (
    result.actionability !== expectedActionability ||
    result.quality.actionable !== qualified ||
    (qualified && (
      result.quality.qualityScore < 0.68 ||
      result.quality.qualityCoverage < 0.7 ||
      result.quality.criticalCoverage < 0.8 ||
      result.actionabilityIndependence.independentGroupCount < 2 ||
      !result.decisionEvidence.currentHiringEvidence ||
      currentIds.length === 0 ||
      result.reasonCodes.some((reason) => blockedReasons.has(reason))
    )) ||
    !currentIds.every((id) => positiveIds.includes(id)) ||
    !sameIds(actionabilityIds, positiveIds) ||
    !sameIds(partitionIds, resultIds) ||
    positiveIds.some((id) => negativeIds.includes(id)) ||
    positiveIds.some((id) => contactIds.includes(id)) ||
    negativeIds.some((id) => contactIds.includes(id))
  ) {
    throw new Error('quality result status and actionability are inconsistent')
  }
}

function compareIds(left: string, right: string): number {
  return left.length - right.length || left.localeCompare(right, 'en')
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
