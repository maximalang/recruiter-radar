/**
 * Server-side data fetching for the dashboard page.
 *
 * Queries the DB directly (no HTTP call) and returns serializable
 * data shapes matching the client component prop types.
 */

import { getPool } from "./db";
import { getSourceRegistry, type SourceId } from "./sources/source-registry";
import { getLeadsForAllProfiles, getPendingReviewCount, type LeadItem } from "./leads-data";
import { listClientProfiles, resolveHiringMode } from "./clientProfiles";

// ─── Types ──────────────────────────────────────────────────────

export interface GateDistribution {
  gate: string;
  count: number;
  percentage: number;
}

export interface AcceptanceRate {
  period: string;
  delivered: number;
  accepted: number;
  rate: number;
}

export interface QualityMetrics {
  gateDistribution: GateDistribution[];
  acceptanceRate7d: AcceptanceRate;
  acceptanceRate30d: AcceptanceRate;
  totalLeadsDelivered: number;
  totalSourcesActive: number;
  overallHealth: number;
}

export interface OverviewMetrics {
  totalSources: number;
  activeSources: number;
  overallHealth: number;
  totalAlerts: number;
}

export interface SourceHealth {
  id: string;
  name: string;
  overall: number;
  lastRun: string;
  recordsProcessed: number;
  errors: number;
  status: "excellent" | "good" | "warning" | "critical";
}

// ─── Data Fetching ──────────────────────────────────────────────

export async function getDashboardQualityMetrics(): Promise<QualityMetrics> {
  const pool = getPool();
  if (!pool) {
    return emptyQualityMetrics();
  }

  try {
    const [gateResult, rate7dResult, rate30dResult] = await Promise.all([
      pool.query<{ gate: string; count: string }>(`
        SELECT
          COALESCE(
            dc.payload->>'confidence_gate',
            dc.payload->>'confidenceGate',
            'unknown'
          ) AS gate,
          COUNT(*) AS count
        FROM digest_candidates dc
        WHERE dc.created_at >= NOW() - INTERVAL '30 days'
        GROUP BY 1
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
          COUNT(*) FILTER (WHERE feedback_status IN ('contacted', 'replied', 'won')) AS accepted
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
          COUNT(*) FILTER (WHERE feedback_status IN ('contacted', 'replied', 'won')) AS accepted
        FROM recent
      `),
    ]);

    const gateRows = gateResult.rows;
    const totalGateCount = gateRows.reduce(
      (sum, r) => sum + parseInt(r.count, 10),
      0,
    );
    const gateDistribution: GateDistribution[] = gateRows.map((r) => ({
      gate: r.gate,
      count: parseInt(r.count, 10),
      percentage:
        totalGateCount > 0
          ? Math.round((parseInt(r.count, 10) / totalGateCount) * 100)
          : 0,
    }));

    const calcRate = (
      period: string,
      result: { delivered: string; accepted: string },
    ): AcceptanceRate => {
      const delivered = parseInt(result.delivered, 10);
      const accepted = parseInt(result.accepted, 10);
      return {
        period,
        delivered,
        accepted,
        rate: delivered > 0 ? Math.round((accepted / delivered) * 100) : 0,
      };
    };

    const totalDelivered = parseInt(
      rate30dResult.rows[0]?.delivered ?? "0",
      10,
    );

    // Derive source health from signals table
    const sourceHealth = await getDashboardSourceHealth();
    const activeSources = sourceHealth.filter(
      (s) => s.status === "excellent" || s.status === "good",
    ).length;
    const totalSources = sourceHealth.length;
    const overallHealth =
      totalSources > 0 ? Math.round((activeSources / totalSources) * 100) : 0;

    return {
      gateDistribution,
      acceptanceRate7d: calcRate("7d", rate7dResult.rows[0] ?? { delivered: "0", accepted: "0" }),
      acceptanceRate30d: calcRate("30d", rate30dResult.rows[0] ?? { delivered: "0", accepted: "0" }),
      totalLeadsDelivered: totalDelivered,
      totalSourcesActive: activeSources,
      overallHealth,
    };
  } catch {
    return emptyQualityMetrics();
  }
}

export async function getDashboardOverviewMetrics(): Promise<OverviewMetrics> {
  const pool = getPool();
  if (!pool) {
    return { totalSources: 0, activeSources: 0, overallHealth: 0, totalAlerts: 0 };
  }

  try {
    // Count signals in the last 24h as "alerts"
    const alertsResult = await pool.query<{ count: string }>(`
      SELECT COUNT(*) AS count
      FROM signals
      WHERE occurred_at >= NOW() - INTERVAL '24 hours'
    `);

    const sourceHealth = await getDashboardSourceHealth();
    const totalSources = sourceHealth.length;
    const activeSources = sourceHealth.filter(
      (s) => s.status === "excellent" || s.status === "good",
    ).length;
    const overallHealth =
      totalSources > 0 ? Math.round((activeSources / totalSources) * 100) : 0;
    const totalAlerts = parseInt(alertsResult.rows[0]?.count ?? "0", 10);

    return { totalSources, activeSources, overallHealth, totalAlerts };
  } catch {
    return { totalSources: 0, activeSources: 0, overallHealth: 0, totalAlerts: 0 };
  }
}

export async function getDashboardSourceHealth(): Promise<SourceHealth[]> {
  const pool = getPool();
  if (!pool) {
    return [];
  }

  try {
    // Get the canonical source list from the registry
    const registry = getSourceRegistry();

    // Query signal stats per source in the last 24h
    const statsResult = await pool.query<{
      source: string;
      records_24h: string;
      latest_at: string | null;
    }>(`
      SELECT
        source,
        COUNT(*)::TEXT AS records_24h,
        MAX(occurred_at)::TEXT AS latest_at
      FROM signals
      WHERE occurred_at >= NOW() - INTERVAL '24 hours'
      GROUP BY source
    `);

    // Build a lookup from the query result
    const statsBySource = new Map(
      statsResult.rows.map((r) => [r.source, r]),
    );

    return registry.map((src) => {
      const stats = statsBySource.get(src.id);
      const records = parseInt(stats?.records_24h ?? "0", 10);
      const lastRun = stats?.latest_at ?? "";
      const syncAgeMs = stats?.latest_at
        ? Date.now() - new Date(stats.latest_at).getTime()
        : Infinity;

      // Compute overall health for this source (0-100)
      let overall = 100;
      // Penalty for stale sync: <1h → 100, 1-6h → 80, 6-24h → 50, 24h+ → 20
      if (syncAgeMs > 24 * 60 * 60 * 1000) overall = 20;
      else if (syncAgeMs > 6 * 60 * 60 * 1000) overall = 50;
      else if (syncAgeMs > 60 * 60 * 1000) overall = 80;
      // Penalty for no records
      if (records === 0 && syncAgeMs > 60 * 60 * 1000) overall -= 20;

      const status: SourceHealth["status"] =
        overall >= 80 ? "excellent" :
        overall >= 60 ? "good" :
        overall >= 40 ? "warning" :
        "critical";

      return {
        id: src.id,
        name: src.name ?? src.id,
        overall,
        lastRun,
        recordsProcessed: records,
        errors: 0, // No error tracking in current schema
        status,
      };
    });
  } catch {
    return [];
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function emptyQualityMetrics(): QualityMetrics {
  return {
    gateDistribution: [],
    acceptanceRate7d: { period: "7d", delivered: 0, accepted: 0, rate: 0 },
    acceptanceRate30d: { period: "30d", delivered: 0, accepted: 0, rate: 0 },
    totalLeadsDelivered: 0,
    totalSourcesActive: 0,
    overallHealth: 0,
  };
}

// ─── Analytics: Feedback Funnel ─────────────────────────────────

export interface FeedbackFunnelItem {
  status: string;
  count: number;
  label: string;
}

const FEEDBACK_LABELS: Record<string, string> = {
  // DB-legal (digest_feedback_status enum) — current in-app vocabulary
  contacted: 'В работе',
  replied: 'Ответили',
  won: 'Клиент',
  snooze: 'Отложено',
  dismissed: 'Мимо',
  badfit: 'Не наш профиль',
  // Legacy / display-only — not emitted by the in-app writer (not in the enum)
  accepted: 'Беру',
  later: 'Позже',
  call: 'Созвон',
  client: 'Клиент',
};

export async function getDashboardFeedbackFunnel(): Promise<FeedbackFunnelItem[]> {
  const pool = getPool();
  if (!pool) {
    return [];
  }

  try {
    const result = await pool.query<{ feedback_status: string; count: string }>(`
      SELECT
        cdos.feedback_status,
        COUNT(*)::TEXT AS count
      FROM client_digest_org_state cdos
      WHERE cdos.feedback_status IS NOT NULL
        AND cdos.feedback_status != 'none'
      GROUP BY cdos.feedback_status
      ORDER BY COUNT(*) DESC
    `);

    return result.rows
      .map((row) => ({
        status: row.feedback_status,
        count: parseInt(row.count, 10),
        label: FEEDBACK_LABELS[row.feedback_status] ?? row.feedback_status,
      }));
  } catch {
    return [];
  }
}

// ─── Analytics: Lead Metrics ────────────────────────────────────

export interface LeadMetrics {
  totalLeads: number;
  todayLeads: number;
  avgScore: number;
}

export async function getDashboardLeadMetrics(): Promise<LeadMetrics> {
  const pool = getPool();
  if (!pool) {
    return { totalLeads: 0, todayLeads: 0, avgScore: 0 };
  }

  try {
    const result = await pool.query<{
      total: string;
      today: string;
      avg_score: number | null;
    }>(`
      SELECT
        COUNT(*)::TEXT AS total,
        COUNT(*) FILTER (WHERE dc.created_at >= CURRENT_DATE)::TEXT AS today,
        ROUND(AVG(dc.total_score), 1) AS avg_score
      FROM digest_candidates dc
    `);

    const row = result.rows[0];
    return {
      totalLeads: parseInt(row?.total ?? "0", 10),
      todayLeads: parseInt(row?.today ?? "0", 10),
      avgScore: row?.avg_score ? Math.round(row.avg_score * 10) / 10 : 0,
    };
  } catch {
    return { totalLeads: 0, todayLeads: 0, avgScore: 0 };
  }
}

// ─── Analytics: Source Performance ──────────────────────────────

export interface SourcePerformanceItem {
  source: string;
  leads: number;
  avgScore: number;
}

export async function getDashboardSourcePerformance(): Promise<SourcePerformanceItem[]> {
  const pool = getPool();
  if (!pool) {
    return [];
  }

  try {
    // unnest source_families array to count leads per source
    const result = await pool.query<{
      source: string;
      leads: string;
      avg_score: number | null;
    }>(`
      SELECT
        sf.element AS source,
        COUNT(*)::TEXT AS leads,
        ROUND(AVG(dc.total_score), 1) AS avg_score
      FROM digest_candidates dc
      CROSS JOIN LATERAL unnest(dc.source_families) AS sf(element)
      GROUP BY sf.element
      ORDER BY COUNT(*) DESC
    `);

    return result.rows.map((row) => ({
      source: row.source,
      leads: parseInt(row.leads, 10),
      avgScore: row.avg_score ? Math.round(row.avg_score * 10) / 10 : 0,
    }));
  } catch {
    return [];
  }
}

// ─── Analytics: Source Evidence Quality ──────────────────────────
// Source performance (above) shows lead COUNT per source. Count alone is a
// volume signal, not a quality signal — a source can produce many gate-C
// platform-aggregation leads and still be weak evidence. This view exposes the
// gate distribution (A/B/C) and evidence-quality distribution
// (direct_hiring_proof vs platform_aggregation) per source, so an operator can
// see whether a source is producing gate-A direct proof or gate-C noise. It
// also surfaces the average recency (days since latest_published_at) so
// staleness is visible per source. This is the analytics layer that makes the
// RF evidence layer inspectable: the HTML-card fallback's contribution shows
// up as more direct_hiring_proof leads under `career-pages`.

export interface SourceEvidenceQualityItem {
  source: string;
  leads: number;
  /** Gate A/B/C/D distribution counts. D is theoretically possible but the
   * digest pipeline filters evidence_quality = enrichment_context, so in
   * practice only A/B/C reach digest_candidates. */
  gateA: number;
  gateB: number;
  gateC: number;
  gateD: number;
  /** Evidence-quality distribution counts. direct_hiring_proof = company-owned
   * surface (career-pages); platform_aggregation = platform/registry match;
   * enrichment_context = background only. */
  directHiringProof: number;
  platformAggregation: number;
  enrichmentContext: number;
  /** Average days from latest_published_at to now, rounded to 1 decimal.
   * Lower = fresher source. null when no published rows. */
  avgAgeDays: number | null;
}

export async function getDashboardSourceEvidenceQuality(): Promise<SourceEvidenceQualityItem[]> {
  const pool = getPool();
  if (!pool) {
    return [];
  }

  try {
    // confidence_gate lives in dc.payload JSON (snake_case from
    // source-digest-evidence.sql, camelCase from mapDigestEvidenceRow) — COALESCE
    // both spellings so this stays correct regardless of which writer produced
    // the row. evidence_quality is NOT persisted to payload today, so derive it
    // from source_families with the SAME classification source-digest-evidence.sql
    // uses (career-pages present → direct_hiring_proof; else platform_aggregation;
    // a lead that reached digest_candidates is never enrichment_context because
    // the SQL scorer filters that out). This keeps the analytics view truthful
    // without a payload-shape change. unnest source_families so a lead backed by
    // 2 source families counts toward each — same projection the lead-count view
    // above uses, so the two views reconcile.
    const result = await pool.query<{
      source: string;
      leads: string;
      gate_a: string;
      gate_b: string;
      gate_c: string;
      gate_d: string;
      direct: string;
      platform: string;
      context: string;
      avg_age_days: number | null;
    }>(`
      SELECT
        sf.element AS source,
        COUNT(*)::TEXT AS leads,
        COUNT(*) FILTER (WHERE COALESCE(dc.payload->>'confidence_gate', dc.payload->>'confidenceGate') = 'A')::TEXT AS gate_a,
        COUNT(*) FILTER (WHERE COALESCE(dc.payload->>'confidence_gate', dc.payload->>'confidenceGate') = 'B')::TEXT AS gate_b,
        COUNT(*) FILTER (WHERE COALESCE(dc.payload->>'confidence_gate', dc.payload->>'confidenceGate') = 'C')::TEXT AS gate_c,
        COUNT(*) FILTER (WHERE COALESCE(dc.payload->>'confidence_gate', dc.payload->>'confidenceGate') = 'D')::TEXT AS gate_d,
        COUNT(*) FILTER (WHERE 'career-pages' = ANY(dc.source_families))::TEXT AS direct,
        COUNT(*) FILTER (WHERE 'career-pages' <> ALL(dc.source_families))::TEXT AS platform,
        COUNT(*) FILTER (WHERE array_length(dc.source_families, 1) IS NULL)::TEXT AS context,
        ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - dc.latest_published_at)) / 86400.0), 1) AS avg_age_days
      FROM digest_candidates dc
      CROSS JOIN LATERAL unnest(dc.source_families) AS sf(element)
      GROUP BY sf.element
      ORDER BY COUNT(*) DESC
    `);

    return result.rows.map((row) => ({
      source: row.source,
      leads: parseInt(row.leads, 10),
      gateA: parseInt(row.gate_a, 10),
      gateB: parseInt(row.gate_b, 10),
      gateC: parseInt(row.gate_c, 10),
      gateD: parseInt(row.gate_d, 10),
      directHiringProof: parseInt(row.direct, 10),
      platformAggregation: parseInt(row.platform, 10),
      enrichmentContext: parseInt(row.context, 10),
      avgAgeDays: parseNullableFloat(row.avg_age_days),
    }));
  } catch {
    return [];
  }
}

// pg returns `ROUND(numeric, 1)` as a string by default (the `numeric` type),
// and `null` when no rows have a published date. Coerce to a number | null so
// the UI layer gets a real number for formatting.
function parseNullableFloat(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(num) ? Math.round(num * 10) / 10 : null;
}

// ─── Analytics: Ingest Volume Trend (7 days) ──────────────────────
// Per-source daily signal counts over the last 7 days. This is the view that
// makes a silently-failing source visible: the 24h health card only shows the
// latest window, so a source that fetches fine but times out mid-write every
// day (habr-career's historical 120s-kill bug) reads as "0 records / 24h" once
// and "healthy" the next, never surfacing the daily loss. A 7-day trend row of
// all-zero days (or zero-after-nonzero) for one source is the actionable signal
// an operator scans for. Read-only; no new tables or migrations.

export interface IngestTrendDay {
  /** ISO date (YYYY-MM-DD) in the DB's timezone — grouped by occurred_at::date. */
  day: string;
  /** Per-source signal counts for that day. Sources with zero are omitted. */
  bySource: Record<string, number>;
  /** Total signals that day across all sources (sum of bySource values). */
  total: number;
}

export interface IngestTrend {
  /** Last 7 days, oldest-first. Days with no signals still appear (total 0). */
  days: IngestTrendDay[];
  /** Union of sources seen across the window, for stable chart columns. */
  sources: string[];
}

export async function getDashboardIngestTrend(): Promise<IngestTrend> {
  const pool = getPool();
  if (!pool) {
    return { days: [], sources: [] };
  }

  try {
    // Group by occurred_at::date so a signal counts on the day the hiring event
    // happened (what the freshness gate uses), not when we ingested it. This keeps
    // the trend truthful: a backlog ingested today still lands on its real day.
    const result = await pool.query<{ day: string; source: string; count: string }>(`
      SELECT
        occurred_at::DATE::TEXT AS day,
        source,
        COUNT(*)::TEXT AS count
      FROM signals
      WHERE occurred_at >= NOW() - INTERVAL '7 days'
      GROUP BY 1, 2
      ORDER BY 1, 2
    `);

    // Build a dense 7-day window (oldest-first) so empty days render as zeros
    // instead of disappearing — a missing day is itself a signal of "source ran
    // and wrote nothing", which is exactly what we want visible.
    const today = new Date();
    const dayBuckets = new Map<string, IngestTrendDay>();
    for (let offset = 6; offset >= 0; offset -= 1) {
      const d = new Date(today.getTime() - offset * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      dayBuckets.set(key, { day: key, bySource: {}, total: 0 });
    }

    const sourceSet = new Set<string>();
    for (const row of result.rows) {
      const bucket = dayBuckets.get(row.day);
      // A signal older than 7 days (timezone edge) outside our window — skip.
      if (!bucket) continue;
      const count = parseInt(row.count, 10);
      bucket.bySource[row.source] = count;
      bucket.total += count;
      sourceSet.add(row.source);
    }

    return {
      days: [...dayBuckets.values()],
      sources: [...sourceSet].sort(),
    };
  } catch {
    return { days: [], sources: [] };
  }
}

// ─── Today's Radar — companies worth contacting now ─────────────

export interface TodayRadar {
  /** Top candidates across all active profiles, ranked by score. */
  topLeads: LeadItem[];
  /** Candidates awaiting analyst review (review_status = 'pending_review'). */
  pendingReview: number;
  /**
   * Resolved hiring mode per active client profile id — drives mode-aware
   * urgency framing on the dashboard radar cards (executive vs volume vs
   * specialist). 'auto' is resolved to a concrete mode via resolveHiringMode,
   * so the card never has to handle it.
   */
  hiringModeByProfileId: Record<string, 'specialist' | 'executive' | 'volume'>;
}

/**
 * Build the "Сегодняшний радар" block for the agency dashboard: the highest-score
 * leads across all active client profiles plus the count awaiting review.
 *
 * Resolves active profiles internally (the dashboard has no profileIds to hand),
 * then reuses the same data layer as /leads so ranking and review-count semantics
 * stay identical between the two surfaces. Returns empty/zero on any failure.
 *
 * Owner-scoped: only returns leads for profiles owned by `ownerId` (or pilot/anonymous
 * profiles with owner_id IS NULL).
 */
export async function getDashboardTodayRadar(
  ownerId: string | number,
  limit = 5
): Promise<TodayRadar> {
  try {
    const profiles = await listClientProfiles(ownerId);
    const activeProfiles = profiles.filter((p) => p.isActive);
    const profileIds = activeProfiles.map((p) => p.id);
    if (profileIds.length === 0) {
      return { topLeads: [], pendingReview: 0, hiringModeByProfileId: {} };
    }

    const [leadsResult, pendingReview] = await Promise.all([
      getLeadsForAllProfiles({ profileIds, ownerId, limit }),
      getPendingReviewCount({ profileIds, ownerId }),
    ]);

    const hiringModeByProfileId: Record<string, 'specialist' | 'executive' | 'volume'> = {};
    for (const p of activeProfiles) {
      hiringModeByProfileId[p.id] = resolveHiringMode(p);
    }

    return { topLeads: leadsResult.leads, pendingReview, hiringModeByProfileId };
  } catch {
    return { topLeads: [], pendingReview: 0, hiringModeByProfileId: {} };
  }
}

// ─── Operator: user management overview ──────────────────────────
// One row per registered user with their client profile, pilot entitlement, and
// payment status joined in — the surface an operator scans to track who signed
// up, who has an active pilot, who paid, and who has Telegram delivery wired.
// Read-only. owner_id links users→client_profiles (1:1 by the unique partial
// index; a NULL owner_id is the pre-multi-tenancy pilot-mode profile and still
// surfaces so the operator can see it).

export interface OperatorUserRow {
  id: string;
  email: string;
  fullName: string | null;
  telegramUsername: string | null;
  telegramChatId: string | null;
  createdAt: string;
  /** Client profile (null when the user has no profile yet). */
  profile: {
    id: string;
    agencyName: string;
    isActive: boolean;
    specialization: string | null;
    targetCity: string | null;
    deliveryEnabled: boolean | null;
    telegramChatId: string | null;
  } | null;
  /** Most recent / active pilot enrollment, if any. */
  pilot: {
    status: string;
    startsAt: string;
    endsAt: string | null;
  } | null;
  /** Whether the user has at least one PAID checkout order. */
  hasPaidOrder: boolean;
  /** Count of paid orders (for the "paid N×" signal). */
  paidOrderCount: number;
}

export async function getOperatorUsers(): Promise<OperatorUserRow[]> {
  const pool = getPool();
  if (!pool) return [];

  try {
    // LATERAL joins keep the per-user aggregates clean without GROUP BY fan-out:
    //   * profile  — the single client_profiles row owned by the user (NULL ok)
    //   * pilot    — the latest enrollment row (NULL when none)
    //   * paid     — count of paid orders; hasPaidOrder = count > 0
    // Ordered newest-first so a new signup is the top row.
    const result = await pool.query<{
      id: string;
      email: string;
      full_name: string | null;
      telegram_username: string | null;
      telegram_chat_id: string | null;
      created_at: string;
      profile_id: string | null;
      agency_name: string | null;
      is_active: boolean | null;
      specialization: string | null;
      target_city: string | null;
      delivery_enabled: boolean | null;
      profile_telegram_chat_id: string | null;
      pilot_status: string | null;
      pilot_starts_at: string | null;
      pilot_ends_at: string | null;
      paid_order_count: string;
    }>(`
      SELECT
        u.id::TEXT            AS id,
        u.email               AS email,
        u.full_name           AS full_name,
        u.telegram_username   AS telegram_username,
        u.telegram_chat_id::TEXT AS telegram_chat_id,
        u.created_at::TEXT    AS created_at,
        p.id::TEXT            AS profile_id,
        p.agency_name         AS agency_name,
        p.is_active           AS is_active,
        p.specialization      AS specialization,
        p.target_city         AS target_city,
        p.delivery_enabled    AS delivery_enabled,
        p.telegram_chat_id::TEXT AS profile_telegram_chat_id,
        pe.status::TEXT       AS pilot_status,
        pe.starts_at::TEXT    AS pilot_starts_at,
        pe.ends_at::TEXT      AS pilot_ends_at,
        COALESCE(po.paid_count, 0)::TEXT AS paid_order_count
      FROM users u
      LEFT JOIN LATERAL (
        SELECT * FROM client_profiles cp WHERE cp.owner_id = u.id LIMIT 1
      ) p ON true
      LEFT JOIN LATERAL (
        SELECT * FROM pilot_enrollments pe2
        WHERE pe2.user_id = u.id
        ORDER BY created_at DESC LIMIT 1
      ) pe ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::INT AS paid_count
        FROM checkout_orders co
        WHERE co.user_id = u.id AND co.status = 'paid'
      ) po ON true
      ORDER BY u.created_at DESC
    `);

    return result.rows.map((r) => ({
      id: r.id,
      email: r.email,
      fullName: r.full_name,
      telegramUsername: r.telegram_username,
      telegramChatId: r.telegram_chat_id,
      createdAt: r.created_at,
      profile: r.profile_id
        ? {
            id: r.profile_id,
            agencyName: r.agency_name ?? "",
            isActive: Boolean(r.is_active),
            specialization: r.specialization,
            targetCity: r.target_city,
            deliveryEnabled: r.delivery_enabled === null ? null : Boolean(r.delivery_enabled),
            telegramChatId: r.profile_telegram_chat_id,
          }
        : null,
      pilot: r.pilot_status
        ? { status: r.pilot_status, startsAt: r.pilot_starts_at ?? "", endsAt: r.pilot_ends_at }
        : null,
      hasPaidOrder: parseInt(r.paid_order_count, 10) > 0,
      paidOrderCount: parseInt(r.paid_order_count, 10),
    }));
  } catch {
    return [];
  }
}
