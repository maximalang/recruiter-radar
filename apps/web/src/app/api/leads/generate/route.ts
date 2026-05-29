import { NextResponse, type NextRequest } from 'next/server'
import { MultiSourceLeadGenerator } from '@/lib/lead-discovery/multi-source-lead-generator'
import { readOwnerSession } from '@/lib/session'
import { getHhDigestItems, type HhDigestItem } from '@/lib/hhDigest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface GenerateLeadsBody {
  industries?: unknown
  regions?: unknown
  minScore?: unknown
  sources?: unknown
  maxResults?: unknown
  clientProfileId?: unknown
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(v => typeof v === 'string')
}

function jsonError(error: string, status: number, requestId: string) {
  return NextResponse.json(
    {
      success: false,
      error,
      metadata: { timestamp: new Date().toISOString(), requestId },
    },
    { status },
  )
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID()

  const ownerId = await readOwnerSession()
  if (!ownerId) {
    return jsonError('Authentication required', 401, requestId)
  }

  let body: GenerateLeadsBody
  try {
    body = (await request.json()) as GenerateLeadsBody
  } catch {
    return jsonError('Invalid JSON body', 400, requestId)
  }

  const industries = isStringArray(body.industries) ? body.industries : []
  const regions = isStringArray(body.regions) ? body.regions : []
  const sources = isStringArray(body.sources) ? body.sources : []

  if (industries.length === 0) {
    return jsonError('industries must be a non-empty string array', 400, requestId)
  }

  const minScore = typeof body.minScore === 'number' && Number.isFinite(body.minScore) ? body.minScore : 1.0
  const maxResultsRaw =
    typeof body.maxResults === 'number' && Number.isFinite(body.maxResults) ? body.maxResults : 100
  const maxResults = Math.max(1, Math.min(500, Math.floor(maxResultsRaw)))

  const clientProfileId = typeof body.clientProfileId === 'string' ? body.clientProfileId.trim() : null

  let digestItems: HhDigestItem[]
  try {
    digestItems = await getHhDigestItems({ clientProfileId })
  } catch (error) {
    console.error(JSON.stringify({ requestId, route: 'leads/generate', stage: 'digest-load', error: String(error) }))
    return jsonError('Failed to load digest items', 502, requestId)
  }

  try {
    const generator = new MultiSourceLeadGenerator()
    const rawLeads = await generator.generateLeads({
      digestItems,
      industries,
      regions,
      minScore,
      sources,
    })

    const limitedLeads = rawLeads.slice(0, maxResults)
    const analytics = generator.getSourceAnalytics(limitedLeads)
    const avgScore =
      limitedLeads.length > 0
        ? limitedLeads.reduce((sum, lead) => sum + lead.score, 0) / limitedLeads.length
        : 0

    return NextResponse.json({
      success: true,
      data: {
        leads: limitedLeads,
        analytics,
        summary: {
          totalLeads: limitedLeads.length,
          avgScore,
          confidenceBreakdown: {
            A: limitedLeads.filter(lead => lead.confidence === 'A').length,
            B: limitedLeads.filter(lead => lead.confidence === 'B').length,
            C: limitedLeads.filter(lead => lead.confidence === 'C').length,
            D: limitedLeads.filter(lead => lead.confidence === 'D').length,
          },
          sourceCoverage: Object.fromEntries(analytics.sources.map(source => [source.id, source.count])),
        },
      },
      metadata: { timestamp: new Date().toISOString(), requestId },
    })
  } catch (error) {
    console.error(JSON.stringify({ requestId, route: 'leads/generate', stage: 'generate', error: String(error) }))
    return jsonError('Failed to generate leads', 500, requestId)
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    message: 'POST to generate leads',
    endpoints: {
      '/api/leads/generate': {
        method: 'POST',
        description: 'Generate leads from multiple sources for the authenticated owner',
        parameters: {
          industries: 'Array of industry filters (required, non-empty)',
          regions: 'Array of region filters (optional)',
          minScore: 'Minimum score threshold (default: 1.0)',
          sources: 'Array of source IDs to include (optional)',
          maxResults: 'Maximum number of results (default: 100, max: 500)',
          clientProfileId: 'Client profile ID to scope digest items (optional)',
        },
      },
    },
  })
}
