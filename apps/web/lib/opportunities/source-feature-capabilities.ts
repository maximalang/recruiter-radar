import type { SourceId } from '@/lib/sources/source-registry'

export const SOURCE_FEATURES = [
  'vacancy',
  'salary_snapshot',
  'region',
  'normalized_role',
  'seniority',
  'stable_publication_identity',
  'requirements_snapshot',
  'corporate_contact',
  'economics',
  'market_benchmark',
  'procurement',
  'external_agency_history',
] as const

export type SourceFeature = typeof SOURCE_FEATURES[number]
export type SourceFeatureCapability = {
  status: 'supported' | 'conditional' | 'unsupported'
  reason: string
}

type CapabilitySet = Record<SourceFeature, SourceFeatureCapability>

const SUPPORTED = (reason: string): SourceFeatureCapability => ({
  status: 'supported', reason,
})
const CONDITIONAL = (reason: string): SourceFeatureCapability => ({
  status: 'conditional', reason,
})
const UNSUPPORTED = (reason: string): SourceFeatureCapability => ({
  status: 'unsupported', reason,
})

function vacancySource(input: {
  salary: boolean
  corporateContact?: boolean
}): CapabilitySet {
  return {
    vacancy: SUPPORTED('PERSISTED_VACANCY_OBSERVATION'),
    salary_snapshot: input.salary
      ? CONDITIONAL('ONLY_WHEN_SOURCE_EXPOSES_NORMALIZED_SALARY')
      : UNSUPPORTED('SOURCE_HAS_NO_NORMALIZED_SALARY_CONTRACT'),
    region: CONDITIONAL('ONLY_WHEN_SOURCE_EXPOSES_NORMALIZED_REGION'),
    normalized_role: CONDITIONAL('ONLY_WHEN_TITLE_NORMALIZES_TO_KNOWN_ROLE'),
    seniority: CONDITIONAL('ONLY_WHEN_TITLE_NORMALIZES_TO_KNOWN_SENIORITY'),
    stable_publication_identity: CONDITIONAL(
      'REQUIRES_STABLE_IDENTITY_AND_DISTINCT_PERSISTED_OBSERVATIONS',
    ),
    requirements_snapshot: UNSUPPORTED(
      'NO_VERSIONED_REQUIREMENTS_SNAPSHOT_PRODUCER',
    ),
    corporate_contact: input.corporateContact
      ? CONDITIONAL('ONLY_LAWFUL_PUBLIC_CORPORATE_CONTACT_PATHS')
      : UNSUPPORTED('SOURCE_NOT_A_CORPORATE_CONTACT_PRODUCER'),
    economics: UNSUPPORTED('SOURCE_NOT_AN_ECONOMICS_PRODUCER'),
    market_benchmark: UNSUPPORTED('NO_PERSISTED_MARKET_BENCHMARK_LAYER'),
    procurement: UNSUPPORTED('NO_CONFIRMED_PROCUREMENT_CONTRACT'),
    external_agency_history: UNSUPPORTED(
      'NO_CONFIRMED_EXTERNAL_AGENCY_USAGE_CONTRACT',
    ),
  }
}

function nonVacancySource(input: {
  corporateContact?: boolean
  economics?: boolean
} = {}): CapabilitySet {
  return {
    vacancy: UNSUPPORTED('SOURCE_NOT_A_VACANCY_PRODUCER'),
    salary_snapshot: UNSUPPORTED('SOURCE_NOT_A_VACANCY_PRODUCER'),
    region: UNSUPPORTED('SOURCE_NOT_A_VACANCY_PRODUCER'),
    normalized_role: UNSUPPORTED('SOURCE_NOT_A_VACANCY_PRODUCER'),
    seniority: UNSUPPORTED('SOURCE_NOT_A_VACANCY_PRODUCER'),
    stable_publication_identity: UNSUPPORTED('SOURCE_NOT_A_VACANCY_PRODUCER'),
    requirements_snapshot: UNSUPPORTED('SOURCE_NOT_A_VACANCY_PRODUCER'),
    corporate_contact: input.corporateContact
      ? CONDITIONAL('ONLY_LAWFUL_PUBLIC_CORPORATE_CONTACT_PATHS')
      : UNSUPPORTED('SOURCE_NOT_A_CORPORATE_CONTACT_PRODUCER'),
    economics: input.economics
      ? CONDITIONAL('ONLY_PERSISTED_VERSIONED_COMPANY_FACTS')
      : UNSUPPORTED('SOURCE_NOT_AN_ECONOMICS_PRODUCER'),
    market_benchmark: UNSUPPORTED('NO_PERSISTED_MARKET_BENCHMARK_LAYER'),
    procurement: UNSUPPORTED('NO_CONFIRMED_PROCUREMENT_CONTRACT'),
    external_agency_history: UNSUPPORTED(
      'NO_CONFIRMED_EXTERNAL_AGENCY_USAGE_CONTRACT',
    ),
  }
}

export const SOURCE_FEATURE_CAPABILITIES: Record<SourceId, CapabilitySet> = {
  hh: vacancySource({ salary: true }),
  superjob: vacancySource({ salary: true }),
  'habr-career': vacancySource({ salary: true }),
  'linkedin-company-pages': vacancySource({ salary: false }),
  'career-pages': vacancySource({ salary: true, corporateContact: true }),
  greenhouse: vacancySource({ salary: false }),
  lever: vacancySource({ salary: false }),
  ashby: vacancySource({ salary: false }),
  recruitee: vacancySource({ salary: false }),
  workable: vacancySource({ salary: false }),
  smartrecruiters: vacancySource({ salary: false }),
  'egrul-fns': nonVacancySource({ economics: true }),
  'rabota-rossii': vacancySource({ salary: true }),
  'company-site': vacancySource({ salary: true, corporateContact: true }),
  'funding-business-signals': nonVacancySource(),
  fedresurs: nonVacancySource({ economics: true }),
  'transparent-business-fns': nonVacancySource({ economics: true }),
  'company-newsrooms': nonVacancySource({ corporateContact: true }),
  'industry-media': nonVacancySource(),
  'github-company-org': nonVacancySource(),
  'youtube-company-channels': nonVacancySource(),
  'fns-open-data': nonVacancySource({ economics: true }),
  'government-procurement': nonVacancySource(),
  'cbr-registry': nonVacancySource(),
  'rosstat-open-data': nonVacancySource(),
  'rospatent-open-data': nonVacancySource(),
}

// Records ingested before the concrete ATS source IDs were introduced remain
// readable, but this compatibility map must not make the retired source
// runnable or add it back to the active source registry.
const LEGACY_SOURCE_FEATURE_CAPABILITIES: Readonly<Record<string, CapabilitySet>> = {
  'tech-job-boards': vacancySource({ salary: true }),
}

const SOURCE_ALIASES: Readonly<Record<string, SourceId>> = {
  'career-site': 'career-pages',
  trudvsem: 'rabota-rossii',
}

export function getSourceFeatureCapability(
  rawSource: string,
  feature: SourceFeature,
): SourceFeatureCapability {
  const normalized = rawSource.trim().toLocaleLowerCase('en-US')
  const source = (SOURCE_ALIASES[normalized] ?? normalized) as SourceId
  return SOURCE_FEATURE_CAPABILITIES[source]?.[feature]
    ?? LEGACY_SOURCE_FEATURE_CAPABILITIES[normalized]?.[feature]
    ?? {
    status: 'unsupported',
    reason: 'SOURCE_NOT_REGISTERED',
  }
}
