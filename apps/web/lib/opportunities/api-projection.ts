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
      components: asRecord(safeMetadata.components),
      fiur: asRecord(safeMetadata.fiur),
    },
    sourceFamilies: toStringArray(safeMetadata.sourceFamilies),
    morningBriefEligible: safeMetadata.morningBriefEligible === true,
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}
