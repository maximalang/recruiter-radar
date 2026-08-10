import {
  COMPANY_EVENT_TYPES,
  type CompanyEventType,
} from './company-event-normalization'

export type CompanyEventSupportLevel =
  | 'production'
  | 'context_only'
  | 'unsupported'

export type CompanyEventSupportDefinition = {
  eventType: CompanyEventType
  support: CompanyEventSupportLevel
  producer: string | null
  realSource: string | null
  payloadVersion: string | null
  canTriggerCommercialEpisode: boolean
  canStrengthenCommercialEpisode: boolean
  consumers: readonly string[]
  productionTested: boolean
  evidencePolicy: string
}

/**
 * Operational source-of-truth for Company Event support.
 *
 * The schema intentionally contains event types ahead of production ingestion.
 * Presence in the enum is NOT permission to originate a Commercial Signal.
 * Context-only events may strengthen/classify a situation only when another
 * evidence-backed Company State change already triggered the episode.
 */
export const COMPANY_EVENT_SUPPORT_REGISTRY = {
  job_posting: {
    eventType: 'job_posting',
    support: 'production',
    producer: 'company-event-normalization',
    realSource: 'approved vacancy source observation',
    payloadVersion: 'company-event-normalizer-v1',
    canTriggerCommercialEpisode: false,
    canStrengthenCommercialEpisode: false,
    consumers: ['Company State'],
    productionTested: true,
    evidencePolicy: 'Requires persisted source observation evidence; atomic vacancy observation is never a lead by itself.',
  },
  vacancy_repost: {
    eventType: 'vacancy_repost',
    support: 'production',
    producer: 'company-event-normalization',
    realSource: 'deterministic comparison of evidenced vacancy observations',
    payloadVersion: 'vacancy-repost-v2',
    canTriggerCommercialEpisode: false,
    canStrengthenCommercialEpisode: true,
    consumers: ['Company State', 'Signal Episode', 'Quality v2'],
    productionTested: true,
    evidencePolicy: 'Requires distinct source observations of the same normalized role separated by the repost window.',
  },
  vacancy_salary_change: {
    eventType: 'vacancy_salary_change',
    support: 'production',
    producer: 'company-event-normalization',
    realSource: 'deterministic comparison of evidenced vacancy salary snapshots',
    payloadVersion: 'company-event-normalizer-v1',
    canTriggerCommercialEpisode: false,
    canStrengthenCommercialEpisode: true,
    consumers: ['Company State', 'Signal Episode', 'Quality v2'],
    productionTested: true,
    evidencePolicy: 'Requires evidenced before/after salary snapshots in the same currency and a material deterministic change.',
  },
  vacancy_cluster: {
    eventType: 'vacancy_cluster',
    support: 'production',
    producer: 'company-event-normalization',
    realSource: 'deterministic cluster of evidenced vacancy observations',
    payloadVersion: 'company-event-normalizer-v1',
    canTriggerCommercialEpisode: false,
    canStrengthenCommercialEpisode: true,
    consumers: ['Company State', 'Signal Episode', 'Quality v2'],
    productionTested: true,
    evidencePolicy: 'Requires multiple distinct evidenced vacancies in the same normalized role family and recent window.',
  },
  recruiter_vacancy: {
    eventType: 'recruiter_vacancy',
    support: 'production',
    producer: 'company-event-normalization',
    realSource: 'evidenced vacancy observation for a recruiting role',
    payloadVersion: 'company-event-normalizer-v1',
    canTriggerCommercialEpisode: false,
    canStrengthenCommercialEpisode: true,
    consumers: ['Company State', 'Signal Episode', 'Quality v2'],
    productionTested: true,
    evidencePolicy: 'Derived only from an evidenced vacancy whose normalized title is a recruiting/TA role; contextual evidence only.',
  },
  new_region: {
    eventType: 'new_region',
    support: 'production',
    producer: 'company-event-normalization',
    realSource: 'evidenced vacancy history plus recent regional observations',
    payloadVersion: 'company-event-normalizer-v1',
    canTriggerCommercialEpisode: false,
    canStrengthenCommercialEpisode: true,
    consumers: ['Company State', 'Signal Episode', 'Quality v2'],
    productionTested: true,
    evidencePolicy: 'Requires recent evidenced roles plus older company hiring history; persistence guard rejects first-observation false positives.',
  },
  hiring_restart: {
    eventType: 'hiring_restart',
    support: 'production',
    producer: 'company-event-normalization',
    realSource: 'deterministic evidenced vacancy history',
    payloadVersion: 'company-event-normalizer-v1',
    canTriggerCommercialEpisode: false,
    canStrengthenCommercialEpisode: true,
    consumers: ['Company State', 'Signal Episode', 'Quality v2'],
    productionTested: true,
    evidencePolicy: 'Requires evidenced historical hiring, a material quiet gap and multiple recent vacancies.',
  },
  leadership_change: {
    eventType: 'leadership_change',
    support: 'context_only',
    producer: null,
    realSource: null,
    payloadVersion: null,
    canTriggerCommercialEpisode: false,
    canStrengthenCommercialEpisode: false,
    consumers: [],
    productionTested: false,
    evidencePolicy: 'No active production ingestor. May only be used as context after a future permitted direct source is implemented; never infer with an LLM.',
  },
  new_business_unit: {
    eventType: 'new_business_unit',
    support: 'context_only',
    producer: null,
    realSource: null,
    payloadVersion: null,
    canTriggerCommercialEpisode: false,
    canStrengthenCommercialEpisode: false,
    consumers: [],
    productionTested: false,
    evidencePolicy: 'No active production ingestor. Requires future direct first-party/official evidence and cannot originate a lead alone.',
  },
  office_opening: {
    eventType: 'office_opening',
    support: 'context_only',
    producer: null,
    realSource: null,
    payloadVersion: null,
    canTriggerCommercialEpisode: false,
    canStrengthenCommercialEpisode: false,
    consumers: [],
    productionTested: false,
    evidencePolicy: 'No active production ingestor. Requires future direct official evidence and a separate hiring state change before commercial use.',
  },
  product_launch: {
    eventType: 'product_launch',
    support: 'context_only',
    producer: null,
    realSource: null,
    payloadVersion: null,
    canTriggerCommercialEpisode: false,
    canStrengthenCommercialEpisode: false,
    consumers: [],
    productionTested: false,
    evidencePolicy: 'No active production ingestor. Context only after future direct evidence; never synthesized from model text.',
  },
  funding_or_investment: {
    eventType: 'funding_or_investment',
    support: 'context_only',
    producer: null,
    realSource: null,
    payloadVersion: null,
    canTriggerCommercialEpisode: false,
    canStrengthenCommercialEpisode: false,
    consumers: [],
    productionTested: false,
    evidencePolicy: 'No active production ingestor. Context only after future directly attributable evidence; funding alone is not a staffing opportunity.',
  },
  major_contract: {
    eventType: 'major_contract',
    support: 'context_only',
    producer: null,
    realSource: null,
    payloadVersion: null,
    canTriggerCommercialEpisode: false,
    canStrengthenCommercialEpisode: false,
    consumers: [],
    productionTested: false,
    evidencePolicy: 'No active production ingestor. Context only after future direct evidence; contract claims cannot be inferred from vacancy text.',
  },
  career_page_change: {
    eventType: 'career_page_change',
    support: 'unsupported',
    producer: null,
    realSource: null,
    payloadVersion: null,
    canTriggerCommercialEpisode: false,
    canStrengthenCommercialEpisode: false,
    consumers: [],
    productionTested: false,
    evidencePolicy: 'Schema placeholder only. No production Company Event normalizer currently emits this event.',
  },
  hiring_slowdown: {
    eventType: 'hiring_slowdown',
    support: 'unsupported',
    producer: null,
    realSource: null,
    payloadVersion: null,
    canTriggerCommercialEpisode: false,
    canStrengthenCommercialEpisode: false,
    consumers: ['Company State Change', 'Quality v2'],
    productionTested: true,
    evidencePolicy: 'Handled through Company State deceleration/baseline semantics, not emitted as a production Company Event.',
  },
} as const satisfies Record<CompanyEventType, CompanyEventSupportDefinition>

export function getCompanyEventSupport(
  eventType: CompanyEventType,
): CompanyEventSupportDefinition {
  return COMPANY_EVENT_SUPPORT_REGISTRY[eventType]
}

export function isProductionCompanyEvent(eventType: CompanyEventType): boolean {
  return COMPANY_EVENT_SUPPORT_REGISTRY[eventType].support === 'production'
}

export function renderCompanyEventSupportMatrixMarkdown(): string {
  const header = [
    '| Event type | Producer | Source | Status | Payload version | Trigger | Strengthen | Consumer | Production tested |',
    '|---|---|---|---|---|---:|---:|---|---:|',
  ]
  const rows = COMPANY_EVENT_TYPES.map((eventType) => {
    const item = COMPANY_EVENT_SUPPORT_REGISTRY[eventType]
    return `| ${eventType} | ${item.producer ?? 'none'} | ${item.realSource ?? 'none'} | ${item.support} | ${item.payloadVersion ?? 'none'} | ${yesNo(item.canTriggerCommercialEpisode)} | ${yesNo(item.canStrengthenCommercialEpisode)} | ${item.consumers.join(', ') || 'none'} | ${yesNo(item.productionTested)} |`
  })
  return [...header, ...rows].join('\n')
}

function yesNo(value: boolean): 'yes' | 'no' {
  return value ? 'yes' : 'no'
}
