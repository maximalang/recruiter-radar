import { NextRequest, NextResponse } from 'next/server'
import { LeadScoringService } from '@/lib/lead-discovery/lead-scoring-service'
import type { LeadScoringOptions, ScoredLead } from '@/lib/lead-discovery/lead-scoring-service'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      agencyProfile,
      sources = [],
      minScore = 1.0,
      enableRealTime = false,
      marketContext,
      maxResults = 100
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

    // Initialize scoring service
    const scoringService = new LeadScoringService()

    // Generate and score leads
    console.log(`Generating and scoring leads for agency...`)
    const scoredLeads = await scoringService.generateAndScoreLeads({
      agencyProfile,
      sources,
      minScore,
      enableRealTime,
      marketContext,
    })

    console.log(`Generated ${scoredLeads.length} scored leads`)

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
          avgScore: limitedLeads.reduce((sum, lead) => sum + lead.finalScore, 0) / limitedLeads.length,
          confidenceBreakdown: {
            high: limitedLeads.filter(lead => lead.confidence === 'A').length,
            medium: limitedLeads.filter(lead => lead.confidence === 'B').length,
            low: limitedLeads.filter(lead => lead.confidence === 'C').length,
          },
          sourceCoverage: insights?.averageBySource || {},
          improvementSuggestions: limitedLeads.flatMap(lead => lead.improvementSuggestions)
        }
      }
    })
  } catch (error) {
    console.error('Lead scoring error:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to score leads',
        details: error instanceof Error ? error.message : 'Unknown error'
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