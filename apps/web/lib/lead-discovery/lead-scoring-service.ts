/**
 * Lead Scoring Service
 *
 * Bridges the multi-source lead generator with the scoring pipeline,
 * converting raw leads from multiple sources into scored and ranked
 * agency leads with explainable breakdowns.
 */

import { runScoringPipeline } from '@/lib/scoring/scoring-pipeline'
import {
  MultiSourceLeadGenerator,
  type MultiSourceLeadGeneratorDeps,
} from './multi-source-lead-generator'
import type {
  MultiSourceLead,
  EvidenceSource,
} from './multi-source-lead-generator'
import type { AggregatedLead } from './lead-aggregator'
import type { HiringSignal } from './hiring-pattern-detector'
import type {
  ScoringPipelineInput,
  ScoringPipelineResult,
  PipelineCompany,
  PipelineVacancy,
  PipelineEvidence,
  AgencyProfile,
} from '@/lib/scoring/scoring-pipeline'
import type { MarketFitInput, IndustryTrend } from '@/lib/scoring/market-fit'
import type { ContactPath } from '@/lib/scoring/contact-paths'
import type { HhDigestItem } from '@/lib/hhDigest'

export interface LeadScoringOptions {
  digestItems: HhDigestItem[]
  agencyProfile: AgencyProfile
  sources?: string[]
  minScore?: number
  marketContext?: MarketFitInput
}

export interface ScoredLead extends AggregatedLead {
  scoringBreakdown: ScoringPipelineResult['breakdown']
  finalScore: number
  confidenceBoost: number
  improvementSuggestions: string[]
}

const RECENT_SIGNAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Service that runs the multi-source generator and scores each lead via
 * the FIUR-based scoring pipeline.
 */
export class LeadScoringService {
  private leadGenerator: MultiSourceLeadGenerator

  constructor(deps: MultiSourceLeadGeneratorDeps = {}) {
    this.leadGenerator = new MultiSourceLeadGenerator(deps)
  }

  async generateAndScoreLeads(options: LeadScoringOptions): Promise<ScoredLead[]> {
    const rawLeads = await this.leadGenerator.generateLeads({
      digestItems: options.digestItems,
      industries: options.agencyProfile.industries,
      regions: options.agencyProfile.locations,
      minScore: options.minScore ?? 1.0,
      sources: options.sources,
    })

    const scoredLeads = rawLeads.map(lead => this.scoreLead(lead, options))

    return scoredLeads
      .filter(lead => lead.finalScore >= (options.minScore ?? 1.0))
      .sort((a, b) => b.finalScore - a.finalScore)
  }

  private scoreLead(lead: MultiSourceLead, options: LeadScoringOptions): ScoredLead {
    const pipelineInput = this.convertToScoringInput(lead, options)
    const result = runScoringPipeline(pipelineInput)
    const enhancement = this.enhanceScoring(result, lead, options)

    const detectedAt = lead.detectedAt
    return {
      id: lead.id,
      canonicalCompanyId: lead.companyId,
      companyName: lead.companyName,
      displayName: lead.companyName,
      score: enhancement.finalScore,
      confidence: this.mapConfidence(result.lead.confidence),
      sources: lead.sources.map(s => ({
        sourceId: s.sourceId,
        sourceName: s.sourceName,
        evidenceType: s.evidenceType,
        confidence: s.confidence,
        relevanceScore: s.relevanceScore,
        contributedSignals: lead.signals,
        extractedAt: s.extractedAt,
      })),
      signals: lead.signals,
      deduplication: { strategy: 'exact', matchedWith: [], confidence: 1.0 },
      metadata: {
        firstSeen: detectedAt,
        lastUpdated: new Date(),
        sourceCount: lead.sources.length,
        uniqueSignals: new Set(lead.signals.map(s => `${s.signalType}-${s.strength}`)).size,
      },
      qualityMetrics: { completeness: 1, freshness: 1, reliability: 1 },
      nextAction: lead.nextAction,
      reasons: lead.reasons,
      detectedAt,
      enrichment: lead.enrichment,
      scoringBreakdown: result.breakdown,
      finalScore: enhancement.finalScore,
      confidenceBoost: enhancement.confidenceBoost,
      improvementSuggestions: enhancement.improvementSuggestions,
    }
  }

  private mapConfidence(confidence: string): 'A' | 'B' | 'C' | 'D' {
    const map: Record<string, 'A' | 'B' | 'C' | 'D'> = {
      high: 'A',
      medium: 'B',
      low: 'C',
      A: 'A',
      B: 'B',
      C: 'C',
      D: 'D',
    }
    return map[confidence] ?? 'D'
  }

  private convertToScoringInput(
    lead: MultiSourceLead,
    options: LeadScoringOptions,
  ): ScoringPipelineInput {
    const company: PipelineCompany = {
      id: lead.companyId,
      name: lead.companyName,
      website: lead.enrichment.website,
      industry: lead.enrichment.industry?.[0],
      industries: lead.enrichment.industry,
      locations: lead.enrichment.locations,
      size: this.mapCompanySize(lead.enrichment.companySize),
      employeeCount: lead.enrichment.employeeCount,
      hasCareerPage: lead.enrichment.hasCareerPage,
      hasCorporateContactPath: lead.enrichment.hasContactPath,
    }

    const vacancies: PipelineVacancy[] = lead.signals
      .filter(signal => signal.signalType === 'burst' || signal.signalType === 'fresh')
      .map((signal, index) => ({
        id: `signal-${lead.id}-${index}`,
        title: this.extractRoleTitle(signal),
        role: this.normalizeRole(signal),
        location: lead.enrichment.locations?.[0] ?? '',
        publishedAt: signal.detectedAt.toISOString(),
        isInternalRecruiter: signal.evidence?.includes('internal'),
        isHardToFill: signal.evidence?.includes('hard_to_fill'),
        sourceTier: this.mapEvidenceTier(signal),
        salaryFrom: null,
        salaryTo: null,
        salaryCurrency: 'RUB',
      }))

    const evidence: PipelineEvidence[] = lead.sources.map(source => ({
      source: source.sourceId,
      tier: this.mapEvidenceTierFromSource(source),
      fetchedAt: source.extractedAt.toISOString(),
    }))

    const contactPaths: ContactPath[] = this.extractContactPaths(lead)

    return {
      leadId: lead.id,
      company,
      vacancies,
      evidence,
      contactPaths,
      agencyProfile: options.agencyProfile,
      marketContext: options.marketContext,
    }
  }

  private enhanceScoring(
    result: ScoringPipelineResult,
    lead: MultiSourceLead,
    options: LeadScoringOptions,
  ) {
    let finalScore = result.lead.score
    let confidenceBoost = 0
    const improvementSuggestions: string[] = []

    if (lead.sources.length > 2) {
      finalScore += 0.2
      confidenceBoost += 0.3
      improvementSuggestions.push('multiple independent sources increase reliability')
    }

    const now = Date.now()
    const recentSignals = lead.signals.filter(signal => {
      const ts = signal.detectedAt instanceof Date ? signal.detectedAt.getTime() : 0
      return ts > 0 && now - ts <= RECENT_SIGNAL_WINDOW_MS
    })
    if (recentSignals.length >= 3) {
      finalScore += 0.15
      confidenceBoost += 0.2
      improvementSuggestions.push('recent hiring signals indicate active hiring')
    }

    const trend = this.deriveIndustryTrend(options.marketContext)
    if (trend === 'growing') {
      finalScore *= 1.1
      improvementSuggestions.push('growing industry boosts lead value')
    } else if (trend === 'declining') {
      finalScore *= 0.9
      improvementSuggestions.push('declining industry — consider focus on resilient verticals')
    }

    finalScore = Math.max(0, Math.min(4, finalScore))
    return { finalScore, confidenceBoost, improvementSuggestions }
  }

  private deriveIndustryTrend(marketContext?: MarketFitInput): IndustryTrend | undefined {
    return marketContext?.industryTrend
  }

  private mapCompanySize(size?: string): PipelineCompany['size'] {
    if (!size) return undefined
    const sizeMap: Record<string, PipelineCompany['size']> = {
      startup: 'startup',
      small: 'small',
      '50-100': 'small',
      '100-500': 'medium',
      medium: 'medium',
      '500-1000': 'medium',
      large: 'large',
      '1000+': 'large',
      enterprise: 'enterprise',
    }
    return sizeMap[size]
  }

  private mapEvidenceTier(signal: HiringSignal): PipelineEvidence['tier'] {
    if (signal.evidence?.includes('direct')) return 'direct'
    if (signal.evidence?.includes('corroboration')) return 'corroboration'
    return 'context'
  }

  private mapEvidenceTierFromSource(source: EvidenceSource): PipelineEvidence['tier'] {
    const directSources = new Set(['career-pages', 'hh', 'rabota-rossii'])
    const corroborationSources = new Set(['linkedin-company-pages', 'superjob', 'habr-career', 'tech-job-boards'])
    if (directSources.has(source.sourceId)) return 'direct'
    if (corroborationSources.has(source.sourceId)) return 'corroboration'
    return 'context'
  }

  private extractRoleTitle(signal: HiringSignal): string {
    const evidence = signal.evidence ?? []
    const roleMatch = evidence.find(e => e.includes('role:'))
    if (roleMatch) {
      const parts = roleMatch.split(':')
      const title = parts.slice(1).join(':').trim()
      if (title) return title
    }
    return 'Hiring Position'
  }

  private normalizeRole(signal: HiringSignal): string {
    const title = this.extractRoleTitle(signal).toLowerCase()
    if (title.includes('engineer') || title.includes('developer')) return 'engineering'
    if (title.includes('manager') || title.includes('product')) return 'product'
    if (title.includes('designer') || title.includes('ui/ux')) return 'design'
    if (title.includes('hr') || title.includes('recruiter')) return 'hr'
    if (title.includes('sales') || title.includes('business')) return 'sales'
    if (title.includes('marketing')) return 'marketing'
    if (title.includes('finance') || title.includes('account')) return 'finance'
    return 'other'
  }

  private extractContactPaths(lead: MultiSourceLead): ContactPath[] {
    const paths: ContactPath[] = []
    if (lead.enrichment.careerPageUrl) {
      paths.push({ category: 'careers-email', value: lead.enrichment.careerPageUrl, confidence: 'high' })
    }
    if (lead.enrichment.contactEmail) {
      paths.push({ category: 'hr-email', value: lead.enrichment.contactEmail, confidence: 'medium' })
    }
    if (lead.enrichment.contactPhone) {
      paths.push({ category: 'phone', value: lead.enrichment.contactPhone, confidence: 'medium' })
    }
    return paths
  }

  /**
   * Aggregate insights for dashboard / analytics views.
   */
  getScoringInsights(scoredLeads: Array<Pick<ScoredLead, 'finalScore' | 'confidence'> & {
    enrichment?: { industry?: string[] }
    sources?: Array<{ sourceId: string }>
  }>) {
    const total = scoredLeads.length
    if (total === 0) return null

    const avgScore = scoredLeads.reduce((sum, lead) => sum + lead.finalScore, 0) / total

    const confidenceBreakdown = scoredLeads.reduce<Record<string, number>>((acc, lead) => {
      acc[lead.confidence] = (acc[lead.confidence] ?? 0) + 1
      return acc
    }, {})

    const industryCounts: Record<string, number> = {}
    scoredLeads.forEach(lead => {
      const industry = lead.enrichment?.industry?.[0] ?? 'Unknown'
      industryCounts[industry] = (industryCounts[industry] ?? 0) + 1
    })
    const topIndustries = Object.entries(industryCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)

    const sourceTotals: Record<string, { score: number; count: number }> = {}
    scoredLeads.forEach(lead => {
      lead.sources?.forEach(source => {
        const bucket = sourceTotals[source.sourceId] ?? { score: 0, count: 0 }
        bucket.score += lead.finalScore
        bucket.count += 1
        sourceTotals[source.sourceId] = bucket
      })
    })
    const averageBySource: Record<string, number> = {}
    Object.entries(sourceTotals).forEach(([id, { score, count }]) => {
      averageBySource[id] = count > 0 ? score / count : 0
    })

    return {
      total,
      avgScore,
      confidenceBreakdown,
      topIndustries,
      averageBySource,
      distribution: this.getScoreDistribution(scoredLeads),
    }
  }

  private getScoreDistribution(leads: Array<{ finalScore: number }>) {
    const bins = { '0-1': 0, '1-2': 0, '2-3': 0, '3-4': 0, '4+': 0 }
    leads.forEach(lead => {
      if (lead.finalScore < 1) bins['0-1']++
      else if (lead.finalScore < 2) bins['1-2']++
      else if (lead.finalScore < 3) bins['2-3']++
      else if (lead.finalScore < 4) bins['3-4']++
      else bins['4+']++
    })
    return bins
  }
}
