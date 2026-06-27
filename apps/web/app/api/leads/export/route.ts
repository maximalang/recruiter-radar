import { NextResponse } from 'next/server';
import { getLeadsForAllProfiles, VALID_FEEDBACK_STATUSES, type LeadItem } from '@/lib/leads-data';
import { listClientProfiles, type ClientProfile } from '@/lib/clientProfiles';
import { leadsToCsv } from '@/lib/leads-csv';

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

  let profiles: ClientProfile[];
  try {
    profiles = await listClientProfiles();
  } catch {
    profiles = [];
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
      confidenceGate,
      feedbackStatus,
      limit: 500,
    });
    leads = result.leads;
  } catch {
    leads = [];
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
