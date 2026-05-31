/**
 * Multi-Source Lead Generation Platform
 *
 * Integrates all available sources to generate comprehensive lead candidates
 * with evidence from multiple data points for maximum confidence.
 */

import { createDefaultRouter } from '@/lib/sources/crawlers'
import type { CrawlerRouter, CrawlerFetchInput, CrawlerResult } from '@/lib/sources/crawlers'
import { HiringPatternDetector, type HiringPattern, type LeadCandidate, type HiringSignal } from './hiring-pattern-detector'
import type { HhDigestItem } from '@/lib/hhDigest'
import { selectConfidenceGate } from '@/lib/scoring/gates'
import type { ConfidenceGateInput, EntityMatchQuality } from '@/lib/scoring/gates'
import type { EvidenceTier } from '@/lib/db/evidence'

// Extend the interface to include confidence_gate (now in base type, kept for compatibility)
export type HhDigestItemWithConfidence = HhDigestItem

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
  enrichment: {
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

export interface EvidenceSource {
  sourceId: string
  sourceName: string
  evidenceType: 'vacancy' | 'career-page' | 'company-profile' | 'news' | 'registry'
  confidence: number
  rawData?: any
  extractedAt: Date
  relevanceScore: number
}

/**
 * Map EvidenceSource.evidenceType to Fiur evidence tier.
 * Career pages and company profiles are direct hiring proof.
 * Vacancies from job boards are corroboration.
 * News and registry data are context.
 */
function evidenceTypeToTier(type: EvidenceSource['evidenceType']): EvidenceTier {
  switch (type) {
    case 'career-page':
    case 'company-profile':
      return 'direct'
    case 'vacancy':
      return 'corroboration'
    case 'news':
    case 'registry':
    default:
      return 'context'
  }
}

/**
 * Recalculate confidence gate from current evidence sources.
 * Uses selectConfidenceGate as the sole authority.
 */
function recalculateConfidence(lead: MultiSourceLead): void {
  const evidence = lead.sources.map(s => ({
    tier: evidenceTypeToTier(s.evidenceType),
    source: s.sourceId,
  }))
  const entityMatch: EntityMatchQuality = lead.companyId ? 'clean' : 'questionable'
  const gateInput: ConfidenceGateInput = { evidence, entityMatch }
  lead.confidence = selectConfidenceGate(gateInput)
}

/**
 * Multi-source lead generator that aggregates evidence from all available sources
 */
export class MultiSourceLeadGenerator {
  private crawler: CrawlerRouter
  private sources: DataSource[]
  private activeSources: string[]

  constructor() {
    this.crawler = createDefaultRouter()
    this.sources = this.initializeSources()
    this.activeSources = this.getActiveSources()
  }

  /** Get Postgres pool from shared db module */
  private getDbPool() {
    const { getPool } = require('@/lib/db') as { getPool: () => import('pg').Pool | null }
    return getPool()
  }

  /** Categorize employee count into size bucket */
  private categorizeCompanySize(count: number): string {
    if (count < 10) return '1-10'
    if (count < 50) return '10-50'
    if (count < 500) return '50-500'
    if (count < 5000) return '500-5000'
    return '5000+'
  }

  /**
   * Initialize all available data sources
   */
  private initializeSources(): DataSource[] {
    return [
      // Primary sources (P1)
      {
        id: 'hh',
        name: 'HeadHunter',
        kind: 'job-board',
        confidence: 0.74,
        priority: 'P1',
        leadEligibility: 'digest-lead-originating',
        description: 'Primary platform for hiring evidence'
      },
      {
        id: 'career-pages',
        name: 'Career Pages',
        kind: 'career-page',
        confidence: 0.92,
        priority: 'P1',
        leadEligibility: 'digest-lead-originating',
        description: 'Direct company career pages'
      },
      {
        id: 'rabota-rossii',
        name: 'Rabota Rossii',
        kind: 'job-board',
        confidence: 0.7,
        priority: 'P1',
        leadEligibility: 'confidence-gated-evidence',
        description: 'Official Russian job board'
      },

      // Secondary sources (P2)
      {
        id: 'linkedin-company-pages',
        name: 'LinkedIn Company Pages',
        kind: 'company-site',
        confidence: 0.72,
        priority: 'P2',
        leadEligibility: 'confidence-gated-evidence',
        description: 'LinkedIn company pages'
      },
      {
        id: 'tech-job-boards',
        name: 'Tech Job Boards',
        kind: 'job-board',
        confidence: 0.68,
        priority: 'P2',
        leadEligibility: 'confidence-gated-evidence',
        description: 'Specialized tech job boards'
      },
      {
        id: 'superjob',
        name: 'SuperJob',
        kind: 'job-board',
        confidence: 0.66,
        priority: 'P2',
        leadEligibility: 'confidence-gated-evidence',
        description: 'Russian job board'
      },
      {
        id: 'habr-career',
        name: 'Habr Career',
        kind: 'job-board',
        confidence: 0.69,
        priority: 'P2',
        leadEligibility: 'confidence-gated-evidence',
        description: 'IT-focused job board'
      },
      {
        id: 'company-site',
        name: 'Company Websites',
        kind: 'company-site',
        confidence: 0.68,
        priority: 'P2',
        leadEligibility: 'enrichment-only',
        description: 'Direct company websites'
      },

      // Enrichment sources (P3)
      {
        id: 'egrul-fns',
        name: 'EGRUL/FNS Registry',
        kind: 'company-registry',
        confidence: 0.9,
        priority: 'P3',
        leadEligibility: 'enrichment-only',
        description: 'Company registry data'
      },
      {
        id: 'funding-business-signals',
        name: 'Funding Signals',
        kind: 'business-signal',
        confidence: 0.58,
        priority: 'P3',
        leadEligibility: 'context-only',
        description: 'Funding and growth signals'
      },
      {
        id: 'company-newsrooms',
        name: 'Company Newsrooms',
        kind: 'company-site',
        confidence: 0.6,
        priority: 'P3',
        leadEligibility: 'context-only',
        description: 'Company news and announcements'
      },
      {
        id: 'industry-media',
        name: 'Industry Media',
        kind: 'business-signal',
        confidence: 0.52,
        priority: 'P3',
        leadEligibility: 'context-only',
        description: 'Industry news and reports'
      }
    ]
  }

  /**
   * Get sources that are eligible for lead generation
   */
  private getActiveSources(): string[] {
    return this.sources
      .filter(source =>
        (source.priority !== 'P3' || source.leadEligibility === 'context-only')
      )
      .map(source => source.id)
  }

  /**
   * Generate leads from multiple sources
   */
  async generateLeads(options: {
    companies?: string[]
    industries?: string[]
    regions?: string[]
    minScore?: number
    sources?: string[]
    enableRealTime?: boolean
    clientProfileId?: string
  } = {}): Promise<MultiSourceLead[]> {
    const {
      companies = [],
      industries = [],
      regions = [],
      minScore = 1.0,
      sources = this.activeSources,
      enableRealTime = false,
      clientProfileId
    } = options

    const allLeads: MultiSourceLead[] = []

    // Step 1: Generate leads from all job board sources via DB pipeline
    // (HH, Rabota Rossii, SuperJob, Habr Career, etc. — all sources in source-digest-evidence.sql)
    const jobBoardLeads = await this.generateJobBoardLeads(clientProfileId)
    allLeads.push(...jobBoardLeads)

    // Step 2: Fetch career pages for enrichment
    if (sources.includes('career-pages')) {
      await this.enrichWithCareerPages(allLeads)
    }

    // Step 3: Add business signals from secondary sources
    if (sources.includes('funding-business-signals')) {
      await this.addBusinessSignals(allLeads)
    }

    // Step 4: Enrich with company registry data
    if (sources.includes('egrul-fns')) {
      await this.enrichWithRegistryData(allLeads)
    }

    // Step 5: Real-time crawling is handled by n8n scheduler via source scripts
    // (enableRealTime is kept as no-op for API backward compatibility)

    // Step 6: Aggregate leads — entity resolution and deduplication
    const aggregatedLeads = await this.deduplicateLeads(allLeads)

    // Step 7: Filter and rank final leads
    return this.filterAndRankLeads(aggregatedLeads, {
      industries,
      regions,
      minScore
    })
  }

  /**
   * Generate leads from all job board sources via the real DB pipeline.
   * Reads from signals → source-digest-evidence.sql → digest items.
   * Now covers HH, Rabota Rossii, SuperJob, Habr Career, etc.
   */
  private async generateJobBoardLeads(clientProfileId?: string): Promise<MultiSourceLead[]> {
    const { getHhDigestItems } = await import('@/lib/hhDigest')

    // Fetch real digest items from DB — client-scoped or preview
    const digestItems = await getHhDigestItems({
      clientProfileId: clientProfileId || null
    })

    if (digestItems.length === 0) {
      return []
    }

    // Convert digest items to candidates via the detector
    const candidates = HiringPatternDetector.digestToLeadCandidates(
      digestItems as HhDigestItemWithConfidence[]
    )

    // Source name lookup for mapping source families to evidence sources
    const sourceNameMap: Record<string, string> = {
      'hh': 'HeadHunter',
      'rabota-rossii': 'Rabota Rossii',
      'career-pages': 'Career Pages',
      'superjob': 'SuperJob',
      'habr-career': 'Habr Career',
      'tech-job-boards': 'Tech Job Boards',
      'linkedin-company-pages': 'LinkedIn',
    }

    // Convert to MultiSourceLead format — one evidence source per source family
    return candidates.map(candidate => {
      const matchingItem = digestItems.find(item => item.org_id === candidate.companyId)
      const sourceFamilies = matchingItem?.source_families || ['hh']

      // Build evidence sources from all contributing source families
      const evidenceSources: EvidenceSource[] = sourceFamilies.map(sourceId => ({
        sourceId,
        sourceName: sourceNameMap[sourceId] || sourceId,
        evidenceType: (sourceId === 'career-pages' ? 'career-page' : 'vacancy') as EvidenceSource['evidenceType'],
        confidence: this.sources.find(s => s.id === sourceId)?.confidence ?? 0.5,
        rawData: matchingItem,
        extractedAt: new Date(),
        relevanceScore: candidate.score / 4
      }))

      // Blocked sources (provider-or-snapshot-only) get capped at confidence C
      const blockedSources = new Set([
        'superjob', 'habr-career', 'linkedin-company-pages',
        'tech-job-boards', 'regional-job-boards'
      ])
      const hasBlockedSource = sourceFamilies.some(s => blockedSources.has(s))
      // If ALL sources are blocked, cap confidence at C (review required)
      // If at least one P1 digest-allowed source is present, use the gate from SQL
      const allBlocked = sourceFamilies.every(s => blockedSources.has(s))

      return {
        id: `multi-${candidate.id}`,
        companyId: candidate.companyId,
        companyName: candidate.companyName,
        score: candidate.score,
        confidence: allBlocked
          ? (candidate.confidence === 'A' || candidate.confidence === 'B' ? 'C' as const : candidate.confidence)
          : candidate.confidence,
        sources: evidenceSources,
        signals: candidate.signals,
        nextAction: candidate.nextAction,
        reasons: candidate.reasons,
        detectedAt: candidate.detectedAt,
        enrichment: {}
      }
    })
  }

  /**
   * Enrich leads with career page evidence.
   * Uses real website URL from orgs table when available, falls back to slug-based URL.
   */
  private async enrichWithCareerPages(leads: MultiSourceLead[]): Promise<void> {
    // Build org_id → website_url map from DB
    const pool = this.getDbPool()
    const websiteMap = new Map<string, string>()

    if (pool) {
      try {
        const orgIds = leads.map(l => l.companyId).filter(Boolean)
        if (orgIds.length > 0) {
          const result = await pool.query(
            `SELECT id, website_url FROM orgs WHERE id = ANY($1) AND website_url IS NOT NULL`,
            [orgIds]
          )
          for (const row of result.rows as Array<Record<string, unknown>>) {
            websiteMap.set(String(row.id), String(row.website_url))
          }
        }
      } catch (error) {
        console.warn('Failed to fetch website URLs from orgs:', error)
      }
    }

    for (const lead of leads) {
      try {
        // Use real website URL from DB, or fall back to slug-based guess
        const websiteUrl = websiteMap.get(lead.companyId)
        let careerUrl: string
        if (websiteUrl) {
          // Try common career page paths
          careerUrl = `${websiteUrl.replace(/\/$/, '')}/careers`
          lead.enrichment.website = websiteUrl
        } else {
          careerUrl = `https://${lead.companyName.toLowerCase().replace(/\s+/g, '-')}.com/careers`
        }

        const crawlInput: CrawlerFetchInput = {
          url: careerUrl,
          options: {
            timeoutMs: 10000
          }
        }

        const result: CrawlerResult = await this.crawler.fetch(crawlInput)

        if (result.status === 200 && result.html) {
          const evidence: EvidenceSource = {
            sourceId: 'career-pages',
            sourceName: 'Career Pages',
            evidenceType: 'career-page',
            confidence: 0.92,
            rawData: {
              html: result.html,
              url: result.url,
              fetchedAt: result.fetchedAt
            },
            extractedAt: new Date(result.fetchedAt),
            relevanceScore: 0.9
          }

          // Add evidence if not already present
          if (!lead.sources.find(s => s.sourceId === 'career-pages')) {
            lead.sources.push(evidence)

            // Recalculate confidence gate via selectConfidenceGate
            // (career-page is 'direct' tier, which can promote B→A)
            recalculateConfidence(lead)

            // Add signal for direct career page
            lead.signals.push({
              companyId: lead.companyId,
              companyName: lead.companyName,
              signalType: 'fresh',
              strength: 1.0,
              evidence: ['Найдена прямая карьерная страница'],
              detectedAt: new Date()
            })
          }
        }
      } catch (error) {
        console.warn(`Failed to crawl career page for ${lead.companyName}:`, error)
      }
    }
  }

  /**
   * Add business signals from real data in the signals table.
   * Context-only sources (funding, news, media) enrich but never originate leads.
   * If no data exists for an org, skip enrichment (no fake data).
   */
  private async addBusinessSignals(leads: MultiSourceLead[]): Promise<void> {
    const pool = this.getDbPool()
    if (!pool) return

    const contextSources = ['funding-business-signals', 'company-newsrooms', 'industry-media']

    for (const lead of leads) {
      try {
        const result = await pool.query(
          `SELECT source, payload, headline, occurred_at FROM signals
           WHERE org_id = $1 AND source = ANY($2)
           ORDER BY occurred_at DESC LIMIT 5`,
          [lead.companyId, contextSources]
        )

        for (const row of result.rows as Array<Record<string, unknown>>) {
          const rowSource = String(row.source)
          const sourceConfig = this.sources.find(s => s.id === rowSource)
          if (!sourceConfig) continue

          // Skip if already present
          if (lead.sources.find(s => s.sourceId === rowSource)) continue

          const evidence: EvidenceSource = {
            sourceId: rowSource,
            sourceName: sourceConfig.name,
            evidenceType: 'news',
            confidence: sourceConfig.confidence,
            rawData: row.payload,
            extractedAt: new Date(String(row.occurred_at)),
            relevanceScore: sourceConfig.confidence
          }

          lead.sources.push(evidence)

          // Add context signal from headline
          const headline = row.headline ? String(row.headline) : null
          if (headline) {
            lead.signals.push({
              companyId: lead.companyId,
              companyName: lead.companyName,
              signalType: 'burst',
              strength: sourceConfig.confidence,
              evidence: [headline],
              detectedAt: new Date(String(row.occurred_at))
            })
          }
        }
      } catch (error) {
        console.warn(`Failed to fetch business signals for ${lead.companyName}:`, error)
      }
    }

    // Recalculate confidence after adding evidence
    for (const lead of leads) {
      recalculateConfidence(lead)
    }
  }

  /**
   * Enrich with company registry data from real signals in the DB.
   * If no EGRUL data exists for an org, skip enrichment (no fake data).
   */
  private async enrichWithRegistryData(leads: MultiSourceLead[]): Promise<void> {
    const pool = this.getDbPool()
    if (!pool) return

    for (const lead of leads) {
      try {
        const result = await pool.query(
          `SELECT payload FROM signals
           WHERE org_id = $1 AND source = 'egrul-fns'
           ORDER BY occurred_at DESC LIMIT 1`,
          [lead.companyId]
        )

        if (result.rows.length > 0) {
          const payload = result.rows[0].payload
          const registryData: EvidenceSource = {
            sourceId: 'egrul-fns',
            sourceName: 'EGRUL/FNS',
            evidenceType: 'registry',
            confidence: 0.9,
            rawData: payload,
            extractedAt: new Date(),
            relevanceScore: 0.8
          }

          lead.sources.push(registryData)

          // Extract enrichment fields from payload
          const p = payload as Record<string, unknown>
          if (p?.employee_count || p?.employeesCount) {
            const count = Number(p.employee_count || p.employeesCount) || 0
            lead.enrichment.companySize = this.categorizeCompanySize(count)
            lead.enrichment.employeeCount = count
          }
          if (p?.legal_form || p?.legalForm) {
            lead.enrichment.industry = lead.enrichment.industry || []
          }
        }
      } catch (error) {
        console.warn(`Failed to fetch EGRUL data for ${lead.companyName}:`, error)
      }
    }

    // Recalculate confidence after adding evidence
    for (const lead of leads) {
      recalculateConfidence(lead)
    }
  }

  /**
   * Deduplicate leads using EntityResolver from LeadAggregator.
   * Groups leads by canonicalCompanyId, merges sources, and keeps the highest-scored lead.
   */
  private async deduplicateLeads(leads: MultiSourceLead[]): Promise<MultiSourceLead[]> {
    if (leads.length === 0) return []

    const { EntityResolver } = await import('./lead-aggregator')
    const resolver = new EntityResolver()

    // Resolve entity IDs for all leads
    const resolved = await resolver.resolveAll(leads)

    // Group by canonicalCompanyId
    const groups = new Map<string, (typeof resolved)[number][]>()
    for (const lead of resolved) {
      const key = lead.canonicalCompanyId
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(lead)
    }

    // Merge each group: keep highest-scored lead, combine sources
    const deduplicated: MultiSourceLead[] = []
    for (const [, group] of groups) {
      // Sort by score descending, take the best lead as representative
      group.sort((a: typeof group[number], b: typeof group[number]) => b.score - a.score)
      const best = group[0]

      // Merge sources from all leads in the group (deduplicate by sourceId)
      const seenSourceIds = new Set(best.sources.map((s: EvidenceSource) => s.sourceId))
      for (const other of group.slice(1)) {
        for (const source of other.sources) {
          if (!seenSourceIds.has(source.sourceId)) {
            best.sources.push(source)
            seenSourceIds.add(source.sourceId)
          }
        }
        // Merge signals too
        for (const signal of other.signals) {
          if (!best.signals.some((s: HiringSignal) => s.signalType === signal.signalType && s.strength === signal.strength)) {
            best.signals.push(signal)
          }
        }
        // Merge enrichment
        if (other.enrichment) {
          for (const [key, value] of Object.entries(other.enrichment)) {
            if (value !== undefined && (best.enrichment as Record<string, unknown>)[key] === undefined) {
              (best.enrichment as Record<string, unknown>)[key] = value
            }
          }
        }
      }

      // Recalculate confidence after merging sources
      recalculateConfidence(best)

      deduplicated.push(best)
    }

    return deduplicated
  }

  /**
   * Filter and rank leads based on criteria
   */
  private filterAndRankLeads(
    leads: MultiSourceLead[],
    options: { industries?: string[]; regions?: string[]; minScore?: number }
  ): MultiSourceLead[] {
    let filtered = leads

    // Apply score filter — score comes from DB/FIUR, do NOT recalculate here
    if (options.minScore) {
      filtered = filtered.filter(lead => lead.score >= (options.minScore || 0))
    }

    // Sort by score descending
    return filtered.sort((a, b) => b.score - a.score)
  }

  /**
   * Get lead source analytics
   */
  getSourceAnalytics(leads: MultiSourceLead[]) {
    const sourceStats = new Map<string, {
      count: number
      avgConfidence: number
      totalRelevance: number
    }>()

    leads.forEach(lead => {
      lead.sources.forEach(source => {
        if (!sourceStats.has(source.sourceId)) {
          sourceStats.set(source.sourceId, {
            count: 0,
            avgConfidence: 0,
            totalRelevance: 0
          })
        }

        const stats = sourceStats.get(source.sourceId)!
        stats.count++
        stats.totalRelevance += source.relevanceScore
      })
    })

    // Calculate averages
    sourceStats.forEach(stats => {
      // This method was incorrectly implemented - it should track per-lead source data
      // For now, just keep the count and relevance metrics
    })

    return {
      totalLeads: leads.length,
      sources: Array.from(sourceStats.entries()).map(([id, stats]) => ({
        id,
        ...stats,
        avgRelevance: stats.count > 0 ? stats.totalRelevance / stats.count : 0
      })),
      coverage: this.calculateCoverage(leads)
    }
  }

  /**
   * Calculate coverage metrics
   */
  private calculateCoverage(leads: MultiSourceLead[]) {
    const coverage = {
      totalCompanies: new Set(leads.map(l => l.companyId)).size,
      avgSourcesPerLead: leads.reduce((sum, l) => sum + l.sources.length, 0) / leads.length,
      highConfidenceLeads: leads.filter(l => l.confidence === 'A').length,
      enrichedLeads: leads.filter(l => Object.keys(l.enrichment).length > 0).length
    }

    return coverage
  }
}