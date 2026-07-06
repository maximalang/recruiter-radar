import { NextRequest, NextResponse } from 'next/server';
import { getLeadDetail } from '@/lib/leads-data';
import { getClientProfileById } from '@/lib/clientProfiles';
import { getOwnerIdFromSession } from '@/lib/session';
import { singleLeadToCsv } from '@/lib/leads-csv';

/**
 * GET /api/leads/:id/export — single-lead CSV handoff.
 *
 * The lead-detail "Дальнейшие шаги" block links here for a quick one-row export
 * that doesn't pull the whole list. Owner-scoped via getLeadDetail: a lead that
 * belongs to another tenant (or no session) → 404, never leaking existence.
 *
 * The CSV uses the SAME column layout as the list export (/api/leads/export),
 * so a CRM import mapping configured once works for both. Identifier columns
 * (INN/ОГРН/domain/career-page) are populated from the lead-detail row, which
 * already joins orgs.
 */
export const dynamic = 'force-dynamic';

function sanitizeFilename(name: string): string {
  // Keep it filesystem-safe: replace anything not word/space/dash/cyrillic-letter
  // friendly. Cyrillic is allowed; strip path separators and quotes.
  return (name || 'lead').replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 60) || 'lead';
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const ownerId = await getOwnerIdFromSession();
  const lead = ownerId ? await getLeadDetail({ candidateId: id, ownerId }) : null;

  if (!lead) {
    return new NextResponse('not_found', { status: 404 });
  }

  // The owning practice name — best-effort; the CSV column is empty when the
  // profile can't be loaded (e.g. pilot/anonymous), matching the list export.
  const profile = ownerId
    ? await getClientProfileById(lead.clientProfileId, ownerId).catch(() => null)
    : null;

  const csv = singleLeadToCsv({
    id: lead.id,
    orgName: lead.orgName,
    score: lead.score,
    confidenceGate: lead.confidenceGate,
    whyNow: lead.whyNow,
    lawfulContactPath: lead.lawfulContactPath,
    vacanciesCount: lead.vacanciesCount,
    evidenceTitles: lead.evidenceTitles,
    locationNames: lead.locationNames,
    sourceFamilies: lead.sourceFamilies,
    feedbackStatus: lead.feedbackStatus,
    latestPublishedAt: lead.latestPublishedAt,
    orgInn: lead.orgInn,
    orgOgrn: lead.orgOgrn,
    orgDomain: lead.orgDomain,
    orgWebsite: lead.orgWebsite,
    careerPageUrl: lead.careerPageUrl,
    profileName: profile?.agencyName ?? null,
  });

  const filename = `lead-${sanitizeFilename(lead.orgName)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
