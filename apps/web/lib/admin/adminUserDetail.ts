import { getPool } from "../db-pool";
import { getEffectiveEntitlement, type EffectiveEntitlement } from "../entitlements";
import { listCheckoutOrdersForOwner } from "../paymentsRepo";
import type { CheckoutOrder } from "../paymentsTypes";

export type DiagnosticStatus = "PASS" | "WARNING" | "FAIL";

export type AdminUserDiagnostic = {
  key: string;
  label: string;
  status: DiagnosticStatus;
  reason: string;
};

type AdminUserDetailRow = {
  id: string;
  dataOwnerId: string;
  email: string;
  fullName: string | null;
  status: string;
  createdAt: string;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  activeSessionCount: number | string;
  workspaceId: string | null;
  workspaceName: string | null;
  workspaceStatus: string | null;
  workspaceRole: string | null;
  profileId: string | null;
  agencyName: string | null;
  profileActive: boolean | null;
  specialization: string | null;
  targetCity: string | null;
  roles: string[] | null;
  industries: unknown;
  companySizes: unknown;
  excludedIndustries: string[] | null;
  hiringIntentMin: number | string | null;
  signalFreshnessDays: number | string | null;
  minOpenRoles: number | string | null;
  dailyDigestLimit: number | string | null;
  deliveryEnabled: boolean | null;
  telegramChatId: string | null;
  emailDigestEnabled: boolean | null;
  digestEmailConfigured: boolean | null;
  webPushEnabled: boolean | null;
  activeWebPushCount: number | string;
  activeEndpointCount: number | string;
  lastDeliveryAt: string | null;
  lastDeliveryErrorAt: string | null;
  lastDeliveryErrorCode: string | null;
  matchingCompanyCount: number | string;
  currentOpportunityCount: number | string;
  lastRadarAt: string | null;
  lastDigestAt: string | null;
  lastDigestStatus: string | null;
  lastSignalAt: string | null;
};

export type AdminUserDetail = {
  dataOwnerId: string;
  account: {
    id: string;
    email: string;
    fullName: string | null;
    status: string;
    createdAt: string;
    emailVerifiedAt: string | null;
    lastLoginAt: string | null;
    activeSessionCount: number;
  };
  workspace: {
    id: string;
    name: string;
    status: string;
    role: string;
  } | null;
  profile: {
    id: string;
    agencyName: string;
    isActive: boolean;
    specialization: string | null;
    targetCity: string | null;
    roles: string[];
    industries: string[];
    companySizes: string[];
    excludedIndustries: string[];
    thresholds: {
      hiringIntentMin: number | null;
      signalFreshnessDays: number | null;
      minOpenRoles: number | null;
    };
    dailyDigestLimit: number;
  } | null;
  access: EffectiveEntitlement;
  payments: CheckoutOrder[];
  delivery: {
    enabled: boolean;
    telegramConfigured: boolean;
    emailEnabled: boolean;
    emailConfigured: boolean;
    webPushEnabled: boolean;
    activeWebPushCount: number;
    activeEndpointCount: number;
    lastSuccessAt: string | null;
    lastErrorAt: string | null;
    lastErrorCode: string | null;
  };
  radar: {
    matchingCompanyCount: number;
    currentOpportunityCount: number;
    lastRunAt: string | null;
    lastDigestAt: string | null;
    lastDigestStatus: string | null;
    lastSignalAt: string | null;
  };
  diagnostics: AdminUserDiagnostic[];
};

export async function getAdminUserDetail(userId: string): Promise<AdminUserDetail | null> {
  if (!/^\d+$/.test(userId) || userId === "0") return null;
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const result = await pool.query<AdminUserDetailRow>(ADMIN_USER_DETAIL_SQL, [userId]);
  if (result.rowCount !== 1) return null;

  const row = result.rows[0];
  const [access, payments] = await Promise.all([
    getEffectiveEntitlement(row.dataOwnerId),
    listCheckoutOrdersForOwner(row.dataOwnerId, 50),
  ]);
  const detail: Omit<AdminUserDetail, "diagnostics"> = {
    dataOwnerId: row.dataOwnerId,
    account: {
      id: row.id,
      email: row.email,
      fullName: row.fullName,
      status: row.status,
      createdAt: row.createdAt,
      emailVerifiedAt: row.emailVerifiedAt,
      lastLoginAt: row.lastLoginAt,
      activeSessionCount: toNumber(row.activeSessionCount),
    },
    workspace: row.workspaceId && row.workspaceName && row.workspaceStatus && row.workspaceRole
      ? { id: row.workspaceId, name: row.workspaceName, status: row.workspaceStatus, role: row.workspaceRole }
      : null,
    profile: row.profileId && row.agencyName
      ? {
          id: row.profileId,
          agencyName: row.agencyName,
          isActive: row.profileActive === true,
          specialization: row.specialization,
          targetCity: row.targetCity,
          roles: row.roles ?? [],
          industries: stringArray(row.industries),
          companySizes: stringArray(row.companySizes),
          excludedIndustries: row.excludedIndustries ?? [],
          thresholds: {
            hiringIntentMin: nullableNumber(row.hiringIntentMin),
            signalFreshnessDays: nullableNumber(row.signalFreshnessDays),
            minOpenRoles: nullableNumber(row.minOpenRoles),
          },
          dailyDigestLimit: toNumber(row.dailyDigestLimit) || 5,
        }
      : null,
    access,
    payments,
    delivery: {
      enabled: row.deliveryEnabled === true,
      telegramConfigured: Boolean(row.telegramChatId),
      emailEnabled: row.emailDigestEnabled === true,
      emailConfigured: row.digestEmailConfigured === true,
      webPushEnabled: row.webPushEnabled === true,
      activeWebPushCount: toNumber(row.activeWebPushCount),
      activeEndpointCount: toNumber(row.activeEndpointCount),
      lastSuccessAt: row.lastDeliveryAt,
      lastErrorAt: row.lastDeliveryErrorAt,
      lastErrorCode: row.lastDeliveryErrorCode,
    },
    radar: {
      matchingCompanyCount: toNumber(row.matchingCompanyCount),
      currentOpportunityCount: toNumber(row.currentOpportunityCount),
      lastRunAt: row.lastRadarAt,
      lastDigestAt: row.lastDigestAt,
      lastDigestStatus: row.lastDigestStatus,
      lastSignalAt: row.lastSignalAt,
    },
  };

  return { ...detail, diagnostics: buildAdminUserDiagnostics(detail) };
}

export function buildAdminUserDiagnostics(
  detail: Omit<AdminUserDetail, "diagnostics">,
  now = new Date(),
): AdminUserDiagnostic[] {
  const profile = detail.profile;
  const accessActive = detail.access.status === "active";
  const deliveryConfigured = detail.delivery.telegramConfigured
    || (detail.delivery.emailEnabled && detail.delivery.emailConfigured)
    || (detail.delivery.webPushEnabled && detail.delivery.activeWebPushCount > 0)
    || detail.delivery.activeEndpointCount > 0;
  const freshnessDays = profile?.thresholds.signalFreshnessDays ?? 14;
  const signalAgeMs = detail.radar.lastSignalAt
    ? now.getTime() - new Date(detail.radar.lastSignalAt).getTime()
    : Number.POSITIVE_INFINITY;
  const signalsFresh = signalAgeMs <= freshnessDays * 86_400_000;

  const diagnostics: AdminUserDiagnostic[] = [
    diagnostic("account", "Account", detail.account.status === "active", `Статус аккаунта: ${detail.account.status}`),
    diagnostic("workspace", "Workspace", detail.workspace?.status === "active", detail.workspace ? `Статус workspace: ${detail.workspace.status}` : "Workspace не найден"),
    diagnostic("profile", "Profile", Boolean(profile), profile ? `Профиль #${profile.id}` : "Профиль не создан"),
    diagnostic("entitlement", "Entitlement", accessActive, accessActive ? `Источник: ${detail.access.source}` : "Активного доступа нет"),
    diagnostic("radar", "Radar enabled", profile?.isActive === true, profile ? (profile.isActive ? "Профиль активен" : "Профиль приостановлен") : "Профиль не создан"),
    diagnostic("delivery", "Delivery enabled", detail.delivery.enabled, detail.delivery.enabled ? "Главный переключатель включён" : "Доставка выключена"),
    diagnostic("channel", "Channel configured", deliveryConfigured, deliveryConfigured ? "Есть активный канал" : "Ни один канал не настроен"),
    diagnostic("signals", "Fresh signals", signalsFresh, detail.radar.lastSignalAt ? `Последний сигнал: ${detail.radar.lastSignalAt}` : "Свежих сигналов нет", true),
  ];
  const requiredFeatures = ["digest", "delivery"] as const;
  const missingFeatures = detail.access.status === "active"
    ? requiredFeatures.filter((feature) => !(detail.access.features as readonly string[]).includes(feature))
    : [...requiredFeatures];
  const eligible = diagnostics.every((item) => item.status === "PASS")
    && detail.access.status === "active"
    && missingFeatures.length === 0;
  diagnostics.push(diagnostic(
    "digest",
    "Digest eligible",
    eligible,
    eligible
      ? "Все обязательные условия выполнены"
      : missingFeatures.length > 0
        ? `Нет возможностей: ${missingFeatures.join(", ")}`
        : "Одна или несколько обязательных проверок не пройдены",
  ));
  return diagnostics;
}

function diagnostic(key: string, label: string, pass: boolean, reason: string, warningWhenFail = false): AdminUserDiagnostic {
  return { key, label, status: pass ? "PASS" : warningWhenFail ? "WARNING" : "FAIL", reason };
}

function toNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: number | string | null): number | null {
  return value === null ? null : toNumber(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

const ADMIN_USER_DETAIL_SQL = `
  SELECT
    account.id::TEXT AS id,
    COALESCE(workspace."dataOwnerId", account.id)::TEXT AS "dataOwnerId",
    account.email,
    account.full_name AS "fullName",
    account.status,
    account.created_at::TEXT AS "createdAt",
    account.email_verified_at::TEXT AS "emailVerifiedAt",
    sessions."lastLoginAt",
    COALESCE(sessions."activeSessionCount", 0) AS "activeSessionCount",
    workspace.id::TEXT AS "workspaceId",
    workspace.name AS "workspaceName",
    workspace.status AS "workspaceStatus",
    workspace.role AS "workspaceRole",
    profile.id::TEXT AS "profileId",
    profile.agency_name AS "agencyName",
    profile.is_active AS "profileActive",
    profile.specialization,
    profile.target_city AS "targetCity",
    profile.roles,
    profile.industries,
    profile.company_sizes AS "companySizes",
    profile.excluded_industries AS "excludedIndustries",
    profile.hiring_intent_min AS "hiringIntentMin",
    profile.signal_freshness_days AS "signalFreshnessDays",
    profile.min_open_roles AS "minOpenRoles",
    profile.daily_digest_limit AS "dailyDigestLimit",
    profile.delivery_enabled AS "deliveryEnabled",
    profile.telegram_chat_id::TEXT AS "telegramChatId",
    profile.email_digest_enabled AS "emailDigestEnabled",
    (profile.digest_email IS NOT NULL) AS "digestEmailConfigured",
    profile.web_push_enabled AS "webPushEnabled",
    COALESCE(delivery."activeWebPushCount", 0) AS "activeWebPushCount",
    COALESCE(delivery."activeEndpointCount", 0) AS "activeEndpointCount",
    delivery."lastDeliveryAt",
    delivery."lastDeliveryErrorAt",
    delivery."lastDeliveryErrorCode",
    COALESCE(radar."matchingCompanyCount", 0) AS "matchingCompanyCount",
    COALESCE(radar."currentOpportunityCount", 0) AS "currentOpportunityCount",
    radar."lastRadarAt",
    radar."lastDigestAt",
    radar."lastDigestStatus",
    radar."lastSignalAt"
  FROM users AS account
  LEFT JOIN LATERAL (
    SELECT
      MAX(COALESCE(last_authenticated_at, created_at))::TEXT AS "lastLoginAt",
      COUNT(*) FILTER (WHERE revoked_at IS NULL AND idle_expires_at > NOW() AND absolute_expires_at > NOW()) AS "activeSessionCount"
    FROM auth_sessions
    WHERE user_id = account.id
  ) AS sessions ON TRUE
  LEFT JOIN LATERAL (
    SELECT ws.id, ws.name, ws.status, member.role, ws.bootstrap_user_id AS "dataOwnerId"
    FROM workspace_members AS member
    JOIN workspaces AS ws ON ws.id = member.workspace_id
    WHERE member.user_id = account.id AND member.status = 'active' AND ws.status = 'active'
    ORDER BY (
      SELECT MAX(last_seen_at)
      FROM auth_sessions
      WHERE user_id = account.id
        AND workspace_id = ws.id
        AND revoked_at IS NULL
        AND idle_expires_at > NOW()
        AND absolute_expires_at > NOW()
    ) DESC NULLS LAST, (member.role = 'owner') DESC, ws.id
    LIMIT 1
  ) AS workspace ON TRUE
  LEFT JOIN LATERAL (
    SELECT * FROM client_profiles
    WHERE owner_id = COALESCE(workspace."dataOwnerId", account.id)
    ORDER BY is_active DESC, updated_at DESC, id DESC
    LIMIT 1
  ) AS profile ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      (SELECT COUNT(*) FROM web_push_subscriptions WHERE client_profile_id = profile.id AND revoked_at IS NULL) AS "activeWebPushCount",
      (SELECT COUNT(*) FROM notification_endpoints WHERE client_profile_id = profile.id AND status = 'active') AS "activeEndpointCount",
      GREATEST(
        (SELECT MAX(delivered_at) FROM lead_channel_deliveries WHERE client_profile_id = profile.id),
        (SELECT MAX(last_delivery_at) FROM notification_endpoints WHERE client_profile_id = profile.id)
      )::TEXT AS "lastDeliveryAt",
      endpoint.last_error_at::TEXT AS "lastDeliveryErrorAt",
      endpoint.last_error_code AS "lastDeliveryErrorCode"
    FROM (SELECT 1) AS seed
    LEFT JOIN LATERAL (
      SELECT last_error_at, last_error_code
      FROM notification_endpoints
      WHERE client_profile_id = profile.id AND last_error_at IS NOT NULL
      ORDER BY last_error_at DESC
      LIMIT 1
    ) AS endpoint ON TRUE
  ) AS delivery ON profile.id IS NOT NULL
  LEFT JOIN LATERAL (
    SELECT
      COUNT(DISTINCT opportunity.organization_id) AS "matchingCompanyCount",
      COUNT(DISTINCT opportunity.id) FILTER (WHERE opportunity.status IN ('new', 'review', 'accepted', 'snoozed', 'contacted')) AS "currentOpportunityCount",
      MAX(opportunity.updated_at)::TEXT AS "lastRadarAt",
      MAX(latest_digest.created_at)::TEXT AS "lastDigestAt",
      MAX(latest_digest.status) AS "lastDigestStatus",
      MAX(signal.occurred_at)::TEXT AS "lastSignalAt"
    FROM opportunities AS opportunity
    LEFT JOIN signals AS signal ON signal.org_id = opportunity.organization_id
    LEFT JOIN LATERAL (
      SELECT created_at, status::TEXT AS status
      FROM digest_runs
      WHERE client_profile_id = profile.id
      ORDER BY created_at DESC
      LIMIT 1
    ) AS latest_digest ON TRUE
    WHERE opportunity.owner_id = COALESCE(workspace."dataOwnerId", account.id)
  ) AS radar ON TRUE
  WHERE account.id = $1
  LIMIT 1
`;
