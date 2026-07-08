import { NextResponse } from "next/server";
import { getPool } from "../../../lib/db";
import { formatReason, type ScoringReason } from "../../../lib/scoring/scoring-reasons";
import { extractPayloadFields } from "../../../lib/leads-data";
import { updateDigestOrgStateFeedback } from "../../../lib/digestFeedback";
import { getOwnerIdFromSession } from "../../../lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Format reasons from DB (handles both legacy string[] and new ScoringReason[]).
 * Returns Russian display strings for the review UI.
 */
function formatReasonsFromRaw(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  const result: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      // Legacy format — pass through
      result.push(item);
    } else if (
      typeof item === "object" &&
      item !== null &&
      "key" in item &&
      "component" in item
    ) {
      // New ScoringReason format — render Russian label
      result.push(formatReason(item as ScoringReason));
    }
  }
  return result;
}

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

  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
  const offset = Math.max(Number(searchParams.get("offset") ?? 0), 0);

  // Owner-scope: reject reads of another tenant's review queue. The JOIN +
  // owner predicate below also defends against a forged clientProfileId.
  const ownerId = await getOwnerIdFromSession();
  if (!ownerId) {
    return NextResponse.json({ error: "Access denied: no active session." }, { status: 401 });
  }

  const pool = getPool();
  if (!pool) {
    return NextResponse.json({ error: "Database not available." }, { status: 503 });
  }

  try {
    const countResult = await pool.query<{ count: string }>(`
      SELECT COUNT(*) AS count
      FROM digest_candidates dc
      JOIN client_profiles cp
        ON cp.id = dc.client_profile_id
      WHERE dc.client_profile_id = $1
        AND (cp.owner_id = $2 OR cp.owner_id IS NULL)
        AND dc.review_status = 'pending_review'
    `, [clientProfileId, ownerId]);

    const total = parseInt(countResult.rows[0]?.count ?? "0", 10);

    const itemsResult = await pool.query<{
      id: string;
      org_id: string;
      org_name: string;
      score: number;
      vacancies_count: number;
      distinct_vacancy_names_count: number;
      latest_published_at: string | null;
      reasons: unknown;
      source_families: unknown;
      payload: unknown;
      created_at: string;
    }>(`
      SELECT
        dc.id::TEXT AS id,
        dc.org_id::TEXT AS org_id,
        dc.source_display_name AS org_name,
        dc.total_score AS score,
        dc.vacancies_count,
        dc.distinct_vacancy_names_count,
        dc.latest_published_at,
        dc.reasons,
        dc.source_families,
        dc.payload,
        dc.created_at::TEXT AS created_at
      FROM digest_candidates dc
      JOIN client_profiles cp
        ON cp.id = dc.client_profile_id
      WHERE dc.client_profile_id = $1
        AND (cp.owner_id = $2 OR cp.owner_id IS NULL)
        AND dc.review_status = 'pending_review'
      ORDER BY dc.total_score DESC, dc.created_at DESC
      LIMIT $3 OFFSET $4
    `, [clientProfileId, ownerId, limit, offset]);

    const items = itemsResult.rows.map((row) => {
      // Confidence gate, evidence titles, location names, and the foreign-
      // employer flag live in payload — they are not real columns on
      // digest_candidates. Read them via the canonical extractor
      // (snake_case/camelCase tolerant, safe empty-array degradation).
      // T4.5: isForeignEmployer is now surfaced so the review card can show the
      // foreign reason chip instead of a hardcoded false. No new SQL — derived
      // from the payload the route already reads.
      const { confidenceGate, evidenceTitles, locationNames, isForeignEmployer } = extractPayloadFields(row.payload);
      return {
        id: row.id,
        orgId: row.org_id,
        orgName: row.org_name ?? "Неизвестная компания",
        score: row.score,
        confidenceGate,
        isForeignEmployer,
        vacanciesCount: row.vacancies_count,
        distinctVacancyNamesCount: row.distinct_vacancy_names_count,
        latestPublishedAt: row.latest_published_at,
        reasons: formatReasonsFromRaw(row.reasons),
        sourceFamilies: Array.isArray(row.source_families)
          ? row.source_families.filter((s: unknown): s is string => typeof s === "string")
          : [],
        evidenceTitles,
        locationNames,
        createdAt: row.created_at,
      };
    });

    return NextResponse.json({ items, total, limit, offset });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch review queue.";
    return NextResponse.json({ error: message }, { status: 500 });
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

  // Owner-scope: only the profile's owner (or a pilot/anonymous profile) may
  // approve/reject its candidates. The owner predicate is enforced inside the
  // UPDATE so a forged clientProfileId simply matches no rows → 404.
  const ownerId = await getOwnerIdFromSession();
  if (!ownerId) {
    return NextResponse.json({ error: "Access denied: no active session." }, { status: 401 });
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
        AND (cp.owner_id = $4 OR cp.owner_id IS NULL)
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
      } catch (suppressError) {
        // The review_status UPDATE already succeeded — log the suppression
        // failure but don't fail the whole request. The candidate is rejected;
        // suppression is a best-effort coherence bonus.
        const message = suppressError instanceof Error ? suppressError.message : "suppression failed";
        return NextResponse.json({
          ok: true,
          candidate: result.rows[0],
          warning: `Rejected, but suppression failed: ${message}`,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      candidate: result.rows[0],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update review status.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
