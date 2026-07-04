/**
 * Lead Scoring Service
 *
 * Bridges the multi-source lead generator with the scoring pipeline,
 * converting raw leads from multiple sources into scored and ranked
 * agency leads with explainable breakdowns.
 */

import { runScoringPipeline } from '@/lib/scoring/scoring-pipeline'
import { computeClientOverrides } from '@/lib/scoring/client-overrides'
import type { FiurClientOverrides } from '@/lib/scoring/fiur'
import { MultiSourceLeadGenerator } from './multi-source-lead-generator'
import pLimit from 'p-limit'
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
import { hasCorporateSurface } from '@/lib/contact-policy-filter'
import { detectForeignEmployer } from '@/lib/scoring/foreign-employer'
import {
  repairWeakCareerPage,
  createFirecrawlProvider,
  isFirecrawlConfigured,
  createCrawl4aiProvider,
  isCrawl4aiConfigured,
  persistEnrichmentForCandidate,
  hasEnrichment,
  type ScrapeProvider,
  type MarkdownProvider,
  type WeakCareerPageCandidate,
  type CareerPageEnrichmentResult,
} from '@/lib/ai'

export interface LeadScoringOptions {
  agencyProfile: AgencyProfile
  sources?: string[]
  minScore?: number
  enableRealTime?: boolean
  clientProfileId?: string
  marketContext?: {
    industryGrowth?: Record<string, number>
    marketConditions?: 'boom' | 'normal' | 'bust'
    competitiveLandscape?: Record<string, number>
  }
}

export interface ScoredLead extends AggregatedLead {
  scoringBreakdown: ScoringPipelineResult['breakdown']
  finalScore: number
  /**
   * Optional AI-recovered hiring signals for weak career pages. This is a
   * SEPARATE, attributed layer (provider + confidence + sourceUrl) that sits
   * alongside — never inside — the deterministic `enrichment`/score/gate/evidence.
   * Absent unless a provider is configured AND the page was weak. Scoring does
   * NOT depend on it; downstream may read it as an optional hint.
   */
  aiEnrichment?: CareerPageEnrichmentResult
}

/**
 * Main service for scoring leads from multiple sources
 */
export class LeadScoringService {
  private leadGenerator: MultiSourceLeadGenerator
  /**
   * Lazily-built enrichment provider. Created once per service when an API key
   * is configured; null when enrichment is off (no key) so the scoring loop is
   * entirely unaffected. The provider itself never throws to callers.
   */
  private enrichmentProvider: ScrapeProvider | null | undefined
  /**
   * Lazily-built Crawl4AI markdown fallback. Used only to PREPARE clean markdown
   * when the primary extract comes back empty (future re-extraction retry path);
   * null when CRAWL4AI_API_URL is absent. Never affects the returned result.
   */
  private fallbackProvider: MarkdownProvider | null | undefined

  constructor() {
    this.leadGenerator = new MultiSourceLeadGenerator()
  }

  /**
   * Resolve the AI enrichment provider, or null when enrichment is disabled.
   * Memoized: built at most once. `undefined` means "not yet resolved", `null`
   * means "resolved to off". Off whenever FIRECRAWL_API_KEY is absent, so the
   * common path does no work and runs no network call.
   */
  private getEnrichmentProvider(): ScrapeProvider | null {
    if (this.enrichmentProvider === undefined) {
      this.enrichmentProvider = isFirecrawlConfigured()
        ? createFirecrawlProvider()
        : null
    }
    return this.enrichmentProvider
  }

  /**
   * Resolve the Crawl4AI markdown fallback, or null when it is not configured.
   * Memoized like the primary provider. Off whenever CRAWL4AI_API_URL is absent,
   * so the fallback prep path is simply skipped.
   */
  private getFallbackProvider(): MarkdownProvider | null {
    if (this.fallbackProvider === undefined) {
      this.fallbackProvider = isCrawl4aiConfigured()
        ? createCrawl4aiProvider()
        : null
    }
    return this.fallbackProvider
  }

  /**
   * Best-effort AI enrichment for a single scored lead. Runs ONLY when a
   * provider is configured AND the lead's career page is weak (quality <= 0.4
   * with a URL — judged inside repairWeakCareerPage). Returns a SEPARATE
   * attributed result; it never touches score, gate, evidence, or the
   * deterministic `enrichment`. Any failure degrades to undefined.
   */
  private async enrichWeakCareerPage(
    lead: MultiSourceLead,
    clientProfileId?: string,
  ): Promise<CareerPageEnrichmentResult | undefined> {
    const provider = this.getEnrichmentProvider()
    if (!provider) return undefined

    const careerPageUrl = lead.enrichment.careerPageUrl ?? null
    if (!careerPageUrl) return undefined

    const candidate: WeakCareerPageCandidate = {
      orgId: lead.companyId,
      careerPageUrl,
      qualityInput: {
        url: careerPageUrl,
        vacancyCount: lead.signals.length,
        contactPaths: this.extractContactPaths(lead),
        lastModifiedAt: lead.enrichment.lastHiringActivity ?? null,
      },
      knownRoleTitles: lead.signals
        .map(s => this.extractRoleTitle(s))
        .filter(t => t && t !== 'Hiring Position'),
      confidenceGate: lead.confidence,
    }

    try {
      const fallbackProvider = this.getFallbackProvider() ?? undefined
      const result = await repairWeakCareerPage(candidate, provider, { fallbackProvider })

      // Persist a SUCCESSFUL enrichment onto the candidate row (best-effort).
      // Writes ONLY the ai_enrichment column — never the deterministic core —
      // and only when we know which client profile owns the candidate. A DB
      // failure here must not abort scoring, so it degrades to a logged warning.
      if (clientProfileId && hasEnrichment(result)) {
        try {
          await persistEnrichmentForCandidate({
            clientProfileId,
            orgId: lead.companyId,
            enrichment: result,
          })
        } catch (persistError) {
          console.error(
            JSON.stringify({
              level: 'error',
              event: 'ai.enrichment.persist_failed',
              orgId: lead.companyId,
              message: persistError instanceof Error ? persistError.message : 'unknown_error',
            }),
          )
        }
      }

      return result
    } catch (error) {
      // repairWeakCareerPage already degrades internally; this is belt-and-braces
      // so enrichment can never abort a scoring run.
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'ai.enrichment.repair_failed',
          orgId: lead.companyId,
          message: error instanceof Error ? error.message : 'unknown_error',
        }),
      )
      return undefined
    }
  }

  /**
   * Generate and score leads from multiple sources.
   * Used by /api/leads/score which doesn't have pre-generated leads.
   */
  async generateAndScoreLeads(options: LeadScoringOptions): Promise<ScoredLead[]> {
    // Generate raw leads from specified sources
    const rawLeads = await this.leadGenerator.generateLeads({
      industries: options.agencyProfile.industries,
      regions: options.agencyProfile.locations,
      minScore: options.minScore || 1.0,
      sources: options.sources || [],
      enableRealTime: options.enableRealTime || false,
      clientProfileId: options.clientProfileId,
    })

    return this.scoreExistingLeads(rawLeads, options)
  }

  /**
   * Score already-generated leads without re-generating them.
   * Used by /api/leads/generate which already has rawLeads from the generator.
   * Avoids the double-generation problem where route generates leads
   * and then generateAndScoreLeads would generate them again.
   */
  async scoreExistingLeads(
    rawLeads: MultiSourceLead[],
    options: LeadScoringOptions
  ): Promise<ScoredLead[]> {
    if (rawLeads.length === 0) return []

    // T6.2: resolve feedback-driven reweighting overrides ONCE per run.
    // computeClientOverrides is a single DB query — running it per-lead would
    // issue one query per lead. The result is identical for every lead in the
    // batch (it depends only on the client profile's badfit history), so we
    // hoist it out of the scoring loop.
    const clientOverrides = await this.resolveClientOverrides(options.clientProfileId)

    // Score in batches to bound total promise creation (1000 leads would
    // create 1000 promises at once without batching).
    const BATCH = 50
    const limit = pLimit(10)
    const scoredLeads: ScoredLead[] = []

    for (let i = 0; i < rawLeads.length; i += BATCH) {
      const batch = rawLeads.slice(i, i + BATCH)
      const results = await Promise.all(
        batch.map(lead => limit(() => this.scoreLead(lead, options, clientOverrides)))
      )
      scoredLeads.push(...results)
    }

    // Filter by minimum score and sort
    return scoredLeads
      .filter(lead => lead.finalScore >= (options.minScore || 1.0))
      .sort((a, b) => b.finalScore - a.finalScore)
  }

  /**
   * T6.2: Resolve feedback-driven reweighting overrides for a client profile.
   *
   * Reads badfit history via computeClientOverrides and returns the
   * FiurClientOverrides to feed into the scoring pipeline. Returns undefined
   * when there is no client profile, no DB, or no penalties — in which case
   * scoring proceeds without reweighting.
   *
   * DB failures are isolated: a broken overrides query must not abort the
   * whole scoring run (the core loop degrades to un-reweighted scoring rather
   * than returning zero leads).
   */
  private async resolveClientOverrides(
    clientProfileId?: string
  ): Promise<FiurClientOverrides | undefined> {
    if (!clientProfileId) return undefined

    try {
      const result = await computeClientOverrides(clientProfileId)
      if (!result || Object.keys(result.overrides).length === 0) {
        return undefined
      }
      return result.overrides
    } catch (error) {
      console.error('Failed to compute client overrides; scoring without reweighting:', error)
      return undefined
    }
  }

  /**
   * Score a single lead using the pipeline
   */
  private async scoreLead(
    lead: MultiSourceLead,
    options: LeadScoringOptions,
    clientOverrides?: FiurClientOverrides
  ): Promise<ScoredLead> {
    // Convert multi-source lead to scoring pipeline input
    const pipelineInput = this.convertToScoringInput(lead, options, clientOverrides)

    // Run the scoring pipeline
    const result = runScoringPipeline(pipelineInput)

    // FIUR total is the canonical score ∈ [0, 4].
    // All scoring factors (source diversity, market context, recent signals)
    // are now handled inside computeFiur — no post-hoc adjustments.

    // Take best confidence gate — the SQL/DB pipeline may have assigned
    // a higher gate (e.g. A from 2+ independent evidence layers in digest_items)
    // than the type-based selectConfidenceGate (vacancy→corroboration→C).
    // Enrichment/promotion only, never demotion.
    const gateOrder: Record<string, number> = { 'A': 4, 'B': 3, 'C': 2, 'D': 1 }
    const bestConfidence = gateOrder[lead.confidence] > gateOrder[result.lead.confidence]
      ? lead.confidence
      : result.lead.confidence

    const finalScore = result.lead.score

    // AI enrichment runs AFTER the deterministic score + gate are final, and its
    // result is stored in a SEPARATE field. It cannot, by construction, change
    // finalScore or bestConfidence computed above.
    const aiEnrichment = await this.enrichWeakCareerPage(lead, options.clientProfileId)

    return {
      id: lead.id,
      canonicalCompanyId: lead.companyId,
      companyName: lead.companyName,
      displayName: lead.companyName,
      score: finalScore,
      confidence: bestConfidence,
      sources: lead.sources.map(s => ({
        sourceId: s.sourceId,
        sourceName: s.sourceName,
        evidenceType: s.evidenceType,
        confidence: s.confidence,
        relevanceScore: s.relevanceScore,
        contributedSignals: [],
        extractedAt: s.extractedAt,
      })),
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
      qualityMetrics: this.computeQualityMetrics(lead),
      signals: lead.signals,
      nextAction: lead.nextAction,
      reasons: lead.reasons,
      detectedAt: lead.detectedAt,
      enrichment: lead.enrichment,
      scoringBreakdown: result.breakdown,
      finalScore,
      ...(aiEnrichment ? { aiEnrichment } : {}),
    }
  }


  /**
   * T2.1: Compute qualityMetrics from real enrichment data
   */
  computeQualityMetrics(lead: MultiSourceLead): { completeness: number; freshness: number; reliability: number } {
    // completeness: fraction of enrichment fields filled (out of 10 possible)
    const enrichment = lead.enrichment
    const fields: (unknown)[] = [
      enrichment.companySize,
      enrichment.industry,
      enrichment.locations,
      enrichment.hiringVelocity,
      enrichment.lastHiringActivity,
      enrichment.website,
      enrichment.employeeCount,
      enrichment.hasCareerPage,
      enrichment.hasContactPath,
      enrichment.careerPageUrl,
    ]
    const filledCount = fields.filter(f => f !== undefined && f !== null && f !== '' && !(Array.isArray(f) && f.length === 0)).length
    const completeness = filledCount / fields.length

    // reliability: independent sources / 3, clamped to [0, 1]
    const independentSources = lead.sources.length
    const reliability = Math.min(independentSources / 3, 1)

    // freshness: derived from pipeline breakdown if available, otherwise from detectedAt
    // Use the most recent source extraction time as a proxy
    const now = Date.now()
    const latestExtraction = lead.sources.reduce((max: number, s) => {
      const t = s.extractedAt?.getTime?.() ?? 0
      return t > max ? t : max
    }, 0)
    const hoursAgo = latestExtraction ? (now - latestExtraction) / (60 * 60 * 1000) : 999
    let freshness: number
    if (hoursAgo <= 24) freshness = 1.0
    else if (hoursAgo <= 72) freshness = 0.7
    else if (hoursAgo <= 168) freshness = 0.4
    else freshness = 0.1

    return { completeness, freshness, reliability }
  }

  /**
   * T2.2: Count signals with timestamps within the last 7 days
   */
  countRecentSignals(signals: HiringSignal[]): number {
    const now = Date.now()
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000

    return signals.filter(signal => {
      if (!signal.timestamp) return false // Safe fallback: no timestamp → no boost
      return (now - signal.timestamp.getTime()) <= sevenDaysMs
    }).length
  }

  /**
   * T3.3: Map marketContext to MarketFitInput — no 'as any' cast
   */
  mapMarketContext(ctx: LeadScoringOptions['marketContext']): ScoringPipelineInput['marketContext'] {
    if (!ctx) return undefined

    let industryTrend: 'growing' | 'stable' | 'declining' = 'stable'
    if (ctx.marketConditions === 'boom') industryTrend = 'growing'
    else if (ctx.marketConditions === 'bust') industryTrend = 'declining'

    return {
      industryTrend,
      growthSignals: Object.keys(ctx.industryGrowth || {}),
      expandingIntoNewMarket: false,
    }
  }

  /**
   * T2.3: Convert signals to vacancies using real publishedAt and location
   */
  convertSignalsToVacancies(signals: HiringSignal[]): PipelineVacancy[] {
    return signals
      .filter(signal => signal.signalType === 'burst' || signal.signalType === 'fresh')
      .map((signal, index) => ({
        id: `signal-${index}`,
        title: this.extractRoleTitle(signal),
        role: this.normalizeRole(signal),
        location: signal.location ?? '', // T2.3: real location from signal
        publishedAt: signal.publishedAt ?? signal.detectedAt.toISOString(), // T2.3: real date from signal
        isInternalRecruiter: signal.evidence?.includes('internal'),
        isHardToFill: signal.evidence?.includes('hard_to_fill'),
        sourceTier: this.mapEvidenceTier(signal),
        salaryFrom: this.extractSalary(signal, 'min'),
        salaryTo: this.extractSalary(signal, 'max'),
        salaryCurrency: 'RUB',
      }))
  }

  /**
   * Convert MultiSourceLead to ScoringPipelineInput
   */
  private convertToScoringInput(
    lead: MultiSourceLead,
    options: LeadScoringOptions,
    clientOverrides?: FiurClientOverrides
  ): ScoringPipelineInput {
    // Extract contact paths, then derive the corporate-surface flag from the
    // actual paths rather than the raw enrichment.hasContactPath bool — a lead
    // can have a contact path that is personal-only and not a safe corporate surface.
    const contactPaths: ContactPath[] = this.extractContactPaths(lead)

    // Extract company info from lead
    const company: PipelineCompany = {
      id: lead.companyId,
      name: lead.companyName,
      website: lead.enrichment.website,
      industry: lead.enrichment.industry?.[0],
      industries: lead.enrichment.industry,
      country: this.deriveCountry(lead),
      locations: lead.enrichment.locations?.[0] ? [lead.enrichment.locations[0]] : [],
      size: this.mapCompanySize(lead.enrichment.companySize),
      employeeCount: lead.enrichment.employeeCount,
      hasCareerPage: lead.enrichment.hasCareerPage,
      hasCorporateContactPath: hasCorporateSurface(contactPaths),
    }

    // Convert signals to vacancies (T2.3: uses real publishedAt and location)
    const vacancies: PipelineVacancy[] = this.convertSignalsToVacancies(lead.signals)

    // Convert sources to evidence
    const evidence: PipelineEvidence[] = lead.sources.map(source => ({
      source: source.sourceId,
      tier: this.mapEvidenceTierFromSource(source),
      fetchedAt: source.extractedAt.toISOString(),
    }))

    return {
      leadId: lead.id,
      company,
      vacancies,
      evidence,
      contactPaths,
      agencyProfile: options.agencyProfile,
      marketContext: this.mapMarketContext(options.marketContext),
      entityMatch: lead.companyId ? 'clean' : 'questionable',
      recentSignalCount: this.countRecentSignals(lead.signals),
      clientOverrides,
    }
  }

  /**
   * Helper methods for conversion
   */
  /**
   * Derive a country marker for the Russia-first Fit geo gate. Reuses the shared
   * foreign-employer detector over the lead's career-page URL / website /
   * locations: a foreign-ATS host with no RU footprint → foreign country code;
   * otherwise undefined (unknown), so a RU or ambiguous company is never
   * penalised. The deterministic SQL path applies the same rule at the row level.
   */
  private deriveCountry(lead: MultiSourceLead): string | undefined {
    const careerPageUrl = lead.enrichment.careerPageUrl ?? null
    const website = lead.enrichment.website ?? null
    const locations = lead.enrichment.locations ?? []
    const foreign = detectForeignEmployer({
      sourceDisplayName: lead.companyName,
      sourceExternalId: careerPageUrl ?? website,
      candidateSourceKeys: [careerPageUrl, website].filter((v): v is string => Boolean(v)),
      locationNames: locations,
    })
    return foreign.isForeign ? (foreign.matchedDomain ?? 'foreign') : undefined
  }

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
    // Tier mapping must be consistent with evidenceTypeToTier in multi-source-lead-generator.ts.
    // Career page = direct, vacancy/job-board = corroboration, registry = corroboration, news/context = context.
    // Source ID alone is NOT sufficient — two sources can produce different evidence types.
    // Use the evidenceType from the source object for canonical tier mapping.
    switch (source.evidenceType) {
      case 'career-page':
      case 'company-profile':
        return 'direct' as const
      case 'registry':
      case 'vacancy':
        return 'corroboration' as const
      case 'news':
      default:
        return 'context' as const
    }
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