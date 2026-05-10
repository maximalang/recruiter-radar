import type { HhDigestItem } from "./hhDigest";

const TELEGRAM_DIGEST_FEEDBACK_ACTIONS = [
  {
    key: "accepted",
    label: "✅ Беру"
  },
  {
    key: "badfit",
    label: "👎 Мимо"
  },
  {
    key: "snooze",
    label: "⏸ Позже"
  }
] as const;

export function buildTelegramDigestAuditItems(items: readonly HhDigestItem[]) {
  return items.map((item) => ({
    orgId: item.orgId,
    rank: item.rank,
    employerName: item.employer_name
  }));
}

export function buildTelegramDigestFeedbackReplyMarkup(input: {
  clientProfileId: string;
  items: readonly HhDigestItem[];
}) {
  const clientProfileId = normalizePositiveIntegerString(input.clientProfileId);

  if (!clientProfileId) {
    return null;
  }

  const inlineKeyboard = input.items
    .map((item) => buildItemFeedbackRows(clientProfileId, item))
    .flat();

  if (inlineKeyboard.length === 0) {
    return null;
  }

  return {
    inline_keyboard: inlineKeyboard
  };
}

function buildItemFeedbackRows(clientProfileId: string, item: HhDigestItem) {
  const orgId = normalizePositiveIntegerString(item.orgId);

  if (!orgId) {
    return [];
  }

  return [
    [
      {
        text: `${item.rank}. ${truncateLabel(item.employer_name)}`,
        callback_data: buildFeedbackCallbackData({
          clientProfileId,
          orgId,
          action: "shown"
        })
      }
    ],
    TELEGRAM_DIGEST_FEEDBACK_ACTIONS.map((action) => ({
      text: action.label,
      callback_data: buildFeedbackCallbackData({
        clientProfileId,
        orgId,
        action: action.key
      })
    }))
  ];
}

function buildFeedbackCallbackData(input: {
  clientProfileId: string;
  orgId: string;
  action: "shown" | "accepted" | "badfit" | "snooze";
}): string {
  return `dgf:${input.clientProfileId}:${input.orgId}:${input.action}`;
}

function normalizePositiveIntegerString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  if (!/^\d+$/.test(normalizedValue)) {
    return null;
  }

  return normalizedValue;
}

function truncateLabel(value: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length <= 24) {
    return normalizedValue || "Компания";
  }

  return `${normalizedValue.slice(0, 21)}…`;
}
