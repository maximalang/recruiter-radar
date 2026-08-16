import { shouldDeliverOnRun } from '@/lib/delivery/nextDeliveryHint'
import { getEffectiveEntitlements } from '@/lib/entitlements'
import { getPool } from '@/lib/db-pool'

export interface DailyRadarProfileCandidate {
  id: string
  ownerId: string | null
  workspaceId: string | null
  isActive: boolean
  deliveryEnabled: boolean
  deliveryFrequency: string
  hasConfiguredChannel: boolean
}

export type DailyRadarProfileExclusionReason =
  | 'profile_paused'
  | 'entitlement_inactive'
  | 'delivery_disabled'
  | 'frequency_mismatch'
  | 'delivery_window_mismatch'
  | 'configuration_incomplete'
  | 'no_configured_channel'
  | 'explicit_exclusion'

export interface DailyRadarProfileEligibilitySummary {
  total: number
  active: number
  eligible: number
  excluded: Record<DailyRadarProfileExclusionReason, number>
}

const emptyExclusions = (): DailyRadarProfileEligibilitySummary['excluded'] => ({
  profile_paused: 0,
  entitlement_inactive: 0,
  delivery_disabled: 0,
  frequency_mismatch: 0,
  delivery_window_mismatch: 0,
  configuration_incomplete: 0,
  no_configured_channel: 0,
  explicit_exclusion: 0,
})

export function classifyDailyRadarProfileEligibility(
  profiles: readonly DailyRadarProfileCandidate[],
  options: {
    now: Date
    excludedWorkspaceId: string | null
    entitledProfileIds: ReadonlySet<string>
  },
): { eligible: DailyRadarProfileCandidate[]; summary: DailyRadarProfileEligibilitySummary } {
  const excluded = emptyExclusions()
  const eligible: DailyRadarProfileCandidate[] = []

  for (const profile of profiles) {
    let reason: DailyRadarProfileExclusionReason | null = null
    if (!profile.isActive) reason = 'profile_paused'
    else if (options.excludedWorkspaceId && profile.workspaceId === options.excludedWorkspaceId) reason = 'explicit_exclusion'
    else if (!profile.ownerId || !profile.workspaceId) reason = 'configuration_incomplete'
    else if (!options.entitledProfileIds.has(profile.id)) reason = 'entitlement_inactive'
    else if (!profile.deliveryEnabled) reason = 'delivery_disabled'
    else if (!profile.hasConfiguredChannel) reason = 'no_configured_channel'
    else if (!shouldDeliverOnRun(profile.deliveryFrequency === 'weekly' ? 'weekly' : 'daily', options.now)) reason = 'frequency_mismatch'

    if (reason) excluded[reason] += 1
    else eligible.push(profile)
  }

  return {
    eligible,
    summary: {
      total: profiles.length,
      active: profiles.filter((profile) => profile.isActive).length,
      eligible: eligible.length,
      excluded,
    },
  }
}

export async function loadDailyRadarProfileEligibility(options: {
  now: Date
  excludedWorkspaceId: string | null
}): Promise<{ eligible: DailyRadarProfileCandidate[]; summary: DailyRadarProfileEligibilitySummary }> {
  const pool = getPool()
  if (!pool) throw new Error('DATABASE_URL is not set.')

  const result = await pool.query<DailyRadarProfileCandidate>(`
    SELECT
      cp.id::TEXT AS id,
      cp.owner_id::TEXT AS "ownerId",
      cp.workspace_id::TEXT AS "workspaceId",
      cp.is_active AS "isActive",
      cp.delivery_enabled AS "deliveryEnabled",
      cp.delivery_frequency AS "deliveryFrequency",
      (
        cp.telegram_chat_id IS NOT NULL
        OR (cp.email_digest_enabled = TRUE AND cp.digest_email IS NOT NULL)
        OR (
          cp.web_push_enabled = TRUE
          AND EXISTS (
            SELECT 1 FROM web_push_subscriptions wps
            WHERE wps.client_profile_id = cp.id AND wps.revoked_at IS NULL
          )
        )
        OR EXISTS (
          SELECT 1
          FROM notification_routes nr
          JOIN notification_endpoints ne ON ne.id = nr.endpoint_id
          JOIN notification_provider_accounts npa ON npa.id = ne.provider_account_id
          WHERE nr.client_profile_id = cp.id
            AND nr.event_kind = 'daily_digest'
            AND nr.status = 'active'
            AND ne.status = 'active'
            AND ne.destination_id IS NOT NULL
            AND npa.status IN ('active', 'degraded')
        )
      ) AS "hasConfiguredChannel"
    FROM client_profiles cp
    ORDER BY cp.id
  `)

  const profilesByWorkspace = new Map<string, DailyRadarProfileCandidate[]>()
  for (const profile of result.rows) {
    if (!profile.ownerId || !profile.workspaceId) continue
    const workspaceProfiles = profilesByWorkspace.get(profile.workspaceId) ?? []
    workspaceProfiles.push(profile)
    profilesByWorkspace.set(profile.workspaceId, workspaceProfiles)
  }

  const entitledProfileIds = new Set<string>()
  for (const [workspaceId, profiles] of profilesByWorkspace) {
    const entitlements = await getEffectiveEntitlements(
      profiles.map((profile) => profile.ownerId as string),
      { workspaceId, now: options.now },
    )
    for (const profile of profiles) {
      const entitlement = entitlements.get(profile.ownerId as string)
      if (
        entitlement?.status === 'active'
        && entitlement.features.includes('digest')
        && entitlement.features.includes('delivery')
      ) entitledProfileIds.add(profile.id)
    }
  }

  return classifyDailyRadarProfileEligibility(result.rows, {
    ...options,
    entitledProfileIds,
  })
}
