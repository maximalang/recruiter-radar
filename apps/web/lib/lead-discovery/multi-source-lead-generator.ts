/**
 * Multi-Source Lead Generation Platform
 *
 * Bridges pre-fetched HH digest items into MultiSourceLead records and
 * enriches each with optional career-page / registry / business-signal
 * evidence via injected adapter callbacks. The generator never fetches
 * HH itself; ingestion stays the single source of HH truth.
 */

import { createDefaultRouter } from '@/lib/sources/crawlers'
import type { CrawlerRouter } from '@/lib/sources/crawlers'
import { HiringPatternDetector, type HiringSignal } from './hiring-pattern-detector'
import type { HhDigestItem } from '@/lib/hhDigest'

export type { AggregatedLead } from './lead-aggregator'
export type { HiringSignal } from './hiring-pattern-detector'

export interface DataSource {
  id: string
  name: string
  kind: 'job-board' | 'career-page' | 'company-site' | 'business-signal' | 'company-registry'
  confidence: number
  priority: 'P1' | 'P2' | 'P3'
  leadEligibility: 'digest-lead-originating' | 'confidence-gated-evidence' | 'enrichment-only' | 'context-only'
  description: string
}

export interface LeadEnrichment {
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

export interface MultiSourceLead {
  id: string
  companyId: string
  companyName: string
  score: number
  confidence: 'A' | 'B' | 'C' | 'D'
  sources: EvidenceSource[]
  signals: HiringSignal[]
  nextAction: string
  reasons: string[]
  detectedAt: Date
  enrichment: LeadEnrichment
}

export interface EvidenceSource {
  sourceId: string
  sourceName: string
  evidenceType: 'vacancy' | 'career-page' | 'company-profile' | 'news' | 'registry'
  confidence: number
  rawData?: unknown
  extractedAt: Date
  relevanceScore: number
}

export interface CareerPageFetchResult {
  url: string
  fetchedAt: Date
  rawData?: unknown
}

export interface BusinessSignalEvidence {
  rawData?: unknown
  signalStrength?: number
  signalEvidence?: string[]
}

export interface RegistryEvidence {
  rawData?: unknown
  enrichment?: Partial<LeadEnrichment>
}

export interface Logger {
  warn(message: string, meta?: Record<string, unknown>): void
  info?(message: string, meta?: Record<string, unknown>): void
  error?(message: string, meta?: Record<string, unknown>): void
}

const noopLogger: Logger = {
  warn: () => undefined,
}

export interface MultiSourceLeadGeneratorDeps {
  crawler?: CrawlerRouter
  resolveCareerPageUrl?: (lead: MultiSourceLead) => string | null
  fetchCareerPage?: (
    lead: MultiSourceLead,
    crawler: CrawlerRouter,
    url: string,
  ) => Promise<CareerPageFetchResult | null>
  fetchBusinessSignals?: (lead: MultiSourceLead) => Promise<BusinessSignalEvidence | null>
  fetchRegistryData?: (lead: MultiSourceLead) => Promise<RegistryEvidence | null>
  logger?: Logger
}

export interface GenerateLeadsOptions {
  digestItems: HhDigestItem[]
  industries?: string[]
  regions?: string[]
  minScore?: number
  sources?: string[]
}

/**
 * Multi-source lead generator. Stateless — supply digestItems per call.
 */
export class MultiSourceLeadGenerator {
  private crawler: CrawlerRouter
  private sources: DataSource[]
  private activeSources: string[]
  private resolveCareerPageUrl?: MultiSourceLeadGeneratorDeps['resolveCareerPageUrl']
  private fetchCareerPage?: MultiSourceLeadGeneratorDeps['fetchCareerPage']
  private fetchBusinessSignals?: MultiSourceLeadGeneratorDeps['fetchBusinessSignals']
  private fetchRegistryData?: MultiSourceLeadGeneratorDeps['fetchRegistryData']
  private logger: Logger

  constructor(deps: MultiSourceLeadGeneratorDeps = {}) {
    this.crawler = deps.crawler ?? createDefaultRouter()
    this.sources = this.initializeSources()
    this.activeSources = this.getActiveSources()
    this.resolveCareerPageUrl = deps.resolveCareerPageUrl
    this.fetchCareerPage = deps.fetchCareerPage
    this.fetchBusinessSignals = deps.fetchBusinessSignals
    this.fetchRegistryData = deps.fetchRegistryData
    this.logger = deps.logger ?? noopLogger
  }

  private initializeSources(): DataSource[] {
    return [
      { id: 'hh', name: 'HeadHunter', kind: 'job-board', confidence: 0.74, priority: 'P1', leadEligibility: 'digest-lead-originating', description: 'Primary platform for hiring evidence' },
      { id: 'career-pages', name: 'Career Pages', kind: 'career-page', confidence: 0.92, priority: 'P1', leadEligibility: 'digest-lead-originating', description: 'Direct company career pages' },
      { id: 'rabota-rossii', name: 'Rabota Rossii', kind: 'job-board', confidence: 0.7, priority: 'P1', leadEligibility: 'confidence-gated-evidence', description: 'Official Russian job board' },
      { id: 'linkedin-company-pages', name: 'LinkedIn Company Pages', kind: 'company-site', confidence: 0.72, priority: 'P2', leadEligibility: 'confidence-gated-evidence', description: 'LinkedIn company pages' },
      { id: 'tech-job-boards', name: 'Tech Job Boards', kind: 'job-board', confidence: 0.68, priority: 'P2', leadEligibility: 'confidence-gated-evidence', description: 'Specialized tech job boards' },
      { id: 'superjob', name: 'SuperJob', kind: 'job-board', confidence: 0.66, priority: 'P2', leadEligibility: 'confidence-gated-evidence', description: 'Russian job board' },
      { id: 'habr-career', name: 'Habr Career', kind: 'job-board', confidence: 0.69, priority: 'P2', leadEligibility: 'confidence-gated-evidence', description: 'IT-focused job board' },
      { id: 'company-site', name: 'Company Websites', kind: 'company-site', confidence: 0.68, priority: 'P2', leadEligibility: 'enrichment-only', description: 'Direct company websites' },
      { id: 'egrul-fns', name: 'EGRUL/FNS Registry', kind: 'company-registry', confidence: 0.9, priority: 'P3', leadEligibility: 'enrichment-only', description: 'Company registry data' },
      { id: 'funding-business-signals', name: 'Funding Signals', kind: 'business-signal', confidence: 0.58, priority: 'P3', leadEligibility: 'context-only', description: 'Funding and growth signals' },
      { id: 'company-newsrooms', name: 'Company Newsrooms', kind: 'company-site', confidence: 0.6, priority: 'P3', leadEligibility: 'context-only', description: 'Company news and announcements' },
      { id: 'industry-media', name: 'Industry Media', kind: 'business-signal', confidence: 0.52, priority: 'P3', leadEligibility: 'context-only', description: 'Industry news and reports' },
    ]
  }

  private getActiveSources(): string[] {
    return this.sources
      .filter(source =>
        source.priority !== 'P3' || source.leadEligibility === 'context-only',
      )
      .map(source => source.id)
  }

  /**
   * Generate leads from caller-supplied digest items, optionally enriching
   * with the configured adapters in parallel.
   */
  async generateLeads(options: GenerateLeadsOptions): Promise<MultiSourceLead[]> {
    const {
      digestItems,
      industries = [],
      regions = [],
      minScore = 1.0,
      sources = this.activeSources,
    } = options

    if (!Array.isArray(digestItems) || digestItems.length === 0) {
      return []
    }

    const baseLeads = this.digestItemsToLeads(digestItems)

    const wantsCareerPages = sources.includes('career-pages') && Boolean(this.fetchCareerPage)
    const wantsBusinessSignals = sources.includes('funding-business-signals') && Boolean(this.fetchBusinessSignals)
    const wantsRegistry = sources.includes('egrul-fns') && Boolean(this.fetchRegistryData)

    await Promise.all(
      baseLeads.map(async lead => {
        const enrichments: Promise<unknown>[] = []
        if (wantsCareerPages) enrichments.push(this.enrichWithCareerPage(lead))
        if (wantsBusinessSignals) enrichments.push(this.enrichWithBusinessSignal(lead))
        if (wantsRegistry) enrichments.push(this.enrichWithRegistry(lead))
        await Promise.all(enrichments)
      }),
    )

    return this.filterAndRankLeads(baseLeads, { industries, regions, minScore })
  }

  private digestItemsToLeads(digestItems: HhDigestItem[]): MultiSourceLead[] {
    const candidates = HiringPatternDetector.digestToLeadCandidates(digestItems)
    const itemById = new Map(digestItems.map(item => [item.org_id, item]))

    return candidates.map(candidate => {
      const sourceItem = itemById.get(candidate.companyId)
      const detectedAt = candidate.detectedAt instanceof Date ? candidate.detectedAt : new Date()
      const evidenceSource: EvidenceSource = {
        sourceId: 'hh',
        sourceName: 'HeadHunter',
        evidenceType: 'vacancy',
        confidence: 0.74,
        rawData: sourceItem,
        extractedAt: detectedAt,
        relevanceScore: Math.min(candidate.score / 4, 1),
      }
      return {
        id: `multi-${candidate.id}`,
        companyId: candidate.companyId,
        companyName: candidate.companyName,
        score: candidate.score,
        confidence: candidate.confidence,
        sources: [evidenceSource],
        signals: candidate.signals,
        nextAction: candidate.nextAction,
        reasons: candidate.reasons,
        detectedAt,
        enrichment: {},
      }
    })
  }

  private async enrichWithCareerPage(lead: MultiSourceLead): Promise<void> {
    if (!this.fetchCareerPage) return
    const url = this.resolveCareerPageUrl?.(lead)
    if (!url) return

    try {
      const result = await this.fetchCareerPage(lead, this.crawler, url)
      if (!result) return

      if (lead.sources.some(s => s.sourceId === 'career-pages')) return

      lead.sources.push({
        sourceId: 'career-pages',
        sourceName: 'Career Pages',
        evidenceType: 'career-page',
        confidence: 0.92,
        rawData: result.rawData,
        extractedAt: result.fetchedAt,
        relevanceScore: 0.9,
      })

      if (lead.confidence === 'B') lead.confidence = 'A'

      lead.enrichment.hasCareerPage = true
      lead.enrichment.careerPageUrl = result.url

      lead.signals.push({
        companyId: lead.companyId,
        companyName: lead.companyName,
        signalType: 'fresh',
        strength: 1.0,
        evidence: ['career page reachable'],
        detectedAt: result.fetchedAt,
      })
    } catch (error) {
      this.logger.warn('career-page enrichment failed', {
        companyId: lead.companyId,
        url,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async enrichWithBusinessSignal(lead: MultiSourceLead): Promise<void> {
    if (!this.fetchBusinessSignals) return
    try {
      const evidence = await this.fetchBusinessSignals(lead)
      if (!evidence) return

      lead.sources.push({
        sourceId: 'funding-business-signals',
        sourceName: 'Funding Signals',
        evidenceType: 'news',
        confidence: 0.58,
        rawData: evidence.rawData,
        extractedAt: new Date(),
        relevanceScore: 0.6,
      })

      if (lead.signals.length < 2 && (evidence.signalEvidence?.length ?? 0) > 0) {
        lead.signals.push({
          companyId: lead.companyId,
          companyName: lead.companyName,
          signalType: 'burst',
          strength: evidence.signalStrength ?? 0.3,
          evidence: evidence.signalEvidence ?? [],
          detectedAt: new Date(),
        })
      }
    } catch (error) {
      this.logger.warn('business-signal enrichment failed', {
        companyId: lead.companyId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async enrichWithRegistry(lead: MultiSourceLead): Promise<void> {
    if (!this.fetchRegistryData) return
    try {
      const evidence = await this.fetchRegistryData(lead)
      if (!evidence) return

      lead.sources.push({
        sourceId: 'egrul-fns',
        sourceName: 'EGRUL/FNS',
        evidenceType: 'registry',
        confidence: 0.9,
        rawData: evidence.rawData,
        extractedAt: new Date(),
        relevanceScore: 0.8,
      })

      if (evidence.enrichment) {
        Object.assign(lead.enrichment, evidence.enrichment)
      }
    } catch (error) {
      this.logger.warn('registry enrichment failed', {
        companyId: lead.companyId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private filterAndRankLeads(
    leads: MultiSourceLead[],
    options: { industries?: string[]; regions?: string[]; minScore?: number },
  ): MultiSourceLead[] {
    const minScore = options.minScore ?? 0
    const adjusted = leads.map(lead => {
      const sourceCount = lead.sources.length
      const avgSourceConfidence = sourceCount > 0
        ? lead.sources.reduce((sum, s) => sum + s.confidence, 0) / sourceCount
        : 0
      const scoreMultiplier = 1 + Math.max(0, sourceCount - 1) * 0.1
      const adjustedScore = lead.score * scoreMultiplier * (avgSourceConfidence || 1)
      return { ...lead, score: Math.min(adjustedScore, 4) }
    })

    return adjusted
      .filter(lead => lead.score >= minScore)
      .sort((a, b) => b.score - a.score)
  }

  /**
   * Per-source analytics across a set of leads.
   */
  getSourceAnalytics(leads: MultiSourceLead[]) {
    const sourceStats = new Map<string, {
      count: number
      totalConfidence: number
      totalRelevance: number
    }>()

    leads.forEach(lead => {
      lead.sources.forEach(source => {
        const stats = sourceStats.get(source.sourceId) ?? {
          count: 0,
          totalConfidence: 0,
          totalRelevance: 0,
        }
        stats.count += 1
        stats.totalConfidence += source.confidence
        stats.totalRelevance += source.relevanceScore
        sourceStats.set(source.sourceId, stats)
      })
    })

    return {
      totalLeads: leads.length,
      sources: Array.from(sourceStats.entries()).map(([id, stats]) => ({
        id,
        count: stats.count,
        avgConfidence: stats.count > 0 ? stats.totalConfidence / stats.count : 0,
        avgRelevance: stats.count > 0 ? stats.totalRelevance / stats.count : 0,
        totalRelevance: stats.totalRelevance,
      })),
      coverage: this.calculateCoverage(leads),
    }
  }

  private calculateCoverage(leads: MultiSourceLead[]) {
    if (leads.length === 0) {
      return {
        totalCompanies: 0,
        avgSourcesPerLead: 0,
        highConfidenceLeads: 0,
        enrichedLeads: 0,
      }
    }
    return {
      totalCompanies: new Set(leads.map(l => l.companyId)).size,
      avgSourcesPerLead: leads.reduce((sum, l) => sum + l.sources.length, 0) / leads.length,
      highConfidenceLeads: leads.filter(l => l.confidence === 'A').length,
      enrichedLeads: leads.filter(l => Object.keys(l.enrichment).length > 0).length,
    }
  }
}
