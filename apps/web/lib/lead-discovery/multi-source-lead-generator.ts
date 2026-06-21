/**
 * Multi-Source Lead Generation Platform
 *
 * Integrates all available sources to generate comprehensive lead candidates
 * with evidence from multiple data points for maximum confidence.
 */

import { createDefaultRouter } from '@/lib/sources/crawlers'
import type { CrawlerRouter, CrawlerFetchInput, CrawlerResult } from '@/lib/sources/crawlers'
import { validateCrawlerUrl } from '@/lib/sources/crawlers/url-validator'
import { HiringPatternDetector, type HiringPattern, type LeadCandidate, type HiringSignal } from './hiring-pattern-detector'
import type { HhDigestItem } from '@/lib/hhDigest'
import pLimit from 'p-limit'
import { selectConfidenceGate } from '@/lib/scoring/gates'
import type { ConfidenceGateInput, ConfidenceGate, EntityMatchQuality } from '@/lib/scoring/gates'
import type { EvidenceTier } from '@/lib/db/evidence'
import { evidenceTypeToTier } from '@/lib/db/evidence'
import { getPool } from '@/lib/db'
import { withRetry } from '@/lib/utils/retry'

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
  /** Russian tax ID (ИНН). When present, used as primary key for entity resolution. */
  inn?: string
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

/** Per-source execution outcome for one generateLeads() run. */
export interface SourceRunStatus {
  status: 'ok' | 'error'
  /** Number of leads/evidence contributed by this source on this run. */
  leads_count: number
  /** Error message when status === 'error'. */
  error?: string
}

/**
 * Map of sourceName → outcome for the most recent generateLeads() run.
 * Exposed via getLastRunSourceReport() so callers (API routes, cron) can
 * surface which sources succeeded vs. failed without changing the array
 * return shape of generateLeads().
 */
export type SourceRunReport = Record<string, SourceRunStatus>

/**
 * Recalculate confidence gate from current evidence sources.
 * Uses selectConfidenceGate to compute the type-based gate, then
 * takes the best (highest) of the SQL-originated gate and the
 * type-based gate. This prevents enrichment from *downgrading*
 * a gate that was already correct from the SQL pipeline (e.g. HH
 * with 2+ independent evidence layers → A, but evidenceType alone
 * would yield C because vacancy→corroboration tier).
 */
function recalculateConfidence(lead: MultiSourceLead): void {
  const evidence = lead.sources.map(s => ({
    tier: evidenceTypeToTier(s.evidenceType),
    source: s.sourceId,
  }))
  const entityMatch: EntityMatchQuality = lead.companyId ? 'clean' : 'questionable'
  const gateInput: ConfidenceGateInput = { evidence, entityMatch }
  const typeBasedGate = selectConfidenceGate(gateInput)

  // Take the best gate — enrichment can only promote, never demote
  const gateOrder: Record<ConfidenceGate, number> = { 'A': 4, 'B': 3, 'C': 2, 'D': 1 }
  const currentGate = lead.confidence
  lead.confidence = gateOrder[typeBasedGate] > gateOrder[currentGate]
    ? typeBasedGate
    : currentGate
}

/**
 * Map a sourceId to its canonical EvidenceSourceType.
 *
 * Aligns with `evidenceTypeToTier` in @/lib/db/evidence:
 *   career-page, company-profile → direct
 *   registry, vacancy            → corroboration
 *   news                         → context
 *
 * Single mapping point — used by MultiSourceLeadGenerator and LeadAggregator.
 */
const SOURCE_ID_TO_EVIDENCE_TYPE: Record<string, EvidenceSource['evidenceType']> = {
  'career-pages': 'career-page',
  'company-site': 'company-profile',
  'linkedin-company-pages': 'company-profile',
  'hh': 'vacancy',
  'rabota-rossii': 'vacancy',
  'superjob': 'vacancy',
  'habr-career': 'vacancy',
  'tech-job-boards': 'vacancy',
  'regional-job-boards': 'vacancy',
  'egrul-fns': 'registry',
  'funding-business-signals': 'news',
  'company-newsrooms': 'news',
  'industry-media': 'news',
}

function sourceIdToEvidenceType(sourceId: string): EvidenceSource['evidenceType'] {
  return SOURCE_ID_TO_EVIDENCE_TYPE[sourceId] ?? 'vacancy'
}

/**
 * Multi-source lead generator that aggregates evidence from all available sources
 */
export class MultiSourceLeadGenerator {
  private crawler: CrawlerRouter
  private sources: DataSource[]
  private activeSources: string[]
  /** Per-source outcome of the most recent generateLeads() run. */
  private lastRunReport: SourceRunReport = {}

  /**
   * @param deps Optional dependency overrides. `crawler` lets tests inject a
   *   stub router instead of the real network-backed one. Production callers
   *   construct with no args and get the default router. This is the supported
   *   seam for testing career-page enrichment: the `@/lib/sources/crawlers`
   *   module cannot be reliably intercepted via `jest.mock` under next/jest's
   *   SWC transform (static `@/`-aliased imports resolve past the mock
   *   registry), so module-level mocking of `createDefaultRouter` is a no-op.
   */
  constructor(deps?: { crawler?: CrawlerRouter }) {
    this.crawler = deps?.crawler ?? createDefaultRouter()
    this.sources = this.initializeSources()
    this.activeSources = this.getActiveSources()
  }

  /**
   * Per-source status/leads_count/error for the most recent generateLeads()
   * run. Returns a fresh copy so callers cannot mutate internal state.
   */
  getLastRunSourceReport(): SourceRunReport {
    return { ...this.lastRunReport }
  }

  /** Record (or merge) the outcome of one source step into the run report. */
  private recordSource(name: string, status: SourceRunStatus): void {
    this.lastRunReport[name] = status
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
    // Reset the per-run source report for this invocation.
    this.lastRunReport = {}

    // Step 1: Generate leads from all job board sources via DB pipeline
    // (HH, Rabota Rossii, SuperJob, Habr Career, etc. — all in source-digest-evidence.sql).
    // A failure here must not abort the rest of the pipeline.
    let jobBoardLeads: MultiSourceLead[] = []
    try {
      jobBoardLeads = await this.generateJobBoardLeads(clientProfileId)
      allLeads.push(...jobBoardLeads)
      this.recordJobBoardSources(jobBoardLeads)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[generateLeads] source failed', { source: 'job-boards', error: message })
      this.recordSource('job-boards', { status: 'error', leads_count: 0, error: message })
    }

    // Step 2: Fetch career pages for enrichment
    if (sources.includes('career-pages')) {
      const before = this.countSourceEvidence(allLeads, 'career-pages')
      try {
        await this.enrichWithCareerPages(allLeads)
        const added = this.countSourceEvidence(allLeads, 'career-pages') - before
        this.recordSource('career-pages', { status: 'ok', leads_count: added })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[generateLeads] source failed', { source: 'career-pages', error: message })
        this.recordSource('career-pages', { status: 'error', leads_count: 0, error: message })
      }
    }

    // Step 3: Add business signals from secondary sources
    if (sources.includes('funding-business-signals')) {
      const before = this.countSourceEvidence(allLeads, 'funding-business-signals')
      try {
        await this.addBusinessSignals(allLeads)
        const added = this.countSourceEvidence(allLeads, 'funding-business-signals') - before
        this.recordSource('funding-business-signals', { status: 'ok', leads_count: added })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[generateLeads] source failed', { source: 'funding-business-signals', error: message })
        this.recordSource('funding-business-signals', { status: 'error', leads_count: 0, error: message })
      }
    }

    // Step 4: Enrich with company registry data
    if (sources.includes('egrul-fns')) {
      const before = this.countSourceEvidence(allLeads, 'egrul-fns')
      try {
        await this.enrichWithRegistryData(allLeads)
        const added = this.countSourceEvidence(allLeads, 'egrul-fns') - before
        this.recordSource('egrul-fns', { status: 'ok', leads_count: added })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[generateLeads] source failed', { source: 'egrul-fns', error: message })
        this.recordSource('egrul-fns', { status: 'error', leads_count: 0, error: message })
      }
    }

    // Step 5: Real-time crawling is handled by n8n scheduler via source scripts
    // (enableRealTime is kept as no-op for API backward compatibility)

    // Step 6: Aggregate leads — entity resolution and deduplication.
    // If dedup fails, fall back to the un-deduplicated leads rather than aborting.
    let aggregatedLeads: MultiSourceLead[]
    try {
      aggregatedLeads = await this.deduplicateLeads(allLeads)
    } catch (err) {
      console.error('[generateLeads] deduplication failed, using raw leads:', err)
      aggregatedLeads = allLeads
    }

    // Step 7: Filter and rank final leads
    return this.filterAndRankLeads(aggregatedLeads, {
      industries,
      regions,
      minScore
    })
  }

  /** Count evidence entries for a given sourceId across all leads. */
  private countSourceEvidence(leads: MultiSourceLead[], sourceId: string): number {
    let count = 0
    for (const lead of leads) {
      if (lead.sources.some(s => s.sourceId === sourceId)) count++
    }
    return count
  }

  /**
   * Break out job-board results by source family (hh, superjob, habr-career, …)
   * so the run report exposes per-board lead counts. A source family that
   * contributed no leads is still recorded as ok with leads_count: 0.
   */
  private recordJobBoardSources(leads: MultiSourceLead[]): void {
    const jobBoardIds = this.sources
      .filter(s => s.kind === 'job-board')
      .map(s => s.id)
    const counts = new Map<string, number>(jobBoardIds.map(id => [id, 0]))
    for (const lead of leads) {
      const seen = new Set<string>()
      for (const evidence of lead.sources) {
        if (counts.has(evidence.sourceId) && !seen.has(evidence.sourceId)) {
          counts.set(evidence.sourceId, counts.get(evidence.sourceId)! + 1)
          seen.add(evidence.sourceId)
        }
      }
    }
    for (const [id, leads_count] of counts) {
      this.recordSource(id, { status: 'ok', leads_count })
    }
  }

  /**
   * Generate leads from all job board sources via the real DB pipeline.
   * Reads from signals → source-digest-evidence.sql → digest items.
   * Now covers HH, Rabota Rossii, SuperJob, Habr Career, etc.
   */
  private async generateJobBoardLeads(clientProfileId?: string): Promise<MultiSourceLead[]> {
    try {
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
      'regional-job-boards': 'Regional Job Boards',
      'linkedin-company-pages': 'LinkedIn',
      'company-site': 'Company Website',
      'egrul-fns': 'EGRUL/FNS Registry',
      'funding-business-signals': 'Funding Signals',
      'company-newsrooms': 'Company Newsrooms',
      'industry-media': 'Industry Media',
    }

    // Convert to MultiSourceLead format — one evidence source per source family
    return candidates.map(candidate => {
      const matchingItem = digestItems.find(item => item.org_id === candidate.companyId)
      const sourceFamilies = matchingItem?.source_families || ['hh']

      // Build evidence sources from all contributing source families
      const evidenceSources: EvidenceSource[] = sourceFamilies.map(sourceId => ({
        sourceId,
        sourceName: sourceNameMap[sourceId] || sourceId,
        evidenceType: sourceIdToEvidenceType(sourceId),
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
    } catch (err) {
      console.error('[generateJobBoardLeads] failed:', err)
      return []
    }
  }

  /**
   * Enrich leads with career page evidence.
   * Resolves a corporate base URL from orgs.website_url, falling back to
   * orgs.domain; orgs with neither are skipped (no career-page crawl).
   */
  private async enrichWithCareerPages(leads: MultiSourceLead[]): Promise<void> {
    // Build org_id → corporate base URL map from DB (website_url, else domain)
    const pool = getPool()
    const websiteMap = new Map<string, string>()

    if (pool) {
      try {
        const orgIds = leads.map(l => l.companyId).filter(Boolean)
        if (orgIds.length > 0) {
          // Fall back to `domain` when `website_url` is null, and vice versa:
          // egrul/company-site/rf adapters populate domain (and not always
          // website_url), while HH ingest populates website_url (and, since the
          // 20260620 backfill + ingest fix, domain too — though older rows or
          // ones whose domain collided on the unique index may still have it
          // NULL). Selecting on website_url alone silently drops every org whose
          // corporate surface is known only via domain — killing career-page
          // enrichment and capping FIUR reachability to zero for those leads.
          const result = await withRetry(() => pool.query(
            `SELECT id, website_url, domain FROM orgs
             WHERE id = ANY($1) AND (website_url IS NOT NULL OR domain IS NOT NULL)`,
            [orgIds]
          ))
          for (const row of result.rows as Array<Record<string, unknown>>) {
            // Prefer the explicit website_url; otherwise derive an https base
            // from the bare domain. Normalize to a scheme-qualified origin so the
            // downstream `${base}/careers` concatenation and URL validation work.
            let base: string | null = null
            if (row.website_url != null && String(row.website_url).trim() !== '') {
              base = String(row.website_url).trim()
            } else if (row.domain != null && String(row.domain).trim() !== '') {
              const bareDomain = String(row.domain).trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
              if (bareDomain) base = `https://${bareDomain}`
            }
            if (base) websiteMap.set(String(row.id), base)
          }
        }
      } catch (error) {
        console.warn('Failed to fetch website URLs from orgs:', error)
      }
    }

    // Parallel crawl with concurrency limit (5 concurrent requests)
    const limit = pLimit(5)
    await Promise.all(leads.map(lead => limit(async () => {
      try {
        // Use real website URL from DB, or fall back to slug-based guess
        const websiteUrl = websiteMap.get(lead.companyId)
        let careerUrl: string
        if (websiteUrl) {
          careerUrl = `${websiteUrl.replace(/\/$/, '')}/careers`
          lead.enrichment.website = websiteUrl
        } else {
          // Slug fallback: strip non-ASCII, transliterate to ASCII-safe form.
          // Cyrillic characters in DNS hostnames require punycode which is fragile.
          // If no real website in DB, skip career page crawl rather than guess a
          // broken URL — crawling `https://яндекс.com/careers` is a DNS error.
          // Mark enrichment as missing website for the scoring pipeline.
          lead.enrichment.hasCareerPage = false
          return
        }

        const crawlInput: CrawlerFetchInput = {
          url: careerUrl,
          options: {
            timeoutMs: 10000
          }
        }

        // C5: Validate URL before crawl — reject private IPs / bad schemes early.
        // The crawler router also validates, but checking here avoids a network
        // round-trip and provides a clearer warning in the lead's reasons.
        const urlValidation = validateCrawlerUrl(careerUrl)
        if (!urlValidation.valid) {
          lead.enrichment.hasCareerPage = false
          lead.reasons.push(`career page URL rejected: ${urlValidation.reason}`)
          return
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
    })))
  }

  /**
   * Add business signals from real data in the signals table.
   * Context-only sources (funding, news, media) enrich but never originate leads.
   * If no data exists for an org, skip enrichment (no fake data).
   */
  private async addBusinessSignals(leads: MultiSourceLead[]): Promise<void> {
    const pool = getPool()
    if (!pool) return

    const contextSources = ['funding-business-signals', 'company-newsrooms', 'industry-media']

    // Batch query: fetch business signals for all leads in one round-trip
    const orgIds = leads.map(l => l.companyId).filter(Boolean)
    if (orgIds.length === 0) return

    try {
      const result = await withRetry(() => pool.query(
        `SELECT org_id, source, payload, headline, occurred_at FROM signals
         WHERE org_id = ANY($1) AND source = ANY($2)
         ORDER BY org_id, occurred_at DESC`,
        [orgIds, contextSources]
      ))

      // Index results by org_id
      const signalsByOrg = new Map<string, Array<Record<string, unknown>>>()
      for (const row of result.rows as Array<Record<string, unknown>>) {
        const orgId = String(row.org_id)
        if (!signalsByOrg.has(orgId)) signalsByOrg.set(orgId, [])
        signalsByOrg.get(orgId)!.push(row)
      }

      for (const lead of leads) {
        const rows = signalsByOrg.get(lead.companyId)
        if (!rows) continue

        // Take top 5 per org (already ordered by occurred_at DESC)
        for (const row of rows.slice(0, 5)) {
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
      }
    } catch (error) {
      console.warn('Failed to fetch business signals:', error)
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
    const pool = getPool()
    if (!pool) return

    // Batch query: fetch EGRUL data for all leads in one round-trip
    const orgIds = leads.map(l => l.companyId).filter(Boolean)
    if (orgIds.length === 0) return

    try {
      const result = await withRetry(() => pool.query(
        `SELECT DISTINCT ON (org_id) org_id, payload
         FROM signals
         WHERE org_id = ANY($1) AND source = 'egrul-fns'
         ORDER BY org_id, occurred_at DESC`,
        [orgIds]
      ))

      // Index results by org_id for O(1) lookup
      const registryByOrg = new Map<string, Record<string, unknown>>()
      for (const row of result.rows as Array<Record<string, unknown>>) {
        registryByOrg.set(String(row.org_id), row.payload as Record<string, unknown>)
      }

      for (const lead of leads) {
        const payload = registryByOrg.get(lead.companyId)
        if (!payload) continue

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
        if (payload.employee_count || payload.employeesCount) {
          const count = Number(payload.employee_count || payload.employeesCount) || 0
          lead.enrichment.companySize = this.categorizeCompanySize(count)
          lead.enrichment.employeeCount = count
        }
        if (payload.legal_form || payload.legalForm) {
          lead.enrichment.industry = lead.enrichment.industry || []
        }
      }
    } catch (error) {
      console.warn('Failed to fetch EGRUL registry data:', error)
    }

    // Recalculate confidence after adding evidence
    for (const lead of leads) {
      recalculateConfidence(lead)
    }
  }

  /**
   * Deduplicate leads using EntityResolver from LeadAggregator.
   * Two-level grouping: first by companyId (org_id from DB), then by
   * canonicalCompanyId (name hash) for leads without matching org_id.
   * Merges sources and keeps the highest-scored lead per group.
   */
  private async deduplicateLeads(leads: MultiSourceLead[]): Promise<MultiSourceLead[]> {
    if (leads.length === 0) return []

    const { EntityResolver } = await import('./lead-aggregator')
    const resolver = new EntityResolver()

    // Resolve entity IDs for all leads
    const resolved = await resolver.resolveAll(leads)

    // Level 1: Group by companyId (org_id) — definitive match from DB
    const orgGroups = new Map<string, (typeof resolved)[number][]>()
    const unresolved: (typeof resolved)[number][] = []

    for (const lead of resolved) {
      if (lead.companyId) {
        if (!orgGroups.has(lead.companyId)) {
          orgGroups.set(lead.companyId, [])
        }
        orgGroups.get(lead.companyId)!.push(lead)
      } else {
        unresolved.push(lead)
      }
    }

    // Level 2: For leads without companyId, group by canonicalCompanyId (name hash)
    const nameGroups = new Map<string, (typeof resolved)[number][]>()
    for (const lead of unresolved) {
      const key = lead.canonicalCompanyId
      if (!nameGroups.has(key)) {
        nameGroups.set(key, [])
      }
      nameGroups.get(key)!.push(lead)
    }

    // Merge helper — combine sources, signals, enrichment from group into best lead
    const mergeGroup = (group: (typeof resolved)[number][]): MultiSourceLead => {
      group.sort((a: typeof group[number], b: typeof group[number]) => b.score - a.score)
      const best = group[0]

      const seenSourceIds = new Set(best.sources.map((s: EvidenceSource) => s.sourceId))
      for (const other of group.slice(1)) {
        for (const source of other.sources) {
          if (!seenSourceIds.has(source.sourceId)) {
            best.sources.push(source)
            seenSourceIds.add(source.sourceId)
          }
        }
        for (const signal of other.signals) {
          if (!best.signals.some((s: HiringSignal) => s.signalType === signal.signalType && s.strength === signal.strength)) {
            best.signals.push(signal)
          }
        }
        if (other.enrichment) {
          for (const [key, value] of Object.entries(other.enrichment)) {
            if (value !== undefined && (best.enrichment as Record<string, unknown>)[key] === undefined) {
              (best.enrichment as Record<string, unknown>)[key] = value
            }
          }
        }
      }

      recalculateConfidence(best)
      return best
    }

    // Merge all groups
    const deduplicated: MultiSourceLead[] = []
    for (const [, group] of orgGroups) {
      deduplicated.push(mergeGroup(group))
    }
    for (const [, group] of nameGroups) {
      deduplicated.push(mergeGroup(group))
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