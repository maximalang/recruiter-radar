import { NextRequest, NextResponse } from 'next/server';
import { getDashboardSourceHealth, type SourceHealth } from '@/lib/dashboard-data';
import {
  getSourceRegistry,
  getPrimarySourceIds,
} from '@/lib/sources/source-registry';

/**
 * GET /api/sources/status — internal-admin source registry + health summary.
 *
 * Auth: INGEST_API_KEY via `x-api-key` (same key/boundary as the ingest route).
 * This is operational telemetry, NOT tenant data, so it is admin-key gated
 * rather than session-scoped — and it deliberately exposes NO lead/tenant data.
 *
 * Returns the registry metadata (id/name/category/primary/requirements) joined
 * with last-24h health (records, last run, status) per source.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const apiKey = process.env.INGEST_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'INGEST_API_KEY is not configured.' },
      { status: 500 },
    );
  }
  if (request.headers.get('x-api-key') !== apiKey) {
    return NextResponse.json(
      { error: 'Invalid or missing x-api-key header.' },
      { status: 401 },
    );
  }

  const registry = getSourceRegistry();
  const primaryIds = new Set(getPrimarySourceIds());

  let health: SourceHealth[];
  try {
    health = await getDashboardSourceHealth();
  } catch {
    health = [];
  }
  const healthById = new Map(health.map((h) => [h.id, h]));

  const sources = registry.map((s) => {
    const h = healthById.get(s.id);
    return {
      id: s.id,
      name: s.name,
      category: s.category,
      isPrimary: primaryIds.has(s.id),
      requiredEnvVars: s.requiredEnvVars,
      health: h
        ? {
            status: h.status,
            overall: h.overall,
            recordsLast24h: h.recordsProcessed,
            lastRun: h.lastRun || null,
          }
        : null,
    };
  });

  return NextResponse.json({
    sources,
    summary: {
      total: sources.length,
      primary: sources.filter((s) => s.isPrimary).length,
    },
  });
}
