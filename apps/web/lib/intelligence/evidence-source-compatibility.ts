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
  'funding-business-signals': 'funding-business-signals',
  fedresurs: 'official-risk-registers',
  'transparent-business-fns': 'official-risk-registers',
  'company-newsrooms': 'official-company-news',
  'industry-media': 'industry-media',
  'github-company-org': 'industry-media',
  'youtube-company-channels': 'industry-media',
  'telegram-company-channels': 'public-vacancy-social-channels',
  'fns-open-data': 'sme-registry',
  'government-procurement': 'eis-procurement',
  'cbr-registry': 'official-address-license-registers',
  // Rosstat remains a distinct runtime provenance. This binding only selects the
  // closest governed Evidence Radar policy family for official regional context.
  'rosstat-open-data': 'government-regional-news',
  'rospatent-open-data': 'official-address-license-registers',
  // 2026-10 public source expansion (Class A): international job boards bind to
  // the professional-job-boards hiring family; community/news context binds to
  // industry-media corroboration; registries bind to the closest governed
  // identity or official open-data family.
  themuse: 'professional-job-boards',
  landingjobs: 'professional-job-boards',
  arbeitnow: 'professional-job-boards',
  remoteok: 'professional-job-boards',
  jobicy: 'professional-job-boards',
  himalayas: 'professional-job-boards',
  remotive: 'professional-job-boards',
  weworkremotely: 'professional-job-boards',
  'hackernews-jobs': 'professional-job-boards',
  'hn-algolia': 'industry-media',
  devto: 'industry-media',
  'gdelt-context': 'industry-media',
  // OpenAlex research works are publication-grade corroboration of R&D activity;
  // industry-media is the closest governed secondary-corroboration family.
  openalex: 'industry-media',
  // ROR provides canonical organization identity references (name, website,
  // aliases, country); egrul-egrip is the canonical-identity policy family.
  ror: 'egrul-egrip',
  // CBR daily FX is official macro context; government-regional-news is the
  // closest governed family for official non-company context (rosstat precedent).
  'cbr-fx-daily': 'government-regional-news',
  'trudvsem-opendata-datasets': 'rabota-rossii-open-data',
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
