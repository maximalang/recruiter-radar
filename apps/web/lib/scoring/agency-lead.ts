/**
 * Unified AgencyLead format.
 *
 * Pure helper that folds the outputs of the various scoring helpers (FIUR,
 * source aggregation, lead freshness, contact quality) into a single lead
 * object the rest of the pipeline can persist, deliver via Telegram digest,
 * and surface in the dashboard. No I/O — callers feed in already-computed
 * inputs.
 */

import type { AggregationResult, SourceBreakdownEntry } from './source-aggregation'
import type { FreshnessResult } from './lead-freshness'
import type { ContactQualityResult } from './contact-quality'

export type LeadStatus =
  | 'new'
  | 'qualified'
  | 'contacted'
  | 'meeting'
  | 'proposal'
  | 'client'
  | 'lost'

export type LeadConfidence = 'high' | 'medium' | 'low'

export type LeadActionKind = 'outreach' | 'enrich-contacts' | 'review' | 'wait'

export interface LeadAction {
  kind: LeadActionKind
  hint: string
}

export interface HiringSource {
  source: string
  itemCount: number
  topTier: SourceBreakdownEntry['topTier']
  weight: number
}

export interface LeadCompany {
  id: string
  name: string
  website?: string
}

export interface FiurSummary {
  fit: number
  intent: number
  urgency: number
  reachability: number
  total: number
  reasons: string[]
}

export interface AgencyLeadInput {
  id: string
  company: LeadCompany
  fiur: FiurSummary
  sourceAggregation: AggregationResult
  freshness: FreshnessResult
  contactQuality: ContactQualityResult
  status?: LeadStatus
  assignedTo?: string
  now?: Date | (() => number)
}

export interface AgencyLead {
  id: string
  company: LeadCompany
  status: LeadStatus
  score: number
  confidence: LeadConfidence
  sources: HiringSource[]
  nextAction: LeadAction
  reasons: string[]
  assignedTo: string | null
  createdAt: Date
  updatedAt: Date
}

function resolveNowDate(now: AgencyLeadInput['now']): Date {
  if (now instanceof Date) return now
  if (typeof now === 'function') return new Date(now())
  return new Date()
}

function deriveConfidence(
  fiurTotal: number,
  freshness: FreshnessResult,
  aggregation: AggregationResult,
  contactQuality: ContactQualityResult
): LeadConfidence {
  let points = 0
  if (fiurTotal >= 2.5) points += 2
  else if (fiurTotal >= 1.8) points += 1

  if (aggregation.hasMultiSourceConfirmation) points += 2
  else if (aggregation.independentSources >= 1) points += 1

  if (freshness.meetsSla) points += 2
  else if (freshness.status === 'fresh' || freshness.status === 'aging') points += 1

  if (contactQuality.tier === 'rich') points += 1
  else if (contactQuality.tier === 'ok') points += 0

  if (points >= 6) return 'high'
  if (points >= 3) return 'medium'
  return 'low'
}

function deriveNextAction(
  freshness: FreshnessResult,
  contactQuality: ContactQualityResult
): LeadAction {
  if (freshness.status === 'stale' || freshness.status === 'expired') {
    return {
      kind: 'review',
      hint: 'Evidence is stale — re-verify the signal before reaching out',
    }
  }

  if (!contactQuality.hasHrChannel || contactQuality.tier === 'weak' || contactQuality.tier === 'none') {
    return {
      kind: 'enrich-contacts',
      hint: 'No HR-purpose contact path yet — enrich contacts before outreach',
    }
  }

  return {
    kind: 'outreach',
    hint: 'Fresh signal with HR-purpose channel — start outreach now',
  }
}

function flattenSources(aggregation: AggregationResult): HiringSource[] {
  return aggregation.breakdown.map((b) => ({
    source: b.source,
    itemCount: b.itemCount,
    topTier: b.topTier,
    weight: b.weight,
  }))
}

function aggregateReasons(input: AgencyLeadInput): string[] {
  return [...input.fiur.reasons, ...input.contactQuality.reasons]
}

export function buildAgencyLead(input: AgencyLeadInput): AgencyLead {
  const now = resolveNowDate(input.now)
  const confidence = deriveConfidence(
    input.fiur.total,
    input.freshness,
    input.sourceAggregation,
    input.contactQuality
  )
  const nextAction = deriveNextAction(input.freshness, input.contactQuality)

  return {
    id: input.id,
    company: input.company,
    status: input.status ?? 'new',
    score: input.fiur.total,
    confidence,
    sources: flattenSources(input.sourceAggregation),
    nextAction,
    reasons: aggregateReasons(input),
    assignedTo: input.assignedTo ?? null,
    createdAt: now,
    updatedAt: now,
  }
}
