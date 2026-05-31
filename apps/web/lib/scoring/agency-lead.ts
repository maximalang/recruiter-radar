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
import { selectConfidenceGate, type ConfidenceGateInput } from './gates'

export type LeadStatus =
  | 'new'
  | 'qualified'
  | 'contacted'
  | 'meeting'
  | 'proposal'
  | 'client'
  | 'lost'

export type LeadConfidence = 'A' | 'B' | 'C' | 'D'

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
  evidence: ConfidenceGateInput['evidence']
  entityMatch: ConfidenceGateInput['entityMatch']
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
  const confidence = selectConfidenceGate({
    evidence: input.evidence,
    entityMatch: input.entityMatch,
  })
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
