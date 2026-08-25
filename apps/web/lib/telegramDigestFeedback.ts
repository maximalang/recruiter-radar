import { createHmac, timingSafeEqual } from "node:crypto";

import type { HhDigestItem } from "./hhDigest";

const TELEGRAM_DIGEST_FEEDBACK_ACTIONS = [
  {
    key: "accepted",
    label: "Беру"
  },
  {
    key: "badfit",
    label: "Мимо"
  },
  {
    key: "snooze",
    label: "Позже"
  },
  {
    key: "contacted",
    label: "Уже написал"
  },
  {
    key: "replied",
    label: "Ответили"
  },
  {
    key: "meeting",
    label: "Созвон"
  },
  {
    key: "won",
    label: "Клиент"
  },
  {
    key: "dismissed",
    label: "Скрыть похожие"
  }
] as const;

// Telegram limits callback_data to 64 bytes. We use 1-char action codes and a
// 22-char base64url HMAC tag (128 bits) to stay well under that ceiling.
const TELEGRAM_CALLBACK_DATA_LIMIT = 64;
const DIGEST_FEEDBACK_SIG_LENGTH = 22;

const ACTION_TO_CODE = {
  shown: "v",
  accepted: "a",
  badfit: "b",
  snooze: "s",
  contacted: "c",
  replied: "r",
  meeting: "m",
  won: "w",
  dismissed: "d",
} as const;

const CODE_TO_ACTION: Record<string, "shown" | "accepted" | "badfit" | "snooze" | "contacted" | "replied" | "meeting" | "won" | "dismissed"> = {
  v: "shown",
  a: "accepted",
  b: "badfit",
  s: "snooze",
  c: "contacted",
  r: "replied",
  m: "meeting",
  w: "won",
  d: "dismissed",
};

export type SignedDigestFeedbackCallback = {
  client_profile_id: string;
  org_id: string;
  action: "shown" | "accepted" | "badfit" | "snooze" | "contacted" | "replied" | "meeting" | "won" | "dismissed";
  sig: string;
};

export type UnsignedDigestFeedbackCallback = {
  client_profile_id: string;
  org_id: string;
  action: "shown" | "accepted" | "badfit" | "snooze" | "contacted" | "replied" | "meeting" | "won" | "dismissed";
};

export function buildTelegramDigestAuditItems(items: readonly HhDigestItem[]) {
  return items.map((item) => ({
    org_id: item.org_id,
    rank: item.rank,
    employer_name: item.employer_name
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
  const org_id = normalizePositiveIntegerString(item.org_id);

  if (!org_id) {
    return [];
  }

  return [
    [
      {
        text: `${item.rank}. ${truncateLabel(item.employer_name)}`,
        callback_data: buildFeedbackCallbackData({
          clientProfileId,
          org_id,
          action: "shown"
        })
      }
    ],
    ...chunk(
      TELEGRAM_DIGEST_FEEDBACK_ACTIONS.map((action) => ({
        text: action.label,
        callback_data: buildFeedbackCallbackData({
          clientProfileId,
          org_id,
          action: action.key
        })
      })),
      4,
    ),
  ];
}

function buildFeedbackCallbackData(input: {
  clientProfileId: string;
  org_id: string;
  action: "shown" | "accepted" | "badfit" | "snooze" | "contacted" | "replied" | "meeting" | "won" | "dismissed";
}): string {
  const unsigned: UnsignedDigestFeedbackCallback = {
    client_profile_id: input.clientProfileId,
    org_id: input.org_id,
    action: input.action,
  };
  const sig = signDigestFeedbackCallback(unsigned);
  const code = ACTION_TO_CODE[input.action];
  const data = `d:${input.clientProfileId}:${input.org_id}:${code}:${sig}`;
  if (Buffer.byteLength(data, "utf8") > TELEGRAM_CALLBACK_DATA_LIMIT) {
    throw new Error("digest feedback callback_data exceeds Telegram limit");
  }
  return data;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}

function signDigestFeedbackCallback(unsigned: UnsignedDigestFeedbackCallback): string {
  const secret = (process.env.DIGEST_CALLBACK_SECRET ?? "").trim();
  if (!secret) {
    throw new Error("DIGEST_CALLBACK_SECRET is not configured.");
  }
  const code = ACTION_TO_CODE[unsigned.action];
  const payload = `${unsigned.client_profile_id}:${unsigned.org_id}:${code}`;
  const hmac = createHmac("sha256", secret);
  hmac.update(payload);
  return hmac.digest("base64url").slice(0, DIGEST_FEEDBACK_SIG_LENGTH);
}

export function verifyDigestFeedbackCallback(data: string | null): SignedDigestFeedbackCallback | null {
  if (!data) return null;
  if (Buffer.byteLength(data, "utf8") > TELEGRAM_CALLBACK_DATA_LIMIT) return null;
  const parts = data.split(":");
  if (parts.length !== 5 || parts[0] !== "d") return null;
  const [, clientProfileId, orgId, code, sig] = parts;
  if (!isPositiveIntegerString(clientProfileId) || !isPositiveIntegerString(orgId)) return null;
  const action = CODE_TO_ACTION[code];
  if (!action) return null;
  if (sig.length !== DIGEST_FEEDBACK_SIG_LENGTH) return null;

  const secret = (process.env.DIGEST_CALLBACK_SECRET ?? "").trim();
  if (!secret) return null;

  const unsigned: UnsignedDigestFeedbackCallback = {
    client_profile_id: clientProfileId,
    org_id: orgId,
    action,
  };

  const expectedSig = signDigestFeedbackCallback(unsigned);

  // timing-safe compare to prevent brute-force of the HMAC
  const expectedBuf = Buffer.from(expectedSig, "utf8");
  const receivedBuf = Buffer.from(sig, "utf8");
  if (expectedBuf.length !== receivedBuf.length) return null;
  if (!timingSafeEqual(expectedBuf, receivedBuf)) return null;

  return { ...unsigned, sig };
}

function isPositiveIntegerString(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
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

  const TELEGRAM_BUTTON_LABEL_BYTE_LIMIT = 24;
  const ellipsis = "…";

  if (Buffer.byteLength(normalizedValue, "utf8") <= TELEGRAM_BUTTON_LABEL_BYTE_LIMIT) {
    return normalizedValue || "Компания";
  }

  // Trim by bytes, not chars — Telegram counts bytes in UTF-8
  // Walk backwards from the full string to find the longest prefix that fits
  let low = 0;
  let high = normalizedValue.length;
  // Ellipsis itself costs 3 bytes in UTF-8
  const ellipsisBytes = Buffer.byteLength(ellipsis, "utf8");
  const maxContentBytes = TELEGRAM_BUTTON_LABEL_BYTE_LIMIT - ellipsisBytes;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(normalizedValue.slice(0, mid), "utf8") <= maxContentBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return normalizedValue.slice(0, low) + ellipsis;
}