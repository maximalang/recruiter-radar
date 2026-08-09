import { getPool } from "./db-pool";

export const ENTITLEMENT_FEATURES = [
  "dashboard",
  "api",
  "digest",
  "delivery",
] as const;

export type EntitlementFeature = (typeof ENTITLEMENT_FEATURES)[number];
export type EntitlementSource =
  | "subscription"
  | "payment"
  | "admin"
  | "trial"
  | "pilot"
  | "promo";

export type EffectiveEntitlement =
  | {
    status: "active";
    source: EntitlementSource;
    plan: string;
    startsAt: string;
    expiresAt: string | null;
    features: EntitlementFeature[];
    activeSources: EntitlementSource[];
  }
  | {
    status: "inactive";
    source: null;
    plan: null;
    startsAt: null;
    expiresAt: null;
    features: [];
    activeSources: [];
    reason: "no_active_entitlement";
  };

type EntitlementRow = {
  userId: string;
  source: EntitlementSource;
  plan: string;
  startsAt: Date | string;
  expiresAt: Date | string | null;
  features: string[];
  activeSources: EntitlementSource[];
};

export type GrantableEntitlementSource =
  | "admin"
  | "trial"
  | "pilot"
  | "promo";

export type EntitlementMutationResult = {
  changed: boolean;
  grantId: string | null;
};

export async function getEffectiveEntitlement(
  userId: string | number,
  options: { workspaceId: string | number; now?: Date },
): Promise<EffectiveEntitlement> {
  const normalizedUserId = normalizeUserId(userId);
  const entitlements = await getEffectiveEntitlements([normalizedUserId], options);
  return entitlements.get(normalizedUserId) ?? inactiveEntitlement();
}

/** Resolves access for an operator list without duplicating entitlement SQL. */
export async function getEffectiveEntitlements(
  userIds: ReadonlyArray<string | number>,
  options: { workspaceId: string | number; now?: Date },
): Promise<Map<string, EffectiveEntitlement>> {
  const normalizedUserIds = [...new Set(userIds.map(normalizeUserId))];
  const entitlements = new Map<string, EffectiveEntitlement>(
    normalizedUserIds.map((userId) => [userId, inactiveEntitlement()]),
  );
  if (normalizedUserIds.length === 0) return entitlements;

  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const now = options.now ?? null;
  const workspaceId = normalizeWorkspaceId(options.workspaceId);
  const result = await pool.query<EntitlementRow>(
    `WITH entitlement_clock AS (
       SELECT COALESCE($2::TIMESTAMPTZ, CURRENT_TIMESTAMP) AS at
     ),
     active_account AS (
       SELECT id, id::TEXT AS "userId"
       FROM users
       WHERE id = ANY($1::BIGINT[])
         AND status = 'active'
     ),
     candidates AS (
       SELECT
         account."userId",
         CASE
           WHEN subscription.status = 'trial' THEN 'trial'
           ELSE 'subscription'
         END::TEXT AS source,
         subscription.plan_code AS plan,
         subscription.started_at AS "startsAt",
         subscription.current_period_end AS "expiresAt",
         ARRAY['dashboard', 'api', 'digest', 'delivery']::TEXT[] AS features,
         40 AS priority
       FROM subscriptions AS subscription
       JOIN active_account AS account ON account.id = subscription.user_id
       WHERE subscription.status IN ('trial', 'active', 'past_due')
         AND subscription.workspace_id = $3::BIGINT
         AND subscription.started_at <= (SELECT at FROM entitlement_clock)
         AND (
           subscription.current_period_end IS NULL
           OR subscription.current_period_end > (SELECT at FROM entitlement_clock)
         )

       UNION ALL

       SELECT
         account."userId",
         'payment'::TEXT AS source,
         entitlement.plan_code AS plan,
         entitlement.starts_at AS "startsAt",
         entitlement.ends_at AS "expiresAt",
         ARRAY['dashboard', 'api', 'digest', 'delivery']::TEXT[] AS features,
         60 AS priority
       FROM checkout_order_entitlements AS entitlement
       JOIN active_account AS account ON account.id = entitlement.user_id
       JOIN checkout_orders AS checkout
         ON checkout.id = entitlement.order_id
        AND checkout.status = 'paid'
       WHERE entitlement.revoked_at IS NULL
         AND entitlement.workspace_id = $3::BIGINT
         AND entitlement.starts_at <= (SELECT at FROM entitlement_clock)
         AND entitlement.ends_at > (SELECT at FROM entitlement_clock)

       UNION ALL

       SELECT
         account."userId",
         CASE
           WHEN pilot.activated_by = 'admin' THEN 'admin'
           WHEN pilot.activated_by IN ('payment_webhook', 'refund_reconciliation')
             THEN 'payment'
           WHEN pilot.activated_by = 'trial' THEN 'trial'
           WHEN pilot.activated_by = 'promo' THEN 'promo'
           ELSE 'pilot'
         END::TEXT AS source,
         CASE
           WHEN pilot.activated_by = 'admin' THEN 'admin'
           WHEN pilot.activated_by = 'trial' THEN 'trial'
           WHEN pilot.activated_by = 'promo' THEN 'promo'
           ELSE 'pilot'
         END::TEXT AS plan,
         pilot.starts_at AS "startsAt",
         pilot.ends_at AS "expiresAt",
         ARRAY['dashboard', 'api', 'digest', 'delivery']::TEXT[] AS features,
         CASE
           WHEN pilot.activated_by = 'admin' THEN 70
           WHEN pilot.activated_by IN ('payment_webhook', 'refund_reconciliation')
             THEN 50
           ELSE 30
         END AS priority
       FROM pilot_enrollments AS pilot
       JOIN active_account AS account ON account.id = pilot.user_id
       WHERE pilot.status = 'active'
         AND pilot.workspace_id = $3::BIGINT
         AND pilot.activated_by <> 'admin'
         AND pilot.starts_at <= (SELECT at FROM entitlement_clock)
         AND (
           pilot.ends_at IS NULL
           OR pilot.ends_at > (SELECT at FROM entitlement_clock)
         )

       UNION ALL

       SELECT
         account."userId",
         entitlement_grant.source,
         entitlement_grant.plan_code AS plan,
         entitlement_grant.starts_at AS "startsAt",
         entitlement_grant.ends_at AS "expiresAt",
         entitlement_grant.features,
         80 AS priority
       FROM entitlement_grants AS entitlement_grant
       JOIN active_account AS account ON account.id = entitlement_grant.user_id
       WHERE entitlement_grant.status = 'active'
         AND entitlement_grant.workspace_id = $3::BIGINT
         AND entitlement_grant.revoked_at IS NULL
         AND entitlement_grant.starts_at <= (SELECT at FROM entitlement_clock)
         AND (
           entitlement_grant.ends_at IS NULL
           OR entitlement_grant.ends_at > (SELECT at FROM entitlement_clock)
         )
     ),
     ranked AS (
       SELECT
         candidates.*,
         ROW_NUMBER() OVER (
           PARTITION BY "userId"
           ORDER BY "expiresAt" DESC NULLS FIRST, priority DESC, "startsAt" DESC
         ) AS rank
       FROM candidates
     ),
     effective_features AS (
       SELECT
         candidates."userId",
         ARRAY_AGG(DISTINCT feature ORDER BY feature) AS features,
         ARRAY_AGG(DISTINCT source ORDER BY source) AS "activeSources"
       FROM candidates
       CROSS JOIN LATERAL UNNEST(candidates.features) AS feature
       GROUP BY candidates."userId"
     )
     SELECT
       ranked."userId",
       ranked.source,
       ranked.plan,
       ranked."startsAt",
       ranked."expiresAt",
       effective_features.features,
       effective_features."activeSources"
     FROM ranked
     JOIN effective_features USING ("userId")
     WHERE ranked.rank = 1`,
    [normalizedUserIds, now, workspaceId],
  );

  for (const row of result.rows) {
    entitlements.set(row.userId, {
      status: "active",
      source: row.source,
      plan: row.plan,
      startsAt: toIsoString(row.startsAt),
      expiresAt: row.expiresAt === null ? null : toIsoString(row.expiresAt),
      features: normalizeFeatures(row.features),
      activeSources: row.activeSources,
    });
  }
  return entitlements;
}

export async function grantEntitlement(input: {
  userId: string | number;
  workspaceId: string | number;
  source: GrantableEntitlementSource;
  plan: string;
  durationDays: number;
  features?: EntitlementFeature[];
}): Promise<EntitlementMutationResult> {
  const userId = normalizeUserId(input.userId);
  const workspaceId = normalizeWorkspaceId(input.workspaceId);
  const source = normalizeGrantSource(input.source);
  const plan = normalizePlan(input.plan);
  const durationDays = normalizeDurationDays(input.durationDays);
  const features = normalizeRequestedFeatures(input.features);
  const pool = requirePool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const account = await client.query(
      `SELECT id FROM users
       WHERE id = $1 AND status = 'active'
       FOR UPDATE`,
      [userId],
    );
    if (account.rowCount !== 1) {
      await client.query("ROLLBACK");
      return { changed: false, grantId: null };
    }
    await client.query(
      `UPDATE entitlement_grants
       SET status = 'revoked',
           revoked_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1
         AND workspace_id = auth_workspace_resolve_user($1, $3::BIGINT)
         AND source = $2
         AND status = 'active'
         AND revoked_at IS NULL
         AND ends_at IS NOT NULL
         AND ends_at <= CURRENT_TIMESTAMP`,
      [userId, source, workspaceId],
    );
    const result = await client.query<{ id: string }>(
      `INSERT INTO entitlement_grants (
       user_id, workspace_id, entitlement_owner_id,
       source, plan_code, features, starts_at, ends_at
     )
     VALUES ($1, auth_workspace_resolve_user($1, $6::BIGINT), $1,
       $2, $3, $5::TEXT[], CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP + ($4 * INTERVAL '1 day'))
     ON CONFLICT (workspace_id, entitlement_owner_id, source) WHERE status = 'active'
     DO UPDATE SET
       plan_code = EXCLUDED.plan_code,
       features = EXCLUDED.features,
       starts_at = CASE
         WHEN entitlement_grants.ends_at IS NOT NULL
           AND entitlement_grants.ends_at <= CURRENT_TIMESTAMP
         THEN CURRENT_TIMESTAMP
         ELSE entitlement_grants.starts_at
       END,
       ends_at = CASE
         WHEN entitlement_grants.ends_at IS NULL THEN NULL
         ELSE GREATEST(entitlement_grants.ends_at, EXCLUDED.ends_at)
       END,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id::TEXT AS id`,
      [userId, source, plan, durationDays, features, workspaceId],
    );
    await client.query("COMMIT");
    return {
      changed: result.rowCount === 1,
      grantId: result.rows[0]?.id ?? null,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Issues an auditable grant with an exact operator-selected expiry. */
export async function grantEntitlementUntil(input: {
  userId: string | number;
  workspaceId: string | number;
  source: GrantableEntitlementSource;
  plan: string;
  expiresAt: Date;
  features?: EntitlementFeature[];
}): Promise<EntitlementMutationResult> {
  const userId = normalizeUserId(input.userId);
  const workspaceId = normalizeWorkspaceId(input.workspaceId);
  const source = normalizeGrantSource(input.source);
  const plan = normalizePlan(input.plan);
  const features = normalizeRequestedFeatures(input.features);
  const expiresAt = input.expiresAt;
  const now = Date.now();
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now || expiresAt.getTime() > now + 3650 * 86_400_000) {
    throw new Error("Entitlement expiry must be within the next 3650 days.");
  }
  const pool = requirePool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const account = await client.query(
      `SELECT id FROM users WHERE id = $1 AND status = 'active' FOR UPDATE`,
      [userId],
    );
    if (account.rowCount !== 1) {
      await client.query("ROLLBACK");
      return { changed: false, grantId: null };
    }
    await client.query(
      `UPDATE entitlement_grants
       SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1
         AND workspace_id = auth_workspace_resolve_user($1, $3::BIGINT)
         AND source = $2 AND status = 'active'
         AND revoked_at IS NULL AND ends_at IS NOT NULL AND ends_at <= CURRENT_TIMESTAMP`,
      [userId, source, workspaceId],
    );
    const result = await client.query<{ id: string }>(
      `INSERT INTO entitlement_grants (
         user_id, workspace_id, entitlement_owner_id,
         source, plan_code, features, starts_at, ends_at
       ) VALUES ($1, auth_workspace_resolve_user($1, $6::BIGINT), $1,
         $2, $3, $5::TEXT[], CURRENT_TIMESTAMP, $4::TIMESTAMPTZ)
       ON CONFLICT (workspace_id, entitlement_owner_id, source) WHERE status = 'active'
       DO UPDATE SET
         plan_code = EXCLUDED.plan_code,
         features = EXCLUDED.features,
         ends_at = EXCLUDED.ends_at,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id::TEXT AS id`,
      [userId, source, plan, expiresAt.toISOString(), features, workspaceId],
    );
    await client.query("COMMIT");
    return { changed: result.rowCount === 1, grantId: result.rows[0]?.id ?? null };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeEntitlement(input: {
  userId: string | number;
  workspaceId: string | number;
  source: GrantableEntitlementSource;
}): Promise<{ changed: boolean; count: number }> {
  const userId = normalizeUserId(input.userId);
  const workspaceId = normalizeWorkspaceId(input.workspaceId);
  const source = normalizeGrantSource(input.source);
  const pool = requirePool();
  const result = await pool.query(
    `UPDATE entitlement_grants
     SET status = 'revoked',
         revoked_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $1
       AND workspace_id = auth_workspace_resolve_user($1, $3::BIGINT)
       AND source = $2
       AND status = 'active'
       AND revoked_at IS NULL`,
    [userId, source, workspaceId],
  );
  const count = result.rowCount ?? 0;
  return { changed: count > 0, count };
}

export async function extendEntitlement(input: {
  userId: string | number;
  workspaceId: string | number;
  source: GrantableEntitlementSource;
  durationDays: number;
}): Promise<EntitlementMutationResult> {
  const userId = normalizeUserId(input.userId);
  const workspaceId = normalizeWorkspaceId(input.workspaceId);
  const source = normalizeGrantSource(input.source);
  const durationDays = normalizeDurationDays(input.durationDays);
  const pool = requirePool();
  const result = await pool.query<{ id: string }>(
    `WITH selected AS (
       SELECT id
       FROM entitlement_grants
       WHERE user_id = $1
         AND workspace_id = auth_workspace_resolve_user($1, $4::BIGINT)
         AND source = $2
         AND status = 'active'
         AND revoked_at IS NULL
       ORDER BY ends_at DESC, id DESC
       LIMIT 1
       FOR UPDATE
     )
     UPDATE entitlement_grants AS entitlement_grant
     SET ends_at = CASE
           WHEN entitlement_grant.ends_at IS NULL THEN NULL
           ELSE GREATEST(entitlement_grant.ends_at, CURRENT_TIMESTAMP)
             + ($3 * INTERVAL '1 day')
         END,
         updated_at = CURRENT_TIMESTAMP
     FROM selected
     WHERE entitlement_grant.id = selected.id
     RETURNING entitlement_grant.id::TEXT AS id`,
    [userId, source, durationDays, workspaceId],
  );
  return {
    changed: result.rowCount === 1,
    grantId: result.rows[0]?.id ?? null,
  };
}

export async function hasFeatureAccess(
  userId: string | number,
  feature: EntitlementFeature,
  options: { workspaceId: string | number },
): Promise<boolean> {
  const entitlement = await getEffectiveEntitlement(userId, options);
  return entitlement.status === "active"
    && entitlement.features.includes(feature);
}

function toIsoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid entitlement timestamp.");
  }
  return date.toISOString();
}

function inactiveEntitlement(): EffectiveEntitlement {
  return {
    status: "inactive",
    source: null,
    plan: null,
    startsAt: null,
    expiresAt: null,
    features: [],
    activeSources: [],
    reason: "no_active_entitlement",
  };
}

function requirePool() {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");
  return pool;
}

function normalizeUserId(userId: string | number): string {
  const normalized = String(userId);
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error("Invalid entitlement user id.");
  }
  return normalized;
}

function normalizeWorkspaceId(workspaceId: string | number): string {
  const normalized = String(workspaceId);
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error("Invalid entitlement workspace id.");
  }
  return normalized;
}

function normalizeGrantSource(source: string): GrantableEntitlementSource {
  if (!(["admin", "trial", "pilot", "promo"] as const).includes(
    source as GrantableEntitlementSource,
  )) {
    throw new Error("Invalid entitlement source.");
  }
  return source as GrantableEntitlementSource;
}

function normalizePlan(plan: string): string {
  const normalized = plan.trim();
  if (!normalized || normalized.length > 80) {
    throw new Error("Invalid entitlement plan.");
  }
  return normalized;
}

function normalizeDurationDays(durationDays: number): number {
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650) {
    throw new Error("Invalid entitlement duration.");
  }
  return durationDays;
}

function normalizeRequestedFeatures(
  features: EntitlementFeature[] | undefined,
): EntitlementFeature[] {
  const requested = features ?? [...ENTITLEMENT_FEATURES];
  const normalized = [...new Set(requested)];
  if (
    normalized.length === 0
    || normalized.some((feature) => !ENTITLEMENT_FEATURES.includes(feature))
  ) {
    throw new Error("Invalid entitlement features.");
  }
  return normalized;
}

function normalizeFeatures(features: string[]): EntitlementFeature[] {
  return features.filter(
    (feature): feature is EntitlementFeature => (
      ENTITLEMENT_FEATURES.includes(feature as EntitlementFeature)
    ),
  );
}
