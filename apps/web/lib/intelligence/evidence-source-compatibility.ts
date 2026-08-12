import {
  getAllSourceIds,
  getSourceConfig,
  type SourceId,
} from '@/lib/sources/source-registry'

import {
  getSourceRegistryEntry,
  type SourceRegistryEntry,
} from './source-registry'

export const EVIDENCE_RUNTIME_SOURCE_BINDINGS = {
  hh: 'headhunter-api',
  superjob: 'professional-job-boards',
  'habr-career': 'professional-job-boards',
  'linkedin-company-pages': 'public-vacancy-social-channels',
  'career-pages': 'company-career-pages',
  greenhouse: 'public-ats',
  lever: 'public-ats',
  ashby: 'public-ats',
  recruitee: 'public-ats',
  workable: 'public-ats',
  smartrecruiters: 'public-ats',
  'egrul-fns': 'egrul-egrip',
  'rabota-rossii': 'rabota-rossii-open-data',
  'company-site': 'official-product-surfaces',
  'tech-job-boards': 'professional-job-boards',
  'regional-job-boards': 'professional-job-boards',
  'funding-business-signals': 'funding-business-signals',
  fedresurs: 'official-risk-registers',
  'transparent-business-fns': 'official-risk-registers',
  'company-newsrooms': 'official-company-news',
  'industry-media': 'industry-media',
  'fns-open-data': 'sme-registry',
  'government-procurement': 'eis-procurement',
  'cbr-registry': 'official-address-license-registers',
  // Rosstat remains a distinct runtime provenance. This binding only selects the
  // closest governed Evidence Radar policy family for official regional context.
  'rosstat-open-data': 'government-regional-news',
  'rospatent-open-data': 'official-address-license-registers',
} as const satisfies Record<SourceId, string>

export type EvidenceRuntimeSourceBinding = {
  runtimeSourceId: SourceId
  runtimeSourceName: string
  evidenceSourceRegistryId: string
  evidencePolicy: SourceRegistryEntry
  runtimePrimary: boolean
  runtimeCategory: string
}

export function listEvidenceRuntimeSourceBindings(): EvidenceRuntimeSourceBinding[] {
  return getAllSourceIds().map((runtimeSourceId) => {
    const config = getSourceConfig(runtimeSourceId)
    const evidenceSourceRegistryId = EVIDENCE_RUNTIME_SOURCE_BINDINGS[runtimeSourceId]
    const evidencePolicy = getSourceRegistryEntry(evidenceSourceRegistryId)
    if (!evidencePolicy) {
      throw new Error(
        `Evidence source policy ${evidenceSourceRegistryId} is missing for ${runtimeSourceId}.`,
      )
    }
    return {
      runtimeSourceId,
      runtimeSourceName: config.name,
      evidenceSourceRegistryId,
      evidencePolicy,
      runtimePrimary: config.isPrimary,
      runtimeCategory: config.category,
    }
  })
}

export function validateEvidenceRuntimeSourceBindings(): string[] {
  const errors: string[] = []
  const runtimeSources = getAllSourceIds()
  const boundSources = Object.keys(EVIDENCE_RUNTIME_SOURCE_BINDINGS) as SourceId[]

  for (const runtimeSourceId of runtimeSources) {
    if (!boundSources.includes(runtimeSourceId)) {
      errors.push(`${runtimeSourceId}: runtime source has no Evidence Radar policy`)
      continue
    }
    const policyId = EVIDENCE_RUNTIME_SOURCE_BINDINGS[runtimeSourceId]
    const policy = getSourceRegistryEntry(policyId)
    if (!policy) errors.push(`${runtimeSourceId}: missing Evidence Radar policy ${policyId}`)
  }

  for (const runtimeSourceId of boundSources) {
    if (!runtimeSources.includes(runtimeSourceId)) {
      errors.push(`${runtimeSourceId}: Evidence Radar binding points to unknown runtime source`)
    }
  }
  return errors
}
