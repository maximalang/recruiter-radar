/**
 * Lead Aggregator & Deduplication System
 *
 * Combines leads from multiple sources, resolves entity matching,
 * and applies sophisticated deduplication strategies.
 */

import type { MultiSourceLead, LeadEnrichment } from './multi-source-lead-generator'
import type { HiringSignal } from './hiring-pattern-detector'

export interface AggregatedLead {
  id: string
  canonicalCompanyId: string
  companyName: string
  displayName: string
  score: number
  confidence: 'A' | 'B' | 'C' | 'D'
  sources: AggregatedSource[]
  signals: HiringSignal[]
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
    completeness: number
    freshness: number
    reliability: number
  }
  nextAction: string
  reasons: string[]
  detectedAt: Date
  enrichment: LeadEnrichment
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

type ResolvedLead = MultiSourceLead & { canonicalCompanyId: string }

/**
 * Lead aggregator with entity resolution and deduplication.
 */
export class LeadAggregator {
  private entityResolver: EntityResolver
  private deduplicator: LeadDeduplicator

  constructor() {
    this.entityResolver = new EntityResolver()
    this.deduplicator = new LeadDeduplicator()
  }

  async aggregateLeads(rawLeads: MultiSourceLead[]): Promise<AggregatedLead[]> {
    const resolvedLeads = await this.entityResolver.resolveAll(rawLeads)
    const groupedLeads = this.groupLeadsByEntity(resolvedLeads)

    const aggregatedLeads = Array.from(groupedLeads.values()).map(group =>
      this.aggregateLeadGroup(group),
    )

    return this.rankAggregatedLeads(aggregatedLeads)
  }

  private groupLeadsByEntity(leads: ResolvedLead[]) {
    const groups = new Map<string, ResolvedLead[]>()
    leads.forEach(lead => {
      const bucket = groups.get(lead.canonicalCompanyId)
      if (bucket) {
        bucket.push(lead)
      } else {
        groups.set(lead.canonicalCompanyId, [lead])
      }
    })
    return groups
  }

  private aggregateLeadGroup(group: ResolvedLead[]): AggregatedLead {
    const firstLead = group[0]
    const canonicalCompanyId = firstLead.canonicalCompanyId

    const allSources = new Map<string, AggregatedSource>()
    group.forEach(lead => {
      lead.sources.forEach(source => {
        const existing = allSources.get(source.sourceId)
        if (existing) {
          existing.contributedSignals.push(...lead.signals)
          if (source.extractedAt > existing.extractedAt) {
            existing.extractedAt = source.extractedAt
            existing.relevanceScore = source.relevanceScore
            existing.confidence = source.confidence
          }
        } else {
          allSources.set(source.sourceId, {
            sourceId: source.sourceId,
            sourceName: source.sourceName,
            evidenceType: source.evidenceType,
            confidence: source.confidence,
            relevanceScore: source.relevanceScore,
            contributedSignals: [...lead.signals],
            extractedAt: source.extractedAt,
          })
        }
      })
    })

    const sourcesArray = Array.from(allSources.values())
    const allSignals = group.flatMap(lead => lead.signals)
    const dedupedSignals = this.deduplicateSignals(allSignals)

    const score = this.calculateCompositeScore(group, sourcesArray)
    const confidence = this.determineConfidence(sourcesArray)
    const deduplication = this.deduplicator.getGroupMetadata(
      canonicalCompanyId,
      group.map(l => l.id),
    )
    const qualityMetrics = this.calculateQualityMetrics(group, sourcesArray)

    const detectedAt = new Date(
      Math.min(...group.map(l => l.detectedAt.getTime())),
    )

    const mergedEnrichment: LeadEnrichment = group.reduce<LeadEnrichment>((acc, lead) => {
      Object.entries(lead.enrichment ?? {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          ;(acc as Record<string, unknown>)[key] = value
        }
      })
      return acc
    }, {})

    return {
      id: `agg-${canonicalCompanyId}`,
      canonicalCompanyId,
      companyName: firstLead.companyName,
      displayName: this.generateDisplayName(firstLead.companyName, sourcesArray),
      score,
      confidence,
      sources: sourcesArray,
      signals: dedupedSignals,
      deduplication,
      metadata: {
        firstSeen: detectedAt,
        lastUpdated: new Date(),
        sourceCount: sourcesArray.length,
        uniqueSignals: dedupedSignals.length,
      },
      qualityMetrics,
      nextAction: firstLead.nextAction,
      reasons: this.mergeReasons(group),
      detectedAt,
      enrichment: mergedEnrichment,
    }
  }

  private mergeReasons(group: ResolvedLead[]): string[] {
    const seen = new Set<string>()
    const merged: string[] = []
    group.forEach(lead => {
      lead.reasons.forEach(reason => {
        if (!seen.has(reason)) {
          seen.add(reason)
          merged.push(reason)
        }
      })
    })
    return merged
  }

  private calculateCompositeScore(leads: MultiSourceLead[], sources: AggregatedSource[]): number {
    if (leads.length === 0) return 0
    const baseScore = Math.max(...leads.map(l => l.score))
    const sourceDiversity = sources.length
    const diversityMultiplier = 1 + Math.max(0, sourceDiversity - 1) * 0.15
    const avgConfidence = sourceDiversity > 0
      ? sources.reduce((sum, s) => sum + s.confidence, 0) / sourceDiversity
      : 0
    const confidenceMultiplier = 0.8 + avgConfidence * 0.4
    const uniqueSignals = new Set(leads.flatMap(l => l.signals.map(s => s.signalType))).size
    const signalBonus = Math.min(uniqueSignals * 0.1, 0.5)
    return Math.min(baseScore * diversityMultiplier * confidenceMultiplier + signalBonus, 4.0)
  }

  private determineConfidence(sources: AggregatedSource[]): 'A' | 'B' | 'C' | 'D' {
    if (sources.length === 0) return 'D'
    const primarySources = ['hh', 'career-pages']
    const hasPrimary = sources.some(s => primarySources.includes(s.sourceId))
    const sourceCount = sources.length
    const avgConfidence = sources.reduce((sum, s) => sum + s.confidence, 0) / sourceCount

    if (hasPrimary && sourceCount >= 2 && avgConfidence > 0.8) return 'A'
    if (hasPrimary && sourceCount >= 1) return 'B'
    if (sourceCount >= 2) return 'C'
    return 'D'
  }

  private generateDisplayName(companyName: string, sources: AggregatedSource[]): string {
    if (sources.length === 0) return companyName
    const sourceNames = sources.map(s => s.sourceName).join(', ')
    return `${companyName} (${sourceNames})`
  }

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

  private calculateQualityMetrics(leads: MultiSourceLead[], sources: AggregatedSource[]) {
    const hasCompanySize = leads.some(l => l.enrichment?.companySize)
    const hasIndustry = leads.some(l => (l.enrichment?.industry?.length ?? 0) > 0)
    const hasLocations = leads.some(l => (l.enrichment?.locations?.length ?? 0) > 0)
    const completeness =
      (hasCompanySize ? 0.3 : 0) +
      (hasIndustry ? 0.4 : 0) +
      (hasLocations ? 0.3 : 0)

    const now = Date.now()
    const ages = leads.map(l => now - l.detectedAt.getTime())
    const maxAge = ages.length > 0 ? Math.max(...ages) : 0
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
    const freshness = Math.max(0, 1 - maxAge / sevenDaysMs)

    const reliability = sources.length > 0
      ? sources.reduce((sum, s) => sum + s.confidence, 0) / sources.length
      : 0

    return { completeness, freshness, reliability }
  }

  private rankAggregatedLeads(leads: AggregatedLead[]): AggregatedLead[] {
    return [...leads].sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score
      const confidenceOrder = { A: 4, B: 3, C: 2, D: 1 }
      if (confidenceOrder[a.confidence] !== confidenceOrder[b.confidence]) {
        return confidenceOrder[b.confidence] - confidenceOrder[a.confidence]
      }
      return b.qualityMetrics.freshness - a.qualityMetrics.freshness
    })
  }
}

class EntityResolver {
  private nameNormalizationCache = new Map<string, string>()

  async resolveAll(leads: MultiSourceLead[]): Promise<ResolvedLead[]> {
    return Promise.all(
      leads.map(async lead => ({
        ...lead,
        canonicalCompanyId: await this.normalizeCompanyNameToId(lead.companyName, lead.companyId),
      })),
    )
  }

  private async normalizeCompanyName(name: string): Promise<string> {
    const cacheKey = name.toLowerCase()
    const cached = this.nameNormalizationCache.get(cacheKey)
    if (cached) return cached

    let normalized = name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '')
      .trim()

    const abbreviations: Record<string, string> = {
      oao: 'open joint stock company',
      ooo: 'limited liability company',
      ip: 'individual entrepreneur',
      ao: 'joint stock company',
    }
    for (const [abbr, full] of Object.entries(abbreviations)) {
      normalized = normalized.replace(new RegExp(`\\b${abbr}\\b`, 'gi'), full)
    }

    this.nameNormalizationCache.set(cacheKey, normalized)
    return normalized
  }

  private async normalizeCompanyNameToId(name: string, _companyId: string): Promise<string> {
    const normalized = await this.normalizeCompanyName(name)
    return this.hashString(normalized)
  }

  private hashString(str: string): string {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash
    }
    return `co-${Math.abs(hash).toString(36)}`
  }
}

class LeadDeduplicator {
  getGroupMetadata(canonicalCompanyId: string, leadIds: string[]) {
    const aggregateId = `agg-${canonicalCompanyId}`
    return {
      strategy: 'exact' as const,
      matchedWith: leadIds.filter(id => id !== aggregateId),
      confidence: 1.0,
    }
  }
}
