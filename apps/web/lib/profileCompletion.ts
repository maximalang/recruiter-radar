/**
 * Profile-completion model for the /settings/profile page.
 *
 * A "complete" profile is the UX goal — the more filter groups an agency fills,
 * the sharper its radar. This computes a simple, honest completion signal: which
 * of the key targeting groups are filled, and a 0..1 ratio for the progress bar.
 *
 * Pure + deterministic (no DB): takes a ClientProfile, returns the breakdown so
 * the page can render a progress indicator and nudge toward the empty groups.
 */

import type { ClientProfile } from "./clientProfiles";
import type { DeliveryPreferences } from "./deliveryPreferences";

export interface ProfileCompletionGroup {
  key: string;
  /** Russian label for the group, shown in the checklist. */
  label: string;
  filled: boolean;
}

export interface ProfileCompletion {
  groups: ProfileCompletionGroup[];
  filledCount: number;
  totalCount: number;
  /** 0..1 — filledCount / totalCount, for the progress bar width. */
  ratio: number;
  /** True once every key group is filled. */
  isComplete: boolean;
}

/**
 * The key targeting groups that make a profile useful. Deliberately the
 * decision-driving filters (roles, industries, region, size, intent threshold) —
 * not every field — so the bar reflects targeting quality, not form tedium.
 *
 * When `deliveryPrefs` is supplied, a "configured delivery" milestone is
 * appended: delivery is considered configured when the master toggle is on AND
 * at least one channel is reachable (Telegram connected, or email digest
 * enabled with an address, or web-push on).
 */
export function computeProfileCompletion(
  profile: ClientProfile,
  deliveryPrefs?: DeliveryPreferences | null,
): ProfileCompletion {
  const groups: ProfileCompletionGroup[] = [
    { key: "roles", label: "Роли, которые вы закрываете", filled: profile.roles.length > 0 },
    { key: "industries", label: "Отрасли клиентов", filled: profile.industries.length > 0 },
    {
      key: "region",
      label: "Регион работы",
      filled: Boolean(profile.targetCity && profile.targetCity.trim()) || profile.remoteFriendly,
    },
    { key: "companySizes", label: "Размер компаний", filled: profile.companySizes.length > 0 },
    {
      key: "intent",
      label: "Порог силы сигнала",
      filled: profile.hiringIntentMin != null,
    },
  ];

  if (deliveryPrefs) {
    const channelReady =
      deliveryPrefs.deliveryEnabled &&
      (Boolean(profile.telegramChatId) ||
        (deliveryPrefs.emailDigestEnabled && Boolean(deliveryPrefs.digestEmail)) ||
        deliveryPrefs.webPushEnabled);
    groups.push({
      key: "delivery",
      label: "Доставка радара настроена",
      filled: channelReady,
    });
  }

  const filledCount = groups.filter((g) => g.filled).length;
  const totalCount = groups.length;

  return {
    groups,
    filledCount,
    totalCount,
    ratio: totalCount > 0 ? filledCount / totalCount : 0,
    isComplete: filledCount === totalCount,
  };
}
