import { NextRequest, NextResponse } from 'next/server';
import { getLeadDetail, formatLawfulContactPath } from '@/lib/leads-data';
import { getClientProfileById } from '@/lib/clientProfiles';
import { getOwnerIdFromSession } from '@/lib/session';
import { buildFitExplanation } from '@/lib/leads/fit-explanation';
import { buildCompanySummary } from '@/lib/leads/company-summary';
import { scoreBand, formatSignalStrength } from '@/lib/scoring/score-display';

/**
 * GET /api/leads/:id — owner-scoped lead detail.
 *
 * Auth: signed session cookie. getLeadDetail is itself owner-scoped, so a lead
 * belonging to another tenant (or no session) returns null → 404. We never leak
 * existence across owners.
 *
 * Response separates DETERMINISTIC evidence (score, gate, evidence titles,
 * deterministic fit/summary, lawful contact path) from the ATTRIBUTED AI layer
 * (`aiEnrichment`) so a consumer can tell hard evidence from advisory hint — the
 * same boundary the lead-detail page renders. Raw internal fields (opener draft,
 * raw payload, candidate source keys, structured reasons) are omitted.
 */

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const ownerId = await getOwnerIdFromSession();
  const lead = ownerId ? await getLeadDetail({ candidateId: id, ownerId }) : null;

  if (!lead) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Deterministic fit explanation needs the agency profile to match against.
  // Degrade gracefully if the profile can't be loaded.
  const profile = ownerId
    ? await getClientProfileById(lead.clientProfileId, ownerId).catch(() => null)
    : null;
  const fit = profile
    ? buildFitExplanation(
        {
          structuredReasons: lead.structuredReasons,
          locationNames: lead.locationNames,
          lawfulContactPath: lead.lawfulContactPath,
          sourceFamilies: lead.sourceFamilies,
          careerPageUrl: lead.careerPageUrl,
          orgDomain: lead.orgDomain,
        },
        {
          industries: profile.industries,
          roles: profile.roles,
          excludedIndustries: profile.excludedIndustries,
          excludedLocations: profile.excludedLocations,
          contactPolicy: profile.contactPolicy,
          remoteFriendly: profile.remoteFriendly,
          targetCity: profile.targetCity,
        },
      )
    : null;

  const summary = buildCompanySummary({
    orgName: lead.orgName,
    confidenceGate: lead.confidenceGate,
    vacanciesCount: lead.vacanciesCount,
    distinctVacancyNamesCount: lead.distinctVacancyNamesCount,
    evidenceTitles: lead.evidenceTitles,
    sourceFamilies: lead.sourceFamilies,
    locationNames: lead.locationNames,
    latestPublishedAt: lead.latestPublishedAt,
  });

  const band = scoreBand(lead.score);

  return NextResponse.json({
    id: lead.id,
    orgName: lead.orgName,
    score: lead.score,
    signalStrength: formatSignalStrength(lead.score),
    scoreBand: { label: band.label, tone: band.tone },
    confidenceGate: lead.confidenceGate,

    // Deterministic decision drivers
    whyNow: lead.whyNow && lead.whyNow.trim() ? lead.whyNow.trim() : null,
    fit: fit && !fit.isEmpty ? fit.lines.map((l) => ({ dimension: l.dimension, text: l.text })) : [],
    companySummary: {
      identity: summary.identity,
      hiringMotion: summary.hiringMotion,
      agencyRelevance: summary.agencyRelevance,
      strength: summary.strength,
    },

    // Deterministic evidence
    evidence: {
      titles: lead.evidenceTitles,
      vacanciesCount: lead.vacanciesCount,
      distinctVacancyNamesCount: lead.distinctVacancyNamesCount,
      latestPublishedAt: lead.latestPublishedAt,
      sourceFamilies: lead.sourceFamilies,
    },
    negativeSignals: lead.negativeSignals,

    // Reachability
    lawfulContactPath: formatLawfulContactPath(lead.lawfulContactPath),
    locationNames: lead.locationNames,
    orgDomain: lead.orgDomain,
    orgWebsite: lead.orgWebsite,
    careerPageUrl: lead.careerPageUrl,

    // Attributed, advisory AI layer — explicitly separated from evidence above.
    aiEnrichment: lead.aiEnrichment,

    feedbackStatus:
      lead.feedbackStatus && lead.feedbackStatus !== 'none' ? lead.feedbackStatus : null,
    createdAt: lead.createdAt,
  });
}
