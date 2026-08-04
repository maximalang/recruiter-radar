import type { QueryResult } from 'pg'

import {
  COMMERCIAL_THESIS_ENGINE_VERSION,
  type CommercialThesisDraft,
  type CommercialThesisStatement,
} from './commercial-thesis'

export type CommercialThesisDb = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
  connect?: () => Promise<CommercialThesisDb & { release: () => void }>
}

export interface CommercialThesisPersistenceResult {
  thesisId: string
  thesisGeneration: number
  inserted: boolean
  evidenceAttached: number
}

export class CommercialThesisProvenanceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommercialThesisProvenanceError'
  }
}

export class CommercialThesisReplayConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommercialThesisReplayConflictError'
  }
}

export async function persistCommercialThesis(
  thesis: CommercialThesisDraft,
  db: CommercialThesisDb,
): Promise<CommercialThesisPersistenceResult> {
  const normalized = validateThesis(thesis)
  const ownsClient = Boolean(db.connect) && !('release' in db)
  const client = ownsClient && db.connect ? await db.connect() : db
  try {
    return await persistThesisTransaction(normalized, client)
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

async function persistThesisTransaction(
  thesis: CommercialThesisDraft,
  db: CommercialThesisDb,
): Promise<CommercialThesisPersistenceResult> {
  await db.query('BEGIN')
  try {
    await db.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`commercial-thesis:v1:${thesis.organizationId}:${thesis.thesisIdentity}`],
    )
    const replay = await findReplay(thesis, db)
    if (replay) {
      await db.query('COMMIT')
      return result(replay.id, replay.thesisGeneration, false, 0)
    }

    const next = await db.query<{ nextGeneration: number }>(
      `SELECT COALESCE(MAX(thesis_generation), 0) + 1 AS "nextGeneration"
       FROM commercial_theses
       WHERE organization_id = $1
         AND engine_version = $2
         AND thesis_identity = $3`,
      [thesis.organizationId, thesis.engineVersion, thesis.thesisIdentity],
    )
    const nextGeneration = positiveGeneration(next.rows[0]?.nextGeneration)
    const inserted = await db.query<{ id: string; thesisGeneration: number }>(
      `INSERT INTO commercial_theses (
         organization_id, signal_episode_id, signal_episode_generation,
         thesis_identity, thesis_generation, what_changed, why_it_matters,
         probable_hiring_problem, why_external_agency_may_be_needed,
         why_this_agency_fits, why_now, recommended_service,
         recommended_persona, recommended_angle, risks, limitations,
         evidence_hash, input_hash, engine_version
       ) VALUES (
         $1, $2, $3, $4, $5, $6::JSONB, $7::JSONB, $8::JSONB,
         $9::JSONB, $10::JSONB, $11::JSONB, $12::JSONB, $13::JSONB,
         $14::JSONB, $15::JSONB, $16::JSONB, $17, $18, $19
       )
       ON CONFLICT (organization_id, engine_version, input_hash) DO NOTHING
       RETURNING id::TEXT AS id, thesis_generation AS "thesisGeneration"`,
      [
        thesis.organizationId,
        thesis.signalEpisodeId,
        thesis.signalEpisodeGeneration,
        thesis.thesisIdentity,
        nextGeneration,
        JSON.stringify(thesis.whatChanged),
        JSON.stringify(thesis.whyItMatters),
        JSON.stringify(thesis.probableHiringProblem),
        JSON.stringify(thesis.whyExternalAgencyMayBeNeeded),
        JSON.stringify(thesis.whyThisAgencyFits),
        JSON.stringify(thesis.whyNow),
        JSON.stringify(thesis.recommendedService),
        JSON.stringify(thesis.recommendedPersona),
        JSON.stringify(thesis.recommendedAngle),
        JSON.stringify(thesis.risks),
        JSON.stringify(thesis.limitations),
        thesis.evidenceHash,
        thesis.inputHash,
        thesis.engineVersion,
      ],
    )
    let thesisId = inserted.rows[0]?.id ?? null
    let persistedGeneration = inserted.rows[0]?.thesisGeneration ?? null
    let wasInserted = Boolean(thesisId)
    if (!thesisId || persistedGeneration === null) {
      const reconciled = await findReplay(thesis, db)
      if (!reconciled) {
        throw new CommercialThesisReplayConflictError(
          'Commercial Thesis input replay could not be reconciled.',
        )
      }
      thesisId = reconciled.id
      persistedGeneration = reconciled.thesisGeneration
      wasInserted = false
    }
    if (!wasInserted) {
      await db.query('COMMIT')
      return result(thesisId, persistedGeneration, false, 0)
    }

    const evidence = await db.query(
      `INSERT INTO commercial_thesis_evidence (
         commercial_thesis_id, organization_id, evidence_id
       )
       SELECT $1, $2, evidence_id
       FROM UNNEST($3::BIGINT[]) AS evidence_id
       ON CONFLICT (commercial_thesis_id, evidence_id) DO NOTHING`,
      [thesisId, thesis.organizationId, thesis.evidenceRefs],
    )
    await db.query('COMMIT')
    return result(
      thesisId,
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
  thesis: CommercialThesisDraft,
  db: CommercialThesisDb,
): Promise<{ id: string; thesisGeneration: number } | null> {
  const existing = await db.query<{
    id: string
    thesisGeneration: number
    thesisIdentity: string
    signalEpisodeId: string
  }>(
    `SELECT
       id::TEXT AS id,
       thesis_generation AS "thesisGeneration",
       thesis_identity AS "thesisIdentity",
       signal_episode_id::TEXT AS "signalEpisodeId"
     FROM commercial_theses
     WHERE organization_id = $1
       AND engine_version = $2
       AND input_hash = $3
     FOR UPDATE`,
    [thesis.organizationId, thesis.engineVersion, thesis.inputHash],
  )
  const row = existing.rows[0]
  if (!row) return null
  if (
    (row.thesisIdentity !== undefined &&
      row.thesisIdentity !== thesis.thesisIdentity) ||
    (row.signalEpisodeId !== undefined &&
      row.signalEpisodeId !== thesis.signalEpisodeId)
  ) {
    throw new CommercialThesisReplayConflictError(
      'Commercial Thesis input hash resolved to a different source.',
    )
  }
  return {
    id: positiveId(row.id, 'thesisId'),
    thesisGeneration: positiveGeneration(row.thesisGeneration),
  }
}

function validateThesis(thesis: CommercialThesisDraft): CommercialThesisDraft {
  const organizationId = positiveId(thesis.organizationId, 'organizationId')
  const signalEpisodeId = positiveId(thesis.signalEpisodeId, 'signalEpisodeId')
  const signalEpisodeGeneration = positiveGeneration(thesis.signalEpisodeGeneration)
  const evidenceRefs = validatedIds(thesis.evidenceRefs, 'evidenceRefs')
  if (evidenceRefs.length === 0) {
    throw new CommercialThesisProvenanceError(
      'Commercial Thesis requires Signal Episode evidence.',
    )
  }
  for (const [name, value] of [
    ['thesisIdentity', thesis.thesisIdentity],
    ['evidenceHash', thesis.evidenceHash],
    ['inputHash', thesis.inputHash],
  ] as const) {
    if (!/^[a-f0-9]{64}$/.test(value)) {
      throw new TypeError(`${name} must be a lowercase SHA-256 hash.`)
    }
  }
  if (thesis.engineVersion !== COMMERCIAL_THESIS_ENGINE_VERSION) {
    throw new TypeError('Commercial Thesis engine version is invalid.')
  }
  const evidenceSet = new Set(evidenceRefs)
  const sections = {
    whatChanged: validateSection(thesis.whatChanged, evidenceSet, 'whatChanged'),
    whyItMatters: validateSection(thesis.whyItMatters, evidenceSet, 'whyItMatters'),
    probableHiringProblem: validateSection(
      thesis.probableHiringProblem,
      evidenceSet,
      'probableHiringProblem',
    ),
    whyExternalAgencyMayBeNeeded: validateSection(
      thesis.whyExternalAgencyMayBeNeeded,
      evidenceSet,
      'whyExternalAgencyMayBeNeeded',
    ),
    whyThisAgencyFits: validateSection(
      thesis.whyThisAgencyFits,
      evidenceSet,
      'whyThisAgencyFits',
    ),
    whyNow: validateSection(thesis.whyNow, evidenceSet, 'whyNow'),
    recommendedService: validateSection(
      thesis.recommendedService,
      evidenceSet,
      'recommendedService',
    ),
    recommendedPersona: validateSection(
      thesis.recommendedPersona,
      evidenceSet,
      'recommendedPersona',
    ),
    recommendedAngle: validateSection(
      thesis.recommendedAngle,
      evidenceSet,
      'recommendedAngle',
    ),
    risks: validateSection(thesis.risks, evidenceSet, 'risks'),
    limitations: validateSection(thesis.limitations, evidenceSet, 'limitations'),
  }
  return {
    ...thesis,
    ...sections,
    organizationId,
    signalEpisodeId,
    signalEpisodeGeneration,
    evidenceRefs,
  }
}

function validateSection(
  statements: readonly CommercialThesisStatement[],
  evidenceSet: ReadonlySet<string>,
  name: string,
): CommercialThesisStatement[] {
  if (!Array.isArray(statements) || statements.length === 0) {
    throw new CommercialThesisProvenanceError(`${name} must be non-empty.`)
  }
  return statements.map((item) => {
    if (
      !item ||
      ![
        'confirmed_fact',
        'rule_based_inference',
        'heuristic_hypothesis',
        'unknown',
      ].includes(item.classification) ||
      !/^[a-z][a-z0-9_]{1,63}$/.test(item.code) ||
      !item.text?.trim()
    ) {
      throw new CommercialThesisProvenanceError(
        `${name} contains an invalid statement.`,
      )
    }
    const statementEvidence = validatedIds(
      item.evidenceRefs,
      `${name}.evidenceRefs`,
    )
    if (statementEvidence.some((id) => !evidenceSet.has(id))) {
      throw new CommercialThesisProvenanceError(
        `${name} references evidence outside the source episode.`,
      )
    }
    if (item.classification !== 'unknown' && statementEvidence.length === 0) {
      throw new CommercialThesisProvenanceError(
        `${name} contains an unsupported derived statement.`,
      )
    }
    return {
      classification: item.classification,
      code: item.code,
      text: item.text.trim(),
      evidenceRefs: statementEvidence,
    }
  })
}

function result(
  thesisId: string,
  thesisGeneration: number,
  inserted: boolean,
  evidenceAttached: number,
): CommercialThesisPersistenceResult {
  return { thesisId, thesisGeneration, inserted, evidenceAttached }
}

function validatedIds(values: readonly string[], name: string): string[] {
  if (!Array.isArray(values)) {
    throw new CommercialThesisProvenanceError(`${name} must be an array.`)
  }
  return [...new Set(values.map((value) => positiveId(value, name)))]
    .sort(compareIds)
}

function positiveId(value: string, name: string): string {
  const normalized = String(value ?? '').trim()
  if (
    !/^[1-9]\d{0,18}$/.test(normalized) ||
    BigInt(normalized) > BigInt('9223372036854775807')
  ) {
    throw new CommercialThesisProvenanceError(
      `${name} contains an invalid bigint ID.`,
    )
  }
  return BigInt(normalized).toString()
}

function positiveGeneration(value: number): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 2_147_483_647) {
    throw new CommercialThesisReplayConflictError(
      'Commercial Thesis generation is invalid.',
    )
  }
  return parsed
}

function compareIds(left: string, right: string): number {
  const difference = BigInt(left) - BigInt(right)
  return difference < 0 ? -1 : difference > 0 ? 1 : 0
}
