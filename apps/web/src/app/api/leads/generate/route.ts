import { NextRequest, NextResponse } from 'next/server'
import { MultiSourceLeadGenerator } from '@/lib/lead-discovery/multi-source-lead-generator'
import { LeadAggregator } from '@/lib/lead-discovery/lead-aggregator'
import type { MultiSourceLead } from '@/lib/lead-discovery/multi-source-lead-generator'
import type { AggregatedLead } from '@/lib/lead-discovery/lead-aggregator'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      companies = [],
      industries = [],
      regions = [],
      minScore = 1.0,
      sources = [],
      enableRealTime = false,
      maxResults = 100
    } = body

    // Initialize lead generator
    const generator = new MultiSourceLeadGenerator()

    // Generate leads from multiple sources
    console.log(`Generating leads for ${companies.length || 'all'} companies...`)
    const rawLeads = await generator.generateLeads({
      companies,
      industries,
      regions,
      minScore,
      sources,
      enableRealTime
    })

    console.log(`Generated ${rawLeads.length} raw leads`)

    // Apply result limit
    const limitedLeads = rawLeads.slice(0, maxResults)

    // Get analytics
    const analytics = generator.getSourceAnalytics(limitedLeads)

    return NextResponse.json({
      success: true,
      data: {
        leads: limitedLeads,
        analytics,
        summary: {
          totalLeads: limitedLeads.length,
          avgScore: limitedLeads.reduce((sum, lead) => sum + lead.score, 0) / limitedLeads.length,
          confidenceBreakdown: {
            A: limitedLeads.filter(lead => lead.confidence === 'A').length,
            B: limitedLeads.filter(lead => lead.confidence === 'B').length,
            C: limitedLeads.filter(lead => lead.confidence === 'C').length,
            D: limitedLeads.filter(lead => lead.confidence === 'D').length
          },
          sourceCoverage: Object.fromEntries(
            analytics.sources.map(source => [source.id, source.count])
          )
        }
      }
    })
  } catch (error) {
    console.error('Lead generation error:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to generate leads',
        details: error instanceof Error ? error.message : 'Unknown error'
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
        description: 'Generate leads from multiple sources',
        parameters: {
          companies: 'Array of company IDs (optional)',
          industries: 'Array of industry filters (optional)',
          regions: 'Array of region filters (optional)',
          minScore: 'Minimum score threshold (default: 1.0)',
          sources: 'Array of source IDs to include (optional)',
          enableRealTime: 'Enable real-time crawling (default: false)',
          maxResults: 'Maximum number of results (default: 100)'
        },
        response: {
          leads: 'Array of aggregated leads',
          analytics: 'Source analytics and metrics',
          summary: 'Summary statistics'
        }
      }
    }
  })
}