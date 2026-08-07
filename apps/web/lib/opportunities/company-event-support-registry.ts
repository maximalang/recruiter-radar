import type { CompanyEventType } from './company-event-normalization'

export type CompanyEventSupportLevel =
  | 'production'
  | 'context_only'
  | 'unsupported'

export type CompanyEventSupportDefinition = {
  eventType: CompanyEventType
  support: CompanyEventSupportLevel
  realSource: string | null
  canTriggerCommercialEpisode: boolean
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
    realSource: 'approved vacancy source observation',
    canTriggerCommercialEpisode: false,
    evidencePolicy: 'Requires persisted source observation evidence; atomic vacancy observation is never a lead by itself.',
  },
  vacancy_repost: {
    eventType: 'vacancy_repost',
    support: 'production',
    realSource: 'deterministic comparison of evidenced vacancy observations',
    canTriggerCommercialEpisode: false,
    evidencePolicy: 'Requires distinct source observations of the same normalized role separated by the repost window.',
  },
  vacancy_salary_change: {
    eventType: 'vacancy_salary_change',
    support: 'production',
    realSource: 'deterministic comparison of evidenced vacancy salary snapshots',
    canTriggerCommercialEpisode: false,
    evidencePolicy: 'Requires evidenced before/after salary snapshots in the same currency and a material deterministic change.',
  },
  vacancy_cluster: {
    eventType: 'vacancy_cluster',
    support: 'production',
    realSource: 'deterministic cluster of evidenced vacancy observations',
    canTriggerCommercialEpisode: false,
    evidencePolicy: 'Requires multiple distinct evidenced vacancies in the same normalized role family and recent window.',
  },
  recruiter_vacancy: {
    eventType: 'recruiter_vacancy',
    support: 'production',
    realSource: 'evidenced vacancy observation for a recruiting role',
    canTriggerCommercialEpisode: false,
    evidencePolicy: 'Derived only from an evidenced vacancy whose normalized title is a recruiting/TA role; contextual evidence only.',
  },
  new_region: {
    eventType: 'new_region',
    support: 'production',
    realSource: 'evidenced vacancy history plus recent regional observations',
    canTriggerCommercialEpisode: false,
    evidencePolicy: 'Requires recent evidenced roles plus older company hiring history; persistence guard rejects first-observation false positives.',
  },
  hiring_restart: {
    eventType: 'hiring_restart',
    support: 'production',
    realSource: 'deterministic evidenced vacancy history',
    canTriggerCommercialEpisode: false,
    evidencePolicy: 'Requires evidenced historical hiring, a material quiet gap and multiple recent vacancies.',
  },
  leadership_change: {
    eventType: 'leadership_change',
    support: 'context_only',
    realSource: null,
    canTriggerCommercialEpisode: false,
    evidencePolicy: 'No active production ingestor. May only be used as context after a future permitted direct source is implemented; never infer with an LLM.',
  },
  new_business_unit: {
    eventType: 'new_business_unit',
    support: 'context_only',
    realSource: null,
    canTriggerCommercialEpisode: false,
    evidencePolicy: 'No active production ingestor. Requires future direct first-party/official evidence and cannot originate a lead alone.',
  },
  office_opening: {
    eventType: 'office_opening',
    support: 'context_only',
    realSource: null,
    canTriggerCommercialEpisode: false,
    evidencePolicy: 'No active production ingestor. Requires future direct official evidence and a separate hiring state change before commercial use.',
  },
  product_launch: {
    eventType: 'product_launch',
    support: 'context_only',
    realSource: null,
    canTriggerCommercialEpisode: false,
    evidencePolicy: 'No active production ingestor. Context only after future direct evidence; never synthesized from model text.',
  },
  funding_or_investment: {
    eventType: 'funding_or_investment',
    support: 'context_only',
    realSource: null,
    canTriggerCommercialEpisode: false,
    evidencePolicy: 'No active production ingestor. Context only after future directly attributable evidence; funding alone is not a staffing opportunity.',
  },
  major_contract: {
    eventType: 'major_contract',
    support: 'context_only',
    realSource: null,
    canTriggerCommercialEpisode: false,
    evidencePolicy: 'No active production ingestor. Context only after future direct evidence; contract claims cannot be inferred from vacancy text.',
  },
  career_page_change: {
    eventType: 'career_page_change',
    support: 'unsupported',
    realSource: null,
    canTriggerCommercialEpisode: false,
    evidencePolicy: 'Schema placeholder only. No production Company Event normalizer currently emits this event.',
  },
  hiring_slowdown: {
    eventType: 'hiring_slowdown',
    support: 'unsupported',
    realSource: null,
    canTriggerCommercialEpisode: false,
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
