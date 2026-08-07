import type { QueryResult } from 'pg'

import {
  EXTERNAL_AGENCY_PROPENSITY_FEATURE_VERSION,
  EXTERNAL_AGENCY_PROPENSITY_LEVELS,
  type ExternalAgencyPropensityDraft,
  type ExternalAgencyPropensityFeatureSnapshot,
  type ExternalAgencyPropensityReason,
} from './external-agency-propensity'
import { AGENCY_DNA_RESTRICTION_TYPES } from './agency-dna'
import { SIGNAL_EPISODE_TYPES } from './signal-episode'

export type ExternalAgencyPropensityDb = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
  connect?: () => Promise<ExternalAgencyPropensityDb & { release: () => void }>
}

export interface ExternalAgencyPropensityPersistenceResult {
  propensitySnapshotId: string
  propensityGeneration: number
  inserted: boolean
  evidenceAttached: number
}

export class ExternalAgencyPropensityProvenanceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExternalAgencyPropensityProvenanceError'
  }
}

export class ExternalAgencyPropensityReplayConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExternalAgencyPropensityReplayConflictError'
  }
}

export async function persistExternalAgencyPropensity(
  draft: ExternalAgencyPropensityDraft,
  db: ExternalAgencyPropensityDb,
): Promise<ExternalAgencyPropensityPersistenceResult> {
  const propensity = validatePropensity(draft)
  const ownsClient = Boolean(db.connect) && !('release' in db)
  const client = ownsClient && db.connect ? await db.connect() : db
  try {
    return await persistPropensityTransaction(propensity, client)
  } finally {
    if (
      ownsClient &&
      'release' in client &&
      typeof client.release === 'function'
    ) {
      client.release()
    }
  }
}

async function persistPropensityTransaction(
  propensity: ExternalAgencyPropensityDraft,
  db: ExternalAgencyPropensityDb,
): Promise<ExternalAgencyPropensityPersistenceResult> {
  await db.query('BEGIN')
  try {
    await db.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [
        `external-agency-propensity:v1:${propensity.workspaceId}:` +
        `${propensity.clientProfileId}:${propensity.organizationId}:` +
        propensity.propensityIdentity,
      ],
    )
    const replay = await findReplay(propensity, db)
    if (replay) {
      await db.query('COMMIT')
      return result(replay.id, replay.propensityGeneration, false, 0)
    }

    const next = await db.query<{ nextGeneration: number }>(
      `SELECT COALESCE(MAX(propensity_generation), 0) + 1 AS "nextGeneration"
       FROM external_agency_propensity_snapshots
       WHERE workspace_id = $1
         AND client_profile_id = $2
         AND organization_id = $3
         AND feature_version = $4
         AND propensity_identity = $5`,
      [
        propensity.workspaceId,
        propensity.clientProfileId,
        propensity.organizationId,
        propensity.featureVersion,
        propensity.propensityIdentity,
      ],
    )
    const nextGeneration = positiveGeneration(next.rows[0]?.nextGeneration)
    const inserted = await db.query<{
      id: string
      propensityGeneration: number
    }>(
      `INSERT INTO external_agency_propensity_snapshots (
         organization_id, workspace_id, owner_id, client_profile_id,
         commercial_thesis_id, commercial_thesis_generation,
         agency_dna_version, agency_dna_snapshot_hash, propensity_identity,
         propensity_generation, score, level, positive_reasons,
         negative_reasons, feature_snapshot, evidence_hash, input_hash,
         feature_version
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
         $13::JSONB, $14::JSONB, $15::JSONB, $16, $17, $18
       )
       ON CONFLICT (
         workspace_id, client_profile_id, organization_id,
         feature_version, input_hash
       ) DO NOTHING
       RETURNING id::TEXT AS id,
         propensity_generation AS "propensityGeneration"`,
      [
        propensity.organizationId,
        propensity.workspaceId,
        propensity.ownerId,
        propensity.clientProfileId,
        propensity.commercialThesisId,
        propensity.commercialThesisGeneration,
        propensity.agencyDnaVersion,
        propensity.agencyDnaSnapshotHash,
        propensity.propensityIdentity,
        nextGeneration,
        propensity.score,
        propensity.level,
        JSON.stringify(propensity.positiveReasons),
        JSON.stringify(propensity.negativeReasons),
        JSON.stringify(propensity.featureSnapshot),
        propensity.thesisEvidenceHash,
        propensity.inputHash,
        propensity.featureVersion,
      ],
    )
    let snapshotId = inserted.rows[0]?.id ?? null
    let persistedGeneration = inserted.rows[0]?.propensityGeneration ?? null
    let wasInserted = Boolean(snapshotId)
    if (!snapshotId || persistedGeneration === null) {
      const reconciled = await findReplay(propensity, db)
      if (!reconciled) {
        throw new ExternalAgencyPropensityReplayConflictError(
          'External Agency Propensity input replay could not be reconciled.',
        )
      }
      snapshotId = reconciled.id
      persistedGeneration = reconciled.propensityGeneration
      wasInserted = false
    }
    if (!wasInserted) {
      await db.query('COMMIT')
      return result(snapshotId, persistedGeneration, false, 0)
    }

    const evidence = await db.query(
      `INSERT INTO external_agency_propensity_evidence (
         propensity_snapshot_id, organization_id, workspace_id,
         client_profile_id, evidence_id
       )
       SELECT $1, $2, $3, $4, evidence_id
       FROM UNNEST($5::BIGINT[]) AS evidence_id
       ON CONFLICT (propensity_snapshot_id, evidence_id) DO NOTHING`,
      [
        snapshotId,
        propensity.organizationId,
        propensity.workspaceId,
        propensity.clientProfileId,
        propensity.evidenceIds,
      ],
    )
    await db.query('COMMIT')
    return result(
      snapshotId,
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
  propensity: ExternalAgencyPropensityDraft,
  db: ExternalAgencyPropensityDb,
): Promise<{ id: string; propensityGeneration: number } | null> {
  const existing = await db.query<{
    id: string
    propensityGeneration: number
    propensityIdentity: string
    ownerId: string
    commercialThesisId: string
    commercialThesisGeneration: number
    agencyDnaVersion: number
    agencyDnaSnapshotHash: string
    evidenceHash: string
  }>(
    `SELECT
       id::TEXT AS id,
       propensity_generation AS "propensityGeneration",
       propensity_identity AS "propensityIdentity",
       owner_id::TEXT AS "ownerId",
       commercial_thesis_id::TEXT AS "commercialThesisId",
       commercial_thesis_generation AS "commercialThesisGeneration",
       agency_dna_version AS "agencyDnaVersion",
       agency_dna_snapshot_hash AS "agencyDnaSnapshotHash",
       evidence_hash AS "evidenceHash"
     FROM external_agency_propensity_snapshots
     WHERE workspace_id = $1
       AND client_profile_id = $2
       AND organization_id = $3
       AND feature_version = $4
       AND input_hash = $5
     FOR UPDATE`,
    [
      propensity.workspaceId,
      propensity.clientProfileId,
      propensity.organizationId,
      propensity.featureVersion,
      propensity.inputHash,
    ],
  )
  const row = existing.rows[0]
  if (!row) return null
  if (
    row.propensityIdentity !== propensity.propensityIdentity ||
    row.ownerId !== propensity.ownerId ||
    row.commercialThesisId !== propensity.commercialThesisId ||
    Number(row.commercialThesisGeneration) !==
      propensity.commercialThesisGeneration ||
    Number(row.agencyDnaVersion) !== propensity.agencyDnaVersion ||
    row.agencyDnaSnapshotHash !== propensity.agencyDnaSnapshotHash ||
    row.evidenceHash !== propensity.thesisEvidenceHash
  ) {
    throw new ExternalAgencyPropensityReplayConflictError(
      'External Agency Propensity input hash resolved to a different source.',
    )
  }
  return {
    id: positiveId(row.id, 'propensitySnapshotId'),
    propensityGeneration: positiveGeneration(row.propensityGeneration),
  }
}

function validatePropensity(
  propensity: ExternalAgencyPropensityDraft,
): ExternalAgencyPropensityDraft {
  const organizationId = positiveId(propensity.organizationId, 'organizationId')
  const workspaceId = positiveId(propensity.workspaceId, 'workspaceId')
  const ownerId = positiveId(propensity.ownerId, 'ownerId')
  const clientProfileId = positiveId(propensity.clientProfileId, 'clientProfileId')
  const commercialThesisId = positiveId(
    propensity.commercialThesisId,
    'commercialThesisId',
  )
  const commercialThesisGeneration = positiveGeneration(
    propensity.commercialThesisGeneration,
  )
  const agencyDnaVersion = positiveGeneration(propensity.agencyDnaVersion)
  const evidenceIds = validatedIds(propensity.evidenceIds, 'evidenceIds')
  if (evidenceIds.length === 0) {
    throw new ExternalAgencyPropensityProvenanceError(
      'External Agency Propensity requires Commercial Thesis evidence.',
    )
  }
  for (const [name, value] of [
    ['agencyDnaSnapshotHash', propensity.agencyDnaSnapshotHash],
    ['propensityIdentity', propensity.propensityIdentity],
    ['thesisEvidenceHash', propensity.thesisEvidenceHash],
    ['inputHash', propensity.inputHash],
  ] as const) {
    if (!/^[a-f0-9]{64}$/.test(value)) {
      throw new TypeError(`${name} must be a lowercase SHA-256 hash.`)
    }
  }
  if (propensity.featureVersion !== EXTERNAL_AGENCY_PROPENSITY_FEATURE_VERSION) {
    throw new TypeError('External Agency Propensity feature version is invalid.')
  }
  if (!EXTERNAL_AGENCY_PROPENSITY_LEVELS.includes(propensity.level)) {
    throw new TypeError('External Agency Propensity level is invalid.')
  }
  if (!Number.isFinite(propensity.score) ||
      propensity.score < 0 || propensity.score > 1) {
    throw new TypeError('External Agency Propensity score must be between 0 and 1.')
  }
  const evidenceSet = new Set(evidenceIds)
  const positiveReasons = validateReasons(
    propensity.positiveReasons,
    evidenceSet,
    'positiveReasons',
  )
  const negativeReasons = validateReasons(
    propensity.negativeReasons,
    evidenceSet,
    'negativeReasons',
  )
  const featureSnapshot = validateFeatureSnapshot(
    propensity.featureSnapshot,
    evidenceIds.length,
  )
  return {
    ...propensity,
    organizationId,
    workspaceId,
    ownerId,
    clientProfileId,
    commercialThesisId,
    commercialThesisGeneration,
    agencyDnaVersion,
    evidenceIds,
    positiveReasons,
    negativeReasons,
    featureSnapshot,
  }
}

function validateReasons(
  reasons: readonly ExternalAgencyPropensityReason[],
  evidenceSet: ReadonlySet<string>,
  name: string,
): ExternalAgencyPropensityReason[] {
  if (!Array.isArray(reasons)) {
    throw new ExternalAgencyPropensityProvenanceError(`${name} must be an array.`)
  }
  return reasons.map((reason) => {
    if (
      !reason ||
      !/^[A-Z][A-Z0-9_]{1,63}$/.test(reason.code) ||
      !reason.message?.trim() ||
      !['evidence', 'agency_profile', 'policy'].includes(reason.basis) ||
      !Number.isFinite(reason.contribution)
    ) {
      throw new ExternalAgencyPropensityProvenanceError(
        `${name} contains an invalid reason.`,
      )
    }
    const reasonEvidence = validatedIds(
      reason.evidenceIds,
      `${name}.evidenceIds`,
    )
    if (reason.basis === 'evidence') {
      if (reasonEvidence.length === 0 ||
          reasonEvidence.some((id) => !evidenceSet.has(id))) {
        throw new ExternalAgencyPropensityProvenanceError(
          `${name} references evidence outside the Commercial Thesis.`,
        )
      }
    } else if (reasonEvidence.length > 0) {
      throw new ExternalAgencyPropensityProvenanceError(
        `${name} attaches evidence to a profile or policy reason.`,
      )
    }
    return {
      code: reason.code,
      message: reason.message.trim(),
      basis: reason.basis,
      contribution: reason.contribution,
      evidenceIds: reasonEvidence,
    }
  })
}

function validateFeatureSnapshot(
  features: ExternalAgencyPropensityFeatureSnapshot,
  evidenceCount: number,
): ExternalAgencyPropensityFeatureSnapshot {
  const roleFamilies = uniqueSortedText(features?.roleFamilies)
  const evidenceSourceFamilies = uniqueSortedText(features?.evidenceSourceFamilies)
  const seniorityDistribution = validNumberRecord(features?.seniorityDistribution)
  if (
    !features ||
    !SIGNAL_EPISODE_TYPES.includes(features.episodeType) ||
    !['active', 'cooling', 'expired'].includes(features.episodeStage) ||
    !Number.isFinite(features.episodeIntensity) ||
    features.episodeIntensity < 0 ||
    features.episodeIntensity > 1 ||
    features.roleFamilyCount !== roleFamilies.length ||
    typeof features.hasComplexSeniority !== 'boolean' ||
    features.evidenceCount !== evidenceCount ||
    features.evidenceSourceFamilyCount !== evidenceSourceFamilies.length ||
    (features.accountRestriction !== null &&
      !AGENCY_DNA_RESTRICTION_TYPES.includes(features.accountRestriction)) ||
    !['new', 'grow', 'reactivate', 'blocked'].includes(features.opportunityMode) ||
    features.opportunityMode !== modeForRestriction(features.accountRestriction)
  ) {
    throw new ExternalAgencyPropensityProvenanceError(
      'External Agency Propensity feature snapshot is inconsistent.',
    )
  }
  return {
    ...features,
    roleFamilies,
    evidenceSourceFamilies,
    seniorityDistribution,
  }
}

function modeForRestriction(
  restriction: ExternalAgencyPropensityFeatureSnapshot['accountRestriction'],
): ExternalAgencyPropensityFeatureSnapshot['opportunityMode'] {
  if (restriction === 'existing_client') return 'grow'
  if (restriction === 'former_client') return 'reactivate'
  if (restriction === 'do_not_contact' || restriction === 'conflict') {
    return 'blocked'
  }
  return 'new'
}

function validNumberRecord(value: Record<string, number>): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ExternalAgencyPropensityProvenanceError(
      'External Agency Propensity seniority distribution is invalid.',
    )
  }
  const entries = Object.entries(value).map(([key, count]) => {
    const normalizedKey = key.trim().toLowerCase()
    if (!normalizedKey || !Number.isFinite(count) || count < 0) {
      throw new ExternalAgencyPropensityProvenanceError(
        'External Agency Propensity seniority distribution is invalid.',
      )
    }
    return [normalizedKey, count] as const
  })
  entries.sort(([left], [right]) => compareText(left, right))
  return Object.fromEntries(entries)
}

function result(
  propensitySnapshotId: string,
  propensityGeneration: number,
  inserted: boolean,
  evidenceAttached: number,
): ExternalAgencyPropensityPersistenceResult {
  return {
    propensitySnapshotId,
    propensityGeneration,
    inserted,
    evidenceAttached,
  }
}

function validatedIds(values: readonly string[], name: string): string[] {
  if (!Array.isArray(values)) {
    throw new ExternalAgencyPropensityProvenanceError(`${name} must be an array.`)
  }
  return [...new Set(values.map((value) => positiveId(value, name)))]
    .sort(compareIds)
}

function positiveId(value: string, name: string): string {
  const normalized = String(value ?? '').trim()
  if (!/^[1-9]\d{0,18}$/.test(normalized) ||
      BigInt(normalized) > BigInt('9223372036854775807')) {
    throw new ExternalAgencyPropensityProvenanceError(
      `${name} contains an invalid bigint ID.`,
    )
  }
  return BigInt(normalized).toString()
}

function positiveGeneration(value: number): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 2_147_483_647) {
    throw new ExternalAgencyPropensityReplayConflictError(
      'External Agency Propensity generation is invalid.',
    )
  }
  return parsed
}

function uniqueSortedText(values: readonly string[]): string[] {
  if (!Array.isArray(values)) {
    throw new ExternalAgencyPropensityProvenanceError(
      'External Agency Propensity feature list is invalid.',
    )
  }
  return [...new Set(values.map((value) => value.trim().toLowerCase())
    .filter(Boolean))].sort(compareText)
}

function compareIds(left: string, right: string): number {
  const difference = BigInt(left) - BigInt(right)
  return difference < 0 ? -1 : difference > 0 ? 1 : 0
}

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}
