import { NextRequest, NextResponse } from 'next/server'
import { MultiSourceLeadGenerator } from '@/lib/lead-discovery/multi-source-lead-generator'
import { LeadScoringService } from '@/lib/lead-discovery/lead-scoring-service'
import type { MultiSourceLead } from '@/lib/lead-discovery/multi-source-lead-generator'
import type { ScoredLead } from '@/lib/lead-discovery/lead-scoring-service'
import { logEvent, logError } from '@/lib/runtime'

// Module-level singletons — one instance per process
let _generator: MultiSourceLeadGenerator | null = null
function getLeadGenerator(): MultiSourceLeadGenerator {
  if (!_generator) {
    _generator = new MultiSourceLeadGenerator()
  }
  return _generator
}

let _scoringService: LeadScoringService | null = null
function getLeadScoringService(): LeadScoringService {
  if (!_scoringService) {
    _scoringService = new LeadScoringService()
  }
  return _scoringService
}

export async function POST(request: NextRequest) {
  // Auth check — LEAD_API_KEY with fallback to DIGEST_API_KEY
  const apiKey = process.env.LEAD_API_KEY || process.env.DIGEST_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: 'LEAD_API_KEY is not configured.' },
      { status: 500 }
    )
  }
  const authHeader = request.headers.get('x-api-key')
  if (authHeader !== apiKey) {
    return NextResponse.json(
      { success: false, error: 'Invalid or missing x-api-key header.' },
      { status: 401 }
    )
  }

  try {
    const body = await request.json()
    const {
      companies = [],
      industries = [],
      regions = [],
      minScore = 1.0,
      sources,
      enableRealTime = false,
      maxResults = 100,
      clientProfileId,
      agencyProfile,
    } = body

    // Get singleton lead generator
    const generator = getLeadGenerator()

    // Generate leads from multiple sources
    logEvent('leads.generate.start', { companyCount: companies.length || 0 })
    const rawLeads = await generator.generateLeads({
      companies,
      industries,
      regions,
      minScore,
      ...(sources === undefined ? {} : { sources }),
      enableRealTime,
      clientProfileId
    })

    logEvent('leads.generate.completed', { rawCount: rawLeads.length })

    // Per-source outcome of this run — surfaced for observability without
    // altering the existing success/failure response shape.
    const rawSourceReport = generator.getLastRunSourceReport()
    for (const [sourceId, outcome] of Object.entries(rawSourceReport)) {
      const effectiveStatus =
        outcome.status === 'ok' && outcome.leads_count === 0 ? 'empty' : outcome.status
      logEvent('leads.generate.source', {
        sourceId,
        status: effectiveStatus,
        leadsCount: outcome.leads_count,
        ...(outcome.error ? { error: outcome.error } : {}),
      })
    }
    // Flatten the keyed report into a stable array for the response body.
    const sourceReport = Object.entries(rawSourceReport).map(([sourceId, outcome]) => ({
      sourceId,
      status: outcome.status,
      leadsFound: outcome.leads_count,
      ...(outcome.error ? { error: outcome.error } : {}),
    }))

    // Apply FIUR scoring if agencyProfile is provided
    // Uses scoreExistingLeads to avoid regenerating leads (which would
    // create a second MultiSourceLeadGenerator and hit the DB again)
    let scoredLeads: ScoredLead[] | MultiSourceLead[] = rawLeads
    if (agencyProfile && rawLeads.length > 0) {
      const scoringService = getLeadScoringService()
      scoredLeads = await scoringService.scoreExistingLeads(rawLeads, {
        agencyProfile,
        ...(sources === undefined ? {} : { sources }),
        minScore,
        enableRealTime,
        clientProfileId,
      })
    }

    // Apply result limit
    const limitedLeads = scoredLeads.slice(0, maxResults)

    // Get analytics
    const analytics = generator.getSourceAnalytics(rawLeads.slice(0, maxResults))

    return NextResponse.json({
      success: true,
      data: {
        leads: limitedLeads,
        analytics,
        summary: {
          totalLeads: limitedLeads.length,
          avgScore: limitedLeads.length === 0
            ? 0
            : limitedLeads.reduce((sum: number, lead) => sum + ('finalScore' in lead ? lead.finalScore : lead.score), 0) / limitedLeads.length,
          confidenceBreakdown: {
            A: limitedLeads.filter(lead => lead.confidence === 'A').length,
            B: limitedLeads.filter(lead => lead.confidence === 'B').length,
            C: limitedLeads.filter(lead => lead.confidence === 'C').length,
            D: limitedLeads.filter(lead => lead.confidence === 'D').length
          },
          sourceCoverage: Object.fromEntries(
            analytics.sources.map(source => [source.id, source.count])
          )
        },
        // Per-source run outcome (status/leads_count/error) for this request.
        // Additive: does not affect existing fields or success/failure status.
        sourceReport
      }
    })
  } catch (error) {
    logError('leads.generate.failed', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to generate leads'
      },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    message: 'POST to generate leads',
    endpoints: {
      '/api/leads/generate': {
        method: 'POST',
        description: 'Generate leads from multiple sources with optional FIUR scoring',
        parameters: {
          companies: 'Array of company IDs (optional)',
          industries: 'Array of industry filters (optional)',
          regions: 'Array of region filters (optional)',
          minScore: 'Minimum score threshold (default: 1.0)',
          sources: 'Array of source IDs to include (optional)',
          enableRealTime: 'Enable real-time crawling (default: false)',
          clientProfileId: 'Client profile ID for scoped digest (optional)',
          agencyProfile: 'Agency ICP for FIUR scoring — when provided, leads are scored via FIUR pipeline (optional)',
          maxResults: 'Maximum number of results (default: 100)'
        },
        response: {
          leads: 'Array of scored leads (FIUR-scored if agencyProfile provided)',
          analytics: 'Source analytics and metrics',
          summary: 'Summary statistics'
        }
      }
    }
  })
}
