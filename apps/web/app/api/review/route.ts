import { NextResponse } from "next/server";
import { getPool } from "../../../lib/db";
import { updateDigestOrgStateFeedback } from "../../../lib/digestFeedback";
import { getSession } from "../../../lib/auth-v2/authorization";
import { hasFeatureAccess } from "../../../lib/entitlements";
import { listPendingReviewCandidates } from "../../../lib/review-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/review — list pending review candidates.
 * Query params:
 *   clientProfileId (required) — filter by client profile
 *   limit (default 50, max 200)
 *   offset (default 0)
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const clientProfileId = searchParams.get("clientProfileId");

  if (!clientProfileId) {
    return NextResponse.json(
      { error: "clientProfileId is required." },
      { status: 400 }
    );
  }

  const rawLimit = searchParams.get("limit");
  const rawOffset = searchParams.get("offset");
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  const offset = rawOffset === null ? 0 : Number(rawOffset);

  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    return NextResponse.json({ error: "limit must be an integer between 1 and 200." }, { status: 400 });
  }
  if (!Number.isInteger(offset) || offset < 0) {
    return NextResponse.json({ error: "offset must be a non-negative integer." }, { status: 400 });
  }

  // Owner-scope: reject reads of another tenant's review queue. The JOIN +
  // owner predicate below also defends against a forged clientProfileId.
  const authorization = await getSession({ permission: "leads:read" });
  if (!authorization?.workspaceId) {
    return NextResponse.json({ error: "Access denied: no active session." }, { status: 401 });
  }
  const ownerId = authorization.dataOwnerId;
  try {
    if (!(await hasFeatureAccess(ownerId, "api", { workspaceId: authorization.workspaceId }))) {
      return NextResponse.json({ error: "entitlement_required" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "entitlement_check_unavailable" }, { status: 503 });
  }

  const pool = getPool();
  if (!pool) {
    return NextResponse.json({ error: "Database not available." }, { status: 503 });
  }

  try {
    const result = await listPendingReviewCandidates({
      pool,
      clientProfileId,
      ownerId,
      limit,
      offset,
    });
    return NextResponse.json({ ...result, limit, offset });
  } catch {
    return NextResponse.json({ error: "Failed to fetch review queue." }, { status: 500 });
  }
}

/**
 * POST /api/review — approve or reject a pending candidate.
 * Body:
 *   candidateId (required) — digest_candidates.id
 *   action (required) — "approve" | "reject"
 *   clientProfileId (required) — for verification
 *
 * Coherent with /leads triage:
 *   approve → review_status = 'approved'. The candidate is cleared for delivery
 *     as a lead. feedback_status is NOT touched: the agency's triage
 *     (В работу / Ответили / …) is a separate stage that happens on /leads.
 *   reject  → review_status = 'rejected' AND feedback_status = 'badfit' with a
 *     30-day suppression (reuses the digest feedback badfit contract). This
 *     means a rejected org will NOT reappear as a fresh lead in /leads for 30
 *     days — the two state machines stay in sync instead of /review rejecting
 *     a candidate that /leads then shows as brand new.
 */
export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "JSON object body is required." }, { status: 400 });
  }

  const payload = body as {
    candidateId?: string | number;
    action?: string;
    clientProfileId?: string | number;
  };

  if (payload.candidateId == null) {
    return NextResponse.json({ error: "candidateId is required." }, { status: 400 });
  }

  if (payload.action !== "approve" && payload.action !== "reject") {
    return NextResponse.json(
      { error: "action must be \"approve\" or \"reject\"." },
      { status: 400 }
    );
  }

  if (payload.clientProfileId == null) {
    return NextResponse.json({ error: "clientProfileId is required." }, { status: 400 });
  }

  // Owner-scope: only the profile's explicit owner may
  // approve/reject its candidates. The owner predicate is enforced inside the
  // UPDATE so a forged clientProfileId simply matches no rows → 404.
  const authorization = await getSession({ permission: "leads:write" });
  if (!authorization?.workspaceId) {
    return NextResponse.json({ error: "Access denied: no active session." }, { status: 401 });
  }
  const ownerId = authorization.dataOwnerId;
  try {
    if (!(await hasFeatureAccess(ownerId, "api", { workspaceId: authorization.workspaceId }))) {
      return NextResponse.json({ error: "entitlement_required" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "entitlement_check_unavailable" }, { status: 503 });
  }

  const pool = getPool();
  if (!pool) {
    return NextResponse.json({ error: "Database not available." }, { status: 503 });
  }

  const reviewStatus = payload.action === "approve" ? "approved" : "rejected";

  try {
    const result = await pool.query<{
      id: string;
      org_id: string;
      review_status: string;
    }>(`
      UPDATE digest_candidates dc
      SET review_status = $1
      FROM client_profiles cp
      WHERE dc.id = $2
        AND dc.client_profile_id = $3
        AND cp.id = dc.client_profile_id
        AND cp.owner_id = $4
        AND dc.review_status = 'pending_review'
      RETURNING dc.id::TEXT AS id, dc.org_id::TEXT AS org_id, dc.review_status
    `, [reviewStatus, payload.candidateId, payload.clientProfileId, ownerId]);

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "Candidate not found or not in pending_review status." },
        { status: 404 }
      );
    }

    // Reject also suppresses the org for 30d + marks feedback_status='badfit'
    // so /review and /leads stay coherent (a rejected candidate does not
    // re-surface as a fresh lead). Approve leaves feedback_status alone — the
    // agency triages separately on /leads.
    if (payload.action === "reject") {
      try {
        await updateDigestOrgStateFeedback({
          clientProfileId: payload.clientProfileId,
          orgId: result.rows[0].org_id,
          digestCandidateId: payload.candidateId,
          action: "badfit",
        });
      } catch {
        // The review_status UPDATE already succeeded, so preserve the successful
        // review result without exposing internal suppression/database details.
        return NextResponse.json({
          ok: true,
          candidate: result.rows[0],
          warning: "Rejected, but suppression failed.",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      candidate: result.rows[0],
    });
  } catch {
    return NextResponse.json({ error: "Failed to update review status." }, { status: 500 });
  }
}
