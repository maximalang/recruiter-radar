/**
 * Scoring pipeline orchestrator.
 *
 * Pure helper that wires the nine scoring sub-helpers (FIUR, source
 * aggregation, lead freshness, contact quality, industry alignment,
 * geographic fit, salary level, market fit, departments) into a single
 * AgencyLead output. No I/O — callers feed in already-collected evidence,
 * vacancies, contacts, and agency profile, and receive a fully-built
 * AgencyLead plus the per-helper breakdown for storage and explainability.
 *
 * The orchestrator is the runtime entry point for the lead-scoring stage:
 * a future ingest worker reads raw signals from sources, hydrates this
 * input shape, calls runScoringPipeline, and persists the result. Keeping
 * it pure means it stays trivially testable and free of database coupling.
 */

import { computeFiur } from '@/lib/scoring/fiur'
import type {
  EvidenceTier,
  FiurClientOverrides,
  FiurEvidenceItem,
  FiurVacancy,
} from '@/lib/scoring/fiur'
import {
  aggregateSourceSignals,
  type AggregationInput,
  type AggregationResult,
} from '@/lib/scoring/source-aggregation'
import {
  computeLeadFreshness,
  type FreshnessInput,
  type FreshnessResult,
} from '@/lib/scoring/lead-freshness'
import {
  computeContactQuality,
  type ContactQualityResult,
} from '@/lib/scoring/contact-quality'
import type { ContactPath } from '@/lib/scoring/contact-paths'
import {
  computeIndustryAlignment,
  type IndustryAlignmentResult,
} from '@/lib/scoring/industry-alignment'
import {
  computeGeographicFit,
  type GeographicFitResult,
} from '@/lib/scoring/geographic-fit'
import {
  analyzeSalaryLevel,
  type SalaryAnalysisOptions,
  type SalaryAnalysisResult,
  type SalaryCurrency,
  type SalaryVacancyInput,
} from '@/lib/scoring/salary-level'
import {
  computeMarketFit,
  type MarketFitInput,
  type MarketFitResult,
} from '@/lib/scoring/market-fit'
import { extractDepartments, type Department } from '@/lib/scoring/departments'
import { buildAgencyLead, type AgencyLead, type LeadStatus } from '@/lib/scoring/agency-lead'

export interface PipelineCompany {
  id: string
  name: string
  website?: string
  industry?: string
  industries?: string[]
  locations?: string[]
  size?: 'startup' | 'small' | 'medium' | 'large' | 'enterprise'
  employeeCount?: number
  hasCareerPage?: boolean
  hasCorporateContactPath?: boolean
}

export interface PipelineVacancy extends FiurVacancy {
  salaryFrom?: number | null
  salaryTo?: number | null
  salaryCurrency?: SalaryCurrency
}

export interface PipelineEvidence {
  source: string
  tier: EvidenceTier
  fetchedAt: string | Date
}

export interface AgencyProfile {
  industries: string[]
  locations: string[]
  roles?: string[]
  companySizes?: NonNullable<PipelineCompany['size']>[]
  excludedIndustries?: string[]
  excludedLocations?: string[]
  exclusions?: string[]
  remoteFriendly?: boolean
}

export interface ScoringPipelineInput {
  leadId: string
  company: PipelineCompany
  vacancies: PipelineVacancy[]
  evidence: PipelineEvidence[]
  contactPaths: ContactPath[]
  agencyProfile: AgencyProfile
  marketContext?: MarketFitInput
  careerPageHtml?: string
  salaryRates?: SalaryAnalysisOptions
  status?: LeadStatus
  assignedTo?: string
  clientOverrides?: FiurClientOverrides
  now?: Date | (() => number)
}

export interface ScoringPipelineBreakdown {
  fiur: ReturnType<typeof computeFiur>
  sourceAggregation: AggregationResult
  freshness: FreshnessResult
  contactQuality: ContactQualityResult
  industryAlignment: IndustryAlignmentResult
  geographicFit: GeographicFitResult
  salaryAnalysis: SalaryAnalysisResult
  marketFit: MarketFitResult
  departments: Department[]
}

export interface ScoringPipelineResult {
  lead: AgencyLead
  breakdown: ScoringPipelineBreakdown
}

function resolveNowMs(now: ScoringPipelineInput['now']): number {
  if (now instanceof Date) return now.getTime()
  if (typeof now === 'function') return now()
  return Date.now()
}

function toAggregationInputs(evidence: PipelineEvidence[]): AggregationInput[] {
  return evidence.map((e) => ({ source: e.source, tier: e.tier, fetchedAt: e.fetchedAt }))
}

function toFreshnessInputs(evidence: PipelineEvidence[]): FreshnessInput[] {
  return evidence.map((e) => ({ fetchedAt: e.fetchedAt }))
}

function toFiurEvidence(evidence: PipelineEvidence[]): FiurEvidenceItem[] {
  return evidence.map((e) => ({ source: e.source, tier: e.tier }))
}

function toSalaryInputs(vacancies: PipelineVacancy[]): SalaryVacancyInput[] {
  return vacancies.map((v) => ({
    salaryFrom: v.salaryFrom ?? null,
    salaryTo: v.salaryTo ?? null,
    salaryCurrency: v.salaryCurrency,
  }))
}

function deriveCompanyIndustries(company: PipelineCompany): string[] {
  if (company.industries && company.industries.length > 0) return company.industries
  if (company.industry) return [company.industry]
  return []
}

function deriveCompanyLocations(company: PipelineCompany, vacancies: PipelineVacancy[]): string[] {
  const fromCompany = company.locations ?? []
  const fromVacancies = vacancies.map((v) => v.location).filter((x): x is string => Boolean(x))
  const seen = new Set<string>()
  const out: string[] = []
  for (const loc of [...fromCompany, ...fromVacancies]) {
    const key = loc.trim().toLowerCase()
    if (!seen.has(key) && key.length > 0) {
      seen.add(key)
      out.push(loc)
    }
  }
  return out
}

export function runScoringPipeline(input: ScoringPipelineInput): ScoringPipelineResult {
  const nowMs = resolveNowMs(input.now)
  const nowDate = new Date(nowMs)

  const sourceAggregation = aggregateSourceSignals(toAggregationInputs(input.evidence))
  const freshness = computeLeadFreshness(toFreshnessInputs(input.evidence), { now: () => nowMs })
  const contactQuality = computeContactQuality(input.contactPaths)
  const industryAlignment = computeIndustryAlignment({
    targetIndustries: input.agencyProfile.industries,
    excludedIndustries: input.agencyProfile.excludedIndustries,
    companyIndustries: deriveCompanyIndustries(input.company),
  })
  const geographicFit = computeGeographicFit({
    targetGeographies: input.agencyProfile.locations,
    excludedGeographies: input.agencyProfile.excludedLocations,
    companyLocations: deriveCompanyLocations(input.company, input.vacancies),
    remoteFriendly: input.agencyProfile.remoteFriendly,
  })
  const salaryAnalysis = analyzeSalaryLevel(toSalaryInputs(input.vacancies), input.salaryRates)
  const marketFit = computeMarketFit(input.marketContext ?? {})
  const departments = input.careerPageHtml ? extractDepartments(input.careerPageHtml) : []

  const fiur = computeFiur({
    company: {
      id: input.company.id,
      name: input.company.name,
      industry: input.company.industry,
      location: input.company.locations?.[0],
      size: input.company.size,
      employeeCount: input.company.employeeCount,
      hasCareerPage: input.company.hasCareerPage,
      hasCorporateContactPath: input.company.hasCorporateContactPath,
    },
    vacancies: input.vacancies,
    clientProfile: {
      industries: input.agencyProfile.industries,
      roles: input.agencyProfile.roles ?? [],
      locations: input.agencyProfile.locations,
      companySizes: input.agencyProfile.companySizes,
      exclusions: input.agencyProfile.exclusions,
    },
    evidence: toFiurEvidence(input.evidence),
    now: () => nowMs,
    clientOverrides: input.clientOverrides,
  })

  const fiurReasons: string[] = [
    ...fiur.reasons.fit,
    ...fiur.reasons.intent,
    ...fiur.reasons.urgency,
    ...fiur.reasons.reachability,
  ]

  const lead = buildAgencyLead({
    id: input.leadId,
    company: {
      id: input.company.id,
      name: input.company.name,
      website: input.company.website,
    },
    fiur: {
      fit: fiur.fit,
      intent: fiur.intent,
      urgency: fiur.urgency,
      reachability: fiur.reachability,
      total: fiur.total,
      reasons: fiurReasons,
    },
    sourceAggregation,
    freshness,
    contactQuality,
    evidence: toFiurEvidence(input.evidence),
    entityMatch: 'clean' as const,
    status: input.status,
    assignedTo: input.assignedTo,
    now: nowDate,
  })

  if (industryAlignment.match === 'excluded' || geographicFit.match === 'excluded') {
    lead.confidence = 'D'
    lead.nextAction = {
      kind: 'review',
      hint: 'Company touches an excluded industry or geography — review ICP before outreach',
    }
  }

  return {
    lead,
    breakdown: {
      fiur,
      sourceAggregation,
      freshness,
      contactQuality,
      industryAlignment,
      geographicFit,
      salaryAnalysis,
      marketFit,
      departments,
    },
  }
}
