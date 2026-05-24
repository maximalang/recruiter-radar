import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

interface GateDistribution {
  gate: string;
  count: number;
  percentage: number;
}

interface AcceptanceRate {
  period: string;
  delivered: number;
  accepted: number;
  rate: number;
}

interface QualityDashboardMetrics {
  gateDistribution: GateDistribution[];
  acceptanceRate7d: AcceptanceRate;
  acceptanceRate30d: AcceptanceRate;
  totalLeadsDelivered: number;
  totalSourcesActive: number;
  overallHealth: number;
}

export async function GET() {
  const pool = getPool();
  if (!pool) {
    return NextResponse.json({ error: "Database not configured." }, { status: 500 });
  }

  try {
    const [
      gateResult,
      rate7dResult,
      rate30dResult,
      sourcesResult,
    ] = await Promise.all([
      pool.query<{ gate: string; count: string }>(`
        SELECT
          COALESCE(dc.confidence_gate, 'unknown') AS gate,
          COUNT(*) AS count
        FROM digest_candidates dc
        WHERE dc.created_at >= NOW() - INTERVAL '30 days'
        GROUP BY dc.confidence_gate
        ORDER BY gate
      `),
      pool.query<{ delivered: string; accepted: string }>(`
        WITH recent AS (
          SELECT
            dc.id,
            dc.org_id,
            dc.client_profile_id,
            dc.created_at,
            cdos.feedback_status
          FROM digest_candidates dc
          LEFT JOIN client_digest_org_state cdos
            ON cdos.org_id = dc.org_id
            AND cdos.client_profile_id = dc.client_profile_id
          WHERE dc.created_at >= NOW() - INTERVAL '7 days'
        )
        SELECT
          COUNT(*) FILTER (WHERE feedback_status IS NOT NULL) AS delivered,
          COUNT(*) FILTER (WHERE feedback_status IN ('accepted', 'contacted', 'replied', 'won')) AS accepted
        FROM recent
      `),
      pool.query<{ delivered: string; accepted: string }>(`
        WITH recent AS (
          SELECT
            dc.id,
            dc.org_id,
            dc.client_profile_id,
            dc.created_at,
            cdos.feedback_status
          FROM digest_candidates dc
          LEFT JOIN client_digest_org_state cdos
            ON cdos.org_id = dc.org_id
            AND cdos.client_profile_id = dc.client_profile_id
          WHERE dc.created_at >= NOW() - INTERVAL '30 days'
        )
        SELECT
          COUNT(*) FILTER (WHERE feedback_status IS NOT NULL) AS delivered,
          COUNT(*) FILTER (WHERE feedback_status IN ('accepted', 'contacted', 'replied', 'won')) AS accepted
        FROM recent
      `),
      pool.query<{ active: string; total: string }>(`
        SELECT
          COUNT(*) FILTER (WHERE last_sync_at >= NOW() - INTERVAL '1 hour') AS active,
          COUNT(*) AS total
        FROM data_sources
      `),
    ]);

    const gateRows = gateResult.rows;
    const totalGateCount = gateRows.reduce((sum, r) => sum + parseInt(r.count, 10), 0);
    const gateDistribution: GateDistribution[] = gateRows.map((r) => ({
      gate: r.gate,
      count: parseInt(r.count, 10),
      percentage: totalGateCount > 0
        ? Math.round((parseInt(r.count, 10) / totalGateCount) * 100)
        : 0,
    }));

    const calcRate = (period: string, result: { delivered: string; accepted: string }): AcceptanceRate => {
      const delivered = parseInt(result.delivered, 10);
      const accepted = parseInt(result.accepted, 10);
      return {
        period,
        delivered,
        accepted,
        rate: delivered > 0 ? Math.round((accepted / delivered) * 100) : 0,
      };
    };

    const totalDelivered = parseInt(rate30dResult.rows[0]?.delivered ?? "0", 10);
    const sourcesActive = parseInt(sourcesResult.rows[0]?.active ?? "0", 10);
    const sourcesTotal = parseInt(sourcesResult.rows[0]?.total ?? "1", 10);
    const overallHealth = sourcesTotal > 0 ? Math.round((sourcesActive / sourcesTotal) * 100) : 0;

    const metrics: QualityDashboardMetrics = {
      gateDistribution,
      acceptanceRate7d: calcRate("7d", rate7dResult.rows[0] ?? { delivered: "0", accepted: "0" }),
      acceptanceRate30d: calcRate("30d", rate30dResult.rows[0] ?? { delivered: "0", accepted: "0" }),
      totalLeadsDelivered: totalDelivered,
      totalSourcesActive: sourcesActive,
      overallHealth,
    };

    return NextResponse.json(metrics);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
