import type { OpportunityItem } from './repository'

export function toPublicOpportunity(opportunity: OpportunityItem) {
  const {
    ownerId: _ownerId,
    evidenceHash: _evidenceHash,
    metadata,
    ...publicOpportunity
  } = opportunity
  const safeMetadata = asRecord(metadata)

  return {
    ...publicOpportunity,
    scoring: {
      components: toPublicComponents(safeMetadata.components),
      fiur: toPublicFiur(safeMetadata.fiur),
    },
    sourceFamilies: toStringArray(safeMetadata.sourceFamilies),
    morningBriefEligible: safeMetadata.morningBriefEligible === true,
  }
}

const COMPONENT_KEYS = [
  'agencyFit',
  'hiringIntent',
  'externalAgencyPropensity',
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
