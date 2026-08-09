import { NextResponse } from 'next/server';
import { getLeadsForAllProfiles, VALID_FEEDBACK_STATUSES, type LeadItem } from '@/lib/leads-data';
import { listClientProfiles, type ClientProfile } from '@/lib/clientProfiles';
import { leadsToCsv } from '@/lib/leads-csv';
import { getSession } from '@/lib/auth-v2/authorization';
import { hasFeatureAccess } from '@/lib/entitlements';

export const dynamic = 'force-dynamic';

/**
 * GET /api/leads/export — CSV export of the current /leads view.
 *
 * Mirrors the /leads page exactly: same internal admin-view scope
 * (all active client profiles via listClientProfiles), same gate/feedback/
 * profile filters validated the same way. The CSV is the lightweight
 * delivery path for handing leads into a CRM — every row carries the
 * evidence-first story (why now, best angle, safe contact, sources).
 *
 * Export takes the full filtered set (capped at the loader's 500-row ceiling),
 * not a single page.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);

  const gateParam = url.searchParams.get('gate');
  const confidenceGate =
    gateParam && ['A', 'B', 'C', 'D'].includes(gateParam) ? gateParam : null;

  const feedbackParam = url.searchParams.get('feedback');
  const feedbackStatus =
    feedbackParam && VALID_FEEDBACK_STATUSES.has(feedbackParam as never)
      ? feedbackParam
      : null;
  // Mirror the /leads "Сегодня в работе" working-set filter so an export from
  // that view matches what the recruiter sees on screen.
  const workingSet = url.searchParams.get('today') === '1';
  const effectiveFeedbackStatus = workingSet ? null : feedbackStatus;

  // Owner-scope: without a session, return empty CSV rather than exposing
  // another tenant's leads. Mirrors /leads page scoping.
  const authorization = await getSession({ permission: 'exports:create' });
  if (!authorization?.workspaceId) {
    const csv = leadsToCsv([]);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="leads-empty.csv"',
        'Cache-Control': 'no-store',
      },
    });
  }
  const ownerId = authorization.dataOwnerId;
  try {
    if (!(await hasFeatureAccess(ownerId, 'api', { workspaceId: authorization.workspaceId }))) {
      return new NextResponse('entitlement_required', { status: 403 });
    }
  } catch {
    return new NextResponse('entitlement_check_unavailable', { status: 503 });
  }

  let profiles: ClientProfile[];
  try {
    profiles = await listClientProfiles(ownerId);
  } catch {
    return new NextResponse('profile_data_unavailable', { status: 503 });
  }
  const activeProfiles = profiles.filter((p) => p.isActive);

  const profileParam = url.searchParams.get('profile');
  const selectedProfileId =
    profileParam && activeProfiles.some((p) => p.id === profileParam)
      ? profileParam
      : null;

  const profileIds = selectedProfileId
    ? [selectedProfileId]
    : activeProfiles.map((p) => p.id);

  let leads: LeadItem[];
  try {
    const result = await getLeadsForAllProfiles({
      profileIds,
      ownerId,
      confidenceGate,
      feedbackStatus: effectiveFeedbackStatus,
      workingSet,
      limit: 500,
      // CRM-identifier columns (INN/ОГРН/domain/career-page/profile name) are
      // only useful in the export, not the UI — opt in here so the join cost is
      // paid only by this path.
      includeOrgDetails: true,
    });
    leads = result.leads;
  } catch {
    return new NextResponse('lead_data_unavailable', { status: 503 });
  }

  const csv = leadsToCsv(leads);
  const filename = `leads-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
