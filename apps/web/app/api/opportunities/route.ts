import { NextRequest, NextResponse } from 'next/server'

import {
  isOpportunityEngineV1EnabledForOwner,
} from '@/lib/opportunities/config'
import { toPublicOpportunity } from '@/lib/opportunities/api-projection'
import {
  listOpportunities,
  type OpportunityView,
} from '@/lib/opportunities/repository'
import type { HiringEpisodeType } from '@/lib/opportunities/hiring-episode-detection'
import type {
  ConfidenceGate,
  OpportunityStatus,
} from '@/lib/opportunities/opportunity-scoring'
import { logError } from '@/lib/runtime'
import { getAuthorizedOwnerId } from '@/lib/auth-v2/authorization'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUSES = new Set<OpportunityStatus>([
  'new',
  'review',
  'accepted',
  'dismissed',
  'snoozed',
  'contacted',
  'expired',
])
const EPISODE_TYPES = new Set<HiringEpisodeType>([
  'vacancy_spike',
  'repeated_vacancies',
  'role_cluster',
  'new_region',
  'hiring_restart',
  'sustained_hiring',
])

export async function GET(request: NextRequest) {
  const ownerId = await getAuthorizedOwnerId('opportunities:read')
  if (!isOpportunityEngineV1EnabledForOwner(ownerId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  if (!ownerId) {
    return NextResponse.json({ error: 'authentication_required' }, { status: 401 })
  }

  const params = request.nextUrl.searchParams
  const view = parseView(params.get('view'))
  if (params.has('view') && view === null) {
    return NextResponse.json({ error: 'invalid_view' }, { status: 400 })
  }
  const cursorValue = params.get('cursor')
  const cursorOffset = decodeCursor(cursorValue)
  if (cursorValue && cursorOffset === null) {
    return NextResponse.json({ error: 'invalid_cursor' }, { status: 400 })
  }
  try {
    const pageSize = positiveInteger(params.get('limit')) ??
      positiveInteger(params.get('pageSize')) ??
      undefined
    const result = await listOpportunities({
      ownerId,
      morningBriefOnly: (view ?? 'morning') === 'morning',
      view: view ?? 'morning',
      clientProfileId: positiveId(params.get('profile')),
      organizationId: positiveId(
        params.get('organizationId') ?? params.get('organization'),
      ),
      statuses: parseStatuses(params.get('status')),
      confidenceGate: parseConfidenceGate(
        params.get('confidenceGate') ?? params.get('gate'),
      ),
      episodeType: parseEpisodeType(params.get('episodeType')),
      minimumScore: boundedNumber(params.get('minimumScore'), 0, 1),
      page: positiveInteger(params.get('page')) ?? 1,
      pageSize,
      offset: cursorOffset ?? undefined,
    })

    return NextResponse.json({
      opportunities: result.opportunities.map(toPublicOpportunity),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      nextCursor: result.nextOffset === null
        ? null
        : encodeCursor(result.nextOffset),
    })
  } catch (error) {
    logError('opportunity.api.list_failed', error, { ownerId })
    return NextResponse.json(
      { error: 'opportunities_unavailable' },
      { status: 500 },
    )
  }
}

function encodeCursor(offset: number): string {
  return Buffer.from(
    JSON.stringify({ version: 1, offset }),
    'utf8',
  ).toString('base64url')
}

function decodeCursor(value: string | null): number | null {
  if (!value) return null
  if (value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as { version?: unknown; offset?: unknown }
    return parsed.version === 1 &&
      typeof parsed.offset === 'number' &&
      Number.isSafeInteger(parsed.offset) &&
      parsed.offset >= 0
      ? parsed.offset
      : null
  } catch {
    return null
  }
}

function parseStatuses(value: string | null): OpportunityStatus[] | undefined {
  if (!value) return undefined
  const statuses = value.split(',').filter(
    (item): item is OpportunityStatus => STATUSES.has(item as OpportunityStatus),
  )
  return statuses.length > 0 ? statuses : undefined
}

function parseView(value: string | null): OpportunityView | null {
  return value === 'morning' || value === 'accepted' || value === 'pipeline' ||
    value === 'snoozed' || value === 'completed' || value === 'all'
    ? value
    : null
}

function parseConfidenceGate(value: string | null): ConfidenceGate | null {
  return value === 'A' || value === 'B' || value === 'C' || value === 'D'
    ? value
    : null
}

function parseEpisodeType(value: string | null): HiringEpisodeType | null {
  return value && EPISODE_TYPES.has(value as HiringEpisodeType)
    ? value as HiringEpisodeType
    : null
}

function positiveId(value: string | null): string | null {
  return value && /^[1-9]\d*$/.test(value) ? value : null
}

function positiveInteger(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function boundedNumber(
  value: string | null,
  minimum: number,
  maximum: number,
): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null
}
