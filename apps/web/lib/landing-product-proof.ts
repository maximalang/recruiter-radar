import { getPool } from "./db-pool";
import { logWarn } from "./runtime";

const QUERY_TIMEOUT_MS = 1_200;

export type LandingProductProof = {
  companiesWithHiringSignals7d: number;
  confirmedHiringSignals7d: number;
  companiesPassingConfidenceGate7d: number;
  lastSuccessfulRecalculationAt: string;
};

type LandingProductProofRow = {
  companies_with_hiring_signals_7d: string | number;
  confirmed_hiring_signals_7d: string | number;
  companies_passing_confidence_gate_7d: string | number;
  last_successful_recalculation_at: string | Date | null;
};

/**
 * Public proof is derived only from anonymous aggregates:
 * - recent hiring signals are job-posting/team-growth signals from the last 7d;
 * - "confirmed" signals belong to an organization whose completed digest
 *   candidate passed confidence gate A or B in the same period;
 * - the recalculation timestamp is the latest completed digest run.
 */
export const LANDING_PRODUCT_PROOF_QUERY = `
  WITH recent_hiring_signals AS (
    SELECT signal.id, signal.org_id
    FROM signals AS signal
    WHERE signal.occurred_at >= NOW() - INTERVAL '7 days'
      AND signal.signal_type::TEXT IN ('job_posting', 'team_growth')
  ),
  recent_confident_orgs AS (
    SELECT DISTINCT candidate.org_id
    FROM digest_candidates AS candidate
    INNER JOIN digest_runs AS run
      ON run.id = candidate.digest_run_id
    WHERE candidate.created_at >= NOW() - INTERVAL '7 days'
      AND run.status = 'completed'
      AND COALESCE(
        candidate.payload->>'confidence_gate',
        candidate.payload->>'confidenceGate'
      ) IN ('A', 'B')
  )
  SELECT
    COUNT(DISTINCT signal.org_id)::TEXT
      AS companies_with_hiring_signals_7d,
    COUNT(signal.id) FILTER (
      WHERE confident.org_id IS NOT NULL
    )::TEXT AS confirmed_hiring_signals_7d,
    (SELECT COUNT(*)::TEXT FROM recent_confident_orgs)
      AS companies_passing_confidence_gate_7d,
    (
      SELECT MAX(run.completed_at)
      FROM digest_runs AS run
      WHERE run.status = 'completed'
    ) AS last_successful_recalculation_at
  FROM recent_hiring_signals AS signal
  LEFT JOIN recent_confident_orgs AS confident
    ON confident.org_id = signal.org_id
`;

function parsePositiveCount(value: string | number): number | null {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseTimestamp(value: string | Date | null): string | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const timeoutError = new Error("Landing product proof query timed out");
      timeoutError.name = "TimeoutError";
      reject(timeoutError);
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function getLandingProductProof(
  options: { timeoutMs?: number } = {},
): Promise<LandingProductProof | null> {
  const pool = getPool();
  if (!pool) return null;

  try {
    const result = await withTimeout(
      pool.query<LandingProductProofRow>(LANDING_PRODUCT_PROOF_QUERY),
      options.timeoutMs ?? QUERY_TIMEOUT_MS,
    );
    const row = result.rows[0];
    if (!row) return null;

    const companiesWithHiringSignals7d = parsePositiveCount(
      row.companies_with_hiring_signals_7d,
    );
    const confirmedHiringSignals7d = parsePositiveCount(
      row.confirmed_hiring_signals_7d,
    );
    const companiesPassingConfidenceGate7d = parsePositiveCount(
      row.companies_passing_confidence_gate_7d,
    );
    const lastSuccessfulRecalculationAt = parseTimestamp(
      row.last_successful_recalculation_at,
    );

    if (
      companiesWithHiringSignals7d == null ||
      confirmedHiringSignals7d == null ||
      companiesPassingConfidenceGate7d == null ||
      lastSuccessfulRecalculationAt == null
    ) {
      return null;
    }

    return {
      companiesWithHiringSignals7d,
      confirmedHiringSignals7d,
      companiesPassingConfidenceGate7d,
      lastSuccessfulRecalculationAt,
    };
  } catch (error) {
    logWarn("landing.product_proof_unavailable", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }
}
