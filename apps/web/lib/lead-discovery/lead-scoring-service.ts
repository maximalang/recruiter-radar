/**
 * Lead Scoring Service
 *
 * Bridges the multi-source lead generator with the scoring pipeline,
 * converting raw leads from multiple sources into scored and ranked
 * agency leads with explainable breakdowns.
 */

import { runScoringPipeline } from '@/lib/scoring/scoring-pipeline'
import { MultiSourceLeadGenerator } from './multi-source-lead-generator'
import type {
  MultiSourceLead,
  AggregatedLead,
  HiringSignal,
  EvidenceSource
} from './multi-source-lead-generator'
import type {
  ScoringPipelineInput,
  ScoringPipelineResult,
  PipelineCompany,
  PipelineVacancy,
  PipelineEvidence,
  AgencyProfile
} from '@/lib/scoring/scoring-pipeline'
import type { ContactPath, ContactCategory } from '@/lib/scoring/contact-paths'

export interface LeadScoringOptions {
  agencyProfile: AgencyProfile
  sources?: string[]
  minScore?: number
  enableRealTime?: boolean
  marketContext?: {
    industryGrowth?: Record<string, number>
    marketConditions?: 'boom' | 'normal' | 'bust'
    competitiveLandscape?: Record<string, number>
  }
}

export interface ScoredLead extends AggregatedLead {
  scoringBreakdown: ScoringPipelineResult['breakdown']
  finalScore: number
  confidenceBoost: number
  improvementSuggestions: string[]
}

/**
 * Main service for scoring leads from multiple sources
 */
export class LeadScoringService {
  private leadGenerator: MultiSourceLeadGenerator

  constructor() {
    this.leadGenerator = new MultiSourceLeadGenerator()
  }

  /**
   * Generate and score leads from multiple sources
   */
  async generateAndScoreLeads(options: LeadScoringOptions): Promise<ScoredLead[]> {
    // Generate raw leads from specified sources
    const rawLeads = await this.leadGenerator.generateLeads({
      industries: options.agencyProfile.industries,
      regions: options.agencyProfile.locations,
      minScore: options.minScore || 1.0,
      sources: options.sources || [],
      enableRealTime: options.enableRealTime || false,
    })

    // Score each lead
    const scoredLeads = await Promise.all(
      rawLeads.map(lead => this.scoreLead(lead, options))
    )

    // Filter by minimum score and sort
    return scoredLeads
      .filter(lead => lead.finalScore >= (options.minScore || 1.0))
      .sort((a, b) => b.finalScore - a.finalScore)
  }

  /**
   * Score a single lead using the pipeline
   */
  private async scoreLead(
    lead: MultiSourceLead,
    options: LeadScoringOptions
  ): Promise<ScoredLead> {
    // Convert multi-source lead to scoring pipeline input
    const pipelineInput = this.convertToScoringInput(lead, options)

    // Run the scoring pipeline
    const result = runScoringPipeline(pipelineInput)

    // Enhance with additional scoring insights
    const enhancement = this.enhanceScoring(result, lead, options)

    return {
      id: lead.id,
      canonicalCompanyId: lead.companyId,
      companyName: lead.companyName,
      displayName: lead.companyName,
      score: enhancement.finalScore,
      confidence: this.mapConfidence(result.lead.confidence),
      sources: [],
      allSignals: lead.signals,
      deduplication: {
        strategy: 'exact',
        matchedWith: [],
        confidence: 1.0
      },
      metadata: {
        firstSeen: result.lead.createdAt || new Date(),
        lastUpdated: result.lead.updatedAt || new Date(),
        sourceCount: lead.sources.length,
        uniqueSignals: new Set(lead.signals.map(s => `${s.signalType}-${s.strength}`)).size
      },
      qualityMetrics: {
        completeness: 1,
        freshness: 1,
        reliability: 1
      },
      signals: lead.signals,
      nextAction: lead.nextAction,
      reasons: lead.reasons,
      detectedAt: lead.detectedAt,
      enrichment: lead.enrichment,
      scoringBreakdown: result.breakdown,
      finalScore: enhancement.finalScore,
      confidenceBoost: enhancement.confidenceBoost,
      improvementSuggestions: enhancement.improvementSuggestions,
    }
  }

  /**
   * Map confidence from scoring pipeline to lead format
   */
  private mapConfidence(confidence: string): 'A' | 'B' | 'C' | 'D' {
    const map: Record<string, 'A' | 'B' | 'C' | 'D'> = {
      'high': 'A',
      'medium': 'B',
      'low': 'C',
      'A': 'A',
      'B': 'B',
      'C': 'C',
      'D': 'D'
    }
    return map[confidence] || 'D'
  }

  /**
   * Convert MultiSourceLead to ScoringPipelineInput
   */
  private convertToScoringInput(
    lead: MultiSourceLead,
    options: LeadScoringOptions
  ): ScoringPipelineInput {
    // Extract company info from lead
    const company: PipelineCompany = {
      id: lead.companyId,
      name: lead.companyName,
      website: lead.enrichment.website,
      industry: lead.enrichment.industry?.[0],
      industries: lead.enrichment.industry,
      locations: lead.enrichment.locations?.[0] ? [lead.enrichment.locations[0]] : [],
      size: this.mapCompanySize(lead.enrichment.companySize),
      employeeCount: lead.enrichment.employeeCount,
      hasCareerPage: lead.enrichment.hasCareerPage,
      hasCorporateContactPath: lead.enrichment.hasContactPath,
    }

    // Convert signals to vacancies
    const vacancies: PipelineVacancy[] = lead.signals
      .filter(signal => signal.signalType === 'burst' || signal.signalType === 'fresh')
      .map((signal, index) => ({
        id: `signal-${index}`,
        title: this.extractRoleTitle(signal),
        role: this.normalizeRole(signal),
        location: '', // signal.location not available in current type
        publishedAt: new Date().toISOString(), // signal.timestamp not available
        isInternalRecruiter: signal.evidence?.includes('internal'),
        isHardToFill: signal.evidence?.includes('hard_to_fill'),
        sourceTier: this.mapEvidenceTier(signal),
        salaryFrom: this.extractSalary(signal, 'min'),
        salaryTo: this.extractSalary(signal, 'max'),
        salaryCurrency: 'RUB',
      }))

    // Convert sources to evidence
    const evidence: PipelineEvidence[] = lead.sources.map(source => ({
      source: source.sourceId,
      tier: this.mapEvidenceTierFromSource(source),
      fetchedAt: source.extractedAt.toISOString(),
    }))

    // Extract contact paths
    const contactPaths: ContactPath[] = this.extractContactPaths(lead)

    return {
      leadId: lead.id,
      company,
      vacancies,
      evidence,
      contactPaths,
      agencyProfile: options.agencyProfile,
      marketContext: options.marketContext ? {
        industryTrend: 'normal' as any, // Placeholder - should be mapped from market conditions
        growthSignals: Object.keys(options.marketContext.industryGrowth || {}),
        expandingIntoNewMarket: false // Should be determined from market data
      } : undefined,
    }
  }

  /**
   * Enhance scoring with additional insights
   */
  private enhanceScoring(
    result: ScoringPipelineResult,
    lead: MultiSourceLead,
    options: LeadScoringOptions
  ) {
    let finalScore = result.lead.score
    let confidenceBoost = 0
    const improvementSuggestions: string[] = []

    // Boost score for source diversity
    if (lead.sources.length > 2) {
      finalScore += 0.2
      confidenceBoost += 0.3
      improvementSuggestions.push('Multiple independent sources increase reliability')
    }

    // Boost score for recent signals
    const recentSignals = lead.signals.filter(signal => {
      const signalDate = new Date()
      const daysOld = (Date.now() - signalDate.getTime()) / (24 * 60 * 60 * 1000)
      return daysOld <= 7
    })

    if (recentSignals.length >= 3) {
      finalScore += 0.15
      confidenceBoost += 0.2
      improvementSuggestions.push('Recent hiring signals indicate active hiring')
    }

    // Apply market context adjustments
    if (options.marketContext?.marketConditions === 'boom') {
      finalScore *= 1.1 // 10% boost in boom times
      improvementSuggestions.push('High market demand increases lead value')
    } else if (options.marketContext?.marketConditions === 'bust') {
      finalScore *= 0.9 // 10% reduction in bust times
      improvementSuggestions.push('Consider focusing on recession-resistant industries')
    }

    // Clamp score to [0, 4]
    finalScore = Math.max(0, Math.min(4, finalScore))

    return {
      finalScore,
      confidenceBoost,
      improvementSuggestions,
    }
  }

  /**
   * Helper methods for conversion
   */
  private mapCompanySize(size?: string): PipelineCompany['size'] {
    if (!size) return undefined

    const sizeMap: Record<string, PipelineCompany['size']> = {
      'startup': 'startup',
      'small': 'small',
      '50-100': 'small',
      '100-500': 'medium',
      'medium': 'medium',
      '500-1000': 'medium',
      'large': 'large',
      '1000+': 'large',
      'enterprise': 'enterprise',
    }

    return sizeMap[size] || undefined
  }

  private mapEvidenceTier(signal: HiringSignal): PipelineEvidence['tier'] {
    if (signal.evidence?.includes('direct')) return 'direct'
    if (signal.evidence?.includes('corroboration')) return 'corroboration'
    return 'context' as const
  }

  private mapEvidenceTierFromSource(source: EvidenceSource): PipelineEvidence['tier'] {
    // Map source to evidence tier based on reliability
    const highTierSources = ['career-pages', 'hh', 'rabota-rossii']
    const corroborationSources = ['linkedin-company-pages', 'superjob']

    if (highTierSources.includes(source.sourceId)) return 'direct' as const
    if (corroborationSources.includes(source.sourceId)) return 'corroboration' as const
    return 'context' as const
  }

  private extractRoleTitle(signal: HiringSignal): string {
    // Extract title from evidence or use generic role
    const evidence = signal.evidence || []
    const roleMatch = evidence.find(e => e.includes('role:'))
    return roleMatch ? roleMatch.split(':')[1] : 'Hiring Position'
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

  private extractSalary(signal: HiringSignal, type: 'min' | 'max'): number | null {
    // This would need to be implemented based on your salary extraction logic
    return null
  }

  private extractContactPaths(lead: MultiSourceLead): ContactPath[] {
    // Convert enrichment data to contact paths
    const paths: ContactPath[] = []

    if (lead.enrichment.careerPageUrl) {
      paths.push({
        category: 'careers-email',
        value: lead.enrichment.careerPageUrl,
        confidence: 'high'
      })
    }

    if (lead.enrichment.contactEmail) {
      paths.push({
        category: 'hr-email',
        value: lead.enrichment.contactEmail,
        confidence: 'medium'
      })
    }

    if (lead.enrichment.contactPhone) {
      paths.push({
        category: 'phone',
        value: lead.enrichment.contactPhone,
        confidence: 'medium'
      })
    }

    return paths
  }

  /**
   * Get scoring insights for dashboard
   */
  getScoringInsights(scoredLeads: ScoredLead[]) {
    const total = scoredLeads.length

    if (total === 0) return null

    const avgScore = scoredLeads.reduce((sum, lead) => sum + lead.finalScore, 0) / total
    const confidenceBreakdown = scoredLeads.reduce((acc, lead) => {
      acc[lead.confidence] = (acc[lead.confidence] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    const industryCounts: Record<string, number> = {}
    scoredLeads.forEach(lead => {
      const industry = lead.enrichment?.industry?.[0] || 'Unknown'
      industryCounts[industry] = (industryCounts[industry] || 0) + 1
    })

    const topIndustries = Object.entries(industryCounts)

    const averageBySource: Record<string, number> = {} as Record<string, number>
    const sourceCounts: Record<string, number> = {} as Record<string, number>

    scoredLeads.forEach(lead => {
      lead.sources.forEach(source => {
        if (!averageBySource[source.sourceId]) {
          averageBySource[source.sourceId] = 0
          sourceCounts[source.sourceId] = 0
        }
        averageBySource[source.sourceId] += lead.finalScore
        sourceCounts[source.sourceId] += 1
      })
    })

    // Calculate averages
    Object.keys(averageBySource).forEach(source => {
      averageBySource[source] = (averageBySource[source] as number) / (sourceCounts[source] as number)
    })

    return {
      total,
      avgScore,
      confidenceBreakdown,
      topIndustries: Object.entries(topIndustries)
        .sort((a, b) => (b[1] as unknown as number) - (a[1] as unknown as number))
        .slice(0, 5)
        .map(entry => [entry[0], entry[1] as unknown as number]),
      averageBySource: Object.fromEntries(
        Object.entries(averageBySource).map(([key, value]) => [key, value as number])
      ),
      distribution: this.getScoreDistribution(scoredLeads),
    }
  }

  private getScoreDistribution(leads: ScoredLead[]) {
    const bins = {
      '0-1': 0,
      '1-2': 0,
      '2-3': 0,
      '3-4': 0,
      '4+': 0,
    }

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