import type { OpportunityItem } from './repository'
import { parseOpportunityStrategistBrief } from './opportunity-strategist-v1'

export function toPublicOpportunity(opportunity: OpportunityItem) {
  const {
    ownerId: _ownerId,
    evidenceHash: _evidenceHash,
    evidenceCount: _evidenceCount,
    factCount,
    publicationCount,
    sourceFamilyCount,
    directEvidenceCount,
    agencyFitExplanation,
    strategistBrief,
    workflow,
    metadata,
    ...publicOpportunity
  } = opportunity
  const safeMetadata = asRecord(metadata)
  const safeStrategistBrief = parseOpportunityStrategistBrief(strategistBrief)
  const publicWorkflow = workflow
    ? {
      assignedToUserId: workflow.assignedToUserId,
      nextActionType: workflow.nextActionType,
      nextActionDueAt: workflow.nextActionDueAt,
      workflowPriority: workflow.workflowPriority,
      updatedAt: workflow.updatedAt,
    }
    : null

  return {
    ...publicOpportunity,
    workflow: publicWorkflow,
    evidenceMetrics: {
      factCount,
      publicationCount,
      sourceFamilyCount,
      directEvidenceCount,
    },
    agencyFitExplanation,
    model: {
      modelType: 'heuristic' as const,
      calibrationStatus: 'uncalibrated' as const,
    },
    scoring: {
      components: toPublicComponents(safeMetadata.components),
      fiur: toPublicFiur(safeMetadata.fiur),
    },
    sourceFamilies: toStringArray(safeMetadata.sourceFamilies),
    morningBriefEligible: safeMetadata.morningBriefEligible === true,
    strategistBrief: safeStrategistBrief
      ? {
        ...safeStrategistBrief,
        evidenceTimeline: publicOpportunity.evidenceTimeline,
      }
      : null,
  }
}

const COMPONENT_KEYS = [
  'agencyFit',
  'hiringIntent',
  'externalSupportNeed',
  'timing',
  'reachability',
  'confidence',
] as const

function toPublicComponents(value: unknown) {
  const input = asRecord(value)
  return Object.fromEntries(
    COMPONENT_KEYS.flatMap((key) => {
      const component = asRecord(input[key])
      const score = finiteNumber(component.score)
      if (score === null) return []
      return [[key, {
        score,
        reasons: toPublicReasons(component.reasons),
      }]]
    }),
  )
}

function toPublicReasons(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 50).flatMap((item) => {
    const reason = asRecord(item)
    const code = safeText(reason.code, 120)
    const message = safeText(reason.message, 500)
    const basis = reason.basis === 'evidence' || reason.basis === 'profile'
      ? reason.basis
      : null
    if (!code || !message || !basis) return []
    return [{
      code,
      message,
      basis,
      evidenceIds: toStringArray(reason.evidenceIds).slice(0, 100),
    }]
  })
}

function toPublicFiur(value: unknown) {
  const input = asRecord(value)
  return Object.fromEntries(
    ['fit', 'intent', 'urgency', 'reachability', 'total'].flatMap((key) => {
      const score = finiteNumber(input[key])
      return score === null ? [] : [[key, score]]
    }),
  )
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : []
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function safeText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized.slice(0, maximumLength) : null
}
