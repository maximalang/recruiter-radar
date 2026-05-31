/**
 * Lead Aggregator & Deduplication System
 *
 * Combines leads from multiple sources, resolves entity matching,
 * and applies sophisticated deduplication strategies.
 */

import type { MultiSourceLead, EvidenceSource } from './multi-source-lead-generator'
import type { HiringSignal } from './hiring-pattern-detector'

export interface AggregatedLead {
  id: string
  canonicalCompanyId: string
  companyName: string
  displayName: string
  score: number
  confidence: 'A' | 'B' | 'C' | 'D'
  sources: AggregatedSource[]
  allSignals: HiringSignal[]
  deduplication: {
    strategy: 'exact' | 'fuzzy' | 'cluster'
    matchedWith: string[]
    confidence: number
  }
  metadata: {
    firstSeen: Date
    lastUpdated: Date
    sourceCount: number
    uniqueSignals: number
  }
  qualityMetrics: {
    completeness: number // 0-1
    freshness: number // 0-1
    reliability: number // 0-1
  }
  signals: HiringSignal[]
  nextAction: string
  reasons: string[]
  detectedAt: Date
  enrichment?: {
    companySize?: string
    industry?: string[]
    locations?: string[]
    hiringVelocity?: number
    lastHiringActivity?: Date
    website?: string
    employeeCount?: number
    hasCareerPage?: boolean
    hasContactPath?: boolean
    careerPageUrl?: string
    contactEmail?: string
    contactPhone?: string
  }
}

export interface AggregatedSource {
  sourceId: string
  sourceName: string
  evidenceType: 'vacancy' | 'career-page' | 'company-profile' | 'news' | 'registry'
  confidence: number
  relevanceScore: number
  contributedSignals: HiringSignal[]
  extractedAt: Date
}

/**
 * Advanced lead aggregator with entity resolution and deduplication
 */
export class LeadAggregator {
  private entityResolver: EntityResolver
  private deduplicator: LeadDeduplicator

  constructor() {
    this.entityResolver = new EntityResolver()
    this.deduplicator = new LeadDeduplicator()
  }

  /**
   * Aggregate leads from multiple sources
   */
  async aggregateLeads(rawLeads: MultiSourceLead[]): Promise<AggregatedLead[]> {
    // Step 1: Resolve entity mappings
    const resolvedLeads = await this.entityResolver.resolveAll(rawLeads)

    // Step 2: Group by canonical entity
    const groupedLeads = this.groupLeadsByEntity(resolvedLeads)

    // Step 3: Aggregate each group
    const aggregatedLeads: AggregatedLead[] = []

    groupedLeads.forEach(group => {
      const aggregated = this.aggregateLeadGroup(group)
      aggregatedLeads.push(aggregated)
    })

    // Step 4: Apply final ranking
    return this.rankAggregatedLeads(aggregatedLeads)
  }

  /**
   * Group leads by resolved canonical company ID
   */
  private groupLeadsByEntity(leads: Array<MultiSourceLead & { canonicalCompanyId: string }>) {
    const groups = new Map<string, Array<MultiSourceLead & { canonicalCompanyId: string }>>()

    leads.forEach(lead => {
      if (!groups.has(lead.canonicalCompanyId)) {
        groups.set(lead.canonicalCompanyId, [])
      }
      groups.get(lead.canonicalCompanyId)!.push(lead)
    })

    return groups
  }

  /**
   * Aggregate a group of leads for the same company
   */
  private aggregateLeadGroup(group: Array<MultiSourceLead & { canonicalCompanyId: string }>): AggregatedLead {
    const firstLead = group[0]
    const canonicalCompanyId = firstLead.canonicalCompanyId

    // Collect all unique sources
    const allSources = new Map<string, AggregatedSource>()

    group.forEach(lead => {
      lead.sources.forEach(source => {
        if (!allSources.has(source.sourceId)) {
          allSources.set(source.sourceId, {
            sourceId: source.sourceId,
            sourceName: source.sourceName,
            evidenceType: source.evidenceType,
            confidence: source.confidence,
            relevanceScore: source.relevanceScore,
            contributedSignals: [],
            extractedAt: source.extractedAt
          })
        }

        // Aggregate signals
        const aggregatedSource = allSources.get(source.sourceId)!
        aggregatedSource.contributedSignals.push(...lead.signals)
      })
    })

    // Combine all signals
    const allSignals = group.flatMap(lead => lead.signals)

    // Calculate composite score
    const score = this.calculateCompositeScore(group, Array.from(allSources.values()))

    // Determine confidence based on source diversity
    const confidence = this.determineConfidence(Array.from(allSources.values()))

    // Apply deduplication metadata
    const deduplication = this.deduplicator.getGroupMetadata(canonicalCompanyId, group.map(l => l.id))

    // Calculate quality metrics
    const qualityMetrics = this.calculateQualityMetrics(group, Array.from(allSources.values()))

    return {
      id: `agg-${canonicalCompanyId}-${Date.now()}`,
      canonicalCompanyId,
      companyName: firstLead.companyName,
      displayName: this.generateDisplayName(firstLead.companyName, Array.from(allSources.values())),
      score,
      confidence,
      sources: Array.from(allSources.values()),
      allSignals: this.deduplicateSignals(allSignals),
      deduplication,
      metadata: {
        firstSeen: new Date(Math.min(...group.map(l => l.detectedAt.getTime()))),
        lastUpdated: new Date(),
        sourceCount: allSources.size,
        uniqueSignals: new Set(allSignals.map(s => `${s.signalType}-${s.strength}`)).size
      },
      qualityMetrics,
      signals: this.deduplicateSignals(allSignals),
      nextAction: '',
      reasons: [],
      detectedAt: new Date(),
      enrichment: firstLead.enrichment
    }
  }

  /**
   * Calculate composite score from multiple sources
   */
  private calculateCompositeScore(leads: MultiSourceLead[], sources: AggregatedSource[]): number {
    // Base score from highest individual lead
    const baseScore = Math.max(...leads.map(l => l.score))

    // Source diversity multiplier
    const sourceDiversity = sources.length
    const diversityMultiplier = 1 + (sourceDiversity - 1) * 0.15

    // Confidence multiplier
    const avgConfidence = sources.reduce((sum, s) => sum + s.confidence, 0) / sources.length
    const confidenceMultiplier = 0.8 + (avgConfidence * 0.4)

    // Signal diversity bonus
    const uniqueSignals = new Set(leads.flatMap(l => l.signals.map(s => s.signalType))).size
    const signalBonus = Math.min(uniqueSignals * 0.1, 0.5)

    return Math.min(baseScore * diversityMultiplier * confidenceMultiplier + signalBonus, 4.0)
  }

  /**
   * Determine confidence level based on sources
   */
  private determineConfidence(sources: AggregatedSource[]): 'A' | 'B' | 'C' | 'D' {
    const primarySources = ['hh', 'career-pages']
    const hasPrimary = sources.some(s => primarySources.includes(s.sourceId))
    const sourceCount = sources.length
    const avgConfidence = sources.reduce((sum, s) => sum + s.confidence, 0) / sources.length

    if (hasPrimary && sourceCount >= 2 && avgConfidence > 0.8) {
      return 'A'
    } else if (hasPrimary && sourceCount >= 1) {
      return 'B'
    } else if (sourceCount >= 2) {
      return 'C'
    } else {
      return 'D'
    }
  }

  /**
   * Generate display name for the company
   */
  private generateDisplayName(companyName: string, sources: AggregatedSource[]): string {
    const sourceNames = sources.map(s => s.sourceName).join(', ')
    return `${companyName} (${sourceNames})`
  }

  /**
   * Deduplicate signals
   */
  private deduplicateSignals(signals: HiringSignal[]): HiringSignal[] {
    const uniqueSignals = new Map<string, HiringSignal>()

    signals.forEach(signal => {
      const key = `${signal.signalType}-${signal.companyId}`
      const existing = uniqueSignals.get(key)

      if (!existing || signal.strength > existing.strength) {
        uniqueSignals.set(key, signal)
      }
    })

    return Array.from(uniqueSignals.values())
  }

  /**
   * Calculate quality metrics
   */
  private calculateQualityMetrics(leads: MultiSourceLead[], sources: AggregatedSource[]): {
    completeness: number
    freshness: number
    reliability: number
  } {
    // Completeness: how much data we have
    const hasCompanySize = leads.some(l => l.enrichment.companySize)
    const hasIndustry = leads.some(l => l.enrichment.industry && l.enrichment.industry.length > 0)
    const hasLocations = leads.some(l => l.enrichment.locations && l.enrichment.locations.length > 0)

    const completeness = (hasCompanySize ? 0.3 : 0) +
                       (hasIndustry ? 0.4 : 0) +
                       (hasLocations ? 0.3 : 0)

    // Freshness: how recent the data is
    const now = new Date()
    const maxAge = Math.max(...leads.map(l => now.getTime() - l.detectedAt.getTime()))
    const freshness = Math.max(0, 1 - (maxAge / (7 * 24 * 60 * 60 * 1000))) // 7-day decay

    // Reliability: source confidence
    const avgSourceConfidence = sources.reduce((sum, s) => sum + s.confidence, 0) / sources.length
    const reliability = avgSourceConfidence

    return {
      completeness,
      freshness,
      reliability
    }
  }

  /**
   * Final ranking of aggregated leads
   */
  private rankAggregatedLeads(leads: AggregatedLead[]): AggregatedLead[] {
    return leads.sort((a, b) => {
      // Primary sort by score
      if (a.score !== b.score) {
        return b.score - a.score
      }

      // Secondary sort by confidence
      const confidenceOrder = { 'A': 4, 'B': 3, 'C': 2, 'D': 1 }
      if (confidenceOrder[a.confidence] !== confidenceOrder[b.confidence]) {
        return confidenceOrder[b.confidence] - confidenceOrder[a.confidence]
      }

      // Tertiary sort by freshness
      return b.qualityMetrics.freshness - a.qualityMetrics.freshness
    })
  }
}

/**
 * Entity resolver for handling company name variations
 */
export class EntityResolver {
  private nameNormalizationCache = new Map<string, string>()

  async resolveAll(leads: MultiSourceLead[]): Promise<Array<MultiSourceLead & { canonicalCompanyId: string }>> {
    return Promise.all(
      leads.map(async lead => ({
        ...lead,
        canonicalCompanyId: await this.normalizeCompanyNameToId(lead.companyName, lead.companyId)
      }))
    )
  }

  private async normalizeCompanyName(name: string): Promise<string> {
    const cacheKey = name.toLowerCase()

    if (this.nameNormalizationCache.has(cacheKey)) {
      return this.nameNormalizationCache.get(cacheKey)!
    }

    // Apply normalization rules
    let normalized = name
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '')
      .trim()

    // Common abbreviations
    const abbreviations: Record<string, string> = {
      'oao': 'open joint stock company',
      'ooo': 'limited liability company',
      'ip': 'individual entrepreneur',
      'ao': 'joint stock company'
    }

    for (const [abbr, full] of Object.entries(abbreviations)) {
      normalized = normalized.replace(new RegExp(`\\b${abbr}\\b`, 'gi'), full)
    }

    this.nameNormalizationCache.set(cacheKey, normalized)
    return normalized
  }

  private async normalizeCompanyNameToId(name: string, companyId: string): Promise<string> {
    // Similar to normalizeCompanyName but returns a hash for company ID
    const normalized = await this.normalizeCompanyName(name)
    return this.hashString(normalized)
  }

  private hashString(str: string): string {
    // Simple hash function for demonstration
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return `co-${Math.abs(hash).toString(36)}`
  }
}

/**
 * Deduplicator for handling similar leads
 */
class LeadDeduplicator {
  private similarityCache = new Map<string, number>()

  getGroupMetadata(canonicalCompanyId: string, leadIds: string[]) {
    // For now, use exact matching strategy
    return {
      strategy: 'exact' as const,
      matchedWith: leadIds.filter(id => id !== `agg-${canonicalCompanyId}-${Date.now()}`),
      confidence: 1.0
    }
  }

  private calculateSimilarity(a: string, b: string): number {
    const key = [a, b].sort().join('-')

    if (this.similarityCache.has(key)) {
      return this.similarityCache.get(key)!
    }

    // Simple string similarity for demonstration
    const longer = a.length > b.length ? a : b
    const shorter = a.length > b.length ? b : a

    if (longer.length === 0) return 1.0

    const editDistance = this.levenshteinDistance(longer, shorter)
    const similarity = 1 - (editDistance / longer.length)

    this.similarityCache.set(key, similarity)
    return similarity
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null))

    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + indicator
        )
      }
    }

    return matrix[str2.length][str1.length]
  }
}