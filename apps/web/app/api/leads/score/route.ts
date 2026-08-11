import { NextRequest, NextResponse } from 'next/server'
import { LeadScoringService } from '@/lib/lead-discovery/lead-scoring-service'
import type { LeadScoringOptions, ScoredLead } from '@/lib/lead-discovery/lead-scoring-service'
import { logEvent, logError } from '@/lib/runtime'

// Module-level singleton — one instance per process
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
      agencyProfile,
      sources,
      minScore = 1.0,
      enableRealTime = false,
      marketContext,
      maxResults = 100,
      clientProfileId
    } = body

    // Validate required fields
    if (!agencyProfile?.industries || agencyProfile.industries.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Agency profile with industries is required'
        },
        { status: 400 }
      )
    }

    // Get singleton scoring service
    const scoringService = getLeadScoringService()

    // Generate and score leads
    const scoredLeads = await scoringService.generateAndScoreLeads({
      agencyProfile,
      ...(sources === undefined ? {} : { sources }),
      minScore,
      enableRealTime,
      marketContext,
      clientProfileId,
    })

    logEvent('leads.score.completed', { count: scoredLeads.length })

    // Apply result limit
    const limitedLeads = scoredLeads.slice(0, maxResults)

    // Get insights
    const insights = scoringService.getScoringInsights(limitedLeads)

    return NextResponse.json({
      success: true,
      data: {
        leads: limitedLeads,
        insights,
        summary: {
          totalLeads: limitedLeads.length,
          avgScore: limitedLeads.length === 0
            ? 0
            : limitedLeads.reduce((sum, lead) => sum + lead.finalScore, 0) / limitedLeads.length,
          confidenceBreakdown: {
            A: limitedLeads.filter(lead => lead.confidence === 'A').length,
            B: limitedLeads.filter(lead => lead.confidence === 'B').length,
            C: limitedLeads.filter(lead => lead.confidence === 'C').length,
            D: limitedLeads.filter(lead => lead.confidence === 'D').length,
          },
          sourceCoverage: insights?.averageBySource || {},
        }
      }
    })
  } catch (error) {
    logError('leads.score.failed', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to score leads'
      },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    message: 'POST to score leads',
    endpoints: {
      '/api/leads/score': {
        method: 'POST',
        description: 'Generate and score leads for agency profiles',
        parameters: {
          agencyProfile: 'Agency ICP configuration (required)',
          sources: 'Array of source IDs to include (optional)',
          minScore: 'Minimum score threshold (default: 1.0)',
          enableRealTime: 'Enable real-time crawling (default: false)',
          marketContext: 'Market conditions and competitive landscape (optional)',
          maxResults: 'Maximum number of results (default: 100)'
        },
        requestExample: {
          agencyProfile: {
            industries: ['IT', 'Technology'],
            locations: ['Moscow', 'Saint Petersburg'],
            roles: ['engineering', 'product'],
            companySizes: ['small', 'medium'],
            remoteFriendly: true,
            exclusions: ['Blockchain']
          },
          sources: ['hh', 'career-pages', 'rabota-rossii'],
          minScore: 2.0,
          marketContext: {
            marketConditions: 'boom',
            industryGrowth: {
              'fintech': 0.15,
              'healthtech': 0.20
            }
          }
        },
        response: {
          leads: 'Array of scored leads with detailed breakdown',
          insights: 'Scoring analytics and trends',
          summary: 'Summary statistics and metrics'
        }
      }
    }
  })
}
