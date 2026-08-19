import { NextRequest, NextResponse } from "next/server";
import { getDashboardQualityMetrics } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/metrics — operator-only quality observability.
 *
 * Returns gate distribution, acceptance rates, and source-health aggregates.
 * This is operational telemetry (NOT tenant data), so it is admin-key gated
 * rather than session-scoped — same boundary as /api/sources/status. The
 * /dashboard page reads getDashboardQualityMetrics() directly via server
 * import (owner-scoped render), so this endpoint has no in-app UI caller.
 */
export async function GET(request: NextRequest) {
  const apiKey = process.env.ADMIN_API_KEY ?? process.env.INGEST_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Operator key is not configured." },
      { status: 500 },
    );
  }
  if (request.headers.get("x-api-key") !== apiKey) {
    return NextResponse.json(
      { error: "Invalid or missing x-api-key header." },
      { status: 401 },
    );
  }

  try {
    const metrics = await getDashboardQualityMetrics();
    return NextResponse.json(metrics);
  } catch {
    return NextResponse.json(
      { error: "Dashboard metrics are temporarily unavailable." },
      { status: 500 },
    );
  }
}
