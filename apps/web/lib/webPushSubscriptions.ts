import { getPool } from "./db-pool";
import { isWebPushConfigured } from "./webPush";

export type ClientProfileWebPushStatus = {
  configured: boolean;
  activeSubscriptionCount: number;
  stateLabel: string;
  helperLabel: string;
};

function describeStatus(input: {
  configured: boolean;
  activeSubscriptionCount: number;
}): ClientProfileWebPushStatus {
  if (!input.configured) {
    return {
      configured: false,
      activeSubscriptionCount: input.activeSubscriptionCount,
      stateLabel: "не настроен",
      helperLabel: "Web push ещё не настроен на сервере."
    };
  }

  if (input.activeSubscriptionCount > 0) {
    return {
      configured: true,
      activeSubscriptionCount: input.activeSubscriptionCount,
      stateLabel: "подключён",
      helperLabel:
        input.activeSubscriptionCount === 1
          ? "Один браузер получает мгновенные сигналы."
          : `${input.activeSubscriptionCount} браузера получают мгновенные сигналы.`
    };
  }

  return {
    configured: true,
    activeSubscriptionCount: 0,
    stateLabel: "не подключён",
    helperLabel: "Подключите браузер, чтобы получать мгновенные сигналы о сильных лидах."
  };
}

/**
 * Returns per-profile web-push status (configured + active subscription count)
 * in a single query. Used by onboarding/settings to render the opt-in card.
 */
export async function getClientProfileWebPushStatuses(input: {
  clientProfileIds: readonly string[];
}): Promise<Map<string, ClientProfileWebPushStatus>> {
  const result = new Map<string, ClientProfileWebPushStatus>();
  const configured = isWebPushConfigured();

  // Seed every requested profile so callers always get a complete map.
  for (const clientProfileId of input.clientProfileIds) {
    result.set(clientProfileId, describeStatus({ configured, activeSubscriptionCount: 0 }));
  }

  const pool = getPool();
  if (!pool || input.clientProfileIds.length === 0) {
    return result;
  }

  const counts = await pool.query<{ clientProfileId: string; count: string }>(
    `
    SELECT client_profile_id::TEXT AS "clientProfileId", COUNT(*)::TEXT AS count
    FROM web_push_subscriptions
    WHERE client_profile_id = ANY($1::bigint[]) AND revoked_at IS NULL
    GROUP BY client_profile_id
    `,
    [input.clientProfileIds]
  );

  for (const row of counts.rows) {
    result.set(
      row.clientProfileId,
      describeStatus({ configured, activeSubscriptionCount: Number(row.count) })
    );
  }

  return result;
}
