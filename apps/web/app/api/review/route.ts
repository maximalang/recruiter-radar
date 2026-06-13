import { NextResponse } from "next/server";
import { getPool } from "../../../lib/db";

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

  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
  const offset = Math.max(Number(searchParams.get("offset") ?? 0), 0);

  const pool = getPool();
  if (!pool) {
    return NextResponse.json({ error: "Database not available." }, { status: 503 });
  }

  try {
    const countResult = await pool.query<{ count: string }>(`
      SELECT COUNT(*) AS count
      FROM digest_candidates
      WHERE client_profile_id = $1 AND review_status = 'pending_review'
    `, [clientProfileId]);

    const total = parseInt(countResult.rows[0]?.count ?? "0", 10);

    const itemsResult = await pool.query<{
      id: string;
      org_id: string;
      org_name: string;
      score: number;
      confidence_gate: string;
      vacancies_count: number;
      distinct_vacancy_names_count: number;
      latest_published_at: string | null;
      reasons: unknown;
      source_families: unknown;
      evidence_titles: unknown;
      location_names: unknown;
      created_at: string;
    }>(`
      SELECT
        dc.id::TEXT AS id,
        dc.org_id::TEXT AS org_id,
        dc.source_display_name AS org_name,
        dc.total_score AS score,
        dc.confidence_gate,
        dc.vacancies_count,
        dc.distinct_vacancy_names_count,
        dc.latest_published_at,
        dc.reasons,
        dc.source_families,
        dc.evidence_titles,
        dc.location_names,
        dc.created_at::TEXT AS created_at
      FROM digest_candidates dc
      WHERE dc.client_profile_id = $1 AND dc.review_status = 'pending_review'
      ORDER BY dc.total_score DESC, dc.created_at DESC
      LIMIT $2 OFFSET $3
    `, [clientProfileId, limit, offset]);

    const items = itemsResult.rows.map((row) => ({
      id: row.id,
      orgId: row.org_id,
      orgName: row.org_name ?? "Неизвестная компания",
      score: row.score,
      confidenceGate: row.confidence_gate ?? "",
      vacanciesCount: row.vacancies_count,
      distinctVacancyNamesCount: row.distinct_vacancy_names_count,
      latestPublishedAt: row.latest_published_at,
      reasons: Array.isArray(row.reasons)
        ? row.reasons.filter((r: unknown): r is string => typeof r === "string")
        : [],
      sourceFamilies: Array.isArray(row.source_families)
        ? row.source_families.filter((s: unknown): s is string => typeof s === "string")
        : [],
      evidenceTitles: Array.isArray(row.evidence_titles)
        ? row.evidence_titles.filter((e: unknown): e is string => typeof e === "string")
        : [],
      locationNames: Array.isArray(row.location_names)
        ? row.location_names.filter((l: unknown): l is string => typeof l === "string")
        : [],
      createdAt: row.created_at,
    }));

    return NextResponse.json({ items, total, limit, offset });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch review queue.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/review — approve or reject a candidate.
 * Body:
 *   candidateId (required) — digest_candidates.id
 *   action (required) — "approve" | "reject"
 *   clientProfileId (required) — for verification
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
      UPDATE digest_candidates
      SET review_status = $1
      WHERE id = $2 AND client_profile_id = $3 AND review_status = 'pending_review'
      RETURNING id::TEXT AS id, org_id::TEXT AS org_id, review_status
    `, [reviewStatus, payload.candidateId, payload.clientProfileId]);

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "Candidate not found or not in pending_review status." },
        { status: 404 }
      );
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
