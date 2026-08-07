import type { QueryResult } from 'pg'

import { hashCanonicalJson } from './canonical-hash'
import {
  buildOpportunityScoringV3,
  type OpportunityScoringV3Input,
  type OpportunityScoringV3Result,
} from './opportunity-scoring-v3'

export type OpportunityCandidateDb = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
  connect?: () => Promise<OpportunityCandidateDb & { release: () => void }>
}

export type OpportunityCandidatePersistenceResult = {
  candidateId: string
  candidateGeneration: number
  inserted: boolean
  evidenceAttached: number
}

export class OpportunityCandidateProvenanceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpportunityCandidateProvenanceError'
  }
}

export class OpportunityCandidateReplayConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpportunityCandidateReplayConflictError'
  }
}

export async function persistOpportunityCandidate(
  draft: OpportunityScoringV3Result,
  db: OpportunityCandidateDb,
): Promise<OpportunityCandidatePersistenceResult> {
  const candidate = validateCandidate(draft)
  const ownsClient = Boolean(db.connect) && !('release' in db)
  const client = ownsClient && db.connect ? await db.connect() : db
  try {
    return await persistTransaction(candidate, client)
  } finally {
    if (ownsClient && 'release' in client && typeof client.release === 'function') {
      client.release()
    }
  }
}

async function persistTransaction(
  candidate: OpportunityScoringV3Result,
  db: OpportunityCandidateDb,
): Promise<OpportunityCandidatePersistenceResult> {
  const source = candidate.featureSnapshot.source
  await db.query('BEGIN')
  try {
    await db.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [
        `opportunity:v3:${candidate.workspaceId}:${candidate.clientProfileId}:` +
        `${candidate.organizationId}:${candidate.candidateIdentity}`,
      ],
    )
    const replay = await findReplay(candidate, db)
    if (replay) {
      await db.query('COMMIT')
      return result(replay.id, replay.candidateGeneration, false, 0)
    }

    const next = await db.query<{ nextGeneration: number }>(
      `SELECT COALESCE(MAX(candidate_generation), 0) + 1 AS "nextGeneration"
       FROM opportunity_candidates
       WHERE workspace_id = $1
         AND client_profile_id = $2
         AND organization_id = $3
         AND score_version = $4
         AND candidate_identity = $5`,
      [
        candidate.workspaceId,
        candidate.clientProfileId,
        candidate.organizationId,
        candidate.scoreVersion,
        candidate.candidateIdentity,
      ],
    )
    const nextGeneration = generation(next.rows[0]?.nextGeneration)
    const inserted = await db.query<{
      id: string
      candidateGeneration: number
    }>(
      `INSERT INTO opportunity_candidates (
         organization_id, workspace_id, owner_id, client_profile_id,
         agency_dna_match_snapshot_id, agency_dna_match_generation,
         propensity_snapshot_id, propensity_generation,
         commercial_thesis_id, commercial_thesis_generation,
         signal_episode_id, signal_episode_generation,
         company_state_snapshot_id, candidate_identity, candidate_generation,
         opportunity_mode, raw_quality_score, quality_score,
         actionability_score, ranking_score, status, legacy_status_projection,
         quality_components, actionability_components, hard_gates, reasons,
         feature_snapshot, evidence_snapshot, evidence_hash, input_hash,
         score_version, feature_schema_version, gate_version, rollout_mode,
         fallback_scoring_version, model_type, calibration_status, valid_until
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
         $15, $16, $17, $18, $19, $20, $21, $22, $23::JSONB, $24::JSONB,
         $25::JSONB, $26::JSONB, $27::JSONB, $28::JSONB, $29, $30, $31,
         $32, $33, $34, $35, $36, $37, $38
       )
       ON CONFLICT (
         workspace_id, client_profile_id, organization_id,
         score_version, input_hash
       ) DO NOTHING
       RETURNING id::TEXT AS id,
         candidate_generation AS "candidateGeneration"`,
      [
        candidate.organizationId,
        candidate.workspaceId,
        candidate.ownerId,
        candidate.clientProfileId,
        source.agencyDnaMatchSnapshotId,
        source.agencyDnaMatchGeneration,
        source.propensitySnapshotId,
        source.propensityGeneration,
        source.commercialThesisId,
        source.commercialThesisGeneration,
        source.signalEpisodeId,
        source.signalEpisodeGeneration,
        source.companyStateSnapshotId,
        candidate.candidateIdentity,
        nextGeneration,
        candidate.opportunityMode,
        candidate.rawQualityScore,
        candidate.qualityScore,
        candidate.actionabilityScore,
        candidate.rankingScore,
        candidate.status,
        candidate.legacyStatusProjection,
        JSON.stringify(candidate.qualityComponents),
        JSON.stringify(candidate.actionabilityComponents),
        JSON.stringify(candidate.hardGates),
        JSON.stringify(candidate.reasons),
        JSON.stringify(candidate.featureSnapshot),
        JSON.stringify(candidate.evidenceSnapshot),
        candidate.evidenceHash,
        candidate.inputHash,
        candidate.scoreVersion,
        candidate.featureSchemaVersion,
        candidate.gateVersion,
        candidate.rolloutMode,
        candidate.fallbackScoringVersion,
        candidate.modelType,
        candidate.calibrationStatus,
        candidate.validUntil,
      ],
    )
    let candidateId = inserted.rows[0]?.id ?? null
    let persistedGeneration = inserted.rows[0]?.candidateGeneration ?? null
    let wasInserted = Boolean(candidateId)
    if (!candidateId || persistedGeneration === null) {
      const reconciled = await findReplay(candidate, db)
      if (!reconciled) {
        throw new OpportunityCandidateReplayConflictError(
          'Opportunity candidate input replay could not be reconciled.',
        )
      }
      candidateId = reconciled.id
      persistedGeneration = reconciled.candidateGeneration
      wasInserted = false
    }
    if (!wasInserted) {
      await db.query('COMMIT')
      return result(candidateId, persistedGeneration, false, 0)
    }

    const evidence = await db.query(
      `INSERT INTO opportunity_candidate_evidence (
         candidate_id, organization_id, workspace_id,
         client_profile_id, evidence_id
       )
       SELECT $1, $2, $3, $4, evidence_id
       FROM UNNEST($5::BIGINT[]) AS evidence_id
       ON CONFLICT (candidate_id, evidence_id) DO NOTHING`,
      [
        candidateId,
        candidate.organizationId,
        candidate.workspaceId,
        candidate.clientProfileId,
        candidate.evidenceSnapshot.evidenceIds,
      ],
    )
    await db.query('COMMIT')
    return result(
      candidateId,
      persistedGeneration,
      true,
      evidence.rowCount ?? 0,
    )
  } catch (error) {
    await db.query('ROLLBACK')
    throw error
  }
}

async function findReplay(
  candidate: OpportunityScoringV3Result,
  db: OpportunityCandidateDb,
): Promise<{ id: string; candidateGeneration: number } | null> {
  const existing = await db.query<{
    id: string
    candidateGeneration: number
    candidateIdentity: string
    ownerId: string
    opportunityMode: string
    agencyDnaMatchSnapshotId: string
    agencyDnaMatchGeneration: number
    propensitySnapshotId: string
    propensityGeneration: number
    commercialThesisId: string
    commercialThesisGeneration: number
    signalEpisodeId: string
    signalEpisodeGeneration: number
    companyStateSnapshotId: string
    evidenceHash: string
  }>(
    `SELECT
       id::TEXT AS id,
       candidate_generation AS "candidateGeneration",
       candidate_identity AS "candidateIdentity",
       owner_id::TEXT AS "ownerId",
       opportunity_mode AS "opportunityMode",
       agency_dna_match_snapshot_id::TEXT AS "agencyDnaMatchSnapshotId",
       agency_dna_match_generation AS "agencyDnaMatchGeneration",
       propensity_snapshot_id::TEXT AS "propensitySnapshotId",
       propensity_generation AS "propensityGeneration",
       commercial_thesis_id::TEXT AS "commercialThesisId",
       commercial_thesis_generation AS "commercialThesisGeneration",
       signal_episode_id::TEXT AS "signalEpisodeId",
       signal_episode_generation AS "signalEpisodeGeneration",
       company_state_snapshot_id::TEXT AS "companyStateSnapshotId",
       evidence_hash AS "evidenceHash"
     FROM opportunity_candidates
     WHERE workspace_id = $1
       AND client_profile_id = $2
       AND organization_id = $3
       AND score_version = $4
       AND input_hash = $5
     FOR UPDATE`,
    [
      candidate.workspaceId,
      candidate.clientProfileId,
      candidate.organizationId,
      candidate.scoreVersion,
      candidate.inputHash,
    ],
  )
  const row = existing.rows[0]
  if (!row) return null
  const source = candidate.featureSnapshot.source
  if (
    row.candidateIdentity !== candidate.candidateIdentity ||
    row.ownerId !== candidate.ownerId ||
    row.opportunityMode !== candidate.opportunityMode ||
    row.agencyDnaMatchSnapshotId !== source.agencyDnaMatchSnapshotId ||
    Number(row.agencyDnaMatchGeneration) !== source.agencyDnaMatchGeneration ||
    row.propensitySnapshotId !== source.propensitySnapshotId ||
    Number(row.propensityGeneration) !== source.propensityGeneration ||
    row.commercialThesisId !== source.commercialThesisId ||
    Number(row.commercialThesisGeneration) !== source.commercialThesisGeneration ||
    row.signalEpisodeId !== source.signalEpisodeId ||
    Number(row.signalEpisodeGeneration) !== source.signalEpisodeGeneration ||
    row.companyStateSnapshotId !== source.companyStateSnapshotId ||
    row.evidenceHash !== candidate.evidenceHash
  ) {
    throw new OpportunityCandidateReplayConflictError(
      'Opportunity candidate input hash resolved to different tenant lineage.',
    )
  }
  return {
    id: positiveId(row.id, 'candidate'),
    candidateGeneration: generation(row.candidateGeneration),
  }
}

function validateCandidate(
  candidate: OpportunityScoringV3Result,
): OpportunityScoringV3Result {
  try {
    if (!candidate || typeof candidate !== 'object') {
      provenance('candidate must be an object.')
    }
    if (candidate.evidenceSnapshot.evidenceIds.length === 0) {
      provenance('candidate requires Agency DNA Match evidence.')
    }
    const rebuilt = buildOpportunityScoringV3(replayInput(candidate))
    if (hashCanonicalJson(rebuilt) !== hashCanonicalJson(candidate)) {
      provenance('candidate does not match its deterministic scoring replay.')
    }
    return rebuilt
  } catch (error) {
    if (error instanceof OpportunityCandidateProvenanceError) throw error
    const message = error instanceof Error ? error.message : 'invalid candidate'
    throw new OpportunityCandidateProvenanceError(
      `Opportunity candidate provenance is invalid: ${message}`,
    )
  }
}

function replayInput(
  candidate: OpportunityScoringV3Result,
): OpportunityScoringV3Input {
  const source = candidate.featureSnapshot.source
  const quality = candidate.featureSnapshot.quality
  const actionability = candidate.featureSnapshot.actionability
  const rollout = candidate.featureSnapshot.rollout
  return {
    organizationId: candidate.organizationId,
    workspaceId: candidate.workspaceId,
    ownerId: candidate.ownerId,
    clientProfileId: candidate.clientProfileId,
    agencyDnaMatchSnapshotId: source.agencyDnaMatchSnapshotId,
    agencyDnaMatchGeneration: source.agencyDnaMatchGeneration,
    agencyDnaMatchIdentity: source.agencyDnaMatchIdentity,
    agencyDnaMatchInputHash: source.agencyDnaMatchInputHash,
    propensitySnapshotId: source.propensitySnapshotId,
    propensityGeneration: source.propensityGeneration,
    commercialThesisId: source.commercialThesisId,
    commercialThesisGeneration: source.commercialThesisGeneration,
    signalEpisodeId: source.signalEpisodeId,
    signalEpisodeGeneration: source.signalEpisodeGeneration,
    companyStateSnapshotId: source.companyStateSnapshotId,
    agencyDnaVersion: source.agencyDnaVersion,
    agencyDnaSnapshotHash: source.agencyDnaSnapshotHash,
    evidenceHash: candidate.evidenceHash,
    evidenceIds: candidate.evidenceSnapshot.evidenceIds,
    evidenceSourceFamilies: candidate.evidenceSnapshot.evidenceSourceFamilies,
    directEvidenceCount: candidate.evidenceSnapshot.directEvidenceCount,
    corroborationEvidenceCount:
      candidate.evidenceSnapshot.corroborationEvidenceCount,
    organizationIdentityVerified: quality.organizationIdentityVerified,
    stateChangeConfirmed: quality.stateChangeConfirmed,
    companyStateConfidence: quality.companyStateConfidence,
    episodeStage: quality.episodeStage,
    episodeIntensity: quality.episodeIntensity,
    episodeLastSeenAt: quality.episodeLastSeenAt,
    episodeValidUntil: quality.episodeValidUntil,
    profileExcluded: quality.profileExcluded,
    accountRestriction: quality.accountRestriction,
    opportunityMode: candidate.opportunityMode,
    agencyFitScore: quality.agencyFitScore,
    agencyFitCoverage: quality.agencyFitCoverage,
    minimumAgencyFitScore: quality.minimumAgencyFitScore,
    minimumAgencyFitCoverage: quality.minimumAgencyFitCoverage,
    propensityScore: quality.propensityScore,
    propensityLevel: quality.propensityLevel,
    economicsOutcome: quality.economicsOutcome,
    currentCapacity: quality.currentCapacity,
    corporateContactPathCategories:
      actionability.corporateContactPathCategories,
    decisionMakerFunctions: actionability.decisionMakerFunctions,
    contactPolicy: actionability.contactPolicy,
    enrichmentCompleteness: actionability.enrichmentCompleteness,
    rolloutMode: rollout.mode,
    fallbackScoringVersion: rollout.fallbackScoringVersion,
    now: evaluationTime(quality),
  }
}

function evaluationTime(
  quality: OpportunityScoringV3Result['featureSnapshot']['quality'],
): Date {
  const lastSeen = Date.parse(quality.episodeLastSeenAt)
  const validUntil = Date.parse(quality.episodeValidUntil)
  if (!Number.isFinite(lastSeen) || !Number.isFinite(validUntil) ||
      validUntil <= lastSeen) {
    provenance('episode replay window is invalid.')
  }
  if (quality.episodeStage === 'active') return new Date(lastSeen)
  if (quality.episodeStage === 'cooling') {
    return new Date(lastSeen + (validUntil - lastSeen) * 0.8)
  }
  return new Date(validUntil)
}

function result(
  candidateId: string,
  candidateGeneration: number,
  inserted: boolean,
  evidenceAttached: number,
): OpportunityCandidatePersistenceResult {
  return { candidateId, candidateGeneration, inserted, evidenceAttached }
}

function provenance(message: string): never {
  throw new OpportunityCandidateProvenanceError(message)
}

function positiveId(value: unknown, label: string): string {
  const normalized = String(value ?? '').trim()
  if (!/^[1-9]\d{0,18}$/.test(normalized) ||
      BigInt(normalized) > BigInt('9223372036854775807')) {
    throw new TypeError(`${label} ID is invalid.`)
  }
  return BigInt(normalized).toString()
}

function generation(value: unknown): number {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized <= 0 ||
      normalized > 2_147_483_647) {
    throw new TypeError('Candidate generation is invalid.')
  }
  return normalized
}
