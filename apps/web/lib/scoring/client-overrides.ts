/**
 * Client overrides computation — reads badfit history and produces
 * FiurClientOverrides for FIUR-based scoring.
 *
 * docs/product.md §Reweighting:
 * > When 3+ "badfit" signals are recorded for a specific industry/role
 * > pattern, the fit score for that pattern is reduced by 50%.
 *
 * This function queries `client_digest_org_state` and `orgs` to find
 * patterns where badfit feedback exceeds the threshold, then builds
 * FiurClientOverrides with industryFitPenalty entries.
 */

import { Pool } from 'pg';
import type { Pool as PoolType, PoolClient } from 'pg';
import type { FiurClientOverrides } from './fiur';

type DbClient = Pick<PoolType, 'query'> | Pick<PoolClient, 'query'>;

const BADFIT_THRESHOLD = 3;
const BASE_PENALTY_MULTIPLIER = 0.5; // 50% penalty after 3+ badfits

export interface ClientOverridesResult {
  overrides: FiurClientOverrides;
  /** Industries that triggered a penalty. */
  penalizedIndustries: string[];
  /** Total badfit count across all penalized industries. */
  totalBadfits: number;
}

/**
 * Compute client overrides from badfit history.
 *
 * Reads client_digest_org_state for feedback_status='badfit' records,
 * joins with orgs to get industry data, counts badfits per industry,
 * and applies penalty when count >= BADFIT_THRESHOLD.
 *
 * Returns null when DATABASE_URL is not set (e.g., in tests without DB).
 */
export async function computeClientOverrides(
  clientProfileId: string | number,
  db?: DbClient
): Promise<ClientOverridesResult | null> {
  const pool = db ?? getPool();

  if (!pool) {
    // No DATABASE_URL — return null, caller skips FIUR scoring
    return null;
  }

  const normalizedId = normalizePositiveInteger(clientProfileId, 'Invalid client profile id');

  const result = await pool.query<{ industry: string; badfit_count: string }>(`
    SELECT
      LOWER(TRIM(orgs.industry)) AS industry,
      COUNT(*)::INT AS badfit_count
    FROM client_digest_org_state AS state
    JOIN orgs
      ON orgs.id = state.org_id
    WHERE state.client_profile_id = $1
      AND state.feedback_status = 'badfit'
      AND orgs.industry IS NOT NULL
      AND LENGTH(TRIM(orgs.industry)) > 0
    GROUP BY LOWER(TRIM(orgs.industry))
    HAVING COUNT(*) >= $2
    ORDER BY badfit_count DESC, industry ASC
  `, [normalizedId, BADFIT_THRESHOLD]);

  if (result.rowCount === 0) {
    return { overrides: {}, penalizedIndustries: [], totalBadfits: 0 };
  }

  const industryFitPenalty: Record<string, number> = {};
  const penalizedIndustries: string[] = [];
  let totalBadfits = 0;

  for (const row of result.rows) {
    const industry = row.industry?.trim() ?? '';
    const count = parseInt(row.badfit_count, 10);

    if (industry.length > 0 && count >= BADFIT_THRESHOLD) {
      industryFitPenalty[industry] = BASE_PENALTY_MULTIPLIER;
      penalizedIndustries.push(industry);
      totalBadfits += count;
    }
  }

  // Sort penalizedIndustries by count descending (matches SQL ORDER BY)
  penalizedIndustries.sort((a, b) => {
    const countA = parseInt(
      result.rows.find((r) => r.industry === a)?.badfit_count ?? '0',
      10
    );
    const countB = parseInt(
      result.rows.find((r) => r.industry === b)?.badfit_count ?? '0',
      10
    );
    return countB - countA;
  });

  return {
    overrides: Object.keys(industryFitPenalty).length > 0 ? { industryFitPenalty } : {},
    penalizedIndustries,
    totalBadfits,
  };
}

function normalizePositiveInteger(value: string | number, _errorMessage?: string): number {
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

const globalForPg = globalThis as typeof globalThis & {
  recruiterRadarClientOverridesPool?: PoolType;
};

function getPool(): PoolType | null {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;

  if (!globalForPg.recruiterRadarClientOverridesPool) {
    globalForPg.recruiterRadarClientOverridesPool = new Pool({ connectionString });
  }
  return globalForPg.recruiterRadarClientOverridesPool;
}