import { NextResponse, type NextRequest } from 'next/server'
import { LeadScoringService } from '@/lib/lead-discovery/lead-scoring-service'
import { readOwnerSession } from '@/lib/session'
import { getHhDigestItems, type HhDigestItem } from '@/lib/hhDigest'
import type { AgencyProfile } from '@/lib/scoring/scoring-pipeline'
import type { MarketFitInput } from '@/lib/scoring/market-fit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ScoreLeadsBody {
  agencyProfile?: unknown
  sources?: unknown
  minScore?: unknown
  marketContext?: unknown
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

type ValidatedAgencyProfile = { ok: true; value: AgencyProfile } | { ok: false; error: string }

function validateAgencyProfile(input: unknown): ValidatedAgencyProfile {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'agencyProfile must be an object' }
  }
  const raw = input as Record<string, unknown>

  if (!isStringArray(raw.industries) || raw.industries.length === 0) {
    return { ok: false, error: 'agencyProfile.industries must be a non-empty string array' }
  }
  if (!isStringArray(raw.locations)) {
    return { ok: false, error: 'agencyProfile.locations must be a string array' }
  }
  if (raw.roles !== undefined && !isStringArray(raw.roles)) {
    return { ok: false, error: 'agencyProfile.roles must be a string array' }
  }
  if (raw.companySizes !== undefined && !isStringArray(raw.companySizes)) {
    return { ok: false, error: 'agencyProfile.companySizes must be a string array' }
  }
  if (raw.exclusions !== undefined && !isStringArray(raw.exclusions)) {
    return { ok: false, error: 'agencyProfile.exclusions must be a string array' }
  }
  if (raw.excludedIndustries !== undefined && !isStringArray(raw.excludedIndustries)) {
    return { ok: false, error: 'agencyProfile.excludedIndustries must be a string array' }
  }
  if (raw.excludedLocations !== undefined && !isStringArray(raw.excludedLocations)) {
    return { ok: false, error: 'agencyProfile.excludedLocations must be a string array' }
  }
  if (raw.remoteFriendly !== undefined && typeof raw.remoteFriendly !== 'boolean') {
    return { ok: false, error: 'agencyProfile.remoteFriendly must be a boolean' }
  }

  return {
    ok: true,
    value: {
      industries: raw.industries,
      locations: raw.locations,
      roles: raw.roles as string[] | undefined,
      companySizes: raw.companySizes as AgencyProfile['companySizes'],
      exclusions: raw.exclusions as string[] | undefined,
      excludedIndustries: raw.excludedIndustries as string[] | undefined,
      excludedLocations: raw.excludedLocations as string[] | undefined,
      remoteFriendly: raw.remoteFriendly as boolean | undefined,
    },
  }
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID()

  const ownerId = await readOwnerSession()
  if (!ownerId) {
    return jsonError('Authentication required', 401, requestId)
  }

  let body: ScoreLeadsBody
  try {
    body = (await request.json()) as ScoreLeadsBody
  } catch {
    return jsonError('Invalid JSON body', 400, requestId)
  }

  const profileResult = validateAgencyProfile(body.agencyProfile)
  if (!profileResult.ok) {
    return jsonError(profileResult.error, 400, requestId)
  }
  const agencyProfile = profileResult.value

  const sources = isStringArray(body.sources) ? body.sources : []

  const minScore = typeof body.minScore === 'number' && Number.isFinite(body.minScore) ? body.minScore : 1.0
  const maxResultsRaw =
    typeof body.maxResults === 'number' && Number.isFinite(body.maxResults) ? body.maxResults : 100
  const maxResults = Math.max(1, Math.min(500, Math.floor(maxResultsRaw)))

  const marketContext: MarketFitInput | undefined =
    body.marketContext && typeof body.marketContext === 'object'
      ? (body.marketContext as MarketFitInput)
      : undefined

  const clientProfileId = typeof body.clientProfileId === 'string' ? body.clientProfileId.trim() : null

  let digestItems: HhDigestItem[]
  try {
    digestItems = await getHhDigestItems({ clientProfileId })
  } catch (error) {
    console.error(JSON.stringify({ requestId, route: 'leads/score', stage: 'digest-load', error: String(error) }))
    return jsonError('Failed to load digest items', 502, requestId)
  }

  try {
    const scoringService = new LeadScoringService()
    const scoredLeads = await scoringService.generateAndScoreLeads({
      digestItems,
      agencyProfile,
      sources,
      minScore,
      marketContext,
    })

    const limitedLeads = scoredLeads.slice(0, maxResults)
    const insights = scoringService.getScoringInsights(limitedLeads)
    const avgScore =
      limitedLeads.length > 0
        ? limitedLeads.reduce((sum, lead) => sum + lead.finalScore, 0) / limitedLeads.length
        : 0

    return NextResponse.json({
      success: true,
      data: {
        leads: limitedLeads,
        insights,
        summary: {
          totalLeads: limitedLeads.length,
          avgScore,
          confidenceBreakdown: {
            high: limitedLeads.filter(lead => lead.confidence === 'A').length,
            medium: limitedLeads.filter(lead => lead.confidence === 'B').length,
            low: limitedLeads.filter(lead => lead.confidence === 'C').length,
          },
          sourceCoverage: insights?.averageBySource ?? {},
          improvementSuggestions: limitedLeads.flatMap(lead => lead.improvementSuggestions),
        },
      },
      metadata: { timestamp: new Date().toISOString(), requestId },
    })
  } catch (error) {
    console.error(JSON.stringify({ requestId, route: 'leads/score', stage: 'score', error: String(error) }))
    return jsonError('Failed to score leads', 500, requestId)
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    message: 'POST to score leads',
    endpoints: {
      '/api/leads/score': {
        method: 'POST',
        description: 'Generate and score leads for the authenticated owner',
        parameters: {
          agencyProfile: 'Agency ICP configuration with non-empty industries (required)',
          sources: 'Array of source IDs to include (optional)',
          minScore: 'Minimum score threshold (default: 1.0)',
          marketContext: 'Market conditions and competitive landscape (optional)',
          maxResults: 'Maximum number of results (default: 100, max: 500)',
          clientProfileId: 'Client profile ID to scope digest items (optional)',
        },
      },
    },
  })
}
