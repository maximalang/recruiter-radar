import { NextResponse } from 'next/server';
import {
  getLeadsForAllProfiles,
  type LeadItem,
  VALID_FEEDBACK_STATUSES,
} from '@/lib/leads-data';
import { listClientProfiles } from '@/lib/clientProfiles';
import { getAuthorizedOwnerId } from '@/lib/auth-v2/authorization';
import { buildWhyMatch, type WhyMatchProfile } from '@/lib/leads/why-match';
import { scoreBand, formatSignalStrength } from '@/lib/scoring/score-display';

/**
 * GET /api/leads — owner-scoped, paginated lead list for the current session.
 *
 * Auth: the signed session cookie (same boundary as /leads). No session → 200
 * with an empty list (never another tenant's leads, never a leaky 401 that would
 * confirm/deny existence).
 *
 * Response is a CLEAN public projection of LeadItem — it deliberately omits raw
 * internal fields (structuredReasons, opener, suppressedUntil, sourceExternalId,
 * raw payload). Each item carries the score band, why-match rationale, top
 * evidence, and an aiHint presence flag.
 */

export const dynamic = 'force-dynamic';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

type ApiLead = {
  id: string;
  orgName: string;
  score: number;
  /** Signal strength on the [0,4] scale, one decimal (e.g. "3.2"). */
  signalStrength: string;
  scoreBand: { label: string; tone: string };
  confidenceGate: string;
  whyNow: string | null;
  whyMatch: string[];
  topEvidence: string[];
  vacanciesCount: number;
  locationNames: string[];
  lawfulContactPath: string | null;
  sourceFamilies: string[];
  latestPublishedAt: string | null;
  feedbackStatus: string | null;
  hasAiHint: boolean;
  createdAt: string;
};

export async function GET(request: Request) {
  const ownerId = await getAuthorizedOwnerId('leads:read');
  if (!ownerId) {
    return NextResponse.json({ leads: [], total: 0, page: 1, pageSize: DEFAULT_PAGE_SIZE });
  }

  const { searchParams } = new URL(request.url);

  const gateParam = searchParams.get('gate');
  const confidenceGate =
    gateParam && ['A', 'B', 'C', 'D'].includes(gateParam) ? gateParam : null;

  const feedbackParam = searchParams.get('feedback');
  const feedbackStatus =
    feedbackParam && VALID_FEEDBACK_STATUSES.has(feedbackParam as never)
      ? feedbackParam
      : null;

  const page = Math.max(parseIntOr(searchParams.get('page'), 1), 1);
  const pageSize = Math.min(
    Math.max(parseIntOr(searchParams.get('pageSize'), DEFAULT_PAGE_SIZE), 1),
    MAX_PAGE_SIZE,
  );

  let profiles;
  try {
    profiles = await listClientProfiles(ownerId);
  } catch {
    return NextResponse.json({ leads: [], total: 0, page, pageSize });
  }

  const activeProfiles = profiles.filter((p) => p.isActive);

  // Optional ?profile= narrows to one active practice; ignored when not owned.
  const profileParam = searchParams.get('profile');
  const selectedProfileId =
    profileParam && activeProfiles.some((p) => p.id === profileParam) ? profileParam : null;

  const profileIds = selectedProfileId
    ? [selectedProfileId]
    : activeProfiles.map((p) => p.id);

  if (profileIds.length === 0) {
    return NextResponse.json({ leads: [], total: 0, page, pageSize });
  }

  let result;
  try {
    result = await getLeadsForAllProfiles({
      profileIds,
      ownerId,
      confidenceGate,
      feedbackStatus,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
  } catch {
    return NextResponse.json({ leads: [], total: 0, page, pageSize });
  }

  // Per-profile filter fields for the why-match rationale, keyed by profile id.
  const filtersById = new Map<string, WhyMatchProfile>(
    activeProfiles.map((p) => [
      p.id,
      {
        roles: p.roles,
        industries: p.industries,
        targetCity: p.targetCity,
        minOpenRoles: p.minOpenRoles,
        hiringIntentMin: p.hiringIntentMin,
        remoteFriendly: p.remoteFriendly,
      },
    ]),
  );

  const leads: ApiLead[] = result.leads.map((lead) => toApiLead(lead, filtersById));

  return NextResponse.json({
    leads,
    total: result.total,
    page,
    pageSize,
  });
}

function toApiLead(
  lead: LeadItem,
  filtersById: Map<string, WhyMatchProfile>,
): ApiLead {
  const filters = filtersById.get(lead.clientProfileId);
  const whyMatch = filters
    ? buildWhyMatch(
        {
          orgName: lead.orgName,
          evidenceTitles: lead.evidenceTitles,
          locationNames: lead.locationNames,
          vacanciesCount: lead.vacanciesCount,
          score: lead.score,
          latestSignalAt: lead.latestPublishedAt,
        },
        filters,
      )
    : [];
  const band = scoreBand(lead.score);

  return {
    id: lead.id,
    orgName: lead.orgName,
    score: lead.score,
    signalStrength: formatSignalStrength(lead.score),
    scoreBand: { label: band.label, tone: band.tone },
    confidenceGate: lead.confidenceGate,
    whyNow: lead.whyNow && lead.whyNow.trim() ? lead.whyNow.trim() : null,
    whyMatch,
    topEvidence: lead.evidenceTitles.slice(0, 5),
    vacanciesCount: lead.vacanciesCount,
    locationNames: lead.locationNames,
    lawfulContactPath: lead.lawfulContactPath,
    sourceFamilies: lead.sourceFamilies,
    latestPublishedAt: lead.latestPublishedAt,
    feedbackStatus:
      lead.feedbackStatus && lead.feedbackStatus !== 'none' ? lead.feedbackStatus : null,
    hasAiHint: lead.hasAiHint,
    createdAt: lead.createdAt,
  };
}

function parseIntOr(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}
