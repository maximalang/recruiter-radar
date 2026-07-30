import { NextResponse } from 'next/server';
import { getClientProfileByOwnerId } from '@/lib/clientProfiles';
import { countMatchingCandidatesForProfile } from '@/lib/digest';
import { computeProfileCompletion } from '@/lib/profileCompletion';
import { getAuthorizedOwnerId } from '@/lib/auth-v2/authorization';

/**
 * GET /api/profile/preview — approximate current match count for the owner's
 * profile, plus the completion breakdown.
 *
 * Auth: signed session cookie. No session or no profile → 200 with
 * `hasProfile: false` and a null match count (never another tenant's data).
 *
 * The match count runs the SAME gate path the digest uses
 * (`countMatchingCandidatesForProfile`), so the number reflects exactly what the
 * filters would deliver — `capped: true` means the scan hit its limit and the
 * real count may be higher.
 */

export const dynamic = 'force-dynamic';

export async function GET() {
  const ownerId = await getAuthorizedOwnerId('profiles:read');
  if (!ownerId) {
    return NextResponse.json({ hasProfile: false, matchCount: null, completion: null });
  }

  let profile;
  try {
    profile = await getClientProfileByOwnerId(ownerId);
  } catch {
    return NextResponse.json({ hasProfile: false, matchCount: null, completion: null });
  }

  if (!profile) {
    return NextResponse.json({ hasProfile: false, matchCount: null, completion: null });
  }

  const completion = computeProfileCompletion(profile);
  const matchCount = await countMatchingCandidatesForProfile(profile).catch(() => null);

  return NextResponse.json({
    hasProfile: true,
    matchCount,
    completion: {
      filledCount: completion.filledCount,
      totalCount: completion.totalCount,
      ratio: completion.ratio,
      isComplete: completion.isComplete,
      groups: completion.groups.map((g) => ({ key: g.key, label: g.label, filled: g.filled })),
    },
  });
}
