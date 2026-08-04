import type { QueryResult } from 'pg'

import {
  AGENCY_DNA_MATCH_DIMENSIONS,
  AGENCY_DNA_MATCH_FEATURE_VERSION,
  AGENCY_DNA_MATCH_LEVELS,
  AGENCY_DNA_MATCH_MODES,
  type AgencyDnaMatchDimension,
  type AgencyDnaMatchDimensionResult,
  type AgencyDnaMatchDraft,
  type AgencyDnaMatchFeatureSnapshot,
  type AgencyDnaMatchMode,
  type AgencyDnaMatchReason,
  type AgencyDnaMatchSelectionPolicy,
} from './agency-dna-match'
import {
  AGENCY_DNA_CAPACITIES,
  AGENCY_DNA_RESTRICTION_TYPES,
  type AgencyDnaCapacity,
  type AgencyDnaRestrictionType,
} from './agency-dna'
import {
  EXTERNAL_AGENCY_PROPENSITY_FEATURE_VERSION,
  EXTERNAL_AGENCY_PROPENSITY_LEVELS,
} from './external-agency-propensity'

export type AgencyDnaMatchDb = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
  connect?: () => Promise<AgencyDnaMatchDb & { release: () => void }>
}

export type AgencyDnaMatchPersistenceResult = {
  matchSnapshotId: string
  matchGeneration: number
  inserted: boolean
  evidenceAttached: number
}

export class AgencyDnaMatchProvenanceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgencyDnaMatchProvenanceError'
  }
}

export class AgencyDnaMatchReplayConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgencyDnaMatchReplayConflictError'
  }
}

const POLICIES: Record<AgencyDnaCapacity, AgencyDnaMatchSelectionPolicy> = {
  low: {
    capacity: 'low',
    minimumFitScore: 0.75,
    minimumCoverage: 0.5,
    minimumPropensityLevel: 'medium',
    quotaMultiplier: 0.5,
    adjacentMatchesAllowed: false,
  },
  normal: {
    capacity: 'normal',
    minimumFitScore: 0.58,
    minimumCoverage: 0.35,
    minimumPropensityLevel: 'medium',
    quotaMultiplier: 1,
    adjacentMatchesAllowed: false,
  },
  high: {
    capacity: 'high',
    minimumFitScore: 0.58,
    minimumCoverage: 0.35,
    minimumPropensityLevel: 'medium',
    quotaMultiplier: 1.5,
    adjacentMatchesAllowed: true,
  },
}

export async function persistAgencyDnaMatch(
  draft: AgencyDnaMatchDraft,
  db: AgencyDnaMatchDb,
): Promise<AgencyDnaMatchPersistenceResult> {
  const match = validateMatch(draft)
  const ownsClient = Boolean(db.connect) && !('release' in db)
  const client = ownsClient && db.connect ? await db.connect() : db
  try {
    return await persistTransaction(match, client)
  } finally {
    if (ownsClient && 'release' in client && typeof client.release === 'function') {
      client.release()
    }
  }
}

async function persistTransaction(
  match: AgencyDnaMatchDraft,
  db: AgencyDnaMatchDb,
): Promise<AgencyDnaMatchPersistenceResult> {
  await db.query('BEGIN')
  try {
    await db.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [
        `agency-dna-match:v2:${match.workspaceId}:` +
        `${match.clientProfileId}:${match.organizationId}:${match.matchIdentity}`,
      ],
    )
    const replay = await findReplay(match, db)
    if (replay) {
      await db.query('COMMIT')
      return result(replay.id, replay.matchGeneration, false, 0)
    }

    const next = await db.query<{ nextGeneration: number }>(
      `SELECT COALESCE(MAX(match_generation), 0) + 1 AS "nextGeneration"
       FROM agency_dna_match_snapshots
       WHERE workspace_id = $1
         AND client_profile_id = $2
         AND organization_id = $3
         AND feature_version = $4
         AND match_identity = $5`,
      [
        match.workspaceId,
        match.clientProfileId,
        match.organizationId,
        match.featureVersion,
        match.matchIdentity,
      ],
    )
    const nextGeneration = generation(next.rows[0]?.nextGeneration)
    const inserted = await db.query<{ id: string; matchGeneration: number }>(
      `INSERT INTO agency_dna_match_snapshots (
         organization_id, workspace_id, owner_id, client_profile_id,
         propensity_snapshot_id, propensity_generation, agency_dna_version,
         agency_dna_snapshot_hash, agency_dna_snapshot, match_identity,
         match_generation, fit_score, coverage, level, dimensions, reasons,
         unknown_dimensions, selection_policy, modes, feature_snapshot,
         evidence_hash, input_hash, feature_version
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9::JSONB, $10, $11, $12,
         $13, $14, $15::JSONB, $16::JSONB, $17::JSONB, $18::JSONB,
         $19::JSONB, $20::JSONB, $21, $22, $23
       )
       ON CONFLICT (
         workspace_id, client_profile_id, organization_id,
         feature_version, input_hash
       ) DO NOTHING
       RETURNING id::TEXT AS id, match_generation AS "matchGeneration"`,
      [
        match.organizationId,
        match.workspaceId,
        match.ownerId,
        match.clientProfileId,
        match.propensitySnapshotId,
        match.propensityGeneration,
        match.agencyDnaVersion,
        match.agencyDnaSnapshotHash,
        JSON.stringify(match.agencyDnaSourceSnapshot),
        match.matchIdentity,
        nextGeneration,
        match.fitScore,
        match.coverage,
        match.level,
        JSON.stringify(match.dimensions),
        JSON.stringify(match.reasons),
        JSON.stringify(match.unknownDimensions),
        JSON.stringify(match.selectionPolicy),
        JSON.stringify(match.modes),
        JSON.stringify(match.featureSnapshot),
        match.propensityEvidenceHash,
        match.inputHash,
        match.featureVersion,
      ],
    )
    let snapshotId = inserted.rows[0]?.id ?? null
    let persistedGeneration = inserted.rows[0]?.matchGeneration ?? null
    let wasInserted = Boolean(snapshotId)
    if (!snapshotId || persistedGeneration === null) {
      const reconciled = await findReplay(match, db)
      if (!reconciled) {
        throw new AgencyDnaMatchReplayConflictError(
          'Agency DNA Match input replay could not be reconciled.',
        )
      }
      snapshotId = reconciled.id
      persistedGeneration = reconciled.matchGeneration
      wasInserted = false
    }
    if (!wasInserted) {
      await db.query('COMMIT')
      return result(snapshotId, persistedGeneration, false, 0)
    }

    const evidence = await db.query(
      `INSERT INTO agency_dna_match_evidence (
         match_snapshot_id, organization_id, workspace_id,
         client_profile_id, evidence_id
       )
       SELECT $1, $2, $3, $4, evidence_id
       FROM UNNEST($5::BIGINT[]) AS evidence_id
       ON CONFLICT (match_snapshot_id, evidence_id) DO NOTHING`,
      [
        snapshotId,
        match.organizationId,
        match.workspaceId,
        match.clientProfileId,
        match.evidenceIds,
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
  match: AgencyDnaMatchDraft,
  db: AgencyDnaMatchDb,
): Promise<{ id: string; matchGeneration: number } | null> {
  const existing = await db.query<{
    id: string
    matchGeneration: number
    matchIdentity: string
    ownerId: string
    propensitySnapshotId: string
    propensityGeneration: number
    agencyDnaVersion: number
    agencyDnaSnapshotHash: string
    evidenceHash: string
  }>(
    `SELECT
       id::TEXT AS id,
       match_generation AS "matchGeneration",
       match_identity AS "matchIdentity",
       owner_id::TEXT AS "ownerId",
       propensity_snapshot_id::TEXT AS "propensitySnapshotId",
       propensity_generation AS "propensityGeneration",
       agency_dna_version AS "agencyDnaVersion",
       agency_dna_snapshot_hash AS "agencyDnaSnapshotHash",
       evidence_hash AS "evidenceHash"
     FROM agency_dna_match_snapshots
     WHERE workspace_id = $1
       AND client_profile_id = $2
       AND organization_id = $3
       AND feature_version = $4
       AND input_hash = $5
     FOR UPDATE`,
    [
      match.workspaceId,
      match.clientProfileId,
      match.organizationId,
      match.featureVersion,
      match.inputHash,
    ],
  )
  const row = existing.rows[0]
  if (!row) return null
  if (
    row.matchIdentity !== match.matchIdentity ||
    row.ownerId !== match.ownerId ||
    row.propensitySnapshotId !== match.propensitySnapshotId ||
    Number(row.propensityGeneration) !== match.propensityGeneration ||
    Number(row.agencyDnaVersion) !== match.agencyDnaVersion ||
    row.agencyDnaSnapshotHash !== match.agencyDnaSnapshotHash ||
    row.evidenceHash !== match.propensityEvidenceHash
  ) {
    throw new AgencyDnaMatchReplayConflictError(
      'Agency DNA Match input hash resolved to a different source.',
    )
  }
  return {
    id: positiveId(row.id, 'match snapshot'),
    matchGeneration: generation(row.matchGeneration),
  }
}

function validateMatch(match: AgencyDnaMatchDraft): AgencyDnaMatchDraft {
  const organizationId = positiveId(match.organizationId, 'organization')
  const workspaceId = positiveId(match.workspaceId, 'workspace')
  const ownerId = positiveId(match.ownerId, 'owner')
  const clientProfileId = positiveId(match.clientProfileId, 'client profile')
  const propensitySnapshotId = positiveId(
    match.propensitySnapshotId,
    'propensity snapshot',
  )
  const propensityGeneration = generation(match.propensityGeneration)
  const agencyDnaVersion = generation(match.agencyDnaVersion)
  const evidenceIds = ids(match.evidenceIds, 'evidence')
  if (evidenceIds.length === 0) {
    throw new AgencyDnaMatchProvenanceError(
      'Agency DNA Match requires External Agency Propensity evidence.',
    )
  }
  for (const [name, value] of [
    ['agencyDnaSnapshotHash', match.agencyDnaSnapshotHash],
    ['matchIdentity', match.matchIdentity],
    ['propensityEvidenceHash', match.propensityEvidenceHash],
    ['inputHash', match.inputHash],
  ] as const) {
    hash(value, name)
  }
  if (match.featureVersion !== AGENCY_DNA_MATCH_FEATURE_VERSION) {
    throw new TypeError('Agency DNA Match feature version is invalid.')
  }
  if (!AGENCY_DNA_MATCH_LEVELS.includes(match.level)) {
    throw new TypeError('Agency DNA Match level is invalid.')
  }
  ratio(match.fitScore, 'fit score')
  ratio(match.coverage, 'coverage')
  const agencyDnaSourceSnapshot = object(
    match.agencyDnaSourceSnapshot,
    'Agency DNA source snapshot',
  )
  const evidenceSet = new Set(evidenceIds)
  const reasons = validateReasons(match.reasons, evidenceSet)
  const dimensions = validateDimensions(match.dimensions)
  const unknownDimensions = validateUnknownDimensions(
    match.unknownDimensions,
    dimensions,
  )
  const featureSnapshot = validateFeatureSnapshot(match, match.featureSnapshot)
  const selectionPolicy = validateSelectionPolicy(
    match.selectionPolicy,
    featureSnapshot.agency.currentCapacity,
  )
  const modes = validateModes(match, featureSnapshot, selectionPolicy)
  validateOutcomeConsistency(match, featureSnapshot, dimensions, reasons)

  return {
    ...match,
    organizationId,
    workspaceId,
    ownerId,
    clientProfileId,
    propensitySnapshotId,
    propensityGeneration,
    agencyDnaVersion,
    agencyDnaSourceSnapshot,
    evidenceIds,
    reasons,
    dimensions,
    unknownDimensions,
    featureSnapshot,
    selectionPolicy,
    modes,
  }
}

function validateReasons(
  reasons: readonly AgencyDnaMatchReason[],
  evidenceSet: ReadonlySet<string>,
): AgencyDnaMatchReason[] {
  if (!Array.isArray(reasons)) provenance('reasons must be an array.')
  return reasons.map((item) => {
    if (
      !item ||
      !/^[A-Z][A-Z0-9_]{1,63}$/.test(item.code) ||
      !item.message?.trim() ||
      !AGENCY_DNA_MATCH_DIMENSIONS.includes(item.dimension) ||
      !['evidence', 'agency_profile', 'organization_record', 'policy']
        .includes(item.basis) ||
      !Number.isFinite(item.contribution)
    ) provenance('reasons contain an invalid reason.')
    const reasonEvidence = ids(item.evidenceIds, 'reason evidence')
    if (item.basis === 'evidence') {
      if (reasonEvidence.length === 0 ||
          reasonEvidence.some((id) => !evidenceSet.has(id))) {
        provenance('evidence reason references evidence outside the propensity.')
      }
    } else if (reasonEvidence.length > 0) {
      provenance('non-evidence reason cannot attach evidence ids.')
    }
    return {
      ...item,
      message: item.message.trim(),
      evidenceIds: reasonEvidence,
    }
  })
}

function validateDimensions(
  dimensions: Record<AgencyDnaMatchDimension, AgencyDnaMatchDimensionResult>,
): Record<AgencyDnaMatchDimension, AgencyDnaMatchDimensionResult> {
  if (!dimensions || typeof dimensions !== 'object' || Array.isArray(dimensions)) {
    provenance('dimensions must be an object.')
  }
  exactKeys(dimensions, AGENCY_DNA_MATCH_DIMENSIONS, 'dimensions')
  const entries = AGENCY_DNA_MATCH_DIMENSIONS.map((dimension) => {
    const item = dimensions[dimension]
    if (
      !item ||
      !['match', 'mismatch', 'unknown', 'not_configured', 'blocked']
        .includes(item.outcome) ||
      !Number.isFinite(item.contribution) ||
      !Number.isFinite(item.weight) || item.weight < 0 || item.weight > 1
    ) provenance(`dimension ${dimension} is invalid.`)
    return [dimension, {
      ...item,
      agencyValues: texts(item.agencyValues, `${dimension}.agencyValues`),
      companyValues: texts(item.companyValues, `${dimension}.companyValues`),
    }] as const
  })
  return Object.fromEntries(entries) as Record<
    AgencyDnaMatchDimension,
    AgencyDnaMatchDimensionResult
  >
}

function validateUnknownDimensions(
  values: readonly AgencyDnaMatchDimension[],
  dimensions: Record<AgencyDnaMatchDimension, AgencyDnaMatchDimensionResult>,
): AgencyDnaMatchDimension[] {
  if (!Array.isArray(values) ||
      values.some((value) => !AGENCY_DNA_MATCH_DIMENSIONS.includes(value))) {
    provenance('unknown dimensions are invalid.')
  }
  const normalized = [...new Set(values)].sort(compareText)
  const expected = AGENCY_DNA_MATCH_DIMENSIONS
    .filter((dimension) => dimensions[dimension].outcome === 'unknown')
    .sort(compareText)
  if (JSON.stringify(normalized) !== JSON.stringify(expected)) {
    provenance('unknown dimensions do not match dimension outcomes.')
  }
  return normalized
}

function validateFeatureSnapshot(
  match: AgencyDnaMatchDraft,
  features: AgencyDnaMatchFeatureSnapshot,
): AgencyDnaMatchFeatureSnapshot {
  if (!features || typeof features !== 'object' ||
      !features.propensity || !features.company || !features.agency) {
    provenance('feature snapshot is invalid.')
  }
  const propensity = features.propensity
  if (
    positiveId(propensity.snapshotId, 'feature propensity snapshot') !==
      match.propensitySnapshotId ||
    generation(propensity.generation) !== match.propensityGeneration ||
    !/^[a-f0-9]{64}$/.test(propensity.identity) ||
    !/^[a-f0-9]{64}$/.test(propensity.inputHash) ||
    propensity.featureVersion !== EXTERNAL_AGENCY_PROPENSITY_FEATURE_VERSION ||
    !EXTERNAL_AGENCY_PROPENSITY_LEVELS.includes(propensity.level) ||
    !['active', 'cooling', 'expired'].includes(propensity.episodeStage) ||
    !Number.isInteger(propensity.evidenceSourceFamilyCount) ||
    propensity.evidenceSourceFamilyCount < 0
  ) provenance('propensity feature snapshot is inconsistent.')
  ratio(propensity.score, 'propensity score')
  if (!AGENCY_DNA_CAPACITIES.includes(features.agency.currentCapacity)) {
    provenance('Agency DNA capacity is invalid.')
  }
  const restriction = features.agency.accountRestriction
  if (restriction !== null && !AGENCY_DNA_RESTRICTION_TYPES.includes(restriction)) {
    provenance('Agency DNA account restriction is invalid.')
  }
  return features
}

function validateSelectionPolicy(
  policy: AgencyDnaMatchSelectionPolicy,
  capacity: AgencyDnaCapacity,
): AgencyDnaMatchSelectionPolicy {
  const expected = POLICIES[capacity]
  if (!policy || JSON.stringify(policy) !== JSON.stringify(expected)) {
    provenance('selection policy is inconsistent with Agency DNA capacity.')
  }
  return { ...policy }
}

function validateModes(
  match: AgencyDnaMatchDraft,
  features: AgencyDnaMatchFeatureSnapshot,
  policy: AgencyDnaMatchSelectionPolicy,
): AgencyDnaMatchDraft['modes'] {
  const modes = match.modes
  if (!modes || typeof modes !== 'object' || Array.isArray(modes)) {
    provenance('modes must be an object.')
  }
  exactKeys(modes, AGENCY_DNA_MATCH_MODES, 'modes')
  const applicableMode = modeForRestriction(features.agency.accountRestriction)
  const evidenceSufficient = propensitySufficient(features)
  const blocked = match.level === 'blocked'
  for (const mode of AGENCY_DNA_MATCH_MODES) {
    const item = modes[mode]
    const applicable = applicableMode === mode
    const expectedStatus = blocked ? 'blocked'
      : !applicable ? 'not_applicable'
        : !evidenceSufficient ? 'insufficient_evidence'
          : match.fitScore >= policy.minimumFitScore &&
              match.coverage >= policy.minimumCoverage
            ? 'qualifies' : 'below_threshold'
    if (
      !item || item.mode !== mode || item.applicable !== applicable ||
      item.status !== expectedStatus || item.fitScore !== match.fitScore ||
      item.coverage !== match.coverage ||
      item.minimumFitScore !== policy.minimumFitScore ||
      item.minimumCoverage !== policy.minimumCoverage
    ) provenance(`mode ${mode} is inconsistent.`)
  }
  return modes
}

function validateOutcomeConsistency(
  match: AgencyDnaMatchDraft,
  features: AgencyDnaMatchFeatureSnapshot,
  dimensions: Record<AgencyDnaMatchDimension, AgencyDnaMatchDimensionResult>,
  reasons: AgencyDnaMatchReason[],
): void {
  const blocked = AGENCY_DNA_MATCH_DIMENSIONS.some((dimension) =>
    dimensions[dimension].outcome === 'blocked')
  if (blocked !== (match.level === 'blocked')) {
    provenance('blocked match level is inconsistent with dimension outcomes.')
  }
  if (blocked && !reasons.some((item) =>
    item.basis === 'policy' && item.contribution === -1)) {
    provenance('blocked match requires an explicit policy reason.')
  }
  if (!blocked && !propensitySufficient(features) &&
      match.level !== 'insufficient_evidence') {
    provenance('match level weakens the propensity evidence floor.')
  }
}

function propensitySufficient(features: AgencyDnaMatchFeatureSnapshot): boolean {
  return features.propensity.episodeStage !== 'expired' &&
    features.propensity.evidenceSourceFamilyCount > 0 &&
    (features.propensity.level === 'high' ||
      features.propensity.level === 'medium')
}

function modeForRestriction(
  restriction: AgencyDnaRestrictionType | null,
): AgencyDnaMatchMode | null {
  if (restriction === 'existing_client') return 'grow'
  if (restriction === 'former_client') return 'reactivate'
  if (restriction === 'do_not_contact' || restriction === 'conflict') return null
  return 'find'
}

function result(
  matchSnapshotId: string,
  matchGeneration: number,
  inserted: boolean,
  evidenceAttached: number,
): AgencyDnaMatchPersistenceResult {
  return { matchSnapshotId, matchGeneration, inserted, evidenceAttached }
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort(compareText)
  const sortedExpected = [...expected].sort(compareText)
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
    provenance(`${label} contain unexpected or missing keys.`)
  }
}

function object(
  value: Readonly<Record<string, unknown>>,
  label: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    provenance(`${label} must be an object.`)
  }
  return value
}

function texts(values: readonly string[], label: string): string[] {
  if (!Array.isArray(values)) provenance(`${label} must be an array.`)
  return [...new Set(values.map((value) => {
    if (typeof value !== 'string' || !value.trim()) {
      provenance(`${label} contains invalid text.`)
    }
    return value.trim().toLowerCase()
  }))].sort(compareText)
}

function ids(values: readonly string[], label: string): string[] {
  if (!Array.isArray(values)) provenance(`${label} must be an array.`)
  return [...new Set(values.map((value) => positiveId(value, label)))]
    .sort(compareIds)
}

function positiveId(value: string, label: string): string {
  const normalized = String(value ?? '').trim()
  if (!/^[1-9]\d{0,18}$/.test(normalized) ||
      BigInt(normalized) > BigInt('9223372036854775807')) {
    provenance(`${label} contains an invalid bigint ID.`)
  }
  return BigInt(normalized).toString()
}

function generation(value: number): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 2_147_483_647) {
    throw new AgencyDnaMatchReplayConflictError(
      'Agency DNA Match generation is invalid.',
    )
  }
  return parsed
}

function hash(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 hash.`)
  }
  return value
}

function ratio(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`Agency DNA Match ${label} must be between 0 and 1.`)
  }
  return value
}

function provenance(message: string): never {
  throw new AgencyDnaMatchProvenanceError(message)
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
